/**
 * External Intelligence Feeds — Sovereign Company Protocol v9: The Self-Running Company
 *
 * The agents get eyes outside the product. Not for users — for YOU.
 *
 * Three intelligence streams:
 * 1. COMPETITOR MONITOR: Beacon watches competitor websites, pricing, features
 * 2. PLATFORM RISK MONITOR: Shield watches Stripe, Twilio, Fly.io, OpenAI changes
 * 3. MARKET SIGNALS: Oracle watches search trends, traffic patterns, market shifts
 *
 * This is the peripheral vision the system currently lacks.
 * Narrow, operational intelligence that directly affects YOUR business.
 */

import { db } from "../db";
import {
  externalIntelligence,
  type ExternalIntelligenceEntry,
} from "@shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { resolveAgentData } from "./agentDataResolvers";

// ─── Intelligence Feed Types ─────────────────────────────────────────────────

type IntelFeedType = "competitor" | "platform_risk" | "market_signal";
type IntelSeverity = "info" | "watch" | "action_needed";

interface IntelSource {
  name: string;
  feedType: IntelFeedType;
  ownerAgent: string;
  description: string;
  checkFrequency: "daily" | "weekly";
}

const INTEL_SOURCES: IntelSource[] = [
  // Competitor monitoring
  {
    name: "competitor_feature_tracking",
    feedType: "competitor",
    ownerAgent: "beacon_marketing",
    description: "Track competitor feature launches, pricing changes, and market positioning",
    checkFrequency: "weekly",
  },
  {
    name: "competitor_marketing_activity",
    feedType: "competitor",
    ownerAgent: "beacon_marketing",
    description: "Monitor competitor ad spend, content strategy, and campaign activity",
    checkFrequency: "weekly",
  },

  // Platform risk monitoring
  {
    name: "stripe_policy_changes",
    feedType: "platform_risk",
    ownerAgent: "shield_legal",
    description: "Monitor Stripe API changes, policy updates, and fee structure changes",
    checkFrequency: "weekly",
  },
  {
    name: "ai_provider_changes",
    feedType: "platform_risk",
    ownerAgent: "atlas_cto",
    description: "Monitor OpenAI model deprecations, pricing changes, and API updates",
    checkFrequency: "weekly",
  },
  {
    name: "infrastructure_provider_changes",
    feedType: "platform_risk",
    ownerAgent: "sentinel_devops",
    description: "Monitor Fly.io, AWS, and other infra provider changes and incidents",
    checkFrequency: "daily",
  },
  {
    name: "communication_provider_changes",
    feedType: "platform_risk",
    ownerAgent: "sophie_csm",
    description: "Monitor Twilio and SendGrid compliance requirements and pricing",
    checkFrequency: "weekly",
  },

  // Market signals
  {
    name: "search_trend_monitoring",
    feedType: "market_signal",
    ownerAgent: "oracle_analytics",
    description: "Track search volume trends for key land investment keywords",
    checkFrequency: "weekly",
  },
  {
    name: "market_condition_tracking",
    feedType: "market_signal",
    ownerAgent: "oracle_analytics",
    description: "Monitor interest rates, lending conditions, and real estate market shifts",
    checkFrequency: "weekly",
  },
];

// ─── Service ─────────────────────────────────────────────────────────────────

class ExternalIntelligenceService {

  /**
   * Run an intelligence scan for a specific feed source.
   * The owning agent generates analysis based on available data.
   */
  async runScan(sourceName: string): Promise<number | null> {
    const source = INTEL_SOURCES.find(s => s.name === sourceName);
    if (!source) return null;

    const agent = await resolveAgentData(source.ownerAgent).catch(() => ({}));

    try {
      const response = await routeAITask({
        taskType: "external_intelligence",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `You are an intelligence analyst for a SaaS company in the land investment space (AcreOS).
Your job is to generate an intelligence brief for the "${source.description}" feed.

Based on your domain knowledge and the provided business context, identify:
1. Any notable changes, risks, or opportunities in this area
2. How they directly impact AcreOS operations
3. Recommended actions (if any)

Be specific and actionable. Don't report things that don't matter to this specific business.
If there's nothing noteworthy to report, say so clearly.`,
          },
          {
            role: "user",
            content: `Intelligence feed: ${source.name}
Type: ${source.feedType}
Owner agent: ${source.ownerAgent}

Business context:
${JSON.stringify(agent, null, 2)}

Generate your intelligence brief. Respond in JSON:
{
  "hasFindings": true|false,
  "severity": "info|watch|action_needed",
  "title": "Brief title for this intelligence item",
  "summary": "2-3 sentence summary of findings",
  "impacts": ["specific impact 1 on AcreOS", "specific impact 2"],
  "recommendedActions": ["action 1", "action 2"],
  "confidence": 0-100
}`,
          },
        ],
        responseFormat: "json",
        temperature: 0.3,
      });

      const parsed = JSON.parse(response.content);

      if (!parsed.hasFindings) {
        // Store an "all clear" entry
        const [entry] = await db.insert(externalIntelligence).values({
          sourceName: source.name,
          feedType: source.feedType,
          ownerAgent: source.ownerAgent,
          severity: "info",
          title: `${source.name}: No notable findings`,
          summary: "Routine scan complete. No significant changes detected.",
          impacts: [],
          recommendedActions: [],
          confidence: parsed.confidence || 50,
          status: "noted",
        }).returning({ id: externalIntelligence.id });
        return entry.id;
      }

      const [entry] = await db.insert(externalIntelligence).values({
        sourceName: source.name,
        feedType: source.feedType,
        ownerAgent: source.ownerAgent,
        severity: parsed.severity || "info",
        title: parsed.title || `Intelligence update: ${source.name}`,
        summary: parsed.summary || "No summary provided.",
        impacts: parsed.impacts || [],
        recommendedActions: parsed.recommendedActions || [],
        confidence: parsed.confidence || 50,
        status: parsed.severity === "action_needed" ? "pending_review" : "noted",
      }).returning({ id: externalIntelligence.id });

      return entry.id;
    } catch {
      return null;
    }
  }

  /**
   * Run all intelligence scans (daily or weekly based on schedule).
   */
  async runAllScans(frequency?: "daily" | "weekly"): Promise<number[]> {
    const sources = frequency
      ? INTEL_SOURCES.filter(s => s.checkFrequency === frequency)
      : INTEL_SOURCES;

    const ids: number[] = [];
    for (const source of sources) {
      const id = await this.runScan(source.name);
      if (id) ids.push(id);
    }
    return ids;
  }

  /**
   * CEO acknowledges an intelligence item.
   */
  async acknowledge(entryId: number): Promise<void> {
    await db.update(externalIntelligence)
      .set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
      .where(eq(externalIntelligence.id, entryId));
  }

  /**
   * CEO marks as acted upon.
   */
  async markActedUpon(entryId: number, actionTaken?: string): Promise<void> {
    await db.update(externalIntelligence)
      .set({
        status: "acted_upon",
        actionTaken,
        acknowledgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(externalIntelligence.id, entryId));
  }

  /** Get items needing review */
  async getPendingReview(): Promise<ExternalIntelligenceEntry[]> {
    return db.query.externalIntelligence.findMany({
      where: eq(externalIntelligence.status, "pending_review"),
      orderBy: [desc(externalIntelligence.createdAt)],
    });
  }

  /** Get recent intelligence by feed type */
  async getByFeedType(feedType: IntelFeedType, limit = 10): Promise<ExternalIntelligenceEntry[]> {
    return db.query.externalIntelligence.findMany({
      where: eq(externalIntelligence.feedType, feedType),
      orderBy: [desc(externalIntelligence.createdAt)],
      limit,
    });
  }

  /** Get recent intelligence (all types) */
  async getRecent(limit = 20): Promise<ExternalIntelligenceEntry[]> {
    return db.query.externalIntelligence.findMany({
      orderBy: [desc(externalIntelligence.createdAt)],
      limit,
    });
  }

  /** Get available intel sources */
  getSources(): IntelSource[] {
    return INTEL_SOURCES;
  }
}

export const externalIntelligenceService = new ExternalIntelligenceService();
