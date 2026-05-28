/**
 * Agent Initiative Proposals — Sovereign Company Protocol v6
 *
 * Agents don't just execute — they THINK strategically.
 * They analyze patterns, identify opportunities, and pitch ideas to the CEO.
 *
 * Example: Oracle notices top customers all use bulk import heavily.
 * Proposes: "Build a premium tier around power features. Projected impact: +15% ARPU."
 * CEO approves → initiative becomes a goal → agents execute.
 *
 * This is the difference between employees and executives.
 */

import { db } from "../db";
import { agentInitiatives, type AgentInitiative } from "@shared/schema";
import { eq, and, desc, gte, count, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { resolveAgentData } from "./agentDataResolvers";

// ─── Initiative Generation Rules ─────────────────────────────────────────────
// Each agent has domains where it can propose initiatives

const INITIATIVE_DOMAINS: Record<string, string[]> = {
  oracle_analytics: ["product_opportunity", "pricing_optimization", "growth_lever", "risk_mitigation"],
  forge_revenue: ["revenue_expansion", "pricing_change", "upsell_strategy", "churn_prevention"],
  sophie_csm: ["customer_experience", "onboarding_improvement", "support_automation", "retention_program"],
  beacon_marketing: ["campaign_strategy", "content_opportunity", "channel_expansion", "brand_positioning"],
  atlas_cto: ["tech_investment", "architecture_improvement", "developer_experience", "platform_capability"],
  compass_pm: ["feature_proposal", "product_strategy", "competitive_response", "user_research"],
  ledger_finance: ["cost_optimization", "pricing_model", "financial_efficiency", "revenue_protection"],
  sentinel_devops: ["infrastructure_improvement", "reliability_investment", "performance_optimization"],
  shield_legal: ["compliance_initiative", "risk_reduction", "policy_improvement"],
  crucible_qa: ["quality_investment", "testing_automation", "process_improvement"],
};

// ─── Service ─────────────────────────────────────────────────────────────────

class AgentInitiativeService {

  /** Generate an initiative proposal from an agent based on current data */
  async generateInitiative(agentCodename: string): Promise<number | null> {
    const agent = await companyAgentService.getByCodename(agentCodename);
    if (!agent) return null;

    const domains = INITIATIVE_DOMAINS[agentCodename] || [];
    if (domains.length === 0) return null;

    // Get agent's live data for context
    const liveData = await resolveAgentData(agentCodename).catch(() => ({}));

    // Check if this agent already has a recent unvoted proposal (don't spam)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentProposal = await db.query.agentInitiatives.findFirst({
      where: and(
        eq(agentInitiatives.proposedBy, agentCodename),
        eq(agentInitiatives.status, "proposed"),
        gte(agentInitiatives.createdAt, oneWeekAgo),
      ),
    });
    if (recentProposal) return null; // Agent already has a pending proposal

    try {
      const response = await routeAITask({
        taskType: "initiative_generation",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `${agent.personalityPrompt}

You are proposing a strategic initiative to the CEO. Think like an executive, not an operator.

Your domain areas: ${domains.join(", ")}

Rules:
- The initiative must be based on DATA you can observe, not hunches
- Include specific metrics and projected impact
- Be honest about confidence level
- Think about what other agents would need to be involved
- Keep the proposal concise — the CEO is busy`,
          },
          {
            role: "user",
            content: `Based on your current data and observations, propose ONE strategic initiative to the CEO.

Your current data:
${JSON.stringify(liveData, null, 2)}

Respond in JSON:
{
  "title": "Short, punchy title (max 10 words)",
  "thesis": "2-3 sentence argument for why this matters NOW",
  "evidence": [
    { "type": "metric|pattern|customer_signal|market_data", "description": "what you observed", "value": "specific number or fact" }
  ],
  "projectedImpact": {
    "metric": "mrr|churn_rate|nps|conversion|efficiency",
    "currentValue": 0,
    "projectedValue": 0,
    "timeframeWeeks": 4,
    "confidence": "low|medium|high"
  },
  "requiredAgents": ["codenames of agents who need to help"],
  "estimatedEffort": "low|medium|high"
}

If you don't see a clear opportunity worth proposing, respond: {"skip": true}`,
          },
        ],
        responseFormat: "json",
        temperature: 0.4,
      });

      const parsed = JSON.parse(response.content);
      if (parsed.skip) return null;

      const [initiative] = await db.insert(agentInitiatives).values({
        proposedBy: agentCodename,
        title: parsed.title,
        thesis: parsed.thesis,
        evidence: parsed.evidence || [],
        projectedImpact: parsed.projectedImpact,
        requiredAgents: parsed.requiredAgents || [],
        estimatedEffort: parsed.estimatedEffort || "medium",
        status: "proposed",
      }).returning({ id: agentInitiatives.id });

      return initiative.id;
    } catch {
      return null;
    }
  }

  /** Generate initiatives from all agents (run weekly) */
  async generateAllInitiatives(): Promise<number[]> {
    const agents = await companyAgentService.getAll();
    const generated: number[] = [];

    for (const agent of agents) {
      // Only agents with trust > 60 can propose initiatives
      if (agent.trustScore < 60) continue;

      const id = await this.generateInitiative(agent.codename);
      if (id) generated.push(id);
    }

    return generated;
  }

  /** CEO approves an initiative */
  async approve(initiativeId: number, ceoNotes?: string): Promise<void> {
    await db.update(agentInitiatives)
      .set({
        status: "approved",
        ceoNotes,
        votedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentInitiatives.id, initiativeId));
  }

  /** CEO rejects an initiative */
  async reject(initiativeId: number, ceoNotes?: string): Promise<void> {
    await db.update(agentInitiatives)
      .set({
        status: "rejected",
        ceoNotes,
        votedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentInitiatives.id, initiativeId));
  }

  /** CEO shelves for later */
  async shelve(initiativeId: number, ceoNotes?: string): Promise<void> {
    await db.update(agentInitiatives)
      .set({
        status: "shelved",
        ceoNotes,
        votedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentInitiatives.id, initiativeId));
  }

  /** Get all pending proposals */
  async getPending(): Promise<AgentInitiative[]> {
    return db.query.agentInitiatives.findMany({
      where: eq(agentInitiatives.status, "proposed"),
      orderBy: [desc(agentInitiatives.createdAt)],
    });
  }

  /** Get all initiatives with optional status filter */
  async getAll(status?: string): Promise<AgentInitiative[]> {
    const where = status ? eq(agentInitiatives.status, status) : undefined;
    return db.query.agentInitiatives.findMany({
      where,
      orderBy: [desc(agentInitiatives.createdAt)],
      limit: 50,
    });
  }

  /** Get initiative by ID */
  async getById(id: number): Promise<AgentInitiative | undefined> {
    return db.query.agentInitiatives.findFirst({
      where: eq(agentInitiatives.id, id),
    });
  }

  /** Get count of pending initiatives */
  async getPendingCount(): Promise<number> {
    const [result] = await db.select({ n: count() })
      .from(agentInitiatives)
      .where(eq(agentInitiatives.status, "proposed"));
    return Number(result?.n || 0);
  }
}

export const agentInitiativeService = new AgentInitiativeService();
