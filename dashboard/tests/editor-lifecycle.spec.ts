import { test, expect } from "@playwright/test";
import {
  editorState,
  fixtures,
  removeAllProjects,
  removeProject,
  uploadProject,
} from "./editor-fixtures";

test.beforeAll(fixtures);

// Runs even when a test above times out, so a killed test cannot leak its
// projects into the shared engine and break the specs that run after it.
test.afterAll(async ({ request }) => {
  await removeAllProjects(request);
});

test("a late project response cannot overwrite or save into the next timeline", async ({
  page,
  request,
}) => {
  const first = await uploadProject(request, "Timeline project A");
  const second = await uploadProject(request, "Timeline project B");
  const firstState = await editorState(request, first.id);
  let requested = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/editor/${first.id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    requested = true;
    await gate;
    await route.fulfill({ json: firstState }).catch(() => {});
  });
  try {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Studio", exact: true })
      .click();
    await page.getByLabel("Studio project").selectOption(first.id);
    await expect.poll(() => requested).toBe(true);
    await page.getByLabel("Studio project").selectOption(second.id);
    await expect(page.getByTestId("timeline-item")).toHaveCount(1);
    await expect(page.getByTestId("timeline-item")).toContainText(
      "Timeline project B",
    );
    release();
    await page.getByTestId("timeline-item").click();
    await page.getByLabel("Scale", { exact: true }).fill("125");
    await expect
      .poll(
        async () =>
          (await editorState(request, second.id)).project.items[0].transform
            .scale,
      )
      .toBe(1.25);
    expect(
      (await editorState(request, first.id)).project.items[0].transform.scale,
    ).toBe(1);
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Library", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Studio", exact: true })
      .click();
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
