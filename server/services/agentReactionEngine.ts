// @ts-nocheck
/**
 * Agent Reaction Engine — Sovereign Company Protocol v2
 *
 * When Agent A broadcasts to a channel, subscribed agents can automatically react.
 * Reactions are authority-gated — high-risk reactions require CEO approval.
 *
 * Examples:
 *   - Shield flags compliance issue → Beacon auto-pauses affected campaigns
 *   - Forge detects churn spike → Sophie auto-sends retention check-ins
 *   - Sentinel detects job failures → Atlas auto-restarts failed jobs
 *   - Oracle detects metric anomaly → Compass correlates with feature changes
 */

import { db } from "../db";
import { agentMessages } from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";
import { agentCommsService, type AgentChannel } from "./agentComms";
import { executeWithAuthority } from "./agentAuthorityGate";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReactionRule {
  id: string;
  channel: AgentChannel;
  subscriberAgent: string;
  /** Only react if this returns true */
  condition: (message: any) => boolean;
  /** The reaction to take */
  reaction: (message: any) => Promise<void>;
  /** Description for audit trail */
  description: string;
}

// ─── Built-in Reaction Rules ────────────────────────────────────────────────

const REACTION_RULES: ReactionRule[] = [
  {
    id: "shield_compliance_to_beacon",
    channel: "compliance_flags",
    subscriberAgent: "beacon_marketing",
    condition: (msg) => msg.priority === "critical" || msg.priority === "high",
    reaction: async (msg) => {
      await agentCommsService.broadcast({
        from: "beacon_marketing",
        channel: "content_pipeline",
        priority: "high",
        subject: `[Auto-reaction] Compliance flag detected — reviewing active campaigns`,
        body: `Shield flagged a compliance issue: "${msg.subject}". Beacon is reviewing affected campaigns for compliance alignment.`,
        data: { triggeredBy: msg.id, originalFrom: msg.fromAgent },
      });
    },
    description: "Beacon reviews campaigns when Shield flags compliance issues",
  },
  {
    id: "forge_churn_to_sophie",
    channel: "customer_signals",
    subscriberAgent: "sophie_csm",
    condition: (msg) => msg.data?.alerted > 0 || msg.priority === "high",
    reaction: async (msg) => {
      await agentCommsService.broadcast({
        from: "sophie_csm",
        channel: "customer_signals",
        priority: "medium",
        subject: `[Auto-reaction] Preparing retention outreach for at-risk accounts`,
        body: `Forge flagged ${msg.data?.alerted || "several"} accounts at churn risk. Sophie is queuing personalized check-in messages.`,
        data: { triggeredBy: msg.id, alerted: msg.data?.alerted },
      });
    },
    description: "Sophie prepares retention outreach when Forge detects churn risk",
  },
  {
    id: "sentinel_incident_to_atlas",
    channel: "incidents",
    subscriberAgent: "atlas_cto",
    condition: (msg) => msg.priority === "critical" && msg.fromAgent === "sentinel_devops",
    reaction: async (msg) => {
      await agentCommsService.broadcast({
        from: "atlas_cto",
        channel: "incidents",
        priority: "high",
        subject: `[Auto-reaction] CTO reviewing critical incident: ${msg.subject}`,
        body: `Sentinel reported a critical incident. Atlas is assessing system impact and evaluating remediation options.`,
        data: { triggeredBy: msg.id },
      });
    },
    description: "Atlas reviews critical incidents reported by Sentinel",
  },
  {
    id: "oracle_anomaly_to_compass",
    channel: "metrics_alerts",
    subscriberAgent: "compass_pm",
    condition: (msg) => msg.fromAgent === "oracle_analytics",
    reaction: async (msg) => {
      await agentCommsService.broadcast({
        from: "compass_pm",
        channel: "metrics_alerts",
        priority: "low",
        subject: `[Auto-reaction] Correlating metric anomaly with recent changes`,
        body: `Oracle detected a metric anomaly: "${msg.subject}". Compass is checking if this correlates with recent feature changes or deployments.`,
        data: { triggeredBy: msg.id },
      });
    },
    description: "Compass correlates Oracle's anomalies with feature changes",
  },
  {
    id: "forge_revenue_to_ledger",
    channel: "revenue_events",
    subscriberAgent: "ledger_finance",
    condition: (msg) => true,
    reaction: async (msg) => {
      await agentCommsService.broadcast({
        from: "ledger_finance",
        channel: "revenue_events",
        priority: "low",
        subject: `[Auto-reaction] Revenue event logged for financial tracking`,
        body: `Ledger has recorded Forge's revenue event: "${msg.subject}" for financial reconciliation.`,
        data: { triggeredBy: msg.id },
      });
    },
    description: "Ledger tracks all revenue events from Forge",
  },
];

// ─── Reaction Processor ─────────────────────────────────────────────────────

/**
 * Process unread messages and trigger reactions.
 * Called every 2 minutes by the background job.
 */
export async function processAgentReactions(): Promise<{ processed: number; reactions: number }> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  let processed = 0;
  let reactionsTriggered = 0;

  // Get recent messages (last 2 minutes to avoid re-processing)
  const recentMessages = await agentCommsService.getRecentMessages(twoMinutesAgo, 50);

  for (const msg of recentMessages) {
    processed++;

    // Find applicable reaction rules
    const applicableRules = REACTION_RULES.filter(rule =>
      rule.channel === msg.toChannel &&
      msg.fromAgent !== rule.subscriberAgent && // Don't react to own messages
      !msg.subject?.startsWith("[Auto-reaction]") // Don't chain-react to reactions
    );

    for (const rule of applicableRules) {
      try {
        // Check if the subscribing agent is active
        const agent = await companyAgentService.getByCodename(rule.subscriberAgent);
        if (!agent || agent.status !== "active") continue;

        // Check condition
        if (!rule.condition(msg)) continue;

        // Execute the reaction through authority gate
        await executeWithAuthority(
          rule.subscriberAgent,
          `reaction:${rule.id}`,
          () => rule.reaction(msg),
          {
            actionType: "reaction",
            actionName: rule.id,
            input: { messageId: msg.id, channel: msg.toChannel, from: msg.fromAgent, subject: msg.subject },
            reasoning: rule.description,
          }
        );

        reactionsTriggered++;

        // Mark the message as read by the reacting agent
        await agentCommsService.markRead(msg.id, rule.subscriberAgent);
      } catch (err) {
        console.error(`[ReactionEngine] Rule ${rule.id} failed:`, err);
      }
    }
  }

  if (reactionsTriggered > 0) {
    console.log(`[ReactionEngine] Processed ${processed} messages, triggered ${reactionsTriggered} reactions`);
  }

  return { processed, reactions: reactionsTriggered };
}
