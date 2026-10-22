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

import { logger } from "../utils/logger";

export const E2E_TEST_USER_ID = process.env.E2E_TEST_USER_ID || "e2e_test_user";
export const E2E_FOUNDER_USER_ID =
  process.env.E2E_FOUNDER_USER_ID || "e2e_founder_user";

/**
 * Sentinel `__session` cookie value that selects the founder test identity.
 * Any other value (specs use "e2e") resolves to the customer identity.
 */
export const E2E_FOUNDER_COOKIE = "e2e-founder";

/**
 * Prefix for the customer-persona suite. A `__session=e2e-persona-<slug>`
 * cookie resolves to a STABLE, DISTINCT customer user id (`e2e_persona_<slug>`)
 * so each of the 30 persona browser contexts auto-provisions its OWN isolated
 * org via getOrCreateOrg — letting one Playwright run drive many genuinely
 * separate tenants. The slug is sanitized to [a-z0-9_] so a hostile cookie
 * can never inject anything into the resolved id. Still gated by
 * e2eTestAuthEnabled() (never active on Fly). See tests/personas/.
 */
export const E2E_PERSONA_COOKIE_PREFIX = "e2e-persona-";

/** The stable test user id a given persona slug resolves to. */
export function personaTestUserId(slug: string): string {
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return clean ? `e2e_persona_${clean}` : E2E_TEST_USER_ID;
}

/** The `__session` cookie value a persona slug should set to claim its identity. */
export function personaCookieValue(slug: string): string {
  return `${E2E_PERSONA_COOKIE_PREFIX}${slug}`;
}

/**
 * Pick the test identity for this request from its raw Cookie header.
 * Only meaningful when e2eTestAuthEnabled() — callers gate on that.
 */
export function resolveTestUserId(cookieHeader: string | undefined): string {
  if (!cookieHeader) return E2E_TEST_USER_ID;
  const match = /(?:^|;\s*)__session=([^;]+)/.exec(cookieHeader);
  const value = match?.[1];
  if (!value) return E2E_TEST_USER_ID;
  if (value === E2E_FOUNDER_COOKIE) return E2E_FOUNDER_USER_ID;
  if (value.startsWith(E2E_PERSONA_COOKIE_PREFIX)) {
    return personaTestUserId(value.slice(E2E_PERSONA_COOKIE_PREFIX.length));
  }
  return E2E_TEST_USER_ID;
}

export interface SyntheticTestProfile {
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * The synthetic profile for an E2E test identity, mirroring what the E2E
 * global setup seeds into its throwaway database
 * (tests/e2e-mobile/global-setup.ts). Returns null for any id that is not
 * a test identity.
 *
 * hydrateUser uses this when a request authenticated through the E2E
 * bypass (blanket flag or staging token) resolves to an identity with no
 * users row: Clerk has never heard of these ids, so the normal
 * auto-provisioning call (clerkClient.users.getUser) throws a Clerk 404
 * and EVERY authenticated request 404s with it. Provisioning the row
 * locally keeps the bypass self-contained — the target database does not
 * need the seed the CI global setup applies to its own Postgres.
 */
export function resolveSyntheticTestProfile(
  userId: string,
): SyntheticTestProfile | null {
  if (userId === E2E_TEST_USER_ID) {
    return { email: "e2e@acreos.test", firstName: "E2E", lastName: "Customer" };
  }
  if (userId === E2E_FOUNDER_USER_ID) {
    return {
      email: "founder-e2e@acreos.test",
      firstName: "E2E",
      lastName: "Founder",
    };
  }
  if (userId.startsWith("e2e_persona_")) {
    const slug = userId.slice("e2e_persona_".length);
    if (slug) {
      return {
        email: `e2e-persona-${slug}@acreos.test`,
        firstName: "E2E",
        lastName: "Persona",
      };
    }
  }
  return null;
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
    logger.error(
      "[FATAL] E2E_TEST_AUTH=1 detected on a Fly machine " +
        `(FLY_APP_NAME=${process.env.FLY_APP_NAME}). The test-auth bypass must ` +
        "never run on a deployed instance. Refusing to start.",
    );
    process.exit(1);
  }
}

/**
 * Token-gated E2E bypass for Fly staging.
 *
 * Unlike e2eTestAuthEnabled() (blanket bypass, disabled on Fly by design),
 * this allows CI to authenticate E2E tests against staging using a shared
 * secret token.
 *
 * SAFETY:
 * - Only active when E2E_TEST_AUTH_TOKEN is set. This env var must NEVER
 *   be set on production. It is set as a Fly secret on acreos-staging only.
 * - The token is compared using timing-safe equality to prevent timing attacks.
 * - The token must be provided via the X-E2E-Auth-Token header.
 * - All activations are logged for audit.
 * - The token should be a high-entropy random value, rotated periodically.
 */
export function e2eTokenAuthValid(providedToken: string | undefined): boolean {
  const expected = process.env.E2E_TEST_AUTH_TOKEN;
  if (!expected || !providedToken) return false;

  // Timing-safe comparison to prevent timing attacks
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(providedToken, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;

  // Use timingSafeEqual from node:crypto
  try {
    const { timingSafeEqual } = require("node:crypto");
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    // Fallback (should not happen on Node 18+)
    return false;
  }
}

/**
 * Check if the current request carries a valid E2E token.
 * Used by isAuthenticated and the global Clerk middleware bypass.
 */
export function e2eTokenAuthEnabled(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const token = req.headers["x-e2e-auth-token"];
  const tokenStr = Array.isArray(token) ? token[0] : token;
  if (e2eTokenAuthValid(tokenStr)) {
    logger.info("[e2e-token-auth] Valid token presented, bypassing Clerk for E2E test");
    return true;
  }
  return false;
}

/**
 * True when this request is E2E test traffic: the blanket local flag, or a
 * valid staging token on the request. Silent (no per-call log line) — it is
 * read by the rate limiters on every request.
 *
 * The limiters already skip the blanket flag because every spec shares ONE
 * test user against one server, so a per-user budget throttles the suite
 * rather than any abuser. The staging token path (e2eTokenAuthEnabled) was
 * added later without the same exemption, and the customer-journey audit —
 * nine viewports × two themes walking full page loads as that one user —
 * spent the 300/min per-user budget and 429'd its own /today ("Slow down",
 * Today stuck on "Loading AcreOS…"; measured locally 2026-10-21, issue #359).
 * Production is unaffected: E2E_TEST_AUTH_TOKEN is never set there, so
 * e2eTokenAuthValid() is false for every request.
 */
export function isE2eTestTraffic(req: { headers?: Record<string, string | string[] | undefined> }): boolean {
  if (e2eTestAuthEnabled()) return true;
  const token = req.headers?.["x-e2e-auth-token"];
  return e2eTokenAuthValid(Array.isArray(token) ? token[0] : token);
}
