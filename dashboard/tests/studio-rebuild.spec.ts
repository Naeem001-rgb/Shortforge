import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  editorState,
  fixtures,
  removeAllProjects,
  root,
  uploadProject,
} from "./editor-fixtures";

test.beforeAll(fixtures);
test.beforeEach(async ({ page }) => {
  // Builders may edit source concurrently; hold this test's loaded module graph steady.
  await page.routeWebSocket(/127\.0\.0\.1:5174/, () => {});
});
test.afterAll(async ({ request }) => {
  await removeAllProjects(request);
});

async function savedProject(request: APIRequestContext, id: string) {
  return (await editorState(request, id)).project;
}

async function save(page: Page, id: string) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/editor/${id}`) && r.request().method() === "PUT",
  );
  await page.keyboard.press("Control+s");
  expect((await response).ok()).toBe(true);
}

test("full-tab Studio persists drag, trim, split, track flags and more than 100 undo steps", async ({
  page,
  request,
}, info) => {
  test.setTimeout(180000);
  const clip = await uploadProject(
    request,
    "Synthetic Studio round-trip fixture",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?studio=${clip.id}`);
  const timeline = page.getByRole("region", { name: "Timeline", exact: true });
  await expect(timeline).toBeVisible();
  await expect(page.locator(".timeline-clip.video")).toHaveCount(1);
  const initial = await savedProject(request, clip.id);
  const original = initial.items[0];
  await page
    .getByRole("button", { name: "Snap to clips and markers", exact: true })
    .click();
  const before = (await page.locator(".timeline-clip.video").boundingBox())!;
  const zoom = Number(
    await page.getByRole("slider", { name: "Timeline zoom" }).inputValue(),
  );
  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width / 2 + zoom,
    before.y + before.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await save(page, clip.id);
  expect((await savedProject(request, clip.id)).items[0].start).toBeCloseTo(
    1,
    2,
  );
  const moved = (await page.locator(".timeline-clip.video").boundingBox())!;
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    moved.x + moved.width / 2,
    moved.y + moved.height / 2 + 62,
    { steps: 8 },
  );
  await page.mouse.up();
  await save(page, clip.id);
  expect((await savedProject(request, clip.id)).items[0].track).toBe(1);
  await timeline
    .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
    .click();
  await save(page, clip.id);
  expect((await savedProject(request, clip.id)).items[0].track).toBe(0);
  const trim = page.getByRole("button", {
    name: `Trim end of ${original.name}`,
    exact: true,
  });
  const edge = (await trim.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    edge.x + edge.width / 2 - zoom,
    edge.y + edge.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  await save(page, clip.id);
  expect((await savedProject(request, clip.id)).items[0].duration).toBeCloseTo(
    original.duration - 1,
    2,
  );
  await page.getByLabel("Playhead", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Split at playhead (S)", exact: true })
    .click();
  await expect(page.locator(".timeline-clip.video")).toHaveCount(2);
  await save(page, clip.id);
  const split = await savedProject(request, clip.id);
  expect(split.items[1].source_in).toBeCloseTo(1, 2);
  expect(split.items[0].duration + split.items[1].duration).toBeCloseTo(
    original.duration - 1,
    2,
  );
  for (const name of ["Lock Video", "Hide Video", "Mute Video"])
    await page.getByRole("button", { name, exact: true }).click();
  await save(page, clip.id);
  await page.reload();
  for (const name of ["Unlock Video", "Show Video", "Unmute Video"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  const baseline = await savedProject(request, clip.id);
  await expect
    .poll(() =>
      page.getByLabel("Video canvas", { exact: true }).evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let different = 0;
        for (let n = 4; n < pixels.length; n += 4)
          if (
            pixels[n] !== pixels[0] ||
            pixels[n + 1] !== pixels[1] ||
            pixels[n + 2] !== pixels[2]
          )
            different++;
        return different;
      }),
    )
    .toBe(0);
  const started = Date.now();
  for (let n = 0; n < 111; n++)
    await page
      .getByRole("button", {
        name: n % 2 ? "Mute Video" : "Unmute Video",
        exact: true,
      })
      .click();
  for (let n = 0; n < 111; n++)
    await timeline
      .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: "Unmute Video", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  // Redo all retained actions, then undo once: 223 history traversals in total.
  for (let n = 0; n < 111; n++)
    await timeline
      .getByRole("button", { name: "Redo (Ctrl+Shift+Z)", exact: true })
      .click();
  await expect(
    page.getByRole("button", { name: "Mute Video", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await timeline
    .getByRole("button", { name: "Undo (Ctrl+Z)", exact: true })
    .click();
  await page.keyboard.press("Control+s");
  await expect.poll(() => savedProject(request, clip.id)).toEqual(baseline);
  expect(errors).toEqual([]);
  await info.attach("history-and-roundtrip.json", {
    body: JSON.stringify(
      {
        historyActions: 111,
        undos: 112,
        redos: 111,
        elapsedMs: Date.now() - started,
        pageErrors: errors,
        project: baseline,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

async function browserExport(
  page: Page,
  request: APIRequestContext,
  id: string,
  seconds: number,
  resolution: 720 | 1080,
  info: TestInfo,
) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?studio=${id}`);
  await expect(page.getByLabel("Video canvas", { exact: true })).toBeVisible();
  const state = await editorState(request, id);
  const result = await page.evaluate(
    async ({ state, seconds, resolution }) => {
      const modelPath = "/src/studio/editorModel.ts",
        renderPath = "/src/studio/engine/renderFrame.ts",
        exportPath = "/src/studio/engine/exportProject.ts",
        audioPath = "/src/studio/engine/audioMix.ts",
        apiPath = "/src/api.ts";
      const [
        { newItem },
        { createRenderResources, renderFrame, sourceTime },
        { exportProject },
        { mixProjectAudio },
        { assetUrl },
      ] = await Promise.all([
        import(modelPath),
        import(renderPath),
        import(exportPath),
        import(audioPath),
        import(apiPath),
      ]);
      const project = structuredClone(state.project);
      const main = project.items.find(
        (i: { kind: string }) => i.kind === "video",
      );
      main.duration = Math.min(seconds, 30);
      main.fit = "cover";
      // Shared model fixture: crop-to-fill, word timing, transform, GPU adjustment, and audible fades.
      main.fade_in = 0.12;
      main.fade_out = 0.12;
      main.adjustments = { exposure: 0.08, saturation: 1.07 };
      const title = {
        ...newItem("text", undefined, 0, 2),
        name: "QA word timing",
        duration: seconds,
        text: "Measured browser export",
        font_family: "Inter",
        font_size: 62,
        transform: { x: 0, y: 22, scale: 1, rotation: 0, opacity: 1 },
        text_background: "#141414",
        text_style: {
          bold: true,
          italic: false,
          uppercase: false,
          align: "center",
          stroke: 3,
          stroke_color: "#000000",
          shadow: 0,
          letter_spacing: 1,
          reveal: "karaoke",
          highlight: "#f9e54c",
        },
        caption_words: [
          { word: "Measured", start: 0, end: seconds / 3 },
          { word: "browser", start: seconds / 3, end: (seconds * 2) / 3 },
          { word: "export", start: (seconds * 2) / 3, end: seconds },
        ],
        keyframes: [
          {
            time: 0,
            x: -5,
            y: 22,
            scale: 1,
            rotation: 0,
            opacity: 1,
            volume: 1,
            easing: "linear",
          },
          {
            time: seconds,
            x: 5,
            y: 22,
            scale: 1,
            rotation: 0,
            opacity: 1,
            volume: 1,
            easing: "linear",
          },
        ],
      };
      const footage =
        seconds > 30
          ? [
              main,
              {
                ...structuredClone(main),
                id: crypto.randomUUID(),
                start: 30,
                duration: seconds - 30,
              },
            ]
          : [main];
      project.items = [...footage, title];
      project.fps = 30;
      await document.fonts.load('800 62px "Inter"');
      await document.fonts.ready;
      const audio = await mixProjectAudio(project, state.media);
      const referenceAudio = Array.from(
        { length: Math.floor(audio.length / 6) },
        (_, n) =>
          (audio.getChannelData(0)[n * 6] + audio.getChannelData(1)[n * 6]) / 2,
      );
      const progress: { progress: number; frame: number; phase: string }[] = [];
      const output = await exportProject(project, state.media, {
        resolution,
        fps: 30,
        quality: "high",
        onProgress: (p: { progress: number; frame: number; phase: string }) =>
          progress.push({
            progress: p.progress,
            frame: p.frame,
            phase: p.phase,
          }),
      });
      const readBase64 = (blob: Blob): Promise<string> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve((reader.result as string).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      const loadVideo = async (src: string) => {
        const video = document.createElement("video");
        video.muted = true;
        video.crossOrigin = "anonymous";
        const loaded = new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = reject;
        });
        video.src = src;
        await loaded;
        return video;
      };
      const seek = async (video: HTMLVideoElement, at: number) => {
        if (Math.abs(video.currentTime - at) < 0.00001) return;
        const ready = new Promise<void>((resolve) =>
          video.addEventListener("seeked", () => resolve(), { once: true }),
        );
        video.currentTime = at;
        await ready;
      };
      const asset = state.media.find(
        (a: { id: string }) => a.id === main.asset_id,
      );
      const source = await loadVideo(assetUrl(asset));
      const outputUrl = URL.createObjectURL(output.blob),
        decoded = await loadVideo(outputUrl);
      const canvas = document.createElement("canvas");
      canvas.width = output.width;
      canvas.height = output.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const resources = createRenderResources();
      const comparisons: {
        time: number;
        exactRepeat: boolean;
        meanAbsoluteError: number;
        p95: number;
      }[] = [];
      const goldenImages: { time: number; preview: string; decoded: string }[] =
        [];
      try {
        for (const fraction of [0.2, 0.6, 0.9]) {
          const time = Math.floor(seconds * fraction * 30) / 30;
          const active = footage.find(
            (item: { start: number; duration: number }) =>
              time >= item.start && time < item.start + item.duration,
          )!;
          await seek(source, sourceTime(active, time));
          const sources = new Map(
            footage.map((item: { id: string }) => [item.id, source]),
          );
          renderFrame(ctx, project, time, sources, resources);
          const preview = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          const previewPng = canvas.toDataURL("image/png").split(",")[1];
          renderFrame(ctx, project, time, sources, resources);
          const repeat = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          const exactRepeat = preview.every((v, n) => v === repeat[n]);
          await seek(decoded, time + 1 / 120);
          ctx.drawImage(decoded, 0, 0, canvas.width, canvas.height);
          const actual = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          const histogram = new Uint32Array(256);
          let total = 0,
            count = 0;
          for (let n = 0; n < preview.length; n += 4)
            for (let c = 0; c < 3; c++) {
              const delta = Math.abs(preview[n + c] - actual[n + c]);
              total += delta;
              histogram[delta]++;
              count++;
            }
          let accumulated = 0,
            p95 = 0;
          for (; p95 < 255; p95++) {
            accumulated += histogram[p95];
            if (accumulated >= count * 0.95) break;
          }
          comparisons.push({
            time,
            exactRepeat,
            meanAbsoluteError: total / count,
            p95,
          });
          goldenImages.push({
            time,
            preview: previewPng,
            decoded: canvas.toDataURL("image/png").split(",")[1],
          });
        }
      } finally {
        resources.gpu.dispose();
        source.removeAttribute("src");
        source.load();
        decoded.removeAttribute("src");
        decoded.load();
        URL.revokeObjectURL(outputUrl);
      }
      const supportsAac = await AudioEncoder.isConfigSupported({
        codec: "mp4a.40.2",
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 192000,
      })
        .then((s: { supported?: boolean }) => Boolean(s.supported))
        .catch(() => false);
      return {
        extension: output.extension,
        width: output.width,
        height: output.height,
        duration: output.duration,
        elapsed: output.elapsed,
        bytes: output.blob.size,
        base64: await readBase64(output.blob),
        comparisons,
        goldenImages,
        progress,
        referenceAudio,
        supportsAac,
        userAgent: navigator.userAgent,
      };
    },
    { state, seconds, resolution },
  );
  const outputPath = info.outputPath(
    `browser-${seconds}s-${resolution}.${result.extension}`,
  );
  fs.writeFileSync(outputPath, Buffer.from(result.base64, "base64"));
  const ffmpeg = execFileSync(
    path.join(root, ".venv/bin/python"),
    ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"],
    { encoding: "utf8" },
  ).trim();
  const probe = JSON.parse(
    execFileSync(
      path.join(root, ".venv/bin/python"),
      [
        "-c",
        "import json,sys;from pathlib import Path;from engine.studio.editor_media import probe_media;print(json.dumps(probe_media(Path(sys.argv[1]))))",
        outputPath,
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  const detailedProbe = process.env.SHORTFORGE_FFPROBE
    ? JSON.parse(
        execFileSync(
          process.env.SHORTFORGE_FFPROBE,
          [
            "-v",
            "error",
            "-count_frames",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            outputPath,
          ],
          { encoding: "utf8" },
        ),
      )
    : null;
  const pcm = execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      outputPath,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "-",
    ],
    { maxBuffer: 30_000_000 },
  );
  const decoded = new Float32Array(
    pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
  );
  const reference = result.referenceAudio;
  const outputAudio = Array.from(
    { length: Math.floor(decoded.length / 6) },
    (_, n) => decoded[n * 6],
  );
  const rms = Math.sqrt(
    outputAudio.reduce((sum, sample) => sum + sample * sample, 0) /
      outputAudio.length,
  );
  // Independent decoded-audio correlation in two 2 s windows; scan ±100 ms in 1 ms steps.
  const lagAt = (start: number) => {
    let best = { lagMs: 0, correlation: -Infinity };
    const from = Math.floor(start * 8000),
      size = 16000;
    for (let lag = -800; lag <= 800; lag += 8) {
      let xy = 0,
        xx = 0,
        yy = 0;
      for (
        let n = from;
        n < Math.min(reference.length - 800, from + size);
        n += 2
      ) {
        const x = reference[n],
          y = outputAudio[n + lag] || 0;
        xy += x * y;
        xx += x * x;
        yy += y * y;
      }
      const correlation = xy / Math.sqrt(xx * yy);
      if (correlation > best.correlation)
        best = { lagMs: lag / 8, correlation };
    }
    return best;
  };
  const startLag = lagAt(Math.min(1, seconds / 4)),
    endLag = lagAt(Math.max(1, seconds - 3));
  const measurements = {
    fixture:
      seconds >= 30
        ? "Sintel trailer, Blender Foundation, CC BY 3.0"
        : "Generated testsrc2 and sine: synthetic test fixture",
    extension: result.extension,
    width: result.width,
    height: result.height,
    duration: result.duration,
    elapsedSeconds: result.elapsed,
    bytes: result.bytes,
    audioSeconds: decoded.length / 48000,
    rms,
    startLag,
    endLag,
    measuredDriftMs:
      startLag.correlation > 0.85 && endLag.correlation > 0.85
        ? endLag.lagMs - startLag.lagMs
        : null,
    supportsAac: result.supportsAac,
    userAgent: result.userAgent,
    probe,
    ffprobe: detailedProbe,
    comparisons: result.comparisons,
    progress: result.progress,
    pageErrors: errors,
    outputPath,
  };
  fs.writeFileSync(
    info.outputPath("measurements.json"),
    JSON.stringify(measurements, null, 2),
  );
  await info.attach("measurements.json", {
    path: info.outputPath("measurements.json"),
    contentType: "application/json",
  });
  for (const golden of result.goldenImages)
    for (const kind of ["preview", "decoded"] as const) {
      const png = info.outputPath(`${kind}-${golden.time}s.png`);
      fs.writeFileSync(png, Buffer.from(golden[kind], "base64"));
      await info.attach(path.basename(png), {
        path: png,
        contentType: "image/png",
      });
    }
  expect(result.width).toBe(resolution);
  expect(result.height).toBe((resolution * 16) / 9);
  expect(probe.width).toBe(resolution);
  expect(probe.height).toBe((resolution * 16) / 9);
  if (detailedProbe) {
    const video = detailedProbe.streams.find(
      (stream: { codec_type: string }) => stream.codec_type === "video",
    );
    expect(Number(video.nb_read_frames)).toBe(seconds * 30);
    expect(video.avg_frame_rate).toBe("30/1");
    expect(
      detailedProbe.streams.some(
        (stream: { codec_type: string }) => stream.codec_type === "audio",
      ),
    ).toBe(true);
  }
  expect(result.duration).toBe(seconds);
  expect(probe.has_audio).toBe(true);
  expect(Math.abs(probe.duration - seconds)).toBeLessThanOrEqual(1 / 30);
  expect(Math.abs(decoded.length / 48000 - seconds)).toBeLessThan(0.04);
  expect(rms).toBeGreaterThan(0.001);
  expect(startLag.correlation).toBeGreaterThan(0.85);
  expect(endLag.correlation).toBeGreaterThan(0.85);
  expect(Math.abs(endLag.lagMs - startLag.lagMs)).toBeLessThan(40);
  for (const comparison of result.comparisons) {
    expect(comparison.exactRepeat).toBe(true);
    expect(comparison.meanAbsoluteError).toBeLessThan(12);
    expect(comparison.p95).toBeLessThan(35);
  }
  expect(result.progress.at(-1)?.progress).toBe(100);
  expect(
    result.progress
      .filter((p) => p.phase === "Rendering video")
      .every((p, n, array) => !n || p.frame >= array[n - 1].frame),
  ).toBe(true);
  expect(errors).toEqual([]);
}

test("browser shared compositor exports actual synthetic media with matching decoded frames and audio", async ({
  page,
  request,
}, info) => {
  test.setTimeout(240000);
  const clip = await uploadProject(
    request,
    "Synthetic browser compositor fixture",
  );
  await browserExport(page, request, clip.id, 4, 720, info);
});

for (const seconds of [30, 60])
  test(`licensed Sintel ${seconds}-second browser export at 1080x1920 preserves decoded audio timing and golden frames`, async ({
    page,
    request,
  }, info) => {
    test.setTimeout(900000);
    const file = process.env.SHORTFORGE_REAL_MEDIA;
    test.skip(
      !file,
      "Set SHORTFORGE_REAL_MEDIA to the licensed Sintel trailer; synthetic footage does not satisfy this acceptance check.",
    );
    expect(fs.existsSync(file!)).toBe(true);
    const response = await request.post("/api/upload", {
      multipart: {
        title: "QA Sintel trailer — Blender Foundation CC BY 3.0",
        file: {
          name: "sintel-trailer.mp4",
          mimeType: "video/mp4",
          buffer: fs.readFileSync(file!),
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json(),
      id = (body.clip || body).id;
    try {
      await browserExport(page, request, id, seconds, 1080, info);
    } finally {
      await request.delete(`/api/clips/${id}`);
    }
  });
