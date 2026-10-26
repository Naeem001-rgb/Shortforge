import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../build.mjs";

test("build fingerprints invalidate for edits, additions, deletions and missing output", async () => {
  const root = await mkdtemp(join(tmpdir(), "shortforge-build-cache-"));
  try {
    const source = join(root, "src");
    const output = join(root, "dist");
    await mkdir(source);
    await mkdir(output);
    await writeFile(join(source, "app.ts"), "first");
    await writeFile(join(output, "app.js"), "built");
    const first = await digest([source, output]);
    assert.equal(await digest([source, output]), first);
    await writeFile(join(source, "app.ts"), "other");
    assert.notEqual(await digest([source, output]), first);
    await writeFile(join(source, "app.ts"), "first");
    assert.equal(await digest([source, output]), first);
    await writeFile(join(source, "new.ts"), "new");
    assert.notEqual(await digest([source, output]), first);
    await rm(join(source, "new.ts"));
    await rm(join(output, "app.js"));
    assert.notEqual(await digest([source, output]), first);
    await rm(output, { recursive: true });
    assert.notEqual(await digest([source, output]), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
