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
