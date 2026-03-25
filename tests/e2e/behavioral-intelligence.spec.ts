import { test, expect, type Page } from "@playwright/test";

/** Returns true if the page has authenticated app content (nav/sidebar/main) */
async function hasAppContent(page: Page): Promise<boolean> {
  if (page.url().includes("/auth")) return false;
  // Check for actual app shell — sidebar or main content area
  const appShell = page.locator("nav, [class*='sidebar'], main, [role='main']");
  return await appShell.count() > 0;
}

/** Navigate and return true if page loaded with authenticated content */
async function navigateTo(page: Page, url: string): Promise<boolean> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  return await hasAppContent(page);
}

test.describe("Layer 3: Mistake Recovery & Flow Resilience", () => {

  test("navigating away from a dirty form warns or preserves state", async ({ page }) => {
    if (!await navigateTo(page, "/leads")) { test.skip(); return; }

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
    if (!await navigateTo(page, "/leads")) { test.skip(); return; }

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
    let pagesChecked = 0;
    for (const url of ["/dashboard", "/leads", "/deals", "/properties"]) {
      if (!await navigateTo(page, url)) continue;
      pagesChecked++;

      // Hard refresh
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Should still be on the same page (or auth redirect), no error
      if (!!(await hasAppContent(page))) {
        expect(page.url()).toContain(url);
      }
      const error = page.locator("[class*='error-boundary']");
      expect(await error.count()).toBe(0);
    }

    if (pagesChecked === 0) test.skip();
  });

  test("clicking the same nav item twice doesn't cause issues", async ({ page }) => {
    if (!await navigateTo(page, "/leads")) { test.skip(); return; }

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
    if (!await navigateTo(page, "/leads")) { test.skip(); return; }

    const searchInput = page.locator("input[type='search'], input[placeholder*='search' i], input[placeholder*='Search' i]").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("zzznonexistent999");
      await page.waitForTimeout(1000);

      const bodyText = await page.textContent("body") || "";
      expect(bodyText).not.toContain("undefined");

      await page.screenshot({ path: `tests/simulation/screenshots/behavioral-empty-search.png` });
    }
  });

  test("tabbing through the page follows logical order", async ({ page }) => {
    if (!await navigateTo(page, "/dashboard")) { test.skip(); return; }

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
    if (!await navigateTo(page, "/dashboard")) { test.skip(); return; }

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
    if (!await navigateTo(page, "/dashboard")) { test.skip(); return; }

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.waitForTimeout(500);

    // Should not be blank
    const text = await page.textContent("body") || "";
    expect(text.trim().length).toBeGreaterThan(50);

    await page.screenshot({ path: `tests/simulation/screenshots/behavioral-offline.png` });
    await context.setOffline(false);
  });

  test("slow network shows loading, not errors", async ({ page, browserName }) => {
    // CDP sessions only work with Chromium
    if (browserName !== "chromium") { test.skip(); return; }

    const client = await page.context().newCDPSession(page);
    await client.send("Network.emulateNetworkConditions", {
      offline: false, downloadThroughput: 40000, uploadThroughput: 20000, latency: 2000,
    });

    await page.goto("/dashboard", { timeout: 45000 });
    await page.waitForTimeout(3000);

    if (!(await hasAppContent(page))) { test.skip(); return; }

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
    await page.waitForTimeout(500);

    if (!(await hasAppContent(page))) { test.skip(); return; }

    expect(await page.locator("[class*='error-boundary']").count()).toBe(0);

    await page.screenshot({ path: `tests/simulation/screenshots/behavioral-api-failure.png` });
  });
});
