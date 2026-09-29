import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  Clapperboard,
  Crop,
  Download,
  FileText,
  Film,
  LoaderCircle,
  Mic2,
  Pause,
  Play,
  Plus,
  Save,
  ScanLine,
  Subtitles,
  Upload,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Clip, Preset, Script, Voice } from "../api";
import { api, assetUrl, editable, post, useJob, wordCount } from "../api";
import { Badge, ClipSelect, JobProgress, Notice } from "../ui";
import { AudioPreview } from "./AudioPreview";
import { TranscriptEditor } from "./TranscriptEditor";
type Tool = "edit" | "script" | "voice" | "captions" | "export";
type Region = { x: number; y: number; width: number; height: number };
const tools = [
  { id: "edit", label: "Video", icon: Crop },
  { id: "script", label: "Script", icon: FileText },
  { id: "voice", label: "Voice", icon: Mic2 },
  { id: "captions", label: "Captions", icon: Subtitles },
  { id: "export", label: "Export", icon: ArrowDownToLine },
] as const;
export function Studio({
  clips,
  selected,
  onSelect,
  refresh,
  onImport,
  onPublish,
}: {
  clips: Clip[];
  selected: string;
  onSelect: (id: string) => void;
  refresh: () => void;
  onImport: () => void;
  onPublish: () => void;
}) {
  const [clip, setClip] = useState<Clip | null>(null);
  const [tool, setTool] = useState<Tool>("edit");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [original, setOriginal] = useState("");
  const [rewritten, setRewritten] = useState("");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [preset, setPreset] = useState("bold-pop");
  const [captionMode, setCaptionMode] = useState("none");
  const [region, setRegion] = useState<Region>({
    x: 0,
    y: 0.6,
    width: 1,
    height: 0.18,
  });
  const [captions, setCaptions] = useState(true);
  const [fontSize, setFontSize] = useState(64);
  const [position, setPosition] = useState(0.75);
  const [wordsPerLine, setWordsPerLine] = useState(4);
  const [color, setColor] = useState("#FFFFFF");
  const [highlight, setHighlight] = useState("#0A84FF");
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState("");
  const [zoom, setZoom] = useState(1);
  const [audioMode, setAudioMode] = useState("original");
  const [originalVolume, setOriginalVolume] = useState(1);
  const [voiceVolume, setVoiceVolume] = useState(1);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("");
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const load = async () => {
    if (!selected) return;
    try {
      const c = await api<Clip>(`/clips/${selected}`);
      setClip(c);
      setOriginal((previous) => previous || c.transcript?.text || "");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const task = useJob(() => {
    load();
    setMessage("Your file is ready.");
  }, selected);
  useEffect(() => {
    setError("");
    setMessage("");
    setClip(null);
    setOriginal("");
    setRewritten("");
    setTrimStart(0);
    setTrimEnd("");
    setDuration(0);
    setTime(0);
    setAudioMode("original");
    setCaptionMode("none");
    if (selected)
      api<Clip>(`/clips/${selected}`)
        .then((c) => {
          setClip(c);
          setOriginal(c.script?.original_text || c.transcript?.text || "");
          setRewritten(c.script?.rewritten_text || "");
          setTool(editable(c) ? "edit" : "script");
        })
        .catch((e) => setError(e.message));
  }, [selected]);
  useEffect(() => {
    api<{ presets: Preset[] }>("/presets")
      .then((d) => setPresets(d.presets))
      .catch((e) => setError(e.message));
    api<{ voices: Voice[] }>("/voices")
      .then((d) => setVoices(d.voices))
      .catch(() => {});
  }, []);
  const source = clip?.assets?.filter((a) => a.kind === "source").at(-1);
  const voiceover = clip?.assets?.filter((a) => a.kind === "voiceover").at(-1);
  const exported = clip?.assets?.filter((a) => a.kind === "export").at(-1);
  const captionText = rewritten.trim() || original.trim();
  const activePreset = presets.find((p) => p.id === preset);
  const permitted = clip ? editable(clip) : false;
  const act = async (action: () => Promise<void>) => {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const save = () =>
    act(async () => {
      await api(`/scripts/${selected}`, {
        method: "PUT",
        body: JSON.stringify({
          original_text: original,
          rewritten_text: rewritten,
        }),
      });
      setMessage("Script saved to this project.");
    });
  const rewrite = () =>
    act(async () => {
      if (!clip) return;
      const r = await post<
        Script & { within_tolerance: boolean; attempts: number }
      >("/rewrite", {
        clip_id: selected,
        text: permitted ? original : "",
        mode: permitted ? "rewrite" : "original",
        topic: permitted ? "" : clip.title + "\n" + clip.description,
      });
      setRewritten(r.rewritten_text);
      if (!permitted) setOriginal(r.original_text);
      setMessage(
        permitted
          ? `Original ${r.words_original} words → new ${r.words_rewritten} words. ${r.within_tolerance ? "Within 5% of the original." : "Still outside 5% after retries; please adjust before recording."}`
          : "An original script is ready. Add your own footage to create the video.",
      );
      load();
    });
  const detect = () =>
    act(async () => {
      const r = await post<Region & { detected: boolean; message: string }>(
        "/captions/detect",
        { clip_id: selected },
      );
      setRegion({ x: r.x, y: r.y, width: r.width, height: r.height });
      setCaptionMode("blur");
      setMessage(r.message);
    });
  const render = async () => {
    await api(`/scripts/${selected}`, {
      method: "PUT",
      body: JSON.stringify({
        original_text: original,
        rewritten_text: rewritten,
      }),
    });
    await task.start("/export", {
      clip_id: selected,
      trim_start: trimStart,
      ...(trimEnd ? { trim_end: Number(trimEnd) } : {}),
      crop_zoom: zoom,
      caption_mode: captionMode,
      caption_region: region,
      preset,
      captions,
      caption_text: captionText,
      font_size: fontSize,
      caption_position: position,
      words_per_line: wordsPerLine,
      caption_color: color,
      highlight_color: highlight,
      audio_mode: audioMode,
      original_volume: originalVolume,
      voice_volume: voiceVolume,
    });
  };
  const format = (n: number) =>
    `${Math.floor(n / 60)
      .toString()
      .padStart(2, "0")}:${Math.floor(n % 60)
      .toString()
      .padStart(2, "0")}`;
  return (
    <>
      <div className="page-heading studio-heading">
        <div>
          <h1>Your story, taking shape.</h1>
          <p>A few thoughtful edits. Something entirely yours.</p>
        </div>
        <div className="heading-actions">
          {clips.length > 0 && (
            <select
              aria-label="Studio project"
              value={selected}
              onChange={(e) => onSelect(e.target.value)}
            >
              <option value="">Select a project</option>
              {clips
                .filter((c) => c.workflow_status !== "archived")
                .map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          )}
          <button className="button secondary" onClick={onImport}>
            <Plus size={17} /> Add footage
          </button>
        </div>
      </div>
      {!clip ? (
        <div className="studio-welcome">
          <div className="empty-tool-icon">
            <Clapperboard size={42} strokeWidth={1.2} />
          </div>
          <h2>Every great Short starts somewhere.</h2>
          <p>
            Choose a project from your library or upload your footage. Your
            script, voice, and captions come together here.
          </p>
          {clips.length > 0 ? (
            <ClipSelect clips={clips} value={selected} onChange={onSelect} />
          ) : (
            <button className="button primary" onClick={onImport}>
              <Upload size={17} /> Add your footage
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="project-bar">
            <div>
              <span className="project-file-icon">
                <Film size={17} />
              </span>
              <strong>{clip.title}</strong>
              <Badge clip={clip} />
            </div>
            <span className="muted">
              9:16 <span className="separator">/</span> 1080 × 1920
            </span>
          </div>
          {(error || task.error) && <Notice>{error || task.error}</Notice>}
          {message && <Notice kind="info">{message}</Notice>}
          <div className={`studio-workbench tool-${tool}`}>
            <nav className="studio-tools" aria-label="Editor tools">
              {tools.map(({ id, label, icon: Icon }) => (
                <button
                  className={tool === id ? "active" : ""}
                  aria-pressed={tool === id}
                  key={id}
                  onClick={() => setTool(id)}
                >
                  <Icon size={21} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
            <div className="studio-stage">
              {tool === "script" ? (
                <div className="script-workspace">
                  <div className="section-heading">
                    <h2>
                      {permitted
                        ? "Same story. Your words."
                        : "Start an original story."}
                    </h2>
                    <button
                      className="button secondary small"
                      onClick={save}
                      disabled={working}
                    >
                      <Save size={15} /> Save
                    </button>
                  </div>
                  {!permitted && (
                    <Notice kind="info">
                      This writes from the topic and description. To export,
                      create a project with your own or authorized footage and
                      paste the script there.
                    </Notice>
                  )}
                  <div className="script-columns">
                    <label className="field">
                      {permitted ? "Original transcript" : "Topic and context"}
                      <textarea
                        rows={16}
                        value={
                          permitted
                            ? original
                            : clip.title + "\n" + clip.description
                        }
                        readOnly={!permitted}
                        onChange={(e) => setOriginal(e.target.value)}
                        placeholder="Transcribe your video or paste its script here."
                      />
                      <small>{wordCount(original)} words</small>
                    </label>
                    <label className="field">
                      Your new script
                      <textarea
                        rows={16}
                        value={rewritten}
                        onChange={(e) => setRewritten(e.target.value)}
                        placeholder="Your rewritten script will appear here. You can edit every word."
                      />
                      <small>{wordCount(rewritten)} words</small>
                    </label>
                  </div>
                  {permitted && (
                    <TranscriptEditor clip={clip} onSaved={setOriginal} />
                  )}
                </div>
              ) : (
                <>
                  <div className="preview-stage">
                    <span className="canvas-label">
                      PREVIEW <span>9:16</span>
                    </span>
                    <div
                      className="phone-preview"
                      onPointerDown={(e) => {
                        if (
                          tool !== "edit" ||
                          captionMode === "none" ||
                          !source
                        )
                          return;
                        const bounds = e.currentTarget.getBoundingClientRect();
                        const update = (y: number) =>
                          setRegion((r) => ({
                            ...r,
                            y: Math.max(
                              0,
                              Math.min(
                                1 - r.height,
                                (y - bounds.top) / bounds.height - r.height / 2,
                              ),
                            ),
                          }));
                        update(e.clientY);
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          const bounds =
                            e.currentTarget.getBoundingClientRect();
                          setRegion((r) => ({
                            ...r,
                            y: Math.max(
                              0,
                              Math.min(
                                1 - r.height,
                                (e.clientY - bounds.top) / bounds.height -
                                  r.height / 2,
                              ),
                            ),
                          }));
                        }
                      }}
                    >
                      {source ? (
                        <video
                          ref={video}
                          src={assetUrl(source)}
                          style={{ transform: `scale(${zoom})` }}
                          onLoadedMetadata={(e) =>
                            setDuration(e.currentTarget.duration)
                          }
                          onTimeUpdate={(e) =>
                            setTime(e.currentTarget.currentTime)
                          }
                          onPlay={() => setPlaying(true)}
                          onPause={() => setPlaying(false)}
                          playsInline
                          muted={audioMode === "replace"}
                        />
                      ) : (
                        <div className="no-preview">
                          <Film size={42} strokeWidth={1} />
                          <strong>
                            {permitted
                              ? "Your footage goes here."
                              : "An idea worth exploring."}
                          </strong>
                          <span>
                            {permitted
                              ? "Download this video to start editing."
                              : "Use the Script tool to write an original story."}
                          </span>
                          {clip.thumbnail_url && (
                            <img
                              src={clip.thumbnail_url}
                              alt="Source video thumbnail"
                            />
                          )}
                        </div>
                      )}
                      {source &&
                        captionMode !== "none" &&
                        captionMode !== "crop" && (
                          <div
                            className={`caption-region ${captionMode}`}
                            style={{
                              top: `${region.y * 100}%`,
                              left: `${region.x * 100}%`,
                              width: `${region.width * 100}%`,
                              height: `${region.height * 100}%`,
                            }}
                          >
                            <span>
                              {tool === "edit" ? "Drag to position" : ""}
                            </span>
                          </div>
                        )}
                      {source && captions && captionText && (
                        <div
                          className={`preview-caption preset-${preset}`}
                          style={
                            {
                              top: `${position * 100}%`,
                              fontSize: fontSize / 3.8,
                              color,
                              "--caption-highlight": highlight,
                            } as React.CSSProperties
                          }
                        >
                          {captionText
                            .split(/\s+/)
                            .slice(0, wordsPerLine)
                            .join(" ")}
                        </div>
                      )}
                    </div>
                    <span className="preview-note">
                      {captionMode === "crop"
                        ? "Crop cleanup is applied during export."
                        : "Preview is a layout guide. Rendered captions use the saved timing."}
                    </span>
                  </div>
                  <div className="transport">
                    <button
                      className="icon-button"
                      aria-label={playing ? "Pause preview" : "Play preview"}
                      disabled={!source}
                      onClick={() => {
                        if (video.current) {
                          if (playing) video.current.pause();
                          else
                            video.current
                              .play()
                              .catch((e) => setError(e.message));
                        }
                      }}
                    >
                      {playing ? (
                        <Pause size={18} />
                      ) : (
                        <Play size={18} fill="currentColor" />
                      )}
                    </button>
                    <span>
                      {format(time)}{" "}
                      <span className="muted">/ {format(duration)}</span>
                    </span>
                    <input
                      aria-label="Video position"
                      type="range"
                      min="0"
                      max={duration || 1}
                      step=".1"
                      value={time}
                      disabled={!source}
                      onChange={(e) => {
                        if (video.current)
                          video.current.currentTime = Number(e.target.value);
                      }}
                    />
                    <Volume2 size={17} />
                  </div>
                  <div className="timeline">
                    <div className="timeline-label">
                      <Film size={15} />
                      <span>Video</span>
                    </div>
                    <div
                      className={`timeline-track ${source ? "has-source" : ""}`}
                    >
                      <span>
                        {source ? clip.title : "Add a video to start"}
                      </span>
                    </div>
                    <div className="timeline-label">
                      <AudioLines size={15} />
                      <span>Voice</span>
                    </div>
                    <div
                      className={`timeline-track audio ${voiceover ? "has-source" : ""}`}
                    >
                      <span>
                        {voiceover
                          ? "Generated voiceover"
                          : "Your voiceover will appear here"}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
            <aside className="studio-properties">
              <div className="properties-heading">
                <h2>
                  {
                    {
                      edit: "Make the cut",
                      script: "Rewrite your story",
                      voice: "Set the tone",
                      captions: "Let every word land",
                      export: "Ready for the world",
                    }[tool]
                  }
                </h2>
                <p>
                  {
                    {
                      edit: "A clean canvas for a fresh story.",
                      script: "Keep the facts. Find a fresh voice.",
                      voice: "A voiceover that feels like you.",
                      captions: "Readable, rhythmic, unmistakably yours.",
                      export: "The last step before your next Short.",
                    }[tool]
                  }
                </p>
              </div>
              {tool === "edit" && (
                <>
                  <div className="property-section">
                    <h3>Source footage</h3>
                    {!permitted ? (
                      <p className="help-text">
                        Save permission in the Library before editing this
                        footage.
                      </p>
                    ) : !source ? (
                      <button
                        className="button primary full"
                        disabled={task.busy}
                        onClick={() =>
                          task.start(`/clips/${selected}/download`)
                        }
                      >
                        <Download size={16} /> Download video
                      </button>
                    ) : (
                      <span className="badge good">
                        <Check size={13} /> Footage ready
                      </span>
                    )}
                  </div>
                  <div className="property-section">
                    <h3>Trim & frame</h3>
                    <div className="field-grid">
                      <label className="field">
                        Start (sec)
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={trimStart}
                          onChange={(e) => setTrimStart(Number(e.target.value))}
                        />
                      </label>
                      <label className="field">
                        End (sec)
                        <input
                          type="number"
                          min={trimStart + 0.1}
                          step="0.1"
                          value={trimEnd}
                          placeholder="Full clip"
                          onChange={(e) => setTrimEnd(e.target.value)}
                        />
                      </label>
                    </div>
                    <Range
                      label="Crop / zoom"
                      value={zoom}
                      min={1}
                      max={2}
                      step={0.05}
                      display={`${zoom.toFixed(2)}×`}
                      onChange={setZoom}
                    />
                  </div>
                  <div className="property-section">
                    <div className="section-heading">
                      <h3>Clean old captions</h3>
                      <span className="badge neutral">Approximate</span>
                    </div>
                    <p className="help-text">
                      Cover, blur, or crop the old text, then place your
                      captions on top.
                    </p>
                    <button
                      className="button secondary full"
                      onClick={detect}
                      disabled={!source || !permitted || working}
                    >
                      <ScanLine size={16} /> Find caption area
                    </button>
                    <label className="field">
                      Cleanup method
                      <select
                        value={captionMode}
                        onChange={(e) => setCaptionMode(e.target.value)}
                      >
                        <option value="none">Keep original</option>
                        <option value="blur">Blur band</option>
                        <option value="cover">Solid cover</option>
                        <option value="crop">Crop outside caption band</option>
                      </select>
                    </label>
                    {captionMode !== "none" && (
                      <>
                        <Range
                          label="Band position"
                          value={region.y}
                          min={0}
                          max={0.9}
                          step={0.01}
                          display={`${Math.round(region.y * 100)}%`}
                          onChange={(y) =>
                            setRegion((r) => ({
                              ...r,
                              y: Math.min(y, 1 - r.height),
                            }))
                          }
                        />
                        <Range
                          label="Band height"
                          value={region.height}
                          min={0.04}
                          max={0.4}
                          step={0.01}
                          display={`${Math.round(region.height * 100)}%`}
                          onChange={(height) =>
                            setRegion((r) => ({
                              ...r,
                              height: Math.min(height, 1 - r.y),
                            }))
                          }
                        />
                      </>
                    )}
                  </div>
                </>
              )}
              {tool === "script" && (
                <>
                  <div className="property-section">
                    <h3>
                      {permitted
                        ? "Start with a transcript"
                        : "Start with the topic"}
                    </h3>
                    <p className="help-text">
                      {permitted
                        ? "Transcribe locally, or paste your script into the original column. Whisper needs a separately installed model."
                        : "An original script uses only this Short’s topic and description."}
                    </p>
                    {permitted && (
                      <button
                        className="button secondary full"
                        disabled={!source || task.busy}
                        onClick={() =>
                          task.start(`/clips/${selected}/transcribe`)
                        }
                      >
                        <AudioLines size={16} /> Transcribe video
                      </button>
                    )}
                    {clip.transcript?.text &&
                      original !== clip.transcript.text && (
                        <button
                          className="button ghost full"
                          onClick={() =>
                            setOriginal(clip.transcript?.text || "")
                          }
                        >
                          Load saved transcript
                        </button>
                      )}
                  </div>
                  <div className="property-section">
                    <h3>Find a new way to say it.</h3>
                    <p className="help-text">
                      {permitted
                        ? "Preserves the language, facts, and tone. Aims for a word count within 5% of the original."
                        : "Creates a fresh narration. Add your own visuals in a new project."}
                    </p>
                    <button
                      className="button primary full"
                      onClick={rewrite}
                      disabled={working || (permitted && !original.trim())}
                    >
                      {working ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <WandSparkles size={16} />
                      )}{" "}
                      {permitted ? "Rewrite script" : "Write original script"}
                    </button>
                    <p className="help-text">
                      Uses the Gemini key in Settings. Review the result for
                      accuracy.
                    </p>
                  </div>
                  <div className="property-section script-counts">
                    <span>
                      Original <strong>{wordCount(original)}</strong>
                    </span>
                    <span>
                      Rewritten <strong>{wordCount(rewritten)}</strong>
                    </span>
                  </div>
                  <button
                    className="button secondary full"
                    onClick={() => {
                      save();
                      setTool("voice");
                    }}
                  >
                    Next: give it a voice <ArrowRight size={16} />
                  </button>
                </>
              )}
              {tool === "voice" && (
                <>
                  <div className="property-section">
                    <label className="field">
                      Voice
                      <select
                        value={voice}
                        onChange={(e) => setVoice(e.target.value)}
                      >
                        <option value="">Choose a voice</option>
                        {voices.map((v) => (
                          <option
                            key={v.id}
                            value={v.id}
                            disabled={!v.available}
                          >
                            {v.name}
                            {!v.available ? " · setup needed" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="help-text">
                      Add your own voice in Voice lab. Configure local models in
                      Settings.
                    </p>
                    <Range
                      label="Speaking speed"
                      min={0.9}
                      max={1.1}
                      step={0.01}
                      value={speed}
                      onChange={setSpeed}
                      display={`${speed.toFixed(2)}×`}
                    />
                    <button
                      className="button primary full"
                      disabled={!voice || !captionText || task.busy || working}
                      onClick={() =>
                        act(async () => {
                          await api(`/scripts/${selected}`, {
                            method: "PUT",
                            body: JSON.stringify({
                              original_text: original,
                              rewritten_text: captionText,
                            }),
                          });
                          await task.start("/tts", {
                            clip_id: selected,
                            text: captionText,
                            provider: voices.find((v) => v.id === voice)
                              ?.provider,
                            voice_id: voice,
                            speed,
                            pitch: 0,
                          });
                        })
                      }
                    >
                      <Volume2 size={16} /> Generate voiceover
                    </button>
                    {!captionText && (
                      <p className="help-text">
                        Write or paste a script first.
                      </p>
                    )}
                    {voiceover && <AudioPreview src={assetUrl(voiceover)} />}
                  </div>
                  <div className="property-section">
                    <h3>Audio mix</h3>
                    <label className="field">
                      Use audio
                      <select
                        value={audioMode}
                        onChange={(e) => setAudioMode(e.target.value)}
                      >
                        <option value="original">Original audio</option>
                        <option value="replace" disabled={!voiceover}>
                          Replace with voiceover
                        </option>
                        <option value="mix" disabled={!voiceover}>
                          Mix original and voiceover
                        </option>
                      </select>
                    </label>
                    <Range
                      label="Original volume"
                      value={originalVolume}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setOriginalVolume}
                      display={`${Math.round(originalVolume * 100)}%`}
                    />
                    <Range
                      label="Voice volume"
                      value={voiceVolume}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={setVoiceVolume}
                      display={`${Math.round(voiceVolume * 100)}%`}
                    />
                    <p className="help-text">
                      The source preview uses original audio. Listen to the
                      generated voice above; the chosen mix is applied during
                      export.
                    </p>
                  </div>
                </>
              )}
              {tool === "captions" && (
                <>
                  <div className="property-section">
                    <label className="switch-row">
                      <span>Show captions</span>
                      <input
                        type="checkbox"
                        checked={captions}
                        onChange={(e) => setCaptions(e.target.checked)}
                      />
                    </label>
                    <div className="caption-presets">
                      {presets.map((p) => (
                        <button
                          key={p.id}
                          className={`caption-preset preset-${p.id} ${preset === p.id ? "selected" : ""}`}
                          onClick={() => {
                            setPreset(p.id);
                            setColor(p.fill || "#FFFFFF");
                            setHighlight(p.highlight || "#0A84FF");
                          }}
                        >
                          <span>Aa</span>
                          <small>{p.name}</small>
                          {preset === p.id && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="property-section">
                    <Range
                      label="Font size"
                      value={fontSize}
                      min={28}
                      max={100}
                      step={2}
                      display={`${fontSize}px`}
                      onChange={setFontSize}
                    />
                    <Range
                      label="Vertical position"
                      value={position}
                      min={0.1}
                      max={0.9}
                      step={0.01}
                      display={`${Math.round(position * 100)}%`}
                      onChange={setPosition}
                    />
                    <Range
                      label="Words per line"
                      value={wordsPerLine}
                      min={1}
                      max={8}
                      step={1}
                      display={String(wordsPerLine)}
                      onChange={setWordsPerLine}
                    />
                    <div className="field-grid">
                      <label className="field">
                        Text color
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => setColor(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        Highlight
                        <input
                          type="color"
                          value={highlight}
                          onChange={(e) => setHighlight(e.target.value)}
                        />
                      </label>
                    </div>
                    <p className="help-text">
                      {activePreset?.description || "Choose a preset to start."}{" "}
                      Imported or edited text without alignment uses approximate
                      word timing.
                    </p>
                  </div>
                </>
              )}
              {tool === "export" && (
                <>
                  <div className="property-section">
                    <div className="export-specs">
                      <div>
                        <span>Format</span>
                        <strong>MP4 · H.264 / AAC</strong>
                      </div>
                      <div>
                        <span>Resolution</span>
                        <strong>1080 × 1920</strong>
                      </div>
                      <div>
                        <span>Captions</span>
                        <strong>
                          {captions ? activePreset?.name || "Bold Pop" : "Off"}
                        </strong>
                      </div>
                      <div>
                        <span>Audio</span>
                        <strong>
                          {audioMode === "original"
                            ? "Original"
                            : audioMode === "replace"
                              ? "Voiceover"
                              : "Mixed"}
                        </strong>
                      </div>
                    </div>
                    <button
                      className="button primary full"
                      disabled={!source || !permitted || working || task.busy}
                      onClick={() => act(render)}
                    >
                      {task.busy ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <ArrowDownToLine size={16} />
                      )}{" "}
                      Export Short
                    </button>
                    <p className="help-text">
                      Renders locally on your CPU. Keep ShortForge open until it
                      finishes.
                    </p>
                    {!source && (
                      <p className="help-text">
                        Add or download authorized footage in the Video tool
                        first.
                      </p>
                    )}
                    {exported && (
                      <a
                        className="button secondary full"
                        download
                        href={assetUrl(exported)}
                      >
                        <Download size={16} /> Download MP4
                      </a>
                    )}
                  </div>
                  <div className="property-section">
                    <h3>One more good detail.</h3>
                    <p className="help-text">
                      Get title ideas, a description, and tags for your finished
                      story.
                    </p>
                    <button
                      className="button secondary full"
                      onClick={onPublish}
                    >
                      Create publish kit <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              <JobProgress job={task.job} />
            </aside>
          </div>
        </>
      )}
    </>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field range-label">
      {label}
      <output>{display}</output>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
