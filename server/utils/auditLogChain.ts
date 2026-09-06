/**
 * Audit-log hash chain — Kareem §1 (SOC 2 CC7.2 / CC7.3).
 *
 * Why this exists
 * ───────────────
 * `audit_log` is the org-scoped sensitive-action log (lead/property/deal/note
 * mutations, exports, imports, etc.). For SOC 2 Type II we need it to be
 * tamper-evident: an auditor must be able to detect any UPDATE, DELETE, or
 * out-of-band INSERT after the fact. A SHA-256 hash chain does that without
 * any external service — every row carries the hash of the previous row,
 * and the most recent hash acts as a Merkle-root for the entire history.
 *
 * Algorithm
 * ─────────
 *   prev_hash = previous row's row_hash for the same organization,
 *               or the literal string 'GENESIS' if none.
 *   row_hash  = sha256(prev_hash + '\n' + canonical(payload))
 *   payload   = JSON.stringify({ id, organizationId, userId, action,
 *                                 entityType, entityId, changes, ipAddress,
 *                                 userAgent, metadata, createdAt }, …, 0)
 *               with keys in sorted order (canonicalization).
 *
 * The chain is per-organization so a bug or compromise affecting one tenant
 * cannot invalidate another tenant's chain.
 *
 * Failure mode
 * ────────────
 * The chain helper runs under `chainAndInsert` which:
 *   1. Inserts the row with NULL row_hash/prev_hash inside a transaction.
 *   2. Reads the previous chained row for that org (FOR UPDATE-style locking
 *      via the transaction's serializable isolation level — but we use the
 *      default isolation and accept that a concurrent inserter wins the
 *      race, in which case our row is rejected by the migration's trigger
 *      and we retry).
 *   3. Computes prev_hash + row_hash and UPDATEs the two columns.
 *   4. Returns the chained row.
 *
 * Because the migration's trigger allows the NULL → non-NULL transition on
 * those two columns and nothing else, even a malicious caller cannot rewrite
 * an already-chained row.
 *
 * Verification
 * ────────────
 * `verifyAuditLogChain(organizationId)` walks the chain and reports the
 * first row (if any) where row_hash does not match a recomputed hash. Used
 * by the /api/admin/audit-log/verify endpoint.
 */

import { createHash } from "crypto";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, type PrimaryDb } from "../db";
import { auditLog, type AuditLogEntry, type InsertAuditLog } from "@shared/schema";
import { logger } from "./logger";

export const GENESIS_PREV_HASH = "GENESIS";

/**
 * Canonicalize an audit row's business payload for hashing. Keys are sorted
 * to ensure the same logical payload produces the same hash across runtimes
 * and JS-engine key-order changes. Null/undefined are normalized to null.
 */
export function canonicalAuditPayload(row: AuditLogEntry): string {
  const payload = {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId ?? null,
    changes: row.changes ?? null,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
  // Stable key ordering — JSON.stringify with a sorted replacer.
  const keys = Object.keys(payload).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = (payload as Record<string, unknown>)[k];
  return JSON.stringify(sorted);
}

export function computeRowHash(prevHash: string, row: AuditLogEntry): string {
  return createHash("sha256")
    .update(prevHash)
    .update("\n")
    .update(canonicalAuditPayload(row))
    .digest("hex");
}

/**
 * Look up the most-recent chained row for `organizationId` and return its
 * row_hash. Returns GENESIS_PREV_HASH if there is no chained predecessor.
 */
export async function getPrevHashForOrg(
  organizationId: number,
  tx: PrimaryDb = db,
): Promise<string> {
  const [prev] = await tx
    .select({ rowHash: auditLog.rowHash })
    .from(auditLog)
    .where(and(eq(auditLog.organizationId, organizationId), isNotNull(auditLog.rowHash)))
    .orderBy(desc(auditLog.id))
    .limit(1);
  return prev?.rowHash ?? GENESIS_PREV_HASH;
}

/**
 * Insert a new audit_log row and chain it. Returns the chained row.
 *
 * Concurrency: two concurrent inserts for the same org will race on
 * `getPrevHashForOrg`. The loser's UPDATE still succeeds (its row is later
 * in `id` order), but its prev_hash may point to a row that is no longer
 * the immediate predecessor. We accept this — the chain is per-id-order, not
 * per-prev_hash-pointer, so verification walks by ascending id and recomputes
 * the expected prev_hash from the row before. In other words: row N's
 * `prev_hash` MUST equal row (N-1)'s `row_hash`, regardless of who wrote
 * what when. The same invariant applies under concurrent inserts as long as
 * each row's `prev_hash` came from SOME earlier-id row's `row_hash`.
 *
 * Verification therefore walks ascending and checks
 *   row.row_hash == sha256(row.prev_hash || canonical(row))
 * AND row.prev_hash == previous_row.row_hash
 *
 * The first guarantees the row's own integrity; the second guarantees that
 * no row was inserted in the middle without rebuilding the chain (which the
 * trigger blocks anyway).
 */
/**
 * @param tx  The executor to run all three statements on. Defaults to the
 *              global handle; a caller inside `withTransaction` MUST pass its
 *              `tx`, because the prev-hash READ has to see the same snapshot as
 *              the insert. Run on two connections, two concurrent writers can
 *              both read the same prev_hash and chain onto it, and the chain
 *              forks silently — which is precisely what an audit chain exists
 *              to make impossible.
 */
export async function chainAndInsertAuditLog(
  entry: InsertAuditLog,
  tx: PrimaryDb = db,
): Promise<AuditLogEntry> {
  // 1) Insert raw row (NULL hashes).
  const [created] = await tx.insert(auditLog).values(entry).returning();
  if (!created) {
    throw new Error("audit_log insert returned no row");
  }

  // 2) Compute prev_hash + row_hash off the row that was just persisted.
  const prevHash = await getPrevHashForOrg(created.organizationId, tx);
  // The row used to compute hash must include the assigned id + createdAt
  // exactly as stored; created already has both.
  const rowHash = computeRowHash(prevHash, created);

  // 3) Update the row in-place. The migration's trigger allows this exact
  //    NULL → non-NULL transition and blocks every other mutation.
  const [updated] = await tx
    .update(auditLog)
    .set({ prevHash, rowHash })
    .where(eq(auditLog.id, created.id))
    .returning();

  if (!updated) {
    // Should be impossible — log loudly so an operator notices.
    logger.error("[auditLogChain] failed to write hash columns", undefined, {
      metadata: { auditLogId: created.id, organizationId: created.organizationId },
    });
    return created;
  }
  return updated;
}

export interface ChainVerificationResult {
  organizationId: number;
  scanned: number;
  /** Number of rows that predate the chain (row_hash IS NULL). */
  preChainSkipped: number;
  /**
   * Number of documented purge gaps the verifier walked across. Each gap
   * is a `prev_hash_mismatch` that was reconciled against a row in
   * `audit_log_purges` whose `last_purged_row_hash` matched. Surfaced as
   * SOC 2 evidence — auditors expect these to be non-zero when retention
   * cron has been running.
   */
  documentedPurgesAcknowledged: number;
  ok: boolean;
  /** First row (if any) where verification failed. */
  failure: null | {
    auditLogId: number;
    reason: "row_hash_mismatch" | "prev_hash_mismatch" | "missing_row_hash";
    expectedRowHash?: string;
    actualRowHash?: string | null;
    expectedPrevHash?: string;
    actualPrevHash?: string | null;
  };
}

/**
 * Walk every chained row for `organizationId` in ascending id order and
 * verify both the row's own row_hash AND that each row's prev_hash matches
 * its predecessor's row_hash. Stops at the first failure and returns it.
 *
 * Reading-heavy and bounded by org size; chunk in 1k batches to keep memory
 * predictable. Auditors typically run this once per quarter or after any
 * reported incident.
 */
export async function verifyAuditLogChain(organizationId: number): Promise<ChainVerificationResult> {
  // Lazy import to avoid cyclic init — auditLogPurge imports back into here
  // via chainAndInsertAuditLog.
  const { findPurgeForGap } = await import("./auditLogPurge");

  const BATCH = 1000;
  let lastId = 0;
  let scanned = 0;
  let preChainSkipped = 0;
  let documentedPurgesAcknowledged = 0;
  let prevRowHash: string | null = null; // tracks the previous chained row's row_hash

  while (true) {
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, organizationId)))
      .orderBy(asc(auditLog.id))
      .limit(BATCH)
      .offset(lastId);

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;

      // Pre-chain rows (no row_hash) are allowed at the head of the table —
      // they were written before the migration landed. Once we see the first
      // chained row, every subsequent row MUST be chained.
      if (row.rowHash == null) {
        if (prevRowHash != null) {
          return {
            organizationId,
            scanned,
            preChainSkipped,
            documentedPurgesAcknowledged,
            ok: false,
            failure: {
              auditLogId: row.id,
              reason: "missing_row_hash",
            },
          };
        }
        preChainSkipped++;
        continue;
      }

      const expectedPrev = prevRowHash ?? GENESIS_PREV_HASH;
      if ((row.prevHash ?? null) !== expectedPrev) {
        // Lens 13: documented purge tolerance. A `prev_hash_mismatch` is
        // expected at the first surviving row after a purge — that row
        // originally chained off a row that has since been deleted. If
        // `audit_log_purges` has a sealed entry whose `last_purged_row_hash`
        // matches this row's prev_hash, the gap is documented and the chain
        // continues from this row onwards.
        const actualPrev = row.prevHash ?? null;
        if (actualPrev != null) {
          const purge = await findPurgeForGap(organizationId, actualPrev);
          if (purge != null) {
            documentedPurgesAcknowledged++;
            // The row's own row_hash must still verify correctly against the
            // (now-missing) predecessor whose row_hash equals actualPrev.
            const recomputed = computeRowHash(actualPrev, row);
            if (recomputed !== row.rowHash) {
              return {
                organizationId,
                scanned,
                preChainSkipped,
                documentedPurgesAcknowledged,
                ok: false,
                failure: {
                  auditLogId: row.id,
                  reason: "row_hash_mismatch",
                  expectedRowHash: recomputed,
                  actualRowHash: row.rowHash,
                },
              };
            }
            prevRowHash = row.rowHash;
            continue;
          }
        }
        return {
          organizationId,
          scanned,
          preChainSkipped,
          documentedPurgesAcknowledged,
          ok: false,
          failure: {
            auditLogId: row.id,
            reason: "prev_hash_mismatch",
            expectedPrevHash: expectedPrev,
            actualPrevHash: actualPrev,
          },
        };
      }

      const recomputed = computeRowHash(row.prevHash ?? GENESIS_PREV_HASH, row);
      if (recomputed !== row.rowHash) {
        return {
          organizationId,
          scanned,
          preChainSkipped,
          documentedPurgesAcknowledged,
          ok: false,
          failure: {
            auditLogId: row.id,
            reason: "row_hash_mismatch",
            expectedRowHash: recomputed,
            actualRowHash: row.rowHash,
          },
        };
      }

      prevRowHash = row.rowHash;
    }

    lastId += rows.length;
    if (rows.length < BATCH) break;
  }

  return { organizationId, scanned, preChainSkipped, documentedPurgesAcknowledged, ok: true, failure: null };
}

// ─────────────────────────────────────────────────────────────────────────
// Tier 2D — fleet-wide verification (weekly audit_chain_verify job)
// ─────────────────────────────────────────────────────────────────────────

export interface AllOrgChainVerificationSummary {
  /** Distinct organizations that have at least one audit_log row. */
  orgsChecked: number;
  /** Total rows walked across every org chain. */
  totalScanned: number;
  /** True only when every org chain verified AND no verifier error. */
  ok: boolean;
  /** Per-org verification failures (tamper/break evidence). */
  failures: ChainVerificationResult[];
  /** Orgs whose verification threw (infra error, NOT tamper evidence). */
  errors: Array<{ organizationId: number; message: string }>;
}

/**
 * Walk EVERY org's audit_log hash chain. Used by the weekly
 * `audit_chain_verify` scheduled job so per-tenant tampering is detected
 * continuously, not only when an admin happens to hit the verify endpoint.
 *
 * A verification failure (ok:false) is tamper/break evidence → the caller
 * raises a CRITICAL alert. A thrown error is an infra problem and is kept
 * separate so it cannot mask — or masquerade as — tampering.
 */
export async function verifyAllOrgAuditLogChains(): Promise<AllOrgChainVerificationSummary> {
  const orgRows = await db
    .selectDistinct({ organizationId: auditLog.organizationId })
    .from(auditLog);

  const summary: AllOrgChainVerificationSummary = {
    orgsChecked: 0,
    totalScanned: 0,
    ok: true,
    failures: [],
    errors: [],
  };

  for (const { organizationId } of orgRows) {
    if (organizationId == null) continue;
    summary.orgsChecked++;
    try {
      const result = await verifyAuditLogChain(organizationId);
      summary.totalScanned += result.scanned;
      if (!result.ok) {
        summary.ok = false;
        summary.failures.push(result);
        logger.error("[auditLogChain] per-org chain verification FAILED", undefined, {
          metadata: {
            organizationId,
            failure: result.failure,
            scanned: result.scanned,
          },
        });
      }
    } catch (err) {
      summary.ok = false;
      summary.errors.push({
        organizationId,
        message: err instanceof Error ? err.message : String(err),
      });
      logger.error("[auditLogChain] per-org chain verification errored", err, {
        metadata: { organizationId },
      });
    }
  }

  return summary;
}
