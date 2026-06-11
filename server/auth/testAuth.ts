/**
 * E2E test-auth bypass — lets the Playwright suite exercise the
 * authenticated app in CI without a live Clerk session.
 *
 * SAFETY (read before touching):
 * The bypass is active ONLY when `E2E_TEST_AUTH=1` AND we are NOT running
 * on Fly. Fly sets `FLY_APP_NAME` on every machine in every environment
 * (app + worker, staging + prod), so the `FLY_APP_NAME` guard makes it
 * impossible for this to activate on any deployed instance — even if the
 * flag somehow leaked into a deploy. `E2E_TEST_AUTH` is set only by the
 * Playwright webServer / CI e2e job and appears in no deploy config.
 *
 * `assertTestAuthSafe()` is called at startup and HARD-EXITS the process
 * if the flag is ever seen alongside `FLY_APP_NAME` — defense in depth.
 *
 * When active:
 *  - isAuthenticated injects a fixed test user id (E2E_TEST_USER_ID), OR —
 *    when the request's `__session` cookie equals E2E_FOUNDER_COOKIE — the
 *    founder test user id (E2E_FOUNDER_USER_ID). Two identities let the
 *    suite cover BOTH sides of the founder gate: the customer user must
 *    never see founder tabs/codenames (pax-founder-gate.spec.ts), and
 *    founder-positive specs can assert what Tom sees. The workflow points
 *    FOUNDER_EMAIL/FOUNDER_EMAILS at the founder user's email ONLY, so the
 *    customer identity is genuinely a non-founder.
 *  - the /__clerk proxy returns 404 so Clerk-JS fails to load client-side
 *    and the SPA renders via the API-based useAuth (no FAPI redirect to a
 *    domain CI can't resolve).
 */

export const E2E_TEST_USER_ID = process.env.E2E_TEST_USER_ID || "e2e_test_user";
export const E2E_FOUNDER_USER_ID =
  process.env.E2E_FOUNDER_USER_ID || "e2e_founder_user";

/**
 * Sentinel `__session` cookie value that selects the founder test identity.
 * Any other value (specs use "e2e") resolves to the customer identity.
 */
export const E2E_FOUNDER_COOKIE = "e2e-founder";

/**
 * Pick the test identity for this request from its raw Cookie header.
 * Only meaningful when e2eTestAuthEnabled() — callers gate on that.
 */
export function resolveTestUserId(cookieHeader: string | undefined): string {
  if (!cookieHeader) return E2E_TEST_USER_ID;
  const match = /(?:^|;\s*)__session=([^;]+)/.exec(cookieHeader);
  return match?.[1] === E2E_FOUNDER_COOKIE
    ? E2E_FOUNDER_USER_ID
    : E2E_TEST_USER_ID;
}

/** True only in a non-Fly environment with the explicit E2E flag set. */
export function e2eTestAuthEnabled(): boolean {
  return process.env.E2E_TEST_AUTH === "1" && !process.env.FLY_APP_NAME;
}

/**
 * Fail-safe: refuse to boot if the E2E flag is present on a Fly machine.
 * Call once at startup. A no-op everywhere the flag isn't set.
 */
export function assertTestAuthSafe(): void {
  if (process.env.E2E_TEST_AUTH === "1" && process.env.FLY_APP_NAME) {
    // eslint-disable-next-line no-console
    console.error(
      "[FATAL] E2E_TEST_AUTH=1 detected on a Fly machine " +
        `(FLY_APP_NAME=${process.env.FLY_APP_NAME}). The test-auth bypass must ` +
        "never run on a deployed instance. Refusing to start.",
    );
    process.exit(1);
  }
}
