"""Extraction uses real FFmpeg. Model inference is an explicit local opt-in."""

import array
import hashlib
import os
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
from engine.studio.media import ffmpeg_binary
from engine.studio.separation import extract_audio, separation_capability
from engine.studio.separation_routes import router


class AudioEditorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.data_patch = patch.object(db, "DATA_DIR", self.folder)
        self.data_patch.start()
        self.owned = self.add_clip("owned")
        self.other = self.add_clip("owned")
        self.unknown = self.add_clip("unknown")
        self.source = self.folder / "source.mp4"
        subprocess.run([ffmpeg_binary(), "-v", "error", "-f", "lavfi", "-i", "color=c=violet:s=160x284:r=15:d=1.2", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", str(self.source)], capture_output=True, check=True, timeout=30)
        self.asset = db.add_asset(self.owned, "source", self.source)
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.data_patch.stop()
        self.temporary.cleanup()

    def add_clip(self, license_status):
        identity = str(uuid4())
        with db.connect() as connection:
            connection.execute("INSERT INTO clips (id,title,license_status,created_at) VALUES (?,?,?,?)", (identity, "Audio fixture", license_status, db.now()))
        return identity

    def test_real_extraction_preserves_source_and_returns_playable_editor_asset(self):
        before = hashlib.sha256(self.source.read_bytes()).hexdigest()
        response = self.client.post(f"/api/editor/{self.owned}/extract-audio", json={"asset_id": self.asset["id"]})
        self.assertEqual(response.status_code, 200, response.text)
        job = db.get_job(response.json()["id"])
        self.assertEqual(job["status"], "completed", job)
        self.assertEqual(job["type"], "editor_extract_audio")
        result = job["result"]["asset"]
        self.assertEqual(result["kind"], "audio")
        self.assertEqual(result["media_type"], "audio")
        self.assertTrue(result["has_audio"])
        self.assertGreater(len(result["waveform"]), 0)
        with wave.open(str(self.folder / result["path"])) as audio:
            self.assertEqual((audio.getnchannels(), audio.getframerate(), audio.getsampwidth()), (2, 44100, 2))
            self.assertAlmostEqual(audio.getnframes() / audio.getframerate(), 1.2, delta=.05)
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), before)

    def test_rights_and_cross_project_access_fail_before_work_is_created(self):
        for clip, expected in ((self.unknown, 403), (self.other, 400)):
            for operation in ("extract-audio", "separate-audio"):
                response = self.client.post(f"/api/editor/{clip}/{operation}", json={"asset_id": self.asset["id"]})
                self.assertEqual(response.status_code, expected, response.text)
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)

    def test_missing_and_outside_files_are_rejected_before_jobs(self):
        with db.connect() as connection:
            connection.execute("UPDATE assets SET path=? WHERE id=?", ("../../outside.wav", self.asset["id"]))
        response = self.client.post(f"/api/editor/{self.owned}/extract-audio", json={"asset_id": self.asset["id"]})
        self.assertEqual(response.status_code, 400)
        with db.connect() as connection:
            connection.execute("UPDATE assets SET path=? WHERE id=?", ("missing.wav", self.asset["id"]))
        response = self.client.post(f"/api/editor/{self.owned}/extract-audio", json={"asset_id": self.asset["id"]})
        self.assertEqual(response.status_code, 404)

    def test_soundtrack_and_duration_are_checked(self):
        for metadata in ({"has_audio": False, "duration": 1}, {"has_audio": True, "duration": 601}):
            with patch("engine.studio.separation_routes.get_editor_asset", return_value=(self.asset, self.source, metadata)):
                response = self.client.post(f"/api/editor/{self.owned}/extract-audio", json={"asset_id": self.asset["id"]})
            self.assertEqual(response.status_code, 400)
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)

    def test_missing_runtime_is_reported_without_starting_a_job_or_downloading(self):
        with patch.dict(os.environ, {"SHORTFORGE_SEPARATION_PYTHON": str(self.folder / "not-installed"), "SHORTFORGE_SEPARATION_MODEL_DIR": str(self.folder / "no-models")}):
            response = self.client.get("/api/editor-capabilities")
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.json()["separation"]["available"])
            response = self.client.post(f"/api/editor/{self.owned}/separate-audio", json={"asset_id": self.asset["id"]})
        self.assertEqual(response.status_code, 503)
        self.assertIn("setup-separation", response.json()["detail"])
        self.assertFalse((self.folder / "no-models").exists())
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0], 0)

    def test_worker_failure_cleans_partial_outputs(self):
        def failed_worker(source, directory, progress):
            (directory / "vocals.wav").write_bytes(b"partial")
            raise ValueError("Test worker failed")
        with patch("engine.studio.separation_routes.separation_capability", return_value={"available": True}), patch("engine.studio.separation_routes.separate_audio", side_effect=failed_worker):
            response = self.client.post(f"/api/editor/{self.owned}/separate-audio", json={"asset_id": self.asset["id"]})
        job = db.get_job(response.json()["id"])
        self.assertEqual(job["status"], "failed")
        self.assertIn("Test worker failed", job["error"])
        self.assertFalse((self.folder / "editor-audio" / self.owned / job["id"]).exists())
        with db.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM assets").fetchone()[0], 1)

    def test_permission_is_rechecked_before_saving_processed_audio(self):
        real_extract = extract_audio
        def revoke_permission(source, output):
            result = real_extract(source, output)
            with db.connect() as connection:
                connection.execute("UPDATE clips SET license_status='unknown' WHERE id=?", (self.owned,))
            return result
        with patch("engine.studio.separation_routes.extract_audio", side_effect=revoke_permission):
            response = self.client.post(f"/api/editor/{self.owned}/extract-audio", json={"asset_id": self.asset["id"]})
        job = db.get_job(response.json()["id"])
        self.assertEqual(job["status"], "failed")
        self.assertFalse((self.folder / "editor-audio" / self.owned / job["id"]).exists())

    @unittest.skipUnless(os.environ.get("SHORTFORGE_TEST_SEPARATION") == "1", "Real model inference is opt-in; never download in tests")
    def test_actual_cpu_demucs_stems_are_playable_and_reconstruct_source(self):
        self.assertTrue(separation_capability()["available"], "Run scripts/setup-separation.sh explicitly first")
        response = self.client.post(f"/api/editor/{self.owned}/separate-audio", json={"asset_id": self.asset["id"]})
        self.assertEqual(response.status_code, 200, response.text)
        job = db.get_job(response.json()["id"])
        self.assertEqual(job["status"], "completed", job)
        self.assertEqual(job["progress"], 100)
        samples = []
        for kind in ("vocals", "instrumental"):
            asset = job["result"][kind]
            self.assertEqual(asset["kind"], kind)
            self.assertEqual(asset["clip_id"], self.owned)
            self.assertTrue(asset["waveform"])
            with wave.open(str(self.folder / asset["path"])) as audio:
                self.assertEqual((audio.getnchannels(), audio.getframerate()), (2, 44100))
                samples.append(array.array("h", audio.readframes(audio.getnframes())))
        source = extract_audio(self.source, self.folder / "verify.wav")
        with wave.open(str(source)) as audio:
            original = array.array("h", audio.readframes(audio.getnframes()))
        self.assertEqual(len(samples[0]), len(original))
        self.assertEqual(len(samples[1]), len(original))
        self.assertNotEqual(samples[0], samples[1])
        self.assertLessEqual(max(abs(a + b - c) for a, b, c in zip(samples[0], samples[1], original)), 2)


if __name__ == "__main__":
    unittest.main()
