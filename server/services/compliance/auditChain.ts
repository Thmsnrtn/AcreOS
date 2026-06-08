/**
 * auditChain — tamper-EVIDENCE for the org-scoped audit_log.
 *
 * ⚠️  TAMPER-EVIDENCE, NOT LEGAL PROOF ⚠️
 * ───────────────────────────────────────
 * The audit_log table is made tamper-EVIDENT via a per-organization SHA-256
 * hash chain: every row carries `prev_hash` (the previous chained row's
 * row_hash, or 'GENESIS') and `row_hash = SHA-256(prev_hash || '\n' ||
 * canonical(row))`. A Postgres trigger blocks UPDATE/DELETE of an already
 * chained row's business columns.
 *
 * This lets a reviewer DETECT after the fact that the log was altered, deleted,
 * or had rows inserted out of band. It does NOT:
 *   - constitute legal proof that any event did or did not occur,
 *   - provide third-party notarization or an attested timestamp, or
 *   - prevent a sufficiently privileged operator from rewriting history (e.g.
 *     by disabling the trigger and recomputing the whole chain).
 * Treat a clean verification as SUPPORTING evidence, not conclusive proof.
 *
 * Implementation
 * ──────────────
 * The chain write + verification primitives live in
 * server/utils/auditLogChain.ts (shipped with migration 0080; columns +
 * trigger re-asserted by migration 0143). This module is the canonical
 * compliance-services entry point and re-exports them under the names the
 * compliance surface expects, including `verifyAuditChain(orgId)`.
 */

import {
  verifyAuditLogChain,
  chainAndInsertAuditLog,
  computeRowHash,
  canonicalAuditPayload,
  getPrevHashForOrg,
  GENESIS_PREV_HASH,
  type ChainVerificationResult,
} from "../../utils/auditLogChain";

export {
  chainAndInsertAuditLog,
  computeRowHash,
  canonicalAuditPayload,
  getPrevHashForOrg,
  GENESIS_PREV_HASH,
};
export type { ChainVerificationResult };

/**
 * Walk the audit_log hash chain for `organizationId` in ascending id order and
 * report the FIRST break (if any). Returns `{ ok: true, failure: null }` when
 * the chain verifies end-to-end.
 *
 * Canonical alias for verifyAuditLogChain — see the file header for the
 * tamper-evidence (not legal-proof) framing.
 */
export async function verifyAuditChain(
  organizationId: number,
): Promise<ChainVerificationResult> {
  return verifyAuditLogChain(organizationId);
}

/**
 * Copy shown to operators / auditors alongside a chain-verification result.
 * Centralized so the tamper-evidence (not legal-proof) framing is identical
 * everywhere.
 */
export const AUDIT_CHAIN_TAMPER_EVIDENCE_COPY =
  "Tamper-evidence: this hash chain lets you detect after-the-fact changes to " +
  "the audit log. It is not legal proof and does not by itself prevent a " +
  "privileged operator from altering history.";
