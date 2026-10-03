⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# D01 — Autosave, recovery and project management — Round 1

**5.9/10 · FIX.** Compliance 5, correctness 7, UX 6, performance 6, code quality 6. Weighted 35/25/20/10/10; raw 5.90, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** 900 ms autosave and local recovery snapshot code exist; project menu has rename/new/select and JSON import/export. Blank-name fallback defect reproduced.

**Findings and required changes.**
1. Blocker: recent-project thumbnails and project duplicate/delete UI are absent in the reviewed mounted shell. Relink/cache modules were unmounted work in progress at snapshot and cannot count as acceptance. Major: demonstrate offline/quota recovery, valid/invalid JSON and missing-media relink without changing source files.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
