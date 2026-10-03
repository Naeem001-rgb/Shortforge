import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { removeProject } from "./editor-fixtures";
const root = path.join(os.tmpdir(), "shortforge-resume-qa-workspace");
test("library, theme, navigation, settings and responsive layout", async ({
  page,
  context,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Engine connected")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your library." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await page.screenshot({
    path: path.join(root, "docs/screenshots/library-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Dark theme", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: path.join(root, "docs/screenshots/library-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  for (const [button, heading] of [
    ["Scout", "A little curiosity goes a long way."],
    ["Publish kit", "A great first impression."],
  ]) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: button })
      .click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await page.screenshot({
      path: path.join(
        root,
        `.impeccable/review/${button.toLowerCase().replaceAll(" ", "-")}-light.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await page.getByLabel("Channel topic").fill("English science stories");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Your settings are saved.")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Library" })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(root, "docs/screenshots/library-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page.screenshot({
    path: path.join(root, ".impeccable/review/mobile-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  const created = context.waitForEvent("page");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Studio", exact: true })
    .click();
  const editor = await created;
  await expect(editor).toHaveURL(/\?studio=[a-f0-9-]{36}$/);
  const id = new URL(editor.url()).searchParams.get("studio")!;
  try {
    await expect(
      editor.getByRole("textbox", { name: "Project name" }),
    ).toBeVisible();
    await expect(editor.locator("main.studio-tab")).toBeVisible();
    expect(
      await editor.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Your library." }),
    ).toBeVisible();
  } finally {
    await editor.close();
    await removeProject(request, id);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test("select all and permanently delete the chosen videos", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const titles = ["Selectable one", "Selectable two", "Selectable three"];
  const ids: string[] = [];
  for (const title of titles) {
    const response = await request.post("/api/clips", {
      data: {
        clips: [
          {
            url: `https://www.youtube.com/shorts/${randomBytes(8).toString("base64url")}`,
            title,
          },
        ],
      },
    });
    expect(response.ok()).toBeTruthy();
    ids.push((await response.json()).clips[0].id);
  }
  try {
    await page.goto("/");
    const selectAll = page.getByLabel("Select all videos in this view");
    await expect(selectAll).toBeVisible();
    // Nothing matches the search yet, so the control is inert.
    await page.getByLabel("Search videos").fill("no such video anywhere");
    await expect(page.getByText("No videos in this view.")).toBeVisible();
    await expect(selectAll).toBeDisabled();

    await page.getByLabel("Search videos").fill("Selectable");
    await expect(page.getByText("3 selected")).toBeHidden();
    await selectAll.click();
    await expect(page.getByText("3 selected")).toBeVisible();
    for (const title of titles)
      await expect(page.getByLabel(`Select ${title}`)).toBeChecked();

    // Searching must not silently shrink a selection before a delete.
    // Row counts are scoped to the clips this test created: an earlier spec
    // that times out cannot run its cleanup, so the shared engine may still
    // hold its projects when this test runs.
    const own = page.locator(".clip-card", { hasText: "Selectable" });
    await page.getByLabel("Search videos").fill("Selectable one");
    await expect(own).toHaveCount(1);
    await expect(page.getByText("3 selected")).toBeVisible();
    // Select all only touches the rows on screen, so it drops just that one.
    await selectAll.click();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByLabel("Search videos").fill("Selectable");
    await expect(own).toHaveCount(3);
    await expect(page.getByLabel("Select Selectable one")).not.toBeChecked();
    await expect(page.getByLabel("Select Selectable two")).toBeChecked();
    await selectAll.click();
    await expect(page.getByText("3 selected")).toBeVisible();
    // Half-selected is reported as a mixed state, not a plain tick.
    await page.getByLabel("Select Selectable three").uncheck();
    await expect(selectAll).not.toBeChecked();
    expect(await selectAll.evaluate((el) => el.indeterminate)).toBe(true);
    // appearance:none drops the native dash, so a visible mark must be drawn.
    expect(
      await selectAll.evaluate((el) => getComputedStyle(el).backgroundImage),
    ).toContain("data:image/svg+xml");
    await expect(page.getByText("2 selected")).toBeVisible();

    await selectAll.click();
    await expect(page.getByText("3 selected")).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete videos" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("3 videos");
    await expect(dialog).toContainText("cannot be undone");
    for (const title of titles) await expect(dialog).toContainText(title);

    // Cancelling must not delete anything.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    for (const title of titles)
      await expect(page.getByRole("heading", { name: title })).toBeVisible();

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Delete videos" })
      .getByRole("button", { name: "Delete permanently" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Delete videos" }),
    ).toBeHidden();
    for (const title of titles)
      await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
    for (const id of ids)
      expect((await request.get(`/api/clips/${id}`)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    for (const id of ids) await removeProject(request, id);
  }
});
