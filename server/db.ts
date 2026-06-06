/**
 * T2 — DB Connection Pool Tuning + Slow Query Monitoring
 *
 * App-side pool sits BEHIND pgBouncer (transaction pooling mode). pgBouncer
 * fronts Postgres and multiplexes our many short-lived app connections onto
 * a much smaller set of real Postgres backends. Because pgBouncer holds the
 * upstream pool (default_pool_size = 25, max_client_conn = 1000), each app
 * instance only needs a handful of client connections — all of them target
 * the same pgBouncer port and are themselves cheap.
 *
 * Pool sizing (P1-15, Phase 3 Week 7-8):
 *   max: 5  connections per app process (down from 20). With 2+ Fly machines
 *           and pgBouncer multiplexing, 5×N still gives plenty of headroom
 *           and avoids exhausting pgBouncer's reserve_pool_size when traffic
 *           spikes.
 *   idleTimeoutMillis: 60s (release unused connections quickly)
 *   connectionTimeoutMillis: 10s (cloud DBs can be slow to acquire)
 *   statement_timeout: 30s (kill runaway queries at the DB level)
 *
 * NOTE: with pool_mode = transaction, prepared statements at the app layer
 * are NOT safe across queries. node-postgres does not enable server-side
 * prepared statements unless you ask for them, and Drizzle's query builder
 * stays compatible. Avoid `pg.Client.prepare()` in this codebase.
 *
 * Slow query logging: any query exceeding SLOW_QUERY_THRESHOLD_MS is
 * logged with its duration so Sentry/logs can surface bottlenecks.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Tahoe L12 + L13 — `ReadOnlyDb` wrapper + `app_role` convention.
 *
 * Each Drizzle instance now carries a branded `__role` so the compiler
 * knows whether it points at the primary or a read-only replica:
 *
 *   type PrimaryDb = NodePgDatabase<typeof schema> & RoleBrand<"primary">;
 *   type ReplicaDb = ReadOnlyDb<typeof schema>;   // brand + Omit mutations
 *
 * `db`         — PrimaryDb. Full read/write surface.
 * `dbReplica`  — ReplicaDb | null. ReadOnlyDb projection: `insert`,
 *                `update`, `delete`, `transaction`, and
 *                `refreshMaterializedView` are removed from the type.
 *                A call site that does `dbReplica.insert(...)` fails
 *                to typecheck (TS2339).
 * `dbReplicaUnsafe` — Same connection as `dbReplica` but typed as
 *                PrimaryDb. ESCAPE HATCH for the rare maintenance
 *                script / test setup that genuinely needs to write
 *                against the replica wire (DDL on a test DB pointed
 *                at `DATABASE_REPLICA_URL`, etc.). Each call site MUST
 *                explain why.
 *
 * Boundary assertion: on startup we read `SHOW transaction_read_only`
 * against the replica connection. If the result disagrees with our
 * `app_role` brand, we either WARN (default) or THROW
 * (when `DB_REPLICA_RO_ENFORCED=1`).
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

import { APP_ROLES, type DbRole, type RoleBrand } from "@shared/db/roles";
import { asReadOnlyDb, type ReadOnlyDb } from "@shared/db/read-only";

import { logger } from "./utils/logger";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// DB_POOL_MAX defaults to 5 because we sit behind pgBouncer (transaction mode).
// Override to 20 in environments where DATABASE_URL points directly at
// Postgres (local dev without pgBouncer, smoke tests, etc.).
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "5", 10),
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000, // cloud DBs can be slow to acquire
  statement_timeout: 30_000, // Kill runaway queries after 30s (SRE-03)
  idle_in_transaction_session_timeout: 60_000, // Kill idle-in-transaction after 60s
});

// Prevent unhandled pool errors from crashing the process (P0 fix SRE-04)
pool.on("error", (err) => {
  logger.error("Unexpected database pool error", err);
});

// ── Primary Drizzle instance ────────────────────────────────────────────────
// Branded as `primary`. The brand is type-only (no runtime field) so the
// underlying class identity is unchanged.
export type PrimaryDb = NodePgDatabase<typeof schema> & RoleBrand<"primary">;

const primaryDb = drizzle(pool, { schema }) as unknown as PrimaryDb;
export const db: PrimaryDb = primaryDb;

// ─── T8: Read Replica Routing ─────────────────────────────────────────────────
// When DATABASE_REPLICA_URL is set (e.g. a Fly.io Postgres read replica),
// heavy analytics/reporting queries are routed to the replica, relieving
// the primary of read pressure from dashboard, cohort, and portfolio queries.
//
// Usage in services (Tahoe L12 — read-only typed):
//   import { dbReplica } from "../db";
//   if (dbReplica) {
//     const rows = await dbReplica.select().from(leads).where(...);
//   }
//
// If DATABASE_REPLICA_URL is not set, `dbReplica` is `null` so the
// `dbForReads()` helper can transparently fall back to the primary.

const replicaUrl = process.env.DATABASE_REPLICA_URL || process.env.DATABASE_URL!;

export const replicaPool = new Pool({
  connectionString: replicaUrl,
  max: parseInt(process.env.DB_REPLICA_POOL_MAX ?? "5", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

replicaPool.on("error", (err) => {
  logger.error("[db:replica] Unexpected client error", err);
});

// Two views on the same replica connection:
//
//   * `dbReplicaInner` — full Drizzle handle, kept INTERNAL to this module
//     plus the `dbReplicaUnsafe` escape hatch. Do not import the inner
//     handle from any other file.
//   * `dbReadOnly`     — public ReadOnlyDb projection. Returned non-null
//     whether or not a true replica is configured (so legacy callers
//     keep working), but always typed as read-only.
//   * `dbReplica`      — public ReadOnlyDb projection or null. Null when
//     no replica is configured — this is the signal `db-replica.ts`
//     uses to fall back to the primary.
const dbReplicaInner = drizzle(replicaPool, { schema });

export type ReplicaDb = ReadOnlyDb<typeof schema>;

export const dbReadOnly: ReplicaDb = asReadOnlyDb(dbReplicaInner);

export const dbReplica: ReplicaDb | null = process.env.DATABASE_REPLICA_URL
  ? dbReadOnly
  : null;

/**
 * ESCAPE HATCH — same connection as `dbReplica`, but typed as a full
 * `PrimaryDb` (writes allowed). Use ONLY for:
 *
 *   - test setup that seeds rows directly into the replica connection
 *     (because the test DB is single-node and replica URL == primary URL),
 *   - one-off maintenance scripts that have audited their write target,
 *   - migrations that genuinely need to run against the replica wire.
 *
 * Every call site MUST include a comment explaining why the read-only
 * type is being bypassed. CI lint can grep for this symbol name.
 */
export const dbReplicaUnsafe: PrimaryDb = dbReplicaInner as unknown as PrimaryDb;

// ── Tahoe L13 — role registry + boundary assertion ──────────────────────────
//
// Maps each exported Drizzle instance to its declared `app_role`. Used by
// `db-replica.ts` and tests to verify the right handle was picked at the
// boundary.
export const DB_ROLES: { primary: DbRole; replica: DbRole } = {
  primary: APP_ROLES.primary,
  replica: APP_ROLES.replica_ro,
};

/**
 * Verify the replica connection actually behaves as a read-only Postgres
 * session, and surface a structured warning (or error, when enforcement
 * is on) if it doesn't.
 *
 * The probe runs `SHOW transaction_read_only`. A true replica streaming
 * from a primary will report `on`. A misconfigured connection that is
 * actually pointing at the primary will report `off` — that's the case
 * we want to catch before a stray write lands on the wrong node.
 *
 * Returns the observed value (or null on probe failure) so the caller
 * can log a startup banner.
 */
export async function assertReplicaRoleAtBoundary(opts: {
  enforce?: boolean;
} = {}): Promise<{ reported: string | null; matches: boolean }> {
  const enforce =
    opts.enforce ?? process.env.DB_REPLICA_RO_ENFORCED === "1";

  // No replica configured → nothing to assert. We treat this as a soft pass.
  if (!process.env.DATABASE_REPLICA_URL) {
    return { reported: null, matches: true };
  }

  let reported: string | null = null;
  try {
    const res = await replicaPool.query<{ transaction_read_only: string }>(
      "SHOW transaction_read_only",
    );
    reported = res.rows[0]?.transaction_read_only ?? null;
  } catch (err) {
    logger.warn("[db:replica] failed to probe transaction_read_only", {
      metadata: { error: (err as Error)?.message },
    });
    return { reported: null, matches: false };
  }

  const matches = reported === "on";

  if (!matches) {
    const message =
      `[db:replica] app_role=${APP_ROLES.replica_ro} expected transaction_read_only=on, ` +
      `observed transaction_read_only=${reported ?? "unknown"}. ` +
      "Connection string may not point at a true read replica.";

    if (enforce) {
      logger.error(message);
      throw new Error(message);
    }
    logger.warn(message, {
      metadata: {
        hint: "Set DB_REPLICA_RO_ENFORCED=1 to fail closed in this environment.",
      },
    });
  } else {
    logger.info("[db:replica] app_role boundary verified", {
      metadata: {
        app_role: APP_ROLES.replica_ro,
        transaction_read_only: reported,
      },
    });
  }

  return { reported, matches };
}

// ── Transaction helper ───────────────────────────────────────────────────────
// Wraps a callback in a Drizzle transaction so that all DB operations within
// `fn` share the same underlying Postgres transaction and are committed or
// rolled back atomically.
//
// Usage:
//   import { withTransaction } from "./db";
//   const result = await withTransaction(async (tx) => {
//     await tx.insert(deals).values(deal);
//     await tx.insert(auditLog).values(entry);
//     return deal;
//   });

export async function withTransaction<T>(fn: (tx: PrimaryDb) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx as unknown as PrimaryDb);
  });
}
