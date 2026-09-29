import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
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
  await page.getByRole("button", { name: "Write an original script" }).click();
  await expect(
    page.getByRole("heading", { name: "Start an original story." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Write original script", exact: true })
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
    .getByLabel("Original transcript", { exact: false })
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
