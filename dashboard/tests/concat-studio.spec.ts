import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Clip } from "../src/api";

const clip: Clip = {
  id: "concat-library-video",
  video_id: "ig:ConcatFixture",
  url: "https://www.instagram.com/reel/ConcatFixture/",
  channel_name: "Test creator",
  channel_handle: "",
  title: "Saved Concat video",
  description: "Integration test footage",
  likes: 6000,
  views: 24000,
  credit_target: "",
  credit_snippet: "",
  license_status: "unknown",
  permission_note: "",
  thumbnail_url: "",
  workflow_status: "collected",
  discovery_mode: "manual",
  created_at: "2026-10-24T00:00:00Z",
};

function completed(clipId: string | null) {
  return {
    id: `open-${clipId || "new"}`,
    type: "studio-open",
    status: "completed",
    progress: 100,
    result: {
      editor: "Concat",
      clip_id: clipId,
      title: clipId ? clip.title : "",
      project_created: Boolean(clipId),
      project_path: clipId ? `/saved/projects/${clipId}/edit` : null,
      opened: true,
    },
  };
}

async function fixture(context: BrowserContext) {
  const opened: (string | null)[] = [];
  await context.route("**/api/clips", (route) =>
    route.fulfill({ json: { clips: [clip] } }),
  );
  await context.route("**/api/studio/open", (route) => {
    const id = route.request().postDataJSON().clip_id;
    opened.push(id);
    return route.fulfill({ json: completed(id) });
  });
  return opened;
}

async function openEditor(page: Page, trigger: Locator, clipId: string | null) {
  await trigger.click();
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your editor opens in the Concat desktop app.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("studio")).toBe(clipId || "new");
  expect(page.context().pages()).toHaveLength(1);
}

async function backToLibrary(page: Page) {
  await page
    .getByRole("button", { name: "Back to Library", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your library", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has("studio")).toBe(false);
}

test("Library thumbnail, title, table Edit and details launch native Concat without a browser tab", async ({
  page,
  context,
}) => {
  const opened = await fixture(context);
  const streams: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/studio/browser/")) streams.push(request.url());
  });
  await page.goto("/");
  const edit = page.getByRole("button", {
    name: `Edit ${clip.title} in Studio`,
    exact: true,
  });
  await openEditor(page, edit, clip.id);
  await page
    .getByRole("button", { name: "Open Concat again", exact: true })
    .click();
  await expect.poll(() => opened.length).toBe(2);
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeVisible();
  await backToLibrary(page);
  await openEditor(
    page,
    page.getByRole("heading", { name: clip.title }).getByRole("button"),
    clip.id,
  );
  await backToLibrary(page);
  await page.getByRole("button", { name: `More about ${clip.title}` }).click();
  const details = page.getByRole("dialog", { name: "Video details" });
  await expect(details).toBeVisible();
  expect(opened).toHaveLength(3);
  await openEditor(
    page,
    details.getByRole("button", { name: "Edit in Studio", exact: true }),
    clip.id,
  );
  await backToLibrary(page);
  await page.getByRole("button", { name: "Table view", exact: true }).click();
  await openEditor(page, edit, clip.id);
  expect(opened).toEqual([clip.id, clip.id, clip.id, clip.id, clip.id]);
  expect(streams).toEqual([]);
});

for (const mobile of [false, true]) {
  test(`Studio launches native Concat from ${mobile ? "mobile" : "desktop"} navigation`, async ({
    page,
    context,
  }) => {
    const opened = await fixture(context);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    if (mobile)
      await page.getByRole("button", { name: "Open navigation" }).click();
    await openEditor(
      page,
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button", { name: "Studio", exact: true }),
      null,
    );
    expect(opened).toEqual([null]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await backToLibrary(page);
  });
}

test("direct Studio links and reload wait for the preparation job", async ({
  page,
  context,
}) => {
  await fixture(context);
  const opened: string[] = [];
  await context.route("**/api/studio/open", (route) => {
    opened.push(route.request().postDataJSON().clip_id);
    return route.fulfill({
      json: {
        ...completed(clip.id),
        status: "queued",
        progress: 0,
        result: null,
      },
    });
  });
  await context.route(`**/api/jobs/open-${clip.id}`, (route) =>
    route.fulfill({ json: completed(clip.id) }),
  );
  await page.goto(`/?studio=${clip.id}`);
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeVisible();
  expect(opened).toEqual([clip.id, clip.id]);
  expect(new URL(page.url()).searchParams.get("studio")).toBe(clip.id);
  expect(context.pages()).toHaveLength(1);
});

test("an unavailable native editor explains the error and supports retry", async ({
  page,
  context,
}) => {
  const opened = await fixture(context);
  let unavailable = true;
  await context.route("**/api/studio/open", (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          json: {
            detail:
              "Concat is not installed. Set up Concat and try Studio again.",
          },
        })
      : route.fallback(),
  );
  await page.goto(`/?studio=${clip.id}`);
  await expect(page.getByRole("alert")).toContainText(
    "Concat is not installed",
  );
  unavailable = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeVisible();
  expect(opened).toEqual([clip.id]);
});

test("an unconfirmed native launch never claims the editor opened", async ({
  page,
  context,
}) => {
  await fixture(context);
  let invalid = true;
  await context.route("**/api/studio/open", (route) =>
    invalid
      ? route.fulfill({
          json: {
            ...completed(clip.id),
            result: { ...completed(clip.id).result, opened: false },
          },
        })
      : route.fallback(),
  );
  await page.goto(`/?studio=${clip.id}`);
  await expect(page.getByRole("alert")).toContainText(
    "could not confirm that Concat opened",
  );
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeHidden();
  invalid = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeVisible();
});

test("a failed launch job shows its error", async ({ page, context }) => {
  await fixture(context);
  await context.route("**/api/studio/open", (route) =>
    route.fulfill({
      json: {
        ...completed(clip.id),
        status: "failed",
        error: "Concat could not start its desktop window.",
        result: null,
      },
    }),
  );
  await page.goto(`/?studio=${clip.id}`);
  await expect(page.getByRole("alert")).toContainText(
    "could not start its desktop window",
  );
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeEnabled();
});

test("a saved completed job cannot claim success before the current launch responds", async ({
  page,
  context,
}) => {
  await fixture(context);
  await page.addInitScript(
    ({ id, job }) => {
      sessionStorage.setItem(
        `shortforge-job:concat-desktop:${id}`,
        JSON.stringify(job),
      );
    },
    { id: clip.id, job: completed(clip.id) },
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/api/studio/open", async (route) => {
    await pending;
    await route.fulfill({ json: completed(clip.id) });
  });
  try {
    const request = page.waitForRequest("**/api/studio/open");
    await page.goto(`/?studio=${clip.id}`);
    await request;
    await expect(
      page.getByRole("button", { name: "Opening Concat…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Opened in Concat", { exact: true }),
    ).toBeHidden();
  } finally {
    release();
  }
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeVisible();
});

test("choosing another video while the first launch is pending keeps requests distinct", async ({
  page,
  context,
}) => {
  await fixture(context);
  const second = {
    ...clip,
    id: "concat-second-video",
    title: "Another saved video",
  };
  await context.route("**/api/clips", (route) =>
    route.fulfill({ json: { clips: [clip, second] } }),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const opened: string[] = [];
  await context.route("**/api/studio/open", async (route) => {
    const id = route.request().postDataJSON().clip_id;
    opened.push(id);
    if (id === clip.id) await pending;
    await route.fulfill({ json: completed(id) });
  });
  try {
    await page.goto("/");
    await page
      .getByRole("button", {
        name: `Edit ${clip.title} in Studio`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Opening Concat…", exact: true }),
    ).toBeDisabled();
    await backToLibrary(page);
    await openEditor(
      page,
      page.getByRole("button", {
        name: `Edit ${second.title} in Studio`,
        exact: true,
      }),
      second.id,
    );
    await expect(
      page.getByRole("heading", { name: second.title, exact: true }),
    ).toBeVisible();
    expect(opened).toEqual([clip.id, second.id]);
  } finally {
    release();
  }
});
