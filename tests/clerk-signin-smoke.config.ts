import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the A12-15 Clerk sign-in smoke
 * (tests/clerk-signin-smoke.spec.ts). Lives under tests/ because batch 4's
 * file set is tests/ + .github/workflows/ only. Mirrors the shape of
 * playwright.smoke.config.ts, but targets the staging deployment and runs
 * serially: the cases share one real Clerk test account, and parallel
 * sign-ins of a single account invite Clerk session churn.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "clerk-signin-smoke.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["line"]],
  outputDir: "./clerk-smoke-results",
  use: {
    baseURL: process.env.CLERK_SMOKE_URL || "https://acreos-staging.fly.dev",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "clerk-signin-smoke",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
