// ============================================================================
// SERVER/SERVICES/EMBEDDINGS/PGVECTORINIT.TS
// ----------------------------------------------------------------------------
// Phase B infra — pgvector availability check + boot-time reporter for
// L3.10 (learning loop) + L3.14 (embedding-based memory).
//
// Why this exists
// ───────────────
// Embedding-using services (next wave) need to know at boot whether
// pgvector is actually installed on the connected Postgres before they
// start dispatching cosine queries — a missing extension turns every
// downstream call into a 5xx surface. This module exposes a single async
// status check + a fire-and-forget boot reporter so worker startup can
// log loud + the operator gets a clear signal in Fly logs.
//
// What this does NOT do
// ─────────────────────
// It does not install the extension (use `scripts/setup-pgvector.mjs
// install` for that — operator one-shot, not a runtime path), and it does
// not run any DDL itself. Migrations are the source of truth for schema
// state; this is read-only introspection.
// ============================================================================

import { db } from "../../db";
import { logger } from "../../utils/logger";
import { sql } from "drizzle-orm";

/**
 * Structured pgvector status report.
 *
 *  - available:           true iff the extension is installed AND the
 *                         registry table + HNSW index both exist.
 *  - extensionInstalled:  `vector` row present in pg_extension.
 *  - tableExists:         `solene_embedded_records` row present in
 *                         information_schema.tables.
 *  - indexExists:         the HNSW index on (embedding) is present.
 *  - detectedVersion:     extversion from pg_extension, or null.
 */
export interface PgvectorStatus {
  available: boolean;
  extensionInstalled: boolean;
  tableExists: boolean;
  indexExists: boolean;
  detectedVersion: string | null;
}

// Name of the embedded-records registry table (mirrors
// shared/schema/solene-embeddings.ts). Kept as a constant so the HNSW
// index name helper can compose against it without re-importing.
export const EMBEDDED_RECORDS_TABLE = "solene_embedded_records";
export const EMBEDDED_RECORDS_VECTOR_COLUMN = "embedding";

/**
 * Pure helper: build the HNSW index name for a given table + column.
 *
 * Mirrors the convention used in scripts/migrate.mjs
 * (`<table>_<column>_hnsw_idx`). Pulled out as a pure function so the
 * test surface doesn't need a database.
 */
export function buildHnswIndexName(table: string, column: string): string {
  return `${table}_${column}_hnsw_idx`;
}

/**
 * Check pgvector availability + returns a structured status report.
 *
 * Each of the four checks is wrapped so a failure in one doesn't cascade
 * — e.g. the extension check might succeed (extension installed) while
 * the table check fails (registry not yet migrated on this DB). The
 * `available` field is the conjunction of the boolean fields so callers
 * can fast-path `if (!status.available) skip-embedding-path`.
 */
export async function checkPgvectorStatus(): Promise<PgvectorStatus> {
  let extensionInstalled = false;
  let tableExists = false;
  let indexExists = false;
  let detectedVersion: string | null = null;

  // Extension presence + version.
  try {
    const result = await db.execute<{
      extname: string;
      extversion: string;
    }>(sql`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname = 'vector'
      LIMIT 1
    `);
    const rows = (result as any)?.rows ?? [];
    if (rows.length > 0) {
      extensionInstalled = true;
      detectedVersion = rows[0].extversion ?? null;
    }
  } catch (err) {
    logger.warn("[pgvectorInit] extension probe failed", {
      metadata: { error: String(err) },
    });
  }

  // Registry table presence.
  try {
    const result = await db.execute<{ table_name: string }>(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${EMBEDDED_RECORDS_TABLE}
      LIMIT 1
    `);
    const rows = (result as any)?.rows ?? [];
    tableExists = rows.length > 0;
  } catch (err) {
    logger.warn("[pgvectorInit] table probe failed", {
      metadata: { error: String(err) },
    });
  }

  // HNSW index presence. The migrate.mjs index name is hard-coded as
  // `solene_embedded_records_embedding_hnsw_idx`; we look it up by
  // exact name rather than scanning pg_indexes for any HNSW on this
  // column (the latter would require parsing indexdef).
  try {
    const indexName = buildHnswIndexName(
      EMBEDDED_RECORDS_TABLE,
      EMBEDDED_RECORDS_VECTOR_COLUMN,
    );
    const result = await db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ${EMBEDDED_RECORDS_TABLE}
        AND indexname = ${indexName}
      LIMIT 1
    `);
    const rows = (result as any)?.rows ?? [];
    indexExists = rows.length > 0;
  } catch (err) {
    logger.warn("[pgvectorInit] index probe failed", {
      metadata: { error: String(err) },
    });
  }

  const available = extensionInstalled && tableExists && indexExists;

  return {
    available,
    extensionInstalled,
    tableExists,
    indexExists,
    detectedVersion,
  };
}

/**
 * Boot-time helper — checks status + logs warn if anything is missing.
 *
 * Fire-and-forget pattern (caller does `void reportPgvectorStatusOnBoot()`);
 * never throws so a probe failure can't take down worker startup. The
 * worst case is a logged warn line and the embedding consumers skipping
 * their hot path until the next deploy lands the missing migration.
 */
export async function reportPgvectorStatusOnBoot(): Promise<void> {
  try {
    const status = await checkPgvectorStatus();
    if (status.available) {
      logger.info("[pgvectorInit] pgvector ready", {
        metadata: {
          version: status.detectedVersion,
          table: EMBEDDED_RECORDS_TABLE,
        },
      });
      return;
    }
    logger.warn("[pgvectorInit] pgvector NOT fully available", {
      metadata: {
        extensionInstalled: status.extensionInstalled,
        tableExists: status.tableExists,
        indexExists: status.indexExists,
        detectedVersion: status.detectedVersion,
        remediation:
          "Run `DATABASE_URL=... node scripts/setup-pgvector.mjs install` " +
          "then re-deploy so migrate.mjs creates the registry table + HNSW index.",
      },
    });
  } catch (err) {
    // checkPgvectorStatus already swallows + logs; this catch is belt-
    // and-suspenders for anything synchronous above (logger throws,
    // etc.).
    logger.warn("[pgvectorInit] boot reporter failed", {
      metadata: { error: String(err) },
    });
  }
}
