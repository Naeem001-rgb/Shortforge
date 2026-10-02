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

  "transitions": {
    describe:
      "Two overlapping clips: the Transition control appears, the timeline marks the blend window, and the autosaved project keeps the id",
    async prepare(harness) {
      await harness.createProject("QA transitions");
      await harness.openProject();
      const page = harness.page;
      // A second clip, imported through the real Media panel.
      await page
        .getByRole("navigation", { name: "Editor tools" })
        .getByRole("button", { name: "Media", exact: true })
        .click();
      await page.getByLabel("Import media", { exact: true })
        .setInputFiles(harness.media.video);
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="timeline-item"]').length >= 2,
        undefined,
        { timeout: 60000 },
      );
      // Importing places each clip on the next FREE track, so the two never
      // overlap on their own. Drag the second clip left AND up onto the first
      // clip's track: a transition needs real overlap on the SAME track, and
      // `freeTrack` guarantees they start on different ones.
      //
      // Snapping is toggled off first. It pulls a dragged clip flush against
      // its neighbour's edges, which is the opposite of the overlap a
      // transition needs, and it wins over the drag distance.
      await page
        .getByRole("button", { name: "Snap to clips and playhead", exact: true })
        .click();
      const items = page.locator('[data-testid="timeline-item"]');
      const second = items.last();
      const first = items.first();
      const box = await second.boundingBox();
      const target = await first.boundingBox();
      if (!box || !target) throw new Error("timeline items have no box");
      // The drag must start on the item BODY, which is the element carrying
      // onPointerDown -> begin(). Pressing on the outer div does nothing.
      const body = second.locator(".editor-item-body");
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      // Land the clip on the first clip's track, ending ~1s short of its left
      // edge so the two genuinely overlap.
      const to = {
        x: target.x + 30,
        y: target.y + target.height / 2,
      };
      await body.hover({ position: { x: box.width / 2, y: box.height / 2 } });
      await page.mouse.down();
      for (let step = 1; step <= 30; step += 1) {
        await page.mouse.move(
          from.x + ((to.x - from.x) * step) / 30,
          from.y + ((to.y - from.y) * step) / 30,
        );
      }
      await page.mouse.up();
      await page
        .getByRole("button", { name: "Snap to clips and playhead", exact: true })
        .click();
      // Prove the overlap exists before asserting on the control, so a future
      // failure says WHICH step broke rather than just "no Transition label".
      const overlap = await page.evaluate(() => {
        const items = document.querySelectorAll('[data-testid="timeline-item"]');
        const times = [...items].map((node) => ({
          left: node.getBoundingClientRect().left,
          right: node.getBoundingClientRect().right,
        }));
        for (const a of times)
          for (const b of times)
            if (a !== b && a.right > b.left + 4) return a.right - b.left;
        return 0;
      });
      if (overlap <= 0)
        throw new Error(`clips did not overlap (overlap=${overlap}px)`);
      await second.click();
      // Now the control must exist, because the clips overlap.
      const transition = page.getByLabel("Transition", { exact: true });
      await transition.waitFor({ state: "visible", timeout: 30000 });
      await transition.selectOption("crossfade");
      // The timeline marks the blend window.
      await page.waitForSelector(".editor-transition-handle", { timeout: 30000 });
      // The editor autosaves on a debounce, so poll the SAVED project: this
      // proves the id survived a round trip, not just that a <select> changed.
      await harness.waitForItems(
        (_kinds, state) =>
          (state.project.items || []).some(
            (item) => item.transition_in === "crossfade",
          ),
        { label: "a saved crossfade", timeout: 60000 },
      );
      // Bring the new control into view so the capture actually shows the
      // feature rather than the panel above it.
      await page
        .getByRole("heading", { name: "Transition", exact: true })
        .scrollIntoViewIfNeeded();
    },
    steps: () => ["tab:Media"],
  },

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


