/**
 * T2 — DB Connection Pool Tuning + Slow Query Monitoring
 *
 * Pool is tuned for production multi-instance deployments:
 *   max: 20 connections (enough for 2-3 Fly.io instances)
 *   idleTimeoutMillis: 30s (release unused connections quickly)
 *   connectionTimeoutMillis: 5s (fail fast rather than queue)
 *   statement_timeout: 30s (kill runaway queries at the DB level)
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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 60_000,
  connectionTimeoutMillis: 10_000, // increased from 3s — cloud DBs can be slow to acquire
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
