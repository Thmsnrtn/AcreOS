/**
 * authConfigDiagnostic — the secret-free auth-config self-check that turns a
 * silent all-requests-401 outage into a one-line, actionable cause.
 *
 * The whole contract is: report ENV PRESENCE + SHAPE only, never key bytes,
 * and name the single most likely cause in the right priority order.
 */
import { describe, expect, it } from "vitest";
import {
  computeAuthConfigReport,
  type KeyMode,
} from "../../server/services/authConfigDiagnostic";

const PEM =
  "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END PUBLIC KEY-----";

function env(over: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return over as NodeJS.ProcessEnv;
}

describe("computeAuthConfigReport", () => {
  it("reports a healthy config when secret + matching publishable + PEM jwt key are set", () => {
    const r = computeAuthConfigReport(
      env({
        CLERK_SECRET_KEY: "sk_live_abc",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_abc",
        CLERK_JWT_KEY: PEM,
      }),
    );
    expect(r.clerkSecretKeyMode).toBe<KeyMode>("live");
    expect(r.clerkPublishableKeyMode).toBe<KeyMode>("live");
    expect(r.clerkJwtKeyPresent).toBe(true);
    expect(r.clerkJwtKeyLooksLikePem).toBe(true);
    expect(r.modeMismatch).toBe(false);
    expect(r.likelyCause).toBe("none");
  });

  it("flags a missing secret key as the most fundamental cause", () => {
    const r = computeAuthConfigReport(env({ CLERK_JWT_KEY: PEM }));
    expect(r.clerkSecretKeyMode).toBe<KeyMode>("missing");
    expect(r.likelyCause).toBe("secret_key_missing");
  });

  it("flags a live-vs-test mismatch between secret and publishable keys", () => {
    const r = computeAuthConfigReport(
      env({
        CLERK_SECRET_KEY: "sk_live_abc",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_abc",
        CLERK_JWT_KEY: PEM,
      }),
    );
    expect(r.modeMismatch).toBe(true);
    expect(r.likelyCause).toBe("mode_mismatch");
    expect(r.hint).toContain("SAME Clerk instance");
  });

  it("flags a missing CLERK_JWT_KEY when secret is set and modes agree (or publishable absent)", () => {
    const r = computeAuthConfigReport(env({ CLERK_SECRET_KEY: "sk_live_abc" }));
    expect(r.clerkPublishableKeyMode).toBe<KeyMode>("missing");
    expect(r.modeMismatch).toBe(false); // an unknown publishable can't mismatch
    expect(r.clerkJwtKeyPresent).toBe(false);
    expect(r.likelyCause).toBe("jwt_key_missing");
  });

  it("flags a present-but-malformed CLERK_JWT_KEY (bare base64, no PEM envelope)", () => {
    const r = computeAuthConfigReport(
      env({
        CLERK_SECRET_KEY: "sk_live_abc",
        CLERK_JWT_KEY: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A", // no BEGIN/END lines
      }),
    );
    expect(r.clerkJwtKeyPresent).toBe(true);
    expect(r.clerkJwtKeyLooksLikePem).toBe(false);
    expect(r.likelyCause).toBe("jwt_key_malformed");
    expect(r.hint).toContain("PEM");
  });

  it("accepts an RSA PUBLIC KEY envelope as a valid PEM shape", () => {
    const rsaPem =
      "-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEA\n-----END RSA PUBLIC KEY-----";
    const r = computeAuthConfigReport(
      env({ CLERK_SECRET_KEY: "sk_live_abc", CLERK_JWT_KEY: rsaPem }),
    );
    expect(r.clerkJwtKeyLooksLikePem).toBe(true);
    expect(r.likelyCause).toBe("none");
  });

  it("never returns key material — only modes, booleans, and a hint string", () => {
    const r = computeAuthConfigReport(
      env({
        CLERK_SECRET_KEY: "sk_live_SUPERSECRETVALUE",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_PUBLISHABLEVALUE",
        CLERK_JWT_KEY: PEM,
      }),
    );
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("SUPERSECRETVALUE");
    expect(serialized).not.toContain("PUBLISHABLEVALUE");
    expect(serialized).not.toContain("MIIBIjAN");
  });

  it("treats an unrecognized key prefix as 'unknown', not a false mismatch", () => {
    const r = computeAuthConfigReport(
      env({
        CLERK_SECRET_KEY: "weird_value",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_live_abc",
        CLERK_JWT_KEY: PEM,
      }),
    );
    expect(r.clerkSecretKeyMode).toBe<KeyMode>("unknown");
    expect(r.modeMismatch).toBe(false);
  });
});
