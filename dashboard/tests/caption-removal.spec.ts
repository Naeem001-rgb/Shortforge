import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  fixtures,
  openProject,
  uploadProject,
  removeAllProjects,
  editorState,
  videoFixture,
  root,
} from "./editor-fixtures";

test.beforeAll(fixtures);
test.afterAll(async ({ request }) => removeAllProjects(request));

test("caption removal previews, applies only on request, survives reload and undoes", async ({
  page,
  request,
}) => {
  const clip = await uploadProject(request, "Caption removal workflow");
  const imported = await request.post(`/api/editor/${clip.id}/media`, {
    multipart: {
      role: "video",
      file: {
        name: "cleaned-test.mp4",
        mimeType: "video/mp4",
        buffer: fs.readFileSync(videoFixture),
      },
    },
  });
  expect(imported.ok()).toBeTruthy();
  const cleaned = await imported.json();
  const originalState = await editorState(request, clip.id);
  const originalId = originalState.project.items[0].asset_id;
  await page.route("**/api/editor-capabilities", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        inpainting: { available: true, message: "Ready" },
      },
    });
  });
  let sequence = 0;
  let lastPayload: any;
  await page.route(
    `**/api/editor/${clip.id}/remove-captions`,
    async (route) => {
      lastPayload = route.request().postDataJSON();
      await route.fulfill({
        json: {
          id: `removal-${++sequence}`,
          status: "completed",
          progress: 100,
          type: "editor_remove_captions",
          result: {
            request:
              sequence === 2
                ? { ...lastPayload, processing_mode: "fast" }
                : lastPayload,
            asset: cleaned,
            seconds: 2,
          },
        },
      });
    },
  );
  await openProject(page, clip.id);
  await page.getByTestId("timeline-item").click();
  await expect(page.getByLabel("Cover existing captions")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove burned-in captions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Remove burned-in captions",
  });
  await expect(
    dialog.getByRole("button", { name: "Preview 1 second" }),
  ).toBeEnabled();
  await expect(dialog.locator(".removal-picture")).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Processing", exact: true }),
  ).toHaveCount(0);
  const rect = await dialog.locator(".removal-picture").boundingBox();
  expect(rect!.width).toBeGreaterThan(60);
  expect(rect!.height).toBeGreaterThan(120);
  await dialog.getByRole("slider", { name: "Preview start" }).focus();
  await dialog
    .getByRole("slider", { name: "Preview start" })
    .press("ArrowRight");
  await dialog.getByRole("button", { name: "Preview 1 second" }).click();
  await expect(dialog.locator(".removal-result")).toBeVisible();
  expect(lastPayload.preview).toBe(true);
  expect(lastPayload.duration).toBe(1);
  expect(lastPayload.mask_mode).toBe("text");
  expect(lastPayload.processing_mode).toBeUndefined();
  expect(lastPayload.start).toBeCloseTo(0.1);
  await page.reload();
  await expect(page.getByTestId("timeline-item")).toHaveCount(1);
  await page.getByTestId("timeline-item").click();
  await page
    .getByRole("button", { name: "Remove burned-in captions", exact: true })
    .click();
  await expect(
    dialog.getByRole("slider", { name: "Preview start" }),
  ).toHaveValue("0.1");
  await expect(dialog.getByText("Cleaned preview · 0.1–1.1s")).toBeVisible();
  await expect
    .poll(() =>
      dialog
        .locator(".removal-picture video")
        .evaluate((el: HTMLVideoElement) => el.currentTime),
    )
    .toBeCloseTo(0.1, 1);
  await dialog.getByRole("slider", { name: "Preview start" }).focus();
  await dialog.getByRole("slider", { name: "Preview start" }).press("Home");
  await expect(
    dialog.getByText(/Preview again to see the newly selected time/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Use cleaned clip" }),
  ).toHaveCount(0);
  expect((await editorState(request, clip.id)).project.items[0].asset_id).toBe(
    originalId,
  );
  const review = path.join(root, ".impeccable/review/caption-removal");
  fs.mkdirSync(review, { recursive: true });
  await page.screenshot({
    path: path.join(review, "desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(review, "mobile.png"),
    fullPage: true,
  });
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog
    .getByRole("button", { name: "Remove from selected clip" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Use cleaned clip" }),
  ).toBeVisible();
  expect(lastPayload.preview).toBe(false);
  expect(lastPayload.start).toBe(0);
  expect(lastPayload.duration).toBeCloseTo(
    originalState.project.items[0].duration,
  );
  await page.reload();
  await expect(page.getByTestId("timeline-item")).toHaveCount(1);
  const showInspector = page.getByRole("button", {
    name: "Show inspector",
    exact: true,
  });
  if (await showInspector.isVisible()) await showInspector.click();
  await page.getByTestId("timeline-item").click();
  await page
    .getByRole("button", { name: "Remove burned-in captions", exact: true })
    .click();
  await expect(
    dialog.getByText(/This result used the removed Fast mode/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Use cleaned clip" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Remove from selected clip" })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Use cleaned clip" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Use cleaned clip" }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await editorState(request, clip.id)).project.items[0].asset_id,
    )
    .toBe(cleaned.id);
  await page
    .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await editorState(request, clip.id)).project.items[0].asset_id,
    )
    .toBe(originalId);
});

test("a running removal exposes cancellation and keeps backend errors visible", async ({
  page,
  request,
}) => {
  const clip = await uploadProject(request, "Cancel removal workflow");
  await page.route("**/api/editor-capabilities", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        inpainting: { available: true, message: "Ready" },
      },
    });
  });
  let state: any;
  await page.route(
    `**/api/editor/${clip.id}/remove-captions`,
    async (route) => {
      state = {
        id: "pending-removal",
        status: "running",
        progress: 20,
        type: "editor_remove_captions",
        result: { request: route.request().postDataJSON() },
      };
      await route.fulfill({ json: state });
    },
  );
  await page.route("**/api/jobs/pending-removal", (route) =>
    route.fulfill({ json: state }),
  );
  await page.route(
    `**/api/editor/${clip.id}/remove-captions/pending-removal/cancel`,
    async (route) => {
      state = {
        ...state,
        status: "failed",
        error: "Caption removal cancelled. Your original is unchanged.",
      };
      await route.fulfill({ json: { message: "Cancellation requested" } });
    },
  );
  await openProject(page, clip.id);
  await page.getByTestId("timeline-item").click();
  await page
    .getByRole("button", { name: "Remove burned-in captions", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Preview 1 second" }).click();
  await expect(
    dialog.getByRole("button", { name: "Remove from selected clip" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Cancel removal", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("cancelled");
  await expect(
    dialog.getByRole("button", { name: "Preview 1 second" }),
  ).toBeEnabled();
});
