import { test, expect, connectionLink } from "./fixtures";

test("an external Studio link waits for an intentional action", async ({
  page,
}) => {
  let launches = 0;
  await page.route("**/api/studio/open", (route) => {
    launches++;
    return route.fulfill({
      json: {
        id: "safe-launch",
        status: "completed",
        progress: 100,
        type: "studio-open",
        result: { opened: true, clip_id: null },
      },
    });
  });
  await page.goto("/?studio=new");
  await expect(
    page.getByRole("button", { name: "Open Concat", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(250);
  expect(launches).toBe(0);
  await page.getByRole("button", { name: "Open Concat", exact: true }).click();
  await expect(
    page.getByText("Opened in Concat", { exact: true }),
  ).toBeVisible();
  expect(launches).toBe(1);
});

test("the dashboard sends framing protection", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
});

test("CSV exports keep spreadsheet formulas as literal text", async ({
  page,
}) => {
  await page.route("**/api/clips", (route) =>
    route.fulfill({
      json: {
        clips: [
          {
            id: "csv-fixture",
            video_id: "abcdefghijk",
            title: " \t=1+1",
            channel_name: " \r@SUM(1)",
            url: "https://www.youtube.com/shorts/abcdefghijk",
            created_at: "2026-11-02",
            thumbnail_url: "",
            workflow_status: "collected",
            license_status: "unknown",
            likes: 0,
            views: 0,
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("checkbox").first().check();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export links", exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain('"\' \t=1+1"');
  expect(csv).toContain('"\' \r@SUM(1)"');
});

test.describe("unconnected browser", () => {
  test.use({ connectedBrowser: false });
  test("a fresh private link connects a window that was already open", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Open your workspace." }),
    ).toBeVisible();
    await page.goto(connectionLink(baseURL!));
    await expect(
      page.getByRole("heading", { name: "Your library", exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
  });
  test("private data stays behind the connection screen", async ({ page }) => {
    const privateRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/clips"))
        privateRequests.push(request.url());
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Open your workspace." }),
    ).toBeVisible();
    expect(privateRequests).toEqual([]);
    await page.getByText("Use a connection link", { exact: true }).click();
    await page.getByLabel("Connection link or code").fill("invalid-code");
    await page.getByRole("button", { name: "Connect this browser" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "complete connection link",
    );
    await expect(
      page.getByRole("heading", { name: "Your library", exact: true }),
    ).toHaveCount(0);
  });
});
