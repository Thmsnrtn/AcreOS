/**
 * Pillar R — daily retract cron for agent-shipped changes.
 *
 * Walks every `agent_proposal_observations` row in status=observing.
 * For each, compares the baseline telemetry (captured at acceptance
 * time, inside autonomousDecisionExecutor) to the current snapshot.
 * If telemetry has regressed beyond a threshold, marks the observation
 * retracted, demotes the agent's graduation tier (via
 * trustGraduation.recordRetract), and writes a /founder/now inbox
 * item flagging the retract.
 *
 * Observations whose window has closed without regression are marked
 * `clean` (status transition is informational; the streak bump already
 * happened at acceptance time).
 *
 * This is the safety net that makes Pillar R's "default to ship"
 * loadable. Without it, auto-execution would compound bad decisions
 * silently.
 */

import { db } from "../db";
import {
  agentProposalObservations,
  decisionsInboxItems,
  agentEvents,
  auditEvents,
  jobHealthLogs,
  customerHealthScores,
  supportCases,
} from "@shared/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { recordRetract } from "./trustGraduation";

interface RegressionVerdict {
  regressed: boolean;
  reason: string;
  metrics: Record<string, number>;
}

const REGRESSION_THRESHOLDS = {
  // Doubling the 24h error count vs baseline = regression.
  errorRateMultiplier: 2.0,
  // 5x the job-failure rate vs baseline = regression.
  jobFailureMultiplier: 5.0,
  // Floor — if baseline was 0 errors, allow up to 10 before flagging.
  errorFloor: 10,
  jobFailureFloor: 3,
  // Customer-side outcome signals. If avg customer health drops by ≥10
  // points or the support-escalation rate triples (with a floor of 5
  // escalations to avoid noise on tiny samples), that's a regression.
  customerHealthDropPoints: 10,
  escalationRateMultiplier: 3.0,
  escalationFloor: 5,
};

async function snapshotCurrentTelemetry(): Promise<Record<string, number>> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const [errorRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(
        and(
          sql`${auditEvents.action} LIKE '%error%'`,
          sql`${auditEvents.createdAt} >= ${dayAgo}`,
        ),
      );
    const [jobFailRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(jobHealthLogs)
      .where(
        and(
          sql`${jobHealthLogs.status} != 'success'`,
          sql`${jobHealthLogs.runStartedAt} >= ${dayAgo}`,
        ),
      );
    // Customer-side outcome signals.
    const [healthRow] = await db
      .select({ avg: sql<number>`coalesce(avg(${customerHealthScores.score})::float, 0)` })
      .from(customerHealthScores)
      .where(sql`${customerHealthScores.calculatedAt} >= ${dayAgo}`);
    const [escalatedRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(supportCases)
      .where(
        and(
          sql`${supportCases.escalatedAt} >= ${dayAgo}`,
          sql`${supportCases.escalatedAt} IS NOT NULL`,
        ),
      );

    return {
      errors24h: Number(errorRow?.c ?? 0),
      jobFailures24h: Number(jobFailRow?.c ?? 0),
      customerHealthAvg: Number(healthRow?.avg ?? 0),
      supportEscalations24h: Number(escalatedRow?.c ?? 0),
      capturedAtMs: Date.now(),
    };
  } catch (err) {
    logger.warn("[retract-cron] telemetry snapshot failed", err as Error);
    return { capturedAtMs: Date.now() };
  }
}

function assessRegression(
  baseline: Record<string, number> | null,
  current: Record<string, number>,
): RegressionVerdict {
  if (!baseline) {
    return { regressed: false, reason: "no baseline captured at acceptance", metrics: current };
  }
  const baseErr = Number(baseline.errors24h ?? 0);
  const curErr = Number(current.errors24h ?? 0);
  const baseJob = Number(baseline.jobFailures24h ?? 0);
  const curJob = Number(current.jobFailures24h ?? 0);

  // Error rate regression
  if (curErr > REGRESSION_THRESHOLDS.errorFloor) {
    const ratio = baseErr > 0 ? curErr / baseErr : curErr / 1;
    if (ratio >= REGRESSION_THRESHOLDS.errorRateMultiplier) {
      return {
        regressed: true,
        reason: `Error count rose ${ratio.toFixed(1)}× (${baseErr} → ${curErr}, threshold ${REGRESSION_THRESHOLDS.errorRateMultiplier}×).`,
        metrics: current,
      };
    }
  }

  // Job-failure regression
  if (curJob > REGRESSION_THRESHOLDS.jobFailureFloor) {
    const ratio = baseJob > 0 ? curJob / baseJob : curJob / 1;
    if (ratio >= REGRESSION_THRESHOLDS.jobFailureMultiplier) {
      return {
        regressed: true,
        reason: `Background-job failure count rose ${ratio.toFixed(1)}× (${baseJob} → ${curJob}, threshold ${REGRESSION_THRESHOLDS.jobFailureMultiplier}×).`,
        metrics: current,
      };
    }
  }

  // Customer-health regression — drop of ≥10 points across the fleet.
  // Only check if both baseline and current have meaningful samples (>0).
  const baseHealth = Number(baseline.customerHealthAvg ?? 0);
  const curHealth = Number(current.customerHealthAvg ?? 0);
  if (baseHealth > 0 && curHealth > 0) {
    const drop = baseHealth - curHealth;
    if (drop >= REGRESSION_THRESHOLDS.customerHealthDropPoints) {
      return {
        regressed: true,
        reason: `Average customer health dropped ${drop.toFixed(1)} points (${baseHealth.toFixed(1)} → ${curHealth.toFixed(1)}, threshold ${REGRESSION_THRESHOLDS.customerHealthDropPoints}).`,
        metrics: current,
      };
    }
  }

  // Support-escalation regression — sustained spike in cases we couldn't auto-resolve.
  const baseEsc = Number(baseline.supportEscalations24h ?? 0);
  const curEsc = Number(current.supportEscalations24h ?? 0);
  if (curEsc > REGRESSION_THRESHOLDS.escalationFloor) {
    const ratio = baseEsc > 0 ? curEsc / baseEsc : curEsc / 1;
    if (ratio >= REGRESSION_THRESHOLDS.escalationRateMultiplier) {
      return {
        regressed: true,
        reason: `Support-escalation count rose ${ratio.toFixed(1)}× (${baseEsc} → ${curEsc}, threshold ${REGRESSION_THRESHOLDS.escalationRateMultiplier}×).`,
        metrics: current,
      };
    }
  }

  return { regressed: false, reason: "within thresholds", metrics: current };
}

async function retractObservation(
  obsId: number,
  agentCodename: string,
  actionCategory: string,
  shippedRef: string,
  reason: string,
  metrics: Record<string, number>,
): Promise<void> {
  await db
    .update(agentProposalObservations)
    .set({
      status: "retracted",
      retractedAt: new Date(),
      retractReason: reason,
      telemetryCurrent: metrics,
    })
    .where(eq(agentProposalObservations.id, obsId));

  // Demote the graduation tier.
  const demotion = await recordRetract(agentCodename, actionCategory);

  // Write to agent_events for /founder/now red-section pickup.
  try {
    const { getFounderPrimaryOrgId } = await import("./founder");
    const orgId = await getFounderPrimaryOrgId();
    await db.insert(agentEvents).values({
      organizationId: orgId,
      eventType: "regression_detected",
      eventSource: "agent_retract_cron",
      payload: {
        agentCodename,
        actionCategory,
        shippedRef,
        reason,
        metrics,
        tierAfter: demotion.newTier,
        suspended: demotion.suspended,
        actionUrl: `/founder/now#observation-${obsId}`,
        title: `Auto-retract: ${actionCategory} #${shippedRef}`,
        message: reason,
      },
    });

    // Surface as inbox item too — observation is real, founder needs to know.
    await db.insert(decisionsInboxItems).values({
      itemType: "agent_retract",
      riskLevel: demotion.suspended ? "critical" : "high",
      urgencyScore: demotion.suspended ? 95 : 80,
      sophieAnalysis:
        `Auto-retract triggered on agent ${agentCodename}'s ${actionCategory} action.\n\n${reason}\n\n` +
        `Trust graduation: tier demoted to ${demotion.newTier}` +
        (demotion.suspended ? " (SUSPENDED — explicit founder re-enable required)" : "") +
        `. Telemetry snapshot:\n` +
        Object.entries(metrics)
          .map(([k, v]) => `  • ${k}: ${v}`)
          .join("\n"),
      recommendedAction: demotion.suspended
        ? "Review the suspension. Re-enable the category via overrideTier if appropriate."
        : "Confirm the retract was the right call. If false positive, re-promote the category.",
      recommendedActionLabel: demotion.suspended
        ? "Resolve suspension"
        : "Confirm retract",
      organizationId: orgId,
      status: "pending",
      ownerAgentCodename: "agent_retract_cron",
      sophieConfidenceScore: 80,
    });
  } catch (err) {
    logger.error("[retract-cron] failed to write retract notification", err as Error);
  }

  logger.warn(
    `[retract-cron] retracted ${agentCodename}:${actionCategory} #${shippedRef} — ${reason}; tier→${demotion.newTier}${demotion.suspended ? " (SUSPENDED)" : ""}`,
  );
}

async function markClean(obsId: number, current: Record<string, number>): Promise<void> {
  await db
    .update(agentProposalObservations)
    .set({ status: "clean", telemetryCurrent: current })
    .where(eq(agentProposalObservations.id, obsId));
}

/**
 * Daily cron entrypoint. Walks open observations, evaluates each.
 */
export async function runAgentRetractCron(): Promise<{
  evaluated: number;
  retracted: number;
  marked_clean: number;
  errors: number;
}> {
  const open = await db
    .select()
    .from(agentProposalObservations)
    .where(eq(agentProposalObservations.status, "observing"))
    .limit(200);

  if (open.length === 0) {
    return { evaluated: 0, retracted: 0, marked_clean: 0, errors: 0 };
  }

  const current = await snapshotCurrentTelemetry();
  const now = new Date();
  let retracted = 0;
  let cleaned = 0;
  let errors = 0;

  for (const obs of open) {
    try {
      const verdict = assessRegression(
        obs.telemetryBaseline as Record<string, number> | null,
        current,
      );
      if (verdict.regressed) {
        await retractObservation(
          obs.id,
          obs.agentCodename,
          obs.actionCategory,
          obs.shippedRef,
          verdict.reason,
          verdict.metrics,
        );
        retracted += 1;
      } else if (obs.observationEndsAt <= now) {
        await markClean(obs.id, current);
        cleaned += 1;
      } else {
        // Still observing — refresh the current snapshot for visibility.
        await db
          .update(agentProposalObservations)
          .set({ telemetryCurrent: current })
          .where(eq(agentProposalObservations.id, obs.id));
      }
    } catch (err) {
      logger.error("[retract-cron] observation eval failed", err as Error);
      errors += 1;
    }
  }

  logger.info(
    `[retract-cron] evaluated=${open.length} retracted=${retracted} cleaned=${cleaned} errors=${errors}`,
  );
  return { evaluated: open.length, retracted, marked_clean: cleaned, errors };
}
