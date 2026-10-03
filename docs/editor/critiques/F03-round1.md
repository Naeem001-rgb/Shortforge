⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# F03 — Blend/masks/chroma/region conceal and effects — Round 1

**5.9/10 · FIX.** Compliance 5, correctness 6, UX 7, performance 6, code quality 6. Weighted 35/25/20/10/10; raw 5.85. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Blend, mask, chroma and conceal implementations were inspected. Independent rendering of circle mask feather 0 versus 100 produced identical pixels.

**Findings and required changes.**
1. Major: feather is ignored and absent from the UI; masks use fixed geometry. Chroma offers color/tolerance without spill/softness control. Implement the promised parameters or explicitly close that scope as incomplete. Burned-caption conceal copy is appropriately honest.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
