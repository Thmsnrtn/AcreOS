/**
 * Institutional Memory — Sovereign Company Protocol v7
 *
 * The compound playbook. Every execution makes the system smarter.
 *
 * When a playbook runs: note the context (customer type, time of year,
 * metrics before). When it succeeds or fails: same thing. Over time:
 *
 * "Churn rescue works 80% for customers in months 3-6, but only 30%
 * for customers past month 12. For late-stage churn, switch to
 * feature-unlock strategy instead of discounts."
 *
 * Cross-agent signal correlation:
 * "When Oracle flags revenue dip AND Sophie sees support spike in
 * the same week, churn follows 70% within 14 days. Pre-emptively
 * triggering retention playbook."
 *
 * Institutional knowledge that survives people leaving. It compounds.
 */

import { db } from "../db";
import {
  institutionalPatterns, signalCorrelations,
  type InstitutionalPattern, type SignalCorrelation,
} from "@shared/schema";
import { eq, desc, gte, and, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";

// ─── Service ─────────────────────────────────────────────────────────────────

class InstitutionalMemoryService {

  /** Record an outcome for a pattern — learn from success or failure */
  async recordOutcome(input: {
    patternName: string;
    response: string;       // what was done
    success: boolean;
    context: {
      customerAge?: string;
      dealSize?: string;
      season?: string;
      churnRisk?: string;
    };
    contributingAgents: string[];
  }): Promise<void> {
    // Find or create the pattern
    let pattern = await db.query.institutionalPatterns.findFirst({
      where: eq(institutionalPatterns.patternName, input.patternName),
    });

    if (!pattern) {
      await db.insert(institutionalPatterns).values({
        patternName: input.patternName,
        description: `Pattern learned from ${input.patternName.replace(/_/g, " ")}`,
        triggerSignals: [],
        effectiveResponse: input.success ? input.response : "",
        ineffectiveResponse: input.success ? "" : input.response,
        contextConditions: input.context,
        successRate: input.success ? "1.0" : "0.0",
        sampleSize: 1,
        lastTriggered: new Date(),
        contributingAgents: input.contributingAgents,
      });
      return;
    }

    // Update existing pattern with new observation
    const newSampleSize = (pattern.sampleSize || 0) + 1;
    const oldRate = Number(pattern.successRate || 0);
    const newRate = ((oldRate * (newSampleSize - 1)) + (input.success ? 1 : 0)) / newSampleSize;

    const updates: any = {
      sampleSize: newSampleSize,
      successRate: newRate.toFixed(3),
      lastTriggered: new Date(),
      updatedAt: new Date(),
    };

    if (input.success && input.response) {
      updates.effectiveResponse = input.response;
    }
    if (!input.success && input.response) {
      updates.ineffectiveResponse = input.response;
    }

    // Merge contributing agents
    const existingAgents = (pattern.contributingAgents as string[]) || [];
    const allAgents = [...new Set([...existingAgents, ...input.contributingAgents])];
    updates.contributingAgents = allAgents;

    await db.update(institutionalPatterns)
      .set(updates)
      .where(eq(institutionalPatterns.id, pattern.id));
  }

  /** Record a signal for cross-agent correlation tracking */
  async recordSignal(agentCodename: string, signalName: string): Promise<void> {
    const signal = `${agentCodename}:${signalName}`;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find recent signals from OTHER agents (within 1 hour)
    // to detect co-occurrence
    const recentCorrelations = await db.query.signalCorrelations.findMany({
      where: gte(signalCorrelations.lastObserved, oneHourAgo),
    });

    // Also track new co-occurrences with any existing signal A
    const allCorrelations = await db.query.signalCorrelations.findMany();
    for (const existing of allCorrelations) {
      if (existing.signalB === signal || existing.signalA === signal) {
        // Strengthen this correlation
        await db.update(signalCorrelations)
          .set({
            observationCount: (existing.observationCount || 0) + 1,
            lastObserved: new Date(),
            correlation: Math.min(0.99,
              Number(existing.correlation || 0) + (1 - Number(existing.correlation || 0)) * 0.1
            ).toFixed(3),
          })
          .where(eq(signalCorrelations.id, existing.id));
      }
    }
  }

  /** Register a new cross-agent signal correlation */
  async registerCorrelation(input: {
    signalA: string;
    signalB: string;
    predictedOutcome: string;
    autoTriggerPlaybookId?: number;
  }): Promise<number> {
    const [correlation] = await db.insert(signalCorrelations).values({
      signalA: input.signalA,
      signalB: input.signalB,
      predictedOutcome: input.predictedOutcome,
      correlation: "0.5",
      observationCount: 1,
      lastObserved: new Date(),
      autoTriggerPlaybookId: input.autoTriggerPlaybookId,
    }).returning({ id: signalCorrelations.id });

    return correlation.id;
  }

  /** Check if current signals match any known correlation — trigger playbook if so */
  async checkCorrelationTriggers(currentSignals: string[]): Promise<Array<{
    correlationId: number;
    predictedOutcome: string;
    correlation: number;
    playbookId: number | null;
  }>> {
    const triggers: any[] = [];

    const allCorrelations = await db.query.signalCorrelations.findMany({
      orderBy: [desc(signalCorrelations.correlation)],
    });

    for (const corr of allCorrelations) {
      if (Number(corr.correlation || 0) < 0.6) continue; // Only act on strong correlations

      const hasA = currentSignals.includes(corr.signalA);
      const hasB = currentSignals.includes(corr.signalB);

      if (hasA && hasB) {
        triggers.push({
          correlationId: corr.id,
          predictedOutcome: corr.predictedOutcome,
          correlation: Number(corr.correlation),
          playbookId: corr.autoTriggerPlaybookId,
        });
      }
    }

    return triggers;
  }

  /** AI-powered pattern discovery — analyze action logs to find new patterns */
  async discoverPatterns(): Promise<number> {
    const existingPatterns = await this.getPatterns();
    const existingNames = existingPatterns.map(p => p.patternName);

    try {
      const response = await routeAITask({
        taskType: "pattern_discovery",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are analyzing operational patterns to discover reusable institutional knowledge. Look for recurring sequences, context-dependent strategies, and cross-agent signal correlations.`,
          },
          {
            role: "user",
            content: `Existing patterns: ${existingNames.join(", ") || "none"}

Based on common SaaS/land-investment operational patterns, suggest 3-5 new institutional patterns that should be tracked. Consider:
- When do churn prevention strategies work vs. fail?
- When do payment recovery approaches succeed?
- What customer profile signals predict different outcomes?
- What agent combinations are most effective for different situations?

Respond in JSON:
{
  "patterns": [
    {
      "patternName": "snake_case_name",
      "description": "What this pattern captures",
      "triggerSignals": [{ "agentCodename": "name", "signal": "signal_name" }],
      "effectiveResponse": "What works",
      "contextConditions": { "customerAge": "0-3m|3-12m|12m+", "churnRisk": "low|medium|high" }
    }
  ],
  "correlations": [
    {
      "signalA": "agent:signal",
      "signalB": "agent:signal",
      "predictedOutcome": "what happens when both fire"
    }
  ]
}`,
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.4,
      });

      const parsed = JSON.parse(response.content);
      let created = 0;

      // Create new patterns
      for (const p of (parsed.patterns || [])) {
        if (existingNames.includes(p.patternName)) continue;

        await db.insert(institutionalPatterns).values({
          patternName: p.patternName,
          description: p.description,
          triggerSignals: p.triggerSignals || [],
          effectiveResponse: p.effectiveResponse || "",
          contextConditions: p.contextConditions || {},
          successRate: "0.5",
          sampleSize: 0,
          contributingAgents: (p.triggerSignals || []).map((s: any) => s.agentCodename),
        });
        created++;
      }

      // Create new correlations
      for (const c of (parsed.correlations || [])) {
        const existing = await db.query.signalCorrelations.findFirst({
          where: and(
            eq(signalCorrelations.signalA, c.signalA),
            eq(signalCorrelations.signalB, c.signalB),
          ),
        });
        if (!existing) {
          await this.registerCorrelation(c);
          created++;
        }
      }

      return created;
    } catch {
      return 0;
    }
  }

  /** Get all institutional patterns */
  async getPatterns(): Promise<InstitutionalPattern[]> {
    return db.query.institutionalPatterns.findMany({
      orderBy: [desc(institutionalPatterns.successRate)],
    });
  }

  /** Get all signal correlations */
  async getCorrelations(): Promise<SignalCorrelation[]> {
    return db.query.signalCorrelations.findMany({
      orderBy: [desc(signalCorrelations.correlation)],
    });
  }

  /** Get the best response for a given context */
  async getBestResponse(patternName: string, context?: Record<string, any>): Promise<{
    response: string;
    confidence: number;
    sampleSize: number;
  } | null> {
    const pattern = await db.query.institutionalPatterns.findFirst({
      where: eq(institutionalPatterns.patternName, patternName),
    });

    if (!pattern || !pattern.effectiveResponse) return null;

    return {
      response: pattern.effectiveResponse,
      confidence: Number(pattern.successRate || 0),
      sampleSize: pattern.sampleSize || 0,
    };
  }
}

export const institutionalMemoryService = new InstitutionalMemoryService();
