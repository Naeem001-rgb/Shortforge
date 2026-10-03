⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# C03 — JSON style engine and >=20 presets — Round 1

**6.0/10 · FIX.** Compliance 7, correctness 7, UX 8, performance 6, code quality 7. Weighted 35/25/20/10/10; raw 7.10, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** 30 preset definitions; shared Canvas caption renderer is used by preview/export. Actual30 s golden frames match compressed output with MAE<=0.613 andP95<=2.

**Findings and required changes.**
1. Blocker: all20 required styles have not been proved distinctly and correctly rendered. Several style parameters supported in the inspector are not visibly consumed by drawCaption (for example non-word color-ramp variants and entrance styling). Render a preset matrix with actual timestamps and compare against each style contract, not catalog count.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
