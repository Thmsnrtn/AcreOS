/**
 * Autonomous Revenue Engine — Sovereign Company Protocol Phase 15
 *
 * Active revenue generation: autonomous sales pipeline, expansion revenue,
 * pricing optimization, and content engine.
 */

import { db } from "../db";
import {
  organizations, leads, deals, campaigns, featureRequests,
  churnRiskScores, agentActionLog, decisionsInboxItems,
} from "@shared/schema";
import { eq, and, desc, gte, sql, count, not } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadScore {
  leadId: number;
  score: number;
  signals: string[];
  recommendation: string;
}

interface ExpansionOpportunity {
  orgId: number;
  orgName: string;
  currentTier: string;
  reason: string;
  confidence: number;
  estimatedRevenueLiftCents: number;
}

interface PricingMetrics {
  tier: string;
  conversionRate: number;
  arpu: number;
  ltv: number;
  churnRate: number;
}

interface ContentBrief {
  contentId: string;
  topic: string;
  format: string;
  targetAudience: string;
  outline: string[];
  complianceApproved: boolean;
  status: "draft" | "review" | "approved" | "published";
}

// ─── In-Memory State ──────────────────────────────────────────────────────────

const contentBriefs: Map<string, ContentBrief> = new Map();

// ─── Service ──────────────────────────────────────────────────────────────────

class AutonomousRevenueEngine {

  // ─── Autonomous Sales Pipeline ────────────────────────────────────────────

  /**
   * Beacon scans for new inbound leads based on activity patterns.
   */
  async identifyLeads(): Promise<LeadScore[]> {
    const recentLeads = await db.select()
      .from(leads)
      .where(and(
        eq(leads.status, "new"),
        gte(leads.createdAt, new Date(Date.now() - 7 * 86400000)),
      ))
      .orderBy(desc(leads.createdAt))
      .limit(50);

    return recentLeads.map(lead => {
      const signals: string[] = [];
      let score = 30;

      // Score based on available data
      if (lead.email) { signals.push("has_email"); score += 15; }
      if (lead.phone) { signals.push("has_phone"); score += 10; }
      if ((lead as any).companyName) { signals.push("has_company"); score += 10; }
      if ((lead as any).source === "referral") { signals.push("referral_source"); score += 20; }
      if ((lead as any).source === "organic") { signals.push("organic_source"); score += 15; }

      return {
        leadId: lead.id,
        score: Math.min(100, score),
        signals,
        recommendation: score >= 70 ? "High priority — immediate outreach" :
          score >= 50 ? "Medium priority — add to nurture sequence" :
          "Low priority — monitor for engagement",
      };
    });
  }

  /**
   * Sophie evaluates lead quality based on engagement and fit.
   */
  async qualifyLead(leadId: number): Promise<{ qualified: boolean; score: number; reasoning: string }> {
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, leadId),
    });
    if (!lead) return { qualified: false, score: 0, reasoning: "Lead not found" };

    // Calculate qualification score
    let score = 40;
    const factors: string[] = [];

    if (lead.email) { score += 15; factors.push("Contact email available"); }
    if (lead.phone) { score += 10; factors.push("Phone available"); }
    if ((lead as any).propertyCount > 5) { score += 15; factors.push("High property count"); }
    if ((lead as any).estimatedBudget > 50000) { score += 20; factors.push("Strong budget signal"); }

    const qualified = score >= 60;

    await db.insert(agentActionLog).values({
      agentCodename: "sophie_csm",
      actionType: "decision",
      actionName: "qualify_lead",
      input: { leadId },
      output: { qualified, score, factors },
      reasoning: `Lead #${leadId} qualification: ${qualified ? "QUALIFIED" : "NOT QUALIFIED"} (score: ${score})`,
      confidence: score,
      authorityLevel: 0,
      trustScoreAtTime: 0,
      outcome: "success",
      durationMs: 0,
    });

    return {
      qualified,
      score,
      reasoning: `Score: ${score}/100. Factors: ${factors.join(", ")}`,
    };
  }

  /**
   * Forge moves deals through pipeline stages.
   */
  async progressDeal(dealId: number, stage: string): Promise<{ success: boolean; message: string }> {
    const deal = await db.query.deals.findFirst({
      where: eq(deals.id, dealId),
    });
    if (!deal) return { success: false, message: "Deal not found" };

    try {
      await db.update(deals)
        .set({ status: stage, updatedAt: new Date() } as any)
        .where(eq(deals.id, dealId));

      await db.insert(agentActionLog).values({
        agentCodename: "forge_revenue",
        actionType: "skill",
        actionName: "progress_deal",
        input: { dealId, stage },
        output: { previousStage: deal.status, newStage: stage },
        reasoning: `Progressed deal #${dealId} to stage: ${stage}`,
        confidence: 85,
        authorityLevel: 1,
        trustScoreAtTime: 0,
        outcome: "success",
        durationMs: 0,
      });

      return { success: true, message: `Deal #${dealId} moved to ${stage}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Get full active pipeline with stage counts and projected revenue.
   */
  async getActivePipeline(): Promise<{
    stages: Record<string, number>;
    totalDeals: number;
    projectedRevenueCents: number;
  }> {
    const allDeals = await db.select().from(deals).limit(500);
    const stages: Record<string, number> = {};
    let projectedRevenue = 0;

    for (const deal of allDeals) {
      const stage = deal.status || "unknown";
      stages[stage] = (stages[stage] || 0) + 1;
      if ((deal as any).estimatedValueCents) {
        projectedRevenue += (deal as any).estimatedValueCents;
      }
    }

    return {
      stages,
      totalDeals: allDeals.length,
      projectedRevenueCents: projectedRevenue,
    };
  }

  // ─── Expansion Revenue Engine ─────────────────────────────────────────────

  /**
   * Sophie analyzes usage patterns for upgrade candidates.
   */
  async identifyExpansionOpportunities(): Promise<ExpansionOpportunity[]> {
    const orgs = await db.select()
      .from(organizations)
      .where(and(
        eq(organizations.subscriptionStatus, "active"),
        not(eq(organizations.subscriptionTier, "enterprise")),
      ))
      .limit(100);

    const opportunities: ExpansionOpportunity[] = [];

    for (const org of orgs) {
      let confidence = 0;
      const reasons: string[] = [];

      // Check for upgrade signals
      const tier = org.subscriptionTier || "free";
      if (tier === "free" || tier === "starter") {
        confidence += 30;
        reasons.push("On lower tier with potential for growth");
      }

      if ((org as any).teamSize > 3) {
        confidence += 25;
        reasons.push("Growing team size");
      }

      if (confidence >= 40) {
        opportunities.push({
          orgId: org.id,
          orgName: org.name,
          currentTier: tier,
          reason: reasons.join("; "),
          confidence,
          estimatedRevenueLiftCents: tier === "free" ? 9900 : tier === "starter" ? 19900 : 49900,
        });
      }
    }

    return opportunities.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Auto-trigger personalized upgrade suggestion.
   */
  async suggestUpgrade(orgId: number, reason: string): Promise<{ success: boolean; message: string }> {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });
    if (!org) return { success: false, message: "Organization not found" };

    try {
      const { executeWithAuthority } = await import("./agentAuthorityGate");
      const result = await executeWithAuthority("forge_revenue", "send_upsell_email", async () => {
        // Log the upgrade suggestion
        await db.insert(agentActionLog).values({
          agentCodename: "forge_revenue",
          actionType: "proactive",
          actionName: "suggest_upgrade",
          input: { orgId, reason, currentTier: org.subscriptionTier },
          output: { suggested: true },
          reasoning: `Expansion opportunity for ${org.name}: ${reason}`,
          confidence: 75,
          authorityLevel: 1,
          trustScoreAtTime: 0,
          outcome: "success",
          durationMs: 0,
        });
        return { suggested: true, orgName: org.name };
      }, { actionType: "proactive" });

      return { success: result.success, message: result.success ? `Upgrade suggestion sent to ${org.name}` : "Escalated for approval" };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async getExpansionPipeline(): Promise<ExpansionOpportunity[]> {
    return this.identifyExpansionOpportunities();
  }

  // ─── Pricing Optimization Loop ────────────────────────────────────────────

  /**
   * Oracle compares conversion rates across pricing tiers.
   */
  async analyzePricingEffectiveness(): Promise<PricingMetrics[]> {
    const tiers = ["free", "starter", "professional", "enterprise"];
    const metrics: PricingMetrics[] = [];

    for (const tier of tiers) {
      const [orgCount] = await db.select({ count: sql<number>`count(*)` })
        .from(organizations)
        .where(eq(organizations.subscriptionTier, tier));

      const [activeCount] = await db.select({ count: sql<number>`count(*)` })
        .from(organizations)
        .where(and(
          eq(organizations.subscriptionTier, tier),
          eq(organizations.subscriptionStatus, "active"),
        ));

      const total = Number(orgCount?.count || 0);
      const active = Number(activeCount?.count || 0);
      const conversionRate = total > 0 ? (active / total) * 100 : 0;
      const tierPriceCents: Record<string, number> = { free: 0, starter: 9900, professional: 29900, enterprise: 99900 };

      metrics.push({
        tier,
        conversionRate: Math.round(conversionRate * 10) / 10,
        arpu: tierPriceCents[tier] || 0,
        ltv: (tierPriceCents[tier] || 0) * 18, // Assume 18-month average LTV
        churnRate: total > 0 ? Math.round(((total - active) / total) * 100 * 10) / 10 : 0,
      });
    }

    return metrics;
  }

  /**
   * Propose a pricing adjustment to the board.
   */
  async proposePriceAdjustment(tier: string, newPriceCents: number, reasoning: string): Promise<{ proposalId: string }> {
    try {
      const { aiBoardOfDirectors } = await import("./aiBoardOfDirectors");
      const proposalId = await aiBoardOfDirectors.createProposal(
        "forge_revenue",
        `Pricing adjustment: Change "${tier}" tier from current to $${(newPriceCents / 100).toFixed(2)}/mo. Rationale: ${reasoning}`,
        "pricing_change",
        "financial"
      );
      return { proposalId };
    } catch {
      return { proposalId: "" };
    }
  }

  async getPricingMetrics(): Promise<PricingMetrics[]> {
    return this.analyzePricingEffectiveness();
  }

  // ─── Autonomous Content Engine ────────────────────────────────────────────

  /**
   * Beacon creates a content brief.
   */
  async generateContentIdea(topic: string, format: string, targetAudience: string = "real estate professionals"): Promise<ContentBrief> {
    const contentId = `content-${crypto.randomUUID().slice(0, 8)}`;

    const brief: ContentBrief = {
      contentId,
      topic,
      format,
      targetAudience,
      outline: [
        `Introduction: Why ${topic} matters for ${targetAudience}`,
        `Key insights and data points`,
        `Actionable strategies`,
        `Case study or example`,
        `Call to action`,
      ],
      complianceApproved: false,
      status: "draft",
    };

    contentBriefs.set(contentId, brief);

    await db.insert(agentActionLog).values({
      agentCodename: "beacon_marketing",
      actionType: "proactive",
      actionName: "generate_content_idea",
      input: { topic, format, targetAudience },
      output: { contentId, outline: brief.outline },
      reasoning: `Generated content brief for "${topic}" (${format})`,
      confidence: 80,
      authorityLevel: 0,
      trustScoreAtTime: 0,
      outcome: "success",
      durationMs: 0,
    });

    return brief;
  }

  /**
   * Shield checks content for compliance.
   */
  async reviewContentCompliance(contentId: string): Promise<{ approved: boolean; issues: string[] }> {
    const brief = contentBriefs.get(contentId);
    if (!brief) return { approved: false, issues: ["Content not found"] };

    // Check for common compliance issues
    const issues: string[] = [];
    const topic = brief.topic.toLowerCase();

    if (topic.includes("guarantee") || topic.includes("guaranteed")) {
      issues.push("Contains guarantee language — may violate advertising standards");
    }
    if (topic.includes("returns") && topic.includes("%")) {
      issues.push("Contains specific return percentages — may violate SEC regulations");
    }

    const approved = issues.length === 0;
    brief.complianceApproved = approved;
    brief.status = approved ? "approved" : "review";
    contentBriefs.set(contentId, brief);

    return { approved, issues };
  }

  /**
   * Get upcoming content schedule.
   */
  getContentCalendar(): ContentBrief[] {
    return Array.from(contentBriefs.values()).filter(b => b.status !== "published");
  }

  /**
   * Publish content after Shield approval.
   */
  async publishContent(contentId: string): Promise<{ success: boolean; message: string }> {
    const brief = contentBriefs.get(contentId);
    if (!brief) return { success: false, message: "Content not found" };
    if (!brief.complianceApproved) return { success: false, message: "Content not compliance-approved" };

    brief.status = "published";
    contentBriefs.set(contentId, brief);

    return { success: true, message: `Content "${brief.topic}" published` };
  }

  // ─── Revenue Dashboard ────────────────────────────────────────────────────

  /**
   * Get comprehensive revenue dashboard.
   */
  async getRevenueDashboard(): Promise<{
    pipeline: any;
    expansion: ExpansionOpportunity[];
    pricing: PricingMetrics[];
    content: ContentBrief[];
  }> {
    const [pipeline, expansion, pricing] = await Promise.all([
      this.getActivePipeline(),
      this.identifyExpansionOpportunities().then(ops => ops.slice(0, 10)),
      this.analyzePricingEffectiveness(),
    ]);

    return {
      pipeline,
      expansion,
      pricing,
      content: this.getContentCalendar(),
    };
  }
}

export const autonomousRevenueEngine = new AutonomousRevenueEngine();
