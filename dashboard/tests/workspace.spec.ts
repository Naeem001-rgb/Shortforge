import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
const root = path.resolve(import.meta.dirname, "../..");
const fixture = path.join(os.tmpdir(), "shortforge-browser-fixture.mp4");
test.beforeAll(() => {
  const ffmpeg = execFileSync(
    path.join(root, ".venv/bin/python"),
    ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"],
    { encoding: "utf8" },
  ).trim();
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x35516e:s=360x640:r=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      fixture,
    ],
    { stdio: "ignore" },
  );
});
test("library, theme, navigation, settings and responsive layout", async ({
  page,
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
    ["Studio", "Your story, taking shape."],
    ["Voice lab", "Give your stories a voice."],
    ["Publish kit", "A great first impression."],
  ]) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: button })
      .click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
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
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Voice lab" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Give your stories a voice." }),
  ).toBeVisible();
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
    await page.getByLabel("Search videos").fill("Selectable one");
    await expect(page.locator(".clip-card")).toHaveCount(1);
    await expect(page.getByText("3 selected")).toBeVisible();
    // Select all only touches the rows on screen, so it drops just that one.
    await selectAll.click();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByLabel("Search videos").fill("");
    await expect(page.locator(".clip-card")).toHaveCount(3);
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
    for (const id of ids) await request.delete(`/api/clips/${id}`);
  }
});

test("import inspiration, save permission, upload own video and render a captioned Short", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add a video", exact: true }).click();
  await page
    .getByLabel("YouTube URL")
    .fill("https://youtube.com/shorts/tleaVXWF3YI");
  await page.getByLabel("Project title").fill("Narrated Short reference");
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Narrated Short reference" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View inspiration", exact: true })
    .click();
  await expect(
    page.getByText("Keep the inspiration. Check the permission."),
  ).toBeVisible();
  await page.route("**/api/clips/*/extract-script", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        detail:
          "Captions unavailable for this test. Paste a script or use Gemini.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Open script", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Same story. Your words." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Write from topic instead", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/Gemini|key/i);
  await page.getByRole("button", { name: "Add footage" }).click();
  await page
    .getByRole("button", { name: "Upload footage", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles(fixture);
  await page.getByLabel("Project title").fill("Browser export test");
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page
    .getByLabel("Studio project")
    .selectOption({ label: "Browser export test" });
  await expect(page.getByText("Footage ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Script", exact: true }).click();
  await page
    .getByLabel("Original script", { exact: false })
    .fill("A small idea becomes a new story.");
  await page
    .getByLabel("Your new script")
    .fill("A small idea becomes a new story.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Script saved to this project.")).toBeVisible();
  await page.getByRole("button", { name: "Captions", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Bold Pop", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bold Pop", exact: false }).click();
  await page.screenshot({
    path: path.join(root, "docs/screenshots/studio-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Export Short", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download MP4" })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.getByText(/Approximate caption timing/)).toBeVisible();
  const url = await page
    .getByRole("link", { name: "Download MP4" })
    .getAttribute("href");
  const video = await request.get(url!);
  expect(video.ok()).toBeTruthy();
  expect(video.headers()["content-type"]).toContain("video/mp4");
  expect((await video.body()).length).toBeGreaterThan(1000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(root, "docs/screenshots/studio-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
