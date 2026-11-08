/**
 * D11 front-door fix 2 — Today tells a fresh note investor what to do first.
 *
 * "A home that does not tell a new user what to do first is not a home."
 * The CTA is the UI design's pinned form (§4.1), verbatim, with the real
 * action attached:
 *   - a fresh post-onboarding note investor (no acquired notes) is presented
 *     "Import your first tape" on the first screen of /today;
 *   - activating it — an in-app navigation, as a person would — lands in the
 *     real note-tape import (its file picker is on screen), not on a list
 *     page with a closed dialog;
 *   - once a note is on the book the CTA is gone;
 *   - a fresh land investor's Today is unchanged (no tape CTA).
 *
 * Each run is a brand-new tenant: the `e2e-persona-<slug>` session cookie
 * resolves to a stable, distinct user that auto-provisions its own org
 * (server/auth/testAuth.ts), and the onboarding wizard is walked through the
 * UI with "Set up data later" — no sample data, nothing imported. The single
 * acquired note for the past-first-value case is inserted into the throwaway
 * E2E database only; no import is completed with fabricated data.
 *
 * Env (see .github/workflows/e2e-mobile.yml): DATABASE_URL, E2E_TEST_AUTH=1.
 */
import { test, expect, type Page } from "@playwright/test";
import pg from "pg";

const PINNED_CTA = "Import your first tape";
const CTA = '[data-testid="button-first-value-cta"]';

async function freshTenant(page: Page, baseURL: string, slug: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: "__session", value: `e2e-persona-${slug}`, domain: hostname, path: "/" },
  ]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
      // The iOS "Add to Home Screen" sheet (pwa-install-prompt.tsx) is the
      // other first-visit prompt a person answers; it auto-opens after 4s on
      // iOS Safari and sits over the bottom of the screen until dismissed.
      localStorage.setItem("pwa-install-dismissed", String(Date.now()));
    } catch {
      /* storage unavailable — banner shows */
    }
  });
}

async function clickIfVisible(page: Page, selector: string, timeout = 4_000) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: "visible", timeout });
    await el.click();
    return true;
  } catch {
    return false;
  }
}

/** Walk onboarding-v2 the way a new customer does, choosing no data. */
async function onboard(page: Page, businessType: "note_investor" | "land_flipper") {
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  // The AI-disclosure dialog a brand-new user must acknowledge first.
  await clickIfVisible(page, 'button:has-text("Got it")', 10_000);
  if (!/onboarding/.test(page.url())) await page.goto("/onboarding-v2");
  const orgName = page.locator('[data-testid="input-org-name"]');
  await orgName.waitFor({ state: "visible", timeout: 20_000 });
  await orgName.fill(`E2E first value ${businessType}`);
  await page.locator(`[data-testid="option-${businessType}"]`).click();
  if (businessType === "note_investor") await clickIfVisible(page, '[data-testid^="option-noterole-"]', 2_000);
  await page.locator('[data-testid="button-continue-workspace"]').click();
  await page.getByRole("button", { name: "Set up data later" }).click();
  // The vertical's own finish (e.g. the note book). Not "Go to Today instead":
  // that button currently bounces a fresh user back to step 1 (reported in
  // docs/evidence/2026-11-03/p0-front-door/README.md, not fixed here).
  const finish = page.locator('[data-testid="button-finish-onboarding"]');
  await finish.waitFor({ state: "visible", timeout: 15_000 });
  await finish.click();
  // Let the wizard's own client-side navigation land before this test
  // navigates — a page.goto racing it is interrupted ("Navigation … is
  // interrupted by another navigation to /money").
  // The wizard can pass through more than one URL on the way (measured: a
  // goto issued on the first non-wizard URL was still interrupted by the
  // push to /money), so wait until the URL has held still for a second.
  let last = "";
  let stableSince = Date.now();
  await expect
    .poll(
      () => {
        const now = page.url();
        if (now !== last) {
          last = now;
          stableSince = Date.now();
        }
        return !new URL(now).pathname.startsWith("/onboarding") && Date.now() - stableSince >= 1_000;
      },
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true);
  await expect
    .poll(async () => (await page.request.get("/api/me/needs-onboarding")).json(), { timeout: 15_000 })
    .toMatchObject({ needsOnboarding: false });
}

async function ctaBox(page: Page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: (el as HTMLElement).innerText.trim(), inViewport: r.top >= 0 && r.bottom <= window.innerHeight };
  }, CTA);
}

test.describe("Today's first-value call to action", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!process.env.DATABASE_URL, "requires DATABASE_URL (CI service / local PG)");
    test.skip(testInfo.project.name !== "iphone-14", "runs once, at a phone and a desktop width");
  });

  for (const size of [null, { width: 1440, height: 900 }] as const) {
    const where = size ? `desktop ${size.width}` : "phone";

    test(`fresh note investor → "${PINNED_CTA}" opens the note-tape import; gone once a note is on the book (${where})`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(180_000);
      if (size) await page.setViewportSize(size);
      await freshTenant(page, baseURL!, `fv-note-${where.replace(/\W/g, "")}-${Date.now()}`);
      await onboard(page, "note_investor");

      await page.goto("/today", { waitUntil: "domcontentloaded" });
      const cta = page.locator(CTA);
      await cta.waitFor({ state: "visible", timeout: 20_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const box = await ctaBox(page);
      expect(box?.text, "the CTA is the design's pinned copy, verbatim").toBe(PINNED_CTA);
      expect(box?.inViewport, `the CTA is on the first screen (${JSON.stringify(box)})`).toBe(true);

      // Activate it as a person does — an in-app navigation, not a page load.
      await cta.click();
      // The in-app navigation's pushState runs inside a View Transition's
      // update callback (client/src/lib/view-transitions.ts), i.e. after the
      // old page is captured. On a loaded CI runner that took ~5.1 s at
      // desktop width (trace, PR #465 run 42341097494: click done 274.866 s,
      // URL still /today at 274.937 s, /notes?action=new at 279.954 s), past
      // expect's default 5 s. Same budget as the file-picker check below; the
      // assertion itself is unchanged: the URL must reach /notes.
      await expect(page).toHaveURL(/\/notes(\?|$)/, { timeout: 15_000 });
      await expect(
        page.locator('[data-testid="note-tape-file"]'),
        "the note-tape import (its file picker) is open after the in-app navigation",
      ).toBeVisible({ timeout: 15_000 });
      // …and stays open: on an in-app nav /notes mounts twice (outgoing and
      // incoming page-transition layers); the surviving instance must keep it.
      await page.waitForTimeout(1_500);
      await expect(page.locator('[data-testid="note-tape-file"]')).toBeVisible();

      // Past first value: one acquired note on this tenant's book.
      const orgId = await page.evaluate(async () => (await (await fetch("/api/organization")).json()).id as number);
      const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try {
        await db.query(
          `INSERT INTO acquired_notes
             (organization_id, note_number, original_principal_cents, current_balance_cents, interest_rate_bps,
              term_months, payment_amount_cents, payment_due_day, origination_date, maturity_date,
              acquisition_date, acquisition_price_cents, payer_name)
           VALUES ($1, 'E2E-FIRST-VALUE-1', 100000, 100000, 900, 60, 2000, 1, '2025-01-01', '2030-01-01',
                   '2026-01-01', 80000, 'E2E payer')`,
          [orgId],
        );
      } finally {
        await db.end();
      }
      await page.goto("/today", { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="text-today-title"]').waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(2_000);
      await expect(page.locator(CTA), "a user past first value is not presented the CTA").toHaveCount(0);
    });
  }

  test("fresh land investor — Today carries no tape CTA", async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await freshTenant(page, baseURL!, `fv-land-${Date.now()}`);
    await onboard(page, "land_flipper");
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="text-today-title"]').waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(2_000);
    await expect(page.locator(CTA)).toHaveCount(0);
  });
});
