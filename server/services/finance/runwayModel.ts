// ============================================================================
// server/services/finance/runwayModel.ts
// ----------------------------------------------------------------------------
// LENA (CFO/CIO) #1 — the runway-to-zero engine. Three scenarios, one number.
//
// My charter names runway-to-zero as "the single most-watched number after
// MRR," refreshed weekly, always in base / downside / upside. The P0 surface
// (routes-founder-money summary) was an honest-but-crude placeholder: a
// founder-typed `FOUNDER_CASH_ON_HAND_USD` env var divided by a trailing
// 30-day burn. This module replaces that with a REAL model read off the
// system-of-record:
//
//   • burn   — opex actually spent against the financial_ledger (category
//              'opex_spent', the only category that debits opex_available),
//              normalised to a monthly figure, PLUS the founder-declared
//              fixed infra lines (Fly + other) which are not yet on the
//              ledger. AI/agent spend that posts to solene_capital_events is
//              folded in too (it's company burn that never hits the customer
//              ledger).
//   • cash   — the SUM of the real reserve-bucket balances on the ledger
//              (profit_reserve + opex_available + owner_draw — the spendable
//              + retained capital), with the founder-declared cash kept ONLY
//              as a labeled override when it is set and larger (the ledger
//              can't see a bank balance that was never run through Stripe).
//   • MRR    — summed from live paying orgs via monthlyRevenueCentsFor.
//
// Three scenarios:
//   base     — cash ÷ current monthly burn (MRR offsets burn).
//   downside — revenue held FLAT (no new MRR) + costs +20%. The stress case.
//   upside   — the trailing MRR week-over-week growth continues compounding,
//              offsetting more burn each month.
//
// Each scenario returns monthsToZero + a WoW trend delta (this week's
// monthsToZero minus last week's, computed from the 7-days-ago ledger
// snapshot) so the cockpit can show "14mo base, stable WoW".
//
// PURE-ISH: all DB reads are aggregations on the ledger + orgs. No writes.
// Exported sub-helpers (projectMonthsToZero, buildScenarios) are unit-tested
// directly so the scenario math is provable without a database.
// ============================================================================

import { and, eq, gte, lt, sql } from "drizzle-orm";

import { db } from "../../db";
import { financialLedger, organizations } from "@shared/schema";
import { monthlyRevenueCentsFor } from "@shared/billing/tier-pricing";
import type { BillingInterval } from "@shared/billing/tier-pricing";
import { soleneCapitalEvents } from "@shared/schema/solene-capital";
import { logger } from "../../utils/logger";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30;

/** Downside stress multiplier on costs (+20%). */
export const DOWNSIDE_COST_MULTIPLIER = 1.2;

/** Cap projected runway at this many months so an MRR-positive company shows a
 *  finite, honest ceiling rather than `Infinity`. */
export const RUNWAY_CAP_MONTHS = 120;

// ── Scenario types ───────────────────────────────────────────────────────────

export interface RunwayScenario {
  /** Months until cash hits zero under this scenario. Capped at RUNWAY_CAP_MONTHS.
   *  null when not computable (no cash basis at all). */
  monthsToZero: number | null;
  /** Net monthly burn (USD) used for this scenario: costs − MRR offset. A
   *  NEGATIVE value means the company is net cash-positive (MRR > burn). */
  netMonthlyBurnUsd: number;
  /** Gross monthly costs (USD) under this scenario, before MRR offset. */
  monthlyCostsUsd: number;
  /** Monthly recurring revenue (USD) assumed under this scenario. */
  mrrUsd: number;
  /** monthsToZero a week ago under the same scenario, for the WoW delta. */
  monthsToZeroPriorWeek: number | null;
  /** monthsToZero − monthsToZeroPriorWeek (positive = runway lengthening). */
  wowDeltaMonths: number | null;
}

export interface RunwayResult {
  asOf: string;
  cashOnHandUsd: number;
  /** "ledger" when cash came from real bucket balances, "founder-declared"
   *  when the env override was larger and used instead. */
  cashBasis: "ledger" | "founder-declared";
  /** True — this IS a model (unlike the P0 placeholder). */
  isModeled: true;
  scenarios: {
    base: RunwayScenario;
    downside: RunwayScenario;
    upside: RunwayScenario;
  };
  /** Transparency block — every input that fed the model, so the surface can
   *  show its work (we sell a provenance contract; our own runway honours it). */
  inputs: {
    ledgerCashUsd: number;
    founderDeclaredCashUsd: number | null;
    monthlyOpexUsd: number;
    monthlyAiBurnUsd: number;
    fixedInfraMonthlyUsd: number;
    mrrUsd: number;
    mrrPriorWeekUsd: number;
    wowMrrGrowthRate: number;
  };
}

// ── Pure scenario math (unit-tested directly) ────────────────────────────────

/**
 * Months until `cashUsd` is exhausted given a NET monthly burn (costs minus
 * MRR offset). If net burn is ≤ 0 the company is cash-neutral-or-positive →
 * runway is effectively unbounded; we return the cap so the surface shows a
 * finite, honest ceiling rather than Infinity. Returns null only when there is
 * no cash basis to model at all (cash ≤ 0).
 */
export function projectMonthsToZero(
  cashUsd: number,
  netMonthlyBurnUsd: number,
): number | null {
  if (!Number.isFinite(cashUsd) || cashUsd <= 0) return null;
  if (!Number.isFinite(netMonthlyBurnUsd) || netMonthlyBurnUsd <= 0) {
    // Net cash-positive (or zero burn) — unbounded; report the capped ceiling.
    return RUNWAY_CAP_MONTHS;
  }
  return Math.min(RUNWAY_CAP_MONTHS, cashUsd / netMonthlyBurnUsd);
}

/**
 * Build the three scenarios from the raw inputs. Separated from the DB reads so
 * the scenario arithmetic is unit-testable with no database.
 */
export function buildScenarios(args: {
  cashUsd: number;
  cashUsdPriorWeek: number;
  monthlyCostsUsd: number;
  monthlyCostsPriorWeekUsd: number;
  mrrUsd: number;
  mrrPriorWeekUsd: number;
  /** WoW MRR growth rate (e.g. 0.05 = +5%/week), used to compound the upside. */
  wowMrrGrowthRate: number;
}): RunwayResult["scenarios"] {
  const {
    cashUsd,
    cashUsdPriorWeek,
    monthlyCostsUsd,
    monthlyCostsPriorWeekUsd,
    mrrUsd,
    mrrPriorWeekUsd,
    wowMrrGrowthRate,
  } = args;

  function scenario(
    costs: number,
    mrr: number,
    priorCosts: number,
    priorMrr: number,
    priorCash: number,
    cash: number,
  ): RunwayScenario {
    const netBurn = costs - mrr;
    const netBurnPrior = priorCosts - priorMrr;
    const monthsToZero = projectMonthsToZero(cash, netBurn);
    const monthsToZeroPriorWeek = projectMonthsToZero(priorCash, netBurnPrior);
    const wowDeltaMonths =
      monthsToZero != null && monthsToZeroPriorWeek != null
        ? round2(monthsToZero - monthsToZeroPriorWeek)
        : null;
    return {
      monthsToZero: monthsToZero != null ? round2(monthsToZero) : null,
      netMonthlyBurnUsd: round2(netBurn),
      monthlyCostsUsd: round2(costs),
      mrrUsd: round2(mrr),
      monthsToZeroPriorWeek:
        monthsToZeroPriorWeek != null ? round2(monthsToZeroPriorWeek) : null,
      wowDeltaMonths,
    };
  }

  // BASE — current costs, current MRR.
  const base = scenario(
    monthlyCostsUsd,
    mrrUsd,
    monthlyCostsPriorWeekUsd,
    mrrPriorWeekUsd,
    cashUsdPriorWeek,
    cashUsd,
  );

  // DOWNSIDE — revenue held flat (no new MRR; we keep TODAY's MRR as the flat
  // line, not zero — "flat" means it stops growing) + costs +20%.
  const downsideCosts = monthlyCostsUsd * DOWNSIDE_COST_MULTIPLIER;
  const downsidePriorCosts = monthlyCostsPriorWeekUsd * DOWNSIDE_COST_MULTIPLIER;
  const downside = scenario(
    downsideCosts,
    mrrUsd,
    downsidePriorCosts,
    mrrPriorWeekUsd,
    cashUsdPriorWeek,
    cashUsd,
  );

  // UPSIDE — the trailing WoW MRR growth continues. We project the average MRR
  // over the next ~4 weeks of compounding as the offset (a single forward
  // figure keeps the months-to-zero arithmetic honest without a full
  // month-by-month sim). Costs held at current.
  const upsideMrr = mrrUsd * (1 + Math.max(0, wowMrrGrowthRate) * 4);
  const upside = scenario(
    monthlyCostsUsd,
    upsideMrr,
    monthlyCostsPriorWeekUsd,
    mrrPriorWeekUsd,
    cashUsdPriorWeek,
    cashUsd,
  );

  return { base, downside, upside };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── DB reads ─────────────────────────────────────────────────────────────────

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Sum of signed amounts (cents) for a bucket, optionally as-of a cutoff
 *  (rows posted strictly before `before`). Mirrors getBucketBalance but with an
 *  upper-bound so we can reconstruct a prior-week snapshot. */
async function bucketBalanceAsOf(
  bucket: string,
  before?: Date,
): Promise<number> {
  const where = before
    ? and(eq(financialLedger.bucket, bucket), lt(financialLedger.postedAt, before))
    : eq(financialLedger.bucket, bucket);
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${financialLedger.amountCents}), 0)`.mapWith(
        Number,
      ),
    })
    .from(financialLedger)
    .where(where);
  return row?.total ?? 0;
}

/** Monthly opex (USD) = (sum of |opex_spent| over the window) normalised to 30d. */
async function monthlyOpexUsd(windowStart: Date, windowEnd: Date): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${financialLedger.amountCents}), 0)`.mapWith(
        Number,
      ),
    })
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.category, "opex_spent"),
        gte(financialLedger.postedAt, windowStart),
        lt(financialLedger.postedAt, windowEnd),
      ),
    );
  const spentCents = Math.abs(row?.total ?? 0); // opex rows are negative
  const windowDays = Math.max(
    1,
    (windowEnd.getTime() - windowStart.getTime()) / ONE_DAY_MS,
  );
  return (spentCents / 100) * (DAYS_PER_MONTH / windowDays);
}

/** AI/agent burn (USD) from solene_capital_events over the window, normalised
 *  to 30d. This is company burn that never hits the customer ledger. */
async function monthlyAiBurnUsd(windowStart: Date, windowEnd: Date): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${soleneCapitalEvents.costUsd}), 0)`.mapWith(
        Number,
      ),
    })
    .from(soleneCapitalEvents)
    .where(
      and(
        gte(soleneCapitalEvents.occurredAt, windowStart),
        lt(soleneCapitalEvents.occurredAt, windowEnd),
      ),
    );
  const usd = row?.total ?? 0;
  const windowDays = Math.max(
    1,
    (windowEnd.getTime() - windowStart.getTime()) / ONE_DAY_MS,
  );
  return usd * (DAYS_PER_MONTH / windowDays);
}

/** Live MRR (USD) summed across paying active orgs. */
async function liveMrrUsd(): Promise<number> {
  const rows = await db
    .select({
      tier: organizations.subscriptionTier,
      status: organizations.subscriptionStatus,
      interval: organizations.billingInterval,
    })
    .from(organizations);
  let cents = 0;
  for (const r of rows) {
    if (r.status !== "active") continue;
    cents += monthlyRevenueCentsFor(
      r.tier,
      (r.interval as BillingInterval) ?? "monthly",
    );
  }
  return cents / 100;
}

/**
 * Compute the three-scenario runway off the real ledger. This is the function
 * routes-founder-money wires into its summary.
 */
export async function computeRunway(): Promise<RunwayResult> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * ONE_DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * ONE_DAY_MS);
  // Prior-week 30-day window: [37d ago, 7d ago).
  const thirtySevenDaysAgo = new Date(now.getTime() - 37 * ONE_DAY_MS);

  const [
    profitReserve,
    opexAvail,
    ownerDraw,
    profitReservePrior,
    opexAvailPrior,
    ownerDrawPrior,
    opexMonthly,
    opexMonthlyPrior,
    aiBurnMonthly,
    aiBurnMonthlyPrior,
    mrrUsd,
  ] = await Promise.all([
    bucketBalanceAsOf("profit_reserve"),
    bucketBalanceAsOf("opex_available"),
    bucketBalanceAsOf("owner_draw"),
    bucketBalanceAsOf("profit_reserve", weekAgo),
    bucketBalanceAsOf("opex_available", weekAgo),
    bucketBalanceAsOf("owner_draw", weekAgo),
    monthlyOpexUsd(thirtyDaysAgo, now),
    monthlyOpexUsd(thirtySevenDaysAgo, weekAgo),
    monthlyAiBurnUsd(thirtyDaysAgo, now),
    monthlyAiBurnUsd(thirtySevenDaysAgo, weekAgo),
    liveMrrUsd(),
  ]);

  // MRR prior-week proxy: we don't persist a weekly MRR snapshot yet, so use
  // today's MRR as the prior baseline (delta defaults to 0 until a snapshot
  // history exists). Honest: we label growth rate 0 when there's no history.
  const mrrPriorWeekUsd = mrrUsd;
  const wowMrrGrowthRate =
    mrrPriorWeekUsd > 0 ? (mrrUsd - mrrPriorWeekUsd) / mrrPriorWeekUsd : 0;

  // Real cash = spendable + retained reserves on the ledger (cents → USD).
  const ledgerCashUsd = (profitReserve + opexAvail + ownerDraw) / 100;
  const ledgerCashUsdPrior =
    (profitReservePrior + opexAvailPrior + ownerDrawPrior) / 100;

  // Founder-declared cash override — used only when SET and LARGER than the
  // ledger (the ledger can't see a bank balance never run through Stripe).
  const founderDeclared = process.env.FOUNDER_CASH_ON_HAND_USD
    ? envFloat("FOUNDER_CASH_ON_HAND_USD", 0)
    : null;
  const useFounderCash =
    founderDeclared != null && founderDeclared > ledgerCashUsd;
  const cashOnHandUsd = useFounderCash ? founderDeclared! : ledgerCashUsd;
  const cashUsdPriorWeek = useFounderCash ? founderDeclared! : ledgerCashUsdPrior;

  // Fixed infra lines — founder-declared env knobs (not yet on the ledger).
  const fixedInfraMonthlyUsd =
    envFloat("FLY_INFRA_MONTHLY_USD", 24) + envFloat("OTHER_INFRA_MONTHLY_USD", 0);

  const monthlyCostsUsd = opexMonthly + aiBurnMonthly + fixedInfraMonthlyUsd;
  const monthlyCostsPriorWeekUsd =
    opexMonthlyPrior + aiBurnMonthlyPrior + fixedInfraMonthlyUsd;

  const scenarios = buildScenarios({
    cashUsd: cashOnHandUsd,
    cashUsdPriorWeek,
    monthlyCostsUsd,
    monthlyCostsPriorWeekUsd,
    mrrUsd,
    mrrPriorWeekUsd,
    wowMrrGrowthRate,
  });

  logger.info("[runwayModel] computeRunway", {
    metadata: {
      cashOnHandUsd,
      cashBasis: useFounderCash ? "founder-declared" : "ledger",
      monthlyCostsUsd,
      mrrUsd,
      baseMonthsToZero: scenarios.base.monthsToZero,
      downsideMonthsToZero: scenarios.downside.monthsToZero,
    },
  });

  return {
    asOf: now.toISOString(),
    cashOnHandUsd: round2(cashOnHandUsd),
    cashBasis: useFounderCash ? "founder-declared" : "ledger",
    isModeled: true,
    scenarios,
    inputs: {
      ledgerCashUsd: round2(ledgerCashUsd),
      founderDeclaredCashUsd: founderDeclared,
      monthlyOpexUsd: round2(opexMonthly),
      monthlyAiBurnUsd: round2(aiBurnMonthly),
      fixedInfraMonthlyUsd: round2(fixedInfraMonthlyUsd),
      mrrUsd: round2(mrrUsd),
      mrrPriorWeekUsd: round2(mrrPriorWeekUsd),
      wowMrrGrowthRate: round2(wowMrrGrowthRate),
    },
  };
}
