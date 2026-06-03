import { defineConfig, devices } from "@playwright/test";

/**
 * AGENTIC L-BAR — full-experience Playwright config.
 *
 * Tom (2026-06-02): "Just make sure all of this is really considering mobile
 * and desktop ux. Full experience." This config is the production CI surface
 * for that mandate. The narrower `playwright.mobile.config.ts` is preserved
 * as a fast-feedback local-dev subset (mobile-only, 5 projects).
 *
 * Matrix shape:
 *   9 device projects × 2 themes (light + dark) = 18 effective runs per test
 *
 * Projects:
 *   Mobile (5)   — iPhone 14, Pixel 5, iPhone SE, iPhone 14 Pro Max, iPad Mini
 *   Desktop (4)  — Chromium 1280×800, Chromium 1920×1080, Firefox 1280×800,
 *                  WebKit 1280×800 (the Safari-only-bug catcher)
 *
 * Theme matrix:
 *   Each project runs in BOTH light + dark via the `colorScheme` use option
 *   (which Playwright forwards to `page.emulateMedia({ colorScheme })`).
 *   Project names are suffixed `-light` / `-dark` so the report names a
 *   single coordinate per failure (no "which theme failed?" guessing).
 *
 * Shared invariants (same as playwright.mobile.config.ts):
 *   - globalSetup: ./tests/e2e-mobile/global-setup.ts (DB push + seed)
 *   - webServer: npm run start, port 5000, /api/version health probe
 *   - retries: 2 in CI, 0 locally
 *   - timeout: 200_000ms per test (CI runner variance budget)
 *
 * Run locally:  npx playwright test --config=playwright.full.config.ts
 * Run in CI:    same; see .github/workflows/e2e-mobile.yml + customer-surface-monitor.yml
 */

interface DeviceMatrixEntry {
  name: string;
  use: Record<string, unknown>;
  /**
   * `mobile-only` projects skip desktop-specific contracts (keyboard-focus
   * sweep, hover-affordance present). `desktop-only` projects skip
   * touch-target 44px (24px is the desktop click-target spec).
   */
  formFactor: "mobile" | "desktop";
}

const DEVICE_MATRIX: DeviceMatrixEntry[] = [
  // ── Mobile (5) — unchanged from playwright.mobile.config.ts ───────────────
  {
    name: "iphone-14",
    formFactor: "mobile",
    use: { ...devices["iPhone 14"] },
  },
  { name: "pixel-5", formFactor: "mobile", use: { ...devices["Pixel 5"] } },
  {
    name: "iphone-se",
    formFactor: "mobile",
    use: { ...devices["iPhone SE"] },
  },
  {
    name: "iphone-14-pro-max",
    formFactor: "mobile",
    use: { ...devices["iPhone 14 Pro Max"] },
  },
  { name: "ipad-mini", formFactor: "mobile", use: { ...devices["iPad Mini"] } },

  // ── Desktop (4) — new for the full-experience extension ───────────────────
  // chromium-laptop: the modal desktop viewport for SaaS dashboards.
  {
    name: "chromium-laptop",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 800 },
    },
  },
  // chromium-wide: catches layouts that assume <=1440 and stretch awkwardly.
  {
    name: "chromium-wide",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1920, height: 1080 },
    },
  },
  // firefox-laptop: catches Chromium-only bugs (CSS Grid quirks, Intl APIs).
  {
    name: "firefox-laptop",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Firefox"],
      viewport: { width: 1280, height: 800 },
    },
  },
  // safari-laptop: catches Safari-only bugs (WebKit dialog focus, Date parsing,
  // scrollbar overlay). The desktop counterpart to iPhone-14's iOS Safari run.
  {
    name: "safari-laptop",
    formFactor: "desktop",
    use: {
      ...devices["Desktop Safari"],
      viewport: { width: 1280, height: 800 },
    },
  },
];

const COLOR_SCHEMES: Array<"light" | "dark"> = ["light", "dark"];

/**
 * Expand DEVICE_MATRIX × COLOR_SCHEMES into the flat projects[] array
 * Playwright consumes. Each project's `use.colorScheme` is read by the
 * spec-level theme fixture which calls page.emulateMedia({ colorScheme })
 * on test setup so app-level prefers-color-scheme media queries resolve
 * correctly even before any client-side theme switcher hydrates.
 *
 * `metadata.formFactor` is read by surface-feel-contracts.spec.ts to
 * auto-skip mobile-only or desktop-only contracts on the wrong projects.
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
  testDir: "./tests/e2e-mobile",
  globalSetup: "./tests/e2e-mobile/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Workers is intentionally 1: the test-auth bypass shares DB state via the
  // global-setup seed, and concurrent specs racing the same fixtures was the
  // original instability we eliminated in the mobile config. Keep that.
  workers: 1,
  timeout: 200_000,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects,
  webServer: {
    command: "npm run start",
    url: "http://localhost:5000/api/version",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});

// Re-exported so specs can introspect the matrix shape (e.g. for skip logic
// on the wrong form-factor). Tests should NOT import devices directly —
// they should consult testInfo.project.metadata.formFactor instead.
export const FULL_MATRIX_DEVICE_NAMES = DEVICE_MATRIX.map((d) => d.name);
export const FULL_MATRIX_COLOR_SCHEMES = COLOR_SCHEMES;
