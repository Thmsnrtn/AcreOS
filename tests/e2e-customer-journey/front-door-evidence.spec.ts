/**
 * CJ4: front-door evidence on the deployed target (D11 / PR #460 close-out).
 *
 * #460's staging proof needs two things CJ1 cannot produce:
 *   1. the Pax composer on the FIRST SCREEN of /ai, as a signed-in user, with
 *      a screenshot. CJ1 asserts it, but its end-of-test screenshot is Today;
 *   2. a genuinely FRESH NOTE INVESTOR on /today shown "Import your first
 *      tape", which opens the real note-tape import. CJ1's user is a land
 *      persona that loads sample data, so it can never see that CTA. CJ1's
 *      own screenshot already shows the converse: a non-note user is not
 *      shown it.
 *
 * Each run attaches named screenshots
 * (`evidence-ai-first-sight`, `evidence-today-fresh-note-investor`,
 * `evidence-note-tape-import`), so every scheduled audit leaves a fresh,
 * signed-in record of the deployed build.
 *
 * Identity: one STABLE persona per project (`e2e-persona-cj4-fresh-note-<project>`).
 * The first run walks onboarding as a note investor choosing "Set up data
 * later"; later runs find it already onboarded. Nothing is ever imported. The
 * spec reaches the import and stops: it never completes one with fabricated
 * data. So the tenant stays fresh, and the deployed target holds exactly one
 * such tenant per project, not one per run.
 *
 * Scope: two projects (phone and desktop, light). That is enough for the
 * evidence and keeps the deployed target's tenant count at two.
 * Auth on a deployed target: the same X-E2E-Auth-Token route rule as CJ1
 * (server/auth/testAuth.ts; clerkAuth resolves the persona from __session).
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";

const EVIDENCE_PROJECTS = new Set(["mobile-iphone-12-light", "desktop-macbook-1440-light"]);
const COMPOSER = 'textarea[data-testid="input-message"]';
const CTA = '[data-testid="button-first-value-cta"]';
// Pinned by the UI design (§4.1) — a paraphrase here means the product copy drifted.
const PINNED_CTA = "Import your first tape";

async function seedPersona(page: Page, baseURL: string, slug: string) {
  const { hostname, origin } = new URL(baseURL);
  await page.context().addCookies([{ name: "__session", value: `e2e-persona-${slug}`, domain: hostname, path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
      localStorage.setItem("pwa-install-dismissed", String(Date.now()));
    } catch {
      /* storage unavailable — a first-visit prompt may then cover the page and the checks fail visibly */
    }
  });
  const token = process.env.E2E_TEST_AUTH_TOKEN;
  if (token) {
    await page.context().route(
      (url) => url.origin === origin,
      async (route) => route.continue({ headers: { ...route.request().headers(), "X-E2E-Auth-Token": token } }),
    );
  }
}

async function attachShot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
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

/** Onboard as a note investor with no data — only on this persona's first run. */
async function ensureOnboardedAsFreshNoteInvestor(page: Page) {
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await clickIfVisible(page, 'button:has-text("Got it")', 10_000);
  const needs = await (await page.request.get("/api/me/needs-onboarding")).json().catch(() => ({ needsOnboarding: true }));
  if (!needs?.needsOnboarding) return;
  if (!/onboarding/.test(page.url())) await page.goto("/onboarding-v2");
  const orgName = page.locator('[data-testid="input-org-name"]');
  await orgName.waitFor({ state: "visible", timeout: 20_000 });
  await orgName.fill("CJ4 fresh note investor");
  await page.locator('[data-testid="option-note_investor"]').click();
  await clickIfVisible(page, '[data-testid^="option-noterole-"]', 2_000);
  await page.locator('[data-testid="button-continue-workspace"]').click();
  await page.getByRole("button", { name: "Set up data later" }).click();
  await page.locator('[data-testid="button-finish-onboarding"]').click();
  await expect
    .poll(async () => (await page.request.get("/api/me/needs-onboarding")).json(), { timeout: 20_000 })
    .toMatchObject({ needsOnboarding: false });
}

test.describe("CJ4: front-door evidence (D11)", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!EVIDENCE_PROJECTS.has(testInfo.project.name), "evidence runs on one phone and one desktop project");
  });

  test("fresh note investor: Today's first-value CTA opens the tape import; /ai composer on the first screen", async ({
    page,
    baseURL,
  }, testInfo) => {
    await seedPersona(page, baseURL!, `cj4-fresh-note-${testInfo.project.name.replace(/[^a-z0-9]/g, "")}`);
    await ensureOnboardedAsFreshNoteInvestor(page);

    await test.step("/today: the pinned CTA is on the first screen", async () => {
      await page.goto("/today", { waitUntil: "domcontentloaded" });
      await page.locator('[data-testid="text-today-title"]').waitFor({ state: "visible", timeout: 30_000 });
      const book = await (await page.request.get("/api/notes/acquired?limit=1")).json().catch(() => null);
      expect(book?.total, `this evidence tenant must stay fresh (no acquired notes): ${JSON.stringify(book)}`).toBe(0);
      const cta = page.locator(CTA);
      await cta.waitFor({ state: "visible", timeout: 20_000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(cta).toHaveText(PINNED_CTA);
      const inView = await cta.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      });
      expect(inView, "the CTA is on the first screen").toBe(true);
      await attachShot(page, testInfo, "evidence-today-fresh-note-investor");
    });

    await test.step("activating it reaches the real note-tape import (not completed)", async () => {
      await page.locator(CTA).click();
      await expect(page).toHaveURL(/\/notes(\?|$)/);
      const picker = page.locator('[data-testid="note-tape-file"]');
      await expect(picker).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);
      await expect(picker, "the import stays open").toBeVisible();
      await attachShot(page, testInfo, "evidence-note-tape-import");
    });

    await test.step("/ai: the composer is on the first screen and takes input", async () => {
      await page.goto("/ai", { waitUntil: "domcontentloaded" });
      const composer = page.locator(COMPOSER);
      await composer.waitFor({ state: "attached", timeout: 30_000 });
      await page.waitForTimeout(1_500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      const sight = await composer.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          inViewport: r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight,
          topmost: !!hit && (hit === el || el.contains(hit)),
          top: Math.round(r.top),
          viewportHeight: window.innerHeight,
        };
      });
      expect(sight.inViewport && sight.topmost, `composer not on the first screen: ${JSON.stringify(sight)}`).toBe(true);
      await composer.fill("What changed this week?");
      await expect(composer).toHaveValue("What changed this week?");
      await attachShot(page, testInfo, "evidence-ai-first-sight");
      // Never sent: the evidence is the affordance, not a Pax turn.
      await composer.fill("");
    });
  });
});
