# QA harness — browser verification for the Studio editor

Everything here drives the **real** running app in real headless Chrome. No
mocks, no stubbed media: the editor is fed genuine ffmpeg-generated MP4/WAV/SRT
fixtures and every assertion is made against what the browser actually did.

| File | What it is |
| --- | --- |
| `scripts/editor-harness.mjs` | The reusable harness: launch, project setup, step DSL, capture, assertions, CLI. |
| `scripts/editor-checks.mjs` | The named checks (including the baseline gallery). Add new feature checks here. |
| `scripts/verify-editor.mjs` | Live visual check. Keeps its original caption-font/asset assertions and now also runs the baseline gallery through the harness. |
| `dashboard/tests/editor-fixtures.ts` | The fixture generator + engine helpers the harness imports (shared with the Playwright suite). |
| `.impeccable/review/editor/` | Where every screenshot lands. |

## Prerequisites

The app must already be running:

```bash
curl -s http://127.0.0.1:5173   # Vite dev server (dashboard)
curl -s http://127.0.0.1:8787   # engine API
```

Chrome is at `/usr/bin/google-chrome` and Playwright is imported from
`dashboard/node_modules/playwright/index.mjs`. Override with `CHROME_PATH`,
`SHORTFORGE_URL`, `SHORTFORGE_ENGINE` if needed.

## Running it

```bash
# every check, both themes, both viewports
node scripts/editor-harness.mjs

# one check, one combination
node scripts/editor-harness.mjs --checks=baseline-full --themes=dark
node scripts/editor-harness.mjs --checks=baseline-empty --viewports=mobile

# keep the fixture projects in your library instead of deleting them
node scripts/editor-harness.mjs --checks=baseline-full --keep

node scripts/editor-harness.mjs --help
```

`node scripts/verify-editor.mjs` still works as before (it asserts the caption
font loads and captures `live-editor-*.png`) and additionally runs
`baseline-empty` and `baseline-full`. Override that set with
`VERIFY_CHECKS=audio-tracks node scripts/verify-editor.mjs`.

The process exits non-zero if any check throws, or if any capture recorded a
console error or a 4xx/5xx response.

### What each capture asserts

`applyAndCapture(label, steps, { theme, viewport })` snapshots the browser
problem log, runs the steps, screenshots, then fails the capture if anything new
appeared in it:

* `pageerror` — uncaught exceptions
* `console` messages of type `error`
* any HTTP response with status >= 400

`requestfailed` is collected on `harness.aborted` but **not** asserted: aborted
media preloads and cancelled navigations are normal in this app.

## Screenshots

```
.impeccable/review/editor/<check>--<viewport>-<theme>.png
```

Viewports: `desktop` = 1440x1000, `mobile` = 390x844. Themes: `light`, `dark`.
Every capture is `fullPage` with animations disabled, so images diff cleanly.

## Adding a new feature check

Add one entry to `checks` in `scripts/editor-checks.mjs`:

```js
"my-feature": {
  describe: "one line printed in the run log",
  // Runs ONCE per check. Do real setup here: create a project, import media
  // through the UI. Never screenshotted, so it is free to be slow.
  async prepare(harness) {
    await harness.createProject("QA my feature");
    await harness.openProject();
    await harness.page.getByLabel("Import music", { exact: true })
      .setInputFiles(harness.media.music);
  },
  // Replayed for every theme x viewport capture.
  steps: () => ["tab:Audio", "fill:Playhead=1"],
},
```

Then run it:

```bash
node scripts/editor-harness.mjs --checks=my-feature
```

If the setup needs to assert that a change was **persisted** (not just
rendered), poll the engine instead of reading once — the editor autosaves on a
debounce:

```js
await harness.waitForItems(
  (kinds) => kinds.filter((k) => k === "audio").length >= 2,
  { label: "two saved audio clips", timeout: 60000 },
);
```

### Do not import `editor-harness.mjs` from `editor-checks.mjs`

`editor-harness.mjs` has a top-level `await` (it imports the TS fixtures), so a
static import back into the checks module deadlocks the CLI. Use the `harness`
object that is passed to `prepare`/`steps` — it carries `harness.media.video`,
`harness.media.voice`, `harness.media.music`, `harness.media.subtitles`.

## The step DSL

Steps are strings: `"verb:target"` or `"verb:target=value"`. Targets are
**accessible names**, so a renamed button fails loudly instead of silently
missing.

| Verb | Meaning |
| --- | --- |
| `click:<name>` | click a button by accessible name |
| `nav:<name>` | click a main-navigation button (opens the mobile drawer first if needed) |
| `tab:<name>` | click an editor bin tab (Media / Audio / Text / Motion) |
| `fill:<label>=<v>` | fill a form control by its accessible label |
| `select:<label>=<v>` | choose an option in a select by accessible label |
| `upload:<label>=<path>` | `setInputFiles` on a file input (absolute or repo-relative) |
| `check:<label>=<v>` | assert an input's value |
| `text:<substring>` | wait for a `role=status` message containing the substring |
| `count:<kind>=<n>` | poll until the timeline holds exactly n clips of that kind (`video`, `audio`, `text`) |
| `gone:<button name>` | assert an element disappears |
| `wait:<ms>` | settle time |

### Harness API

```js
const h = await openHarness({ viewport: "desktop" });
await h.createProject("title");        // real upload of the video fixture
await h.openProject(id);               // Studio + editor mounted (resets to desktop first)
await h.state();                       // GET /api/editor/:id
await h.waitForItems(pred, opts);      // poll the SAVED project
await h.setTheme("dark"); await h.setViewport("mobile");
h.media;                               // fixture paths
h.problems; h.aborted;                 // raw problem logs
await h.close();                       // deletes every fixture project, closes the browser
```

## The Playwright suite

```bash
cd dashboard && npx playwright test
```

The suite takes roughly 1.5-4 minutes, so run it in the background and poll
(a single foreground shell command times out at 30s):

```bash
cd /home/naeem/Documents/ShortForge/dashboard && rm -f /tmp/qa.log && \
setsid nohup bash -c 'timeout 1500 npx playwright test > /tmp/qa.log 2>&1; echo "EXIT=$?" >> /tmp/qa.log' \
  >/dev/null 2>&1 </dev/null & sleep 25; tail -5 /tmp/qa.log
```

It starts its **own** engine on 8788 and dev server on 5174 with a throwaway
`SHORTFORGE_DATA_DIR`, so it never touches the live library at 8787/5173.

### Test isolation

All specs share one engine and one data directory for the whole run. If a spec
**times out**, Playwright kills it before its `finally` can delete the fixture
projects, and those rows stay in the library for every later spec — which is
how one timing-out editor test used to break `workspace.spec.ts`'s select-all
assertions. Two defences are in place:

* `uploadProject()` registers every id it creates and each uploading spec wires
  `test.afterAll(() => removeAllProjects(request))`, which still runs after a
  timeout.
* Row counts are scoped to the rows the test owns (see the `own` locator in
  `dashboard/tests/workspace.spec.ts`) rather than counting the whole library.

## Reporting

QA owns `dashboard/tests/**`, `scripts/**` and `.impeccable/review/**` and never
edits product source (`dashboard/src/**`, `engine/**`). Product bugs are
reported with file, line and a repro instead of being patched. When another
agent is mid-flight on a feature, classify the failure as IN-FLIGHT and keep
the evidence rather than changing their code.
