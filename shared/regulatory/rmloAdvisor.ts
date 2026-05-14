/**
 * RMLO + Reg-Z + state-usury advisory — pure function, no DB.
 *
 * Pillar K (note-investor personas) surfaced a consistent fear across
 * Catalina (compliance-paranoid newcomer), Jacques (multi-state RMLO
 * operator), Kit (homestead lender), and Devon (land seller-financer):
 * none of them are confident about whether a specific note triggers
 * RMLO involvement, Reg-Z timing, or a state usury cap.
 *
 * This advisor takes the note's attributes and returns a posture
 * statement. It is NOT legal advice — every caller surfaces the
 * advisor's output with a "not legal advice; verify with counsel"
 * banner. The point is to give the operator a starting position and
 * a checklist, not to license-out compliance entirely.
 *
 * The state usury caps below are intentionally conservative
 * (annualized "general" caps where states have multiple). Specific
 * statutes vary by collateral type, borrower type, and origination
 * channel. Operators verify the exact cap for their transaction.
 *
 * Sources / footnotes for each state cap are in
 * `docs/exhaustive-completion/pillar-k-note-investors-25-personas.md`
 * under "Regulatory reference table."
 */

export type CollateralType =
  | "owner_occupied_1_4_residential"
  | "owner_occupied_homestead"
  | "non_owner_occupied_residential"
  | "vacant_land"
  | "manufactured_home_titled"
  | "manufactured_home_real_property"
  | "commercial"
  | "mixed_use";

export interface AdvisorInput {
  state: string;                          // 2-letter postal code (e.g. "TX")
  collateralType: CollateralType;
  loanAmountCents: number;
  annualRateBps: number;                  // basis points (8.5% = 850)
  isOriginating: boolean;                 // operator originating vs. buying paper
  isBusinessPurpose?: boolean;            // changes Reg-Z applicability
  borrowerIsActiveDutyMilitary?: boolean; // triggers SCRA
}

export interface AdvisorOutput {
  rmloLikelyRequired: boolean;
  rmloReason: string;
  regZTimingApplicable: boolean;
  regZReason: string;
  stateUsuryCapBps: number | null;        // null = no general cap or non-applicable
  stateUsuryCapNote: string;
  scraApplicable: boolean;
  hoepaWarning: boolean;                  // high-cost / high-fee threshold caution
  // Human-readable posture: rendered on the note creation form's
  // "Compliance posture" panel.
  postureSummary: string;
  // Step-by-step checklist for the operator. Each entry is a short
  // imperative. Operators tick them off in the UI; the list is the
  // contract between Pax and the operator at origination.
  checklist: string[];
  // Always-rendered disclaimer copy — single source of truth.
  disclaimer: string;
}

const STATE_USURY_BPS: Record<string, { bps: number | null; note: string }> = {
  // General (non-licensed-lender) civil usury caps. Many states have
  // higher contractual caps when explicitly bargained — these are the
  // "default if you don't think about it" numbers.
  AL: { bps: 800, note: "8% default; up to 1100bps if written contract." },
  AK: { bps: 500, note: "Federal-rate-plus-5 by reference; varies." },
  AZ: { bps: 1000, note: "10% default; no cap if written contract." },
  AR: { bps: 1700, note: "Federal-rate-plus-500, max 17%." },
  CA: { bps: 1000, note: "10% on consumer loans; carve-outs by lender type." },
  CO: { bps: 4500, note: "Supervised lenders to 45%; non-supervised much lower." },
  CT: { bps: 1200, note: "12% civil; banking-licensed exceptions." },
  DE: { bps: null, note: "No statutory cap with written agreement (broad)." },
  FL: { bps: 1800, note: "18% under $500k; 25% over $500k." },
  GA: { bps: 1600, note: "16% on loans under $3k; higher tiers above." },
  HI: { bps: 1000, note: "10% general; 12% if not regulated lender." },
  ID: { bps: null, note: "No general cap; written-agreement-based." },
  IL: { bps: 900, note: "9% civil; licensed-lender exceptions." },
  IN: { bps: 800, note: "8% civil; consumer-loan-act exceptions." },
  IA: { bps: 800, note: "8% civil; higher if business purpose." },
  KS: { bps: 1500, note: "15% on most consumer loans." },
  KY: { bps: 800, note: "8% general; higher for licensed lenders." },
  LA: { bps: 1200, note: "12% civil; 36% for certain consumer loans." },
  ME: { bps: 1200, note: "12%; supervised-lender exceptions." },
  MD: { bps: 600, note: "6% general; many statutory exceptions." },
  MA: { bps: 2000, note: "20% on consumer loans; criminal usury above." },
  MI: { bps: 700, note: "7% civil; 11% if written, with regulated-lender carve-out." },
  MN: { bps: 800, note: "8% civil; consumer-loan-rate carve-out." },
  MS: { bps: 1000, note: "10% civil; many statutory exceptions." },
  MO: { bps: 1000, note: "10% civil; 'market rate' contractual." },
  MT: { bps: 1500, note: "15% civil." },
  NE: { bps: 1600, note: "16% civil; consumer-credit-act lower." },
  NV: { bps: null, note: "No general statutory cap with written agreement." },
  NH: { bps: 1000, note: "10% civil; bank/credit-union exceptions." },
  NJ: { bps: 3000, note: "30% criminal; 16% civil first-lien residential." },
  NM: { bps: 1500, note: "15% civil; licensed-lender carve-outs." },
  NY: { bps: 1600, note: "16% civil; 25% criminal usury." },
  NC: { bps: 800, note: "8% civil; varies for residential mortgages." },
  ND: { bps: 1500, note: "Federal-rate-plus, capped 15%." },
  OH: { bps: 800, note: "8% civil; 25% for certain commercial." },
  OK: { bps: 1000, note: "10% civil; written-agreement carve-outs." },
  OR: { bps: 900, note: "9% civil; consumer-finance-act carve-outs." },
  PA: { bps: 600, note: "6% civil; many statutory exceptions." },
  RI: { bps: 2100, note: "21% civil; mortgage-loan carve-outs." },
  SC: { bps: 875, note: "8.75% civil; higher with written contract." },
  SD: { bps: null, note: "No statutory cap with written agreement." },
  TN: { bps: 2400, note: "24% civil; or formula rate, whichever lower." },
  TX: { bps: 1000, note: "10% civil baseline; finance-code Section 303 carve-outs by loan type." },
  UT: { bps: null, note: "No general cap; written-agreement-based." },
  VT: { bps: 1200, note: "12% civil; consumer-lender carve-outs." },
  VA: { bps: 1200, note: "12% civil; written-agreement carve-outs broad." },
  WA: { bps: 1200, note: "12% civil; consumer-loan-act lower." },
  WV: { bps: 800, note: "8% civil; many statutory exceptions." },
  WI: { bps: 1200, note: "12% civil; licensed-lender exceptions." },
  WY: { bps: 700, note: "7% civil; uniform-consumer-credit-code carve-outs." },
  DC: { bps: 2400, note: "24% civil; mortgage-loan exceptions." },
};

const DISCLAIMER =
  "Not legal advice. AcreOS surfaces compliance posture as a starting point — every operator must confirm specific requirements with their attorney before originating, buying, or servicing a note. State laws change; AcreOS does not warrant currentness.";

const HOEPA_RATE_TRIGGER_BPS_OVER_APR_TABLE = 650;  // First-lien threshold
const HOEPA_POINTS_FEE_TRIGGER_BPS = 500;            // Per Reg-Z 1026.32

export function advise(input: AdvisorInput): AdvisorOutput {
  const state = (input.state || "").toUpperCase();
  const cap = STATE_USURY_BPS[state] ?? { bps: null, note: `${state} not in advisor's reference table.` };

  // RMLO determination — Dodd-Frank / SAFE Act framing. The trigger
  // is roughly: residential, owner-occupied, 1-4 family, consumer
  // purpose, and the originator isn't otherwise exempt. The "de
  // minimis" exemption (≤3 loans per year, secured by seller's own
  // residence) is a frequent edge case operators ask about — we flag
  // it conservatively and let the operator + counsel confirm.
  const isResidentialOwnerOccupied =
    input.collateralType === "owner_occupied_1_4_residential" ||
    input.collateralType === "owner_occupied_homestead" ||
    input.collateralType === "manufactured_home_real_property";

  const consumerPurpose = input.isBusinessPurpose !== true;

  let rmloLikelyRequired = false;
  let rmloReason = "";
  if (input.isOriginating && isResidentialOwnerOccupied && consumerPurpose) {
    rmloLikelyRequired = true;
    rmloReason =
      "Originating a residential owner-occupied consumer-purpose loan typically triggers RMLO involvement under the SAFE Act unless a state-specific exemption applies (e.g. seller-financing ≤3 loans/year on the seller's own residence). Confirm exemption status with counsel before closing.";
  } else if (!input.isOriginating) {
    rmloReason = "Operator is buying paper, not originating — RMLO requirements attached to the original origination, not the secondary-market acquisition.";
  } else if (!isResidentialOwnerOccupied) {
    rmloReason = "Collateral is not residential owner-occupied — RMLO requirements typically don't apply.";
  } else {
    rmloReason = "Business-purpose loan — Reg-Z + RMLO requirements typically don't apply.";
  }

  // Reg-Z timing — applies on consumer-credit residential transactions.
  let regZTimingApplicable = false;
  let regZReason = "";
  if (input.isOriginating && isResidentialOwnerOccupied && consumerPurpose) {
    regZTimingApplicable = true;
    regZReason = "Loan Estimate must be delivered within 3 business days of application; Closing Disclosure at least 3 business days before consummation (1026.19(e)+(f)).";
  } else {
    regZReason = "Reg-Z's timing rules apply to consumer-credit residential transactions — not applicable here based on the inputs.";
  }

  // HOEPA / high-cost — first-lien rate threshold = APR over the APOR
  // by 650bps. We don't have APOR in scope here; flag any rate above
  // 12% as a HOEPA-review trigger for the operator to verify.
  const hoepaWarning =
    rmloLikelyRequired && input.annualRateBps > 1200;

  // SCRA — Servicemembers Civil Relief Act caps interest at 6% on
  // pre-service debt during active duty.
  const scraApplicable = !!input.borrowerIsActiveDutyMilitary;

  // Compose posture summary + checklist.
  const checklist: string[] = [];
  if (rmloLikelyRequired) {
    checklist.push("Engage RMLO before borrower application is taken.");
    checklist.push("Confirm RMLO loan-officer license is active in " + state + ".");
    checklist.push("Use Loan Estimate template; deliver within 3 business days of application.");
    checklist.push("Deliver Closing Disclosure at least 3 business days before consummation.");
    if (input.collateralType === "owner_occupied_homestead") {
      checklist.push("Verify homestead protection in " + state + " — confirms recovery posture pre-default.");
    }
  } else if (input.isOriginating) {
    checklist.push("Confirm business-purpose / non-consumer rationale with counsel.");
    checklist.push("Document loan-purpose attestation in the file.");
  } else {
    checklist.push("Confirm origination chain-of-title shows compliant origination (RMLO/Reg-Z if it was a residential consumer loan).");
    checklist.push("Verify Allonge + Assignment of Mortgage is properly executed.");
    checklist.push("Record assignment in the county of collateral.");
  }
  if (cap.bps !== null && input.annualRateBps > cap.bps) {
    checklist.push(`Rate (${(input.annualRateBps / 100).toFixed(2)}%) exceeds ${state}'s general usury cap (${(cap.bps / 100).toFixed(2)}%) — confirm written-agreement carve-out applies.`);
  }
  if (scraApplicable) {
    checklist.push("SCRA active — cap interest at 6% during active duty.");
  }
  if (hoepaWarning) {
    checklist.push("Rate may trigger HOEPA high-cost classification — confirm against current APOR before pricing.");
  }

  const postureSummary =
    rmloLikelyRequired
      ? `RMLO likely required. Reg-Z timing applies. ${state} usury reference: ${cap.note}`
      : input.isOriginating
        ? `RMLO likely NOT required (non-residential or business-purpose). ${state} usury reference: ${cap.note}`
        : `Secondary-market acquisition — origination compliance is already locked. Confirm assignment paperwork. ${state} usury reference: ${cap.note}`;

  return {
    rmloLikelyRequired,
    rmloReason,
    regZTimingApplicable,
    regZReason,
    stateUsuryCapBps: cap.bps,
    stateUsuryCapNote: cap.note,
    scraApplicable,
    hoepaWarning,
    postureSummary,
    checklist,
    disclaimer: DISCLAIMER,
  };
}
