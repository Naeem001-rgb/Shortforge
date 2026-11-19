import { test, expect } from "./fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import type { Publication } from "../src/studio/Publishing";

test.use({ timezoneId: "Asia/Karachi", actionTimeout: 10000 });
const clip = {
  id: "publishing-test-video",
  video_id: null,
  url: "",
  title: "A walk through Lahore",
  description: "An evening walk. #Lahore",
  channel_name: "Test footage",
  channel_handle: "",
  likes: null,
  views: null,
  credit_target: "",
  credit_snippet: "",
  license_status: "owned",
  permission_note: "",
  thumbnail_url: "",
  workflow_status: "editing",
  discovery_mode: "manual",
  created_at: "2026-11-05T00:00:00Z",
};

async function fixture(
  context: BrowserContext,
  { connected = true, ready = true } = {},
) {
  const requests: Record<string, unknown>[] = [];
  const actions: string[] = [];
  const state = {
    project: {
      ready,
      revision: ready ? "a".repeat(64) : null,
      saved_at: ready ? "2026-11-05T08:00:00Z" : null,
      error: ready
        ? null
        : "Open this video in Concat and save your edit first.",
    },
    defaults: {
      title: clip.title,
      description: clip.description,
      tags: ["Lahore"],
    },
    publications: [] as Publication[],
  };
  await context.route("**/api/clips", (route) =>
    route.fulfill({ json: { clips: [clip] } }),
  );
  await context.route("**/api/studio/publishing?*", (route) =>
    route.fulfill({ json: state }),
  );
  await context.route("**/api/youtube/channels", (route) =>
    route.fulfill({
      json: {
        configured: connected,
        redirect_uri: "http://127.0.0.1:8788/api/youtube/oauth/callback",
        channels: connected
          ? [{ id: "UCtest", title: "My travel channel", thumbnail_url: "" }]
          : [],
      },
    }),
  );
  await context.route("**/api/studio/publish", (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const job: Publication = {
      id: "publication-1",
      clip_id: clip.id,
      channel_id: body.channel_id,
      channel_title: "My travel channel",
      title: body.title,
      status: "queued",
      progress: 0,
      privacy_status: body.privacy_status,
      publish_at: body.publish_at,
      error: null,
      retryable: false,
      can_cancel: true,
      video_url: null,
      created_at: new Date().toISOString(),
    };
    state.publications = [job];
    return route.fulfill({ json: job });
  });
  await context.route("**/api/studio/publications/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const job = state.publications.find((item) => item.id === id);
    return route.fulfill({
      status: job ? 200 : 404,
      json: job || { detail: "Publishing job not found." },
    });
  });
  for (const action of ["cancel", "retry"])
    await context.route(`**/api/studio/publications/*/${action}`, (route) => {
      actions.push(action);
      const job = state.publications[0];
      job.status = action === "cancel" ? "cancelled" : "uploading";
      job.can_cancel = false;
      job.retryable = false;
      job.error = null;
      return route.fulfill({ json: job });
    });
  return { requests, actions, state };
}

async function open(page: Page) {
  await page.goto(`/?studio=${clip.id}`);
  await expect(
    page.getByRole("form", { name: "YouTube publishing details" }),
  ).toBeVisible();
}

async function chooseTime(page: Page) {
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const value = await page.evaluate(() => {
    const date = new Date(Date.now() + 86400000);
    date.setSeconds(0, 0);
    return {
      local: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T20:30`,
      iso: new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        20,
        30,
      ).toISOString(),
    };
  });
  await page.getByLabel("Date and time", { exact: true }).fill(value.local);
  await page.getByLabel("Is this video made for kids?").selectOption("no");
  return value;
}

test("Studio shows publishing choices but opening or refreshing never posts", async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await open(page);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    clip.title,
  );
  await expect(page.getByLabel("Tags", { exact: true })).toHaveValue("Lahore");
  await page
    .getByRole("button", { name: "Refresh saved edit", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Schedule", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload privately", exact: true }),
  ).toBeEnabled();
  expect(f.requests).toEqual([]);
});

test("Schedule sends reviewed metadata as private with the Pakistan time converted to UTC", async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await open(page);
  const when = await chooseTime(page);
  await expect(page.getByText("Asia/Karachi", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Visibility", exact: true }),
  ).toBeHidden();
  await page
    .getByLabel("Title", { exact: true })
    .fill("My edited Lahore short");
  await page
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Reviewed description");
  await page
    .getByLabel("Tags", { exact: true })
    .fill("Lahore, travel, short video");
  await page
    .getByRole("button", { name: "Schedule video", exact: true })
    .click();
  await expect.poll(() => f.requests.length).toBe(1);
  expect(f.requests[0]).toMatchObject({
    clip_id: clip.id,
    channel_id: "UCtest",
    title: "My edited Lahore short",
    description: "Reviewed description",
    tags: ["Lahore", "travel", "short video"],
    privacy_status: "private",
    publish_at: when.iso,
    project_revision: "a".repeat(64),
    self_declared_made_for_kids: false,
    contains_synthetic_media: false,
  });
  expect(f.requests[0].request_id).toBeTruthy();
  await expect(
    page.getByText("Waiting to create the video", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Schedule video", exact: true }),
  ).toBeDisabled();
});

test("Publish now uses selected visibility and never carries a hidden schedule", async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await open(page);
  await chooseTime(page);
  await page.getByRole("button", { name: "Publish now", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Visibility", exact: true })
    .selectOption("public");
  await page.getByRole("form").locator('button[type="submit"]').click();
  await expect.poll(() => f.requests.length).toBe(1);
  expect(f.requests[0].privacy_status).toBe("public");
  expect(f.requests[0].publish_at).toBeNull();
});

test("schedule and metadata drafts survive reload without submitting", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key.startsWith("shortforge-publishing-draft:")) {
        const root = document.documentElement;
        root.dataset.draftReads = String(
          Number(root.dataset.draftReads || 0) + 1,
        );
      }
      return getItem.call(this, key);
    };
  });
  const f = await fixture(context);
  await open(page);
  const reads = await page.locator("html").getAttribute("data-draft-reads");
  expect(Number(reads)).toBeGreaterThan(0);
  const when = await chooseTime(page);
  await page
    .getByLabel("Title", { exact: true })
    .fill("My saved publishing draft");
  await expect(page.locator("html")).toHaveAttribute(
    "data-draft-reads",
    reads!,
  );
  await page.reload();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "My saved publishing draft",
  );
  await expect(page.getByLabel("Date and time", { exact: true })).toHaveValue(
    when.local,
  );
  await expect(
    page.getByRole("button", { name: "Schedule", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(f.requests).toEqual([]);
});

test("invalid past time and missing audience cannot submit", async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await open(page);
  await page
    .getByRole("button", { name: "Upload privately", exact: true })
    .click();
  expect(f.requests).toEqual([]);
  await chooseTime(page);
  await page
    .getByLabel("Date and time", { exact: true })
    .fill("2020-01-01T10:00");
  await page
    .getByRole("button", { name: "Schedule video", exact: true })
    .click();
  expect(f.requests).toEqual([]);
  expect(
    await page
      .getByLabel("Date and time", { exact: true })
      .evaluate((input) => (input as HTMLInputElement).validity.rangeUnderflow),
  ).toBe(true);
});

test("setup and saved-edit requirements provide a working next action", async ({
  page,
  context,
}) => {
  const f = await fixture(context, { connected: false, ready: false });
  await open(page);
  await expect(
    page.getByText("Open this video in Concat and save your edit first.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload privately", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Connect YouTube in Settings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "YouTube publishing", exact: true }),
  ).toBeVisible();
  expect(f.requests).toEqual([]);
});

test("confirmed scheduled status and video links survive navigation and reload", async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await open(page);
  await chooseTime(page);
  await page
    .getByRole("button", { name: "Schedule video", exact: true })
    .click();
  await expect.poll(() => f.requests.length).toBe(1);
  Object.assign(f.state.publications[0], {
    status: "scheduled",
    progress: 100,
    can_cancel: false,
    video_url: "https://www.youtube.com/watch?v=Abc123_xY-0",
  });
  await page.reload();
  await expect(
    page.getByText("Scheduled on YouTube", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open video", exact: true }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=Abc123_xY-0");
  await expect(page.getByText("Goes public", { exact: false })).toContainText(
    "Asia/Karachi",
  );
  expect(f.requests).toHaveLength(1);
});

test("a failed upload retries its saved job and a queued job can be cancelled", async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await open(page);
  await page.getByLabel("Is this video made for kids?").selectOption("no");
  await page
    .getByRole("button", { name: "Upload privately", exact: true })
    .click();
  await expect.poll(() => f.requests.length).toBe(1);
  Object.assign(f.state.publications[0], {
    status: "failed",
    error: "The connection was interrupted.",
    retryable: true,
    can_cancel: false,
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Retry publishing", exact: true })
    .click();
  expect(f.actions).toEqual(["retry"]);
  expect(f.requests).toHaveLength(1);
  Object.assign(f.state.publications[0], {
    status: "queued",
    error: null,
    retryable: false,
    can_cancel: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "Cancel job", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(f.actions).toEqual(["retry", "cancel"]);
});

test("an unconfirmed YouTube schedule is an action-needed state", async ({
  page,
  context,
}) => {
  const f = await fixture(context);
  await open(page);
  await chooseTime(page);
  await page
    .getByRole("button", { name: "Schedule video", exact: true })
    .click();
  await expect.poll(() => f.requests.length).toBe(1);
  Object.assign(f.state.publications[0], {
    status: "needs_attention",
    can_cancel: false,
    error: "YouTube did not confirm the scheduled time.",
    video_url: "https://www.youtube.com/watch?v=Abc123_xY-0",
  });
  await page.reload();
  await expect(
    page.getByText("Scheduled on YouTube", { exact: true }),
  ).toBeHidden();
  await expect(page.getByRole("alert")).toContainText("did not confirm");
  await expect(
    page.getByRole("link", { name: "Manage in YouTube Studio" }),
  ).toBeVisible();
});

test("an uncertain submit can be retried using the same request identity", async ({
  page,
  context,
}) => {
  await fixture(context);
  const bodies: Record<string, unknown>[] = [];
  await context.route("**/api/studio/publish", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 503,
      json: { detail: "The response was interrupted. Try again." },
    });
  });
  await open(page);
  await page.getByLabel("Is this video made for kids?").selectOption("no");
  const submit = page.getByRole("button", {
    name: "Upload privately",
    exact: true,
  });
  await submit.click();
  await expect(page.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  await submit.click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0].request_id).toBe(bodies[1].request_id);
});

for (const width of [390, 320])
  test(`scheduling fits a ${width}px screen and works from the keyboard`, async ({
    page,
    context,
  }) => {
    await fixture(context);
    await page.setViewportSize({ width, height: 844 });
    await open(page);
    const schedule = page.getByRole("button", {
      name: "Schedule",
      exact: true,
    });
    await schedule.focus();
    await page.keyboard.press("Space");
    await expect(schedule).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByLabel("Date and time", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
