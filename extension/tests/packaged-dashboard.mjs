// Load the real unpacked MV3 build. API fixtures never touch the owner's data.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium } from "../../dashboard/node_modules/playwright/index.mjs";
const dist = resolve(import.meta.dirname, "../dist");
const profile = await mkdtemp(resolve(tmpdir(), "shortforge-extension-"));
const manifest = JSON.parse(
  await readFile(resolve(dist, "manifest.json"), "utf8"),
);
assert.match(
  manifest.content_security_policy.extension_pages,
  /script-src 'self';/,
);
assert.doesNotMatch(
  manifest.content_security_policy.extension_pages,
  /unsafe-eval|script-src[^;]*https?:/,
);
assert.deepEqual(manifest.host_permissions, [
  "http://127.0.0.1:8787/*",
  "http://localhost:8787/*",
]);
assert.ok(
  manifest.content_scripts.some((script) =>
    script.matches.includes("https://www.instagram.com/*"),
  ),
);
const html = await readFile(resolve(dist, "dashboard/index.html"), "utf8");
assert.doesNotMatch(html, /<script>([\s\S]*?)<\/script>/);
assert.match(html, /src="\.\/assets\//);
const clip = {
  id: "extension-fixture",
  video_id: "ig:Packaged123",
  url: "https://www.instagram.com/reel/Packaged123/",
  title: "Packaged Library fixture",
  channel_name: "Fixture",
  channel_handle: "",
  description: "",
  license_status: "unknown",
  permission_note: "",
  thumbnail_url: "",
  workflow_status: "collected",
  created_at: "2026-10-02",
  assets: [],
  script: null,
  transcript: null,
};
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    "--no-sandbox",
  ],
  viewport: { width: 1440, height: 960 },
});
const errors = [];
context.on("page", (page) => {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      /content security policy|Refused to load|Refused to execute/i.test(
        message.text(),
      )
    )
      errors.push(message.text());
  });
});
const requested = [];
const opened = [];
await context.route("http://127.0.0.1:8787/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname.replace("/api", "");
  requested.push(path);
  let json = {};
  if (path === "/clips") json = { clips: [clip] };
  else if (path === "/health")
    json = { status: "ok", tools: {}, version: "test" };
  else if (path === `/clips/${clip.id}`) json = clip;
  else if (path === "/studio/open") {
    const body = route.request().postDataJSON();
    opened.push(body.clip_id);
    json = {
      id: "concat-extension-job",
      type: "studio-open",
      status: "completed",
      progress: 100,
      result: {
        editor: "Concat",
        clip_id: body.clip_id,
        title: clip.title,
        project_created: true,
        project_path: body.clip_id
          ? `/saved/projects/${body.clip_id}/edit`
          : null,
        opened: true,
      },
    };
  } else if (path.endsWith("/download"))
    return route.fulfill({
      status: 503,
      json: { detail: "Test source is offline. Retry with real footage." },
    });
  else if (path === "/voices") json = { voices: [], providers: [] };
  else if (path.includes("capabilities"))
    json = { available: false, model_ready: false, message: "Test fixture" };
  await route.fulfill({ json });
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/dashboard/index.html`);
  await page
    .getByRole("heading", { name: "Your library", exact: true })
    .waitFor();
  assert.equal(await page.locator(".source-pill").textContent(), "Instagram");
  await page.getByRole("button", { name: `More about ${clip.title}` }).click();
  await page.getByRole("dialog", { name: "Video details" }).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Watch original" })
      .getAttribute("href"),
    clip.url,
  );
  assert.equal(
    await page
      .getByRole("dialog", { name: "Video details" })
      .getByRole("button", { name: "Edit in Studio", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button")
      .count(),
    3,
  );
  const tabs = context.pages().length;
  await page
    .getByRole("dialog", { name: "Video details" })
    .getByRole("button", { name: "Edit in Studio", exact: true })
    .click();
  await page.getByText("Opened in Concat", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("studio"), clip.id);
  assert.equal(context.pages().length, tabs);
  await page
    .getByRole("button", { name: "Open Concat again", exact: true })
    .click();
  await page.getByText("Opened in Concat", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Back to Library", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your library", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.has("studio"), false);
  await page.goto(
    `chrome-extension://${id}/dashboard/index.html?studio=${clip.id}`,
  );
  await page.getByText("Opened in Concat", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("Opened in Concat", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).protocol, "chrome-extension:");
  assert.equal(context.pages().length, tabs);
  assert.deepEqual(opened, [clip.id, clip.id, clip.id, clip.id]);
  assert.ok(requested.includes("/clips"), "Library must fetch from loopback");
  assert.ok(
    requested.includes("/studio/open"),
    "Studio must use the local Concat bridge",
  );
  assert.ok(
    requested.every(
      (path) =>
        !/^\/(editor|projects|seo|export|presets)(?:\/|-|$)/.test(path) &&
        !path.startsWith("/studio/browser/"),
    ),
    "dashboard must not request retired editor, streaming or SEO services",
  );
  assert.deepEqual(
    errors,
    [],
    "packaged assets and scripts must satisfy MV3 CSP",
  );
  console.log(
    "Loaded unpacked MV3 extension: relative assets, strict CSP, loopback API and native Concat handoff passed.",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
