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


class ElevenLabsContractTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.data_patch = patch.object(db, "DATA_DIR", Path(self.temporary.name))
        self.data_patch.start()
        self.identity = str(uuid4())
        with db.connect() as connection:
            connection.execute("INSERT INTO clips (id,title,created_at) VALUES (?,?,?)", (self.identity, "Unknown source", db.now()))
            connection.execute("INSERT INTO settings VALUES (?,?)", ("elevenlabs_api_key", json.dumps("test-key-never-echo")))
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        from engine.ai.voice import VOICE_CACHE
        VOICE_CACHE.clear()

    def tearDown(self):
        self.client.close()
        self.data_patch.stop()
        self.temporary.cleanup()

    def test_account_voices_are_fetched_and_cached_without_exposing_key(self):
        import io
        payload = {"voices": [{"voice_id": "voice123456", "name": "My account voice", "labels": {"language": "Urdu"}, "category": "cloned"}]}
        with patch("engine.ai.voice.request.urlopen", return_value=io.BytesIO(json.dumps(payload).encode())) as request:
            first = self.client.get("/api/voices")
            second = self.client.get("/api/voices")
        self.assertEqual(request.call_count, 1)
        remote = next(voice for voice in first.json()["voices"] if voice["provider"] == "elevenlabs")
        self.assertEqual(remote["id"], "voice123456")
        self.assertEqual(remote["language"], "Urdu")
        self.assertTrue(remote["cloned"])
        self.assertNotIn("test-key-never-echo", first.text + second.text)

    def test_timestamp_generation_keeps_real_word_intervals_speed_and_stability(self):
        import base64
        import io
        audio_bytes = io.BytesIO()
        with wave.open(audio_bytes, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b"\x01\x00" * 32000)
        payload = {"audio_base64": base64.b64encode(audio_bytes.getvalue()).decode(), "alignment": {
            "characters": list("Hi all!"),
            "character_start_times_seconds": [0.1, 0.2, 0.3, 0.8, 0.9, 1, 1.1],
            "character_end_times_seconds": [0.2, 0.3, 0.4, 0.9, 1, 1.1, 1.2],
        }}
        with patch("engine.ai.voice.request.urlopen", return_value=io.BytesIO(json.dumps(payload).encode())) as request, patch("engine.core.media.transcribe_file") as transcribe:
            response = self.client.post("/api/tts", json={"clip_id": self.identity, "text": "Hi all!", "provider": "elevenlabs", "voice_id": "voice123456", "speed": 0.75, "stability": 0.2})
        self.assertEqual(response.status_code, 200, response.text)
        submitted = request.call_args.args[0]
        self.assertTrue(submitted.full_url.endswith("/voice123456/with-timestamps"))
        settings = json.loads(submitted.data)["voice_settings"]
        self.assertEqual(settings["speed"], 0.75)
        self.assertEqual(settings["stability"], 0.2)
        transcribe.assert_not_called()
        job = db.get_job(response.json()["id"])
        self.assertEqual(job["status"], "completed", job)
        result = job["result"]
        self.assertEqual(result["timing_method"], "elevenlabs")
        self.assertEqual(result["words"], [{"word": "Hi", "start": 0.1, "end": 0.3}, {"word": "all!", "start": 0.8, "end": 1.2}])
        self.assertAlmostEqual(result["duration"], 2, places=2)
        self.assertEqual(db.get_clip(self.identity)["license_status"], "unknown")
        self.assertNotIn("test-key-never-echo", json.dumps(job))
        sidecar = db.DATA_DIR / result["asset"]["path"]
        self.assertNotIn("test-key-never-echo", sidecar.with_suffix(".timing.json").read_text())

    def test_provider_errors_are_retryable_and_do_not_expose_keys(self):
        from urllib.error import HTTPError
        with patch("engine.ai.voice.request.urlopen", side_effect=HTTPError("provider", 401, "test-key-never-echo", {}, None)):
            listing = self.client.get("/api/voices")
            response = self.client.post("/api/tts", json={"clip_id": self.identity, "text": "Hi", "provider": "elevenlabs", "voice_id": "voice123456"})
        provider = next(item for item in listing.json()["providers"] if item["id"] == "elevenlabs")
        self.assertFalse(provider["available"])
        self.assertIn("refresh", provider["note"])
        job = db.get_job(response.json()["id"])
        self.assertEqual(job["status"], "failed")
        self.assertIn("401", job["error"])
        self.assertNotIn("test-key-never-echo", listing.text + json.dumps(job))

    def test_invalid_alignment_and_provider_parameters_are_rejected(self):
        from engine.ai.voice import alignment_words
        with self.assertRaises(ValueError):
            alignment_words({"characters": ["A"], "character_start_times_seconds": [1], "character_end_times_seconds": [0]})
        for change in ({"stability": 2}, {"speed": 4}):
            response = self.client.post("/api/tts", json={"clip_id": self.identity, "text": "Hi", "provider": "elevenlabs", "voice_id": "voice123456", **change})
            self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
