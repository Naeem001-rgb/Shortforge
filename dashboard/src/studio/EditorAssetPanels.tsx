import { useState } from "react";
import { AudioLines, Check, Film, Image, Plus, Search } from "lucide-react";
import { assetUrl } from "../api";
import { defaultAdjustments, formatTime, newItem, uid } from "./editorModel";
import type {
  Adjustments,
  EditorMedia,
  EditorProject,
  TimelineItem,
  TransitionId,
} from "./editorModel";
import { transitions } from "./transitions";

export function MediaAssetGrid({
  media,
  onAdd,
}: {
  media: EditorMedia[];
  onAdd: (asset: EditorMedia) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = media.filter((asset) =>
    asset.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      {media.length > 0 && (
        <label className="editor-template-search">
          <Search size={15} />
          <input
            type="search"
            aria-label="Search project media"
            placeholder="Search your files"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      <div className="editor-media-list">
        {media.length > 0 && (
          <div className="editor-bin-list-heading">
            <h3>Project files</h3>
            <span>{media.length}</span>
          </div>
        )}
        {matches.map((asset) => (
          <button
            className="editor-media-asset"
            key={asset.id}
            onClick={() => onAdd(asset)}
            title={`Add ${asset.name} to timeline`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(
                "application/x-shortforge-media",
                asset.id,
              );
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <span className={`editor-asset-preview ${asset.media_type}`}>
              {asset.media_type === "audio" ? (
                <>
                  <AudioLines size={25} />
                  {asset.waveform?.length > 0 && (
                    <svg
                      className="editor-bin-waveform"
                      viewBox="0 0 160 40"
                      aria-hidden="true"
                    >
                      {asset.waveform.slice(0, 48).map((level, index) => (
                        <line
                          key={index}
                          x1={index * 3.4}
                          x2={index * 3.4}
                          y1={20 - Math.abs(level) * 18}
                          y2={20 + Math.abs(level) * 18}
                        />
                      ))}
                    </svg>
                  )}
                </>
              ) : asset.media_type === "image" ? (
                <img
                  crossOrigin="anonymous"
                  src={assetUrl(asset)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <video
                  crossOrigin="anonymous"
                  src={`${assetUrl(asset)}#t=0.1`}
                  preload="metadata"
                  muted
                  playsInline
                />
              )}
              <span className="editor-asset-type">
                {asset.media_type === "image" ? (
                  <Image size={12} />
                ) : asset.media_type === "audio" ? (
                  <AudioLines size={12} />
                ) : (
                  <Film size={12} />
                )}
              </span>
              <span className="editor-asset-duration">
                {formatTime(asset.duration)}
              </span>
              <span className="editor-asset-plus">
                <Plus size={15} />
              </span>
            </span>
            <strong>{asset.name}</strong>
            <span className="editor-asset-add">
              {asset.media_type === "audio"
                ? "Audio"
                : `${asset.width || "—"} × ${asset.height || "—"}`}
            </span>
          </button>
        ))}
      </div>
      {media.length > 0 && !matches.length && (
        <p className="editor-panel-note">No files match “{query}”.</p>
      )}
    </>
  );
}

type FilterPreset = {
  id: string;
  name: string;
  color: string;
  adjustments: Partial<Adjustments>;
};
export const filterPresets: FilterPreset[] = [
  { id: "original", name: "Original", color: "#8f9b8d", adjustments: {} },
  {
    id: "daylight",
    name: "Daylight",
    color: "#bfcea0",
    adjustments: { brightness: 0.04, contrast: 1.08, saturation: 1.12 },
  },
  {
    id: "warm",
    name: "Golden",
    color: "#dba96a",
    adjustments: { temperature: 0.22, saturation: 1.14, contrast: 1.04 },
  },
  {
    id: "cool",
    name: "Alpine",
    color: "#8ab6c7",
    adjustments: { temperature: -0.2, saturation: 0.88, contrast: 1.08 },
  },
  {
    id: "cinema",
    name: "Cinema",
    color: "#79968e",
    adjustments: { contrast: 1.22, saturation: 0.78, vignette: 0.2 },
  },
  {
    id: "soft",
    name: "Soft light",
    color: "#d1b7ad",
    adjustments: { brightness: 0.04, contrast: 0.9, saturation: 0.86 },
  },
  {
    id: "mono",
    name: "Monochrome",
    color: "#aaaaaa",
    adjustments: { saturation: 0, contrast: 1.12 },
  },
  {
    id: "ink",
    name: "Silver",
    color: "#80858c",
    adjustments: { saturation: 0, contrast: 1.4, brightness: -0.03 },
  },
  {
    id: "vivid",
    name: "Vivid",
    color: "#aac77c",
    adjustments: { saturation: 1.45, contrast: 1.14 },
  },
  {
    id: "faded",
    name: "Faded",
    color: "#c2ba99",
    adjustments: { contrast: 0.78, saturation: 0.7, brightness: 0.04 },
  },
  {
    id: "dusk",
    name: "Dusk",
    color: "#b993ad",
    adjustments: {
      temperature: -0.1,
      tint: 0.18,
      contrast: 1.08,
      saturation: 0.8,
    },
  },
  {
    id: "ember",
    name: "Ember",
    color: "#b68b6b",
    adjustments: {
      temperature: 0.3,
      contrast: 1.2,
      saturation: 0.88,
      vignette: 0.25,
    },
  },
  {
    id: "crisp",
    name: "Crisp",
    color: "#95bab8",
    adjustments: { contrast: 1.18, saturation: 1.06, sharpen: 0.3 },
  },
];
export function FilterPresets({
  item,
  asset,
  onChange,
}: {
  item?: TimelineItem;
  asset?: EditorMedia;
  onChange: (item: TimelineItem) => void;
}) {
  const available = item?.kind === "video";
  return (
    <section className="editor-preset-browser" aria-label="Filter presets">
      <p className="editor-panel-note">
        {available
          ? "Give this clip a look. Fine-tune it in Adjustments."
          : "Select a video or image clip to apply a filter."}
      </p>
      <div className="editor-filter-grid">
        {filterPresets.map((preset) => (
          <button
            key={preset.id}
            className="editor-filter-card"
            disabled={!available}
            aria-label={`Apply ${preset.name} filter`}
            aria-pressed={
              available &&
              Object.entries(defaultAdjustments).every(
                ([key, value]) =>
                  (item?.adjustments?.[key as keyof Adjustments] ?? value) ===
                  (preset.adjustments[key as keyof Adjustments] ?? value),
              )
            }
            onClick={() => {
              if (item) {
                onChange({
                  ...item,
                  adjustments: { ...defaultAdjustments, ...preset.adjustments },
                });
              }
            }}
          >
            <span
              className="editor-filter-art"
              style={{
                backgroundColor: preset.color,
                filter: `brightness(${1 + (preset.adjustments.brightness || 0)}) contrast(${preset.adjustments.contrast ?? 1}) saturate(${preset.adjustments.saturation ?? 1})`,
              }}
            >
              {asset && asset.media_type !== "audio" ? (
                asset.media_type === "image" ? (
                  <img crossOrigin="anonymous" src={assetUrl(asset)} alt="" />
                ) : (
                  <video
                    crossOrigin="anonymous"
                    src={`${assetUrl(asset)}#t=0.1`}
                    muted
                    preload="metadata"
                  />
                )
              ) : (
                <span className="editor-look-composition">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </span>
            <span>
              {preset.name}
              {available &&
                Object.entries(defaultAdjustments).every(
                  ([key, value]) =>
                    (item?.adjustments?.[key as keyof Adjustments] ?? value) ===
                    (preset.adjustments[key as keyof Adjustments] ?? value),
                ) && <Check size={12} />}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function TransitionPresets({
  item,
  onApply,
}: {
  item?: TimelineItem;
  onApply: (id: TransitionId, duration: number, all: boolean) => void;
}) {
  const [duration, setDuration] = useState(0.6);
  const [chosen, setChosen] = useState<TransitionId>("crossfade");
  return (
    <section className="editor-preset-browser" aria-label="Transitions">
      <p className="editor-panel-note">
        Choose the second of two clips. Applying a transition creates the
        overlap.
      </p>
      <label className="editor-field editor-transition-duration">
        <span>
          Duration <strong>{duration.toFixed(1)}s</strong>
        </span>
        <input
          aria-label="Transition duration"
          type="range"
          min="0.1"
          max="2"
          step="0.1"
          value={duration}
          onChange={(event) => setDuration(Number(event.target.value))}
        />
      </label>
      <div className="editor-transition-grid">
        {transitions.map((preset, index) => (
          <button
            key={preset.id}
            className="editor-transition-card"
            disabled={!item || item.kind !== "video"}
            aria-label={`Apply ${preset.label} transition`}
            aria-pressed={item?.transition_in === preset.id}
            onClick={() => {
              setChosen(preset.id as TransitionId);
              onApply(preset.id as TransitionId, duration, false);
            }}
          >
            <span className="editor-transition-art" data-transition={preset.id}>
              <span
                style={{ transform: `rotate(${index % 3 === 0 ? -10 : 0}deg)` }}
              />
              <span />
              <i />
            </span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
      <button
        className="button secondary full"
        onClick={() => onApply(chosen, duration, true)}
      >
        Apply to all cuts
      </button>
      {item?.transition_in !== "none" && item?.kind === "video" && (
        <button
          className="editor-text-action"
          onClick={() => onApply("none", 0, false)}
        >
          Remove selected transition
        </button>
      )}
    </section>
  );
}

export type StickerPreset = {
  id: string;
  label: string;
  text: string;
  color: string;
  background: string;
  rotation: number;
  shape?: "circle" | "arrow" | "frame" | "spark";
};
export const stickerPresets: StickerPreset[] = [
  {
    id: "new",
    label: "Fresh take",
    text: "NEW",
    color: "#171920",
    background: "#d1ff71",
    rotation: -8,
  },
  {
    id: "save",
    label: "Save this",
    text: "SAVE THIS",
    color: "#ffffff",
    background: "#7051eb",
    rotation: 0,
  },
  {
    id: "watch",
    label: "Watch closely",
    text: "WATCH THIS",
    color: "#16181d",
    background: "#ffb785",
    rotation: 5,
  },
  {
    id: "part",
    label: "Chapter",
    text: "PART 01",
    color: "#ffffff",
    background: "#292d37",
    rotation: 0,
  },
  {
    id: "circle",
    label: "Circle",
    text: "",
    color: "#d1ff71",
    background: "transparent",
    rotation: 0,
    shape: "circle",
  },
  {
    id: "arrow",
    label: "Arrow",
    text: "",
    color: "#ffffff",
    background: "transparent",
    rotation: -12,
    shape: "arrow",
  },
  {
    id: "frame",
    label: "Focus frame",
    text: "",
    color: "#c2acff",
    background: "transparent",
    rotation: 0,
    shape: "frame",
  },
  {
    id: "spark",
    label: "Spark",
    text: "",
    color: "#ffc688",
    background: "transparent",
    rotation: 0,
    shape: "spark",
  },
];
export function StickerArt({ preset }: { preset: StickerPreset }) {
  return preset.shape ? (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      stroke={preset.color}
      strokeWidth="7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {preset.shape === "circle" ? (
        <circle cx="50" cy="50" r="32" />
      ) : preset.shape === "arrow" ? (
        <path d="M17 78 77 24M38 24h40v40" />
      ) : preset.shape === "frame" ? (
        <path d="M12 36V12h24m28 0h24v24m0 28v24H64m-28 0H12V64" />
      ) : (
        <path
          fill={preset.color}
          strokeWidth="0"
          d="m50 4 11 35 35 11-35 11-11 35-11-35L4 50l35-11Z"
        />
      )}
    </svg>
  ) : (
    <span
      style={{
        color: preset.color,
        background: preset.background,
        transform: `rotate(${preset.rotation}deg)`,
      }}
    >
      {preset.text}
    </span>
  );
}
export function StickerPresets({
  onAdd,
  busy,
}: {
  onAdd: (preset: StickerPreset) => void;
  busy: boolean;
}) {
  return (
    <section className="editor-preset-browser" aria-label="Stickers">
      <p className="editor-panel-note">
        Original callouts and shapes. Add one, then position it on the canvas.
      </p>
      <div className="editor-sticker-grid">
        {stickerPresets.map((preset) => (
          <button
            key={preset.id}
            className="editor-sticker-card"
            onClick={() => onAdd(preset)}
            disabled={busy}
            aria-label={`Add ${preset.label} sticker`}
          >
            <span className="editor-sticker-art">
              <StickerArt preset={preset} />
            </span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  title: string;
  shots: number[];
  color: string;
  style: "bold" | "minimal" | "label";
  motion: TimelineItem["animation_in"];
};
export const projectTemplates: ProjectTemplate[] = [
  {
    id: "quick-story",
    name: "Quick story",
    description: "A hook, a moment, a close",
    title: "Here's the story",
    shots: [3, 6, 6],
    color: "#c2acff",
    style: "bold",
    motion: "pop",
  },
  {
    id: "three-tips",
    name: "Three things",
    description: "One idea, three clear points",
    title: "Three things to know",
    shots: [3, 7, 7, 7],
    color: "#d1ff71",
    style: "label",
    motion: "slide-up",
  },
  {
    id: "day-in-life",
    name: "A day in motion",
    description: "Six moments in 30 seconds",
    title: "A day in my life",
    shots: [3, 5, 6, 6, 6, 4],
    color: "#ffbd8e",
    style: "minimal",
    motion: "fade",
  },
  {
    id: "product",
    name: "In the details",
    description: "Close cuts for a closer look",
    title: "Meet your next favorite",
    shots: [4, 4, 4, 5, 3],
    color: "#b6d9ff",
    style: "minimal",
    motion: "zoom-in",
  },
  {
    id: "before-after",
    name: "The transformation",
    description: "Set it up. Reveal the change.",
    title: "Wait for the change",
    shots: [4, 8, 8],
    color: "#ffd47a",
    style: "bold",
    motion: "punch",
  },
  {
    id: "mini-guide",
    name: "Make it simple",
    description: "A calm, step-by-step guide",
    title: "Let's make this simple",
    shots: [4, 8, 8, 6, 4],
    color: "#bde8d1",
    style: "label",
    motion: "slide-up",
  },
  {
    id: "travel",
    name: "Somewhere new",
    description: "Open wide. Let the view breathe.",
    title: "Somewhere worth going",
    shots: [5, 7, 7, 7, 4],
    color: "#b5d8e7",
    style: "minimal",
    motion: "fade",
  },
  {
    id: "opinion",
    name: "A different take",
    description: "One thought with room to land",
    title: "Let's talk about this",
    shots: [4, 12, 10, 4],
    color: "#f4b6c9",
    style: "bold",
    motion: "rise-fade",
  },
  {
    id: "countdown",
    name: "The short list",
    description: "Five favorites, one fast edit",
    title: "The short list",
    shots: [2, 4, 4, 4, 4, 4],
    color: "#d1ff71",
    style: "label",
    motion: "pop",
  },
  {
    id: "quiet",
    name: "Take a moment",
    description: "Slow cuts and understated type",
    title: "A little room to breathe",
    shots: [6, 8, 8, 8],
    color: "#d3c9b7",
    style: "minimal",
    motion: "fade",
  },
];
export function ProjectTemplates({
  media,
  onApply,
}: {
  media: EditorMedia[];
  onApply: (preset: ProjectTemplate) => void;
}) {
  const footage = media.find((asset) => asset.media_type !== "audio");
  return (
    <section className="editor-preset-browser" aria-label="Project templates">
      <p className="editor-panel-note">
        {footage
          ? "Rearrange your footage into an editable short. One undo restores your edit."
          : "Import footage first, then give your edit a starting structure."}
      </p>
      <div className="editor-project-template-grid">
        {projectTemplates.map((preset) => (
          <button
            key={preset.id}
            className="editor-project-template"
            disabled={!footage}
            onClick={() => onApply(preset)}
            aria-label={`Apply ${preset.name} project template`}
          >
            <span
              className={`editor-project-template-art ${preset.style}`}
              style={{ color: preset.color }}
            >
              {footage &&
                (footage.media_type === "image" ? (
                  <img crossOrigin="anonymous" src={assetUrl(footage)} alt="" />
                ) : (
                  <video
                    crossOrigin="anonymous"
                    src={`${assetUrl(footage)}#t=0.1`}
                    muted
                    preload="metadata"
                  />
                ))}
              <span>{preset.title}</span>
              <small>
                {preset.shots.reduce((sum, seconds) => sum + seconds, 0)}s ·{" "}
                {preset.shots.length} shots
              </small>
            </span>
            <strong>{preset.name}</strong>
            <span>{preset.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function buildProjectTemplate(
  project: EditorProject,
  media: EditorMedia[],
  preset: ProjectTemplate,
): EditorProject {
  const sourceItems = project.items.filter(
    (item) =>
      item.kind === "video" &&
      media.some((asset) => asset.id === item.asset_id),
  );
  const footage = media.filter((asset) => asset.media_type !== "audio");
  if (!footage.length) return project;
  let start = 0;
  const items: TimelineItem[] = [];
  preset.shots.forEach((length, index) => {
    const existing = sourceItems.length
      ? sourceItems[index % sourceItems.length]
      : undefined;
    const asset =
      media.find((candidate) => candidate.id === existing?.asset_id) ||
      footage[index % footage.length];
    const sourceIn = existing?.source_in || 0;
    const duration =
      asset.media_type === "image"
        ? length
        : Math.min(
            length,
            Math.max(0.1, (asset.duration - sourceIn) / (existing?.speed || 1)),
          );
    const video = existing
      ? {
          ...structuredClone(existing),
          id: uid(),
          start,
          duration,
          track: 0,
          transition_in: "none" as const,
          keyframes: [],
        }
      : { ...newItem("video", asset, start, 0), duration };
    items.push(video);
    if (index === 0 || (preset.style === "label" && index > 0)) {
      const label = newItem("text", undefined, start, 2);
      label.text =
        index === 0
          ? preset.title
          : `${String(index).padStart(2, "0")}  Your next point`;
      label.name = label.text;
      label.duration = Math.min(duration, index === 0 ? 3.5 : 2.5);
      label.color = preset.style === "label" ? "#171920" : preset.color;
      label.text_background =
        preset.style === "label" ? preset.color : "transparent";
      label.font_size =
        preset.style === "bold" ? 92 : preset.style === "minimal" ? 58 : 62;
      label.transform.y = preset.style === "minimal" ? 28 : 18;
      label.text_style = {
        bold: preset.style !== "minimal",
        italic: false,
        uppercase: preset.style === "bold",
        align: "center",
        stroke: preset.style === "bold" ? 3 : 0,
        stroke_color: "#101115",
        shadow: 0,
        letter_spacing: preset.style === "minimal" ? 2 : 0,
        reveal: "none",
        highlight: preset.color,
      };
      label.animation_in = preset.motion;
      items.push(label);
    }
    start += duration;
  });
  return {
    ...project,
    width: 1080,
    height: 1920,
    items: [
      ...items,
      ...project.items
        .filter((item) => item.kind === "audio")
        .map((item) => ({ ...item, track: 1 })),
    ],
  };
}
