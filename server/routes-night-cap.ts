// @ts-nocheck
/**
 * Night Cap Snapshot API
 *
 * Epic A: Nite Cap Dashboard — Passive Income Command Center
 *
 * GET /api/night-cap/snapshot
 *   Aggregates tonight's passive income data for the Nite Cap end-of-day review:
 *   - Today's note payments received
 *   - Freedom meter snapshot (passive income vs expenses)
 *   - Pipeline velocity by stage
 *   - Campaign pulse (today's responses)
 *   - Top AcreScore leads
 *   - Win of the day (latest closed deal or note)
 *   - Tomorrow's one thing (AI-suggested highest-impact action)
 *   - Rotating Nite Cap wisdom quote
 *
 * Reuses existing finance, pipeline, campaign, and lead data endpoints.
 * No new DB tables — pure aggregation.
 */

import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { sql, desc, eq, and, gte, lte } from "drizzle-orm";
import {
  payments, notes, deals, leads, campaigns, leadScoreHistory,
  activityLog, organizations,
} from "@shared/schema";

const router = Router();

// ============================================
// NITE CAP WISDOM QUOTES
// 30 curated quotes from Podolsky / Nite Cap methodology
// ============================================

const NITE_CAP_QUOTES = [
  { quote: "The land business isn't about buying land. It's about building a system that buys land for you.", author: "Mark Podolsky" },
  { quote: "Every note payment that hits your account is a vote of confidence in your system.", author: "Land Geek" },
  { quote: "The freedom number isn't a dream — it's a math problem. And math problems have solutions.", author: "Mark Podolsky" },
  { quote: "Raw land is the one asset that has never gone to zero in the history of the United States.", author: "Land Geek" },
  { quote: "Your best deal is always the next one. Keep your pipeline full.", author: "Mark Podolsky" },
  { quote: "The mailer that goes out today is the passive income that arrives next quarter.", author: "Land Geek" },
  { quote: "Owner financing raw land is the closest thing to a legal money printing machine.", author: "Mark Podolsky" },
  { quote: "Consistency beats intensity. Mail every month, score every lead, close every deal.", author: "Land Geek" },
  { quote: "Your freedom number is the finish line. Every note payment is a step toward it.", author: "Mark Podolsky" },
  { quote: "The best time to mail was last month. The second best time is right now.", author: "Land Geek" },
  { quote: "Tax delinquency is not a problem. It's an opportunity wearing a disguise.", author: "Mark Podolsky" },
  { quote: "A motivated seller plus a great county equals a great deal. Every time.", author: "Land Geek" },
  { quote: "The land business rewards the consistent, not the clever.", author: "Mark Podolsky" },
  { quote: "Your note portfolio is your moat. Each note is a brick in your financial fortress.", author: "Land Geek" },
  { quote: "The out-of-state owner with a delinquent tax bill is your ideal seller. They're practically begging you to buy.", author: "Mark Podolsky" },
  { quote: "Due diligence isn't optional — it's the difference between a deal and a disaster.", author: "Land Geek" },
  { quote: "Buy low, sell owner-financed. Repeat until free.", author: "Mark Podolsky" },
  { quote: "The land investor who mails the most, wins the most. Volume is the variable you control.", author: "Land Geek" },
  { quote: "One great county can fund your freedom number. Know your counties.", author: "Mark Podolsky" },
  { quote: "Passive income isn't passive at first. It's active work building a passive system.", author: "Land Geek" },
  { quote: "The seller who says no today is the seller who calls you back in 6 months.", author: "Mark Podolsky" },
  { quote: "Your AcreScore is your edge. Data beats gut feel every single time.", author: "Land Geek" },
  { quote: "Solar, recreation, agriculture — great land serves many masters and many buyers.", author: "Mark Podolsky" },
  { quote: "When you stop trading time for money, you start trading systems for freedom.", author: "Land Geek" },
  { quote: "Every rejected offer is market data. Learn from it.", author: "Mark Podolsky" },
  { quote: "The difference between a deal and a great deal is your offer price. Do the math.", author: "Land Geek" },
  { quote: "Nite Cap moment: If your passive income exceeded your expenses today, you won.", author: "Mark Podolsky" },
  { quote: "The land investor's superpower: turning unwanted land into cash flow machines.", author: "Land Geek" },
  { quote: "Build systems, not jobs. Your land business should run whether you're watching or not.", author: "Mark Podolsky" },
  { quote: "Tonight's note payment is tomorrow's freedom. Stack them up.", author: "Land Geek" },
];

function getTodaysQuote(): { quote: string; author: string } {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return NITE_CAP_QUOTES[dayOfYear % NITE_CAP_QUOTES.length];
}

// ============================================
// GET /api/night-cap/snapshot
// ============================================

router.get("/snapshot", async (req: Request, res: Response) => {
  try {
    const org = (req as any).organization || (req as any).org;
    if (!org) return res.status(401).json({ error: "Organization required" });

    const orgId = org.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Run all aggregations in parallel
    const [
      todayPaymentsResult,
      freedomDataResult,
      pipelineResult,
      campaignResult,
      leadScoringResult,
      winOfDayResult,
    ] = await Promise.allSettled([

      // Today's note payments
      db.select({
        total: sql<number>`COALESCE(SUM(amount), 0)`,
        count: sql<number>`COUNT(*)`,
      }).from(payments)
        .where(and(
          eq(payments.organizationId, orgId),
          gte(payments.paymentDate, today),
          lte(payments.paymentDate, todayEnd),
        )),

      // Freedom meter: active notes monthly income
      db.select({
        monthlyIncome: sql<number>`COALESCE(SUM(monthly_payment), 0)`,
        activeNotes: sql<number>`COUNT(*)`,
      }).from(notes)
        .where(and(
          eq(notes.organizationId, orgId),
          sql`status = 'active'`,
        )),

      // Pipeline by stage
      db.select({
        status: deals.status,
        count: sql<number>`COUNT(*)`,
      }).from(deals)
        .where(eq(deals.organizationId, orgId))
        .groupBy(deals.status),

      // Campaign pulse: responses today
      db.select({
        responses: sql<number>`COALESCE(SUM(responses_count), 0)`,
        sent: sql<number>`COALESCE(SUM(sent_count), 0)`,
      }).from(campaigns)
        .where(and(
          eq(campaigns.organizationId, orgId),
          gte(campaigns.updatedAt, today),
        )),

      // Top AcreScore leads scored today
      db.select({
        leadId: leadScoreHistory.leadId,
        score: leadScoreHistory.score,
        scoredAt: leadScoreHistory.scoredAt,
      }).from(leadScoreHistory)
        .where(and(
          eq(leadScoreHistory.organizationId, orgId),
          gte(leadScoreHistory.scoredAt, today),
        ))
        .orderBy(desc(leadScoreHistory.score))
        .limit(5),

      // Win of the day: latest closed deal
      db.select({
        id: deals.id,
        title: deals.title,
        status: deals.status,
        salePrice: deals.salePrice,
        updatedAt: deals.updatedAt,
      }).from(deals)
        .where(and(
          eq(deals.organizationId, orgId),
          eq(deals.status, "closed"),
          gte(deals.updatedAt, today),
        ))
        .orderBy(desc(deals.updatedAt))
        .limit(1),
    ]);

    // Unpack results safely
    const todayPayments = todayPaymentsResult.status === "fulfilled" ? todayPaymentsResult.value[0] : { total: 0, count: 0 };
    const freedomData = freedomDataResult.status === "fulfilled" ? freedomDataResult.value[0] : { monthlyIncome: 0, activeNotes: 0 };
    const pipeline = pipelineResult.status === "fulfilled" ? pipelineResult.value : [];
    const campaignPulse = campaignResult.status === "fulfilled" ? campaignResult.value[0] : { responses: 0, sent: 0 };
    const topLeads = leadScoringResult.status === "fulfilled" ? leadScoringResult.value : [];
    const winOfDay = winOfDayResult.status === "fulfilled" ? winOfDayResult.value[0] : null;

    // Freedom meter calculation
    const monthlyPassiveIncome = Number(freedomData.monthlyIncome) || 0;
    const monthlyExpenses = org.settings?.monthlyExpenses || org.freedomNumber || 5000;
    const freedomPercent = monthlyExpenses > 0
      ? Math.min(100, Math.round((monthlyPassiveIncome / monthlyExpenses) * 100))
      : 0;

    // Pipeline velocity: group by status
    const pipelineByStage = pipeline.reduce((acc: Record<string, number>, row: any) => {
      acc[row.status || "unknown"] = Number(row.count) || 0;
      return acc;
    }, {});

    // Total leads scored today
    const leadsScoreToday = topLeads.length;

    // Tomorrow's one thing: AI-suggested highest-impact action
    const tomorrowOneThing = computeTomorrowOneThing(pipelineByStage, topLeads, monthlyPassiveIncome, monthlyExpenses);

    res.json({
      generatedAt: new Date().toISOString(),
      tonightIncome: {
        totalCents: Math.round(Number(todayPayments.total) * 100),
        totalDollars: Number(todayPayments.total) || 0,
        paymentCount: Number(todayPayments.count) || 0,
      },
      freedomMeter: {
        monthlyPassiveIncome,
        monthlyExpenses: Number(monthlyExpenses),
        freedomPercent,
        activeNotes: Number(freedomData.activeNotes) || 0,
        distanceToFreedom: Math.max(0, Number(monthlyExpenses) - monthlyPassiveIncome),
      },
      pipelineHeat: {
        byStage: pipelineByStage,
        totalDeals: pipeline.reduce((sum: number, r: any) => sum + (Number(r.count) || 0), 0),
      },
      campaignPulse: {
        responsesToday: Number(campaignPulse.responses) || 0,
        sentToday: Number(campaignPulse.sent) || 0,
        responseRate: Number(campaignPulse.sent) > 0
          ? Math.round((Number(campaignPulse.responses) / Number(campaignPulse.sent)) * 100)
          : 0,
      },
      acreScoreToday: {
        leadsScored: leadsScoreToday,
        topLeads: topLeads.map((l: any) => ({
          leadId: l.leadId,
          score: l.score,
          scoredAt: l.scoredAt,
        })),
      },
      winOfDay: winOfDay ? {
        dealId: winOfDay.id,
        title: winOfDay.title,
        salePrice: Number(winOfDay.salePrice) || 0,
        closedAt: winOfDay.updatedAt,
      } : null,
      tomorrowOneThing,
      nitecapWisdom: getTodaysQuote(),
    });
  } catch (err: any) {
    console.error("[NightCap] Snapshot error:", err);
    res.status(500).json({ error: err.message || "Failed to load Night Cap snapshot" });
  }
});

function computeTomorrowOneThing(
  pipeline: Record<string, number>,
  topLeads: any[],
  monthlyIncome: number,
  monthlyExpenses: number
): { action: string; reason: string; priority: "high" | "medium" | "low" } {
  // Rule 1: If unscored leads exist, score them
  if (topLeads.length === 0) {
    return { action: "Run AcreScore on your pending leads", reason: "No leads were scored today. Scored leads = prioritized outreach = faster deals.", priority: "high" };
  }

  // Rule 2: If pipeline has lots of new leads but few offers
  const newLeads = pipeline.new || pipeline.prospect || 0;
  const offersSent = pipeline.offer_sent || pipeline.offers || 0;
  if (newLeads > 10 && offersSent === 0) {
    return { action: `Send blind offers to your top ${Math.min(newLeads, 20)} scored leads`, reason: `You have ${newLeads} leads in your pipeline but no offers sent. The Podolsky formula: offers out = passive income in.`, priority: "high" };
  }

  // Rule 3: If close to freedom number
  const freedomGap = monthlyExpenses - monthlyIncome;
  if (freedomGap > 0 && freedomGap < 500) {
    return { action: "Close one more note — you're $" + freedomGap.toFixed(0) + " from your freedom number", reason: "One more owner-financed deal could push you over the freedom number. Check your pipeline for deals ready to close.", priority: "high" };
  }

  // Rule 4: Default — send a campaign
  return { action: "Plan tomorrow's direct mail campaign", reason: "Consistent mailing is the engine of the land business. If you haven't mailed in the last 30 days, plan a campaign tonight.", priority: "medium" };
}

export default router;
