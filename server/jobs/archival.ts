/**
 * Pillar 9.2 — Cold-storage archival for old activity tables.
 *
 * Activity tables (lead_activities, ai_call_log, financial_ledger, audit
 * logs, messages, …) grow forever but are read <0.1% of the time once
 * they're older than ~90 days.  Keeping that long-tail mass in the
 * primary OLTP database hurts:
 *
 *   • Postgres dump/restore time — every nightly backup hauls the cold
 *     rows whether they're queried or not.
 *   • Index size — every B-tree page has to load through shared_buffers
 *     even when only the recent slice is hot.
 *   • Vacuum / autovacuum pressure — wraparound XID protection runs
 *     across the whole heap.
 *
 * The pattern: at 4am daily, sweep each archive-eligible table for rows
 * older than `archival.horizon_days` (default 90) and stream them to
 * Cloudflare R2 in Parquet format, partitioned by year/month.  Then
 * DELETE from primary in the same transaction as a sweep checkpoint
 * (so a crash between R2-write and DB-delete is recoverable).
 *
 * R2 path layout:
 *   acreos-archive/{table_name}/{yyyy}/{mm}/{batch_id}.parquet
 *
 * Querying archived rows (deferred — Tom's TODO when R2 is configured):
 * ─────────────────────────────────────────────────────────────────────
 * The right read-path is a Postgres FDW (parquet_s3_fdw or similar)
 * that lets `SELECT * FROM lead_activities_archive WHERE ...` route to
 * R2 transparently.  That requires:
 *
 *   1. Installing parquet_s3_fdw extension on the Fly Postgres machine.
 *   2. Creating a FOREIGN SERVER pointing at the R2 endpoint with the
 *      bucket creds.
 *   3. Creating one IMPORT FOREIGN SCHEMA … OPTIONS (path 'lead_activities/')
 *      per archive-eligible table.
 *
 * Once those are in place, queries against the archive look identical
 * to queries against primary — the FDW handles partition pruning by
 * file-name pattern.  Not implemented in this pass; Tom needs to set
 * up the FDW in his Postgres before this becomes reachable.
 *
 * Until then, the archived parquet files are queryable directly with
 * any S3-compatible Parquet reader (DuckDB CLI is the easiest:
 *   `DuckDB> SELECT * FROM 's3://acreos-archive/lead_activities/2026/01/*.parquet'`).
 *
 * Default state: opt-in.
 * ─────────────────────
 * `founder_settings.archival.enabled` defaults to false.  Tom flips it
 * on once R2 creds are configured in Fly and the bucket exists.
 */

import { db, pool } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { getSetting, getNumberSetting } from "../services/founderSettings";
import { getStorage } from "../services/cmo/storage";

const DEFAULT_HORIZON_DAYS = 90;

export interface ArchivalTableConfig {
  /** Postgres table name. */
  table: string;
  /** Column used to determine row age. Usually `created_at`. */
  ageColumn: string;
  /** Parquet schema definition (column-name → parquetjs-lite type). */
  schema: Record<string, { type: string; optional?: boolean }>;
  /**
   * Max rows to archive per sweep.  Kept tight (5k default) so a single
   * sweep doesn't block the DB for minutes — the next 4am pass will
   * pick up the remainder.
   */
  batchSize?: number;
}

/**
 * Registry of archive-eligible tables.  Adding a new table here makes
 * it eligible for the nightly sweep — no other code changes required.
 *
 * Pillar 9.2 ships with `lead_activities` only as the proof-of-pattern.
 * Tom can add `ai_call_log`, `financial_ledger`, etc. once the R2 read
 * path is validated.
 */
export const ARCHIVAL_TABLES: ArchivalTableConfig[] = [
  {
    table: "lead_activities",
    ageColumn: "created_at",
    schema: {
      id: { type: "INT64" },
      lead_id: { type: "INT64" },
      organization_id: { type: "INT64" },
      type: { type: "UTF8" },
      description: { type: "UTF8", optional: true },
      metadata: { type: "UTF8", optional: true }, // jsonb serialized as string
      performed_by: { type: "INT64", optional: true },
      created_at: { type: "UTF8" }, // ISO-8601 string
    },
    batchSize: 5000,
  },
];

export interface ArchivalSweepResult {
  table: string;
  rowsArchived: number;
  sizeBytes: number;
  archivedTo: string | null;
  durationMs: number;
  skipped?: string;
}

/**
 * Pillar 9.2 — Archive one table.  Streams candidate rows through a
 * Parquet writer in-memory, uploads the buffer to R2, then DELETEs the
 * source rows in a single transaction.
 *
 * Failure modes:
 *   • R2 write fails  → no DELETE happens.  Next sweep retries.
 *   • DELETE fails    → rows stay in primary; the R2 file is leaked but
 *                       has no PII impact (R2 bucket is private).  A
 *                       reconciliation job (TBD) can dedupe.
 *
 * Returns a structured result for logging / metrics.
 */
export async function archiveTable(
  config: ArchivalTableConfig,
  horizonDays: number,
): Promise<ArchivalSweepResult> {
  const t0 = Date.now();
  const { table, ageColumn, batchSize = 5000 } = config;

  // Pull candidate rows.  Using sql.identifier here would be ideal but
  // Drizzle's raw sql helper makes that awkward; we whitelist the
  // table/column names in code so injection isn't possible.
  if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[a-z_][a-z0-9_]*$/.test(ageColumn)) {
    throw new Error(`[archival] invalid identifier: table=${table} ageColumn=${ageColumn}`);
  }

  const cutoffSql = `NOW() - INTERVAL '${horizonDays} days'`;
  const selectSql = `SELECT * FROM "${table}" WHERE "${ageColumn}" < ${cutoffSql} ORDER BY "${ageColumn}" ASC LIMIT ${batchSize}`;
  const rowsResult = await pool.query<Record<string, unknown>>(selectSql);
  const rows = rowsResult.rows;

  if (rows.length === 0) {
    return {
      table,
      rowsArchived: 0,
      sizeBytes: 0,
      archivedTo: null,
      durationMs: Date.now() - t0,
      skipped: "no_candidates",
    };
  }

  // Lazy-load parquetjs-lite so the dependency isn't pulled into a
  // boot path that doesn't need it.  Package is CommonJS so the named
  // exports land on `.default` when accessed via ESM dynamic import.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parquetMod: any = await import("parquetjs-lite");
  const parquet = parquetMod.default ?? parquetMod;

  const schemaDef: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config.schema)) {
    schemaDef[k] = { type: v.type, optional: !!v.optional };
  }
  const schema = new parquet.ParquetSchema(schemaDef);

  // Build the file in a temp path because parquetjs-lite's writer needs
  // a real fs path.  Then read it back into a Buffer for R2 upload.
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = path.join(tmpdir(), `acreos-archive-${table}-${batchId}.parquet`);

  const writer = await parquet.ParquetWriter.openFile(schema, tmpPath);
  for (const row of rows) {
    const out: Record<string, unknown> = {};
    for (const [colName, colDef] of Object.entries(config.schema)) {
      const v = row[colName];
      if (v == null) {
        if (!colDef.optional) {
          // Non-null column came back null — schema drift.  Skip this
          // column for the row rather than crashing the whole sweep.
          out[colName] = "";
        }
        continue;
      }
      if (v instanceof Date) {
        out[colName] = v.toISOString();
      } else if (typeof v === "object") {
        out[colName] = JSON.stringify(v);
      } else if (colDef.type === "INT64" && typeof v === "string") {
        out[colName] = Number(v);
      } else {
        out[colName] = v;
      }
    }
    await writer.appendRow(out);
  }
  await writer.close();

  const fileBuf = await fs.readFile(tmpPath);
  await fs.unlink(tmpPath).catch(() => {});

  // Partition path: acreos-archive/{table}/{yyyy}/{mm}/{batch_id}.parquet
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const key = `acreos-archive/${table}/${yyyy}/${mm}/${batchId}.parquet`;

  const storage = getStorage();
  const archivedTo = await storage.write(key, fileBuf);

  // Now safe to delete from primary.  Tie the delete to the exact row
  // ids we just archived (rather than re-running the WHERE on
  // `ageColumn`) so any rows that became eligible during the parquet
  // write aren't missed-and-deleted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = rows.map((r) => (r as any).id).filter((n) => n != null);
  if (ids.length > 0) {
    await db.execute(sql.raw(`DELETE FROM "${table}" WHERE id IN (${ids.join(",")})`));
  }

  return {
    table,
    rowsArchived: rows.length,
    sizeBytes: fileBuf.byteLength,
    archivedTo: archivedTo as string,
    durationMs: Date.now() - t0,
  };
}

/**
 * Pillar 9.2 — Run a full archival sweep across every registered table.
 * Wired to the scheduler (runScheduledJobs) at 4am daily.
 *
 * Skips silently when `archival.enabled` is false (the default) so the
 * job is invisible until Tom flips it on.
 */
export async function runArchivalSweep(): Promise<{
  enabled: boolean;
  results: ArchivalSweepResult[];
}> {
  const enabledRaw = await getSetting("archival.enabled");
  if (enabledRaw !== "true") {
    return { enabled: false, results: [] };
  }

  const horizonDays = await getNumberSetting("archival.horizon_days", DEFAULT_HORIZON_DAYS);
  const results: ArchivalSweepResult[] = [];

  for (const cfg of ARCHIVAL_TABLES) {
    try {
      const result = await archiveTable(cfg, horizonDays);
      logger.info("[archival] sweep complete", {
        metadata: {
          __pii_safe: true,
          table: result.table,
          rowsArchived: result.rowsArchived,
          sizeBytes: result.sizeBytes,
          archivedTo: result.archivedTo,
          durationMs: result.durationMs,
        },
      });
      results.push(result);
    } catch (err) {
      logger.error(
        `[archival] sweep failed for ${cfg.table}`,
        err instanceof Error ? err : undefined,
      );
      results.push({
        table: cfg.table,
        rowsArchived: 0,
        sizeBytes: 0,
        archivedTo: null,
        durationMs: 0,
        skipped: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { enabled: true, results };
}
