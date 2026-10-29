import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  dependenciesCurrent,
  ensureDependencies,
} from "../../scripts/setup-node.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "shortforge-node-setup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const writeJson = (name, value) =>
    writeFile(join(directory, name), JSON.stringify(value));
  const pin = (version) => ({
    version,
    resolved: `https://registry.example/typescript-${version}.tgz`,
    integrity: `fixture-${version}`,
  });
  async function wanted(version = "1.0.0") {
    const manifest = {
      name: "fixture",
      devDependencies: { typescript: version },
    };
    await writeJson("package.json", manifest);
    await writeJson("package-lock.json", {
      lockfileVersion: 3,
      packages: {
        "": manifest,
        "node_modules/typescript": pin(version),
        "node_modules/optional-platform-package": {
          version: "1.0.0",
          optional: true,
          os: [process.platform === "win32" ? "darwin" : "win32"],
          cpu: [process.arch],
        },
      },
    });
  }
  async function install(version = "1.0.0") {
    await mkdir(join(directory, "node_modules/typescript/bin"), {
      recursive: true,
    });
    await mkdir(join(directory, "node_modules/.bin"), { recursive: true });
    await writeJson("node_modules/.package-lock.json", {
      lockfileVersion: 3,
      packages: { "node_modules/typescript": pin(version) },
    });
    await writeJson("node_modules/typescript/package.json", {
      name: "typescript",
      version,
      bin: { tsc: "bin/tsc" },
    });
    await writeFile(
      join(directory, "node_modules/typescript/bin/tsc"),
      "fixture",
    );
    await chmod(join(directory, "node_modules/typescript/bin/tsc"), 0o755);
    await writeFile(
      join(
        directory,
        "node_modules/.bin",
        process.platform === "win32" ? "tsc.cmd" : "tsc",
      ),
      "fixture",
    );
    await chmod(
      join(
        directory,
        "node_modules/.bin",
        process.platform === "win32" ? "tsc.cmd" : "tsc",
      ),
      0o755,
    );
  }
  await wanted();
  return { directory, wanted, install };
}

async function runDefaultInstaller(
  directory,
  { exitCode = 0, repairLock } = {},
) {
  const bin = join(directory, "fake-npm");
  await mkdir(bin);
  const log = join(bin, "calls.jsonl");
  const script = join(bin, "npm.cjs");
  await writeFile(
    script,
    `const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.SHORTFORGE_TEST_NPM_LOG, JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  nodeEnv: process.env.NODE_ENV,
  omit: process.env.npm_config_omit,
}) + "\\n");
if (process.env.SHORTFORGE_TEST_REPAIR_LOCK) {
  fs.copyFileSync(process.env.SHORTFORGE_TEST_REPAIR_LOCK,
    path.join(process.cwd(), "node_modules/.package-lock.json"));
}
process.exitCode = Number(process.env.SHORTFORGE_TEST_NPM_EXIT);
`,
  );
  const command = join(bin, process.platform === "win32" ? "npm.cmd" : "npm");
  await writeFile(
    command,
    process.platform === "win32"
      ? '@echo off\r\n"%SHORTFORGE_TEST_NODE%" "%SHORTFORGE_TEST_NPM_SCRIPT%" %*\r\nexit /b %errorlevel%\r\n'
      : '#!/bin/sh\nexec "$SHORTFORGE_TEST_NODE" "$SHORTFORGE_TEST_NPM_SCRIPT" "$@"\n',
  );
  await chmod(command, 0o755);
  // Use a child environment so concurrently running test files keep their PATH.
  const childEnv = { ...process.env };
  const pathKey = Object.keys(childEnv).find(
    (key) => key.toUpperCase() === "PATH",
  );
  const previousPath = pathKey ? childEnv[pathKey] : "";
  for (const key of Object.keys(childEnv))
    if (key.toUpperCase() === "PATH") delete childEnv[key];
  Object.assign(childEnv, {
    PATH: bin + delimiter + previousPath,
    NODE_ENV: "production",
    npm_config_omit: "dev optional",
    // Even a broken fake-command lookup must never reach the package registry.
    npm_config_offline: "true",
    SHORTFORGE_TEST_NODE: process.execPath,
    SHORTFORGE_TEST_NPM_SCRIPT: script,
    SHORTFORGE_TEST_NPM_LOG: log,
    SHORTFORGE_TEST_NPM_EXIT: String(exitCode),
    SHORTFORGE_TEST_REPAIR_LOCK: repairLock || "",
  });
  const setup = new URL("../../scripts/setup-node.mjs", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { ensureDependencies } from ${JSON.stringify(setup)};
await ensureDependencies(${JSON.stringify(directory)});`,
    ],
    { cwd: directory, env: childEnv, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.error, undefined);
  const calls = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  return { ...result, call: calls[0] };
}

async function removeInstallMetadata(directory) {
  const path = join(directory, "node_modules/.package-lock.json");
  const saved = join(directory, "installed-lock.json");
  await writeFile(saved, await readFile(path));
  await rm(path);
  return saved;
}

test("startup reuses matching dependencies without running npm or requiring other-platform optionals", async (t) => {
  const { directory, install } = await fixture(t);
  await install();
  assert.equal(await dependenciesCurrent(directory), true);
  assert.equal(
    await ensureDependencies(directory, () =>
      assert.fail("A current install must not reinstall"),
    ),
    false,
  );
});

test("an existing node_modules cannot hide a lockfile security update", async (t) => {
  const { directory, wanted, install } = await fixture(t);
  await install();
  await wanted("1.0.1");
  assert.equal(await dependenciesCurrent(directory), false);
  let installations = 0;
  assert.equal(
    await ensureDependencies(directory, async () => {
      installations++;
      await install("1.0.1");
    }),
    true,
  );
  assert.equal(installations, 1);
  assert.equal(await dependenciesCurrent(directory), true);
});

test("missing current-platform native binaries invalidate an otherwise matching install", async (t) => {
  const { directory, install } = await fixture(t);
  await install();
  const path = join(directory, "package-lock.json");
  const locked = JSON.parse(await readFile(path, "utf8"));
  locked.packages["node_modules/current-native"] = {
    version: "1.0.0",
    optional: true,
    os: [process.platform],
    cpu: [process.arch],
  };
  await writeFile(path, JSON.stringify(locked));
  assert.equal(await dependenciesCurrent(directory), false);
});

test("native optionals for another CPU or an excluded OS do not force reinstall", async (t) => {
  const { directory, install } = await fixture(t);
  await install();
  const path = join(directory, "package-lock.json");
  const locked = JSON.parse(await readFile(path, "utf8"));
  locked.packages["node_modules/other-cpu"] = {
    version: "1.0.0",
    optional: true,
    os: [process.platform],
    cpu: [process.arch === "x64" ? "arm64" : "x64"],
  };
  locked.packages["node_modules/excluded-os"] = {
    version: "1.0.0",
    optional: true,
    os: [`!${process.platform}`],
    cpu: [process.arch],
  };
  await writeFile(path, JSON.stringify(locked));
  assert.equal(
    await ensureDependencies(directory, () =>
      assert.fail("Inapplicable native packages must not trigger npm"),
    ),
    false,
  );
});

test(
  "Linux native optionals require the current libc and reject a copied incompatible package",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { directory, install } = await fixture(t);
    await install();
    const libc = process.report.getReport().header.glibcVersionRuntime
      ? "glibc"
      : "musl";
    const path = join(directory, "package-lock.json");
    const locked = JSON.parse(await readFile(path, "utf8"));
    const native = {
      version: "1.0.0",
      optional: true,
      os: ["linux"],
      cpu: [process.arch],
      libc: [libc === "glibc" ? "musl" : "glibc"],
    };
    locked.packages["node_modules/native-libc"] = native;
    await writeFile(path, JSON.stringify(locked));
    assert.equal(await dependenciesCurrent(directory), true);

    native.libc = [libc];
    await writeFile(path, JSON.stringify(locked));
    assert.equal(await dependenciesCurrent(directory), false);

    const installedPath = join(directory, "node_modules/.package-lock.json");
    const installed = JSON.parse(await readFile(installedPath, "utf8"));
    installed.packages["node_modules/native-libc"] = native;
    await writeFile(installedPath, JSON.stringify(installed));
    await mkdir(join(directory, "node_modules/native-libc"));
    await writeFile(
      join(directory, "node_modules/native-libc/package.json"),
      JSON.stringify({ name: "native-libc", version: "1.0.0" }),
    );
    assert.equal(await dependenciesCurrent(directory), true);

    native.libc = [libc === "glibc" ? "musl" : "glibc"];
    await writeFile(path, JSON.stringify(locked));
    await writeFile(installedPath, JSON.stringify(installed));
    assert.equal(await dependenciesCurrent(directory), false);
  },
);

test(
  "non-executable Unix command shims are repaired",
  { skip: process.platform === "win32" },
  async (t) => {
    const { directory, install } = await fixture(t);
    await install();
    await chmod(join(directory, "node_modules/.bin/tsc"), 0o644);
    assert.equal(await dependenciesCurrent(directory), false);
    assert.equal(await ensureDependencies(directory, () => install()), true);
  },
);

for (const value of [
  null,
  [],
  { packages: null },
  { packages: { "node_modules/typescript": null } },
]) {
  test(`malformed install metadata is repaired: ${JSON.stringify(value)}`, async (t) => {
    const { directory, install } = await fixture(t);
    await install();
    await writeFile(
      join(directory, "node_modules/.package-lock.json"),
      JSON.stringify(value),
    );
    assert.equal(await dependenciesCurrent(directory), false);
    assert.equal(await ensureDependencies(directory, () => install()), true);
  });
}

for (const broken of ["package", "binary", "shim", "metadata", "version"]) {
  test(`startup repairs missing or changed ${broken} in a partial install`, async (t) => {
    const { directory, install } = await fixture(t);
    await install();
    const packageRoot = join(directory, "node_modules/typescript");
    if (broken === "package") await rm(packageRoot, { recursive: true });
    if (broken === "binary") await rm(join(packageRoot, "bin/tsc"));
    if (broken === "shim")
      await rm(join(directory, "node_modules/.bin"), { recursive: true });
    if (broken === "metadata")
      await writeFile(
        join(directory, "node_modules/.package-lock.json"),
        "invalid json",
      );
    if (broken === "version") {
      const path = join(packageRoot, "package.json");
      const actual = JSON.parse(await readFile(path, "utf8"));
      await writeFile(path, JSON.stringify({ ...actual, version: "0.9.0" }));
    }
    assert.equal(await dependenciesCurrent(directory), false);
    assert.equal(await ensureDependencies(directory, () => install()), true);
  });
}

test("startup fails rather than building with a failed or incomplete install", async (t) => {
  const { directory } = await fixture(t);
  await assert.rejects(
    ensureDependencies(directory, () => {
      throw new Error("npm ci failed");
    }),
    /npm ci failed/,
  );
  await assert.rejects(
    ensureDependencies(directory, () => {}),
    /incomplete/,
  );
});

test("the default installer propagates npm failure even if package metadata was repaired", async (t) => {
  const { directory, install } = await fixture(t);
  await install();
  const repairLock = await removeInstallMetadata(directory);
  const result = await runDefaultInstaller(directory, {
    exitCode: 37,
    repairLock,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm ci failed/);
  assert.equal(await dependenciesCurrent(directory), true);
});

test("the default installer rejects npm success that leaves the install incomplete", async (t) => {
  const { directory, install } = await fixture(t);
  await install();
  await removeInstallMetadata(directory);
  const result = await runDefaultInstaller(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /incomplete after npm ci/);
});

test("the default installer explicitly includes dev and optional packages under production npm settings", async (t) => {
  const { directory, install } = await fixture(t);
  await install();
  const repairLock = await removeInstallMetadata(directory);
  const result = await runDefaultInstaller(directory, { repairLock });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.call.cwd, directory);
  assert.equal(result.call.nodeEnv, "production");
  assert.equal(result.call.omit, "dev optional");
  assert.equal(result.call.args[0], "ci");
  assert.ok(result.call.args.includes("--include=dev"));
  assert.ok(result.call.args.includes("--include=optional"));
  assert.equal(await dependenciesCurrent(directory), true);
});

test("manifest changes without a matching lockfile require npm validation", async (t) => {
  const { directory, install } = await fixture(t);
  await install();
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "fixture",
      devDependencies: { typescript: "2.0.0" },
    }),
  );
  assert.equal(await dependenciesCurrent(directory), false);
  await assert.rejects(
    ensureDependencies(directory, () => {
      throw new Error("Manifest and lockfile do not match");
    }),
    /do not match/,
  );
});
