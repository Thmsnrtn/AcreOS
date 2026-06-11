/**
 * Mobile navigation smoke test.
 *
 * Walks the customer mobile surface at a phone viewport and asserts every
 * screen actually renders — the regression class that prompted this suite
 * (mobile navigation "felt broken / lost functionality" after large agent
 * refactors). Authentication is handled by the server test-auth bypass
 * (server/auth/testAuth.ts, gated on E2E_TEST_AUTH); the spec only needs to
 * present a `__session` cookie so the client's `hasAnyClerkSession()` gate
 * enables the authenticated user query.
 *
 * For each route we assert:
 *   - it does NOT redirect back to /auth (i.e. auth resolved),
 *   - the React root rendered meaningful content (not a blank shell),
 *   - no error-boundary fallback text is visible,
 *   - no uncaught page error was thrown.
 */
import { test, expect, type Page } from "@playwright/test";

// Core customer-facing routes. Bottom-nav targets first, then the primary
// CRUD surfaces reachable from the "More" drawer.
// NOTE: /settings is intentionally excluded — it renders Clerk's <UserProfile>
// which requires ClerkProvider, and ClerkProvider is skipped in E2E test mode
// (its dev-instance handshake can't complete in CI). Settings is a Clerk
// account surface, not core navigation.
const ROUTES = [
  "/today",
  "/deals",
  "/money",
  "/ai",
  "/leads",
  "/properties",
  "/campaigns",
  "/pipeline",
  "/portfolio",
  "/inbox",
];

// Per-route content the page MUST surface from the seeded data (see
// tests/e2e-mobile/global-setup.ts). Proves the page renders real records,
// not just a non-blank shell. Any one of the alternatives is acceptable
// (pages may summarize vs. list).
const EXPECTED_CONTENT: Record<string, string[]> = {
  "/leads": ["Hollowell", "Trujillo", "Vanterpool", "Marina"],
  "/properties": ["Maricopa", "Buckeye", "E2E-APN-7781", "Presidio"],
};

// Client-side noise that is not an app bug (e.g. Clerk-JS is intentionally
// blocked in test mode so it fails to load — see testAuth.ts).
const IGNORED_PAGE_ERRORS = [
  /Clerk/i,
  /clerk\.browser\.js/i,
  /failed to load/i,
  /ResizeObserver/i,
];

async function seedSessionCookie(page: Page, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: "__session", value: "e2e", domain: hostname, path: "/" },
  ]);
}

test.describe("mobile navigation smoke", () => {
  for (const route of ROUTES) {
    test(`renders ${route}`, async ({ page, baseURL }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on("pageerror", (e) => {
        const msg = e.message || String(e);
        if (!IGNORED_PAGE_ERRORS.some((re) => re.test(msg))) pageErrors.push(msg);
      });
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });

      await seedSessionCookie(page, baseURL!);
      await page.goto(route, { waitUntil: "domcontentloaded" });

      // The app boots, resolves auth via the API, then renders. Wait for the
      // React root to have real content rather than the empty shell. On
      // failure, dump diagnostics so CI tells us *why* it stayed blank.
      try {
        await expect
          .poll(
            async () =>
              page.evaluate(
                () => (document.getElementById("root")?.innerText || "").trim().length,
              ),
            { timeout: 60000 },
          )
          .toBeGreaterThan(20);
      } catch {
        const diag = await page.evaluate(() => ({
          url: location.href,
          cookie: document.cookie,
          rootHtml: (document.getElementById("root")?.innerHTML || "").slice(0, 400),
          bodyText: (document.body?.innerText || "").slice(0, 200),
        }));
        throw new Error(
          `#root never rendered for ${route}\n` +
            `  final url: ${diag.url}\n` +
            `  cookie: ${diag.cookie}\n` +
            `  console errors: ${consoleErrors.slice(0, 6).join(" || ")}\n` +
            `  page errors: ${pageErrors.slice(0, 6).join(" || ")}\n` +
            `  root html: ${diag.rootHtml}\n` +
            `  body text: ${diag.bodyText}`,
        );
      }

      // Auth must have resolved — we should not be bounced to the sign-in page.
      expect(page.url(), `${route} redirected to /auth`).not.toMatch(/\/auth(\b|$)/);

      // No visible error-boundary fallback.
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body, `${route} shows an error fallback`).not.toMatch(
        /something went wrong|unexpected error|couldn'?t load/,
      );

      // No uncaught runtime errors (Clerk noise filtered above).
      expect(pageErrors, `${route} threw: ${pageErrors.join(" | ")}`).toEqual([]);

      // If this route shows seeded records, confirm the real data rendered.
      const expected = EXPECTED_CONTENT[route];
      if (expected) {
        try {
          await expect
            .poll(
              async () => {
                const txt = await page.locator("body").innerText();
                return expected.some((s) => txt.includes(s));
              },
              { timeout: 60000 },
            )
            .toBe(true);
        } catch {
          // Distinguish "page logic dropped the data" from "API returned none"
          // by fetching the same endpoint from inside the page.
          const apiCount = await page
            .evaluate(async () => {
              try {
                const r = await fetch("/api/leads?page=1&pageSize=100", { credentials: "include" });
                const j = await r.json();
                const arr = Array.isArray(j) ? j : j?.data;
                return Array.isArray(arr) ? arr.length : `shape:${JSON.stringify(j).slice(0, 80)}`;
              } catch (e) {
                return `fetch-err:${(e as Error).message}`;
              }
            })
            .catch(() => "evaluate-failed");
          const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
          throw new Error(
            `${route} never showed seeded records (expected one of: ${expected.join(", ")}).\n` +
              `  in-page /api/leads count: ${apiCount}\n` +
              `  body: ${body}`,
          );
        }
      }
    });
  }

  test("primary nav is present and every tab navigates", async ({ page, baseURL }) => {
    await seedSessionCookie(page, baseURL!);
    await page.goto("/today", { waitUntil: "domcontentloaded" });

    // Arm-aware: the app's MOBILE_BREAKPOINT is 768 — STRICTLY below it the
    // bottom nav renders; at >= 768 (Playwright's iPad Mini descriptor is
    // exactly 768x1024) the desktop sidebar is the primary nav BY DESIGN.
    // Asserting the bottom nav on ipad-mini was a wrong test premise, not an
    // app bug. Both arms must expose the five doors and navigate.
    const viewportWidth = page.viewportSize()?.width ?? 0;
    const nav =
      viewportWidth < 768
        ? page.locator('[data-testid="mobile-bottom-nav"]')
        : page.locator('nav[aria-label="Main navigation"]');
    await expect(
      nav,
      `primary nav did not render (expected ${viewportWidth < 768 ? "mobile bottom nav" : "desktop sidebar nav"} at ${viewportWidth}px)`,
    ).toBeVisible({ timeout: 60000 });

    // :visible — the desktop sidebar nests child links inside collapsed
    // modules; clicking a hidden anchor would burn the action timeout.
    const hrefs = (await nav.locator("a:visible").evaluateAll((els) =>
      els.map((e) => e.getAttribute("href")).filter((h): h is string => !!h),
    ));
    expect(hrefs.length, "primary nav has no tabs").toBeGreaterThanOrEqual(3);

    // Each tab navigates (client-side route change), not bounced to /auth.
    // Render correctness per destination is covered by the per-route tests
    // above, so here we only assert navigation — keeps this lightweight on
    // slow CI runners where deep per-tab render-polling overruns the budget.
    for (const href of hrefs) {
      await nav.locator(`a[href="${href}"]:visible`).first().click();
      await expect(page).toHaveURL(new RegExp(`${href}(\\b|/|\\?|$)`), { timeout: 15000 });
      expect(page.url(), `tab ${href} bounced to /auth`).not.toMatch(/\/auth(\b|$)/);
    }
  });
});
