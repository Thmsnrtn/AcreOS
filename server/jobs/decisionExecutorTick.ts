/**
 * The autonomous decision executor's per-tick cost bound.
 *
 * ── WHY IT LIVES HERE ───────────────────────────────────────────────────────
 * Extracted from `runScheduledJobs.ts` on 2026-08-18. It was module-private
 * inside a 5,700-line scheduler, so the thing it actually measured could not be
 * asserted on — and what it measured was wrong.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `sumAiSpendUsdSince` summed EVERY row in `ai_telemetry_events` in the window
 * — Pax chat, enrichment summarisation, the CMO pipeline, every other AI path —
 * and the caller used that total to decide whether THE DECISION EXECUTOR may
 * run. Two consequences:
 *
 *   1. The executor deferred because of spend it did not cause. A busy Pax hour
 *      starved it, silently, with one log line, on a $1.00/30-min default cap.
 *   2. The post-tick line read "this tick spent $X across N items" when $X was
 *      all platform AI spend in that window. That is the number a human reads
 *      to decide whether the executor is the burn source — and the job's own
 *      comment says it "was identified as the single most-likely $30/day burn
 *      source", so a misattributing measurement is exactly what would confirm a
 *      wrong diagnosis.
 *
 * The repository already knew which telemetry rows belong to the executor:
 * `intelligence/budget.ts` maps task types to budget categories and has an
 * `executor` bucket, checked inside `aiRouter` before every call. That mapping
 * is now the one definition — `EXECUTOR_TASK_TYPES` is the same list
 * `categoryFor` branches on, not a copy of it, so the two cannot drift.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * Not a fifth cost gate. The stack documented in `aiCostCeiling.ts` is
 * unchanged: per-category daily budget (soft), per-org quota (soft), platform
 * daily ceiling (the only fail-closed one). This is the scheduler's own
 * admission control, and it now measures the subsystem it admits.
 *
 * Neither the window constant nor the sum is exported: their only non-local
 * consumer would be a test, which the reachability gate correctly calls
 * "built but unwired". The tick itself is the seam, and asserting through it is
 * stronger anyway — it shows whether the executor RAN, not merely what a helper
 * returned.
 *
 * Summing across ALL ORGS remains correct and deliberate. This bounds AcreOS's
 * OWN AI spend on its OWN autonomous work; it is not customer money, and a
 * per-org predicate here would be the wrong scope for a platform budget.
 */

import { sql } from "drizzle-orm";
import { db } from "../db";
import { EXECUTOR_TASK_TYPES } from "../services/intelligence/budget";

export const AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK = (() => {
  const raw = Number(process.env.AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK);
  return Number.isFinite(raw) && raw > 0 ? raw : 1.0;
})();

export const AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK = (() => {
  const raw = Number(process.env.AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
})();

const DECISION_EXECUTOR_TICK_WINDOW_MS = 30 * 60 * 1000;

/**
 * Estimated USD the EXECUTOR has spent since `since`, across all orgs.
 *
 * Scoped to the executor's own task types. On any error we return null so the
 * caller fails OPEN — never block the executor purely because telemetry was
 * momentarily unreadable.
 */
async function sumExecutorAiSpendUsdSince(since: Date): Promise<number | null> {
  try {
    const { aiTelemetryEvents } = await import("@shared/schema");
    const { and, gte, inArray } = await import("drizzle-orm");
    const [row] = await db
      .select({
        cents: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
      })
      .from(aiTelemetryEvents)
      .where(and(
        gte(aiTelemetryEvents.createdAt, since),
        inArray(aiTelemetryEvents.taskType, [...EXECUTOR_TASK_TYPES]),
      ));
    return Number(row?.cents ?? 0) / 100;
  } catch {
    return null;
  }
}

/** Runs one executor tick under the per-tick cost bound. */
export async function runDecisionExecutorTickBounded(
  log: (msg: string, tag: string) => void,
): Promise<void> {
  const tickStart = new Date();
  const windowStart = new Date(tickStart.getTime() - DECISION_EXECUTOR_TICK_WINDOW_MS);

  // PRE-tick enforcing bound: if the executor's own recent spend already blew
  // the ceiling, defer.
  const recentSpend = await sumExecutorAiSpendUsdSince(windowStart);
  if (recentSpend !== null && recentSpend >= AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK) {
    log(
      `[decision-executor] per-tick spend cap hit — skipping tick. ` +
        `trailing-${Math.round(DECISION_EXECUTOR_TICK_WINDOW_MS / 60000)}m EXECUTOR spend=$${recentSpend.toFixed(2)} ` +
        `>= cap=$${AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK.toFixed(2)} ` +
        `(AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK)`,
      "decision-executor",
    );
    return;
  }

  const { runAutonomousDecisionExecutor } = await import("../services/autonomousDecisionExecutor");
  const result = await runAutonomousDecisionExecutor();

  // POST-tick bound: surface a breach so a runaway tick is greppable even
  // though we let the in-flight items finish (we never kill mid-tick).
  const incurred = await sumExecutorAiSpendUsdSince(tickStart);
  if (incurred !== null && incurred > AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK) {
    log(
      `[decision-executor] per-tick spend ceiling exceeded: this tick's EXECUTOR calls spent ` +
        `$${incurred.toFixed(2)} > cap=$${AUTONOMOUS_DECISION_EXECUTOR_MAX_USD_PER_TICK.toFixed(2)} ` +
        `across ${result.itemsProcessed} items — next tick will defer until spend drains`,
      "decision-executor",
    );
  }
  if (result.itemsProcessed > AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK) {
    log(
      `[decision-executor] per-tick decision cap exceeded: processed ${result.itemsProcessed} ` +
        `> cap=${AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK} ` +
        `(AUTONOMOUS_DECISION_EXECUTOR_MAX_DECISIONS_PER_TICK)`,
      "decision-executor",
    );
  }
}
