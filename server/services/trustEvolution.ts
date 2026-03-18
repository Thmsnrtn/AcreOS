// @ts-nocheck
/**
 * Trust Evolution Service — Sovereign Company Protocol
 *
 * Runs weekly to recalculate each agent's trust score based on:
 *   - Decision accuracy (CEO approvals vs. overrides)
 *   - Number of escalations
 *   - Overall activity
 *
 * When trust crosses thresholds (60, 75, 90), generates promotion/demotion suggestions.
 *
 * Trust Score Meaning:
 *   0-39:  Low trust — most actions require CEO approval
 *   40-59: Growing trust — standard autonomy levels
 *   60-74: Established trust — eligible for Level 2 → Level 1 promotions
 *   75-89: High trust — eligible for Level 1 → Level 0 promotions
 *   90-100: Full trust — agent operates with maximum autonomy
 */

import { db } from "../db";
import {
  companyAgents, decisionsInboxItems, trustEvolutionLog, agentActionLog,
} from "@shared/schema";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";
import { agentCommsService } from "./agentComms";

/**
 * Run trust evolution for all agents.
 * v3: Changed from weekly to daily. Now scores on REAL ACTION OUTCOMES,
 * not just decision accuracy. Trust should feel responsive.
 */
export async function runTrustEvolution(): Promise<{
  updates: { codename: string; previousScore: number; newScore: number; delta: number; reason: string }[];
  promotionSuggestions: { codename: string; title: string; suggestion: string }[];
}> {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const agents = await companyAgentService.getAllIncludingPaused();
  const updates: any[] = [];
  const promotionSuggestions: any[] = [];

  for (const agent of agents) {
    if (agent.status === "disabled") continue;

    // ── Dimension 1: Decision accuracy (same as v2, but daily) ──────────
    const decisionResults = await db.select({
      total: count(),
      approved: sql<number>`count(*) filter (where status = 'approved' or status = 'auto_resolved')`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')`,
      overridden: sql<number>`count(*) filter (where founder_override_action is not null)`,
    })
      .from(decisionsInboxItems)
      .where(and(
        eq(decisionsInboxItems.ownerAgentCodename, agent.codename),
        gte(decisionsInboxItems.createdAt, oneDayAgo),
      ));

    const stats = decisionResults[0] || { total: 0, approved: 0, rejected: 0, overridden: 0 };
    const totalDecisions = Number(stats.total);
    const approvedDecisions = Number(stats.approved);
    const overriddenDecisions = Number(stats.overridden);

    // ── Dimension 2: Action outcomes (NEW in v3) ────────────────────────
    const actionResults = await db.select({
      total: count(),
      succeeded: sql<number>`count(*) filter (where outcome = 'success')`,
      failed: sql<number>`count(*) filter (where outcome = 'failure')`,
    })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agent.codename),
        gte(agentActionLog.createdAt, oneDayAgo),
        sql`${agentActionLog.actionType} != 'outcome_check'`, // Exclude verification checks
      ));

    const actionStats = actionResults[0] || { total: 0, succeeded: 0, failed: 0 };
    const totalActions = Number(actionStats.total);
    const succeededActions = Number(actionStats.succeeded);
    const failedActions = Number(actionStats.failed);

    // Skip if no activity at all
    if (totalDecisions === 0 && totalActions === 0) continue;

    // ── Calculate combined trust delta ──────────────────────────────────
    let delta = 0;
    let reasons: string[] = [];

    // Decision accuracy component
    if (totalDecisions > 0) {
      const accuracyRate = (approvedDecisions / totalDecisions) * 100;
      if (accuracyRate >= 90) {
        delta += 1;
        reasons.push(`${accuracyRate.toFixed(0)}% accuracy on ${totalDecisions} decisions`);
      } else if (accuracyRate < 60) {
        delta -= 1;
        reasons.push(`${accuracyRate.toFixed(0)}% accuracy — needs improvement`);
      }
      if (overriddenDecisions > 0) {
        delta -= overriddenDecisions;
        reasons.push(`${overriddenDecisions} CEO override(s)`);
      }
    }

    // Action outcome component (NEW in v3)
    if (totalActions > 0) {
      const successRate = (succeededActions / totalActions) * 100;
      if (successRate >= 80 && totalActions >= 2) {
        delta += 1;
        reasons.push(`${succeededActions}/${totalActions} actions succeeded`);
      } else if (failedActions > 2) {
        delta -= 1;
        reasons.push(`${failedActions} failed actions — reliability concern`);
      } else if (totalActions > 0 && succeededActions > 0) {
        reasons.push(`${succeededActions} successful action(s)`);
      }
    }

    // Daily deltas are smaller than weekly — cap at ±2 per day
    delta = Math.max(-2, Math.min(2, delta));
    const reason = reasons.join("; ") || "Routine evaluation";

    const previousScore = agent.trustScore;
    const newScore = Math.max(0, Math.min(100, previousScore + delta));

    // Apply the update
    if (delta !== 0) {
      await companyAgentService.updateTrustScore(agent.codename, delta);
    }

    // Update agent metrics
    await companyAgentService.updateMetrics(agent.codename, {
      decisionsTotal: (agent.metrics as any)?.decisionsTotal + totalDecisions || totalDecisions,
      decisionsCorrect: (agent.metrics as any)?.decisionsCorrect + approvedDecisions || approvedDecisions,
      lastWeekActions: totalDecisions,
      avgConfidence: accuracyRate,
    });

    // Log the evolution
    await db.insert(trustEvolutionLog).values({
      agentCodename: agent.codename,
      previousScore,
      newScore,
      delta,
      reason,
      periodStart: oneDayAgo,
      periodEnd: now,
      decisionsInPeriod: totalDecisions,
      accuracyRate: accuracyRate.toFixed(2),
      promotionSuggested: false,
      promotionAction: null,
    });

    updates.push({ codename: agent.codename, previousScore, newScore, delta, reason });

    // Check for promotion thresholds
    const crossedUp = (threshold: number) => previousScore < threshold && newScore >= threshold;
    const crossedDown = (threshold: number) => previousScore >= threshold && newScore < threshold;

    if (crossedUp(90)) {
      const suggestion = `${agent.title} has reached trust score 90. Eligible for maximum autonomy — promote remaining Level 1 actions to Level 0?`;
      promotionSuggestions.push({ codename: agent.codename, title: agent.title, suggestion });

      await db.insert(trustEvolutionLog).values({
        agentCodename: agent.codename,
        previousScore,
        newScore,
        delta,
        reason: "Trust threshold crossed: 90 (full trust)",
        periodStart: oneDayAgo,
        periodEnd: now,
        decisionsInPeriod: totalDecisions,
        accuracyRate: accuracyRate.toFixed(2),
        promotionSuggested: true,
        promotionAction: "Promote Level 1 → Level 0",
      });
    } else if (crossedUp(75)) {
      const suggestion = `${agent.title} has reached trust score 75. Eligible for expanded autonomy — promote Level 2 actions to Level 1?`;
      promotionSuggestions.push({ codename: agent.codename, title: agent.title, suggestion });

      await db.insert(trustEvolutionLog).values({
        agentCodename: agent.codename,
        previousScore,
        newScore,
        delta,
        reason: "Trust threshold crossed: 75 (high trust)",
        periodStart: oneDayAgo,
        periodEnd: now,
        decisionsInPeriod: totalDecisions,
        accuracyRate: accuracyRate.toFixed(2),
        promotionSuggested: true,
        promotionAction: "Promote Level 2 → Level 1",
      });
    } else if (crossedUp(60)) {
      const suggestion = `${agent.title} has reached trust score 60. Eligible for Level 2 → Level 1 promotions on low-risk actions.`;
      promotionSuggestions.push({ codename: agent.codename, title: agent.title, suggestion });
    }

    if (crossedDown(60)) {
      const suggestion = `${agent.title} dropped below trust score 60. Consider restricting autonomy — demote Level 1 actions to Level 2?`;
      promotionSuggestions.push({ codename: agent.codename, title: agent.title, suggestion });
    }
  }

  // Broadcast summary to the team
  if (updates.length > 0) {
    await agentCommsService.broadcast({
      from: "trust_evolution",
      channel: "incidents",
      priority: promotionSuggestions.length > 0 ? "high" : "low",
      subject: `Daily trust evolution: ${updates.length} agents updated`,
      body: updates.map(u => `${u.codename}: ${u.previousScore} → ${u.newScore} (${u.delta > 0 ? "+" : ""}${u.delta})`).join("\n"),
      data: { updates, promotionSuggestions },
    });
  }

  console.log(`[TrustEvolution] ${updates.length} agents updated, ${promotionSuggestions.length} promotion suggestions`);

  return { updates, promotionSuggestions };
}
