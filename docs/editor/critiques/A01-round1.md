⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# A01 — Detach, mute/delete and audio mixer — Round 1

**6.0/10 · FIX.** Compliance 7, correctness 8, UX 7, performance 6, code quality 7. Weighted 35/25/20/10/10; raw 7.15, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Shared offline mixer used by actual30 s export has audible PCM,0 ms measured drift and high decoded/reference correlation. Detach source alignment/mute code inspected.

**Findings and required changes.**
1. Blocker: per-track volume/fades are absent from the track model/UI; track controls are mute/hide/lock. Major: detach no-double-audio scenario was not independently run because the old extraction UI test fails at entry. Verify that workflow audibly, including per-clip envelopes and clipped mixed peaks.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
