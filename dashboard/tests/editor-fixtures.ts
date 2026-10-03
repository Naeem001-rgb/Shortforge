import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const root = path.resolve(import.meta.dirname, "../..");
export const fixtureDir = path.join(
  os.tmpdir(),
  `shortforge-editor-${process.pid}`,
);
export const videoFixture = path.join(fixtureDir, "editor-motion-test.mp4");
export const voiceFixture = path.join(fixtureDir, "imported-voice-test.wav");
export const musicFixture = path.join(fixtureDir, "imported-music-test.wav");
export const subtitleFixture = path.join(fixtureDir, "captions.srt");
let ffmpeg = "";

/**
 * Every project this worker uploaded. A spec that TIMES OUT is killed before
 * its `finally` can delete anything, and the leaked row then breaks the next
 * spec (the whole suite shares one engine and one data directory). The
 * registry plus `removeAllProjects` — wired to `test.afterAll`, which still
 * runs after a timeout — makes cleanup unconditional.
 */
const uploadedProjects = new Set<string>();

export async function removeAllProjects(
  request: APIRequestContext,
): Promise<void> {
  for (const id of uploadedProjects) {
    try {
      await request.delete(`/api/clips/${id}`);
    } catch {
      // The request context may already be torn down; nothing else to do.
    }
  }
  uploadedProjects.clear();
}

export function fixtures() {
  if (fs.existsSync(videoFixture)) return;
  fs.mkdirSync(fixtureDir, { recursive: true });
  ffmpeg = execFileSync(
    path.join(root, ".venv/bin/python"),
    ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"],
    { encoding: "utf8" },
  ).trim();
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=360x640:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    videoFixture,
  ]);
  for (const [file, frequency] of [
    [voiceFixture, "660"],
    [musicFixture, "220"],
  ]) {
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=48000`,
      "-t",
      "4",
      "-ac",
      "2",
      file,
    ]);
  }
  fs.writeFileSync(
    subtitleFixture,
    "1\n00:00:00,000 --> 00:00:01,500\nBrowser test caption\n\n2\n00:00:01,500 --> 00:00:03,000\nA second timed caption\n",
  );
}

export async function uploadProject(
  request: APIRequestContext,
  title = "Timeline browser test",
) {
  fixtures();
  const response = await request.post("/api/upload", {
    multipart: {
      title,
      file: {
        name: "editor-motion-test.mp4",
        mimeType: "video/mp4",
        buffer: fs.readFileSync(videoFixture),
      },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  const clip = body.clip || body;
  uploadedProjects.add(clip.id);
  return clip;
}

export async function openProject(page: Page, id: string) {
  await page.goto(`/?studio=${id}`);
  await expect(page.locator("main.studio-tab")).toBeVisible();
  await expect(page.getByTestId("timeline-item")).toHaveCount(1);
}

export async function editorState(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/editor/${id}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

/** Best-effort cleanup: never mask the real assertion failure. */
export async function removeProject(
  request: APIRequestContext,
  id: string | undefined,
) {
  if (!id) return;
  try {
    await request.delete(`/api/clips/${id}`);
  } catch {
    // The request context is already torn down (for example after a timeout).
  }
}

export function inspectExport(buffer: Buffer) {
  const file = path.join(fixtureDir, `render-${Date.now()}.mp4`);
  fs.writeFileSync(file, buffer);
  return JSON.parse(
    execFileSync(
      path.join(root, ".venv/bin/python"),
      [
        "-c",
        "import json,sys;from pathlib import Path;from engine.studio.editor_media import probe_media;print(json.dumps(probe_media(Path(sys.argv[1]))))",
        file,
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
}
