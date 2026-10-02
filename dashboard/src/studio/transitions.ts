/**
 * Clip-to-clip transitions: the single source of truth for transition ids,
 * labels, and preview maths.
 *
 * Every function here is PURE. There is no React, no DOM, no `Date.now`, and
 * no randomness, so the same inputs always produce the same output and the
 * behaviour can be asserted directly in a unit test.
 *
 * A transition is NOT a clip animation. Animations (`animation_in` /
 * `animation_out`) move a single clip against the background. A transition
 * blends TWO adjacent overlapping clips against each other, so it needs real
 * overlap between the two items on the same track. See `findTransitionOverlap`.
 *
 * Mirrored on the engine side by `engine/studio/editor_transitions.py`; the two
 * files must expose identical ids.
 */

/** One selectable transition in the inspector / timeline UI. */
export type Transition = {
  /** Stable id. Persisted on the timeline item, so never rename one. */
  id: string;
  /** Human label shown in the <select>. */
  label: string;
  /** Suggested duration in seconds when the user first applies it. */
  duration: number;
};

/**
 * The minimum an object must expose to take part in a transition. Declared
 * structurally (rather than importing `TimelineItem`) so this module stays
 * free of a circular import once `editorModel.ts` adopts the transition ids.
 */
export type TransitionHost = {
  id: string;
  start: number;
  duration: number;
  track?: number;
};

/** The transition window shared by two overlapping clips, in timeline seconds. */
export type TransitionOverlap = {
  /** Absolute timeline time at which the blend begins. */
  start: number;
  /** Length of the blend in seconds. */
  duration: number;
};

/**
 * Visual state for ONE side of a transition at a given instant. Percentages
 * are relative to the canvas (matching the `x`/`y` convention already used by
 * `Transform` in editorModel.ts), so these values can be fed straight into a
 * CSS `transform`.
 */
export type TransitionLayer = {
  opacity: number;
  /** Horizontal offset as a percentage of canvas width. */
  x: number;
  /** Vertical offset as a percentage of canvas height. */
  y: number;
  scale: number;
  /** CSS `clip-path`, or null when the transition does not clip. */
  clipPath: string | null;
  /** CSS `mask-image`, or null. Used by the clock wipe, which is not a clip. */
  mask: string | null;
  /** Gaussian blur radius in px, as a preview hint. 0 means sharp. */
  blur: number;
  /** CSS `brightness()` multiplier. 1 is unchanged. */
  brightness: number;
  /**
   * Block size hint for the pixelize transition, in px. Purely advisory: CSS
   * cannot quantise pixels, so the browser preview approximates this with a
   * scale pulse while the renderer produces true blocky pixels.
   */
  pixelSize: number;
};

/** A fully resolved transition frame. Both clips are described together. */
export type TransitionFrame = {
  /** Raw 0..1 position within the transition window, before easing. */
  progress: number;
  /** Eased 0..1 position actually used for the visuals. */
  eased: number;
  /** The clip fading IN (the later item). */
  incoming: TransitionLayer;
  /** The clip fading OUT (the earlier item). */
  outgoing: TransitionLayer;
};

export const defaultTransitionDuration = 0.6;

/**
 * A transition shorter than this cannot be perceived, and one this short is
 * almost always an accidental overlap from dragging a clip. Rejecting it keeps
 * the timeline honest instead of rendering an unseeable blend.
 */
export const minTransitionOverlap = 0.1;

/** Upper bound shared with the engine-side Pydantic field. */
export const maxTransitionDuration = 5;

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

/** Smoothstep. Matches the ease-in-out curve used by keyframes. */
const smooth = (p: number) => p * p * (3 - 2 * p);

/** Bell curve peaking at 1 when p is 0.5 and falling to 0 at both ends. */
const bell = (p: number) => 1 - Math.abs(2 * p - 1);

const NEUTRAL: TransitionLayer = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  clipPath: null,
  mask: null,
  blur: 0,
  brightness: 1,
  pixelSize: 0,
};

const layer = (overrides: Partial<TransitionLayer>): TransitionLayer => ({
  ...NEUTRAL,
  ...overrides,
});
/**
 * The catalogue. Order is the order shown in the picker: dissolves, then
 * directional moves, then reveals, then stylised effects.
 */
export const transitions: Transition[] = [
  { id: "crossfade", label: "Cross dissolve", duration: 0.6 },
  { id: "dip-to-black", label: "Dip to black", duration: 0.7 },
  { id: "dip-to-white", label: "Dip to white", duration: 0.7 },
  { id: "slide-left", label: "Slide left", duration: 0.6 },
  { id: "slide-right", label: "Slide right", duration: 0.6 },
  { id: "slide-up", label: "Slide up", duration: 0.6 },
  { id: "slide-down", label: "Slide down", duration: 0.6 },
  { id: "push", label: "Push", duration: 0.5 },
  { id: "zoom-blur", label: "Zoom blur", duration: 0.7 },
  { id: "blur", label: "Blur", duration: 0.6 },
  { id: "whip-pan", label: "Whip pan", duration: 0.4 },
  { id: "circle-open", label: "Circle open", duration: 0.7 },
  { id: "circle-close", label: "Circle close", duration: 0.7 },
  { id: "wipe-left", label: "Wipe left", duration: 0.6 },
  { id: "wipe-right", label: "Wipe right", duration: 0.6 },
  { id: "wipe-up", label: "Wipe up", duration: 0.6 },
  { id: "wipe-down", label: "Wipe down", duration: 0.6 },
  { id: "clock-wipe", label: "Clock wipe", duration: 0.7 },
  { id: "pixelize", label: "Pixelize", duration: 0.6 },
  { id: "luma-burn", label: "Luma burn", duration: 0.6 },
];

export const transitionIds: string[] = transitions.map((t) => t.id);

const byId = new Map(transitions.map((t) => [t.id, t]));

/** Look up a catalogue entry. Returns undefined for an unknown id. */
export const findTransition = (id: string): Transition | undefined =>
  byId.get(id);

/** Narrowing guard for values arriving from JSON or a <select>. */
/**
 * Measure the overlap between two ADJACENT timeline items.
 *
 * Returns the blend window in absolute timeline seconds, or null when the two
 * clips do not actually overlap (or overlap by less than
 * `minTransitionOverlap`, which is treated as no overlap at all).
 *
 * Items on different tracks never transition into each other: the renderer
 * stacks tracks, it does not cut between them. Pass items already sorted by
 * `start`; the function picks the earlier one as the outgoing clip.
 */
export function findTransitionOverlap(
  itemA: TransitionHost,
  itemB: TransitionHost,
): TransitionOverlap | null {
  if (itemA.track !== undefined && itemB.track !== undefined) {
    if (itemA.track !== itemB.track) return null;
  }
  const [first, second] =
    itemA.start <= itemB.start ? [itemA, itemB] : [itemB, itemA];
  const start = Math.max(first.start, second.start);
  const end = Math.min(
    first.start + first.duration,
    second.start + second.duration,
  );
  const duration = end - start;
  if (!Number.isFinite(duration) || duration < minTransitionOverlap) {
    return null;
  }
  return { start, duration };
}

/**
 * Resolve which pair of clips is blending at timeline time `time`, if any.
 *
 * This is the bridge between the timeline and the renderer: given the playhead
 * it finds the one adjacent overlapping pair that is mid-blend and returns both
 * clips' resolved visual state. Callers use it to pick which side of the frame
 * belongs to the clip they are drawing.
 *
 * Pure and deterministic — the same (items, time) always returns the same
 * result, so the preview is assertable in a unit test rather than eyeballed.
 */
export function transitionBlend<
  T extends TransitionHost & {
    transition_in?: string;
    transition_duration?: number;
  },
>(
  items: readonly T[],
  time: number,
): { item: T; previous: T; frame: TransitionFrame } | null {
  if (!Number.isFinite(time)) return null;
  const ordered = [...items].sort(
    (a, b) => (a.track ?? 0) - (b.track ?? 0) || a.start - b.start,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const item = ordered[index];
    const identifier = item.transition_in;
    if (!identifier || identifier === "none") continue;
    const previous = ordered[index - 1];
    const overlap = findTransitionOverlap(previous, item);
    if (!overlap) continue;
    // Half-open window: the first frame of the blend belongs to the outgoing
    // clip, the last to the incoming one, so no frame blends twice.
    if (time < overlap.start || time >= overlap.start + overlap.duration)
      continue;
    const length = Math.min(
      item.transition_duration ?? overlap.duration,
      overlap.duration,
    );
    return {
      item,
      previous,
      frame: transitionProgress(identifier, time - overlap.start, length),
    };
  }
  return null;
}

/**
 * Resolve both clips' visual state at local time `t` within a transition of
 * `duration` seconds.
 *
 * `t` is measured from the START of the overlap window, so 0 is the first
 * frame of the blend and `duration` is the frame after the last. Values
 * outside the window are clamped, so callers may pass the raw playhead without
 * range-checking first.
 *
 * Deterministic by construction: the only inputs are the id, `t`, and
 * `duration`, and the easing is a closed-form polynomial. The same call always
 * returns the same frame, which is what makes the result assertable in tests
 * and safe to memoise during preview.
 *
 * Unknown or disabled ids resolve to fully opaque, untransformed layers, i.e.
 * the caller can render unconditionally and a missing transition is a no-op.
 */
export function transitionProgress(
  transitionId: string,
  t: number,
  duration: number,
): TransitionFrame {
  const span = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const progress = clamp(Number.isFinite(t) ? t / span : 0, 0, 1);
  // Most transitions read better with a symmetric ease, but the wipes and the
  // pixelize block must stay linear or the edge lags behind the mask.
  const eased = smooth(progress);
  const frame: TransitionFrame = {
    progress,
    eased,
    incoming: layer({}),
    outgoing: layer({}),
  };
  const p = eased;
  const q = progress;

  switch (transitionId) {
    case "crossfade":
      frame.incoming = layer({ opacity: p });
      frame.outgoing = layer({ opacity: 1 - p });
      break;

    // Both clips fade out to the flat colour and back in, so each is only
    // half-visible at the midpoint and the frame passes through the colour.
    case "dip-to-black":
    case "dip-to-white": {
      const toColor = clamp(1 - bell(q) * 2, 0, 1);
      frame.incoming = layer({ opacity: toColor });
      frame.outgoing = layer({ opacity: toColor });
      break;
    }

    case "slide-left":
      frame.incoming = layer({ x: 100 * (1 - p) });
      frame.outgoing = layer({ x: -100 * p });
      break;
    case "slide-right":
      frame.incoming = layer({ x: -100 * (1 - p) });
      frame.outgoing = layer({ x: 100 * p });
      break;
    case "slide-up":
      frame.incoming = layer({ y: 100 * (1 - p) });
      frame.outgoing = layer({ y: -100 * p });
      break;
    case "slide-down":
      frame.incoming = layer({ y: -100 * (1 - p) });
      frame.outgoing = layer({ y: 100 * p });
      break;

    // Push differs from a slide: the outgoing clip leaves at full speed while
    // the incoming one decelerates, which reads as pressure rather than a
    // conveyor belt. The slight incoming scale sells the direction change.
    case "push":
      frame.incoming = layer({ x: 100 * (1 - q), scale: 1 - 0.04 * (1 - q) });
      frame.outgoing = layer({ x: -100 * q });
      break;

    // Zoom through the outgoing clip. Blur is strongest at the midpoint, where
    // both clips are least visible, so the softness hides the seam.
    case "zoom-blur":
      frame.incoming = layer({
        opacity: p,
        scale: 0.82 + 0.18 * p,
        blur: 26 * bell(q),
      });
      frame.outgoing = layer({
        opacity: 1 - p,
        scale: 1 + 0.25 * (1 - q),
        blur: 26 * bell(q),
      });
      break;

    case "blur":
      frame.incoming = layer({ opacity: p, blur: 22 * bell(q) });
      frame.outgoing = layer({ opacity: 1 - p, blur: 22 * bell(q) });
      break;

    // A whip pan is a slide with motion blur and a faster, snappier curve.
    case "whip-pan":
      frame.incoming = layer({
        x: 100 * (1 - q),
        blur: 30 * bell(q),
        scale: 1.05 - 0.05 * q,
      });
      frame.outgoing = layer({
        x: -100 * q,
        blur: 30 * bell(q),
        scale: 0.97 + 0.03 * q,
      });
      break;
    // Clip paths are expressed as percentages so they track the canvas at any
    // preview size, exactly as the renderer sizes its own masks.
    case "circle-open":
      frame.incoming = layer({
        clipPath: `circle(${(75 * q).toFixed(3)}% at 50% 50%)`,
      });
      break;
    case "circle-close":
      frame.outgoing = layer({
        clipPath: `circle(${(75 * (1 - q)).toFixed(3)}% at 50% 50%)`,
      });
      break;

    case "wipe-left":
      frame.incoming = layer({
        clipPath: `inset(0 ${((1 - q) * 100).toFixed(3)}% 0 0)`,
      });
      break;
    case "wipe-right":
      frame.incoming = layer({
        clipPath: `inset(0 0 0 ${((1 - q) * 100).toFixed(3)}%)`,
      });
      break;
    case "wipe-up":
      frame.incoming = layer({
        clipPath: `inset(${((1 - q) * 100).toFixed(3)}% 0 0 0)`,
      });
      break;
    case "wipe-down":
      frame.incoming = layer({
        clipPath: `inset(0 0 ${((1 - q) * 100).toFixed(3)}% 0)`,
      });
      break;

    // A sweep is a mask rather than a clip, so the incoming clip stays whole.
    case "clock-wipe":
      frame.incoming = layer({
        mask: `conic-gradient(#000 ${(q * 360).toFixed(2)}deg, #0000 0deg)`,
      });
      break;

    // CSS cannot quantise pixels, so the preview fakes the block-in with a
    // scale pulse plus a coarse pixel hint. The renderer emits real blocks.
    case "pixelize":
      frame.incoming = layer({
        opacity: p,
        scale: 1 + 0.12 * bell(q),
        pixelSize: Math.round(2 + 22 * bell(q)),
      });
      frame.outgoing = layer({
        opacity: 1 - p,
        scale: 1 - 0.12 * bell(q),
        pixelSize: Math.round(2 + 22 * bell(q)),
      });
      break;

    // Additive-looking burn: both clips brighten towards white as they cross.
    case "luma-burn":
      frame.incoming = layer({ opacity: p, brightness: 1 + 0.85 * bell(q) });
      frame.outgoing = layer({
        opacity: 1 - p,
        brightness: 1 + 0.85 * bell(q),
      });
      break;

    // 'none' and any unrecognised id render as a plain cut.
    default:
      break;
  }
  return frame;
}
export const isTransitionId = (id: unknown): id is string =>
  typeof id === "string" && byId.has(id);
