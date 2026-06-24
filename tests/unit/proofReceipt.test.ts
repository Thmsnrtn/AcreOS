import { describe, it, expect } from "vitest";
import {
  buildReceipt,
  verifyReceipt,
  hashPayload,
  ART50_DISCLOSURE,
  CONSTITUTION_VERSION_HASH,
  PROOF_RECEIPT_VERSION,
  type ProofReceipt,
  type ProofReceiptInput,
} from "../../server/services/autopilot/proofReceipt";
import { PLATFORM_SCOPE, orgScope } from "../../server/services/autopilot/tenantScope";

const ISSUED = "2026-06-24T12:00:00.000Z";

function sample(overrides: Partial<ProofReceiptInput> = {}): ProofReceipt {
  return buildReceipt(
    {
      actionKind: "send_email",
      scope: orgScope(42),
      payloadHash: hashPayload({ to: "x@y.com", subject: "Hi" }),
      accountableHumanId: "user_abc",
      ...overrides,
    },
    ISSUED,
  );
}

describe("buildReceipt — sealed, principal-attributed proof", () => {
  it("captures the full attribution and seals it with a hash", () => {
    const r = sample();
    expect(r.v).toBe(PROOF_RECEIPT_VERSION);
    expect(r.actionKind).toBe("send_email");
    expect(r.scope).toBe("org:42");
    expect(r.orgId).toBe(42);
    expect(r.accountableHumanId).toBe("user_abc");
    expect(r.disclosure).toBe(ART50_DISCLOSURE);
    expect(r.constitutionVersionHash).toBe(CONSTITUTION_VERSION_HASH);
    expect(r.issuedAt).toBe(ISSUED);
    expect(r.receiptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic — same input + issuedAt → identical hash", () => {
    expect(sample().receiptHash).toBe(sample().receiptHash);
  });

  it("platform scope records orgId null", () => {
    const r = sample({ scope: PLATFORM_SCOPE } as never);
    expect(r.scope).toBe("platform");
    expect(r.orgId).toBeNull();
  });

  it("a different payload yields a different seal", () => {
    const a = sample();
    const b = sample({ payloadHash: hashPayload({ to: "z@y.com" }) } as never);
    expect(a.receiptHash).not.toBe(b.receiptHash);
  });
});

describe("verifyReceipt — integrity proof", () => {
  it("accepts an untampered receipt", () => {
    const v = verifyReceipt(sample());
    expect(v.valid).toBe(true);
    expect(v.constitutionMatchesCurrent).toBe(true);
  });

  it("detects a tampered field (the seal no longer matches the body)", () => {
    const r = sample();
    const tampered = { ...r, payloadHash: hashPayload({ to: "attacker@evil.com" }) };
    const v = verifyReceipt(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/tampered/i);
  });

  it("detects a swapped accountable human", () => {
    const r = sample();
    const v = verifyReceipt({ ...r, accountableHumanId: "user_someone_else" });
    expect(v.valid).toBe(false);
  });

  it("rejects an unsupported version", () => {
    const r = sample();
    const v = verifyReceipt({ ...r, v: 99 as unknown as ProofReceipt["v"] });
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/version/i);
  });

  it("flags (without invalidating) a receipt issued under a different constitution", () => {
    const r = sample();
    // Re-seal a receipt that records a different constitution hash so the body
    // is internally consistent (untampered) but no longer matches CURRENT.
    const stale = buildReceiptWithConstitution(r, "deadbeef".repeat(8));
    const v = verifyReceipt(stale);
    expect(v.valid).toBe(true); // integrity intact
    expect(v.constitutionMatchesCurrent).toBe(false); // but constitution moved on
  });
});

// Helper: forge an internally-consistent receipt that records a chosen
// constitution hash (re-seals the body so verifyReceipt sees no tampering).
function buildReceiptWithConstitution(base: ProofReceipt, constitutionVersionHash: string): ProofReceipt {
  const { receiptHash: _omit, ...body } = { ...base, constitutionVersionHash };
  // Recompute the seal the same way the module does (canonical sorted-key sha256).
  // We import the internal hashing indirectly by round-tripping through buildReceipt
  // is not possible (it forces the current hash), so reuse hashPayload over the body.
  const receiptHash = hashPayload(body);
  return { ...body, receiptHash };
}
