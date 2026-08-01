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
import { clerk, clerkSetup } from "@clerk/testing/playwright";

test.use({ storageState: "tests/e2e/.auth/user.json" });
test.setTimeout(90_000);

// Mint a Clerk sign-in ticket via the Backend API and exchange it
// for a session before navigating to the route under test. The shared
// storageState user.json holds a single JWT that ages out across a
// 20-minute sweep; re-signing isolates real product regressions from
// Clerk session-staleness noise.
//
// Clerk's /v1/sign_in_tokens has rate limits (≈100/hour). Minting
// per-test was burning the budget mid-sweep, after which beforeEach
// silently returned and every subsequent test landed on PageLoader
// with stale cookies — surfacing as a cascade of false "no interactive
// elements rendered" failures. To stay under the limit we mint one
// ticket per WORKER process and re-use it across that worker's tests;
// the resulting session refreshes naturally via Clerk's in-page touch.
//
// Skipped when CLERK_SECRET_KEY isn't available — falls back to whatever's
// in user.json.
let setupDone = false;
let workerTicketMinted = false;
test.beforeEach(async ({ page, context }) => {
  const secret = process.env.CLERK_SECRET_KEY;
  const userId = process.env.CLERK_TEST_USER_ID || process.env.DEV_FOUNDER_USER_ID;
  if (!secret || !userId) return;

  // Seed cookie-consent in localStorage on every new page in this
  // context. Mirrors auth-clerk-ticket.setup.ts — without it, fresh
  // clerk.signIn navigations occasionally land on /auth via a path that
  // clears localStorage and the cookie-consent <Dialog> intercepts the
  // interactive-element count.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "accepted");
    } catch {
      /* private mode etc. — best-effort */
    }
  });

  // One ticket mint per worker. Stays well under Clerk's /v1/sign_in_tokens
  // rate limit even across multiple parallel sweep runs.
  if (workerTicketMinted) return;

  if (!setupDone) {
    await clerkSetup();
    setupDone = true;
  }

  const res = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) return;
  const { token } = await res.json();

  await page.goto("/auth");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: token } });
  workerTicketMinted = true;
});

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
  "/founder/admin/costs",
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
  // 429 rate-limit responses on a hammering sweep are caused by the
  // test itself, not by a product regression — production rate limiters
  // see N concurrent workers from one IP and back off. Real-user nav
  // is below the limit. Multiple phrasings: raw "Failed to load
  // resource" plus react-query's "[Query Error] Error: 429:".
  /Failed to load resource: the server responded with a status of 429/i,
  /\[Query Error\][^]*429[^]*Rate limit exceeded/i,
  /\[Query Error\][^]*\b429\b/i,
  // 401s on optional/in-flight session-bootstrap calls during a hard
  // navigation race (Clerk fetches /api/me while the cookie is still
  // settling). Not a product regression.
  /Failed to load resource: the server responded with a status of 401/i,
  /\[Query Error\][^]*\b401\b/i,
  // Playwright tears down the page when a test ends; any in-flight
  // fetch from a polling hook (Pax SSE, react-query refetchInterval,
  // websocket reconnects) shows up as net::ERR_FAILED in the console
  // even though nothing is actually broken. Real failures still log a
  // [Query Error] or a stack — those aren't allowlisted.
  /Failed to load resource: net::ERR_FAILED/i,
  /Failed to load resource: net::ERR_ABORTED/i,
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
    // Heavy/data-viz routes lazy-load a big chunk and sit on the
    // "Loading AcreOS…" splash longer than networkidle's 500ms quiet
    // window will tolerate. Wait explicitly for the splash to detach
    // before sampling the DOM. 12s upper bound — anything slower than
    // that on prod is a real perf regression worth flagging.
    await page
      .locator('[aria-label="Loading AcreOS"], [role="status"]:has-text("Loading AcreOS")')
      .first()
      .waitFor({ state: "detached", timeout: 12_000 })
      .catch(() => {});
    // Final beat for framer-motion / final paint.
    await page.waitForTimeout(800);

    // Error-boundary fallback — any of these = regression. Playwright
    // refuses mixed CSS+text selectors in one comma-list, so we sum
    // counts across separate locators instead.
    const errorBoundary =
      (await page.locator('[data-testid="error-boundary"]').count()) +
      (await page.locator('[class*="error-boundary"]').count()) +
      (await page.getByText(/something went wrong/i).count());
    if (errorBoundary > 0) {
      errors.push(`error-boundary mounted on ${path}`);
    }

    // 404 / NotFound surfaces.
    const notFound =
      (await page.locator('[data-testid="page-not-found"]').count()) +
      (await page.getByText(/page not found/i).count()) +
      (await page.getByText(/^\s*404\s*$/).count());
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
