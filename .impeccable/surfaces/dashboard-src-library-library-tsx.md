---
version: 1
slug: "dashboard-src-library-library-tsx"
primary_target: "dashboard/src/library/Library.tsx"
related_targets: ["dashboard/src/shell/App.tsx","dashboard/src/theme/shell.css","dashboard/src/theme/library.css","dashboard/src/theme/tokens.css","dashboard/src/theme/workspace.css"]
---

# ShortForge Pinterest dashboard redesign

Mode: Operate. A creator finds footage, collects inspiration, and opens a real local video project. The user explicitly requested researching 10–20 modern Pinterest dashboard designs with 3–5 research subagents, then implementing the strongest reference. Three research agents inspected actual Pinterest images. The current redesign replaces the previous Nexus composition.

## Direction contract

THESIS: A readable media workspace makes the collection and next editing action immediately clear. Coursie’s framed workspace is the primary visual reference, replacing the incumbent flat utility rail and cramped library chrome.

OWN-WORLD: White outer frame; inset, rounded pale-gray navigation and work regions; white media and summary surfaces; one strong violet summary tile; #5347CE actions; bundled Inter Variable; 12–16px control/panel corners; dark-theme equivalents. Follow the reference’s restrained spacing and surface separation, without importing unrelated charts or financial data.

STORY: Identify the library state from real counts, filter or search the collection, inspect footage, and open Studio in its own tab. Import and blank-project creation are distinct working actions. Failed thumbnails and an empty library remain useful.

FIRST VIEWPORT: Approximately 220px inset navigation, 64px rounded utility bar, 24px content gutters, a 30px heading with import and Studio actions, four compact factual overview tiles, and tabs/search/view controls immediately above five compact media cards. Narrow screens use a focus-trapped drawer, two overview columns and fewer media columns. Persistent themes and grid/table choices retain geometry.

FORM: Code-led recreation of the user-requested Pinterest visual family, using Coursie / Donezo for the shell and EditorPro / KUBMA for content clarity. The assigned concept seed is 4b836d5b (index 3); the explicit Pinterest-reference brief governs over unrelated catalog challengers. Candidate families considered: Coursie pale/violet; FindMe neutral workspace; Courseco content workspace; iDraft monochrome; Eduplex dark rail; Taskly task board; Bankio tabular. Signature interaction: overview counts filter the collection, with keyboard-operable tabs and consistent grid/table selection. Motion is restrained 160ms control feedback; reduced motion removes transitions.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Reference evidence

- Primary: https://www.pinterest.com/pin/304626362318839469/ (Coursie image, verified and visually inspected).
- Structure: https://www.pinterest.com/pin/35254809577482776/ (Donezo).
- Media cards: https://www.pinterest.com/pin/615163630351164319/ (KUBMA).
- Creator content: https://www.pinterest.com/pin/1128714725392184328/ (Courseco) and the actual EditorPro image from Pinterest video-dashboard search.
- Research reports: /tmp/shortforge-pinterest-saas.md, /tmp/shortforge-pinterest-dashboard.md, /tmp/shortforge-pinterest-creator.md. The consolidated source list will be retained in docs/design/pinterest-dashboard-research.md.

Preserve actual library records, rights/source labels, import, filters, bulk operations, command search, settings, Scout, Publish kit and the existing Studio editing behavior. No invented metrics, media records, avatars or subscription offers. Keep the removed creative-workflow footer absent. No reference raster is shipped as application artwork.

## Verification evidence

Production build passed. Eight Playwright tests passed across dashboard behavior, responsive layout, light/dark/system themes, settings, selection/deletion, source metadata, and new-tab Studio entry. The source detector reported no findings. Text token pairs checked against their actual light/dark surfaces all exceed 4.5:1 (lowest checked: 4.96:1). Mobile overview panels are compact two-column controls; unavailable libraries show unavailable counts and a retry action rather than a false empty collection. Captures are in `.impeccable/review/pinterest-dashboard/`.

The independent finish review returned **ship**, with no material findings, after inspecting the Coursie reference and all required captures. Its evidence and limits are recorded in `.impeccable/review/pinterest-dashboard/finish-review.md`. Documentation is complete in `DESIGN.md` and `.impeccable/design.json`; `PRODUCT.md` retains all non-brand product truth. On 6 October 2026, three parallel finishing agents verified the documentation, the 15-reference research record, and the continued applicability of the saved build/test results. The validation handoff is `docs/design/dashboard-validation.md`. No reference raster is bundled as application artwork.
