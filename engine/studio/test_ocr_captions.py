"""Reading subtitles that are painted into a video, plus cue grouping rules."""
import subprocess
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from engine.core import db
from engine.core.routes import router as core_router
from engine.studio import ocr_captions
from engine.studio.editor_routes import router
from engine.studio.separation_routes import router as separation_router
from engine.studio.media import ffmpeg_binary


class GroupingTests(unittest.TestCase):
    """Neighbouring frames read the same line slightly differently."""

    def test_repeated_readings_become_one_cue(self):
        cues = ocr_captions.group_readings(
            [(0.0, "HELLO THERE", 0.9), (0.5, "HELLO THERE", 0.9),
             (1.0, "HELLO THERE", 0.8), (1.5, "GOODBYE", 0.9)],
            interval=0.5,
        )
        self.assertEqual([c["text"] for c in cues], ["HELLO THERE", "GOODBYE"])
        self.assertAlmostEqual(cues[0]["start"], 0.0)
        self.assertAlmostEqual(cues[0]["end"], 1.5)

    def test_styling_differences_do_not_split_a_cue(self):
        cues = ocr_captions.group_readings(
            [(0.0, "Your orange is NOT", 0.9), (0.5, "YOUR ORANGE IS NOT", 0.9),
             (1.0, "your orange is not!", 0.9)],
            interval=0.5,
        )
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0]["text"], "Your orange is NOT")

    def test_low_confidence_and_empty_readings_are_dropped(self):
        cues = ocr_captions.group_readings(
            [(0.0, "", 0.0), (0.5, "   ", 0.9), (1.0, "NOISE", 0.2),
             (1.5, "REAL TEXT", 0.9)],
            interval=0.5,
        )
        self.assertEqual([c["text"] for c in cues], ["REAL TEXT"])

    def test_a_long_run_is_chunked_and_no_time_is_lost(self):
        long_run = [(round(n * 0.5, 2), "SAME LINE", 0.9) for n in range(40)]
        cues = ocr_captions.group_readings(long_run, interval=0.5)
        self.assertGreater(len(cues), 1)
        for cue in cues:
            self.assertLessEqual(cue["end"] - cue["start"], ocr_captions.MAX_CUE)
        # Chunks must stay consecutive, not overlap or leave gaps.
        for earlier, later in zip(cues, cues[1:]):
            self.assertAlmostEqual(earlier["end"], later["start"], places=2)
        self.assertAlmostEqual(cues[0]["start"], 0.0)
        self.assertAlmostEqual(cues[-1]["end"], 19.5 + 0.5)

    def test_every_cue_is_a_forward_ending_span(self):
        cues = ocr_captions.group_readings(
            [(0.0, "ONE", 0.9), (0.5, "TWO", 0.9), (1.0, "THREE", 0.9)],
            interval=0.5,
        )
        for cue in cues:
            self.assertLess(cue["start"], cue["end"])
            self.assertTrue(0.0 <= cue["confidence"] <= 1.0)


class ReadBandTests(unittest.TestCase):
    """The band sampler talks to real ffmpeg."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.clip = Path(cls.tmp.name) / "band.mp4"
        subprocess.run(
            [ffmpeg_binary(), "-v", "error", "-y", "-f", "lavfi", "-i",
             "color=c=black:s=320x240:d=2:r=10", "-c:v", "libx264",
             "-pix_fmt", "yuv420p", str(cls.clip)],
            check=True, capture_output=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_band_sampler_returns_normalised_frames(self):
        frames = list(ocr_captions._read_band(self.clip, 320, 240, 0.5))
        self.assertTrue(frames)
        for time, frame in frames:
            self.assertGreaterEqual(time, 0.0)
            self.assertEqual(frame.ndim, 3)
            self.assertEqual(frame.shape[2], 3)
            # The band is normalised to a height the recogniser can read.
            self.assertGreaterEqual(frame.shape[0], 32)

    def test_band_is_clamped_to_the_picture(self):
        # A band that runs off the bottom must still produce a usable crop.
        frames = list(
            ocr_captions._read_band(self.clip, 320, 240, 1.0, band=(5.0, 9.0))
        )
        self.assertTrue(frames)

    def test_narrow_interval_yields_more_frames_than_fast(self):
        fast = list(ocr_captions._read_band(self.clip, 320, 240, 1.0))
        quick = list(ocr_captions._read_band(self.clip, 320, 240, 0.25))
        self.assertGreater(len(quick), len(fast))


class OcrRouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data_patch = patch.object(db, "DATA_DIR", Path(self.tmp.name))
        self.data_patch.start()
        self.addCleanup(self.data_patch.stop)
        self.addCleanup(self.tmp.cleanup)
        app = FastAPI()
        app.include_router(core_router)
        app.include_router(separation_router)
        app.include_router(router)
        self.client = TestClient(app)
        self.id = str(uuid4())
        with db.connect() as connection:
            connection.execute(
                "INSERT INTO clips (id,title,license_status,created_at) VALUES (?,?,?,?)",
                (self.id, "OCR fixture", "owned", db.now()),
            )

    def test_capability_reports_ocr_availability(self):
        body = self.client.get("/api/editor-capabilities").json()
        self.assertIn("ocr", body)
        self.assertIn("available", body["ocr"])
        self.assertTrue(body["ocr"]["message"])

    def test_missing_runtime_is_refused_with_an_honest_message(self):
        with patch.object(ocr_captions, "ocr_capability",
                          return_value={"available": False, "message": "not installed"}):
            response = self.client.post(
                f"/api/editor/{self.id}/ocr-captions", json={"asset_id": "missing"}
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("not installed", response.json()["detail"])

    def test_unknown_speed_is_rejected(self):
        response = self.client.post(
            f"/api/editor/{self.id}/ocr-captions",
            json={"asset_id": "x", "speed": "turbo"},
        )
        self.assertEqual(response.status_code, 422)

    def test_audio_asset_is_refused_because_it_has_no_picture(self):
        with patch.object(ocr_captions, "ocr_capability", return_value={"available": True, "message": "ok"}):
            with patch("engine.studio.editor_media.get_editor_asset",
                       return_value=({}, "/tmp/x.wav", {"media_type": "audio"})):
                job_id = db.new_job("editor_ocr_captions", self.id)["id"]
                ocr_captions.ocr_captions_job(job_id, self.id, "a")
        job = db.get_job(job_id)
        self.assertEqual(job["status"], "failed")
        self.assertIn("video", job["error"])


if __name__ == "__main__":
    unittest.main()