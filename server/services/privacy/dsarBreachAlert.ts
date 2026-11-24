/**
 * DSAR breach paging (Founder Autopilot brief B-1, 2026-11-16 drills).
 *
 * The strict 24h internal DSAR clock (Tap #4) used to breach into a server
 * log line only: the hourly `dsar_overdue_alert` cron counted overdue rows
 * and logged them ("v0: log-only; alert-fan-out is a follow-up"). A breach
 * paged nobody. This module is the fan-out:
 *
 *   - FIRST breach of a DSAR (unfulfilled, `slaDeadlineAt` passed): one
 *     critical `system_alerts` row + a founder page through the alert
 *     spine's throttled pager + one founder decisions card (via
 *     `decisionsInboxService.createFromAlert`, this sweep being its first
 *     production caller).
 *   - RE-ALERT daily while the DSAR stays unfulfilled: the durable gate is
 *     the `system_alerts` table itself — the sweep reads the newest
 *     `dsar_breach` alert for the DSAR and re-fires only once it is ≥24h
 *     old. (The spine's page window is in-process and resets on deploy; a
 *     compliance clock may not depend on process memory.) While a founder
 *     card for the DSAR is still open (pending/deferred), no second card
 *     is created — the daily alert + page is the re-alert, and a fresh
 *     card is raised once the founder has resolved the previous one.
 *   - `metBySla` honesty: an overdue unfulfilled DSAR records
 *     `metBySla: false` on its alert, in words and in metadata. A late
 *     fulfilment keeps recording `false` at the `/fulfill` route's audit
 *     write — nothing here (or there) rewrites a miss into a meet.
 *
 * No new table or column: the breach record IS the `system_alerts` row
 * (plus the spine finding/page and the decisions card). `auditNotes` on
 * the DSAR row is deliberately NOT used for breach state — `/fulfill`
 * overwrites it.
 *
 * Privacy: alerts carry the DSAR id, type, and deadline only — never the
 * requester's email (the founder opens /founder/dsar/recent for detail).
 */

import { and, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { dsarRequestsLifecycle, systemAlerts } from "@shared/schema";
import { clock } from "../../utils/clock";
import { logger } from "../../utils/logger";

const DSAR_BREACH_ALERT_TYPE = "dsar_breach";
const DSAR_BREACH_SOURCE = "dsar_overdue_alert";
/** Re-alert cadence while a breached DSAR stays unfulfilled. */
export const DSAR_BREACH_RE_ALERT_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DsarLifecycleRow = typeof dsarRequestsLifecycle.$inferSelect;

/** Unfulfilled AND past the SLA deadline at `nowMs`. */
export function isOverdueUnfulfilled(row: DsarLifecycleRow, nowMs: number): boolean {
  return row.fulfilledAt == null && new Date(row.slaDeadlineAt).getTime() <= nowMs;
}

/**
 * The honest SLA verdict for a DSAR row: fulfilled rows met the SLA only
 * if fulfilment landed by the deadline; an unfulfilled row past its
 * deadline has NOT met it (and an unfulfilled row still inside its window
 * has not met it yet either — `false` is "not met", never "met").
 */
export function dsarMetBySla(row: DsarLifecycleRow): boolean {
  if (row.fulfilledAt == null) return false;
  return new Date(row.fulfilledAt).getTime() <= new Date(row.slaDeadlineAt).getTime();
}

/** Whole days the row has been in breach at `nowMs` (0 on breach day one). */
export function dsarDaysOverdue(row: DsarLifecycleRow, nowMs: number): number {
  const overdueMs = nowMs - new Date(row.slaDeadlineAt).getTime();
  return overdueMs <= 0 ? 0 : Math.floor(overdueMs / DAY_MS);
}

/**
 * Is a breach alert due? First breach (no prior alert) is always due;
 * afterwards only once the last alert is at least one re-alert interval old.
 */
export function breachAlertDue(lastAlertAt: Date | null, nowMs: number): boolean {
  if (lastAlertAt == null) return true;
  return nowMs - lastAlertAt.getTime() >= DSAR_BREACH_RE_ALERT_MS;
}

export interface DsarBreachAlertDeps {
  now: () => Date;
  loadOverdue: (now: Date) => Promise<DsarLifecycleRow[]>;
  lastBreachAlertAt: (dsarId: string) => Promise<Date | null>;
  /** Writes the critical system alert (+ founder page); returns its id. */
  raiseBreachAlert: (row: DsarLifecycleRow, now: Date) => Promise<number | null>;
  /** True while a founder card for this DSAR is still open. */
  hasOpenBreachCard: (dsarId: string) => Promise<boolean>;
  /** Creates the founder decisions card for a system alert id. */
  ensureBreachCard: (alertId: number) => Promise<number | null>;
  log: (message: string) => void;
}

export interface DsarBreachSweepResult {
  overdue: number;
  alerted: number;
  carded: number;
  /** Overdue rows whose last alert is still inside the re-alert interval. */
  suppressed: number;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function defaultDeps(): DsarBreachAlertDeps {
  return {
    now: () => clock.now(),
    loadOverdue: async (now) =>
      db
        .select()
        .from(dsarRequestsLifecycle)
        .where(
          and(
            isNull(dsarRequestsLifecycle.fulfilledAt),
            lte(dsarRequestsLifecycle.slaDeadlineAt, now),
          ),
        ),
    lastBreachAlertAt: async (dsarId) => {
      const result = await db.execute(sql`
        SELECT created_at FROM system_alerts
        WHERE type = ${DSAR_BREACH_ALERT_TYPE}
          AND metadata->>'dsarId' = ${dsarId}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const raw = rowsOf(result)[0]?.created_at;
      if (raw == null) return null;
      const at = raw instanceof Date ? raw : new Date(String(raw));
      return Number.isNaN(at.getTime()) ? null : at;
    },
    raiseBreachAlert: async (row, now) => {
      const days = dsarDaysOverdue(row, now.getTime());
      const title = `DSAR breach: 24h SLA missed — request ${row.id}`;
      const message =
        `DSAR ${row.id} (${row.requestType}) was received ${new Date(row.receivedAt).toISOString()} ` +
        `and breached its 24h SLA deadline ${new Date(row.slaDeadlineAt).toISOString()} ` +
        `(${days} day${days === 1 ? "" : "s"} overdue) and is still unfulfilled — metBySla: false. ` +
        `Review at /founder/dsar/recent. This alert re-fires daily while the request remains unfulfilled.`;
      const [alert] = await db
        .insert(systemAlerts)
        .values({
          type: DSAR_BREACH_ALERT_TYPE,
          alertType: DSAR_BREACH_ALERT_TYPE,
          severity: "critical",
          title,
          message,
          metadata: {
            source: DSAR_BREACH_SOURCE,
            dsarId: row.id,
            requestType: row.requestType,
            receivedAt: new Date(row.receivedAt).toISOString(),
            slaDeadlineAt: new Date(row.slaDeadlineAt).toISOString(),
            daysOverdue: days,
            metBySla: false,
            isSelfTest: row.isSelfTest,
          },
        })
        .returning({ id: systemAlerts.id });
      // Founder page through the spine's throttled pager — best-effort and
      // independent: the durable alert row above stands even if paging fails.
      try {
        const { pageCriticalThrottled } = await import("../alertSpine");
        await pageCriticalThrottled({
          source: DSAR_BREACH_SOURCE,
          title,
          detail: message,
          dedupeKey: `dsar:${row.id}:${now.toISOString().slice(0, 10)}`,
          priority: "P1",
          metadata: { dsarId: row.id, alertId: alert?.id ?? null },
        });
      } catch (err) {
        logger.error(
          `[dsar-breach] founder page failed for DSAR ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return alert?.id ?? null;
    },
    hasOpenBreachCard: async (dsarId) => {
      const result = await db.execute(sql`
        SELECT d.id FROM decisions_inbox_items d
        JOIN system_alerts a ON a.id = d.source_alert_id
        WHERE d.status IN ('pending', 'deferred')
          AND a.type = ${DSAR_BREACH_ALERT_TYPE}
          AND a.metadata->>'dsarId' = ${dsarId}
        LIMIT 1
      `);
      return rowsOf(result).length > 0;
    },
    ensureBreachCard: async (alertId) => {
      const { decisionsInboxService } = await import("../decisionsInbox");
      return decisionsInboxService.createFromAlert(alertId);
    },
    log: (message) => logger.info(message),
  };
}

/**
 * One breach sweep (the hourly `dsar_overdue_alert` cron's whole body).
 * Per-row failures are isolated and logged — one bad row never suppresses
 * the alerts owed for the others.
 */
export async function runDsarBreachAlertSweep(
  deps: DsarBreachAlertDeps = defaultDeps(),
): Promise<DsarBreachSweepResult> {
  const now = deps.now();
  const nowMs = now.getTime();
  const overdue = (await deps.loadOverdue(now)).filter((row) =>
    isOverdueUnfulfilled(row, nowMs),
  );
  let alerted = 0;
  let carded = 0;
  let suppressed = 0;
  for (const row of overdue) {
    try {
      const last = await deps.lastBreachAlertAt(row.id);
      if (!breachAlertDue(last, nowMs)) {
        suppressed += 1;
        continue;
      }
      const alertId = await deps.raiseBreachAlert(row, now);
      alerted += 1;
      if (alertId != null && !(await deps.hasOpenBreachCard(row.id))) {
        const cardId = await deps.ensureBreachCard(alertId);
        if (cardId != null) carded += 1;
      }
    } catch (err) {
      deps.log(
        `[dsar-breach] alert fan-out failed for DSAR ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { overdue: overdue.length, alerted, carded, suppressed };
}
