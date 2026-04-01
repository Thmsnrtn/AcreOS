// @ts-nocheck
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

export async function runDataRetention(): Promise<{ purged: number }> {
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

  logger.info(`[data-retention] Complete — purged ${totalPurged} total rows across ${retentionRules.length} tables`);
  return { purged: totalPurged };
}
