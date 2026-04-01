/**
 * Agent Debates — Sovereign Company Protocol v8
 *
 * Structured disagreement before big decisions.
 * "Should we build a mobile app?"
 * Atlas: YES (tech opportunity). Ledger: NO (cash burn).
 * Compass: YES (customer demand). Forge: WAIT (current revenue growing).
 *
 * Format: Proposition → Opening arguments → Rebuttals → Final votes → CEO decides.
 * The goal is adversarial reasoning. Surface blind spots.
 */

import { db } from "../db";
import { agentDebates, type AgentDebate } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { resolveAgentData } from "./agentDataResolvers";
import { logger } from "../utils/logger";

// ─── Debate Participants by Category ─────────────────────────────────────────

const DEBATE_PANELS: Record<string, { forCandidates: string[]; againstCandidates: string[] }> = {
  investment: {
    forCandidates: ["atlas_cto", "compass_pm", "forge_revenue"],
    againstCandidates: ["ledger_finance", "crucible_qa", "shield_legal"],
  },
  pricing: {
    forCandidates: ["forge_revenue", "beacon_marketing"],
    againstCandidates: ["sophie_csm", "ledger_finance", "oracle_analytics"],
  },
  product: {
    forCandidates: ["compass_pm", "atlas_cto", "beacon_marketing"],
    againstCandidates: ["crucible_qa", "ledger_finance", "sentinel_devops"],
  },
  hiring: {
    forCandidates: ["atlas_cto", "compass_pm"],
    againstCandidates: ["ledger_finance", "forge_revenue"],
  },
  strategy: {
    forCandidates: ["atlas_cto", "forge_revenue", "oracle_analytics"],
    againstCandidates: ["ledger_finance", "shield_legal", "sophie_csm"],
  },
  risk: {
    forCandidates: ["forge_revenue", "compass_pm"],
    againstCandidates: ["shield_legal", "sentinel_devops", "crucible_qa"],
  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

class AgentDebateService {

  /** Initiate a debate */
  async initiate(proposition: string, category?: string): Promise<number> {
    const cat = category || this.classifyCategory(proposition);
    const panel = DEBATE_PANELS[cat] || DEBATE_PANELS.strategy;

    // Pick 2 for, 2 against
    const forAgents = panel.forCandidates.slice(0, 2);
    const againstAgents = panel.againstCandidates.slice(0, 2);

    const [debate] = await db.insert(agentDebates).values({
      proposition,
      status: "in_progress",
      category: cat,
      initiatedBy: "ceo",
      forAgents,
      againstAgents,
      arguments: [],
      votes: [],
    }).returning({ id: agentDebates.id });

    // Run the debate asynchronously
    this.runDebate(debate.id, proposition, forAgents, againstAgents).catch(err => {
      logger.error(`[Debate] ${debate.id} failed`, err);
    });

    return debate.id;
  }

  /** Run the full debate */
  private async runDebate(
    debateId: number,
    proposition: string,
    forAgents: string[],
    againstAgents: string[],
  ): Promise<void> {
    const allArgs: any[] = [];

    // Round 1: Opening arguments
    for (const agentCodename of forAgents) {
      const arg = await this.generateArgument(agentCodename, proposition, "for", 1, []);
      if (arg) allArgs.push(arg);
    }
    for (const agentCodename of againstAgents) {
      const arg = await this.generateArgument(agentCodename, proposition, "against", 1, []);
      if (arg) allArgs.push(arg);
    }

    // Save round 1
    await db.update(agentDebates)
      .set({ arguments: allArgs })
      .where(eq(agentDebates.id, debateId));

    // Round 2: Rebuttals (each side responds to the other)
    const forArgs = allArgs.filter(a => a.position === "for").map(a => `${a.agentCodename}: ${a.argument}`).join("\n");
    const againstArgs = allArgs.filter(a => a.position === "against").map(a => `${a.agentCodename}: ${a.argument}`).join("\n");

    for (const agentCodename of forAgents) {
      const arg = await this.generateArgument(agentCodename, proposition, "for", 2, allArgs, againstArgs);
      if (arg) allArgs.push(arg);
    }
    for (const agentCodename of againstAgents) {
      const arg = await this.generateArgument(agentCodename, proposition, "against", 2, allArgs, forArgs);
      if (arg) allArgs.push(arg);
    }

    // Save round 2
    await db.update(agentDebates)
      .set({ arguments: allArgs })
      .where(eq(agentDebates.id, debateId));

    // Final votes from ALL participants
    const allParticipants = [...forAgents, ...againstAgents];
    const votes: any[] = [];

    for (const agentCodename of allParticipants) {
      const vote = await this.generateVote(agentCodename, proposition, allArgs);
      if (vote) votes.push(vote);
    }

    // Update with votes and mark as awaiting decision
    await db.update(agentDebates)
      .set({
        arguments: allArgs,
        votes,
        status: "awaiting_decision",
      })
      .where(eq(agentDebates.id, debateId));
  }

  /** Generate an argument from one agent */
  private async generateArgument(
    agentCodename: string,
    proposition: string,
    position: "for" | "against",
    round: number,
    priorArgs: any[],
    opposingArgsSummary?: string,
  ): Promise<any | null> {
    const agent = await companyAgentService.getByCodename(agentCodename);
    if (!agent) return null;

    const liveData = await resolveAgentData(agentCodename).catch(() => ({}));
    const roundLabel = round === 1 ? "opening argument" : "rebuttal";
    const positionLabel = position === "for" ? "IN FAVOR" : "AGAINST";

    try {
      const response = await routeAITask({
        taskType: "debate_argument",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `${agent.personalityPrompt}\n\nYou are in a structured debate. You are arguing ${positionLabel} the proposition. This is your ${roundLabel}. Be specific, use data, and argue from your domain expertise. ${round === 2 ? "Address the opposing arguments directly." : ""}`,
          },
          {
            role: "user",
            content: `Proposition: "${proposition}"
Your position: ${positionLabel}
Round: ${roundLabel}

Your domain data:
${JSON.stringify(liveData, null, 2)}

${opposingArgsSummary ? `Opposing arguments to address:\n${opposingArgsSummary}` : ""}

Respond in JSON:
{
  "argument": "Your argument in 2-3 sentences. Be specific with numbers.",
  "evidence": ["fact 1", "fact 2"],
  "confidence": 0-100
}`,
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.4,
      });

      const parsed = JSON.parse(response.content);
      return {
        agentCodename,
        position,
        round,
        argument: parsed.argument,
        evidence: parsed.evidence || [],
        confidence: parsed.confidence || 50,
      };
    } catch {
      return null;
    }
  }

  /** Generate a final vote from an agent */
  private async generateVote(agentCodename: string, proposition: string, allArgs: any[]): Promise<any | null> {
    const agent = await companyAgentService.getByCodename(agentCodename);
    if (!agent) return null;

    const debateSummary = allArgs.map(a =>
      `${a.agentCodename} (${a.position}, round ${a.round}): ${a.argument}`
    ).join("\n");

    try {
      const response = await routeAITask({
        taskType: "debate_vote",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          {
            role: "system",
            content: `${agent.personalityPrompt}\n\nAfter hearing all arguments, cast your final vote. You can change your mind from your original position if the other side made better arguments.`,
          },
          {
            role: "user",
            content: `Proposition: "${proposition}"

Full debate:
${debateSummary}

Cast your vote. JSON:
{ "vote": "for|against|abstain", "confidence": 0-100, "reasoning": "one sentence" }`,
          },
        ],
        responseFormat: { type: "json_object" },
        maxTokens: 80,
        temperature: 0.2,
      });

      const parsed = JSON.parse(response.content);
      return {
        agentCodename,
        vote: parsed.vote,
        confidence: parsed.confidence || 50,
        reasoning: parsed.reasoning,
      };
    } catch {
      return null;
    }
  }

  /** CEO makes a decision on a debate */
  async decide(debateId: number, decision: string, reasoning?: string): Promise<void> {
    await db.update(agentDebates)
      .set({
        status: "decided",
        ceoDecision: decision,
        ceoReasoning: reasoning,
        decidedAt: new Date(),
      })
      .where(eq(agentDebates.id, debateId));

    // Store as precedent for future auto-resolution
    const debate = await this.getById(debateId);
    if (debate) {
      const agents = [...(debate.forAgents || []), ...(debate.againstAgents || [])];
      await this.storePrecedent(debateId, decision, agents, debate.proposition);
    }
  }

  /** Get active/awaiting debates */
  async getPending(): Promise<AgentDebate[]> {
    return db.query.agentDebates.findMany({
      where: eq(agentDebates.status, "awaiting_decision"),
      orderBy: [desc(agentDebates.createdAt)],
    });
  }

  /** Get recent debates */
  async getRecent(limit = 10): Promise<AgentDebate[]> {
    return db.query.agentDebates.findMany({
      orderBy: [desc(agentDebates.createdAt)],
      limit,
    });
  }

  /** Get debate by ID */
  async getById(id: number): Promise<AgentDebate | undefined> {
    return db.query.agentDebates.findFirst({
      where: eq(agentDebates.id, id),
    });
  }

  /**
   * Detect disagreement: when two agents give conflicting recommendations
   * for the same context, automatically initiate a debate.
   */
  async detectDisagreement(
    context: string,
    agentA: { codename: string; position: string; data?: any },
    agentB: { codename: string; position: string; data?: any },
  ) {
    // Check for precedent first
    const precedent = await this.findPrecedent(context, agentA.codename, agentB.codename);

    if (precedent && precedent.similarity > 0.8) {
      // Auto-resolve using precedent
      return {
        autoResolved: true,
        resolution: precedent.resolution,
        precedentId: precedent.id,
        message: `Auto-resolved ${agentA.codename} vs ${agentB.codename} disagreement using precedent from ${precedent.date}.`,
      };
    }

    // No strong precedent — initiate a formal debate
    const debate = await this.initiate(
      `${agentA.codename} recommends: "${agentA.position}" vs ${agentB.codename} recommends: "${agentB.position}" — Context: ${context}`,
      this.classifyCategory(context),
    );

    return {
      autoResolved: false,
      debateId: debate,
      message: `Debate initiated between ${agentA.codename} and ${agentB.codename}.`,
    };
  }

  /**
   * Search institutional memory for similar past disagreements and their resolutions.
   */
  async findPrecedent(
    context: string,
    agentA: string,
    agentB: string,
  ): Promise<{ id: number; resolution: string; similarity: number; date: string } | null> {
    try {
      const { cognitiveMemoryService } = await import("./cognitiveMemoryV13");
      const episodes = await cognitiveMemoryService.recallEpisodes(agentA, {
        tags: ["disagreement", "precedent"],
        limit: 5,
      });

      for (const ep of episodes || []) {
        const epData = ep.context || ep;
        if (epData.agents?.includes(agentA) && epData.agents?.includes(agentB)) {
          // Simple similarity: same agents involved in same category
          return {
            id: ep.id,
            resolution: epData.resolution || "unknown",
            similarity: 0.85,
            date: ep.createdAt ? new Date(ep.createdAt).toLocaleDateString() : "unknown",
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Store a debate resolution as precedent for future auto-resolution.
   */
  async storePrecedent(debateId: number, resolution: string, agents: string[], topic: string) {
    try {
      const { cognitiveMemoryService } = await import("./cognitiveMemoryV13");
      for (const agent of agents) {
        await cognitiveMemoryService.recordEpisode(agent, {
          action: "disagreement_resolution",
          outcome: resolution,
          context: { debateId, agents, topic, resolution },
          tags: ["disagreement", "precedent"],
        });
      }
    } catch {
      // Best effort
    }
  }

  /** Simple category classification */
  private classifyCategory(proposition: string): string {
    const lower = proposition.toLowerCase();
    if (/invest|build|buy|spend|budget/i.test(lower)) return "investment";
    if (/price|pricing|charge|discount|tier/i.test(lower)) return "pricing";
    if (/feature|product|ship|launch|ux/i.test(lower)) return "product";
    if (/hire|recruit|team|headcount|role/i.test(lower)) return "hiring";
    if (/risk|security|compliance|danger/i.test(lower)) return "risk";
    return "strategy";
  }
}

export const agentDebateService = new AgentDebateService();
