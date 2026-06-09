/**
 * audit_events hash chain — Beatrice / compliance-debt §2.
 *
 * Why this exists
 * ───────────────
 * `auditLogChain.ts` already hash-chains `audit_log` (org-scoped entity
 * mutations). But the MOST sensitive events — login, MFA-disable,
 * ownership-transfer, refunds, DSAR-erasure — are written to a DIFFERENT,
 * previously UN-chained table: `audit_events` (via `auditLog.ts`). This module
 * extends the same SHA-256 tamper-evidence scheme to that crown-jewel table.
 *
 * How it differs from auditLogChain
 * ─────────────────────────────────
 *  1. GLOBAL chain, not per-org. `audit_events` is intentionally org-less
 *     (cross-org targets: account-wide 2FA resets, ownership transfers), so
 *     there is one single chain across every row, ordered by the `seq`
 *     bigserial column (the UUID PK is random and cannot order the chain).
 *
 *  2. Hash computed BEFORE insert, inserted in ONE statement. `audit_events`
 *     already carries a blanket append-only UPDATE-deny trigger (migration
 *     0049 — `audit_events_no_update`). auditLog's insert-then-UPDATE pattern
 *     would be rejected by that trigger. So we generate the row id in app code,
 *     read the previous row's row_hash, compute this row's row_hash, and insert
 *     the fully-chained row atomically. No UPDATE ever touches a chained row.
 *
 * Algorithm
 * ─────────
 *   prev_hash = latest chained row's row_hash (max seq, row_hash NOT NULL),
 *               or the literal string 'GENESIS' if none.
 *   row_hash  = sha256(prev_hash + '\n' + canonical(payload))
 *   payload   = JSON.stringify({ action, actorEmail, actorUserId, createdAt,
 *                                id, ip, justification, metadata, targetId,
 *                                targetType, userAgent }, …, sorted keys)
 *               — `seq`, `prevHash`, `rowHash` are NOT part of the payload.
 *
 * Honest framing
 * ──────────────
 * TAMPER-EVIDENCE, not legal proof. The chain lets a reviewer DETECT an
 * after-the-fact UPDATE/DELETE/out-of-band-INSERT. It does not by itself
 * prevent a sufficiently privileged operator from rewriting history (e.g. by
 * disabling the trigger or the chaining writer). See AUDIT_CHAIN_TAMPER_EVIDENCE_COPY.
 */

import { createHash, randomUUID } from "crypto";
import { asc, desc, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, type AuditEvent, type InsertAuditEvent } from "@shared/schema";
import { logger } from "./logger";

export const GENESIS_PREV_HASH = "GENESIS";

/**
 * The subset of an audit_events row that participates in the hash. Deliberately
 * excludes `seq` (an ordering helper assigned by the DB) and the two chain
 * columns themselves.
 */
export interface AuditEventHashable {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  justification: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date | string | null;
}

/**
 * Canonicalize an audit_events row's business payload for hashing. Keys sorted
 * for cross-runtime stability. Null/undefined normalized to null.
 */
export function canonicalAuditEventPayload(row: AuditEventHashable): string {
  const payload: Record<string, unknown> = {
    id: row.id,
    actorUserId: row.actorUserId ?? null,
    actorEmail: row.actorEmail ?? null,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    justification: row.justification ?? null,
    metadata: row.metadata ?? null,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
  const keys = Object.keys(payload).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = payload[k];
  return JSON.stringify(sorted);
}

export function computeEventRowHash(prevHash: string, row: AuditEventHashable): string {
  return createHash("sha256")
    .update(prevHash)
    .update("\n")
    .update(canonicalAuditEventPayload(row))
    .digest("hex");
}

/**
 * Look up the most-recent chained row (global, max seq) and return its
 * row_hash. Returns GENESIS_PREV_HASH if there is no chained predecessor.
 */
export async function getPrevHashForEvents(): Promise<string> {
  const [prev] = await db
    .select({ rowHash: auditEvents.rowHash })
    .from(auditEvents)
    .where(isNotNull(auditEvents.rowHash))
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  return prev?.rowHash ?? GENESIS_PREV_HASH;
}

/**
 * Insert a new audit_events row, hash-chained. The row id is generated in app
 * code (so it can be folded into the canonical payload), the prev_hash is read
 * from the latest chained row, and the fully-chained row is inserted in ONE
 * statement — never an UPDATE, which the append-only trigger would reject.
 *
 * Concurrency note: two concurrent inserts can both read the same prev_hash and
 * each chain off it. The verifier walks ascending by `seq` and requires
 * row.prev_hash == previous_row.row_hash; under a true race the loser's
 * prev_hash may not equal its immediate predecessor's row_hash, producing a
 * `prev_hash_mismatch` at verification time. audit_events is a LOW-volume,
 * operator/recovery-console path (logins, MFA changes, refunds, DSAR) — true
 * concurrent writes are rare. If contention ever becomes real, wrap this in a
 * SERIALIZABLE transaction or a Postgres advisory lock on a fixed key. We keep
 * it lock-free here to match the existing fire-and-forget audit semantics.
 */
export async function chainAndInsertAuditEvent(
  entry: Omit<InsertAuditEvent, "id" | "seq" | "prevHash" | "rowHash"> & {
    id?: string;
    createdAt?: Date;
  },
): Promise<AuditEvent> {
  const id = entry.id ?? randomUUID();
  const createdAt = entry.createdAt ?? new Date();

  const hashable: AuditEventHashable = {
    id,
    actorUserId: entry.actorUserId ?? null,
    actorEmail: entry.actorEmail ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    justification: entry.justification ?? null,
    metadata: (entry.metadata ?? null) as Record<string, unknown> | null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    createdAt,
  };

  const prevHash = await getPrevHashForEvents();
  const rowHash = computeEventRowHash(prevHash, hashable);

  const [created] = await db
    .insert(auditEvents)
    .values({
      id,
      actorUserId: hashable.actorUserId,
      actorEmail: hashable.actorEmail,
      action: hashable.action,
      targetType: hashable.targetType,
      targetId: hashable.targetId,
      justification: hashable.justification,
      metadata: (hashable.metadata ?? {}) as Record<string, unknown>,
      ip: hashable.ip,
      userAgent: hashable.userAgent,
      createdAt,
      prevHash,
      rowHash,
    })
    .returning();

  if (!created) {
    throw new Error("audit_events insert returned no row");
  }
  return created;
}

export interface EventsChainVerificationResult {
  scanned: number;
  /** Rows that predate the chain (row_hash IS NULL) at the head of the table. */
  preChainSkipped: number;
  ok: boolean;
  failure: null | {
    auditEventId: string;
    seq: number | null;
    reason: "row_hash_mismatch" | "prev_hash_mismatch" | "missing_row_hash";
    expectedRowHash?: string;
    actualRowHash?: string | null;
    expectedPrevHash?: string;
    actualPrevHash?: string | null;
  };
}

/**
 * Walk the GLOBAL audit_events chain in ascending `seq` order and verify both
 * each row's own row_hash AND that each row's prev_hash matches its
 * predecessor's row_hash. Stops at the first failure. Pre-chain rows (NULL
 * row_hash) are tolerated only at the head — once the first chained row is
 * seen, every subsequent row must be chained.
 */
export async function verifyAuditEventsChain(): Promise<EventsChainVerificationResult> {
  const BATCH = 1000;
  let offset = 0;
  let scanned = 0;
  let preChainSkipped = 0;
  let prevRowHash: string | null = null;

  while (true) {
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(asc(auditEvents.seq))
      .limit(BATCH)
      .offset(offset);

    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;

      if (row.rowHash == null) {
        if (prevRowHash != null) {
          return {
            scanned,
            preChainSkipped,
            ok: false,
            failure: {
              auditEventId: row.id,
              seq: row.seq ?? null,
              reason: "missing_row_hash",
            },
          };
        }
        preChainSkipped++;
        continue;
      }

      const expectedPrev = prevRowHash ?? GENESIS_PREV_HASH;
      if ((row.prevHash ?? null) !== expectedPrev) {
        return {
          scanned,
          preChainSkipped,
          ok: false,
          failure: {
            auditEventId: row.id,
            seq: row.seq ?? null,
            reason: "prev_hash_mismatch",
            expectedPrevHash: expectedPrev,
            actualPrevHash: row.prevHash ?? null,
          },
        };
      }

      const recomputed = computeEventRowHash(row.prevHash ?? GENESIS_PREV_HASH, {
        id: row.id,
        actorUserId: row.actorUserId,
        actorEmail: row.actorEmail,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        justification: row.justification,
        metadata: row.metadata,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
      });
      if (recomputed !== row.rowHash) {
        return {
          scanned,
          preChainSkipped,
          ok: false,
          failure: {
            auditEventId: row.id,
            seq: row.seq ?? null,
            reason: "row_hash_mismatch",
            expectedRowHash: recomputed,
            actualRowHash: row.rowHash,
          },
        };
      }

      prevRowHash = row.rowHash;
    }

    offset += rows.length;
    if (rows.length < BATCH) break;
  }

  return { scanned, preChainSkipped, ok: true, failure: null };
}
