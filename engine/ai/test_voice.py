"""Exercise the installed small CPU synthesizer without downloading a model."""

import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
import wave

from fastapi import FastAPI
from fastapi.testclient import TestClient

from engine.core import db
from engine.ai.routes import router


class ESpeakIntegrationTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("espeak-ng") or shutil.which("espeak"), "eSpeak is not installed")
    def test_actual_local_voice_job_produces_audible_wav_and_fresh_approximate_timing(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(db, "DATA_DIR", Path(temporary)):
            identity = str(uuid4())
            with db.connect() as connection:
                connection.execute("INSERT INTO clips (id,title,license_status,created_at) VALUES (?,?,?,?)", (identity, "My original narration", "owned", db.now()))
            app = FastAPI()
            app.include_router(router)
            with TestClient(app, base_url="http://localhost") as client:
                listing = client.get("/api/voices").json()
                voice = next(item for item in listing["voices"] if item["id"] == "espeak-en")
                self.assertTrue(voice["available"])
                self.assertFalse(voice["cloned"])
                self.assertIn("synthetic", voice["description"])
                # Speech really runs; only optional Whisper is disabled so this
                # test also checks the explicit proportional-timing fallback.
                with patch("engine.core.media.transcribe_file", side_effect=RuntimeError("No local Whisper model")):
                    response = client.post("/api/tts", json={"clip_id": identity, "text": "This is a free local voice from Short Forge.", "provider": "espeak", "voice_id": "espeak-en", "speed": 1.1, "pitch": 0})
                self.assertEqual(response.status_code, 200, response.text)
                job = db.get_job(response.json()["id"])
                self.assertEqual(job["status"], "completed", job)
                result = job["result"]
                self.assertEqual(result["timing_method"], "approximate")
                self.assertGreater(result["duration"], 1)
                self.assertIn("Approximate", result["timing_note"])
                output = db.DATA_DIR / result["asset"]["path"]
                with wave.open(str(output)) as audio:
                    frames = audio.readframes(audio.getnframes())
                    self.assertTrue(any(frames), "Synthesized speech should contain non-silent PCM samples")
                sidecar = json.loads(output.with_suffix(".timing.json").read_text())
                self.assertEqual(sidecar["words"][0]["start"], 0)
                self.assertAlmostEqual(sidecar["words"][-1]["end"], result["duration"], places=2)
                rejected = client.post("/api/tts", json={"clip_id": identity, "text": "Test", "provider": "espeak", "voice_id": "../../arbitrary", "speed": 1})
                self.assertEqual(rejected.status_code, 400)


if __name__ == "__main__":
    unittest.main()
