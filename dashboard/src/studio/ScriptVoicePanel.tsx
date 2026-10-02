import {
  AudioLines,
  LoaderCircle,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Square,
  Flag,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, useJob } from "../api";
import type { Asset, Voice } from "../api";
import { clamp, formatTime, newItem, uid } from "./editorModel";
import type { EditorMedia, EditorProject } from "./editorModel";
import { tracksOf } from "./timelineOps";
import "./audio-captions.css";

export type ScriptVoicePanelProps = {
  clipId: string;
  project: EditorProject;
  media: EditorMedia[];
  playhead: number;
  playing: boolean;
  onChange: (next: EditorProject) => void;
  onMedia: (asset: EditorMedia) => void;
  onPlayback: (playing: boolean) => void;
  onSeek: (time: number) => void;
  notify: (message: string) => void;
};
type Provider = { id: string; name: string; available: boolean; note: string };
type Take = {
  blob: Blob;
  url: string;
  start: number;
  itemId: string;
  filename: string;
};
type VoicePlacement = { start: number; text: string; placed?: boolean };

function addVoice(
  project: EditorProject,
  asset: EditorMedia,
  start: number,
  id: string,
) {
  const tracks = tracksOf(project);
  const duration = Math.min(asset.duration, 600 - start);
  if (duration <= 0.01 || project.items.some((item) => item.id === id))
    return project;
  let track = tracks.find(
    (t) =>
      t.kind === "audio" &&
      !t.locked &&
      /voice|narration/i.test(t.name) &&
      !project.items.some(
        (item) =>
          item.track === t.id &&
          item.start < start + duration &&
          item.start + item.duration > start,
      ),
  );
  if (!track) {
    track = {
      id: Math.max(-1, ...tracks.map((t) => t.id)) + 1,
      name: "Voiceover",
      kind: "audio",
      locked: false,
      hidden: false,
      muted: false,
    };
    tracks.push(track);
  }
  return {
    ...project,
    tracks,
    items: [
      ...project.items,
      {
        ...newItem("audio", asset, start, track.id),
        id,
        duration,
        audio_role: "voiceover" as const,
      },
    ],
  };
}

export function ScriptVoicePanel(props: ScriptVoicePanelProps) {
  const current = useRef(props);
  current.current = props;
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]),
    [providers, setProviders] = useState<Provider[]>([]);
  const [voiceId, setVoiceId] = useState(""),
    [voicesLoading, setVoicesLoading] = useState(true);
  const [speed, setSpeed] = useState(1),
    [stability, setStability] = useState(0.5);
  const [segmentMode, setSegmentMode] = useState<"all" | "paragraph" | "line">(
      "all",
    ),
    [segmentIndex, setSegmentIndex] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [deviceId, setDeviceId] = useState("");
  const [micReady, setMicReady] = useState(false),
    [level, setLevel] = useState(0);
  const [recordState, setRecordState] = useState<
    "idle" | "requesting" | "countdown" | "recording" | "uploading"
  >("idle");
  const [countdown, setCountdown] = useState(3),
    [elapsed, setElapsed] = useState(0),
    [playAlong, setPlayAlong] = useState(true);
  const [take, setTake] = useState<Take | null>(null),
    [showScript, setShowScript] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null);
  const meterFrame = useRef(0),
    countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStarted = useRef(0),
    takeUrl = useRef(""),
    mounted = useRef(true),
    recordStateRef = useRef(recordState);
  recordStateRef.current = recordState;
  const voiceJob = useJob(undefined, `studio-voice:${props.clipId}`),
    placedJobs = useRef(new Set<string>());
  const script = props.project.script || "";
  const segments =
    segmentMode === "paragraph"
      ? script.split(/\n\s*\n/).filter((s) => s.trim())
      : script.split(/\n/).filter((s) => s.trim());
  const narration =
    segmentMode === "all"
      ? script
      : segments[Math.min(segmentIndex, Math.max(0, segments.length - 1))] ||
        "";
  const voice = voices.find((v) => v.id === voiceId);
  const recording = recordState === "recording" || recordState === "countdown";

  async function loadVoices() {
    setVoicesLoading(true);
    try {
      const data = await api<{ voices: Voice[]; providers: Provider[] }>(
        "/voices",
      );
      if (!mounted.current) return;
      setVoices(data.voices);
      setProviders(data.providers);
      setVoiceId((previous) =>
        data.voices.some((v) => v.id === previous && v.available)
          ? previous
          : (
              data.voices.find(
                (v) => v.available && v.provider === "elevenlabs",
              ) || data.voices.find((v) => v.available)
            )?.id || "",
      );
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setVoicesLoading(false);
    }
  }
  function releaseMic() {
    cancelAnimationFrame(meterFrame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void context.current?.close();
    context.current = null;
    if (mounted.current) {
      setMicReady(false);
      setLevel(0);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void loadVoices();
    return () => {
      mounted.current = false;
      if (countdownTimer.current) clearTimeout(countdownTimer.current);
      if (stopTimer.current) clearTimeout(stopTimer.current);
      if (recorder.current?.state === "recording") {
        recorder.current.onstop = null;
        recorder.current.stop();
        current.current.onPlayback(false);
      }
      releaseMic();
      if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
    };
  }, [props.clipId]);

  async function enableMic(selectedDevice = deviceId) {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Microphone recording needs a supported browser on localhost or HTTPS.",
      );
      return false;
    }
    setError("");
    setRecordState("requesting");
    releaseMic();
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(selectedDevice ? { deviceId: { exact: selectedDevice } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (!mounted.current) {
        next.getTracks().forEach((t) => t.stop());
        return false;
      }
      stream.current = next;
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (d) => d.kind === "audioinput",
        ),
      );
      const audioContext = new AudioContext();
      context.current = audioContext;
      await audioContext.resume();
      const analyzer = audioContext.createAnalyser();
      analyzer.fftSize = 512;
      audioContext.createMediaStreamSource(next).connect(analyzer);
      const samples = new Uint8Array(analyzer.fftSize);
      const tick = () => {
        if (!mounted.current || context.current !== audioContext) return;
        analyzer.getByteTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
            samples.length,
        );
        setLevel(clamp(rms * 5, 0, 1));
        if (recordStateRef.current === "recording")
          setElapsed((performance.now() - recordingStarted.current) / 1000);
        meterFrame.current = requestAnimationFrame(tick);
      };
      tick();
      setMicReady(true);
      setRecordState("idle");
      return true;
    } catch (e) {
      releaseMic();
      setRecordState("idle");
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser, then try again."
          : `Microphone unavailable. ${(e as Error).message}`,
      );
      return false;
    }
  }
  async function uploadTake(recorded: Take) {
    setRecordState("uploading");
    setError("");
    try {
      const form = new FormData();
      form.append("file", recorded.blob, recorded.filename);
      form.append("role", "voiceover");
      const asset = await api<EditorMedia>(
        `/editor/${current.current.clipId}/media`,
        { method: "POST", body: form },
      );
      if (!mounted.current) return;
      current.current.onMedia(asset);
      current.current.onChange(
        addVoice(
          current.current.project,
          asset,
          recorded.start,
          recorded.itemId,
        ),
      );
      current.current.notify(
        `Voice take added at ${formatTime(recorded.start)}.`,
      );
    } catch (e) {
      if (mounted.current)
        setError(
          `Take saved in this panel; upload failed. ${(e as Error).message}`,
        );
    } finally {
      if (mounted.current) setRecordState("idle");
    }
  }
  async function startRecording(retake = false) {
    if (recordState !== "idle") return;
    if (!micReady && !(await enableMic())) return;
    const start =
      retake && take ? take.start : clamp(current.current.playhead, 0, 599.9);
    if (retake && take)
      current.current.onChange({
        ...current.current.project,
        items: current.current.project.items.filter(
          (item) => item.id !== take.itemId,
        ),
      });
    current.current.onPlayback(false);
    current.current.onSeek(start);
    setError("");
    setElapsed(0);
    setCountdown(3);
    setRecordState("countdown");
    let count = 3;
    const begin = () => {
      count -= 1;
      if (count > 0) {
        setCountdown(count);
        countdownTimer.current = setTimeout(begin, 1000);
        return;
      }
      if (!stream.current || !mounted.current) return;
      try {
        const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
          (type) => MediaRecorder.isTypeSupported(type),
        );
        const next = new MediaRecorder(
          stream.current,
          mime ? { mimeType: mime } : undefined,
        );
        recorder.current = next;
        const chunks: BlobPart[] = [];
        next.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        next.onerror = () => {
          if (mounted.current)
            setError(
              "The microphone stopped unexpectedly. Retry the recording.",
            );
        };
        next.onstop = () => {
          if (stopTimer.current) clearTimeout(stopTimer.current);
          current.current.onPlayback(false);
          if (!mounted.current) return;
          const blob = new Blob(chunks, {
            type: next.mimeType || "audio/webm",
          });
          if (!blob.size) {
            setRecordState("idle");
            setError(
              "No audio was captured. Check the selected microphone and retry.",
            );
            return;
          }
          if (takeUrl.current) URL.revokeObjectURL(takeUrl.current);
          const url = URL.createObjectURL(blob);
          takeUrl.current = url;
          const recorded: Take = {
            blob,
            url,
            start,
            itemId: `recording-${uid()}`,
            filename: `Voice take.${next.mimeType.includes("mp4") ? "m4a" : "webm"}`,
          };
          setTake(recorded);
          void uploadTake(recorded);
        };
        recordingStarted.current = performance.now();
        next.start(100);
        recordStateRef.current = "recording";
        setRecordState("recording");
        if (playAlong) current.current.onPlayback(true);
        stopTimer.current = setTimeout(
          () => {
            if (next.state === "recording") next.stop();
          },
          (600 - start) * 1000,
        );
      } catch (e) {
        setRecordState("idle");
        setError(`Recording could not start. ${(e as Error).message}`);
      }
    };
    countdownTimer.current = setTimeout(begin, 1000);
  }
  function stopRecording() {
    if (countdownTimer.current) clearTimeout(countdownTimer.current);
    if (recordState === "countdown") {
      setRecordState("idle");
      return;
    }
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  async function generateVoice() {
    if (!voice || !narration.trim()) return;
    setError("");
    const placement: VoicePlacement = {
      start: clamp(props.playhead, 0, 599.9),
      text: narration.trim(),
    };
    try {
      sessionStorage.setItem(
        `studio-voice-placement:${props.clipId}`,
        JSON.stringify(placement),
      );
    } catch {
      /* Storage is optional. */
    }
    await voiceJob.start("/tts", {
      clip_id: props.clipId,
      text: placement.text,
      provider: voice.provider,
      voice_id: voice.id,
      speed,
      stability,
      pitch: 0,
    });
  }
  useEffect(() => {
    const job = voiceJob.job;
    if (job?.status !== "completed" || placedJobs.current.has(job.id)) return;
    const asset = job.result?.asset as Asset | undefined;
    if (!asset) return;
    placedJobs.current.add(job.id);
    let placement: VoicePlacement = {
      start: current.current.playhead,
      text: "Narration",
    };
    try {
      placement =
        JSON.parse(
          sessionStorage.getItem(`studio-voice-placement:${props.clipId}`) ||
            "null",
        ) || placement;
    } catch {
      /* Use the current playhead. */
    }
    if (
      placement.placed ||
      current.current.project.items.some((item) => item.id === `tts-${job.id}`)
    )
      return;
    void api<{ media: EditorMedia[] }>(`/editor/${props.clipId}`)
      .then((response) => {
        if (!mounted.current) return;
        const rich = response.media.find((media) => media.id === asset.id);
        if (!rich)
          throw new Error(
            "Generated audio is missing. Refresh the media bin and retry.",
          );
        current.current.onMedia(rich);
        current.current.onChange(
          addVoice(
            current.current.project,
            rich,
            placement.start,
            `tts-${job.id}`,
          ),
        );
        try {
          sessionStorage.setItem(
            `studio-voice-placement:${props.clipId}`,
            JSON.stringify({ ...placement, placed: true }),
          );
        } catch {
          /* Current project still records the item ID. */
        }
        current.current.notify(
          `Narration added at ${formatTime(placement.start)}.`,
        );
      })
      .catch((e) => {
        placedJobs.current.delete(job.id);
        if (mounted.current) setError((e as Error).message);
      });
  }, [voiceJob.job, props.clipId]);

  return (
    <section className="audio-caption-panel" aria-label="Script and voice">
      <header className="ac-heading">
        <h3>
          <Mic size={16} /> Voice recording
        </h3>
        <span className="ac-time">
          {recording ? formatTime(elapsed) : formatTime(props.playhead)}
        </span>
      </header>
      {error && (
        <p className="ac-feedback ac-error" role="alert">
          {error}
        </p>
      )}
      <label className="ac-field">
        Microphone
        <select
          aria-label="Recording microphone"
          value={deviceId}
          disabled={recording || recordState === "requesting"}
          onChange={(e) => {
            setDeviceId(e.target.value);
            if (micReady) void enableMic(e.target.value);
          }}
        >
          <option value="">Default microphone</option>
          {devices.map((device) => (
            <option value={device.deviceId} key={device.deviceId}>
              {device.label || `Microphone ${devices.indexOf(device) + 1}`}
            </option>
          ))}
        </select>
      </label>
      <div className="ac-meter-row">
        <div
          className="ac-meter"
          role="meter"
          aria-label="Live microphone level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <span style={{ transform: `scaleX(${level})` }} />
        </div>
        <span>{micReady ? "Live" : "Off"}</span>
      </div>
      <div className="ac-actions">
        {recording ? (
          <button
            type="button"
            className="button danger small"
            onClick={stopRecording}
          >
            <Square size={14} />
            {recordState === "countdown"
              ? `Cancel ${countdown}`
              : "Stop recording"}
          </button>
        ) : (
          <button
            type="button"
            className="button primary small"
            onClick={() => void startRecording()}
            disabled={recordState !== "idle"}
          >
            {recordState === "requesting" || recordState === "uploading" ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Mic size={14} />
            )}
            {recordState === "uploading"
              ? "Saving take…"
              : recordState === "requesting"
                ? "Connecting…"
                : "Record voice"}
          </button>
        )}
        <button
          type="button"
          className="button secondary small ac-icon"
          aria-label={micReady ? "Turn microphone off" : "Check microphone"}
          disabled={recording || recordState !== "idle"}
          onClick={() => (micReady ? releaseMic() : void enableMic())}
        >
          {micReady ? <MicOff size={15} /> : <AudioLines size={15} />}
        </button>
      </div>
      <label className="ac-check">
        <input
          type="checkbox"
          checked={playAlong}
          disabled={recording}
          onChange={(e) => setPlayAlong(e.target.checked)}
        />{" "}
        Play timeline while recording
      </label>
      <p className="ac-help">
        A 3-second countdown, then record from the playhead. Use headphones for
        clean sound.
      </p>
      {take && (
        <div className="ac-take">
          <audio aria-label="Latest voice take" src={take.url} controls />
          <div className="ac-actions">
            <button
              className="button secondary small"
              type="button"
              disabled={recordState !== "idle"}
              onClick={() => void startRecording(true)}
            >
              <RefreshCw size={13} /> Retake
            </button>
            {!props.project.items.some((item) => item.id === take.itemId) && (
              <button
                className="button secondary small"
                type="button"
                disabled={recordState !== "idle"}
                onClick={() => void uploadTake(take)}
              >
                Retry upload
              </button>
            )}
          </div>
        </div>
      )}
      <header className="ac-heading ac-section-heading">
        <h3>Script</h3>
        <span>
          {script.trim() ? script.trim().split(/\s+/).length : 0} words
        </span>
      </header>
      <textarea
        className="ac-script"
        aria-label="Project narration script"
        placeholder="Write your narration. Leave a blank line between paragraphs."
        rows={7}
        value={script}
        onChange={(e) =>
          props.onChange({ ...props.project, script: e.target.value })
        }
      />
      <div className="ac-actions">
        <button
          className="button secondary small"
          type="button"
          disabled={!script.trim()}
          onClick={() => setShowScript(!showScript)}
          aria-pressed={showScript}
        >
          <Play size={13} /> Read along
        </button>
        <button
          className="button secondary small ac-icon"
          type="button"
          aria-label="Add script marker at playhead"
          disabled={!script.trim()}
          onClick={() =>
            props.onChange({
              ...props.project,
              markers: [
                ...(props.project.markers || []),
                {
                  id: uid(),
                  time: props.playhead,
                  label:
                    narration.trim().split(/\s+/).slice(0, 6).join(" ") ||
                    "Narration",
                },
              ],
            })
          }
        >
          <Flag size={14} />
        </button>
      </div>
      {showScript && (
        <div
          className="ac-teleprompter"
          tabIndex={0}
          aria-label="Script read along"
        >
          {narration || script}
        </div>
      )}
      <header className="ac-heading ac-section-heading">
        <h3>
          <Volume2 size={16} /> Generate narration
        </h3>
        <button
          type="button"
          className="ac-plain"
          aria-label="Refresh available voices"
          onClick={() => void loadVoices()}
          disabled={voicesLoading}
        >
          <RefreshCw size={13} />
        </button>
      </header>
      <label className="ac-field">
        Voice
        <select
          aria-label="Narration voice"
          value={voiceId}
          disabled={voicesLoading || voiceJob.busy}
          onChange={(e) => setVoiceId(e.target.value)}
        >
          <option value="">
            {voicesLoading ? "Loading voices…" : "Choose a voice"}
          </option>
          {providers.map((provider) => (
            <optgroup label={provider.name} key={provider.id}>
              {voices
                .filter((v) => v.provider === provider.id)
                .map((v) => (
                  <option
                    value={v.id}
                    key={`${v.provider}:${v.id}`}
                    disabled={!v.available}
                  >
                    {v.name} · {v.language}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {!voicesLoading && !voices.some((v) => v.available) && (
        <p className="ac-help">
          Add an ElevenLabs key in Settings, or install a local voice provider.
          Recording and imported audio are ready to use.
        </p>
      )}
      {voice?.provider === "elevenlabs" && (
        <p className="ac-help">
          Sends the selected script to your ElevenLabs account.
        </p>
      )}
      <div className="ac-field-pair">
        <label className="ac-field">
          Read
          <select
            value={segmentMode}
            onChange={(e) => {
              setSegmentMode(e.target.value as typeof segmentMode);
              setSegmentIndex(0);
            }}
          >
            <option value="all">Whole script</option>
            <option value="paragraph">Paragraph</option>
            <option value="line">Single line</option>
          </select>
        </label>
        {segmentMode !== "all" && (
          <label className="ac-field">
            {segmentMode === "paragraph" ? "Paragraph" : "Line"}
            <select
              value={Math.min(segmentIndex, Math.max(0, segments.length - 1))}
              onChange={(e) => setSegmentIndex(Number(e.target.value))}
            >
              {segments.map((segment, index) => (
                <option key={index} value={index}>
                  {index + 1}. {segment.slice(0, 24)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="ac-range">
        Speed <output>{speed.toFixed(2)}×</output>
        <input
          aria-label="Narration speed"
          type="range"
          min={0.7}
          max={1.2}
          step={0.05}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        />
      </label>
      {voice?.provider === "elevenlabs" && (
        <label className="ac-range">
          Stability <output>{Math.round(stability * 100)}%</output>
          <input
            aria-label="ElevenLabs stability"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={stability}
            onChange={(e) => setStability(Number(e.target.value))}
          />
        </label>
      )}
      {voiceJob.error && (
        <p className="ac-feedback ac-error" role="alert">
          {voiceJob.error}
        </p>
      )}
      {voiceJob.busy && (
        <progress
          aria-label="Voice generation progress"
          max={100}
          value={voiceJob.job?.progress || 0}
        />
      )}
      <button
        className="button primary small ac-full"
        type="button"
        disabled={
          !narration.trim() || !voice?.available || voiceJob.busy || recording
        }
        onClick={() => void generateVoice()}
      >
        {voiceJob.busy ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <Volume2 size={14} />
        )}
        {voiceJob.busy ? "Generating voice…" : "Generate at playhead"}
      </button>
    </section>
  );
}
