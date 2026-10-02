import { useState } from "react";
import { Check, Search } from "lucide-react";
import { animations } from "./editorModel";
import type { Animation, TimelineItem } from "./editorModel";
import {
  captionWordAppearance,
  captionWords,
  CAPTION_CSS,
  presetCategories,
  textAppearance,
  textPresets,
} from "./textPresets";
import type { TextPreset } from "./textPresets";

/* The word-level caption renderer. EditorPreview and the template cards both
 * go through this so what you see is what captions.py writes into the ASS. */
if (
  typeof document !== "undefined" &&
  !document.getElementById("sf-caption-css")
) {
  const tag = document.createElement("style");
  tag.id = "sf-caption-css";
  tag.textContent = CAPTION_CSS;
  document.head.appendChild(tag);
}

export function CaptionLine({
  item,
  scale,
  localTime = 0,
  demo = false,
}: {
  item: TimelineItem;
  scale: number;
  localTime?: number;
  /** Loop the bounce so a still template card shows the motion. */
  demo?: boolean;
}) {
  const caption = captionWords(item, localTime),
    shown =
      caption.style.reveal === "typewriter"
        ? caption.caption.slice(0, caption.current + 1)
        : caption.caption,
    demoIndex = demo
      ? caption.keys.size
        ? [...caption.keys][0]
        : caption.caption.length
          ? 0
          : -1
      : -1;
  return (
    <span className="caption-line" style={textAppearance(item, scale)}>
      {shown.map((word) => (
        <span
          key={word.index}
          style={captionWordAppearance(
            demo && word.index === demoIndex
              ? { ...word, popping: true }
              : word,
            caption.style,
            scale,
            demo,
          )}
        >
          {word.text}
        </span>
      ))}
    </span>
  );
}

export function TextTemplates({
  onApply,
  hasCaptions,
  selectedText,
}: {
  onApply: (preset: TextPreset, all: boolean) => void;
  hasCaptions: boolean;
  selectedText: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [chosen, setChosen] = useState(textPresets[0]);
  const matches = textPresets.filter(
    (p) =>
      (category === "All" || p.category === category) &&
      p.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section
      className="editor-template-section"
      aria-label="Subtitle templates"
    >
      <h3>
        Subtitle templates <span>{textPresets.length}</span>
      </h3>
      <label className="editor-template-search">
        <Search size={13} />
        <input
          type="search"
          aria-label="Search subtitle templates"
          placeholder="Search styles"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="editor-template-filters" aria-label="Template categories">
        {presetCategories.map((c) => (
          <button
            key={c}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <p>
        {selectedText
          ? "Choose a style for the selected caption."
          : "Choose a style to add text at the playhead."}
      </p>
      <div className="editor-template-grid">
        {matches.map((preset) => {
          const sample = {
            text: preset.sample,
            font_size: preset.size,
            color: preset.color,
            text_background: preset.background || "transparent",
            text_style: preset.style,
            duration: 3,
          } as unknown as TimelineItem;
          return (
            <button
              key={preset.id}
              className="editor-template-card"
              aria-label={`Apply ${preset.name} template`}
              aria-pressed={chosen.id === preset.id}
              onClick={() => {
                setChosen(preset);
                onApply(preset, false);
              }}
            >
              <span className="editor-template-art">
                <CaptionLine item={sample} scale={0.2} demo />
              </span>
              <span className="editor-template-caption">
                {preset.name}
                {preset.previewOnly?.length ? (
                  <small
                    title={`Preview only: ${preset.previewOnly.join(", ")}`}
                    style={{
                      display: "block",
                      fontSize: 9,
                      opacity: 0.6,
                      fontWeight: 400,
                    }}
                  >
                    preview only: {preset.previewOnly.join(", ")}
                  </small>
                ) : null}
                {chosen.id === preset.id && <Check size={12} />}
              </span>
            </button>
          );
        })}
      </div>
      {!matches.length && (
        <p>No styles match. Try a different name or category.</p>
      )}
      <button
        className="button secondary small full"
        disabled={!hasCaptions}
        onClick={() => onApply(chosen, true)}
      >
        Apply {chosen.name} to all captions
      </button>
    </section>
  );
}

export function AnimationTemplates({
  item,
  onApply,
}: {
  item?: TimelineItem;
  onApply: (side: "animation_in" | "animation_out", value: Animation) => void;
}) {
  const [side, setSide] = useState<"animation_in" | "animation_out">(
    "animation_in",
  );
  const available = item && item.kind !== "audio";
  return (
    <section className="editor-template-section" aria-label="Animation presets">
      <h3>Animations</h3>
      <div className="editor-template-filters">
        <button
          aria-pressed={side === "animation_in"}
          onClick={() => setSide("animation_in")}
        >
          In
        </button>
        <button
          aria-pressed={side === "animation_out"}
          onClick={() => setSide("animation_out")}
        >
          Out
        </button>
      </div>
      <p>
        {available
          ? "Apply motion to the selected clip. Adjust timing in the inspector."
          : "Select a video or text clip to add animation."}
      </p>
      <div className="editor-animation-grid">
        {animations.map((preset) => (
          <button
            key={preset.value}
            className="editor-animation-card"
            disabled={!available}
            aria-label={`Apply ${preset.label} ${side === "animation_in" ? "in" : "out"} animation`}
            aria-pressed={available && item[side] === preset.value}
            onClick={() => onApply(side, preset.value)}
          >
            <span
              className="editor-animation-art"
              data-animation={preset.value}
            >
              <span>Aa</span>
            </span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
      <p>
        Use keyframes for custom position, scale, rotation, opacity and volume
        over time.
      </p>
    </section>
  );
}
