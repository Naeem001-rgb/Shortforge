import type { CSSProperties } from "react";
import { defaultTextStyle } from "./editorModel";
import type { Animation, TextStyle, TimelineItem } from "./editorModel";

/* ------------------------------------------------------------------ *
 * Modern caption styling.
 *
 * Every field in `ModernTextStyle` is implemented twice, in lockstep:
 * once here for the browser preview and once in engine/studio/captions.py
 * for the ASS file FFmpeg burns in. docs/CAPTIONS-SPEC.md is the contract,
 * so if you change a default or an override tag, change it there too.
 * ------------------------------------------------------------------ */

export type CaseStyle = "none" | "upper" | "lower" | "title" | "sentence";
export type EmphasisMotion = "none" | "pop" | "tilt" | "flash" | "shake";
export type EmphasisScope = "all" | "key";
export type EmphasisWords =
  "none" | "all" | "first" | "last" | "longest" | "keyword";
export type EmphasisCase = "none" | "upper" | "lower";
export type ColorRamp = "none" | "words";
export type ChipMode = "none" | "emphasis";

/** Fields added on top of the original `TextStyle` in editor_models.py. */
export type ModernTextStyle = {
  case_style: CaseStyle;
  line_height: number;
  emphasis: EmphasisMotion;
  emphasis_scope: EmphasisScope;
  emphasis_words: EmphasisWords;
  emphasis_keywords: string[];
  emphasis_case: EmphasisCase;
  emphasis_bold: boolean;
  emphasis_color: string;
  color_ramp: ColorRamp;
  ramp_color: string;
  glow: number;
  glow_color: string;
  shadow_color: string;
  shadow_opacity: number;
  shadow_soft: number;
  box_padding: number;
  chip: ChipMode;
};

export type ResolvedTextStyle = TextStyle & ModernTextStyle;

export const modernTextStyle: ModernTextStyle = {
  case_style: "none",
  line_height: 1,
  emphasis: "none",
  emphasis_scope: "all",
  emphasis_words: "none",
  emphasis_keywords: [],
  emphasis_case: "none",
  emphasis_bold: true,
  emphasis_color: "#f9e54c",
  color_ramp: "none",
  ramp_color: "#ff2d55",
  glow: 0,
  glow_color: "#7c5cff",
  shadow_color: "#000000",
  shadow_opacity: 0.5,
  shadow_soft: 0,
  box_padding: 0,
  chip: "none",
};

/** The live style for an item: legacy defaults, then new defaults, then saved. */
export function styleOf(
  item: Pick<TimelineItem, "text_style"> | { text_style?: Partial<TextStyle> },
): ResolvedTextStyle {
  return {
    ...defaultTextStyle,
    ...modernTextStyle,
    ...item.text_style,
  } as ResolvedTextStyle;
}

/**
 * Drop every new field still sitting on its default, so saved projects stay
 * valid against engines that have not gained the new columns yet. Only
 * captions that actually use an effect pay for it.
 */
function compactStyle(style: ResolvedTextStyle): Record<string, unknown> {
  const out: Record<string, unknown> = { ...style };
  (Object.keys(modernTextStyle) as (keyof ModernTextStyle)[]).forEach((key) => {
    const value = style[key];
    if (Array.isArray(value) ? !value.length : value === modernTextStyle[key])
      delete out[key];
  });
  return out;
}

export function withTextStyle(
  item: TimelineItem,
  patch: Partial<ResolvedTextStyle>,
): TimelineItem {
  return {
    ...item,
    text_style: compactStyle({
      ...styleOf(item),
      ...patch,
    } as ResolvedTextStyle) as TextStyle,
  };
}

/* ----------------------------- colour ----------------------------- */

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const safe = /^[0-9a-fA-F]{6}$/.test(value) ? value : "ffffff";
  return [
    parseInt(safe.slice(0, 2), 16),
    parseInt(safe.slice(2, 4), 16),
    parseInt(safe.slice(4, 6), 16),
  ];
}

const pair = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

export function mixColor(from: string, to: string, amount: number): string {
  const t = clamp01(amount),
    a = channels(from),
    b = channels(to);
  return `#${pair(a[0] * (1 - t) + b[0] * t)}${pair(
    a[1] * (1 - t) + b[1] * t,
  )}${pair(a[2] * (1 - t) + b[2] * t)}`;
}

/** `#rrggbb` plus an alpha 0..1, for CSS text-shadow stacks. */
export function colorAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${Math.round(clamp01(alpha) * 1000) / 1000})`;
}

/** Pick black or white text for a filled chip, using perceived luminance. */
export function readableOn(hex: string): string {
  const [r, g, b] = channels(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#101014" : "#ffffff";
}

/* ------------------------- text preparation ----------------------- */

/** Case folding shared, character for character, with captions.py. */
export function foldCase(value: string, mode: CaseStyle): string {
  if (mode === "upper") return value.toUpperCase();
  if (mode === "lower") return value.toLowerCase();
  if (mode === "title")
    return value.replace(
      /\S+/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1),
    );
  if (mode === "sentence") {
    const lower = value.toLowerCase(),
      at = lower.search(/[a-z]/);
    return at < 0
      ? lower
      : lower.slice(0, at) + lower[at].toUpperCase() + lower.slice(at + 1);
  }
  return value;
}

/** The caption string after `uppercase` and `case_style`, before emphasis. */
export function captionSource(
  item: Pick<TimelineItem, "text" | "text_style">,
  style = styleOf(item),
): string {
  return foldCase(
    style.uppercase ? item.text.toUpperCase() : item.text,
    style.case_style,
  );
}

/** Split into words, keeping the trailing space, exactly like Python's regex. */
export function splitWords(text: string): string[] {
  return text.match(/\S+\s*/g) || [];
}

const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which words carry the emphasis colour, weight and case. */
export function keyWordIndexes(
  words: string[],
  style: ResolvedTextStyle,
): Set<number> {
  const keys = new Set<number>();
  const mode = style.emphasis_words;
  if (mode === "none" || !words.length) return keys;
  if (mode === "all") {
    words.forEach((_, index) => keys.add(index));
    return keys;
  }
  if (mode === "keyword") {
    const wanted = new Set(style.emphasis_keywords.map(bare).filter(Boolean));
    words.forEach((word, index) => {
      if (wanted.has(bare(word))) keys.add(index);
    });
    return keys;
  }
  if (mode === "last") {
    keys.add(words.length - 1);
    return keys;
  }
  if (mode === "first") {
    keys.add(0);
    return keys;
  }
  let best = 0;
  words.forEach((word, index) => {
    if (word.trim().length > words[best].trim().length) best = index;
  });
  keys.add(best);
  return keys;
}

/** The word that bounces right now, or -1 when nothing is animating. */
export function activeEmphasis(
  current: number,
  keys: Set<number>,
  style: ResolvedTextStyle,
): number {
  if (style.emphasis === "none" || current < 0) return -1;
  if (style.emphasis_scope === "key" && !keys.has(current)) return -1;
  return current;
}

/** Fill colour of a word: ramp blend, or the keyword colour. */
export function wordColor(
  index: number,
  total: number,
  base: string,
  style: ResolvedTextStyle,
  isKey: boolean,
): string {
  if (style.color_ramp === "words" && total > 1)
    return mixColor(base, style.ramp_color, index / (total - 1));
  return isKey ? style.emphasis_color : base;
}

/** Padding for the background box, in output pixels. Shared with captions.py. */
export function boxPadding(
  style: ResolvedTextStyle,
  fontSize: number,
  hasBackground: boolean,
): number {
  if (style.box_padding > 0) return style.box_padding;
  return hasBackground ? Math.max(2, fontSize * 0.14) : 0;
}

/* ------------------------- preview rendering ----------------------- */

/** Motion length, in ms. Matches the `\t()` window used by captions.py. */
export const EMPHASIS_MS = 180;

/** libass natural leading, mirrored by FONT_LEADING in captions.py. */
export const FONT_LEADING = 1.16;

const KEYFRAMES: Record<EmphasisMotion, string> = {
  none: "",
  pop: "@keyframes caption-pop{from{transform:scale(1.35)}to{transform:scale(1)}}",
  tilt: "@keyframes caption-tilt{from{transform:rotate(-14deg)}to{transform:rotate(0)}}",
  flash: "@keyframes caption-flash{from{opacity:.25}to{opacity:1}}",
  shake:
    "@keyframes caption-shake{0%{transform:rotate(-7deg)}39%{transform:rotate(7deg)}100%{transform:rotate(0)}}",
};

const MOTION_NAME: Record<EmphasisMotion, string> = {
  none: "none",
  pop: "caption-pop",
  tilt: "caption-tilt",
  flash: "caption-flash",
  shake: "caption-shake",
};

/** Keyframes have to exist in the document; this is the stylesheet for them. */
export const CAPTION_CSS =
  `.caption-line{display:inline-block;max-width:100%}` +
  Object.values(KEYFRAMES).join("");

/** Text-level styling shared by every word, so the box and glow sit right. */
export function textAppearance(
  item: Pick<
    TimelineItem,
    "font_size" | "color" | "text_background" | "text_style" | "font_family"
  >,
  scale: number,
): CSSProperties {
  const style = styleOf(item),
    fontSize = item.font_size * scale,
    hasBackground = item.text_background !== "transparent",
    padding = boxPadding(style, fontSize, hasBackground) * scale,
    shadows: string[] = [];
  if (style.glow > 0)
    shadows.push(
      `0 0 ${Math.max(1, style.glow * scale * 0.55)}px ${colorAlpha(style.glow_color, 0.9)}`,
      `0 0 ${Math.max(2, style.glow * scale * 1.4)}px ${colorAlpha(style.glow_color, 0.45)}`,
    );
  if (style.shadow_soft > 0)
    shadows.push(
      `${style.shadow_soft * scale * 0.3}px ${style.shadow_soft * scale * 0.3}px ${Math.max(
        1,
        style.shadow_soft * scale * 0.9,
      )}px ${colorAlpha(style.shadow_color, style.shadow_opacity)}`,
    );
  if (style.shadow > 0)
    shadows.push(
      `${style.shadow * scale}px ${style.shadow * scale}px 0 ${colorAlpha(
        style.shadow_color,
        style.shadow_opacity,
      )}`,
    );
  return {
    fontSize,
    fontFamily: `"${item.font_family || "ShortForge Captions"}", sans-serif`,
    // 1.16 is libass's natural leading for DejaVu Sans; see FONT_LEADING in
    // engine/studio/captions.py, which turns the same number into `\fsp`.
    lineHeight: Math.round(style.line_height * FONT_LEADING * 100) / 100,
    whiteSpace: "pre-wrap",
    color: item.color,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textAlign: style.align,
    letterSpacing: style.letter_spacing * scale,
    WebkitTextStroke: `${style.stroke * scale}px ${style.stroke_color}`,
    paintOrder: "stroke fill",
    textShadow: shadows.length ? shadows.join(", ") : "none",
    ...(hasBackground
      ? {
          background: item.text_background,
          padding: `${padding * 0.6}px ${padding}px`,
          borderRadius: Math.min(14, padding * 0.5),
          boxShadow: `0 ${padding * 0.2}px ${padding * 0.8}px ${colorAlpha("#000000", 0.28)}`,
        }
      : {}),
  };
}

export type CaptionWord = {
  index: number;
  /** The word with any keyword case change already applied. */
  text: string;
  color: string;
  isKey: boolean;
  chip: boolean;
  /** True on the one word that is bouncing at this instant. */
  popping: boolean;
};

export function captionWords(item: TimelineItem, localTime: number) {
  const style = styleOf(item);
  const text = captionSource(item, style);
  const words = splitWords(text);
  const duration = item.duration > 0 ? item.duration : 1;
  const current = Math.max(
    0,
    Math.min(
      words.length - 1,
      Math.floor((localTime / duration) * words.length),
    ),
  );
  const keys = keyWordIndexes(words, style);
  const popping = activeEmphasis(words.length ? current : -1, keys, style);
  const caption: CaptionWord[] = words.map((word, index) => {
    const isKey = keys.has(index);
    return {
      index,
      text:
        isKey && style.emphasis_case !== "none"
          ? foldCase(word, style.emphasis_case)
          : word,
      color: wordColor(index, words.length, item.color, style, isKey),
      isKey,
      chip: style.chip === "emphasis" && isKey,
      popping: index === popping,
    };
  });
  return { style, text, words, current, keys, caption };
}

/**
 * Per-word CSS for the shared caption renderer. Size, box, glow and tracking
 * stay on the wrapping element; only what has to differ per word lives here.
 */
export function captionWordAppearance(
  word: CaptionWord,
  style: ResolvedTextStyle,
  scale: number,
  loop = false,
): CSSProperties {
  const appearance: CSSProperties = {
    display: "inline-block",
    color: word.color,
    fontWeight: style.bold || (word.isKey && style.emphasis_bold) ? 800 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    WebkitTextStroke: `${style.stroke * scale}px ${style.stroke_color}`,
    paintOrder: "stroke fill",
  };
  if (word.chip) {
    appearance.background = style.emphasis_color;
    appearance.color = readableOn(style.emphasis_color);
    appearance.borderRadius = Math.max(3, 6 * scale);
    appearance.padding = `${2 * scale}px ${6 * scale}px`;
    appearance.boxShadow = "none";
  }
  if (word.popping) {
    appearance.animation = `${MOTION_NAME[style.emphasis]} ${EMPHASIS_MS}ms linear`;
    if (loop) appearance.animationIterationCount = "infinite";
    appearance.animationFillMode = "both";
  }
  return appearance;
}

/* ----------------------------- presets ----------------------------- */

export type TextCategory =
  "Essential" | "Kinetic" | "Popular" | "Neon & Glow" | "Editorial" | "Clean";

export type TextPreset = {
  id: string;
  name: string;
  category: TextCategory;
  sample: string;
  size: number;
  color: string;
  background?: string;
  y?: number;
  animation?: Animation;
  style?: Partial<TextStyle> & Partial<ModernTextStyle>;
  /** Fields this preset uses that the MP4 export cannot reproduce. */
  previewOnly?: string[];
};

export const textPresets: TextPreset[] = [
  {
    id: "classic",
    name: "Classic subtitle",
    category: "Essential",
    sample: "Tell your story",
    size: 56,
    color: "#ffffff",
    y: 32,
    style: { stroke: 2, shadow: 1, shadow_opacity: 0.55 },
  },
  {
    id: "clean",
    name: "Clean minimal",
    category: "Essential",
    sample: "Less is more.",
    size: 54,
    color: "#ffffff",
    y: 30,
    style: { line_height: 1.2 },
  },
  {
    id: "boxed",
    name: "Boxed label",
    category: "Essential",
    sample: "ONE MORE THING",
    size: 58,
    color: "#ffffff",
    background: "#191923",
    y: 28,
    style: { bold: true, uppercase: true, box_padding: 24 },
  },
  {
    id: "lower",
    name: "Lower third",
    category: "Essential",
    sample: "A different perspective",
    size: 48,
    color: "#ffffff",
    y: 34,
    animation: "slide-up",
    style: { align: "left", shadow: 2, shadow_soft: 12 },
  },
  {
    id: "soft-shadow",
    name: "Soft shadow",
    category: "Essential",
    sample: "Quiet confidence",
    size: 60,
    color: "#f5f5f7",
    y: 30,
    style: { shadow_soft: 16, shadow_opacity: 0.45, line_height: 1.15 },
  },
  {
    id: "word-pop",
    name: "Word pop",
    category: "Kinetic",
    sample: "Every word bounces",
    size: 76,
    color: "#ffffff",
    y: 26,
    animation: "pop",
    style: {
      bold: true,
      stroke: 4,
      stroke_color: "#000000",
      case_style: "upper",
      emphasis: "pop",
    },
  },
  {
    id: "keyword-bounce",
    name: "Keyword bounce",
    category: "Kinetic",
    sample: "Pick the biggest word",
    size: 74,
    color: "#ffffff",
    y: 26,
    style: {
      bold: true,
      stroke: 3,
      stroke_color: "#0a0a0a",
      emphasis: "pop",
      emphasis_scope: "key",
      emphasis_words: "longest",
      emphasis_color: "#ffe14d",
    },
  },
  {
    id: "tilt-beat",
    name: "Tilt beat",
    category: "Kinetic",
    sample: "Lean into it",
    size: 72,
    color: "#ffffff",
    y: 26,
    animation: "rise-fade",
    style: {
      bold: true,
      stroke: 3,
      letter_spacing: -1,
      emphasis: "tilt",
      line_height: 1.05,
    },
  },
  {
    id: "flash-beat",
    name: "Flash beat",
    category: "Kinetic",
    sample: "Hit every beat",
    size: 78,
    color: "#ffffff",
    y: 24,
    animation: "punch",
    style: {
      bold: true,
      stroke: 4,
      stroke_color: "#000000",
      emphasis: "flash",
      emphasis_words: "first",
      emphasis_color: "#ff2d55",
      line_height: 1.05,
    },
  },
  {
    id: "shake-callout",
    name: "Shake callout",
    category: "Kinetic",
    sample: "Wait but why",
    size: 80,
    color: "#ffffff",
    y: 22,
    animation: "zoom-in",
    style: {
      bold: true,
      uppercase: true,
      stroke: 5,
      stroke_color: "#000000",
      shadow: 3,
      emphasis: "shake",
      emphasis_words: "keyword",
      emphasis_keywords: ["wait", "why", "stop", "never", "but"],
      emphasis_color: "#f9e54c",
    },
  },
  {
    id: "punch-hook",
    name: "Punch hook",
    category: "Kinetic",
    sample: "Nobody talks about this",
    size: 88,
    color: "#ffffff",
    y: 20,
    animation: "punch",
    style: {
      bold: true,
      uppercase: true,
      stroke: 6,
      stroke_color: "#000000",
      shadow: 4,
      line_height: 1,
    },
  },
  {
    id: "drift-ramp",
    name: "Drift ramp",
    category: "Kinetic",
    sample: "Watch the colour move",
    size: 64,
    color: "#ffffff",
    y: 28,
    animation: "drift",
    style: {
      bold: true,
      shadow: 2,
      color_ramp: "words",
      ramp_color: "#7cc7ff",
      emphasis: "pop",
      line_height: 1.15,
    },
  },
  {
    id: "hormozi",
    name: "Bold Pop",
    category: "Popular",
    sample: "Get rich or stay rich",
    size: 80,
    color: "#ffffff",
    y: 24,
    animation: "punch",
    style: {
      bold: true,
      uppercase: true,
      stroke: 5,
      stroke_color: "#000000",
      emphasis: "pop",
      emphasis_scope: "key",
      emphasis_words: "longest",
      emphasis_color: "#f9e54c",
    },
  },
  {
    id: "tiktok-bold",
    name: "Bold outline",
    category: "Popular",
    sample: "POV you finally did it",
    size: 84,
    color: "#ffffff",
    y: 22,
    style: {
      bold: true,
      stroke: 6,
      stroke_color: "#000000",
      shadow: 4,
      case_style: "upper",
      line_height: 1.02,
    },
  },
  {
    id: "beast-yellow",
    name: "Single-Word Slam",
    category: "Popular",
    sample: "I did it again",
    size: 78,
    color: "#f9e54c",
    y: 24,
    animation: "pop",
    style: {
      bold: true,
      uppercase: true,
      stroke: 5,
      stroke_color: "#000000",
      shadow: 3,
    },
  },
  {
    id: "karaoke",
    name: "Karaoke sweep",
    category: "Popular",
    sample: "Every word matters",
    size: 70,
    color: "#ffffff",
    y: 28,
    style: {
      bold: true,
      stroke: 3,
      stroke_color: "#111111",
      reveal: "karaoke",
      highlight: "#f9e54c",
      line_height: 1.1,
    },
  },
  {
    id: "typewriter",
    name: "Typewriter",
    category: "Popular",
    sample: "One word at a time",
    size: 60,
    color: "#ffffff",
    y: 28,
    style: {
      reveal: "typewriter",
      letter_spacing: 2,
      shadow: 1,
      shadow_soft: 8,
      case_style: "lower",
    },
  },
  {
    id: "neon-purple",
    name: "Neon purple",
    category: "Neon & Glow",
    sample: "After hours",
    size: 74,
    color: "#ffffff",
    y: 24,
    animation: "fade",
    style: {
      bold: true,
      uppercase: true,
      stroke: 2,
      stroke_color: "#c06cff",
      glow: 12,
      glow_color: "#a855f7",
    },
  },
  {
    id: "neon-cyan",
    name: "Neon cyan",
    category: "Neon & Glow",
    sample: "Open all night",
    size: 70,
    color: "#e8feff",
    y: 26,
    style: {
      bold: true,
      uppercase: true,
      letter_spacing: 3,
      stroke: 1,
      stroke_color: "#0e7490",
      glow: 10,
      glow_color: "#22d3ee",
    },
  },
  {
    id: "cyber-outline",
    name: "Cyber outline",
    category: "Neon & Glow",
    sample: "System online",
    size: 72,
    color: "#ffffff",
    y: 26,
    animation: "rise-fade",
    style: {
      bold: true,
      uppercase: true,
      stroke: 5,
      stroke_color: "#ff2d95",
      glow: 8,
      glow_color: "#ff2d95",
    },
  },
  {
    id: "sunset-ramp",
    name: "Sunset ramp",
    category: "Neon & Glow",
    sample: "Golden hour glow",
    size: 76,
    color: "#ffffff",
    y: 26,
    style: {
      bold: true,
      uppercase: true,
      stroke: 3,
      stroke_color: "#7c2d12",
      color_ramp: "words",
      ramp_color: "#fb923c",
      glow: 6,
      glow_color: "#fb7185",
      emphasis: "pop",
    },
  },
  {
    id: "ice-crystal",
    name: "Ice crystal",
    category: "Neon & Glow",
    sample: "Cold and clear",
    size: 66,
    color: "#f0fbff",
    y: 28,
    style: {
      uppercase: true,
      letter_spacing: 5,
      stroke: 1,
      stroke_color: "#0ea5e9",
      glow: 9,
      glow_color: "#38bdf8",
      line_height: 1.3,
      emphasis: "tilt",
      emphasis_words: "last",
      emphasis_color: "#e0f2fe",
    },
  },
  {
    id: "headline-wide",
    name: "Headline wide",
    category: "Editorial",
    sample: "The Sunday read",
    size: 50,
    color: "#fafafa",
    background: "#0b0b0f",
    y: 30,
    style: {
      bold: true,
      uppercase: true,
      letter_spacing: 6,
      box_padding: 20,
      align: "left",
      line_height: 1.25,
    },
  },
  {
    id: "quote-italic",
    name: "Quote italic",
    category: "Editorial",
    sample: "we never talk about this",
    size: 62,
    color: "#f5f5f5",
    y: 30,
    animation: "fade",
    style: {
      italic: true,
      line_height: 1.25,
      letter_spacing: 1,
      emphasis_words: "keyword",
      emphasis_keywords: ["never", "always", "nobody", "everything"],
      emphasis_color: "#f9e54c",
      chip: "emphasis",
    },
    previewOnly: ["chip"],
  },
  {
    id: "news-strap",
    name: "News strap",
    category: "Editorial",
    sample: "Breaking: markets rally",
    size: 46,
    color: "#ffffff",
    background: "#0a3d62",
    y: 30,
    style: {
      bold: true,
      uppercase: true,
      letter_spacing: 2,
      box_padding: 18,
      align: "left",
      line_height: 1.2,
      emphasis_words: "last",
      emphasis_color: "#ffd166",
    },
  },
  {
    id: "pull-quote",
    name: "Pull quote",
    category: "Editorial",
    sample: "Say it out loud",
    size: 70,
    color: "#ffffff",
    y: 28,
    style: {
      italic: true,
      stroke: 2,
      stroke_color: "#111111",
      shadow_soft: 14,
      emphasis_words: "longest",
      emphasis_case: "upper",
      emphasis_bold: true,
      line_height: 1.15,
    },
  },
  {
    id: "whisper",
    name: "Whisper",
    category: "Clean",
    sample: "Just a small thought",
    size: 54,
    color: "#d7d7de",
    y: 30,
    style: {
      shadow_soft: 8,
      shadow_opacity: 0.35,
      line_height: 1.25,
      case_style: "sentence",
    },
  },
  {
    id: "minimal-caps",
    name: "Minimal caps",
    category: "Clean",
    sample: "slow is smooth",
    size: 58,
    color: "#f2f2f5",
    y: 28,
    style: {
      uppercase: true,
      letter_spacing: 7,
      line_height: 1.4,
      emphasis: "pop",
    },
  },
  {
    id: "soft-card",
    name: "Soft card",
    category: "Clean",
    sample: "Save this one",
    size: 56,
    color: "#1c1c22",
    background: "#f4f4f6",
    y: 28,
    style: {
      bold: true,
      box_padding: 28,
      chip: "emphasis",
      emphasis_words: "longest",
      emphasis_color: "#1c1c22",
      line_height: 1.2,
    },
    previewOnly: ["chip"],
  },
  {
    id: "mono-ledger",
    name: "Mono ledger",
    category: "Clean",
    sample: "one number at a time",
    size: 54,
    color: "#e8f0ff",
    y: 28,
    style: {
      letter_spacing: 4,
      uppercase: true,
      line_height: 1.35,
      color_ramp: "words",
      ramp_color: "#38bdf8",
      emphasis_words: "last",
      emphasis_color: "#38bdf8",
    },
  },
];

/** Filter chips for the template browser, in display order. */
export const presetCategories: (TextCategory | "All")[] = [
  "All",
  ...([...new Set(textPresets.map((p) => p.category))] as TextCategory[]),
];

export function applyTextPreset(
  item: TimelineItem,
  preset: TextPreset,
): TimelineItem {
  return {
    ...item,
    font_size: preset.size,
    caption_style: preset.id,
    font_family: ({ classic:"Lato", clean:"DM Sans", boxed:"Space Grotesk", lower:"Roboto Condensed", "soft-shadow":"Nunito Sans", "word-pop":"Montserrat", "keyword-bounce":"Poppins", "tilt-beat":"Rubik", "flash-beat":"Anton", "shake-callout":"Permanent Marker", "punch-hook":"Archivo Black", "drift-ramp":"Righteous", hormozi:"Montserrat", "tiktok-bold":"Poppins", "beast-yellow":"Anton", karaoke:"Montserrat", typewriter:"IBM Plex Mono", "neon-purple":"Space Grotesk", "neon-cyan":"Rubik", "cyber-outline":"Barlow Condensed", "sunset-ramp":"Righteous", "ice-crystal":"Oswald", "headline-wide":"Bebas Neue", "quote-italic":"Playfair Display", "news-strap":"Roboto Condensed", "pull-quote":"DM Serif Display", whisper:"Libre Baskerville", "minimal-caps":"Lato", "soft-card":"Nunito Sans", "mono-ledger":"IBM Plex Mono" } as Record<string,string>)[preset.id] || "Montserrat",
    color: preset.color,
    text_background: preset.background || "transparent",
    // A template is a complete look, not a layer on top of the last one, so
    // it starts from the defaults instead of the clip's current style.
    text_style: compactStyle({
      ...defaultTextStyle,
      ...modernTextStyle,
      ...preset.style,
    } as ResolvedTextStyle) as TextStyle,
    transform: { ...item.transform, y: preset.y ?? 28 },
    animation_in: preset.animation || "none",
    animation_out: "none",
    animation_duration: 0.35,
  };
}
