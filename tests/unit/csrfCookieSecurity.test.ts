/**
 * The CSRF cookie's `Secure` attribute may be relaxed for the E2E bypass, and NOWHERE ELSE.
 *
 * `csrf_token` is a double-submit cookie: the server sets it, JavaScript reads
 * it, and the client mirrors it into `x-csrf-token`. A cookie marked `Secure`
 * is DROPPED by the browser on an insecure origin — and the mobile E2E runs a
 * PRODUCTION build over plain `http://localhost:5000`.
 *
 * Chromium grants localhost a trustworthy-origin exception and keeps the
 * cookie. WEBKIT DOES NOT. So on every WebKit device `document.cookie` held no
 * `csrf_token`, the client sent an empty header, and every mutation came back
 * 403 "CSRF token validation failed" — including approving or rejecting a Pax
 * ask. The suite reported a product failure for a request that never reached
 * the product.
 *
 * The relaxation is gated on `e2eTestAuthEnabled()`, which is already
 * hard-gated twice over: it requires `E2E_TEST_AUTH=1` AND the absence of
 * `FLY_APP_NAME`, and the server FATALs on boot if that flag is ever seen on a
 * Fly machine. This suite pins the property that matters — THE FLAG ALONE IS
 * NOT ENOUGH. On a Fly machine the cookie stays `Secure` even with the flag
 * set, because a leaked env var must not be able to downgrade a security
 * attribute in a deployed environment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = { ...process.env };

/** Issue the cookie under a given environment and report the options used. */
type CookieOptions = Record<string, unknown>;

async function cookieOptionsUnder(
  env: Record<string, string | undefined>,
): Promise<CookieOptions | null> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const { csrfProtection } = await import("../../server/middleware/csrf");

  // Captured through an object rather than a bare `let`: TypeScript does not
  // track assignments made inside the callback, so a `let … = null` narrows to
  // `never` at every read below and the file stops type-checking — which the
  // check-tests-typecheck gate correctly refuses.
  const captured: { options: CookieOptions | null } = { options: null };
  const req = { method: "GET", path: "/api/anything", cookies: {}, headers: {} } as never;
  const res = {
    cookie: (_name: string, _value: string, opts: CookieOptions) => {
      captured.options = opts;
    },
  } as never;
  csrfProtection(req, res, () => {});
  return captured.options;
}

beforeEach(() => {
  for (const k of ["NODE_ENV", "E2E_TEST_AUTH", "FLY_APP_NAME"]) delete process.env[k];
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("csrf_token cookie: Secure is relaxed only under the hard-gated E2E bypass", () => {
  it("is Secure in production", async () => {
    const opts = await cookieOptionsUnder({
      NODE_ENV: "production",
      E2E_TEST_AUTH: undefined,
      FLY_APP_NAME: undefined,
    });
    expect(opts, "no cookie was issued at all").toBeTruthy();
    expect(opts!.secure).toBe(true);
    // Vacuity: the reader must be seeing the real options object, or "secure
    // is true" would be indistinguishable from reading nothing.
    expect(opts!.httpOnly).toBe(false);
    expect(opts!.sameSite).toBe("lax");
  });

  it("is relaxed under the E2E bypass off Fly, so WebKit keeps the cookie over http", async () => {
    const opts = await cookieOptionsUnder({
      NODE_ENV: "production",
      E2E_TEST_AUTH: "1",
      FLY_APP_NAME: undefined,
    });
    expect(opts!.secure).toBe(false);
    expect(opts!.httpOnly).toBe(false);
  });

  it("STAYS Secure on a Fly machine even with the E2E flag set", async () => {
    // The security-critical case. A leaked E2E_TEST_AUTH in a deployed
    // environment must not be able to downgrade the attribute — the absence of
    // FLY_APP_NAME is the second half of the gate, not decoration.
    const opts = await cookieOptionsUnder({
      NODE_ENV: "production",
      E2E_TEST_AUTH: "1",
      FLY_APP_NAME: "acreos-prod",
    });
    expect(opts!.secure).toBe(true);
  });

  it("is not Secure outside production, with or without the flag", async () => {
    for (const flag of [undefined, "1"]) {
      const opts = await cookieOptionsUnder({
        NODE_ENV: "development",
        E2E_TEST_AUTH: flag,
        FLY_APP_NAME: undefined,
      });
      expect(opts!.secure).toBe(false);
    }
  });
});
