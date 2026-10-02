/**
 * ShortForge Studio editor — reusable browser verification harness.
 *
 * Shared driver for scripts/verify-editor.mjs, the baseline gallery runner,
 * and anyone adding a new feature check. It owns:
 *   - launching real Chrome against the running app + engine,
 *   - creating a REAL project from the real ffmpeg fixtures,
 *   - driving the editor by accessible name through a tiny step DSL,
 *   - screenshotting into .impeccable/review/editor/,
 *   - asserting no console errors and no failed (4xx/5xx) requests.
 *
 * Fixture generation and engine calls are NOT reimplemented here: the helpers
 * in dashboard/tests/editor-fixtures.ts are imported directly so the harness
 * and the Playwright suite always exercise the same media.
 *
 * CLI:   node scripts/editor-harness.mjs --checks=baseline-empty,baseline-full
 *        node scripts/editor-harness.mjs --checks=baseline-full --themes=dark
 *
 * Library:
 *   import { openHarness, applyAndCapture } from "./editor-harness.mjs";
 *   const h = await openHarness();
 *   const clip = await h.createProject("QA feature check");
 *   await h.openProject(clip.id);
 *   await applyAndCapture("my-feature", ["tab:Text", "click:Add text"], {
 *     harness: h, theme: "light", viewport: "desktop",
 *   });
 *   await h.close();
 */
import {
  chromium,
  request as playwrightRequest,
} from "../dashboard/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const APP_URL = process.env.SHORTFORGE_URL || "http://127.0.0.1:5173";
export const ENGINE_URL =
  process.env.SHORTFORGE_ENGINE || "http://127.0.0.1:8787";
export const REVIEW_DIR = path.join(ROOT, ".impeccable/review/editor");

export const VIEWPORTS = {
  desktop: { width: 1440, height: 1000 },
  mobile: { width: 390, height: 844 },
};
export const THEMES = { light: "Light", dark: "Dark" };

/** Every capture this process made, for the final summary. */
export const captures = [];

// Real ffmpeg media + engine helpers, reused from the Playwright suite.
const fx = await import("../dashboard/tests/editor-fixtures.ts");
export const fixtures = fx.fixtures;
export const uploadProject = fx.uploadProject;
export const openProject = fx.openProject;
export const editorState = fx.editorState;
export const removeProject = fx.removeProject;
export const videoFixture = fx.videoFixture;
export const voiceFixture = fx.voiceFixture;
export const musicFixture = fx.musicFixture;
export const subtitleFixture = fx.subtitleFixture;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (message) => console.log(`  · ${message}`);
/**
 * Launch Chrome, open the app, and start recording browser problems.
 * Returns the harness handle every other helper takes.
 */
export async function openHarness(options = {}) {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({
    baseURL: APP_URL,
    viewport: VIEWPORTS[options.viewport || "desktop"] || options.viewport,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  // APIRequestContext so the editor-fixtures helpers (relative "/api/upload")
  // work against the live engine.
  const api = await playwrightRequest.newContext({ baseURL: ENGINE_URL });

  const problems = { errors: [], failed: [] };
  // requestfailed is noisy by design (aborted media preloads, cancelled
  // navigations): reported, but not asserted.
  const aborted = [];
  page.on("pageerror", (e) => problems.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) problems.failed.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    aborted.push(
      `requestfailed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`,
    );
  });

  const harness = {
    browser,
    context,
    page,
    api,
    problems,
    aborted,
    project: undefined,
    /** Every project this harness created, so close() can delete them all. */
    projects: [],
    /** Real fixture files on disk, for checks that import media. */
    media: {
      video: fx.videoFixture,
      voice: fx.voiceFixture,
      music: fx.musicFixture,
      subtitles: fx.subtitleFixture,
    },
    /** Snapshot the problem log so a capture asserts only on NEW problems. */
    mark() {
      return {
        errors: problems.errors.length,
        failed: problems.failed.length,
        aborted: aborted.length,
      };
    },
    since(mark) {
      return [
        ...problems.errors.slice(mark.errors),
        ...problems.failed.slice(mark.failed),
      ];
    },
    /** Create a real project on the live engine from the real video fixture. */
    async createProject(title) {
      fixtures();
      const clip = await uploadProject(api, title);
      harness.project = { id: clip.id, title };
      harness.projects.push(clip.id);
      log(`created project ${clip.id} "${title}"`);
      return clip;
    },
    /** On mobile the sidebar is `inert` until the drawer is opened. */
    async ensureNav() {
      const sidebar = page.locator("#workspace-navigation");
      const inert = await sidebar
        .evaluate((el) => el.hasAttribute("inert"))
        .catch(() => false);
      if (!inert) return false;
      const opener = page.getByRole("button", { name: "Open navigation" });
      if (await opener.isVisible()) {
        await opener.click();
        await sleep(350);
        return true;
      }
      return false;
    },
    /** Open the project in Studio and wait for the editor to mount. */
    async openProject(id = harness.project?.id) {
      if (!id) throw new Error("openProject() needs a project id");
      // A previous capture may have left the page at 390px, where the sidebar
      // is inert and the nav buttons cannot be clicked at all.
      await harness.setViewport("desktop");
      await harness.ensureNav();
      await openProject(page, id);
      await page.waitForSelector(".editor-workspace", { timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      harness.project = { id, ...(harness.project || {}) };
      return id;
    },
    state() {
      if (!harness.project) throw new Error("no project created yet");
      return editorState(api, harness.project.id);
    },
    /**
     * Poll the SAVED project until `match(kinds, state)` is true. The editor
     * autosaves on a debounce, so a UI change is not persisted the instant it
     * renders.
     */
    async waitForItems(match, options = {}) {
      const timeout = options.timeout || 30000;
      const what = options.label || "project items";
      const deadline = Date.now() + timeout;
      let kinds = [];
      let lastError;
      while (Date.now() < deadline) {
        try {
          const state = await harness.state();
          kinds = state.project.items.map((i) => i.kind);
          if (match(kinds, state)) return state;
          lastError = undefined;
        } catch (error) {
          // The engine can drop a keep-alive socket under load; that is not a
          // product failure, so keep polling until the deadline.
          lastError = error;
        }
        await sleep(400);
      }
      throw new Error(
        `timed out after ${timeout}ms waiting for ${what}; saved timeline: ${kinds.join(",") || "empty"}` +
          (lastError ? `; last request error: ${lastError.message || lastError}` : ""),
      );
    },
    /** Set the app colour theme by its accessible name. */
    async setTheme(theme) {
      const label = THEMES[theme] || theme;
      await page
        .getByRole("button", { name: `${label} theme`, exact: true })
        .click();
      await sleep(400);
    },
    async setViewport(viewport) {
      await page.setViewportSize(VIEWPORTS[viewport] || viewport);
      await sleep(250);
    },
    async close() {
      // Delete EVERY project this run created, not just the current one, or a
      // multi-check run leaves its fixtures in the user's library.
      for (const id of new Set([...harness.projects, harness.project?.id])) {
        try {
          await removeProject(api, id);
        } catch {
          /* best effort; never mask the real failure */
        }
      }
      await api.dispose();
      await context.close();
      await browser.close();
    },
  };
  return harness;
}
/* ------------------------------------------------------------------ *
 * Step DSL: "verb:target" or "verb:target=value"
 * ------------------------------------------------------------------ */

function parseStep(step) {
  const colon = step.indexOf(":");
  if (colon < 0) return { verb: step, target: "", value: "" };
  const verb = step.slice(0, colon);
  const rest = step.slice(colon + 1);
  const eq = rest.indexOf("=");
  return eq < 0
    ? { verb, target: rest, value: "" }
    : { verb, target: rest.slice(0, eq), value: rest.slice(eq + 1) };
}

/** Resolve a target string to a locator, by accessible name. */
export function locate(harness, kind, target) {
  const { page } = harness;
  switch (kind) {
    case "button":
      return page.getByRole("button", { name: target, exact: true });
    case "nav":
      return page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: target, exact: true });
    case "tab":
      return page
        .getByRole("navigation", { name: "Editor tools" })
        .getByRole("button", { name: target, exact: true });
    case "group":
      return page.getByRole("group", { name: target, exact: true });
    case "status":
      return page.getByRole("status").filter({ hasText: target });
    case "label":
      return page.getByLabel(target, { exact: true });
    case "item":
      return page.locator(
        `[data-testid="timeline-item"][data-kind="${target}"]`,
      );
    case "testid":
      return page.getByTestId(target);
    case "css":
      return page.locator(target);
    default:
      throw new Error(`unknown locator kind "${kind}"`);
  }
}

async function waitForGone(locator) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if ((await locator.count()) === 0) return;
    await sleep(100);
  }
  throw new Error("timed out waiting for the element to disappear");
}

/**
 * Perform ONE named UI interaction and return the step for logging.
 * Verbs:
 *   click|nav|tab        click a button / main-nav button / editor bin tab
 *   fill|select|upload   act on a form control by its accessible label
 *   check:<label>=<v>    assert an input's value
 *   text:<substring>     wait for a role=status message containing it
 *   count:<kind>=<n>     assert n timeline items of that kind
 *   gone:<button|css>    assert an element disappears
 *   wait:<ms>            settle time
 */
export async function runStep(harness, step) {
  const { verb, target, value } = parseStep(step);
  const where = (kind) => locate(harness, kind, target);
  switch (verb) {
    case "click":
      await where("button").click();
      break;
    case "nav":
      await harness.ensureNav();
      await where("nav").click();
      break;
    case "tab":
      await where("tab").click();
      break;
    case "fill":
      await where("label").fill(value);
      break;
    case "select":
      await where("label").selectOption(value);
      break;
    case "upload":
      await where("label").setInputFiles(path.resolve(ROOT, value));
      break;
    case "check": {
      const locator = where("label");
      await locator.waitFor({ state: "attached", timeout: 30000 });
      const actual = await locator.inputValue();
      if (actual !== value)
        throw new Error(
          `"${target}" was "${actual}", expected "${value}" (step: ${step})`,
        );
      break;
    }
    case "text":
      await where("status").waitFor({ timeout: 30000 });
      break;
    case "count": {
      // Poll: the count may need to reach the expected value (import in
      // flight) or drain down to zero (a deleted clip).
      const locator = where("item");
      const deadline = Date.now() + 30000;
      let actual = -1;
      while (Date.now() < deadline) {
        actual = await locator.count();
        if (String(actual) === value) break;
        await sleep(150);
      }
      if (String(actual) !== value)
        throw new Error(
          `expected ${value} "${target}" timeline items, found ${actual}`,
        );
      break;
    }
    case "gone":
      await waitForGone(where(target.startsWith("[") ? "css" : "button"));
      break;
    case "wait":
      await sleep(Number(target || 250));
      break;
    default:
      throw new Error(
        `unknown step verb "${verb}" in "${step}" (see docs/QA-HARNESS.md)`,
      );
  }
  return step;
}

export async function runSteps(harness, steps = []) {
  for (const step of steps) {
    await runStep(harness, step);
    log(`step ${step}`);
  }
}

/* ------------------------------------------------------------------ *
 * applyAndCapture — the one helper a feature check needs
 * ------------------------------------------------------------------ */

/**
 * Run `steps` in the editor, screenshot the result, and assert the interaction
 * produced no console errors and no failed (4xx/5xx) requests.
 *
 * @param {string} label    screenshot basename, e.g. "baseline-full"
 * @param {string[]} steps  step DSL entries (see runStep)
 * @param {object} options  { harness, theme: "light"|"dark",
 *                            viewport: "desktop"|"mobile"|{width,height},
 *                            fullPage?: boolean }
 * @returns {Promise<{label,file,theme,viewport,problems,ok}>}
 */
export async function applyAndCapture(label, steps = [], options = {}) {
  const harness = options.harness;
  if (!harness) throw new Error("applyAndCapture needs options.harness");
  const { page } = harness;
  const theme = options.theme || "light";
  const viewport = options.viewport || "desktop";
  const fullPage = options.fullPage !== false;

  await harness.setViewport(viewport);
  await harness.setTheme(theme);
  const mark = harness.mark();

  let failure;
  try {
    await runSteps(harness, steps);
    await page.evaluate(() => document.fonts.ready);
    await sleep(350); // let CSS transitions settle before the capture
  } catch (error) {
    failure = error;
  }

  // Capture either way so a failing check leaves visual evidence behind.
  const file = path.join(REVIEW_DIR, `${label}--${viewport}-${theme}.png`);
  const problems = [
    ...(failure ? [String(failure.message || failure)] : []),
    ...harness.since(mark),
  ];
  await page
    .screenshot({ path: file, fullPage, animations: "disabled" })
    .catch((e) => problems.push(`screenshot failed: ${e.message}`));

  const result = {
    label,
    file,
    theme,
    viewport: typeof viewport === "string" ? viewport : `${viewport.width}x${viewport.height}`,
    problems,
    ok: problems.length === 0,
  };
  captures.push(result);
  if (result.ok) log(`captured ${path.relative(ROOT, file)}`);
  else for (const problem of problems) console.error(`  ! ${problem}`);
  return result;
}

/** Print every capture made in this process; returns the failure count. */
export function summarize() {
  console.log("\ncaptures:");
  for (const c of captures) {
    console.log(
      `  ${c.ok ? "ok  " : "FAIL"} ${path.relative(ROOT, c.file)} (${c.viewport}/${c.theme})`,
    );
    for (const problem of c.problems) console.log(`       ${problem}`);
  }
  const failed = captures.filter((c) => !c.ok);
  console.log(
    `\n${captures.length - failed.length}/${captures.length} captures clean, ${failed.length} with problems`,
  );
  return failed.length;
}

/* ------------------------------------------------------------------ *
 * CLI — runs many named checks in one pass
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = {
    checks: [],
    themes: ["light", "dark"],
    viewports: ["desktop", "mobile"],
    keep: false,
  };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "checks") args.checks = value.split(",").filter(Boolean);
    else if (key === "themes") args.themes = value.split(",").filter(Boolean);
    else if (key === "viewports")
      args.viewports = value.split(",").filter(Boolean);
    else if (key === "keep") args.keep = true;
    else if (key === "help") args.help = true;
  }
  return args;
}

const USAGE = `
ShortForge editor browser harness

  node scripts/editor-harness.mjs [options]

  --checks=a,b        named checks from scripts/editor-checks.mjs
                      (default: every check)
  --themes=light,dark
  --viewports=desktop,mobile
  --keep              do not delete the fixture projects afterwards
  --help

Screenshots land in .impeccable/review/editor/<check>--<viewport>-<theme>.png
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const { checks } = await import("./editor-checks.mjs");
  const names = args.checks.length ? args.checks : Object.keys(checks);
  const unknown = names.filter((n) => !checks[n]);
  if (unknown.length) {
    console.error(`unknown check(s): ${unknown.join(", ")}`);
    console.error(`available: ${Object.keys(checks).join(", ")}`);
    return 2;
  }

  for (const name of names) {
    const check = checks[name];
    console.log(`\n[${name}] ${check.describe}`);
    const harness = await openHarness({ viewport: args.viewports[0] });
    try {
      if (check.prepare) await check.prepare(harness);
      const steps = check.steps ? await check.steps(harness) : [];
      for (const viewport of args.viewports) {
        for (const theme of args.themes) {
          await applyAndCapture(name, steps, { harness, theme, viewport });
        }
      }
    } catch (error) {
      const message = String(error.message || error);
      captures.push({
        label: name,
        file: path.join(REVIEW_DIR, `${name}.FAILED.png`),
        theme: "-",
        viewport: "-",
        problems: [message],
        ok: false,
      });
      console.error(`  ! check threw: ${message}`);
      await harness.page
        .screenshot({
          path: path.join(REVIEW_DIR, `${name}.FAILED.png`),
          fullPage: true,
          animations: "disabled",
        })
        .catch(() => {});
    } finally {
      if (args.keep) console.log("  · --keep: fixture project left in the library");
      else await harness.close();
    }
  }
  return summarize() ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
