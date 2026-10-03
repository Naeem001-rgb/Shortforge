⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# F01 — >=20 real transitions — Round 1

**5.6/10 · FIX.** Compliance 5, correctness 5, UX 7, performance 6, code quality 6. Weighted 35/25/20/10/10; raw 5.60, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Independently rendered all 20 transition IDs with controlled red/blue sources at five overlap progress points. Shared preview/export execution is verified on real media.

**Findings and required changes.**
1. Blocker: Circle close outputs full incoming blue at 5%, 25%, 50%, 75%, 95%; its outgoing mask is covered by the opaque incoming layer. Fix layer order/compositing and compare boundary frames. Major: the catalog mainly uses Canvas2D transforms/clips, rather than 20 GPU effects; luma burn uses uniform brightness rather than a luminance-based reveal.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
