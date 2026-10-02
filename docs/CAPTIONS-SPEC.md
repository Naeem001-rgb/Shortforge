# Caption styling: export-parity spec

Everything in this file is implemented twice and must stay in step:

| Side | File | What it does |
| --- | --- | --- |
| Preview | `dashboard/src/studio/textPresets.ts` | `textAppearance()` for the line, `captionWords()` / `captionWordAppearance()` per word |
| Export | `engine/studio/captions.py` | `caption_ass()` writes the ASS document FFmpeg burns in |

`dashboard/src/studio/textPresets.ts` owns the new defaults
(`modernTextStyle`). `engine/studio/captions.py` mirrors them in
`CAPTION_DEFAULTS` and reads them with `getattr`, so a caption keeps rendering
on an engine whose `TextStyle` has not gained the columns yet. Nothing crashes;
the new effects are simply ignored until the model knows about them.

## Wiring the model

`editor_render.write_text()` should become a thin wrapper so there is exactly
one ASS builder:

```python
def write_text(item, width, height, directory, index, ratio):
    from .captions import caption_ass
    name = f'text-{index}.ass'
    (directory / name).write_text(caption_ass(item, width, height, ratio), encoding='utf-8')
    return name
```

Then paste this block into `TextStyle` in `engine/studio/editor_models.py`,
after the existing `highlight` line. Nothing else in the model changes.

```python
    case_style: Literal['none','upper','lower','title','sentence'] = 'none'
    line_height: float = Field(1, ge=.6, le=3)
    emphasis: Literal['none','pop','tilt','flash','shake'] = 'none'
    emphasis_scope: Literal['all','key'] = 'all'
    emphasis_words: Literal['none','all','first','last','longest','keyword'] = 'none'
    emphasis_keywords: list[str] = Field(default_factory=list, max_length=40)
    emphasis_case: Literal['none','upper','lower'] = 'none'
    emphasis_bold: bool = True
    emphasis_color: str = Field('#f9e54c', pattern=r'^#[0-9a-fA-F]{6}$')
    color_ramp: Literal['none','words'] = 'none'
    ramp_color: str = Field('#ff2d55', pattern=r'^#[0-9a-fA-F]{6}$')
    glow: float = Field(0, ge=0, le=16)
    glow_color: str = Field('#7c5cff', pattern=r'^#[0-9a-fA-F]{6}$')
    shadow_color: str = Field('#000000', pattern=r'^#[0-9a-fA-F]{6}$')
    shadow_opacity: float = Field(.5, ge=0, le=1)
    shadow_soft: float = Field(0, ge=0, le=24)
    box_padding: float = Field(0, ge=0, le=160)
    chip: Literal['none','emphasis'] = 'none'
```

`emphasis_keywords` accepts any string today. If you want a hard length cap per
entry, add `from typing import Annotated` and use
`list[Annotated[str, Field(max_length=40)]]`.

Until this lands, saving a project that uses one of the new presets fails with
`422 items.0.text_style.emphasis: Extra inputs are not permitted` (the model is
`extra='forbid'`). The dashboard only writes the new fields when a value differs
from its default, so untouched captions keep saving fine.

## Shared vocabulary

Both sides compute the same three things before styling anything.

1. **Caption string** — `item.text`, uppercased when `uppercase` is set, then
   folded by `case_style`. `foldCase()` (TS) and `fold_case()` (Python).
2. **Words** — `text.match(/\S+\s*/g)` (TS) and `re.findall(r"\S+\s*", text)`
   (Python). Trailing whitespace rides along with each word, so the spaces
   exist in the ASS line too.
3. **Word slices** — word `i` is current for `[i·duration/n, (i+1)·duration/n]`.
   This is the existing karaoke rule, unchanged. The word that is current is the
   only one that animates.

`emphasis_words` then picks the *key* words, deterministically, with the same
code on both sides: `all`, `first` (`0`), `last` (`n-1`), `longest` (longest
`word.trim()`, earliest wins a tie) and `keyword` (lowercased, stripped to
`[a-z0-9]`, compared against `emphasis_keywords`).

## New TextStyle fields

`ratio` is `resolution / 1080` in the export and the canvas scale in the
preview, so every pixel-ish value is written as `value * ratio` in ASS and
`value * scale` in CSS.

### `case_style`

- Type: `"none" | "upper" | "lower" | "title" | "sentence"`
- Default: `"none"`
- ASS: no override tag. The string is folded before it is escaped, so the
  exported text is literally the folded text.
- Notes: `title` upper-cases the first character of every whitespace-delimited
  run; `sentence` upper-cases the first `a-z` in the string and lower-cases the
  rest. Both implementations search for ASCII `[a-z]` so accented input folds
  the same way on both sides.

### `line_height`

- Type: `number`
- Default: `1`
- ASS: `{\fsp<font_size × ratio × (line_height − 1)>}` as the first override
  block of every event for this caption, including the glow, shadow and box
  layers so all of them break lines identically.
- Preview: `line-height: line_height × 1.16`. The 1.16 is libass's natural
  leading for DejaVu Sans (`FONT_LEADING` in both files) — without it the
  preview would sit visibly tighter than the export.
- Caveat: ASS has no line-height *style field*. The eighth numeric slot of a
  V4+ style line is the baseline angle, so it stays `0` and `\fsp` does the
  work.

### `emphasis`

- Type: `"none" | "pop" | "tilt" | "flash" | "shake"`
- Default: `"none"`
- ASS: one override block on the current word, inside that word's own block:

  | value | tag |
  | --- | --- |
  | `pop` | `\fscx135\fscy135\t(0,180,\fscx100\fscy100)` |
  | `tilt` | `\frz-14\t(0,180,\frz0)` |
  | `flash` | `\alpha&H40&\t(0,180,\alpha&H00&)` |
  | `shake` | `\frz-7\t(0,70,\frz7)\t(70,180,\frz0)` |

- Preview: the same motion as a CSS keyframe animation
  (`CAPTION_CSS` in `textPresets.ts`), started at 135% / −14° / 25% opacity /
  −7° and settled to rest over the same 180 ms. The class is removed when the
  word stops being current, which truncates the motion at exactly the moment
  the ASS event ends, so short slices behave the same on both sides.
- Timing: the caption is emitted as one event per word slice so the motion can
  start when its word starts rather than when the line appears. A
  `reveal: "typewriter"` caption wins over the motion, and its glow, shadow and
  box layers grow with the reveal instead.

### `emphasis_scope`

- Type: `"all" | "key"`
- Default: `"all"`
- ASS: no tag. Decides whether the `emphasis` block is written onto every
  current word or only onto a current word that is also a key word.

### `emphasis_words`

- Type: `"none" | "all" | "first" | "last" | "longest" | "keyword"`
- Default: `"none"`
- ASS: no tag of its own. It decides which words receive `\1c<emphasis_color>`
  and `\b1` in their own override block, which is the honest ASS way to mark a
  word: the block ends on the next word, so nothing leaks sideways.
- This is the marker a template uses to say which words matter.

### `emphasis_keywords`

- Type: `string[]`, at most 40 entries
- Default: `[]`
- ASS: none. It is the input to the `keyword` selector above.

### `emphasis_case`

- Type: `"none" | "upper" | "lower"`
- Default: `"none"`
- ASS: no tag. Only the key words' strings are folded, so a caption can be
  lowercase with one shouted word — the mixed-case emphasis look.
- Preview: identical folding in `captionWords()`.

### `emphasis_bold`

- Type: `boolean`
- Default: `true`
- ASS: `\b1` inside the key word's override block.
- Preview: `font-weight: 800` on that word (700 when the caption is bold).

### `emphasis_color`

- Type: `string` (`#rrggbb`)
- Default: `"#f9e54c"`
- ASS: `\1c&H<BBGGRR>&` inside the key word's override block.

### `color_ramp`

- Type: `"none" | "words"`
- Default: `"none"`
- ASS: `\1c&H<BBGGRR>&` on **every** word, with the colour interpolated
  between `item.color` (word 0) and `ramp_color` (last word) in sRGB.
- **This is a discrete per-word blend, not a true gradient fill.** ASS has no
  gradient text primitive. The preview renders the same per-word blend rather
  than a CSS `linear-gradient`, precisely so the two agree; do not "improve" the
  preview into a real gradient or the export will drift.
- Rounding is `Math.round` in TS and `int(x + 0.5)` in Python so both pick the
  same byte.

### `ramp_color`

- Type: `string` (`#rrggbb`)
- Default: `"#ff2d55"`
- ASS: the far end of the blend described above.

### `glow`

- Type: `number`, 0–16
- Default: `0`
- ASS: two extra `Dialogue` events on **layer 0**, styled `Glow`
  (`BorderStyle 1`, `Outline 0`, every colour = `glow_color`), carrying the
  untagged caption text:

  | ring | tag |
  | --- | --- |
  | tight, bright | `\bord<glow × ratio × 0.55>\shad0\blur<glow × ratio × 0.15>\alpha&H1A&` |
  | wide, faint | `\bord<glow × ratio × 1.0>\shad0\blur<glow × ratio × 0.3>\alpha&H8C&` |

  (`&H1A&` / `&H8C&` are `&H…&` wrappers around `round((1 − alpha) × 255)` for
  alpha 0.9 and 0.45. The `&H..&` wrapper is not optional: `\alpha` swallows
  hex digits greedily and the rest of the colour would otherwise be drawn as
  text. This was a real bug, caught by rendering frames through libass.)
- Preview: two `text-shadow` rings, `0 0 glow·0.55·scale` at 0.9 alpha and
  `0 0 glow·1.4·scale` at 0.45 alpha.
- Honest difference: libass strokes and CSS blurs, so the halo is a little
  harder-edged in the MP4. Same colour, same radius, same intent.

### `glow_color`

- Type: `string` (`#rrggbb`)
- Default: `"#7c5cff"`
- ASS: every colour slot of the `Glow` style, `&H00BBGGRR`.

### `shadow_color`

- Type: `string` (`#rrggbb`)
- Default: `"#000000"`
- ASS: the `BackColour` slot of **every** style, so it drives the existing hard
  `shadow` as well as `shadow_soft`. With the defaults this is `&H80000000`,
  byte for byte what the old builder hard-coded.

### `shadow_opacity`

- Type: `number`, 0–1
- Default: `0.5`
- ASS: the alpha byte of that `BackColour`, `round((1 − opacity) × 255)`.
- Preview: the alpha of the `rgba()` shadow colour.

### `shadow_soft`

- Type: `number`, 0–24
- Default: `0`
- ASS: one extra `Dialogue` on **layer 1**, styled `Soft` (`BorderStyle 1`,
  `Outline 0`, `Shadow 0`, fill = `shadow_color`), tagged
  `\shad<soft × ratio × 0.4>\blur<soft × ratio × 0.5>\alpha&H…&`.
- Preview: one `text-shadow` with a `soft × scale × 0.9` blur radius.
- Honest difference: same as glow — a blurred, offset copy of the glyphs, not a
  real drop-shadow filter.

### `box_padding`

- Type: `number`, 0–160
- Default: `0`
- ASS: when `text_background` is not `transparent`, an extra `Dialogue` on
  **layer 2** styled `Box` with `BorderStyle 3` and
  `Outline = max(2, box_padding × ratio)`. For `BorderStyle 3` libass uses
  `Outline` as the box padding, so this is the honest equivalent of CSS
  padding. `0` falls back to `max(2, font_size × 0.14)`, which is the padding
  the old builder used.
- Preview: `padding` on the caption element, plus a border radius and a soft
  `box-shadow`.
- Honest difference: the preview rounds the box corners and the export cannot;
  ASS boxes are square. The padding itself matches.

### `chip`

- Type: `"none" | "emphasis"`
- Default: `"none"`
- **PREVIEW ONLY. Not rendered in the export.**
- ASS cannot fill a background behind one word of a line. Doing it properly
  would mean splitting the caption into positioned events and hand-estimating
  DejaVu's advance widths, which drifts as soon as the text is not centred, so
  it is not attempted.
- What the export does instead: the key word keeps `emphasis_color` and
  `\b1`, and the generated ASS carries a machine-readable marker so the gap can
  never pass unnoticed:

  ```
  Comment: 0,0:00:00.00,0:10:00.00,Default,,0,0,0,,preview-only, not rendered: chip
  ```

- The dashboard labels it too: the Word chip control in the inspector prints
  "The word chip is preview only…", and the two presets that use it
  (`quote-italic`, `soft-card`) carry `previewOnly: ["chip"]`, which the
  template card prints under the name.

## Existing fields, unchanged

`bold`, `italic`, `uppercase`, `align`, `stroke`, `stroke_color`, `shadow`,
`letter_spacing`, `reveal` and `highlight` keep their meaning and their ASS
mapping. Two notes:

- `reveal: "karaoke"` still emits `\k<centiseconds>` per word, **not** `\kf`.
  `\k` flips a whole syllable to the highlight colour when it becomes current,
  which is exactly what the canvas does. `\kf` would sweep within the word and
  disagree with the preview, and it also made the existing karaoke regression
  test in `test_editor.py` marginal.
- `uppercase` runs before `case_style`, so `uppercase: true` plus
  `case_style: "lower"` is lower case.

## What is genuinely exportable, and what is not

| Capability | Export | Notes |
| --- | --- | --- |
| Per-word emphasis colour, weight, case | Yes | `\1c`, `\b1`, string folding |
| Word-level motion on the spoken word | Yes | `\fscx`/`\fscy`/`\frz`/`\alpha` with `\t()` |
| Colour blend across words | Yes | per-word `\1c`; a blend, **not** a true gradient fill |
| Outer glow | Yes | two stacked outline events, layer 0 |
| Soft shadow | Yes | one blurred offset event, layer 1 |
| Background box with padding | Yes | `BorderStyle 3`, `Outline` = padding |
| Casing, title case, sentence case | Yes | folded into the string |
| Line spacing | Yes | `\fsp` |
| Letter spacing, stroke, hard shadow, alignment | Yes | unchanged |
| Karaoke and typewriter reveals | Yes | unchanged, typewriter wins over motion |
| Rounded box corners | **No** | preview only, ASS boxes are square |
| Per-word background chip | **No** | preview only, flagged in the ASS and in the UI |
| True gradient text fill | **No** | shipped as the honest per-word blend instead |

## Known gaps outside these two files

- `EditorPreview.tsx` still renders captions with its own single-span markup
  (`textAppearance` + a flat `caption.words.map`). It picks up the box padding,
  glow, soft shadow, line spacing and white-space handling, but **not** the
  per-word colour, weight, case or motion. The shared renderer is exported as
  `CaptionLine` from `EditorTemplates.tsx`; swapping the canvas over to it is
  a two-line change in the file that owns it:

  ```tsx
  import { CaptionLine } from "./EditorTemplates";
  // ...
  <CaptionLine item={item} scale={size.width / project.width} localTime={time - item.start} />
  ```

  The template cards and the inspector preview already use it, which is where
  the screenshots in `.impeccable/review/editor/subs-*.png` come from.
- The engine needs the `write_text` change at the top of this file before any
  of the new effects reach an exported MP4.

## Verification performed

- `cd dashboard && npx tsc --noEmit` — clean.
- `cd dashboard && npx prettier --check src vite.config.ts playwright.config.ts tests`
  — clean for every file in this change. `src/studio/transitions.ts` is
  reported unformatted; it belongs to another agent and was left alone.
- `.venv/bin/python -m pytest engine/studio -q` — 41 passed, 1 skipped.
- `caption_ass()` output rendered through the bundled libass for seven styles
  (keyword bounce, sunset ramp, neon purple, boxed, quote italic, karaoke,
  typewriter). All produced frames with no libass warnings. This is how the
  `\alpha` bug above was found.
- Headless Chromium against the running app: 30 templates across 6 categories,
  four templates applied to a live caption, inspector controls exercised.
  Screenshots in `.impeccable/review/editor/subs-*.png`.
- Saving a caption that uses a new field returns
  `422 … Extra inputs are not permitted` until the model block above is pasted
  in. Confirmed directly against the running engine.
