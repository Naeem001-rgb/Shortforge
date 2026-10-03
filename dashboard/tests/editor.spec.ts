import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  editorState,
  fixtures,
  fixtureDir,
  inspectExport,
  musicFixture,
  removeAllProjects,
  subtitleFixture,
  openProject,
  removeProject,
  uploadProject,
  voiceFixture,
} from "./editor-fixtures";

test.beforeAll(fixtures);
test.beforeEach(async ({ page }) => {
  // Exports and reload assertions must use one consistent development build.
  await page.routeWebSocket(/127\.0\.0\.1:5174/, () => {});
});
test.afterAll(async ({ request }) => removeAllProjects(request));
const timeline = (page: Page) =>
  page.getByRole("region", { name: "Timeline", exact: true });
const undo = (page: Page) =>
  timeline(page).getByRole("button", { name: "Undo (Ctrl+Z)", exact: true });
const redo = (page: Page) =>
  timeline(page).getByRole("button", {
    name: "Redo (Ctrl+Shift+Z)",
    exact: true,
  });
const deleteSelection = (page: Page) =>
  timeline(page).getByRole("button", {
    name: "Delete selection (Delete)",
    exact: true,
  });

// Styled captions need the shared renderer. The basic transform/audio case
// separately retains a real compatibility MP4 regression.
async function exportVideo(
  page: Page,
  request: APIRequestContext,
  method: "browser" | "compatibility" = "compatibility",
) {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Export resolution").selectOption("720");
  await page.getByText("Export method", { exact: true }).click();
  await page.getByLabel("Export method", { exact: true }).selectOption(method);
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  const exports = page.locator(".editor-export-history");
  await expect(exports).toBeVisible({ timeout: 120000 });
  await exports.locator("summary").click();
  const url = await exports.getByRole("link").first().getAttribute("href");
  const response = await request.get(url!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toMatch(
    method === "compatibility" ? /^video\/mp4/ : /^video\/(mp4|webm)/,
  );
  const bytes = await response.body();
  expect(bytes.length).toBeGreaterThan(10000);
  return inspectExport(bytes);
}

test("subtitle styles and compiled motion persist and export in full-tab Studio", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const clip = await uploadProject(request, "Caption template browser test");
  try {
    await openProject(page, clip.id);
    await expect(page.locator(".editor-workspace")).toHaveCSS(
      "display",
      "grid",
    );
    await page
      .getByLabel("Import captions", { exact: true })
      .setInputFiles(subtitleFixture);
    await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Apply Karaoke sweep template",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: "Apply Karaoke sweep to all captions",
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items.filter(
            (item: { kind: string; text_style?: { reveal: string } }) =>
              item.kind === "text" && item.text_style?.reveal === "karaoke",
          ).length,
      )
      .toBe(2);
    const caption = page.locator(".timeline-clip.text").first();
    await caption.click();
    await page.getByRole("tab", { name: "Animation", exact: true }).click();
    await page.getByLabel("In animation", { exact: true }).selectOption("pop");
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items.find(
            (item: { kind: string }) => item.kind === "text",
          ).animation_labels?.in,
      )
      .toBe("pop");
    const saved = (await editorState(request, clip.id)).project.items.find(
      (item: { kind: string }) => item.kind === "text",
    );
    expect(saved.animation_in).toBe("none");
    expect(saved.keyframes.length).toBeGreaterThan(2);
    await page.reload();
    await caption.click();
    await expect(
      page.getByLabel("Word animation", { exact: true }),
    ).toHaveValue("karaoke");
    await page.getByRole("tab", { name: "Animation", exact: true }).click();
    await expect(page.getByLabel("In animation", { exact: true })).toHaveValue(
      "pop",
    );
    await page.getByLabel("Playhead", { exact: true }).fill("1");
    expect(
      await page.evaluate(
        async () => (await document.fonts.load('800 64px "Montserrat"')).length,
      ),
    ).toBeGreaterThan(0);
    await page.screenshot({
      path: path.join(fixtureDir, "caption-presets-desktop.png"),
      animations: "disabled",
    });
    const metadata = await exportVideo(page, request, "browser");
    expect(metadata).toMatchObject({
      width: 720,
      height: 1280,
      has_audio: true,
    });
    await page.getByRole("button", { name: "Close export panel" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByLabel("Video canvas", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await removeProject(request, clip.id);
  }
});

test("cross-track dragging, trimming, captions and Web Audio preview cleanup work together", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  // Observe actual Web Audio sources; preview no longer creates DOM audio tags.
  await page.addInitScript(() => {
    const sources: { started: boolean; stopped: boolean }[] = [];
    (window as any).__previewSources = sources;
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this),
        record = { started: false, stopped: false };
      sources.push(record);
      const start = source.start.bind(source),
        stop = source.stop.bind(source);
      source.start = (...args) => {
        record.started = true;
        return start(...args);
      };
      source.stop = (...args) => {
        record.stopped = true;
        return stop(...args);
      };
      source.addEventListener("ended", () => {
        record.stopped = true;
      });
      return source;
    };
  });
  const clip = await uploadProject(request, "Timeline interaction test");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await openProject(page, clip.id);
    const video = page.locator(".timeline-clip.video");
    await page
      .getByRole("button", { name: "Snap to clips and markers", exact: true })
      .click();
    const zoom = Number(
      await page.getByRole("slider", { name: "Timeline zoom" }).inputValue(),
    );
    const box = (await video.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + zoom,
      box.y + box.height / 2 + 62,
      { steps: 12 },
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items[0].track,
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items[0].start,
      )
      .toBe(1);
    await undo(page).click();
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items[0].track,
      )
      .toBe(0);
    const edge = (await video
      .getByRole("button", { name: /Trim end/ })
      .boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      edge.x + edge.width / 2 - zoom,
      edge.y + edge.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items[0].duration,
      )
      .toBe(3);
    await page
      .getByLabel("Import captions", { exact: true })
      .setInputFiles(subtitleFixture);
    await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
    await page.locator(".timeline-clip.text").first().click();
    await expect(page.getByLabel("Text content", { exact: true })).toHaveValue(
      "Browser test caption",
    );
    await page
      .getByLabel("Import voiceover", { exact: true })
      .setInputFiles(voiceFixture);
    await expect(page.locator(".timeline-clip.audio")).toHaveCount(1);
    await page.getByLabel("Playhead", { exact: true }).fill("0");
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__previewSources.filter(
              (s: any) => s.started && !s.stopped,
            ).length,
        ),
      )
      .toBe(1);
    await page.evaluate(() => {
      (window as any).__oldPreviewSources = [
        ...(window as any).__previewSources,
      ];
    });
    await deleteSelection(page).click();
    await expect(page.locator(".timeline-clip.audio")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__oldPreviewSources.every((s: any) => s.stopped),
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Pause preview", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__previewSources.every(
            (s: any) => !s.started || s.stopped,
          ),
        ),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await removeProject(request, clip.id);
  }
});

test("full-tab editor saves edits, imports, editable animation and a playable MP4", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const clip = await uploadProject(request);
  const errors: string[] = [],
    forbiddenRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    // Voice catalog discovery is allowed; ordinary edits must not generate
    // speech or transform the user's script without an explicit action.
    if (
      /\/api\/(tts|rewrite|clips\/[^/]+\/extract-script)(?:\?|$|\/)/.test(
        req.url(),
      )
    )
      forbiddenRequests.push(req.url());
  });
  try {
    await openProject(page, clip.id);
    await page.getByTestId("timeline-item").click();
    await page.getByRole("tab", { name: "Audio", exact: true }).click();
    await page.getByLabel("Volume", { exact: true }).fill("0");
    await page.getByRole("tab", { name: "Basic", exact: true }).click();
    await page.getByLabel("Scale", { exact: true }).fill("115");
    await page
      .getByRole("button", { name: "Keyframe Scale", exact: true })
      .click();
    await page.getByLabel("Playhead", { exact: true }).fill("2");
    await page.getByLabel("Position X", { exact: true }).fill("15");
    await page.getByRole("tab", { name: "Animation", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Go to keyframe 2", exact: true }),
    ).toBeVisible();
    await undo(page).click();
    await expect(
      page.getByRole("button", { name: "Go to keyframe 2", exact: true }),
    ).toHaveCount(0);
    await redo(page).click();
    await expect(
      page.getByRole("button", { name: "Go to keyframe 2", exact: true }),
    ).toBeVisible();
    await page.getByLabel("In animation", { exact: true }).selectOption("fade");
    await page
      .getByLabel("Import voiceover", { exact: true })
      .setInputFiles(voiceFixture);
    await expect(page.locator(".timeline-clip.audio")).toHaveCount(1);
    await page
      .getByLabel("Import music", { exact: true })
      .setInputFiles(musicFixture);
    await expect(page.locator(".timeline-clip.audio")).toHaveCount(2);
    await expect
      .poll(
        async () => (await editorState(request, clip.id)).project.items.length,
      )
      .toBe(3);
    const state = await editorState(request, clip.id);
    expect(
      state.project.items.find(
        (item: { kind: string }) => item.kind === "video",
      ),
    ).toMatchObject({
      volume: 0,
      animation_in: "none",
      animation_labels: { in: "fade" },
      keyframes: expect.arrayContaining([
        expect.objectContaining({ x: 15, time: 2 }),
      ]),
    });
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`\\?studio=${clip.id}$`));
    await expect(page.getByTestId("timeline-item")).toHaveCount(3);
    await page.locator(".timeline-clip.video").click();
    await page.getByLabel("Playhead", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "Split at playhead (S)", exact: true })
      .click();
    await expect(page.locator(".timeline-clip.video")).toHaveCount(2);
    await deleteSelection(page).click();
    await expect(page.locator(".timeline-clip.video")).toHaveCount(1);
    await undo(page).click();
    await expect(page.locator(".timeline-clip.video")).toHaveCount(2);
    await expect
      .poll(
        async () => (await editorState(request, clip.id)).project.items.length,
      )
      .toBe(4);
    const videos = (await editorState(request, clip.id)).project.items.filter(
      (item: { kind: string }) => item.kind === "video",
    );
    expect(videos.map((item: { duration: number }) => item.duration)).toEqual([
      2, 2,
    ]);
    expect(videos[1].source_in).toBe(2);
    const metadata = await exportVideo(page, request);
    expect(metadata).toMatchObject({
      width: 720,
      height: 1280,
      has_audio: true,
    });
    expect(metadata.duration).toBeGreaterThan(3.8);
    fs.writeFileSync(
      path.join(fixtureDir, "compatibility-export-measurements.json"),
      JSON.stringify(metadata, null, 2),
    );
    await page.getByRole("button", { name: "Close export panel" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(fixtureDir, "editor-mobile.png"),
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
  } finally {
    await removeProject(request, clip.id);
  }
});

test("detaching source audio creates a separate track and mutes only its video", async ({
  page,
  request,
}) => {
  const clip = await uploadProject(request, "Extract audio browser test");
  try {
    await openProject(page, clip.id);
    await page.getByTestId("timeline-item").click();
    await page.getByRole("button", { name: "Audio", exact: true }).click();
    await page
      .getByRole("button", { name: "Detach audio", exact: true })
      .click();
    await expect(page.locator(".timeline-clip.audio")).toHaveCount(1, {
      timeout: 30000,
    });
    await expect
      .poll(
        async () => (await editorState(request, clip.id)).project.items.length,
      )
      .toBe(2);
    const state = await editorState(request, clip.id);
    expect(
      state.project.items.find(
        (item: { kind: string }) => item.kind === "video",
      ).muted,
    ).toBe(true);
    const audio = state.project.items.find(
      (item: { kind: string }) => item.kind === "audio",
    );
    const response = await request.get(`/api/assets/${audio.asset_id}`);
    expect(response.ok()).toBe(true);
    expect((await response.body()).length).toBeGreaterThan(10000);
    // The peaks are vertical strokes, so a stroke-only line has no bounding
    // box of its own. Assert the drawn geometry from the real peak values.
    const waveform = page.locator(".timeline-clip.audio .timeline-waveform");
    await expect(waveform).toBeVisible();
    const peaks = await waveform.locator("line").evaluateAll((lines) =>
      lines.map((line) =>
        Math.abs(
          Number(line.getAttribute("y2")) - Number(line.getAttribute("y1")),
        ),
      ),
    );
    expect(peaks.length).toBeGreaterThan(32);
    expect(Math.max(...peaks)).toBeGreaterThan(1);
    await page.locator(".timeline-clip.audio").click();
    await deleteSelection(page).click();
    await expect
      .poll(
        async () => (await editorState(request, clip.id)).project.items.length,
      )
      .toBe(1);
    expect((await request.get(`/api/assets/${audio.asset_id}`)).ok()).toBe(
      true,
    );
  } finally {
    await removeProject(request, clip.id);
  }
});
