import { test, expect } from "@playwright/test";
import type { Clip } from "../src/api";

test("an unavailable engine does not present an empty library as fact", async ({
  page,
}) => {
  await page.route("**/api/clips", (route) =>
    route.fulfill({ status: 503, json: { detail: "Engine unavailable" } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your library is unavailable." }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Library overview" }).locator("strong"),
  ).toHaveText(["—", "—", "—", "—"]);
  await expect(
    page.getByText("Waiting for your library", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Your next story starts here.")).toHaveCount(0);
});

const clips: Clip[] = [
  {
    title: "My footage",
    license_status: "owned",
    workflow_status: "discovered",
    discovery_mode: "upload",
  },
  {
    title: "Finished Short",
    license_status: "owned",
    workflow_status: "exported",
    discovery_mode: "project",
  },
  {
    title: "Saved inspiration",
    license_status: "unknown",
    workflow_status: "discovered",
    discovery_mode: "manual",
  },
].map((clip, index) => ({
  id: `redesign-${index}`,
  video_id: null,
  url: "",
  channel_name: "Test workspace",
  channel_handle: "",
  description: "",
  likes: null,
  views: null,
  credit_target: "",
  credit_snippet: "",
  permission_note: "",
  thumbnail_url: "/api/redesign-missing-thumbnail",
  created_at: "2026-10-05T00:00:00Z",
  ...clip,
})) as Clip[];

test("overview, keyboard filters, and persistent views operate on the same library", async ({
  page,
}) => {
  await page.route("**/api/clips", (route) =>
    route.fulfill({ json: { clips } }),
  );
  await page.route("**/api/redesign-missing-thumbnail", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/");
  await expect(page.locator(".clip-card")).toHaveCount(3);
  await expect(page.locator(".clip-thumbnail img")).toHaveCount(0);
  await expect(
    page.locator(".source-pill", { hasText: "Project" }),
  ).toBeVisible();
  await page.getByLabel("Select My footage", { exact: true }).check();

  await page.getByRole("button", { name: /^Show exported/ }).click();
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Finished Short", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Exported/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Show inspiration/ }).click();
  await expect(page.getByLabel("Filter by rights")).toHaveValue("unknown");
  await expect(page.locator(".clip-card")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Saved inspiration", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Show all videos/ }).click();
  await expect(page.getByLabel("Filter by rights")).toHaveValue("all");
  await expect(
    page.getByLabel("Select My footage", { exact: true }),
  ).toBeChecked();
  const all = page.getByRole("tab", { name: /^All videos/ });
  await all.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: /^Archived/ })).toBeFocused();
  await expect(page.getByText("No videos in this view.")).toBeVisible();
  await page.keyboard.press("Home");
  await expect(all).toBeFocused();
  await expect(page.locator(".clip-card")).toHaveCount(3);

  await page.getByRole("button", { name: "Table view", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(4);
  await expect(
    page.getByLabel("Select My footage", { exact: true }),
  ).toBeChecked();
  await page.reload();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Table view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Add a video", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Bring your next idea in" }),
  ).toBeVisible();
});
