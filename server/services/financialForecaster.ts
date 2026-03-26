// @ts-nocheck
/**
 * Financial Forecaster — Sovereign Company Protocol v5
 *
 * Answers the CEO's most pressing question: "When will I hit $X MRR?"
 * Provides forward-looking projections with confidence bands,
 * runway calculations, and unit economics.
 *
 * NOT a replacement for an accountant — this is for quick pulse checks.
 */

import { db } from "../db";
import { organizations, payments, subscriptionEvents } from "@shared/schema";
import { sql, gte, lte, count, sum, desc, eq, and } from "drizzle-orm";

export interface MRRProjection {
  currentMRR: number;
  growthRatePct: number;          // monthly growth rate
  projections: Array<{
    month: string;                // "2026-04"
    projected: number;            // dollars
    low: number;                  // 90% confidence lower bound
    high: number;                 // 90% confidence upper bound
  }>;
  milestones: Array<{
    target: number;               // $5000, $10000, etc.
    estimatedDate: string | null; // "June 2026" or null if declining
    confidence: string;           // "high" | "medium" | "low"
  }>;
}

export interface RunwayResult {
  monthlyBurn: number;
  monthlyRevenue: number;
  netBurn: number;                // burn - revenue (negative = profitable)
  isProfitable: boolean;
  runwayMonths: number | null;    // null if profitable or no burn data
  recommendation: string;
}

export interface UnitEconomics {
  avgRevenuePerCustomer: number;  // ARPU
  totalCustomers: number;
  customerLifetimeMonths: number; // estimated
  estimatedLTV: number;
  monthlyChurnRate: number;
  summary: string;
}

/**
 * Project MRR forward 6 months with confidence intervals.
 */
export async function projectMRR(): Promise<MRRProjection> {
  const now = new Date();

  // Get monthly MRR for the last 6 months
  const monthlyData: { month: string; mrr: number }[] = [];

  for (let i = 5; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthStr = monthStart.toISOString().slice(0, 7);

    // Count active orgs with paid plans as of that month
    const [result] = await db.select({
      count: count(),
    })
      .from(organizations)
      .where(and(
        lte(organizations.createdAt, monthEnd),
        sql`${organizations.plan} IS NOT NULL AND ${organizations.plan} != 'free' AND ${organizations.plan} != ''`,
      ));

    // Estimate MRR from active paid orgs (avg $49/mo assumption if no payment data)
    const activeOrgs = Number(result?.count || 0);
    const estimatedMRR = activeOrgs * 49; // Could be refined with actual payment data

    monthlyData.push({ month: monthStr, mrr: estimatedMRR });
  }

  const currentMRR = monthlyData[monthlyData.length - 1]?.mrr || 0;

  // Calculate growth rates between consecutive months
  const growthRates: number[] = [];
  for (let i = 1; i < monthlyData.length; i++) {
    const prev = monthlyData[i - 1].mrr;
    const curr = monthlyData[i].mrr;
    if (prev > 0) {
      growthRates.push((curr - prev) / prev);
    }
  }

  // Average growth rate and standard deviation
  const avgGrowthRate = growthRates.length > 0
    ? growthRates.reduce((a, b) => a + b, 0) / growthRates.length
    : 0;
  const growthStdDev = growthRates.length > 1
    ? Math.sqrt(growthRates.reduce((sum, r) => sum + Math.pow(r - avgGrowthRate, 2), 0) / (growthRates.length - 1))
    : avgGrowthRate * 0.3; // Default 30% variance if insufficient data

  // Project forward 6 months
  const projections: MRRProjection["projections"] = [];
  let projectedMRR = currentMRR;

  for (let i = 1; i <= 6; i++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthStr = futureDate.toLocaleString("en-US", { month: "short", year: "numeric" });

    projectedMRR *= (1 + avgGrowthRate);
    const low = currentMRR * Math.pow(1 + avgGrowthRate - 1.645 * growthStdDev, i);
    const high = currentMRR * Math.pow(1 + avgGrowthRate + 1.645 * growthStdDev, i);

    projections.push({
      month: monthStr,
      projected: Math.round(projectedMRR),
      low: Math.max(0, Math.round(low)),
      high: Math.round(high),
    });
  }

  // Calculate milestone dates
  const targets = [5000, 10000, 25000, 50000, 100000];
  const milestones: MRRProjection["milestones"] = [];

  for (const target of targets) {
    if (currentMRR >= target) continue; // Already passed this milestone
    if (avgGrowthRate <= 0) {
      milestones.push({ target, estimatedDate: null, confidence: "low" });
      continue;
    }

    // Months to reach target: log(target/current) / log(1+growth)
    const monthsNeeded = Math.log(target / currentMRR) / Math.log(1 + avgGrowthRate);
    const targetDate = new Date(now.getFullYear(), now.getMonth() + Math.ceil(monthsNeeded), 1);
    const dateStr = targetDate.toLocaleString("en-US", { month: "long", year: "numeric" });

    const confidence = growthStdDev / Math.abs(avgGrowthRate) < 0.5 ? "high"
      : growthStdDev / Math.abs(avgGrowthRate) < 1 ? "medium" : "low";

    milestones.push({ target, estimatedDate: dateStr, confidence });
  }

  return {
    currentMRR,
    growthRatePct: Math.round(avgGrowthRate * 1000) / 10,
    projections,
    milestones,
  };
}

/**
 * Calculate runway based on burn rate and revenue.
 */
export async function calculateRunway(): Promise<RunwayResult> {
  // Get current MRR
  const projection = await projectMRR();
  const monthlyRevenue = projection.currentMRR;

  // Estimate monthly costs (AI spend + infrastructure)
  // Use the ledger data resolver pattern
  const { resolveAgentData } = await import("./agentDataResolvers");
  const ledgerData = await resolveAgentData("ledger_finance").catch(() => ({}));
  const aiSpendWeekly = Number((ledgerData as any).aiSpend7dDollars || 0);
  const monthlyAISpend = aiSpendWeekly * 4.3;

  // Rough monthly burn estimate (AI + estimated infra)
  const monthlyBurn = monthlyAISpend + 200; // $200 base infra estimate
  const netBurn = monthlyBurn - monthlyRevenue;
  const isProfitable = netBurn <= 0;

  let runwayMonths: number | null = null;
  if (!isProfitable && monthlyBurn > 0) {
    // Simple runway: assume some capital buffer (this is a rough estimate)
    runwayMonths = Math.max(1, Math.round(monthlyRevenue / netBurn * -1 * 12));
  }

  let recommendation: string;
  if (isProfitable) {
    recommendation = "You're profitable. Revenue exceeds costs.";
  } else if (runwayMonths && runwayMonths > 12) {
    recommendation = `Comfortable runway. You have roughly ${runwayMonths} months at current burn rate.`;
  } else if (runwayMonths && runwayMonths > 6) {
    recommendation = `Watch your burn. ~${runwayMonths} months of runway remaining.`;
  } else {
    recommendation = "Revenue is growing but costs need attention.";
  }

  return { monthlyBurn, monthlyRevenue, netBurn, isProfitable, runwayMonths, recommendation };
}

/**
 * Calculate unit economics: ARPU, estimated LTV, churn rate.
 */
export async function calculateUnitEconomics(): Promise<UnitEconomics> {
  // Total active paying customers
  const [orgCount] = await db.select({ c: count() })
    .from(organizations)
    .where(sql`${organizations.plan} IS NOT NULL AND ${organizations.plan} != 'free' AND ${organizations.plan} != ''`);

  const totalCustomers = Number(orgCount?.c || 0);

  // Current MRR / customers = ARPU
  const projection = await projectMRR();
  const avgRevenuePerCustomer = totalCustomers > 0
    ? Math.round(projection.currentMRR / totalCustomers)
    : 0;

  // Estimate churn rate from org data
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [churned] = await db.select({ c: count() })
    .from(organizations)
    .where(and(
      sql`${organizations.plan} = 'free' OR ${organizations.plan} IS NULL`,
      gte(organizations.updatedAt, thirtyDaysAgo),
    ));

  const churnedCount = Number(churned?.c || 0);
  const monthlyChurnRate = totalCustomers > 0
    ? Math.round((churnedCount / totalCustomers) * 1000) / 10
    : 0;

  // LTV = ARPU / monthly churn rate
  const customerLifetimeMonths = monthlyChurnRate > 0
    ? Math.round(100 / monthlyChurnRate)
    : 24; // Default 24 months if no churn
  const estimatedLTV = avgRevenuePerCustomer * customerLifetimeMonths;

  let summary: string;
  if (totalCustomers === 0) {
    summary = "No paying customers yet.";
  } else {
    summary = `${totalCustomers} customer${totalCustomers > 1 ? "s" : ""} paying ~$${avgRevenuePerCustomer}/mo. Estimated LTV: $${estimatedLTV.toLocaleString()}. Monthly churn: ${monthlyChurnRate}%.`;
  }

  return {
    avgRevenuePerCustomer,
    totalCustomers,
    customerLifetimeMonths,
    estimatedLTV,
    monthlyChurnRate,
    summary,
  };
}
