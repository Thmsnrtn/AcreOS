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
  type ReceiptVersion,
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
      // Frontier #4 — persist the sealed prediction + replay anchor + cause.
      receiptVersion: receipt.v,
      prediction: receipt.prediction ?? null,
      inputsHash: receipt.inputsHash ?? null,
      causeAllocation: receipt.causeAllocation ?? null,
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

/**
 * Reconstruct the sealed ProofReceipt from a stored row (exact fields). The
 * body shape MUST match what the hash sealed, so we branch on receipt_version:
 * a v1 row omits the prediction/inputsHash/causeAllocation keys entirely (they
 * didn't exist when its hash was computed); a v2 row includes them. Including a
 * null-valued key where the original had no key would change the canonical hash
 * and falsely fail verification.
 */
export function rowToReceipt(r: ProofReceiptRow): ProofReceipt {
  const v: ReceiptVersion = r.receiptVersion === 2 ? 2 : 1;
  const base: ProofReceipt = {
    v,
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
  if (v === 2) {
    base.prediction = (r.prediction as ProofReceipt["prediction"]) ?? null;
    base.inputsHash = r.inputsHash ?? null;
    base.causeAllocation = (r.causeAllocation as ProofReceipt["causeAllocation"]) ?? null;
  }
  return base;
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

export interface ChainAuditSummary {
  scopesChecked: number;
  receiptsChecked: number;
  /** Chains with a broken seal or chain link — the alarm condition. */
  brokenChains: Array<{ scope: string; reason: string; failedAtIndex?: number }>;
}

/**
 * Frontier #4 — CHAIN SELF-VERIFY. Walk EVERY scope's persisted receipt chain
 * and verify it end to end. A tamper-evident log is only as good as the thing
 * that re-checks it: this is the self-audit the scheduled `proof_chain_audit`
 * job runs so a silent corruption (a hand-edited row, a forked chain) surfaces
 * as an alarm instead of sitting undetected until a regulator asks. Returns a
 * summary; the caller decides whether to page. Best-effort per scope — one bad
 * chain doesn't abort the sweep.
 */
export async function auditAllReceiptChains(): Promise<ChainAuditSummary> {
  const scopes = await db
    .selectDistinct({ scope: proofReceipts.scope })
    .from(proofReceipts);
  const summary: ChainAuditSummary = { scopesChecked: 0, receiptsChecked: 0, brokenChains: [] };
  for (const { scope } of scopes) {
    summary.scopesChecked++;
    try {
      const verdict = await verifyReceiptChain(scope);
      summary.receiptsChecked += verdict.count;
      if (!verdict.ok) {
        summary.brokenChains.push({ scope, reason: verdict.reason ?? "unknown", failedAtIndex: verdict.failedAtIndex });
      }
    } catch (err) {
      summary.brokenChains.push({ scope, reason: `audit threw: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return summary;
}
