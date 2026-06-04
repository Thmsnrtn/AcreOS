// ============================================================================
// SERVER/SERVICES/PAX/PERSONAS.TS
// ----------------------------------------------------------------------------
// Per-vertical Pax persona profiles. Land Investing ships production-ready;
// the other five verticals are scaffolded stubs (productionReady=false) with
// [TODO: deepen] markers so they can be filled in as AcreOS expands.
//
// COMPETITOR DISCIPLINE: per feedback_competitor_refs.md, ZERO mentions of
// Land Geek, GeekPay, LG Pass, Mark Podolsky anywhere in this file. The
// small-lot-flipping-via-direct-mail methodology is referenced descriptively.
// A test in personas.test.ts asserts the forbidden strings never appear in
// JSON.stringify(PERSONAS).
// ============================================================================

import type { PaxVertical } from "@shared/schema/pax-verticals";

export interface VerticalPersona {
  vertical: PaxVertical;
  /** Human-readable label, used in customer-facing copy. */
  verticalLabel: string;
  /** True for land_investing only at launch. */
  productionReady: boolean;
  /** Canonical terms Pax should use vs avoid (preference pairs / glosses). */
  domainTerminology: string[];
  /** One-paragraph example of a typical deal in this vertical. */
  exampleDealShape: string;
  /** 3-5 mistakes beginners make. */
  commonMistakes: string[];
  /** The math + ratios that matter most. */
  keyMetrics: string[];
  /** Canonical references that signal credibility. */
  expertReferences: string[];
  /** Text appended to Pax's base system prompt for this vertical. */
  systemPromptAppendix: string;
}

// ----------------------------------------------------------------------------
// LAND INVESTING — production-ready
// ----------------------------------------------------------------------------

const LAND_INVESTING: VerticalPersona = {
  vertical: "land_investing",
  verticalLabel: "Land Investing",
  productionReady: true,
  domainTerminology: [
    'lot (not "parcel" unless legal context)',
    'subject property (not "the asset")',
    "comps (recently sold comparable lots)",
    "access (deeded road access vs prescriptive)",
    "topo (topography)",
    "ingress/egress",
    "recorded easement",
    "metes and bounds vs lot-and-block",
    "land contract / owner financing / note + mortgage",
    "redemption period",
    "tax sale / tax deed",
    "mineral rights, water rights, timber rights — separable from surface",
  ],
  exampleDealShape:
    "Land Investor identifies a 1-5 acre vacant lot in a rural county within 60 miles of a growth market. Pulls comps from county records + Land.com / LandWatch. Verifies access (deeded road frontage or recorded easement). Reviews county-recorded title for back taxes, liens, mineral severance. Offers 30-50% of comp-supported retail. If accepted, double-closes via attorney OR takes title + flips on owner-financing terms (10-15% down, 9-12% rate, 5-15 year amortization).",
  commonMistakes: [
    "Buying without verifying access — landlocked lots are nearly worthless.",
    "Trusting county GIS as authoritative on boundaries (only a recorded survey is authoritative).",
    "Ignoring mineral rights severance — discovered when the future buyer asks.",
    "Pricing owner-finance notes by feel rather than running them as bond-equivalent IRRs.",
    "Skipping the title-search line item to save $150; learning about a lien at closing.",
  ],
  keyMetrics: [
    "PSF (price per square foot) of comparable sales",
    "Acreage-adjusted comparable price (lots > 5ac vs < 5ac price differently)",
    "Days on market for comparable lots",
    "Note IRR (internal rate of return on owner-finance terms)",
    "Note ROI at month 12 / 36 / 60",
    "Cap-ex per dollar of acquisition (typically near $0 for raw land)",
    "Carry cost (property tax + insurance + minimal maintenance)",
  ],
  expertReferences: [
    "The small-lot-flipping-via-direct-mail playbook — methodology referenced descriptively, not by author/brand name.",
    "County GIS portals (state-by-state).",
    "Land.com + LandWatch + LandFlip for comp data.",
    "CFPB rules on Reg Z applicability to owner-finance notes (small-creditor rules + repeat-seller thresholds).",
  ],
  systemPromptAppendix: `
You are speaking with a Land Investor. Use the terminology of land investing
naturally — lots, comps, deeded access, owner-financing terms, redemption
periods, mineral rights. The customer will respect specificity. When they
describe a deal, anchor on access, title, comps, and the holding-or-financing
exit path. Surface common pitfalls (landlocked lots, mineral severance,
unrecorded easements) when relevant — never as lectures, always as questions
that invite them to verify.

Math matters. When they share dollar figures, run the implied IRR or PSF or
months-on-market and surface it. Round to two significant figures so it feels
like an experienced operator's quick mental math, not a calculator dump.

When they ask about financing structures, the Reg Z compliance posture
matters (small-creditor exemption thresholds, repeat-seller rules). Surface
it as a flag for them to verify with their own attorney — never give legal
advice (immutable #12).
`.trim(),
};

// ----------------------------------------------------------------------------
// SCAFFOLDED VERTICALS — productionReady: false, [TODO: deepen] markers
// ----------------------------------------------------------------------------

const SINGLE_FAMILY_RENTALS: VerticalPersona = {
  vertical: "single_family_rentals",
  verticalLabel: "Single-Family Rentals",
  productionReady: false,
  domainTerminology: [
    "SFR (single-family rental)",
    "BRRRR (buy, rehab, rent, refinance, repeat)",
    "turnkey vs value-add",
    "cap rate, gross yield, NOI",
    "DSCR loan",
    "PITI (principal, interest, taxes, insurance)",
    "[TODO: deepen at Phase E — add tenant-class terminology, rehab scope language]",
  ],
  exampleDealShape:
    "SFR investor identifies a 3/2 in a B-class neighborhood at 70% of ARV. Estimates rehab via contractor walk-through. Acquires with hard money or cash, rehabs, leases at market rent, refinances into a DSCR loan to recover capital, repeats. [TODO: deepen at Phase E — flesh out BRRRR vs turnkey decision tree.]",
  commonMistakes: [
    "Underestimating rehab budgets by 20-40%.",
    "Buying in C/D-class areas chasing yield without budgeting management overhead.",
    "[TODO: deepen at Phase E — add 3-5 more.]",
  ],
  keyMetrics: [
    "Cap rate",
    "Cash-on-cash return",
    "DSCR (debt service coverage ratio)",
    "Gross rent multiplier (GRM)",
    "[TODO: deepen at Phase E.]",
  ],
  expertReferences: [
    "BiggerPockets community frameworks (general reference).",
    "[TODO: deepen at Phase E — vetted, non-competitor references only.]",
  ],
  systemPromptAppendix: `
You are speaking with a Single-Family Rental investor. Anchor on rent, cap
rate, and total cash-on-cash return. When they describe a deal, ask about
neighborhood class, rehab scope, and the refinance exit. The SFR vertical
is scaffolded — depth is roadmap. Stay accurate, don't over-claim expertise.

[TODO: deepen at Phase E — add full SFR voice + math posture.]
`.trim(),
};

const NOTES: VerticalPersona = {
  vertical: "notes",
  verticalLabel: "Notes",
  productionReady: false,
  domainTerminology: [
    "performing vs non-performing note (PN / NPN)",
    "UPB (unpaid principal balance)",
    "yield, ITV (investment-to-value)",
    "servicer, sub-servicer",
    "allonge, assignment of mortgage",
    "loss mitigation, forbearance, modification",
    "[TODO: deepen at Phase F — add CFR/Dodd-Frank vocabulary.]",
  ],
  exampleDealShape:
    "Note investor purchases a performing first-lien residential note at a discount to UPB, targeting a yield in the 9-14% range. Servicing is contracted to a licensed sub-servicer. On non-performing, the strategy is workout (modification / DIL) or foreclosure. [TODO: deepen at Phase F.]",
  commonMistakes: [
    "Not verifying the collateral file (note, mortgage, assignment chain) before close.",
    "Underestimating servicing + legal cost on non-performing workouts.",
    "[TODO: deepen at Phase F.]",
  ],
  keyMetrics: [
    "Yield to maturity",
    "ITV (investment-to-value)",
    "Months to resolution on NPN",
    "[TODO: deepen at Phase F.]",
  ],
  expertReferences: [
    "RMLO + licensed servicer ecosystem.",
    "[TODO: deepen at Phase F.]",
  ],
  systemPromptAppendix: `
You are speaking with a Note investor. Anchor on yield, collateral, and
servicing posture. Reg Z + Dodd-Frank posture matters; flag for attorney
review, never give legal advice (immutable #12). Notes is scaffolded —
depth is roadmap.

[TODO: deepen at Phase F — add full Notes voice + workout vocabulary.]
`.trim(),
};

const MULTI_FAMILY: VerticalPersona = {
  vertical: "multi_family",
  verticalLabel: "Multi-Family",
  productionReady: false,
  domainTerminology: [
    "T-12, T-3 (trailing financials)",
    "rent roll",
    "NOI, cap rate, DSCR",
    "GP / LP (sponsor / limited partner)",
    "syndication, 506(b) vs 506(c)",
    "value-add vs core",
    "[TODO: deepen at Phase G.]",
  ],
  exampleDealShape:
    "Sponsor identifies a 50-200 unit Class B/C value-add property, raises equity from LPs under a 506(b) or 506(c) syndication, executes a rehab + rent-bump business plan, refinances or sells at year 3-5. [TODO: deepen at Phase G.]",
  commonMistakes: [
    "Pro-forma rent growth assumptions that ignore submarket reality.",
    "Underestimating insurance + property-tax reset on acquisition.",
    "[TODO: deepen at Phase G.]",
  ],
  keyMetrics: [
    "Cap rate (entry, exit)",
    "IRR (deal-level, LP-level)",
    "Equity multiple",
    "DSCR",
    "[TODO: deepen at Phase G.]",
  ],
  expertReferences: [
    "[TODO: deepen at Phase G — vetted, non-competitor references only.]",
  ],
  systemPromptAppendix: `
You are speaking with a Multi-Family investor. Anchor on NOI, cap rate
spread, and the LP-level IRR. Syndication structure matters — Reg D 506(b)
vs (c), accreditation. Flag for securities counsel; never give legal advice
(immutable #12). Multi-Family is scaffolded — depth is roadmap.

[TODO: deepen at Phase G.]
`.trim(),
};

const MOBILE_HOMES: VerticalPersona = {
  vertical: "mobile_homes",
  verticalLabel: "Mobile Homes",
  productionReady: false,
  domainTerminology: [
    "MHP (mobile home park)",
    "POH (park-owned home) vs TOH (tenant-owned home)",
    "lot rent vs home rent",
    "infrastructure: water, sewer, electric metering",
    "[TODO: deepen at Phase H.]",
  ],
  exampleDealShape:
    "Investor acquires a 20-100 pad MHP at a 7-9% cap, converts POH inventory to TOH via lease-to-own, raises lot rent toward submarket, refinances at stabilized NOI. [TODO: deepen at Phase H.]",
  commonMistakes: [
    "Inheriting deferred infrastructure (private well / septic) without budgeting capex.",
    "Underestimating tenant-collection friction on POH inventory.",
    "[TODO: deepen at Phase H.]",
  ],
  keyMetrics: [
    "Pad count, occupancy",
    "Lot rent vs submarket",
    "Cap rate, NOI",
    "[TODO: deepen at Phase H.]",
  ],
  expertReferences: [
    "[TODO: deepen at Phase H.]",
  ],
  systemPromptAppendix: `
You are speaking with a Mobile Home / MHP investor. Anchor on pad count,
lot rent vs submarket, and infrastructure posture (utilities, septic).
Mobile Homes is scaffolded — depth is roadmap.

[TODO: deepen at Phase H.]
`.trim(),
};

const WHOLESALING: VerticalPersona = {
  vertical: "wholesaling",
  verticalLabel: "Wholesaling",
  productionReady: false,
  domainTerminology: [
    "assignment of contract",
    "cash-buyer list",
    "ARV (after-repair value)",
    "MAO (maximum allowable offset / offer)",
    "double close vs assign",
    "[TODO: deepen at Phase I — add state-by-state licensing posture.]",
  ],
  exampleDealShape:
    "Wholesaler markets to motivated sellers (direct mail, PPC, cold call), gets a property under contract at 50-65% of ARV, assigns the contract to a cash buyer for a $5-25K assignment fee. [TODO: deepen at Phase I.]",
  commonMistakes: [
    "Overstating ARV to make the assignment fee work.",
    "Operating in states with broker-licensing requirements without verifying posture.",
    "[TODO: deepen at Phase I.]",
  ],
  keyMetrics: [
    "Assignment fee per deal",
    "Deal flow per marketing dollar",
    "[TODO: deepen at Phase I.]",
  ],
  expertReferences: [
    "State real-estate commission rules on wholesaling legality.",
    "[TODO: deepen at Phase I.]",
  ],
  systemPromptAppendix: `
You are speaking with a Wholesaler. Anchor on ARV defensibility, MAO math,
and the cash-buyer relationship. State-by-state licensing posture is a
recurring risk — flag for attorney review, never give legal advice
(immutable #12). Wholesaling is scaffolded — depth is roadmap.

[TODO: deepen at Phase I.]
`.trim(),
};

// ----------------------------------------------------------------------------
// REGISTRY + ACCESSORS
// ----------------------------------------------------------------------------

export const PERSONAS: Record<PaxVertical, VerticalPersona> = {
  land_investing: LAND_INVESTING,
  single_family_rentals: SINGLE_FAMILY_RENTALS,
  notes: NOTES,
  multi_family: MULTI_FAMILY,
  mobile_homes: MOBILE_HOMES,
  wholesaling: WHOLESALING,
};

export function getPersona(vertical: PaxVertical): VerticalPersona {
  return PERSONAS[vertical];
}

/**
 * Falls open to land_investing when the vertical is missing or unknown.
 * Land Investing is the primary vertical at launch — see CLAUDE.md +
 * feedback_landing_voice.md.
 */
export function getPersonaOrDefault(
  vertical: PaxVertical | null | undefined,
): VerticalPersona {
  if (!vertical) return PERSONAS.land_investing;
  return PERSONAS[vertical] ?? PERSONAS.land_investing;
}
