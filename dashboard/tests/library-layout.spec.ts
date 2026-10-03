import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Clip } from "../src/api";

const review = path.join(os.tmpdir(), "shortforge-resume-qa-library-layout");

// Intercepted layout fixtures never write to the user's library. An optional
// local snapshot supplies real thumbnails for the design review only.
const fixture: Clip[] = process.env.SHORTFORGE_LAYOUT_FIXTURE
  ? JSON.parse(fs.readFileSync(process.env.SHORTFORGE_LAYOUT_FIXTURE, "utf8"))
  : Array.from({ length: 10 }, (_, i) => ({
      id: `layout-${i}`,
      video_id: null,
      url: "",
      channel_name: "Layout test fixture",
      channel_handle: "",
      title: `Sample ${i + 1}: A longer title to check the compact video card`,
      description: "",
      likes: 12800 + i,
      views: 124500 + i,
      credit_target: "",
      credit_snippet: "",
      license_status: "unknown",
      permission_note: "",
      thumbnail_url: "",
      workflow_status: "discovered",
      discovery_mode: "manual",
      created_at: "2026-09-30T00:00:00Z",
    }));

test("reference library: five compact desktop cards, responsive themes and honest states", async ({
  page,
}) => {
  let clips = fixture;
  let offline = false;
  await page.route("**/api/clips", (route) =>
    route.fulfill({
      status: offline ? 503 : 200,
      json: offline ? { detail: "Engine unavailable" } : { clips },
    }),
  );
  await page.route("**/api/health", (route) =>
    route.fulfill({
      status: offline ? 503 : 200,
      json: { status: "ok", version: "0.1", tools: {} },
    }),
  );
  const capture = (name: string) =>
    page.screenshot({
      path: path.join(review, `${name}.png`),
      fullPage: true,
      animations: "disabled",
    });
  const geometry = () =>
    page.locator(".clip-grid").evaluate((grid) => {
      const cards = [...grid.querySelectorAll<HTMLElement>(".clip-card")];
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        firstRow: cards.filter(
          (card) => Math.abs(card.offsetTop - cards[0].offsetTop) < 1,
        ).length,
        maxHeight: Math.max(
          ...cards.map((card) => card.getBoundingClientRect().height),
        ),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
  await page.setViewportSize({ width: 1261, height: 698 });
  await page.goto("/");
  await expect(page.locator(".clip-card")).toHaveCount(fixture.length);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  const compact = await geometry();
  expect(compact.columns).toBe(5);
  expect(compact.firstRow).toBe(5);
  // Keep cards compact with the current 142–167px inset thumbnail range.
  expect(compact.maxHeight).toBeLessThanOrEqual(320);
  expect(compact.overflow).toBe(false);
  await expect(page.locator(".library-flow")).toHaveCount(0);
  await capture("desktop-light");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await capture("desktop-dark");
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect((await geometry()).columns).toBe(5);
  await capture("wide-dark");
  clips = fixture.slice(0, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".clip-card")).toHaveCount(2);
  expect((await geometry()).overflow).toBe(false);
  await capture("mobile-dark");
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await capture("mobile-light");
  clips = [];
  await page.setViewportSize({ width: 1261, height: 698 });
  await page.reload();
  await expect(page.locator(".clip-card")).toHaveCount(0);
  await capture("empty-light");
  offline = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("engine");
  await capture("offline-light");
});
