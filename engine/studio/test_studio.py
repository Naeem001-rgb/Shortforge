import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
import wave

from fastapi import FastAPI
from fastapi.testclient import TestClient

from engine.core import db
from engine.ai.routes import router as ai_router
from engine.studio.routes import CaptionRegion, ExportRequest, caption_timing, router
from engine.studio.captions import all_presets, get_preset, make_ass, prepare_fonts, shifted_words
from engine.studio.media import approximate_words, audio_fit_note, ffmpeg_binary, probe_media
from engine.studio.render import build_export_command


class CaptionLogicTests(unittest.TestCase):
    def test_ten_distinct_presets(self):
        presets = all_presets()
        self.assertEqual(len(presets), 10)
        self.assertEqual(len({p["id"] for p in presets}), 10)
        with self.assertRaises(ValueError):
            get_preset("../../secrets")

    def test_subtitles_escape_user_override_tags_and_keep_timing(self):
        words = [{"word": "{\\pos(0,0)}Hello", "start": 1, "end": 1.5}, {"word": "world", "start": 2, "end": 2.5}]
        content = make_ass(words, get_preset("karaoke-highlight"), 64, .75, 4, "#FFFFFF", "#0A84FF")
        self.assertIn("0:00:01.00,0:00:02.50", content)
        self.assertNotIn("{\\pos(0,0)}", content)
        self.assertIn("\\kf100", content)

    def test_trim_offsets_source_word_timestamps(self):
        words = [{"word": "before", "start": 0, "end": 1}, {"word": "during", "start": 2, "end": 3}, {"word": "after", "start": 4, "end": 5}]
        self.assertEqual(shifted_words(words, 1.5, 2), [{"word": "during", "start": .5, "end": 1.5}])

    def test_approximation_ends_at_audio_duration(self):
        words = approximate_words("hello shorter voice", 4)
        self.assertEqual(words[0]["start"], 0)
        self.assertEqual(words[-1]["end"], 4)

    def test_export_command_maps_mixed_audio_and_never_uses_shell(self):
        options = ExportRequest(clip_id="test", audio_mode="mix", caption_mode="blur").model_dump()
        command = build_export_command("ffmpeg", Path("a tricky; name.mp4"), Path("out.mp4"), options, 5, True, Path("voice.wav"), "abcdef.ass")
        self.assertIn("a tricky; name.mp4", command)
        filters = command[command.index("-filter_complex") + 1]
        self.assertIn("boxblur", filters)
        self.assertIn("amix=inputs=2", filters)
        self.assertIn("ass=abcdef.ass", filters)
        self.assertIn("fontsdir=fonts", filters)
        self.assertNotIn("-shortest", command)

    def test_region_cannot_extend_outside_video(self):
        with self.assertRaises(ValueError):
            CaptionRegion(x=.8, width=.8)
        with self.assertRaises(ValueError):
            ExportRequest(clip_id="test", crop_zoom=float("nan"))

    def test_audio_fit_describes_cuts_and_real_mix_tail(self):
        self.assertIn("last 2.00s", audio_fit_note(10, 12, "replace", True))
        self.assertIn("will be cut", audio_fit_note(10, 12, "replace", True))
        self.assertIn("was cut", audio_fit_note(10, 12, "replace", True, completed=True))
        self.assertIn("original audio", audio_fit_note(10, 8, "mix", True))
        self.assertIn("silence", audio_fit_note(10, 8, "mix", False))
        self.assertIn("silence", audio_fit_note(10, 8, "mix", True, original_volume=0))


class StudioAPITests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.db_patch = patch.object(db, "DATA_DIR", self.folder)
        self.db_patch.start()
        app = FastAPI()
        app.include_router(router)
        app.include_router(ai_router)
        self.client = TestClient(app)
        self.unknown = self.add_clip("unknown")
        self.owned = self.add_clip("owned")

    def tearDown(self):
        self.client.close()
        self.db_patch.stop()
        self.temporary.cleanup()

    def add_clip(self, status):
        identity = str(uuid4())
        with db.connect() as connection:
            connection.execute("INSERT INTO clips (id,title,description,license_status,created_at) VALUES (?,?,?,?,?)", (identity, "A topic", "Metadata only", status, db.now()))
        return identity

    def test_unknown_cannot_export_or_detect_captions_via_direct_api(self):
        for route in ("/api/export", "/api/captions/detect"):
            response = self.client.post(route, json={"clip_id": self.unknown, "text": "borrowed transcript"})
            self.assertEqual(response.status_code, 403, response.text)
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)

    def test_original_mode_uses_metadata_and_ignores_transcript(self):
        result = {"original_text": "A topic", "rewritten_text": "New original narration", "words_original": 2, "words_rewritten": 3, "within_tolerance": False, "attempts": 1}
        with patch("engine.ai.routes.original_script", return_value=result) as generate:
            response = self.client.post("/api/rewrite", json={"clip_id": self.unknown, "mode": "original", "text": "PRIVATE TRANSCRIPT"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("A topic", generate.call_args.args[0])
        self.assertNotIn("PRIVATE TRANSCRIPT", generate.call_args.args[0])

    def test_new_voice_never_reuses_source_transcript_timestamps(self):
        with db.connect() as connection:
            connection.execute("INSERT INTO transcripts VALUES (?,?,?)", (self.owned, "source words", json.dumps([{"word": "source", "start": 40, "end": 50}])))
        voice = self.folder / "voice.wav"
        voice.with_suffix(".timing.json").write_text(json.dumps({"text": "new narration", "duration": 3, "words": []}))
        timing = caption_timing(ExportRequest(clip_id=self.owned, caption_text="new narration", audio_mode="replace"), 3, voice)
        self.assertEqual(timing["timing_method"], "approximate")
        self.assertEqual(timing["words"][0]["start"], 0)
        self.assertEqual(timing["words"][-1]["end"], 3)

    def test_long_voice_caption_fallback_does_not_show_words_beyond_video_end(self):
        voice = self.folder / "voice.wav"
        voice.with_suffix(".timing.json").write_text(json.dumps({"text": "old text", "duration": 10, "words": []}))
        timing = caption_timing(ExportRequest(clip_id=self.owned, caption_text="one two six ten", audio_mode="replace"), 5, voice)
        self.assertEqual([word["word"] for word in timing["words"]], ["one", "two"])
        self.assertEqual(timing["words"][-1]["end"], 5)
        self.assertIn("differs", timing["timing_note"])

    def test_rewritten_captions_with_original_audio_report_mismatch(self):
        with db.connect() as connection:
            connection.execute("INSERT INTO transcripts VALUES (?,?,?)", (self.owned, "old transcript", json.dumps([{"word": "old", "start": 0, "end": 1}])))
        timing = caption_timing(ExportRequest(clip_id=self.owned, caption_text="fresh new script"), 3, None)
        self.assertIn("Original audio remains unchanged", timing["timing_note"])

    def test_clone_needs_consent_and_saves_reference_without_pretending_model_ready(self):
        audio = io.BytesIO()
        with wave.open(audio, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(16000)
            output.writeframes(b"\0\0" * (16000 * 7))
        contents = audio.getvalue()
        rejected = self.client.post("/api/voices/clone", files={"file": ("sample.wav", contents, "audio/wav")}, data={"name": "My voice", "consent": "false"})
        self.assertEqual(rejected.status_code, 400)
        try:
            ffmpeg_binary()
        except ValueError:
            self.skipTest("FFmpeg unavailable for reference media verification")
        accepted = self.client.post("/api/voices/clone", files={"file": ("sample.wav", contents, "audio/wav")}, data={"name": "My voice", "consent": "true"})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertTrue(accepted.json()["cloned"])
        self.assertFalse(accepted.json()["available"])
        self.assertIn("Reference saved", accepted.json()["description"])
        deleted = self.client.delete("/api/voices/" + accepted.json()["id"])
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(list((self.folder / "voices").glob("*.wav")), [])

    def test_real_cpu_exports_caption_treatments_and_handles_silent_video(self):
        try:
            executable = ffmpeg_binary()
        except ValueError:
            self.skipTest("FFmpeg not installed")
        source = self.folder / "source.mp4"
        subprocess.run([executable, "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x568:r=30:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", str(source)], check=True, capture_output=True, timeout=30)
        db.add_asset(self.owned, "source", source)
        for mode in ("cover", "blur", "crop"):
            response = self.client.post("/api/export", json={"clip_id": self.owned, "caption_text": "Local captions work", "caption_mode": mode, "preset": "gradient-pop" if mode == "crop" else "bold-pop"})
            self.assertEqual(response.status_code, 200, response.text)
            job = db.get_job(response.json()["id"])
            self.assertEqual(job["status"], "completed", job)
            asset = self.folder / job["result"]["asset"]["path"]
            self.assertGreater(asset.stat().st_size, 500)
            metadata = probe_media(asset)
            self.assertTrue(metadata["video"])
            self.assertFalse(metadata["audio"])
            self.assertEqual(job["result"]["timing_method"], "approximate")

    def test_real_export_mixes_and_replaces_audio_with_new_voice_timing(self):
        try:
            executable = ffmpeg_binary()
        except ValueError:
            self.skipTest("FFmpeg not installed")
        source = self.folder / "source.mp4"
        voice = self.folder / "voice.wav"
        subprocess.run([executable, "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=320x568:r=30:d=0.4", "-f", "lavfi", "-i", "sine=frequency=300:duration=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", str(source)], check=True, capture_output=True, timeout=30)
        subprocess.run([executable, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=600:duration=0.4", "-y", str(voice)], check=True, capture_output=True, timeout=30)
        db.add_asset(self.owned, "source", source)
        db.add_asset(self.owned, "voiceover", voice)
        voice.with_suffix(".timing.json").write_text(json.dumps({"text": "new voice", "words": [{"word": "new", "start": 0, "end": .2}, {"word": "voice", "start": .2, "end": .4}], "duration": .4, "timing_method": "whisper", "timing_note": "New audio timestamps"}))
        for mode in ("replace", "mix"):
            response = self.client.post("/api/export", json={"clip_id": self.owned, "caption_text": "new voice", "audio_mode": mode, "preset": "karaoke-highlight"})
            job = db.get_job(response.json()["id"])
            self.assertEqual(job["status"], "completed", job)
            self.assertEqual(job["result"]["timing_method"], "whisper")
            self.assertTrue(probe_media(self.folder / job["result"]["asset"]["path"])["audio"])

    def test_export_duration_notes_are_available_before_rendering(self):
        source = self.folder / "source.mp4"
        source.write_bytes(b"source placeholder")
        voice = self.folder / "voice.wav"
        voice.write_bytes(b"voice placeholder")
        db.add_asset(self.owned, "source", source)
        db.add_asset(self.owned, "voiceover", voice)
        def metadata(path):
            return {"duration": 12 if path == voice else 10, "audio": True, "video": path == source}
        with patch("engine.studio.routes.ffmpeg_binary", return_value="ffmpeg"), patch("engine.studio.routes.probe_media", side_effect=metadata), patch("engine.studio.routes.render_job"):
            response = self.client.post("/api/export", json={"clip_id": self.owned, "captions": False, "audio_mode": "replace", "trim_start": 2, "trim_end": 11})
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()["result"]
        self.assertIn("will be cut", result["audio_note"])
        self.assertIn("exceeds the source", result["trim_note"])
        self.assertEqual(result["duration"], 8)
        self.assertEqual((result["width"], result["height"]), (1080, 1920))

    def test_ffmpeg_selects_the_bundled_subtitle_font(self):
        try:
            executable = ffmpeg_binary()
        except ValueError:
            self.skipTest("FFmpeg not installed")
        prepare_fonts(self.folder)
        subtitle = self.folder / "abcdef.ass"
        subtitle.write_text(make_ass([{"word": "Bundled font", "start": 0, "end": 1}], get_preset("clean-minimal"), 64, .75, 4, "#FFFFFF", "#0A84FF"), encoding="utf-8")
        process = subprocess.run([executable, "-hide_banner", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=1:d=1", "-vf", "ass=abcdef.ass:fontsdir=fonts", "-frames:v", "1", "-f", "null", "-"], cwd=self.folder, capture_output=True, text=True, timeout=30)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("Loading font file 'fonts/DejaVuSans.ttf'", process.stderr)
        self.assertRegex(process.stderr, r"fontselect: \(DejaVu Sans, 400, 0\) -> DejaVuSans")


if __name__ == "__main__":
    unittest.main()
