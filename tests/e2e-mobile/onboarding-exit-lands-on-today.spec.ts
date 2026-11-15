/**
 * A brand-new user who leaves onboarding for Today ends up on Today.
 *
 * Both exits the wizard offers on the way to Today:
 *   - "Go to Today instead" on the final step (onboarding-v2 completeMutation);
 *   - "Skip" in the header, available on every step (skipMutation).
 *
 * Measured on main 0abcce7 (2026-11-07): both went pushState /today →
 * pushState /onboarding-v2 and left the user on step 1 ("Your workspace, your
 * way."), every time. OnboardingGate read the cached
 * ["/api/me/needs-onboarding"] = true it held from the user's first visit
 * (60s staleTime); the un-awaited invalidate had not landed yet. CJ1 never
 * saw it because its next step is a page.goto('/today') — a full load.
 * Fixed by PR #473 (OnboardingGate + server completion ordering; its proof is
 * unit tests). This is the browser-level guard: 4/4 red on 0abcce7, 4/4 green
 * after #473 (docs/evidence/2026-11-07/onboarding-exit-bounce.md).
 *
 * So this spec does NOT navigate after the click. It asserts where the
 * click itself leaves the user, and that the app never pushed the wizard back.
 *
 * Each test is a brand-new tenant (`e2e-persona-<slug>` auto-provisions its
 * own org — server/auth/testAuth.ts). Env: E2E_TEST_AUTH=1.
 */
import { test, expect, type Page } from "@playwright/test";

async function freshTenant(page: Page, baseURL: string, slug: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([{ name: "__session", value: `e2e-persona-${slug}`, domain: hostname, path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
      localStorage.setItem("pwa-install-dismissed", String(Date.now()));
    } catch {
      /* storage unavailable */
    }
    // Record every client-side navigation the app makes.
    const w = window as unknown as { __navs: string[] };
    w.__navs = [];
    for (const k of ["pushState", "replaceState"] as const) {
      const orig = history[k].bind(history);
      history[k] = (data: unknown, unused: string, url?: string | URL | null) => {
        if (url != null) w.__navs.push(`${k} ${String(url)}`);
        return orig(data, unused, url);
      };
    }
  });
}

async function openWizard(page: Page) {
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  // The AI-disclosure dialog a brand-new user acknowledges first (its button
  // reads "Got it"; its accessible name is "Acknowledge the Pax disclosure…").
  const ack = page.locator('button:has-text("Got it")').first();
  await ack.waitFor({ state: "visible", timeout: 10_000 }).then(() => ack.click()).catch(() => {});
  if (!/onboarding/.test(page.url())) await page.goto("/onboarding-v2");
  await page.locator('[data-testid="input-org-name"]').waitFor({ state: "visible", timeout: 20_000 });
}

async function expectStaysOnToday(page: Page) {
  // Where the click leaves the user — no page.goto after it.
  await expect(page).toHaveURL(/\/today(\?|$)/, { timeout: 15_000 });
  await expect(page.locator('[data-testid="text-today-title"]')).toBeVisible({ timeout: 20_000 });
  // …and it holds: the gate does not bounce them back a beat later.
  await page.waitForTimeout(2_500);
  await expect(page).toHaveURL(/\/today(\?|$)/);
  await expect(page.locator('[data-testid="input-org-name"]')).toHaveCount(0);
  const navs = await page.evaluate(() => (window as unknown as { __navs: string[] }).__navs);
  expect(navs.filter((n) => /onboarding/.test(n)), `the app pushed the wizard back: ${JSON.stringify(navs)}`).toEqual([]);
}

test.describe("Leaving onboarding for Today lands on Today", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "iphone-14" && testInfo.project.name !== "pixel-5", "two engines are enough");
  });

  test('"Go to Today instead" on the final step', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await freshTenant(page, baseURL!, `exit-today-${testInfo.project.name}-${Date.now()}`);
    await openWizard(page);
    await page.locator('[data-testid="input-org-name"]').fill("E2E onboarding exit");
    await page.locator('[data-testid="option-land_flipper"]').click();
    await page.locator('[data-testid="button-continue-workspace"]').click();
    await page.getByRole("button", { name: "Set up data later" }).click();
    const goToday = page.locator('[data-testid="button-go-to-today"]');
    await goToday.waitFor({ state: "visible", timeout: 15_000 });
    await page.evaluate(() => {
      (window as unknown as { __navs: string[] }).__navs = [];
    });
    await goToday.click();
    await expectStaysOnToday(page);
  });

  test('"Skip" from the first step', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await freshTenant(page, baseURL!, `exit-skip-${testInfo.project.name}-${Date.now()}`);
    await openWizard(page);
    await page.evaluate(() => {
      (window as unknown as { __navs: string[] }).__navs = [];
    });
    await page.locator('[data-testid="button-skip-onboarding"]').click();
    await expectStaysOnToday(page);
  });
});
