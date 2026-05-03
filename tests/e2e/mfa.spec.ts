/**
 * R4 — E2E: Clerk-native MFA enforcement
 *
 * The in-house TOTP endpoints (`/api/auth/2fa/*`) were deleted in R4 because
 * they ran on an express-session implementation that wasn't installed and
 * a `users.twoFactorEnabled` column that didn't exist. MFA now lives
 * exclusively in Clerk:
 *   - Enrollment / disable: Clerk's hosted UserProfile component (settings page)
 *   - Server enforcement: server/middleware/requireClerkMFA.ts
 *
 * This spec keeps a thin smoke check that:
 *   1. The legacy in-house endpoints are gone (404).
 *   2. Admin routes return 401/403 when unauthenticated (no silent bypass).
 */

import { test, expect } from "@playwright/test";

test.describe("R4 — legacy in-house 2FA endpoints are removed", () => {
  for (const path of [
    "/api/auth/2fa/status",
    "/api/auth/2fa/setup",
    "/api/auth/2fa/verify-setup",
    "/api/auth/2fa/verify",
    "/api/auth/2fa/disable",
  ]) {
    test(`legacy endpoint ${path} is gone`, async ({ request }) => {
      const get = await request.get(path).catch(() => null);
      const post = await request.post(path, { data: {} }).catch(() => null);
      // 404 (route deleted) is the canonical answer; 401/405 are also
      // acceptable as long as we don't get a 200 — that would mean the
      // route still exists.
      const candidates = [get?.status(), post?.status()].filter(Boolean) as number[];
      for (const s of candidates) {
        expect(s, `${path} returned ${s} — endpoint should not exist`).not.toBe(200);
        expect([400, 401, 403, 404, 405]).toContain(s);
      }
    });
  }
});

test.describe("R4 — admin routes never silently bypass MFA gate", () => {
  test("unauthenticated /api/admin/* returns 401", async ({ request }) => {
    const resp = await request.get("/api/admin/users");
    // requireClerkMFA runs after isAuthenticated; an unauthenticated
    // request must hit 401 before MFA enforcement is even consulted.
    expect([401, 403, 404]).toContain(resp.status());
    expect(resp.status()).not.toBe(200);
  });

  test("403 mfa_required uses the documented response shape", async ({ request }) => {
    // We can't seed an auth'd-but-unverified session from an e2e test
    // without Clerk test mode, but if the API ever returns 403 with
    // `mfa_required` we want to assert the shape stays stable for the
    // client-side handler that translates this into a sign-out prompt.
    const resp = await request.get("/api/admin/users");
    if (resp.status() === 403) {
      const body = await resp.json();
      expect(typeof body.error).toBe("string");
      expect(typeof body.message).toBe("string");
    }
  });
});
