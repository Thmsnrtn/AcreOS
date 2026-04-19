import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/simulation",
  testMatch: /sim-.*\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 60000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/simulation/reports/playwright-html" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://acreos.io",
    trace: "on-first-retry",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
