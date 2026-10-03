⚠️ DEGRADED: single-context (delegated reviewer instructed not to spawn; runtime slots full).
# C01 — Word-level captions and transcription — Round 1

**6.0/10 · FIX.** Compliance 7, correctness 7, UX 7, performance 6, code quality 7. Weighted 35/25/20/10/10; raw 6.90, ceiling 6. Required unverified criteria count as failed; this is not a PASS.

Snapshot: runtime 27093e3 with supplied uncommitted preview fix; source-only late patch d9b2a33 acknowledged. Build/lint pass after d9b2a33. New recovery/audio modules were not mounted at review cutoff. Detailed run caveats and artifacts: [whole-product review](Q02-round1.md).

**Evidence.** Python transcription tests pass; builder real microphone recognition artifact has nonuniform word timestamps. CaptionPanel maps source trims/speed/reverse and surfaces local capability.

**Findings and required changes.**
1. Major: actual local recognition and edited-caption alignment were not independently run in this lane. Browser-default/on-device recognition is not delivered: current inference requires the local service/runtime. Document that architecture gap explicitly and verify local readiness/error recovery.

Questions skipped: delegated evidence review; no product-scope decision requested. One correction batch and an independent Round 2 confirmation are appropriate; no automatic Round 3.
