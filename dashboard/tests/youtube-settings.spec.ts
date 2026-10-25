import { test, expect } from "@playwright/test";

test("YouTube setup imports a Desktop client and manages connected channels", async ({
  page,
}) => {
  let configured = false;
  let channels = [
    { id: "UCtest", title: "My science channel", thumbnail_url: "" },
  ];
  const saved: unknown[] = [];
  await page.route("**/api/youtube/channels", (route) =>
    route.fulfill({
      json: {
        configured,
        redirect_uri: "http://127.0.0.1:8787/api/youtube/oauth/callback",
        channels: configured ? channels : [],
      },
    }),
  );
  await page.route("**/api/youtube/config", async (route) => {
    saved.push(route.request().postDataJSON());
    configured = true;
    await route.fulfill({ json: { configured: true } });
  });
  await page.route("**/api/youtube/channels/UCtest", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    channels = [];
    await route.fulfill({ json: { disconnected: true } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "YouTube publishing" });
  await expect(settings.getByText("Get your Google client file")).toBeVisible();
  await settings.getByLabel("Google Desktop client JSON").setInputFiles({
    name: "desktop-client.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        installed: {
          client_id: "test.apps.googleusercontent.com",
          client_secret: "fixture-client-secret",
        },
      }),
    ),
  });
  await settings.getByRole("button", { name: "Save YouTube setup" }).click();
  await expect(
    settings.getByText("My science channel", { exact: true }),
  ).toBeVisible();
  expect(saved).toEqual([
    {
      client_id: "test.apps.googleusercontent.com",
      client_secret: "fixture-client-secret",
    },
  ]);
  await expect(settings.getByText("fixture-client-secret")).toHaveCount(0);
  await settings
    .getByRole("button", { name: "Disconnect My science channel" })
    .click();
  await expect(
    settings.getByRole("list", { name: "Connected YouTube channels" }),
  ).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Connect YouTube channel" }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("wrong OAuth file is explained and cannot be saved", async ({ page }) => {
  await page.route("**/api/youtube/channels", (route) =>
    route.fulfill({
      json: {
        configured: false,
        redirect_uri: "http://127.0.0.1:8787/api/youtube/oauth/callback",
        channels: [],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "YouTube publishing" });
  await settings.getByLabel("Google Desktop client JSON").setInputFiles({
    name: "wrong.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"web":{}}'),
  });
  await expect(settings.getByRole("alert")).toContainText(
    "Desktop app OAuth client",
  );
  await expect(
    settings.getByRole("button", { name: "Save YouTube setup" }),
  ).toBeDisabled();
});
