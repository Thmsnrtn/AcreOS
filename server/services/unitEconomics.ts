/**
 * Customer Unit Economics — Lavender Week 12 (profit-margin dashboard).
 *
 * Two public entry points:
 *
 *   • `computeUnitEconomicsForOrg(orgId)` — recomputes a single org's
 *     trailing-30-day rollup and upserts the row keyed on
 *     (organizationId, computedDate). Used by both the nightly job and the
 *     "recompute now" affordance on /founder/unit-economics.
 *
 *   • `computeAllOrgs()` — iterates every org and writes a fresh snapshot
 *     for each. Wired into the self-rescheduling framework via
 *     server/index.ts → startCustomerUnitEconomicsJob.
 *
 * Cost sources (trailing 30 days) — Tier 2B "one money spine":
 *
 *   ALL variable costs are summed from `financial_ledger` (the system of
 *   record — see financial-ledger.ts; every postOpexSpent call site lands
 *   there with real provider-billed cents). One grouped query per org:
 *
 *   - AI:           category 'ai_tokens' (OpenRouter, actual billed cents)
 *                   + category 'voice' (ElevenLabs) folded into aiCostUsd.
 *   - Direct mail:  category 'mail' (Lob / PostGrid actual postage cents).
 *   - SMS:          category 'sms' (Twilio actual cents — replaces the old
 *                   hardcoded $0.0079 × outbound-message-count estimate).
 *   - Email:        category 'email'.
 *   - Skip trace:   category 'skip_trace'.
 *
 *   Counts (aiCallCount, smsCount, …) are ledger row counts per category —
 *   one posting per billed provider event. Two deliberate semantic shifts vs
 *   the pre-2B parallel-table reads: BYOK orgs post nothing to the ledger
 *   (the customer pays the provider directly), so their variable COGS is
 *   correctly $0 now; and $0-cost events (cached AI calls, mock sends)
 *   no longer inflate counts. category 'stripe_fee' is deliberately
 *   EXCLUDED — payment processing is netted at the revenue level, matching
 *   the pre-2B definition of these six COGS columns.
 *
 * Fixed-cost share:
 *   Sum of FIXED_COST_INPUTS_USD_MONTHLY (Fly + Postgres + Clerk + Sentry) is
 *   divided across the count of *paying* active orgs. Free-tier orgs are
 *   excluded from the divisor and assigned a zero share so they don't
 *   "subsidise" themselves into a negative margin we can't act on.
 *
 * Math invariant — `totalCogsUsd` is always recomputed as the sum of the six
 * cost columns; we never accept a caller-supplied total. Profit margin is
 * `mrr - cogs` and `marginPct` is `100 * margin / mrr` (with mrr=0 ⇒ 0% so
 * free-tier orgs render cleanly even when costs are positive).
 *
 * Alignment with `account_ledger_entries` (Wave 9 double-entry):
 * Revenue accounts (4xxx) credited for MRR, COGS accounts (5xxx) debited for
 * variable costs. We don't *post* into the ledger here — the existing
 * recognition / Stripe webhook paths already do that — but the rollup uses
 * the same booking-date semantics so a reconciliation pass can compare them.
 */

import { sql, eq, gte, and, desc, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  financialLedger,
  customerUnitEconomics,
  systemAlerts,
  FIXED_COST_INPUTS_USD_MONTHLY,
  UNPROFITABLE_ALERT_DAYS,
  type InsertCustomerUnitEconomics,
  type CustomerUnitEconomicsRow,
  type InsertSystemAlert,
  type Organization,
} from "@shared/schema";
import {
  monthlyRevenueCentsFor,
  tierForSubscriptionTier,
} from "@shared/billing/tier-pricing";
import { logger } from "../utils/logger";
import { storage } from "../storage";

const DEFAULT_WINDOW_DAYS = 30;

/**
 * financial_ledger categories that constitute variable COGS, and which of
 * the six output columns each one feeds. 'stripe_fee' is deliberately absent
 * (netted at revenue level, not a per-feature COGS column — see header).
 */
const LEDGER_COST_CATEGORIES = [
  "ai_tokens",
  "voice",
  "mail",
  "sms",
  "email",
  "skip_trace",
] as const;

export interface UnitEconomicsResult {
  organizationId: number;
  organizationName: string;
  subscriptionTier: string;
  windowDays: number;
  mrrUsd: number;
  aiCostUsd: number;
  directMailCostUsd: number;
  smsCostUsd: number;
  emailCostUsd: number;
  skipTraceCostUsd: number;
  fixedCostShareUsd: number;
  totalCogsUsd: number;
  profitMarginUsd: number;
  profitMarginPct: number;
  aiCallCount: number;
  smsCount: number;
  emailCount: number;
  directMailPieces: number;
  skipTraceCount: number;
  consecutiveUnprofitableDays: number;
  breakdown: {
    aiByFeature?: Record<string, { usd: number; calls: number }>;
    notes?: string[];
    fixedCostInputs?: {
      flyMonthlyUsd: number;
      postgresMonthlyUsd: number;
      clerkMonthlyUsd: number;
      sentryMonthlyUsd: number;
      activeCustomers: number;
    };
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function totalFixedMonthlyUsd(): number {
  return (
    FIXED_COST_INPUTS_USD_MONTHLY.fly +
    FIXED_COST_INPUTS_USD_MONTHLY.postgres +
    FIXED_COST_INPUTS_USD_MONTHLY.clerk +
    FIXED_COST_INPUTS_USD_MONTHLY.sentry
  );
}

/**
 * Count of orgs over which fixed costs should be amortised. We split across
 * paying customers (any non-free tier with an active subscription) so the
 * free tier doesn't dilute the per-customer load. If there are zero paying
 * customers we fall back to 1 to avoid a divide-by-zero — the math is
 * meaningless on a zero-customer cluster anyway, but the table renders
 * cleanly.
 */
async function countPayingActiveOrgs(): Promise<number> {
  const all = await db.select({ tier: organizations.subscriptionTier, status: organizations.subscriptionStatus }).from(organizations);
  const paying = all.filter((o) => o.status === "active" && tierForSubscriptionTier(o.tier) !== null);
  return Math.max(1, paying.length);
}

// ─── Per-org cost query (Tier 2B — financial_ledger is the ONE source) ──────

export interface LedgerCostRollup {
  aiCostUsd: number;
  directMailCostUsd: number;
  smsCostUsd: number;
  emailCostUsd: number;
  skipTraceCostUsd: number;
  aiCallCount: number;
  smsCount: number;
  emailCount: number;
  directMailPieces: number;
  skipTraceCount: number;
  aiByFeature: Record<string, { usd: number; calls: number }>;
}

/**
 * One grouped scan of financial_ledger per org. opex rows are stored as
 * NEGATIVE signed cents (postOpexSpent negates), so costs are `-sum`.
 * Grouped by (category, feature) so the AI per-feature breakdown comes from
 * the same query. Exported for the unit-economics-from-ledger tests.
 */
export async function ledgerCostsFor(orgId: number, since: Date): Promise<LedgerCostRollup> {
  const rows = await db
    .select({
      category: financialLedger.category,
      feature: financialLedger.feature,
      totalCents: sql<number>`COALESCE(SUM(${financialLedger.amountCents}), 0)::bigint`,
      rowCount: sql<number>`COUNT(*)::int`,
    })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.organizationId, orgId),
        inArray(financialLedger.category, [...LEDGER_COST_CATEGORIES]),
        gte(financialLedger.postedAt, since),
      ),
    )
    .groupBy(financialLedger.category, financialLedger.feature);

  const rollup: LedgerCostRollup = {
    aiCostUsd: 0,
    directMailCostUsd: 0,
    smsCostUsd: 0,
    emailCostUsd: 0,
    skipTraceCostUsd: 0,
    aiCallCount: 0,
    smsCount: 0,
    emailCount: 0,
    directMailPieces: 0,
    skipTraceCount: 0,
    aiByFeature: {},
  };

  for (const r of rows) {
    // Signed cents: opex rows are negative; abs-guard so a stray positive
    // correction row can't flip a cost negative.
    const usd = Math.abs(toNumber(r.totalCents)) / 100;
    const count = r.rowCount ?? 0;
    switch (r.category) {
      case "ai_tokens":
      case "voice": {
        rollup.aiCostUsd += usd;
        rollup.aiCallCount += count;
        const featureKey = r.feature ?? (r.category === "voice" ? "voice" : "unknown");
        const existing = rollup.aiByFeature[featureKey] ?? { usd: 0, calls: 0 };
        existing.usd = round6(existing.usd + usd);
        existing.calls += count;
        rollup.aiByFeature[featureKey] = existing;
        break;
      }
      case "mail":
        rollup.directMailCostUsd += usd;
        rollup.directMailPieces += count;
        break;
      case "sms":
        rollup.smsCostUsd += usd;
        rollup.smsCount += count;
        break;
      case "email":
        rollup.emailCostUsd += usd;
        rollup.emailCount += count;
        break;
      case "skip_trace":
        rollup.skipTraceCostUsd += usd;
        rollup.skipTraceCount += count;
        break;
    }
  }

  rollup.aiCostUsd = round6(rollup.aiCostUsd);
  rollup.directMailCostUsd = round6(rollup.directMailCostUsd);
  rollup.smsCostUsd = round6(rollup.smsCostUsd);
  rollup.emailCostUsd = round6(rollup.emailCostUsd);
  rollup.skipTraceCostUsd = round6(rollup.skipTraceCostUsd);
  return rollup;
}

// ─── Last snapshot lookup (for consecutive-unprofitable streak) ─────────────

async function previousSnapshot(orgId: number): Promise<CustomerUnitEconomicsRow | null> {
  const rows = await db
    .select()
    .from(customerUnitEconomics)
    .where(eq(customerUnitEconomics.organizationId, orgId))
    .orderBy(desc(customerUnitEconomics.computedAt))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function computeUnitEconomicsForOrg(
  orgId: number,
  opts: { windowDays?: number; activeCustomerCount?: number } = {},
): Promise<UnitEconomicsResult> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  const orgRows = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const org = orgRows[0];
  if (!org) {
    throw new Error(`Organization ${orgId} not found`);
  }

  const since = new Date(Date.now() - windowDays * 86_400_000);

  // Tier 2B — all variable costs from the ONE money spine (financial_ledger).
  const costs = await ledgerCostsFor(orgId, since);

  // Fixed-cost share — only paid active customers shoulder this.
  const activeCustomers = opts.activeCustomerCount ?? (await countPayingActiveOrgs());
  const tier = tierForSubscriptionTier(org.subscriptionTier);
  const isPaying = tier !== null && org.subscriptionStatus === "active";
  const fixedCostShareUsd = isPaying ? round6(totalFixedMonthlyUsd() / activeCustomers) : 0;

  // MRR (normalised to monthly USD).
  const billingInterval = (org.billingInterval === "yearly" ? "yearly" : "monthly") as "monthly" | "yearly";
  const mrrUsd = round6(monthlyRevenueCentsFor(org.subscriptionTier, billingInterval) / 100);

  const totalCogsUsd = round6(
    costs.aiCostUsd +
      costs.directMailCostUsd +
      costs.smsCostUsd +
      costs.emailCostUsd +
      costs.skipTraceCostUsd +
      fixedCostShareUsd,
  );
  const profitMarginUsd = round6(mrrUsd - totalCogsUsd);
  const profitMarginPct = mrrUsd > 0 ? Math.round((profitMarginUsd / mrrUsd) * 10000) / 100 : 0;

  const prev = await previousSnapshot(orgId);
  const prevStreak = prev?.consecutiveUnprofitableDays ?? 0;
  const consecutiveUnprofitableDays =
    profitMarginUsd < 0 ? prevStreak + 1 : 0;

  return {
    organizationId: orgId,
    organizationName: org.name,
    subscriptionTier: org.subscriptionTier,
    windowDays,
    mrrUsd,
    aiCostUsd: costs.aiCostUsd,
    directMailCostUsd: costs.directMailCostUsd,
    smsCostUsd: costs.smsCostUsd,
    emailCostUsd: costs.emailCostUsd,
    skipTraceCostUsd: costs.skipTraceCostUsd,
    fixedCostShareUsd,
    totalCogsUsd,
    profitMarginUsd,
    profitMarginPct,
    aiCallCount: costs.aiCallCount,
    smsCount: costs.smsCount,
    emailCount: costs.emailCount,
    directMailPieces: costs.directMailPieces,
    skipTraceCount: costs.skipTraceCount,
    consecutiveUnprofitableDays,
    breakdown: {
      aiByFeature: costs.aiByFeature,
      notes: [
        "costs sourced from financial_ledger (Tier 2B one money spine); BYOK spend and stripe_fee excluded by design",
      ],
      fixedCostInputs: {
        flyMonthlyUsd: FIXED_COST_INPUTS_USD_MONTHLY.fly,
        postgresMonthlyUsd: FIXED_COST_INPUTS_USD_MONTHLY.postgres,
        clerkMonthlyUsd: FIXED_COST_INPUTS_USD_MONTHLY.clerk,
        sentryMonthlyUsd: FIXED_COST_INPUTS_USD_MONTHLY.sentry,
        activeCustomers,
      },
    },
  };
}

/**
 * Persist a snapshot. Upserts on (organizationId, computedDate) so re-runs
 * within the same UTC day overwrite in place.
 */
export async function persistSnapshot(result: UnitEconomicsResult): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const insert: InsertCustomerUnitEconomics = {
    organizationId: result.organizationId,
    computedDate: today,
    windowDays: result.windowDays,
    mrrUsd: result.mrrUsd.toFixed(6),
    aiCostUsd: result.aiCostUsd.toFixed(6),
    directMailCostUsd: result.directMailCostUsd.toFixed(6),
    smsCostUsd: result.smsCostUsd.toFixed(6),
    emailCostUsd: result.emailCostUsd.toFixed(6),
    skipTraceCostUsd: result.skipTraceCostUsd.toFixed(6),
    fixedCostShareUsd: result.fixedCostShareUsd.toFixed(6),
    totalCogsUsd: result.totalCogsUsd.toFixed(6),
    profitMarginUsd: result.profitMarginUsd.toFixed(6),
    profitMarginPct: result.profitMarginPct.toFixed(2),
    aiCallCount: result.aiCallCount,
    smsCount: result.smsCount,
    emailCount: result.emailCount,
    directMailPieces: result.directMailPieces,
    skipTraceCount: result.skipTraceCount,
    consecutiveUnprofitableDays: result.consecutiveUnprofitableDays,
    breakdown: result.breakdown,
  };

  await db
    .insert(customerUnitEconomics)
    .values(insert)
    .onConflictDoUpdate({
      target: [customerUnitEconomics.organizationId, customerUnitEconomics.computedDate],
      set: {
        computedAt: new Date(),
        windowDays: insert.windowDays,
        mrrUsd: insert.mrrUsd,
        aiCostUsd: insert.aiCostUsd,
        directMailCostUsd: insert.directMailCostUsd,
        smsCostUsd: insert.smsCostUsd,
        emailCostUsd: insert.emailCostUsd,
        skipTraceCostUsd: insert.skipTraceCostUsd,
        fixedCostShareUsd: insert.fixedCostShareUsd,
        totalCogsUsd: insert.totalCogsUsd,
        profitMarginUsd: insert.profitMarginUsd,
        profitMarginPct: insert.profitMarginPct,
        aiCallCount: insert.aiCallCount,
        smsCount: insert.smsCount,
        emailCount: insert.emailCount,
        directMailPieces: insert.directMailPieces,
        skipTraceCount: insert.skipTraceCount,
        consecutiveUnprofitableDays: insert.consecutiveUnprofitableDays,
        breakdown: insert.breakdown,
      },
    });
}

/**
 * If the org has been unprofitable for >= UNPROFITABLE_ALERT_DAYS days
 * and we haven't already filed an alert, file one. We dedupe by
 * (alertType, organizationId, status='new'|'acknowledged') so the founder
 * doesn't get spammed every night.
 */
export async function maybeEmitUnprofitableAlert(result: UnitEconomicsResult): Promise<boolean> {
  if (result.consecutiveUnprofitableDays < UNPROFITABLE_ALERT_DAYS) return false;

  // Dedupe — skip if an open alert already exists for this org.
  const existing = await db
    .select({ id: systemAlerts.id })
    .from(systemAlerts)
    .where(
      and(
        eq(systemAlerts.alertType, "customer_unprofitable"),
        eq(systemAlerts.organizationId, result.organizationId),
        inArray(systemAlerts.status, ["new", "acknowledged"]),
      ),
    )
    .limit(1);
  if (existing.length > 0) return false;

  const alert: InsertSystemAlert = {
    type: "customer_unprofitable",
    alertType: "customer_unprofitable",
    severity: "warning",
    title: `${result.organizationName} unprofitable for ${result.consecutiveUnprofitableDays}d`,
    message:
      `Customer ${result.organizationName} (tier=${result.subscriptionTier}) has had a ` +
      `negative profit margin for ${result.consecutiveUnprofitableDays} consecutive days — ` +
      `MRR $${result.mrrUsd.toFixed(2)} vs COGS $${result.totalCogsUsd.toFixed(2)} ` +
      `(margin -$${Math.abs(result.profitMarginUsd).toFixed(2)}). Review pricing or usage.`,
    organizationId: result.organizationId,
    relatedEntityType: "organization",
    relatedEntityId: result.organizationId,
    status: "new",
    autoResolvable: false,
    metadata: {
      mrrUsd: result.mrrUsd,
      totalCogsUsd: result.totalCogsUsd,
      profitMarginUsd: result.profitMarginUsd,
      profitMarginPct: result.profitMarginPct,
      consecutiveUnprofitableDays: result.consecutiveUnprofitableDays,
      breakdown: {
        ai: result.aiCostUsd,
        directMail: result.directMailCostUsd,
        sms: result.smsCostUsd,
        email: result.emailCostUsd,
        skipTrace: result.skipTraceCostUsd,
        fixedShare: result.fixedCostShareUsd,
      },
    },
  };

  try {
    await storage.createSystemAlert(alert);
    return true;
  } catch (err) {
    logger.warn("[unitEconomics] failed to file unprofitable alert", {
      metadata: { orgId: result.organizationId, error: (err as Error).message },
    });
    return false;
  }
}

/**
 * Nightly job entry point — recomputes and persists every org's snapshot
 * and emits unprofitable alerts. Returns the number of orgs processed.
 */
export async function computeAllOrgs(): Promise<number> {
  const allOrgs: Pick<Organization, "id" | "name" | "subscriptionStatus" | "subscriptionTier">[] =
    await db
      .select({
        id: organizations.id,
        name: organizations.name,
        subscriptionStatus: organizations.subscriptionStatus,
        subscriptionTier: organizations.subscriptionTier,
      })
      .from(organizations)
      .limit(50000);

  // Pre-compute the active-customer divisor once so every org sees the same
  // denominator within a run. Without this, computing fixed-share inside the
  // loop would re-query the orgs table N times.
  const activeCustomerCount = Math.max(
    1,
    allOrgs.filter(
      (o) => o.subscriptionStatus === "active" && tierForSubscriptionTier(o.subscriptionTier) !== null,
    ).length,
  );

  let processed = 0;
  let alertsFired = 0;

  for (const org of allOrgs) {
    try {
      const result = await computeUnitEconomicsForOrg(org.id, { activeCustomerCount });
      await persistSnapshot(result);
      const fired = await maybeEmitUnprofitableAlert(result);
      if (fired) alertsFired += 1;
      processed += 1;
    } catch (err) {
      logger.warn("[unitEconomics] per-org compute failed", {
        metadata: { orgId: org.id, error: (err as Error).message },
      });
    }
  }

  logger.info("[unitEconomics] nightly run complete", {
    metadata: { processed, totalOrgs: allOrgs.length, alertsFired, activeCustomerCount },
  });

  return processed;
}

/**
 * Read API helper used by GET /api/founder/unit-economics. Returns the
 * latest snapshot per org plus a 90-day daily aggregate for the trend chart.
 */
export interface UnitEconomicsApiResponse {
  totals: {
    customerCount: number;
    payingCustomerCount: number;
    totalMrrUsd: number;
    totalCogsUsd: number;
    grossMarginUsd: number;
    grossMarginPct: number;
  };
  rows: Array<{
    organizationId: number;
    organizationName: string;
    subscriptionTier: string;
    mrrUsd: number;
    aiCostUsd: number;
    directMailCostUsd: number;
    smsCostUsd: number;
    emailCostUsd: number;
    skipTraceCostUsd: number;
    fixedCostShareUsd: number;
    totalCogsUsd: number;
    profitMarginUsd: number;
    profitMarginPct: number;
    consecutiveUnprofitableDays: number;
    computedAt: string;
  }>;
  trend: Array<{
    date: string;
    totalMrrUsd: number;
    totalCogsUsd: number;
    grossMarginUsd: number;
  }>;
}

export async function readUnitEconomicsRollup(): Promise<UnitEconomicsApiResponse> {
  // Latest snapshot per org via DISTINCT ON.
  const latestRows = await db.execute(sql`
    SELECT DISTINCT ON (cue.organization_id)
      cue.organization_id,
      cue.computed_at,
      cue.mrr_usd,
      cue.ai_cost_usd,
      cue.direct_mail_cost_usd,
      cue.sms_cost_usd,
      cue.email_cost_usd,
      cue.skip_trace_cost_usd,
      cue.fixed_cost_share_usd,
      cue.total_cogs_usd,
      cue.profit_margin_usd,
      cue.profit_margin_pct,
      cue.consecutive_unprofitable_days,
      o.name AS organization_name,
      o.subscription_tier
    FROM customer_unit_economics cue
    JOIN organizations o ON o.id = cue.organization_id
    ORDER BY cue.organization_id, cue.computed_at DESC
  `);

  const rows = (latestRows.rows ?? []).map((r: any) => ({
    organizationId: r.organization_id as number,
    organizationName: (r.organization_name ?? "Unknown") as string,
    subscriptionTier: (r.subscription_tier ?? "free") as string,
    mrrUsd: toNumber(r.mrr_usd),
    aiCostUsd: toNumber(r.ai_cost_usd),
    directMailCostUsd: toNumber(r.direct_mail_cost_usd),
    smsCostUsd: toNumber(r.sms_cost_usd),
    emailCostUsd: toNumber(r.email_cost_usd),
    skipTraceCostUsd: toNumber(r.skip_trace_cost_usd),
    fixedCostShareUsd: toNumber(r.fixed_cost_share_usd),
    totalCogsUsd: toNumber(r.total_cogs_usd),
    profitMarginUsd: toNumber(r.profit_margin_usd),
    profitMarginPct: toNumber(r.profit_margin_pct),
    consecutiveUnprofitableDays: r.consecutive_unprofitable_days as number,
    computedAt: new Date(r.computed_at).toISOString(),
  }));

  // Sort by margin ASC so red customers are at the top of the list when the
  // founder dashboard reads the array; the page splits into top-10
  // profitable / top-10 unprofitable.
  rows.sort((a, b) => a.profitMarginUsd - b.profitMarginUsd);

  const totalMrrUsd = round6(rows.reduce((sum, r) => sum + r.mrrUsd, 0));
  const totalCogsUsd = round6(rows.reduce((sum, r) => sum + r.totalCogsUsd, 0));
  const grossMarginUsd = round6(totalMrrUsd - totalCogsUsd);
  const grossMarginPct =
    totalMrrUsd > 0 ? Math.round((grossMarginUsd / totalMrrUsd) * 10000) / 100 : 0;
  const payingCustomerCount = rows.filter(
    (r) => tierForSubscriptionTier(r.subscriptionTier) !== null,
  ).length;

  // 90-day trend — sum across orgs per computed_date.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const trendRows = await db.execute(sql`
    SELECT
      computed_date AS date,
      SUM(mrr_usd) AS total_mrr_usd,
      SUM(total_cogs_usd) AS total_cogs_usd,
      SUM(profit_margin_usd) AS gross_margin_usd
    FROM customer_unit_economics
    WHERE computed_date >= ${ninetyDaysAgo}
    GROUP BY computed_date
    ORDER BY computed_date ASC
  `);

  const trend = (trendRows.rows ?? []).map((r: any) => ({
    date: typeof r.date === "string" ? r.date : new Date(r.date).toISOString().slice(0, 10),
    totalMrrUsd: toNumber(r.total_mrr_usd),
    totalCogsUsd: toNumber(r.total_cogs_usd),
    grossMarginUsd: toNumber(r.gross_margin_usd),
  }));

  return {
    totals: {
      customerCount: rows.length,
      payingCustomerCount,
      totalMrrUsd,
      totalCogsUsd,
      grossMarginUsd,
      grossMarginPct,
    },
    rows,
    trend,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// O6 (P5 §5) — the unit-economics RECEIPT + the infra curve.
//
// ADDITIVE READ HELPERS ONLY. Nothing below changes the math above or any of
// its existing consumers (runScheduledJobs, routes-founder-money,
// ledgerDeadLetter, provider-registry, ceoCommandBridge). These functions
// re-read what the engine already persisted and answer two questions the
// Letter asks:
//
//   1. "What does each customer contribute, and which way is it moving?"
//   2. "What is a unit of work costing me over time?"
//
// HONESTY CONTRACT (refuse-not-fabricate — the deepest rule in this repo):
//
//   • ATTRIBUTABLE ≠ ALLOCATED. `attributableCostUsd` is the sum of the five
//     LEDGER-SOURCED variable columns only. `fixedCostShareUsd` is an
//     ALLOCATION (a declared monthly constant divided by a customer count) and
//     is reported in its own field, never folded into "what this customer
//     costs us". Contribution = revenue − attributable cost.
//   • A PERCENT NEEDS A DENOMINATOR. `contributionPct` is null when mrrUsd is
//     0. (The persisted `profit_margin_pct` column stores 0 in that case for
//     UI back-compat; this receipt deliberately does NOT reuse it — a 0% that
//     means "undefined" is a zero presented as a fact.)
//   • ZERO NEEDS EVIDENCE. A $0 cost is reported alongside `billedEvents`, so
//     the surface can say "$0 across 0 billed events" instead of implying we
//     measured a customer we simply never billed anything for.
//   • NO SNAPSHOT ⇒ NOT COUNTED, AND SAID. Orgs with no row in
//     customer_unit_economics are excluded from every figure and enumerated in
//     `coverage` — they are never averaged in as zeros.
//   • A DIRECTION NEEDS HISTORY. `direction.available` is false unless the
//     series has ≥ RECEIPT_DIRECTION_MIN_POINTS distinct snapshot dates
//     spanning ≥ RECEIPT_DIRECTION_MIN_SPAN_DAYS; the curve needs
//     ≥ INFRA_CURVE_MIN_POINTS. Below that we say so instead of drawing a
//     flattering line through two points.
//   • DECLARED ≠ MEASURED. The fixed-cost inputs (Fly/Postgres/Clerk/Sentry)
//     are constants declared in shared/schema.ts, not vendor bills; they ship
//     labelled `declared`. Cost lines we do not meter at all (storage, egress,
//     map-tile serving, the canary fleet) are enumerated in `notMeasured`
//     rather than silently omitted.
// ═══════════════════════════════════════════════════════════════════════════

/** DECLARED (not measured) — the charter's sustained gross-margin floor. */
/**
 * How old the newest snapshot may be before the receipt stops speaking in the
 * present tense. DECLARED, not measured — the nightly job's own cadence is
 * daily, so a week without one means the job is not running.
 */
export const RECEIPT_STALE_AFTER_DAYS = 7;

export const RECEIPT_MARGIN_FLOOR_PCT = 70;
/** Distinct snapshot dates required before a direction of travel may be stated. */
export const RECEIPT_DIRECTION_MIN_POINTS = 3;
/** Days the direction window must span before a direction may be stated. */
export const RECEIPT_DIRECTION_MIN_SPAN_DAYS = 7;
/** Distinct snapshot dates required before the infra curve may be drawn. */
export const INFRA_CURVE_MIN_POINTS = 7;
/** Where the founder goes to see the rows behind any receipt figure. */
export const RECEIPT_SOURCE_HREF = "/founder/admin/costs?tab=unit-economics";
/** Where the founder goes to see the infra curve itself. */
export const INFRA_CURVE_HREF = "/founder/admin/costs?tab=unit-economics";

/**
 * Cost lines that exist in reality but that NOTHING meters today. Listed so
 * the panel can name its own blind spots rather than implying the measured
 * total is the whole bill (P5 §5.3 names the two planned inflections).
 */
export const INFRA_NOT_MEASURED = [
  "object storage (no per-byte meter posts to financial_ledger)",
  "bandwidth / egress (not metered per org)",
  "map-tile serving (Mapbox is the default engine today and posts nothing to financial_ledger, so its billed tile loads are unmetered here; the PMTiles self-host that would replace it is not shipped)",
  "canary fleet compute (not yet a separate billed line)",
] as const;

/** One number on the receipt, with its provenance and a place to go and check. */
export interface ReceiptFigure {
  /** The measured value — null when the engine cannot source it. */
  value: number | null;
  /** Exactly what produced it (table + columns), in words. */
  source: string;
  /** Where the founder can see the rows behind it. */
  href: string;
  /** Why it is null. Non-null ONLY when `value` is null. */
  absent: string | null;
}

function figure(
  value: number | null,
  source: string,
  absent: string | null,
  href: string = RECEIPT_SOURCE_HREF,
): ReceiptFigure {
  return { value, source, href, absent: value == null ? absent : null };
}

export interface ReceiptCustomerRow {
  organizationId: number;
  organizationName: string;
  subscriptionTier: string;
  /** Monthly recurring revenue (snapshot column mrr_usd). */
  mrrUsd: number;
  /** Ledger-sourced variable cost only — the five COGS columns, no allocation. */
  attributableCostUsd: number;
  /** revenue − attributable cost. */
  contributionUsd: number;
  /** null when mrrUsd is 0 — a percent with no denominator is not a number. */
  contributionPct: number | null;
  /** The ALLOCATED fixed share. Reported separately; never called attributable. */
  allocatedFixedShareUsd: number;
  /** Ledger rows behind the cost — 0 means "we billed nothing", not "we measured nothing". */
  billedEvents: number | null;
  /** "billed" when billedEvents > 0, "no_billed_events" at 0, "unknown" when counts are unreadable. */
  costEvidence: "billed" | "no_billed_events" | "unknown";
  consecutiveUnprofitableDays: number;
  /** Trailing window the snapshot covers (days). */
  windowDays: number | null;
  computedAt: string;
  source: string;
  href: string;
}

export interface ReceiptDirection {
  available: boolean;
  /** How it was computed, or precisely why it could not be. Always populated. */
  reason: string;
  fromDate: string | null;
  toDate: string | null;
  /** Contribution per customer then → now, and the delta. Null when unavailable. */
  fromContributionPerCustomerUsd: number | null;
  toContributionPerCustomerUsd: number | null;
  deltaUsd: number | null;
  /** Distinct snapshot dates the series actually has. */
  pointCount: number;
  spanDays: number;
}

export interface UnitEconomicsReceipt {
  asOf: string;
  rollup: {
    customersWithSnapshot: ReceiptFigure;
    /** Orgs with MRR > 0 — the figure a "customers" line should qualify with. */
    payingCustomers: ReceiptFigure;
    /** Metered work behind the cost figure: $0 across 0 events is not $0 spent. */
    billedEvents: ReceiptFigure;
    revenueUsd: ReceiptFigure;
    attributableCostUsd: ReceiptFigure;
    contributionUsd: ReceiptFigure;
    contributionPct: ReceiptFigure;
    allocatedFixedShareUsd: ReceiptFigure;
    /** Revenue − TOTAL COGS (allocation included) ÷ revenue — what the floor judges. */
    grossMarginPct: ReceiptFigure;
  };
  /** DECLARED floor (a goal), and whether the MEASURED GROSS margin is under it. */
  marginFloorPct: number;
  belowFloor: boolean | null;
  customers: ReceiptCustomerRow[];
  coverage: {
    organizationsTotal: number;
    withSnapshot: number;
    withoutSnapshot: number;
    /** Named, not just counted — capped for payload size. */
    missing: Array<{ organizationId: number; organizationName: string }>;
    line: string;
  };
  /** How current the figures are. A stale roll-up is not a statement about today. */
  freshness: {
    newestComputedAt: string | null;
    oldestComputedAt: string | null;
    /** Whole days since the newest snapshot; null when there is none. */
    ageDays: number | null;
    /**
     * True when the newest snapshot is older than STALE_AFTER_DAYS — the
     * surface must then stop speaking in the present tense (the nightly job
     * can die and the roll-up would otherwise keep reading as "today").
     */
    stale: boolean;
    staleAfterDays: number;
    line: string;
  };
  direction: ReceiptDirection;
}

/** One day of the platform-wide series (every point is a real snapshot date). */
export interface InfraCurvePoint {
  date: string;
  /** Orgs with a snapshot on that date. */
  orgCount: number;
  mrrUsd: number;
  /** Ledger-sourced variable cost across all orgs that date. */
  variableCostUsd: number;
  /** Allocated fixed share across all orgs that date. */
  allocatedFixedShareUsd: number;
  totalCogsUsd: number;
  /** Billed events across all orgs that date — the "units of work". */
  unitsOfWork: number;
  /** variableCost ÷ units. null when units is 0 — never 0/0 rendered as $0. */
  costPerUnitUsd: number | null;
  /** variableCost ÷ orgs. null when no orgs had a snapshot. */
  variableCostPerOrgUsd: number | null;
  /** Trailing window each snapshot covers — consecutive points OVERLAP. */
  windowDays: number;
}

export interface InfraCurve {
  asOf: string;
  /** False ⇒ the panel must say so rather than draw. */
  sufficient: boolean;
  /** How the curve was built, or exactly why it cannot be drawn. Always set. */
  reason: string;
  minPointsRequired: number;
  points: InfraCurvePoint[];
  latest: InfraCurvePoint | null;
  /** DECLARED monthly constants — not vendor bills. */
  declaredFixedInputsUsdMonthly: {
    fly: number;
    postgres: number;
    clerk: number;
    sentry: number;
    total: number;
  };
  /** Real cost lines nothing meters today. */
  notMeasured: string[];
  href: string;
}

/** Raw row shape the daily-series SQL returns (pg gives numerics back as text). */
interface RawSeriesRow {
  date: string | Date;
  org_count: number | string | null;
  window_days: number | string | null;
  mrr_usd: string | number | null;
  variable_cost_usd: string | number | null;
  fixed_share_usd: string | number | null;
  total_cogs_usd: string | number | null;
  units_of_work: string | number | null;
}

/** Raw row shape the per-org billed-event-count SQL returns. */
interface RawCountRow {
  organization_id: number | string;
  window_days: number | string | null;
  billed_events: number | string | null;
}

/** Internal: the platform-wide daily series both O6 readers derive from. */
async function readDailySeries(days: number): Promise<InfraCurvePoint[]> {
  const sinceDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const res = await db.execute(sql`
    SELECT
      computed_date AS date,
      COUNT(DISTINCT organization_id)::int AS org_count,
      MAX(window_days)::int AS window_days,
      SUM(mrr_usd) AS mrr_usd,
      SUM(ai_cost_usd + direct_mail_cost_usd + sms_cost_usd + email_cost_usd + skip_trace_cost_usd) AS variable_cost_usd,
      SUM(fixed_cost_share_usd) AS fixed_share_usd,
      SUM(total_cogs_usd) AS total_cogs_usd,
      SUM(ai_call_count + sms_count + email_count + direct_mail_pieces + skip_trace_count)::bigint AS units_of_work
    FROM customer_unit_economics
    WHERE computed_date >= ${sinceDate}
    GROUP BY computed_date
    ORDER BY computed_date ASC
  `);

  const seriesRows = (res.rows ?? []) as unknown as RawSeriesRow[];
  return seriesRows.map((r) => {
    const variableCostUsd = round6(toNumber(r.variable_cost_usd));
    const unitsOfWork = Math.round(toNumber(r.units_of_work));
    const orgCount = Number(r.org_count ?? 0);
    return {
      date: typeof r.date === "string" ? r.date : new Date(r.date).toISOString().slice(0, 10),
      orgCount,
      mrrUsd: round6(toNumber(r.mrr_usd)),
      variableCostUsd,
      allocatedFixedShareUsd: round6(toNumber(r.fixed_share_usd)),
      totalCogsUsd: round6(toNumber(r.total_cogs_usd)),
      unitsOfWork,
      // 0 units is NOT a $0 unit cost — it is an undefined ratio. Say null.
      costPerUnitUsd: unitsOfWork > 0 ? round6(variableCostUsd / unitsOfWork) : null,
      variableCostPerOrgUsd: orgCount > 0 ? round6(variableCostUsd / orgCount) : null,
      windowDays: Number(r.window_days ?? DEFAULT_WINDOW_DAYS),
    };
  });
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

/**
 * Direction of travel for contribution per customer. Refuses to state one
 * until the series is long enough AND wide enough to mean anything.
 */
function deriveDirection(points: InfraCurvePoint[]): ReceiptDirection {
  const pointCount = points.length;
  const spanDays = pointCount >= 2 ? daysBetween(points[0].date, points[pointCount - 1].date) : 0;
  const base: ReceiptDirection = {
    available: false,
    reason: "",
    fromDate: null,
    toDate: null,
    fromContributionPerCustomerUsd: null,
    toContributionPerCustomerUsd: null,
    deltaUsd: null,
    pointCount,
    spanDays,
  };

  if (pointCount < RECEIPT_DIRECTION_MIN_POINTS) {
    return {
      ...base,
      reason:
        `Only ${pointCount} snapshot ${pointCount === 1 ? "day" : "days"} recorded — ` +
        `a direction needs at least ${RECEIPT_DIRECTION_MIN_POINTS}. Nothing to compare against yet.`,
    };
  }
  if (spanDays < RECEIPT_DIRECTION_MIN_SPAN_DAYS) {
    return {
      ...base,
      reason:
        `The snapshots span ${spanDays} ${spanDays === 1 ? "day" : "days"} — ` +
        `a direction needs at least ${RECEIPT_DIRECTION_MIN_SPAN_DAYS}. Too short to call a trend.`,
    };
  }

  const first = points[0];
  const last = points[pointCount - 1];
  const from =
    first.orgCount > 0 ? round6((first.mrrUsd - first.variableCostUsd) / first.orgCount) : null;
  const to =
    last.orgCount > 0 ? round6((last.mrrUsd - last.variableCostUsd) / last.orgCount) : null;
  if (from === null || to === null) {
    return {
      ...base,
      reason:
        "One of the endpoint days has no customers with a snapshot, so contribution per customer is undefined there.",
      fromDate: first.date,
      toDate: last.date,
    };
  }

  return {
    available: true,
    reason:
      `Contribution per customer (revenue − attributable cost ÷ customers with a snapshot), ` +
      `${first.date} → ${last.date} — ${pointCount} snapshot days across ${spanDays}. ` +
      `Each point is a trailing-${last.windowDays}-day window, so consecutive days overlap.`,
    fromDate: first.date,
    toDate: last.date,
    fromContributionPerCustomerUsd: from,
    toContributionPerCustomerUsd: to,
    deltaUsd: round6(to - from),
    pointCount,
    spanDays,
  };
}

/**
 * The Letter's unit-economics receipt. Reuses `readUnitEconomicsRollup` for the
 * canonical per-org snapshot (one definition of the rollup platform-wide) and
 * adds only what the receipt needs: billed-event counts (so a $0 can carry its
 * evidence), the attributable/allocated split, snapshot coverage, and the
 * direction of travel.
 */
export async function readUnitEconomicsReceipt(): Promise<UnitEconomicsReceipt> {
  const rollup = await readUnitEconomicsRollup();

  // Per-org billed-event counts from the SAME latest snapshot the rollup read.
  const countsRes = await db.execute(sql`
    SELECT DISTINCT ON (organization_id)
      organization_id,
      window_days,
      (ai_call_count + sms_count + email_count + direct_mail_pieces + skip_trace_count)::int AS billed_events
    FROM customer_unit_economics
    ORDER BY organization_id, computed_at DESC
  `);
  const countsByOrg = new Map<number, { billedEvents: number; windowDays: number }>();
  for (const r of (countsRes.rows ?? []) as unknown as RawCountRow[]) {
    countsByOrg.set(Number(r.organization_id), {
      billedEvents: Number(r.billed_events ?? 0),
      windowDays: Number(r.window_days ?? DEFAULT_WINDOW_DAYS),
    });
  }

  // Sum of metered work behind the cost figure. Null (not 0) when NO org row
  // carried a readable count — the difference between "nothing billed" and
  // "we could not read what was billed".
  const rollupBilledEvents =
    countsByOrg.size === 0
      ? null
      : rollup.rows.reduce(
          (sum, r) => sum + (countsByOrg.get(r.organizationId)?.billedEvents ?? 0),
          0,
        );

  const customers: ReceiptCustomerRow[] = rollup.rows.map((r) => {
    const attributableCostUsd = round6(
      r.aiCostUsd + r.directMailCostUsd + r.smsCostUsd + r.emailCostUsd + r.skipTraceCostUsd,
    );
    const contributionUsd = round6(r.mrrUsd - attributableCostUsd);
    const counts = countsByOrg.get(r.organizationId) ?? null;
    return {
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      subscriptionTier: r.subscriptionTier,
      mrrUsd: r.mrrUsd,
      attributableCostUsd,
      contributionUsd,
      // A percent with no denominator is not a number.
      contributionPct:
        r.mrrUsd > 0 ? Math.round((contributionUsd / r.mrrUsd) * 10000) / 100 : null,
      allocatedFixedShareUsd: r.fixedCostShareUsd,
      billedEvents: counts ? counts.billedEvents : null,
      costEvidence: !counts ? "unknown" : counts.billedEvents > 0 ? "billed" : "no_billed_events",
      consecutiveUnprofitableDays: r.consecutiveUnprofitableDays,
      windowDays: counts ? counts.windowDays : null,
      computedAt: r.computedAt,
      source: "customer_unit_economics (latest snapshot per org) ← financial_ledger",
      href: RECEIPT_SOURCE_HREF,
    };
  });

  const withSnapshot = customers.length;
  const totalRevenueUsd = round6(customers.reduce((s, c) => s + c.mrrUsd, 0));
  const totalAttributableUsd = round6(customers.reduce((s, c) => s + c.attributableCostUsd, 0));
  const totalAllocatedUsd = round6(customers.reduce((s, c) => s + c.allocatedFixedShareUsd, 0));
  const totalContributionUsd = round6(totalRevenueUsd - totalAttributableUsd);
  const contributionPct =
    totalRevenueUsd > 0
      ? Math.round((totalContributionUsd / totalRevenueUsd) * 10000) / 100
      : null;

  // Coverage — who is NOT in these numbers. Orgs with no snapshot are excluded
  // from every figure above; averaging them in as zeros would be a fabrication.
  const allOrgs = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .limit(5000);
  const snapshotIds = new Set(customers.map((c) => c.organizationId));
  const missingAll = allOrgs.filter((o) => !snapshotIds.has(o.id));
  const coverageLine =
    allOrgs.length === 0
      ? // "Everyone is covered" is a lie when there is nobody. Say the real thing.
        "No organizations on record yet, so there is nothing to cover."
      : missingAll.length === 0
        ? `Every organization on record (${allOrgs.length}) has a snapshot — nothing is missing from these figures.`
        : `${missingAll.length} of ${allOrgs.length} organizations have no snapshot yet and are NOT in these figures — they are excluded, not counted as zero.`;

  // FRESHNESS — a snapshot from months ago is not a statement about today. The
  // roll-up is only as current as its newest row, and the spread matters when
  // some orgs stopped being recomputed; both render, so the figures above can
  // never quietly pass off stale arithmetic as the present.
  const computedTimes = customers
    .map((c) => Date.parse(c.computedAt))
    .filter((t) => Number.isFinite(t));
  const newestComputedAt =
    computedTimes.length > 0 ? new Date(Math.max(...computedTimes)).toISOString() : null;
  const oldestComputedAt =
    computedTimes.length > 0 ? new Date(Math.min(...computedTimes)).toISOString() : null;
  // An AGE, not just a date: readUnitEconomicsRollup has no recency bound, so
  // if the nightly job died three months ago these figures would still render
  // in the present tense against the margin floor (fleet-9 verifier catch).
  const ageDays =
    newestComputedAt === null
      ? null
      : Math.max(0, Math.floor((Date.now() - Date.parse(newestComputedAt)) / 86_400_000));
  const stale = ageDays !== null && ageDays > RECEIPT_STALE_AFTER_DAYS;
  const freshnessLine =
    newestComputedAt === null
      ? "Nothing has been computed yet, so these figures have no as-of date."
      : stale
        ? `These numbers are ${ageDays} days old — the nightly roll-up has not run since ${newestComputedAt.slice(0, 10)}, so they describe that day, not today.`
        : newestComputedAt === oldestComputedAt
          ? `All snapshots computed ${newestComputedAt.slice(0, 10)} (${ageDays === 0 ? "today" : `${ageDays}d ago`}).`
          : `Newest snapshot ${newestComputedAt.slice(0, 10)} (${ageDays === 0 ? "today" : `${ageDays}d ago`}); the oldest still in this roll-up is from ${oldestComputedAt!.slice(0, 10)}.`;

  const series = await readDailySeries(90);
  const direction = deriveDirection(series);

  const noSnapshots = withSnapshot === 0;
  const absentReason = "No organization has a unit-economics snapshot yet — the nightly rollup has not produced one.";

  // GROSS margin — revenue − (attributable + allocated). This is the number the
  // ≥70% charter gate is written against, and it is deliberately NOT the
  // contribution margin above: contribution excludes the allocated fixed share
  // and therefore always reads HIGHER. Comparing contribution to a gross-margin
  // floor would flatter the company by exactly the size of the allocation, so
  // the floor verdict is computed here and nowhere else. `rollup.totals` is the
  // existing engine definition — reused so the Letter and the costs dashboard
  // cannot disagree about the same month.
  const grossMarginPct = rollup.totals.totalMrrUsd > 0 ? rollup.totals.grossMarginPct : null;

  return {
    asOf: new Date().toISOString(),
    rollup: {
      // ORGS, not customers — computeAllOrgs snapshots every row in
      // `organizations`, so free-tier orgs, trials and the demo org are in
      // this number. The paying figure travels with it so the Letter can
      // qualify rather than imply (fleet-9 verifier catch).
      customersWithSnapshot: figure(
        withSnapshot,
        "customer_unit_economics — count of ORGS with a latest snapshot (includes free/trial)",
        null,
      ),
      payingCustomers: figure(
        noSnapshots ? null : rollup.totals.payingCustomerCount,
        "customer_unit_economics — orgs with mrr_usd > 0 in their latest snapshot",
        absentReason,
      ),
      // ZERO NEEDS EVIDENCE, at the roll-up too — this is the level the Letter
      // leads with, and "$0 attributable cost" reads as thrift when the truth
      // may be "nothing was metered" (fleet-9 verifier catch). Null when the
      // per-org counts could not be read at all: unknown is not zero.
      billedEvents: figure(
        noSnapshots || rollupBilledEvents === null ? null : rollupBilledEvents,
        "customer_unit_economics — billed events summed across the same latest snapshots",
        noSnapshots ? absentReason : "Per-org billed-event counts could not be read.",
      ),
      revenueUsd: figure(
        noSnapshots ? null : totalRevenueUsd,
        "customer_unit_economics.mrr_usd, summed across latest snapshots",
        absentReason,
      ),
      attributableCostUsd: figure(
        noSnapshots ? null : totalAttributableUsd,
        "customer_unit_economics — the five ledger-sourced COGS columns (ai + mail + sms + email + skip-trace), summed",
        absentReason,
      ),
      contributionUsd: figure(
        noSnapshots ? null : totalContributionUsd,
        "revenue − attributable cost (allocated fixed share excluded)",
        absentReason,
      ),
      contributionPct: figure(
        contributionPct,
        "contribution ÷ revenue",
        noSnapshots
          ? absentReason
          : "Recorded revenue is $0, so a contribution percentage has no denominator.",
      ),
      allocatedFixedShareUsd: figure(
        noSnapshots ? null : totalAllocatedUsd,
        "customer_unit_economics.fixed_cost_share_usd — an ALLOCATION of declared monthly constants, not a measured per-customer cost",
        absentReason,
      ),
      grossMarginPct: figure(
        grossMarginPct,
        "readUnitEconomicsRollup totals — (revenue − total COGS, allocation INCLUDED) ÷ revenue. This is the figure the declared floor is written against.",
        noSnapshots
          ? absentReason
          : "Recorded revenue is $0, so a gross margin has no denominator.",
      ),
    },
    marginFloorPct: RECEIPT_MARGIN_FLOOR_PCT,
    // Judged on GROSS margin, never on contribution — see the note above.
    belowFloor: grossMarginPct === null ? null : grossMarginPct < RECEIPT_MARGIN_FLOOR_PCT,
    customers,
    coverage: {
      organizationsTotal: allOrgs.length,
      withSnapshot,
      withoutSnapshot: missingAll.length,
      missing: missingAll.slice(0, 25).map((o) => ({ organizationId: o.id, organizationName: o.name })),
      line: coverageLine,
    },
    freshness: {
      newestComputedAt,
      oldestComputedAt,
      ageDays,
      stale,
      staleAfterDays: RECEIPT_STALE_AFTER_DAYS,
      line: freshnessLine,
    },
    direction,
  };
}

/**
 * The infra curve — cost per unit of work over the real snapshot history.
 * Refuses to draw below INFRA_CURVE_MIN_POINTS distinct snapshot dates.
 */
export async function readInfraCurve(days = 90): Promise<InfraCurve> {
  const points = await readDailySeries(days);
  const sufficient = points.length >= INFRA_CURVE_MIN_POINTS;
  const fixed = FIXED_COST_INPUTS_USD_MONTHLY;
  const drawable = points.filter((p) => p.costPerUnitUsd !== null);

  let reason: string;
  if (points.length === 0) {
    reason = `No unit-economics snapshots in the last ${days} days — there is no history to plot.`;
  } else if (!sufficient) {
    reason =
      `Only ${points.length} snapshot ${points.length === 1 ? "day" : "days"} in the last ${days} — ` +
      `a curve needs at least ${INFRA_CURVE_MIN_POINTS}. Drawing a line through this would flatter the data.`;
  } else if (drawable.length < INFRA_CURVE_MIN_POINTS) {
    reason =
      `${points.length} snapshot days exist, but only ${drawable.length} recorded any billed work — ` +
      `cost per unit is undefined on the rest, so the curve would be mostly gaps.`;
  } else {
    reason =
      `Cost per unit of work = ledger-sourced variable cost ÷ billed events, per snapshot day. ` +
      `Each point is a trailing-${points[points.length - 1].windowDays}-day window, so consecutive days overlap: ` +
      `this shows drift, not daily spend.`;
  }

  return {
    asOf: new Date().toISOString(),
    sufficient: sufficient && drawable.length >= INFRA_CURVE_MIN_POINTS,
    reason,
    minPointsRequired: INFRA_CURVE_MIN_POINTS,
    points,
    latest: points.length > 0 ? points[points.length - 1] : null,
    declaredFixedInputsUsdMonthly: {
      fly: fixed.fly,
      postgres: fixed.postgres,
      clerk: fixed.clerk,
      sentry: fixed.sentry,
      total: totalFixedMonthlyUsd(),
    },
    notMeasured: [...INFRA_NOT_MEASURED],
    href: INFRA_CURVE_HREF,
  };
}
