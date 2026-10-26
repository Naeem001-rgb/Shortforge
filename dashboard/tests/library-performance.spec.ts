import { test, expect } from "@playwright/test";
import type { Clip } from "../src/api";

function fixtures(size: number): Clip[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `performance-${i}`,
    video_id: null,
    url: "",
    title: `Video ${i}`,
    description: "",
    channel_name: "Fixture",
    channel_handle: "",
    likes: 12000,
    views: 125000,
    credit_target: "",
    credit_snippet: "",
    license_status: "unknown",
    permission_note: "",
    thumbnail_url: "",
    workflow_status: "collected",
    discovery_mode: "manual",
    created_at: "2026-10-26T00:00:00Z",
  }));
}

test("pagination keeps selection across pages and filters; archive is bounded and retryable", async ({
  page,
}) => {
  const clips = fixtures(55);
  let active = 0,
    peak = 0;
  await page.route("**/api/clips", (route) =>
    route.fulfill({ json: { clips } }),
  );
  await page.route("**/api/clips/performance-*", async (route) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const id = route.request().url().split("/").at(-1);
    const failed = id === "performance-54";
    if (!failed)
      clips.find((clip) => clip.id === id)!.workflow_status = "archived";
    await route.fulfill({
      status: failed ? 503 : 200,
      json: failed ? { detail: "Try again" } : {},
    });
    active--;
  });
  await page.goto("/");
  await expect(page.locator(".clip-card")).toHaveCount(50);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "Library pages" })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: "test-results/library-pagination-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("checkbox", { name: "Select all videos on this page" })
    .check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".clip-card")).toHaveCount(5);
  await page
    .getByRole("checkbox", { name: "Select all videos on this page" })
    .check();
  await expect(page.getByText("55 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.locator(".clip-checkbox:checked")).toHaveCount(50);
  await page.getByPlaceholder("Search your videos…").fill("Video 54");
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(page.getByText("55 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Table view" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Archived 54 of 55");
  expect(peak).toBeLessThanOrEqual(4);
  expect(peak).toBeGreaterThan(1);
  await expect(
    page.getByRole("checkbox", { name: "Select Video 54", exact: true }),
  ).toBeChecked();
});

test("multi-page deletion batches 200 IDs and retains the failed batch for retry", async ({
  page,
}) => {
  let clips = fixtures(205);
  const batches: string[][] = [];
  let fail = true;
  await page.route("**/api/clips", (route) =>
    route.fulfill({ json: { clips } }),
  );
  await page.route("**/api/clips/delete-bulk", (route) => {
    const ids: string[] = route.request().postDataJSON().ids;
    batches.push(ids);
    if (ids.length === 5 && fail)
      return route.fulfill({
        status: 503,
        json: { detail: "Retry the last batch" },
      });
    clips = clips.filter((clip) => !ids.includes(clip.id));
    return route.fulfill({ json: { deleted: ids, missing: [] } });
  });
  await page.goto("/");
  for (let i = 0; i < 5; i++) {
    await page
      .getByRole("checkbox", { name: "Select all videos on this page" })
      .check();
    if (i < 4)
      await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page.getByRole("dialog").locator("strong")).toHaveText(
    "5 videos",
  );
  await expect.poll(() => batches.map((ids) => ids.length)).toEqual([200, 5]);
  await expect(
    page.getByRole("button", { name: "Delete permanently", exact: true }),
  ).toBeEnabled();
  fail = false;
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".clip-card")).toHaveCount(0);
  expect(batches[2]).toEqual(batches[1]);
});

test("polls do not overlap, hidden tabs pause, and unchanged clips do not mutate the grid", async ({
  page,
}) => {
  const clips = fixtures(10);
  let requests = 0;
  let release: (() => void) | undefined;
  let hold = false;
  await page.clock.install();
  await page.route("**/api/clips", async (route) => {
    requests++;
    if (hold)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({ json: { clips } });
  });
  await page.goto("/");
  await expect(page.locator(".clip-card")).toHaveCount(10);
  await page.evaluate(() => {
    (window as any).gridMutations = 0;
    new MutationObserver((records) => {
      (window as any).gridMutations += records.length;
    }).observe(document.querySelector(".clip-grid")!, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  });
  hold = true;
  const before = requests;
  await page.clock.fastForward(5000);
  await expect.poll(() => requests).toBe(before + 1);
  await page.clock.fastForward(10000);
  expect(requests).toBe(before + 1);
  hold = false;
  release!();
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelectorAll(".clip-card").length),
    )
    .toBe(10);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(20000);
  expect(requests).toBe(before + 1);
  expect(await page.evaluate(() => (window as any).gridMutations)).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests).toBe(before + 2);
});
