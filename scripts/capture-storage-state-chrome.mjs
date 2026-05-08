#!/usr/bin/env node
// Capture a Playwright storageState.json by launching the user's REAL Google
// Chrome (not Playwright's bundled Chromium) with a fresh dedicated profile
// dir. Real Chrome's fingerprint passes Google's OAuth bot-detection wall
// that blocks Chromium with "Couldn't sign you in / browser may not be
// secure."
//
// Run: node scripts/capture-storage-state-chrome.mjs
// Output: ./storageState.json
//
// The dedicated profile lives at /tmp/acreos-pw-chrome-profile and is
// reusable — re-running this script picks up where you left off, so if a
// later F.1/F.2 run hits 401s you can re-launch and re-sign-in without
// losing any unrelated browser state.

import { chromium } from "playwright";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const URL = process.env.ACREOS_URL || "https://acreos.io/";
const OUT = resolve(process.cwd(), "storageState.json");
const PROFILE_DIR = resolve(tmpdir(), "acreos-pw-chrome-profile");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Auto-detect mode: when the script is run from a non-TTY shell harness
// (stdin redirected to /dev/null), readline prompts hang forever. Detect
// non-TTY stdin and switch to polling for the __session cookie instead.
const AUTO = !process.stdin.isTTY || process.env.AUTO === "1";

if (!existsSync(CHROME_PATH)) {
  console.error(`[capture] Real Chrome not found at: ${CHROME_PATH}`);
  console.error(`[capture] Install Chrome or pass CHROME_PATH=... env var.`);
  process.exit(1);
}

console.log(`[capture] Launching REAL Chrome → ${URL}`);
console.log(`[capture] Profile dir (dedicated, separate from your main Chrome): ${PROFILE_DIR}`);
console.log(`[capture] Output will be written to: ${OUT}`);

// Persistent context = the launched browser uses --user-data-dir, so cookies
// + localStorage persist across runs. Important for Google: their device
// fingerprint check is more lenient when the profile is "warm" (has prior
// successful sessions).
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  executablePath: CHROME_PATH,
  viewport: null,
  args: ["--start-maximized"],
});

// Reuse the first existing page (Chrome opens with a blank tab) if there is
// one; otherwise open a new tab.
const pages = context.pages();
const page = pages.length > 0 ? pages[0] : await context.newPage();
await page.goto(URL, { waitUntil: "domcontentloaded" });

console.log("");
console.log("[capture] ─────────────────────────────────────────────────────");
if (AUTO) {
  console.log("[capture]  AUTO mode (non-TTY stdin) — polling for __session");
  console.log("[capture]  cookie. Sign in if not already; the script saves");
  console.log("[capture]  storageState as soon as the cookie appears.");
  console.log("[capture]  Timeout: 5 minutes.");
} else {
  console.log("[capture]  Sign in to AcreOS in the Chrome window. Google OAuth");
  console.log("[capture]  should now work — this is real Chrome, not Chromium.");
  console.log("[capture]");
  console.log("[capture]  When you see the authenticated dashboard, return to");
  console.log("[capture]  THIS terminal and press <Enter>.");
}
console.log("[capture] ─────────────────────────────────────────────────────");
console.log("");

if (AUTO) {
  const DEADLINE = Date.now() + 5 * 60 * 1000;
  let detected = false;
  while (Date.now() < DEADLINE) {
    const cs = await context.cookies();
    if (cs.some((c) => c.name === "__session" && /acreos\.io$/.test(c.domain.replace(/^\./, "")))) {
      detected = true;
      console.log("[capture] __session cookie detected — saving.");
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!detected) {
    console.error("[capture] Timed out waiting for __session cookie.");
    await context.close();
    process.exit(1);
  }
} else {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question("Press <Enter> after you've finished signing in: ");
  rl.close();
}

const cookies = await context.cookies();
const sessionCookie = cookies.find(
  (c) => c.name === "__session" && /acreos\.io$/.test(c.domain.replace(/^\./, "")),
);

await context.storageState({ path: OUT });
await context.close();

if (!existsSync(OUT)) {
  console.error("[capture] FAILED — storageState.json was not written.");
  process.exit(1);
}

const size = statSync(OUT).size;
console.log("");
console.log(`[capture] ✓ wrote ${OUT} (${size} bytes, ${cookies.length} cookies)`);
if (!sessionCookie) {
  console.warn("[capture] ⚠ no __session cookie on .acreos.io — sign-in may not have completed.");
  console.warn("[capture]   Re-run this script if F.1 / F.2 hit 401s.");
} else {
  const expMs = sessionCookie.expires > 0 ? sessionCookie.expires * 1000 - Date.now() : null;
  console.log(
    `[capture]   __session cookie present${
      expMs !== null ? ` (expires in ~${Math.round(expMs / 60000)} min)` : ""
    } → ready for F.1 / F.2.`,
  );
}
