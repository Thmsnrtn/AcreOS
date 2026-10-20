/**
 * Real-estate deed transfer / documentary / conveyance tax — the ONE table.
 *
 * Every caller that states a transfer-tax figure (the purchase-agreement
 * generator, the closing-cost estimator, /api/recording-fees, the state
 * document API) reads it from here. There used to be two independent tables:
 * `stateDocumentConfig.transferTaxPercent` (a percent) and
 * `countyRecordingFees.STATE_TRANSFER_TAX` (per $1,000). Each mixed statutory
 * units — Florida's "$0.70 per $100" was stored as 0.07% in one and as
 * $0.70 per $1,000 in the other (both 10× low); Nevada's "$1.95 per $500"
 * was stored as $1.95 per $1,000 — and the purchase agreement printed the
 * wrong dollar figure beside the right statutory note (best-in-class audit
 * 2026-10-20, §3 P0 #1).
 *
 * ── UNIT CONVENTION (stated here and nowhere else) ─────────────────────────
 * A rate is stored exactly as its statute states it: `ratePerUnit` dollars
 * per `unitUsd` dollars of consideration, with the statute's rounding of the
 * consideration into units ("or fraction thereof" = round UP; Colorado's "or
 * major fraction" = round to nearest; a percentage = exact, unit $1). The
 * per-$1,000 figure shown to people is DERIVED from that, never stored, so a
 * per-$100 figure can no longer be typed into a per-$1,000 column.
 *
 * ── REFUSE, NEVER GUESS ────────────────────────────────────────────────────
 * `estimateTransferTax` returns a dollar figure only when the table can
 * compute it from facts the caller supplied. It refuses when the amount
 * depends on a fact it does not have (a bracket that turns on property class
 * or principal-residence status, a county whose surtax is class-dependent),
 * when the closing date precedes the rate in this table, or when the state
 * has no statewide tax but local governments levy one. Local add-ons that
 * vary by city or county are never guessed: the estimate says which local
 * taxes it EXCLUDES.
 *
 * ── SOURCING ───────────────────────────────────────────────────────────────
 * Rates re-derived 2026-10-20 from the cited statute or state revenue agency
 * text (official-domain sources; see each row's `citation`). Rows marked
 * `confidence: "medium"` were confirmed only through a secondary source. This
 * is tax information, not tax advice; every rendered figure carries
 * "estimate — confirm with your closing agent".
 */

export const TRANSFER_TAX_TABLE_VERIFIED_AT = "2026-10-20";

export type CustomaryPayer = "seller" | "buyer" | "split" | "varies" | "none";
export type PropertyClass = "vacant_land" | "single_family_residence" | "other_residential" | "nonresidential";
export type Rounding = "up" | "nearest" | "exact";

/** A rate exactly as a statute states it. */
export interface StatutoryRate {
  /** Dollars of tax per `unitUsd` dollars of consideration. */
  ratePerUnit: number;
  /** The statute's unit of consideration: 100, 500, 1000, or 1 for a percent-as-dollars rate. */
  unitUsd: number;
  /** How the consideration is broken into units. */
  rounding: Rounding;
  /** The statute's own wording of the rate, e.g. "$0.70 per $100 (or fraction)". */
  statutoryUnit: string;
}

/** One bracket of a graduated schedule. `upToUsd: null` is the top bracket. */
export interface Bracket {
  upToUsd: number | null;
  rate: StatutoryRate;
}

export interface Schedule {
  /** Property classes this schedule governs. */
  appliesTo: PropertyClass[];
  /** marginal: each bracket taxes its slice; whole_value: the bracket the price falls in taxes the whole price. */
  method: "marginal" | "whole_value";
  brackets: Bracket[];
}

export interface TransferTaxRule {
  state: string;
  kind: "none" | "flat" | "graduated" | "local_only" | "refused";
  /** flat: the statewide rate. */
  rate?: StatutoryRate;
  /** graduated: one schedule per property-class group. A class with no schedule is refused. */
  schedules?: Schedule[];
  /**
   * Further mandatory pieces levied everywhere in the state on the same
   * deed — a uniform county tax (IL, MI, SC, WV) or a second state tax
   * (VA's grantor tax). Each is computed with its own statutory rounding.
   */
  addOns?: Array<StatutoryRate & { citation: string }>;
  /** A conveyance at or below this consideration is not taxed (AR $100, CO $500). */
  exemptBelowUsd?: number;
  /** This much of the consideration is deducted before the rate applies (IA: the first $500). */
  exemptFirstUsd?: number;
  /** Local taxes this table does NOT include (city/county/municipal add-ons that vary). */
  excludesLocal?: string;
  /** Why a dollar figure cannot be computed (kind "refused" / "local_only"). */
  refusalReason?: string;
  /** The rate in this row applies to transfers on/after this ISO date. */
  effectiveFrom?: string;
  /** The rate in this row applies to transfers on/before this ISO date. */
  effectiveThrough?: string;
  customaryPayer: CustomaryPayer;
  citation: string;
  confidence: "high" | "medium";
}

const r = (ratePerUnit: number, unitUsd: number, rounding: Rounding, statutoryUnit: string): StatutoryRate => ({
  ratePerUnit,
  unitUsd,
  rounding,
  statutoryUnit,
});
/** A percentage rate, computed exactly. */
const pct = (percent: number, statutoryUnit = `${percent}%`): StatutoryRate =>
  r(percent / 100, 1, "exact", statutoryUnit);

const ALL_CLASSES: PropertyClass[] = ["vacant_land", "single_family_residence", "other_residential", "nonresidential"];

const none = (state: string, citation: string, confidence: "high" | "medium" = "medium"): TransferTaxRule => ({
  state,
  kind: "none",
  customaryPayer: "none",
  citation,
  confidence,
});

export const TRANSFER_TAX_RULES: Record<string, TransferTaxRule> = {
  AL: { state: "AL", kind: "flat", rate: r(0.5, 500, "up", "$0.50 per $500 (or fraction) of value"), customaryPayer: "varies", citation: "Ala. Code § 40-22-1", confidence: "high" },
  AK: none("AK", "No state or local real-estate transfer tax statute"),
  AZ: none("AZ", "Ariz. Const. art. 9 § 24 (no real-property transfer tax; a $2 affidavit fee is not a tax on value)"),
  AR: { state: "AR", kind: "flat", rate: r(3.3, 1000, "exact", "$3.30 per $1,000 of actual consideration"), exemptBelowUsd: 100, customaryPayer: "varies", citation: "Ark. Code Ann. § 26-60-105", confidence: "high" },
  CA: {
    state: "CA", kind: "flat", rate: r(0.55, 500, "up", "$0.55 per $500 (or fraction) — county documentary transfer tax"),
    excludesLocal: "charter-city transfer taxes (e.g. Los Angeles, San Francisco, Oakland, Berkeley), which can be many times the county rate",
    customaryPayer: "seller", citation: "Cal. Rev. & Tax. Code § 11911", confidence: "high",
  },
  CO: {
    state: "CO", kind: "flat", rate: r(0.01, 100, "nearest", "$0.01 per $100 (or major fraction) — documentary fee"), exemptBelowUsd: 500,
    excludesLocal: "home-rule municipal transfer taxes (e.g. Aspen, Vail, Telluride, Breckenridge)",
    customaryPayer: "buyer", citation: "C.R.S. § 39-13-102", confidence: "medium",
  },
  CT: {
    state: "CT", kind: "graduated",
    schedules: [
      { appliesTo: ["single_family_residence", "other_residential"], method: "marginal", brackets: [
        { upToUsd: 800_000, rate: pct(0.75) },
        { upToUsd: 2_500_000, rate: pct(1.25) },
        { upToUsd: null, rate: pct(2.25) },
      ] },
      { appliesTo: ["vacant_land"], method: "whole_value", brackets: [{ upToUsd: null, rate: pct(0.75, "0.75% (unimproved land)") }] },
      { appliesTo: ["nonresidential"], method: "whole_value", brackets: [{ upToUsd: null, rate: pct(1.25, "1.25% (nonresidential)") }] },
    ],
    excludesLocal: "the municipal conveyance tax (0.25%, up to 0.5% in targeted investment communities)",
    customaryPayer: "seller", citation: "Conn. Gen. Stat. § 12-494", confidence: "high",
  },
  DE: {
    state: "DE", kind: "flat", rate: pct(2.5, "2.5% state realty transfer tax (3% where no local tax is levied)"),
    excludesLocal: "the county or municipal realty transfer tax (up to 1.5%); where none is levied the state rate is 3%",
    customaryPayer: "split", citation: "30 Del. C. § 5402", confidence: "medium",
  },
  DC: {
    state: "DC", kind: "graduated",
    schedules: [
      { appliesTo: ["single_family_residence", "other_residential"], method: "whole_value", brackets: [
        { upToUsd: 399_999.99, rate: pct(2.2, "1.1% recordation + 1.1% transfer") },
        { upToUsd: null, rate: pct(2.9, "1.45% recordation + 1.45% transfer") },
      ] },
      { appliesTo: ["nonresidential"], method: "whole_value", brackets: [{ upToUsd: null, rate: pct(2.9, "1.45% recordation + 1.45% transfer") }] },
    ],
    customaryPayer: "split", citation: "D.C. Code § 42-1103 (recordation), § 47-903 (transfer)", confidence: "high",
  },
  FL: { state: "FL", kind: "flat", rate: r(0.7, 100, "up", "$0.70 per $100 (or fraction) — documentary stamp tax"), customaryPayer: "seller", citation: "Fla. Stat. § 201.02(1)(a)", confidence: "high" },
  GA: { state: "GA", kind: "flat", rate: r(0.1, 100, "up", "$1.00 for the first $1,000 and $0.10 per additional $100 (or fraction)"), customaryPayer: "seller", citation: "O.C.G.A. § 48-6-1", confidence: "high" },
  HI: {
    state: "HI", kind: "graduated",
    // General schedule only. The higher schedule for a condo or single-family
    // residence sold to a buyer ineligible for the county homeowner exemption
    // turns on a fact AcreOS does not hold, so residences are refused.
    schedules: [{ appliesTo: ["vacant_land", "nonresidential"], method: "whole_value", brackets: [
      { upToUsd: 599_999.99, rate: r(0.1, 100, "up", "$0.10 per $100") },
      { upToUsd: 999_999.99, rate: r(0.2, 100, "up", "$0.20 per $100") },
      { upToUsd: 1_999_999.99, rate: r(0.3, 100, "up", "$0.30 per $100") },
      { upToUsd: 3_999_999.99, rate: r(0.5, 100, "up", "$0.50 per $100") },
      { upToUsd: 5_999_999.99, rate: r(0.7, 100, "up", "$0.70 per $100") },
      { upToUsd: 9_999_999.99, rate: r(0.9, 100, "up", "$0.90 per $100") },
      { upToUsd: null, rate: r(1.0, 100, "up", "$1.00 per $100") },
    ] }],
    customaryPayer: "seller", citation: "HRS § 247-2", confidence: "high",
  },
  ID: none("ID", "No transfer tax statute"),
  IL: {
    state: "IL", kind: "flat", rate: r(0.5, 500, "up", "$0.50 per $500 (or fraction) — state"),
    addOns: [{ ...r(0.25, 500, "up", "$0.25 per $500 (or fraction) — county"), citation: "35 ILCS 200/31-15" }],
    excludesLocal: "home-rule municipal transfer taxes (e.g. Chicago $5.25 per $500)",
    customaryPayer: "seller", citation: "35 ILCS 200/31-10", confidence: "high",
  },
  IN: none("IN", "No transfer tax statute (sales disclosure fee only)"),
  IA: { state: "IA", kind: "flat", rate: r(0.8, 500, "up", "$0.80 per $500 (or fraction) over the first $500"), exemptFirstUsd: 500, customaryPayer: "seller", citation: "Iowa Code § 428A.1", confidence: "high" },
  KS: none("KS", "No transfer tax statute"),
  KY: { state: "KY", kind: "flat", rate: r(0.5, 500, "up", "$0.50 per $500 (or fraction) of value"), customaryPayer: "seller", citation: "KRS 142.050", confidence: "high" },
  LA: {
    state: "LA", kind: "local_only",
    refusalReason: "Louisiana has no state transfer tax; New Orleans (Orleans Parish) levies a flat per-instrument documentary tax. Confirm with the parish clerk.",
    customaryPayer: "varies", citation: "La. Const. art. VII § 3 (bar on new transfer taxes); New Orleans Code of Ordinances", confidence: "medium",
  },
  ME: {
    state: "ME", kind: "graduated", effectiveFrom: "2025-11-01",
    schedules: [{ appliesTo: ALL_CLASSES, method: "marginal", brackets: [
      { upToUsd: 1_000_000, rate: r(2.2, 500, "up", "$2.20 per $500 (or fraction), split grantor/grantee") },
      { upToUsd: null, rate: r(6.0, 500, "up", "$6.00 per $500 on value above $1,000,000") },
    ] }],
    customaryPayer: "split", citation: "36 M.R.S. § 4641-A", confidence: "high",
  },
  MD: {
    state: "MD", kind: "flat", rate: pct(0.5, "0.5% state transfer tax"),
    excludesLocal: "county recordation tax and county/municipal transfer tax, which typically exceed the state tax",
    customaryPayer: "split", citation: "Md. Code, Tax-Prop. § 13-203", confidence: "high",
  },
  MA: { state: "MA", kind: "flat", rate: r(2.28, 500, "up", "$2.28 per $500 (or fraction), incl. 14% surtax"), customaryPayer: "seller", citation: "M.G.L. c. 64D § 1", confidence: "high" },
  MI: {
    state: "MI", kind: "flat", rate: r(3.75, 500, "up", "$3.75 per $500 (or fraction) — state"),
    addOns: [{ ...r(0.55, 500, "up", "$0.55 per $500 (or fraction) — county"), citation: "MCL 207.505" }],
    excludesLocal: "the higher county rate a county of 2,000,000+ may levy",
    customaryPayer: "seller", citation: "MCL 207.525", confidence: "high",
  },
  MN: { state: "MN", kind: "flat", rate: pct(0.33, "0.33% deed tax"), customaryPayer: "seller", citation: "Minn. Stat. § 287.21", confidence: "high" },
  MS: none("MS", "No transfer tax statute"),
  MO: none("MO", "Mo. Const. art. X § 26 (bars transfer taxes)"),
  MT: none("MT", "Mont. Const. art. VIII § 17 (bars transfer taxes)", "high"),
  NE: { state: "NE", kind: "flat", rate: r(3.32, 1000, "exact", "$3.32 per $1,000 of value"), effectiveFrom: "2026-07-18", customaryPayer: "seller", citation: "Neb. Rev. Stat. § 76-901 (as amended by LB 1067, 2026)", confidence: "high" },
  NV: { state: "NV", kind: "flat", rate: r(1.95, 500, "up", "$1.95 per $500 (or fraction) — statewide base"), customaryPayer: "varies", citation: "NRS 375.020, 375.023", confidence: "high" },
  NH: { state: "NH", kind: "flat", rate: r(1.5, 100, "up", "$0.75 per $100 (or fraction) from each of buyer and seller"), customaryPayer: "split", citation: "RSA 78-B:1", confidence: "high" },
  NJ: {
    state: "NJ", kind: "refused",
    refusalReason: "New Jersey's realty transfer fee is graduated by price with partial exemptions, and the graduated-percent fee (from 7/10/2025) applies to classes AcreOS does not record. Get the figure from the closing agent.",
    customaryPayer: "seller", citation: "N.J.S.A. 46:15-7 et seq.; P.L. 2025, c.69", confidence: "high",
  },
  NM: none("NM", "No transfer tax statute"),
  NY: {
    state: "NY", kind: "flat", rate: r(2, 500, "up", "$2 per $500 (or fraction) of consideration"),
    excludesLocal: "the 1% mansion tax on residential conveyances of $1,000,000+, New York City's real property transfer tax and higher base rate, and other local transfer taxes",
    customaryPayer: "seller", citation: "N.Y. Tax Law § 1402", confidence: "high",
  },
  NC: { state: "NC", kind: "flat", rate: r(1, 500, "up", "$1 per $500 (or fraction) — excise tax"), customaryPayer: "seller", citation: "N.C. Gen. Stat. § 105-228.30", confidence: "high" },
  ND: none("ND", "No transfer tax statute"),
  OH: {
    state: "OH", kind: "flat", rate: r(1, 1000, "up", "$1 per $1,000 — mandatory county conveyance fee"),
    excludesLocal: "the permissive county conveyance fee (up to $3 per $1,000), which most counties levy",
    customaryPayer: "seller", citation: "Ohio Rev. Code § 319.54(G)(3), § 322.02", confidence: "high",
  },
  OK: { state: "OK", kind: "flat", rate: r(0.75, 500, "up", "$0.75 per $500 (or fraction) — documentary stamp tax"), customaryPayer: "varies", citation: "68 O.S. § 3201", confidence: "high" },
  OR: {
    state: "OR", kind: "local_only",
    refusalReason: "Oregon has no state transfer tax; Washington County alone levies one ($1.00 per $1,000).",
    customaryPayer: "split", citation: "ORS 306.815; Washington County Code ch. 3.04", confidence: "medium",
  },
  PA: {
    state: "PA", kind: "flat", rate: pct(1, "1% state realty transfer tax"),
    excludesLocal: "local realty transfer taxes (municipality + school district, typically 1%; Philadelphia 3.578%)",
    customaryPayer: "split", citation: "72 P.S. § 8102-C", confidence: "high",
  },
  RI: {
    state: "RI", kind: "graduated", effectiveFrom: "2025-10-01", effectiveThrough: "2026-12-31",
    schedules: [
      { appliesTo: ["single_family_residence", "other_residential"], method: "marginal", brackets: [
        { upToUsd: 824_000, rate: r(3.75, 500, "up", "$3.75 per $500 (or fraction)") },
        { upToUsd: null, rate: r(7.5, 500, "up", "$7.50 per $500 above the 2026 residential threshold ($824,000)") },
      ] },
      { appliesTo: ["vacant_land", "nonresidential"], method: "whole_value", brackets: [{ upToUsd: null, rate: r(3.75, 500, "up", "$3.75 per $500 (or fraction)") }] },
    ],
    customaryPayer: "seller", citation: "R.I. Gen. Laws § 44-25-1", confidence: "high",
  },
  SC: {
    state: "SC", kind: "flat", rate: r(1.3, 500, "up", "$1.30 per $500 (or fraction) — state deed recording fee"),
    addOns: [{ ...r(0.55, 500, "up", "$0.55 per $500 (or fraction) — county"), citation: "S.C. Code § 12-24-10" }],
    customaryPayer: "seller", citation: "S.C. Code § 12-24-10", confidence: "high",
  },
  SD: { state: "SD", kind: "flat", rate: r(0.5, 500, "up", "$0.50 per $500 (or fraction) of value"), customaryPayer: "seller", citation: "SDCL § 43-4-21", confidence: "high" },
  TN: { state: "TN", kind: "flat", rate: r(0.37, 100, "up", "$0.37 per $100 of consideration or value, whichever is greater"), customaryPayer: "buyer", citation: "Tenn. Code Ann. § 67-4-409(a)", confidence: "high" },
  TX: none("TX", "No transfer tax statute; Tex. Const. art. VIII § 29 bars one"),
  UT: none("UT", "No transfer tax statute"),
  VT: {
    state: "VT", kind: "graduated",
    // General rate plus the clean water surcharge. Residences turn on
    // principal-residence status, which AcreOS does not record — refused.
    schedules: [{ appliesTo: ["vacant_land", "nonresidential"], method: "whole_value", brackets: [
      { upToUsd: null, rate: pct(1.47, "1.25% general rate + 0.22% clean water surcharge") },
    ] }],
    customaryPayer: "buyer", citation: "32 V.S.A. § 9602 (as amended by Act 181 of 2024)", confidence: "high",
  },
  VA: {
    state: "VA", kind: "flat", rate: r(0.25, 100, "up", "$0.25 per $100 (or fraction) — state recordation tax"),
    addOns: [{ ...r(0.5, 500, "up", "$0.50 per $500 (or fraction) — grantor tax"), citation: "Va. Code § 58.1-802" }],
    excludesLocal: "local recordation tax (up to one-third of the state recordation tax) and Northern Virginia regional fees",
    customaryPayer: "split", citation: "Va. Code §§ 58.1-801, 58.1-802", confidence: "high",
  },
  WA: {
    state: "WA", kind: "graduated", effectiveThrough: "2026-12-31",
    schedules: [{ appliesTo: ALL_CLASSES, method: "marginal", brackets: [
      { upToUsd: 525_000, rate: pct(1.1) },
      { upToUsd: 1_525_000, rate: pct(1.28) },
      { upToUsd: 3_025_000, rate: pct(2.75) },
      { upToUsd: null, rate: pct(3.0) },
    ] }],
    excludesLocal: "local REET (0.25%–0.5% in most cities and counties); agricultural and timberland use a flat 1.28%",
    customaryPayer: "seller", citation: "RCW 82.45.060", confidence: "high",
  },
  WV: {
    state: "WV", kind: "flat", rate: r(1.1, 500, "up", "$1.10 per $500 (or fraction)"),
    addOns: [{ ...r(0.55, 500, "up", "$0.55 per $500 (or fraction) — county"), citation: "W. Va. Code § 11-22-2(b)" }],
    customaryPayer: "seller", citation: "W. Va. Code § 11-22-2", confidence: "high",
  },
  WI: { state: "WI", kind: "flat", rate: r(0.3, 100, "up", "$0.30 per $100 (or fraction) — real estate transfer fee"), customaryPayer: "seller", citation: "Wis. Stat. § 77.22(1)", confidence: "high" },
  WY: none("WY", "No transfer tax statute"),
};

/**
 * County rules that REPLACE the state row for that county. Keyed "ST|County"
 * with the county name as the clerk writes it (no "County" suffix).
 */
export const TRANSFER_TAX_COUNTY_RULES: Record<string, TransferTaxRule> = {
  // Fla. Stat. § 201.02(1)(b): Miami-Dade's base is $0.60 per $100; deeds of
  // anything other than solely a single-family residence add a $0.45 per $100
  // surtax (§ 201.031) — vacant land included.
  "FL|Miami-Dade": {
    state: "FL", kind: "graduated",
    schedules: [
      { appliesTo: ["single_family_residence"], method: "whole_value", brackets: [{ upToUsd: null, rate: r(0.6, 100, "up", "$0.60 per $100 (single-family residence)") }] },
      { appliesTo: ["vacant_land", "other_residential", "nonresidential"], method: "whole_value", brackets: [{ upToUsd: null, rate: r(1.05, 100, "up", "$0.60 per $100 + $0.45 per $100 surtax") }] },
    ],
    customaryPayer: "seller", citation: "Fla. Stat. § 201.02(1)(b), § 201.031", confidence: "high",
  },
  // NRS 375.070: Clark adds $0.60 per $500 (school district); Washoe and
  // Churchill add $0.10 per $500 (1991 Local Government Tax Act option).
  "NV|Clark": { state: "NV", kind: "flat", rate: r(2.55, 500, "up", "$2.55 per $500 (or fraction) — statewide $1.95 + Clark $0.60"), customaryPayer: "varies", citation: "NRS 375.020, 375.023, 375.070(1)(b)", confidence: "high" },
  "NV|Washoe": { state: "NV", kind: "flat", rate: r(2.05, 500, "up", "$2.05 per $500 (or fraction) — statewide $1.95 + county $0.10"), customaryPayer: "varies", citation: "NRS 375.020, 375.023, 375.025", confidence: "high" },
  "NV|Churchill": { state: "NV", kind: "flat", rate: r(2.05, 500, "up", "$2.05 per $500 (or fraction) — statewide $1.95 + county $0.10"), customaryPayer: "varies", citation: "NRS 375.020, 375.023, 375.025", confidence: "high" },
  "MN|Hennepin": { state: "MN", kind: "flat", rate: pct(0.34, "0.33% deed tax + 0.01% county environmental fee"), customaryPayer: "seller", citation: "Minn. Stat. §§ 287.21, 383B.80", confidence: "high" },
  "MN|Ramsey": { state: "MN", kind: "flat", rate: pct(0.34, "0.33% deed tax + 0.01% county environmental fee"), customaryPayer: "seller", citation: "Minn. Stat. §§ 287.21, 383A.80", confidence: "high" },
  "MA|Barnstable": {
    state: "MA", kind: "refused",
    refusalReason: "Barnstable County's state excise is $1.71 per $500 and the county adds its own deeds excise; confirm the combined figure with the Barnstable Registry of Deeds.",
    customaryPayer: "seller", citation: "M.G.L. c. 64D § 1", confidence: "medium",
  },
  "OR|Washington": { state: "OR", kind: "flat", rate: r(1, 1000, "up", "$1.00 per $1,000 — Washington County transfer tax"), customaryPayer: "split", citation: "Washington County Code ch. 3.04; ORS 306.815", confidence: "medium" },
};

// ─── Computation ──────────────────────────────────────────────────────────

function normalizeCounty(county: string | null | undefined): string {
  return (county ?? "").trim().replace(/\s+county$/i, "").replace(/\s+parish$/i, "");
}

/** Find the rule for a state and (optional) county. */
export function transferTaxRuleFor(state: string, county?: string | null): TransferTaxRule | null {
  const st = (state ?? "").trim().toUpperCase();
  const c = normalizeCounty(county);
  if (c) {
    const key = Object.keys(TRANSFER_TAX_COUNTY_RULES).find((k) => k.toLowerCase() === `${st}|${c}`.toLowerCase());
    if (key) return TRANSFER_TAX_COUNTY_RULES[key];
  }
  return TRANSFER_TAX_RULES[st] ?? null;
}

/** Tax on `amountUsd` at one statutory rate, in cents, honouring the statute's rounding. */
export function taxAtRateCents(amountUsd: number, rate: StatutoryRate): number {
  if (amountUsd <= 0) return 0;
  const raw = amountUsd / rate.unitUsd;
  const units = rate.rounding === "up" ? Math.ceil(raw - 1e-9) : rate.rounding === "nearest" ? Math.round(raw) : raw;
  return Math.round(units * rate.ratePerUnit * 100);
}

/** The per-$1,000 equivalent of a statutory rate — for display only. */
export function per1000(rate: StatutoryRate): number {
  return Math.round((rate.ratePerUnit / rate.unitUsd) * 1000 * 10000) / 10000;
}

function scheduleCents(price: number, s: Schedule): number {
  if (s.method === "whole_value") {
    const b = s.brackets.find((x) => x.upToUsd === null || price <= x.upToUsd)!;
    return taxAtRateCents(price, b.rate);
  }
  let cents = 0;
  let floor = 0;
  for (const b of s.brackets) {
    const top = b.upToUsd ?? Infinity;
    if (price <= floor) break;
    const slice = Math.min(price, top) - floor;
    cents += taxAtRateCents(slice, b.rate);
    floor = top;
  }
  return cents;
}

export type TransferTaxEstimate =
  | {
      kind: "estimate";
      /** Total tax in cents (state + any uniform county piece). */
      amountCents: number;
      statutoryUnit: string;
      customaryPayer: CustomaryPayer;
      citation: string;
      /** Local taxes NOT included in amountCents; null when none are known to apply. */
      excludesLocal: string | null;
      confidence: "high" | "medium";
    }
  | { kind: "none"; citation: string }
  | { kind: "refused"; reason: string; citation: string | null };

export interface EstimateOptions {
  county?: string | null;
  /** Needed where a bracket or surtax turns on it; omitted = refuse those. */
  propertyClass?: PropertyClass;
  /** ISO date of the transfer (closing). Defaults to the caller's today. */
  asOfIsoDate?: string;
}

/**
 * Transfer tax on `priceUsd`, or a refusal naming the missing fact. See the
 * header: this never guesses a bracket, a class, or a local add-on.
 */
export function estimateTransferTax(state: string, priceUsd: number, opts: EstimateOptions = {}): TransferTaxEstimate {
  const rule = transferTaxRuleFor(state, opts.county);
  if (!rule) return { kind: "refused", reason: `No transfer-tax rule on file for "${state}".`, citation: null };
  if (rule.kind === "none") return { kind: "none", citation: rule.citation };
  if (rule.kind === "refused" || rule.kind === "local_only") {
    return { kind: "refused", reason: rule.refusalReason ?? "Confirm with the closing agent.", citation: rule.citation };
  }
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return { kind: "refused", reason: "A positive price is required to estimate transfer tax.", citation: rule.citation };
  }
  const asOf = opts.asOfIsoDate;
  if (asOf && rule.effectiveFrom && asOf < rule.effectiveFrom) {
    return { kind: "refused", reason: `${rule.state}'s rate changed on ${rule.effectiveFrom}; this table holds only the current rate.`, citation: rule.citation };
  }
  if (asOf && rule.effectiveThrough && asOf > rule.effectiveThrough) {
    return { kind: "refused", reason: `${rule.state}'s brackets on file run through ${rule.effectiveThrough}; confirm the schedule in force on ${asOf}.`, citation: rule.citation };
  }
  if ((rule.exemptBelowUsd !== undefined && priceUsd <= rule.exemptBelowUsd) ||
      (rule.exemptFirstUsd !== undefined && priceUsd <= rule.exemptFirstUsd)) {
    return { kind: "none", citation: rule.citation };
  }

  let cents: number;
  let statutoryUnit: string;
  if (rule.kind === "flat") {
    cents = taxAtRateCents(priceUsd - (rule.exemptFirstUsd ?? 0), rule.rate!);
    statutoryUnit = rule.rate!.statutoryUnit;
  } else {
    if (!opts.propertyClass) {
      return { kind: "refused", reason: `${rule.state}'s transfer tax depends on the property class; it is not recorded for this deal.`, citation: rule.citation };
    }
    const schedule = rule.schedules!.find((s) => s.appliesTo.includes(opts.propertyClass!));
    if (!schedule) {
      return { kind: "refused", reason: `${rule.state}'s rate for this property class turns on facts AcreOS does not record (e.g. principal-residence status). Confirm with the closing agent.`, citation: rule.citation };
    }
    cents = scheduleCents(priceUsd, schedule);
    statutoryUnit = schedule.brackets.map((b) => b.rate.statutoryUnit).join("; ");
  }
  for (const addOn of rule.addOns ?? []) {
    cents += taxAtRateCents(priceUsd, addOn);
    statutoryUnit = `${statutoryUnit} + ${addOn.statutoryUnit}`;
  }
  return {
    kind: "estimate",
    amountCents: cents,
    statutoryUnit,
    customaryPayer: rule.customaryPayer,
    citation: rule.citation,
    excludesLocal: rule.excludesLocal ?? null,
    confidence: rule.confidence,
  };
}

/** A one-line, human statement of the rule (no dollar figure). */
export function describeTransferTax(state: string, county?: string | null): string {
  const rule = transferTaxRuleFor(state, county);
  if (!rule) return "No transfer-tax rule on file — confirm with the closing agent.";
  if (rule.kind === "none") return `No transfer tax (${rule.citation}).`;
  if (rule.kind === "refused" || rule.kind === "local_only") return rule.refusalReason ?? "Confirm with the closing agent.";
  const base = rule.kind === "flat"
    ? rule.rate!.statutoryUnit
    : rule.schedules!.map((s) => s.brackets.map((b) => b.rate.statutoryUnit).join("; ")).join(" | ");
  const addOnText = (rule.addOns ?? []).map((a) => ` + ${a.statutoryUnit}`).join("");
  const local = rule.excludesLocal ? ` Excludes ${rule.excludesLocal}.` : "";
  return `${base}${addOnText} (${rule.citation}).${local}`;
}
