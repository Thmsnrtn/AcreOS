/**
 * Agent Communications — Sovereign Company Protocol
 *
 * Inter-agent messaging system built on typed channels.
 * Agents broadcast events when they detect relevant signals.
 * The CEO Briefing aggregates highlights from all channels.
 *
 * Channels:
 *   releases          — Atlas CTO + Crucible QA + Compass PM + Sentinel DevOps
 *   incidents         — Sentinel broadcasts, all agents subscribe
 *   customer_signals  — Sophie + Forge + Compass share customer intelligence
 *   metrics_alerts    — Oracle broadcasts anomalies to relevant agents
 *   revenue_events    — Forge broadcasts MRR changes, Ledger + Beacon subscribe
 *   content_pipeline  — Beacon drafts, Compass reviews, Forge tracks conversion
 *   compliance_flags  — Shield broadcasts, all agents subscribe
 */

import { db } from "../db";
import { agentChannelMessages } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AgentChannel =
  | "releases"
  | "incidents"
  | "customer_signals"
  | "metrics_alerts"
  | "revenue_events"
  | "content_pipeline"
  | "compliance_flags";

export type MessagePriority = "low" | "medium" | "high" | "critical";

export interface BroadcastOptions {
  from: string;
  channel: AgentChannel;
  priority?: MessagePriority;
  subject: string;
  body: string;
  data?: Record<string, any>;
  requiresResponse?: boolean;
  respondBy?: Date;
}

// ─── Channel Subscriptions ──────────────────────────────────────────────────

const CHANNEL_SUBSCRIBERS: Record<AgentChannel, string[]> = {
  releases: ["atlas_cto", "crucible_qa", "compass_pm", "sentinel_devops"],
  incidents: ["atlas_cto", "sophie_csm", "forge_revenue", "beacon_marketing", "sentinel_devops", "ledger_finance", "shield_legal", "oracle_analytics", "compass_pm", "crucible_qa"],
  customer_signals: ["sophie_csm", "forge_revenue", "compass_pm"],
  metrics_alerts: ["oracle_analytics", "forge_revenue", "atlas_cto", "compass_pm"],
  revenue_events: ["forge_revenue", "ledger_finance", "beacon_marketing"],
  content_pipeline: ["beacon_marketing", "compass_pm", "forge_revenue"],
  compliance_flags: ["atlas_cto", "sophie_csm", "forge_revenue", "beacon_marketing", "sentinel_devops", "ledger_finance", "shield_legal", "oracle_analytics", "compass_pm", "crucible_qa"],
};

// ─── Service Class ──────────────────────────────────────────────────────────

class AgentCommsService {
  /**
   * Broadcast a message to a channel.
   * Returns the created message ID.
   */
  async broadcast(options: BroadcastOptions): Promise<number> {
    const [msg] = await db.insert(agentChannelMessages).values({
      fromAgent: options.from,
      toChannel: options.channel,
      priority: options.priority || "medium",
      subject: options.subject,
      body: options.body,
      data: options.data,
      requiresResponse: options.requiresResponse || false,
      respondBy: options.respondBy,
      readByAgents: [],
    }).returning({ id: agentChannelMessages.id });

    return msg.id;
  }

  /**
   * Get messages from a specific channel, optionally filtered by time.
   */
  async getMessages(channel: AgentChannel, since?: Date, limit = 50) {
    const conditions = [eq(agentChannelMessages.toChannel, channel)];
    if (since) {
      conditions.push(gte(agentChannelMessages.createdAt, since));
    }

    return db.select()
      .from(agentChannelMessages)
      .where(and(...conditions))
      .orderBy(desc(agentChannelMessages.createdAt))
      .limit(limit);
  }

  /**
   * Get all recent messages across all channels (for CEO Briefing).
   */
  async getRecentMessages(since?: Date, limit = 100) {
    const conditions = [];
    if (since) {
      conditions.push(gte(agentChannelMessages.createdAt, since));
    }

    return db.select()
      .from(agentChannelMessages)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agentChannelMessages.createdAt))
      .limit(limit);
  }

  /**
   * Get unread messages for a specific agent.
   * "Unread" = agent is a subscriber of the channel but not in readByAgents.
   */
  async getUnreadFor(agentCodename: string, limit = 50) {
    // Get channels this agent subscribes to
    const subscribedChannels = Object.entries(CHANNEL_SUBSCRIBERS)
      .filter(([, subs]) => subs.includes(agentCodename))
      .map(([channel]) => channel);

    if (subscribedChannels.length === 0) return [];

    const messages = await db.select()
      .from(agentChannelMessages)
      .where(
        sql`${agentChannelMessages.toChannel} = ANY(${subscribedChannels})
            AND NOT (${agentChannelMessages.readByAgents}::jsonb ? ${agentCodename})`
      )
      .orderBy(desc(agentChannelMessages.createdAt))
      .limit(limit);

    return messages;
  }

  /**
   * Mark a message as read by an agent.
   */
  async markRead(messageId: number, agentCodename: string): Promise<void> {
    await db.execute(
      sql`UPDATE agent_channel_messages
          SET read_by_agents = COALESCE(read_by_agents, '[]'::jsonb) || ${JSON.stringify([agentCodename])}::jsonb
          WHERE id = ${messageId}
          AND NOT (COALESCE(read_by_agents, '[]'::jsonb) ? ${agentCodename})`
    );
  }

  /**
   * Get subscribers for a channel.
   */
  getSubscribers(channel: AgentChannel): string[] {
    return CHANNEL_SUBSCRIBERS[channel] || [];
  }

  /**
   * Get high-priority messages from the last 24 hours (for CEO Briefing highlights).
   */
  async getHighlights(hoursBack = 24) {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    return db.select()
      .from(agentChannelMessages)
      .where(
        and(
          gte(agentChannelMessages.createdAt, since),
          sql`${agentChannelMessages.priority} IN ('high', 'critical')`
        )
      )
      .orderBy(desc(agentChannelMessages.createdAt))
      .limit(20);
  }

  /**
   * Get message count by channel for the last N hours.
   */
  async getChannelActivity(hoursBack = 24): Promise<Record<string, number>> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const results = await db.select({
      channel: agentChannelMessages.toChannel,
      count: sql<number>`count(*)`,
    })
      .from(agentChannelMessages)
      .where(gte(agentChannelMessages.createdAt, since))
      .groupBy(agentChannelMessages.toChannel);

    const activity: Record<string, number> = {};
    for (const row of results) {
      activity[row.channel] = Number(row.count);
    }
    return activity;
  }
}

export const agentCommsService = new AgentCommsService();
