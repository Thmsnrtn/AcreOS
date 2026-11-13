// ============================================================================
// SHARED/NOTES/SELLERFINANCEGATE.TS — Notes V2 Leg 3: may this originated note
// be activated (consummated) on the facts recorded for it?
// ----------------------------------------------------------------------------
// Pure and browser-safe: no I/O, no clock reads. The caller supplies the facts,
// the counts and the activation instant; this module decides and explains.
// Spec: package §5, read through docs/evidence/2026-11-09/notes-v2-leg3-step0.md
// and its coordinator rulings R1–R8.
//
// WHAT IT HOLDS
//  - The zod shapes of every `note_origination_records.detail` kind
//    (migration 0307; the kind vocabulary is pinned against the migration's
//    CHECK in tests/unit/sellerFinanceGate.test.ts).
//  - The counter's output type (`SellerFinanceCounts`). The counter itself
//    (server/services/notes/sellerFinanceCounter.ts) is a later stage; it
//    computes the tracks per seller over the rolling 12 months ending at the
//    proposed consummation date. Counts handed to `decideActivation` EXCLUDE
//    the deal being gated — the gate adds it where the rule says "including
//    this deal".
//  - `decideActivation`, which refuses with every failed check named, each
//    with the fact that would cure it.
//
// THE CHECKS (a refusal lists every one that fails, not just the first):
//  1. Count / RMLO routing. The dwelling count = track (a) + the unknown-
//     dwelling bucket (R2: unknown counts conservatively as dwelling-secured)
//     + this deal.
//       claim a4: count > 3 refuses ('count_a4').
//       claim a5: count > 1 refuses ('count_a5'); a seller that is not a
//                 natural person, estate or trust refuses, and an unanswered
//                 seller type refuses and names itself ('seller_type_a5').
//       no claim: a consumer-purpose (or ATR-record) deal at count ≥ 4 refuses
//                 without a complete RMLO engagement record ('rmlo_required').
//                 A deal recorded non-consumer is outside this clause (R6').
//     A complete RMLO record cures EXACTLY 'rmlo_required' and nothing else.
//     A claim requires an origination_facts record (R7) — 'claim_unrecorded'.
//  2. ATR. A dwelling-secured consumer deal (an unanswered dwelling or purpose
//     fact counts as possibly yes) needs either a determination attested at
//     or before the activation instant, or an exemption code whose recorded
//     facts do not contradict it ('atr_missing', 'exemption_contradicted').
//     `legacy` is refused whenever it is claimed ('legacy_claimed'): the only
//     legacy rows are import-grandfathered and never reach this gate (R1).
//  3. Terms, only under a claim: every element verdict from
//     evaluateClaimedExclusion (shared/regulatory/doddFrankElements.ts) that
//     is not 'met' refuses and names its element ('terms_element').
//  4. Creditor threshold, §1026.2(a)(17)(v): track (b)'s calendar-year count
//     (plus its unknown-dwelling bucket, R2) including this deal above 5
//     refuses unless a founder's threshold_release record covers this org,
//     seller and calendar year (R4) ('creditor_threshold').
//
// COPY RULES. Messages name the check and the curing fact and cite the Reg Z
// section. They never call the outcome legal sign-off, and they never claim a
// licence was checked: an RMLO record is the operator's statement, recorded.
// ============================================================================

import { z } from "zod";
import type { NoteOriginationRecordKind } from "@shared/schema/note-origination-records";
import {
  evaluateClaimedExclusion,
  type ElementVerdict,
  type TriState,
} from "@shared/regulatory/doddFrankElements";

export type { TriState } from "@shared/regulatory/doddFrankElements";

export const ENGINE_VERSION = "seller-finance-gate-1";

// ── Record detail shapes (one per note_origination_records.kind) ─────────────

const triStateSchema = z.enum(["yes", "no", "unanswered"]);
const nonEmpty = z.string().trim().min(1);
const isoDate = z.iso.date();
const isoInstant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();

export const SELLER_TYPES = ["natural_person", "estate_or_trust", "entity", "unanswered"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

const ATR_EXEMPTION_CODES = ["raw_land", "business_purpose", "commercial_borrower", "legacy"] as const;
export type AtrExemptionCode = (typeof ATR_EXEMPTION_CODES)[number];

export const originationFactsDetail = z.strictObject({
  /** R3: normalized owning_entity; null = the organization itself. */
  sellerKey: z.string().nullable(),
  sellerType: z.enum(SELLER_TYPES),
  dwellingSecured: triStateSchema,
  consumerPurpose: triStateSchema,
  claimedExclusion: z.enum(["a4", "a5", "none"]),
  balloon: triStateSchema,
  negativeAmortization: triStateSchema,
  rateType: z.enum(["fixed", "adjustable", "unanswered"]),
  firstRateAdjustmentMonths: count.nullable(),
  rateCapsStated: triStateSchema,
  sellerConstructedDwelling: triStateSchema,
  consummationDate: isoDate,
});
export type OriginationFactsDetail = z.infer<typeof originationFactsDetail>;

export const rmloEngagementDetail = z.strictObject({
  originatorName: nonEmpty,
  licenceIdentifierAsStated: nonEmpty,
  engagementDate: nonEmpty,
});
export type RmloEngagementDetail = z.infer<typeof rmloEngagementDetail>;

/**
 * Completeness of the STATED fields only. A true result means the operator
 * recorded a name, a licence identifier as they stated it, and a date; it says
 * nothing about whether that licence exists or is current.
 */
export function isCompleteRmloEngagement(detail: unknown): boolean {
  return rmloEngagementDetail.safeParse(detail).success;
}

const trackCounts = z.strictObject({
  trackA: count,
  trackBRolling: count,
  trackBCalendarYear: count,
  trackC: count,
  unknownDwelling: count,
  unknownDwellingCalendarYear: count,
  legacyFlagged: count,
});
const noteIds = z.array(z.number().int());

const elementVerdictSchema = z.strictObject({
  element: z.enum(["balloon", "negative_amortization", "rate_adjustment_timing", "rate_caps", "seller_constructed_dwelling"]),
  verdict: z.enum(["met", "failed", "unanswered"]),
  reason: z.string(),
});

export const activationGatePassedDetail = z.strictObject({
  sellerKey: z.string().nullable(),
  /** Counts BEFORE this deal, as the gate received them. */
  counts: trackCounts,
  contributingNoteIds: z.strictObject({
    trackA: noteIds,
    trackBRolling: noteIds,
    trackBCalendarYear: noteIds,
    trackC: noteIds,
    unknownDwelling: noteIds,
    unknownDwellingCalendarYear: noteIds,
    legacyFlagged: noteIds,
  }),
  /** The origination_facts record used; null when facts were implied from the note (R7). */
  factsRecordId: z.uuid().nullable(),
  atrBasis: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("determination"), attestedAt: isoInstant }),
      z.strictObject({ kind: z.literal("exemption"), code: z.enum(["raw_land", "business_purpose", "commercial_borrower"]) }),
    ])
    .nullable(),
  elementVerdicts: z.array(elementVerdictSchema),
  engineVersion: nonEmpty,
  activatedAt: isoInstant,
});
export type ActivationGatePassedDetail = z.infer<typeof activationGatePassedDetail>;

export const thresholdReleaseDetail = z.strictObject({
  threshold: z.literal("creditor_1026_2_a_17_v"),
  // The seller the release covers, in the counter's normalized key form
  // (null = the organization itself). The release is matched on THIS key,
  // never re-derived from the anchor note: a later facts record can change
  // a note's seller, and a release must not move with it.
  sellerKey: z.string().min(1).nullable(),
  calendarYear: z.number().int().min(1900).max(9999),
  rollingCount: count,
  calendarYearCount: count,
  decisionRef: nonEmpty,
});
export type ThresholdReleaseDetail = z.infer<typeof thresholdReleaseDetail>;

export const atrDeterminationWrittenDetail = z.strictObject({
  attestedAt: isoInstant,
  attestorUserId: nonEmpty,
});
export type AtrDeterminationWrittenDetail = z.infer<typeof atrDeterminationWrittenDetail>;

/** The detail schema for every record kind — keyed by the 0307 vocabulary. */
export const ORIGINATION_RECORD_DETAIL_SCHEMAS = {
  origination_facts: originationFactsDetail,
  rmlo_engagement: rmloEngagementDetail,
  activation_gate_passed: activationGatePassedDetail,
  threshold_release: thresholdReleaseDetail,
  atr_determination_written: atrDeterminationWrittenDetail,
} as const satisfies Record<NoteOriginationRecordKind, z.ZodType>;

// ── Gate inputs ──────────────────────────────────────────────────────────────

export interface SellerFinanceCounts {
  /** (a) dwelling-secured seller-financed deals, rolling 12 months. */
  trackA: number;
  /** (b) dwelling-secured consumer-purpose extensions, rolling 12 months. */
  trackBRolling: number;
  /** (b) the same, for the calendar year the creditor threshold is read in. */
  trackBCalendarYear: number;
  /** (c) every seller-financed deal, rolling 12 months. */
  trackC: number;
  /** R2: consummated rows, rolling 12 months, whose dwelling fact is unknown. */
  unknownDwelling: number;
  /**
   * R2 for the creditor threshold: consummated rows in that calendar year whose
   * dwelling fact is unknown and that are not recorded non-consumer.
   */
  unknownDwellingCalendarYear: number;
  /** `legacy` rows: flagged and reported, never counted. */
  legacyFlagged: number;
}

export interface GateFacts {
  sellerKey: string | null;
  sellerType: SellerType;
  dwellingSecured: TriState;
  consumerPurpose: TriState;
  claimedExclusion: "a4" | "a5" | "none";
  /** R7: a claim lives in an origination_facts record; implied facts cannot carry one. */
  hasFactsRecord: boolean;
  balloon: TriState;
  negativeAmortization: TriState;
  rateType: "fixed" | "adjustable" | "unanswered";
  firstRateAdjustmentMonths: number | null;
  rateCapsStated: TriState;
  sellerConstructedDwelling: TriState;
  /** A determination that passed validateAtrDetermination. */
  hasAtrDetermination: boolean;
  attestedAt: string | null;
  /** The instant of the activation being gated (ISO). */
  activatedAt: string;
  exemptionCode: AtrExemptionCode | null;
  /** The caller's finding that the recorded facts contradict the code (OR'd with the gate's own). */
  factsContradictCode: boolean;
  hasCompleteRmlo: boolean;
  hasThresholdRelease: boolean;
}

export type RefusalCheck =
  | "count_a4"
  | "count_a5"
  | "seller_type_a5"
  | "rmlo_required"
  | "claim_unrecorded"
  | "atr_missing"
  | "exemption_contradicted"
  | "legacy_claimed"
  | "terms_element"
  | "creditor_threshold";

export interface Refusal {
  check: RefusalCheck;
  element?: string;
  message: string;
  curingFact: string;
}

export type ActivationDecision = { allowed: true } | { allowed: false; refusals: Refusal[] };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A code the gate accepts as an ATR basis (legacy never is). */
function isLiveExemption(code: AtrExemptionCode | null): code is "raw_land" | "business_purpose" | "commercial_borrower" {
  return code === "raw_land" || code === "business_purpose" || code === "commercial_borrower";
}

/**
 * Does the recorded fact contradict the exemption code? raw_land claims no
 * dwelling; business_purpose / commercial_borrower claim a non-consumer
 * purpose. Only an ANSWERED opposite fact contradicts.
 */
export function exemptionContradictedBy(
  code: AtrExemptionCode | null,
  facts: Pick<GateFacts, "dwellingSecured" | "consumerPurpose">,
): boolean {
  if (code === "raw_land") return facts.dwellingSecured === "yes";
  if (code === "business_purpose" || code === "commercial_borrower") return facts.consumerPurpose === "yes";
  return false;
}

/** Recorded non-consumer, by the facts record or by a non-consumer exemption code (R6'). */
function recordedNonConsumer(facts: GateFacts): boolean {
  return facts.consumerPurpose === "no" || facts.exemptionCode === "business_purpose" || facts.exemptionCode === "commercial_borrower";
}

function attestedBeforeActivation(attestedAt: string | null, activatedAt: string): boolean {
  if (attestedAt === null) return false;
  const a = Date.parse(attestedAt);
  const b = Date.parse(activatedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a <= b;
}

function bucketNote(unknown: number): string {
  return unknown > 0
    ? ` This includes ${unknown} earlier note${unknown === 1 ? "" : "s"} in the unknown-dwelling bucket, counted as dwelling-secured because no dwelling fact is recorded for ${unknown === 1 ? "it" : "them"}.`
    : "";
}

function bucketCure(unknown: number): string {
  return unknown > 0
    ? ` Or record origination facts for the ${unknown} unknown-dwelling note${unknown === 1 ? "" : "s"}; any answered as not dwelling-secured leave the count.`
    : "";
}

// ── The gate ─────────────────────────────────────────────────────────────────

export function decideActivation(facts: GateFacts, counts: SellerFinanceCounts): ActivationDecision {
  const refusals: Refusal[] = [];
  const claim = facts.claimedExclusion;
  const dwellingCount = counts.trackA + counts.unknownDwelling + 1;
  const priorText = `${counts.trackA + counts.unknownDwelling} earlier dwelling-secured deal${counts.trackA + counts.unknownDwelling === 1 ? "" : "s"} in the 12 months to consummation, plus this one, is ${dwellingCount}.`;

  // ── 1. Count / claim / RMLO routing ────────────────────────────────────────
  if (claim !== "none" && !facts.hasFactsRecord) {
    refusals.push({
      check: "claim_unrecorded",
      message: `An exclusion under 12 CFR 1026.36(a)(${claim === "a4" ? "4" : "5"}) is claimed, but no origination facts record exists for this note. A claim can only be made in that record.`,
      curingFact: "Record the origination facts for this note, including the exclusion claimed.",
    });
  }
  if (claim === "a4" && dwellingCount > 3) {
    refusals.push({
      check: "count_a4",
      message: `The 3-property exclusion, 12 CFR 1026.36(a)(4), allows 3 or fewer financed properties in any 12 months. ${priorText}${bucketNote(counts.unknownDwelling)}`,
      curingFact: `Withdraw the claim (record facts with no exclusion claimed) and record an RMLO engagement for this deal.${bucketCure(counts.unknownDwelling)}`,
    });
  }
  if (claim === "a5") {
    if (dwellingCount > 1) {
      refusals.push({
        check: "count_a5",
        message: `The 1-property exclusion, 12 CFR 1026.36(a)(5), allows only 1 financed property in any 12 months. ${priorText}${bucketNote(counts.unknownDwelling)}`,
        curingFact: `Withdraw the claim (record facts with no exclusion claimed, or claim (a)(4) if its elements hold) and route the deal through a recorded RMLO engagement.${bucketCure(counts.unknownDwelling)}`,
      });
    }
    if (facts.sellerType === "entity") {
      refusals.push({
        check: "seller_type_a5",
        element: "sellerType",
        message: "The 1-property exclusion, 12 CFR 1026.36(a)(5), is open only to a natural person, an estate or a trust. The seller is recorded as an entity.",
        curingFact: "Claim the 3-property exclusion, 12 CFR 1026.36(a)(4), if its elements hold, or record an RMLO engagement and claim no exclusion.",
      });
    } else if (facts.sellerType === "unanswered") {
      refusals.push({
        check: "seller_type_a5",
        element: "sellerType",
        message: "The 1-property exclusion, 12 CFR 1026.36(a)(5), depends on the seller being a natural person, an estate or a trust. The seller type is not recorded.",
        curingFact: "Record the seller type (natural person, estate or trust, or entity) in the origination facts.",
      });
    }
  }
  const insideRmloClause = facts.hasAtrDetermination || !recordedNonConsumer(facts);
  if (claim === "none" && insideRmloClause && dwellingCount >= 4 && !facts.hasCompleteRmlo) {
    refusals.push({
      check: "rmlo_required",
      message: `No seller-financer exclusion is claimed and this would be dwelling-secured deal number ${dwellingCount} in 12 months, so the loan is routed to a licensed mortgage loan originator.${bucketNote(counts.unknownDwelling)}`,
      curingFact: `Record the RMLO engagement for this deal: the originator's name, the licence identifier as they state it, and the engagement date. AcreOS records what is stated; it does not check the licence.${bucketCure(counts.unknownDwelling)}`,
    });
  }

  // ── 2. ATR basis ───────────────────────────────────────────────────────────
  const code = facts.exemptionCode;
  const contradicted = isLiveExemption(code) && (facts.factsContradictCode || exemptionContradictedBy(code, facts));
  if (code === "legacy") {
    refusals.push({
      check: "legacy_claimed",
      element: "exemptionCode",
      message: "The legacy exemption code is reserved for notes imported from the pre-gate book. It cannot be claimed for a new activation.",
      curingFact: "Record an ability-to-repay determination under 12 CFR 1026.43(c), or a raw_land, business_purpose or commercial_borrower exemption the recorded facts support.",
    });
  }
  if (contradicted) {
    const fact = code === "raw_land" ? "the property is dwelling-secured" : "the loan is for a consumer purpose";
    refusals.push({
      check: "exemption_contradicted",
      element: "exemptionCode",
      message: `The exemption code ${code} is contradicted by the origination facts, which record that ${fact}.`,
      curingFact: `Correct whichever is wrong: record new origination facts, or replace the exemption with an ability-to-repay determination under 12 CFR 1026.43(c).`,
    });
  }
  const atrApplies = facts.dwellingSecured !== "no" && facts.consumerPurpose !== "no";
  const determinationHolds = facts.hasAtrDetermination && attestedBeforeActivation(facts.attestedAt, facts.activatedAt);
  const exemptionHolds = isLiveExemption(code) && !contradicted;
  if (atrApplies && !determinationHolds && !exemptionHolds && code !== "legacy" && !contradicted) {
    const late = facts.hasAtrDetermination && !determinationHolds;
    refusals.push({
      check: "atr_missing",
      ...(late ? { element: "attestedAt" } : {}),
      message: late
        ? `The ability-to-repay determination is dated ${facts.attestedAt ?? "(no date)"}, which is not at or before this activation (${facts.activatedAt}). 12 CFR 1026.43(c) requires the determination before consummation.`
        : "This is a dwelling-secured consumer loan (or its dwelling or purpose is not recorded) with no ability-to-repay determination and no exemption. 12 CFR 1026.43(c) requires one before consummation.",
      curingFact: "Record an ability-to-repay determination before activating, or record origination facts showing the loan is not a dwelling-secured consumer loan with the matching exemption.",
    });
  }

  // ── 3. Terms under a claim ─────────────────────────────────────────────────
  if (claim !== "none") {
    const verdicts: ElementVerdict[] = evaluateClaimedExclusion(claim, {
      balloon: facts.balloon,
      negativeAmortization: facts.negativeAmortization,
      rateType: facts.rateType,
      firstRateAdjustmentMonths: facts.firstRateAdjustmentMonths,
      rateCapsStated: facts.rateCapsStated,
      sellerConstructedDwelling: facts.sellerConstructedDwelling,
      hasDwelling: facts.dwellingSecured,
    });
    for (const v of verdicts) {
      if (v.verdict === "met") continue;
      refusals.push({
        check: "terms_element",
        element: v.element,
        message: v.verdict === "failed" ? `Terms element ${v.element} fails: ${v.reason}` : `Terms element ${v.element} is unanswered: ${v.reason}`,
        curingFact:
          v.verdict === "failed"
            ? "Change the note terms so this element holds, or withdraw the claim and record an RMLO engagement."
            : `Record the ${v.element.replace(/_/g, " ")} answer in the origination facts.`,
      });
    }
  }

  // ── 4. Creditor threshold, 12 CFR 1026.2(a)(17)(v) ─────────────────────────
  const thisIsTrackB = facts.dwellingSecured !== "no" && !recordedNonConsumer(facts);
  const calendarYearCount = counts.trackBCalendarYear + counts.unknownDwellingCalendarYear + (thisIsTrackB ? 1 : 0);
  if (calendarYearCount > 5 && !facts.hasThresholdRelease) {
    const unknown = counts.unknownDwellingCalendarYear;
    refusals.push({
      check: "creditor_threshold",
      message: `This would be dwelling-secured consumer credit extension number ${calendarYearCount} in the calendar year, above the 5 at which a seller becomes a creditor under 12 CFR 1026.2(a)(17)(v).${unknown > 0 ? ` This includes ${unknown} note${unknown === 1 ? "" : "s"} in the unknown-dwelling bucket.` : ""}`,
      curingFact: `A founder threshold release recorded for this organization, seller and calendar year.${bucketCure(unknown)}`,
    });
  }

  return refusals.length === 0 ? { allowed: true } : { allowed: false, refusals };
}
