/**
 * Scenario War Room — Sovereign Company Protocol v10: The Conscious Organization
 *
 * Multi-agent "what if?" simulation engine.
 *
 * CEO asks: "What happens if we raise prices 20%?"
 * Every agent models the impact from their domain simultaneously:
 * - Forge: Revenue projection
 * - Sophie: Customer sentiment & support ticket prediction
 * - Beacon: Competitive positioning
 * - Ledger: Margin impact & runway
 * - Shield: Contractual implications
 * - Oracle: Historical comparison
 *
 * Returns a unified multi-perspective simulation with confidence intervals
 * and a recommended approach — before making any real change.
 */

import { db } from "../db";
import {
  scenarioSimulations, scenarioOutcomeComparisons,
  type ScenarioSimulation, type ScenarioOutcomeComparison,
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { resolveAgentData } from "./agentDataResolvers";
import { logger } from "../utils/logger";

// ─── Agent Domain Mapping ──────────────────────────────────────────────────

const SCENARIO_DOMAINS: Record<string, {
  domain: string;
  focusAreas: string[];
}> = {
  forge_revenue: {
    domain: "Revenue & Sales",
    focusAreas: ["revenue projection", "deal pipeline impact", "conversion rate changes", "MRR/ARR forecast"],
  },
  sophie_support: {
    domain: "Customer Success & Support",
    focusAreas: ["customer sentiment", "support ticket volume", "churn prediction", "NPS impact"],
  },
  beacon_marketing: {
    domain: "Marketing & Positioning",
    focusAreas: ["competitive positioning", "messaging adjustment", "campaign effectiveness", "brand perception"],
  },
  ledger_finance: {
    domain: "Finance & Operations",
    focusAreas: ["margin impact", "runway change", "cost structure", "cash flow projection"],
  },
  shield_compliance: {
    domain: "Legal & Compliance",
    focusAreas: ["contractual implications", "regulatory risk", "existing customer obligations", "liability exposure"],
  },
  oracle_analytics: {
    domain: "Data & Analytics",
    focusAreas: ["historical comparison", "statistical modeling", "cohort analysis", "trend projection"],
  },
  atlas_market: {
    domain: "Market Intelligence",
    focusAreas: ["market conditions", "competitive landscape", "timing assessment", "external factors"],
  },
  pioneer_growth: {
    domain: "Growth & Expansion",
    focusAreas: ["growth trajectory", "acquisition cost impact", "expansion opportunities", "scaling considerations"],
  },
  sentinel_risk: {
    domain: "Risk Assessment",
    focusAreas: ["downside scenarios", "risk mitigation", "worst case analysis", "contingency planning"],
  },
  nexus_integration: {
    domain: "Systems & Integration",
    focusAreas: ["implementation complexity", "system dependencies", "integration requirements", "technical feasibility"],
  },
};

// ─── Service ───────────────────────────────────────────────────────────────

class ScenarioWarRoomService {

  /**
   * Launch a new scenario simulation — all agents model the impact concurrently.
   */
  async simulate(params: {
    title: string;
    scenarioType: string;
    hypothesis: string;
    parameters: Record<string, any>;
  }): Promise<ScenarioSimulation> {
    // Create the scenario record
    const [scenario] = await db.insert(scenarioSimulations).values({
      title: params.title,
      scenarioType: params.scenarioType,
      hypothesis: params.hypothesis,
      parameters: params.parameters,
      status: "running",
    }).returning();

    // Get all active agents
    const agents = await companyAgentService.getAll();

    // Run all agent projections concurrently
    const projectionPromises = agents.map(async (agent) => {
      const domainInfo = SCENARIO_DOMAINS[agent.codename] || {
        domain: agent.title || agent.codename,
        focusAreas: ["general impact assessment"],
      };

      try {
        // Get agent's domain data for context
        const domainData = await resolveAgentData(agent.codename);

        const prompt = `You are ${agent.codename} (${agent.title}), a specialized AI agent focused on ${domainInfo.domain}.

SCENARIO TO ANALYZE:
Title: ${params.title}
Type: ${params.scenarioType}
Hypothesis: ${params.hypothesis}
Parameters: ${JSON.stringify(params.parameters)}

YOUR DOMAIN DATA:
${JSON.stringify(domainData).slice(0, 3000)}

YOUR FOCUS AREAS: ${domainInfo.focusAreas.join(", ")}

Analyze this scenario STRICTLY from your domain perspective. Provide:
1. Your projection of what would happen (be specific with numbers where possible)
2. Your confidence level (0-100)
3. Key risks you foresee (2-4 specific risks)
4. Opportunities this creates (1-3 specific opportunities)

Respond in JSON:
{
  "projection": "Your detailed projection (2-3 sentences with specific numbers)",
  "confidence": 75,
  "risks": ["Risk 1", "Risk 2"],
  "opportunities": ["Opportunity 1"]
}`;

        const result = await routeAITask({
          task: prompt,
          complexity: TaskComplexity.MODERATE,
          responseFormat: "json",
        });

        const parsed = JSON.parse(result.response);
        return {
          agentCodename: agent.codename,
          domain: domainInfo.domain,
          projection: parsed.projection || "Unable to project",
          confidence: Math.min(100, Math.max(0, parsed.confidence || 50)),
          risks: parsed.risks || [],
          opportunities: parsed.opportunities || [],
        };
      } catch (err) {
        logger.error(`[WarRoom] ${agent.codename} projection failed`, err);
        return {
          agentCodename: agent.codename,
          domain: domainInfo.domain,
          projection: "Analysis unavailable — agent encountered an error",
          confidence: 0,
          risks: ["Unable to assess risks"],
          opportunities: [],
        };
      }
    });

    const projections = await Promise.all(projectionPromises);

    // Generate consensus synthesis
    const consensusPrompt = `You are the Scenario War Room synthesizer. ${projections.length} agents have modeled a scenario.

SCENARIO: ${params.title}
HYPOTHESIS: ${params.hypothesis}

AGENT PROJECTIONS:
${projections.map(p => `[${p.agentCodename} — ${p.domain}] (Confidence: ${p.confidence}%)
  Projection: ${p.projection}
  Risks: ${p.risks.join("; ")}
  Opportunities: ${p.opportunities.join("; ")}`).join("\n\n")}

Synthesize into:
1. A consensus summary (what most agents agree on, where they diverge)
2. A clear recommendation (proceed, proceed with modifications, delay, or abort)
3. Confidence interval: { low: pessimistic%, mid: expected%, high: optimistic% }

Respond in JSON:
{
  "summary": "Consensus summary here",
  "recommendation": "Clear recommendation here",
  "confidenceInterval": { "low": 30, "mid": 65, "high": 85 }
}`;

    try {
      const consensus = await routeAITask({
        task: consensusPrompt,
        complexity: TaskComplexity.COMPLEX,
        responseFormat: "json",
      });

      const parsed = JSON.parse(consensus.response);

      const [updated] = await db.update(scenarioSimulations)
        .set({
          agentProjections: projections,
          consensusSummary: parsed.summary,
          consensusRecommendation: parsed.recommendation,
          confidenceInterval: parsed.confidenceInterval || { low: 30, mid: 50, high: 70 },
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(scenarioSimulations.id, scenario.id))
        .returning();

      return updated;
    } catch (err) {
      // Still save projections even if consensus fails
      const [updated] = await db.update(scenarioSimulations)
        .set({
          agentProjections: projections,
          consensusSummary: "Consensus synthesis failed — review individual projections",
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(scenarioSimulations.id, scenario.id))
        .returning();

      return updated;
    }
  }

  /**
   * Compare a completed scenario's predictions against actual outcomes.
   */
  async compareOutcome(scenarioId: number, actualOutcome: Record<string, any>): Promise<ScenarioOutcomeComparison> {
    const [scenario] = await db.select().from(scenarioSimulations)
      .where(eq(scenarioSimulations.id, scenarioId)).limit(1);

    if (!scenario) throw new Error("Scenario not found");

    // AI-assess accuracy
    const prompt = `Compare these scenario predictions against actual outcomes:

SCENARIO: ${scenario.title}
PREDICTIONS: ${scenario.consensusSummary}
Agent Projections: ${JSON.stringify(scenario.agentProjections)}
ACTUAL OUTCOME: ${JSON.stringify(actualOutcome)}

Rate overall accuracy 0-100 and each agent's accuracy. Extract key lessons.

Respond in JSON:
{
  "accuracyScore": 65,
  "lessonsLearned": "Key lesson here",
  "agentAccuracy": [{ "agentCodename": "forge_revenue", "accuracy": 70 }]
}`;

    const result = await routeAITask({
      task: prompt,
      complexity: TaskComplexity.MODERATE,
      responseFormat: "json",
    });

    const parsed = JSON.parse(result.response);

    const [comparison] = await db.insert(scenarioOutcomeComparisons).values({
      scenarioId,
      predictedOutcome: {
        summary: scenario.consensusSummary,
        recommendation: scenario.consensusRecommendation,
        projections: scenario.agentProjections,
      },
      actualOutcome,
      accuracyScore: parsed.accuracyScore || 50,
      lessonsLearned: parsed.lessonsLearned,
      agentAccuracy: parsed.agentAccuracy || [],
    }).returning();

    return comparison;
  }

  async getById(id: number): Promise<ScenarioSimulation | null> {
    const [s] = await db.select().from(scenarioSimulations)
      .where(eq(scenarioSimulations.id, id)).limit(1);
    return s || null;
  }

  async getRecent(limit = 20): Promise<ScenarioSimulation[]> {
    return db.select().from(scenarioSimulations)
      .orderBy(desc(scenarioSimulations.createdAt))
      .limit(limit);
  }

  async getByType(type: string, limit = 10): Promise<ScenarioSimulation[]> {
    return db.select().from(scenarioSimulations)
      .where(eq(scenarioSimulations.scenarioType, type))
      .orderBy(desc(scenarioSimulations.createdAt))
      .limit(limit);
  }

  async getComparisons(scenarioId: number): Promise<ScenarioOutcomeComparison[]> {
    return db.select().from(scenarioOutcomeComparisons)
      .where(eq(scenarioOutcomeComparisons.scenarioId, scenarioId))
      .orderBy(desc(scenarioOutcomeComparisons.createdAt));
  }

  async archive(id: number): Promise<void> {
    await db.update(scenarioSimulations)
      .set({ status: "archived" })
      .where(eq(scenarioSimulations.id, id));
  }
}

export const scenarioWarRoomService = new ScenarioWarRoomService();
