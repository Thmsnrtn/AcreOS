/**
 * upl-gating — the SINGLE source of truth for the unauthorized-practice-of-law /
 * assignment-disclosure gate on blind offers.
 *
 * Originally lived inline in blind-offer-wizard.tsx (Carla Mendoza fix,
 * 2026-05-27). Extracted here so the SAME table + gate rides EVERY surface that
 * lets a Land Investor turn a parcel into a blind offer — the full wizard AND
 * the in-panel inline composer on the Map door. One table, one severity rule,
 * no drift: if a state is "block" severity here, no surface may hand a for-fee
 * assignment draft to Pax without the operator seeing this banner first.
 *
 * The .ts (data + helpers) is framework-pure so it can be unit-tested; the
 * React banner lives in upl-gating-banner.tsx so this file stays UI-free.
 */

export interface StateUplWarning {
  states: string[];
  severity: "block" | "warn";
  kind: "license_required" | "advertising_restricted" | "equitable_interest" | "recording" | "disclosure";
  headline: string;
  body: string;
  citation: string;
}

// Sourcing for each entry: the citations are paralegal-level (cite-check before
// you quote in pleadings) and refer to the broker-licensing + assignment-
// disclosure regime AS OF the rule-data date stamp the user can see on
// /wholesaler-state-rules.
//
// "license_required": you cannot lawfully assign the contract for a fee in this
//   state without a real-estate broker license.
// "advertising_restricted": you cannot advertise property you don't own without
//   disclosing that you hold an equitable interest only.
// "equitable_interest": California-specific — the equitable-interest doctrine
//   means an unrecorded contract is not necessarily a defense to UPL if the
//   wholesaler's intent was to never close.
// "recording": some states (e.g. NC, FL) require the assignment itself to be
//   recorded for the assignee to claim against the property.
export const STATE_UPL_WARNINGS: StateUplWarning[] = [
  {
    states: ["OK"],
    severity: "block",
    kind: "license_required",
    headline: "Oklahoma: assigning a real-estate contract for a fee is the unauthorized practice of real estate without a broker license.",
    body: "Generating an assignment-for-fee here without a license can trigger a class-A misdemeanor and disgorgement of any assignment fee. Use the double-close flow instead, or partner with a licensed broker.",
    citation: "59 O.S. § 858-301 (broker license required to negotiate the purchase or sale of real estate for compensation).",
  },
  {
    states: ["IL"],
    severity: "block",
    kind: "license_required",
    headline: "Illinois: the Wholesale Disclosure Act + Real Estate License Act treat for-fee assignment without a license as a licensable activity.",
    body: "Illinois HB 1063 (2019) and the 2023 wholesaler-specific amendment treat soliciting purchase contracts and assigning them for a fee as activity requiring a broker license. Equitable-interest argument is narrowly construed.",
    citation: "225 ILCS 454/1-10 (broker definition); Public Act 103-0099 (wholesaler disclosure).",
  },
  {
    states: ["SC"],
    severity: "block",
    kind: "license_required",
    headline: "South Carolina: cannot wholesale more than one deal per year without a broker license.",
    body: "South Carolina caps unlicensed assignment-for-fee activity at one transaction per 12 months per person. Multiple deals = brokerage activity = license required.",
    citation: "S.C. Code § 40-57-30(D)(8) (one-transaction-per-year exemption).",
  },
  {
    states: ["PA"],
    severity: "block",
    kind: "license_required",
    headline: "Pennsylvania: assignment-for-fee is broker activity under the RE License Act.",
    body: "Pennsylvania prosecutes unlicensed wholesaling aggressively. The 2024 wholesaler amendments require disclosure of intent to assign in the marketing material itself.",
    citation: "63 P.S. § 455.201 et seq.; 49 Pa. Code § 35.201.",
  },
  {
    states: ["CA"],
    severity: "warn",
    kind: "equitable_interest",
    headline: "California: the equitable-interest doctrine is narrowly construed; AB 968 (2024) and DRE advisories treat 'never intended to close' as evidence of unlicensed brokerage.",
    body: "If you market the property before closing, you must disclose that you hold only an equitable interest (an executed purchase contract), not title. Failure to disclose can void the assignment and expose you to a § 10130 enforcement action.",
    citation: "Cal. Bus. & Prof. Code § 10130; AB 968 (2024); DRE Bulletin 2023-04.",
  },
  {
    states: ["NC"],
    severity: "warn",
    kind: "disclosure",
    headline: "North Carolina: NCREC's 2022 guidance requires disclosure of wholesaler intent in writing to the seller.",
    body: "NCREC Real Estate Bulletin Vol. 53 No. 2 (Oct 2022): wholesalers who market property they do not own to a third party must (a) disclose to the original seller that they intend to assign the contract, and (b) disclose to the end buyer that they are not the owner of record.",
    citation: "NCREC Bulletin Vol. 53 No. 2 (Oct 2022); N.C.G.S. § 93A-2.",
  },
  {
    states: ["TX"],
    severity: "warn",
    kind: "disclosure",
    headline: "Texas: HB 2730 (2017) requires written disclosure to the seller that you intend to assign the contract, BEFORE the contract is signed.",
    body: "TREC has prosecuted wholesalers who 'forgot' the assignment disclosure. The disclosure must be in writing and made before the contract is executed — not after.",
    citation: "Tex. Occ. Code § 1101.0045 (equitable-interest disclosure).",
  },
  {
    states: ["FL"],
    severity: "warn",
    kind: "advertising_restricted",
    headline: "Florida: § 475.42 makes it unlawful to advertise property you do not own without disclosing your equitable interest.",
    body: "DBPR has issued cease-and-desist orders to wholesalers who post properties on Zillow/Craigslist before closing. Marketing language must disclose 'equitable interest only — assignment of contract.'",
    citation: "Fla. Stat. § 475.42(1)(b); DBPR FREC Final Orders 2021-2024.",
  },
];

export function findStateWarning(state: string | undefined): StateUplWarning | null {
  if (!state) return null;
  return STATE_UPL_WARNINGS.find((w) => w.states.includes(state.toUpperCase())) ?? null;
}

/** True when the parcel's state blocks for-fee assignment outright (license
 *  required). Any blind-offer surface MUST refuse to hand a draft to the send
 *  path in this state — the same rule the wizard enforces by disabling Continue. */
export function isUplBlocked(state: string | undefined): boolean {
  return findStateWarning(state)?.severity === "block";
}
