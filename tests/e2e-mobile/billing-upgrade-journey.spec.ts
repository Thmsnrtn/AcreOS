/**
 * BILLING UPGRADE JOURNEY — Settings → Billing → plans → Stripe checkout.
 *
 * Two-speed spec:
 *
 *   A. ALWAYS (no Stripe keys needed): the Billing tab's plans section is
 *      the surface every server upgradeUrl deep-links to
 *      (/settings#billing — plans were MOVED here from the Account tab in
 *      fix wave 2 / WS1 2026-07-07 precisely because the deep link landed on
 *      a tab with no plans). This test pins the HONEST DEGRADED state: with
 *      no STRIPE_SECRET_KEY the /api/stripe/products call 500s, and the page
 *      must show the "Couldn't load plans" error card
 *      (testid error-available-plans) with a WORKING retry — never a blank
 *      section, never a crash. If keys ARE present it instead requires one
 *      of the three legitimate states (plan cards / empty state / error
 *      card) — still never blank.
 *
 *   B. GATED (self-activating): the real upgrade flow — plans render, the
 *      customer taps an upgrade button, and the browser is handed off to a
 *      Stripe-hosted checkout page. Skipped via
 *      test.skip(!process.env.STRIPE_SECRET_KEY) so it turns itself on the
 *      moment the founder's Stripe TEST keys land in CI (no spec edit
 *      needed). Prerequisite baked into the account, not this spec: the
 *      subscription products must exist with metadata.acreos_product=true
 *      and metadata.tier=starter|pro|scale
 *      (scripts/setup-stripe-subscription-products.ts).
 *
 * The seeded customer (global-setup) is the org OWNER, so the
 * requirePermission("canManageBilling") gate on /api/stripe/checkout passes;
 * the org is subscription_tier='pro', so the Starter/Scale cards render an
 * Upgrade button (the Pro card shows Manage instead).
 */
import { test, expect, type Page } from "@playwright/test";

const CSRF_TOKEN = "e2e-billing-csrf-double-submit";

/** Same bypass helper as the other mobile specs (see nav-smoke.spec.ts). */
async function seedSessionCookies(page: Page, baseURL: string) {
  const { hostname } = new URL(baseURL);
  await page.context().addCookies([
    { name: "__session", value: "e2e", domain: hostname, path: "/" },
    { name: "csrf_token", value: CSRF_TOKEN, domain: hostname, path: "/" },
  ]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("acreos_cookie_consent", "declined");
    } catch {}
  });
}

/**
 * Arriving via /settings#billing intentionally auto-opens the
 * plan-comparison dialog (settings.tsx hash effect — the upgrade-toast
 * deep-link behavior). A real customer dismisses it to reach the plans grid
 * underneath; so does this spec. Tolerates the dialog not opening (e.g. if
 * that behavior is ever removed) — the assertions that matter come after.
 */
async function dismissPlanComparisonDialog(page: Page) {
  const dialog = page.getByRole("dialog", { name: /compare plans/i });
  try {
    await dialog.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return; // never opened — nothing to dismiss
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test.describe("billing upgrade journey (Settings → Billing)", () => {
  test("Billing tab shows the plans section — honest degraded state, never blank", async ({
    page,
    baseURL,
  }) => {
    test.skip(!process.env.DATABASE_URL, "requires DATABASE_URL (CI service / local PG)");
    await seedSessionCookies(page, baseURL!);

    // The canonical deep link every server upgradeUrl points at. The hash
    // both selects the tab (getTabFromHash) and works on every breakpoint —
    // the horizontal TabsList is hidden below md, so clicking the trigger
    // is not a portable way in on phones.
    await page.goto("/settings#billing", { waitUntil: "domcontentloaded" });
    await dismissPlanComparisonDialog(page);

    // The Billing tab must exist in the settings tab model (visible on
    // >=md; present-but-hidden behind the mobile Select below md).
    await expect(page.getByTestId("tab-billing")).toBeAttached();

    // The billing tab content + plans section render — the WS1 regression
    // this spec exists to hold: #billing must actually contain the plans.
    const billingContent = page.getByTestId("tab-content-billing");
    await expect(billingContent).toBeVisible({ timeout: 20_000 });
    const pricingSection = page.locator("#pricing-section");
    await expect(pricingSection).toBeVisible();
    // Role-scoped: plain getByText would also substring-match the loading
    // skeleton's sr-only "Loading available plans" announcement.
    await expect(
      pricingSection.getByRole("heading", { name: "Available Plans" }),
    ).toBeVisible();

    if (!process.env.STRIPE_SECRET_KEY) {
      // ── Degraded-honest: no Stripe key → products 500s → error card ──
      const errorCard = page.getByTestId("error-available-plans");
      // Query retries once (shouldRetry caps at attempt 1) then settles
      // into the error state; generous timeout for a starved runner.
      await expect(errorCard).toBeVisible({ timeout: 30_000 });
      await expect(errorCard.getByText("Couldn't load plans")).toBeVisible();

      // The retry affordance must WORK: clicking it re-fires the real
      // products request (asserted at the network layer) and — with keys
      // still absent — lands back on the error card, not a blank section.
      const retryButton = page.getByTestId("error-available-plans-retry-button");
      await expect(retryButton).toBeVisible();
      const refetch = page.waitForRequest(
        (req) => req.url().includes("/api/stripe/products"),
        { timeout: 15_000 },
      );
      await retryButton.click();
      await refetch;
      await expect(errorCard).toBeVisible({ timeout: 30_000 });
      await expect(pricingSection).toBeVisible();
    } else {
      // ── Keys present: any of the three legitimate settled states is
      // acceptable here (cards / empty / error) — the REAL flow below owns
      // the strong "plans render" assertion. This branch only forbids the
      // fourth state: a silently blank section.
      await expect
        .poll(
          async () => {
            const cards = await page.locator('[data-testid^="card-plan-"]').count();
            const empty = await page.getByTestId("empty-available-plans").count();
            const error = await page.getByTestId("error-available-plans").count();
            return cards + empty + error;
          },
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
    }
  });

  test("real upgrade flow: plans render → upgrade → Stripe checkout redirect", async ({
    page,
    baseURL,
  }) => {
    // Self-activating: flips on the moment STRIPE_SECRET_KEY (the founder's
    // Stripe TEST key) lands in the CI environment. Until then it SKIPS —
    // it must never fail for the keys' absence.
    test.skip(
      !process.env.STRIPE_SECRET_KEY,
      "requires STRIPE_SECRET_KEY (Stripe test key) — self-activates when the founder's keys land in CI",
    );
    test.skip(!process.env.DATABASE_URL, "requires DATABASE_URL (CI service / local PG)");
    test.setTimeout(120_000);

    await seedSessionCookies(page, baseURL!);
    await page.goto("/settings#billing", { waitUntil: "domcontentloaded" });
    await dismissPlanComparisonDialog(page);

    // ── 1. Plans render from the real Stripe account ─────────────────────
    // Requires the subscription products to be tagged
    // metadata.acreos_product=true + metadata.tier (setup script above);
    // an account without them fails HERE, loudly, which is the correct
    // signal that provisioning is incomplete.
    const planCards = page.locator('[data-testid^="card-plan-"]');
    await expect(planCards.first()).toBeVisible({ timeout: 30_000 });

    // ── 2. An upgrade button exists (org is 'pro', so Starter/Scale offer
    // Upgrade; the current tier offers Manage instead) ────────────────────
    const upgradeButton = page.locator('[data-testid^="button-upgrade-"]').first();
    await expect(upgradeButton).toBeVisible();

    // ── 3. Tap upgrade → the SPA POSTs /api/stripe/checkout (real session
    // creation, owner's canManageBilling permission, idempotency key) and
    // hands the browser to Stripe-hosted checkout ─────────────────────────
    await upgradeButton.click();
    // Hostname-exact (not substring/regex): a substring match on the URL
    // would also accept e.g. evil.example/checkout.stripe.com (CodeQL
    // js/incomplete-url-substring-sanitization).
    await page.waitForURL((url) => url.hostname === "checkout.stripe.com", {
      timeout: 45_000,
    });
    expect(new URL(page.url()).hostname).toBe("checkout.stripe.com");
  });
});
