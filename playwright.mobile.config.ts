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
    // only-on-failure: "on" captured a screenshot after EVERY action across
    // ~250 test executions — on a 2-core CI runner that IO/CPU pressure
    // manifested as page crashes, "#root never rendered", and WebKit fetch
    // failures ("due to access control checks") in otherwise-sound tests.
    screenshot: "only-on-failure",
    // on-first-retry: retain-on-failure still RECORDS every test (the pass
    // case merely deletes the file afterward) — recording is the expensive
    // part. With retries=2 in CI, every real failure still gets a video on
    // its first retry.
    video: "on-first-retry",
    // Without this, a single detached/obstructed element makes click()'s
    // auto-wait run until the 200s TEST timeout — seen as C1's 3.4-minute
    // hangs on /settings. 15s is generous for a starved runner while keeping
    // one bad element from eating the whole test budget.
    actionTimeout: 15_000,
  },
  // The real device classes founders + customers use. iOS Safari (WebKit)
  // dominates on Tom's audience; Android Chrome is the second-largest. The
  // SE / Pro Max / iPad-mini additions are Krieger's mobile-feel matrix —
  // touch-target + active-companion + dvh contracts must hold across the
  // full iPhone form-factor range and the smallest tablet, not just the
  // single iPhone-14 baseline. See docs/design/krieger-mobile-feel-contracts.md.
  projects: [
    { name: "iphone-14", use: { ...devices["iPhone 14"] } },
    { name: "pixel-5", use: { ...devices["Pixel 5"] } },
    // Playwright's "iPhone SE" descriptor is the ORIGINAL 2016 SE:
    // 320x568, iOS 10 UA — NOT the 375x667 3rd-gen. Even stricter than
    // intended: catches buttons that wrap-and-collide at the absolute
    // smallest viewport any customer could bring. (Verified against
    // playwright deviceDescriptors, 2026-06-10 — same descriptor-
    // assumption error class as the iPad Mini 768x1024-vs-744 mixup.)
    { name: "iphone-se", use: { ...devices["iPhone SE"] } },
    // iPhone 14 Pro Max — 430x932. The widest iPhone in production; catches
    // surfaces that assume <= 414px width and stretch awkwardly.
    { name: "iphone-14-pro-max", use: { ...devices["iPhone 14 Pro Max"] } },
    // iPad mini — 768x1024. The boundary between phone-stack and
    // desktop-grid; catches layouts that pick the wrong responsive arm.
    { name: "ipad-mini", use: { ...devices["iPad Mini"] } },
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
