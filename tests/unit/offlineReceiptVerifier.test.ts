import { describe, it, expect } from "vitest";
import { verifyArtifact, verifyReceiptObject, verifyChain } from "../../scripts/verify-receipt.mjs";
import { buildReceipt, hashPayload } from "../../server/services/autopilot/proofReceipt";
import { assembleEvidencePacket } from "../../server/services/governance/evidencePacket";
import { orgScope, PLATFORM_SCOPE } from "../../server/services/autopilot/tenantScope";

/**
 * Frontier #14 — the offline verifier (scripts/verify-receipt.mjs) re-implements
 * the canonical hash, so these tests PIN it to the real app implementation: a
 * receipt built by buildReceipt MUST pass the standalone verifier, and any edit
 * MUST fail it. If the two hash implementations ever drift, this goes red.
 */

const ISSUED = "2026-06-24T12:00:00.000Z";
const realReceipt = (over = {}) =>
  buildReceipt(
    { actionKind: "send_email", scope: orgScope(7), payloadHash: hashPayload({ to: "x@y.com" }), accountableHumanId: "user_a", ...over },
    ISSUED,
  );

describe("offline verifier — pinned to the app's canonical hash (anti-drift)", () => {
  it("PASSES a genuine receipt built by buildReceipt (v2, prediction-sealed)", () => {
    const r = realReceipt({ prediction: { pSuccess: 0.7, expectedValueUsd: 1, predictedCostUsd: 1, basis: "x" }, inputsHash: hashPayload({ a: 1 }) });
    expect(verifyReceiptObject(r).valid).toBe(true);
    expect(verifyArtifact(r)).toMatchObject({ ok: true, kind: "receipt" });
  });

  it("FAILS a tampered receipt (any edited field breaks the recomputed seal)", () => {
    const r = realReceipt();
    expect(verifyReceiptObject({ ...r, payloadHash: "tampered" }).valid).toBe(false);
    expect(verifyReceiptObject({ ...r, accountableHumanId: "someone_else" }).valid).toBe(false);
  });

  it("rejects 'unknown' attribution + unsupported versions", () => {
    expect(verifyReceiptObject({ ...realReceipt(), accountableHumanId: "unknown" }).valid).toBe(false);
    expect(verifyReceiptObject({ ...realReceipt(), v: 99 }).valid).toBe(false);
  });
});

describe("offline verifier — chains", () => {
  const chainOf = (n) => {
    const out = [];
    let prev = "GENESIS";
    for (let i = 0; i < n; i++) {
      const r = buildReceipt(
        { actionKind: "send", scope: orgScope(7), payloadHash: `h${i}`, accountableHumanId: "user_a", prevReceiptHash: prev },
        `2026-06-24T12:0${i}:00.000Z`,
      );
      out.push(r);
      prev = r.receiptHash;
    }
    return out;
  };

  it("PASSES a well-formed chain and reports the count", () => {
    const v = verifyArtifact(chainOf(3));
    expect(v.ok).toBe(true);
    expect(v.kind).toBe("chain");
    expect(v.detail.count).toBe(3);
  });

  it("FAILS at the first broken link (re-sealed but mislinked)", () => {
    const chain = chainOf(3);
    // A properly-sealed receipt that points at the WRONG predecessor — its own
    // seal verifies, so only the chain-link check can catch it.
    chain[2] = buildReceipt(
      { actionKind: "send", scope: orgScope(7), payloadHash: "h2", accountableHumanId: "user_a", prevReceiptHash: "WRONG" },
      "2026-06-24T12:09:00.000Z",
    );
    const v = verifyChain(chain);
    expect(v.ok).toBe(false);
    expect(v.failedAtIndex).toBe(2);
    expect(v.reason).toMatch(/chain link broken/);
  });
});

describe("offline verifier — evidence packet", () => {
  it("PASSES a sealed evidence packet and FAILS an altered one", () => {
    const packet = assembleEvidencePacket({
      scope: PLATFORM_SCOPE,
      periodDays: 30,
      generatedAt: ISSUED,
      auditChainVerified: true,
      witnessedSends: { total: 2, byChannel: { email: 2 } },
      autonomy: [{ domain: "growth", level: "OBSERVE", cleanCycleCount: 0 }],
    });
    expect(verifyArtifact(packet)).toMatchObject({ ok: true, kind: "evidence-packet" });
    expect(verifyArtifact({ ...packet, periodDays: 999 }).ok).toBe(false);
  });

  it("rejects an unrecognized artifact", () => {
    expect(verifyArtifact({ foo: "bar" })).toMatchObject({ ok: false, kind: "unknown" });
  });
});
