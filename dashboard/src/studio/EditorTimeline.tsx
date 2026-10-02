import {
  Copy,
  Film,
  Magnet,
  Music2,
  Plus,
  Redo2,
  Scissors,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { IconButton } from "../ui";
import { clamp, durationOf, formatTime, trimItem } from "./editorModel";
import type { EditorMedia, EditorProject, TimelineItem } from "./editorModel";
import { findTransition, findTransitionOverlap } from "./transitions";
export function EditorTimeline({
  project,
  media,
  selected,
  time,
  onTime,
  onSelect,
  onChange,
  onSplit,
  onDelete,
  onDuplicate,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  project: EditorProject;
  media: EditorMedia[];
  selected: string;
  time: number;
  onTime: (n: number) => void;
  onSelect: (id: string) => void;
  onChange: (item: TimelineItem) => void;
  onSplit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [zoom, setZoom] = useState(32),
    [snap, setSnap] = useState(true),
    [extraTracks, setExtraTracks] = useState(0);
  const [draft, setDraft] = useState<TimelineItem | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    item: TimelineItem;
    mode: "move" | "left" | "right";
    x: number;
    y: number;
    latest: TimelineItem;
  } | null>(null);
  const duration = durationOf(project),
    extent = Math.min(610, Math.max(30, Math.ceil(duration / 10) * 10 + 5));
  const trackCount = Math.min(
    8,
    Math.max(3 + extraTracks, ...project.items.map((i) => i.track + 1)),
  );
  const visible = project.items.map((i) => (draft?.id === i.id ? draft : i)),
    width = extent * zoom;
  const snapTime = (n: number, item: TimelineItem, end = false) => {
    if (!snap) return n;
    const points = [
      0,
      time,
      ...project.items
        .filter((i) => i.id !== item.id)
        .flatMap((i) => [i.start, i.start + i.duration]),
    ];
    const near = points.find((p) => Math.abs(p - n) < 7 / zoom);
    if (near !== undefined) return near;
    if (end) {
      const p = points.find(
        (p) => Math.abs(p - (n + item.duration)) < 7 / zoom,
      );
      if (p !== undefined) return p - item.duration;
    }
    return Math.round(n * project.fps) / project.fps;
  };
  const begin = (
    e: PointerEvent<HTMLButtonElement>,
    item: TimelineItem,
    mode: "move" | "left" | "right",
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(item.id);
    // A clip moves between track parents during dragging. Capture on the stable
    // timeline so replacing that clip's DOM node cannot lose the release event.
    content.current?.setPointerCapture(e.pointerId);
    drag.current = { item, mode, x: e.clientX, y: e.clientY, latest: item };
    setDraft(item);
  };
  // The blend window for a clip, or null when it cannot transition: no
  // transition set, first on its track, or not enough overlap with the
  // previous clip.
  const blendFor = (item: TimelineItem) => {
    if (item.transition_in === "none") return null;
    const siblings = project.items
      .filter((other) => other.kind !== "audio")
      .sort((a, b) => a.track - b.track || a.start - b.start);
    const index = siblings.findIndex((other) => other.id === item.id);
    if (index <= 0) return null;
    return findTransitionOverlap(siblings[index - 1], item);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = (e.clientX - d.x) / zoom,
      item = d.item;
    let next = item;
    if (d.mode === "move")
      next = {
        ...item,
        start: clamp(
          snapTime(item.start + delta, item, true),
          0,
          600 - item.duration,
        ),
        track: clamp(
          item.track + Math.round((e.clientY - d.y) / 58),
          0,
          trackCount - 1,
        ),
      };
    else if (d.mode === "left") {
      const front = clamp(
        snapTime(item.start + delta, item) - item.start,
        -Math.min(item.source_in / item.speed, item.start),
        item.duration - 0.1,
      );
      next = trimItem(item, front, item.duration);
    } else {
      const asset = media.find((a) => a.id === item.asset_id),
        maxDuration = asset?.duration
          ? (asset.duration - item.source_in) / item.speed
          : 600;
      const newDuration = clamp(
        snapTime(item.start + item.duration + delta, item) - item.start,
        0.1,
        Math.min(maxDuration, 600 - item.start),
      );
      next =
        newDuration <= item.duration
          ? trimItem(item, 0, newDuration)
          : { ...item, duration: newDuration };
    }
    drag.current = { ...d, latest: next };
    setDraft(next);
  };
  const finish = () => {
    if (drag.current) onChange(drag.current.latest);
    drag.current = null;
    setDraft(null);
  };
  const tickStep = zoom < 24 ? 5 : zoom < 60 ? 2 : 1;
  return (
    <section className="editor-timeline" aria-label="Timeline">
      <div className="editor-timeline-toolbar">
        <div>
          <IconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 size={16} />
          </IconButton>
          <span className="editor-toolbar-rule" />
          <IconButton
            label="Split at playhead"
            disabled={!selected}
            onClick={onSplit}
          >
            <Scissors size={16} />
          </IconButton>
          <IconButton
            label="Duplicate selected clip"
            disabled={!selected}
            onClick={onDuplicate}
          >
            <Copy size={16} />
          </IconButton>
          <IconButton
            label="Delete selected clip"
            disabled={!selected}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </IconButton>
        </div>
        <span className="editor-timeline-hint">
          Drag to move · Drag edges to trim
        </span>
        <div>
          <IconButton
            label="Snap to clips and playhead"
            pressed={snap}
            onClick={() => setSnap(!snap)}
          >
            <Magnet size={16} />
          </IconButton>
          <span className="editor-toolbar-rule" />
          <IconButton
            label="Zoom timeline out"
            disabled={zoom <= 12}
            onClick={() => setZoom(Math.max(12, zoom - 12))}
          >
            <ZoomOut size={16} />
          </IconButton>
          <label className="editor-zoom">
            <input
              aria-label="Timeline zoom"
              type="range"
              min="12"
              max="120"
              step="4"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <IconButton
            label="Zoom timeline in"
            disabled={zoom >= 120}
            onClick={() => setZoom(Math.min(120, zoom + 12))}
          >
            <ZoomIn size={16} />
          </IconButton>
        </div>
      </div>
      <div className="editor-timeline-body">
        <div className="editor-track-labels">
          <div className="editor-ruler-label">Tracks</div>
          {Array.from({ length: trackCount }, (_, n) => (
            <div key={n}>
              <span>
                {n === 0 ? (
                  <Film size={15} />
                ) : n === 1 ? (
                  <Music2 size={15} />
                ) : (
                  <Type size={15} />
                )}
                {n === 0 ? "Video" : n === 1 ? "Audio" : `Layer ${n + 1}`}
              </span>
            </div>
          ))}
          <button
            className="editor-add-track"
            disabled={trackCount >= 8}
            onClick={() => setExtraTracks(extraTracks + 1)}
          >
            <Plus size={13} /> Track
          </button>
        </div>
        <div className="editor-timeline-scroll">
          <div
            ref={content}
            className="editor-timeline-content"
            style={{ width, minHeight: trackCount * 58 + 65 }}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={() => {
              drag.current = null;
              setDraft(null);
            }}
          >
            <div
              className="editor-ruler"
              role="slider"
              aria-label="Timeline playhead"
              aria-valuemin={0}
              aria-valuemax={Math.max(duration, 1)}
              aria-valuenow={time}
              aria-valuetext={formatTime(time, true)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  onTime(
                    clamp(
                      time + (e.key === "ArrowRight" ? 1 : -1) / project.fps,
                      0,
                      duration,
                    ),
                  );
                }
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onTime(
                  clamp(
                    (e.clientX - e.currentTarget.getBoundingClientRect().left) /
                      zoom,
                    0,
                    duration,
                  ),
                );
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  onTime(
                    clamp(
                      (e.clientX -
                        e.currentTarget.getBoundingClientRect().left) /
                        zoom,
                      0,
                      duration,
                    ),
                  );
              }}
            >
              {Array.from(
                { length: Math.ceil(extent / tickStep) + 1 },
                (_, i) => (
                  <span key={i} style={{ left: i * tickStep * zoom }}>
                    {formatTime(i * tickStep)}
                  </span>
                ),
              )}
            </div>
            {Array.from({ length: trackCount }, (_, track) => (
              <div
                className="editor-track"
                key={track}
                data-track={track}
                onDoubleClick={(e) =>
                  onTime(
                    clamp(
                      (e.clientX -
                        e.currentTarget.getBoundingClientRect().left) /
                        zoom,
                      0,
                      duration,
                    ),
                  )
                }
              >
                {visible
                  .filter((i) => i.track === track)
                  .map((item) => {
                    const asset = media.find((a) => a.id === item.asset_id),
                      wave = asset?.waveform || [];
                    return (
                      <div
                        data-testid="timeline-item"
                        data-kind={item.kind}
                        data-id={item.id}
                        className={`editor-timeline-item kind-${item.kind} ${selected === item.id ? "selected" : ""} ${item.muted ? "muted" : ""}`}
                        key={item.id}
                        style={{
                          left: item.start * zoom,
                          width: Math.max(8, item.duration * zoom),
                        }}
                      >
                        <button
                          className="editor-item-body"
                          aria-label={`Select ${item.name}`}
                          aria-pressed={selected === item.id}
                          title={`${item.name} · ${formatTime(item.duration, true)}`}
                          onClick={() => onSelect(item.id)}
                          onPointerDown={(e) => begin(e, item, "move")}
                        >
                          <span>
                            {item.kind === "video" ? (
                              <Film size={12} />
                            ) : item.kind === "audio" ? (
                              <Music2 size={12} />
                            ) : (
                              <Type size={12} />
                            )}
                            {item.name}
                          </span>
                          {item.kind !== "text" && wave.length > 0 && (
                            <svg
                              className="editor-waveform"
                              preserveAspectRatio="none"
                              viewBox={`0 0 ${wave.length} 20`}
                              aria-hidden="true"
                            >
                              {wave.map((amplitude, i) => (
                                <line
                                  key={i}
                                  x1={i}
                                  x2={i}
                                  y1={10 - clamp(amplitude, 0, 1) * 9}
                                  y2={10 + clamp(amplitude, 0, 1) * 9}
                                />
                              ))}
                            </svg>
                          )}
                          {item.keyframes.map((key, i) => (
                            <i
                              key={i}
                              className="editor-timeline-key"
                              style={{
                                left: `${(key.time / item.duration) * 100}%`,
                              }}
                            />
                          ))}
                        </button>
                        <button
                          className="editor-trim-handle left"
                          aria-label={`Trim start of ${item.name}`}
                          onPointerDown={(e) => begin(e, item, "left")}
                        />
                        <button
                          className="editor-trim-handle right"
                          aria-label={`Trim end of ${item.name}`}
                          onPointerDown={(e) => begin(e, item, "right")}
                        />
                        {/* The blend window, drawn where the two clips share
                            screen time. Its length is set in the inspector,
                            which clamps it to this window, so this is a
                            readout rather than a second drag target competing
                            with the trim handles. */}
                        {(() => {
                          const blend = blendFor(item);
                          if (!blend) return null;
                          return (
                            <span
                              className="editor-transition-handle"
                              aria-label={`Transition into ${item.name}`}
                              title={`${
                                findTransition(item.transition_in)?.label ??
                                "Transition"
                              } · ${formatTime(blend.duration, true)}`}
                              style={{
                                left: `${(blend.start / item.duration) * 100}%`,
                                width: `${(blend.duration / item.duration) * 100}%`,
                              }}
                            />
                          );
                        })()}
                      </div>
                    );
                  })}
              </div>
            ))}
            <div
              className="editor-playhead"
              style={{ left: time * zoom }}
              aria-hidden="true"
            >
              <span />
            </div>
          </div>
        </div>
      </div>
      <div className="editor-timeline-footer">
        <span>
          {project.items.length} clips <span className="editor-divider">/</span>{" "}
          {formatTime(duration, true)}
        </span>
        <span>Space play/pause · S split · Delete remove · Ctrl/⌘ Z undo</span>
      </div>
    </section>
  );
}
