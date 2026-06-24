/**
 * ProofReceipt persistence + hash chain (Foundry move #3 persistence / follow-up).
 *
 * Writes each witnessed-action ProofReceipt to the append-only `proof_receipts`
 * table and links it to the previous receipt in the SAME scope chain (its
 * `prevReceiptHash` = the prior row's `receiptHash`), so the log is tamper-
 * evident as an ORDERED sequence — not just per-row.
 *
 * Two layers of integrity:
 *   • per-row seal — `receiptHash` over the canonical body (the authoritative
 *     check; survives any reordering),
 *   • chain link — `prevReceiptHash` ties row N to row N-1 in scope.
 *
 * Honest scoping: the per-row seal is the strong guarantee. The chain is
 * best-effort under concurrency (two witnessed actions in the same scope racing
 * could read the same predecessor and fork) — acceptable today because witnessed
 * actions are human-paced + low-volume + single-tenant. A high-volume multi-
 * tenant deployment would serialize this the way the audit_log chain does (a DB
 * trigger); `verifyReceiptChain` already reports a fork as a break.
 *
 * Composition layer (touches the DB) — NOT kernel; the kernel is proofReceipt.ts.
 */

import { desc, eq, asc } from "drizzle-orm";
import { db } from "../../db";
import { proofReceipts, type ProofReceiptRow } from "@shared/schema";
import {
  buildReceipt,
  verifyReceipt,
  GENESIS_RECEIPT_HASH,
  type ProofReceipt,
  type ProofReceiptInput,
} from "./proofReceipt";
import { describeScope, scopeOrgId } from "./tenantScope";
import { logger } from "../../utils/logger";

/** Latest receiptHash in a scope's chain, or GENESIS if the chain is empty. */
export async function getPrevReceiptHash(scopeStr: string): Promise<string> {
  const [row] = await db
    .select({ receiptHash: proofReceipts.receiptHash })
    .from(proofReceipts)
    .where(eq(proofReceipts.scope, scopeStr))
    .orderBy(desc(proofReceipts.id))
    .limit(1);
  return row?.receiptHash ?? GENESIS_RECEIPT_HASH;
}

/**
 * Build + persist a chained proof-receipt for a witnessed governed action.
 * The caller supplies everything except the chain link (which this sets). Best-
 * effort: never throws — a persistence failure must not void a real send (the
 * caller already executed it). Returns the receipt, or null on a write failure.
 */
export async function recordReceipt(
  input: Omit<ProofReceiptInput, "prevReceiptHash">,
  issuedAt: string = new Date().toISOString(),
): Promise<ProofReceipt | null> {
  try {
    const scopeStr = describeScope(input.scope);
    const prevReceiptHash = await getPrevReceiptHash(scopeStr);
    const receipt = buildReceipt({ ...input, prevReceiptHash }, issuedAt);
    await db.insert(proofReceipts).values({
      organizationId: scopeOrgId(input.scope),
      scope: receipt.scope,
      actionKind: receipt.actionKind,
      payloadHash: receipt.payloadHash,
      accountableHumanId: receipt.accountableHumanId,
      constitutionVersion: receipt.constitutionVersion,
      constitutionVersionHash: receipt.constitutionVersionHash,
      gateResults: receipt.gateResults,
      evalScore: receipt.evalScore,
      costUsd: receipt.costUsd,
      autonomyLevel: receipt.autonomyLevel,
      situationHash: receipt.situationHash,
      disclosure: receipt.disclosure,
      issuedAt: receipt.issuedAt,
      prevReceiptHash: receipt.prevReceiptHash,
      receiptHash: receipt.receiptHash,
    });
    return receipt;
  } catch (err) {
    logger.warn("[proofReceiptStore] recordReceipt failed (send still valid)", err instanceof Error ? err : undefined);
    return null;
  }
}

/** Reconstruct the sealed ProofReceipt from a stored row (exact fields). */
export function rowToReceipt(r: ProofReceiptRow): ProofReceipt {
  return {
    v: 1,
    actionKind: r.actionKind,
    scope: r.scope,
    orgId: r.organizationId ?? null,
    payloadHash: r.payloadHash,
    accountableHumanId: r.accountableHumanId,
    constitutionVersion: r.constitutionVersion,
    constitutionVersionHash: r.constitutionVersionHash,
    gateResults: (r.gateResults as Array<{ gate: string; status: string }>) ?? [],
    evalScore: r.evalScore ?? null,
    costUsd: r.costUsd ?? null,
    autonomyLevel: r.autonomyLevel ?? null,
    situationHash: r.situationHash ?? null,
    disclosure: r.disclosure,
    issuedAt: r.issuedAt,
    prevReceiptHash: r.prevReceiptHash ?? null,
    receiptHash: r.receiptHash,
  };
}

export interface ChainVerdict {
  ok: boolean;
  count: number;
  /** index (insertion order) of the first receipt that failed, if any. */
  failedAtIndex?: number;
  reason?: string;
}

/**
 * Pure: verify an ORDERED sequence of receipts — (a) each row's per-row seal
 * verifies, and (b) each row's prevReceiptHash equals the prior row's
 * receiptHash (GENESIS for the first). Reports the first break by index.
 * Exhaustively testable without a DB.
 */
export function verifyReceiptSequence(receipts: ProofReceipt[]): ChainVerdict {
  let expectedPrev = GENESIS_RECEIPT_HASH;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i];
    const seal = verifyReceipt(r);
    if (!seal.valid) {
      return { ok: false, count: receipts.length, failedAtIndex: i, reason: `#${i}: ${seal.reason}` };
    }
    if ((r.prevReceiptHash ?? GENESIS_RECEIPT_HASH) !== expectedPrev) {
      return {
        ok: false,
        count: receipts.length,
        failedAtIndex: i,
        reason: `#${i}: chain link broken (prev=${r.prevReceiptHash ?? "GENESIS"}, expected ${expectedPrev})`,
      };
    }
    expectedPrev = r.receiptHash;
  }
  return { ok: true, count: receipts.length };
}

/**
 * Walk a scope's persisted receipt chain in insertion order and verify it (the
 * per-row seal + the chain linkage). Fetches + maps, then delegates to the pure
 * verifyReceiptSequence.
 */
export async function verifyReceiptChain(scopeStr: string): Promise<ChainVerdict> {
  const rows = await db
    .select()
    .from(proofReceipts)
    .where(eq(proofReceipts.scope, scopeStr))
    .orderBy(asc(proofReceipts.id));
  return verifyReceiptSequence(rows.map(rowToReceipt));
}
