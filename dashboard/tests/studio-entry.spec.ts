import { test, expect } from "@playwright/test";

test("grid, table, and details Edit open a full Studio tab with honest source metadata", async ({
  page,
  context,
  request,
}) => {
  const response = await request.post("/api/clips", {
    data: {
      clips: [{ video_id: "testEntry01", title: "Studio entry fixture" }],
    },
  });
  const clip = (await response.json()).clips[0];
  await context.route("**/api/clips/*/download", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "Acquisition fixture: retry with a real source" },
    }),
  );
  try {
    await page.goto("/");
    const checkTab = async (click: () => Promise<void>) => {
      const created = context.waitForEvent("page");
      await click();
      const editor = await created;
      await expect(editor).toHaveURL(new RegExp(`\\?studio=${clip.id}$`));
      await expect(editor.locator("main.studio-tab")).toBeVisible();
      await expect(editor.locator(".sidebar")).toHaveCount(0);
      await editor.reload();
      await expect(editor.locator("main.studio-tab")).toBeVisible();
      await editor.close();
      await expect(page).not.toHaveURL(/studio=/);
    };
    await checkTab(() =>
      page
        .getByRole("button", { name: `Edit ${clip.title} in a new tab` })
        .click(),
    );
    await page.getByRole("button", { name: "Table view" }).click();
    await checkTab(() =>
      page
        .getByRole("button", { name: `Edit ${clip.title} in a new tab` })
        .click(),
    );
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await checkTab(() =>
      page.getByRole("button", { name: "Edit in Studio", exact: true }).click(),
    );
    const detail = await (await request.get(`/api/clips/${clip.id}`)).json();
    expect(detail.license_status).toBe("unknown");
    expect(detail.permission_note).toBe("");
  } finally {
    await request.delete(`/api/clips/${clip.id}`);
  }
});

test("studio=new creates one blank local project and replaces the deep link", async ({
  page,
  request,
}) => {
  let creations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/projects"))
      creations++;
  });
  await page.goto("/?studio=new");
  await expect(page).toHaveURL(/\?studio=[a-f0-9-]{36}$/);
  const id = new URL(page.url()).searchParams.get("studio")!;
  try {
    const project = await (await request.get(`/api/clips/${id}`)).json();
    expect(project.license_status).toBe("owned");
    expect(project.assets).toEqual([]);
    expect(project.url).toBe("");
    await page.reload();
    await expect(page.locator("main.studio-tab")).toBeVisible();
    expect(creations).toBe(1);
  } finally {
    await request.delete(`/api/projects/${id}`);
  }
});

test("ElevenLabs settings save without returning the key and fit desktop/mobile", async ({
  page,
  request,
}) => {
  const key = "fixture-key-not-a-real-secret";
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const input = page.getByLabel(/^ElevenLabs API key/);
    await input.fill(key);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(input).toHaveValue("");
    expect(await (await request.get("/api/settings")).text()).not.toContain(
      key,
    );
    await page.screenshot({
      path: "/tmp/shortforge-settings-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(input).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "/tmp/shortforge-settings-mobile.png",
      fullPage: true,
    });
  } finally {
    await request.put("/api/settings", { data: { elevenlabs_api_key: "" } });
  }
});
