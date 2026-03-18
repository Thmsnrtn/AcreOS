// @ts-nocheck
/**
 * Agent Knowledge Graph — Sovereign Company Protocol v4
 *
 * Cross-agent intelligence sharing. When Sophie discovers customers
 * are struggling with imports, Atlas learns there's a UX issue.
 * When Forge sees churn signals, Sophie already has context.
 *
 * Built on top of the existing agentMemory table — adds a sharing layer.
 */

import { db } from "../db";
import { agentMemory } from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

// Knowledge sharing rules: who shares what with whom
const SHARING_RULES: Record<string, { recipients: string[]; topics: string[] }> = {
  sophie_csm: {
    recipients: ["atlas_cto", "compass_pm", "forge_revenue"],
    topics: ["customer_pain", "feature_request", "usability_issue", "churn_signal"],
  },
  forge_revenue: {
    recipients: ["sophie_csm", "beacon_marketing", "ledger_finance"],
    topics: ["churn_risk", "revenue_signal", "pricing_feedback", "upsell_opportunity"],
  },
  sentinel_devops: {
    recipients: ["atlas_cto", "crucible_qa"],
    topics: ["system_failure", "performance_issue", "infrastructure_pattern"],
  },
  oracle_analytics: {
    recipients: ["compass_pm", "forge_revenue", "beacon_marketing", "sophie_csm"],
    topics: ["metric_anomaly", "trend_shift", "correlation_found", "growth_signal"],
  },
  atlas_cto: {
    recipients: ["sentinel_devops", "crucible_qa", "compass_pm"],
    topics: ["architecture_decision", "tech_debt", "system_change"],
  },
  beacon_marketing: {
    recipients: ["forge_revenue", "sophie_csm"],
    topics: ["campaign_result", "lead_quality_signal", "content_performance"],
  },
  shield_legal: {
    recipients: ["beacon_marketing", "sophie_csm", "forge_revenue"],
    topics: ["compliance_update", "regulatory_change", "risk_flag"],
  },
};

/**
 * Share a piece of knowledge from one agent to its configured recipients.
 * Stores a copy of the memory tagged with the sharing source.
 */
export async function shareKnowledge(params: {
  fromAgent: string;
  topic: string;
  content: string;
  confidence: number;
}): Promise<{ sharedWith: string[] }> {
  const rules = SHARING_RULES[params.fromAgent];
  if (!rules) return { sharedWith: [] };

  // Check if this topic matches any sharing rules
  const topicMatch = rules.topics.some(t => params.topic.includes(t) || params.content.toLowerCase().includes(t.replace(/_/g, " ")));
  if (!topicMatch) return { sharedWith: [] };

  const sharedWith: string[] = [];

  for (const recipient of rules.recipients) {
    try {
      await db.insert(agentMemory).values({
        agentType: recipient,
        memoryType: "fact",
        key: `shared:${params.fromAgent}:${params.topic}`,
        content: `[From ${params.fromAgent}] ${params.content}`,
        confidence: (params.confidence * 0.8).toFixed(2), // Slightly lower confidence for shared knowledge
        usageCount: 0,
      } as any);
      sharedWith.push(recipient);
    } catch {
      // Duplicate key — knowledge already shared
    }
  }

  if (sharedWith.length > 0) {
    console.log(`[KnowledgeGraph] ${params.fromAgent} shared "${params.topic}" with ${sharedWith.join(", ")}`);
  }

  return { sharedWith };
}

/**
 * Get all knowledge available to an agent (own + shared from others).
 * Used to build the agent's context for AI calls.
 */
export async function getAgentKnowledge(agentCodename: string, limit = 20): Promise<{
  ownMemories: any[];
  sharedKnowledge: any[];
}> {
  // Own memories
  const ownMemories = await db.select()
    .from(agentMemory)
    .where(and(
      eq(agentMemory.agentType, agentCodename),
      sql`${agentMemory.key} NOT LIKE 'shared:%'`,
    ))
    .orderBy(desc(agentMemory.lastUsedAt))
    .limit(limit);

  // Shared knowledge from other agents
  const sharedKnowledge = await db.select()
    .from(agentMemory)
    .where(and(
      eq(agentMemory.agentType, agentCodename),
      sql`${agentMemory.key} LIKE 'shared:%'`,
    ))
    .orderBy(desc(agentMemory.createdAt))
    .limit(limit);

  return { ownMemories, sharedKnowledge };
}

/**
 * Format shared knowledge into a prompt section for an agent.
 */
export async function getSharedKnowledgeForPrompt(agentCodename: string): Promise<string> {
  const { sharedKnowledge } = await getAgentKnowledge(agentCodename, 10);

  if (sharedKnowledge.length === 0) return "";

  const lines = sharedKnowledge.map(m => `- ${m.content}`);

  return `\n--- TEAM INTELLIGENCE ---\nInsights shared by your teammates:\n${lines.join("\n")}\n`;
}

/**
 * Get the sharing rules for display in the admin UI.
 */
export function getSharingRules() {
  return SHARING_RULES;
}
