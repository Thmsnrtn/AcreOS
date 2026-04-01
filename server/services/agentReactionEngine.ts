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
import { executeAction } from "./agentActionExecutors";
import { logger } from "../utils/logger";

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
      // v3: Actually pause affected campaigns on compliance flags
      if (msg.data?.campaignId) {
        await executeAction({
          agentCodename: "beacon_marketing",
          actionName: "pause_campaign",
          input: { campaignId: msg.data.campaignId, reason: `Compliance flag: ${msg.subject}` },
          triggeredBy: "reaction",
        });
      }

      await agentCommsService.broadcast({
        from: "beacon_marketing",
        channel: "content_pipeline",
        priority: "high",
        subject: `[Auto-reaction] Compliance flag — campaigns paused for review`,
        body: `Shield flagged a compliance issue: "${msg.subject}". Beacon has paused affected campaigns and is reviewing for compliance alignment.`,
        data: { triggeredBy: msg.id, originalFrom: msg.fromAgent },
      });
    },
    description: "Beacon pauses and reviews campaigns when Shield flags compliance issues",
  },
  {
    id: "forge_churn_to_sophie",
    channel: "customer_signals",
    subscriberAgent: "sophie_csm",
    condition: (msg) => msg.data?.alerted > 0 || msg.priority === "high",
    reaction: async (msg) => {
      // v3: Actually send retention emails to at-risk accounts
      let sent = 0;
      const atRiskOrgs = msg.data?.atRiskOrgs || [];
      for (const org of atRiskOrgs.slice(0, 3)) {
        const result = await executeAction({
          agentCodename: "sophie_csm",
          actionName: "send_retention_email",
          input: { orgId: org.orgId || org, riskScore: org.riskScore },
          triggeredBy: "reaction",
        });
        if (result.success) sent++;
      }

      await agentCommsService.broadcast({
        from: "sophie_csm",
        channel: "customer_signals",
        priority: "medium",
        subject: `[Auto-reaction] Retention outreach sent to ${sent} at-risk account(s)`,
        body: `Forge flagged ${msg.data?.alerted || "several"} accounts at churn risk. Sophie sent personalized check-in messages to ${sent} of them.`,
        data: { triggeredBy: msg.id, alerted: msg.data?.alerted, emailsSent: sent },
      });
    },
    description: "Sophie sends retention emails when Forge detects churn risk",
  },
  {
    id: "sentinel_incident_to_atlas",
    channel: "incidents",
    subscriberAgent: "atlas_cto",
    condition: (msg) => msg.priority === "critical" && msg.fromAgent === "sentinel_devops",
    reaction: async (msg) => {
      // v3: Atlas acknowledges the incident and begins assessment
      if (msg.data?.alertId) {
        await executeAction({
          agentCodename: "atlas_cto",
          actionName: "acknowledge_incident",
          input: { alertId: msg.data.alertId },
          triggeredBy: "reaction",
        });
      }

      await agentCommsService.broadcast({
        from: "atlas_cto",
        channel: "incidents",
        priority: "high",
        subject: `[Auto-reaction] CTO acknowledged critical incident: ${msg.subject}`,
        body: `Sentinel reported a critical incident. Atlas has acknowledged it and is assessing system impact and remediation options.`,
        data: { triggeredBy: msg.id },
      });
    },
    description: "Atlas acknowledges and reviews critical incidents from Sentinel",
  },
  {
    id: "oracle_anomaly_to_compass",
    channel: "metrics_alerts",
    subscriberAgent: "compass_pm",
    condition: (msg) => msg.fromAgent === "oracle_analytics",
    reaction: async (msg) => {
      // v4: Actually create a feature request if the anomaly suggests a product issue
      if (msg.data?.metric && msg.priority !== "low") {
        await executeAction({
          agentCodename: "compass_pm",
          actionName: "create_feature_request",
          input: {
            title: `Investigate: ${msg.subject}`,
            description: `Oracle detected an anomaly in ${msg.data.metric}. This may correlate with recent changes. Original alert: ${msg.body}`,
            priority: msg.priority === "critical" ? "high" : "medium",
            source: "oracle_anomaly",
          },
          triggeredBy: "reaction",
        });
      }

      await agentCommsService.broadcast({
        from: "compass_pm",
        channel: "metrics_alerts",
        priority: "low",
        subject: `[Auto-reaction] Investigating metric anomaly: ${msg.subject}`,
        body: `Oracle flagged "${msg.subject}". Compass has created an investigation task and is correlating with recent feature changes.`,
        data: { triggeredBy: msg.id },
      });
    },
    description: "Compass investigates Oracle's anomalies and creates feature requests",
  },
  {
    id: "forge_revenue_to_ledger",
    channel: "revenue_events",
    subscriberAgent: "ledger_finance",
    condition: (msg) => true,
    reaction: async (msg) => {
      // v4: Actually log the financial event through Ledger's executor
      if (msg.data?.amount || msg.data?.anomalyType) {
        await executeAction({
          agentCodename: "ledger_finance",
          actionName: "flag_anomaly",
          input: {
            anomalyType: msg.data.anomalyType || "revenue_event",
            detail: msg.body || msg.subject,
            severity: msg.priority === "critical" ? "critical" : "info",
          },
          triggeredBy: "reaction",
        });
      }

      await agentCommsService.broadcast({
        from: "ledger_finance",
        channel: "revenue_events",
        priority: "low",
        subject: `[Auto-reaction] Revenue event recorded: ${msg.subject}`,
        body: `Ledger has recorded and reconciled Forge's revenue event: "${msg.subject}".`,
        data: { triggeredBy: msg.id },
      });
    },
    description: "Ledger records and reconciles all revenue events from Forge",
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
        logger.error(`[ReactionEngine] Rule ${rule.id} failed`, err);
      }
    }
  }

  if (reactionsTriggered > 0) {
    logger.info(`[ReactionEngine] Processed ${processed} messages, triggered ${reactionsTriggered} reactions`);
  }

  return { processed, reactions: reactionsTriggered };
}
