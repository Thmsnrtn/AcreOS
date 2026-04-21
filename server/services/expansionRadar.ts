/**
 * Expansion Radar — proactive upsell identification.
 *
 * Sophie handles retention (keeping customers). Onboarding autonomy
 * handles activation (getting new customers engaged). This service
 * is the third leg: Forge's proactive look at existing healthy
 * customers to find who's ready to pay more.
 *
 * Not "upsell the heaviest users" — that's obvious. The radar finds
 * non-obvious candidates: steady-but-growing accounts, accounts with
 * specific feature-adoption patterns, accounts whose deal velocity
 * has inflected upward.
 *
 * Scoring (0-100, composite):
 *   - Tenure (30 points max): longer = more leverage, caps at 180 days
 *   - Activity trend (30 points max): last 30 days vs prior 30
 *     days of lead + deal volume
 *   - Revenue trajectory (20 points max): last 60 days payment
 *     consistency and growth
 *   - Engagement (20 points max): days active in last 30
 *
 * Anyone at 60+ is a candidate. Top 5 surface weekly; founder approves
 * → an upgrade offer is queued (email + in-app nudge, both sim-wrapped).
 *
 * Tier-upgrade proposal logic is simple for the MVP:
 *   free → starter
 *   starter → pro
 *   pro → scale
 *   scale → enterprise
 *   enterprise → (nothing to propose; surface for renewal talk instead)
 *
 * Cost: no LLM calls — pure data rules. Free to run weekly.
 */

import { db } from "../db";
import {
  expansionCandidates,
  organizations,
  leads,
  deals,
  payments,
  activityLog,
} from "@shared/schema";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const TIER_LADDER: Record<string, string> = {
  free: "starter",
  starter: "pro",
  pro: "scale",
  scale: "enterprise",
  // enterprise intentionally omitted — no higher tier, renewal-talk instead
};

const TIER_PRICES_CENTS: Record<string, number> = {
  free: 0,
  starter: 4900,
  pro: 9900,
  scale: 19900,
  enterprise: 49900,
};

const CANDIDATE_THRESHOLD = 60;

export interface CandidateScan {
  weekKey: string;
  scanned: number;
  qualifiers: number;
  topCandidates: number[];
}

export async function runWeeklyExpansionScan(): Promise<CandidateScan> {
  const weekKey = isoWeekKey(new Date());

  // Skip if we've already scanned this week — idempotent.
  const existing = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(expansionCandidates)
    .where(eq(expansionCandidates.weekKey, weekKey));
  if (Number(existing[0]?.c ?? 0) > 0) {
    logger.info(`[expansionRadar] week ${weekKey} already scanned, skipping`);
    return { weekKey, scanned: 0, qualifiers: 0, topCandidates: [] };
  }

  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      subscriptionTier: organizations.subscriptionTier,
      subscriptionStatus: organizations.subscriptionStatus,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(sql`${organizations.subscriptionStatus} IN ('active', 'trialing')`);

  const scored: Array<{
    orgId: number;
    score: number;
    signals: Record<string, any>;
    reasoning: string;
    proposedTier: string | null;
    estimatedMrrLiftCents: number;
    currentTier: string;
  }> = [];

  for (const org of orgs) {
    // Skip enterprise — no tier to propose.
    const proposedTier = TIER_LADDER[org.subscriptionTier];
    if (!proposedTier) continue;

    const { score, signals, reasoning } = await scoreOrg(org);
    if (score < CANDIDATE_THRESHOLD) continue;

    const currentPrice = TIER_PRICES_CENTS[org.subscriptionTier] ?? 0;
    const proposedPrice = TIER_PRICES_CENTS[proposedTier] ?? 0;
    const lift = Math.max(0, proposedPrice - currentPrice);

    scored.push({
      orgId: org.id,
      score,
      signals,
      reasoning,
      proposedTier,
      estimatedMrrLiftCents: lift,
      currentTier: org.subscriptionTier,
    });
  }

  // Rank by score; take top 5.
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);

  for (const c of top) {
    await db.insert(expansionCandidates).values({
      organizationId: c.orgId,
      weekKey,
      currentTier: c.currentTier,
      proposedTier: c.proposedTier!,
      score: c.score,
      signals: c.signals,
      reasoning: c.reasoning,
      estimatedMrrLiftCents: c.estimatedMrrLiftCents,
      status: "proposed",
    });
  }

  logger.info(
    `[expansionRadar] week ${weekKey}: ${scored.length} qualified, top ${top.length} filed`,
  );

  return {
    weekKey,
    scanned: orgs.length,
    qualifiers: scored.length,
    topCandidates: top.map((c) => c.orgId),
  };
}

async function scoreOrg(org: {
  id: number;
  name: string;
  subscriptionTier: string;
  createdAt: Date | null;
}): Promise<{
  score: number;
  signals: Record<string, any>;
  reasoning: string;
}> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const priorThirty = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  // Tenure score
  const tenureDays = org.createdAt
    ? Math.floor((now.getTime() - new Date(org.createdAt).getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  const tenureScore = Math.min(30, Math.round((tenureDays / 180) * 30));

  // Activity trend
  const [lead30, lead60_30] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.organizationId, org.id), gte(leads.createdAt, thirtyDaysAgo))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(leads)
      .where(
        and(
          eq(leads.organizationId, org.id),
          gte(leads.createdAt, priorThirty),
          lt(leads.createdAt, thirtyDaysAgo),
        ),
      ),
  ]);
  const [deal30, deal60_30] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(deals)
      .where(and(eq(deals.organizationId, org.id), gte(deals.createdAt, thirtyDaysAgo))),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(deals)
      .where(
        and(
          eq(deals.organizationId, org.id),
          gte(deals.createdAt, priorThirty),
          lt(deals.createdAt, thirtyDaysAgo),
        ),
      ),
  ]);
  const l30 = Number(lead30[0]?.c ?? 0);
  const l60 = Number(lead60_30[0]?.c ?? 0);
  const d30 = Number(deal30[0]?.c ?? 0);
  const d60 = Number(deal60_30[0]?.c ?? 0);
  const leadGrowth = l60 === 0 ? (l30 > 0 ? 1 : 0) : (l30 - l60) / l60;
  const dealGrowth = d60 === 0 ? (d30 > 0 ? 1 : 0) : (d30 - d60) / d60;
  const activityScore = Math.max(
    0,
    Math.min(30, Math.round((leadGrowth * 15 + dealGrowth * 15))),
  );

  // Revenue trajectory — last 60 days payments
  const [payRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
      sum: sql<number>`coalesce(sum(amount), 0)::numeric`,
    })
    .from(payments)
    .where(and(eq(payments.organizationId, org.id), gte(payments.createdAt, sixtyDaysAgo)));
  const paymentCount = Number(payRow?.count ?? 0);
  const revenueScore = Math.min(20, Math.round((paymentCount / 2) * 4)); // 2+ payments = 4, 5+ = 10, 10+ = 20

  // Engagement — days with any activity in last 30 days
  const activeDaysRow = await db.execute(sql`
    SELECT count(DISTINCT date_trunc('day', created_at))::int AS days
    FROM activity_log
    WHERE organization_id = ${org.id}
      AND created_at >= ${thirtyDaysAgo}
  `);
  const activeDays = Number((activeDaysRow.rows[0] as any)?.days ?? 0);
  const engagementScore = Math.min(20, Math.round((activeDays / 30) * 20));

  const total = tenureScore + activityScore + revenueScore + engagementScore;

  const signals = {
    tenureDays,
    tenureScore,
    leadsLast30: l30,
    leadsPrior30: l60,
    leadGrowthPct: Math.round(leadGrowth * 100),
    dealsLast30: d30,
    dealsPrior30: d60,
    dealGrowthPct: Math.round(dealGrowth * 100),
    activityScore,
    paymentsLast60: paymentCount,
    revenueScore,
    activeDaysLast30: activeDays,
    engagementScore,
  };

  const reasons: string[] = [];
  if (tenureScore >= 20) reasons.push(`mature account (${tenureDays}d tenure)`);
  if (leadGrowth >= 0.2) reasons.push(`lead volume up ${Math.round(leadGrowth * 100)}% MoM`);
  if (dealGrowth >= 0.2) reasons.push(`deal count up ${Math.round(dealGrowth * 100)}% MoM`);
  if (paymentCount >= 2) reasons.push(`${paymentCount} payments in the last 60 days`);
  if (activeDays >= 20) reasons.push(`active ${activeDays}/30 days`);
  const reasoning = reasons.length > 0
    ? `${org.name}: ${reasons.join("; ")}. Score: ${total}/100.`
    : `${org.name}: composite signals yield score ${total}/100.`;

  return { score: total, signals, reasoning };
}

// ── Queries for founder UI ──────────────────────────────────────────

export async function listExpansionCandidates(status?: string) {
  const q = db
    .select({
      id: expansionCandidates.id,
      organizationId: expansionCandidates.organizationId,
      weekKey: expansionCandidates.weekKey,
      currentTier: expansionCandidates.currentTier,
      proposedTier: expansionCandidates.proposedTier,
      score: expansionCandidates.score,
      reasoning: expansionCandidates.reasoning,
      estimatedMrrLiftCents: expansionCandidates.estimatedMrrLiftCents,
      status: expansionCandidates.status,
      founderNotes: expansionCandidates.founderNotes,
      resolvedAt: expansionCandidates.resolvedAt,
      createdAt: expansionCandidates.createdAt,
      orgName: organizations.name,
    })
    .from(expansionCandidates)
    .leftJoin(organizations, eq(organizations.id, expansionCandidates.organizationId));
  if (status) {
    return q
      .where(eq(expansionCandidates.status, status))
      .orderBy(desc(expansionCandidates.score))
      .limit(50);
  }
  return q.orderBy(desc(expansionCandidates.createdAt)).limit(50);
}

export async function resolveExpansionCandidate(
  id: number,
  status: "approved" | "rejected" | "offered" | "converted" | "declined",
  founderNotes?: string,
  resolvedBy?: string,
) {
  await db
    .update(expansionCandidates)
    .set({
      status,
      founderNotes: founderNotes?.slice(0, 2000) ?? null,
      resolvedAt: new Date(),
      resolvedBy: resolvedBy ?? "founder",
    })
    .where(eq(expansionCandidates.id, id));
}

// ── Helpers ─────────────────────────────────────────────────────────

function isoWeekKey(d: Date): string {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${target.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}
