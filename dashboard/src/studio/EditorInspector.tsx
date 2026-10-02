import {
  Diamond,
  Film,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { IconButton } from "../ui";
import { animations, clamp, formatTime, valueAt } from "./editorModel";
import type { TransitionId } from "./editorModel";
import {
  findTransitionOverlap,
  maxTransitionDuration,
  minTransitionOverlap,
  transitions,
} from "./transitions";
import type {
  EditorMedia,
  EditorProject,
  Keyframe,
  TimelineItem,
} from "./editorModel";
import { styleOf, withTextStyle } from "./textPresets";
import type { ResolvedTextStyle } from "./textPresets";
import { CaptionLine } from "./EditorTemplates";

function NumberField({
  label,
  value,
  min,
  max,
  step = 0.1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <div className="editor-number">
        <input
          type="number"
          aria-label={label}
          value={Math.round(value * 1000) / 1000}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = e.currentTarget.valueAsNumber;
            if (Number.isFinite(n)) onChange(clamp(n, min, max));
          }}
        />
        {suffix && <span>{suffix}</span>}
      </div>
    </label>
  );
}
function GroupLabel({ children }: { children: string }) {
  return (
    <p
      style={{
        margin: "14px 0 6px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        opacity: 0.65,
      }}
    >
      {children}
    </p>
  );
}
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
export function EditorInspector({
  project,
  item,
  asset,
  time,
  onChange,
  onProject,
  onTime,
}: {
  project: EditorProject;
  item?: TimelineItem;
  asset?: EditorMedia;
  time: number;
  onChange: (item: TimelineItem) => void;
  onProject: (patch: Partial<EditorProject>) => void;
  onTime: (n: number) => void;
}) {
  if (!item)
    return (
      <aside className="editor-inspector" aria-label="Inspector">
        <div className="editor-panel-heading">
          <h2>Project</h2>
          <SlidersHorizontal size={16} />
        </div>
        <div className="editor-inspector-scroll">
          <section className="editor-inspector-section">
            <h3>Canvas</h3>
            <label className="editor-field">
              <span>Aspect ratio</span>
              <select
                aria-label="Canvas aspect ratio"
                value={`${project.width}:${project.height}`}
                onChange={(e) => {
                  const [width, height] = e.target.value.split(":").map(Number);
                  onProject({ width, height });
                }}
              >
                <option value="1080:1920">9:16 · Portrait</option>
                <option value="1920:1080">16:9 · Landscape</option>
                <option value="1080:1080">1:1 · Square</option>
              </select>
            </label>
            <label className="editor-field">
              <span>Background</span>
              <input
                aria-label="Canvas background"
                type="color"
                value={project.background}
                onChange={(e) => onProject({ background: e.target.value })}
              />
            </label>
            <p>30 fps · MP4 export</p>
          </section>
          <div className="editor-inspector-empty">
            <Film size={26} />
            <h3>Select a clip</h3>
            <p>Adjust video, audio, text, animations and keyframes here.</p>
          </div>
        </div>
      </aside>
    );
  const local = clamp(time - item.start, 0, item.duration),
    value = valueAt(item, local);
  const textStyle = styleOf(item);
  const updateTextStyle = (patch: Partial<ResolvedTextStyle>) =>
    onChange(withTextStyle(item, patch));
  const activeKey = item.keyframes.find((k) => Math.abs(k.time - local) < 0.02);
  // The blend window with the previous clip on the same track. Null means a
  // transition cannot play here, so the whole control is hidden.
  const overlap = (() => {
    const siblings = project.items
      .filter((other) => other.kind !== "audio")
      .sort((a, b) => a.track - b.track || a.start - b.start);
    const index = siblings.findIndex((other) => other.id === item.id);
    if (index <= 0) return null;
    return findTransitionOverlap(siblings[index - 1], item);
  })();
  const update = (patch: Partial<TimelineItem>) =>
    onChange({ ...item, ...patch });
  const writeValue = (
    property: "x" | "y" | "scale" | "rotation" | "opacity" | "volume",
    n: number,
  ) => {
    const patch =
      property === "volume"
        ? { volume: n }
        : { transform: { ...item.transform, [property]: n } };
    if (!item.keyframes.length) {
      update(patch);
      return;
    }
    const key: Keyframe = {
      ...value,
      time: local,
      easing: activeKey?.easing || "linear",
      [property]: n,
    };
    update({
      ...patch,
      keyframes: [
        ...item.keyframes.filter((k) => Math.abs(k.time - local) >= 0.02),
        key,
      ].sort((a, b) => a.time - b.time),
    });
  };
  const addKey = () =>
    update({
      keyframes: [
        ...item.keyframes.filter((k) => Math.abs(k.time - local) >= 0.02),
        { ...value, time: local, easing: activeKey?.easing || "linear" },
      ].sort((a, b) => a.time - b.time),
    });
  return (
    <aside className="editor-inspector" aria-label="Inspector">
      <div className="editor-panel-heading">
        <h2>
          {item.kind === "video"
            ? "Video"
            : item.kind === "audio"
              ? "Audio"
              : "Text"}
        </h2>
        <span className="editor-selected-name" title={item.name}>
          {item.name}
        </span>
      </div>
      <div className="editor-inspector-scroll">
        <section className="editor-inspector-section">
          <h3>Timing</h3>
          <div className="editor-field-pair">
            <NumberField
              label="Start"
              value={item.start}
              min={0}
              max={600 - item.duration}
              suffix="s"
              onChange={(start) => update({ start })}
            />
            <NumberField
              label="Duration"
              value={item.duration}
              min={0.1}
              max={Math.min(
                600 - item.start,
                asset?.duration
                  ? (asset.duration - item.source_in) / item.speed
                  : 600,
              )}
              suffix="s"
              onChange={(duration) =>
                update({
                  duration,
                  keyframes: item.keyframes.filter((k) => k.time <= duration),
                })
              }
            />
          </div>
          {item.kind !== "text" && (
            <div className="editor-field-pair">
              <NumberField
                label="Source in"
                value={item.source_in}
                min={0}
                max={Math.max(
                  0,
                  (asset?.duration || 600) - item.duration * item.speed,
                )}
                suffix="s"
                onChange={(source_in) => update({ source_in })}
              />
              <NumberField
                label="Speed"
                value={item.speed}
                min={0.25}
                max={4}
                step={0.25}
                suffix="×"
                onChange={(speed) => {
                  const ratio = item.speed / speed;
                  update({
                    speed,
                    duration: Math.min(600 - item.start, item.duration * ratio),
                    keyframes: item.keyframes
                      .map((k) => ({ ...k, time: k.time * ratio }))
                      .filter(
                        (k) =>
                          k.time <=
                          Math.min(600 - item.start, item.duration * ratio),
                      ),
                  });
                }}
              />
            </div>
          )}
          <label className="editor-field">
            <span>Track</span>
            <select
              aria-label="Track"
              value={item.track}
              onChange={(e) => update({ track: Number(e.target.value) })}
            >
              {Array.from({ length: 8 }, (_, n) => (
                <option value={n} key={n}>
                  {n + 1}
                  {n === 0 ? " · Video" : n === 1 ? " · Audio" : " · Layer"}
                </option>
              ))}
            </select>
          </label>
        </section>
        {item.kind !== "audio" && (
          <section className="editor-inspector-section">
            <h3>Transform</h3>
            <div className="editor-field-pair">
              <NumberField
                label="Position X"
                value={value.x}
                min={-200}
                max={200}
                step={1}
                suffix="%"
                onChange={(n) => writeValue("x", n)}
              />
              <NumberField
                label="Position Y"
                value={value.y}
                min={-200}
                max={200}
                step={1}
                suffix="%"
                onChange={(n) => writeValue("y", n)}
              />
              <NumberField
                label="Scale"
                value={value.scale * 100}
                min={10}
                max={400}
                step={1}
                suffix="%"
                onChange={(n) => writeValue("scale", n / 100)}
              />
              <NumberField
                label="Rotation"
                value={value.rotation}
                min={-360}
                max={360}
                step={1}
                suffix="°"
                onChange={(n) => writeValue("rotation", n)}
              />
              <NumberField
                label="Opacity"
                value={value.opacity * 100}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(n) => writeValue("opacity", n / 100)}
              />
              {item.kind === "video" && (
                <label className="editor-field">
                  <span>Fit</span>
                  <select
                    aria-label="Video fit"
                    value={item.fit}
                    onChange={(e) =>
                      update({ fit: e.target.value as "contain" | "cover" })
                    }
                  >
                    <option value="contain">Fit</option>
                    <option value="cover">Fill</option>
                  </select>
                </label>
              )}
            </div>
          </section>
        )}
        {item.kind === "text" && (
          <section className="editor-inspector-section">
            <h3>Text</h3>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: 64,
                padding: "10px 8px",
                marginBottom: "10px",
                borderRadius: "8px",
                overflow: "hidden",
                background: project.background,
              }}
            >
              <CaptionLine item={item} scale={0.3} localTime={local} />
            </div>
            <label className="editor-field">
              <span>Text content</span>
              <textarea
                aria-label="Text content"
                rows={3}
                value={item.text}
                onChange={(e) =>
                  update({
                    text: e.target.value,
                    name: e.target.value.slice(0, 40) || "Text",
                  })
                }
              />
            </label>
            <NumberField
              label="Font size"
              value={item.font_size}
              min={12}
              max={240}
              step={1}
              suffix="px"
              onChange={(font_size) =>
                update({ font_size: Math.round(font_size) })
              }
            />
            <div className="editor-text-format" aria-label="Text formatting">
              <button
                aria-label="Bold text"
                aria-pressed={textStyle.bold}
                onClick={() => updateTextStyle({ bold: !textStyle.bold })}
              >
                <strong>B</strong>
              </button>
              <button
                aria-label="Italic text"
                aria-pressed={textStyle.italic}
                onClick={() => updateTextStyle({ italic: !textStyle.italic })}
              >
                <em>I</em>
              </button>
              <button
                aria-label="Uppercase text"
                aria-pressed={textStyle.uppercase}
                onClick={() =>
                  updateTextStyle({ uppercase: !textStyle.uppercase })
                }
              >
                AA
              </button>
              <select
                aria-label="Text alignment"
                value={textStyle.align}
                onChange={(e) =>
                  updateTextStyle({
                    align: e.target.value as typeof textStyle.align,
                  })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="editor-field-pair">
              <label className="editor-field">
                <span>Text color</span>
                <input
                  aria-label="Text color"
                  type="color"
                  value={item.color}
                  onChange={(e) => update({ color: e.target.value })}
                />
              </label>
              <label className="editor-field">
                <span>Text background</span>
                <input
                  aria-label="Text background"
                  type="color"
                  value={
                    item.text_background === "transparent"
                      ? "#000000"
                      : item.text_background
                  }
                  onChange={(e) => update({ text_background: e.target.value })}
                />
              </label>
            </div>
            <label className="editor-checkbox">
              <input
                type="checkbox"
                checked={item.text_background === "transparent"}
                onChange={(e) =>
                  update({
                    text_background: e.target.checked
                      ? "transparent"
                      : "#000000",
                  })
                }
              />
              Transparent background
            </label>
            <div className="editor-field-pair">
              <NumberField
                label="Text outline"
                value={textStyle.stroke}
                min={0}
                max={12}
                step={1}
                suffix="px"
                onChange={(stroke) => updateTextStyle({ stroke })}
              />
              <label className="editor-field">
                <span>Outline color</span>
                <input
                  type="color"
                  aria-label="Outline color"
                  value={textStyle.stroke_color}
                  onChange={(e) =>
                    updateTextStyle({ stroke_color: e.target.value })
                  }
                />
              </label>
              <NumberField
                label="Text shadow"
                value={textStyle.shadow}
                min={0}
                max={12}
                step={1}
                suffix="px"
                onChange={(shadow) => updateTextStyle({ shadow })}
              />
              <NumberField
                label="Letter spacing"
                value={textStyle.letter_spacing}
                min={-2}
                max={20}
                step={1}
                suffix="px"
                onChange={(letter_spacing) =>
                  updateTextStyle({ letter_spacing })
                }
              />
            </div>
            <label className="editor-field">
              <span>Word animation</span>
              <select
                aria-label="Word animation"
                value={textStyle.reveal}
                onChange={(e) =>
                  updateTextStyle({
                    reveal: e.target.value as typeof textStyle.reveal,
                  })
                }
              >
                <option value="none">None</option>
                <option value="typewriter">Typewriter</option>
                <option value="karaoke">Karaoke highlight</option>
              </select>
            </label>
            {textStyle.reveal === "karaoke" && (
              <label className="editor-field">
                <span>Highlight color</span>
                <input
                  type="color"
                  aria-label="Highlight color"
                  value={textStyle.highlight}
                  onChange={(e) =>
                    updateTextStyle({ highlight: e.target.value })
                  }
                />
              </label>
            )}
            {textStyle.reveal !== "none" && (
              <p>
                Words are spaced across this caption’s duration. Adjust the
                caption timing to match your recording.
              </p>
            )}
            <GroupLabel>Casing &amp; layout</GroupLabel>
            <SelectField
              label="Letter case"
              value={textStyle.case_style}
              options={[
                ["none", "As typed"],
                ["upper", "UPPERCASE"],
                ["lower", "lowercase"],
                ["title", "Title Case"],
                ["sentence", "Sentence case"],
              ]}
              onChange={(case_style) =>
                updateTextStyle({
                  case_style: case_style as ResolvedTextStyle["case_style"],
                })
              }
            />
            <div className="editor-field-pair">
              <NumberField
                label="Line height"
                value={textStyle.line_height}
                min={0.6}
                max={3}
                step={0.05}
                suffix="x"
                onChange={(line_height) => updateTextStyle({ line_height })}
              />
              <NumberField
                label="Box padding"
                value={textStyle.box_padding}
                min={0}
                max={160}
                step={2}
                suffix="px"
                onChange={(box_padding) => updateTextStyle({ box_padding })}
              />
            </div>
            <GroupLabel>Word emphasis</GroupLabel>
            <SelectField
              label="Word motion"
              value={textStyle.emphasis}
              options={[
                ["none", "None"],
                ["pop", "Pop"],
                ["tilt", "Tilt"],
                ["flash", "Flash"],
                ["shake", "Shake"],
              ]}
              onChange={(emphasis) =>
                updateTextStyle({
                  emphasis: emphasis as ResolvedTextStyle["emphasis"],
                })
              }
            />
            {textStyle.emphasis !== "none" && (
              <SelectField
                label="Motion applies to"
                value={textStyle.emphasis_scope}
                options={[
                  ["all", "Every word"],
                  ["key", "Highlighted words only"],
                ]}
                onChange={(emphasis_scope) =>
                  updateTextStyle({
                    emphasis_scope:
                      emphasis_scope as ResolvedTextStyle["emphasis_scope"],
                  })
                }
              />
            )}
            <SelectField
              label="Highlight words"
              value={textStyle.emphasis_words}
              options={[
                ["none", "None"],
                ["all", "All words"],
                ["first", "First word"],
                ["last", "Last word"],
                ["longest", "Longest word"],
                ["keyword", "Keyword list"],
              ]}
              onChange={(emphasis_words) =>
                updateTextStyle({
                  emphasis_words:
                    emphasis_words as ResolvedTextStyle["emphasis_words"],
                })
              }
            />
            {textStyle.emphasis_words === "keyword" && (
              <label className="editor-field">
                <span>Keywords</span>
                <input
                  type="text"
                  aria-label="Emphasis keywords"
                  placeholder="never, always, money"
                  value={textStyle.emphasis_keywords.join(", ")}
                  onChange={(e) =>
                    updateTextStyle({
                      emphasis_keywords: e.target.value
                        .split(",")
                        .map((word) => word.trim())
                        .filter(Boolean)
                        .slice(0, 40),
                    })
                  }
                />
              </label>
            )}
            {textStyle.emphasis_words !== "none" && (
              <>
                <div className="editor-field-pair">
                  <label className="editor-field">
                    <span>Emphasis color</span>
                    <input
                      type="color"
                      aria-label="Emphasis color"
                      value={textStyle.emphasis_color}
                      onChange={(e) =>
                        updateTextStyle({ emphasis_color: e.target.value })
                      }
                    />
                  </label>
                  <SelectField
                    label="Emphasis case"
                    value={textStyle.emphasis_case}
                    options={[
                      ["none", "As typed"],
                      ["upper", "UPPERCASE"],
                      ["lower", "lowercase"],
                    ]}
                    onChange={(emphasis_case) =>
                      updateTextStyle({
                        emphasis_case:
                          emphasis_case as ResolvedTextStyle["emphasis_case"],
                      })
                    }
                  />
                </div>
                <label className="editor-checkbox">
                  <input
                    type="checkbox"
                    checked={textStyle.emphasis_bold}
                    onChange={(e) =>
                      updateTextStyle({ emphasis_bold: e.target.checked })
                    }
                  />
                  Bolder highlighted words
                </label>
              </>
            )}
            {textStyle.emphasis !== "none" && (
              <p>
                The word being spoken bounces as it reaches the front. Export
                timing follows this caption’s own duration.
              </p>
            )}
            <GroupLabel>Effects</GroupLabel>
            <div className="editor-field-pair">
              <NumberField
                label="Glow"
                value={textStyle.glow}
                min={0}
                max={16}
                step={1}
                suffix="px"
                onChange={(glow) => updateTextStyle({ glow })}
              />
              <label className="editor-field">
                <span>Glow color</span>
                <input
                  type="color"
                  aria-label="Glow color"
                  value={textStyle.glow_color}
                  onChange={(e) =>
                    updateTextStyle({ glow_color: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="editor-field-pair">
              <NumberField
                label="Soft shadow"
                value={textStyle.shadow_soft}
                min={0}
                max={24}
                step={1}
                suffix="px"
                onChange={(shadow_soft) => updateTextStyle({ shadow_soft })}
              />
              <label className="editor-field">
                <span>Shadow color</span>
                <input
                  type="color"
                  aria-label="Shadow color"
                  value={textStyle.shadow_color}
                  onChange={(e) =>
                    updateTextStyle({ shadow_color: e.target.value })
                  }
                />
              </label>
            </div>
            <NumberField
              label="Shadow opacity"
              value={textStyle.shadow_opacity * 100}
              min={0}
              max={100}
              step={5}
              suffix="%"
              onChange={(n) => updateTextStyle({ shadow_opacity: n / 100 })}
            />
            <div className="editor-field-pair">
              <SelectField
                label="Color ramp"
                value={textStyle.color_ramp}
                options={[
                  ["none", "Off"],
                  ["words", "Blend across words"],
                ]}
                onChange={(color_ramp) =>
                  updateTextStyle({
                    color_ramp: color_ramp as ResolvedTextStyle["color_ramp"],
                  })
                }
              />
              <label className="editor-field">
                <span>Ramp color</span>
                <input
                  type="color"
                  aria-label="Ramp color"
                  value={textStyle.ramp_color}
                  onChange={(e) =>
                    updateTextStyle({ ramp_color: e.target.value })
                  }
                />
              </label>
            </div>
            <SelectField
              label="Word chip"
              value={textStyle.chip}
              options={[
                ["none", "Off"],
                ["emphasis", "Behind highlighted words"],
              ]}
              onChange={(chip) =>
                updateTextStyle({ chip: chip as ResolvedTextStyle["chip"] })
              }
            />
            {textStyle.chip === "emphasis" && (
              <p>
                The word chip is preview only. ASS has no per-word background,
                so the exported MP4 shows the highlight colour without the
                filled box.
              </p>
            )}
          </section>
        )}
        {item.kind !== "text" && (
          <section className="editor-inspector-section">
            <h3>
              Audio
              <IconButton
                label={item.muted ? "Unmute clip" : "Mute clip"}
                pressed={item.muted}
                onClick={() => update({ muted: !item.muted })}
              >
                {item.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </IconButton>
            </h3>
            <NumberField
              label="Volume"
              value={value.volume * 100}
              min={0}
              max={200}
              step={5}
              suffix="%"
              onChange={(n) => writeValue("volume", n / 100)}
            />
            <div className="editor-field-pair">
              <NumberField
                label="Fade in"
                value={item.fade_in}
                min={0}
                max={item.duration}
                suffix="s"
                onChange={(fade_in) => update({ fade_in })}
              />
              <NumberField
                label="Fade out"
                value={item.fade_out}
                min={0}
                max={item.duration}
                suffix="s"
                onChange={(fade_out) => update({ fade_out })}
              />
            </div>
          </section>
        )}
        {item.kind !== "audio" && (
          <section className="editor-inspector-section">
            <h3>Animation</h3>
            <div className="editor-field-pair">
              <label className="editor-field">
                <span>In animation</span>
                <select
                  aria-label="In animation"
                  value={item.animation_in}
                  onChange={(e) =>
                    update({
                      animation_in: e.target
                        .value as TimelineItem["animation_in"],
                    })
                  }
                >
                  {animations.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="editor-field">
                <span>Out animation</span>
                <select
                  aria-label="Out animation"
                  value={item.animation_out}
                  onChange={(e) =>
                    update({
                      animation_out: e.target
                        .value as TimelineItem["animation_out"],
                    })
                  }
                >
                  {animations.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <NumberField
              label="Animation duration"
              value={item.animation_duration}
              min={0.1}
              max={Math.min(5, item.duration)}
              suffix="s"
              onChange={(animation_duration) => update({ animation_duration })}
            />
          </section>
        )}
        {/*
          A transition blends this clip with the PREVIOUS one on the same track,
          so it needs real overlap. The section is hidden entirely when there is
          none, rather than offering a control the engine would reject on save.
        */}
        {overlap && (
          <section className="editor-inspector-section">
            <h3>Transition</h3>
            <label className="editor-field">
              <span>Transition</span>
              <select
                aria-label="Transition"
                value={item.transition_in}
                onChange={(e) =>
                  update({ transition_in: e.target.value as TransitionId })
                }
              >
                <option value="none">None</option>
                {transitions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Transition duration"
              value={item.transition_duration}
              min={minTransitionOverlap}
              max={Math.min(maxTransitionDuration, overlap.duration)}
              suffix="s"
              onChange={(transition_duration) =>
                update({ transition_duration })
              }
            />
            <p className="editor-hint">
              Blends with the clip before it over {formatTime(overlap.duration)}
              .
            </p>
          </section>
        )}
        <section className="editor-inspector-section">
          <h3>
            Keyframes<span>{item.keyframes.length}</span>
          </h3>
          <button className="button secondary small full" onClick={addKey}>
            <Diamond size={14} />
            {activeKey ? "Update keyframe" : "Add keyframe"} at{" "}
            {formatTime(local, true)}
          </button>
          <p>
            {item.keyframes.length
              ? "Property changes add or update a keyframe at the playhead."
              : "Animate transform and volume between points in time."}
          </p>
          {item.keyframes.map((key, index) => (
            <div
              className={`editor-keyframe-row ${Math.abs(key.time - local) < 0.02 ? "active" : ""}`}
              key={index}
            >
              <button
                aria-label={`Go to keyframe ${index + 1}`}
                onClick={() => onTime(item.start + key.time)}
              >
                <Diamond size={12} />
                {formatTime(key.time, true)}
              </button>
              <select
                aria-label={`Keyframe ${index + 1} easing`}
                value={key.easing}
                onChange={(e) =>
                  update({
                    keyframes: item.keyframes.map((k, i) =>
                      i === index
                        ? { ...k, easing: e.target.value as Keyframe["easing"] }
                        : k,
                    ),
                  })
                }
              >
                <option value="linear">Linear</option>
                <option value="ease-in">Ease in</option>
                <option value="ease-out">Ease out</option>
                <option value="ease-in-out">Ease in/out</option>
              </select>
              <IconButton
                label={`Delete keyframe ${index + 1}`}
                onClick={() =>
                  update({
                    keyframes: item.keyframes.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}
