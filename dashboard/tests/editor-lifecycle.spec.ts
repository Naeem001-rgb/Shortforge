import { test, expect } from "@playwright/test";
import {
  editorState,
  fixtures,
  openProject,
  removeAllProjects,
  removeProject,
  uploadProject,
} from "./editor-fixtures";

test.beforeAll(fixtures);
test.beforeEach(async ({ page }) => {
  // Keep an in-flight lifecycle scenario stable if a development build changes.
  await page.routeWebSocket(/127\.0\.0\.1:5174/, () => {});
});

// Runs even when a test above times out, so a killed test cannot leak its
// projects into the shared engine and break the specs that run after it.
test.afterAll(async ({ request }) => {
  await removeAllProjects(request);
});

test("a late save response cannot overwrite or save into the next timeline", async ({
  page,
  request,
}) => {
  const first = await uploadProject(request, "Timeline project A");
  const second = await uploadProject(request, "Timeline project B");
  let requested = false;
  let returned = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/editor/${first.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    requested = true;
    await gate;
    await route.fulfill({ response }).catch(() => {});
    returned = true;
  });
  try {
    await openProject(page, first.id);
    await page.getByLabel("Scale", { exact: true }).fill("110");
    await expect.poll(() => requested).toBe(true);
    await page.getByLabel("Project menu", { exact: true }).click();
    await page.getByLabel("Studio project").selectOption(second.id);
    await expect(page.getByTestId("timeline-item")).toHaveCount(1);
    await expect(page.getByTestId("timeline-item")).toContainText(
      "Timeline project B",
    );
    await page.getByTestId("timeline-item").click();
    await page.getByLabel("Scale", { exact: true }).fill("125");
    await expect
      .poll(
        async () =>
          (await editorState(request, second.id)).project.items[0].transform
            .scale,
      )
      .toBe(1.25);
    release();
    await expect.poll(() => returned).toBe(true);
    await expect(page.getByTestId("timeline-item")).toContainText(
      "Timeline project B",
    );
    await expect(page.getByLabel("Scale", { exact: true })).toHaveValue("125");
    expect(
      (await editorState(request, first.id)).project.items[0].transform.scale,
    ).toBe(1.1);
    await page.getByLabel("Project menu", { exact: true }).click();
    await page.getByLabel("Studio project").selectOption(first.id);
    await expect(page.getByLabel("Scale", { exact: true })).toHaveValue("110");
    await page.getByLabel("Project menu", { exact: true }).click();
    await page.getByLabel("Studio project").selectOption(second.id);
    await page.getByTestId("timeline-item").click();
    await expect(page.getByLabel("Scale", { exact: true })).toHaveValue("125");
    await page.reload();
    await page.getByTestId("timeline-item").click();
    await expect(page.getByLabel("Scale", { exact: true })).toHaveValue("125");
  } finally {
    release();
    await removeProject(request, first.id);
    await removeProject(request, second.id);
  }
});
