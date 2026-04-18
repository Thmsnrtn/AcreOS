/**
 * Evening Review Snapshot API
 *
 * Epic A: Evening Review Dashboard — Passive Income Command Center
 *
 * GET /api/night-cap/snapshot
 *   Aggregates tonight's passive income data for the Evening Review:
 *   - Today's note payments received
 *   - Freedom meter snapshot (passive income vs expenses)
 *   - Pipeline velocity by stage
 *   - Campaign pulse (today's responses)
 *   - Top AcreScore leads
 *   - Win of the day (latest closed deal or note)
 *   - Tomorrow's one thing (AI-suggested highest-impact action)
 *   - Rotating Evening Review wisdom quote
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
import { logger } from "./utils/logger";

const router = Router();

// ============================================
// EVENING REVIEW WISDOM QUOTES
// 30 curated quotes for Evening Review methodology
// ============================================

const EVENING_REVIEW_QUOTES = [
  { quote: "The real estate business isn't about buying property. It's about building a system that buys property for you.", author: "AcreOS" },
  { quote: "Every note payment that hits your account is a vote of confidence in your system.", author: "AcreOS" },
  { quote: "The freedom number isn't a dream — it's a math problem. And math problems have solutions.", author: "AcreOS" },
  { quote: "Raw land is the one asset that has never gone to zero in the history of the United States.", author: "AcreOS" },
  { quote: "Your best deal is always the next one. Keep your pipeline full.", author: "AcreOS" },
  { quote: "The mailer that goes out today is the passive income that arrives next quarter.", author: "AcreOS" },
  { quote: "Owner financing raw land is the closest thing to a legal money printing machine.", author: "AcreOS" },
  { quote: "Consistency beats intensity. Mail every month, score every lead, close every deal.", author: "AcreOS" },
  { quote: "Your freedom number is the finish line. Every note payment is a step toward it.", author: "AcreOS" },
  { quote: "The best time to mail was last month. The second best time is right now.", author: "AcreOS" },
  { quote: "Tax delinquency is not a problem. It's an opportunity wearing a disguise.", author: "AcreOS" },
  { quote: "A motivated seller plus a great county equals a great deal. Every time.", author: "AcreOS" },
  { quote: "The real estate business rewards the consistent, not the clever.", author: "AcreOS" },
  { quote: "Your note portfolio is your moat. Each note is a brick in your financial fortress.", author: "AcreOS" },
  { quote: "The out-of-state owner with a delinquent tax bill is your ideal seller.", author: "AcreOS" },
  { quote: "Due diligence isn't optional — it's the difference between a deal and a disaster.", author: "AcreOS" },
  { quote: "Buy low, sell owner-financed. Repeat until free.", author: "AcreOS" },
  { quote: "The professional who mails the most, wins the most. Volume is the variable you control.", author: "AcreOS" },
  { quote: "One great county can fund your freedom number. Know your counties.", author: "AcreOS" },
  { quote: "Passive income isn't passive at first. It's active work building a passive system.", author: "AcreOS" },
  { quote: "The seller who says no today is the seller who calls you back in 6 months.", author: "AcreOS" },
  { quote: "Your AcreScore is your edge. Data beats gut feel every single time.", author: "AcreOS" },
  { quote: "Solar, recreation, agriculture — great land serves many masters and many buyers.", author: "AcreOS" },
  { quote: "When you stop trading time for money, you start trading systems for freedom.", author: "AcreOS" },
  { quote: "Every rejected offer is market data. Learn from it.", author: "AcreOS" },
  { quote: "The difference between a deal and a great deal is your offer price. Do the math.", author: "AcreOS" },
  { quote: "If your passive income exceeded your expenses today, you won.", author: "AcreOS" },
  { quote: "The real estate professional's superpower: turning unwanted land into cash flow machines.", author: "AcreOS" },
  { quote: "Build systems, not jobs. Your business should run whether you're watching or not.", author: "AcreOS" },
  { quote: "Tonight's note payment is tomorrow's freedom. Stack them up.", author: "AcreOS" },
  { quote: "The best professionals aren't the cleverest — they're the most consistent. Mail. Score. Offer. Repeat.", author: "AcreOS" },
  { quote: "Your county is your moat. Deep knowledge of one county beats shallow knowledge of ten.", author: "AcreOS" },
  { quote: "Subdivision is the multiplier. One parcel becomes four. Four deals become passive income.", author: "AcreOS" },
  { quote: "Owner financing isn't just a payment plan — it's your passive income engine. Every note is a tiny salary.", author: "AcreOS" },
  { quote: "The seller doesn't need to like the offer. They just need to be more motivated to sell than to hold.", author: "AcreOS" },
  { quote: "Know your redemption period better than your seller does. Time creates leverage.", author: "AcreOS" },
  { quote: "Price for the payment, not the total. $199/mo closes more deals than $9,500 cash.", author: "AcreOS" },
  { quote: "Your buyer list is worth more than your property list. Build it with every single sale.", author: "AcreOS" },
  { quote: "A deal that doesn't close is just tuition. What did you learn?", author: "AcreOS" },
  { quote: "The freedom number is not a destination. It's the moment the system takes over.", author: "AcreOS" },
  { quote: "Out of state + tax delinquent + no mortgage + long ownership = the holy grail of sellers.", author: "AcreOS" },
  { quote: "You are not in the land business. You are in the marketing business that happens to sell land.", author: "AcreOS" },
  { quote: "Every failed follow-up is a future deal waiting for the right moment. Keep the sequence running.", author: "AcreOS" },
  { quote: "The evening habit: review what came in, plan what goes out, sleep knowing the system is working.", author: "AcreOS" },
  { quote: "Don't negotiate against yourself. Make the offer. Let the seller negotiate back.", author: "AcreOS" },
  { quote: "Recreational land buyers are everywhere. They're on Facebook groups, YouTube channels, dreams of escape.", author: "AcreOS" },
  { quote: "A VA doing your data entry is time arbitrage. Your highest value work is offer strategy and county selection.", author: "AcreOS" },
  { quote: "The land business scales beautifully because land doesn't call you at 2am with a broken toilet.", author: "AcreOS" },
];

function getTodaysQuote(): { quote: string; author: string } {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return EVENING_REVIEW_QUOTES[dayOfYear % EVENING_REVIEW_QUOTES.length];
}

// ============================================
// GET /api/night-cap/snapshot
// ============================================

router.get("/snapshot", async (req: Request, res: Response) => {
  try {
    const org = req.organization || req.organization;
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
    logger.error("[EveningReview] Snapshot error", err);
    res.status(500).json({ error: err.message || "Failed to load Evening Review snapshot" });
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
    return { action: `Send blind offers to your top ${Math.min(newLeads, 20)} scored leads`, reason: `You have ${newLeads} leads in your pipeline but no offers sent. The proven formula: offers out = passive income in.`, priority: "high" };
  }

  // Rule 3: If close to freedom number
  const freedomGap = monthlyExpenses - monthlyIncome;
  if (freedomGap > 0 && freedomGap < 500) {
    return { action: "Close one more note — you're $" + freedomGap.toFixed(0) + " from your freedom number", reason: "One more owner-financed deal could push you over the freedom number. Check your pipeline for deals ready to close.", priority: "high" };
  }

  // Rule 4: Default — send a campaign
  return { action: "Plan tomorrow's direct mail campaign", reason: "Consistent mailing is the engine of the real estate business. If you haven't mailed in the last 30 days, plan a campaign tonight.", priority: "medium" };
}

export default router;
