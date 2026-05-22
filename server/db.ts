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
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
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

export const db = drizzle(pool, { schema });

// ─── T8: Read Replica Routing ─────────────────────────────────────────────────
// When DATABASE_REPLICA_URL is set (e.g. a Fly.io Postgres read replica),
// heavy analytics/reporting queries are routed to the replica, relieving
// the primary of read pressure from dashboard, cohort, and portfolio queries.
//
// Usage in services:
//   import { dbReadOnly } from "../db";
//   const rows = await dbReadOnly.select().from(leads).where(...);
//
// If DATABASE_REPLICA_URL is not set, dbReadOnly falls back to the primary.

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

export const dbReadOnly = drizzle(replicaPool, { schema });

// Pillar 8.6 — canonical alias preferred by `server/db-replica.ts` and new
// call sites. `dbReplica` is null when no replica is configured so the
// `dbForReads()` helper can transparently fall back to the primary.
export const dbReplica = process.env.DATABASE_REPLICA_URL ? dbReadOnly : null;

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

export async function withTransaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx as unknown as typeof db);
  });
}
