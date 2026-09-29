"""Run optional Chatterbox in a separate offline process.

Reads JSON on stdin. Uses only pre-existing local weights and keeps Chatterbox's
native audio watermark. Saving a voice profile does not train a new model.
"""

import json
from pathlib import Path
import sys


def main():
    payload = json.load(sys.stdin)
    # Some transitive ML libraries try to fetch caches during first use. This
    # isolated worker must use local files only, even if a dependency changes.
    import socket
    def offline_connect(*args, **kwargs):
        raise OSError("ShortForge voice cloning is offline. Install the required model files explicitly first.")
    socket.socket.connect = offline_connect
    socket.socket.connect_ex = offline_connect
    socket.create_connection = offline_connect
    import torch
    torch.set_num_threads(4)
    import soundfile as sf
    model_dir = Path(payload["model_dir"])
    if (model_dir / "t3_nano_v1.safetensors").is_file():
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        model = ChatterboxTurboTTS.from_local(model_dir, device="cpu", nano=True)
    else:
        from chatterbox.tts import ChatterboxTTS
        model = ChatterboxTTS.from_local(model_dir, device="cpu")
    # Short chunks avoid silent truncation by the model's context window.
    chunks = []
    current = []
    for token in payload["text"].split():
        current.append(token)
        if len(current) >= 45 and token.endswith((".", "!", "?", ",")) or len(current) >= 65:
            chunks.append(" ".join(current))
            current = []
    if current:
        chunks.append(" ".join(current))
    import numpy as np
    audio = []
    for chunk in chunks:
        wav = model.generate(chunk, audio_prompt_path=payload["reference"])
        audio.append(wav.squeeze().detach().cpu().numpy())
        audio.append(np.zeros(int(model.sr * 0.15), dtype=np.float32))
    sf.write(payload["output"], np.concatenate(audio), model.sr)


if __name__ == "__main__":
    main()
