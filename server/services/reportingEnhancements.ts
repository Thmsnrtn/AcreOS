/**
 * Reporting Enhancements — Items 141-160
 * Custom reports, scheduled reports, export, branded covers, pipeline velocity, etc.
 */

import { db } from "../db";
import { deals, properties, notes, payments, leads } from "@shared/schema";
import { eq, and, sql, count, gte, desc } from "drizzle-orm";

// Item 144: Universal CSV export
export function tableToCSV(data: any[], columns?: string[]): string {
  if (!data.length) return "";
  const headers = columns || Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => {
    const val = row[h];
    if (val === null || val === undefined) return "";
    const str = String(val);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(","));
  return [headers.join(","), ...rows].join("\n");
}

// Item 155: Pipeline velocity report
//
// Per-stage average dwell time (avgDays) requires a stage-transition history
// (when each deal entered/left each status). No such history is recorded today
// — `deals` carries only a single current `status` plus created/offer/closing
// timestamps, which cannot reconstruct time-in-stage. Rather than fabricate
// per-stage durations, we report avgDays as null ("not available") and surface
// an explicit timingAvailable: false flag. Stage counts are real.
export async function getPipelineVelocity(orgId: number): Promise<{
  stages: Array<{ stage: string; avgDays: number | null; count: number }>;
  bottleneck: string | null;
  totalAvgDays: number | null;
  timingAvailable: boolean;
}> {
  const stages = ["new", "contacted", "responded", "offer_sent", "negotiating", "under_contract", "closed_won"];
  const stageData: Array<{ stage: string; avgDays: number | null; count: number }> = [];

  for (const stage of stages) {
    const [result] = await db.select({ count: count() })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), eq(deals.status, stage)));
    stageData.push({ stage, avgDays: null, count: result?.count || 0 });
  }

  // No stage-transition timing source — cannot honestly identify a bottleneck
  // or a total cycle time. Report nulls; the timingAvailable flag tells callers
  // these fields are intentionally absent, not zero.
  return { stages: stageData, bottleneck: null, totalAvgDays: null, timingAvailable: false };
}

// Item 157: Deal P&L statement
export async function getDealPnL(dealId: number, orgId: number): Promise<{
  revenue: number;
  costs: Array<{ category: string; amount: number }>;
  profit: number;
  margin: number;
} | null> {
  const deal = await db.query.deals.findFirst({
    where: and(eq(deals.id, dealId), eq(deals.organizationId, orgId)),
  });
  if (!deal) return null;

  const revenue = Number((deal as any).salePrice || (deal as any).offerAmount || 0);
  const costs = [
    { category: "Acquisition", amount: Number((deal as any).purchasePrice || 0) },
    { category: "Closing Costs", amount: Math.round(revenue * 0.03) },
    { category: "Marketing", amount: Math.round(revenue * 0.02) },
    { category: "Due Diligence", amount: 200 },
  ];
  const totalCost = costs.reduce((s, c) => s + c.amount, 0);
  const profit = revenue - totalCost;

  return {
    revenue,
    costs,
    profit,
    margin: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
  };
}

// Item 160: Report caching
const reportCache = new Map<string, { data: any; expiry: number }>();

export function getCachedReport(key: string): any | null {
  const cached = reportCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiry) { reportCache.delete(key); return null; }
  return cached.data;
}

export function cacheReport(key: string, data: any, ttlMs: number = 5 * 60 * 1000): void {
  reportCache.set(key, { data, expiry: Date.now() + ttlMs });
}

// Item 156: Cost basis report
export async function getCostBasisReport(orgId: number): Promise<Array<{
  propertyId: number;
  address: string;
  acquisitionCost: number;
  improvements: number;
  totalBasis: number;
}>> {
  const props = await db.select()
    .from(properties)
    .where(eq(properties.organizationId, orgId))
    .limit(100);

  return props.map(p => ({
    propertyId: p.id,
    address: p.address || `${p.county}, ${p.state}`,
    acquisitionCost: Number((p as any).purchasePrice || 0),
    improvements: Number((p as any).improvementCost || 0),
    totalBasis: Number((p as any).purchasePrice || 0) + Number((p as any).improvementCost || 0),
  }));
}
