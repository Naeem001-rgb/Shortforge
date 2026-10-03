⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# K01 — Unified keyframes, easing, inspector diamonds — Round 1

**6.0/10 · FIX.** Compliance 7, correctness 8, UX 7, performance 7, code quality 7. Weighted 35/25/20/10/10; raw 7.25, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Numeric interpolation, easing endpoints,hold/spring/bezier tests pass. Timeline diamonds can be retimed; inspector offers delete/easing and numericBezier fields.

**Findings and required changes.**
1. Blocker: keyframe copy is absent as a direct editing flow and all numeric property controls are not unified. Major: test add/move/copy/delete through UI and ensure transforms/effect values update the selected playhead key instead of hidden base values.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
