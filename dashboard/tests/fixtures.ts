import { test as base, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

type Fixtures = {
  engineAccess: { token: string; expires_at: number };
  connectedBrowser: boolean;
  connectBrowser: void;
};
const root = path.resolve(import.meta.dirname, "../..");
export function connectionLink(origin: string) {
  const code = execFileSync(
    path.join(root, ".venv/bin/python"),
    [
      "-c",
      "import sys; from engine.core.security import create_pairing; print(create_pairing(sys.argv[1]))",
      origin,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        SHORTFORGE_DATA_DIR: process.env.SHORTFORGE_TEST_DATA_DIR!,
        SHORTFORGE_DASHBOARD_ORIGINS: origin,
      },
    },
  ).trim();
  return `${origin}/#connect=${code}`;
}
export const test = base.extend<Fixtures>({
  connectedBrowser: [true, { option: true }],
  engineAccess: async ({ baseURL }, use) => {
    const result = execFileSync(
      path.join(root, ".venv/bin/python"),
      [
        "-c",
        "import json,sys; from engine.core.security import local_client; print(json.dumps(local_client(sys.argv[1])))",
        baseURL!,
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: "1",
          SHORTFORGE_DATA_DIR: process.env.SHORTFORGE_TEST_DATA_DIR!,
        },
      },
    );
    await use(JSON.parse(result));
  },
  connectBrowser: [
    async ({ context, engineAccess, connectedBrowser }, use) => {
      if (connectedBrowser)
        await context.addInitScript((access) => {
          if (location.origin === "http://127.0.0.1:5174")
            localStorage.setItem(
              "shortforge-engine-access",
              JSON.stringify(access),
            );
        }, engineAccess);
      await use();
    },
    { auto: true },
  ],
  request: async ({ playwright, baseURL, engineAccess }, use) => {
    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${engineAccess.token}` },
    });
    await use(request);
    await request.dispose();
  },
});
export { expect };
