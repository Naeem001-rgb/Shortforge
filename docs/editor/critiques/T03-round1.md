⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# T03 — Transform and direct preview handles — Round 1

**6.0/10 · FIX.** Compliance 7, correctness 7, UX 7, performance 6, code quality 7. Weighted 35/25/20/10/10; raw 6.90, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Canvas selection outline/scale/rotation controls are visible with real video. Read direct-handle implementation and its0/±40percent snap points.

**Findings and required changes.**
1. Blocker: real edge/safe-zone snapping is not implemented as geometry-aware snapping; fixed centre coordinates are used regardless of object bounds. Major: hit-testing treats every active video as covering the canvas, so a top inset layer can capture clicks outside its visible area. Test transformed bounds and inverse-rotation hit testing; verify handles and inspector agree.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
