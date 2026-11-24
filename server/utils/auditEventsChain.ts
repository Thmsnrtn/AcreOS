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
 * Canonicalization v2 (AUD-DEF-1 cure, 2026-11-21)
 * ────────────────────────────────────────────────
 * v1 sorted only the payload's TOP-LEVEL keys and passed nested `metadata`
 * through JSON.stringify in the writer's in-memory insertion order.
 * Postgres `jsonb` does NOT preserve that order (it stores keys sorted by
 * length, then bytewise), so a hash computed at write time did not
 * recompute after a DB round-trip for any row whose nested metadata keys
 * were not already in jsonb order. Proven first-hand on staging's genesis
 * row (seq=1, access_review.quarterly): the stored row_hash
 * 2065e6b8… matches EXACTLY the payload whose metadata is in the writer's
 * source order (reviewedCount, staleCount, thresholdDays, sentTo), while
 * the v1 verifier — reading the jsonb round-tripped order (sentTo,
 * staleCount, reviewedCount, thresholdDays) — recomputes 01e95f94….
 * Rows with single-key metadata (e.g. seq=2) verify under both orders;
 * rows with multi-key metadata (e.g. seq=605, writer order ipPrefix,
 * uaFamily, country) match only in writer order. createdAt precision is
 * NOT a factor: the stored hashes match millisecond ISO timestamps.
 *
 * v2 therefore canonicalizes RECURSIVELY and deterministically
 * (stableCanonicalStringify): object keys sorted at every depth, arrays
 * in order, Dates as ISO strings, undefined object properties dropped
 * (JSON semantics). `metadata` null/undefined normalizes to {} — the
 * value the writer actually stores — so the hashed value and the stored
 * value are the same. `createdAt` normalizes to millisecond ISO, which
 * is exactly what a JS Date writer produces and what timestamptz
 * round-trips.
 *
 * Historical-rows disposition (EXPLICIT — AUD-DEF-1)
 * ───────────────────────────────────────────────────
 * Pre-v2 rows CANNOT be verified by ANY order-independent canonical form:
 * the writer's key order was destroyed by the jsonb round-trip and is
 * unrecoverable from the stored data. Recomputing and rewriting their
 * hashes would destroy the very tamper-evidence the chain exists to
 * provide, so hashes are NEVER silently rewritten. The disposition is
 * GRANDFATHER + CHECKPOINT:
 *   - Rows with seq <= the configured grandfather boundary
 *     (AUDIT_EVENTS_GRANDFATHER_THROUGH_SEQ, or the verifier option) are
 *     counted as `legacyGrandfathered`: their stored row_hash is used as
 *     a linkage anchor but their content hash is not recomputed.
 *   - The first post-boundary row must chain (prev_hash) onto the last
 *     legacy row's stored row_hash — the checkpoint anchor. New rows
 *     already do this via getPrevHashForEvents, so the v2 chain is
 *     continuous with the legacy tip, not a re-genesis.
 *   - With NO boundary configured the verifier stays strict and fails on
 *     the first legacy row, exactly as v1 did — grandfathering is an
 *     operator's explicit, per-environment act (set the boundary to the
 *     last pre-v2 seq after a read-only review), never a silent default.
 * The alternative — re-genesis with a documented checkpoint row that
 * supersedes the legacy chain — was NOT chosen: it severs the new chain
 * from the historical tip and still cannot make the legacy rows verify;
 * it remains available as a founder decision if the grandfathered span
 * is ever judged unacceptable as evidence.
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
import { clock } from "./clock";

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
 * Deterministic, recursive canonical stringify (canonicalization v2).
 *
 * Object keys are sorted at EVERY depth — this is the AUD-DEF-1 cure:
 * Postgres jsonb reorders nested keys (by length, then bytewise), so any
 * canonical form that depends on nested insertion order cannot survive a
 * DB round-trip. Arrays keep their order (order is meaning in an array).
 * Dates serialize as ISO strings; undefined object properties are dropped
 * and undefined array elements become null (JSON.stringify semantics);
 * non-finite numbers become null (JSON semantics). Values that JSONB
 * cannot represent (functions, symbols, bigint) canonicalize as null —
 * they can never come back from the database as anything else.
 */
export function stableCanonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableCanonicalStringify(v)).join(",") + "]";
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "object": {
      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec)
        .filter((k) => rec[k] !== undefined && typeof rec[k] !== "function" && typeof rec[k] !== "symbol")
        .sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableCanonicalStringify(rec[k])).join(",") + "}";
    }
    default:
      return "null";
  }
}

function normalizeCreatedAt(value: Date | string | null): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  // Millisecond ISO: a JS Date writer has ms precision, and Date parsing
  // truncates any sub-millisecond timestamptz fraction to ms, so write
  // time and verify time agree after the DB round-trip.
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

/**
 * Canonicalize an audit_events row's business payload for hashing.
 * Recursive/deterministic at write AND verify time (both call this).
 * `metadata` null/undefined normalizes to {} — the value
 * chainAndInsertAuditEvent actually stores — so the hashed value is the
 * stored value.
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
    metadata: row.metadata ?? {},
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: normalizeCreatedAt(row.createdAt),
  };
  return stableCanonicalStringify(payload);
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
  const createdAt = entry.createdAt ?? clock.now();

  const hashable: AuditEventHashable = {
    id,
    actorUserId: entry.actorUserId ?? null,
    actorEmail: entry.actorEmail ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    justification: entry.justification ?? null,
    // Hash exactly what will be stored: the insert below writes
    // `metadata ?? {}`, so the hashable carries {} (not null) — the v1
    // hash-null/store-{} split was a second round-trip instability.
    metadata: (entry.metadata ?? {}) as Record<string, unknown>,
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
  /**
   * Pre-v2 rows inside the configured grandfather boundary whose stored
   * row_hash was accepted as a linkage anchor WITHOUT content
   * recomputation (see the disposition note in the module header).
   * Zero unless a boundary was explicitly configured.
   */
  legacyGrandfathered: number;
  /** The grandfather boundary in effect for this walk, or null if none. */
  checkpointSeq: number | null;
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

export interface VerifyAuditEventsChainOptions {
  /**
   * Grandfather boundary: rows with seq <= this value are legacy pre-v2
   * rows (see header). Defaults to the AUDIT_EVENTS_GRANDFATHER_THROUGH_SEQ
   * environment variable; absent/invalid means NO grandfathering (strict).
   */
  grandfatherThroughSeq?: number | null;
  /**
   * Expected prev_hash for the FIRST row supplied (used when verifying a
   * segment that does not start at the genesis row — e.g. a round-trip
   * test against a freshly written row). Defaults to GENESIS.
   */
  startingPrevHash?: string;
}

/** Environment variable carrying the per-environment grandfather boundary. */
const AUDIT_EVENTS_GRANDFATHER_ENV = "AUDIT_EVENTS_GRANDFATHER_THROUGH_SEQ";

function resolveGrandfatherThroughSeq(
  opts?: VerifyAuditEventsChainOptions,
): number | null {
  if (opts && opts.grandfatherThroughSeq !== undefined) {
    return opts.grandfatherThroughSeq;
  }
  const raw = process.env[AUDIT_EVENTS_GRANDFATHER_ENV];
  if (raw == null || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A stored audit_events row as the chain walker sees it. */
export interface AuditEventChainRow extends AuditEventHashable {
  seq: number | null;
  prevHash: string | null;
  rowHash: string | null;
}

/**
 * Pure chain walk over already-loaded rows (ascending `seq`). This is the
 * ONE walk implementation: verifyAuditEventsChain loads the table and
 * delegates here, and tests exercise the verifier logic against fixtures
 * (including the historical byte pattern) through this function.
 */
export function verifyAuditEventRows(
  rows: AuditEventChainRow[],
  opts?: VerifyAuditEventsChainOptions,
): EventsChainVerificationResult {
  const grandfatherThroughSeq = resolveGrandfatherThroughSeq(opts);
  const ordered = [...rows].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  let scanned = 0;
  let preChainSkipped = 0;
  let legacyGrandfathered = 0;
  let prevRowHash: string | null = opts?.startingPrevHash ?? null;
  let sawChained = prevRowHash != null;

  const fail = (
    row: AuditEventChainRow,
    reason: "row_hash_mismatch" | "prev_hash_mismatch" | "missing_row_hash",
    extra?: { expectedRowHash?: string; actualRowHash?: string | null; expectedPrevHash?: string; actualPrevHash?: string | null },
  ): EventsChainVerificationResult => ({
    scanned,
    preChainSkipped,
    legacyGrandfathered,
    checkpointSeq: legacyGrandfathered > 0 ? grandfatherThroughSeq : null,
    ok: false,
    failure: { auditEventId: row.id, seq: row.seq ?? null, reason, ...extra },
  });

  for (const row of ordered) {
    scanned++;
    const isLegacy =
      grandfatherThroughSeq != null && row.seq != null && row.seq <= grandfatherThroughSeq;

    if (row.rowHash == null) {
      if (isLegacy) {
        // A legacy row without a hash cannot anchor the chain; count it
        // as grandfathered and leave the anchor unchanged.
        legacyGrandfathered++;
        continue;
      }
      if (sawChained) return fail(row, "missing_row_hash");
      preChainSkipped++;
      continue;
    }

    if (isLegacy) {
      // GRANDFATHERED (explicit disposition, see header): the content
      // hash is NOT recomputed — the v1 writer's nested key order was
      // destroyed by the jsonb round-trip, so no canonical form can
      // recompute it. The stored hash still anchors linkage for the
      // first post-boundary row, which IS strictly checked.
      legacyGrandfathered++;
      prevRowHash = row.rowHash;
      sawChained = true;
      continue;
    }

    const expectedPrev = prevRowHash ?? GENESIS_PREV_HASH;
    if ((row.prevHash ?? null) !== expectedPrev) {
      return fail(row, "prev_hash_mismatch", {
        expectedPrevHash: expectedPrev,
        actualPrevHash: row.prevHash ?? null,
      });
    }

    const recomputed = computeEventRowHash(row.prevHash ?? GENESIS_PREV_HASH, row);
    if (recomputed !== row.rowHash) {
      return fail(row, "row_hash_mismatch", {
        expectedRowHash: recomputed,
        actualRowHash: row.rowHash,
      });
    }

    prevRowHash = row.rowHash;
    sawChained = true;
  }

  return {
    scanned,
    preChainSkipped,
    legacyGrandfathered,
    checkpointSeq: legacyGrandfathered > 0 ? grandfatherThroughSeq : null,
    ok: true,
    failure: null,
  };
}

/**
 * Walk the GLOBAL audit_events chain in ascending `seq` order and verify
 * both each row's own row_hash AND that each row's prev_hash matches its
 * predecessor's row_hash. Stops at the first failure. Pre-chain rows
 * (NULL row_hash) are tolerated only at the head — once the first chained
 * row is seen, every subsequent row must be chained. Pre-v2 legacy rows
 * are grandfathered ONLY when a boundary is explicitly configured (see
 * the disposition note in the module header).
 *
 * audit_events is a low-volume operator/recovery-console table, so the
 * walk loads rows in batches and delegates to the pure
 * verifyAuditEventRows — one walk implementation for DB and fixtures.
 */
export async function verifyAuditEventsChain(
  opts?: VerifyAuditEventsChainOptions,
): Promise<EventsChainVerificationResult> {
  const BATCH = 1000;
  let offset = 0;
  const all: AuditEventChainRow[] = [];

  while (true) {
    const rows = await db
      .select()
      .from(auditEvents)
      .orderBy(asc(auditEvents.seq))
      .limit(BATCH)
      .offset(offset);

    if (rows.length === 0) break;
    for (const row of rows) {
      all.push({
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
        seq: row.seq ?? null,
        prevHash: row.prevHash ?? null,
        rowHash: row.rowHash ?? null,
      });
    }
    offset += rows.length;
    if (rows.length < BATCH) break;
  }

  return verifyAuditEventRows(all, opts);
}
