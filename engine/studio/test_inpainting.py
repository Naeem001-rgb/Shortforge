"""Caption removal: real media plumbing, boundaries, cancellation and failure behavior."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient

from engine.core import db
from . import inpainting
from .editor_media import probe_media
from .inpainting_worker import Cancelled, caption_mask, process_video
from .media import ffmpeg_binary


class MaskTests(unittest.TestCase):
    def test_ocr_only_erases_detected_text_inside_selected_region(self):
        frame = np.zeros((100, 200, 3), np.uint8)
        detector = lambda *args, **kw: SimpleNamespace(boxes=np.array([[[0, 0], [25, 0], [25, 10], [0, 10]]]))
        mask = caption_mask(frame, {"x": .2, "y": .5, "width": .5, "height": .3}, detector)
        self.assertTrue(mask[50:60, 40:65].all())
        self.assertFalse(mask[:50].any())
        self.assertFalse(mask[:, :40].any())
        self.assertFalse(mask[80:].any())
        self.assertFalse(mask[:, 140:].any())
        self.assertFalse(mask[70:80, 100:130].any())

    def test_empty_detection_does_not_replace_whole_area(self):
        mask = caption_mask(np.zeros((100, 100, 3), np.uint8), {"x": 0, "y": 0, "width": 1, "height": 1},
                            lambda *a, **k: SimpleNamespace(boxes=None))
        self.assertFalse(mask.any())

    def test_detection_uses_full_selected_resolution(self):
        frame = np.zeros((200, 400, 3), np.uint8)
        def detector(crop, **kwargs):
            self.assertEqual(crop.shape[:2], (200, 400))
            return SimpleNamespace(boxes=np.array([[[40, 40], [120, 40], [120, 80], [40, 80]]]))
        mask = caption_mask(frame, {"x": 0, "y": 0, "width": 1, "height": 1}, detector)
        self.assertTrue(mask[40:80, 40:120].all())
        self.assertFalse(mask[:25].any())
        self.assertFalse(mask[:, 150:].any())


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.source = self.directory / "source.mp4"
        subprocess.run([ffmpeg_binary(), "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x240:r=10:d=1",
                        "-f", "lavfi", "-i", "sine=frequency=660:duration=1", "-c:v", "libx264", "-threads", "1",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(self.source)], check=True, capture_output=True)
        self.config = {"source": str(self.source), "output": str(self.directory / "result.mp4"),
                       "cancel": str(self.directory / "cancel"), "model": "unused", "start": .2, "duration": .5,
                       "width": 160, "height": 240, "fps": 10, "mask_mode": "area",
                       "region": {"x": .1, "y": .5, "width": .8, "height": .2}}

    def test_streamed_render_preserves_original_dimensions_audio_and_selected_timing(self):
        original = hashlib.sha256(self.source.read_bytes()).hexdigest()
        calls = []
        def painter(frame, mask):
            calls.append(frame.shape)
            result = frame.copy()
            result[mask > 0] = [255, 0, 0]
            return result
        stats = process_video(self.config, painter=painter)
        self.assertEqual(stats["frames"], 5)
        self.assertEqual(stats["frames_changed"], 5)
        self.assertEqual(calls, [(240, 160, 3)] * 5)
        metadata = probe_media(Path(self.config["output"]))
        self.assertEqual((metadata["width"], metadata["height"]), (160, 240))
        self.assertTrue(metadata["has_audio"])
        self.assertAlmostEqual(metadata["duration"], .5, delta=.06)
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), original)
        self.assertFalse((self.directory / "silent.mp4").exists())

    def test_empty_scan_reports_failure_instead_of_claiming_success(self):
        self.config["mask_mode"] = "text"
        with self.assertRaisesRegex(ValueError, "No text was found"):
            process_video(self.config, painter=lambda f, m: f, detector=lambda *a, **k: SimpleNamespace(boxes=None))
        self.assertFalse(Path(self.config["output"]).exists())

    def test_cancel_cleans_intermediate_video(self):
        def painter(frame, mask):
            Path(self.config["cancel"]).touch()
            return frame
        with self.assertRaises(Cancelled):
            process_video(self.config, painter=painter)
        self.assertFalse((self.directory / "silent.mp4").exists())
        self.assertFalse(Path(self.config["output"]).exists())



class RouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = patch.object(db, "DATA_DIR", Path(self.tmp.name))
        self.data.start()
        self.addCleanup(self.data.stop)
        self.clip = str(uuid4())
        with db.connect() as c:
            c.execute("INSERT INTO clips (id,title,license_status,created_at) VALUES (?,?,?,?)", (self.clip, "Removal test", "owned", db.now()))
        self.app = FastAPI()
        self.app.include_router(inpainting.router)
        self.client = TestClient(self.app)
        self.payload = {"asset_id": "source", "item_id": "timeline-video", "start": 0, "duration": 1}
        self.source = ({"id": "source"}, Path("source.mp4"), {"media_type": "video", "duration": 3, "width": 320, "height": 240})

    def post(self, payload=None):
        return self.client.post(f"/api/editor/{self.clip}/remove-captions", json=payload or self.payload)

    def test_out_of_bounds_region_and_nonfinite_values_rejected(self):
        self.assertEqual(self.post({**self.payload, "region": {"x": .9, "width": .5}}).status_code, 422)
        self.assertEqual(self.post({**self.payload, "start": "NaN"}).status_code, 422)
        self.assertEqual(self.post({**self.payload, "mask_mode": "blur"}).status_code, 422)
        self.assertEqual(self.post({**self.payload, "processing_mode": "fast"}).status_code, 422)

    def test_missing_model_cannot_silently_fall_back_to_blur(self):
        with patch.object(inpainting, "get_editor_asset", return_value=self.source), patch.object(inpainting, "inpainting_capability", return_value={"available": False, "message": "Install AI model"}):
            response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertIn("Install AI", response.json()["detail"])

    def test_source_range_and_preview_duration_are_validated(self):
        with patch.object(inpainting, "get_editor_asset", return_value=self.source):
            self.assertEqual(self.post({**self.payload, "start": 2.5}).status_code, 400)
            longer = (self.source[0], self.source[1], {**self.source[2], "duration": 10})
            with patch.object(inpainting, "get_editor_asset", return_value=longer):
                self.assertEqual(self.post({**self.payload, "duration": 3}).status_code, 400)
            self.assertEqual(self.post({**self.payload, "start": 3, "duration": .01}).status_code, 400)

    def test_source_ownership_is_enforced(self):
        other = str(uuid4())
        with db.connect() as c:
            c.execute("INSERT INTO clips (id,title,license_status,created_at) VALUES (?,?,?,?)", (other, "Other", "owned", db.now()))
        path = Path(self.tmp.name) / "other.mp4"
        path.write_bytes(b"placeholder")
        asset = db.add_asset(other, "video", path)
        self.assertEqual(self.post({**self.payload, "asset_id": asset["id"]}).status_code, 400)

    def test_only_one_memory_heavy_job_can_run(self):
        inpainting.INPAINT_LOCK.acquire()
        try:
            with patch.object(inpainting, "get_editor_asset", return_value=self.source), patch.object(inpainting, "inpainting_capability", return_value={"available": True}):
                self.assertEqual(self.post().status_code, 409)
        finally:
            inpainting.INPAINT_LOCK.release()

    def test_worker_failure_releases_slot_and_removes_partial_output(self):
        inpainting.INPAINT_LOCK.acquire()
        job = db.new_job("editor_remove_captions", self.clip)
        with patch.object(inpainting, "source_for_request", side_effect=ValueError("No readable video")):
            inpainting.removal_job(job["id"], self.clip, inpainting.RemovalRequest(**self.payload))
        self.assertFalse(inpainting.INPAINT_LOCK.locked())
        self.assertEqual(db.get_job(job["id"])["status"], "failed")
        self.assertIn("No readable video", db.get_job(job["id"])["error"])

    def test_cancel_is_scoped_to_its_project_and_job_type(self):
        job = db.new_job("editor_remove_captions", self.clip)
        response = self.client.post(f"/api/editor/{self.clip}/remove-captions/{job['id']}/cancel")
        self.assertEqual(response.status_code, 200)
        self.assertTrue((Path(self.tmp.name) / "caption-removal" / self.clip / job["id"] / "cancel").exists())
        unrelated = db.new_job("editor_extract_audio", self.clip)
        self.assertEqual(self.client.post(f"/api/editor/{self.clip}/remove-captions/{unrelated['id']}/cancel").status_code, 404)


if __name__ == "__main__":
    unittest.main()
