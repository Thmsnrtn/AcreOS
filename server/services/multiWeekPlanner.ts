/**
 * Rosy River C6 — Multi-week planner agent (v0).
 *
 * Once a week, read the telemetry snapshot + a comparison snapshot from
 * the prior week + the promotion-gate state, and emit a structured plan
 * for the founder. The plan is deterministic (no LLM in v0) — a
 * future iteration can layer Claude on top to write narrative + propose
 * specific re-prioritizations.
 *
 * Reads:
 *   - readTelemetrySnapshot()         — this week's metrics
 *   - readTelemetrySnapshot() (prev)  — last week's, for trend deltas
 *   - listGateStatus()                — eligible-for-promotion list
 *
 * Writes:
 *   - notifyFounder() with the structured plan summary.
 *
 * Schedule: Sundays at 9am UTC (1h after the telemetry digest at 8am).
 */

import { db } from "../db";
import { agentTasks, agentLlmTraces, evolutionHistory, decisionsInboxItems } from "@shared/schema";
import { and, gte, lt, sql, inArray } from "drizzle-orm";
import { logger } from "../utils/logger";
import { notifyFounder, ROSY_RIVER_AGENT_TYPES, WEEKLY_BUDGET_CEILING_USD } from "./rosyRiver";
import { listGateStatus } from "./agentPromotionGate";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface PlannerOutput {
  weekIso: string;
  thisWeek: WeekMetrics;
  lastWeek: WeekMetrics;
  deltas: {
    spendDeltaPct: number;
    proposalsDelta: number;
    deployedDelta: number;
    revertedDelta: number;
  };
  recommendations: string[];
  promotionEligible: Array<{ codename: string; capability: string }>;
}

interface WeekMetrics {
  spendUsd: number;
  proposals: number;
  deployed: number;
  reverted: number;
  approvalRatePct: number;
}

async function readWindowMetrics(start: Date, end: Date): Promise<WeekMetrics> {
  const [{ spendCents }] = await db
    .select({
      spendCents: sql<string>`COALESCE(SUM(${agentLlmTraces.costCents}), 0)`,
    })
    .from(agentLlmTraces)
    .where(and(gte(agentLlmTraces.createdAt, start), lt(agentLlmTraces.createdAt, end)));

  const proposalRows = await db
    .select({ status: agentTasks.status })
    .from(agentTasks)
    .where(
      and(
        gte(agentTasks.createdAt, start),
        lt(agentTasks.createdAt, end),
        inArray(agentTasks.agentType, [...ROSY_RIVER_AGENT_TYPES] as string[]),
      ),
    );

  const gauntletRows = await db
    .select({ status: evolutionHistory.status })
    .from(evolutionHistory)
    .where(and(gte(evolutionHistory.createdAt, start), lt(evolutionHistory.createdAt, end)));

  const deployed = gauntletRows.filter((r) => r.status === "deployed").length;
  const reverted = gauntletRows.filter((r) => r.status === "reverted").length;

  const decisionRows = await db
    .select({ status: decisionsInboxItems.status })
    .from(decisionsInboxItems)
    .where(
      and(
        gte(decisionsInboxItems.createdAt, start),
        lt(decisionsInboxItems.createdAt, end),
        inArray(decisionsInboxItems.itemType, ["agent_code_proposal", "agent_initiative"]),
      ),
    );
  const approved = decisionRows.filter((r) => r.status === "approved").length;
  const decided = approved + decisionRows.filter((r) => r.status === "rejected").length;
  const approvalRatePct = decided > 0 ? Math.round((approved / decided) * 100) : 0;

  return {
    spendUsd: Number(spendCents) / 100,
    proposals: proposalRows.length,
    deployed,
    reverted,
    approvalRatePct,
  };
}

export async function runMultiWeekPlanner(): Promise<PlannerOutput> {
  const now = Date.now();
  const thisWeekStart = new Date(now - ONE_WEEK_MS);
  const lastWeekStart = new Date(now - 2 * ONE_WEEK_MS);

  const thisWeek = await readWindowMetrics(thisWeekStart, new Date(now));
  const lastWeek = await readWindowMetrics(lastWeekStart, thisWeekStart);
  const gates = await listGateStatus();

  const spendDeltaPct =
    lastWeek.spendUsd > 0
      ? Math.round(((thisWeek.spendUsd - lastWeek.spendUsd) / lastWeek.spendUsd) * 100)
      : thisWeek.spendUsd > 0
        ? 100
        : 0;
  const proposalsDelta = thisWeek.proposals - lastWeek.proposals;
  const deployedDelta = thisWeek.deployed - lastWeek.deployed;
  const revertedDelta = thisWeek.reverted - lastWeek.reverted;

  // ── Deterministic recommendations ──────────────────────────────────────
  const recs: string[] = [];

  if (thisWeek.spendUsd > 0.8 * WEEKLY_BUDGET_CEILING_USD) {
    recs.push(
      `Spend at ${Math.round((thisWeek.spendUsd / WEEKLY_BUDGET_CEILING_USD) * 100)}% of weekly ceiling. ` +
        `Consider tightening estimatedCostUsd preflight or pausing the highest-spend agent.`,
    );
  }
  if (spendDeltaPct >= 50) {
    recs.push(
      `Spend up ${spendDeltaPct}% vs last week. Investigate which agent ramped — see /founder/agent-queue → budget banner.`,
    );
  }
  if (revertedDelta > 0 && thisWeek.reverted >= 2) {
    recs.push(
      `${thisWeek.reverted} reverts this week (vs ${lastWeek.reverted} last week). ` +
        `Review the last 3 evolution_history rows with status='reverted' for root cause.`,
    );
  }
  if (thisWeek.proposals === 0 && lastWeek.proposals === 0) {
    recs.push(
      `Zero codebase-monitor proposals in the last 14 days. ` +
        `Either the npm-outdated signal is empty (dep set is fresh) or the job is failing — check jobHealthLogs for 'codebase_monitor'.`,
    );
  }
  if (thisWeek.approvalRatePct < 30 && thisWeek.proposals >= 5) {
    recs.push(
      `Approval rate at ${thisWeek.approvalRatePct}%. ` +
        `Codebase monitor may be over-proposing — consider raising the risk threshold or filtering high-blast deps.`,
    );
  }
  if (gates.filter((g) => g.eligibleForPromotion).length > 0) {
    const list = gates
      .filter((g) => g.eligibleForPromotion)
      .map((g) => `${g.codename}:${g.capability}`)
      .join(", ");
    recs.push(`Promotion-gate eligible: ${list}. Founder can promote via the agent-queue UI.`);
  }
  if (recs.length === 0) {
    recs.push(
      `System operating in steady state. Spend $${thisWeek.spendUsd.toFixed(2)}, ${thisWeek.proposals} proposals, ${thisWeek.deployed} deployed, ${thisWeek.reverted} reverted.`,
    );
  }

  const out: PlannerOutput = {
    weekIso: thisWeekStart.toISOString(),
    thisWeek,
    lastWeek,
    deltas: { spendDeltaPct, proposalsDelta, deployedDelta, revertedDelta },
    recommendations: recs,
    promotionEligible: gates
      .filter((g) => g.eligibleForPromotion)
      .map((g) => ({ codename: g.codename, capability: g.capability })),
  };

  const summary =
    `Multi-week planner — week of ${thisWeekStart.toLocaleDateString()}:\n\n` +
    `Spend trend: $${thisWeek.spendUsd.toFixed(2)} this week vs $${lastWeek.spendUsd.toFixed(2)} last (${spendDeltaPct >= 0 ? "+" : ""}${spendDeltaPct}%)\n` +
    `Proposals:   ${thisWeek.proposals} this week vs ${lastWeek.proposals} last (${proposalsDelta >= 0 ? "+" : ""}${proposalsDelta})\n` +
    `Deployed:    ${thisWeek.deployed} this week vs ${lastWeek.deployed} last (${deployedDelta >= 0 ? "+" : ""}${deployedDelta})\n` +
    `Reverted:    ${thisWeek.reverted} this week vs ${lastWeek.reverted} last (${revertedDelta >= 0 ? "+" : ""}${revertedDelta})\n` +
    `Approval %:  ${thisWeek.approvalRatePct}% this week\n\n` +
    `Recommendations:\n` +
    recs.map((r) => `  • ${r}`).join("\n");

  try {
    await notifyFounder({
      source: "planner_weekly",
      pillar: "C_agentic",
      agentCodename: "multi_week_planner",
      severity: spendDeltaPct >= 100 || (thisWeek.reverted > thisWeek.deployed && thisWeek.reverted >= 2) ? "warning" : "info",
      title: `Multi-week plan — ${recs.length === 1 && recs[0].startsWith("System operating in steady state") ? "steady state" : `${recs.length} recommendation${recs.length === 1 ? "" : "s"}`}`,
      body: summary,
      metadata: { plan: out as unknown as Record<string, unknown> },
    });
  } catch (err) {
    logger.error("[multi-week-planner] notifyFounder failed", err);
  }

  logger.info("[multi-week-planner] plan emitted", {
    source: "multi-week-planner",
    metadata: {
      spendDeltaPct,
      proposalsDelta,
      revertedDelta,
      recCount: recs.length,
      promotionEligible: out.promotionEligible.length,
    },
  });

  return out;
}
