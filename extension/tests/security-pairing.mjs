// Exercise the real engine, unpacked extension and production dashboard together.
// Every credential, browser profile and Library record is a disposable fixture.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "../../dashboard/node_modules/playwright/index.mjs";

const root = resolve(import.meta.dirname, "../..");
const directory = await mkdtemp(resolve(tmpdir(), "shortforge-pairing-"));
const data = resolve(directory, "data");
await mkdir(data);
const origin = "http://127.0.0.1:8787";
const environment = {
  ...process.env,
  SHORTFORGE_DATA_DIR: data,
  SHORTFORGE_PRIVATE_KEYS_DIR: resolve(directory, "keys"),
  SHORTFORGE_KEY_STORAGE: "file",
  PYTHONDONTWRITEBYTECODE: "1",
};
for (const key of [
  "YOUTUBE_API_KEY",
  "ELEVENLABS_API_KEY",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
])
  delete environment[key];
const python = resolve(root, ".venv/bin/python");
let engine;
let context;
let log = "";

async function startEngine() {
  engine = spawn(
    python,
    [
      "-m",
      "uvicorn",
      "engine.core.app:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8787",
      "--no-access-log",
    ],
    { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  engine.stdout.on("data", (value) => {
    log += value;
  });
  engine.stderr.on("data", (value) => {
    log += value;
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (engine.exitCode !== null)
      throw new Error("Fixture engine failed to start: " + log);
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Fixture engine did not become ready.");
}
async function stopEngine() {
  if (!engine || engine.exitCode !== null) return;
  const stopped = new Promise((resolve) => engine.once("exit", resolve));
  engine.kill("SIGTERM");
  await stopped;
}
function pairingLink() {
  return execFileSync(
    python,
    [
      "-c",
      "from engine.core.security import launch_file; print(launch_file().as_uri())",
    ],
    { cwd: root, env: environment, encoding: "utf8" },
  ).trim();
}

try {
  let occupied = false;
  try {
    await fetch(origin + "/api/health", { signal: AbortSignal.timeout(500) });
    occupied = true;
  } catch {}
  if (occupied)
    throw new Error(
      "Close the engine on port 8787 before running this isolated fixture. No existing process was stopped.",
    );
  await startEngine();
  assert.equal((await fetch(origin + "/api/clips")).status, 401);
  const dist = resolve(root, "extension/dist");
  context = await chromium.launchPersistentContext(
    resolve(directory, "browser"),
    {
      headless: true,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${dist}`,
        `--load-extension=${dist}`,
        "--no-sandbox",
      ],
    },
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const identity = new URL(worker.url()).host;
  const expected = execFileSync(
    python,
    [
      "-c",
      "from engine.core.security import scout_origin; print(scout_origin())",
    ],
    { cwd: root, env: environment, encoding: "utf8" },
  ).trim();
  assert.equal("chrome-extension://" + identity, expected);
  const page = await context.newPage();
  await page.goto(pairingLink());
  await page
    .getByRole("heading", { name: "Your library", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).hash, "");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      await worker.evaluate(async () =>
        Boolean(
          (await chrome.storage.local.get("shortforge-engine-access"))[
            "shortforge-engine-access"
          ],
        ),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    await worker.evaluate(async () =>
      Boolean(
        (await chrome.storage.local.get("shortforge-engine-access"))[
          "shortforge-engine-access"
        ],
      ),
    ),
    "Launcher-connected dashboard should pair Scout automatically.",
  );
  const packaged = await context.newPage();
  await packaged.goto(`chrome-extension://${identity}/dashboard/index.html`);
  await packaged
    .getByRole("heading", { name: "Your library", exact: true })
    .waitFor();
  let launches = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/studio/open")) launches++;
  });
  await page.goto(origin + "/?studio=new");
  await page
    .getByRole("button", { name: "Open Concat", exact: true })
    .waitFor();
  assert.equal(launches, 0);
  const old = await page.evaluate(
    () => JSON.parse(localStorage.getItem("shortforge-engine-access")).token,
  );
  await stopEngine();
  await startEngine();
  assert.equal(
    (
      await fetch(origin + "/api/clips", {
        headers: { Authorization: "Bearer " + old },
      })
    ).status,
    401,
  );
  await page.goto(pairingLink());
  await page
    .getByRole("heading", { name: "Your library", exact: true })
    .waitFor();
  await packaged.reload();
  await packaged
    .getByRole("heading", { name: "Your library", exact: true })
    .waitFor();
  console.log(
    "PASS: private launcher connection, real Scout pairing, packaged dashboard, safe Studio links, and restart revocation.",
  );
} finally {
  await context?.close();
  await stopEngine();
  await rm(directory, { recursive: true, force: true });
}
