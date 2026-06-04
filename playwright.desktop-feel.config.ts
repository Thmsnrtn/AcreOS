import { defineConfig, devices } from "@playwright/test";

/**
 * KRIEGER — Desktop-feel synthetic monitor config.
 *
 * Phase D3: dedicated Playwright config for the desktop customer-surface
 * feel contracts. Scope expansion from the mobile-only Phase-D1/D2 gate
 * to mobile+desktop. 4 desktop viewports × 2 themes = 8 effective
 * projects per execution.
 *
 * Matrix shape (desktop only — mobile lives in playwright.mobile.config.ts
 * + playwright.customer-journey.config.ts):
 *   1280×800  — laptop reference (most legacy 13" macbooks).
 *   1440×900  — modern MacBook Air / Pro effective rendering width.
 *   1920×1080 — modal 24" external monitor.
 *   2560×1440 — 27" iMac / Studio Display; Deals + Finance get serious
 *               use at QHD, so this catches layouts that assume <=1920
 *               and leave a hollow center column.
 *
 * Theme matrix:
 *   Each project × {light, dark} via colorScheme. Project names suffixed
 *   `-light` / `-dark` so a single coordinate in the report names a
 *   single failure (no "which theme failed?" guessing).
 *
 * Base URL:
 *   Defaults to http://localhost:5000 for documentation parity with the
 *   other configs. NOTE: per reference_browser_verification.md, the local
 *   Claude sandbox CANNOT drive a browser (loopback blocked). The CI
 *   runner sets PLAYWRIGHT_BASE_URL / TARGET_URL to the live production
 *   surface, where the E2E_TEST_AUTH bypass is gated by an HTTP header.
 *
 * Sibling configs (NOT replaced):
 *   - playwright.mobile.config.ts — fast-feedback 5-project mobile subset.
 *   - playwright.full.config.ts — 9-project × 2-theme surface-feel.
 *   - playwright.customer-journey.config.ts — 9-project × 2-theme journey.
 *   - this file — desktop-feel contracts, 4 projects × 2 themes.
 *
 * Run locally:
 *   npx playwright test --config=playwright.desktop-feel.config.ts
 * List discovery (works offline; sandbox-safe):
 *   npx playwright test --list --config=playwright.desktop-feel.config.ts
 */

interface DeviceMatrixEntry {
  name: string;
  use: Record<string, unknown>;
  formFactor: "desktop";
}

const DEVICE_MATRIX: DeviceMatrixEntry[] = [
  // 1280×800 — common laptop baseline (most legacy 13" macbooks).
  {
    name: "desktop-laptop-1280",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 800 },
    },
  },
  // 1440×900 — modern MacBook Air / Pro effective rendering width.
  {
    name: "desktop-macbook-1440",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1440, height: 900 },
    },
  },
  // 1920×1080 — the modal 24" external monitor.
  {
    name: "desktop-24in-1920",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1920, height: 1080 },
    },
  },
  // 2560×1440 — 27" iMac / Studio Display. Deals + Finance get serious
  // use at QHD; catches layouts that assume <=1920 and leave a hollow
  // center column.
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
 * Expand DEVICE_MATRIX × COLOR_SCHEMES into the flat projects[] array.
 * Each project carries metadata that the contract specs read via
 * testInfo.project.metadata to drive theme contract assertions + to
 * skip contracts that don't apply at a given viewport.
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
      viewportWidth: (dev.use as { viewport?: { width: number } }).viewport
        ?.width,
    },
  })),
);

export default defineConfig({
  testDir: "./tests/e2e-desktop-feel",
  // Reuses the proven mobile global-setup — a single seeded org + user so
  // the test-auth bypass resolves to a real account.
  globalSetup: "./tests/e2e-mobile/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // 180s per test — desktop contract probes walk 7 routes × multiple
  // hover/focus/keyboard interactions per route.
  timeout: 180_000,
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["html", { open: "never" }],
        [
          "json",
          {
            outputFile:
              "tests/e2e-desktop-feel/results/playwright-report.json",
          },
        ],
      ]
    : [
        ["list"],
        [
          "json",
          {
            outputFile:
              "tests/e2e-desktop-feel/results/playwright-report.json",
          },
        ],
      ],
  outputDir: "test-results/desktop-feel",
  use: {
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
export const DESKTOP_FEEL_DEVICE_NAMES = DEVICE_MATRIX.map((d) => d.name);
export const DESKTOP_FEEL_COLOR_SCHEMES = COLOR_SCHEMES;
