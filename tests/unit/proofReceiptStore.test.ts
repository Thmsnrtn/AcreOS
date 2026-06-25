import { describe, it, expect, vi } from "vitest";

// proofReceiptStore imports the db barrel at module load; stub it so this pure-
// logic test never touches a real connection (verifyReceiptSequence/rowToReceipt
// don't call it, but the import must resolve).
vi.mock("../../server/db", () => ({ db: {} }));

import { verifyReceiptSequence, rowToReceipt } from "../../server/services/autopilot/proofReceiptStore";
import { buildReceipt, hashPayload, GENESIS_RECEIPT_HASH, type ProofReceipt } from "../../server/services/autopilot/proofReceipt";
import { orgScope } from "../../server/services/autopilot/tenantScope";
import type { ProofReceiptRow } from "@shared/schema";

function chainOf(n: number): ProofReceipt[] {
  const out: ProofReceipt[] = [];
  let prev = GENESIS_RECEIPT_HASH;
  for (let i = 0; i < n; i++) {
    const r = buildReceipt(
      {
        actionKind: "send_email",
        scope: orgScope(7),
        payloadHash: `hash-${i}`,
        accountableHumanId: "founder_1",
        prevReceiptHash: prev,
      },
      `2026-06-24T12:0${i}:00.000Z`,
    );
    out.push(r);
    prev = r.receiptHash;
  }
  return out;
}

describe("verifyReceiptSequence — chained tamper-evidence", () => {
  it("verifies a well-formed chain", () => {
    const v = verifyReceiptSequence(chainOf(3));
    expect(v.ok).toBe(true);
    expect(v.count).toBe(3);
  });

  it("accepts the empty chain", () => {
    expect(verifyReceiptSequence([]).ok).toBe(true);
  });

  it("detects a tampered receipt (per-row seal breaks)", () => {
    const chain = chainOf(3);
    chain[1] = { ...chain[1], payloadHash: "tampered" }; // reseal NOT recomputed
    const v = verifyReceiptSequence(chain);
    expect(v.ok).toBe(false);
    expect(v.failedAtIndex).toBe(1);
    expect(v.reason).toMatch(/tampered/i);
  });

  it("detects a broken chain link (re-sealed but mislinked)", () => {
    const chain = chainOf(3);
    // Build a valid receipt that points at the WRONG predecessor, then splice.
    const mislinked = buildReceipt(
      {
        actionKind: "send_email",
        scope: orgScope(7),
        payloadHash: "x",
        accountableHumanId: "founder_1",
        prevReceiptHash: "WRONG_PREV",
      },
      "2026-06-24T12:09:00.000Z",
    );
    chain[1] = mislinked; // internally valid, but its prev != chain[0].receiptHash
    const v = verifyReceiptSequence(chain);
    expect(v.ok).toBe(false);
    expect(v.failedAtIndex).toBe(1);
    expect(v.reason).toMatch(/chain link broken/i);
  });
});

describe("rowToReceipt — DB row round-trips to a verifiable receipt", () => {
  it("reconstructs a receipt whose seal still verifies", () => {
    const original = chainOf(1)[0];
    const row: ProofReceiptRow = {
      id: 1,
      organizationId: 7,
      scope: original.scope,
      actionKind: original.actionKind,
      payloadHash: original.payloadHash,
      accountableHumanId: original.accountableHumanId,
      constitutionVersion: original.constitutionVersion,
      constitutionVersionHash: original.constitutionVersionHash,
      gateResults: original.gateResults,
      evalScore: original.evalScore,
      costUsd: original.costUsd,
      autonomyLevel: original.autonomyLevel,
      situationHash: original.situationHash,
      receiptVersion: 2,
      prediction: original.prediction ?? null,
      inputsHash: original.inputsHash ?? null,
      causeAllocation: original.causeAllocation ?? null,
      disclosure: original.disclosure,
      issuedAt: original.issuedAt,
      prevReceiptHash: original.prevReceiptHash,
      receiptHash: original.receiptHash,
      createdAt: new Date(),
    };
    const reconstructed = rowToReceipt(row);
    expect(reconstructed).toEqual(original); // exact field-for-field match
    expect(verifyReceiptSequence([reconstructed]).ok).toBe(true);
  });

  it("a LEGACY v1 row (no prediction columns) still round-trips + verifies", () => {
    // A v1 receipt was sealed WITHOUT the Frontier #4 fields — its hash covers
    // the legacy body shape. rowToReceipt must reconstruct that exact shape
    // (omitting the new keys) so the seal still matches.
    const original = chainOf(1)[0];
    // Recompute a genuine v1 seal over the legacy body (no new fields).
    const legacyBody = {
      v: 1 as const,
      actionKind: original.actionKind,
      scope: original.scope,
      orgId: original.orgId,
      payloadHash: original.payloadHash,
      accountableHumanId: original.accountableHumanId,
      constitutionVersion: original.constitutionVersion,
      constitutionVersionHash: original.constitutionVersionHash,
      gateResults: original.gateResults,
      evalScore: original.evalScore,
      costUsd: original.costUsd,
      autonomyLevel: original.autonomyLevel,
      situationHash: original.situationHash,
      disclosure: original.disclosure,
      issuedAt: original.issuedAt,
      prevReceiptHash: original.prevReceiptHash,
    };
    const legacySeal = hashPayload(legacyBody);
    const row: ProofReceiptRow = {
      id: 1,
      organizationId: original.orgId,
      scope: original.scope,
      actionKind: original.actionKind,
      payloadHash: original.payloadHash,
      accountableHumanId: original.accountableHumanId,
      constitutionVersion: original.constitutionVersion,
      constitutionVersionHash: original.constitutionVersionHash,
      gateResults: original.gateResults,
      evalScore: original.evalScore,
      costUsd: original.costUsd,
      autonomyLevel: original.autonomyLevel,
      situationHash: original.situationHash,
      receiptVersion: 1,
      prediction: null,
      inputsHash: null,
      causeAllocation: null,
      disclosure: original.disclosure,
      issuedAt: original.issuedAt,
      prevReceiptHash: original.prevReceiptHash,
      receiptHash: legacySeal,
      createdAt: new Date(),
    };
    const reconstructed = rowToReceipt(row);
    expect(reconstructed.v).toBe(1);
    expect("prediction" in reconstructed).toBe(false); // legacy shape — key absent
    expect(verifyReceiptSequence([reconstructed]).ok).toBe(true); // seal still verifies
  });
});
