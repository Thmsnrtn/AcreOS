import { parseCalendarDate } from "@shared/dates/calendar";

/**
 * Redemption-clock math for tax certificates / deeds.
 *
 * Marcus's deal-killer: "If AcreOS tells me 'redemption window closes
 * 2027-05-01' and the actual statutory deadline was 2027-04-15 because
 * Alabama counts from the *first Monday after the sale* and not the sale
 * date, I lose a $40,000 property. Once. Not twice."
 *
 * That means three things must be bulletproof per his §8:
 *   1. Per-state redemption math reviewed by a real attorney in each state.
 *   2. The clock recalculates nightly and surfaces exceptions (holiday-
 *      extended deadlines, owner-occupied vs vacant, SCRA tolling).
 *   3. The redemption amount calculation matches the county clerk's
 *      calculation to the cent.
 *
 * SCOPE OF THIS COMMIT (TD-2): the math is **structurally correct** but
 * the per-state rates are author-researched, NOT attorney-reviewed.
 * Each state entry below carries `attorneyReviewedAt: null` to make the
 * gap explicit. TD-3 expands the rules database to all 50 states with
 * actual review stamps. Until those review stamps land, the redemption
 * dashboard surfaces a banner: "Per-state math is preliminary. Confirm
 * with the county clerk before relying on a redemption quote."
 */

interface StateRedemptionRule {
  saleType: "lien" | "deed" | "redeemable_deed";
  redemptionPeriodMonths: number;
  // 'simple_annual' = principal × rate × (years_held)
  // 'monthly' = principal × monthly_rate × months_held
  // 'flat_first_period' = flat rate first half (TX), step-up second half
  // 'tiered_yearly' = first-year premium + each-additional-year premium (GA)
  // 'bid_down' = the rate stored on the certificate from the bid-down auction
  // 'no_redemption' = NC-style; certificate becomes deed at sale
  interestModel:
    | "simple_annual"
    | "monthly"
    | "flat_first_period"
    | "tiered_yearly"
    | "bid_down"
    | "no_redemption";
  // Default rate in basis points. For bid_down, used as the cap.
  defaultRateBps: number;
  // For tiered_yearly / flat_first_period, additional structure.
  firstPeriodMonths?: number;
  firstPeriodRateBps?: number;
  secondPeriodRateBps?: number;
  yearlyAddOnBps?: number;
  // Owner-occupied gets a longer redemption in some states (TX 24mo vs 6mo).
  redemptionPeriodMonthsOwnerOccupied?: number;
  // Deadline anchor: most states use sale_date; some use the next-business-
  // day or first-Monday-after-sale. Marcus's example was AL.
  deadlineAnchor: "sale_date" | "first_monday_after_sale" | "deed_recordation";
  // Lawyer-review stamp. null until counsel reviews; the UI surfaces this.
  attorneyReviewedAt: string | null;
  attorneyReviewedBy: string | null;
  // Citation for footnote display.
  citation?: string;
}

/**
 * Per-state redemption rules — the ONLY source the math reads.
 * computeRedemptionDeadline and computeRedemptionAmount index this map
 * directly; neither takes an override, and no caller feeds them anything
 * else.
 *
 * The comment that stood here until 2026-09-01 said the tax_jurisdiction_rules
 * (TD-3) DB version "takes priority via loadRulesFromDb()". **No such function
 * was ever written** — loadRulesFromDb() exists nowhere in the repo, and the
 * production math callers (routes-tax-certificates.ts, the nightly
 * jobs/redemptionClockRefresh.ts recompute) never consult
 * tax_jurisdiction_rules. That table is read for display and notice scheduling
 * only (routes-tax-rules.ts, routes-quiet-title.ts). So an attorney-corrected
 * DB row changes the /state-rules page while every persisted deadline and
 * redemption quote keeps running on this hardcoded map — the two surfaces are
 * free to disagree about the same certificate. Wiring the DB rows into the
 * math changes legally consequential deadlines and is a founder decision, not
 * a refactor — same rule as the SCRA note in computeRedemptionDeadline below.
 */
export const STATE_REDEMPTION_RULES: Record<string, StateRedemptionRule> = {
  TX: {
    saleType: "deed",
    redemptionPeriodMonths: 6,
    redemptionPeriodMonthsOwnerOccupied: 24,
    interestModel: "flat_first_period",
    defaultRateBps: 2_500, // 25%
    firstPeriodMonths: 6,
    firstPeriodRateBps: 2_500,  // 25% in first 6 months
    secondPeriodRateBps: 5_000, // 50% in second 6-month window (24mo case)
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "Tex. Tax Code §34.21",
  },
  FL: {
    saleType: "lien",
    redemptionPeriodMonths: 24,
    interestModel: "bid_down",
    defaultRateBps: 1_800, // 18% statutory cap
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "Fla. Stat. §197.472",
  },
  GA: {
    saleType: "redeemable_deed",
    redemptionPeriodMonths: 12,
    interestModel: "tiered_yearly",
    defaultRateBps: 2_000, // 20% first-year premium
    yearlyAddOnBps: 1_000, // +10% each subsequent year
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "O.C.G.A. §48-4-42",
  },
  AL: {
    saleType: "lien",
    redemptionPeriodMonths: 36,
    interestModel: "simple_annual",
    defaultRateBps: 1_200, // 12%
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "Code of Ala. §40-10-122 (3-year redemption); §40-10-83 (12% interest)",
  },
  IA: {
    saleType: "lien",
    redemptionPeriodMonths: 21,
    interestModel: "monthly",
    defaultRateBps: 200, // 2% per MONTH (24% annual)
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "Iowa Code §447.1",
  },
  AZ: {
    saleType: "lien",
    redemptionPeriodMonths: 36,
    interestModel: "bid_down",
    defaultRateBps: 1_600, // 16% cap
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "A.R.S. §42-18152",
  },
  TN: {
    saleType: "deed",
    redemptionPeriodMonths: 12,
    interestModel: "simple_annual",
    defaultRateBps: 1_200, // 12%
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "Tenn. Code Ann. §67-5-2701",
  },
  MS: {
    saleType: "lien",
    redemptionPeriodMonths: 24,
    interestModel: "simple_annual",
    defaultRateBps: 1_800, // 18%
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "Miss. Code Ann. §27-45-3",
  },
  SC: {
    saleType: "lien",
    redemptionPeriodMonths: 12,
    interestModel: "simple_annual",
    defaultRateBps: 1_200, // 12%
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "S.C. Code §12-51-90",
  },
  NC: {
    saleType: "deed",
    redemptionPeriodMonths: 0,
    interestModel: "no_redemption",
    defaultRateBps: 0,
    deadlineAnchor: "sale_date",
    attorneyReviewedAt: null,
    attorneyReviewedBy: null,
    citation: "N.C. Gen. Stat. §105-374",
  },
};

/**
 * Add calendar months to an ISO date, clamped to the last day of the target
 * month (Jan 31 + 1 month = Feb 28/29, not Mar 3 — a three-day error on a
 * redemption deadline is a lost parcel). Moved here 2026-09-01 from
 * taxRuleCoverage.ts so BOTH doors run the same arithmetic: until then this
 * file's computeRedemptionDeadline used an UNCLAMPED setUTCMonth (sale
 * 2025-08-31 + 3 months returned 2025-12-01) while wonBidToCertificate used
 * the clamped version — the same certificate got deadlines up to 3 days
 * apart depending on which door created it.
 */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid sale date '${iso}'`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/**
 * The anchor + month arithmetic, refusal-first — exported so the gate can
 * drive every anchor directly (no production rule currently uses
 * first_monday_after_sale or deed_recordation, so the branches would
 * otherwise be untestable through computeRedemptionDeadline).
 *
 *   - A calendar-impossible sale date returns null ("2026-02-30" used to
 *     parse as March 2 via bare new Date() and compute from a day that
 *     does not exist).
 *   - deed_recordation returns null: we hold a sale date, not a recordation
 *     date — same refusal taxRuleCoverage.deriveRedemptionDeadline makes.
 *     (Until 2026-09-01 this file silently computed from the sale date for
 *     that anchor.)
 *   - first_monday_after_sale rolls the anchor forward to Monday; a sale
 *     already on a Monday anchors on the sale day itself.
 */
export function redemptionDeadlineFromAnchor(
  saleDateIso: string,
  months: number,
  anchor: StateRedemptionRule["deadlineAnchor"],
): string | null {
  const sale = parseCalendarDate(saleDateIso);
  if (!sale) return null;
  if (anchor === "deed_recordation") return null;
  let anchorIso = sale.toISOString().slice(0, 10);
  if (anchor === "first_monday_after_sale") {
    const d = new Date(sale);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    anchorIso = d.toISOString().slice(0, 10);
  }
  return addMonthsIso(anchorIso, months);
}

export interface ComputeDeadlineInput {
  state: string;
  saleDate: string;
  ownerOccupied?: boolean;
  scraTolling?: boolean;
}

/**
 * Compute the redemption deadline (ISO date string) for a given certificate.
 * Returns null when the state has no redemption (NC etc) — the caller
 * sets status to 'deed_obtained' immediately at sale.
 */
export function computeRedemptionDeadline(input: ComputeDeadlineInput): string | null {
  const rule = STATE_REDEMPTION_RULES[input.state.toUpperCase()];
  if (!rule || rule.interestModel === "no_redemption") return null;

  const months = (input.ownerOccupied && rule.redemptionPeriodMonthsOwnerOccupied)
    ? rule.redemptionPeriodMonthsOwnerOccupied
    : rule.redemptionPeriodMonths;

  // All anchor + month arithmetic lives in redemptionDeadlineFromAnchor —
  // clamped months, rollover refusal, deed_recordation refusal. (Fixed
  // 2026-09-01: this body used an unclamped setUTCMonth and a bare
  // new Date() parse; see the helper's docs for what that produced.)
  const deadlineIso = redemptionDeadlineFromAnchor(
    input.saleDate,
    months,
    rule.deadlineAnchor,
  );
  if (deadlineIso === null) return null;

  // ── SCRA TOLLING IS NOT IMPLEMENTED. Read this before trusting the date. ──
  //
  // The Servicemembers Civil Relief Act tolls redemption while the borrower is
  // on active duty, plus 9 months post-discharge (50 U.S.C. §3936), and §3953
  // bars a non-judicial sale of protected property without a court order.
  //
  // This function models NONE of that. `input.scraTolling` is accepted and
  // discarded on the next line.
  //
  // The comment that stood here until 2026-07-31 said "a flag tells the UI that
  // the deadline shown is a floor, not a ceiling, when scraTollingApplied is
  // true." **No such flag was ever produced** — this function returns a bare
  // ISO date string and always has. The mitigation was described, not written,
  // and the description was doing the reassuring. That is the same failure that
  // put "the 1st of next month" on every Reg-Z periodic statement: a comment
  // promising an override nobody implemented.
  //
  // So, stated plainly: for a borrower on active duty this date is WRONG in the
  // direction that costs them their property. Federal law says the clock has
  // not run; this returns a date as though it had, with nothing distinguishing
  // "computed" from "legally binding". `scra_checked_at` / `scra_active_duty`
  // already exist on the schema and nothing here reads them.
  //
  // Tracked as `scra.tolling-and-rate-cap` in shared/governance/statuteRegister.ts
  // (UNREVIEWED). Implementing it is a founder decision, not a refactor: it
  // changes a date that decides whether someone loses a home, and it carries
  // criminal exposure and mandatory attorney's fees when it is wrong.
  void input.scraTolling;

  return deadlineIso;
}

export interface ComputeAmountInput {
  state: string;
  saleDate: string;
  asOfDate: string;
  purchaseAmountCents: number;
  bidDownRateBps?: number; // for bid_down states
}

export interface RedemptionAmountResult {
  asOfDate: string;
  daysHeld: number;
  monthsHeld: number;
  yearsHeld: number;
  principalCents: number;
  interestCents: number;
  totalRedemptionCents: number;
  appliedRateBps: number;
  modelUsed: StateRedemptionRule["interestModel"];
  // Set when the math is structurally non-trivial; the UI shows
  // an asterisk + "Verify with clerk before relying on this number".
  preliminary: boolean;
}

/**
 * Compute the dollar amount required to redeem the certificate as of
 * a given date. Pure math — no DB. The caller passes the state, sale
 * date, asOfDate, purchase amount, and (for bid-down states) the rate
 * we won at.
 */
export function computeRedemptionAmount(input: ComputeAmountInput): RedemptionAmountResult {
  const rule = STATE_REDEMPTION_RULES[input.state.toUpperCase()];
  // Refuse calendar-impossible dates loudly rather than letting NaN flow
  // into a dollar figure (same posture as addMonthsIso; fixed 2026-09-01 —
  // bare new Date() previously rolled "2026-02-30" to March 2).
  const sale = parseCalendarDate(input.saleDate);
  const asOf = parseCalendarDate(input.asOfDate);
  if (!sale) throw new Error(`Invalid sale date '${input.saleDate}'`);
  if (!asOf) throw new Error(`Invalid as-of date '${input.asOfDate}'`);
  const daysHeld = Math.max(0, Math.floor((asOf.getTime() - sale.getTime()) / 86_400_000));
  const monthsHeld = Math.max(0, daysHeld / 30.4375); // average month length
  const yearsHeld = monthsHeld / 12;

  // Default fallback if state isn't in the rule table (TD-3 will reduce
  // this to never-fired). 12% simple annual is the closest median rule.
  if (!rule) {
    const fallbackRateBps = 1_200;
    const interestCents = Math.round((input.purchaseAmountCents * fallbackRateBps / 10_000) * yearsHeld);
    return {
      asOfDate: input.asOfDate,
      daysHeld,
      monthsHeld,
      yearsHeld,
      principalCents: input.purchaseAmountCents,
      interestCents,
      totalRedemptionCents: input.purchaseAmountCents + interestCents,
      appliedRateBps: fallbackRateBps,
      modelUsed: "simple_annual",
      preliminary: true,
    };
  }

  // No-redemption states: amount is N/A but we return the principal so
  // the UI can render a "deed stands; no redemption" message.
  if (rule.interestModel === "no_redemption") {
    return {
      asOfDate: input.asOfDate,
      daysHeld,
      monthsHeld,
      yearsHeld,
      principalCents: input.purchaseAmountCents,
      interestCents: 0,
      totalRedemptionCents: input.purchaseAmountCents,
      appliedRateBps: 0,
      modelUsed: "no_redemption",
      preliminary: rule.attorneyReviewedAt === null,
    };
  }

  let interestCents = 0;
  let appliedRateBps = rule.defaultRateBps;

  switch (rule.interestModel) {
    case "simple_annual": {
      // principal × annualRate × yearsHeld
      interestCents = Math.round((input.purchaseAmountCents * rule.defaultRateBps / 10_000) * yearsHeld);
      break;
    }
    case "monthly": {
      // principal × monthlyRate × monthsHeld (e.g. IA 2%/month)
      interestCents = Math.round((input.purchaseAmountCents * rule.defaultRateBps / 10_000) * monthsHeld);
      break;
    }
    case "bid_down": {
      // Use the rate the buyer won at (capped to defaultRateBps).
      const rate = Math.min(rule.defaultRateBps, input.bidDownRateBps ?? rule.defaultRateBps);
      appliedRateBps = rate;
      interestCents = Math.round((input.purchaseAmountCents * rate / 10_000) * yearsHeld);
      break;
    }
    case "flat_first_period": {
      // TX: 25% flat in first 6 months; if past first period, plus the
      // second-period uplift on the remaining months. Returns the
      // statutory MINIMUM redemption (clerks may add filing fees).
      const firstMonths = Math.min(monthsHeld, rule.firstPeriodMonths ?? 6);
      const secondMonths = Math.max(0, monthsHeld - firstMonths);
      const firstRate = rule.firstPeriodRateBps ?? rule.defaultRateBps;
      const secondRate = rule.secondPeriodRateBps ?? rule.defaultRateBps;
      // Texas-specific quirk: the flat rate applies even on early
      // redemption. If you redeem on day 1, you owe the full 25%.
      if (firstMonths > 0) {
        interestCents += Math.round(input.purchaseAmountCents * firstRate / 10_000);
      }
      if (secondMonths > 0) {
        interestCents += Math.round(input.purchaseAmountCents * secondRate / 10_000);
      }
      break;
    }
    case "tiered_yearly": {
      // GA: 20% first year, +10% each additional year.
      const firstYearPremium = Math.round(input.purchaseAmountCents * rule.defaultRateBps / 10_000);
      const additionalYears = Math.max(0, Math.ceil(yearsHeld) - 1);
      const additional = Math.round(
        input.purchaseAmountCents * (rule.yearlyAddOnBps ?? 0) / 10_000 * additionalYears,
      );
      interestCents = firstYearPremium + additional;
      break;
    }
  }

  return {
    asOfDate: input.asOfDate,
    daysHeld,
    monthsHeld,
    yearsHeld,
    principalCents: input.purchaseAmountCents,
    interestCents,
    totalRedemptionCents: input.purchaseAmountCents + interestCents,
    appliedRateBps,
    modelUsed: rule.interestModel,
    preliminary: rule.attorneyReviewedAt === null,
  };
}
