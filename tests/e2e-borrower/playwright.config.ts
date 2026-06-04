import { defineConfig, devices } from "@playwright/test";

/**
 * Beatrice — Borrower-cookie-session E2E config.
 *
 * Phase D3. End-to-end verification of the F3.4 fix (commit 99be388b +
 * type-fix f4f46032) that moved borrower-statement credentials out of
 * URL query params and into a signed, IP-bound, 30-min cookie minted by
 * `POST /api/borrower/auth/exchange`.
 *
 * Distinct from the customer-journey config — this suite only exercises
 * the unauthenticated borrower-portal surface, NOT the Clerk-authed
 * application. We don't need the 9 × 2 matrix; one desktop Chromium
 * project is enough to verify the credential plumbing.
 *
 * Discovery (always works, sandbox-safe):
 *   npx playwright test --list --config=tests/e2e-borrower/playwright.config.ts
 *
 * Live run (CI only — needs a seeded test DB):
 *   DATABASE_URL=... node scripts/seed-test-borrower.mjs seed
 *   npx playwright test --config=tests/e2e-borrower/playwright.config.ts
 *
 * The spec self-skips when .test-borrower-credentials.json is absent so
 * `--list` and CI cold-runs never crash. The CI job is responsible for
 * running the seeder before invoking Playwright.
 */
export default defineConfig({
  testDir: ".",
  // No globalSetup — credential plumbing is by file (seeder writes
  // .test-borrower-credentials.json; spec reads it). This keeps the
  // suite runnable against a remote target URL without DB push.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        ["html", { open: "never" }],
        [
          "json",
          { outputFile: "tests/e2e-borrower/results/playwright-report.json" },
        ],
      ]
    : [
        ["list"],
        [
          "json",
          { outputFile: "tests/e2e-borrower/results/playwright-report.json" },
        ],
      ],
  outputDir: "test-results/e2e-borrower",
  use: {
    // Local docs-parity default. CI sets PLAYWRIGHT_BASE_URL / TARGET_URL.
    baseURL:
      process.env.TARGET_URL ??
      process.env.PLAYWRIGHT_BASE_URL ??
      "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // The borrower surface is NOT behind Clerk — no E2E_TEST_AUTH header
    // is forwarded. The borrower-session cookie is the entire auth model.
  },
  projects: [
    {
      name: "borrower-desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
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
