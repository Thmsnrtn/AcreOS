/**
 * Clerk Sign-In Smoke — A12-15 post-deploy guard (EL-P1 batch 4).
 *
 * WHY THIS EXISTS
 * The existing tests/production-smoke.spec.ts navigates routes against the
 * deployed app UNAUTHENTICATED, so a deploy that breaks sign-in — the exact
 * failure class of the Oct 18 build, where prod sign-in was broken — still
 * passes that spec as REDIRECT/OK. This spec is the missing guard: it signs
 * in through the REAL Clerk UI with a dedicated test account and asserts an
 * authenticated-only landmark is reached, not merely a redirect or a 200.
 *
 * CREDENTIALS (names only — values never live in the repo)
 *   E2E_USER_EMAIL / E2E_USER_PASSWORD — the repo's existing convention
 *   (tests/e2e/auth.setup.ts), supplied to CI as GitHub Actions secrets by
 *   the .github/workflows/clerk-signin-smoke.yml workflow.
 * Until those secrets are provisioned, the preflight test below FAILS
 * VISIBLY and names the missing secrets. That is deliberate: a smoke guard
 * that silently skips is the blind spot this file exists to close.
 *
 * The fleet's persona-cookie bypass (E2E_TEST_AUTH_TOKEN) is NOT used here:
 * bypassing Clerk is precisely what A12-15 says is insufficient.
 *
 * Run (against staging, post-deploy):
 *   CLERK_SMOKE_URL=https://<staging-app>.fly.dev \
 *   E2E_USER_EMAIL=... E2E_USER_PASSWORD=... \
 *   npx playwright test --config tests/clerk-signin-smoke.config.ts
 */

import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.CLERK_SMOKE_URL || "https://acreos-staging.fly.dev";
const EMAIL = process.env.E2E_USER_EMAIL ?? "";
const PASSWORD = process.env.E2E_USER_PASSWORD ?? "";

// Authenticated-only landmark: the /today page heading. /today is a
// protected route — unauthenticated visitors are redirected to /auth and
// never see this element — so its visibility distinguishes "signed in"
// from "redirected", which a bare HTTP 200/302 cannot.
const TODAY_TITLE = '[data-testid="text-today-title"]';

async function seedCookieConsent(page: Page): Promise<void> {
  // Same pre-seed as tests/e2e/auth-clerk-ticket.setup.ts: the consent
  // dialog must never block Clerk's frontend from receiving clicks.
  await page.context().addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "accepted");
    } catch {
      /* ignore — private-mode storage can throw */
    }
  });
}

async function signInThroughClerk(page: Page): Promise<void> {
  await seedCookieConsent(page);
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });

  // Clerk's <SignIn routing="hash"> widget (client/src/pages/auth-page.tsx).
  // Selectors mirror the legacy UI flow in tests/e2e/auth.setup.ts.
  const emailInput = page
    .locator("input[name='identifier'], input[type='email'], input[name='emailAddress']")
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 30_000 });
  await emailInput.fill(EMAIL);

  const continueBtn = page
    .locator("button:has-text('Continue'), button[type='submit']")
    .first();
  await continueBtn.click();

  const passwordInput = page
    .locator("input[type='password'], input[name='password']")
    .first();
  await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
  await passwordInput.fill(PASSWORD);

  const signInBtn = page
    .locator("button:has-text('Continue'), button:has-text('Sign in'), button[type='submit']")
    .first();
  await signInBtn.click();

  // SignIn's fallbackRedirectUrl is /today: a completed sign-in leaves
  // /auth. Staying on /auth (or landing back on it) is a broken sign-in.
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 30_000 });
  await expect(
    page.locator(".cl-formFieldErrorText, .cl-alertText--error"),
    "Clerk must not show an error after sign-in",
  ).toHaveCount(0);
}

test.describe("Clerk sign-in smoke (post-deploy, real Clerk)", () => {
  test("preflight: smoke credentials are configured", () => {
    expect(
      EMAIL,
      "E2E_USER_EMAIL secret is not set — provision the staging Clerk test-account secrets (names: E2E_USER_EMAIL, E2E_USER_PASSWORD) before this guard can run green",
    ).not.toBe("");
    expect(
      PASSWORD,
      "E2E_USER_PASSWORD secret is not set — provision the staging Clerk test-account secrets (names: E2E_USER_EMAIL, E2E_USER_PASSWORD) before this guard can run green",
    ).not.toBe("");
  });

  test("unauthenticated protected route lands on sign-in", async ({ page }) => {
    await seedCookieConsent(page);
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    // Baseline that shows the old spec's blind spot: without a session the
    // protected route must redirect to /auth and must NOT render the
    // authenticated-only landmark.
    await expect(page).toHaveURL(/\/auth/, { timeout: 30_000 });
    await expect(page.locator(TODAY_TITLE)).toHaveCount(0);
  });

  test("real Clerk sign-in reaches an authenticated-only landmark", async ({ page }) => {
    await signInThroughClerk(page);
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator(TODAY_TITLE)).toBeVisible({ timeout: 30_000 });
  });

  test("session persists across a reload", async ({ page }) => {
    await signInThroughClerk(page);
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(TODAY_TITLE)).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/auth/);
    await expect(page.locator(TODAY_TITLE)).toBeVisible({ timeout: 30_000 });
  });

  test("sign-out returns to public state", async ({ page }) => {
    await signInThroughClerk(page);
    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(TODAY_TITLE)).toBeVisible({ timeout: 30_000 });

    // The app renders no Clerk UserButton; terminate the session through
    // ClerkJS itself (window.Clerk is published by @clerk/react), which is
    // the same sign-out the app's own use-auth hook invokes.
    await page.evaluate(async () => {
      const w = window as unknown as {
        Clerk?: { signOut: () => Promise<unknown> };
      };
      if (!w.Clerk) {
        throw new Error("ClerkJS global (window.Clerk) not present — cannot sign out");
      }
      await w.Clerk.signOut();
    });

    await page.goto(`${BASE}/today`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/auth/, { timeout: 30_000 });
    await expect(page.locator(TODAY_TITLE)).toHaveCount(0);
  });
});
