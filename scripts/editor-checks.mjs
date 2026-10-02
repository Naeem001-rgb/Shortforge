/**
 * Named editor checks driven by scripts/editor-harness.mjs.
 *
 * A check is { describe, prepare(harness), steps(harness) }:
 *   prepare — one-off real setup (create a project, import media through the
 *             UI). Runs once per check, never screenshotted.
 *   steps   — the step DSL replayed for every theme x viewport capture.
 *
 * Run them all, or one at a time:
 *   node scripts/editor-harness.mjs
 *   node scripts/editor-harness.mjs --checks=baseline-full --themes=dark
 *
 * NOTE: deliberately no import from ./editor-harness.mjs — that module has a
 * top-level await, so importing it back here would deadlock the CLI. Fixture
 * paths come from `harness.media` instead.
 */

export const checks = {
  /* -------------------------------------------------------------- *
   * Baseline gallery: the editor before any feature work lands.
   * -------------------------------------------------------------- */

  "baseline-empty": {
    describe:
      "Studio editor with an empty timeline (real uploaded project, video clip removed through the UI)",
    async prepare(harness) {
      await harness.createProject("QA baseline — empty");
      await harness.openProject();
      // A fresh upload seeds the source video onto track 0. Select it and use
      // the real toolbar action to clear the timeline, so this is a genuinely
      // empty project rather than a mocked one.
      await harness.page.getByTestId("timeline-item").first().click();
      await harness.page
        .getByRole("button", { name: "Delete selected clip", exact: true })
        .click();
      await harness.page.waitForFunction(
        () => document.querySelectorAll('[data-testid="timeline-item"]').length === 0,
        undefined,
        { timeout: 30000 },
      );
    },
    steps: () => ["tab:Media"],
  },

  "baseline-full": {
    describe:
      "Studio editor with a populated timeline (video clip + text clip + audio clip, all imported for real)",
    async prepare(harness) {
      await harness.createProject("QA baseline — populated");
      await harness.openProject();
      await harness.page.waitForSelector('[data-testid="timeline-item"][data-kind="video"]', {
        timeout: 30000,
      });

      // Text clip: real "Add text" button in the Text tool tab.
      await harness.page
        .getByRole("navigation", { name: "Editor tools" })
        .getByRole("button", { name: "Text", exact: true })
        .click();
      await harness.page
        .getByRole("button", { name: "Add text", exact: true })
        .click();
      await harness.page.waitForSelector('[data-testid="timeline-item"][data-kind="text"]', {
        timeout: 30000,
      });
      await harness.page
        .getByLabel("Text content", { exact: true })
        .fill("Baseline caption clip");

      // Audio clip: real WAV fixture through the Audio tool tab's import.
      await harness.page
        .getByRole("navigation", { name: "Editor tools" })
        .getByRole("button", { name: "Audio", exact: true })
        .click();
      await harness.page.getByLabel("Import music", { exact: true })
        .setInputFiles(harness.media.music);
      await harness.page.waitForSelector('[data-testid="timeline-item"][data-kind="audio"]', {
        timeout: 60000,
      });

      // Park the playhead on a real frame so the preview is not black.
      await harness.page.getByLabel("Playhead", { exact: true }).fill("1");

      // Autosave is debounced: wait for all three clips to be PERSISTED, not
      // just rendered.
      const state = await harness.waitForItems(
        (kinds) =>
          kinds.filter((k) => k === "video").length === 1 &&
          kinds.includes("text") &&
          kinds.includes("audio"),
        { label: "a saved video + text + audio timeline", timeout: 60000 },
      );
      const text = state.project.items.find((i) => i.kind === "text");
      if (!text.text?.includes("Baseline caption"))
        throw new Error(
          `saved text clip lost its content: ${JSON.stringify(text.text)}`,
        );
    },
    steps: () => ["tab:Media", "fill:Playhead=1"],
  },

  /* -------------------------------------------------------------- *
   * Feature checks. Add new ones here; see docs/QA-HARNESS.md.
   * -------------------------------------------------------------- */

  "audio-tracks": {
    describe:
      "Audio tool tab: a music clip and a voiceover clip both land on the timeline",
    async prepare(harness) {
      await harness.createProject("QA audio tracks");
      await harness.openProject();
      const tab = harness.page
        .getByRole("navigation", { name: "Editor tools" })
        .getByRole("button", { name: "Audio", exact: true });
      await tab.click();
      await harness.page.getByLabel("Import music", { exact: true })
        .setInputFiles(harness.media.music);
      await harness.page.waitForSelector(
        '[data-testid="timeline-item"][data-kind="audio"]',
        { timeout: 60000 },
      );
      await harness.page.getByLabel("Import voiceover", { exact: true })
        .setInputFiles(harness.media.voice);
      await harness.page.waitForFunction(
        () => document.querySelectorAll('[data-testid="timeline-item"][data-kind="audio"]').length >= 2,
        undefined,
        { timeout: 60000 },
      );
      // Both audio clips must survive the debounced autosave.
      await harness.waitForItems(
        (kinds) => kinds.filter((k) => k === "audio").length >= 2,
        { label: "two saved audio clips", timeout: 60000 },
      );
    },
    steps: () => ["tab:Audio"],
  },
};

export default checks;


