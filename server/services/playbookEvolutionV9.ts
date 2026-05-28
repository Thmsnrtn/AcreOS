/**
 * Playbook Evolution Engine — Sovereign Company Protocol v9: The Self-Running Company
 *
 * Playbooks become living organisms that mutate, compete, and evolve.
 *
 * When a playbook's success rate drops below threshold for N consecutive
 * executions, the system:
 * 1. Analyzes WHY (what changed in the data)
 * 2. Proposes a MUTATION (one specific modification)
 * 3. Runs the mutation as a CHALLENGER vs the CHAMPION
 * 4. Winner becomes the new champion. Loser is archived.
 *
 * The CEO sees the evolution tree of any playbook — how it adapted over time.
 */

import { db } from "../db";
import {
  playbookEvolutions, agentPlaybooks,
  type PlaybookEvolution,
} from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { resolveAgentData } from "./agentDataResolvers";

// ─── Evolution Config ────────────────────────────────────────────────────────

const EVOLUTION_CONFIG = {
  degradationThreshold: 60,        // success rate below which we consider degraded
  minExecutionsBeforeMutate: 5,    // need at least N executions to evaluate
  challengerTestRuns: 5,           // how many runs before we compare
  minImprovementPercent: 10,       // challenger must beat champion by at least this much
};

type MutationType = "step_swap" | "timing_change" | "agent_swap" | "condition_add" | "step_remove" | "step_add";

// ─── Service ─────────────────────────────────────────────────────────────────

class PlaybookEvolutionService {

  /**
   * Scan all active playbooks for degradation and propose mutations.
   * Call this on a regular cadence (e.g., daily or after every N executions).
   */
  async scanForDegradation(): Promise<Array<{ playbookId: number; name: string; successRate: number; mutationProposed: boolean }>> {
    const playbooks = await db.query.agentPlaybooks.findMany({
      where: and(
        eq(agentPlaybooks.isApproved, true),
        eq(agentPlaybooks.isActive, true),
      ),
    });

    const results: Array<{ playbookId: number; name: string; successRate: number; mutationProposed: boolean }> = [];

    for (const playbook of playbooks) {
      const successRate = Number(playbook.successRate || 100);
      const totalExecutions = playbook.totalExecutions || 0;

      if (
        totalExecutions >= EVOLUTION_CONFIG.minExecutionsBeforeMutate &&
        successRate < EVOLUTION_CONFIG.degradationThreshold
      ) {
        // Check if there's already an active evolution for this playbook
        const existingEvolution = await db.query.playbookEvolutions.findFirst({
          where: and(
            eq(playbookEvolutions.championPlaybookId, playbook.id),
            eq(playbookEvolutions.status, "testing"),
          ),
        });

        if (!existingEvolution) {
          const mutationProposed = await this.proposeMutation(playbook);
          results.push({
            playbookId: playbook.id,
            name: playbook.name,
            successRate,
            mutationProposed,
          });
        } else {
          results.push({
            playbookId: playbook.id,
            name: playbook.name,
            successRate,
            mutationProposed: false,
          });
        }
      }
    }

    return results;
  }

  /**
   * Propose a mutation for a degrading playbook.
   * Analyzes what changed, generates a specific modification, creates the challenger.
   */
  private async proposeMutation(playbook: any): Promise<boolean> {
    const ownerAgent = await companyAgentService.getByCodename(playbook.ownerAgent || "oracle_analytics");
    const liveData = await resolveAgentData(playbook.ownerAgent || "oracle_analytics").catch(() => ({}));

    try {
      const response = await routeAITask({
        taskType: "playbook_mutation",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are analyzing a degrading playbook and proposing a single, specific mutation to improve it.

Mutation types:
- step_swap: Replace one step's action with a different action
- timing_change: Adjust delays between steps
- agent_swap: Replace the agent handling a step with a different agent
- condition_add: Add a conditional check before a step
- step_remove: Remove a step that may be counterproductive
- step_add: Add a new step to address a gap

Propose exactly ONE mutation. Be specific about what to change and why.`,
          },
          {
            role: "user",
            content: `Degrading playbook:
Name: ${playbook.name}
Description: ${playbook.description}
Success rate: ${playbook.successRate}% (threshold: ${EVOLUTION_CONFIG.degradationThreshold}%)
Total executions: ${playbook.totalExecutions}
Owner: ${playbook.ownerAgent}

Current steps:
${(playbook.steps as any[]).map((s: any, i: number) =>
  `  Step ${i}: ${s.agentCodename} → ${s.action} (${s.description})`
).join("\n")}

Current business context:
${JSON.stringify(liveData, null, 2)}

Analyze why this playbook might be failing and propose ONE mutation.

Respond in JSON:
{
  "analysis": "Why this playbook is likely degrading (2-3 sentences)",
  "mutationType": "step_swap|timing_change|agent_swap|condition_add|step_remove|step_add",
  "mutationDescription": "Specific description of the change",
  "mutatedSteps": [
    { "order": 0, "agentCodename": "agent", "action": "action", "description": "what this step does" }
  ],
  "hypothesis": "Why this mutation should improve success rate",
  "expectedImprovement": "10-30%"
}`,
          },
        ],
        responseFormat: "json",
        temperature: 0.4,
      });

      const parsed = JSON.parse(response.content);

      // Create the evolution record
      await db.insert(playbookEvolutions).values({
        championPlaybookId: playbook.id,
        championGeneration: playbook.generation || 1,
        mutationType: parsed.mutationType,
        mutationDescription: parsed.mutationDescription,
        analysis: parsed.analysis,
        hypothesis: parsed.hypothesis,
        mutatedSteps: parsed.mutatedSteps || playbook.steps,
        status: "proposed",
        championSuccessRate: playbook.successRate,
        challengerSuccessRate: null,
        challengerExecutions: 0,
        requiredTestRuns: EVOLUTION_CONFIG.challengerTestRuns,
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * CEO approves a proposed mutation — starts the A/B test.
   */
  async approveEvolution(evolutionId: number): Promise<void> {
    await db.update(playbookEvolutions)
      .set({
        status: "testing",
        testStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(playbookEvolutions.id, evolutionId));
  }

  /**
   * Record a challenger execution result.
   * When enough results are in, automatically determine the winner.
   */
  async recordChallengerResult(evolutionId: number, success: boolean): Promise<{
    status: "testing" | "champion_wins" | "challenger_wins";
    message: string;
  }> {
    const evolution = await db.query.playbookEvolutions.findFirst({
      where: eq(playbookEvolutions.id, evolutionId),
    });
    if (!evolution) return { status: "testing", message: "Evolution not found" };

    const executions = (evolution.challengerExecutions || 0) + 1;
    const successCount = (evolution.challengerSuccessCount || 0) + (success ? 1 : 0);
    const challengerRate = Math.round((successCount / executions) * 100);

    await db.update(playbookEvolutions)
      .set({
        challengerExecutions: executions,
        challengerSuccessCount: successCount,
        challengerSuccessRate: challengerRate.toString(),
        updatedAt: new Date(),
      })
      .where(eq(playbookEvolutions.id, evolutionId));

    // Check if we have enough data to decide
    if (executions >= EVOLUTION_CONFIG.challengerTestRuns) {
      const championRate = Number(evolution.championSuccessRate || 0);

      if (challengerRate > championRate + EVOLUTION_CONFIG.minImprovementPercent) {
        // Challenger wins — apply the mutation to the playbook
        await this.applyChallengerWin(evolution, challengerRate);
        return { status: "challenger_wins", message: `Challenger wins: ${challengerRate}% vs ${championRate}%. Mutation applied.` };
      } else {
        // Champion survives
        await db.update(playbookEvolutions)
          .set({ status: "champion_wins", resolvedAt: new Date(), updatedAt: new Date() })
          .where(eq(playbookEvolutions.id, evolutionId));
        return { status: "champion_wins", message: `Champion survives: ${championRate}% vs challenger ${challengerRate}%. Mutation reverted.` };
      }
    }

    return { status: "testing", message: `Testing: ${executions}/${EVOLUTION_CONFIG.challengerTestRuns} runs. Current challenger rate: ${challengerRate}%` };
  }

  /**
   * Apply a winning challenger mutation to the original playbook.
   */
  private async applyChallengerWin(evolution: any, newSuccessRate: number): Promise<void> {
    const playbook = await db.query.agentPlaybooks.findFirst({
      where: eq(agentPlaybooks.id, evolution.championPlaybookId),
    });
    if (!playbook) return;

    // Update the playbook with the mutated steps
    await db.update(agentPlaybooks)
      .set({
        steps: evolution.mutatedSteps,
        generation: (playbook.generation || 1) + 1,
        successRate: newSuccessRate.toString(),
        parentPlaybookId: playbook.id,
        updatedAt: new Date(),
      })
      .where(eq(agentPlaybooks.id, evolution.championPlaybookId));

    // Mark evolution as resolved
    await db.update(playbookEvolutions)
      .set({
        status: "challenger_wins",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(playbookEvolutions.id, evolution.id));
  }

  /** Get active evolutions (in testing) */
  async getActiveEvolutions(): Promise<PlaybookEvolution[]> {
    return db.query.playbookEvolutions.findMany({
      where: eq(playbookEvolutions.status, "testing"),
      orderBy: [desc(playbookEvolutions.createdAt)],
    });
  }

  /** Get proposed evolutions awaiting approval */
  async getProposedEvolutions(): Promise<PlaybookEvolution[]> {
    return db.query.playbookEvolutions.findMany({
      where: eq(playbookEvolutions.status, "proposed"),
      orderBy: [desc(playbookEvolutions.createdAt)],
    });
  }

  /** Get evolution history for a specific playbook */
  async getPlaybookHistory(playbookId: number): Promise<PlaybookEvolution[]> {
    return db.query.playbookEvolutions.findMany({
      where: eq(playbookEvolutions.championPlaybookId, playbookId),
      orderBy: [desc(playbookEvolutions.createdAt)],
    });
  }

  /** Get all recent evolutions */
  async getRecent(limit = 20): Promise<PlaybookEvolution[]> {
    return db.query.playbookEvolutions.findMany({
      orderBy: [desc(playbookEvolutions.createdAt)],
      limit,
    });
  }
}

export const playbookEvolutionService = new PlaybookEvolutionService();
