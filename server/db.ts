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

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const SLOW_QUERY_THRESHOLD_MS = parseInt(
  process.env.SLOW_QUERY_THRESHOLD_MS ?? "500",
  10,
);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Pool sizing — 20 max across all instances on this node
  max: parseInt(process.env.DB_POOL_MAX ?? "20", 10),
  // Release connections idle for > 30s back to the pool
  idleTimeoutMillis: 30_000,
  // Fail if a connection can't be acquired in 5s
  connectionTimeoutMillis: 5_000,
  // Kill any individual statement that runs > 30s at the Postgres level
  options: "-c statement_timeout=30000",
});

// Slow query instrumentation — attach to every pooled connection
pool.on("connect", (client) => {
  const originalQuery = client.query.bind(client);
  (client as any).query = function (...args: any[]) {
    const start = Date.now();
    const queryText =
      typeof args[0] === "string" ? args[0] : (args[0]?.text ?? "unknown");

    const result = originalQuery(...args);

    // result may be a Promise or a Query object with a then()
    if (result && typeof (result as any).then === "function") {
      (result as Promise<any>)
        .then(() => {
          const duration = Date.now() - start;
          if (duration >= SLOW_QUERY_THRESHOLD_MS) {
            const truncated = queryText.slice(0, 200);
            console.warn(
              `[db:slow] ${duration}ms — ${truncated}${queryText.length > 200 ? "…" : ""}`,
            );
          }
        })
        .catch(() => {});
    }

    return result;
  };
});

pool.on("error", (err) => {
  console.error("[db:pool] Unexpected client error:", err.message);
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
  console.error("[db:replica] Unexpected client error:", err.message);
});

export const dbReadOnly = drizzle(replicaPool, { schema });
