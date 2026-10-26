import { build } from "esbuild";
import {
  mkdir,
  cp,
  rm,
  readFile,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const dashboard = fileURLToPath(new URL("../dashboard", import.meta.url));
// Hash contents as well as paths: timestamps alone can miss a restored checkout.
export async function digest(paths) {
  const hash = createHash("sha256");
  async function visit(path) {
    hash.update(JSON.stringify(path));
    let info;
    try {
      info = await stat(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("missing");
      return;
    }
    if (info.isDirectory()) {
      hash.update("directory");
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name));
    } else {
      hash.update(`file:${info.size}:`);
      hash.update(await readFile(path));
    }
  }
  for (const path of paths) await visit(path);
  return hash.digest("hex");
}

async function main() {
  const inputs = await digest([
    "src",
    "static",
    "tests",
    "build.mjs",
    "tsconfig.json",
    "package.json",
    "package-lock.json",
    "node_modules/.package-lock.json",
    ...[
      "src",
      "public",
      "index.html",
      "vite.config.ts",
      "tsconfig.json",
      "package.json",
      "package-lock.json",
      "node_modules/.package-lock.json",
      ".env",
      ".env.local",
      ".env.production",
      ".env.production.local",
    ].map((path) => join(dashboard, path)),
  ]);
  const environment = JSON.stringify([
    process.version,
    process.platform,
    process.arch,
    Object.entries(process.env)
      .filter(([key]) => key.startsWith("VITE_") || key === "NODE_ENV")
      .sort(),
  ]);
  const cacheFile = "node_modules/.shortforge-build.json";
  if (process.argv.includes("--if-needed")) {
    try {
      const previous = JSON.parse(await readFile(cacheFile, "utf8"));
      if (
        previous?.inputs === inputs &&
        previous.environment === environment &&
        previous.outputs === (await digest(["dist"]))
      ) {
        console.log(
          "Scout and Dashboard build is unchanged; reusing verified output.",
        );
        return;
      }
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
  }
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist", { recursive: true });
  await build({
    entryPoints: ["src/background.ts", "src/content.ts", "src/popup.ts"],
    outdir: "dist",
    bundle: true,
    target: "chrome120",
    format: "iife",
  });
  await cp("static", "dist", { recursive: true });
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json"],
    { cwd: dashboard, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "--base=./",
      "--outDir=../extension/dist/dashboard",
      "--emptyOutDir",
    ],
    { cwd: dashboard, stdio: "inherit" },
  );
  // Vite preserves the early theme bootstrap. Externalize it for strict MV3 CSP.
  let html = await readFile("dist/dashboard/index.html", "utf8");
  let scriptIndex = 0;
  for (const match of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]) {
    const filename = `bootstrap-${scriptIndex++}.js`;
    await writeFile(`dist/dashboard/${filename}`, match[1]);
    html = html.replace(match[0], `<script src="./${filename}"></script>`);
  }
  await writeFile("dist/dashboard/index.html", html);
  console.log(
    "Scout and Dashboard built. Load extension/dist in chrome://extensions. Only the local engine is required.",
  );
  await writeFile(
    cacheFile,
    JSON.stringify({ inputs, environment, outputs: await digest(["dist"]) }),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
