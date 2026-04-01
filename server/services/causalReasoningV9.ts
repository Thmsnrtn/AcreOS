/**
 * Causal Reasoning Engine — Sovereign Company Protocol v9: The Self-Running Company
 *
 * Upgrade from "X correlates with Y" to "X probably caused Y, here's the evidence chain."
 *
 * When Oracle detects an anomaly, instead of just flagging it, the engine runs
 * a full causal investigation:
 *
 * 1. TIMELINE: What changed in the 7 days before the anomaly?
 * 2. ISOLATION: Is the anomaly across all cohorts or specific segments?
 * 3. COUNTERFACTUAL: What would we expect if nothing had changed?
 * 4. HYPOTHESIS: Ranked list of probable causes
 * 5. TEST PROPOSAL: How to confirm the root cause
 *
 * The CEO doesn't get "metric dropped" — they get "metric dropped, here's
 * probably why, and here's how we confirm."
 */

import { db } from "../db";
import {
  causalInvestigations,
  agentActionLog,
  type CausalInvestigation,
} from "@shared/schema";
import { eq, desc, gte, and, count, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { resolveAgentData } from "./agentDataResolvers";
import { companyAgentService } from "./companyAgents";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimelineEvent {
  timestamp: string;
  source: string;       // agent or system
  eventType: string;    // "deployment" | "config_change" | "playbook_execution" | "external"
  description: string;
}

interface Hypothesis {
  rank: number;
  cause: string;
  probability: string;   // "high" | "medium" | "low"
  evidence: string[];
  affectedSegment: string;
  testProposal: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class CausalReasoningService {

  /**
   * Launch a causal investigation for a detected anomaly.
   * This is the main entry point — Oracle or any agent can trigger this.
   */
  async investigate(input: {
    anomalyType: string;           // "metric_drop" | "metric_spike" | "pattern_break"
    metric: string;                // which metric
    currentValue: number;
    expectedValue: number;
    detectedBy: string;            // agent codename
    additionalContext?: Record<string, any>;
  }): Promise<number> {
    const deviation = input.expectedValue !== 0
      ? Math.round(((input.currentValue - input.expectedValue) / input.expectedValue) * 100)
      : 0;

    // Step 1: Build timeline of recent changes
    const timeline = await this.buildTimeline();

    // Step 2: Gather cross-agent context
    const crossAgentData = await this.gatherCrossAgentContext();

    // Step 3: AI-powered causal analysis
    const analysis = await this.runCausalAnalysis({
      ...input,
      deviation,
      timeline,
      crossAgentData,
    });

    // Step 4: Store the investigation
    const [investigation] = await db.insert(causalInvestigations).values({
      anomalyType: input.anomalyType,
      metric: input.metric,
      currentValue: input.currentValue.toString(),
      expectedValue: input.expectedValue.toString(),
      deviationPercent: deviation,
      detectedBy: input.detectedBy,
      timeline: timeline,
      hypotheses: analysis.hypotheses,
      primaryCause: analysis.primaryCause,
      primaryCauseProbability: analysis.primaryCauseProbability,
      testProposal: analysis.testProposal,
      affectedSegments: analysis.affectedSegments,
      status: "open",
    }).returning({ id: causalInvestigations.id });

    return investigation.id;
  }

  /**
   * Build a timeline of what changed in the last 7 days.
   * Queries agent action logs, deployments, config changes, etc.
   */
  private async buildTimeline(): Promise<TimelineEvent[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const events: TimelineEvent[] = [];

    // Get significant agent actions (not routine ones)
    const significantActions = await db.select()
      .from(agentActionLog)
      .where(and(
        gte(agentActionLog.createdAt, sevenDaysAgo),
        sql`${agentActionLog.actionType} IN ('proactive', 'reaction', 'decision')`,
      ))
      .orderBy(desc(agentActionLog.createdAt))
      .limit(30);

    for (const action of significantActions) {
      events.push({
        timestamp: action.createdAt.toISOString(),
        source: action.agentCodename,
        eventType: action.actionType || "action",
        description: `${action.agentCodename}: ${action.actionName} — ${action.reasoning || "no reasoning recorded"}`,
      });
    }

    // Sort by timestamp
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return events;
  }

  /**
   * Gather context from multiple agents to enrich the investigation.
   */
  private async gatherCrossAgentContext(): Promise<Record<string, any>> {
    const agents = ["forge_revenue", "sophie_csm", "oracle_analytics", "sentinel_devops", "beacon_marketing"];
    const context: Record<string, any> = {};

    await Promise.all(agents.map(async (codename) => {
      try {
        context[codename] = await resolveAgentData(codename);
      } catch {
        context[codename] = {};
      }
    }));

    return context;
  }

  /**
   * Run the AI-powered causal analysis.
   * This is the core reasoning step that produces hypotheses.
   */
  private async runCausalAnalysis(input: {
    anomalyType: string;
    metric: string;
    currentValue: number;
    expectedValue: number;
    deviation: number;
    timeline: TimelineEvent[];
    crossAgentData: Record<string, any>;
    additionalContext?: Record<string, any>;
  }): Promise<{
    primaryCause: string;
    primaryCauseProbability: string;
    hypotheses: Hypothesis[];
    testProposal: string;
    affectedSegments: string[];
  }> {
    try {
      const response = await routeAITask({
        taskType: "causal_analysis",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are a causal reasoning engine for a SaaS business. An anomaly has been detected and you need to diagnose its probable cause.

Your process:
1. TIMELINE ANALYSIS: What changed in the 7 days before the anomaly? Deployments, config changes, agent actions, external events?
2. SEGMENT ISOLATION: Is the anomaly across all users/segments, or specific ones? This narrows the cause.
3. COUNTERFACTUAL: What would the metric be if nothing had changed? Is this a natural fluctuation or a real anomaly?
4. HYPOTHESIS RANKING: Rank 2-4 probable causes by likelihood. For each: what's the evidence? What segment is affected?
5. TEST PROPOSAL: How can the CEO confirm the root cause? (A/B test, data query, revert, etc.)

Be specific. Use data. Don't speculate without evidence.`,
          },
          {
            role: "user",
            content: `ANOMALY DETECTED:
Metric: ${input.metric}
Current value: ${input.currentValue}
Expected value: ${input.expectedValue}
Deviation: ${input.deviation}%
Type: ${input.anomalyType}

TIMELINE (last 7 days):
${input.timeline.map(e => `  [${e.timestamp}] ${e.source}: ${e.description}`).join("\n") || "  No significant events recorded"}

CROSS-AGENT CONTEXT:
${Object.entries(input.crossAgentData).map(([agent, data]) =>
  `  ${agent}: ${JSON.stringify(data, null, 2).slice(0, 300)}`
).join("\n")}

${input.additionalContext ? `ADDITIONAL CONTEXT:\n${JSON.stringify(input.additionalContext, null, 2)}` : ""}

Produce your causal analysis. Respond in JSON:
{
  "primaryCause": "Most likely cause in one sentence",
  "primaryCauseProbability": "high|medium|low",
  "hypotheses": [
    {
      "rank": 1,
      "cause": "Specific cause description",
      "probability": "high|medium|low",
      "evidence": ["evidence point 1", "evidence point 2"],
      "affectedSegment": "all|new_users|existing_users|specific_plan|etc",
      "testProposal": "How to confirm this cause"
    }
  ],
  "testProposal": "Recommended next step to confirm root cause",
  "affectedSegments": ["all", "new_users", etc]
}`,
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.3,
      });

      const parsed = JSON.parse(response.content);
      return {
        primaryCause: parsed.primaryCause || "Unable to determine",
        primaryCauseProbability: parsed.primaryCauseProbability || "low",
        hypotheses: parsed.hypotheses || [],
        testProposal: parsed.testProposal || "Gather more data before acting",
        affectedSegments: parsed.affectedSegments || ["unknown"],
      };
    } catch {
      return {
        primaryCause: "Analysis failed — insufficient data",
        primaryCauseProbability: "low",
        hypotheses: [],
        testProposal: "Manual investigation needed",
        affectedSegments: ["unknown"],
      };
    }
  }

  /**
   * CEO marks investigation as resolved with the confirmed cause.
   */
  async resolve(investigationId: number, confirmedCause: string, actionTaken?: string): Promise<void> {
    await db.update(causalInvestigations)
      .set({
        status: "resolved",
        confirmedCause,
        actionTaken,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(causalInvestigations.id, investigationId));
  }

  /**
   * CEO dismisses investigation (false alarm or not actionable).
   */
  async dismiss(investigationId: number, reason?: string): Promise<void> {
    await db.update(causalInvestigations)
      .set({
        status: "dismissed",
        confirmedCause: reason || "Dismissed — not actionable",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(causalInvestigations.id, investigationId));
  }

  /** Get open investigations */
  async getOpen(): Promise<CausalInvestigation[]> {
    return db.query.causalInvestigations.findMany({
      where: eq(causalInvestigations.status, "open"),
      orderBy: [desc(causalInvestigations.createdAt)],
    });
  }

  /** Get recent investigations */
  async getRecent(limit = 10): Promise<CausalInvestigation[]> {
    return db.query.causalInvestigations.findMany({
      orderBy: [desc(causalInvestigations.createdAt)],
      limit,
    });
  }

  /** Get investigation by ID */
  async getById(id: number): Promise<CausalInvestigation | undefined> {
    return db.query.causalInvestigations.findFirst({
      where: eq(causalInvestigations.id, id),
    });
  }
}

export const causalReasoningService = new CausalReasoningService();
