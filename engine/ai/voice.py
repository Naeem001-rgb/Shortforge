"""Real TTS providers, with availability checks before any work is queued."""

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from threading import Lock
from urllib import error, request

from engine.studio.media import audio_duration, approximate_words, ffmpeg_binary

LOCAL_VOICE_LOCK = Lock()


def installed(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ModuleNotFoundError, ValueError):
        return False


def clone_readiness(settings: dict) -> tuple[bool, str]:
    model_dir = Path(settings.get("clone_model_path") or "__not_configured__").expanduser()
    common = ["ve.safetensors", "tokenizer.json"]
    nano = (model_dir / "t3_nano_v1.safetensors").is_file()
    required = common + (["t3_nano_v1.safetensors", "s3gen_meanflow.safetensors", "tokenizer_config.json"] if nano else ["t3_cfg.safetensors", "s3gen.safetensors"])
    if not all((model_dir / item).is_file() for item in required):
        return False, "Reference saved. Set the local Chatterbox model folder in Settings to enable generation; no model is downloaded automatically."
    if not installed("chatterbox"):
        return False, "Reference saved. Install the optional Chatterbox environment first (Python 3.11 recommended). Model files are already present."
    return True, "Local Chatterbox reference voice is ready. CPU generation can be slow. MIT model; use your own or an authorized voice."


def provider_list(settings: dict) -> list[dict]:
    model = Path(settings.get("piper_model") or "__not_configured__").expanduser()
    piper = bool((shutil.which("piper") or installed("piper")) and model.is_file() and Path(str(model) + ".json").is_file())
    clone_available, clone_note = clone_readiness(settings)
    return [
        {"id": "piper", "name": "Piper · local & free", "available": piper, "note": "CPU voice. Install Piper and select a local .onnx model plus its .onnx.json file. Check that voice's MODEL_CARD for commercial rights; licenses vary."},
        {"id": "edge", "name": "Edge · optional online", "available": installed("edge_tts"), "note": "Unofficial online service; may stop working. Its library license does not grant commercial rights to Microsoft's voices. Check service terms before monetized use."},
        {"id": "elevenlabs", "name": "ElevenLabs · your key", "available": bool(settings.get("elevenlabs_api_key")), "note": "Optional paid service. ElevenLabs' free plan does not include commercial use. Requests use your account credits."},
        {"id": "clone", "name": "Your voice · local Chatterbox", "available": clone_available, "note": clone_note},
    ]


def builtin_voices(settings: dict) -> list[dict]:
    available = {p["id"]: p["available"] for p in provider_list(settings)}
    rows = [
        ("piper-local", "My local Piper voice", "piper", "Model language", "Uses the voice model selected in Settings."),
        ("en-US-AriaNeural", "Aria", "edge", "English (US)", "Clear conversational voice. Online, unofficial service."),
        ("en-US-GuyNeural", "Guy", "edge", "English (US)", "Warm narration voice. Online, unofficial service."),
        ("en-GB-SoniaNeural", "Sonia", "edge", "English (UK)", "British narration. Online, unofficial service."),
        ("ur-PK-UzmaNeural", "Uzma", "edge", "Urdu (Pakistan)", "Urdu narration. Online, unofficial service."),
        ("ur-PK-AsadNeural", "Asad", "edge", "Urdu (Pakistan)", "Urdu narration. Online, unofficial service."),
        ("JBFqnCBsd6RMkjVDRZzb", "George", "elevenlabs", "Multilingual", "Uses your ElevenLabs account credits. Commercial use needs a paid plan."),
    ]
    return [{"id": id, "name": name, "provider": provider, "language": language, "description": description, "available": available[provider], "cloned": False} for id, name, provider, language, description in rows]


def synthesize(text: str, provider: str, voice_id: str, speed: float, pitch: float, output: Path, settings: dict, reference: Path | None = None) -> Path:
    if pitch and provider != "edge":
        raise ValueError("Pitch control is available for Edge voices. Keep pitch at 0 for this provider.")
    if provider == "piper":
        model = str(Path(settings["piper_model"]).expanduser().resolve())
        command = [shutil.which("piper")] if shutil.which("piper") else [sys.executable, "-m", "piper"]
        command += ["--model", model, "--output_file", str(output), "--length_scale", str(1 / speed)]
        with LOCAL_VOICE_LOCK:
            process = subprocess.run(command, input=text, text=True, capture_output=True, timeout=600)
        if process.returncode:
            raise ValueError("Piper could not generate speech. Check that the .onnx and .onnx.json files match, and that Piper is installed.")
    elif provider == "edge":
        import edge_tts
        mp3 = output.with_suffix(".mp3")
        rate = f"{round((speed - 1) * 100):+d}%"
        asyncio.run(edge_tts.Communicate(text, voice_id, rate=rate, pitch=f"{round(pitch):+d}Hz").save(str(mp3)))
        return mp3
    elif provider == "elevenlabs":
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", voice_id):
            raise ValueError("Choose a valid ElevenLabs voice ID.")
        req = request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}", data=json.dumps({"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": speed}}).encode(), headers={"xi-api-key": settings["elevenlabs_api_key"], "Content-Type": "application/json", "Accept": "audio/mpeg"}, method="POST")
        mp3 = output.with_suffix(".mp3")
        try:
            with request.urlopen(req, timeout=120) as response:
                mp3.write_bytes(response.read())
        except error.HTTPError as exc:
            raise ValueError(f"ElevenLabs returned HTTP {exc.code}. Check your key, voice access and account credits.") from None
        return mp3
    elif provider == "clone":
        if reference is None:
            raise ValueError("Choose a saved voice reference first.")
        environment = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}
        payload = {"model_dir": str(Path(settings["clone_model_path"]).expanduser().resolve()), "reference": str(reference), "text": text, "output": str(output)}
        with LOCAL_VOICE_LOCK:
            process = subprocess.run([sys.executable, "-m", "engine.ai.clone_worker"], input=json.dumps(payload), text=True, capture_output=True, timeout=1800, env=environment, cwd=Path(__file__).resolve().parents[2])
        if process.returncode:
            raise ValueError("Local cloning failed. Use a complete compatible Chatterbox or Nano model folder, its optional Python dependencies, and a clean 6–30 second voice sample. No model was downloaded.")
        if speed != 1:
            adjusted = output.with_name(output.stem + "-paced.wav")
            process = subprocess.run([ffmpeg_binary(), "-y", "-i", str(output), "-af", f"atempo={speed}", str(adjusted)], capture_output=True, timeout=120)
            if process.returncode:
                raise ValueError("Voice was generated but pacing could not be adjusted. Try speed 1.0.")
            return adjusted
    else:
        raise ValueError("Choose a supported voice provider.")
    if not output.is_file() or output.stat().st_size < 44:
        raise ValueError("The voice provider did not produce an audio file.")
    return output


def align_voice(path: Path, text: str) -> dict:
    duration = audio_duration(path)
    try:
        from engine.core.media import transcribe_file
        result = transcribe_file(path)
        if result.get("words"):
            return {**result, "timing_method": "whisper", "timing_note": "Word timestamps come from the newly generated audio. Review for recognition errors.", "duration": duration}
    except Exception:
        pass
    return {"text": text, "words": approximate_words(text, duration), "duration": duration, "timing_method": "approximate", "timing_note": "Approximate timing: a local Whisper model is unavailable. Words are distributed across this new audio; review timing before export."}
