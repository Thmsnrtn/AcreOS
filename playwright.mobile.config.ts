import { defineConfig, devices } from "@playwright/test";

/**
 * Dedicated mobile E2E config. Separate from playwright.config.ts (which
 * depends on real Clerk credentials) so this suite can run unattended in CI
 * using the server test-auth bypass (server/auth/testAuth.ts).
 *
 * The webServer inherits the job environment, which MUST set:
 *   E2E_TEST_AUTH=1, DATABASE_URL, ENCRYPTION_KEY, CLERK_SECRET_KEY (dummy),
 *   VITE_CLERK_PUBLISHABLE_KEY (dummy pk_test_…).
 * Run with `npm run test:e2e:mobile` after `npm run build`.
 */
export default defineConfig({
  testDir: "./tests/e2e-mobile",
  globalSetup: "./tests/e2e-mobile/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // CI runners vary wildly (seen 1–12 min total under load); give each test
  // generous headroom so render-polling survives a starved runner.
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
  // The two real device classes founders use: iOS Safari (WebKit) and
  // Android Chrome. A 320px "tiny-phone" project was dropped to cut runtime
  // and flake under CI load — re-add once runner capacity is reliable.
  projects: [
    { name: "iphone-14", use: { ...devices["iPhone 14"] } },
    { name: "pixel-5", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:5000/api/version",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
