/**
 * killSwitches — Emergency stops for automated systems.
 *
 * Four switches (design: files/kill-switches-design-2026-10.md, 2026-10-15):
 * 1. Deploy Freeze     — GitHub Actions variable DEPLOY_FROZEN (workflows check it)
 * 2. Autopilot Pause   — ledger actionType='autopilot_pause' / 'autopilot_resume'
 * 3. COO Stand-down    — ledger actionType='coo_stand_down' / 'coo_stand_up'
 * 4. Cost Circuit Breaker — blocks spending when monthly ledger costs >= threshold
 *
 * Principles: fast (<60s), visible (GET /api/ops/kill-switches), logged
 * (every change is a ledger entry), reversible, independent.
 *
 * Implemented 2026-10-17.
 */

import { sql, desc, eq, and, gte } from "drizzle-orm";
import { unscopedForPlatformOps } from "./utils/orgScopedDb";
import { cooLedger } from "@shared/schema";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";

const REASON = "killSwitches: emergency-stop state checks (read-only)";

export type KillSwitchName =
  | "deploy_freeze"
  | "autopilot_pause"
  | "coo_stand_down"
  | "cost_circuit_breaker";

export interface KillSwitchState {
  name: KillSwitchName;
  /** true = switch is ENGAGED (system halted); false = normal operation */
  engaged: boolean;
  engagedAt: Date | null;
  engagedBy: string | null;
  detail: string | null;
}

/** Monthly spending threshold in USD (Law III). Adjustable by Tom. */
export const COST_BREAKER_THRESHOLD_USD = 25;

/**
 * Find the latest ledger entry for a given actionType pair.
 * Returns the pause/down entry if it's newer than the resume/up entry,
 * i.e. the switch is currently engaged.
 */
async function latestSwitchEntry(
  engageType: string,
  releaseType: string,
): Promise<typeof cooLedger.$inferSelect | null> {
  const rows = await unscopedForPlatformOps(REASON)
    .select()
    .from(cooLedger)
    .where(
      sql`${cooLedger.actionType} IN (${engageType}, ${releaseType})`,
    )
    .orderBy(desc(cooLedger.id))
    .limit(1);
  const latest = rows[0] ?? null;
  if (!latest) return null;
  return latest.actionType === engageType ? latest : null;
}

/** Switch 3: Is the COO currently stood down? */
export async function isCooStoodDown(): Promise<KillSwitchState> {
  const entry = await latestSwitchEntry("coo_stand_down", "coo_stand_up");
  return {
    name: "coo_stand_down",
    engaged: entry !== null,
    engagedAt: entry?.createdAt ?? null,
    engagedBy: entry?.actor ?? null,
    detail: entry?.reasoning ?? null,
  };
}

/** Switch 2: Is the autopilot currently paused? */
export async function isAutopilotPaused(): Promise<KillSwitchState> {
  const entry = await latestSwitchEntry("autopilot_pause", "autopilot_resume");
  return {
    name: "autopilot_pause",
    engaged: entry !== null,
    engagedAt: entry?.createdAt ?? null,
    engagedBy: entry?.actor ?? null,
    detail: entry?.reasoning ?? null,
  };
}

/**
 * Switch 4: Cost circuit breaker.
 * Sums costUsd from the ledger for the current calendar month.
 * Returns engaged=true when spending >= threshold.
 *
 * NOTE: costUsd is stored as text/decimal; we cast to numeric for the sum.
 */
export async function checkCostCircuitBreaker(
  thresholdUsd: number = COST_BREAKER_THRESHOLD_USD,
): Promise<KillSwitchState & { spentUsd: number; thresholdUsd: number }> {
  const now = clock.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const rows = await unscopedForPlatformOps(REASON)
    .select({
      total: sql<string | null>`COALESCE(SUM(${cooLedger.costUsd}::numeric), 0)`,
    })
    .from(cooLedger)
    .where(gte(cooLedger.createdAt, monthStart));

  const spentUsd = parseFloat(rows[0]?.total ?? "0") || 0;
  const engaged = spentUsd >= thresholdUsd;

  // Find when it tripped (latest cost_circuit_breaker_triggered entry this month)
  let engagedAt: Date | null = null;
  if (engaged) {
    const trip = await unscopedForPlatformOps(REASON)
      .select()
      .from(cooLedger)
      .where(
        and(
          eq(cooLedger.actionType, "cost_circuit_breaker_triggered"),
          gte(cooLedger.createdAt, monthStart),
        ),
      )
      .orderBy(desc(cooLedger.id))
      .limit(1);
    engagedAt = trip[0]?.createdAt ?? null;
  }

  return {
    name: "cost_circuit_breaker",
    engaged,
    engagedAt,
    engagedBy: "system",
    detail: `$${spentUsd.toFixed(2)} / $${thresholdUsd.toFixed(2)} this month`,
    spentUsd,
    thresholdUsd,
  };
}

/**
 * Switch 1: Deploy freeze status.
 * The actual enforcement lives in the GitHub workflows (DEPLOY_FROZEN variable).
 * This reports the ledger's record of freeze/unfreeze events for visibility.
 * NOTE: the GitHub variable is the source of truth; the ledger is the audit trail.
 */
export async function getDeployFreezeState(): Promise<KillSwitchState> {
  const entry = await latestSwitchEntry("deploy_freeze", "deploy_unfreeze");
  return {
    name: "deploy_freeze",
    engaged: entry !== null,
    engagedAt: entry?.createdAt ?? null,
    engagedBy: entry?.actor ?? null,
    detail: entry
      ? entry.reasoning ?? "Deploy frozen via kill switch"
      : "Deploys active (verify GitHub variable DEPLOY_FROZEN)",
  };
}

/** All four switches at a glance — the status dashboard payload. */
export async function getKillSwitchStatus(): Promise<{
  asOf: Date;
  switches: KillSwitchState[];
}> {
  const [deploy, autopilot, coo, cost] = await Promise.all([
    getDeployFreezeState(),
    isAutopilotPaused(),
    isCooStoodDown(),
    checkCostCircuitBreaker(),
  ]);
  return { asOf: clock.now(), switches: [deploy, autopilot, coo, cost] };
}

/**
 * Log a kill-switch activation/deactivation to the ledger.
 * Callers: API routes (Tom via dashboard/ops API) or the COO itself.
 */
export async function logKillSwitchEvent(
  actor: "coo" | "founder" | "autopilot" | "system",
  actionType:
    | "deploy_freeze" | "deploy_unfreeze"
    | "autopilot_pause" | "autopilot_resume"
    | "coo_stand_down" | "coo_stand_up"
    | "cost_circuit_breaker_triggered" | "cost_circuit_breaker_reset",
  reasoning: string,
): Promise<void> {
  const engaged = /freeze|pause|stand_down|triggered/.test(actionType);
  await unscopedForPlatformOps("killSwitches: log switch event (ledger append)")
    .insert(cooLedger)
    .values({
      actor,
      actionType,
      reasoning,
      status: engaged ? "started" : "completed",
      resultSummary: engaged
        ? "Kill switch ENGAGED"
        : "Kill switch released",
    });
  logger.info(`[killSwitches] ${actionType} by ${actor}: ${reasoning}`);
}
