// @ts-nocheck
/**
 * Agent Synergy Map — Sovereign Company Protocol v8
 *
 * Track which agent PAIRS produce the best outcomes.
 * "Sophie + Oracle: 92% success when working together."
 * "Forge + Shield: 61% — legal review bottleneck."
 *
 * Feeds back into workflow routing: when a task needs two agents,
 * pick the highest-synergy pair. When a pair keeps failing, restructure.
 */

import { db } from "../db";
import { agentSynergyMap, type AgentSynergy } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";

// ─── Service ─────────────────────────────────────────────────────────────────

class AgentSynergyService {

  /** Record a collaboration outcome between two agents */
  async recordCollaboration(input: {
    agentA: string;
    agentB: string;
    taskType: string;
    success: boolean;
  }): Promise<void> {
    // Normalize ordering (alphabetical) so A-B and B-A are the same pair
    const [a, b] = [input.agentA, input.agentB].sort();

    let synergy = await db.query.agentSynergyMap.findFirst({
      where: and(
        eq(agentSynergyMap.agentA, a),
        eq(agentSynergyMap.agentB, b),
      ),
    });

    if (!synergy) {
      const [created] = await db.insert(agentSynergyMap).values({
        agentA: a,
        agentB: b,
        totalCollaborations: 0,
        successCount: 0,
        failureCount: 0,
        recentOutcomes: [],
      }).returning();
      synergy = created;
    }

    const totalCollaborations = (synergy.totalCollaborations || 0) + 1;
    const successCount = (synergy.successCount || 0) + (input.success ? 1 : 0);
    const failureCount = (synergy.failureCount || 0) + (input.success ? 0 : 1);
    const synergyScore = totalCollaborations > 0 ? (successCount / totalCollaborations) : 0.5;

    // Track recent outcomes (keep last 20)
    const recentOutcomes = [...((synergy.recentOutcomes as any[]) || [])];
    recentOutcomes.push({
      taskType: input.taskType,
      success: input.success,
      timestamp: new Date().toISOString(),
    });
    if (recentOutcomes.length > 20) recentOutcomes.shift();

    // Track best/worst task types
    const taskSuccessMap: Record<string, { s: number; f: number }> = {};
    for (const o of recentOutcomes) {
      if (!taskSuccessMap[o.taskType]) taskSuccessMap[o.taskType] = { s: 0, f: 0 };
      if (o.success) taskSuccessMap[o.taskType].s++;
      else taskSuccessMap[o.taskType].f++;
    }

    const bestAt: string[] = [];
    const worstAt: string[] = [];
    for (const [taskType, counts] of Object.entries(taskSuccessMap)) {
      const rate = counts.s / (counts.s + counts.f);
      if (rate >= 0.8 && (counts.s + counts.f) >= 3) bestAt.push(taskType);
      if (rate <= 0.4 && (counts.s + counts.f) >= 3) worstAt.push(taskType);
    }

    await db.update(agentSynergyMap)
      .set({
        totalCollaborations,
        successCount,
        failureCount,
        synergyScore: synergyScore.toFixed(3),
        recentOutcomes,
        bestAt,
        worstAt,
        updatedAt: new Date(),
      })
      .where(eq(agentSynergyMap.id, synergy.id));
  }

  /** Get all synergy pairs sorted by score */
  async getAll(): Promise<AgentSynergy[]> {
    return db.query.agentSynergyMap.findMany({
      orderBy: [desc(agentSynergyMap.synergyScore)],
    });
  }

  /** Get the best pair for a given task type */
  async getBestPair(taskType: string): Promise<{ agentA: string; agentB: string; score: number } | null> {
    const all = await this.getAll();
    for (const synergy of all) {
      if ((synergy.bestAt as string[])?.includes(taskType)) {
        return {
          agentA: synergy.agentA,
          agentB: synergy.agentB,
          score: Number(synergy.synergyScore || 0),
        };
      }
    }
    return all.length > 0 ? {
      agentA: all[0].agentA,
      agentB: all[0].agentB,
      score: Number(all[0].synergyScore || 0),
    } : null;
  }

  /** Generate AI recommendations for pair optimization */
  async generateRecommendations(): Promise<void> {
    const all = await this.getAll();
    if (all.length === 0) return;

    for (const synergy of all) {
      if ((synergy.totalCollaborations || 0) < 5) continue;

      try {
        const response = await routeAITask({
          taskType: "synergy_recommendation",
          complexity: TaskComplexity.SIMPLE,
          messages: [
            {
              role: "system",
              content: `You generate brief routing recommendations for agent pairs. One sentence.`,
            },
            {
              role: "user",
              content: `Agent pair: ${synergy.agentA} + ${synergy.agentB}
Collaborations: ${synergy.totalCollaborations}, Success: ${synergy.successCount}, Failure: ${synergy.failureCount}
Best at: ${(synergy.bestAt as string[])?.join(", ") || "nothing specific"}
Worst at: ${(synergy.worstAt as string[])?.join(", ") || "nothing specific"}

One sentence routing recommendation:`,
            },
          ],
          maxTokens: 50,
          temperature: 0.2,
        });

        await db.update(agentSynergyMap)
          .set({ recommendation: response.content, updatedAt: new Date() })
          .where(eq(agentSynergyMap.id, synergy.id));
      } catch {}
    }
  }
}

export const agentSynergyService = new AgentSynergyService();
