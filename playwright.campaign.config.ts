/**
 * Campaign UX crawl — Playwright config.
 *
 * Drives tests/simulation/campaign/ux-crawl.spec.ts against a LOCAL AcreOS
 * running with the E2E test-auth bypass (server/auth/testAuth.ts). Never
 * valid against a deployed instance. No webServer: the server is shared
 * with the other campaign sims and is started/stopped outside this run.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:5000 \
 *     npx playwright test --config=playwright.campaign.config.ts
 *
 * Four viewport projects — every route×persona in the spec runs once per
 * project, so each route×viewport is its own test. Only Chromium is installed
 * in this environment, so the iPhone/iPad device descriptors (which default
 * to WebKit) are pinned to `browserName: "chromium"` — the viewport, DPR,
 * touch + UA emulation still apply.
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000";
const UX_OUT = "tests/simulation/reports/campaign-2026-10-05/ux";

export default defineConfig({
  testDir: "./tests/simulation/campaign",
  testMatch: /ux-crawl\.spec\.ts/,
  fullyParallel: true,
  retries: 0,
  workers: 3,
  timeout: 60_000,
  reporter: [["list"], ["json", { outputFile: `${UX_OUT}/playwright.json` }]],
  outputDir: `${UX_OUT}/test-results`,
  use: {
    baseURL: BASE_URL,
    // The spec injects axe-core under the app's CSP; bypass applies only to
    // the test browser, never the app.
    bypassCSP: true,
    trace: "off",
    screenshot: "off",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      // 2nd/3rd-gen iPhone SE class: 375×667 @2x. Playwright's built-in
      // "iPhone SE" descriptor is the 320×568 first generation, so this is
      // declared explicitly.
      name: "iphone-se",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
      },
    },
    {
      name: "pixel-5",
      use: { ...devices["Pixel 5"], browserName: "chromium" },
    },
    {
      name: "ipad-portrait",
      use: { ...devices["iPad (gen 7)"], browserName: "chromium" },
    },
    {
      name: "desktop-1440",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    },
  ],
});
