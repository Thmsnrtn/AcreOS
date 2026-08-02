import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mintImpersonationToken,
  verifyImpersonationToken,
  isMutatingMethod,
  IMPERSONATION_TTL_MS,
} from "../../server/services/impersonation";

/**
 * Real read-only impersonation (Phase 0 audit — CISO / Head of CS). The prior
 * endpoint returned readOnly/expiry claims that NOTHING enforced. This pins the
 * enforced mechanism: a signed, expiring token that only verifies for the right
 * founder, and the mutating-method classifier the middleware uses to block writes.
 */
describe("impersonation token", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "test-impersonation-secret";
  });

  const NOW = 1_000_000_000_000;

  it("mints a token that verifies within its TTL", () => {
    const minted = mintImpersonationToken("founder_1", 42, NOW);
    expect(minted).not.toBeNull();
    const session = verifyImpersonationToken(minted!.token, NOW + 1000);
    expect(session).toEqual({ founderUserId: "founder_1", targetOrgId: 42, expiresAt: NOW + IMPERSONATION_TTL_MS });
  });

  it("rejects an expired token", () => {
    const minted = mintImpersonationToken("founder_1", 42, NOW)!;
    expect(verifyImpersonationToken(minted.token, NOW + IMPERSONATION_TTL_MS)).toBeNull(); // exactly at expiry
    expect(verifyImpersonationToken(minted.token, NOW + IMPERSONATION_TTL_MS + 1)).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const minted = mintImpersonationToken("founder_1", 42, NOW)!;
    const [body, sig] = minted.token.split(".");
    // Swap the org id in the payload but keep the old signature.
    const forgedBody = Buffer.from(JSON.stringify({ founderUserId: "founder_1", targetOrgId: 999, expiresAt: NOW + IMPERSONATION_TTL_MS })).toString("base64url");
    expect(verifyImpersonationToken(`${forgedBody}.${sig}`, NOW + 1000)).toBeNull();
    expect(verifyImpersonationToken(`${body}.deadbeef`, NOW + 1000)).toBeNull();
    expect(verifyImpersonationToken("garbage", NOW + 1000)).toBeNull();
    expect(verifyImpersonationToken(undefined, NOW + 1000)).toBeNull();
  });

  it("classifies mutating vs safe HTTP methods", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post"]) expect(isMutatingMethod(m)).toBe(true);
    for (const m of ["GET", "HEAD", "OPTIONS", "get"]) expect(isMutatingMethod(m)).toBe(false);
  });
});

/**
 * Regression guard for the two bugs the adversarial security review found:
 * getOrCreateOrg performs org-state writes (founder self-upgrade + activity
 * heartbeat) AFTER the org is swapped, which during impersonation would mutate
 * the TARGET tenant on a mere GET — outside the method-based read-only guard.
 * A full middleware integration test needs a live DB; this pins the source
 * invariant that both writes are gated on `!impersonation`, and that the token
 * is minted with the same identity domain getOrCreateOrg compares (DB user id).
 */
describe("impersonation middleware write-safety (source invariants)", () => {
  const mw = readFileSync(resolve(__dirname, "../../server/middleware/getOrCreateOrg.ts"), "utf8");
  const admin = readFileSync(resolve(__dirname, "../../server/routes-admin.ts"), "utf8");

  it("gates the founder self-upgrade on !impersonation", () => {
    expect(mw).toMatch(/}\s*else if \(!impersonation && isFounder && !org\.isFounder\)/);
  });

  it("gates the activity heartbeat on !impersonation", () => {
    expect(mw).toMatch(/if \(!impersonation && Date\.now\(\) - lastActiveTs > HEARTBEAT_MS\)/);
  });

  it("compares the token founderUserId against the same domain it is minted with", () => {
    // getOrCreateOrg compares session.founderUserId === userId (userId = user.id, DB UUID)
    expect(mw).toMatch(/session\.founderUserId === userId/);
    // the mint must therefore use the DB user id, not the Clerk id
    expect(admin).toMatch(/founderDbUserId = String\(req\.user\.id/);
    expect(admin).toMatch(/mintImpersonationToken\(founderDbUserId,/);
  });
});

describe("impersonation token (secret fallback)", () => {
  const NOW = 1_000_000_000_000;
  it("fails safe (returns null) when no signing secret is configured", () => {
    const saved = process.env.SESSION_SECRET;
    const savedClerk = process.env.CLERK_SECRET_KEY;
    delete process.env.SESSION_SECRET;
    delete process.env.CLERK_SECRET_KEY;
    try {
      expect(mintImpersonationToken("f", 1, NOW)).toBeNull();
    } finally {
      if (saved) process.env.SESSION_SECRET = saved;
      if (savedClerk) process.env.CLERK_SECRET_KEY = savedClerk;
    }
  });
});
