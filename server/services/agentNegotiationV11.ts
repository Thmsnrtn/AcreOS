// @ts-nocheck
/**
 * Agent Negotiation Protocol — Sovereign Company Protocol v11: The Anticipatory Enterprise
 *
 * When agents disagree, they negotiate — not escalate.
 * Forge wants 20% discount for churn rescue. Shield says contract forbids it.
 * Instead of CEO bottleneck: structured negotiation rounds with evidence,
 * proposals, concessions. If deadlocked → escalate with both positions documented.
 * CEO override patterns feed back into future negotiations.
 */

import { db } from "../db";
import { agentNegotiations, type AgentNegotiation } from "@shared/schema";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";

const MAX_ROUNDS = 3;

class AgentNegotiationService {

  /**
   * Initiate a negotiation between two agents.
   */
  async initiate(params: {
    initiatorAgent: string;
    respondentAgent: string;
    conflictType: string;
    subject: string;
    initiatorPosition: string;
    initiatorEvidence: string[];
  }): Promise<AgentNegotiation> {
    const [neg] = await db.insert(agentNegotiations).values({
      initiatorAgent: params.initiatorAgent,
      respondentAgent: params.respondentAgent,
      conflictType: params.conflictType,
      subject: params.subject,
      initiatorPosition: params.initiatorPosition,
      initiatorEvidence: params.initiatorEvidence,
      status: "open",
    }).returning();

    // Auto-start negotiation
    return this.runNegotiation(neg.id);
  }

  /**
   * Run the full negotiation protocol.
   * Each agent gets MAX_ROUNDS to propose, counter-propose, and find compromise.
   */
  async runNegotiation(negotiationId: number): Promise<AgentNegotiation> {
    const [neg] = await db.select().from(agentNegotiations)
      .where(eq(agentNegotiations.id, negotiationId)).limit(1);
    if (!neg) throw new Error("Negotiation not found");

    const agents = await companyAgentService.getAll();
    const initiator = agents.find(a => a.codename === neg.initiatorAgent);
    const respondent = agents.find(a => a.codename === neg.respondentAgent);

    // Get respondent's initial position
    const respondentPrompt = `You are ${neg.respondentAgent} (${respondent?.title || "Agent"}).
Another agent (${neg.initiatorAgent}) has initiated a negotiation:

SUBJECT: ${neg.subject}
CONFLICT TYPE: ${neg.conflictType}
THEIR POSITION: ${neg.initiatorPosition}
THEIR EVIDENCE: ${JSON.stringify(neg.initiatorEvidence)}

State YOUR position on this matter. What do you think should happen and why?
Consider your domain expertise and responsibilities.

Respond in JSON:
{
  "position": "Your position (2-3 sentences)",
  "evidence": ["Evidence point 1", "Evidence point 2"],
  "openToCompromise": true,
  "redLines": ["Things you absolutely cannot accept"]
}`;

    let respondentPosition = "";
    let respondentEvidence: string[] = [];
    try {
      const result = await routeAITask({ task: respondentPrompt, complexity: TaskComplexity.MODERATE, responseFormat: "json" });
      const parsed = JSON.parse(result.response);
      respondentPosition = parsed.position || "No position stated";
      respondentEvidence = parsed.evidence || [];
    } catch {
      respondentPosition = "Unable to formulate position";
    }

    await db.update(agentNegotiations)
      .set({ respondentPosition, respondentEvidence, status: "negotiating" })
      .where(eq(agentNegotiations.id, negotiationId));

    // Run negotiation rounds
    const rounds: Array<{ round: number; agentCodename: string; proposal: string; concessions: string[]; reasoning: string }> = [];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // Each agent proposes in alternating turns
      for (const agent of [neg.initiatorAgent, neg.respondentAgent]) {
        const isInitiator = agent === neg.initiatorAgent;
        const myPosition = isInitiator ? neg.initiatorPosition : respondentPosition;
        const theirPosition = isInitiator ? respondentPosition : neg.initiatorPosition;

        const roundPrompt = `You are ${agent} in negotiation round ${round}/${MAX_ROUNDS}.

SUBJECT: ${neg.subject}
YOUR POSITION: ${myPosition}
THEIR POSITION: ${theirPosition}
PREVIOUS ROUNDS: ${JSON.stringify(rounds)}

${round === MAX_ROUNDS ? "THIS IS THE FINAL ROUND. You MUST either find compromise or accept deadlock." : "Propose a solution that addresses both sides' concerns."}

Respond in JSON:
{
  "proposal": "Your specific proposal this round",
  "concessions": ["What you're willing to give up"],
  "reasoning": "Why this is fair"
}`;

        try {
          const result = await routeAITask({ task: roundPrompt, complexity: TaskComplexity.MODERATE, responseFormat: "json" });
          const parsed = JSON.parse(result.response);
          rounds.push({
            round,
            agentCodename: agent,
            proposal: parsed.proposal || "No proposal",
            concessions: parsed.concessions || [],
            reasoning: parsed.reasoning || "",
          });
        } catch {
          rounds.push({ round, agentCodename: agent, proposal: "Error generating proposal", concessions: [], reasoning: "" });
        }
      }
    }

    // Evaluate resolution
    const evalPrompt = `Evaluate this negotiation:

SUBJECT: ${neg.subject}
INITIATOR (${neg.initiatorAgent}): ${neg.initiatorPosition}
RESPONDENT (${neg.respondentAgent}): ${respondentPosition}
NEGOTIATION ROUNDS: ${JSON.stringify(rounds)}

Did they reach a resolution? Classify:

Respond in JSON:
{
  "resolutionType": "compromise|initiator_wins|respondent_wins|deadlocked",
  "resolution": "Description of the final outcome",
  "compromiseDetails": { "key": "value pairs of the agreed terms" }
}`;

    let resolution = "Negotiation concluded";
    let resolutionType = "deadlocked";
    let compromiseDetails = {};

    try {
      const result = await routeAITask({ task: evalPrompt, complexity: TaskComplexity.MODERATE, responseFormat: "json" });
      const parsed = JSON.parse(result.response);
      resolution = parsed.resolution || "Negotiation concluded";
      resolutionType = parsed.resolutionType || "deadlocked";
      compromiseDetails = parsed.compromiseDetails || {};
    } catch { /* use defaults */ }

    const finalStatus = resolutionType === "deadlocked" ? "escalated" : "resolved";

    const [updated] = await db.update(agentNegotiations)
      .set({
        negotiationRounds: rounds,
        resolution,
        resolutionType,
        compromiseDetails,
        status: finalStatus,
        resolvedAt: new Date(),
      })
      .where(eq(agentNegotiations.id, negotiationId))
      .returning();

    return updated;
  }

  /**
   * CEO overrides a negotiation result.
   */
  async ceoOverride(negotiationId: number, override: string): Promise<void> {
    await db.update(agentNegotiations)
      .set({ ceoOverride: override, status: "resolved", resolvedAt: new Date() })
      .where(eq(agentNegotiations.id, negotiationId));
  }

  async getById(id: number): Promise<AgentNegotiation | null> {
    const [n] = await db.select().from(agentNegotiations).where(eq(agentNegotiations.id, id)).limit(1);
    return n || null;
  }

  async getActive(): Promise<AgentNegotiation[]> {
    return db.select().from(agentNegotiations)
      .where(sql`${agentNegotiations.status} IN ('open', 'negotiating')`)
      .orderBy(desc(agentNegotiations.createdAt));
  }

  async getEscalated(): Promise<AgentNegotiation[]> {
    return db.select().from(agentNegotiations)
      .where(eq(agentNegotiations.status, "escalated"))
      .orderBy(desc(agentNegotiations.createdAt));
  }

  async getRecent(limit = 20): Promise<AgentNegotiation[]> {
    return db.select().from(agentNegotiations)
      .orderBy(desc(agentNegotiations.createdAt)).limit(limit);
  }

  async getStats(): Promise<{ total: number; resolved: number; escalated: number; compromiseRate: number }> {
    const all = await db.select().from(agentNegotiations);
    const resolved = all.filter(n => n.status === "resolved").length;
    const escalated = all.filter(n => n.status === "escalated").length;
    const compromises = all.filter(n => n.resolutionType === "compromise").length;
    return {
      total: all.length,
      resolved,
      escalated,
      compromiseRate: resolved > 0 ? Math.round((compromises / resolved) * 100) : 0,
    };
  }
}

export const agentNegotiationService = new AgentNegotiationService();
