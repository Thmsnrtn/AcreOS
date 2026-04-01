/**
 * Monthly "Your Month in Review" email.
 * Runs on the 1st of each month. Generates rich HTML email
 * that's screenshot-worthy — users share in investing communities.
 */

import { storage, db } from "../storage";
import { deals, notes, payments } from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

interface MonthlyReviewData {
  orgId: number;
  orgName: string;
  month: string;
  year: number;

  // Deals
  dealsClosed: number;
  totalProfit: number;
  bestDeal: { acres: number; county: string; profit: number; days: number } | null;
  pipelineDeals: number;
  pipelineValue: number;

  // Notes
  notesCollected: number;
  activeNotes: number;
  collectionRate: number;
  portfolioYield: number;

  // Freedom
  freedomScore: number;
  freedomChange: number;
  projectedDate: string | null;
}

export async function generateMonthlyReview(orgId: number): Promise<MonthlyReviewData | null> {
  try {
    const org = await storage.getOrganization(orgId);
    if (!org) return null;

    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const monthName = lastMonth.toLocaleDateString("en-US", { month: "long" });

    // Get deals closed last month
    const orgDeals = await storage.getDeals(orgId);
    const closedLastMonth = orgDeals.filter((d) => {
      if (d.status !== "closed" || !d.closingDate) return false;
      const cd = new Date(d.closingDate);
      return cd >= lastMonth && cd <= lastMonthEnd;
    });

    const totalProfit = closedLastMonth.reduce((s, d) => {
      const accepted = parseFloat(d.acceptedAmount || "0");
      const offer = parseFloat(d.offerAmount || "0");
      return s + Math.max(0, accepted - offer);
    }, 0);

    // Best deal
    let bestDeal: MonthlyReviewData["bestDeal"] = null;
    if (closedLastMonth.length > 0) {
      const best = closedLastMonth.reduce((best, d) => {
        const profit = parseFloat(d.acceptedAmount || "0") - parseFloat(d.offerAmount || "0");
        return profit > (best.profit || 0) ? { deal: d, profit } : best;
      }, { deal: closedLastMonth[0], profit: 0 });

      if (best.deal.propertyId) {
        const prop = await storage.getProperty(orgId, best.deal.propertyId);
        bestDeal = {
          acres: prop?.sizeAcres ? parseFloat(prop.sizeAcres) : 0,
          county: prop?.county || "Unknown",
          profit: best.profit,
          days: best.deal.closingDate && best.deal.offerDate
            ? Math.ceil((new Date(best.deal.closingDate).getTime() - new Date(best.deal.offerDate).getTime()) / 86400000)
            : 0,
        };
      }
    }

    // Pipeline
    const pipeline = orgDeals.filter((d) => d.status !== "closed" && d.status !== "cancelled");
    const pipelineValue = pipeline.reduce((s, d) => s + parseFloat(d.offerAmount || "0"), 0);

    // Notes
    const orgNotes = await storage.getNotes(orgId);
    const activeNotes = orgNotes.filter((n: any) => n.status === "active");
    const monthlyIncome = activeNotes.reduce((s, n: any) => s + parseFloat(n.monthlyPayment || "0"), 0);
    const currentNotes = activeNotes.filter((n: any) => n.delinquencyStatus === "current" || !n.delinquencyStatus);
    const collectionRate = activeNotes.length > 0 ? (currentNotes.length / activeNotes.length) * 100 : 100;
    const totalBalance = activeNotes.reduce((s, n: any) => s + parseFloat(n.currentBalance || "0"), 0);
    const avgRate = activeNotes.length > 0
      ? activeNotes.reduce((s, n: any) => s + parseFloat(n.interestRate || "0"), 0) / activeNotes.length
      : 0;

    // Freedom score (simplified)
    const monthlyExpenses = 5000; // default target
    const freedomScore = monthlyExpenses > 0 ? Math.min(100, Math.round((monthlyIncome / monthlyExpenses) * 100)) : 0;

    return {
      orgId,
      orgName: org.name || "Your Organization",
      month: monthName,
      year: lastMonth.getFullYear(),

      dealsClosed: closedLastMonth.length,
      totalProfit,
      bestDeal,
      pipelineDeals: pipeline.length,
      pipelineValue,

      notesCollected: Math.round(monthlyIncome),
      activeNotes: activeNotes.length,
      collectionRate: Math.round(collectionRate),
      portfolioYield: Math.round(avgRate * 10) / 10,

      freedomScore,
      freedomChange: 0, // would compare to previous month
      projectedDate: null,
    };
  } catch (err) {
    logger.error("Monthly review generation failed", err instanceof Error ? err : undefined);
    return null;
  }
}

export function renderMonthlyReviewHtml(data: MonthlyReviewData): string {
  const fmt$ = (n: number) => `$${Math.round(n).toLocaleString()}`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your ${data.month} in Review</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; color: #1a1a1a; }
    .header { text-align: center; padding: 24px 0; border-bottom: 2px solid #8B6914; }
    .header h1 { margin: 0; font-size: 24px; color: #1a1a1a; }
    .header p { margin: 4px 0 0; color: #666; font-size: 14px; }
    .section { background: #fff; border-radius: 8px; padding: 20px; margin: 16px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #8B6914; margin: 0 0 12px; font-weight: 600; }
    .stat { margin: 8px 0; font-size: 15px; line-height: 1.5; }
    .stat strong { color: #1a1a1a; }
    .highlight { color: #2D5A2D; font-weight: 600; }
    .cta { display: block; text-align: center; background: #2D5A2D; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; margin: 24px auto; max-width: 200px; }
    .footer { text-align: center; color: #999; font-size: 12px; padding: 16px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Your ${data.month} in Review</h1>
    <p>${data.orgName} · ${data.month} ${data.year}</p>
  </div>

  <div class="section">
    <div class="section-title">Deals</div>
    <div class="stat">${data.dealsClosed} deal${data.dealsClosed !== 1 ? "s" : ""} closed — <span class="highlight">${fmt$(data.totalProfit)}</span> total profit</div>
    ${data.bestDeal ? `<div class="stat">Best deal: ${data.bestDeal.acres.toFixed(1)} acres, ${data.bestDeal.county} — ${fmt$(data.bestDeal.profit)} profit in ${data.bestDeal.days} days</div>` : ""}
    <div class="stat">Your pipeline: ${data.pipelineDeals} active deal${data.pipelineDeals !== 1 ? "s" : ""} worth ${fmt$(data.pipelineValue)} potential</div>
  </div>

  <div class="section">
    <div class="section-title">Notes</div>
    <div class="stat">${fmt$(data.notesCollected)} collected from ${data.activeNotes} active note${data.activeNotes !== 1 ? "s" : ""}</div>
    <div class="stat">${data.collectionRate}% collection rate this month</div>
    <div class="stat">Portfolio yield: ${data.portfolioYield}%</div>
  </div>

  <div class="section">
    <div class="section-title">Freedom</div>
    <div class="stat">You're <span class="highlight">${data.freedomScore}%</span> to financial freedom${data.freedomChange > 0 ? ` (up from ${data.freedomScore - data.freedomChange}% last month)` : ""}</div>
    ${data.projectedDate ? `<div class="stat">At current pace: ${data.projectedDate}</div>` : ""}
  </div>

  <a href="https://app.acreos.com" class="cta">View Full Dashboard →</a>

  <div class="footer">
    <p>AcreOS — Real Estate Intelligence</p>
    <p><a href="https://app.acreos.com/settings/notifications" style="color: #999;">Unsubscribe</a></p>
  </div>
</body>
</html>`;
}
