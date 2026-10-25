import { test, expect } from "@playwright/test";

test("Instagram imports retain their source and details without YouTube enrichment", async ({
  page,
  request,
  context,
}) => {
  const response = await request.post("/api/clips", {
    data: {
      clips: [
        {
          url: "https://www.instagram.com/reel/ScoutFixture1/",
          title: "Instagram Scout fixture",
          channel_name: "Fixture creator",
          likes: 6200,
          views: 22000,
        },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
  const clip = (await response.json()).clips[0];
  await context.route("**/api/clips/*/thumbnail", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await context.route("**/api/clips/*/download", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "No remote downloads in this fixture" },
    }),
  );
  try {
    await page.goto("/");
    const card = page.locator(".clip-card").filter({ hasText: clip.title });
    await expect(card.locator(".source-pill")).toHaveText("Instagram");
    await expect(card.locator(".media-artwork img")).toHaveAttribute(
      "src",
      clip.thumbnail_url,
    );
    await expect
      .poll(() =>
        card
          .locator(".media-artwork img")
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    await card
      .getByRole("button", { name: `More about ${clip.title}` })
      .click();
    await expect(
      page.getByRole("link", { name: "Watch original" }),
    ).toHaveAttribute("href", clip.url);
    await expect(
      page.getByRole("button", { name: "Fetch YouTube details" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("dialog", { name: "Video details" })
        .getByRole("button", { name: "Edit in Studio", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Video details" }),
    ).toBeHidden();
    await page.getByRole("tab", { name: /^Archived/ }).click();
    await expect(card).toBeVisible();
  } finally {
    await request.delete(`/api/clips/${clip.id}`);
  }
});
