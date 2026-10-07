/**
 * Campaign variant of playwright.mobile.config.ts: same spec, same device
 * viewports, but every project forced onto Chromium. The cloud container
 * carries no WebKit build, so this measures LAYOUT contracts (touch targets,
 * overflow, blank dialogs) at iPhone/iPad sizes — it says nothing about
 * Safari's engine. Safari-specific behaviour stays unverified.
 */
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.mobile.config";

const asChromium = (d: (typeof devices)[string]) => {
  const { defaultBrowserType: _ignored, ...rest } = d as any;
  return { ...rest, browserName: "chromium" as const };
};

export default defineConfig({
  ...base,
  webServer: undefined,
  projects: [
    { name: "iphone-14 (chromium)", use: asChromium(devices["iPhone 14"]) },
    { name: "iphone-se (chromium)", use: asChromium(devices["iPhone SE"]) },
    { name: "iphone-14-pro-max (chromium)", use: asChromium(devices["iPhone 14 Pro Max"]) },
    { name: "ipad-mini (chromium)", use: asChromium(devices["iPad Mini"]) },
  ],
});
