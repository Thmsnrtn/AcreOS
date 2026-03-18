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
  companyAgents, decisionsInboxItems, trustEvolutionLog,
} from "@shared/schema";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";
import { agentCommsService } from "./agentComms";

/**
 * Run the weekly trust evolution for all agents.
 * Called by a weekly scheduled job (Sunday midnight).
 */
export async function runTrustEvolution(): Promise<{
  updates: { codename: string; previousScore: number; newScore: number; delta: number; reason: string }[];
  promotionSuggestions: { codename: string; title: string; suggestion: string }[];
}> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const agents = await companyAgentService.getAllIncludingPaused();
  const updates: any[] = [];
  const promotionSuggestions: any[] = [];

  for (const agent of agents) {
    if (agent.status === "disabled") continue;

    // Count decisions attributed to this agent in the last week
    const decisionResults = await db.select({
      total: count(),
      approved: sql<number>`count(*) filter (where status = 'approved' or status = 'auto_resolved')`,
      rejected: sql<number>`count(*) filter (where status = 'rejected')`,
      overridden: sql<number>`count(*) filter (where founder_override_action is not null)`,
    })
      .from(decisionsInboxItems)
      .where(and(
        eq(decisionsInboxItems.ownerAgentCodename, agent.codename),
        gte(decisionsInboxItems.createdAt, oneWeekAgo),
      ));

    const stats = decisionResults[0] || { total: 0, approved: 0, rejected: 0, overridden: 0 };
    const totalDecisions = Number(stats.total);
    const approvedDecisions = Number(stats.approved);
    const overriddenDecisions = Number(stats.overridden);

    if (totalDecisions === 0) {
      // No decisions this week — no change, but record it
      continue;
    }

    // Calculate accuracy rate
    const accuracyRate = totalDecisions > 0
      ? (approvedDecisions / totalDecisions) * 100
      : 100;

    // Determine trust delta
    let delta = 0;
    let reason = "";

    if (accuracyRate >= 90) {
      delta = 2;
      reason = `${accuracyRate.toFixed(0)}% accuracy on ${totalDecisions} decisions — excellent performance`;
    } else if (accuracyRate >= 75) {
      delta = 1;
      reason = `${accuracyRate.toFixed(0)}% accuracy on ${totalDecisions} decisions — good performance`;
    } else if (accuracyRate >= 60) {
      delta = 0;
      reason = `${accuracyRate.toFixed(0)}% accuracy on ${totalDecisions} decisions — satisfactory`;
    } else if (accuracyRate >= 40) {
      delta = -1;
      reason = `${accuracyRate.toFixed(0)}% accuracy on ${totalDecisions} decisions — needs improvement`;
    } else {
      delta = -3;
      reason = `${accuracyRate.toFixed(0)}% accuracy on ${totalDecisions} decisions — significant concerns`;
    }

    // Bonus for high volume + high accuracy
    if (totalDecisions >= 10 && accuracyRate >= 90) {
      delta += 1;
      reason += ` (bonus: high volume + high accuracy)`;
    }

    // Penalty for overrides
    if (overriddenDecisions > 0) {
      delta -= overriddenDecisions;
      reason += ` (${overriddenDecisions} CEO override(s))`;
    }

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
      periodStart: oneWeekAgo,
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
        periodStart: oneWeekAgo,
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
        periodStart: oneWeekAgo,
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
      subject: `Weekly trust evolution: ${updates.length} agents updated`,
      body: updates.map(u => `${u.codename}: ${u.previousScore} → ${u.newScore} (${u.delta > 0 ? "+" : ""}${u.delta})`).join("\n"),
      data: { updates, promotionSuggestions },
    });
  }

  console.log(`[TrustEvolution] ${updates.length} agents updated, ${promotionSuggestions.length} promotion suggestions`);

  return { updates, promotionSuggestions };
}
