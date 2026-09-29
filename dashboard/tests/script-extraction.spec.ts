import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

const source = "We counted 12 stars, but I cannot promise you will.";
const rewritten = "We saw 12 stars, though I cannot guarantee your result.";
const importedClipIds = new Set<string>();

test.afterEach(async ({ request }) => {
  for (const clipId of importedClipIds) {
    const response = await request.delete(`/api/clips/${clipId}`);
    expect(response.ok()).toBeTruthy();
    importedClipIds.delete(clipId);
  }
});

async function importClip(request: APIRequestContext, title: string) {
  const videoId = randomBytes(8).toString("base64url");
  const response = await request.post("/api/clips", {
    data: {
      clips: [
        {
          url: `https://www.youtube.com/shorts/${videoId}`,
          title,
          description:
            "This description is metadata, not the spoken narration.",
          discovery_mode: "narrated",
        },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
  const clip = (await response.json()).clips[0];
  importedClipIds.add(clip.id);
  expect(clip.license_status).toBe("unknown");
  return clip as { id: string; title: string };
}

async function saveScript(
  request: APIRequestContext,
  clipId: string,
  originalText: string,
  rewrittenText = "",
) {
  const response = await request.put(`/api/scripts/${clipId}`, {
    data: { original_text: originalText, rewritten_text: rewrittenText },
  });
  expect(response.ok()).toBeTruthy();
}

async function openStudio(page: Page, clipId: string) {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Studio", exact: true })
    .click();
  await page.getByLabel("Studio project").selectOption(clipId);
  await expect(
    page.getByLabel("Original script", { exact: false }),
  ).toBeVisible();
}

// The browser exercises real project import, persistence and reload. Only the
// external transcription/generation work is simulated, so no API key is used.
async function mockExtraction(
  page: Page,
  request: APIRequestContext,
  clipId: string,
  failFree = false,
) {
  const providers: string[] = [];
  const extractionRequests: { provider: string; replace_existing?: boolean }[] =
    [];
  const jobs = new Map<string, { provider: string; saved: boolean }>();
  await page.route(`**/api/clips/${clipId}/extract-script`, async (route) => {
    const body = route.request().postDataJSON();
    extractionRequests.push(body);
    const { provider } = body;
    providers.push(provider);
    const id = `script-test-${clipId}-${providers.length}`;
    jobs.set(id, { provider, saved: false });
    await route.fulfill({
      json: { id, type: "extract-script", status: "queued", progress: 0 },
    });
  });
  await page.route(`**/api/jobs/script-test-${clipId}-*`, async (route) => {
    const id = route.request().url().split("/").at(-1)!;
    const job = jobs.get(id)!;
    if (failFree && job.provider === "auto") {
      await route.fulfill({
        json: {
          id,
          type: "extract-script",
          status: "failed",
          progress: 0,
          error:
            "No usable captions were found. Paste the narration or transcribe with Gemini.",
        },
      });
      return;
    }
    if (!job.saved) {
      const existing = await (await request.get(`/api/clips/${clipId}`)).json();
      await saveScript(
        request,
        clipId,
        source,
        existing.script?.rewritten_text || "",
      );
      job.saved = true;
    }
    await route.fulfill({
      json: {
        id,
        type: "extract-script",
        status: "completed",
        progress: 100,
        result: {
          text: source,
          source: job.provider === "auto" ? "youtube-captions" : "gemini",
          original_updated: true,
        },
      },
    });
  });
  return { providers, extractionRequests };
}

test("opening a collected Short extracts its narration and rewrites that exact source", async ({
  page,
  request,
}) => {
  const clip = await importClip(
    request,
    "A title that is not the original script",
  );
  const { providers, extractionRequests } = await mockExtraction(
    page,
    request,
    clip.id,
  );
  const rewriteRequests: Record<string, unknown>[] = [];
  await page.route("**/api/rewrite", async (route) => {
    const body = route.request().postDataJSON();
    rewriteRequests.push(body);
    await saveScript(request, clip.id, body.text, rewritten);
    await route.fulfill({
      json: {
        original_text: body.text,
        rewritten_text: rewritten,
        words_original: 10,
        words_rewritten: 10,
        within_tolerance: true,
        exact_word_count: true,
        attempts: 1,
      },
    });
  });

  await openStudio(page, clip.id);
  const original = page.getByLabel("Original script", { exact: false });
  await expect(original).toHaveValue(source);
  await expect(original).toBeEditable();
  expect(providers).toEqual(["auto"]);
  expect(extractionRequests[0].replace_existing).not.toBe(true);
  await page
    .getByRole("button", { name: "Rewrite script", exact: true })
    .click();
  await expect(page.getByLabel("Your new script")).toHaveValue(rewritten);
  expect(rewriteRequests).toHaveLength(1);
  expect(rewriteRequests[0]).toMatchObject({
    clip_id: clip.id,
    mode: "rewrite",
    text: source,
  });
  expect(rewriteRequests[0].text).not.toBe(clip.title);
  const saved = await (await request.get(`/api/clips/${clip.id}`)).json();
  expect(saved.script.original_text).toBe(source);
  expect(saved.script.rewritten_text).toBe(rewritten);
  expect(saved.script.words_original).toBe(saved.script.words_rewritten);
  await page.screenshot({
    path: test.info().outputPath("script-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(original).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: test.info().outputPath("script-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("failed free extraction explains the fallback and Gemini runs only when requested", async ({
  page,
  request,
}) => {
  const clip = await importClip(
    request,
    "Narration without available captions",
  );
  const { providers } = await mockExtraction(page, request, clip.id, true);
  await openStudio(page, clip.id);
  await expect(page.getByRole("alert")).toContainText(
    "No usable captions were found",
  );
  await expect(
    page.getByLabel("Original script", { exact: false }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Rewrite script", exact: true }),
  ).toBeDisabled();
  expect(providers).toEqual(["auto"]);
  await page
    .getByRole("button", { name: "Transcribe with Gemini", exact: true })
    .click();
  await expect(
    page.getByLabel("Original script", { exact: false }),
  ).toHaveValue(source);
  expect(providers).toEqual(["auto", "gemini"]);
  const saved = await (await request.get(`/api/clips/${clip.id}`)).json();
  expect(saved.script.original_text).toBe(source);
});

test("a saved original is kept editable and is not extracted again or overwritten", async ({
  page,
  request,
}) => {
  const clip = await importClip(request, "A project with a reviewed original");
  const reviewed = "This is the source narration I already checked carefully.";
  const edited = "This is the source narration I checked and corrected myself.";
  await saveScript(request, clip.id, reviewed, "A previously saved rewrite.");
  const extractionRequests: unknown[] = [];
  await page.route(`**/api/clips/${clip.id}/extract-script`, async (route) => {
    extractionRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 400,
      json: {
        detail: "Existing originals must not trigger automatic extraction.",
      },
    });
  });
  await openStudio(page, clip.id);
  const original = page.getByLabel("Original script", { exact: false });
  await expect(original).toHaveValue(reviewed);
  await expect(page.getByLabel("Your new script")).toHaveValue(
    "A previously saved rewrite.",
  );
  await original.fill(edited);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Script saved to this project.")).toBeVisible();
  const saved = await (await request.get(`/api/clips/${clip.id}`)).json();
  expect(saved.script.original_text).toBe(edited);
  expect(saved.script.rewritten_text).toBe("A previously saved rewrite.");

  await openStudio(page, clip.id);
  await expect(
    page.getByLabel("Original script", { exact: false }),
  ).toHaveValue(edited);
  await expect(
    page.getByRole("button", { name: "Rewrite script", exact: true }),
  ).toBeEnabled();
  expect(extractionRequests).toEqual([]);
});

test("reopening a project retries a failed free extraction instead of staying blank", async ({
  page,
  request,
}) => {
  const clip = await importClip(request, "Narration retried after a failure");
  // A reviewed project so switching to it never starts its own extraction.
  const other = await importClip(request, "An unrelated reviewed project");
  await saveScript(
    request,
    other.id,
    "A different project with its own script.",
  );
  const { providers } = await mockExtraction(page, request, clip.id, true);

  await openStudio(page, clip.id);
  await expect(page.getByRole("alert")).toContainText(
    "No usable captions were found",
  );
  expect(providers).toEqual(["auto"]);

  await page.getByLabel("Studio project").selectOption(other.id);
  await page.getByLabel("Studio project").selectOption(clip.id);
  const original = page.getByLabel("Original script", { exact: false });
  await expect(original).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "No usable captions were found",
  );
  expect(providers).toEqual(["auto", "auto"]);
  await expect(
    page.getByRole("button", { name: "Rewrite script", exact: true }),
  ).toBeDisabled();
});

test("Extract again replaces an old saved topic with narration and keeps the existing rewrite", async ({
  page,
  request,
}) => {
  const clip = await importClip(request, "An old topic-based project");
  const oldTopic = `${clip.title}\nPreviously saved topic metadata.`;
  const savedDraft = "A rewrite already reviewed by the user.";
  await saveScript(request, clip.id, oldTopic, savedDraft);
  const { providers, extractionRequests } = await mockExtraction(
    page,
    request,
    clip.id,
  );

  await openStudio(page, clip.id);
  const original = page.getByLabel("Original script", { exact: false });
  await expect(original).toHaveValue(oldTopic);
  expect(providers).toEqual([]);
  await page
    .getByRole("button", { name: "Extract again", exact: true })
    .click();
  await expect(original).toHaveValue(source);
  await expect(page.getByLabel("Your new script")).toHaveValue(savedDraft);
  expect(extractionRequests).toEqual([
    { provider: "auto", replace_existing: true },
  ]);
  const saved = await (await request.get(`/api/clips/${clip.id}`)).json();
  expect(saved.script.original_text).toBe(source);
  expect(saved.script.rewritten_text).toBe(savedDraft);

  await openStudio(page, clip.id);
  await expect(
    page.getByLabel("Original script", { exact: false }),
  ).toHaveValue(source);
  await expect(page.getByLabel("Your new script")).toHaveValue(savedDraft);
  expect(providers).toEqual(["auto"]);
});
