import { describe, it, expect, vi } from "vitest";

// proofReceiptStore imports the db barrel at module load; stub it so this pure-
// logic test never touches a real connection (verifyReceiptSequence/rowToReceipt
// don't call it, but the import must resolve).
vi.mock("../../server/db", () => ({ db: {} }));

import { verifyReceiptSequence, rowToReceipt } from "../../server/services/autopilot/proofReceiptStore";
import { buildReceipt, GENESIS_RECEIPT_HASH, type ProofReceipt } from "../../server/services/autopilot/proofReceipt";
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
});
