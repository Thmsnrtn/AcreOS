/**
 * State-specific lease notice / non-renewal timing rules.
 *
 * Imelda §3.2 / Lens 31 (Glenn): when a fixed-term lease is within 90 days
 * of expiry, the operator needs to know which side of the timing fence
 * they're on for that state — too early and the notice isn't actionable,
 * too late and they're stuck month-to-month or in tenant-favoring territory.
 *
 * The columns we surface:
 *   nonRenewalNoticeDays — landlord-to-tenant notice of non-renewal of a
 *     fixed-term lease (days BEFORE the end date the notice must arrive).
 *   monthToMonthNoticeDays — once on month-to-month, days of notice
 *     required to terminate (landlord side).
 *   rentIncreaseNoticeDays — days before a rent increase takes effect.
 *
 * Numbers below are public-statute summaries as of 2024–2026; counsel
 * should re-verify before relying on them in a notice. Where a state has
 * no statutory non-renewal notice (lease terms govern), nonRenewalNoticeDays
 * is null and the UI surfaces "lease terms govern."
 */

export interface LeaseNoticeRule {
  state: string;
  nonRenewalNoticeDays: number | null;
  monthToMonthNoticeDays: number;
  rentIncreaseNoticeDays: number;
  citation: string;
  notes?: string;
}

export const LEASE_NOTICE_RULES: Record<string, LeaseNoticeRule> = {
  TX: {
    state: "TX",
    nonRenewalNoticeDays: null,  // Texas: lease terms govern non-renewal
    monthToMonthNoticeDays: 30,
    rentIncreaseNoticeDays: 30,
    citation: "Tex. Prop. Code §91.001",
    notes: "Fixed-term non-renewal follows lease clause; absent a clause, lease simply ends. Month-to-month: 1 full rental period notice (30d typical).",
  },
  CA: {
    state: "CA",
    nonRenewalNoticeDays: 60,   // CA: 60d if tenancy ≥ 1 year (CC §1946.1)
    monthToMonthNoticeDays: 60,
    rentIncreaseNoticeDays: 30, // 90d if increase > 10% (AB 1482)
    citation: "Cal. Civ. Code §1946.1 / §827",
    notes: "60-day notice for tenancies ≥ 1 year; 30 days if < 1 year. Rent increase ≤10%: 30d; >10%: 90d.",
  },
  NY: {
    state: "NY",
    nonRenewalNoticeDays: 90,   // NY: 90d if tenancy ≥ 2 years (HSTPA 2019)
    monthToMonthNoticeDays: 30,
    rentIncreaseNoticeDays: 90,
    citation: "N.Y. RPL §226-c (HSTPA 2019)",
    notes: "Tiered: 30d if tenancy <1y; 60d if 1–2y; 90d if ≥2y. Applies to non-renewal AND rent-increase >5%.",
  },
  FL: {
    state: "FL",
    nonRenewalNoticeDays: 60,   // FL: 60d for annual leases (CS/HB 1417, 2023)
    monthToMonthNoticeDays: 30,
    rentIncreaseNoticeDays: 60,
    citation: "Fla. Stat. §83.575 / §83.57",
    notes: "Annual lease non-renewal: 60-day written notice (per 2023 statute). Month-to-month: 30d.",
  },
  GA: {
    state: "GA",
    nonRenewalNoticeDays: null,
    monthToMonthNoticeDays: 60,  // Landlord must give 60d on month-to-month
    rentIncreaseNoticeDays: 60,
    citation: "O.C.G.A. §44-7-7",
    notes: "Fixed-term: lease terms govern. Month-to-month: landlord 60d, tenant 30d (asymmetric).",
  },
  IL: {
    state: "IL",
    nonRenewalNoticeDays: 60,
    monthToMonthNoticeDays: 30,
    rentIncreaseNoticeDays: 30,
    citation: "765 ILCS 705 / Chicago RLTO §5-12-130",
    notes: "Chicago RLTO requires 30/60/120d depending on tenancy length; statewide default 30d on month-to-month.",
  },
  AZ: {
    state: "AZ",
    nonRenewalNoticeDays: 30,
    monthToMonthNoticeDays: 30,
    rentIncreaseNoticeDays: 30,
    citation: "A.R.S. §33-1375",
    notes: "30 days for month-to-month termination or rent increase.",
  },
  OH: {
    state: "OH",
    nonRenewalNoticeDays: null,
    monthToMonthNoticeDays: 30,
    rentIncreaseNoticeDays: 30,
    citation: "Ohio Rev. Code §5321.17",
    notes: "Fixed-term: lease terms govern. Month-to-month: 30d.",
  },
  NC: {
    state: "NC",
    nonRenewalNoticeDays: null,
    monthToMonthNoticeDays: 7,
    rentIncreaseNoticeDays: 7,
    citation: "N.C.G.S. §42-14",
    notes: "Asymmetric short notice on month-to-month; fixed-term governed by lease.",
  },
};

/**
 * Look up a lease notice rule by state code; returns null when no rule on
 * file (caller falls back to "lease terms govern").
 */
export function getLeaseNoticeRule(state: string): LeaseNoticeRule | null {
  if (!state) return null;
  return LEASE_NOTICE_RULES[state.toUpperCase()] ?? null;
}
