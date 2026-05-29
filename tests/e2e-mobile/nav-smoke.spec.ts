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
            { timeout: 35000 },
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
    });
  }

  test("bottom nav is present and every tab navigates", async ({ page, baseURL }) => {
    await seedSessionCookie(page, baseURL!);
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    const nav = page.locator('[data-testid="mobile-bottom-nav"]');
    await expect(nav, "mobile bottom nav did not render").toBeVisible({ timeout: 35000 });

    const links = await nav.locator("a").all();
    expect(links.length, "bottom nav has no tabs").toBeGreaterThanOrEqual(3);

    for (const link of links) {
      const href = await link.getAttribute("href");
      if (!href) continue;
      await link.click();
      await expect
        .poll(
          async () =>
            page.evaluate(
              () => (document.getElementById("root")?.innerText || "").trim().length,
            ),
          { timeout: 25000, message: `tab ${href} rendered blank` },
        )
        .toBeGreaterThan(20);
      expect(page.url(), `tab ${href} bounced to /auth`).not.toMatch(/\/auth(\b|$)/);
    }
  });
});
