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
  /** null when no acquisition cost is recorded — revenue minus nothing is not profit. */
  profit: number | null;
  margin: number | null;
  costsComplete: boolean;
  costsNotTracked: string[];
} | null> {
  const deal = await db.query.deals.findFirst({
    where: and(eq(deals.id, dealId), eq(deals.organizationId, orgId)),
  });
  if (!deal) return null;

  // ── What this used to do, and why none of it survived ──────────────────
  //   revenue = (deal as any).salePrice || (deal as any).offerAmount || 0
  //   Acquisition    = (deal as any).purchasePrice || 0
  //   Closing Costs  = revenue * 0.03
  //   Marketing      = revenue * 0.02
  //   Due Diligence  = 200
  //
  // `deals` has no `salePrice` and no `purchasePrice`, so ACQUISITION — the
  // largest cost in any real estate deal — was ALWAYS ZERO, and the other three
  // lines were invented. The reported profit was therefore
  // `offerAmount * 0.95 - 200` on every deal in the system, presented as a P&L.
  //
  // The acquisition figure exists: `cost_basis` holds it per property, and
  // CostBasisTracker maintains it. Closing costs, marketing spend and due
  // diligence are not tracked per deal anywhere, so they are omitted rather
  // than estimated — a cost line the customer can see is a claim that the money
  // was spent.
  const revenue = Number(deal.acceptedAmount ?? deal.offerAmount ?? 0);

  const { costBasis } = await import("@shared/schema");
  const [basis] = await db.select()
    .from(costBasis)
    .where(and(eq(costBasis.propertyId, deal.propertyId), eq(costBasis.organizationId, orgId)))
    .limit(1);

  const acquisition =
    basis?.acquisitionPrice == null
      ? null
      : Number(basis.acquisitionPrice) + Number(basis.acquisitionCosts ?? 0);

  const costs = acquisition === null ? [] : [{ category: "Acquisition", amount: acquisition }];
  const totalCost = costs.reduce((s, c) => s + c.amount, 0);
  // Without an acquisition cost there is no profit to report. Revenue minus
  // nothing is revenue, and calling that profit is the defect this replaces.
  const profit = acquisition === null ? null : revenue - totalCost;

  return {
    revenue,
    costs,
    profit,
    margin: profit === null || revenue <= 0 ? null : Math.round((profit / revenue) * 100),
    // Which cost lines AcreOS can actually account for. False means the figures
    // above are revenue and a partial cost picture, not a profit statement.
    costsComplete: acquisition !== null,
    costsNotTracked: ["Closing costs", "Marketing", "Due diligence"],
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
//
// Reads the canonical `cost_basis` table, which CostBasisTracker owns. This used
// to compute a basis of its own from two casts on the property row:
//
//     acquisitionCost: Number((p as any).purchasePrice || 0),
//     improvements:    Number((p as any).improvementCost || 0),
//     totalBasis:      purchasePrice + improvementCost
//
// `improvementCost` is not a column of `properties` — it is not on any table —
// so improvements were ALWAYS 0 and every basis was reported without them.
// Capital improvements are the thing a cost basis exists to capture, and
// understating basis overstates gain.
//
// Meanwhile `cost_basis` records acquisitionPrice, acquisitionCosts,
// improvementCosts and a maintained adjustedBasis, and CostBasisTracker
// maintains it. This surface was computing the same rule independently and
// worse — the second CLAUDE.md law in its documented form.
//
// A property with no basis record reports nulls with `basisRecorded: false`,
// following the `timingAvailable` precedent in getPipelineVelocity above:
// absent is stated, not rendered as zero.
export async function getCostBasisReport(orgId: number): Promise<Array<{
  propertyId: number;
  address: string;
  acquisitionCost: number | null;
  improvements: number | null;
  totalBasis: number | null;
  basisRecorded: boolean;
}>> {
  const props = await db.select()
    .from(properties)
    .where(eq(properties.organizationId, orgId))
    .limit(100);

  const { costBasis } = await import("@shared/schema");
  const basisRows = await db.select()
    .from(costBasis)
    .where(eq(costBasis.organizationId, orgId));
  const byProperty = new Map(basisRows.map((b) => [b.propertyId, b]));

  const num = (v: string | null | undefined): number | null =>
    v === null || v === undefined || v === "" ? null : Number(v);

  return props.map((p) => {
    const b = byProperty.get(p.id);
    const address = p.address || `${p.county}, ${p.state}`;
    if (!b) {
      return {
        propertyId: p.id, address,
        acquisitionCost: null, improvements: null, totalBasis: null,
        basisRecorded: false,
      };
    }
    const acquisition = num(b.acquisitionPrice);
    const acqCosts = num(b.acquisitionCosts) ?? 0;
    return {
      propertyId: p.id, address,
      acquisitionCost: acquisition === null ? null : acquisition + acqCosts,
      improvements: num(b.improvementCosts),
      totalBasis: num(b.adjustedBasis),
      basisRecorded: true,
    };
  });
}
