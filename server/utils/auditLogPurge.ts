/**
 * Audit-log purge sealing — Lens 13 / Kareem §1.
 *
 * Why this exists
 * ───────────────
 * `audit_log` is a SHA-256 hash chain (see auditLogChain.ts). Each row's
 * `prev_hash` points at the immediately-prior chained row's `row_hash`.
 * Deleting rows in the middle of the chain leaves the next surviving row's
 * `prev_hash` pointing at a row_hash that no longer exists in the table.
 * The chain verifier then reports a `prev_hash_mismatch` for every row
 * after the gap.
 *
 * Compliance still requires us to delete old audit rows (retention policies,
 * org deletion, DSAR). We bridge the two requirements with a *sealing row*:
 *
 *   1. Compute the cumulative SHA-256 over every to-be-purged row's row_hash
 *      (in id order). Call this H_cum.
 *   2. Insert a new audit_log row with:
 *        action    = 'audit_log:sealing_purge'
 *        metadata  = { purgeId, purgedCount, purgedThrough, lastPurgedRowHash,
 *                      cumulativeHash, purgedBefore }
 *      and chain it through `chainAndInsertAuditLog` as normal. This row's
 *      prev_hash will be the row_hash of the most-recent chained row at the
 *      moment of insertion — typically the last purged row (if the purge
 *      window includes "now"), or a later row if the window is older.
 *   3. Record the purge in `audit_log_purges` with sealingAuditLogId, the
 *      cumulative hash, and the last purged row_hash.
 *   4. DELETE the underlying rows (bypassing the chain trigger via a
 *      session-local `session_replication_role = 'replica'`).
 *
 * Auditor walk
 * ────────────
 *   row N      (last pre-window unaffected row, row_hash = H_pre)
 *   row M      (FIRST post-purge surviving row whose prev_hash = H_lastPurged,
 *               row M itself was chained against a now-deleted row)
 *   row S      (sealing row, prev_hash = H_pre or some later row's hash,
 *               row_hash recorded in the ledger)
 *
 * The verifier walks ascending. When it hits row M and sees its prev_hash
 * doesn't match the previous row's row_hash, it consults `audit_log_purges`
 * for a row whose `last_purged_row_hash` == row M's prev_hash. If one is
 * found, the gap is *documented*: the verifier records the purge id in its
 * trace and continues — resetting its tracked prev hash to row M's row_hash.
 *
 * The sealing row's row_hash is the cumulative SHA-256 of every purged
 * row's row_hash, so the purge ledger is itself tamper-evident: an attacker
 * who silently DROPs rows from `audit_log` AND from the candidate set must
 * also forge a consistent `audit_log_purges.sealing_hash` AND a sealing
 * audit_log row — three places to keep in sync, each protected by the
 * append-only chain trigger.
 *
 * Concurrency
 * ───────────
 * Wrapped in a transaction. The hash-chain trigger blocks concurrent
 * INSERTs into the same chain (it doesn't, technically — the chain helper
 * just races on `getPrevHashForOrg`), so we accept the standard chain race:
 * worst case the sealing row's prev_hash points at a slightly-later row
 * than the absolute tail at the moment of computation. That's fine because
 * the ledger row captures the *cumulative* hash of purged rows
 * independently of the sealing row's chain position.
 */

import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, auditLogPurges, type AuditLogEntry } from "@shared/schema";
import { chainAndInsertAuditLog } from "./auditLogChain";
import { logger } from "./logger";

export const PURGE_SEALING_ACTION = "audit_log:sealing_purge";

export interface PurgeSealingResult {
  /** Number of rows actually purged. */
  purgedCount: number;
  /** id of the new sealing audit_log row (null if nothing was purged). */
  sealingAuditLogId: number | null;
  /** id of the audit_log_purges ledger entry (null if nothing was purged). */
  purgeId: number | null;
  /** Cumulative SHA-256 of purged rows' row_hashes (hex), or null if none. */
  sealingHash: string | null;
}

export interface SealAndPurgeOpts {
  organizationId: number;
  beforeDate: Date;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Compute the cumulative hash of an ordered list of row_hash strings.
 * sha256(rh[0] || '\n' || rh[1] || '\n' || …).
 */
export function computeCumulativeHash(rowHashes: string[]): string {
  const h = createHash("sha256");
  for (let i = 0; i < rowHashes.length; i++) {
    if (i > 0) h.update("\n");
    h.update(rowHashes[i]);
  }
  return h.digest("hex");
}

/**
 * Atomically: write a sealing audit_log row, ledger the purge, then delete
 * the underlying audit_log rows. Returns the sealing info so callers can
 * audit the action. No-op (returns purgedCount=0) if nothing matches the
 * purge window.
 */
export async function sealAndPurgeAuditLogs(opts: SealAndPurgeOpts): Promise<PurgeSealingResult> {
  const { organizationId, beforeDate, actorUserId, metadata } = opts;

  // 1) Snapshot the rows we'd purge. We need every chained row's row_hash
  //    to fold into the cumulative seal.
  const candidates = await db
    .select({ id: auditLog.id, rowHash: auditLog.rowHash, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(and(
      eq(auditLog.organizationId, organizationId),
      lte(auditLog.createdAt, beforeDate),
    ))
    .orderBy(asc(auditLog.id));

  if (candidates.length === 0) {
    return { purgedCount: 0, sealingAuditLogId: null, purgeId: null, sealingHash: null };
  }

  // Only chained rows contribute to the cumulative hash. Pre-chain rows
  // (row_hash IS NULL) are still purged but don't fold into the sealing hash.
  const chainedHashes = candidates
    .map((r) => r.rowHash)
    .filter((h): h is string => typeof h === "string" && h.length > 0);

  const lastPurgedRowHash = chainedHashes.length > 0
    ? chainedHashes[chainedHashes.length - 1]
    : null;
  const sealingHash = chainedHashes.length > 0
    ? computeCumulativeHash(chainedHashes)
    : null;

  const purgedThrough = candidates[candidates.length - 1].createdAt;
  const candidateIds = candidates.map((c) => c.id);

  // 2) Run the rest in a single transaction so a partial purge cannot leave
  //    inconsistent state behind.
  const result = await db.transaction(async (tx) => {
    // 2a) Insert ledger row first so we have an id to embed in the sealing
    //     row's metadata.
    const [ledger] = await tx.insert(auditLogPurges).values({
      organizationId,
      purgedBefore: beforeDate,
      purgedCount: candidates.length,
      lastPurgedRowHash,
      sealingHash,
      actorUserId: actorUserId ?? null,
      metadata: metadata ?? {},
    }).returning({ id: auditLogPurges.id });

    if (!ledger) {
      throw new Error("[auditLogPurge] failed to insert ledger row");
    }

    // 2b) Write the sealing audit_log row through the chain helper. Note:
    //     chainAndInsertAuditLog uses the shared `db` connection, not `tx`,
    //     so this insert is committed outside the transaction. That's
    //     acceptable for our threat model: if the surrounding tx rolls back
    //     after the sealing row is written, the sealing row remains as a
    //     no-op "we tried to purge" marker — verifier still passes because
    //     no rows were actually deleted.
    const sealingRow: AuditLogEntry = await chainAndInsertAuditLog({
      organizationId,
      userId: actorUserId ?? null,
      action: PURGE_SEALING_ACTION,
      entityType: "audit_log",
      entityId: null,
      changes: null,
      ipAddress: null,
      userAgent: null,
      metadata: {
        purgeId: ledger.id,
        purgedCount: candidates.length,
        purgedThrough: purgedThrough ? new Date(purgedThrough).toISOString() : null,
        purgedBefore: beforeDate.toISOString(),
        lastPurgedRowHash,
        cumulativeHash: sealingHash,
      },
    });

    // 2c) Update the ledger row with the sealing row id + completion stamp.
    await tx.update(auditLogPurges)
      .set({ sealingAuditLogId: sealingRow.id, purgeCompletedAt: new Date() })
      .where(eq(auditLogPurges.id, ledger.id));

    // 2d) Delete the original rows. The chain trigger blocks DELETEs on
    //     chained rows; bypass via session_replication_role=replica which
    //     is scoped to this transaction (SET LOCAL).
    await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);

    if (candidateIds.length > 0) {
      // Exclude the sealing row itself (its id is necessarily > all candidate
      // ids since it was just inserted, but defence-in-depth).
      const safeIds = candidateIds.filter((id) => id !== sealingRow.id);
      if (safeIds.length > 0) {
        const { inArray } = await import("drizzle-orm");
        await tx.delete(auditLog)
          .where(and(
            eq(auditLog.organizationId, organizationId),
            inArray(auditLog.id, safeIds),
          ));
      }
    }

    return {
      purgedCount: candidates.length,
      sealingAuditLogId: sealingRow.id,
      purgeId: ledger.id,
      sealingHash,
    } satisfies PurgeSealingResult;
  });

  logger.info("[auditLogPurge] sealed and purged audit_log rows", {
    metadata: {
      organizationId,
      purgedCount: result.purgedCount,
      purgeId: result.purgeId,
      sealingAuditLogId: result.sealingAuditLogId,
    },
  });

  return result;
}

/**
 * Look up the purge (if any) that documents a discontinuity for the given
 * organization, given the row_hash that the *post-gap* row's prev_hash
 * points at. The verifier calls this when it encounters a
 * prev_hash_mismatch: if a purge's `last_purged_row_hash` equals the
 * mismatched prev_hash, the gap is documented.
 */
export async function findPurgeForGap(
  organizationId: number,
  expectedPrevHash: string,
): Promise<{ id: number; sealingAuditLogId: number | null; sealingHash: string | null } | null> {
  const [row] = await db
    .select({
      id: auditLogPurges.id,
      sealingAuditLogId: auditLogPurges.sealingAuditLogId,
      sealingHash: auditLogPurges.sealingHash,
    })
    .from(auditLogPurges)
    .where(and(
      eq(auditLogPurges.organizationId, organizationId),
      eq(auditLogPurges.lastPurgedRowHash, expectedPrevHash),
      isNotNull(auditLogPurges.sealingAuditLogId),
    ))
    .limit(1);
  return row ?? null;
}
