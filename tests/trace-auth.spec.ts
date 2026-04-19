import { test } from "@playwright/test";

test("trace Google OAuth flow", async ({ browser }) => {
  test.setTimeout(60000);
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors: string[] = [];

  page.on("response", res => {
    const url = res.url();
    if (res.status() >= 400 && (url.includes("clerk") || url.includes("__clerk"))) {
      errors.push(`${res.status()} ${url.substring(0, 200)}`);
    }
  });

  page.on("console", msg => {
    if (msg.type() === "error") {
      errors.push(`CONSOLE: ${msg.text().substring(0, 300)}`);
    }
  });

  console.log("Loading auth page...");
  await page.goto("https://acreos.io/auth");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tests/trace-auth-1.png" });

  const content = await page.content();
  console.log("Has Clerk form:", content.includes("cl-") || content.includes("clerk"));
  console.log("Has Cloudflare error:", content.includes("prohibited") || content.includes("Error 1000"));
  console.log("Has spinner only:", !content.includes("cl-") && content.includes("animate-spin"));

  // Check for Google button
  const googleBtn = page.locator("button:has-text('Google')").first();
  console.log("Google button visible:", await googleBtn.isVisible().catch(() => false));

  console.log("\nErrors captured:");
  errors.forEach(e => console.log("  ", e));

  await context.close();
});
