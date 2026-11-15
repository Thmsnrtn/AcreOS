/**
 * D11 front-door fix 1 — the Pax composer is on the FIRST SCREEN of /ai.
 *
 * "A Pax you cannot find is not a Pax" (UI design §0). The customer-journey
 * audit's composer step asks Playwright's `isVisible()`, which is true for an
 * element that has a box ANYWHERE in the document. Step 0 (2026-11-03)
 * measured the composer's top at 1,758px on a 844px phone, 1,622px on a
 * 1,180px tablet and 1,316px on a 900px desktop — "visible" to that check,
 * below the fold for a person, on every viewport and theme.
 *
 * This spec asserts what a person needs instead, with no interaction first —
 * no scroll, no menu, no hover, no gesture:
 *   - the composer's whole box is inside the viewport, both at the scroll
 *     position the page settles on by itself and with the page scrolled to
 *     the very top;
 *   - nothing is painted over it (elementFromPoint at its centre is the
 *     composer — a fixed bar or banner on top of it fails);
 *   - it is not display:none / visibility:hidden;
 *   - it accepts typing;
 *   - its placeholder is the design's own words (UI design §3.1), verbatim.
 *
 * Runs on every project in playwright.mobile.config.ts (iPhone SE 320×568 is
 * the smallest screen a customer can bring; iPad mini is the tablet), and on
 * two desktop widths, in light and dark. The cookie banner is answered first,
 * as a first-time visitor must (CJ1 does the same on the landing).
 *
 * Env (see .github/workflows/e2e-mobile.yml): E2E_TEST_AUTH=1, seeded customer.
 */
import { test, expect, type Page } from "@playwright/test";

const COMPOSER = 'textarea[data-testid="input-message"]';
// Pinned by the UI design (§3.1). A paraphrase here means the product copy drifted.
const PINNED_PLACEHOLDER = "Ask about a note, a parcel, or what changed this week";

async function asSeededCustomer(page: Page, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([{ name: "__session", value: "e2e", domain: hostname, path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
      // The iOS "Add to Home Screen" sheet (pwa-install-prompt.tsx) is the
      // other first-visit prompt a person answers; it auto-opens after 4s on
      // iOS Safari and sits over the bottom of the screen until dismissed.
      localStorage.setItem("pwa-install-dismissed", String(Date.now()));
    } catch {
      /* storage unavailable — the banner shows and the overlap check fails visibly */
    }
  });
}

interface FirstSight {
  inViewport: boolean;
  topmost: boolean;
  shown: boolean;
  top: number;
  bottom: number;
  viewportHeight: number;
  scrollY: number;
  hit: string | null;
}

async function measure(page: Page): Promise<FirstSight | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLTextAreaElement>(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      inViewport: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight,
      topmost: !!hit && (hit === el || el.contains(hit)),
      shown: cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      viewportHeight: window.innerHeight,
      scrollY: Math.round(window.scrollY),
      hit: hit ? hit.getAttribute("data-testid") ?? hit.tagName : null,
    };
  }, COMPOSER);
}

async function assertFirstSight(page: Page, where: string) {
  await page.goto("/ai", { waitUntil: "domcontentloaded" });
  const composer = page.locator(COMPOSER);
  await composer.waitFor({ state: "attached", timeout: 20_000 });
  // Let the page settle (lazy chat chunk, health probe, its own scroll-to-latest).
  await page.waitForTimeout(1_500);

  const settled = await measure(page);
  expect(settled, `${where}: composer not rendered on /ai`).not.toBeNull();
  expect(settled!.shown, `${where}: composer hidden (${JSON.stringify(settled)})`).toBe(true);
  expect(settled!.inViewport, `${where}: composer outside the first screen (${JSON.stringify(settled)})`).toBe(true);
  expect(settled!.topmost, `${where}: something is painted over the composer (${JSON.stringify(settled)})`).toBe(true);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const atTop = await measure(page);
  expect(atTop!.inViewport, `${where}: composer outside the first screen at scrollY=0 (${JSON.stringify(atTop)})`).toBe(true);
  expect(atTop!.topmost, `${where}: composer covered at scrollY=0 (${JSON.stringify(atTop)})`).toBe(true);

  await expect(composer).toHaveAttribute("placeholder", PINNED_PLACEHOLDER);
  // It takes input where it stands — no prerequisite interaction.
  await composer.fill("hello");
  await expect(composer).toHaveValue("hello");
  await composer.fill("");
}

test.describe("Pax composer is on the first screen of /ai", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`at this project's own viewport — ${colorScheme}`, async ({ page, baseURL }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      await asSeededCustomer(page, baseURL!);
      await assertFirstSight(page, `${testInfo.project.name}/${colorScheme}`);
    });
  }

  for (const size of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    test(`at desktop ${size.width}×${size.height}`, async ({ page, baseURL }, testInfo) => {
      // Desktop widths need running once, not once per phone project.
      test.skip(testInfo.project.name !== "iphone-14", "desktop widths run on one project");
      for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize(size);
        await page.emulateMedia({ colorScheme });
        await asSeededCustomer(page, baseURL!);
        await assertFirstSight(page, `desktop-${size.width}/${colorScheme}`);
      }
    });
  }
});
