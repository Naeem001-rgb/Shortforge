⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# U01 — Resizable/collapsible panes and shortcuts — Round 1

**6.0/10 · FIX.** Compliance 8, correctness 7, UX 8, performance 6, code quality 7. Weighted 35/25/20/10/10; raw 7.45, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Pane resize/collapse code and keyboard handlers inspected; d9b2a33 addsK and narrow-screen mutually exclusive drawers. Nine tool buttons fit at desktop sizes.

**Findings and required changes.**
1. Major: complete listed shortcut matrix is not independently demonstrated. Timeline-scoped copy/paste/ripple and global shortcuts require explicit focus tests; verify typing never edits the timeline and controls remain reachable at browser zoom200%.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
