⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# C04 — Bundle ~20 open-license fonts — Round 1

**6.0/10 · FIX.** Compliance 9, correctness 8, UX 8, performance 7, code quality 8. Weighted 35/25/20/10/10; raw 8.25, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** All 20 local TTFs, 20 license files, provenance manifest and selectable font array were inspected. Final independent Chrome check loaded every face successfully from the local application; /tmp/shortforge-critic-final-browser.json records all 20 loaded states.

**Findings and required changes.**
1. Major: deterministic exported text has not been demonstrated for every selectable face/style/weight. Complete a font matrix including missing-glyph fallback and link each bundled font license from the central inventory.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
