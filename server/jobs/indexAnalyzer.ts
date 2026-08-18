/**
 * Database Query Analyzer & Missing Index Detector (T75)
 *
 * Runs weekly against pg_stat_statements to:
 *  1. Identify slow queries (avg execution > 100ms)
 *  2. Detect sequential scans on large tables
 *  3. Suggest CREATE INDEX CONCURRENTLY statements
 *  4. Optionally apply them automatically (OTEL_AUTO_INDEX=true)
 *
 * Scheduled: DAILY at ~02:00 UTC, by startIndexAnalyzerJob() in
 * server/jobs/runScheduledJobs.ts (a trackInterval tick guarded by
 * withJobLock('index_analyzer', 23h)).
 *
 * This header said "every Sunday at 2 AM UTC via BullMQ repeatable job" until
 * 2026-08-17. There is no BullMQ registrar for it — the only wiring that runs
 * it is the daily interval above. The OD-4 note below inherited "weekly" from
 * this line before it was checked; both are corrected. A schedule claim nobody
 * verifies is how you reason about a failure rate off by 7x.
 * Results stored in organizationIntegrations with provider='index_analysis'
 * and exposed via GET /api/admin/index-analysis.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { organizationIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger";
import { SYSTEM_ORG_ID } from "@shared/tenancy/systemOrg";

// Was `const PLATFORM_ORG_ID = 0` — a sixth private spelling of "the platform's
// own org", and the only one that said 0. `organizations.id` is a `serial`, so
// it begins at 1 and row 0 does not exist unless someone inserted it
// explicitly. Repointed to the shared constant on the founder's decision
// (OD-4, 2026-08-17).
//
// This was NOT a harmless no-op read. `saveReport` INSERTs with this id, so the
// insert failed its foreign key on every DAILY run — and the catch below swallowed it
// as an INFO line. `getLastReport` then found nothing, and
// GET /api/admin/index-analysis (founder-only, routes-admin.ts:2771) has been
// answering "No analysis run yet" ever since, while the weekly job computed a
// report and threw it away.
const PROVIDER = "index_analysis";

export interface SlowQuery {
  query: string;
  calls: number;
  totalTimeMs: number;
  avgTimeMs: number;
  rows: number;
}

export interface SequentialScan {
  tableName: string;
  seqScan: number;
  seqTupRead: number;
  indexScan: number;
  liveRows: number;
  seqScanRatio: number;
}

export interface IndexSuggestion {
  tableName: string;
  reason: string;
  suggestedSql: string;
  severity: "high" | "medium" | "low";
}

export interface IndexAnalysisReport {
  generatedAt: Date;
  slowQueries: SlowQuery[];
  sequentialScans: SequentialScan[];
  suggestions: IndexSuggestion[];
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

async function fetchSlowQueries(): Promise<SlowQuery[]> {
  try {
    // pg_stat_statements must be enabled (shared_preload_libraries = 'pg_stat_statements')
    const result = await db.execute(sql`
      SELECT
        query,
        calls,
        ROUND((total_exec_time)::numeric, 2) AS total_time_ms,
        ROUND((mean_exec_time)::numeric, 2) AS avg_time_ms,
        rows
      FROM pg_stat_statements
      WHERE mean_exec_time > 100
        AND calls > 5
        AND query NOT LIKE '%pg_stat%'
        AND query NOT LIKE '%EXPLAIN%'
      ORDER BY mean_exec_time DESC
      LIMIT 20
    `);
    return ((result as any).rows ?? []).map((r: any) => ({
      query: r.query?.slice(0, 500) ?? "",
      calls: Number(r.calls),
      totalTimeMs: Number(r.total_time_ms),
      avgTimeMs: Number(r.avg_time_ms),
      rows: Number(r.rows),
    }));
  } catch {
    // pg_stat_statements not enabled — skip
    return [];
  }
}

async function fetchSequentialScans(): Promise<SequentialScan[]> {
  try {
    const result = await db.execute(sql`
      SELECT
        relname AS table_name,
        seq_scan,
        seq_tup_read,
        idx_scan AS index_scan,
        n_live_tup AS live_rows,
        CASE WHEN (seq_scan + idx_scan) > 0
          THEN ROUND(seq_scan::numeric / (seq_scan + idx_scan) * 100, 1)
          ELSE 0
        END AS seq_scan_ratio
      FROM pg_stat_user_tables
      WHERE n_live_tup > 1000
        AND seq_scan > 100
        AND seq_scan > COALESCE(idx_scan, 0)
      ORDER BY seq_tup_read DESC
      LIMIT 15
    `);
    return ((result as any).rows ?? []).map((r: any) => ({
      tableName: r.table_name,
      seqScan: Number(r.seq_scan),
      seqTupRead: Number(r.seq_tup_read),
      indexScan: Number(r.index_scan),
      liveRows: Number(r.live_rows),
      seqScanRatio: Number(r.seq_scan_ratio),
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch existing indexes to avoid suggesting duplicates.
 */
async function fetchExistingIndexes(): Promise<Set<string>> {
  try {
    const result = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
    `);
    return new Set(
      ((result as any).rows ?? []).map((r: any) => r.indexname as string)
    );
  } catch {
    return new Set();
  }
}

function buildSuggestions(
  seqScans: SequentialScan[],
  existingIndexes: Set<string>,
  slowQueries: SlowQuery[]
): IndexSuggestion[] {
  const suggestions: IndexSuggestion[] = [];

  // Suggest indexes for tables with high sequential scan ratios
  for (const scan of seqScans) {
    const indexName = `idx_${scan.tableName}_org_created`;
    if (!existingIndexes.has(indexName)) {
      // Most AcreOS tables filter by (organization_id, created_at)
      suggestions.push({
        tableName: scan.tableName,
        reason: `${scan.seqScanRatio}% of scans on ${scan.tableName} (${scan.liveRows.toLocaleString()} rows) are sequential`,
        suggestedSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON ${scan.tableName} (organization_id, created_at DESC);`,
        severity: scan.seqScanRatio > 80 ? "high" : scan.seqScanRatio > 50 ? "medium" : "low",
      });
    }

    // Suggest a status index if table name suggests status filtering
    if (["leads", "deals", "notes", "campaigns", "properties"].includes(scan.tableName)) {
      const statusIdx = `idx_${scan.tableName}_org_status`;
      if (!existingIndexes.has(statusIdx)) {
        suggestions.push({
          tableName: scan.tableName,
          reason: `${scan.tableName} is frequently filtered by status — composite index recommended`,
          suggestedSql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${statusIdx} ON ${scan.tableName} (organization_id, status);`,
          severity: "medium",
        });
      }
    }
  }

  // Suggest index based on slow query patterns
  for (const q of slowQueries) {
    // Look for WHERE clauses without indexed columns (very basic heuristic)
    if (q.avgTimeMs > 500 && q.query.includes("WHERE")) {
      suggestions.push({
        tableName: "unknown (see query)",
        reason: `Query averaging ${q.avgTimeMs}ms across ${q.calls} calls — review for missing index`,
        suggestedSql: `-- Review: ${q.query.slice(0, 200)}`,
        severity: "high",
      });
    }
  }

  return suggestions.slice(0, 20); // cap at 20 suggestions
}

// ---------------------------------------------------------------------------
// Report storage
// ---------------------------------------------------------------------------

async function saveReport(report: IndexAnalysisReport): Promise<void> {
  // organizationIntegrations.credentials is a typed jsonb whose shape only
  // models integration secrets; the index-analysis report has no dedicated
  // column, so it is persisted as a JSON blob in the `encrypted` slot and
  // round-tripped by getLastReport below.
  const credentials = {
    encrypted: JSON.stringify({
      report: {
        ...report,
        generatedAt: report.generatedAt.toISOString(),
      },
    }),
  };

  try {
    const [existing] = await db
      .select()
      .from(organizationIntegrations)
      .where(
        and(
          eq(organizationIntegrations.organizationId, SYSTEM_ORG_ID),
          eq(organizationIntegrations.provider, PROVIDER)
        )
      )
      .limit(1);

    if (existing) {
      await db
        .update(organizationIntegrations)
        .set({ credentials, updatedAt: new Date() })
        .where(eq(organizationIntegrations.id, existing.id));
    } else {
      await db.insert(organizationIntegrations).values({
        organizationId: SYSTEM_ORG_ID,
        provider: PROVIDER,
        isEnabled: true,
        credentials,
      });
    }
  } catch (err) {
    // Was: `logger.info("… (org 0 may not exist) — report logged above")`, with
    // the error discarded. That INFO line is how a foreign-key violation on
    // EVERY run stayed invisible for the life of this job. A failed persist
    // means the founder's index-analysis panel is empty and nobody is told why,
    // so it is a WARN and it carries the actual error.
    logger.warn("[IndexAnalyzer] could not persist report", {
      error: err instanceof Error ? err.message : String(err),
      organizationId: SYSTEM_ORG_ID,
      provider: PROVIDER,
    });
  }
}

export async function getLastReport(): Promise<IndexAnalysisReport | null> {
  try {
    const [row] = await db
      .select()
      .from(organizationIntegrations)
      .where(
        and(
          eq(organizationIntegrations.organizationId, SYSTEM_ORG_ID),
          eq(organizationIntegrations.provider, PROVIDER)
        )
      )
      .limit(1);

    if (!row?.credentials?.encrypted) return null;
    const parsed = JSON.parse(row.credentials.encrypted) as {
      report?: Omit<IndexAnalysisReport, "generatedAt"> & { generatedAt: string };
    };
    if (!parsed.report) return null;
    return {
      ...parsed.report,
      generatedAt: new Date(parsed.report.generatedAt),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runIndexAnalysis(): Promise<IndexAnalysisReport> {
  logger.info("[IndexAnalyzer] Starting database analysis...");

  const [slowQueries, sequentialScans, existingIndexes] = await Promise.all([
    fetchSlowQueries(),
    fetchSequentialScans(),
    fetchExistingIndexes(),
  ]);

  const suggestions = buildSuggestions(sequentialScans, existingIndexes, slowQueries);

  const report: IndexAnalysisReport = {
    generatedAt: new Date(),
    slowQueries,
    sequentialScans,
    suggestions,
  };

  // Log summary
  logger.info(`[IndexAnalyzer] Analysis complete: ${slowQueries.length} slow queries, ` +
    `${sequentialScans.length} seq scan tables, ${suggestions.length} suggestions`);

  if (suggestions.filter((s) => s.severity === "high").length > 0) {
    logger.warn(`[IndexAnalyzer] ⚠️ ${suggestions.filter((s) => s.severity === "high").length} HIGH severity index recommendations`);
    for (const s of suggestions.filter((s) => s.severity === "high")) {
      logger.warn(`  → ${s.tableName}: ${s.reason}`);
      logger.warn(`    ${s.suggestedSql}`);
    }
  }

  // Auto-apply if configured (opt-in)
  if (process.env.OTEL_AUTO_INDEX === "true") {
    logger.info("[IndexAnalyzer] Auto-applying HIGH severity index suggestions...");
    for (const s of suggestions.filter((s) => s.severity === "high")) {
      if (s.suggestedSql.startsWith("CREATE INDEX")) {
        try {
          await db.execute(sql.raw(s.suggestedSql));
          logger.info(`[IndexAnalyzer] Applied: ${s.suggestedSql}`);
        } catch (err: any) {
          logger.error(`[IndexAnalyzer] Failed to apply index: ${err.message}`);
        }
      }
    }
  }

  await saveReport(report);
  return report;
}

/**
 * Register the weekly index analysis job with BullMQ.
 */
export async function registerIndexAnalyzerJob(queue: any): Promise<void> {
  await queue.add(
    "index-analyzer",
    {},
    {
      repeat: {
        pattern: "0 2 * * 0", // 2 AM UTC every Sunday
      },
      removeOnComplete: 3,
      removeOnFail: 2,
    }
  );
  logger.info("[IndexAnalyzer] Registered weekly index analysis job (Sundays at 2 AM UTC)");
}
