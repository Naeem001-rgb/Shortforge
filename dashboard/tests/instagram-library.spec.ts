import { test, expect } from "@playwright/test";

test("Instagram imports retain their source in Library and open Studio without YouTube enrichment", async ({
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
    await card
      .getByRole("button", { name: `Details for ${clip.title}` })
      .click();
    await expect(
      page.getByRole("link", { name: "Watch original" }),
    ).toHaveAttribute("href", clip.url);
    await expect(
      page.getByRole("button", { name: "Fetch YouTube details" }),
    ).toHaveCount(0);
    const created = context.waitForEvent("page");
    await page
      .getByRole("button", { name: "Edit in Studio", exact: true })
      .click();
    const editor = await created;
    await expect(editor).toHaveURL(new RegExp(`\\?studio=${clip.id}$`));
    await expect(editor.locator("main.studio-tab")).toBeVisible();
    await editor.close();
  } finally {
    await request.delete(`/api/clips/${clip.id}`);
  }
});
