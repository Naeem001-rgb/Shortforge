import { defineConfig } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
const root = path.resolve(import.meta.dirname, "..");
const dataDirectory = (process.env.SHORTFORGE_TEST_DATA_DIR ||= mkdtempSync(
  path.join(os.tmpdir(), "shortforge-test-"),
));
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `${root}/.venv/bin/python -m uvicorn engine.core.app:app --host 127.0.0.1 --port 8788`,
      cwd: root,
      port: 8788,
      reuseExistingServer: false,
      env: {
        SHORTFORGE_DATA_DIR: dataDirectory,
        SHORTFORGE_PRIVATE_KEYS_DIR: dataDirectory + "-keys",
        SHORTFORGE_KEY_STORAGE: "file",
        SHORTFORGE_DASHBOARD_ORIGINS: "http://127.0.0.1:5174",
      },
    },
    {
      command: "npm run dev -- --port 5174",
      port: 5174,
      reuseExistingServer: false,
      env: { SHORTFORGE_ENGINE_URL: "http://127.0.0.1:8788" },
    },
  ],
});
