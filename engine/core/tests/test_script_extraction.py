"""Extraction, caption fidelity, and script persistence without external calls."""

import io
import json
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient
import httpx
import pytest

from engine.core import db, media, script_extraction as extraction
from engine.core.app import app


VIDEO_ID = "tleaVXWF3YI"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    for key in db.SECRET_SETTINGS:
        monkeypatch.delenv(key.upper(), raising=False)
    with TestClient(app, base_url="http://localhost") as session:
        yield session


def import_clip(client):
    return client.post("/api/clips", json={"clips": [{"video_id": VIDEO_ID, "title": "Do not invent speech from this title", "description": "Not the narration"}]}).json()["clips"][0]


def run_job(client, clip_id, body=None):
    response = client.post(f"/api/clips/{clip_id}/extract-script", json=body) if body is not None else client.post(f"/api/clips/{clip_id}/extract-script")
    assert response.status_code == 200, response.text
    assert response.json()["type"] == "extract-script"
    return client.get(f"/api/jobs/{response.json()['id']}").json()


def caption_result(text="This is the exact original narration."):
    return {"text": text, "words": [], "source": "youtube-captions", "language": "en", "caption_kind": "automatic"}


def test_extraction_populates_original_without_granting_footage_permission(client, monkeypatch):
    clip = import_clip(client)
    monkeypatch.setattr(extraction, "youtube_captions", lambda _: caption_result())
    job = run_job(client, clip["id"])
    assert job["status"] == "completed", job
    assert job["result"]["word_count"] == 6
    assert job["result"]["original_updated"] is True
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["script"]["original_text"] == caption_result()["text"]
    assert detail["script"]["rewritten_text"] == ""
    assert detail["transcript"]["text"] == caption_result()["text"]
    assert detail["license_status"] == "unknown"
    assert detail["assets"] == []
    assert detail["workflow_status"] == "transcribed"
    for action in ("download", "transcribe"):
        assert client.post(f"/api/clips/{clip['id']}/{action}").status_code == 403
    assert client.post("/api/export", json={"clip_id": clip["id"]}).status_code == 403


def test_reuses_original_and_saved_transcript_without_network(client, monkeypatch):
    clip = import_clip(client)
    monkeypatch.setattr(extraction, "youtube_captions", lambda _: pytest.fail("Should reuse saved text"))
    with db.connect() as conn:
        conn.execute("INSERT INTO transcripts(clip_id,text,words) VALUES(?,?,?)", (clip["id"], "Actual words", "[]"))
    assert run_job(client, clip["id"])["result"]["source"] == "saved-transcript"
    db.save_script(clip["id"], "Edited original words", "Keep this rewrite")
    assert run_job(client, clip["id"])["result"]["source"] == "saved-script"
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["script"]["rewritten_text"] == "Keep this rewrite"
    assert detail["transcript"]["text"] == "Actual words"


def test_extraction_keeps_concurrent_original_and_rewrite_edits(client, monkeypatch):
    clip = import_clip(client)

    def captions(_):
        db.save_script(clip["id"], "User typed this while waiting", "User wrote this too")
        return caption_result()

    monkeypatch.setattr(extraction, "youtube_captions", captions)
    job = run_job(client, clip["id"])
    assert job["status"] == "completed"
    assert job["result"]["original_updated"] is False
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["script"]["original_text"] == "User typed this while waiting"
    assert detail["script"]["rewritten_text"] == "User wrote this too"
    assert detail["transcript"]["text"] == caption_result()["text"]


def test_gemini_also_preserves_existing_original_unless_replacement_is_requested(client, monkeypatch):
    clip = import_clip(client)
    db.save_script(clip["id"], "Saved original narration", "My draft")
    monkeypatch.setattr(extraction, "gemini_transcript", lambda *_: pytest.fail("Existing original must not spend quota or be replaced"))
    job = run_job(client, clip["id"], {"provider": "gemini"})
    assert job["status"] == "completed"
    assert job["result"]["source"] == "saved-script"
    assert job["result"]["original_updated"] is False
    assert client.get(f"/api/clips/{clip['id']}").json()["script"]["rewritten_text"] == "My draft"


def test_explicit_extraction_replaces_old_topic_but_preserves_rewrite(client, monkeypatch):
    clip = import_clip(client)
    db.save_script(clip["id"], "Old topic inferred from a title", "My rewrite")
    with db.connect() as conn:
        conn.execute("INSERT INTO transcripts(clip_id,text,words) VALUES(?,?,?)", (clip["id"], "Old transcript", "[]"))
    monkeypatch.setattr(extraction, "youtube_captions", lambda _: caption_result())
    assert run_job(client, clip["id"])["result"]["source"] == "saved-script"
    job = run_job(client, clip["id"], {"replace_existing": True})
    assert job["status"] == "completed"
    assert job["result"]["source"] == "youtube-captions"
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["script"]["original_text"] == caption_result()["text"]
    assert detail["script"]["rewritten_text"] == "My rewrite"


def test_explicit_reextract_also_preserves_edits_made_while_waiting(client, monkeypatch):
    clip = import_clip(client)
    db.save_script(clip["id"], "Old topic", "Existing rewrite")

    def captions(_):
        db.save_script(clip["id"], "User corrected original while waiting", "Updated rewrite")
        return caption_result()

    monkeypatch.setattr(extraction, "youtube_captions", captions)
    job = run_job(client, clip["id"], {"replace_existing": True})
    assert job["result"]["original_updated"] is False
    assert client.get(f"/api/clips/{clip['id']}").json()["script"]["original_text"] == "User corrected original while waiting"


def test_transcription_helper_preserves_rewrite_and_advanced_workflow(client):
    clip = import_clip(client)
    db.save_script(clip["id"], "", "Already rewritten")
    client.patch(f"/api/clips/{clip['id']}", json={"workflow_status": "exported"})
    assert extraction.persist_original_transcript(clip["id"], caption_result()) is True
    assert extraction.persist_original_transcript(clip["id"], caption_result("Different source")) is False
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["script"]["original_text"] == caption_result()["text"]
    assert detail["script"]["rewritten_text"] == "Already rewritten"
    assert detail["workflow_status"] == "exported"


def test_absent_captions_fail_actionably_without_inventing_or_spending(client, monkeypatch):
    clip = import_clip(client)
    client.put("/api/settings", json={"gemini_api_key": "unused-secret"})
    monkeypatch.setattr(extraction, "youtube_captions", lambda _: (_ for _ in ()).throw(ValueError(extraction.NO_CAPTIONS)))
    monkeypatch.setattr(extraction, "gemini_transcript", lambda *_: pytest.fail("Auto must never spend Gemini quota"))
    monkeypatch.setattr(media, "get_source", lambda _: pytest.fail("Unknown footage must not be opened"))
    job = run_job(client, clip["id"])
    assert job["status"] == "failed"
    assert "Transcribe with Gemini" in job["error"]
    assert "paste" in job["error"]
    detail = client.get(f"/api/clips/{clip['id']}").json()
    assert detail["script"] is None
    assert detail["transcript"] is None


def test_missing_key_and_invalid_provider_fail_without_network(client, monkeypatch):
    clip = import_clip(client)
    monkeypatch.setattr(extraction.httpx, "post", lambda *_args, **_kwargs: pytest.fail("No key, no call"))
    job = run_job(client, clip["id"], {"provider": "gemini"})
    assert job["status"] == "failed"
    assert "Settings" in job["error"]
    assert client.post(f"/api/clips/{clip['id']}/extract-script", json={"provider": "paid"}).status_code == 422
    assert client.post("/api/clips/missing/extract-script").status_code == 404


def test_duplicate_extraction_is_rejected(client):
    clip = import_clip(client)
    db.new_job("extract-script", clip["id"])
    assert client.post(f"/api/clips/{clip['id']}/extract-script").status_code == 409


def test_authorized_existing_file_falls_back_to_local_whisper(client, monkeypatch):
    clip = import_clip(client)
    client.patch(f"/api/clips/{clip['id']}", json={"license_status": "permission", "permission_note": "Creator authorized use"})
    source = db.DATA_DIR / "existing.mp4"
    source.write_bytes(b"already present")
    db.add_asset(clip["id"], "source", source)
    monkeypatch.setattr(extraction, "youtube_captions", lambda _: (_ for _ in ()).throw(ValueError(extraction.NO_CAPTIONS)))
    monkeypatch.setattr(media, "transcribe_file", lambda path: {"text": "Actual local words", "words": [{"word": "Actual", "start": 0, "end": 1}]})
    job = run_job(client, clip["id"])
    assert job["status"] == "completed"
    assert job["result"]["source"] == "local-whisper"
    assert job["result"]["words"][0]["word"] == "Actual"


def test_json3_keeps_real_offsets_and_append_repetition():
    data = {"events": [
        {"tStartMs": 1000, "dDurationMs": 1500, "segs": [{"utf8": "Hello", "tOffsetMs": 0}, {"utf8": " world", "tOffsetMs": 700}]},
        {"tStartMs": 2000, "dDurationMs": 1000, "aAppend": 1, "segs": [{"utf8": " world", "tOffsetMs": 0}]},
    ]}
    result = extraction.parse_json3(json.dumps(data))
    assert result["text"] == "Hello world world"
    assert result["words"] == [{"word": "Hello", "start": 1, "end": 1.7}, {"word": "world", "start": 1.7, "end": 2.5}, {"word": "world", "start": 2, "end": 3}]


def test_sound_labels_are_not_counted_as_narration():
    result = extraction.parse_json3(json.dumps({"events": [{"tStartMs": 0, "dDurationMs": 1000, "segs": [{"utf8": "Hello [music] world. [Applause]"}]}]}))
    assert result["text"] == "Hello world."


def test_vtt_deduplicates_rolling_captions_but_not_later_repeated_speech():
    result = extraction.parse_vtt("""WEBVTT
Kind: captions

00:00:00.000 --> 00:00:03.000
<c>Hello &amp; welcome</c>

00:00:01.000 --> 00:00:04.000
Hello &amp; welcome
to this story

00:00:02.000 --> 00:00:05.000
to this story
today.

00:00:05.000 --> 00:00:06.000
today.
""")
    assert result["text"] == "Hello & welcome to this story today. today."
    assert result["words"] == []  # Caption-cue times are not word alignment.
    assert result["segments"][2]["start"] == 2


def track(language, ext="json3", translated=False):
    return {"ext": ext, "url": f"https://www.youtube.com/api/timedtext?lang={language}" + ("&tlang=en" if translated else "")}


def test_prefers_original_language_manual_over_asr_and_never_translates():
    info = {"language": "en-US", "subtitles": {"ur": [track("ur", "vtt")]},
            "automatic_captions": {"en": [track("ur", translated=True)], "ur-orig": [track("ur")]}}
    selected = extraction._original_tracks(info)
    assert [entry[:2] for entry in selected] == [("manual", "ur"), ("automatic", "ur")]
    assert extraction._original_tracks({"subtitles": {"en": [track("en")], "fr": [track("fr")]}}) == []
    assert extraction._original_tracks({"language": "en-US", "subtitles": {"en": [track("en")]}})[0][1] == "en"


def test_public_caption_fetch_is_text_only_and_tries_second_format(monkeypatch):
    calls = []

    class Downloader:
        def __init__(self, options):
            assert options["skip_download"] is True
            assert options["extractor_args"]["youtube"]["skip"] == ["translated_subs"]
        def __enter__(self): return self
        def __exit__(self, *_args): pass
        def extract_info(self, url, download):
            assert download is False
            assert url == f"https://www.youtube.com/watch?v={VIDEO_ID}"
            return {"automatic_captions": {"en-orig": [track("en"), track("en", "vtt")]}}
        def urlopen(self, url):
            calls.append(url)
            return io.BytesIO(b"" if len(calls) == 1 else b"WEBVTT\n\n00:00.000 --> 00:01.000\nActual narration\n")

    monkeypatch.setattr(media, "tool_available", lambda _: True)
    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=Downloader))
    result = extraction.youtube_captions(VIDEO_ID)
    assert result["text"] == "Actual narration"
    assert result["language"] == "en"
    assert len(calls) == 2


@pytest.mark.parametrize("url", ["http://www.youtube.com/api/timedtext", "https://evil.example/api/timedtext", "https://www.youtube.com:8000/api/timedtext", "https://www.youtube.com@127.0.0.1/api/timedtext", "https://www.youtube.com/other"])
def test_caption_track_urls_are_restricted(url):
    assert not extraction._caption_url(url)


def test_explicit_gemini_uses_video_not_metadata_and_preserves_original_language(client, monkeypatch):
    clip = import_clip(client)
    client.put("/api/settings", json={"gemini_api_key": "key-test", "gemini_model": "gemini-3.8-flash"})

    def post(url, **kwargs):
        assert kwargs["headers"]["x-goog-api-key"] == "key-test"
        assert "key-test" not in url
        parts = kwargs["json"]["contents"][0]["parts"]
        assert parts[0]["fileData"]["fileUri"] == f"https://www.youtube.com/watch?v={VIDEO_ID}"
        assert "verbatim" in parts[1]["text"]
        assert "Do not translate" in parts[1]["text"]
        assert clip["title"] not in json.dumps(kwargs["json"])
        return httpx.Response(200, request=httpx.Request("POST", url), json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": json.dumps({"text": "یہ اصل کہانی ہے", "language": "ur"})}]}}]})

    monkeypatch.setattr(extraction.httpx, "post", post)
    job = run_job(client, clip["id"], {"provider": "gemini"})
    assert job["status"] == "completed", job
    assert job["result"]["text"] == "یہ اصل کہانی ہے"
    assert job["result"]["language"] == "ur"
    assert job["result"]["words"] == []
    assert job["result"]["source"] == "gemini"


@pytest.mark.parametrize("content,reason", [("", "STOP"), ("Some speech", "MAX_TOKENS")])
def test_gemini_rejects_empty_or_truncated_transcript(monkeypatch, content, reason):
    response = httpx.Response(200, request=httpx.Request("POST", "https://example.test"), json={"candidates": [{"finishReason": reason, "content": {"parts": [{"text": json.dumps({"text": content, "language": "en"})}]}}]})
    monkeypatch.setattr(extraction.httpx, "post", lambda *_args, **_kwargs: response)
    with pytest.raises(ValueError):
        extraction.gemini_transcript(VIDEO_ID, {"gemini_api_key": "test"})
