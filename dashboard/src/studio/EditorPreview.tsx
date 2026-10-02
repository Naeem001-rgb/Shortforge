import {
  Film,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assetUrl } from "../api";
import { IconButton } from "../ui";
import { clamp, displayAt, durationOf, formatTime } from "./editorModel";
import type { EditorMedia, EditorProject } from "./editorModel";
import { captionWords } from "./textPresets";
import { CaptionLine } from "./EditorTemplates";
import { transitionBlend } from "./transitions";

export function EditorPreview({
  project,
  media,
  time,
  playing,
  selected,
  onTime,
  onPlaying,
  onSelect,
}: {
  project: EditorProject;
  media: EditorMedia[];
  time: number;
  playing: boolean;
  selected: string;
  onTime: (n: number) => void;
  onPlaying: (b: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLMediaElement>());
  const context = useRef<AudioContext | null>(null);
  const gains = useRef(
    new Map<
      string,
      {
        source: MediaElementAudioSourceNode;
        gain: GainNode;
        element: HTMLMediaElement;
      }
    >(),
  );
  const [size, setSize] = useState({ width: 216, height: 384 });
  const [monitorMuted, setMonitorMuted] = useState(false);
  const [playError, setPlayError] = useState("");
  const duration = durationOf(project);
  const current = useRef({ project, time });
  current.current = { project, time };
  const bindMedia = (id: string, element: HTMLMediaElement | null) => {
    const previous = elements.current.get(id);
    if (element) elements.current.set(id, element);
    else if (previous) {
      elements.current.delete(id);
      queueMicrotask(() => {
        if (elements.current.get(id) === previous) return;
        previous.pause();
        const graph = gains.current.get(id);
        if (graph?.element === previous) {
          graph.source.disconnect();
          graph.gain.disconnect();
          gains.current.delete(id);
        }
      });
    }
  };
  const mediaReady = (id: string, element: HTMLMediaElement) => {
    const item = current.current.project.items.find((i) => i.id === id);
    if (item)
      element.currentTime =
        item.source_in +
        clamp(current.current.time - item.start, 0, item.duration) * item.speed;
  };
  useEffect(() => {
    const resize = () => {
      if (!stage.current) return;
      const box = stage.current.getBoundingClientRect(),
        ratio = project.width / project.height;
      const h = Math.max(
        60,
        Math.min(box.height - 32, (box.width - 32) / ratio),
      );
      setSize({ width: h * ratio, height: h });
    };
    const observer = new ResizeObserver(resize);
    if (stage.current) observer.observe(stage.current);
    resize();
    return () => observer.disconnect();
  }, [project.width, project.height]);
  useEffect(() => {
    if (playing && !context.current) context.current = new AudioContext();
    if (playing) void context.current?.resume();
    for (const item of project.items) {
      const element = elements.current.get(item.id);
      if (!element) continue;
      const active = time >= item.start && time < item.start + item.duration;
      const sourceTime =
        item.source_in +
        clamp(time - item.start, 0, item.duration) * item.speed;
      if (
        Number.isFinite(sourceTime) &&
        Math.abs(element.currentTime - sourceTime) > (playing ? 0.12 : 0.015)
      )
        element.currentTime = sourceTime;
      element.playbackRate = item.speed;
      // Speech and music retain pitch when changing speed, matching export atempo.
      element.preservesPitch = true;
      const volume =
        item.muted || monitorMuted || !active
          ? 0
          : displayAt(item, time - item.start).volume;
      if (context.current) {
        let graph = gains.current.get(item.id);
        if (!graph || graph.element !== element) {
          graph?.source.disconnect();
          graph?.gain.disconnect();
          const source = context.current.createMediaElementSource(element),
            gain = context.current.createGain();
          source.connect(gain).connect(context.current.destination);
          graph = { source, gain, element };
          gains.current.set(item.id, graph);
        }
        graph.gain.gain.value = clamp(volume, 0, 2);
        element.volume = 1;
      } else element.volume = clamp(volume, 0, 1);
      if (playing && active && element.paused)
        void element
          .play()
          .catch(() =>
            setPlayError(
              "Preview playback was interrupted. Pause, then press play again.",
            ),
          );
      if (!playing || !active) element.pause();
    }
  }, [project, time, playing, monitorMuted]);
  useEffect(
    () => () => {
      elements.current.forEach((element) => element.pause());
      gains.current.forEach((graph) => {
        graph.source.disconnect();
        graph.gain.disconnect();
      });
      gains.current.clear();
      void context.current?.close();
      context.current = null;
    },
    [],
  );
  return (
    <section className="editor-player" aria-label="Video preview">
      <div className="editor-panel-heading">
        <h2>Player</h2>
        <span>
          {project.width} × {project.height}{" "}
          <span className="editor-divider">/</span> {project.fps} fps
        </span>
      </div>
      <div className="editor-preview-stage" ref={stage}>
        <div
          className="editor-canvas"
          style={{
            width: size.width,
            height: size.height,
            background: project.background,
          }}
        >
          {project.items.length === 0 && (
            <div className="editor-canvas-empty">
              <Film size={28} />
              <span>Your canvas</span>
            </div>
          )}
          {[...project.items]
            .sort((a, b) => a.track - b.track)
            .map((item) => {
              const asset = media.find((a) => a.id === item.asset_id),
                active =
                  time >= item.start && time < item.start + item.duration;
              const value = displayAt(item, time - item.start);
              // §4.2. `active` deliberately stays "within the item's own span":
              // a transition needs both clips on screen for the whole blend
              // window, which is exactly what makes it visible. Starting the
              // incoming clip at the blend instead would hide the effect.
              const blend = transitionBlend(project.items, time);
              const mine =
                blend && blend.item.id === item.id
                  ? blend.frame.incoming
                  : blend && blend.previous.id === item.id
                    ? blend.frame.outgoing
                    : null;
              const style = {
                opacity: active ? value.opacity * (mine?.opacity ?? 1) : 0,
                transform: `translate(${value.x + (mine?.x ?? 0)}%, ${value.y + (mine?.y ?? 0)}%) rotate(${value.rotation}deg) scale(${value.scale * (mine?.scale ?? 1)})`,
                clipPath: mine?.clipPath ?? undefined,
                maskImage: mine?.mask ?? undefined,
                filter: `blur(${(mine?.blur ?? 0) * (size.width / project.width)}px) brightness(${mine?.brightness ?? 1})`,
                zIndex: item.track + 1,
                pointerEvents: active ? ("auto" as const) : ("none" as const),
              };
              if (item.kind === "text") {
                // Alignment still comes from captionWords, but the words
                // themselves render through the shared CaptionLine so the
                // preview shows exactly what the template cards and the
                // exported ASS render — one component, three consumers.
                const caption = captionWords(item, time - item.start);
                return (
                  <div
                    key={item.id}
                    className={`editor-text-layer ${selected === item.id ? "selected" : ""}`}
                    style={{
                      ...style,
                      justifyContent:
                        caption.style.align === "left"
                          ? "flex-start"
                          : caption.style.align === "right"
                            ? "flex-end"
                            : "center",
                    }}
                    onClick={() => onSelect(item.id)}
                  >
                    <CaptionLine
                      item={item}
                      scale={size.width / project.width}
                      localTime={time - item.start}
                    />
                  </div>
                );
              }
              if (!asset) return null;
              if (item.kind === "audio")
                return (
                  <audio
                    key={item.id}
                    src={assetUrl(asset)}
                    preload="auto"
                    ref={(el) => bindMedia(item.id, el)}
                    onLoadedMetadata={(event) =>
                      mediaReady(item.id, event.currentTarget)
                    }
                  />
                );
              if (asset.media_type === "image")
                return (
                  <div
                    key={item.id}
                    className="editor-video-layer"
                    style={style}
                    onClick={() => onSelect(item.id)}
                  >
                    <img
                      src={assetUrl(asset)}
                      alt={item.name}
                      style={{ objectFit: item.fit }}
                    />
                  </div>
                );
              return (
                <div
                  key={item.id}
                  className="editor-video-layer"
                  style={style}
                  onClick={() => onSelect(item.id)}
                >
                  <video
                    src={assetUrl(asset)}
                    playsInline
                    preload="auto"
                    style={{ objectFit: item.fit }}
                    ref={(el) => bindMedia(item.id, el)}
                    onLoadedMetadata={(event) =>
                      mediaReady(item.id, event.currentTarget)
                    }
                    onError={() =>
                      setPlayError(
                        `Cannot preview ${item.name}. Try importing an MP4 with H.264 video.`,
                      )
                    }
                  />
                </div>
              );
            })}
        </div>
      </div>
      {playError && (
        <div className="editor-preview-error" role="status">
          {playError}
        </div>
      )}
      <div className="editor-transport">
        <span className="editor-timecode">
          <input
            aria-label="Playhead"
            title="Playhead in seconds"
            type="number"
            min={0}
            max={duration}
            step={1 / project.fps}
            value={Math.round(time * 100) / 100}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isFinite(value)) onTime(clamp(value, 0, duration));
            }}
          />
          <span> / {formatTime(duration, true)}</span>
        </span>
        <div>
          <IconButton label="Go to beginning" onClick={() => onTime(0)}>
            <SkipBack size={16} />
          </IconButton>
          <IconButton
            label={playing ? "Pause preview" : "Play preview"}
            disabled={!duration}
            onClick={() => {
              setPlayError("");
              if (time >= duration) onTime(0);
              onPlaying(!playing);
            }}
            className="editor-play-button"
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </IconButton>
          <IconButton
            label="Go to end"
            onClick={() => {
              onPlaying(false);
              onTime(Math.max(0, duration - 1 / project.fps));
            }}
          >
            <SkipForward size={16} />
          </IconButton>
        </div>
        <IconButton
          label={monitorMuted ? "Unmute preview" : "Mute preview"}
          pressed={monitorMuted}
          onClick={() => setMonitorMuted(!monitorMuted)}
        >
          {monitorMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </IconButton>
      </div>
    </section>
  );
}
