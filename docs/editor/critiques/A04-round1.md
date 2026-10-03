⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# A04 — Ducking, normalization, pause removal — Round 1

**5.1/10 · FIX.** Compliance 4, correctness 6, UX 5, performance 6, code quality 6. Weighted 35/25/20/10/10; raw 5.10. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Ducking envelope pure test passes and mixer consumes the same function. Audio inspector has Lower music under voiceover.

**Findings and required changes.**
1. Major: measured normalization and pause-removal preview/commit are absent. Ducking audibility/export with actual competing voice/music was not independently measured. Implement or explicitly close these P1 requirements as known issues after the allowed review cycle.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
