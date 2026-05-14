/**
 * Rosy River — broken-interaction sweep.
 *
 * Visits every authenticated customer route + every founder route and
 * asserts:
 *   1. The route mounts without a thrown error (no error-boundary fallback)
 *   2. No console.error fired during mount
 *   3. The page emits at least one interactive element (heading / button /
 *      link), proving the shell rendered something
 *
 * Goal: catch the kind of regression where a single broken import or a
 * thrown selector in a card crashes a whole page silently. Each route is
 * its own test so failures land surgically — you see which page broke,
 * not "the sweep failed."
 *
 * Routes are intentionally hard-coded here rather than scraped from
 * App.tsx — the scrape would couple test-runtime to component-tree
 * traversal and pull in a hundred lazy chunks. The hand-curated list is
 * the surface area we actually care about catching regressions on.
 *
 *   npx playwright test tests/e2e/route-sweep.spec.ts
 *
 * To debug a single route:
 *
 *   npx playwright test tests/e2e/route-sweep.spec.ts --grep "today"
 */

import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

test.use({ storageState: "tests/e2e/.auth/user.json" });
test.setTimeout(60_000);

const CUSTOMER_ROUTES = [
  "/today",
  "/pipeline",
  "/money",
  "/leads",
  "/properties",
  "/deals",
  "/deals/discover",
  "/contractors",
  "/tenants",
  "/leases",
  "/permits",
  "/rehabs",
  "/tasks",
  "/maintenance",
  "/campaigns",
  "/buyer-blasts",
  "/team",
  "/automation",
  "/analytics",
  "/portfolio",
  "/cash-flow",
  "/bookkeeping",
  "/forecasting",
  "/avm",
  "/marketplace",
  "/vision-ai",
  "/negotiation",
  "/capital-markets",
  "/market-intelligence",
  "/decision-queue",
  "/inbox",
  "/account/security",
  "/settings",
] as const;

const FOUNDER_ROUTES = [
  "/founder",
  "/founder/ai-observatory",
  "/founder/financials",
  "/founder/compliance-ops",
  "/founder/features",
  "/founder/keys",
  "/founder/readiness",
  "/founder/customers/health",
  "/founder/growth/campaigns",
  "/founder/telemetry",
  "/founder/integrations",
  "/founder/ai-costs",
  "/founder/cost-optimizer",
  "/founder/unit-economics",
  "/founder/feedback",
  "/founder/agent-queue",
  "/founder/feed",
  "/founder/beta-analytics",
  "/founder/agents",
  "/founder/daily-digest",
  "/founder/decisions",
  "/founder/letter",
  "/founder/settings",
  "/founder/strategy",
  "/founder/trends",
  "/founder/expansion",
  "/founder/experiments",
  "/founder/providers",
  "/founder/todo",
] as const;

/**
 * Some routes legitimately log warnings on mount (Maps tile loads,
 * legitimate deprecation messages from third-party libs). The sweep
 * fails on ERROR-level only; we additionally allow-list known noisy
 * patterns that aren't real regressions.
 */
const CONSOLE_ALLOWLIST: RegExp[] = [
  // React DevTools download nag — fires on every page in dev.
  /Download the React DevTools/i,
  // Mapbox / MapLibre tile load warnings during fast nav.
  /Style is not done loading/i,
  // Clerk dev-instance frontend nag.
  /Clerk has been loaded with development keys/i,
  // 401s from optional integration endpoints (Stripe Connect, etc.) on
  // accounts that haven't connected them — not a regression.
  /Failed to load resource.*\/api\/integrations\//i,
  /Failed to load resource.*\/api\/stripe\/connect/i,
];

interface SweepResult {
  errors: string[];
  hasInteractive: boolean;
}

async function sweepRoute(page: Page, path: string): Promise<SweepResult> {
  const errors: string[] = [];

  const onConsole = (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (CONSOLE_ALLOWLIST.some((re) => re.test(text))) return;
    errors.push(text);
  };
  const onPageError = (err: Error) => {
    errors.push(`pageerror: ${err.message}`);
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    // networkidle is best-effort — some routes keep WS / polling open.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    // Give lazy-loaded chunks + framer-motion a beat to commit.
    await page.waitForTimeout(800);

    // Error-boundary fallback — any of these = regression.
    const errorBoundary = await page
      .locator('[data-testid="error-boundary"], [class*="error-boundary"], text=/something went wrong/i')
      .count();
    if (errorBoundary > 0) {
      errors.push(`error-boundary mounted on ${path}`);
    }

    // 404 / NotFound surfaces.
    const notFound = await page
      .locator('[data-testid="page-not-found"], text=/page not found/i, text=/404/i')
      .count();
    if (notFound > 0) {
      // Permitted on /founder/* if non-founder, but the test user is a founder.
      errors.push(`not-found surface on ${path}`);
    }

    const interactiveCount = await page
      .locator('h1, h2, [role="button"], button, [role="link"]:not([aria-hidden="true"])')
      .count();

    return { errors, hasInteractive: interactiveCount > 0 };
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
}

for (const path of CUSTOMER_ROUTES) {
  test(`sweep · customer ${path}`, async ({ page }) => {
    const r = await sweepRoute(page, path);
    expect(r.errors, `console / pageerror on ${path}:\n${r.errors.join("\n")}`).toEqual([]);
    expect(r.hasInteractive, `no interactive elements rendered on ${path}`).toBe(true);
  });
}

for (const path of FOUNDER_ROUTES) {
  test(`sweep · founder ${path}`, async ({ page }) => {
    const r = await sweepRoute(page, path);
    expect(r.errors, `console / pageerror on ${path}:\n${r.errors.join("\n")}`).toEqual([]);
    expect(r.hasInteractive, `no interactive elements rendered on ${path}`).toBe(true);
  });
}
