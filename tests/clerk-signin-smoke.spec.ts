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

  // NEVER select the submit button with a bare `button[type='submit']`
  // union + .first(): Clerk's <form class="cl-form"> opens with a
  // deliberately hidden submit button —
  //   <button type="submit" aria-hidden="true"
  //           style="visibility: hidden; position: absolute">
  // — placed BEFORE the visible "Continue" button in DOM order, so a
  // DOM-ordered .first() resolves to that invisible button and the click
  // times out (run 45658284275, 2026-11-25: all 3 sign-in tests burned
  // the full 120s at this click; see the failure artifacts' trace DOM).
  // A role lookup only matches buttons with an accessible name, which
  // the aria-hidden button does not have, and we additionally wait for
  // visibility before clicking.
  const submitBtn = page
    .getByRole("button", { name: /continue|sign in/i })
    .first();
  const passwordInput = page
    .locator("input[type='password'], input[name='password']")
    .first();

  // Clerk renders this form two ways depending on instance config: the
  // password field either appears only after the identifier step, or is
  // already visible alongside the email field. Fill it up front when it
  // is already there so a single submit completes the sign-in.
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(PASSWORD);
    await submitBtn.waitFor({ state: "visible", timeout: 30_000 });
    await submitBtn.click();
  } else {
    await submitBtn.waitFor({ state: "visible", timeout: 30_000 });
    await submitBtn.click();
    await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
    await passwordInput.fill(PASSWORD);
    const signInBtn = page
      .getByRole("button", { name: /continue|sign in/i })
      .first();
    await signInBtn.waitFor({ state: "visible", timeout: 30_000 });
    await signInBtn.click();
  }

  // Factor-two: the staging Clerk instance has new-device verification
  // on, and a CI runner is always a new device — after the password is
  // ACCEPTED (POST /v1/client/sign_ins → 200, then prepare_second_factor
  // → 200) Clerk routes to /auth#/factor-two, "Check your email …
  // You're signing in from a new device", and emails a 6-digit code
  // (proven by re-proof run 45663560002's artifacts, 2026-11-25).
  // On a Clerk DEVELOPMENT instance, an account whose email uses the
  // +clerk_test subaddress (e.g. name+clerk_test@acreos.io) always
  // receives the fixed test code 424242 and no real email is sent —
  // Clerk's documented E2E affordance. Complete that step when it
  // appears; if the account is NOT a +clerk_test account the code will
  // be rejected and this smoke stays red with Clerk's error visible,
  // which is the correct fail-closed behaviour until the account is
  // switched (see the PR description for the instance-side item).
  const TEST_CODE = process.env.E2E_CLERK_TEST_CODE ?? "424242";
  const codeInput = page
    .locator(
      "input[name='code'], input[autocomplete='one-time-code'], input[inputmode='numeric']",
    )
    .first();
  const factorTwoShown = await codeInput
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (factorTwoShown) {
    await codeInput.click();
    await codeInput.fill(TEST_CODE).catch(async () => {
      await page.keyboard.type(TEST_CODE);
    });
    const verifyBtn = page
      .getByRole("button", { name: /continue/i })
      .first();
    if (await verifyBtn.isVisible().catch(() => false)) {
      await verifyBtn.click();
    }
  }

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
