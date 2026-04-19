import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "production-smoke.spec.ts",
  fullyParallel: true,
  retries: 0,
  workers: 4,
  reporter: [["line"]],
  timeout: 30000,
  use: {
    baseURL: process.env.SMOKE_URL || "https://acreos.fly.dev",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "smoke",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
