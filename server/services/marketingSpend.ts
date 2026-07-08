/**
 * marketingSpend — the CAC numerator (2026-07-07 cost audit).
 *
 * Records ACTUAL acquisition spend (never budgets — a budget is not spend)
 * and computes CAC honestly: when the ledger is empty for the window, CAC
 * is null and stays null, preserving the dashboard's no-fabrication stance.
 * Writers: the founder money surface (manual entries) and, once a
 * Meta/Google spend-sync exists, the ad-provider adapter
 * (source='ad_provider'). Readers: the unit-economics endpoint
 * (routes-founder-money.ts) and the autopilot budget ramp (its CAC-proof
 * gate should see real ad dollars, not just AI-dispatch spend).
 */

import { and, desc, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { marketingSpend, organizations, type MarketingSpendEntry } from "@shared/schema";
import { logger } from "../utils/logger";

export const MARKETING_CHANNELS = [
  "meta",
  "google",
  "content",
  "referral",
  "sponsorship",
  "other",
] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export const MARKETING_SPEND_SOURCES = ["manual", "ad_provider", "autopilot"] as const;
export type MarketingSpendSource = (typeof MARKETING_SPEND_SOURCES)[number];

export interface RecordMarketingSpendInput {
  channel: MarketingChannel;
  amountCents: number;
  /** When the spend occurred; defaults to now. */
  spentAt?: Date;
  source?: MarketingSpendSource;
  campaignRef?: string | null;
  note?: string | null;
}

export async function recordMarketingSpend(
  input: RecordMarketingSpendInput,
): Promise<MarketingSpendEntry> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("marketing spend amountCents must be a positive integer");
  }
  const [row] = await db
    .insert(marketingSpend)
    .values({
      channel: input.channel,
      amountCents: input.amountCents,
      spentAt: input.spentAt ?? new Date(),
      source: input.source ?? "manual",
      campaignRef: input.campaignRef ?? null,
      note: input.note ?? null,
    })
    .returning();
  logger.info("[marketingSpend] recorded", {
    metadata: {
      channel: row.channel,
      amountCents: row.amountCents,
      source: row.source,
    },
  });
  return row;
}

export interface MarketingSpendSummary {
  sinceDays: number;
  totalCents: number;
  entryCount: number;
  byChannel: Record<string, number>;
}

export async function marketingSpendSummary(sinceDays: number): Promise<MarketingSpendSummary> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      channel: marketingSpend.channel,
      totalCents: sql<number>`coalesce(sum(${marketingSpend.amountCents}), 0)::int`,
      n: sql<number>`count(*)::int`,
    })
    .from(marketingSpend)
    .where(gte(marketingSpend.spentAt, since))
    .groupBy(marketingSpend.channel);

  const byChannel: Record<string, number> = {};
  let totalCents = 0;
  let entryCount = 0;
  for (const r of rows) {
    byChannel[r.channel] = Number(r.totalCents);
    totalCents += Number(r.totalCents);
    entryCount += Number(r.n);
  }
  return { sinceDays, totalCents, entryCount, byChannel };
}

export async function listMarketingSpend(
  sinceDays: number,
  limit = 200,
): Promise<MarketingSpendEntry[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(marketingSpend)
    .where(gte(marketingSpend.spentAt, since))
    .orderBy(desc(marketingSpend.spentAt))
    .limit(limit);
}

/** Month-to-date actual ad/marketing spend in USD (budget-ramp input). */
export async function marketingSpendMonthToDateUsd(): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({ totalCents: sql<number>`coalesce(sum(${marketingSpend.amountCents}), 0)::int` })
    .from(marketingSpend)
    .where(gte(marketingSpend.spentAt, monthStart));
  return Number(row?.totalCents ?? 0) / 100;
}

// ── CAC ───────────────────────────────────────────────────────────────────────

export interface CacResult {
  /** Null when the window has no recorded spend — never fabricated. */
  cacUsd: number | null;
  spendCents: number;
  newPayingCustomers: number;
  windowDays: number;
}

/**
 * Pure CAC math, exported for tests: spend ÷ new paying customers.
 * No spend → null (an empty ledger is "unknown", not "free acquisition");
 * spend with zero new customers → Infinity is useless, report null too and
 * let the caller surface "spend with no attributed signups yet".
 */
export function cacFromTotals(spendCents: number, newPayingCustomers: number): number | null {
  if (spendCents <= 0) return null;
  if (newPayingCustomers <= 0) return null;
  return Math.round((spendCents / 100 / newPayingCustomers) * 100) / 100;
}

/**
 * Blended CAC over a trailing window: recorded marketing spend ÷ orgs that
 * signed up in the window and are currently on a paid tier.
 */
export async function computeCac(windowDays = 90): Promise<CacResult> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [{ totalCents } = { totalCents: 0 }] = await db
    .select({ totalCents: sql<number>`coalesce(sum(${marketingSpend.amountCents}), 0)::int` })
    .from(marketingSpend)
    .where(gte(marketingSpend.spentAt, since));

  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(organizations)
    .where(
      and(
        gte(organizations.createdAt, since),
        sql`${organizations.subscriptionTier} IS NOT NULL AND ${organizations.subscriptionTier} != 'free' AND ${organizations.subscriptionTier} != ''`,
        sql`COALESCE(${organizations.subscriptionStatus}, 'active') NOT IN ('cancelled', 'suspended')`,
      ),
    );

  const spendCents = Number(totalCents ?? 0);
  const newPayingCustomers = Number(n ?? 0);
  return {
    cacUsd: cacFromTotals(spendCents, newPayingCustomers),
    spendCents,
    newPayingCustomers,
    windowDays,
  };
}
