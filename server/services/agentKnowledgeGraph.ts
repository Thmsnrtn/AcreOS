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
import { logger } from "../utils/logger";
import { SYSTEM_ORG_ID } from "@shared/tenancy/systemOrg";

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
        // `agent_memory.organization_id` is NOT NULL with a foreign key. This
        // insert used to omit it entirely and pass `as any` to silence the type
        // error — so EVERY insert violated the constraint, threw, and was
        // swallowed by the catch below as "already shared". This function had
        // never shared a single piece of knowledge, and said nothing about it.
        organizationId: SYSTEM_ORG_ID,
        agentType: recipient,
        memoryType: "fact",
        key: `shared:${params.fromAgent}:${params.topic}`,
        // `value` is the jsonb payload column and is NOT NULL. This insert used
        // to write `content`, which IS NOT A COLUMN ON THIS TABLE, and omit
        // both `value` and `organization_id` — three violations at once, all
        // silenced by an `as any` and swallowed by the catch below as "already
        // shared". This function had never written a row.
        value: {
          from: params.fromAgent,
          topic: params.topic,
          content: params.content,
        },
        confidence: (params.confidence * 0.8).toFixed(2), // Slightly lower confidence for shared knowledge
        usageCount: 0,
      });
      sharedWith.push(recipient);
    } catch (err) {
      // The old comment here claimed a duplicate key. There is no unique
      // constraint on `agent_memory` — nothing could ever raise one — so that
      // comment described an error that cannot happen while hiding three that
      // did. A failure is now reported.
      logger.warn(
        `[KnowledgeGraph] share to ${recipient} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  if (sharedWith.length > 0) {
    logger.info(`[KnowledgeGraph] ${params.fromAgent} shared "${params.topic}" with ${sharedWith.join(", ")}`);
  }

  return { sharedWith };
}

/**
 * Get all knowledge available to an agent (own + shared from others).
 * Used to build the agent's context for AI calls.
 *
 * ORG-SCOPED, and this was a real hole rather than a hypothetical one. Both
 * queries filtered on `agent_type` ALONE, over a table whose
 * `organization_id` is NOT NULL — so they returned EVERY organization's
 * memories for that agent codename, and the docstring says the result becomes
 * "the agent's context for AI calls". One customer's campaign results, lead
 * quality signals and content performance would have entered another
 * customer's agent prompt.
 *
 * It has no production caller today, which is the only reason this was a latent
 * leak rather than a live one — and exactly why it is worth closing now: the
 * next person to wire it would have inherited the bug silently.
 *
 * `organizationId` is REQUIRED, not defaulted. A default would let a caller
 * omit it and get the platform's own rows back while believing they had asked
 * for a customer's — the failure mode this parameter exists to prevent.
 */
export async function getAgentKnowledge(
  organizationId: number,
  agentCodename: string,
  limit = 20,
): Promise<{
  ownMemories: any[];
  sharedKnowledge: any[];
}> {
  // Own memories
  const ownMemories = await db.select()
    .from(agentMemory)
    .where(and(
      eq(agentMemory.organizationId, organizationId),
      eq(agentMemory.agentType, agentCodename),
      sql`${agentMemory.key} NOT LIKE 'shared:%'`,
    ))
    .orderBy(desc(agentMemory.lastUsedAt))
    .limit(limit);

  // Shared knowledge from other agents
  const sharedKnowledge = await db.select()
    .from(agentMemory)
    .where(and(
      eq(agentMemory.organizationId, organizationId),
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
  // These are AcreOS's OWN company agents (beacon_marketing, sophie_csm,
  // forge_revenue, shield_legal), so their shared memory is platform-plane.
  // Named explicitly rather than defaulted inside getAgentKnowledge, so a
  // customer-plane caller cannot get these rows back by omitting an argument.
  const { sharedKnowledge } = await getAgentKnowledge(SYSTEM_ORG_ID, agentCodename, 10);

  if (sharedKnowledge.length === 0) return "";

  // `m.content` — the column that does not exist. Every line of this prompt
  // section would have read "- undefined" had any row ever been written, which
  // no row ever was: the writer violated three NOT NULL constraints on every
  // call and swallowed the error. The payload lives in `value` (jsonb).
  const lines = sharedKnowledge
    .map((m) => {
      const v = (m.value ?? {}) as { from?: string; topic?: string; content?: string };
      if (!v.content) return null;
      return v.from ? `- [${v.from}] ${v.content}` : `- ${v.content}`;
    })
    .filter((l): l is string => l !== null);

  // Refuse to emit an empty section rather than a header with nothing under it —
  // a prompt that announces TEAM INTELLIGENCE and then lists nothing invites the
  // model to fill the gap.
  if (lines.length === 0) return "";

  return `\n--- TEAM INTELLIGENCE ---\nInsights shared by your teammates:\n${lines.join("\n")}\n`;
}

/**
 * Get the sharing rules for display in the admin UI.
 */
export function getSharingRules() {
  return SHARING_RULES;
}
