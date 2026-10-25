// Runs ruff from the project's own .venv, whichever operating system you are on.
// Why this file exists: `npm run lint:py` has to find ruff, and the virtual
// environment puts it in ".venv/bin" on macOS/Linux but ".venv\Scripts" on Windows.
// Hard-coding either path would break the command for half of the people using it.
//
// Usage (normally through package.json): node scripts/ruff.mjs check .
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const candidates = [
  join(root, ".venv", "bin", "ruff"),
  join(root, ".venv", "Scripts", "ruff.exe"),
];
const ruff = candidates.find(existsSync);

if (!ruff) {
  console.error(
    [
      "Could not find ruff in this project's .venv.",
      "",
      "Install it once with the matching command for your system:",
      "  macOS/Linux:  .venv/bin/python -m pip install -r requirements-dev.txt",
      "  Windows:      .venv\\Scripts\\python -m pip install -r requirements-dev.txt",
    ].join("\n"),
  );
  process.exit(1);
}

// Pass our arguments straight through and report ruff's own exit code, so a failed
// check still fails the npm script.
const result = spawnSync(ruff, process.argv.slice(2), {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
