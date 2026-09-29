import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";

// Each test creates its own records in Playwright's isolated engine database.
// Keep other workflow tests independent of this file's execution order.
let createdClips: string[] = [];

test.beforeEach(() => {
  createdClips = [];
});

test.afterEach(async ({ request }) => {
  for (const id of createdClips) {
    await request.delete(`/api/clips/${id}`);
  }
});

async function project(
  request: APIRequestContext,
  title: string,
  original: string,
  rewritten: string,
) {
  const videoId = randomBytes(9).toString("base64url").slice(0, 11);
  const response = await request.post("/api/clips", {
    data: {
      clips: [{ url: `https://youtube.com/shorts/${videoId}`, title }],
    },
  });
  expect(response.ok()).toBeTruthy();
  const clip = (await response.json()).clips[0];
  createdClips.push(clip.id);
  const saved = await request.put(`/api/scripts/${clip.id}`, {
    data: { original_text: original, rewritten_text: rewritten },
  });
  expect(saved.ok()).toBeTruthy();
  return clip;
}

test("lifecycle: edited narration is saved and a pending job resumes across pages", async ({
  page,
  request,
}) => {
  const original = "The original topic notes stay intact.";
  const before = "The previously saved narration.";
  const narration =
    "This updated narration is the exact script for my new voiceover.";
  const clip = await project(
    request,
    "Lifecycle voice project",
    original,
    before,
  );
  const jobId = `lifecycle-${randomBytes(8).toString("hex")}`;
  let complete = false;
  let polls = 0;
  let narrationSent = "";
  let savedBeforeGeneration: {
    original_text: string;
    rewritten_text: string;
  } | null = null;

  await page.route("**/api/voices", (route) =>
    route.fulfill({
      json: {
        voices: [
          {
            id: "piper-local",
            name: "Lifecycle test voice",
            provider: "piper",
            language: "English",
            description: "A simulated local voice for this browser test.",
            available: true,
            cloned: false,
          },
        ],
        providers: [
          {
            id: "piper",
            name: "Piper",
            available: true,
            note: "Test provider",
          },
        ],
      },
    }),
  );
  await page.route("**/api/tts", async (route) => {
    narrationSent = route.request().postDataJSON().text;
    // Check persistence at the time generation begins, not after a later Save.
    const detail = await request.get(`/api/clips/${clip.id}`);
    savedBeforeGeneration = (await detail.json()).script;
    await route.fulfill({
      json: {
        id: jobId,
        clip_id: clip.id,
        type: "tts",
        status: "queued",
        progress: 0,
      },
    });
  });
  await page.route(`**/api/jobs/${jobId}`, async (route) => {
    polls += 1;
    await route.fulfill({
      json: {
        id: jobId,
        clip_id: clip.id,
        type: "tts",
        status: complete ? "completed" : "running",
        progress: complete ? 100 : 35,
        error: null,
        result: complete
          ? { timing_note: "Lifecycle generation completed." }
          : null,
      },
    });
  });

  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("button", { name: "Voice lab" }).click();
  await page.getByLabel("Project", { exact: true }).selectOption(clip.id);
  await expect(page.getByLabel("Voiceover script")).toHaveValue(before);
  await page.getByRole("button", { name: /Lifecycle test voice/ }).click();
  await page.getByLabel("Voiceover script").fill(narration);
  await page
    .getByRole("button", { name: "Generate voiceover", exact: true })
    .click();
  await expect(
    page.getByText("tts in progress", { exact: true }),
  ).toBeVisible();
  expect(narrationSent).toBe(narration);
  expect(savedBeforeGeneration).toMatchObject({
    original_text: original,
    rewritten_text: narration,
  });
  await expect.poll(() => polls).toBeGreaterThan(0);

  await navigation.getByRole("button", { name: "Library" }).click();
  await expect(
    page.getByRole("heading", { name: "Your library." }),
  ).toBeVisible();
  const previousPolls = polls;
  await navigation.getByRole("button", { name: "Studio", exact: true }).click();
  await expect(
    page.getByText("tts in progress", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Your new script")).toHaveValue(narration);
  await expect.poll(() => polls).toBeGreaterThan(previousPolls);

  complete = true;
  await expect(page.getByText("Lifecycle generation completed.")).toBeVisible();
  await expect(page.locator(".job-progress")).toContainText("100%");
  await navigation.getByRole("button", { name: "Voice lab" }).click();
  await expect(page.getByLabel("Voiceover script")).toHaveValue(narration);
});

test("lifecycle: a delayed project response cannot overwrite the newly selected project", async ({
  page,
  request,
}) => {
  const first = await project(
    request,
    "Lifecycle project A",
    "Topic A",
    "Narration A",
  );
  const second = await project(
    request,
    "Lifecycle project B",
    "Topic B",
    "Narration B",
  );
  const firstDetail = await (
    await request.get(`/api/clips/${first.id}`)
  ).json();
  let requested = false;
  let released = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(`**/api/clips/${first.id}`, async (route) => {
    requested = true;
    await gate;
    try {
      await route.fulfill({ json: firstDetail });
    } finally {
      released = true;
    }
  });

  try {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("button", { name: "Studio", exact: true })
      .click();
    await page.getByLabel("Studio project").selectOption(first.id);
    await expect.poll(() => requested).toBeTruthy();
    await page.getByLabel("Studio project").selectOption(second.id);
    await expect(page.locator(".project-bar strong")).toHaveText(
      "Lifecycle project B",
    );
    await expect(page.getByLabel("Your new script")).toHaveValue("Narration B");

    release();
    await expect.poll(() => released).toBeTruthy();
    // Let React process the deliberately late response before checking state.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(page.locator(".project-bar strong")).toHaveText(
      "Lifecycle project B",
    );
    await expect(page.getByLabel("Your new script")).toHaveValue("Narration B");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Script saved to this project.")).toBeVisible();
    const detail = await (await request.get(`/api/clips/${second.id}`)).json();
    expect(detail.script).toMatchObject({
      original_text: "Topic B",
      rewritten_text: "Narration B",
    });
  } finally {
    release();
  }
});
