#!/usr/bin/env node
/**
 * Console bridge for the founder-recovery mission.
 *
 * Launches a HEADED Chromium with a persistent profile (logins survive
 * restarts) and CDP exposed on localhost:9222 so the agent can drive pages
 * with playwright.connectOverCDP — while every password is typed by the
 * human in this real window, never by (or visible to) the agent.
 *
 * Usage:  node scripts/founder-recovery/browser.mjs [--port 9222]
 * Leave it running for the whole mission; Ctrl-C when done.
 */

import { chromium } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 9222;
const profileDir = path.join(os.homedir(), ".acreos-recovery-profile");

const START_PAGES = [
  "https://console.aws.amazon.com/iam/home#/users",
  "https://console.anthropic.com/settings/keys",
  "https://platform.openai.com/api-keys",
  "https://app.sendgrid.com/settings/api_keys",
  "https://dash.cloudflare.com/",
];

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: null,
  args: [`--remote-debugging-port=${port}`],
});

console.log(`\nConsole bridge up — CDP on http://localhost:${port}`);
console.log(`Profile: ${profileDir} (logins persist between runs)`);
console.log(`Log into each vendor tab as it loads. Ctrl-C to close.\n`);

for (const url of START_PAGES) {
  const page = await context.newPage();
  page.goto(url).catch(() => {}); // login redirects etc. are fine
}
// Close the initial blank page.
const blank = context.pages().find((p) => p.url() === "about:blank");
if (blank) await blank.close();

// Keep alive until the human closes the window or Ctrl-C.
await new Promise((resolve) => context.on("close", resolve));
