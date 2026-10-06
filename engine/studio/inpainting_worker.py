"""Bounded-memory, offline MI-GAN frame inpainting. Invoked in a disposable process."""
import json
from pathlib import Path
import subprocess
import sys
import time

import cv2
import numpy as np

from .media import ffmpeg_binary


class Cancelled(Exception):
    pass


def region_pixels(region, width, height):
    x = max(0, min(width - 1, round(region["x"] * width)))
    y = max(0, min(height - 1, round(region["y"] * height)))
    right = max(x + 1, min(width, round((region["x"] + region["width"]) * width)))
    bottom = max(y + 1, min(height, round((region["y"] + region["height"]) * height)))
    return x, y, right, bottom


def caption_mask(frame, region, detector=None):
    """Only erase OCR boxes inside the user-selected area, including text outlines."""
    height, width = frame.shape[:2]
    x, y, right, bottom = region_pixels(region, width, height)
    mask = np.zeros((height, width), dtype=np.uint8)
    if detector is None:
        mask[y:bottom, x:right] = 255
        return mask
    crop = frame[y:bottom, x:right]
    # RapidOCR accepts BGR arrays, whereas the video pipe and MI-GAN use RGB.
    result = detector(cv2.cvtColor(crop, cv2.COLOR_RGB2BGR), use_cls=False, use_rec=False)
    boxes = getattr(result, "boxes", None)
    if boxes is not None:
        for box in boxes:
            polygon = np.round(np.asarray(box) + [x, y]).astype(np.int32)
            cv2.fillPoly(mask, [polygon], 255)
        padding = max(3, round(min(width, height) * .009))
        mask = cv2.dilate(mask, np.ones((padding * 2 + 1,) * 2, np.uint8))
        # Never let automatic removal escape the selected region.
        mask[:y] = 0
        mask[bottom:] = 0
        mask[:, :x] = 0
        mask[:, right:] = 0
    return mask


class Inpainter:
    def __init__(self, path):
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
        options.log_severity_level = 3
        self.session = ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])

    def __call__(self, frame, mask):
        """MI-GAN's pinned pipeline crops context and restores the original dimensions."""
        if not mask.any():
            return frame
        prediction = self.session.run(None, {
            "image": frame.transpose(2, 0, 1)[None],
            # MI-GAN uses black for erased pixels and white for retained pixels.
            "mask": (255 - mask)[None, None],
        })[0][0].transpose(1, 2, 0)
        output = frame.copy()
        output[mask > 0] = prediction[mask > 0]
        return output


def process_video(config, progress=lambda value: None, painter=None, detector=None):
    source, output = Path(config["source"]), Path(config["output"])
    cancel_path = Path(config["cancel"])
    def check_cancel():
        if cancel_path.exists():
            raise Cancelled("Caption removal cancelled. Your original is unchanged.")
    check_cancel()
    cv2.setNumThreads(1)
    if config["mask_mode"] == "text" and detector is None:
        from rapidocr import RapidOCR
        detector = RapidOCR(params={
            "Global.use_cls": False, "Global.use_rec": False,
            # A narrow caption band must not be enlarged until its short side
            # reaches 736px: that turns a small crop into a huge OCR image.
            "Det.limit_type": "max",
            "EngineConfig.onnxruntime.intra_op_num_threads": 2,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "Global.log_level": "error",
        })
    check_cancel()
    painter = painter or Inpainter(config["model"])
    width, height = config["width"], config["height"]
    fps = config["fps"]
    expected = max(1, round(config["duration"] * fps))
    silent = output.with_name("silent.mp4")
    ffmpeg = ffmpeg_binary()
    decoder = encoder = None
    count = changed = 0
    begun = time.monotonic()
    try:
        decoder = subprocess.Popen([
            ffmpeg, "-v", "error", "-nostdin", "-threads", "2", "-ss", str(config["start"]),
            "-i", str(source), "-t", str(config["duration"]), "-an", "-sn", "-dn",
            "-vf", f"fps={fps},scale={width}:{height}", "-pix_fmt", "rgb24",
            "-threads", "2", "-f", "rawvideo", "-",
        ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        encoder = subprocess.Popen([
            ffmpeg, "-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{width}x{height}", "-r", str(fps), "-i", "-", "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-threads", "2", "-movflags", "+faststart", str(silent),
        ], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        frame_bytes = width * height * 3
        while True:
            check_cancel()
            raw = decoder.stdout.read(frame_bytes)
            if not raw:
                break
            if len(raw) != frame_bytes:
                raise RuntimeError("The video stopped decoding. Try importing it again.")
            frame = np.frombuffer(raw, np.uint8).reshape(height, width, 3)
            mask = caption_mask(frame, config["region"], detector if config["mask_mode"] == "text" else None)
            if mask.any():
                frame = painter(frame, mask)
                changed += 1
            check_cancel()
            encoder.stdin.write(frame.tobytes())
            count += 1
            progress({"progress": min(94, 5 + 89 * count / expected), "frames": count,
                      "total_frames": expected,
                      "seconds_remaining": round((time.monotonic() - begun) / count * max(0, expected - count))})
        encoder.stdin.close()
        if decoder.wait(timeout=30) or encoder.wait(timeout=60):
            raise RuntimeError("The cleaned video could not be encoded. Try a shorter selection.")
        if count < max(1, expected - 2):
            raise RuntimeError("The video ended before the selected range. Reimport the source and try again.")
        if not changed:
            raise ValueError("No text was found in this area. Adjust the box or choose ‘Erase the whole area’, then preview again.")
        check_cancel()
        progress({"progress": 96, "frames": count, "total_frames": expected, "seconds_remaining": 0})
        result = subprocess.run([
            ffmpeg, "-v", "error", "-nostdin", "-y", "-ss", str(config["start"]), "-i", str(source),
            "-i", str(silent), "-map", "1:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac",
            "-b:a", "192k", "-threads", "2", "-t", str(count / fps), "-movflags", "+faststart", str(output),
        ], capture_output=True, timeout=180)
        if result.returncode:
            raise RuntimeError("The soundtrack could not be kept with the cleaned video. Try importing the source again.")
        check_cancel()
        return {"frames": count, "frames_changed": changed, "seconds": round(time.monotonic() - begun, 1)}
    finally:
        for process in (decoder, encoder):
            if process is not None:
                if process.poll() is None:
                    process.kill()
                process.wait()
                for stream in (process.stdin, process.stdout):
                    if stream and not stream.closed:
                        stream.close()
        silent.unlink(missing_ok=True)


def main():
    config = json.loads(Path(sys.argv[1]).read_text())
    try:
        stats = process_video(config, lambda data: print(json.dumps(data), flush=True))
        print(json.dumps({"done": stats}), flush=True)
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, (ValueError, RuntimeError, Cancelled))
                          else "AI removal stopped. Close memory-heavy apps and try a one-second preview."}), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
