import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "on-failure" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Auth setup project — creates signed-in state for reuse
    { name: "setup", testMatch: /.*\.setup\.ts/ },

    // The 30 First Users persona walk — self-auths per persona via the
    // e2e-persona-<slug> cookie, so it needs NO shared storageState/setup.
    // Each persona test builds its own device context internally. Run with:
    //   npx playwright test --project=customer-personas
    {
      name: "customer-personas",
      testMatch: /customer-personas\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // Desktop
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    // Firefox disabled — NS_ERROR_NET_EMPTY_RESPONSE with Clerk middleware; re-enable when resolved
    // { name: "desktop-firefox", use: { ...devices["Desktop Firefox"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 720 }, storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    { name: "desktop-ultrawide", use: { viewport: { width: 2560, height: 1080 }, storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },

    // Tablets
    { name: "ipad-portrait", use: { ...devices["iPad (gen 7)"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    { name: "ipad-landscape", use: { ...devices["iPad (gen 7) landscape"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    { name: "ipad-pro", use: { ...devices["iPad Pro 11"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },

    // Phones
    { name: "iphone-14", use: { ...devices["iPhone 14"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    { name: "iphone-se", use: { ...devices["iPhone SE"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    { name: "pixel-5", use: { ...devices["Pixel 5"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    { name: "galaxy-s9", use: { ...devices["Galaxy S9+"], storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },

    // Worst case
    { name: "tiny-phone", use: { viewport: { width: 320, height: 568 }, isMobile: true, storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
    { name: "short-wide", use: { viewport: { width: 1920, height: 600 }, storageState: "tests/e2e/.auth/user.json" }, dependencies: ["setup"], testIgnore: /(?:.*\.setup\.ts|customer-personas\.spec\.ts)/ },
  ],
  // Start the dev server automatically in CI
  webServer: process.env.CI
    ? {
        command: "npm run start",
        url: "http://localhost:5000",
        reuseExistingServer: false,
        timeout: 120 * 1000,
      }
    : undefined,
})
