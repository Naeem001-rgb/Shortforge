import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

const root = path.resolve(import.meta.dirname, "../..");
const screenshots = path.join(root, ".impeccable/review/youtube-callback");
const callbackUrl = "http://127.0.0.1:8788/api/youtube/oauth/callback";
function render(
  result: string,
  theme: string,
  returnTo: string,
  channel = "Everyday Stories",
) {
  const messages: Record<string, string> = {
    success:
      "Review your channel in Settings, then choose a video to publish or schedule.",
    cancelled:
      "YouTube connection was cancelled or denied. No new channel was connected.",
    expired:
      "This connection request is invalid or expired. Start again in Settings.",
    error:
      "Both YouTube upload and channel read permissions are required. Reconnect and allow both permissions.",
  };
  return JSON.parse(
    execFileSync(
      path.join(root, ".venv/bin/python"),
      [
        "-c",
        `
import json, sys
from engine.core.youtube_auth import _callback_page
options = json.loads(sys.stdin.read())
response = _callback_page(**options)
print(json.dumps({"body": response.body.decode(), "headers": dict(response.headers), "status": response.status_code}))
`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        input: JSON.stringify({
          message: messages[result],
          result,
          theme,
          return_to: returnTo,
          channel_title: channel,
          status_code: result === "success" ? 200 : 400,
        }),
        env: {
          ...process.env,
          SHORTFORGE_DATA_DIR: process.env.SHORTFORGE_TEST_DATA_DIR!,
          SHORTFORGE_DASHBOARD_ORIGINS: returnTo.split("/?")[0],
        },
      },
    ),
  );
}

test("production callback is themed, private and returns to YouTube settings", async ({
  page,
  baseURL,
}) => {
  mkdirSync(screenshots, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      /content security policy|Refused to load|Refused to execute/i.test(
        message.text(),
      )
    )
      errors.push(message.text());
  });
  let result = "success";
  let theme = "light";
  let channel = "Everyday Stories";
  await page.route(callbackUrl + "**", (route) =>
    route.fulfill(
      render(result, theme, baseURL + "/?settings=youtube", channel),
    ),
  );
  for (const variant of [
    { name: "desktop-light", width: 1440, height: 1000, theme: "light" },
    { name: "desktop-dark", width: 1440, height: 1000, theme: "dark" },
    { name: "mobile-dark", width: 390, height: 844, theme: "dark" },
    { name: "user-1021", width: 1021, height: 760, theme: "dark" },
  ]) {
    theme = variant.theme;
    await page.setViewportSize({
      width: variant.width,
      height: variant.height,
    });
    await page.goto(callbackUrl + "?state=fixture-state&code=fixture-code");
    await expect(
      page.getByRole("heading", { name: "YouTube is connected." }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page).toHaveURL(callbackUrl);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(screenshots, variant.name + ".png"),
      fullPage: true,
    });
  }
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Back to Settings" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "YouTube publishing", exact: true }),
  ).toBeVisible();

  for (const [state, heading] of [
    ["cancelled", "Connection cancelled."],
    ["expired", "This link has expired."],
    ["error", "Let’s try that again."],
  ]) {
    result = state;
    await page.goto(callbackUrl + "?state=fixture-state");
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator(".oauth-channel")).toBeHidden();
    await page.screenshot({
      path: path.join(screenshots, state + ".png"),
      fullPage: true,
    });
  }
  result = "success";
  channel = "My channel <script>alert(1)</script> " + "A".repeat(160);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(callbackUrl);
  await expect(page.locator(".oauth-channel-copy strong")).toHaveText(channel);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".oauth-return svg")
      .evaluate((element) =>
        parseFloat(getComputedStyle(element).transitionDuration),
      ),
  ).toBeLessThanOrEqual(0.0001);
  expect(errors).toEqual([]);
});
