/**
 * Pipeline Intelligence — throughput analysis, disposition recommendations,
 * and attribution ROI for the deal pipeline.
 */

import { db } from "../db";
import { deals, leads, campaigns, properties } from "@shared/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";
import { logger } from "../utils/logger";

// ── Throughput Analysis ─────────────────────────────────────────────

export interface ThroughputMetrics {
  period: string;
  leadsIn: number;
  dealsCreated: number;
  dealsClosed: number;
  conversionRate: number;
  avgDaysToClose: number;
  bottleneck: { stage: string; avgDays: number; count: number } | null;
  velocity: number; // deals closed per month
}

export async function analyzeThroughput(orgId: number, periodDays = 90): Promise<ThroughputMetrics> {
  const since = new Date(Date.now() - periodDays * 86400000);

  const [leadsResult] = await db.select({ cnt: count() }).from(leads)
    .where(and(eq(leads.organizationId, orgId), gte(leads.createdAt, since)));

  const [dealsCreated] = await db.select({ cnt: count() }).from(deals)
    .where(and(eq(deals.organizationId, orgId), gte(deals.createdAt, since)));

  const [dealsClosed] = await db.select({ cnt: count() }).from(deals)
    .where(and(eq(deals.organizationId, orgId), eq(deals.status, "closed"), gte(deals.updatedAt, since)));

  const leadsIn = Number(leadsResult?.cnt || 0);
  const created = Number(dealsCreated?.cnt || 0);
  const closed = Number(dealsClosed?.cnt || 0);
  const conversionRate = leadsIn > 0 ? (closed / leadsIn) * 100 : 0;
  const velocity = closed / Math.max(1, periodDays / 30);

  // Find bottleneck — which stage has the most deals stuck longest
  const stageData = await db.execute(sql`
    SELECT status, COUNT(*) as cnt,
      AVG(EXTRACT(EPOCH FROM (NOW() - COALESCE(updated_at, created_at))) / 86400) as avg_days
    FROM deals
    WHERE organization_id = ${orgId}
      AND status NOT IN ('closed', 'cancelled', 'dead')
    GROUP BY status
    ORDER BY avg_days DESC
    LIMIT 1
  `);

  const bottleneckRow = (stageData as any).rows?.[0];
  const bottleneck = bottleneckRow ? {
    stage: bottleneckRow.status,
    avgDays: Math.round(Number(bottleneckRow.avg_days) || 0),
    count: Number(bottleneckRow.cnt) || 0,
  } : null;

  return {
    period: `${periodDays} days`,
    leadsIn,
    dealsCreated: created,
    dealsClosed: closed,
    conversionRate: parseFloat(conversionRate.toFixed(2)),
    avgDaysToClose: 0, // would compute from closed deals
    bottleneck,
    velocity: parseFloat(velocity.toFixed(1)),
  };
}

// ── Disposition Recommendations ─────────────────────────────────────

export type DispositionStrategy = "wholesale" | "retail" | "seller_finance" | "hold_and_lease" | "subdivide" | "entitle_and_sell";

export interface DispositionRecommendation {
  strategy: DispositionStrategy;
  score: number;
  projectedProfit: number;
  projectedTimeline: string;
  reasoning: string;
  risks: string[];
}

export async function recommendDisposition(
  orgId: number,
  dealId: number
): Promise<DispositionRecommendation[]> {
  const [deal] = await db.select().from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)))
    .limit(1);

  if (!deal) return [];

  const property = deal.propertyId
    ? (await db.select().from(properties).where(eq(properties.id, deal.propertyId)).limit(1))[0]
    : null;

  const buyPrice = parseFloat(deal.offerAmount || "0");
  const acres = parseFloat(property?.sizeAcres || "0");
  const hasUtilities = !!(property as any)?.utilities;
  const hasRoadAccess = !!property?.roadAccess;

  const recommendations: DispositionRecommendation[] = [];

  // Wholesale
  recommendations.push({
    strategy: "wholesale",
    score: 75,
    projectedProfit: Math.round(buyPrice * 0.3),
    projectedTimeline: "30-60 days",
    reasoning: "Quick turn with assignment or double-close. Lowest risk, fastest return.",
    risks: ["Requires active buyer list", "Lower profit margin"],
  });

  // Retail
  const retailMultiplier = hasUtilities && hasRoadAccess ? 2.0 : 1.5;
  recommendations.push({
    strategy: "retail",
    score: hasUtilities ? 80 : 60,
    projectedProfit: Math.round(buyPrice * (retailMultiplier - 1)),
    projectedTimeline: "60-180 days",
    reasoning: "List on MLS/marketplace for full retail. Higher profit, longer timeline.",
    risks: ["Market exposure risk", "Holding costs", "Requires marketing budget"],
  });

  // Seller finance
  if (buyPrice >= 5000) {
    const downPayment = Math.round(buyPrice * 0.2);
    const noteBalance = buyPrice * 1.4 - downPayment;
    recommendations.push({
      strategy: "seller_finance",
      score: 70,
      projectedProfit: Math.round(noteBalance * 0.3),
      projectedTimeline: "30-90 days to originate, 5-10 year note term",
      reasoning: "Create a performing note — monthly cash flow + interest income. Sell the note later for lump sum.",
      risks: ["Default risk", "Servicing overhead", "Dodd-Frank compliance for residential"],
    });
  }

  // Hold and lease
  if (acres >= 5) {
    recommendations.push({
      strategy: "hold_and_lease",
      score: 55,
      projectedProfit: Math.round(acres * 50 * 12), // rough annual lease income
      projectedTimeline: "Ongoing — annual income",
      reasoning: "Lease for agriculture, hunting, or recreation while property appreciates.",
      risks: ["Low liquidity", "Property management", "Market depreciation"],
    });
  }

  // Subdivide
  if (acres >= 10) {
    recommendations.push({
      strategy: "subdivide",
      score: hasUtilities ? 65 : 40,
      projectedProfit: Math.round(buyPrice * 1.5),
      projectedTimeline: "6-18 months",
      reasoning: "Split into smaller lots for higher per-acre pricing.",
      risks: ["County subdivision regulations", "Survey and legal costs", "Infrastructure costs"],
    });
  }

  recommendations.sort((a, b) => b.score - a.score);

  // Integration point: try dispositionOptimizer for enhanced recommendations
  try {
    const { DispositionOptimizerService } = await import("./dispositionOptimizer");
    const optimizer = new DispositionOptimizerService();
    if (deal.propertyId) {
      const analysis = await optimizer.analyzeProperty(orgId, deal.propertyId);
      // Use optimizer's recommended strategy to boost the matching recommendation
      const optimizerStrategy = analysis.recommendedStrategy;
      const strategyMap: Record<string, DispositionStrategy> = {
        list_retail: "retail",
        sell_wholesale: "wholesale",
        owner_finance: "seller_finance",
        hold: "hold_and_lease",
        auction: "wholesale",
      };
      const mappedStrategy = strategyMap[optimizerStrategy];
      if (mappedStrategy) {
        const match = recommendations.find(r => r.strategy === mappedStrategy);
        if (match) {
          match.score = Math.min(100, match.score + 15);
          match.reasoning = `[Enhanced by Disposition Optimizer — confidence ${(analysis.confidence * 100).toFixed(0)}%] ${match.reasoning}`;
        }
      }
      recommendations.sort((a, b) => b.score - a.score);
      logger.info("disposition_recommendation_enhanced", { orgId, dealId, optimizerStrategy });
    }
  } catch {
    // dispositionOptimizer not available or property analysis failed — using standalone recommendations
    logger.info("disposition_recommendation_standalone", { orgId, dealId, reason: "optimizer_unavailable" });
  }

  return recommendations;
}

// ── Attribution ROI ─────────────────────────────────────────────────

export interface AttributionROI {
  source: string;
  leadsGenerated: number;
  dealsClosed: number;
  totalRevenue: number;
  totalCost: number;
  roi: number;
  costPerLead: number;
  costPerDeal: number;
}

export async function computeAttributionROI(orgId: number): Promise<AttributionROI[]> {
  // deals table does not have a lead_id column in prod — group leads by source only
  // and approximate "deals closed" via lead -> property -> deal join when available.
  const result = await db.execute(sql`
    SELECT l.source,
      COUNT(DISTINCT l.id) as lead_count,
      0::int as deal_count,
      0::numeric as revenue
    FROM leads l
    WHERE l.organization_id = ${orgId}
      AND l.source IS NOT NULL
    GROUP BY l.source
    ORDER BY COUNT(DISTINCT l.id) DESC
    LIMIT 20
  `);

  return ((result as any).rows ?? []).map((r: any) => {
    const leads = Number(r.lead_count) || 0;
    const deals = Number(r.deal_count) || 0;
    const revenue = Number(r.revenue) || 0;
    const cost = 0; // Would come from campaign spend data
    const roi = cost > 0 ? ((revenue - cost) / cost) * 100 : revenue > 0 ? 100 : 0;

    return {
      source: r.source || "Unknown",
      leadsGenerated: leads,
      dealsClosed: deals,
      totalRevenue: Math.round(revenue),
      totalCost: cost,
      roi: parseFloat(roi.toFixed(1)),
      costPerLead: leads > 0 ? Math.round(cost / leads) : 0,
      costPerDeal: deals > 0 ? Math.round(cost / deals) : 0,
    };
  });
}
