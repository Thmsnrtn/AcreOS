import { defineConfig, devices } from "@playwright/test";

/**
 * KRIEGER — Customer-Journey synthetic monitor config.
 *
 * Phase D2: dedicated Playwright config for the end-to-end customer
 * journey — fresh-signup → onboarding → first-value. 9 device projects ×
 * 2 themes (light + dark) = 18 effective runs per execution.
 *
 * Matrix shape:
 *   Mobile (5):  iPhone SE (375x667), iPhone 12 (390x844),
 *                iPhone 14 Pro Max (430x932), Pixel 5 (393x851),
 *                Galaxy S20 (360x800)
 *   Desktop (4): 1280x800 (laptop), 1440x900 (MacBook),
 *                1920x1080 (24"), 2560x1440 (27")
 *
 * Theme matrix:
 *   Each project × {light, dark}. Project names are suffixed `-light` /
 *   `-dark` so a single coordinate in the report names a single failure
 *   (no "which theme failed?" guessing).
 *
 * Base URL:
 *   Defaults to http://localhost:5000 for documentation parity with the
 *   other configs. The CI runner sets PLAYWRIGHT_BASE_URL / TARGET_URL to a
 *   deployed surface, where the E2E_TEST_AUTH bypass is gated by an HTTP
 *   header — which is what makes a SIGNED-OUT landing page reachable there.
 *
 * ── RUNNING THIS LOCALLY: read this first ─────────────────────────────────
 * Two things this header used to say or imply are wrong, both measured
 * 2026-09-05 by running it.
 *
 * 1. It said "the local Claude sandbox CANNOT drive a browser (loopback
 *    blocked)". It can. The desktop-feel matrix ran 350 contracts against
 *    http://localhost:5000 the same afternoon. A limitation nobody re-measures
 *    is indistinguishable from one that does not exist, and this one had
 *    outlived whatever made it true.
 *
 * 2. `npx playwright test --config=…` against a LOCAL server with
 *    E2E_TEST_AUTH=1 cannot pass, and not for a product reason. That flag makes
 *    `isAuthenticated` inject `resolveTestUserId(req.headers.cookie)` on EVERY
 *    request (server/auth/clerkAuth.ts), defaulting to the seeded customer when
 *    no cookie is present — so `/` redirects to `/today` and there is no
 *    landing page at all. CJ1 opens on the signed-out landing CTA. Measured:
 *    36 failed / 18 skipped, of which 18 are `landing primary CTA missing` for
 *    exactly this reason, and the remainder are downstream of the same
 *    unrepresentative auth state.
 *
 *    So a local run of THIS suite needs a signed-out mode — the bypass gated on
 *    the `x-e2e-test-auth` header locally as it is on a deployed target, rather
 *    than on the env flag alone. That is an auth change and belongs in its own
 *    piece of work; until it exists, a green or red result from a local run of
 *    this config says nothing about the customer journey.
 *
 *    The feel suites are unaffected: they assert viewport and styling
 *    properties of the authenticated app, which is exactly what the flag gives
 *    them.
 *
 * Sibling configs (NOT replaced):
 *   - playwright.mobile.config.ts — fast-feedback 5-project mobile subset
 *   - playwright.full.config.ts   — full-experience 9-project × 2-theme
 *     for surface-feel/contracts (NOT customer-journey).
 *   - this file — customer-journey-only, 9 projects × 2 themes.
 *
 * Run locally:
 *   npx playwright test --config=playwright.customer-journey.config.ts
 * List discovery (works offline; sandbox-safe):
 *   npx playwright test --list --config=playwright.customer-journey.config.ts
 */

interface DeviceMatrixEntry {
  name: string;
  use: Record<string, unknown>;
  formFactor: "mobile" | "desktop";
}

const DEVICE_MATRIX: DeviceMatrixEntry[] = [
  // ── Mobile (5) ──────────────────────────────────────────────────────────
  // iPhone SE — narrowest current iPhone; catches buttons that wrap.
  {
    name: "mobile-iphone-se",
    formFactor: "mobile",
    use: { ...devices["iPhone SE"], viewport: { width: 375, height: 667 } },
  },
  // iPhone 12 — modal-iPhone target audience.
  {
    name: "mobile-iphone-12",
    formFactor: "mobile",
    use: { ...devices["iPhone 12"], viewport: { width: 390, height: 844 } },
  },
  // iPhone 14 Pro Max — widest current iPhone; catches >414 awkwardness.
  {
    name: "mobile-iphone-14-pro-max",
    formFactor: "mobile",
    use: {
      ...devices["iPhone 14 Pro Max"],
      viewport: { width: 430, height: 932 },
    },
  },
  // Pixel 5 — Android Chrome surface.
  {
    name: "mobile-pixel-5",
    formFactor: "mobile",
    use: { ...devices["Pixel 5"], viewport: { width: 393, height: 851 } },
  },
  // Galaxy S20 — common Samsung target with one of the narrowest dvw.
  {
    name: "mobile-galaxy-s20",
    formFactor: "mobile",
    use: {
      ...devices["Galaxy S9+"],
      viewport: { width: 360, height: 800 },
    },
  },

  // ── Desktop (4) ─────────────────────────────────────────────────────────
  // 1280x800 — common laptop baseline (most legacy 13" macbooks).
  {
    name: "desktop-laptop-1280",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 800 },
    },
  },
  // 1440x900 — modern MacBook Air / Pro effective rendering width.
  {
    name: "desktop-macbook-1440",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1440, height: 900 },
    },
  },
  // 1920x1080 — the modal 24" external monitor.
  {
    name: "desktop-24in-1920",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1920, height: 1080 },
    },
  },
  // 2560x1440 — 27" iMac / Studio Display; catches layouts that assume
  // <=1920 and leave a hollow center column at QHD.
  {
    name: "desktop-27in-2560",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 2560, height: 1440 },
    },
  },
];

const COLOR_SCHEMES: Array<"light" | "dark"> = ["light", "dark"];

/**
 * Expand DEVICE_MATRIX × COLOR_SCHEMES into the flat projects[] array
 * Playwright consumes. Each project carries metadata that the journey
 * specs read via testInfo.project.metadata to skip mobile-only or
 * desktop-only contracts and to drive the theme contract assertion.
 */
const projects = DEVICE_MATRIX.flatMap((dev) =>
  COLOR_SCHEMES.map((colorScheme) => ({
    name: `${dev.name}-${colorScheme}`,
    use: {
      ...dev.use,
      colorScheme,
    },
    metadata: {
      formFactor: dev.formFactor,
      colorScheme,
      baseDevice: dev.name,
    },
  })),
);

export default defineConfig({
  testDir: "./tests/e2e-customer-journey",
  // The customer-journey suite uses the same DB-seed global setup as the
  // mobile/full suites — a single seeded org + user so the test-auth
  // bypass resolves to a real account. Reuses the proven setup verbatim.
  globalSetup: "./tests/e2e-mobile/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // 240s per test — journey walks through onboarding (5 steps), Pax mount,
  // first-value action, plus theme contract probes at every checkpoint.
  timeout: 240_000,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }], ["json", { outputFile: "tests/e2e-customer-journey/results/playwright-report.json" }]]
    : [["list"], ["json", { outputFile: "tests/e2e-customer-journey/results/playwright-report.json" }]],
  outputDir: "test-results/customer-journey",
  use: {
    // Default to localhost:5000. Driving a browser at loopback works — see the
    // header. What does NOT work locally is this suite's signed-out first step
    // while E2E_TEST_AUTH=1 authenticates every request.
    //
    // The claim that used to sit here cited `reference_browser_verification.md`
    // as its authority. That file does not exist in this repository (checked
    // 2026-09-05; the only other citation of it is
    // docs/internal/multi-vertical-verification.md:40, which declines to run a
    // live browser test on the same missing authority). A limitation is worth
    // exactly as much as the last time someone measured it.
    //
    // CI overrides via TARGET_URL / PLAYWRIGHT_BASE_URL to a deployed surface,
    // where the test-auth bypass is gated by header + signed token.
    baseURL:
      process.env.TARGET_URL ??
      process.env.PLAYWRIGHT_BASE_URL ??
      "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "on",
    video: "retain-on-failure",
    extraHTTPHeaders: process.env.E2E_TEST_AUTH_TOKEN
      ? { "x-e2e-test-auth": process.env.E2E_TEST_AUTH_TOKEN }
      : undefined,
  },
  projects,
  // No webServer block when running against TARGET_URL — the CI runner
  // points at the live production app. When no TARGET_URL is set (local
  // dev / docs-build), Playwright will boot the dev server.
  webServer: process.env.TARGET_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:5000/api/version",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});

// Re-export for the runbook script + cross-run reporter.
export const CUSTOMER_JOURNEY_DEVICE_NAMES = DEVICE_MATRIX.map((d) => d.name);
export const CUSTOMER_JOURNEY_COLOR_SCHEMES = COLOR_SCHEMES;
