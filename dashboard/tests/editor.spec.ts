import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  editorState,
  fixtures,
  inspectExport,
  musicFixture,
  removeAllProjects,
  subtitleFixture,
  openProject,
  removeProject,
  root,
  uploadProject,
  voiceFixture,
} from "./editor-fixtures";

test.beforeAll(fixtures);

// Runs even when a test above times out, so a killed test cannot leak its
// projects into the shared engine and break the specs that run after it.
test.afterAll(async ({ request }) => {
  await removeAllProjects(request);
});

test("subtitle templates and motion presets persist and export with the editor layout", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const clip = await uploadProject(request, "Caption template browser test");
  try {
    await openProject(page, clip.id);
    await expect(page.locator(".editor-workspace")).toHaveCSS(
      "display",
      "grid",
    );
    await expect(page.getByLabel("Import media", { exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page
      .getByLabel("Import captions", { exact: true })
      .setInputFiles(subtitleFixture);
    await page
      .getByRole("button", {
        name: "Apply Karaoke highlight template",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: "Apply Karaoke highlight to all captions",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Word animation", { exact: true }),
    ).toHaveValue("karaoke");
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items.filter(
            (i: { kind: string; text_style?: { reveal: string } }) =>
              i.kind === "text" && i.text_style?.reveal === "karaoke",
          ).length,
      )
      .toBe(2);
    await page.getByRole("button", { name: "Motion", exact: true }).click();
    await page
      .getByRole("button", { name: "Apply Pop in animation", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items.find(
            (i: { kind: string }) => i.kind === "text",
          ).animation_in,
      )
      .toBe("pop");
    await page.reload();
    await page
      .locator('[data-testid="timeline-item"][data-kind="text"]')
      .first()
      .click();
    await expect(
      page.getByLabel("Word animation", { exact: true }),
    ).toHaveValue("karaoke");
    await expect(page.getByLabel("In animation", { exact: true })).toHaveValue(
      "pop",
    );
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.getByLabel("Playhead", { exact: true }).fill("1");
    expect(
      await page.evaluate(
        async () =>
          (await document.fonts.load('16px "ShortForge Captions"')).length,
      ),
    ).toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "Light theme", exact: true })
      .click();
    await page.screenshot({
      path: path.join(root, ".impeccable/review/editor/templates-light.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    await page.screenshot({
      path: path.join(root, ".impeccable/review/editor/templates-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByLabel("Export resolution").selectOption("480");
    await page.getByRole("button", { name: "Export MP4", exact: true }).click();
    const download = page.getByRole("link", {
      name: "Download MP4",
      exact: true,
    });
    await expect(download).toBeVisible({ timeout: 60000 });
    expect(
      (await request.get((await download.getAttribute("href"))!)).ok(),
    ).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    const timecode = (await page.locator(".editor-timecode").boundingBox())!;
    const transport = (await page
      .getByRole("button", { name: "Go to beginning" })
      .boundingBox())!;
    expect(timecode.x + timecode.width).toBeLessThanOrEqual(transport.x);
  } finally {
    await removeProject(request, clip.id);
  }
});

test("dragging across tracks, trimming, captions and preview cleanup work together", async ({
  page,
  request,
}) => {
  // Drives real pointer gestures and media decoding, so allow headroom on a
  // busy machine (FFmpeg exports from the neighbouring test saturate the CPU).
  test.setTimeout(120000);
  const clip = await uploadProject(request, "Timeline interaction test");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await openProject(page, clip.id);
    const video = page.locator(
      '[data-testid="timeline-item"][data-kind="video"]',
    );
    await expect(video).toHaveCount(1);
    const body = video.locator(".editor-item-body");
    const box = (await body.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 62, box.y + box.height / 2 + 116, {
      steps: 12,
    });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items[0].track,
      )
      .toBe(2);
    await expect
      .poll(
        async () =>
          (await editorState(request, clip.id)).project.items[0].start,
      )
      .toBe(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.locator(
        '.editor-track[data-track="0"] [data-testid="timeline-item"]',
      ),
    ).toHaveCount(1);

    const handle = video.getByRole("button", { name: /Trim end/ });
    const edge = (await handle.boundingBox())!;
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      edge.x + edge.width / 2 - 32,
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
    await expect(
      page.locator('[data-testid="timeline-item"][data-kind="text"]'),
    ).toHaveCount(2);
    await expect(page.locator(".editor-text-layer").first()).toContainText(
      "Browser test caption",
    );
    await page
      .getByLabel("Import voiceover", { exact: true })
      .setInputFiles(voiceFixture);
    const audio = page.locator(".editor-canvas audio");
    await expect(audio).toHaveCount(1);
    await page
      .getByRole("button", { name: "Play preview", exact: true })
      .click();
    await expect
      .poll(() =>
        audio.evaluate(
          (el: HTMLAudioElement) => !el.paused && el.currentTime > 0.1,
        ),
      )
      .toBe(true);
    await audio.evaluate((el) => {
      (window as any).__removedAudio = el;
    });
    await page
      .getByRole("button", { name: "Delete selected clip", exact: true })
      .click();
    await expect(audio).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (window as any).__removedAudio.paused))
      .toBe(true);
    await page
      .getByRole("button", { name: "Pause preview", exact: true })
      .click();
    expect(errors).toEqual([]);
  } finally {
    await removeProject(request, clip.id);
  }
});

test("timeline editor saves real edits, imported audio, animation and a playable MP4", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const clip = await uploadProject(request);
  const errors: string[] = [];
  const forbiddenRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (
      /\/api\/(tts|rewrite|voices|clips\/[^/]+\/extract-script)(?:\?|$|\/)/.test(
        req.url(),
      )
    )
      forbiddenRequests.push(req.url());
  });
  try {
    await openProject(page, clip.id);
    await expect(page.getByTestId("timeline-item")).toHaveCount(1);
    await page.getByTestId("timeline-item").first().click();
    await page.getByLabel("Volume", { exact: true }).fill("0");
    await page.getByLabel("Scale", { exact: true }).fill("115");
    await page.getByLabel("In animation", { exact: true }).selectOption("fade");
    await page.getByRole("button", { name: /Add keyframe/ }).click();
    await page.getByLabel("Playhead", { exact: true }).fill("2");
    await page.getByLabel("Position X", { exact: true }).fill("15");
    await expect(
      page.getByRole("button", { name: "Go to keyframe 2", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Go to keyframe 2", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Go to keyframe 2", exact: true }),
    ).toBeVisible();

    await page
      .getByLabel("Import voiceover", { exact: true })
      .setInputFiles(voiceFixture);
    await expect(
      page.locator('[data-testid="timeline-item"][data-kind="audio"]'),
    ).toHaveCount(1);
    await page
      .getByLabel("Import music", { exact: true })
      .setInputFiles(musicFixture);
    await expect(
      page.locator('[data-testid="timeline-item"][data-kind="audio"]'),
    ).toHaveCount(2);
    await expect
      .poll(
        async () => (await editorState(request, clip.id)).project.items.length,
      )
      .toBe(3);
    let state = await editorState(request, clip.id);
    expect(
      state.project.items.find(
        (item: { kind: string }) => item.kind === "video",
      ),
    ).toMatchObject({
      volume: 0,
      animation_in: "fade",
      keyframes: expect.arrayContaining([
        expect.objectContaining({ x: 15, time: 2 }),
      ]),
    });

    await page.reload();
    await expect(page.getByLabel("Studio project")).toHaveValue(clip.id);
    await expect(page.getByTestId("timeline-item")).toHaveCount(3);
    await page
      .locator('[data-testid="timeline-item"][data-kind="video"]')
      .click();
    await page.getByLabel("Playhead", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "Split at playhead", exact: true })
      .click();
    await expect(
      page.locator('[data-testid="timeline-item"][data-kind="video"]'),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Delete selected clip", exact: true })
      .click();
    await expect(
      page.locator('[data-testid="timeline-item"][data-kind="video"]'),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page.locator('[data-testid="timeline-item"][data-kind="video"]'),
    ).toHaveCount(2);
    await expect
      .poll(
        async () => (await editorState(request, clip.id)).project.items.length,
      )
      .toBe(4);
    state = await editorState(request, clip.id);
    const videos = state.project.items.filter(
      (item: { kind: string }) => item.kind === "video",
    );
    expect(videos.map((item: { duration: number }) => item.duration)).toEqual([
      2, 2,
    ]);
    expect(videos[1].source_in).toBe(2);

    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    await page.screenshot({
      path: path.join(root, ".impeccable/review/editor/desktop-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Light theme", exact: true })
      .click();
    await page.screenshot({
      path: path.join(root, ".impeccable/review/editor/desktop-light.png"),
      fullPage: true,
      animations: "disabled",
    });

    // Export through the visible UI, then inspect actual bytes/streams from FFmpeg.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByLabel("Export resolution").selectOption("480");
    await page.getByRole("button", { name: "Export MP4", exact: true }).click();
    const download = page.getByRole("link", {
      name: "Download MP4",
      exact: true,
    });
    await expect(download).toBeVisible({ timeout: 120000 });
    const url = await download.getAttribute("href");
    const rendered = await request.get(url!);
    expect(rendered.ok()).toBeTruthy();
    expect(rendered.headers()["content-type"]).toContain("video/mp4");
    const bytes = await rendered.body();
    expect(bytes.length).toBeGreaterThan(10000);
    const metadata = inspectExport(bytes);
    expect(metadata.width).toBe(480);
    expect(metadata.height).toBeGreaterThan(800);
    expect(metadata.has_audio).toBe(true);
    expect(metadata.duration).toBeGreaterThan(3.8);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(root, ".impeccable/review/editor/mobile-light.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    await page.screenshot({
      path: path.join(root, ".impeccable/review/editor/mobile-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(errors).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
  } finally {
    await removeProject(request, clip.id);
  }
});

test("extracting source audio creates a separate track and mutes only its video", async ({
  page,
  request,
}) => {
  const clip = await uploadProject(request, "Extract audio browser test");
  try {
    await openProject(page, clip.id);
    await page.getByTestId("timeline-item").first().click();
    await page.getByRole("button", { name: "Audio", exact: true }).click();
    await page
      .getByRole("button", { name: "Extract audio", exact: true })
      .click();
    await expect(
      page.locator('[data-testid="timeline-item"][data-kind="audio"]'),
    ).toHaveCount(1, { timeout: 30000 });
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
    expect(response.ok()).toBeTruthy();
    expect((await response.body()).length).toBeGreaterThan(10000);
    await page
      .locator('[data-testid="timeline-item"][data-kind="audio"]')
      .click();
    await page
      .getByRole("button", { name: "Delete selected clip", exact: true })
      .click();
    await expect
      .poll(
        async () => (await editorState(request, clip.id)).project.items.length,
      )
      .toBe(1);
    // Timeline deletion is nondestructive: the extracted media remains available.
    expect(
      (await request.get(`/api/assets/${audio.asset_id}`)).ok(),
    ).toBeTruthy();
  } finally {
    await removeProject(request, clip.id);
  }
});
