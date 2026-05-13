/**
 * Data retention job — runs nightly to archive/purge old records.
 * Prevents unbounded table growth for high-volume tables.
 *
 * Scheduled at 3 AM UTC (see server/index.ts).
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Retention rules: each entry defines a table, the timestamp column to check,
 * how many days to retain, and a human-readable label for logging.
 */
const retentionRules = [
  { table: "job_health_logs", column: "created_at", retainDays: 30, label: "Job health logs" },
  { table: "agent_events", column: "created_at", retainDays: 60, label: "Agent events" },
  { table: "activity_log", column: "created_at", retainDays: 90, label: "Activity logs" },
  { table: "ai_telemetry_events", column: "created_at", retainDays: 30, label: "AI telemetry" },
  { table: "usage_events", column: "created_at", retainDays: 90, label: "Usage events" },
  { table: "notification_history", column: "created_at", retainDays: 60, label: "Notification history" },
  { table: "revenue_protection_interventions", column: "created_at", retainDays: 180, label: "Revenue interventions" },
];

export async function runDataRetention(): Promise<{ purged: number; auditReport: AuditRetentionReport }> {
  let totalPurged = 0;

  for (const rule of retentionRules) {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - rule.retainDays);

      const result = await db.execute(sql.raw(
        `DELETE FROM ${rule.table} WHERE ${rule.column} < '${cutoff.toISOString()}' RETURNING id`
      ));

      const count = Array.isArray(result) ? result.length : 0;
      if (count > 0) {
        logger.info(`[data-retention] Purged ${count} rows from ${rule.label} (>${rule.retainDays}d old)`);
        totalPurged += count;
      }
    } catch (err) {
      // Table may not exist yet — that's fine, skip it
      logger.debug(`[data-retention] Skipped ${rule.label}: ${String(err)}`);
    }
  }

  // Pillar D / D4 — Audit-events retention report. The table has append-only
  // triggers (migration 0049) so we can't DELETE here. Instead we surface
  // the row distribution + warn when archival is overdue (oldest event
  // exceeds the 7-year retention floor). Actual archival to cold storage
  // is a future iteration that temporarily disables the trigger, exports
  // to S3 Glacier, then re-enables.
  const auditReport = await reportAuditEventsRetention();

  logger.info(`[data-retention] Complete — purged ${totalPurged} total rows across ${retentionRules.length} tables`);
  return { purged: totalPurged, auditReport };
}

// ─── Pillar D / D4 — audit_events retention report ────────────────────────

const AUDIT_RETENTION_FLOOR_DAYS = 7 * 365; // 7-year minimum, per compliance comment in schema

export interface AuditRetentionReport {
  totalRows: number;
  oldestEventAt: string | null;
  rowsOlderThanFloor: number;
  archivalOverdue: boolean;
  approxSizeMb: number;
}

export async function reportAuditEventsRetention(): Promise<AuditRetentionReport> {
  try {
    const floorDate = new Date();
    floorDate.setDate(floorDate.getDate() - AUDIT_RETENTION_FLOOR_DAYS);

    const totalResult = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM audit_events`));
    const oldestResult = await db.execute(sql.raw(`SELECT MIN(created_at) AS oldest FROM audit_events`));
    const overdueResult = await db.execute(sql.raw(
      `SELECT count(*)::int AS n FROM audit_events WHERE created_at < '${floorDate.toISOString()}'`,
    ));
    const sizeResult = await db.execute(sql.raw(
      `SELECT (pg_total_relation_size('audit_events') / 1024 / 1024)::int AS mb`,
    ));

    const totalRows = Number((totalResult as unknown as Array<{ n: number }>)[0]?.n ?? 0);
    const oldestEventAt =
      ((oldestResult as unknown as Array<{ oldest: Date | string | null }>)[0]?.oldest as Date | string | null) ?? null;
    const rowsOlderThanFloor = Number((overdueResult as unknown as Array<{ n: number }>)[0]?.n ?? 0);
    const approxSizeMb = Number((sizeResult as unknown as Array<{ mb: number }>)[0]?.mb ?? 0);

    const report: AuditRetentionReport = {
      totalRows,
      oldestEventAt: oldestEventAt
        ? oldestEventAt instanceof Date
          ? oldestEventAt.toISOString()
          : String(oldestEventAt)
        : null,
      rowsOlderThanFloor,
      archivalOverdue: rowsOlderThanFloor > 0,
      approxSizeMb,
    };

    if (report.archivalOverdue) {
      logger.warn("[data-retention] audit_events archival OVERDUE", {
        source: "data-retention",
        metadata: {
          rowsOlderThanFloor: report.rowsOlderThanFloor,
          floorDays: AUDIT_RETENTION_FLOOR_DAYS,
          approxSizeMb: report.approxSizeMb,
        },
      });
    } else {
      logger.info("[data-retention] audit_events retention OK", {
        source: "data-retention",
        metadata: {
          totalRows: report.totalRows,
          oldestEventAt: report.oldestEventAt,
          approxSizeMb: report.approxSizeMb,
        },
      });
    }

    return report;
  } catch (err) {
    logger.error("[data-retention] audit_events retention report failed", err);
    return {
      totalRows: 0,
      oldestEventAt: null,
      rowsOlderThanFloor: 0,
      archivalOverdue: false,
      approxSizeMb: 0,
    };
  }
}
