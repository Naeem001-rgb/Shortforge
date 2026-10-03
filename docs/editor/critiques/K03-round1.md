⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# K03 — Curves, auto-keyframe, ramps and magnetic track — Round 1

**4.4/10 · FIX.** Compliance 3, correctness 5, UX 5, performance 6, code quality 5. Weighted 35/25/20/10/10; raw 4.40. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** NumericBezier visualization and main-track magnetic packing exist. Inspector updates existing property keys at the playhead.

**Findings and required changes.**
1. Major: interactive curve editing, speed ramps and punch-at-marker workflow are not delivered. Magnetic packing must prove it preserves trims and transition intent. Do not count static curve SVG or fixed playback speed as these features.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
