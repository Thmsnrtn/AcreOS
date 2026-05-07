#!/usr/bin/env node
// Capture a Playwright storageState.json for acreos.io by opening a real
// browser and waiting for the user to sign in manually. Smoother than
// `playwright codegen` for Clerk sign-in flows because there's no codegen
// sidebar interfering with cookies/popups, and we control the timing.
//
// Run: node scripts/capture-storage-state.mjs
// Output: ./storageState.json (Playwright-format, with cookies + localStorage)

import { chromium } from "playwright";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.env.ACREOS_URL || "https://acreos.io/";
const OUT = resolve(process.cwd(), "storageState.json");

console.log(`[capture] launching browser → ${URL}`);
console.log(`[capture] output will be written to: ${OUT}`);

const browser = await chromium.launch({
  headless: false,
  args: ["--start-maximized"],
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();

await page.goto(URL, { waitUntil: "domcontentloaded" });

console.log("");
console.log("[capture] ─────────────────────────────────────────────────────");
console.log("[capture]  Sign in to AcreOS in the browser window that opened.");
console.log("[capture]  When you see your authenticated dashboard, come back");
console.log("[capture]  to THIS terminal and press <Enter>.");
console.log("[capture] ─────────────────────────────────────────────────────");
console.log("");

const rl = readline.createInterface({ input: stdin, output: stdout });
await rl.question("Press <Enter> after you've finished signing in: ");
rl.close();

const cookies = await context.cookies();
const hasSession = cookies.some(
  (c) => c.name === "__session" && /acreos\.io$/.test(c.domain.replace(/^\./, "")),
);

await context.storageState({ path: OUT });
await browser.close();

if (!existsSync(OUT)) {
  console.error("[capture] FAILED — storageState.json was not written.");
  process.exit(1);
}

const size = statSync(OUT).size;
console.log("");
console.log(`[capture] ✓ wrote ${OUT} (${size} bytes, ${cookies.length} cookies)`);
if (!hasSession) {
  console.warn("[capture] ⚠ no __session cookie on .acreos.io — sign-in may not have completed.");
  console.warn("[capture]   Re-run if F.1 / F.2 hit 401s.");
} else {
  console.log("[capture]   __session cookie present → ready for F.1 / F.2.");
}
