/**
 * Rosy River A2 — Visual regression snapshots.
 *
 * Captures Playwright `toHaveScreenshot()` baselines for the top-traffic
 * pages so any unintended visual regression (a Tailwind utility flip, a
 * font swap, a stray padding change) gets caught by the test suite
 * before reaching the founder.
 *
 * Pages covered: /today, /leads, /properties, /deals
 * Viewports: desktop (1280×720) only for v0. Mobile snapshots are
 * deferred until the desktop baselines are stable (snapshot diffs are
 * already noisy enough on one viewport).
 *
 * ── Baseline management ──────────────────────────────────────────────
 *
 * First run on a fresh checkout will write missing baselines and pass.
 * Subsequent runs DIFF against committed baselines and FAIL on any
 * pixel-level change above the configured threshold.
 *
 * When you intentionally change a page's visuals:
 *   npx playwright test tests/e2e/visual.spec.ts --update-snapshots
 *
 * That regenerates baselines locally; commit the updated PNGs alongside
 * the visual change. Reviewers compare old vs new in the PR.
 *
 * ── Mask strategy ────────────────────────────────────────────────────
 *
 * Pages with timestamps, counts, or freshly-fetched data create false-
 * positive diffs across runs. We `mask` the volatile selectors so the
 * snapshot rendering ignores them. Add to `VOLATILE_SELECTORS` whenever
 * a new diff source shows up.
 *
 * ── Cadence ──────────────────────────────────────────────────────────
 *
 * Run as part of the standard `playwright test` invocation. Suitable
 * for nightly CI; safe to opt out of PR runs by tagging the spec
 * `@visual` and gating with --grep in CI config.
 */

import { test, expect, type Page } from "@playwright/test";

test.use({
  storageState: "tests/e2e/.auth/user.json",
  viewport: { width: 1280, height: 720 },
});

// Page load + networkidle settle on production runs hot; the 30s default
// isn't enough for /leads + /properties which fan out 5-10 API calls on
// mount. 90s per test is comfortable.
test.setTimeout(90_000);

const VOLATILE_SELECTORS = [
  // Date / time pills — most pages render "5m ago" or "Mar 14" copy that
  // shifts every run.
  '[data-testid*="timestamp"]',
  'time',
  '.tabular-nums', // dollar amounts, counts
  // Notification + budget banner counts. The agent-queue header has a
  // weekly-spend banner; /today has live KPI tiles.
  '[data-testid="weekly-spend"]',
  '[data-testid="founder-greeting"]',
  // Random demo content seeded for new orgs varies per run.
  '[data-testid*="demo-"]',
];

async function settleForSnapshot(page: Page): Promise<void> {
  // Stop animations + transitions so a snapshot taken mid-spring doesn't
  // diff with a snapshot taken at rest.
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });
  // Wait for any data fetches to settle. networkidle is the cleanest
  // signal we have without per-page knowledge. Bounded so a slow API
  // doesn't blow the whole test budget.
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // Give framer-motion / lazy-loaded sections a beat to commit DOM.
  await page.waitForTimeout(500);
}

const PAGES: Array<{ path: string; name: string }> = [
  { path: "/today", name: "today" },
  { path: "/leads", name: "leads" },
  { path: "/properties", name: "properties" },
  { path: "/deals", name: "deals" },
];

for (const { path, name } of PAGES) {
  test(`visual · ${name}`, async ({ page }) => {
    await page.goto(path);
    await settleForSnapshot(page);

    const masks = VOLATILE_SELECTORS.map((s) => page.locator(s));

    // 0.2% pixel-diff tolerance — high enough to ride out anti-aliasing
    // and font-subpixel jitter across CI runs, low enough to catch any
    // real layout / color / typography regression.
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      mask: masks,
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
      // Full-page capture on heavy routes (/today, /leads) can run
      // 20-40s against production. The 5s default is too tight.
      timeout: 60_000,
    });
  });
}
