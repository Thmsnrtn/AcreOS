/**
 * Scenario Engine — Sovereign Company Protocol v7
 *
 * "What if we raise prices 20%?"
 *
 * The system runs a coordinated simulation across every relevant agent:
 * - Forge models revenue impact
 * - Sophie models churn response
 * - Oracle analyzes historical elasticity
 * - Beacon drafts messaging pivots
 * - Ledger models cashflow impact
 *
 * Returns a unified scenario card with best/median/worst outcomes
 * and a concrete recommendation. The CEO's strategy simulation lab.
 */

import { db } from "../db";
import { scenarioSimulations, type ScenarioSimulation } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { resolveAgentData } from "./agentDataResolvers";
import { logger } from "../utils/logger";

// ─── Agent Perspectives by Scenario Type ─────────────────────────────────────

const SCENARIO_AGENTS: Record<string, Array<{ agentCodename: string; perspective: string }>> = {
  pricing: [
    { agentCodename: "forge_revenue", perspective: "revenue_impact" },
    { agentCodename: "sophie_csm", perspective: "churn_risk" },
    { agentCodename: "oracle_analytics", perspective: "historical_elasticity" },
    { agentCodename: "beacon_marketing", perspective: "messaging_strategy" },
    { agentCodename: "ledger_finance", perspective: "cashflow_impact" },
  ],
  feature: [
    { agentCodename: "compass_pm", perspective: "product_strategy" },
    { agentCodename: "atlas_cto", perspective: "technical_feasibility" },
    { agentCodename: "crucible_qa", perspective: "quality_risk" },
    { agentCodename: "sophie_csm", perspective: "customer_demand" },
    { agentCodename: "forge_revenue", perspective: "revenue_potential" },
  ],
  expansion: [
    { agentCodename: "forge_revenue", perspective: "market_sizing" },
    { agentCodename: "oracle_analytics", perspective: "competitive_landscape" },
    { agentCodename: "beacon_marketing", perspective: "go_to_market" },
    { agentCodename: "ledger_finance", perspective: "investment_required" },
    { agentCodename: "shield_legal", perspective: "compliance_risk" },
  ],
  cost_cut: [
    { agentCodename: "ledger_finance", perspective: "savings_analysis" },
    { agentCodename: "atlas_cto", perspective: "technical_impact" },
    { agentCodename: "sentinel_devops", perspective: "operational_risk" },
    { agentCodename: "sophie_csm", perspective: "service_quality_impact" },
    { agentCodename: "crucible_qa", perspective: "quality_risk" },
  ],
  hiring: [
    { agentCodename: "atlas_cto", perspective: "team_need" },
    { agentCodename: "ledger_finance", perspective: "budget_impact" },
    { agentCodename: "forge_revenue", perspective: "revenue_per_head" },
    { agentCodename: "compass_pm", perspective: "velocity_improvement" },
  ],
  default: [
    { agentCodename: "atlas_cto", perspective: "strategic_assessment" },
    { agentCodename: "forge_revenue", perspective: "revenue_impact" },
    { agentCodename: "oracle_analytics", perspective: "data_analysis" },
    { agentCodename: "ledger_finance", perspective: "financial_impact" },
    { agentCodename: "sophie_csm", perspective: "customer_impact" },
  ],
};

// ─── Service ─────────────────────────────────────────────────────────────────

class ScenarioEngineService {

  /** Run a scenario simulation */
  async simulate(hypothesis: string, scenarioType?: string): Promise<number> {
    // Classify the scenario type if not provided
    const type = scenarioType || await this.classifyScenario(hypothesis);
    const agents = SCENARIO_AGENTS[type] || SCENARIO_AGENTS.default;

    // Create the simulation record
    const [sim] = await db.insert(scenarioSimulations).values({
      title: hypothesis.slice(0, 100),
      hypothesis,
      status: "running",
      agentAnalyses: [],
      requestedBy: "ceo",
    }).returning({ id: scenarioSimulations.id });

    // Run analysis asynchronously
    this.runAnalysis(sim.id, hypothesis, agents).catch(err => {
      logger.error(`[ScenarioEngine] Simulation ${sim.id} failed`, err);
      db.update(scenarioSimulations)
        .set({ status: "failed" })
        .where(eq(scenarioSimulations.id, sim.id))
        .catch(() => {});
    });

    return sim.id;
  }

  /** Run the full multi-agent analysis */
  private async runAnalysis(
    simId: number,
    hypothesis: string,
    agents: Array<{ agentCodename: string; perspective: string }>,
  ): Promise<void> {
    const analyses: any[] = [];

    // Phase 1: Gather each agent's perspective
    for (const { agentCodename, perspective } of agents) {
      try {
        const agent = await companyAgentService.getByCodename(agentCodename);
        if (!agent) continue;

        const liveData = await resolveAgentData(agentCodename).catch(() => ({}));

        const response = await routeAITask({
          taskType: "scenario_analysis",
          complexity: TaskComplexity.MODERATE,
          messages: [
            {
              role: "system",
              content: `${agent.personalityPrompt}\n\nYou are analyzing a strategic scenario from your ${perspective} perspective. Be quantitative where possible. Use real numbers from the data provided. Be honest about uncertainty.`,
            },
            {
              role: "user",
              content: `Scenario: "${hypothesis}"

Your current data:
${JSON.stringify(liveData, null, 2)}

Analyze this from your ${perspective.replace(/_/g, " ")} perspective. Respond in JSON:
{
  "analysis": "2-3 sentence analysis from your perspective",
  "metrics": {
    "key_metric_name": estimated_value,
    "impact_percent": estimated_percent_change
  },
  "confidence": "low|medium|high",
  "risks": ["risk 1"],
  "opportunities": ["opportunity 1"]
}`,
            },
          ],
          responseFormat: "json",
          temperature: 0.3,
        });

        const parsed = JSON.parse(response.content);
        analyses.push({
          agentCodename,
          perspective,
          analysis: parsed.analysis,
          metrics: parsed.metrics || {},
          confidence: parsed.confidence || "medium",
          risks: parsed.risks || [],
          opportunities: parsed.opportunities || [],
        });

        // Save progress incrementally
        await db.update(scenarioSimulations)
          .set({ agentAnalyses: analyses })
          .where(eq(scenarioSimulations.id, simId));

      } catch {}
    }

    // Phase 2: Synthesize into best/median/worst scenarios
    const analysisText = analyses.map(a =>
      `${a.agentCodename} (${a.perspective}): ${a.analysis}\nMetrics: ${JSON.stringify(a.metrics)}\nConfidence: ${a.confidence}`
    ).join("\n\n");

    try {
      const synthesis = await routeAITask({
        taskType: "scenario_synthesis",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are synthesizing multiple agent analyses into a unified scenario assessment. Be specific with numbers. The CEO needs a clear recommendation.`,
          },
          {
            role: "user",
            content: `Scenario: "${hypothesis}"

Agent analyses:
${analysisText}

Synthesize into JSON:
{
  "scenarios": {
    "best": { "description": "1 sentence", "probability": 0.0-1.0, "metrics": { "mrr_change": number, "churn_change": number } },
    "median": { "description": "1 sentence", "probability": 0.0-1.0, "metrics": { "mrr_change": number, "churn_change": number } },
    "worst": { "description": "1 sentence", "probability": 0.0-1.0, "metrics": { "mrr_change": number, "churn_change": number } }
  },
  "recommendation": "2-3 sentence concrete recommendation. What should the CEO do?"
}`,
          },
        ],
        responseFormat: "json",
        temperature: 0.2,
      });

      const parsed = JSON.parse(synthesis.content);

      await db.update(scenarioSimulations)
        .set({
          agentAnalyses: analyses,
          scenarios: parsed.scenarios,
          recommendation: parsed.recommendation,
          status: "completed",
          completedAt: new Date(),
        })
        .where(eq(scenarioSimulations.id, simId));

    } catch {
      await db.update(scenarioSimulations)
        .set({ agentAnalyses: analyses, status: "completed", completedAt: new Date() })
        .where(eq(scenarioSimulations.id, simId));
    }
  }

  /** Classify what type of scenario this is */
  private async classifyScenario(hypothesis: string): Promise<string> {
    const lower = hypothesis.toLowerCase();
    if (/price|pricing|raise|lower|discount|cost.*customer/i.test(lower)) return "pricing";
    if (/feature|build|ship|launch|release/i.test(lower)) return "feature";
    if (/expand|new market|geo|international/i.test(lower)) return "expansion";
    if (/cut|reduce|save|eliminate|downsize/i.test(lower)) return "cost_cut";
    if (/hire|recruit|team|headcount/i.test(lower)) return "hiring";
    return "default";
  }

  /** Get a simulation by ID */
  async getById(id: number): Promise<ScenarioSimulation | undefined> {
    return db.query.scenarioSimulations.findFirst({
      where: eq(scenarioSimulations.id, id),
    });
  }

  /** Get recent simulations */
  async getRecent(limit = 10): Promise<ScenarioSimulation[]> {
    return db.query.scenarioSimulations.findMany({
      orderBy: [desc(scenarioSimulations.createdAt)],
      limit,
    });
  }
}

export const scenarioEngineService = new ScenarioEngineService();
