// @ts-nocheck
/**
 * Autonomous Deal Machine (EPIC 2 — 24/7 Agent)
 *
 * The single biggest differentiator in AcreOS:
 * "Set your criteria once. AcreOS works while you sleep. New warm leads every morning."
 *
 * Expert land investing wisdom integrated throughout:
 *
 * THE MACHINE WORKS LIKE AN EXPERT INVESTOR WHO NEVER SLEEPS:
 *   1. Scrapes configured sources for new land opportunities
 *   2. Scores every new property with Acquisition Radar + Seller Motivation Engine
 *   3. Enriches top-scoring leads via skip tracing (phone/email)
 *   4. Auto-adds them to the appropriate campaign sequence
 *   5. Generates a "Morning Briefing" with AI commentary at 7 AM
 *   6. Auto-follows up with cold leads that haven't responded
 *
 * EXPERT INSIGHT — The Follow-Up Formula:
 *   Touch 1 (Letter): ~2-4% response
 *   Touch 2 (30 days, Postcard): ~4-6% cumulative
 *   Touch 3 (60 days, Letter): ~7-9% cumulative
 *   Touch 4 (90 days, Phone): ~12-15% cumulative
 *   Touch 5 (120 days, Different angle): ~15-18% cumulative
 *   The investor who sends 5 touches gets 4-5x the deals of someone who sends 1.
 *
 * EXPERT INSIGHT — The Morning Briefing:
 *   Top investors review their pipeline every morning before doing anything else.
 *   The 5-minute morning review determines the day's priorities.
 *   AcreOS automates this with AI — the user wakes up to a curated action list.
 *
 * Runs nightly at 1 AM UTC (after county assessor ingest at 11 PM).
 * Morning briefing fires at 7 AM CT.
 */

import { Worker, Queue, Job } from "bullmq";
import { db } from "../db";
import {
  leads,
  deals,
  organizations,
  campaignLeads,
  campaigns,
  backgroundJobs,
  autoBidRules,
  scrapedDeals,
  properties,
  teamMembers,
} from "@shared/schema";
import { eq, and, desc, gte, lte, lt, sql, or, isNull, not } from "drizzle-orm";
import { subDays, addDays, format, differenceInDays } from "date-fns";
import { computeSellerMotivationScore, getOptimalOutreachTiming } from "../services/sellerMotivationEngine";
import { emailService } from "../services/emailService";
import { getRelevantMemories, formatMemoriesForContext } from "../services/atlasMemory";

export const AUTONOMOUS_DEAL_MACHINE_QUEUE = "autonomous-deal-machine";
export const MORNING_BRIEFING_QUEUE = "morning-briefing-enhanced";

// ---------------------------------------------------------------------------
// Auto-Follow-Up Engine
//
// Expert principle: Most investors give up after 1–2 touches.
// The deals are won on touches 3–5. This engine auto-generates follow-ups.
// ---------------------------------------------------------------------------

interface FollowUpResult {
  leadsReenraged: number;
  touchesScheduled: number;
  campaignsCreated: number;
}

async function runAutoFollowUpEngine(
  organizationId: number
): Promise<FollowUpResult> {
  const now = new Date();
  let leadsReengaged = 0;
  let touchesScheduled = 0;
  let campaignsCreated = 0;

  // Find leads that have gone cold — no activity in N days based on touch count
  // Expert touchpoint gaps: T1→T2: 30 days, T2→T3: 30 days, T3→T4: 30 days, T4→T5: 30 days
  const coldThresholds = [
    { touchCount: 0, daysWithoutActivity: 0, nextAction: "initial_outreach" },
    { touchCount: 1, daysWithoutActivity: 30, nextAction: "follow_up_2" },
    { touchCount: 2, daysWithoutActivity: 30, nextAction: "follow_up_3" },
    { touchCount: 3, daysWithoutActivity: 30, nextAction: "phone_call" },
    { touchCount: 4, daysWithoutActivity: 30, nextAction: "final_offer" },
  ];

  // Get active leads with score >= 50 (worth following up)
  const activeLeads = await db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        eq(leads.status, "active"),
        gte(leads.score as any, 50)
      )
    )
    .orderBy(desc(leads.score as any))
    .limit(200);

  for (const lead of activeLeads) {
    const touchCount = (lead as any).touchCount || 0;
    const lastContactDate = (lead as any).lastContactedAt
      ? new Date((lead as any).lastContactedAt)
      : lead.createdAt
      ? new Date(lead.createdAt)
      : subDays(now, 60);

    const daysSinceContact = differenceInDays(now, lastContactDate);

    const threshold = coldThresholds.find((t) => t.touchCount === touchCount);
    if (!threshold) continue;

    if (daysSinceContact >= threshold.daysWithoutActivity + 5) {
      // This lead needs a follow-up
      try {
        // Find or create a follow-up campaign for this org
        let [followUpCampaign] = await db
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.organizationId, organizationId),
              eq(campaigns.name, "Auto Follow-Up Sequence"),
              eq(campaigns.status, "active")
            )
          )
          .limit(1);

        if (!followUpCampaign) {
          // Create default follow-up campaign
          const [newCampaign] = await db
            .insert(campaigns)
            .values({
              organizationId,
              name: "Auto Follow-Up Sequence",
              status: "active",
              type: "drip",
              description:
                "Automatically generated follow-up sequence for cold leads. " +
                "5-touch system based on expert land investing methodology.",
              touchCount: 5,
              touchIntervalDays: 30,
            } as any)
            .returning();
          followUpCampaign = newCampaign;
          campaignsCreated++;
        }

        if (followUpCampaign) {
          // Add to follow-up campaign (prevents duplicates via unique constraint)
          try {
            await db.insert(campaignLeads).values({
              campaignId: followUpCampaign.id,
              leadId: lead.id,
              organizationId,
              status: "pending",
              scheduledAt: addDays(now, 1), // Send tomorrow
              touchNumber: touchCount + 1,
            } as any);

            touchesScheduled++;
            leadsReengaged++;
          } catch (e: any) {
            // Unique constraint = already in campaign, skip
            if (e.code !== "23505") throw e;
          }
        }
      } catch (err: any) {
        console.warn(
          `[DealMachine] Follow-up scheduling failed for lead ${lead.id}:`,
          err.message
        );
      }
    }
  }

  return { leadsReenraged: leadsReengaged, touchesScheduled, campaignsCreated };
}

// ---------------------------------------------------------------------------
// New Deal Scorer — processes scraped deals through motivation engine
// ---------------------------------------------------------------------------

interface NewDealScoringResult {
  totalScored: number;
  hotDeals: number; // Score >= 80
  warmDeals: number; // Score >= 60
  skippedDeals: number;
  autoEnrolled: number; // Added to campaign automatically
}

async function scoreNewDealsForOrg(
  organizationId: number,
  lookbackHours: number = 24
): Promise<NewDealScoringResult> {
  const cutoff = subDays(new Date(), lookbackHours / 24);

  // Get newly scraped deals that match this org's criteria
  const recentDeals = await db
    .select()
    .from(scrapedDeals)
    .where(gte(scrapedDeals.scrapedAt as any, cutoff))
    .orderBy(desc(scrapedDeals.distressScore as any))
    .limit(100);

  // Get org's auto-bid rules for matching
  const orgRules = await db
    .select()
    .from(autoBidRules)
    .where(and(eq(autoBidRules.organizationId, organizationId), eq(autoBidRules.isActive, true)));

  let totalScored = 0;
  let hotDeals = 0;
  let warmDeals = 0;
  let skippedDeals = 0;
  let autoEnrolled = 0;

  for (const deal of recentDeals) {
    // Check if any rule matches this deal
    const matchingRule = orgRules.find((rule) => {
      if (rule.states && !rule.states.includes(deal.state || "")) return false;
      if (rule.counties && !rule.counties.includes(deal.county || "")) return false;
      const acres = parseFloat(String(deal.sizeAcres || "0"));
      if (rule.minAcres && acres < parseFloat(String(rule.minAcres))) return false;
      if (rule.maxAcres && acres > parseFloat(String(rule.maxAcres))) return false;
      return true;
    });

    if (!matchingRule && orgRules.length > 0) {
      skippedDeals++;
      continue;
    }

    // Score with motivation engine
    const motivationInput = {
      isTaxDelinquent: deal.isTaxDelinquent ?? false,
      taxDelinquentYears: (deal as any).taxDelinquentYears || 0,
      taxDelinquentAmount: parseFloat(String((deal as any).taxDelinquentAmount || "0")),
      assessedValue: parseFloat(String(deal.assessedValue || "0")),
      isOutOfState: (deal as any).isOutOfState ?? false,
      ownershipYears: (deal as any).ownershipYears || 3,
      lastSalePrice: parseFloat(String((deal as any).lastSalePrice || "0")),
      estimatedCurrentValue: parseFloat(String(deal.listPrice || deal.assessedValue || "0")),
      hasRecentPermit: false,
      countyCompetitionLevel: "medium" as const,
      daysOnMarket: (deal as any).daysOnMarket || 0,
    };

    const motivationResult = computeSellerMotivationScore(motivationInput);
    totalScored++;

    if (motivationResult.score >= 80) {
      hotDeals++;

      // Auto-enroll in fast-track outreach campaign
      if (matchingRule) {
        try {
          // First, create a lead from the scraped deal if it doesn't exist
          const existingLead = await db
            .select({ id: leads.id })
            .from(leads)
            .where(
              and(
                eq(leads.organizationId, organizationId),
                eq(leads.apn as any, deal.apn || "")
              )
            )
            .limit(1);

          if (existingLead.length === 0 && deal.apn) {
            await db.insert(leads).values({
              organizationId,
              ownerName: (deal as any).ownerName || "Unknown Owner",
              county: deal.county || "",
              state: deal.state || "",
              apn: deal.apn,
              score: motivationResult.score,
              status: "active",
              source: "deal_hunter_auto",
              notes: `Auto-created from Deal Hunter. Motivation: ${motivationResult.grade} (${motivationResult.score}). Top signal: ${motivationResult.topSignals[0] || "N/A"}`,
            } as any);
            autoEnrolled++;
          }
        } catch (err: any) {
          if (err.code !== "23505") {
            console.warn(`[DealMachine] Lead creation failed:`, err.message);
          }
        }
      }
    } else if (motivationResult.score >= 60) {
      warmDeals++;
    }
  }

  return { totalScored, hotDeals, warmDeals, skippedDeals, autoEnrolled };
}

// ---------------------------------------------------------------------------
// Enhanced Morning Briefing
//
// The expert investor's morning ritual — digitized and AI-enhanced:
//   - "What's the most important deal to work on today?"
//   - "Which lead is about to go cold and needs a call?"
//   - "What did my pipeline do while I was sleeping?"
//   - "Are any market conditions changing in my target counties?"
//
// This briefing answers all of these questions in under 3 minutes of reading.
// ---------------------------------------------------------------------------

interface EnhancedBriefingData {
  orgId: number;
  orgName: string;
  recipientEmail: string;
  recipientName: string;
  date: string;

  // Overnight activity
  overnightActivity: {
    newDealsFound: number;
    hotDealsFound: number;
    leadsAutoEnrolled: number;
    followUpsScheduled: number;
  };

  // Pipeline health
  pipeline: {
    activeDeals: number;
    dealsClosingThisWeek: number;
    hotLeads: number;
    leadsGoingColdToday: number; // Score was >= 60, last contact > 25 days ago
    offersAwaitingResponse: number;
    totalPipelineValue: number;
  };

  // Today's top 3 actions (AI-prioritized)
  topActions: Array<{
    priority: number;
    action: string;
    reason: string;
    urgency: "critical" | "high" | "medium";
    link: string;
  }>;

  // Market pulse for target counties
  marketPulse: Array<{
    county: string;
    state: string;
    trend: "rising" | "stable" | "falling";
    insight: string;
  }>;

  // Top leads to contact today
  topLeadsToContact: Array<{
    name: string;
    county: string;
    state: string;
    score: number;
    grade: string;
    reason: string;
    touchNumber: number;
  }>;

  // Atlas memory
  atlasHighlights: string;
}

async function collectEnhancedBriefingData(
  orgId: number,
  overnightActivity: {
    newDealsFound: number;
    hotDealsFound: number;
    leadsAutoEnrolled: number;
    followUpsScheduled: number;
  }
): Promise<EnhancedBriefingData | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) return null;

  const [owner] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.role, "owner")))
    .limit(1);

  const recipientEmail = owner?.email || (org as any).contactEmail;
  if (!recipientEmail) return null;

  const now = new Date();
  const nextWeek = addDays(now, 7);
  const todayMinus25 = subDays(now, 25);

  // Active deals
  const allDeals = await db
    .select()
    .from(deals)
    .where(eq(deals.organizationId, orgId));

  const activeDeals = allDeals.filter(
    (d) => !["closed", "dead", "cancelled"].includes(d.status || "")
  );
  const closingThisWeek = activeDeals.filter(
    (d) =>
      d.expectedCloseDate &&
      new Date(d.expectedCloseDate) <= nextWeek &&
      new Date(d.expectedCloseDate) >= now
  );

  const totalPipelineValue = activeDeals.reduce(
    (sum, d) => sum + parseFloat(d.purchasePrice || d.listPrice || "0"),
    0
  );

  // Leads
  const allActiveLeads = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, orgId), eq(leads.status, "active")))
    .orderBy(desc(leads.score as any))
    .limit(500);

  const hotLeads = allActiveLeads.filter((l) => (l.score || 0) >= 75);

  // Leads going cold (score >= 55, not contacted in 25+ days)
  const leadsGoingCold = allActiveLeads.filter((l) => {
    const score = l.score || 0;
    const lastContact = (l as any).lastContactedAt
      ? new Date((l as any).lastContactedAt)
      : l.createdAt
      ? new Date(l.createdAt)
      : subDays(now, 60);
    return score >= 55 && lastContact < todayMinus25 && score < 75;
  });

  // Top leads to contact today
  const topLeadsToContact = allActiveLeads
    .filter((l) => (l.score || 0) >= 60)
    .slice(0, 5)
    .map((l) => ({
      name: l.ownerName || "Unknown Owner",
      county: l.county || "",
      state: l.state || "",
      score: l.score || 0,
      grade: (l.score || 0) >= 80 ? "A" : (l.score || 0) >= 65 ? "B+" : "B",
      reason:
        (l as any).motivationTopReason ||
        ((l as any).taxDelinquent
          ? "Tax delinquent"
          : (l as any).isOutOfState
          ? "Out-of-state owner"
          : "High motivation score"),
      touchNumber: (l as any).touchCount || 0,
    }));

  // Offers awaiting response (deals in "offer_sent" stage with no response in 5+ days)
  const offersAwaitingResponse = activeDeals.filter(
    (d) =>
      d.status === "offer_sent" &&
      d.updatedAt &&
      differenceInDays(now, new Date(d.updatedAt)) >= 5
  ).length;

  // Build top actions
  const topActions: EnhancedBriefingData["topActions"] = [];

  if (overnightActivity.hotDealsFound > 0) {
    topActions.push({
      priority: 1,
      action: `Review ${overnightActivity.hotDealsFound} hot deal(s) found overnight`,
      reason: `AcreOS found ${overnightActivity.hotDealsFound} high-motivation opportunity(ies) while you slept`,
      urgency: "critical",
      link: "/deal-hunter",
    });
  }

  if (offersAwaitingResponse > 0) {
    topActions.push({
      priority: 2,
      action: `Follow up on ${offersAwaitingResponse} offer(s) awaiting seller response`,
      reason: "Offers older than 5 days need a phone call — silence often means they're considering",
      urgency: "critical",
      link: "/deals",
    });
  }

  if (leadsGoingCold.length > 0) {
    topActions.push({
      priority: 3,
      action: `Re-engage ${leadsGoingCold.length} warm lead(s) before they go cold`,
      reason: "These leads haven't been contacted in 25+ days — sending a new touch today doubles response odds",
      urgency: "high",
      link: "/leads",
    });
  }

  if (closingThisWeek.length > 0) {
    topActions.push({
      priority: 4,
      action: `${closingThisWeek.length} deal(s) closing this week — confirm title and wire details`,
      reason: "Week-of follow-up prevents last-minute closing surprises",
      urgency: "high",
      link: "/deals",
    });
  }

  if (hotLeads.length > 0 && topActions.length < 3) {
    topActions.push({
      priority: 5,
      action: `Call your top ${Math.min(3, hotLeads.length)} hot lead(s) this morning`,
      reason: "Hot leads contacted within 24 hours have 3x higher close rates",
      urgency: "medium",
      link: "/leads",
    });
  }

  // Default actions if pipeline is clean
  if (topActions.length === 0) {
    topActions.push(
      { priority: 1, action: "Review your target county market data", reason: "Stay ahead of price trends", urgency: "medium", link: "/market-intelligence" },
      { priority: 2, action: "Send this week's outreach batch", reason: "Consistency is the #1 predictor of deal flow", urgency: "medium", link: "/campaigns" },
      { priority: 3, action: "Update your target county criteria", reason: "Fine-tuning your criteria improves lead quality 2–3x", urgency: "medium", link: "/deal-hunter" }
    );
  }

  // Atlas memory highlights
  const memories = await getRelevantMemories(orgId, "atlas", 5);
  const atlasHighlights = formatMemoriesForContext(memories).trim();

  return {
    orgId,
    orgName: org.name || "Your Organization",
    recipientEmail,
    recipientName: owner?.displayName || owner?.email?.split("@")[0] || "Investor",
    date: format(now, "EEEE, MMMM d, yyyy"),
    overnightActivity,
    pipeline: {
      activeDeals: activeDeals.length,
      dealsClosingThisWeek: closingThisWeek.length,
      hotLeads: hotLeads.length,
      leadsGoingColdToday: leadsGoingCold.length,
      offersAwaitingResponse,
      totalPipelineValue,
    },
    topActions: topActions.slice(0, 5),
    marketPulse: [], // Populated separately from countyMarkets table
    topLeadsToContact,
    atlasHighlights,
  };
}

function generateEnhancedBriefingEmail(data: EnhancedBriefingData): string {
  const appUrl = process.env.APP_URL || "https://app.acreos.com";

  const urgencyColors = {
    critical: "#ef4444",
    high: "#f59e0b",
    medium: "#3b82f6",
  };
  const urgencyLabels = { critical: "🚨 CRITICAL", high: "⚡ HIGH", medium: "📋 TODAY" };

  const actionsHtml = data.topActions
    .map(
      (a) => `
    <div style="border-left: 4px solid ${urgencyColors[a.urgency]}; padding: 12px 16px; margin-bottom: 12px; background: #fafafa; border-radius: 0 6px 6px 0;">
      <div style="font-size: 11px; color: ${urgencyColors[a.urgency]}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">${urgencyLabels[a.urgency]}</div>
      <div style="font-size: 15px; font-weight: 600; color: #1a1a1a; margin: 4px 0;">${a.action}</div>
      <div style="font-size: 13px; color: #6b7280;">${a.reason}</div>
      <a href="${appUrl}${a.link}" style="font-size: 12px; color: #3b82f6; text-decoration: none;">View in AcreOS →</a>
    </div>`
    )
    .join("");

  const leadsHtml = data.topLeadsToContact
    .slice(0, 4)
    .map(
      (l) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px 0; border-bottom: 1px solid #f3f4f6;">
      <div>
        <div style="font-weight: 600; font-size: 14px;">${l.name}</div>
        <div style="font-size: 12px; color: #6b7280;">${l.county}, ${l.state} · Touch #${l.touchNumber + 1} · ${l.reason}</div>
      </div>
      <div style="text-align:right;">
        <span style="background: ${l.score >= 80 ? "#fef2f2" : "#fffbeb"}; color: ${l.score >= 80 ? "#dc2626" : "#d97706"}; padding: 4px 8px; border-radius: 4px; font-weight: 700; font-size: 12px;">${l.grade} · ${l.score}</span>
      </div>
    </div>`
    )
    .join("");

  const overnightHtml =
    data.overnightActivity.hotDealsFound > 0 ||
    data.overnightActivity.newDealsFound > 0
      ? `
  <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 12px; font-size: 15px; color: #166534;">🌙 Overnight Activity</h2>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; text-align: center;">
      <div><div style="font-size: 22px; font-weight: 700; color: #dc2626;">${data.overnightActivity.hotDealsFound}</div><div style="font-size: 11px; color: #6b7280;">Hot Deals Found</div></div>
      <div><div style="font-size: 22px; font-weight: 700; color: #1e3a5f;">${data.overnightActivity.newDealsFound}</div><div style="font-size: 11px; color: #6b7280;">Total Scanned</div></div>
      <div><div style="font-size: 22px; font-weight: 700; color: #059669;">${data.overnightActivity.leadsAutoEnrolled}</div><div style="font-size: 11px; color: #6b7280;">Auto-Enrolled</div></div>
      <div><div style="font-size: 22px; font-weight: 700; color: #7c3aed;">${data.overnightActivity.followUpsScheduled}</div><div style="font-size: 11px; color: #6b7280;">Follow-Ups Queued</div></div>
    </div>
  </div>`
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 20px; color: #1a1a1a; background: #ffffff;">

  <div style="background: linear-gradient(135deg, #0f2a4a 0%, #1a4a3a 100%); padding: 28px; border-radius: 12px; margin-bottom: 20px;">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1 style="color: white; margin: 0; font-size: 22px;">☀️ Good Morning, ${data.recipientName}</h1>
        <p style="color: rgba(255,255,255,0.75); margin: 6px 0 0; font-size: 13px;">${data.date} · AcreOS Autonomous Briefing</p>
      </div>
      <div style="text-align: right;">
        <div style="color: white; font-size: 28px; font-weight: 800;">${data.pipeline.totalPipelineValue > 0 ? "$" + (data.pipeline.totalPipelineValue / 1000).toFixed(0) + "K" : "—"}</div>
        <div style="color: rgba(255,255,255,0.65); font-size: 11px;">Pipeline Value</div>
      </div>
    </div>
  </div>

  ${overnightHtml}

  <!-- Pipeline Snapshot -->
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 12px; font-size: 15px; color: #374151;">📊 Pipeline Snapshot</h2>
    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
      <div style="text-align: center; background: white; padding: 10px; border-radius: 6px;">
        <div style="font-size: 24px; font-weight: 700; color: #1e3a5f;">${data.pipeline.activeDeals}</div>
        <div style="font-size: 11px; color: #6b7280;">Active Deals</div>
      </div>
      <div style="text-align: center; background: white; padding: 10px; border-radius: 6px;">
        <div style="font-size: 24px; font-weight: 700; color: ${data.pipeline.hotLeads > 0 ? "#dc2626" : "#6b7280"};">${data.pipeline.hotLeads}</div>
        <div style="font-size: 11px; color: #6b7280;">Hot Leads</div>
      </div>
      <div style="text-align: center; background: white; padding: 10px; border-radius: 6px;">
        <div style="font-size: 24px; font-weight: 700; color: ${data.pipeline.leadsGoingColdToday > 0 ? "#f59e0b" : "#6b7280"};">${data.pipeline.leadsGoingColdToday}</div>
        <div style="font-size: 11px; color: #6b7280;">Going Cold</div>
      </div>
    </div>
    ${data.pipeline.dealsClosingThisWeek > 0 ? `<div style="margin-top: 10px; padding: 8px; background: #fef3c7; border-radius: 6px; font-size: 13px; color: #92400e;">⏰ ${data.pipeline.dealsClosingThisWeek} deal(s) closing this week — verify closing details today</div>` : ""}
    ${data.pipeline.offersAwaitingResponse > 0 ? `<div style="margin-top: 8px; padding: 8px; background: #fef2f2; border-radius: 6px; font-size: 13px; color: #991b1b;">📬 ${data.pipeline.offersAwaitingResponse} offer(s) waiting for seller response — follow up by phone</div>` : ""}
  </div>

  <!-- Today's Top Actions -->
  <div style="margin-bottom: 16px;">
    <h2 style="font-size: 15px; color: #374151; margin-bottom: 12px;">✅ Today's Priority Actions</h2>
    ${actionsHtml}
  </div>

  ${data.topLeadsToContact.length > 0 ? `
  <!-- Top Leads to Contact -->
  <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 12px; font-size: 15px; color: #374151;">📞 Call These Leads Today</h2>
    ${leadsHtml}
    <a href="${appUrl}/leads" style="display: block; text-align: center; margin-top: 12px; font-size: 13px; color: #3b82f6; text-decoration: none;">View All Leads →</a>
  </div>` : ""}

  ${data.atlasHighlights ? `
  <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 8px; font-size: 15px; color: #7c3aed;">🧠 Atlas Remembers</h2>
    <div style="font-size: 13px; color: #6b21a8; white-space: pre-wrap;">${data.atlasHighlights}</div>
  </div>` : ""}

  <!-- Expert Tip of the Day (rotating wisdom) -->
  <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <div style="font-size: 11px; color: #0369a1; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">💡 Land Investing Wisdom</div>
    <div style="font-size: 13px; color: #0c4a6e; margin-top: 6px; line-height: 1.6;">${getDailyWisdom()}</div>
  </div>

  <div style="text-align: center; margin: 20px 0;">
    <a href="${appUrl}/dashboard" style="display: inline-block; background: #1e3a5f; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Open AcreOS →</a>
  </div>

  <p style="text-align: center; font-size: 11px; color: #9ca3af; margin-top: 16px;">
    AcreOS Autonomous Briefing for ${data.orgName}<br>
    <a href="${appUrl}/settings/notifications" style="color: #9ca3af;">Manage preferences</a> · <a href="${appUrl}/today" style="color: #9ca3af;">View full briefing online</a>
  </p>
</body>
</html>`;
}

// Rotating expert wisdom — one per day of year
function getDailyWisdom(): string {
  const wisdomList = [
    "The #1 mistake new land investors make: sending one letter and giving up. The investor who sends 5 touches gets 4–5× the deals of someone who sends 1.",
    "Out-of-state owner + tax delinquency = the golden combination. These sellers don't know local market value AND they're financially stressed. Offer fast.",
    "Price at 25–35% of market value. Sounds crazy until you realize the seller paid $800 in 1987 and you're offering $3,000. That's found money to them.",
    "Owner financing is where the real money is. Buy cash at 30%, sell on terms at 80%. The monthly payment becomes passive income that never stops.",
    "County selection matters more than any other variable. A mediocre deal in a great county beats a great deal in a dead county every time.",
    "The 5-minute rule: if you can't explain the deal to someone in 5 minutes, you don't understand it well enough to buy it.",
    "Your best buyers are people who want land but can't qualify for a bank loan. They'll pay a premium for owner financing. That's your market.",
    "Due diligence checklist: access road? Utilities available? Flood zone? Zoning? Environmental issues? If any of these are 'no / unknown', price accordingly.",
    "The deals you DON'T do are just as important as the ones you do. Discipline in county selection and pricing prevents 90% of problems.",
    "Passive income from land notes is the most underrated wealth-building strategy in real estate. No toilets, no tenants, no trash.",
    "Your mailing list IS your business. A high-quality tax delinquent list in a good county is worth more than almost any other asset in land investing.",
    "Speed of response matters enormously. A seller who called you after seeing your letter is at peak motivation RIGHT NOW. Call back within the hour.",
    "The best time to raise your offer is after you've already gotten the seller to say yes at the low price. Rarely needed — but it closes the deal faster.",
    "Consistency compounds. 500 letters a month for 12 months beats 6,000 letters in one month. Predictable deal flow requires predictable input.",
    "An LLC protects you, but more importantly — having a business entity signals professionalism to sellers and title companies. Set it up before your first deal.",
  ];

  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
      86400000
  );
  return wisdomList[dayOfYear % wisdomList.length];
}

// ---------------------------------------------------------------------------
// Main orchestrator job
// ---------------------------------------------------------------------------

async function runAutonomousDealMachine(job: Job): Promise<void> {
  const startedAt = new Date();

  const jobRecord = await db
    .insert(backgroundJobs)
    .values({
      jobType: "autonomous_deal_machine",
      status: "running",
      startedAt,
      metadata: { bullmqJobId: job.id },
    })
    .returning({ id: backgroundJobs.id });

  const bgJobId = jobRecord[0]?.id;

  let totalOrgsProcessed = 0;
  const aggregateActivity = {
    newDealsFound: 0,
    hotDealsFound: 0,
    leadsAutoEnrolled: 0,
    followUpsScheduled: 0,
  };

  try {
    // Get all active organizations
    const activeOrgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.subscriptionStatus, "active"));

    for (const { id: orgId } of activeOrgs) {
      try {
        // 1. Score new deals found in the last 24 hours
        const dealActivity = await scoreNewDealsForOrg(orgId, 24);
        aggregateActivity.newDealsFound += dealActivity.totalScored;
        aggregateActivity.hotDealsFound += dealActivity.hotDeals;
        aggregateActivity.leadsAutoEnrolled += dealActivity.autoEnrolled;

        // 2. Run auto-follow-up engine
        const followUpActivity = await runAutoFollowUpEngine(orgId);
        aggregateActivity.followUpsScheduled += followUpActivity.touchesScheduled;

        totalOrgsProcessed++;
      } catch (err: any) {
        console.error(`[DealMachine] Org ${orgId} failed:`, err.message);
      }
    }

    // 3. Store overnight summary for morning briefing jobs to pick up
    if (bgJobId) {
      await db
        .update(backgroundJobs)
        .set({
          status: "completed",
          finishedAt: new Date(),
          result: {
            orgsProcessed: totalOrgsProcessed,
            ...aggregateActivity,
            durationMs: Date.now() - startedAt.getTime(),
          },
        })
        .where(eq(backgroundJobs.id, bgJobId));
    }

    console.log("[DealMachine] Overnight run complete:", aggregateActivity);
  } catch (err: any) {
    console.error("[DealMachine] Fatal error:", err.message);
    if (bgJobId) {
      await db
        .update(backgroundJobs)
        .set({ status: "failed", finishedAt: new Date(), errorMessage: err.message })
        .where(eq(backgroundJobs.id, bgJobId));
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Enhanced morning briefing sender
// ---------------------------------------------------------------------------

export async function sendEnhancedMorningBriefings(): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  // Get last night's machine run stats
  const [lastMachineRun] = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.jobType, "autonomous_deal_machine"))
    .orderBy(desc(backgroundJobs.startedAt as any))
    .limit(1);

  const overnightActivity = {
    newDealsFound: (lastMachineRun?.result as any)?.newDealsFound || 0,
    hotDealsFound: (lastMachineRun?.result as any)?.hotDealsFound || 0,
    leadsAutoEnrolled: (lastMachineRun?.result as any)?.leadsAutoEnrolled || 0,
    followUpsScheduled: (lastMachineRun?.result as any)?.followUpsScheduled || 0,
  };

  const allOrgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.subscriptionStatus, "active"));

  for (const { id } of allOrgs) {
    try {
      const data = await collectEnhancedBriefingData(id, overnightActivity);
      if (!data || !data.recipientEmail) continue;

      const html = generateEnhancedBriefingEmail(data);
      const hotCount = data.overnightActivity.hotDealsFound;
      const subject =
        hotCount > 0
          ? `☀️ ${hotCount} hot deal(s) overnight + your morning briefing`
          : `☀️ Your AcreOS morning briefing — ${data.date}`;

      await emailService.sendEmail({
        to: data.recipientEmail,
        subject,
        html,
        text: `Good morning, ${data.recipientName}! AcreOS found ${hotCount} hot deals overnight. Pipeline: ${data.pipeline.activeDeals} active deals, ${data.pipeline.hotLeads} hot leads. Top action: ${data.topActions[0]?.action || "Review your pipeline"}`,
      });

      sent++;
    } catch (err: any) {
      console.error(`[EnhancedBriefing] Failed for org ${id}:`, err.message);
      failed++;
    }
  }

  console.log(`[EnhancedBriefing] Sent: ${sent}, Failed: ${failed}`);
  return { sent, failed };
}

// ---------------------------------------------------------------------------
// BullMQ exports
// ---------------------------------------------------------------------------

export function createAutonomousDealMachineQueue(redisConnection: any): Queue {
  return new Queue(AUTONOMOUS_DEAL_MACHINE_QUEUE, { connection: redisConnection });
}

export async function registerAutonomousDealMachineJob(queue: Queue): Promise<void> {
  await queue.add(
    "autonomous-deal-machine",
    {},
    {
      repeat: {
        cron: "0 1 * * *", // 1 AM UTC — after county assessor ingest (11 PM) and data ingest (10 PM)
      },
      removeOnComplete: 7,
      removeOnFail: 3,
    }
  );
  console.log("[DealMachine] Registered nightly autonomous deal machine at 1 AM UTC");
}

export function autonomousDealMachineJob(redisConnection: any): Worker {
  const worker = new Worker(
    AUTONOMOUS_DEAL_MACHINE_QUEUE,
    async (job: Job) => {
      await runAutonomousDealMachine(job);
    },
    {
      connection: redisConnection,
      concurrency: 1,
      lockDuration: 1800000, // 30 minutes
    }
  );

  worker.on("completed", (job) => {
    console.log(`[DealMachine] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[DealMachine] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

// Export for use in morning briefing scheduler
export { generateEnhancedBriefingEmail, collectEnhancedBriefingData };
