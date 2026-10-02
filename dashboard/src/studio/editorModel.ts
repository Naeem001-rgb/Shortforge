import type { Asset } from "../api";
import { transitionIds } from "./transitions";

export type Animation =
  | "none"
  | "fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "zoom-in"
  | "zoom-out"
  | "pop"
  | "bounce"
  | "spin-left"
  | "spin-right"
  | "drop"
  | "float"
  | "drift"
  | "rise-fade"
  | "punch"
  | "blur-in"
  | "glitch"
  | "swing"
  | "tilt"
  | "push-in"
  | "whip"
  | "fade-zoom"
  | "pulse"
  | "wobble"
  | "shake";

/**
 * Transition ids are declared literally rather than aliased to
 * `Transition["id"]` (which is just `string`), so a typo becomes a compile
 * error instead of a runtime rejection from the engine.
 *
 * The ids must stay identical to `TRANSITIONS` in
 * engine/studio/editor_transitions.py. The guard below fails the build the
 * moment the catalogue and this union drift apart.
 */
export type TransitionId =
  | "none"
  | "blur"
  | "circle-close"
  | "circle-open"
  | "clock-wipe"
  | "crossfade"
  | "dip-to-black"
  | "dip-to-white"
  | "luma-burn"
  | "pixelize"
  | "push"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "whip-pan"
  | "wipe-down"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "zoom-blur";

// Compile-time guard: every catalogue id must exist in the union above.
const _idsMatch: TransitionId[] = transitionIds as TransitionId[];
void _idsMatch;
export type TextStyle = {
  bold: boolean;
  italic: boolean;
  uppercase: boolean;
  align: "left" | "center" | "right";
  stroke: number;
  stroke_color: string;
  shadow: number;
  letter_spacing: number;
  reveal: "none" | "typewriter" | "karaoke";
  highlight: string;
};
export const defaultTextStyle: TextStyle = {
  bold: false,
  italic: false,
  uppercase: false,
  align: "center",
  stroke: 0,
  stroke_color: "#000000",
  shadow: 0,
  letter_spacing: 0,
  reveal: "none",
  highlight: "#f9e54c",
};
export type Transform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};
export type Keyframe = Transform & {
  time: number;
  volume: number;
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold" | "spring" | "bounce" | "cubic-bezier";
  bezier?: [number, number, number, number];
  values?: Record<string, number>;
};
export type CaptionWord = { word: string; start: number; end: number };
export type Adjustments = {
  brightness: number; contrast: number; saturation: number; exposure: number;
  temperature: number; tint: number; highlights: number; shadows: number;
  vignette: number; sharpen: number; grain: number; blur: number;
};
export const defaultAdjustments: Adjustments = {
  brightness: 0, contrast: 1, saturation: 1, exposure: 0,
  temperature: 0, tint: 0, highlights: 0, shadows: 0,
  vignette: 0, sharpen: 0, grain: 0, blur: 0,
};
export type EditorTrack = { id: number; name: string; kind: "video" | "audio" | "text"; locked: boolean; hidden: boolean; muted: boolean };
export type EditorMarker = { id: string; time: number; label: string; color?: string };
export type TimelineItem = {
  id: string;
  kind: "video" | "audio" | "text";
  asset_id: string | null;
  name: string;
  track: number;
  start: number;
  source_in: number;
  duration: number;
  speed: number;
  volume: number;
  muted: boolean;
  transform: Transform;
  keyframes: Keyframe[];
  animation_in: Animation;
  animation_out: Animation;
  animation_duration: number;
  /** Blend between this clip and the previous one on the same track. */
  transition_in: TransitionId;
  /** Seconds. Shared by both halves of the pair. */
  transition_duration: number;
  fade_in: number;
  fade_out: number;
  fit: "contain" | "cover";
  text: string;
  font_size: number;
  color: string;
  text_background: string;
  text_style?: TextStyle;
  caption_words?: CaptionWord[];
  caption_style?: string;
  font_family?: string;
  reverse?: boolean;
  freeze_at?: number | null;
  flip_x?: boolean;
  flip_y?: boolean;
  crop?: { top: number; right: number; bottom: number; left: number };
  adjustments?: Partial<Adjustments>;
  animation_loop?: Animation;
  group_id?: string;
  blend_mode?: "normal" | "multiply" | "screen" | "overlay" | "lighten" | "darken";
  mask?: { shape: "none" | "circle" | "rectangle"; feather: number };
  chroma_key?: { enabled: boolean; color: string; similarity: number };
  conceal?: { mode: "none" | "blur" | "cover" | "mosaic"; x: number; y: number; width: number; height: number; color: string };
  audio_role?: "original" | "voiceover" | "music" | "sfx";
  ducking?: boolean;

};
export type EditorProject = {
  version: 1;
  width: number;
  height: number;
  fps: number;
  background: string;
  items: TimelineItem[];
  tracks?: EditorTrack[];
  markers?: EditorMarker[];
  script?: string;
  name?: string;
  source_seeded?: boolean;
};
export type EditorMedia = Asset & {
  name: string;
  duration: number;
  width: number;
  height: number;
  has_audio: boolean;
  media_type: "video" | "audio" | "image";
  waveform: number[];
  thumbnail_url?: string;
};
export type EditorResponse = {
  project: EditorProject;
  media: EditorMedia[];
  saved_at: string | null;
};
export const animations: { value: Animation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-down", label: "Slide down" },
  { value: "zoom-in", label: "Zoom in" },
  { value: "zoom-out", label: "Zoom out" },
  { value: "pop", label: "Pop" },
  { value: "bounce", label: "Bounce" },
  { value: "spin-left", label: "Spin left" },
  { value: "spin-right", label: "Spin right" },
  { value: "drop", label: "Drop" },
  { value: "float", label: "Float" },
  { value: "drift", label: "Drift" },
  { value: "rise-fade", label: "Rise + fade" },
  { value: "punch", label: "Punch" },
  { value: "blur-in", label: "Blur in" },
  { value: "glitch", label: "Glitch" },
  { value: "swing", label: "Swing" },
  { value: "tilt", label: "Tilt" },
  { value: "push-in", label: "Push in" },
  { value: "whip", label: "Whip" },
  { value: "fade-zoom", label: "Fade + zoom" },
  { value: "pulse", label: "Pulse" },
  { value: "wobble", label: "Wobble" },
  { value: "shake", label: "Shake" },
];
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export const uid = () => crypto.randomUUID();
export const durationOf = (project: EditorProject) =>
  Math.max(0, ...project.items.map((item) => item.start + item.duration));
export const formatTime = (value: number, frames = false) => {
  const n = Math.max(0, value);
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}${
    frames
      ? `.${Math.floor((n % 1) * 100)
          .toString()
          .padStart(2, "0")}`
      : ""
  }`;
};
export function newItem(
  kind: TimelineItem["kind"],
  asset?: EditorMedia,
  start = 0,
  track = 0,
): TimelineItem {
  return {
    id: uid(),
    kind,
    asset_id: asset?.id || null,
    name: asset?.name || "Text",
    track,
    start,
    source_in: 0,
    duration: Math.min(asset?.duration || 5, 600 - start),
    speed: 1,
    volume: 1,
    muted: false,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    keyframes: [],
    animation_in: "none",
    animation_out: "none",
    animation_duration: 0.5,
    transition_in: "none",
    transition_duration: 0.6,
    fade_in: 0,
    fade_out: 0,
    fit: "contain",
    text: kind === "text" ? "Your text here" : "",
    font_size: 64,
    color: "#ffffff",
    text_background: "transparent",
  };
}
export function valueAt(
  item: TimelineItem,
  localTime: number,
): Transform & { volume: number; values?: Record<string, number> } {
  const keys = [...item.keyframes].sort((a, b) => a.time - b.time);
  if (!keys.length) return { ...item.transform, volume: item.volume };
  if (localTime <= keys[0].time) return { ...keys[0] };
  const last = keys[keys.length - 1];
  if (localTime >= last.time) return { ...last };
  const rightIndex = keys.findIndex((k) => k.time >= localTime),
    left = keys[rightIndex - 1],
    right = keys[rightIndex];
  const q = easeProgress((localTime-left.time)/(right.time-left.time), left.easing, left.bezier);
  const result = { ...item.transform, volume: item.volume };
  for (const property of [
    "x",
    "y",
    "scale",
    "rotation",
    "opacity",
    "volume",
  ] as const)
    result[property] = left[property] + (right[property] - left[property]) * q;
  const values: Record<string,number> = {};
  for (const property of new Set([...Object.keys(left.values || {}), ...Object.keys(right.values || {})])) {
    const a = left.values?.[property] ?? right.values?.[property] ?? 0;
    const b = right.values?.[property] ?? a;
    values[property] = a+(b-a)*q;
  }
  return {...result, values};
}
export function easeProgress(progress:number, easing:Keyframe["easing"], bezier?: [number,number,number,number]):number {
  const p=clamp(progress,0,1);
  if(easing === "hold") return p<1 ? 0 : 1;
  if(easing === "ease-in") return p*p;
  if(easing === "ease-out") return 1-(1-p)**2;
  if(easing === "ease-in-out") return p*p*(3-2*p);
  if(easing === "spring") return p===1 ? 1 : 1-Math.cos(p*Math.PI*4.5)*Math.exp(-6*p);
  if(easing === "bounce") { const n=7.5625,d=2.75; if(p<1/d)return n*p*p; if(p<2/d)return n*(p-1.5/d)**2+.75; if(p<2.5/d)return n*(p-2.25/d)**2+.9375;return n*(p-2.625/d)**2+.984375; }
  if(easing === "cubic-bezier") {
    const [x1,y1,x2,y2]=bezier || [.25,.1,.25,1];
    const cubic=(t:number,a:number,b:number)=>3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3;
    let lo=0,hi=1;
    for(let i=0;i<18;i++){const mid=(lo+hi)/2;if(cubic(mid,x1,x2)<p)lo=mid;else hi=mid;}
    return cubic((lo+hi)/2,y1,y2);
  }
  return p;
}
// Quint ease-out, mirrors ease_out() in engine/studio/editor_render.py.
export const easeOut = (p: number, power = 5) => 1 - Math.pow(1 - p, power);
export function displayAt(item: TimelineItem, localTime: number) {
  const value = valueAt(item, localTime);
  for (const [preset, progress] of [
    [item.animation_in, localTime / item.animation_duration],
    [item.animation_out, (item.duration - localTime) / item.animation_duration],
  ] as const) {
    const p = clamp(progress, 0, 1);
    if (preset === "pulse") value.scale *= 1+.1*Math.sin(p*Math.PI*4)*(1-p);
    if (preset === "wobble") value.rotation += 12*Math.sin(p*Math.PI*4)*(1-p);
    if (preset === "shake") value.x += 5*Math.sin(p*Math.PI*10)*(1-p);
    if (preset === "fade") value.opacity *= p;
    if (preset === "slide-left") value.x -= 100 * (1 - p);
    if (preset === "slide-right") value.x += 100 * (1 - p);
    if (preset === "slide-up") value.y -= 100 * (1 - p);
    if (preset === "slide-down") value.y += 100 * (1 - p);
    if (preset === "zoom-in") value.scale *= 0.65 + 0.35 * p;
    if (preset === "zoom-out") value.scale *= 1.35 - 0.35 * p;
    if (preset === "pop")
      value.scale *= 0.7 + 0.3 * p + 0.16 * Math.sin(Math.PI * p);
    if (preset === "bounce")
      value.y += 20 * (1 - p) * Math.cos(3 * Math.PI * p);
    if (preset === "spin-left") value.rotation -= 180 * (1 - p);
    if (preset === "spin-right") value.rotation += 180 * (1 - p);
    // Modern presets below mirror editor_render.interpolate()/visual_expression()
    // exactly and share the quint ease-out so entrances settle, not slide.
    const e = easeOut(p);
    if (preset === "drop") value.y -= 100 * (1 - e);
    if (preset === "float") {
      value.y += 50 * (1 - e);
      value.opacity *= e;
    }
    if (preset === "drift") {
      value.x += 50 * (1 - e);
      value.y -= 40 * (1 - e);
    }
    if (preset === "rise-fade") {
      value.y -= 40 * (1 - e);
      value.opacity *= e;
    }
    // Overshoot past 1 near the end of the ease, then back to rest.
    if (preset === "punch")
      value.scale *= 0.5 + 0.5 * e + 0.35 * Math.sin(Math.PI * e ** 0.7);
    // No blur filter exists in the render graph, so this fakes a depth-of-field
    // pull: slightly oversized and transparent, settling sharp and opaque.
    if (preset === "blur-in") {
      value.scale *= 1.15 - 0.15 * e;
      value.opacity *= e;
    }
    // Deterministic jitter: damped sine on rotation and x, no randomness.
    if (preset === "glitch") {
      value.rotation += 8 * (1 - e) * Math.sin(12 * Math.PI * p);
      value.x += 6 * (1 - e) * Math.sin(9 * Math.PI * p);
    }
    if (preset === "swing")
      value.rotation += 16 * (1 - e) * Math.sin(2.4 * Math.PI * p);
    if (preset === "tilt") {
      value.rotation -= 18 * (1 - e);
      value.x -= 12 * (1 - e);
    }
    if (preset === "push-in") value.scale *= 1.4 - 0.4 * e;
    if (preset === "whip") {
      value.x += 120 * (1 - e);
      value.rotation -= 8 * (1 - e);
    }
    if (preset === "fade-zoom") {
      value.opacity *= e;
      value.scale *= 0.85 + 0.15 * e;
    }
  }
  if(item.animation_loop && item.animation_loop !== "none") {
    const phase=localTime/Math.max(.1,item.animation_duration)*Math.PI*2;
    if(item.animation_loop === "pulse" || item.animation_loop === "zoom-in") value.scale*=1+.06*Math.sin(phase);
    else if(item.animation_loop === "wobble" || item.animation_loop === "swing") value.rotation+=6*Math.sin(phase);
    else if(item.animation_loop === "shake" || item.animation_loop === "glitch") value.x+=1.4*Math.sin(phase*3);
    else if(item.animation_loop === "float" || item.animation_loop === "bounce") value.y+=2*Math.sin(phase);
    else if(item.animation_loop === "spin-right") value.rotation+=localTime/Math.max(.1,item.animation_duration)*360;
    else if(item.animation_loop === "spin-left") value.rotation-=localTime/Math.max(.1,item.animation_duration)*360;
    else if(item.animation_loop === "fade") value.opacity*=.7+.3*Math.sin(phase);
  }
  if (item.fade_in > 0) value.volume *= clamp(localTime / item.fade_in, 0, 1);
  if (item.fade_out > 0)
    value.volume *= clamp((item.duration - localTime) / item.fade_out, 0, 1);
  return value;
}
export function trimItem(
  item: TimelineItem,
  front: number,
  end: number,
): TimelineItem {
  const duration = Math.max(0.1, end - front),
    originalKeys = item.keyframes;
  const keyframes: Keyframe[] = originalKeys.length
    ? [
        {
          ...valueAt(item, front),
          time: 0,
          easing:
            originalKeys.filter((k) => k.time <= front).at(-1)?.easing ||
            "linear",
        },
        ...originalKeys
          .filter((k) => k.time > front && k.time < end)
          .map((k) => ({ ...k, time: k.time - front })),
        { ...valueAt(item, end), time: duration, easing: "linear" },
      ]
    : [];
  return {
    ...item,
    start: item.start + front,
    source_in: item.kind === "text" ? 0 : item.reverse ? item.source_in + (item.duration-end)*item.speed : item.source_in + front * item.speed,
    duration,
    keyframes,
    ...(item.caption_words ? {caption_words:item.caption_words.filter(w => w.end>front && w.start<end).map(w=>({...w,start:Math.max(0,w.start-front),end:Math.min(duration,w.end-front)}))} : {}),
  };
}
export function parseSrt(text: string): TimelineItem[] {
  const result: TimelineItem[] = [];
  const time = (s: string) => {
    const [h, m, sec] = s.replace(",", ".").split(":").map(Number);
    return h * 3600 + m * 60 + sec;
  };
  for (const block of text
    .replaceAll("\r", "")
    .trim()
    .split(/\n\s*\n/)) {
    const lines = block.split("\n"),
      index = lines.findIndex((l) => l.includes("-->"));
    if (index < 0) continue;
    const match = lines[index].match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );
    if (!match) continue;
    const start = time(match[1]),
      end = Math.min(600, time(match[2]));
    if (end <= start || start >= 600) continue;
    const content = lines
      .slice(index + 1)
      .join("\n")
      .replace(/<[^>]*>/g, "");
    result.push({
      ...newItem("text", undefined, start, 2),
      name: content.slice(0, 40),
      text: content,
      duration: end - start,
      transform: { x: 0, y: 30, scale: 1, rotation: 0, opacity: 1 },
    });
  }
  return result;
}
