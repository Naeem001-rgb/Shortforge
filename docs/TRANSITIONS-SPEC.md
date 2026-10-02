# Transitions — integration spec

Author: Transitions engineer (`trans`). Owns exactly two new files:

- `dashboard/src/studio/transitions.ts`
- `engine/studio/editor_transitions.py`

Everything below is a **hand-off**: the edits in sections 1–6 are for the lead
to apply. I could not make them myself because those files are owned by other
agents working in parallel. Both modules are complete, importable and verified;
this document is the wiring.

---

## 0. Read this first: two findings that contradict the original brief

The brief said the renderer "renders each item to a normalized intermediate then
concatenates". **It does not.** `editor_render.py` builds a single flat
`overlay` graph:

```
color=background  -> [base]
each item         -> [layerN]  (normalised, alpha, set to absolute PTS)
overlay chain     -> [v0][v1]...[video]
```

Verified by reading `build_render_command` (editor_render.py:162–229) and by
grepping: there is **no `concat=` and no `xfade` anywhere in `engine/studio`.**
Consequences:

1. **Do not insert an xfade chain.** xfade consumes two *sequential streams* and
   emits one. This renderer has many *parallel* layers over one canvas. Bolting
   an xfade chain in would require restructuring the whole graph, and would
   break multi-track compositing (text over video, which the current model
   supports and the tests assert).
2. **The hook is the per-layer alpha ramp that already exists.**
   editor_render.py:203–204 already emits
   `geq=...:a='alpha(X,Y)*({opacity})'` with a per-frame expression. A cross-clip
   blend is the same mechanism applied to two overlapping layers. I proved this
   compositing model is exact:

   ```
   red (opaque) + blue (alpha = clip((T-2)/1,0,1))
   t=1.5 -> rgb(254,  0,  0)   red
   t=2.5 -> rgb(127,  0,127)   EXACTLY 50/50
   t=3.5 -> rgb(  0,  0,255)   blue
   ```

3. `xfade_filter()` is still delivered, because it is the correct primitive for
   the *audio* crossfade and for a future single-track render path, and because
   it pins each id to a real, verified FFmpeg effect name. But the visual hook is
   `transition_alpha_expression()`.

### FFmpeg capability constraints (probed on the bundled 7.0.2 build)

These decide which effects are buildable in the overlay graph:

| Capability | Result | Impact |
|---|---|---|
| `geq` alpha `a=` | accepts `X, Y, W, H, T` | masks, wipes, circles all possible |
| `geq` `T` is **item-local** | verified | ramps are written in clip-local time |
| `gblur` `sigma` | **rejected** time expressions | no continuous blur; use static + `enable=` |
| `boxblur` radius | **rejected** time expressions | same |
| `unsharp` `luma_amount` | **rejected** time expressions | same |
| `scale` `w`/`h` | `eval=frame` **works** | pixelize is buildable |
| `perspective` | `eval=frame` **works** | slides/push/zoom are buildable |
| `xfade` | 58 named effects | used for audio + future paths |

**Design consequence:** "blur" and "zoom-blur" cannot ramp continuously inside
the overlay graph. Render them as a *static* blur gated by an `enable=` window
that is only on during the blend. This is a deliberate, documented compromise —
visually correct at the seam, cheaper than a per-frame blur, and it keeps the
preview honest. See section 3.4.
---

## 1. Model changes — `engine/studio/editor_models.py`

### 1.1 The `TransitionName` alias

Insert immediately after the existing `Animation` literal (line 5). Do **not**
hand-type it; paste the output of the helper so the two catalogues cannot drift:

```bash
.venv/bin/python -c "from engine.studio.editor_transitions import transition_id_literal as f; print(f())"
```

Produces a single line beginning
`TransitionName = Literal['none', 'blur', ...` with all 21 members.

### 1.2 Fields on `TimelineItem`

Add two fields, placed next to the existing animation fields (after line 51):

```python
    transition_in: TransitionName = 'none'
    transition_duration: float = Field(0.6, ge=0.1, le=5)
```

- `transition_in` describes the blend **entering this item**, i.e. this item is
  the *incoming* clip. The outgoing side is derived from the previous item on
  the same track — no second field is needed, and storing one would let the two
  halves disagree.
- `transition_duration` is shared by both halves of a pair.
- Bounds `ge=0.1, le=5` mirror `MIN_TRANSITION_OVERLAP` / `MAX_TRANSITION_DURATION`.
- `'none'` is a real member of the literal so the field can be omitted in JSON
  and older saved projects still validate (`extra='forbid'` is already set, so
  the names must match exactly).

### 1.3 Import

```python
from .editor_transitions import (
    MAX_TRANSITION_DURATION, MIN_TRANSITION_OVERLAP,
    NO_TRANSITION, TransitionName, validate_transition,
)
```

---

## 2. TS type changes — `dashboard/src/studio/editorModel.ts`

### 2.1 Union

Add after the `Animation` union (line 15). Keep it in sync with the Python
literal; the sanity script asserts the two id sets are identical:

```ts
import { transitionIds } from "./transitions";

export type TransitionId =
  | "none" | "crossfade" | "dip-to-black" | "dip-to-white"
  | "slide-left" | "slide-right" | "slide-up" | "slide-down"
  | "push" | "zoom-blur" | "blur" | "whip-pan"
  | "circle-open" | "circle-close" | "wipe-left" | "wipe-right"
  | "wipe-up" | "wipe-down" | "clock-wipe" | "pixelize" | "luma-burn";

// Compile-time guard: every catalogue id must exist in the union above.
const _idsMatch: TransitionId[] = transitionIds as TransitionId[];
```

Declaring the union literally (rather than aliasing `Transition["id"]`, which is
just `string`) is what turns a typo into a compile error instead of a runtime
rejection.

Then in `TimelineItem` (after line 68):

```ts
---

## 3. Renderer hook — `engine/studio/editor_render.py`

### 3.1 Where exactly

Inside the `for index,item in sorted(...)` loop (line 174). The insertion point
is **between line 204 (`opacity=...` / the `geq`) and line 205
(`setpts=PTS+start/TB`)**. That ordering is load-bearing and must not change:

- the `geq` must run **before** `setpts`, so `T` is item-local (verified), and
- the transition ramp is expressed in item-local time.

Current code:

```python
        opacity=visual_expression(item,'opacity','T')
        if opacity!='1': head+=f",geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*({opacity})'"
        head+=f',setpts=PTS+{number(item.start)}/TB[layer{index}]'
```

### 3.2 Precompute the pairs (before the loop, near line 174)

```python
    blends = transition_map(project)
```

where `transition_map` pairs each item with its predecessor **on the same
track** and returns `{item_id: (blend_local_start, blend_length, transition_id)}`
using `transition_overlap()` from `editor_transitions.py`. Computing it once
outside the loop keeps the O(n²) pairing out of the hot path and guarantees both
halves of a pair agree on the window.

### 3.3 The offset, derived from cumulative durations

For item *N* overlapping item *N-1* on the same track:

```
window_start  = max(prev.start,  item.start)      # absolute timeline seconds
window_length = min(prev.end,    item.end) - window_start
blend_start   = window_start - item.start          # ITEM-LOCAL, for the geq T
blend_length  = min(item.transition_duration, window_length)
```

`blend_start` is the crux: `geq`'s `T` is item-local, so the absolute window
start **must** have `item.start` subtracted or the ramp fires at the wrong frame.
Clamp `blend_length` to `window_length` — a ramp longer than the real overlap
would extend the clip beyond its own duration.

### 3.4 The filter fragment

Replace the block above with:

```python
        opacity=visual_expression(item,'opacity','T')
        blend=blends.get(item.id)
        if blend:
            blend_start,length,identifier=blend
            incoming=transition_alpha_expression(identifier,'T',length,True,blend_start)
            outgoing=transition_alpha_expression(identifier,'T',length,False,blend_start)
            # An item that is both arriving and leaving multiplies both ramps.
            opacity=f'({opacity})*({incoming})' if item.transition_in!='none' else f'({opacity})*({outgoing})'
            if identifier in STATIC_BLUR:   # blur, zoom-blur, whip-pan
                head+=f',boxblur=luma_radius={BLUR_RADIUS}:luma_power=1'
        if opacity!='1':
            head+=f",geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*({opacity})'"
```

`STATIC_BLUR` is a module-level frozenset; `BLUR_RADIUS` ≈
`round(min(width,height)*0.012)`. Because `gblur`/`boxblur`/`unsharp` reject
time-varying radii (table in §0), the blur is static and only present when a blur
transition applies — the `enable=` window on the overlay then limits it to the
blend.

For the shaped transitions (circle/wipe/clock) multiply the alpha by a spatial
mask instead of a scalar. `geq` exposes `X, Y, W, H`, e.g. a circle-open is:

```python
r='hypot(X-W/2,Y-H/2)/hypot(W/2,H/2)'   # 0 at centre, 1 at corner
alpha=f'clip({r}/({r_at_progress})-1,0,1)'
```

This is the one part I recommend a second pair of eyes on: it is straightforward
but fiddly, and it is the only place where a transition is not a pure scalar
ramp.

### 3.5 Audio

Audio is already mixed with `amix` (line 226) and **cannot** crossfade that way.
For a genuine audio transition, use `acrossfade` on the pair before the mix
(verified against the bundled build):

---

## 4. UI hooks

### 4.1 `EditorTimeline.tsx` — transition handles

Render a handle spanning the overlap. Insert inside the `.editor-timeline-item`
map, after the trim handles (line ~408):

```tsx
{blend && (
  <span
    className="editor-transition-handle"
    style={{
      left: `${(blend.start / item.duration) * 100}%`,
      width: `${(blend.length / item.duration) * 100}%`,
    }}
    title={`${findTransition(item.transition_in)?.label} · ${formatTime(blend.length, true)}`}
    aria-label={`Transition into ${item.name}`}
  />
)}
```

Pointer handling: reuse the existing `begin(e, item, mode)` capture on
`content.current` (line 101). Dragging the handle's edges changes
`transition_duration` and drags `item.start` to grow/shrink the overlap. Two
constraints:

- clamp `transition_duration` to `[0.1, 5]` **and** to the actual overlap;
- growing the overlap must push `item.start` earlier, which shortens the previous
  clip — respect `trimItem` so keyframes stay consistent.

### 4.2 `EditorPreview.tsx` — compositing

The `style` object at line 186 already carries `opacity` and `transform`. Merge
the transition frame into it:

```tsx
const blend = activeTransition(project.items, time);   // over findTransitionOverlap
const frame = blend
  ? transitionProgress(blend.item.transition_in, time - blend.start, blend.length)
  : null;
const mine = frame && blend.item.id === item.id ? frame.incoming
  : frame && blend.item.id === blend.previous.id ? frame.outgoing
  : null;
const style = {
  opacity: active ? value.opacity * (mine?.opacity ?? 1) : 0,
  transform: `translate(${(mine?.x ?? 0) + value.x}%, ${(mine?.y ?? 0) + value.y}%) rotate(${value.rotation}deg) scale(${(mine?.scale ?? 1) * value.scale})`,
  clipPath: mine?.clipPath ?? undefined,
  maskImage: mine?.mask ?? undefined,
  filter: `blur(${(mine?.blur ?? 0) * (size.width / project.width)}px) brightness(${mine?.brightness ?? 1})`,
};
```

Critical: `active` (line 184) stays
`time >= item.start && time < item.start + item.duration`. That is correct
**because a transition requires real overlap** — both clips are active for the
whole window, which is what makes the blend visible. Do not "fix" the incoming
clip to start at the blend; that would hide the transition entirely.

`clipPath`/`maskImage` on a `<video>` element clips the element box, not the
letterboxed picture. For pixel-accurate wipes, apply the clip to the existing
`.editor-video-layer` wrapper div instead.

### 4.3 `EditorInspector.tsx` — the controls

Mirror the existing Animation section (line 552). Add a "Transition" section
only when the selected item actually overlaps a predecessor, so the control is
never shown where it cannot work:

```tsx
{overlap && (
  <section className="editor-inspector-section">
    <h3>Transition</h3>
    <label className="editor-field">
      <span>Transition</span>
      <select aria-label="Transition" value={item.transition_in}
        onChange={(e) => update({ transition_in: e.target.value as TransitionId })}>
        <option value="none">None</option>
        {transitions.map((t) => (
---

## 5. Backend overlap validation

`editor_transitions.validate_project_transitions(items)` is written and ready.
Call it from a second validator in `editor_models.py`, declared **after**
`sane_item` since the overlap maths depends on `start`/`duration` being sane:

```python
    @model_validator(mode='after')
    def transitions_have_overlap(self):
        validate_project_transitions(self.items)
        return self
```

It raises a `ValueError` that Pydantic surfaces as a 422 with the message in
`detail`, which `Studio.tsx` already renders through its existing error path.
The message is written for the person editing, e.g.:

> `"B-roll" needs to overlap the clip before it for a transition to play. Drag
> the clips together, shorten the transition, or set it back to None.`

Because the check lives on `Project`, it covers **both** `PUT /{clip_id}` (save)
and `POST /{clip_id}/export` — a project with an impossible transition can never
reach the renderer. Audio items are excluded, since they have no visual blend.

---

## 6. Security review — the reason the allow-list exists

`editor_models.py` is titled "no executable filter text from clients".
Transitions are the first field where a client string could reach a filter
graph, so the rule is enforced in three independent layers:

1. **Pydantic `Literal`** — an unknown id fails validation before any code runs.
2. **`validate_transition()`** — the only gate; strips, lowercases, and looks up
   `TRANSITIONS`. Returns `'none'` for `None`/`''`. Raises for everything else.
3. **`_number()`** — every float formatted with `format(v,'.10g')`, matching
   `editor_render.number()`. No exponent, no locale comma, no whitespace.

Nothing else is ever interpolated. `XfadeSpec.filter_string()` emits
`transition=<name from TRANSITIONS>` where the name is a literal in source, and
`transition_alpha_expression` only accepts time tokens from the `TIME_TOKENS`
frozenset — it cannot be talked into emitting caller text.

Verified rejections: `fade; rm -rf /`, `xfade=transition=fade`, `$(whoami)`,
`../../etc/passwd`, `'.nomodule`, `fade\0black`, `123`, `['fade']`.

**Do not** add an escape hatch, an "advanced/custom" field, or a passthrough
`xfade_string` parameter. If a new transition is needed, add an id and a vetted
name to `TRANSITIONS`.

---

## 7. Verification performed

| Check | Result |
|---|---|
| `import engine.studio.editor_transitions` | OK — 20 transitions, 20 xfade names |
| `tsc --noEmit` on `transitions.ts` (strict) | 0 errors |
| Every id resolves to an allow-listed xfade name | 20/20 |
| Every name advertised by the local FFmpeg build | 20/20 |
| **Real FFmpeg render of every generated filter** | **20/20 pass** |
| Hostile input rejected | 9/9 |
| Duration bounds + NaN | pass |
| Fallback path / hard-fail path | pass |
| Dashboard ⇄ engine id sets identical | 20 == 20 |
| Alpha-ramp compositing verified pixel-exact | 50% → `rgb(127,0,127)` |
| `pytest engine/studio -q` | no regression |

The sanity script is standalone and was run inline from `/tmp`; nothing was added
to `dashboard/tests/**` or `scripts/**`, both owned by other agents.

---

## 8. Known gaps, stated plainly

- **Pixelize and the shaped masks (§3.4) are specified but not yet rendered.**
  The alpha-ramp path is verified end-to-end; the `geq` spatial-mask path and the
  `scale`-based pixelize path are designed against probed capabilities but have
  not been through the real renderer. Budget a verification pass on those 7 ids
  (`circle-open`, `circle-close`, `clock-wipe`, 4 wipes, `pixelize`) before
  calling the feature complete.
- **Blur is static, not continuous** — an FFmpeg limitation, documented in §0.
- **The preview is an approximation for `pixelize`** (CSS cannot quantise
  pixels); the `pixelSize` field is advisory and currently unused by the
  renderer path.
- **Audio crossfade needs `acrossfade` (§3.5)**, a separate change to the
  `amix` stage, not part of the two delivered modules.
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    </label>
    <NumberField label="Transition duration" value={item.transition_duration}
      min={0.1} max={Math.min(5, overlap.duration)} suffix="s"
      onChange={(transition_duration) => update({ transition_duration })} />
  </section>
)}
```

Clamping the max to the real overlap is what stops the UI from producing a state
the backend will reject (section 5).
```
[0:a][1:a]acrossfade=d=1:c1=tri:c2=tri[a]
```

Note in the UI that a video transition without `acrossfade` still crossfades the
picture over mixed audio. That is the same behaviour CapCut has when you mute
one side, so it is acceptable — but it should be a conscious choice, not an
accident.

### 3.6 The `xfade` path (audio / future single-track renders)

For a linear A→B render, `xfade_chain` builds the graph:

```python
steps=[]
label,acc=items[0].label,0.0
for nxt in items[1:]:
    length=min(nxt.transition_duration,nxt.duration)
    spec=xfade_filter(nxt.transition_in,length,acc-length)
    steps.append((spec,label,nxt.label)); label=nxt.label
    acc+=nxt.duration-length
filters+=xfade_chain(steps)
```

Offset arithmetic: each `xfade` consumes `duration` from **both** inputs, so the
next offset is `previous_offset + incoming_duration - transition_length`. Getting
this wrong double-counts and desynchronises every subsequent cut.
  transition_in: TransitionId;
  transition_duration: number;
```

### 2.2 Picker list

`transitions` is already the `<select>` source — it is `{id, label, duration}`,
the same shape as the existing `animations` list. Do **not** re-declare it:

```tsx
import { transitions } from "./transitions";
```

### 2.3 `newItem()` defaults

In `newItem` (line 133) add next to the animation defaults:

```ts
    transition_in: "none",
    transition_duration: 0.6,
```

Without this, every newly created clip fails `tsc` against the new required
fields, and `Studio.tsx`'s split-at-playhead (line ~327) inherits the omission.