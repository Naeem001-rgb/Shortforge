"""Transitions: model, pairing maths, renderer output, and overlap validation.

Every assertion here is about behaviour a user can observe — a clip that fades
wrong, a transition the timeline accepts but cannot render, a payload that slips
client text into an FFmpeg filter graph. The FFmpeg tests render real pixels
rather than asserting on strings, because a filter string can be perfectly
well-formed and still produce the wrong picture.
"""
import subprocess
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import get_args
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from engine.core import db
from engine.studio.editor_models import Project, TimelineItem
from engine.studio.editor_render import STATIC_BLUR, build_render_command
from engine.studio.editor_routes import router
from engine.studio.editor_transitions import (
    MAX_TRANSITION_DURATION,
    MIN_TRANSITION_OVERLAP,
    NO_TRANSITION,
    TRANSITIONS,
    TransitionName,
    transition_map,
)
from engine.studio.media import ffmpeg_binary


def video(identity, start=0.0, duration=2.0, track=0, **values):
    return TimelineItem.model_validate({
        'id': identity, 'kind': 'video', 'asset_id': identity, 'name': identity,
        'track': track, 'start': start, 'duration': duration, **values,
    })


def solid_clip(directory, color):
    """A 3s solid clip, real enough for FFmpeg to actually render."""
    from pathlib import Path
    target = Path(directory) / f'{color}.mp4'
    subprocess.run([ffmpeg_binary(), '-v', 'error', '-y', '-f', 'lavfi', '-i',
                    f'color={color}:s=160x90:r=30:d=3', '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p', str(target)], check=True)
    return target


def red_clip(directory):
    return solid_clip(directory, 'red')


class ModelTests(unittest.TestCase):
    def test_transition_name_literal_cannot_drift_from_the_catalogue(self):
        # §1: the union IS the catalogue, built from TRANSITIONS rather than
        # hand-typed. Renaming a transition cannot leave the model behind.
        self.assertEqual(set(get_args(TransitionName)), {NO_TRANSITION, *TRANSITIONS})

    def test_defaults_match_the_catalogue_bounds(self):
        item = video('a')
        self.assertEqual(item.transition_in, NO_TRANSITION)
        self.assertEqual(item.transition_duration, 0.6)
        self.assertGreaterEqual(item.transition_duration, MIN_TRANSITION_OVERLAP)
        self.assertLessEqual(item.transition_duration, MAX_TRANSITION_DURATION)

    def test_saved_projects_without_transitions_still_validate(self):
        # The dashboard writes a timeline per autosave. Adding two fields must
        # not invalidate every project already on disk.
        self.assertEqual(video('a').transition_in, NO_TRANSITION)

    def test_unknown_transition_id_is_rejected_by_the_model(self):
        with self.assertRaises(ValidationError):
            video('a', transition_in='xfade=transition=fade')

    def test_transition_duration_bounds(self):
        with self.assertRaises(ValidationError):
            video('a', transition_duration=0.01)
        with self.assertRaises(ValidationError):
            video('a', transition_duration=MAX_TRANSITION_DURATION + 0.1)


class PairingTests(unittest.TestCase):
    """The window maths decides which frames actually blend."""

    def test_pair_needs_real_overlap(self):
        # No transition requested, or no overlap -> absent from the map, which
        # the renderer reads as "draw this layer plain".
        self.assertEqual(transition_map([video('a', 0, 2), video('b', 2, 2)]), {})
        self.assertNotEqual(transition_map([
            video('a', 0, 2), video('b', 1.5, 2, transition_in='crossfade'),
        ]), {})

    def test_clips_on_different_tracks_never_transition(self):
        # The renderer stacks tracks; it does not cut between them.
        self.assertEqual(transition_map([
            video('a', 0, 2, track=0),
            video('b', 1.5, 2, track=1, transition_in='crossfade'),
        ]), {})

    def test_blend_start_is_item_local(self):
        # §3.3: geq's T is item-local, so the window start must have item.start
        # subtracted or the ramp fires at the wrong frame.
        blends = transition_map([
            video('a', 0, 2), video('b', 1.5, 2, transition_in='crossfade'),
        ])
        self.assertAlmostEqual(blends['b']['incoming'][0], 0.0)   # b begins at the seam
        self.assertAlmostEqual(blends['a']['outgoing'][0], 1.5)  # a leaves 1.5s in

    def test_a_clip_can_be_both_arriving_and_leaving(self):
        # Ruling 6. In A->B->C the middle clip fades in AND out. Collapsing this
        # to one ramp per clip is the bug the spec shipped.
        blends = transition_map([
            video('a', 0, 3), video('b', 1, 3, transition_in='crossfade'),
            video('c', 2, 3, transition_in='crossfade'),
        ])
        self.assertIsNotNone(blends['b']['incoming'])
        self.assertIsNotNone(blends['b']['outgoing'])

    def test_ramp_never_outlives_the_clip(self):
        # §3.3: clamp to the real overlap, or the ramp extends past the item.
        # b lasts 0.6s and the pair overlaps by 0.5s, so a 2s request must be
        # clamped down to the 0.5s that actually exists.
        blends = transition_map([
            video('a', 0, 2.0),
            video('b', 1.5, 0.6, transition_in='crossfade', transition_duration=2.0),
        ])
        self.assertAlmostEqual(blends['b']['incoming'][1], 0.5)

    def test_audio_items_are_excluded(self):
        audio = TimelineItem.model_validate({
            'id': 'm', 'kind': 'audio', 'asset_id': 'm', 'name': 'm',
            'start': 0, 'duration': 3,
        })
        self.assertEqual(transition_map([audio, video('v', 1, 2)]), {})


class ValidationTests(unittest.TestCase):
    """§5: an impossible transition must not reach the renderer."""

    def test_transition_without_overlap_is_rejected_on_save(self):
        with self.assertRaises(ValidationError) as caught:
            Project(items=[video('a', 0, 2),
                           video('b', 2, 2, transition_in='crossfade')])
        self.assertIn('overlap', str(caught.exception))

    def test_valid_transition_saves(self):
        Project(items=[video('a', 0, 2),
                       video('b', 1.5, 2, transition_in='crossfade')])

    def test_no_transition_means_no_constraint(self):
        Project(items=[video('a', 0, 2), video('b', 2, 2)])


class RenderTests(unittest.TestCase):
    """§3: the filter graph, verified against the real FFmpeg build."""

    def project(self, identifier='crossfade'):
        return Project(width=1080, height=1080, items=[
            video('a', 0, 3),
            video('b', 2, 3, transition_in=identifier, transition_duration=1.0),
        ])

    def graph(self, project):
        from pathlib import Path
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source = red_clip(directory)
            assets = {item.asset_id: (None, source, {'has_audio': False})
                      for item in project.items if item.kind != 'text'}
            build_render_command(project, assets, Path(folder) / 'out.mp4',
                                 720, directory)
            return (directory / 'filters.txt').read_text()

    def test_blend_precedes_setpts_so_T_stays_item_local(self):
        # §3.1: load-bearing ordering. Reversing it silently moves every ramp.
        layer = next(part for part in self.graph(self.project()).split(';\n')
                     if 'geq' in part and part.endswith('[layer1]'))
        self.assertLess(layer.index('geq'), layer.rindex('setpts'))

    def test_transition_multiplies_into_the_alpha_expression(self):
        # b starts at 2s and the pair overlaps [2,3], so b's own local blend
        # begins at 0 — the ramp is clip((T-0)/1,0,1).
        self.assertIn('clip((T-0)/1,0,1)', self.graph(self.project()))

    def test_blur_transition_gets_a_time_gated_blur(self):
        # Ruling 7: an ungated boxblur would blur the entire clip, not the blend.
        # Both halves get one, each gated to its OWN local time: b starts at 2s
        # so its blend is local [0,1], while a's is local [2,3].
        self.assertIn('blur', STATIC_BLUR)
        parts = self.graph(self.project('blur')).split(';\n')
        incoming = next(p for p in parts if 'boxblur' in p and p.endswith('[layer1]'))
        outgoing = next(p for p in parts if 'boxblur' in p and p.endswith('[layer0]'))
        self.assertIn("enable='between(t,0,1)'", incoming)
        self.assertIn("enable='between(t,2,3)'", outgoing)

    def test_every_catalogue_id_renders_in_real_ffmpeg(self):
        # §3.4's honest scope: the alpha-ramp path is exercised end to end.
        from pathlib import Path
        import tempfile
        for identifier in sorted(TRANSITIONS):
            with self.subTest(transition=identifier), \
                    tempfile.TemporaryDirectory() as folder:
                directory = Path(folder)
                project = self.project(identifier)
                source = red_clip(directory)
                assets = {item.asset_id: (None, source, {'has_audio': False})
                          for item in project.items}
                result = subprocess.run(
                    build_render_command(project, assets,
                                         directory / 'out.mp4', 720, directory),
                    capture_output=True, text=True, cwd=directory)
                self.assertEqual(result.returncode, 0, result.stderr[-600:])


class PixelTests(unittest.TestCase):
    """The blend must be a real mix, not two hard cuts wearing a label."""

    def frames(self, project, colours):
        """Render `project` and read back the centre pixel at three instants.

        The centre is sampled rather than (0,0) because a 16:9 source is
        letterboxed into a square canvas, so the corner is padding, not picture.
        """
        from pathlib import Path
        import tempfile
        ffmpeg = ffmpeg_binary()
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            sources = [solid_clip(directory, colour) for colour in colours]
            assets = {item.asset_id: (None, sources[index], {'has_audio': False})
                      for index, item in enumerate(project.items)
                      if item.kind != 'text'}
            output = directory / 'out.mp4'
            subprocess.run(build_render_command(project, assets, output, 720, directory),
                           check=True, capture_output=True, cwd=directory)
            raw = subprocess.run(
                [ffmpeg, '-v', 'error', '-i', str(output), '-vf',
                 # t=0.5s (before the blend), t=2.5s (mid-blend), t=4.0s (after).
                 r'select=eq(n\,15)+eq(n\,75)+eq(n\,120)', '-vsync', '0',
                 '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                capture_output=True, check=True).stdout
        size = 720 * 720 * 3
        centre = 360 * 720 * 3 + 360 * 3
        return [tuple(raw[i * size + centre:i * size + centre + 3])
                for i in range(len(raw) // size)]

    def test_a_crossfade_really_mixes_the_two_clips(self):
        # Ruling the spec asked for a second pair of eyes on. Red fades into
        # blue over [2,3]; at the midpoint the canvas must be neither colour.
        before, middle, after = self.frames(Project(width=1080, height=1080, items=[
            video('a', 0, 3),
            video('b', 2, 3, transition_in='crossfade', transition_duration=1.0),
        ]), ['red', 'blue'])
        self.assertEqual(len((before, middle, after)), 3)
        self.assertGreater(before[0], 200)       # pure red before the blend
        self.assertLess(before[2], 60)
        # Mid-blend the canvas must be genuinely BETWEEN the two clips: red
        # still contributing, blue genuinely arrived, neither fully dominant.
        self.assertGreater(middle[0], 60)
        self.assertGreater(middle[2], 60)
        self.assertLess(middle[0], 220)
        self.assertLess(middle[2], 220)
        self.assertGreater(after[2], 200)        # pure blue after it
        self.assertLess(after[0], 60)

    def test_no_transition_is_a_hard_cut(self):
        # The control: without a transition the same edit switches instantly,
        # which is what proves the test above is measuring a blend.
        before, middle, after = self.frames(Project(width=1080, height=1080, items=[
            video('a', 0, 3),
            video('b', 2, 3),
        ]), ['red', 'blue'])
        self.assertGreater(before[0], 200)       # red before the cut
        self.assertLess(before[2], 60)
        self.assertGreater(middle[2], 200)       # already fully blue at t=2.5s
        self.assertLess(middle[0], 60)


class ApiTests(unittest.TestCase):
    """§5 and §6 at the HTTP boundary, not just in the model.

    A rule enforced only in the model is one a future route can route around, so
    the save and export paths are exercised directly here.
    """

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.db_patch = patch.object(db, 'DATA_DIR', self.folder)
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.addCleanup(self.temporary.cleanup)
        self.clip = str(uuid4())
        with db.connect() as connection:
            connection.execute(
                'INSERT INTO clips (id,title,license_status,created_at) VALUES (?,?,?,?)',
                (self.clip, 'My movie', 'owned', db.now()))
        # Real media, because the save route probes the asset before Pydantic
        # ever sees the timeline — a missing file would 404 before the
        # transition rule could be exercised.
        self.assets = []
        for colour in ('red', 'blue'):
            source = solid_clip(self.folder, colour)
            target = self.folder / f'{colour}-copy{source.suffix}'
            shutil.copyfile(source, target)
            self.assets.append(
                db.add_asset(self.clip, 'video', target))
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def payload(self, overlapping=True, transition=None):
        """A two-clip timeline. `overlapping=False` puts them back to back so a
        transition genuinely cannot play between them."""
        def item(identity, start, duration, **values):
            return {'id': identity, 'kind': 'video',
                    'asset_id': self.assets[0 if identity == 'a' else 1]['id'],
                    'name': identity.upper(), 'track': 0, 'start': start,
                    'source_in': 0, 'duration': duration, 'transition_in': 'none',
                    'transition_duration': 0.6, **values}
        items = ([item('a', 0, 3), item('b', 2, 3)] if overlapping
                 else [item('a', 0, 2), item('b', 2, 2)])
        if transition:
            items[1]['transition_in'] = transition
        return {'version': 1, 'width': 1080, 'height': 1920, 'fps': 30,
                'background': '#000000', 'items': items}

    def test_impossible_transition_is_rejected_on_save(self):
        response = self.client.put(
            f'/api/editor/{self.clip}',
            json=self.payload(overlapping=False, transition='crossfade'))
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn('overlap', str(response.json()))

    def test_impossible_transition_never_reaches_the_export_route(self):
        # §5: the same check covers export, so an impossible transition cannot
        # render as a silent hard cut.
        response = self.client.post(
            f'/api/editor/{self.clip}/export',
            json={'project': self.payload(overlapping=False,
                                          transition='crossfade'),
                  'resolution': 720})
        self.assertEqual(response.status_code, 422, response.text)

    def test_a_hostile_transition_id_is_rejected_over_http(self):
        # §6: no client string may reach the filter graph.
        for hostile in ('fade; rm -rf /', 'xfade=transition=fade', "$(whoami)",
                        '../../etc/passwd', '123'):
            with self.subTest(payload=hostile):
                response = self.client.put(
                    f'/api/editor/{self.clip}',
                    json=self.payload(transition=hostile))
                self.assertEqual(response.status_code, 422, response.text)

    def test_a_valid_transition_round_trips_through_save_and_load(self):
        body = self.payload(transition='crossfade')
        body['items'][1]['transition_duration'] = 0.8
        saved = self.client.put(f'/api/editor/{self.clip}', json=body)
        self.assertEqual(saved.status_code, 200, saved.text)
        item = saved.json()['project']['items'][1]
        self.assertEqual(item['transition_in'], 'crossfade')
        self.assertAlmostEqual(item['transition_duration'], 0.8)
        # And it survives a reload, so an autosave cannot drop it.
        loaded = self.client.get(f'/api/editor/{self.clip}')
        self.assertEqual(loaded.json()['project']['items'][1]['transition_in'],
                         'crossfade')


if __name__ == '__main__':
    unittest.main()