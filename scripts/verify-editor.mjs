// Live visual check of the Studio editor against the running app.
// Captures desktop/mobile light+dark screenshots and asserts the caption
// font actually loads in the browser.
//
// Extended (QA baseline): the font/asset checks below are unchanged; the run
// now also drives the shared harness in scripts/editor-harness.mjs to capture
// the baseline gallery (empty timeline and a populated timeline) and to assert
// every one of those interactions is console-error and 4xx/5xx free.
import { chromium } from "../dashboard/node_modules/playwright/index.mjs";
import { applyAndCapture, captures, openHarness } from "./editor-harness.mjs";
import fs from "node:fs";
import path from "node:path";

const base = process.env.SHORTFORGE_URL || "http://127.0.0.1:5173";
const engine = process.env.SHORTFORGE_ENGINE || "http://127.0.0.1:8787";
const out = path.resolve(import.meta.dirname, "../.impeccable/review/editor");
fs.mkdirSync(out, { recursive: true });

const clips = await (await fetch(`${engine}/api/clips`)).json();
const list = clips.clips || clips;
if (!list.length) throw new Error("No live clips to open.");
const id = list[0].id;
console.log("using clip", id, list[0].title);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const failed = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
});

await page.goto(base);
await page
  .getByRole("navigation", { name: "Main navigation" })
  .getByRole("button", { name: "Studio", exact: true })
  .click();
await page.getByLabel("Studio project").selectOption(id);
await page.waitForSelector(".editor-workspace");
await page.getByRole("button", { name: "Text", exact: true }).click();
await page.evaluate(() => document.fonts.ready);

const loaded = await page.evaluate(async () => {
  const faces = await document.fonts.load('16px "ShortForge Captions"');
  const art = document.querySelector(".editor-template-art > span");
  return {
    count: faces.length,
    check: document.fonts.check('16px "ShortForge Captions"'),
    family: art ? getComputedStyle(art).fontFamily : "missing",
  };
});
console.log("caption font:", JSON.stringify(loaded));
if (!loaded.count || !loaded.check)
  throw new Error("ShortForge Captions font did not load in the browser.");
if (!loaded.family.includes("ShortForge Captions"))
  throw new Error(`template art is not using the caption font: ${loaded.family}`);

const art = await page.locator(".editor-template-art").first().boundingBox();
if (!art || art.width < 20 || art.height < 20)
  throw new Error("template card artwork is not visibly rendered.");

const styled = await page.evaluate(() => {
  const el = document.querySelector(".editor-template-art > span");
  const s = getComputedStyle(el);
  return { fontSize: s.fontSize, stroke: s.webkitTextStrokeWidth };
});
console.log("template art style:", JSON.stringify(styled), "box:", JSON.stringify(art));

for (const theme of ["Light", "Dark"]) {
  await page.getByRole("button", { name: `${theme} theme`, exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(out, `live-editor-${theme.toLowerCase()}.png`),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(out, `live-editor-mobile-${theme.toLowerCase()}.png`),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

console.log("failed requests:", failed.length ? failed : "none");
console.log("page errors:", errors.length ? errors : "none");
await browser.close();
if (errors.length || failed.length)
  throw new Error(
    "Browser problems: " + [...failed, ...errors].join(" | "),
  );

// --- Baseline gallery through the shared harness -------------------------
// Same app, same engine, same real ffmpeg fixtures the Playwright suite uses.
const { checks } = await import("./editor-checks.mjs");
const wanted = (process.env.VERIFY_CHECKS || "baseline-empty,baseline-full")
  .split(",")
  .filter(Boolean);
const harness = await openHarness({ viewport: "desktop" });
try {
  for (const name of wanted) {
    const check = checks[name];
    if (!check) throw new Error(`unknown check "${name}"`);
    console.log(`\n[${name}] ${check.describe}`);
    if (check.prepare) await check.prepare(harness);
    const steps = check.steps ? await check.steps(harness) : [];
    for (const viewport of ["desktop", "mobile"]) {
      for (const theme of ["light", "dark"]) {
        await applyAndCapture(name, steps, { harness, theme, viewport });
      }
    }
  }
} finally {
  await harness.close();
}
const dirty = captures.filter((c) => !c.ok);
for (const capture of dirty)
  console.error(`${capture.file}: ${capture.problems.join(" | ")}`);
console.log("OK");
if (dirty.length) {
  console.error(`${dirty.length} harness capture(s) had browser problems.`);
  process.exitCode = 1;
}