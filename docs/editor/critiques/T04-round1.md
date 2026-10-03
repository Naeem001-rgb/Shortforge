⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# T04 — Speed, reverse, freeze, fit/fill, flip — Round 1

**6.0/10 · FIX.** Compliance 8, correctness 7, UX 7, performance 6, code quality 7. Weighted 35/25/20/10/10; raw 7.25, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Pure-engine source timing tests cover reverse/freeze. Inspector exposes0.1–10x and crop/flip/rotation/opacity; source bounds backend rejection test passes.

**Findings and required changes.**
1. Major: reverse/freeze/flip/speed extremes were not independently rendered and compared after export. The audio mixer uses AudioBufferSourceNode.playbackRate, which changes pitch; if the full brief requires pitch preservation, this is an explicit missing implementation. Add real source-bound and extreme-speed export evidence.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
