/**
 * backupRestoreVerify.ts — Tier 1E (elevation blueprint): weekly automated
 * backup RESTORE verification.
 *
 * A backup that has never been restored is a hope, not a backup. This job:
 *   1. Lists DB_BACKUP_S3_BUCKET under database-backups/ and picks the most
 *      recent pg_dump object.
 *   2. Downloads it and restores it into a SCRATCH database
 *      (acreos_restore_verify) on the same Postgres host — created fresh and
 *      dropped at the end, success or failure.
 *   3. Asserts row-count parity on the crown-jewel tables vs LIVE production
 *      counts, within DRIFT_TOLERANCE_PCT (the dump can be up to ~24h old —
 *      daily cadence — so exact equality is wrong; a near-empty restore is a
 *      corrupt/partial backup and FAILS).
 *   4. Writes one `backup_verified` row (status verified | failed) — the
 *      durable proof trail the deadman/founder surfaces can read.
 *
 * Config-dormant behaviour (blueprint: dormant jobs must be VISIBLE, never
 * silently forgotten): when DB_BACKUP_S3_BUCKET / AWS creds are absent,
 * `backupVerifyDisabledReason()` returns the reason. The job roster entry
 * (jobRegistry.ts) uses the same predicate as its `disabledWhen`, and the
 * deadman's config-dormant meta-check (deadmanCheck.ts) lists every dormant
 * CRITICAL job each sweep so "wired but dark" can't rot unseen.
 *
 * Credential hygiene: psql/pg connections receive credentials via PG* env
 * vars (pgEnvFromDatabaseUrl) — never on a child-process argv.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { db } from "../db";
import { backupVerified } from "@shared/schema";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { pgEnvFromDatabaseUrl } from "../utils/pgEnv";
import { backupConfigMissingReason } from "./jobRegistry";

const execFileAsync = promisify(execFile);

/**
 * Audit F-13-1: page the founder's phone when restore-verification fails.
 * Routed through alertSpine.raiseAlert (critical → pageCriticalThrottled),
 * the SAME live page path the deadman uses — NOT the Class-C in-app tray the
 * generic job:failed event resolves to. Best-effort: a page failure must never
 * change the verification result.
 */
async function pageBackupVerifyFailure(detail: string): Promise<void> {
  try {
    const { raiseAlert } = await import("../services/alertSpine");
    await raiseAlert({
      severity: "critical",
      source: "backupRestoreVerify",
      title: "Weekly backup restore-verification FAILED",
      detail,
      dedupeKey: "backup_restore_verify_failed",
      domain: "reliability",
      citedReason: "A backup that cannot be restored is not a backup — this is data-loss exposure.",
    });
  } catch (err) {
    logger.error("[backupRestoreVerify] failed to page on verification failure", err instanceof Error ? err : undefined);
  }
}

/** Fixed scratch DB name — a crashed prior run is cleaned up by the next. */
export const SCRATCH_DB_NAME = "acreos_restore_verify";

/**
 * Crown-jewel tables: the data whose loss is unrecoverable-business-ending.
 * `financial_ledger` lives in migrate.mjs DDL only (system-of-record, Tahoe
 * L6); tables absent from PRODUCTION are skipped, not failed, so this list
 * can lead the schema slightly.
 */
export const CROWN_JEWEL_TABLES = [
  "organizations",
  "leads",
  "properties",
  "deals",
  "financial_ledger",
] as const;

/** Allowed count drift between live prod and the (≤7-day-old) restored dump. */
export const DRIFT_TOLERANCE_PCT = 20;
/** Tiny-table escape hatch: absolute diffs ≤ this many rows always pass. */
export const ABS_ROW_SLACK = 25;

export interface TableCheck {
  table: string;
  /** null = table does not exist in that database */
  prodCount: number | null;
  scratchCount: number | null;
  driftPct: number | null;
  ok: boolean;
  note?: string;
}

export interface CompareResult {
  ok: boolean;
  maxDriftPct: number;
  tables: TableCheck[];
}

/**
 * Why is this job config-dormant (or null if fully configured)?
 * ONE predicate, three surfaces: the job body (skip log), the JOB_ROSTER
 * `disabledWhen`, and the deadman's config-dormant meta-check — defined in
 * jobRegistry.ts (the dependency-free jobs module) and re-exported here.
 */
export const backupVerifyDisabledReason = backupConfigMissingReason;

/**
 * Pure assertion core (unit-tested without a database).
 *
 * Rules per table:
 *  - absent in PROD            → skipped (ok, noted) — schema may trail list
 *  - present in prod, absent in scratch → FAIL (dump is missing a table)
 *  - prod > 0 but scratch == 0 → FAIL (empty restore of a live table)
 *  - |prod−scratch| ≤ ABS_ROW_SLACK → ok (tiny-table noise)
 *  - drift% = |prod−scratch|/prod*100 ≤ tolerance → ok, else FAIL
 */
export function compareCrownJewelCounts(
  counts: Array<{ table: string; prodCount: number | null; scratchCount: number | null }>,
  tolerancePct: number = DRIFT_TOLERANCE_PCT,
  absRowSlack: number = ABS_ROW_SLACK,
): CompareResult {
  const tables: TableCheck[] = [];
  let maxDriftPct = 0;

  for (const { table, prodCount, scratchCount } of counts) {
    if (prodCount === null) {
      tables.push({
        table, prodCount, scratchCount, driftPct: null, ok: true,
        note: "absent in production — skipped (schema not yet migrated)",
      });
      continue;
    }
    if (scratchCount === null) {
      tables.push({
        table, prodCount, scratchCount, driftPct: null, ok: false,
        note: "table present in production but MISSING from restored dump",
      });
      continue;
    }
    if (prodCount > 0 && scratchCount === 0) {
      tables.push({
        table, prodCount, scratchCount, driftPct: 100, ok: false,
        note: "restored table is EMPTY while production has rows",
      });
      maxDriftPct = Math.max(maxDriftPct, 100);
      continue;
    }
    const absDiff = Math.abs(prodCount - scratchCount);
    const driftPct = prodCount === 0 ? 0 : (absDiff / prodCount) * 100;
    maxDriftPct = Math.max(maxDriftPct, driftPct);
    const ok = absDiff <= absRowSlack || driftPct <= tolerancePct;
    tables.push({
      table, prodCount, scratchCount,
      driftPct: Math.round(driftPct * 100) / 100,
      ok,
      ...(ok ? {} : { note: `count drift ${driftPct.toFixed(1)}% exceeds ${tolerancePct}% tolerance` }),
    });
  }

  return { ok: tables.every((t) => t.ok), maxDriftPct: Math.round(maxDriftPct * 100) / 100, tables };
}

/** Pure picker (unit-tested): newest object under the backups prefix. */
export function pickLatestBackup(
  objects: Array<{ Key?: string; LastModified?: Date; Size?: number }>,
): { key: string; size: number } | null {
  let best: { key: string; size: number; ts: number } | null = null;
  for (const o of objects) {
    if (!o.Key || !o.Key.endsWith(".sql")) continue;
    const ts = o.LastModified ? o.LastModified.getTime() : 0;
    if (!best || ts > best.ts) best = { key: o.Key, size: o.Size ?? 0, ts };
  }
  return best ? { key: best.key, size: best.size } : null;
}

async function countIfExists(
  query: (q: string) => Promise<Array<Record<string, unknown>>>,
  table: string,
): Promise<number | null> {
  const exists = await query(
    `SELECT to_regclass('public."${table}"') IS NOT NULL AS present`,
  );
  if (!exists[0] || exists[0].present !== true) return null;
  const rows = await query(`SELECT count(*)::bigint AS c FROM "${table}"`);
  return Number(rows[0]?.c ?? 0);
}

export interface RestoreVerifyResult {
  status: "verified" | "failed" | "skipped_config";
  backupKey?: string;
  maxDriftPct?: number;
  tables?: TableCheck[];
  error?: string;
}

/**
 * Full restore-verification pass. Never throws — failures are written to
 * backup_verified (status "failed") and logged at error level, so a broken
 * backup pipeline is LOUD in the proof trail, not an unhandled rejection.
 */
export async function runBackupRestoreVerification(): Promise<RestoreVerifyResult> {
  const startedAt = Date.now();

  const dormantReason = backupVerifyDisabledReason();
  if (dormantReason) {
    // Config-dormant: visible via the roster disabledWhen + deadman meta-check.
    logger.info(`[backupRestoreVerify] skipped — ${dormantReason}`);
    return { status: "skipped_config", error: dormantReason };
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.error("[backupRestoreVerify] DATABASE_URL not set — cannot verify");
    return { status: "failed", error: "DATABASE_URL not set" };
  }

  const bucket = process.env.DB_BACKUP_S3_BUCKET!;
  const region = process.env.AWS_REGION || "us-east-1";
  const dumpPath = path.join(os.tmpdir(), `restore-verify-${Date.now()}.sql`);
  let backupKey = "";
  let backupSize = 0;
  let scratchCreated = false;

  const { Client } = await import("pg");

  const adminQuery = async (q: string): Promise<Array<Record<string, unknown>>> => {
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const r = await client.query(q);
      return r.rows as Array<Record<string, unknown>>;
    } finally {
      await client.end().catch(() => {});
    }
  };

  try {
    // 1 ── locate + download the newest backup
    const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({ region });
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "database-backups/" }),
    );
    const latest = pickLatestBackup(listed.Contents ?? []);
    if (!latest) {
      throw new Error(`no backup objects found under s3 prefix database-backups/ — has the daily db_backup job ever succeeded?`);
    }
    backupKey = latest.key;
    backupSize = latest.size;

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: backupKey }));
    const bytes = await obj.Body!.transformToByteArray();
    fs.writeFileSync(dumpPath, Buffer.from(bytes));
    logger.info(`[backupRestoreVerify] downloaded ${backupKey} (${(bytes.length / 1024 / 1024).toFixed(1)}MB)`);

    // 2 ── recreate the scratch database (FORCE-drop any crashed prior run)
    await adminQuery(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}" WITH (FORCE)`).catch(async (err) => {
      // Pre-PG13 has no WITH (FORCE); fall back to the plain form.
      if (String(err).includes("syntax error")) {
        await adminQuery(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}"`);
      } else throw err;
    });
    await adminQuery(`CREATE DATABASE "${SCRATCH_DB_NAME}"`);
    scratchCreated = true;

    // 3 ── restore the dump into the scratch DB. Credentials via PG* env
    // (never argv). ON_ERROR_STOP=0: --no-owner/--no-acl dumps can emit
    // benign role/extension errors; the count assertions below are the gate.
    await execFileAsync(
      "psql",
      ["-q", "-v", "ON_ERROR_STOP=0", "-f", dumpPath],
      {
        env: { ...process.env, ...pgEnvFromDatabaseUrl(dbUrl, SCRATCH_DB_NAME) },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30 * 60 * 1000,
      },
    );

    // 4 ── count crown jewels in prod (live pool) and scratch (direct client)
    const scratchClient = new Client({
      connectionString: dbUrl.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH_DB_NAME}$1`),
    });
    await scratchClient.connect();

    const counts: Array<{ table: string; prodCount: number | null; scratchCount: number | null }> = [];
    try {
      for (const table of CROWN_JEWEL_TABLES) {
        const prodCount = await countIfExists(async (q) => {
          const r = await db.execute(sql.raw(q));
          return (r as unknown as { rows: Array<Record<string, unknown>> }).rows;
        }, table);
        const scratchCount = await countIfExists(async (q) => {
          const r = await scratchClient.query(q);
          return r.rows as Array<Record<string, unknown>>;
        }, table);
        counts.push({ table, prodCount, scratchCount });
      }
    } finally {
      await scratchClient.end().catch(() => {});
    }

    const result = compareCrownJewelCounts(counts);
    const durationMs = Date.now() - startedAt;

    // 5 ── durable proof row
    await db.insert(backupVerified).values({
      backupKey,
      backupSizeBytes: backupSize,
      status: result.ok ? "verified" : "failed",
      tablesChecked: result.tables,
      maxDriftPct: result.maxDriftPct,
      error: result.ok
        ? null
        : result.tables.filter((t) => !t.ok).map((t) => `${t.table}: ${t.note}`).join("; "),
      durationMs,
    });

    if (result.ok) {
      logger.info(
        `[backupRestoreVerify] VERIFIED ${backupKey} — ${result.tables.length} tables, max drift ${result.maxDriftPct}% (${Math.round(durationMs / 1000)}s)`,
      );
      return { status: "verified", backupKey, maxDriftPct: result.maxDriftPct, tables: result.tables };
    }
    logger.error(
      `[backupRestoreVerify] FAILED ${backupKey} — ${result.tables.filter((t) => !t.ok).map((t) => t.table).join(", ")} out of tolerance`,
      undefined,
      { metadata: { tables: result.tables } },
    );
    // Audit F-13-1: a job that RUNS AND FAILS must reach the founder's phone,
    // not just the Class-C in-app tray. A silently-corrupt backup is data-loss
    // exposure — page it.
    await pageBackupVerifyFailure(
      `Restore-verification FAILED for ${backupKey}: crown-jewel row-count parity out of tolerance (${result.tables.filter((t) => !t.ok).map((t) => t.table).join(", ")}).`,
    );
    return { status: "failed", backupKey, maxDriftPct: result.maxDriftPct, tables: result.tables };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[backupRestoreVerify] verification errored: ${message}`, err instanceof Error ? err : undefined);
    // Best-effort failed proof row so the failure is in the trail, not just logs.
    try {
      await db.insert(backupVerified).values({
        backupKey: backupKey || "(none located)",
        backupSizeBytes: backupSize || null,
        status: "failed",
        error: message.slice(0, 2000),
        durationMs: Date.now() - startedAt,
      });
    } catch {
      /* proof-row write is best-effort */
    }
    // Audit F-13-1: page — a restore-verify that errors out is as serious as
    // one that fails the parity check.
    await pageBackupVerifyFailure(`Restore-verification errored: ${message}`);
    return { status: "failed", backupKey: backupKey || undefined, error: message };
  } finally {
    try { if (fs.existsSync(dumpPath)) fs.unlinkSync(dumpPath); } catch { /* tmp cleanup */ }
    if (scratchCreated) {
      try {
        await adminQuery(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}" WITH (FORCE)`);
      } catch (err) {
        logger.warn(`[backupRestoreVerify] scratch DB drop failed (next run will FORCE-drop): ${String(err)}`);
      }
    }
  }
}
