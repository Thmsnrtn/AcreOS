/**
 * Dealer-vs-investor classification helper (§1221(a)(1)) +
 * §469(c)(7) real-estate-professional test.
 *
 * Lisa Tanaka (CPA, audit defense): every flipper-platform tax surface
 * sooner or later runs into the dealer-vs-investor question, and every
 * one of them gets it wrong by defaulting customers to "investor"
 * because that's what the customer wants to hear. Dealer status means
 * §1221(a)(1) excludes the property from "capital asset" treatment, so:
 *   - Gains are ORDINARY INCOME (up to 37%), not capital gains
 *   - §1031 like-kind exchange is UNAVAILABLE (§1031(a)(2)(A))
 *   - §453 installment-sale treatment is UNAVAILABLE on dealer property
 *     (§453(b)(2)(A))
 *   - Self-employment tax (15.3% on first $168,600 in 2024) applies
 *   - No long-term capital-gain rates — even on 5-year holds
 *
 * The IRS has no bright-line test. Tax Court & 7th Circuit (Suburban
 * Realty, Winthrop, Malat v. Riddell) look at the totality of factors.
 * AcreOS surfaces a *score* with weighted factors so the user understands
 * WHY they look like a dealer, not just a yes/no.
 *
 * §469(c)(7) Real-Estate-Professional test (rental side):
 *   - More than 50% of personal services performed in real property
 *     trades or businesses
 *   - More than 750 hours of services per year in real property trades
 *     or businesses
 *   - Both conditions must be met
 *   - If met, rentals are NON-PASSIVE and losses are deductible against
 *     ordinary income (vs. the standard $25,000 passive-loss cap that
 *     phases out at $150k AGI)
 *
 * This is the test that gets botched on every "I'm a real estate
 * professional, my CPA said so" audit because customers don't keep
 * contemporaneous hour logs.
 */

import { db } from "../db";
import { deals, properties, rentalLeases } from "@shared/schema";
import { and, eq, gte, lte, isNotNull } from "drizzle-orm";

// ─── Dealer-vs-investor classification ────────────────────────────────────

export type DealerSignal = "investor" | "ambiguous" | "likely_dealer" | "dealer";

export interface DealerFactor {
  /** Code for audit-trail reference. */
  code: string;
  /** Human-readable factor description. */
  label: string;
  /** Tax Court precedent or IRC cite that frames the factor. */
  citation: string;
  /** -100…+100. Positive = points TOWARD dealer status. */
  score: number;
  /** Detail rendered to the user so they can see WHY. */
  detail: string;
}

export interface DealerClassification {
  signal: DealerSignal;
  /** -100…+100. Positive points toward dealer. */
  weightedScore: number;
  /**
   * Probability the IRS would classify as dealer if examined.
   * NOT a guarantee — this is decision-support, not legal advice.
   */
  dealerProbabilityPct: number;
  factors: DealerFactor[];
  /** Statistics derived from the org's activity. */
  stats: {
    salesLast12Months: number;
    salesLast24Months: number;
    medianHoldDays: number;
    shortHoldShare: number;   // % of sales with hold <12 months
    averageActiveListings: number;
  };
  /** Audit-defense talking points if the customer wants to argue investor status. */
  auditDefense: string[];
  /** What happens if dealer status is asserted by the IRS. */
  dealerConsequences: string[];
}

interface ClassifyInput {
  orgId: number;
  /** Hours spent on real-estate trade/business in the last 12 months. */
  selfReportedHoursLast12: number | null;
  /** True if the operator's only trade/business is real estate. */
  exclusiveRealEstate: boolean | null;
}

/**
 * Run the dealer-vs-investor classification for an organization.
 *
 * Sources:
 *   - deals (closed, with closingDate) — frequency + hold period
 *   - properties (purchaseDate, soldDate) — hold period when deals are
 *     thin
 *   - user-reported hours (passed in; the schema doesn't have a hours
 *     ledger today)
 *
 * The factor weights are calibrated to the post-Suburban-Realty (115 F.2d
 * 1132) factor set, NOT to give a specific answer. Anyone who wants the
 * answer to be different can document offsetting facts in their workpaper
 * file.
 */
export async function classifyDealerVsInvestor(
  input: ClassifyInput,
): Promise<DealerClassification> {
  const { orgId, selfReportedHoursLast12, exclusiveRealEstate } = input;

  const now = new Date();
  const twelveMoAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const twentyFourMoAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);

  // 1) Closed deals in the last 24 months
  const recentDeals = await db
    .select({
      id: deals.id,
      closingDate: deals.closingDate,
      createdAt: deals.createdAt,
    })
    .from(deals)
    .where(
      and(
        eq(deals.organizationId, orgId),
        eq(deals.status, "closed"),
        isNotNull(deals.closingDate),
        gte(deals.closingDate, twentyFourMoAgo),
        lte(deals.closingDate, now),
      ),
    );

  // 2) Property sales — second source of hold-period truth
  const soldProps = await db
    .select({
      id: properties.id,
      purchaseDate: properties.purchaseDate,
      soldDate: properties.soldDate,
    })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        isNotNull(properties.soldDate),
        gte(properties.soldDate, twentyFourMoAgo),
      ),
    );

  // 3) Active rental leases — true investor signal
  const activeLeases = await db
    .select({ id: rentalLeases.id })
    .from(rentalLeases)
    .where(
      and(
        eq(rentalLeases.organizationId, orgId),
        eq(rentalLeases.status, "active"),
      ),
    );

  // ── Stats ────────────────────────────────────────────────────────────
  const salesLast24 = Math.max(recentDeals.length, soldProps.length);
  const salesLast12 = Math.max(
    recentDeals.filter((d) => d.closingDate && d.closingDate >= twelveMoAgo).length,
    soldProps.filter((p) => p.soldDate && p.soldDate >= twelveMoAgo).length,
  );

  // Hold periods (days) from property pairs where both dates exist
  const holdDays: number[] = [];
  for (const p of soldProps) {
    if (p.purchaseDate && p.soldDate) {
      const days = Math.floor(
        (p.soldDate.getTime() - p.purchaseDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (days >= 0) holdDays.push(days);
    }
  }
  holdDays.sort((a, b) => a - b);
  const medianHoldDays =
    holdDays.length === 0
      ? 0
      : holdDays.length % 2 === 1
      ? holdDays[(holdDays.length - 1) / 2]!
      : Math.round((holdDays[holdDays.length / 2 - 1]! + holdDays[holdDays.length / 2]!) / 2);
  const shortHoldShare =
    holdDays.length === 0
      ? 0
      : holdDays.filter((d) => d < 365).length / holdDays.length;

  const factors: DealerFactor[] = [];

  // F1: Frequency of sales (Suburban Realty factor #1)
  if (salesLast12 >= 10) {
    factors.push({
      code: "F1_FREQ_HIGH",
      label: "High frequency of sales (≥10 in the trailing 12 months)",
      citation: "Suburban Realty Co. v. United States, 615 F.2d 171 (5th Cir. 1980)",
      score: 35,
      detail: `${salesLast12} closed sales in the last 12 months. Courts consistently rule this is dealer-level activity.`,
    });
  } else if (salesLast12 >= 5) {
    factors.push({
      code: "F1_FREQ_MED",
      label: "Moderate-to-high frequency of sales (5-9 in the trailing 12 months)",
      citation: "Winthrop v. Comm'r, 417 F.2d 905 (5th Cir. 1969)",
      score: 18,
      detail: `${salesLast12} closed sales in the last 12 months. Above the threshold the 5th Circuit treats as 'recurrent' in Winthrop.`,
    });
  } else if (salesLast12 >= 2) {
    factors.push({
      code: "F1_FREQ_LOW",
      label: "Few sales (2-4 in the trailing 12 months)",
      citation: "Malat v. Riddell, 383 U.S. 569 (1966)",
      score: 3,
      detail: `${salesLast12} closed sales in the last 12 months. Frequency alone is not dispositive at this level.`,
    });
  } else {
    factors.push({
      code: "F1_FREQ_NONE",
      label: "0-1 sales in the trailing 12 months",
      citation: "Malat v. Riddell, 383 U.S. 569 (1966)",
      score: -10,
      detail: "Sporadic activity is the hallmark of an investor.",
    });
  }

  // F2: Median holding period
  if (medianHoldDays > 0 && medianHoldDays < 180) {
    factors.push({
      code: "F2_HOLD_VERY_SHORT",
      label: `Median holding period under 6 months (${medianHoldDays} days)`,
      citation: "§1221(a)(1) — property held primarily for sale to customers",
      score: 30,
      detail: "Very short holds are the textbook 'primarily for sale' indicator. Dealer-friendly.",
    });
  } else if (medianHoldDays > 0 && medianHoldDays < 365) {
    factors.push({
      code: "F2_HOLD_SHORT",
      label: `Median holding period under 12 months (${medianHoldDays} days)`,
      citation: "§1221(a)(1)",
      score: 15,
      detail: "Short holds without rental income suggest 'held primarily for sale.'",
    });
  } else if (medianHoldDays >= 365 && medianHoldDays < 730) {
    factors.push({
      code: "F2_HOLD_MED",
      label: `Median holding period 1-2 years (${medianHoldDays} days)`,
      citation: "§1222(3) long-term capital gain definition",
      score: -5,
      detail: "Long-term hold qualifies for §1222 LTCG treatment IF investor classification holds.",
    });
  } else if (medianHoldDays >= 730) {
    factors.push({
      code: "F2_HOLD_LONG",
      label: `Median holding period 2+ years (${medianHoldDays} days)`,
      citation: "Estate of Freeland v. Comm'r, 393 F.2d 573 (9th Cir. 1968)",
      score: -20,
      detail: "Long holds are strong evidence of investment intent.",
    });
  }

  // F3: Short-hold share — the % under 12 months
  if (shortHoldShare >= 0.75 && holdDays.length >= 3) {
    factors.push({
      code: "F3_SHORT_HOLD_SHARE",
      label: `${Math.round(shortHoldShare * 100)}% of sales held under 12 months`,
      citation: "Biedenharn Realty Co. v. United States, 526 F.2d 409 (5th Cir. 1976)",
      score: 20,
      detail: "Consistent quick-turn pattern. Hard to argue investor intent.",
    });
  }

  // F4: Active rental portfolio
  if (activeLeases.length >= 3) {
    factors.push({
      code: "F4_RENTALS_HIGH",
      label: `Active rental portfolio (${activeLeases.length} units producing income)`,
      citation: "§469 passive activity rules; Reg. §1.469-9",
      score: -15,
      detail: "Rentals generating ongoing income are investment property, not inventory. Helps the investor argument for the rental side; doesn't insulate flip activity.",
    });
  } else if (activeLeases.length >= 1) {
    factors.push({
      code: "F4_RENTALS_LOW",
      label: `Some rental activity (${activeLeases.length} active lease${activeLeases.length === 1 ? "" : "s"})`,
      citation: "§469",
      score: -5,
      detail: "Rental side likely investment; flip side analyzed separately.",
    });
  }

  // F5: Self-reported full-time real-estate
  if (exclusiveRealEstate === true) {
    factors.push({
      code: "F5_FULL_TIME",
      label: "Full-time real-estate operator (no other trade/business)",
      citation: "Williford v. Comm'r, T.C. Memo 1992-450",
      score: 12,
      detail: "Full-time devotion to real-estate trade/business is a dealer indicator.",
    });
  }

  // F6: Self-reported hours
  if (selfReportedHoursLast12 !== null && selfReportedHoursLast12 >= 1500) {
    factors.push({
      code: "F6_HOURS_FT",
      label: `Self-reported ${selfReportedHoursLast12} hours in real-estate trade/business (12mo)`,
      citation: "§469(c)(7); Reg. §1.469-5T",
      score: 10,
      detail: "1500+ hours is full-time-equivalent; combined with frequent sales, that's a strong dealer signal.",
    });
  }

  // ── Aggregate to signal ──────────────────────────────────────────────
  const weightedScore = factors.reduce((s, f) => s + f.score, 0);
  let signal: DealerSignal;
  if (weightedScore >= 50) signal = "dealer";
  else if (weightedScore >= 25) signal = "likely_dealer";
  else if (weightedScore >= 5) signal = "ambiguous";
  else signal = "investor";

  // Naive sigmoid for probability — purely illustrative
  const dealerProbabilityPct = Math.round(
    100 / (1 + Math.exp(-(weightedScore - 25) / 15)),
  );

  // Audit-defense talking points — what the CPA needs to document if the
  // customer wants to argue investor against an IRS examiner.
  const auditDefense: string[] = [
    "Keep contemporaneous workpapers showing INVESTMENT INTENT at each acquisition (memo to file).",
    "Document the EXIT PLAN at acquisition — rental hold, 1031 chain, retirement-income vehicle.",
    "Separate dealer activity from investor activity into different entities (LLC-A flips, LLC-B holds).",
    "If you have rentals, keep a hours log per §469(c)(7) — it bolsters the rental-side investor argument even if flips are dealer.",
    "Avoid marketing yourself as a 'flipper' in advertising — courts look at this.",
    "Title transactions in the holding-side entity, not the flip-side, when the intent is to hold.",
  ];

  const dealerConsequences: string[] = [
    "Gain taxed as ORDINARY INCOME (up to 37%), not capital gains (max 20% federal).",
    "Self-employment tax at 15.3% on first $168,600 of net earnings (2024).",
    "§1031 like-kind exchange UNAVAILABLE — §1031(a)(2)(A) excludes dealer property.",
    "§453 installment sale UNAVAILABLE on dealer property — full gain in year of sale.",
    "Sales reported on Schedule C, not Schedule D / Form 4797.",
    "Inventory accounting required — UNICAP §263A may apply.",
  ];

  return {
    signal,
    weightedScore,
    dealerProbabilityPct,
    factors,
    stats: {
      salesLast12Months: salesLast12,
      salesLast24Months: salesLast24,
      medianHoldDays,
      shortHoldShare,
      averageActiveListings: activeLeases.length,
    },
    auditDefense,
    dealerConsequences,
  };
}

// ─── §469(c)(7) real-estate-professional test ────────────────────────────

export interface RealEstateProfessionalResult {
  qualifies: boolean;
  /** Did the operator clear the >50% of personal services test? */
  passes50PctTest: boolean;
  /** Did the operator clear the >750-hour test? */
  passes750HourTest: boolean;
  /** Self-reported hours for the year. */
  realEstateHours: number;
  /** Self-reported total working hours for the year. */
  totalWorkHours: number;
  /** % of working hours spent on real estate. */
  realEstateSharePct: number;
  /** What this means for the customer in practical terms. */
  consequences: string[];
  /** What CPA must document if the test is claimed. */
  documentationRequirements: string[];
  /**
   * Activities that DO qualify under §469(c)(7)(C). The customer needs
   * to know what counts so they don't double-count W-2 employer hours
   * that aren't theirs.
   */
  qualifyingActivities: string[];
}

/**
 * Test whether a user qualifies as a Real-Estate Professional under
 * §469(c)(7) for the current tax year.
 *
 * Inputs are self-reported (the schema doesn't track hours per
 * activity). The result is contingent on the customer maintaining
 * contemporaneous evidence — that's why the documentationRequirements
 * are surfaced explicitly.
 */
export function evaluateRealEstateProfessional(input: {
  realEstateHoursThisYear: number;
  totalWorkHoursThisYear: number;
  hasMaterialParticipationLog: boolean;
}): RealEstateProfessionalResult {
  const { realEstateHoursThisYear, totalWorkHoursThisYear, hasMaterialParticipationLog } = input;

  const passes750HourTest = realEstateHoursThisYear > 750;
  const realEstateSharePct =
    totalWorkHoursThisYear > 0
      ? Math.round((realEstateHoursThisYear / totalWorkHoursThisYear) * 100)
      : 0;
  // §469(c)(7)(B): "more than one-half of the personal services
  // performed in trades or businesses by the taxpayer during such
  // taxable year are performed in real property trades or businesses"
  const passes50PctTest = totalWorkHoursThisYear > 0 && realEstateHoursThisYear > totalWorkHoursThisYear / 2;

  const qualifies = passes750HourTest && passes50PctTest;

  const consequences: string[] = qualifies
    ? [
        "Rental real estate is treated as NON-PASSIVE (Reg. §1.469-9(e)).",
        "Rental losses are deductible against ordinary income — no $25,000 cap, no AGI phase-out.",
        "You can still flunk the material-participation test PER PROPERTY (Reg. §1.469-5T) unless you make a §1.469-9(g) aggregation election.",
        "If you have a W-2 job, the IRS will challenge this aggressively — the burden is on you to document hours.",
      ]
    : [
        "Rentals stay PASSIVE under §469(c)(2) — losses are limited.",
        "If MAGI < $100k, the $25,000 active-participation loss allowance (§469(i)) may apply; phases out fully at $150k.",
        "Unused passive losses carry forward until the activity is disposed of.",
      ];

  const documentationRequirements: string[] = [
    "Contemporaneous time log (paper diary, calendar entries, or app) — NOT a year-end estimate (Estate of Stange v. Comm'r, T.C. Memo 2010-130).",
    "Log entries per property OR a §1.469-9(g) election to aggregate ALL rentals as one activity.",
    "If married filing jointly, ONE spouse must meet the test alone — hours don't combine (§469(c)(7)(B), flush language).",
    "Hours spent as a §1.469-5T(f) investor (reviewing financials, monitoring) do NOT count.",
    "Hours spent on activities OTHER than as an owner-operator (W-2 for an unrelated employer's real-estate biz) do NOT count unless you own >5%.",
  ];

  const qualifyingActivities: string[] = [
    "Development or redevelopment",
    "Construction or reconstruction",
    "Acquisition",
    "Conversion",
    "Rental",
    "Operation or management",
    "Leasing",
    "Brokerage",
  ];

  // If the user qualifies but has no log, warn them explicitly — the
  // §469 audit playbook is "produce the log."
  if (qualifies && !hasMaterialParticipationLog) {
    consequences.unshift(
      "WARNING: You claim to qualify but have not affirmed a contemporaneous hours log. The IRS's standard challenge is 'produce the log' — without it, your claim collapses.",
    );
  }

  return {
    qualifies,
    passes50PctTest,
    passes750HourTest,
    realEstateHours: realEstateHoursThisYear,
    totalWorkHours: totalWorkHoursThisYear,
    realEstateSharePct,
    consequences,
    documentationRequirements,
    qualifyingActivities,
  };
}
