/**
 * Data retention job — runs nightly to archive/purge old records.
 * Prevents unbounded table growth for high-volume tables.
 *
 * Scheduled at 3 AM UTC (see server/index.ts).
 */

import { db } from "../db";
import { sql, type SQL } from "drizzle-orm";
import { logger } from "../utils/logger";

/**
 * Retention rules: each entry defines a table, the timestamp column to check,
 * how many days to retain, a human-readable label for logging, and — where the
 * table holds rows that must NEVER be purged — an extra WHERE clause that
 * excludes them.
 *
 * ── WHY `keepWhere` EXISTS ──────────────────────────────────────────────────
 * `activity_log` is not only activity logs. It is also where every Pax RECEIPT
 * lives: `paxReceipts.ts` writes each autonomous effect there with
 * `agent_type = 'pax'`, and `paxReceiptsReader.ts` — the ONE reader behind
 * `GET /api/pax/receipts` and the "What Pax did" section — reads exactly those
 * rows back. So this job was hard-DELETING the autopilot's own accountability
 * record every ninety days. Not archiving it. Deleting it.
 *
 * That is the opposite of what the product claims. "What Pax did" is the answer
 * to the only question that matters about an autonomous system, and a customer
 * asking it about a send from four months ago got an empty list — with no
 * indication that anything had ever been there.
 *
 * The predicate is DERIVED FROM THE READER rather than invented here: the
 * reader's WHERE is `eq(activityLog.agentType, "pax")`, so a row it can return
 * is a row this job must not touch. The retention test asserts that
 * correspondence against BOTH files, so a reader that widens what it returns
 * without widening what is kept fails rather than silently losing rows.
 */
const retentionRules: Array<{
  table: string;
  column: string;
  retainDays: number;
  label: string;
  /** Extra WHERE conjunct restricting what may be deleted. */
  keepWhere?: SQL;
  /** Why those rows are exempt — printed with the purge log. */
  keepReason?: string;
}> = [
  { table: "job_health_logs", column: "created_at", retainDays: 30, label: "Job health logs" },
  { table: "agent_events", column: "created_at", retainDays: 60, label: "Agent events" },
  {
    table: "activity_log",
    column: "created_at",
    retainDays: 90,
    label: "Activity logs",
    // Pax receipts live in this table and are never purged. See the block above.
    keepWhere: sql` AND agent_type IS DISTINCT FROM 'pax'`,
    keepReason: "Pax receipts (agent_type = 'pax') are the autopilot's accountability record and are retained indefinitely",
  },
  // 2026-07 audit: activity_events (the polymorphic customer timeline) is a
  // DIFFERENT table from activity_log and was growing forever — the deal/
  // lead timelines only render recent history, so a generous 2-year window
  // keeps every visible timeline intact while bounding growth.
  { table: "activity_events", column: "created_at", retainDays: 730, label: "Activity events (timeline)" },
  { table: "ai_telemetry_events", column: "created_at", retainDays: 30, label: "AI telemetry" },
  { table: "usage_events", column: "created_at", retainDays: 90, label: "Usage events" },
  { table: "notification_history", column: "created_at", retainDays: 60, label: "Notification history" },
  { table: "revenue_protection_interventions", column: "created_at", retainDays: 180, label: "Revenue interventions" },
  // 2026-07 audit: two more forever-growth tables. Realtime heartbeat/event
  // rows are operational exhaust (30d); raw API telemetry samples feed the
  // monthly rollup job, so 120d comfortably covers re-rollup needs.
  { table: "realtime_event_log", column: "created_at", retainDays: 30, label: "Realtime event log" },
  { table: "api_telemetry_samples", column: "created_at", retainDays: 120, label: "API telemetry samples" },
];

/** postgres: relation does not exist. The one failure worth skipping quietly. */
const UNDEFINED_TABLE = "42P01";

export async function runDataRetention(): Promise<{
  purged: number;
  auditReport: AuditRetentionReport;
  failures: Array<{ label: string; error: string }>;
}> {
  let totalPurged = 0;
  const failures: Array<{ label: string; error: string }> = [];

  for (const rule of retentionRules) {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - rule.retainDays);

      // The cutoff is a PARAMETER now, not a string interpolated into the
      // statement. The table and column still come from the literal list above
      // and so are the only part that needs sql.raw — one occurrence, as
      // before, so the sql-raw ratchet is unmoved.
      const result = await db.execute(
        sql`${sql.raw(`DELETE FROM ${rule.table} WHERE ${rule.column} < `)}${cutoff}${
          rule.keepWhere ?? sql``
        } RETURNING id`,
      );

      // node-postgres returns a result OBJECT ({ rows, rowCount }), not a
      // bare array — the old Array.isArray check made every purge log 0.
      const count = Array.isArray(result)
        ? result.length
        : ((result as { rowCount?: number; rows?: unknown[] }).rowCount
            ?? (result as { rows?: unknown[] }).rows?.length
            ?? 0);
      if (count > 0) {
        logger.info(
          `[data-retention] Purged ${count} rows from ${rule.label} (>${rule.retainDays}d old)` +
            (rule.keepReason ? ` — exempt: ${rule.keepReason}` : ""),
        );
        totalPurged += count;
      }
    } catch (err) {
      // A MISSING TABLE is the only skippable failure, and it is now told apart
      // from every other one. This catch used to swallow everything at DEBUG
      // with the comment "table may not exist yet" — so a lock timeout, a
      // constraint violation or a typo in the rule list read exactly like a
      // table that had not been created, in a job whose whole purpose is
      // deleting rows. A destructive job that cannot fail loudly is a
      // destructive job nobody is watching.
      const code = (err as { code?: string })?.code;
      if (code === UNDEFINED_TABLE) {
        logger.debug(`[data-retention] ${rule.label}: table ${rule.table} does not exist yet, skipped`);
      } else {
        failures.push({ label: rule.label, error: err instanceof Error ? err.message : String(err) });
        logger.error(
          `[data-retention] FAILED to purge ${rule.label} — rows were NOT deleted`,
          err instanceof Error ? err : undefined,
        );
      }
    }
  }

  // Pillar D / D4 — Audit-events retention report. The table has append-only
  // triggers (migration 0049) so we can't DELETE here. Instead we surface
  // the row distribution + warn when archival is overdue (oldest event
  // exceeds the 7-year retention floor). Actual archival to cold storage
  // is a future iteration that temporarily disables the trigger, exports
  // to S3 Glacier, then re-enables.
  const auditReport = await reportAuditEventsRetention();

  if (failures.length > 0) {
    logger.error(
      `[data-retention] ${failures.length} of ${retentionRules.length} rules FAILED and purged nothing: ` +
        failures.map((f) => f.label).join(", "),
    );
  }
  logger.info(
    `[data-retention] Complete — purged ${totalPurged} total rows across ` +
      `${retentionRules.length - failures.length}/${retentionRules.length} tables`,
  );
  return { purged: totalPurged, auditReport, failures };
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
