⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# I01 — Library-to-Studio automatic acquisition — Round 1

**6.0/10 · FIX.** Compliance 8, correctness 8, UX 8, performance 7, code quality 7. Weighted 35/25/20/10/10; raw 7.80, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Real local upload opened through ?studio=<id> and seeded actual video once in my browser. New-project deep-link test passes. Read acquisition/job and source-seeding paths.

**Findings and required changes.**
1. Major: live remote acquisition, failed-download retry and edit-preserving reload were not independently completed. The entry-test Details selector is unscoped in a multi-record library; scope it to the created fixture, then test idempotent remote acquisition with an isolated fake downloader and one real allowed source.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
