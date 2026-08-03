/**
 * Task #254 — Accessibility (a11y) end-to-end audit.
 *
 * Runs automated WCAG 2.1 A/AA audits against the app's critical pages using
 * @axe-core/playwright and fails on critical/serious violations.
 *
 * NOTE: this layer requires a real browser + a running app, so it runs in CI
 * (via `npm run test:e2e`), not in the unit runner. The browser-free companion
 * guard lives in tests/unit/accessibility.test.ts.
 *
 *   Install dep (done centrally):  npm install --save-dev @axe-core/playwright
 *   Run:                           npx playwright test tests/e2e/accessibility.spec.ts
 *
 * @axe-core/playwright exposes the `AxeBuilder` default export — NOT the
 * `injectAxe`/`checkA11y` helpers (those belong to the unrelated `axe-playwright`
 * package). The earlier version of this file imported the wrong names and then
 * swallowed the failure in a try/catch, so the axe layer never actually ran.
 */

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Impacts we treat as build-breaking. */
const BLOCKING_IMPACTS = ["critical", "serious"] as const;

async function auditPage(page: Page, url: string, pageName: string) {
  await page.goto(url);

  // Pages behind auth redirect to /auth — audit whatever renders there instead
  // of failing on a login wall.
  await page.waitForLoadState("domcontentloaded");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  const blocking = results.violations.filter(
    (v) =>
      v.impact === "critical" ||
      v.impact === "serious",
  );

  const summary = blocking
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`,
    )
    .join("\n");

  expect(
    blocking,
    `${pageName} has ${blocking.length} ${BLOCKING_IMPACTS.join("/")} axe violation(s):\n${summary}`,
  ).toEqual([]);
}

// ─── Critical-page audits ───────────────────────────────────────────────────

const CRITICAL_PAGES: Array<{ url: string; name: string }> = [
  { url: "/auth", name: "Auth" },
  { url: "/", name: "Today" },
  { url: "/maps", name: "Map" },
  { url: "/deals", name: "Deals" },
  { url: "/finance", name: "Finance" },
  { url: "/pax", name: "Pax" },
  { url: "/inbox", name: "Inbox" },
  { url: "/settings", name: "Settings" },
];

test.describe("Accessibility Audit — Task #254", () => {
  for (const { url, name } of CRITICAL_PAGES) {
    test(`${name} (${url}) has no critical/serious a11y violations`, async ({
      page,
    }) => {
      await auditPage(page, url, name);
    });
  }
});

// ─── Structural WCAG checks that don't need axe ─────────────────────────────

test.describe("WCAG Structural Checks — Task #254", () => {
  test("a landmark (main or nav) is present on load", async ({ page }) => {
    await page.goto("/");
    const hasMain = (await page.locator("main, [role='main']").count()) > 0;
    const hasNav = (await page.locator("nav, [role='navigation']").count()) > 0;
    expect(hasMain || hasNav).toBe(true);
  });

  test("the document has a non-empty title", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toBe("undefined");
    expect(title).not.toBe("null");
  });

  test("every image has an alt attribute", async ({ page }) => {
    await page.goto("/");
    const imagesWithoutAlt = await page.evaluate(() =>
      Array.from(document.querySelectorAll("img")).filter(
        (img) => !img.hasAttribute("alt"),
      ).length,
    );
    // Decorative images may use alt="" — we only require the attribute exists.
    expect(imagesWithoutAlt).toBe(0);
  });
});
