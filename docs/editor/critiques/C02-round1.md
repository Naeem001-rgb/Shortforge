⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# C02 — Caption editor, find/replace, merge/split — Round 1

**6.0/10 · FIX.** Compliance 8, correctness 8, UX 7, performance 7, code quality 7. Weighted 35/25/20/10/10; raw 7.60, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Pure caption grouping/SRT/timing test passes. Word editor, find/replace, merge and split code inspected; builder screenshot shows updated real recognized words.

**Findings and required changes.**
1. Major: full edit/merge/split/find/replace persistence/undo acceptance is unverified. Same-word-count replacements preserve timestamps, changed counts deliberately clear alignment; confirm this warning and an alignment-repair path with real speech.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
