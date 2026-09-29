import { useEffect, useRef, useState } from "react";

/** Draw the actual generated recording, using the browser's local audio decoder. */
export function AudioPreview({ src }: { src: string }) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Reading the waveform…");
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let context: AudioContext | undefined;
    setPeaks([]);
    setProgress(0);
    setMessage("Reading the waveform…");
    const decode = async () => {
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok) throw new Error("Audio unavailable");
        context = new AudioContext();
        const decoded = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        if (controller.signal.aborted) return;
        const samples = decoded.getChannelData(0);
        const size = Math.max(1, Math.floor(samples.length / 80));
        const values = Array.from({ length: 80 }, (_, i) => {
          let total = 0;
          for (
            let j = i * size;
            j < Math.min((i + 1) * size, samples.length);
            j += 8
          )
            total += Math.abs(samples[j]);
          return total / (size / 8);
        });
        const maximum = Math.max(...values, 0.001);
        setPeaks(values.map((v) => Math.max(0.04, v / maximum)));
      } catch {
        if (!controller.signal.aborted)
          setMessage(
            "Waveform unavailable. You can still play the audio below.",
          );
      } finally {
        await context?.close();
      }
    };
    void decode();
    return () => controller.abort();
  }, [src]);
  return (
    <div className="recording-preview">
      {peaks.length > 0 ? (
        <svg
          viewBox="0 0 400 64"
          role="img"
          aria-label="Waveform of your generated voiceover"
          style={{ width: "100%", height: 64, marginTop: 16 }}
        >
          {peaks.map((height, index) => (
            <rect
              key={index}
              x={index * 5}
              y={32 - height * 29}
              width="3"
              height={height * 58}
              rx="1.5"
              fill={
                index / peaks.length < progress
                  ? "var(--accent)"
                  : "var(--muted)"
              }
              opacity={index / peaks.length < progress ? 1 : 0.5}
            />
          ))}
        </svg>
      ) : (
        <p className="help-text">{message}</p>
      )}
      <audio
        ref={audio}
        controls
        src={src}
        onTimeUpdate={(e) =>
          setProgress(
            e.currentTarget.duration
              ? e.currentTarget.currentTime / e.currentTarget.duration
              : 0,
          )
        }
      />
    </div>
  );
}
