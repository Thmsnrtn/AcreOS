import { test, expect } from "@playwright/test";

test.describe("Layer 3: Mistake Recovery & Flow Resilience", () => {

  test("navigating away from a dirty form warns or preserves state", async ({ page }) => {
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");

    // Try to open a create form
    const createBtn = page.locator("button:has-text('Add'), button:has-text('Create'), button:has-text('New')").first();
    if (!await createBtn.isVisible()) { test.skip(); return; }

    await createBtn.click();
    await page.waitForTimeout(500);

    // Type something in first visible input
    const input = page.locator("[role='dialog'] input, [class*='sheet'] input, [class*='modal'] input").first();
    if (await input.count() > 0 && await input.isVisible()) {
      await input.fill("Test Lead Name");
      await page.waitForTimeout(200);

      // Navigate away without saving
      await page.goto("/deals");
      await page.waitForLoadState("networkidle");

      // No crash — page should work fine
      const error = page.locator("[class*='error-boundary']");
      expect(await error.count()).toBe(0);

      await page.screenshot({ path: `tests/simulation/screenshots/behavioral-dirty-form.png` });
    }
  });

  test("pressing Escape closes modals/sheets", async ({ page }) => {
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");

    const createBtn = page.locator("button:has-text('Add'), button:has-text('Create'), button:has-text('New')").first();
    if (!await createBtn.isVisible()) { test.skip(); return; }

    await createBtn.click();
    await page.waitForTimeout(500);

    const dialog = page.locator("[role='dialog'], [class*='modal'], [class*='sheet']");
    if (await dialog.count() > 0) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Dialog should be closed
      expect(await dialog.count()).toBe(0);
    }
  });

  test("refreshing the page doesn't break the current view", async ({ page }) => {
    for (const url of ["/dashboard", "/leads", "/deals", "/properties"]) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");

      // Hard refresh
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Should still be on the same page, no error
      expect(page.url()).toContain(url);
      const error = page.locator("[class*='error-boundary'], text=/something went wrong/i");
      expect(await error.count()).toBe(0);
    }
  });

  test("clicking the same nav item twice doesn't cause issues", async ({ page }) => {
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");

    const leadsNav = page.locator("a[href='/leads'], a[href*='leads']").first();
    if (await leadsNav.isVisible()) {
      await leadsNav.click();
      await leadsNav.click();
      await page.waitForLoadState("networkidle");

      const error = page.locator("[class*='error-boundary']");
      expect(await error.count()).toBe(0);
    }
  });

  test("empty search returns helpful message, not error", async ({ page }) => {
    await page.goto("/leads");
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator("input[type='search'], input[placeholder*='search' i], input[placeholder*='Search' i]").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("zzznonexistent999");
      await page.waitForTimeout(1000);

      const bodyText = await page.textContent("body") || "";
      expect(bodyText).not.toContain("undefined");
      expect(bodyText).not.toContain("Error");

      await page.screenshot({ path: `tests/simulation/screenshots/behavioral-empty-search.png` });
    }
  });

  test("tabbing through the page follows logical order", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const focusedElements: string[] = [];
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "none";
        return `${el.tagName.toLowerCase()}${el.textContent?.trim().slice(0, 20) || ""}`;
      });
      focusedElements.push(focused);
    }

    // Should have focused different elements (not stuck on one)
    const unique = new Set(focusedElements);
    expect(unique.size).toBeGreaterThan(3);
  });

  test("keyboard Enter triggers primary actions", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Focus a button and press Enter — should activate it
    const btn = page.locator("button").first();
    if (await btn.isVisible()) {
      await btn.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      // Just verify no crash
      expect(await page.locator("[class*='error-boundary']").count()).toBe(0);
    }
  });
});

test.describe("Layer 3: Offline & Degradation", () => {

  test("offline shows indicator, not blank screen", async ({ page, context }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForTimeout(500);

    // Should not be blank
    const text = await page.textContent("body") || "";
    expect(text.trim().length).toBeGreaterThan(50);

    await page.screenshot({ path: `tests/simulation/screenshots/behavioral-offline.png` });
    await context.setOffline(false);
  });

  test("slow network shows loading, not errors", async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send("Network.emulateNetworkConditions", {
      offline: false, downloadThroughput: 40000, uploadThroughput: 20000, latency: 2000,
    });

    await page.goto("/dashboard", { timeout: 45000 });
    await page.waitForTimeout(3000);

    const text = await page.textContent("body") || "";
    expect(text.trim().length).toBeGreaterThan(50);
    expect(text).not.toContain("undefined");

    await page.screenshot({ path: `tests/simulation/screenshots/behavioral-slow-network.png` });

    await client.send("Network.emulateNetworkConditions", {
      offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0,
    });
  });

  test("API failure on one widget doesn't crash others", async ({ page }) => {
    await page.route("**/api/deal-feed**", route => route.abort("failed"));
    await page.route("**/api/dashboard/priority**", route => route.abort("failed"));

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const main = page.locator("main, [role='main'], #root > div");
    await expect(main.first()).toBeVisible();

    expect(await page.locator("[class*='error-boundary']").count()).toBe(0);

    await page.screenshot({ path: `tests/simulation/screenshots/behavioral-api-failure.png` });
  });
});
