/**
 * Programmatic Clerk auth via a sign-in ticket minted from the Backend API.
 *
 * Activated when CLERK_SIGN_IN_TICKET is set. Falls back to the legacy
 * email/password UI flow when it isn't.
 *
 * Workflow (driven by scripts/playwright-clerk-runner.sh):
 *   1. Caller mints a one-time sign-in ticket via
 *      POST https://api.clerk.com/v1/sign_in_tokens { user_id }
 *   2. Caller exports CLERK_SIGN_IN_TICKET + CLERK_PUBLISHABLE_KEY
 *   3. Playwright runs this setup, which uses @clerk/testing to exchange
 *      the ticket for a real session, then persists the cookie state to
 *      tests/e2e/.auth/user.json
 *   4. Downstream test projects pick up that storage state.
 *
 * This file lives alongside the legacy auth.setup.ts. Playwright's
 * setup project matches /.*\.setup\.ts/ so both will run — the second
 * one to write user.json wins. We set this file's storageState first
 * by exiting early when no ticket is present.
 */

import { test as setup } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authDir = path.join(__dirname, ".auth");
const authFile = path.join(authDir, "user.json");

// 60s — Clerk hosted sign-in + AcreOS bootstrap can be slow on a cold cache.
setup.setTimeout(120_000);

setup("authenticate via Clerk ticket", async ({ page, context }) => {
  const ticket = process.env.CLERK_SIGN_IN_TICKET;
  if (!ticket) {
    return;
  }

  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // Pre-seed cookie-consent so the dialog never blocks Clerk's frontend
  // from intercepting clicks / navigations. localStorage is per-origin
  // so we set it under the production origin via initScript.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "accepted");
    } catch {
      /* ignore — Safari private mode etc */
    }
  });

  await clerkSetup();

  await page.goto("/auth");
  // Give Clerk's frontend a beat to mount before signIn drives it.
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1_500);

  await clerk.signIn({
    page,
    signInParams: { strategy: "ticket", ticket },
  });

  // Verify the session.
  await page.goto("/today");
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  if (page.url().includes("/auth") || page.url().includes("/sign-in")) {
    throw new Error(`Clerk sign-in via ticket did not produce a session — landed at ${page.url()}`);
  }

  await page.context().storageState({ path: authFile });
  console.log(`[clerk-ticket-auth] session persisted to ${authFile} (url=${page.url()})`);
});
