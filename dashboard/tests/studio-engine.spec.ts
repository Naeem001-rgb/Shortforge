import { expect, test } from "@playwright/test";
import {
  defaultTextStyle,
  easeProgress,
  newItem,
  parseSrt,
  trimItem,
  valueAt,
} from "../src/studio/editorModel";
import type { EditorProject, TimelineItem } from "../src/studio/editorModel";
import {
  addKeyframe,
  captionItems,
  groupItems,
  pasteItems,
  projectSrt,
  removeItems,
  splitAt,
  tracksOf,
} from "../src/studio/timelineOps";
import {
  audibleGain,
  layoutCaption,
  sourceTime,
} from "../src/studio/engine/renderFrame";

const project = (items: TimelineItem[]): EditorProject => ({
  version: 1,
  width: 1080,
  height: 1920,
  fps: 30,
  background: "#000000",
  items,
});
const video = (patch: Partial<TimelineItem> = {}): TimelineItem => ({
  ...newItem("video"),
  name: "Synthetic unit fixture",
  duration: 4,
  ...patch,
});

test("one-frame and ordinary splits preserve duration, source continuity and input immutability", () => {
  for (const reverse of [false, true])
    for (const at of [1 / 30, 1.5, 4 - 1 / 30]) {
      const item = video({ source_in: 2, speed: 1.5, reverse });
      const before = structuredClone(item);
      const result = splitAt(project([item]), [item.id], at);
      expect(result.items).toHaveLength(2);
      const [left, right] = result.items;
      expect(left.start).toBe(0);
      expect(left.duration).toBeCloseTo(at, 9);
      expect(right.start).toBeCloseTo(at, 9);
      expect(left.duration + right.duration).toBeCloseTo(4, 9);
      expect(right.start + right.duration).toBeCloseTo(4, 9);
      expect(sourceTime(left, Math.max(0, at - 0.00001))).toBeCloseTo(
        sourceTime(right, at),
        3,
      );
      expect(new Set(result.items.map((i) => i.id)).size).toBe(2);
      expect(item).toEqual(before);
    }
});

test("trim rebases linear keyframes and word timings without changing the retained frame", () => {
  const item = video({
    start: 3,
    source_in: 1,
    speed: 2,
    caption_words: [
      { word: "first", start: 0, end: 1.2 },
      { word: "middle", start: 1.2, end: 2 },
      { word: "last", start: 2, end: 3.5 },
    ],
  });
  item.keyframes = [
    {
      ...item.transform,
      time: 0,
      x: 0,
      volume: 1,
      easing: "linear",
      values: { "adjustments.exposure": 0 },
    },
    {
      ...item.transform,
      time: 4,
      x: 40,
      volume: 0,
      easing: "linear",
      values: { "adjustments.exposure": 2 },
    },
  ];
  const trimmed = trimItem(item, 1, 3);
  expect(trimmed.start).toBe(4);
  expect(trimmed.source_in).toBe(3);
  expect(trimmed.duration).toBe(2);
  expect(trimmed.caption_words).toEqual(
    [
      { word: "first", start: 0, end: 0.2 },
      { word: "middle", start: 0.2, end: 1 },
      { word: "last", start: 1, end: 2 },
    ].map((w) => ({
      ...w,
      start: expect.closeTo(w.start, 8),
      end: expect.closeTo(w.end, 8),
    })),
  );
  for (const t of [0, 0.5, 1, 2]) {
    expect(valueAt(trimmed, t).x).toBeCloseTo(valueAt(item, t + 1).x, 8);
    expect(valueAt(trimmed, t).values?.["adjustments.exposure"]).toBeCloseTo(
      valueAt(item, t + 1).values!["adjustments.exposure"],
      8,
    );
  }
});

test("ripple deletion unions overlapping spans and respects track locks", () => {
  const a = video({ start: 1, duration: 3 }),
    b = video({ start: 2, duration: 3 }),
    later = video({ start: 8 }),
    locked = video({ start: 8, track: 1 });
  const p = project([a, b, later, locked]);
  p.tracks = tracksOf(p).map((t) => ({ ...t, locked: t.id === 1 }));
  const result = removeItems(p, [a.id, b.id, locked.id], true);
  expect(result.items.map((i) => [i.id, i.start])).toEqual([
    [later.id, 4],
    [locked.id, 8],
  ]);
  expect(splitAt(p, [locked.id], 9).items).toHaveLength(4);
});

test("copying a group gives independent IDs and relative timing, clipping only outside the project limit", () => {
  const a = video({ start: 2 }),
    b = video({ start: 4, track: 1 });
  const grouped = groupItems(project([a, b]), [a.id, b.id]);
  const result = pasteItems(grouped, grouped.items, 10);
  const copies = result.project.items.slice(2);
  expect(copies.map((i) => i.start)).toEqual([10, 12]);
  expect(copies[0].group_id).toBe(copies[1].group_id);
  expect(copies[0].group_id).not.toBe(grouped.items[0].group_id);
  expect(new Set(result.project.items.map((i) => i.id)).size).toBe(4);
  copies[0].transform.x = 80;
  expect(grouped.items[0].transform.x).toBe(0);
  expect(pasteItems(grouped, grouped.items, 597).ids).toHaveLength(0);
});

test("easing handles endpoints, monotone curves, hold and spring overshoot", () => {
  for (const ease of [
    "linear",
    "ease-in",
    "ease-out",
    "ease-in-out",
    "hold",
    "spring",
    "bounce",
    "cubic-bezier",
  ] as const) {
    expect(easeProgress(0, ease)).toBeCloseTo(0, 4);
    expect(easeProgress(1, ease)).toBeCloseTo(1, 4);
  }
  expect(easeProgress(0.999, "hold")).toBe(0);
  expect(easeProgress(0.5, "ease-in")).toBe(0.25);
  expect(easeProgress(0.5, "ease-out")).toBe(0.75);
  expect(easeProgress(0.5, "cubic-bezier", [0.42, 0, 0.58, 1])).toBeCloseTo(
    0.5,
    4,
  );
  const values = Array.from({ length: 101 }, (_, n) =>
    easeProgress(n / 100, "cubic-bezier", [0.42, 0, 0.58, 1]),
  );
  expect(values.every((v, n) => n === 0 || v >= values[n - 1])).toBe(true);
  expect(
    Math.max(
      ...Array.from({ length: 100 }, (_, n) => easeProgress(n / 100, "spring")),
    ),
  ).toBeGreaterThan(1);
});

test("numeric keyframes interpolate properties and replace a same-time key", () => {
  let item = video({ start: 2, adjustments: { exposure: 1 } });
  item = addKeyframe(item, 2, "adjustments.exposure");
  item = {
    ...item,
    adjustments: { exposure: 3 },
    transform: { ...item.transform, x: 40 },
  };
  item = addKeyframe(item, 6, "adjustments.exposure");
  expect(valueAt(item, 2).values?.["adjustments.exposure"]).toBeCloseTo(2, 6);
  expect(item.keyframes.map((k) => k.time)).toEqual([0, 4]);
  expect(addKeyframe(item, 6, "adjustments.exposure").keyframes).toHaveLength(
    2,
  );
});

test("caption grouping retains actual timestamps and SRT round-trips timing and text", () => {
  const words = [
    { word: "Three", start: 2, end: 2.3 },
    { word: "timed", start: 2.45, end: 2.9 },
    { word: "words", start: 3.1, end: 3.7 },
    { word: "next", start: 4.5, end: 5 },
    { word: "invalid", start: 6, end: 5 },
  ];
  const items = captionItems(words, 10, 3);
  expect(items.map((i) => i.start)).toEqual([12, 14.5]);
  expect(items[0].duration).toBeCloseTo(1.7, 8);
  expect(items[0].caption_words?.[1].start).toBeCloseTo(0.45, 8);
  const reloaded = parseSrt(projectSrt(project(items)));
  expect(reloaded.map((i) => [i.text, i.start, i.duration])).toEqual(
    items.map((i) => [i.text, i.start, expect.closeTo(i.duration, 3)]),
  );
});

test("caption layout preserves indices over wrapping and explicit paragraph breaks", () => {
  const ctx = {
    measureText: (text: string) => ({ width: text.length * 10 }),
  } as CanvasRenderingContext2D;
  const item = {
    ...newItem("text"),
    text: "one two three\nfour five",
    text_style: { ...defaultTextStyle, letter_spacing: 2 },
  };
  const layout = layoutCaption(ctx, item, 90);
  expect(layout.lines.map((line) => line.map((w) => w.text))).toEqual([
    ["one", "two"],
    ["three"],
    ["four"],
    ["five"],
  ]);
  expect(layout.lines.flat().map((word) => word.index)).toEqual([
    0, 1, 2, 3, 4,
  ]);
  expect(layout.lineWidths).toEqual([78, 58, 46, 46]);
  expect(layout.height).toBe(4 * item.font_size);
});

test("source timing and audio track flags obey reverse, freeze, mute and ducking", () => {
  const item = video({ start: 2, source_in: 3, speed: 2 });
  expect(sourceTime(item, 3)).toBe(5);
  expect(sourceTime({ ...item, reverse: true }, 3)).toBeCloseTo(9, 3);
  expect(sourceTime({ ...item, freeze_at: 7 }, 3)).toBe(7);
  const voice = video({
    kind: "audio",
    start: 3,
    duration: 1,
    track: 1,
    audio_role: "voiceover",
  });
  const music = {
    ...item,
    kind: "audio" as const,
    audio_role: "music" as const,
    ducking: true,
  };
  const p = project([music, voice]);
  expect(audibleGain(p, music, 2)).toBe(1);
  expect(audibleGain(p, music, 3.5)).toBeCloseTo(0.22, 8);
  p.tracks = tracksOf(p).map((t) => ({ ...t, muted: t.id === 1 }));
  expect(audibleGain(p, music, 3.5)).toBe(1);
  p.tracks[0].hidden = true;
  expect(audibleGain(p, music, 3.5)).toBe(0);
  expect(audibleGain(project([item]), { ...item, freeze_at: 7 }, 3)).toBe(0);
});
