import { defineConfig, devices } from "@playwright/test";

/**
 * Offline field maps (W5b): proves a saved area opens and draws on a phone in
 * airplane mode, using Chromium's offline emulation against the REAL service
 * worker (client/public/sw.js), viewer (client/public/offline-map.*) and
 * page-side store (client/src/lib/offline-map-store.ts). Needs no database.
 * Run: npx playwright test --config=playwright.offline.config.ts
 */
const PORT = Number(process.env.OFFLINE_SPEC_PORT ?? 4791);
export default defineConfig({
  testDir: "./tests/e2e-offline",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, serviceWorkers: "allow" },
  projects: [{ name: "pixel-5", use: { ...devices["Pixel 5"] } }],
  webServer: {
    command: `node tests/e2e-offline/server.mjs`,
    url: `http://localhost:${PORT}/offline-map.html`,
    reuseExistingServer: false,
    env: { OFFLINE_SPEC_PORT: String(PORT) },
  },
});
