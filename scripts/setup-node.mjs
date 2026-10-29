// Reuse matching installs, but do not let an existing node_modules directory
// hide a lockfile update or a partial installation during normal startup.
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sameDependencies = (left = {}, right = {}) =>
  record(left) &&
  record(right) &&
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([name, version]) => right[name] === version);
const executable =
  process.platform === "win32" ? constants.F_OK : constants.X_OK;
const platform = {
  os: process.platform,
  cpu: process.arch,
  libc:
    process.platform === "linux"
      ? process.report.getReport().header.glibcVersionRuntime
        ? "glibc"
        : "musl"
      : undefined,
};
const supportsPlatform = (entry) =>
  Object.entries(platform).every(([field, value]) => {
    const choices = entry[field];
    return (
      !choices ||
      (Array.isArray(choices) &&
        !choices.includes(`!${value}`) &&
        (choices.includes(value) ||
          choices.every((choice) => choice.startsWith("!"))))
    );
  });

export async function dependenciesCurrent(directory) {
  try {
    const [manifest, locked, installed] = await Promise.all([
      readJson(join(directory, "package.json")),
      readJson(join(directory, "package-lock.json")),
      readJson(join(directory, "node_modules/.package-lock.json")),
    ]);
    if (
      !record(manifest) ||
      !record(locked) ||
      !record(installed) ||
      !record(locked.packages) ||
      !record(locked.packages[""]) ||
      !record(installed.packages)
    )
      return false;
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ])
      if (!sameDependencies(manifest[field], locked.packages[""][field]))
        return false;
    for (const [name, entry] of Object.entries(locked.packages)) {
      if (!record(entry)) return false;
      // Rollup/esbuild publish required native binaries as platform optionals.
      const native =
        entry.os && entry.cpu && !entry.peer && supportsPlatform(entry);
      if (name && (!entry.optional || native) && !installed.packages[name])
        return false;
    }

    const matches = await Promise.all(
      Object.entries(installed.packages).map(async ([name, entry]) => {
        const expected = locked.packages[name];
        if (
          !name.startsWith("node_modules/") ||
          !record(expected) ||
          !record(entry) ||
          !supportsPlatform(expected)
        )
          return false;
        for (const field of ["version", "resolved", "integrity", "link"])
          if (entry[field] !== expected[field]) return false;
        const actual = await readJson(join(directory, name, "package.json"));
        if (
          !record(actual) ||
          typeof expected.version !== "string" ||
          actual.version !== expected.version
        )
          return false;
        // npm's hidden lock is metadata, not proof that its binaries still exist.
        const bins =
          typeof actual.bin === "string"
            ? [actual.bin]
            : Object.values(actual.bin || {});
        await Promise.all(
          bins.map((bin) => access(join(directory, name, bin), executable)),
        );
        return true;
      }),
    );
    if (!matches.every(Boolean)) return false;
    // npm scripts invoke these shims, not just the underlying package files.
    const commands = manifest.devDependencies?.vite ? ["tsc", "vite"] : ["tsc"];
    await Promise.all(
      commands.map((name) =>
        access(
          join(
            directory,
            "node_modules/.bin",
            name + (process.platform === "win32" ? ".cmd" : ""),
          ),
          executable,
        ),
      ),
    );
    return true;
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      ["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)
    )
      return false;
    throw error;
  }
}

function installLocked(directory) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci", "--include=dev", "--include=optional", "--no-audit"],
    {
      cwd: directory,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ci failed in ${directory}.`);
}

export async function ensureDependencies(directory, install = installLocked) {
  if (await dependenciesCurrent(directory)) return false;
  await install(directory);
  if (!(await dependenciesCurrent(directory)))
    throw new Error(
      `Dependencies in ${directory} are incomplete after npm ci.`,
    );
  return true;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const project of ["dashboard", "extension"]) {
    const changed = await ensureDependencies(join(root, project));
    console.log(
      `${project} dependencies ${changed ? "installed from lockfile" : "are current"}.`,
    );
  }
}
