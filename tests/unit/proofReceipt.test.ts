import { describe, it, expect } from "vitest";
import {
  buildReceipt,
  verifyReceipt,
  hashPayload,
  hashDecisionInputs,
  scorePrediction,
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

describe("Frontier #4 — prediction-sealed, replayable, cause-allocable", () => {
  const withPrediction = (overrides: Partial<ProofReceiptInput> = {}) =>
    sample({
      prediction: { pSuccess: 0.8, expectedValueUsd: 120, predictedCostUsd: 2, basis: "contextualForecast" },
      inputsHash: hashDecisionInputs({ situation: "stalled", candidates: ["a", "b"], chosen: "a" }),
      causeAllocation: { lever: "recover_payment", moveKind: "dunning_action", weight: 1 },
      ...overrides,
    });

  it("the current build emits v2 receipts", () => {
    expect(PROOF_RECEIPT_VERSION).toBe(2);
    expect(withPrediction().v).toBe(2);
  });

  it("the sealed prediction is part of the integrity seal — editing it is tampering", () => {
    const r = withPrediction();
    expect(verifyReceipt(r).valid).toBe(true);
    const forged = { ...r, prediction: { ...r.prediction!, pSuccess: 0.01 } };
    expect(verifyReceipt(forged).valid).toBe(false); // can't rewrite the forecast after the fact
  });

  it("the inputsHash + causeAllocation are sealed too", () => {
    const r = withPrediction();
    expect(verifyReceipt({ ...r, inputsHash: "rewritten" }).valid).toBe(false);
    expect(verifyReceipt({ ...r, causeAllocation: { ...r.causeAllocation!, lever: "other" } }).valid).toBe(false);
  });

  it("scorePrediction grades the sealed forecast against reality (Brier)", () => {
    const confident = withPrediction({ prediction: { pSuccess: 0.9, expectedValueUsd: null, predictedCostUsd: null, basis: "x" } });
    const hit = scorePrediction(confident, true)!;
    expect(hit.brier).toBeCloseTo(0.01, 6); // (0.9-1)^2
    expect(hit.surprised).toBe(false);
    const miss = scorePrediction(confident, false)!;
    expect(miss.brier).toBeCloseTo(0.81, 6); // (0.9-0)^2 — confidently wrong
    expect(miss.surprised).toBe(true);
  });

  it("scorePrediction abstains (null) when the brain sealed no pSuccess", () => {
    const noP = withPrediction({ prediction: { pSuccess: null, expectedValueUsd: 1, predictedCostUsd: 1, basis: "x" } });
    expect(scorePrediction(noP, true)).toBeNull();
    expect(scorePrediction(sample(), true)).toBeNull(); // no prediction at all
  });

  it("a receipt with no Frontier-#4 fields still seals + verifies (honest abstention)", () => {
    const r = sample(); // prediction/inputsHash/causeAllocation default to null
    expect(verifyReceipt(r).valid).toBe(true);
    expect(r.prediction).toBeNull();
  });

  it("hashDecisionInputs is deterministic + order-insensitive (the replay anchor)", () => {
    const a = hashDecisionInputs({ x: 1, y: [2, 3], z: "q" });
    const b = hashDecisionInputs({ z: "q", y: [2, 3], x: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(hashDecisionInputs({ x: 1 })).not.toBe(a);
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
