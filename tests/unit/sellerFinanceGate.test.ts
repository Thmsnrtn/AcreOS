/**
 * Notes V2 Leg 3 — the pure stage: the seller-finance activation gate, the
 * record detail shapes, the claimed-exclusion element rule, and the
 * payment-side status helper.
 *
 * Expected outcomes are derived from the spec (package §5 as condensed in the
 * build brief, read through the Step 0 coordinator rulings R1–R8 in
 * docs/evidence/2026-11-09/notes-v2-leg3-step0.md), not from the
 * implementation. Every edge is tested on BOTH sides, so an off-by-one in
 * either direction goes red.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decideActivation,
  exemptionContradictedBy,
  isCompleteRmloEngagement,
  originationFactsDetail,
  rmloEngagementDetail,
  activationGatePassedDetail,
  thresholdReleaseDetail,
  atrDeterminationWrittenDetail,
  ORIGINATION_RECORD_DETAIL_SCHEMAS,
  ENGINE_VERSION,
  type GateFacts,
  type SellerFinanceCounts,
  type Refusal,
} from "../../shared/notes/sellerFinanceGate";
import {
  evaluateClaimedExclusion,
  DODD_FRANK_ELEMENT_CODES,
  type ClaimedExclusionFacts,
} from "../../shared/regulatory/doddFrankElements";
import { evaluateClaimedExclusion as checkerEvaluateClaimedExclusion } from "../../server/services/doddFrankChecker";
import { nextServicedStatus } from "../../shared/notes/servicedStatus";
import { NOTE_ORIGINATION_RECORD_KINDS } from "../../shared/schema/note-origination-records";

const ACTIVATED_AT = "2026-11-09T15:00:00.000Z";

/** A no-claim consumer dwelling deal with a timely ATR determination: allowed at zero counts. */
const consumerNoClaim: GateFacts = {
  sellerKey: null,
  sellerType: "natural_person",
  dwellingSecured: "yes",
  consumerPurpose: "yes",
  claimedExclusion: "none",
  hasFactsRecord: true,
  balloon: "unanswered",
  negativeAmortization: "unanswered",
  rateType: "unanswered",
  firstRateAdjustmentMonths: null,
  rateCapsStated: "unanswered",
  sellerConstructedDwelling: "unanswered",
  hasAtrDetermination: true,
  attestedAt: "2026-11-09T14:00:00.000Z",
  activatedAt: ACTIVATED_AT,
  exemptionCode: null,
  factsContradictCode: false,
  hasCompleteRmlo: false,
  hasThresholdRelease: false,
};

/** Every terms element answered so the claim holds. */
const cleanTerms: Partial<GateFacts> = {
  balloon: "no",
  negativeAmortization: "no",
  rateType: "fixed",
  firstRateAdjustmentMonths: null,
  rateCapsStated: "unanswered",
  sellerConstructedDwelling: "no",
};

const claimA4: GateFacts = { ...consumerNoClaim, ...cleanTerms, claimedExclusion: "a4", sellerType: "entity" };
const claimA5: GateFacts = { ...consumerNoClaim, ...cleanTerms, claimedExclusion: "a5" };

const zero: SellerFinanceCounts = {
  trackA: 0,
  trackBRolling: 0,
  trackBCalendarYear: 0,
  trackC: 0,
  unknownDwelling: 0,
  unknownDwellingCalendarYear: 0,
  legacyFlagged: 0,
};

function refusals(facts: GateFacts, counts: Partial<SellerFinanceCounts> = {}): Refusal[] {
  const d = decideActivation(facts, { ...zero, ...counts });
  return d.allowed ? [] : d.refusals;
}
const checks = (facts: GateFacts, counts: Partial<SellerFinanceCounts> = {}) => refusals(facts, counts).map((r) => r.check);

describe("baselines are allowed (so every refusal below is caused by its perturbation)", () => {
  it.each([
    ["no-claim consumer deal with ATR", consumerNoClaim],
    ["a4 claim, clean terms", claimA4],
    ["a5 claim, clean terms", claimA5],
  ])("%s", (_label, facts) => {
    expect(decideActivation(facts, zero)).toEqual({ allowed: true });
  });
});

describe("count edges — the deal being gated counts as the next one", () => {
  it("(a)(4): 2 prior + this = 3 is allowed", () => {
    expect(checks(claimA4, { trackA: 2 })).toEqual([]);
  });
  it("(a)(4): 3 prior + this = 4 is refused as count_a4", () => {
    expect(checks(claimA4, { trackA: 3 })).toEqual(["count_a4"]);
  });
  it("(a)(5): 0 prior + this = 1 is allowed", () => {
    expect(checks(claimA5, { trackA: 0 })).toEqual([]);
  });
  it("(a)(5): 1 prior + this = 2 is refused as count_a5", () => {
    expect(checks(claimA5, { trackA: 1 })).toEqual(["count_a5"]);
  });
  it("the unknown-dwelling bucket pushes a claim over the cap, and the refusal names the bucket", () => {
    expect(checks(claimA4, { trackA: 2 })).toEqual([]);
    const r = refusals(claimA4, { trackA: 2, unknownDwelling: 1 });
    expect(r.map((x) => x.check)).toEqual(["count_a4"]);
    expect(r[0].message).toMatch(/unknown-dwelling bucket/);
    expect(r[0].curingFact).toMatch(/unknown-dwelling note/);
    const r5 = refusals(claimA5, { unknownDwelling: 1 });
    expect(r5.map((x) => x.check)).toEqual(["count_a5"]);
    expect(r5[0].message).toMatch(/unknown-dwelling bucket/);
  });
  it("legacy-flagged and track (c) rows never count toward a claim", () => {
    expect(checks(claimA5, { legacyFlagged: 40, trackC: 40 })).toEqual([]);
  });
});

describe("creditor threshold, §1026.2(a)(17)(v)", () => {
  it("calendar-year 4 prior + this = 5 is allowed", () => {
    expect(checks(consumerNoClaim, { trackBCalendarYear: 4 })).toEqual([]);
  });
  it("calendar-year 5 prior + this = 6 is refused without a release", () => {
    expect(checks(consumerNoClaim, { trackBCalendarYear: 5 })).toEqual(["creditor_threshold"]);
  });
  it("is allowed with a founder threshold release", () => {
    expect(checks({ ...consumerNoClaim, hasThresholdRelease: true }, { trackBCalendarYear: 5 })).toEqual([]);
  });
  it("reads the calendar-year count, not the rolling one", () => {
    expect(checks(consumerNoClaim, { trackBRolling: 9, trackBCalendarYear: 0 })).toEqual([]);
  });
  it("the unknown-dwelling calendar-year bucket counts conservatively and is named", () => {
    const r = refusals(consumerNoClaim, { trackBCalendarYear: 4, unknownDwellingCalendarYear: 1 });
    expect(r.map((x) => x.check)).toEqual(["creditor_threshold"]);
    expect(r[0].message).toMatch(/unknown-dwelling bucket/);
  });
  it("a deal recorded non-consumer is not itself a track (b) extension", () => {
    const business: GateFacts = { ...consumerNoClaim, consumerPurpose: "no", hasAtrDetermination: false, attestedAt: null, exemptionCode: "business_purpose" };
    expect(checks(business, { trackBCalendarYear: 5 })).toEqual([]);
    expect(checks(business, { trackBCalendarYear: 6 })).toEqual(["creditor_threshold"]);
  });
});

describe("(a)(5) seller type", () => {
  it("an entity under (a)(5) refuses", () => {
    const r = refusals({ ...claimA5, sellerType: "entity" });
    expect(r.map((x) => x.check)).toEqual(["seller_type_a5"]);
    expect(r[0].element).toBe("sellerType");
  });
  it("an unanswered seller type refuses and names itself", () => {
    const r = refusals({ ...claimA5, sellerType: "unanswered" });
    expect(r.map((x) => x.check)).toEqual(["seller_type_a5"]);
    expect(r[0].message).toMatch(/not recorded/);
    expect(r[0].curingFact).toMatch(/seller type/);
  });
  it("an estate or trust passes", () => {
    expect(checks({ ...claimA5, sellerType: "estate_or_trust" })).toEqual([]);
  });
  it("an entity may claim (a)(4)", () => {
    expect(checks({ ...claimA4, sellerType: "entity" })).toEqual([]);
  });
});

describe("RMLO routing (no claim, consumer deal)", () => {
  it("count 3 (2 prior + this) needs no RMLO", () => {
    expect(checks(consumerNoClaim, { trackA: 2 })).toEqual([]);
  });
  it("count 4 (3 prior + this) refuses without an RMLO record", () => {
    expect(checks(consumerNoClaim, { trackA: 3 })).toEqual(["rmlo_required"]);
  });
  it("the unknown bucket alone can reach the RMLO count", () => {
    expect(checks(consumerNoClaim, { trackA: 1, unknownDwelling: 2 })).toEqual(["rmlo_required"]);
  });
  it("passes with a complete RMLO record", () => {
    expect(checks({ ...consumerNoClaim, hasCompleteRmlo: true }, { trackA: 3 })).toEqual([]);
  });
  it("an unanswered purpose stays inside the clause (refuse, never assume)", () => {
    expect(checks({ ...consumerNoClaim, consumerPurpose: "unanswered" }, { trackA: 3 })).toEqual(["rmlo_required"]);
  });

  it("a complete RMLO record cures EXACTLY rmlo_required and no other refusal (package test 13)", () => {
    const situations: Array<[GateFacts, Partial<SellerFinanceCounts>]> = [
      [{ ...claimA4, balloon: "yes" }, { trackA: 3 }],
      [{ ...claimA5, sellerType: "entity", negativeAmortization: "yes" }, { trackA: 1 }],
      [{ ...consumerNoClaim, hasAtrDetermination: false, attestedAt: null }, { trackA: 3 }],
      [{ ...consumerNoClaim, exemptionCode: "legacy" }, { trackA: 5, trackBCalendarYear: 9 }],
      [consumerNoClaim, { trackA: 3, trackBCalendarYear: 5 }],
    ];
    for (const [facts, counts] of situations) {
      const without = checks({ ...facts, hasCompleteRmlo: false }, counts);
      const withRmlo = checks({ ...facts, hasCompleteRmlo: true }, counts);
      expect(withRmlo).toEqual(without.filter((c) => c !== "rmlo_required"));
    }
  });

  it("the RMLO does NOT cure a simultaneous terms refusal", () => {
    const r = checks({ ...claimA4, balloon: "yes", hasCompleteRmlo: true }, { trackA: 3 });
    expect(r).toContain("count_a4");
    expect(r).toContain("terms_element");
  });
});

describe("R6' — a deal recorded non-consumer is outside the no-claim clause", () => {
  it("consumerPurpose 'no' at count 6 with no RMLO is not routed to an RMLO", () => {
    const f: GateFacts = { ...consumerNoClaim, consumerPurpose: "no", hasAtrDetermination: false, attestedAt: null, exemptionCode: "business_purpose" };
    expect(checks(f, { trackA: 5 })).toEqual([]);
  });
  it("a commercial_borrower code with an unanswered purpose is also outside it", () => {
    const f: GateFacts = { ...consumerNoClaim, consumerPurpose: "unanswered", hasAtrDetermination: false, attestedAt: null, exemptionCode: "commercial_borrower" };
    expect(checks(f, { trackA: 5 })).toEqual([]);
  });
  it("an ATR-record deal is inside it whatever its purpose field says", () => {
    expect(checks({ ...consumerNoClaim, consumerPurpose: "no" }, { trackA: 3 })).toEqual(["rmlo_required"]);
  });
});

describe("R7 — a claim requires an origination facts record", () => {
  it("a claim with no facts record refuses", () => {
    expect(checks({ ...claimA4, hasFactsRecord: false })).toEqual(["claim_unrecorded"]);
  });
  it("no claim needs no record", () => {
    expect(checks({ ...consumerNoClaim, hasFactsRecord: false })).toEqual([]);
  });
});

describe("ATR basis", () => {
  const noAtr: GateFacts = { ...consumerNoClaim, hasAtrDetermination: false, attestedAt: null };

  it("a dwelling consumer deal with neither a determination nor an exemption refuses", () => {
    const r = refusals(noAtr);
    expect(r.map((x) => x.check)).toEqual(["atr_missing"]);
    expect(r[0].message).toMatch(/1026\.43\(c\)/);
  });
  it("an unanswered dwelling fact still requires ATR", () => {
    expect(checks({ ...noAtr, dwellingSecured: "unanswered" })).toEqual(["atr_missing"]);
  });
  it("a determination attested AFTER activation does not satisfy (package test 16)", () => {
    const r = refusals({ ...consumerNoClaim, attestedAt: "2026-11-09T15:00:00.001Z" });
    expect(r.map((x) => x.check)).toEqual(["atr_missing"]);
    expect(r[0].element).toBe("attestedAt");
  });
  it("a determination attested AT the activation instant satisfies", () => {
    expect(checks({ ...consumerNoClaim, attestedAt: ACTIVATED_AT })).toEqual([]);
  });
  it("a determination flag with no date does not satisfy", () => {
    expect(checks({ ...consumerNoClaim, attestedAt: null })).toEqual(["atr_missing"]);
  });
  it("an unparseable attestation date does not satisfy", () => {
    expect(checks({ ...consumerNoClaim, attestedAt: "yesterday" })).toEqual(["atr_missing"]);
  });
  it("raw_land with the dwelling recorded 'no' satisfies without a determination", () => {
    expect(checks({ ...noAtr, dwellingSecured: "no", exemptionCode: "raw_land" })).toEqual([]);
  });
  it("raw_land while the facts record says dwelling = yes refuses (package test 15)", () => {
    const r = refusals({ ...noAtr, exemptionCode: "raw_land" });
    expect(r.map((x) => x.check)).toEqual(["exemption_contradicted"]);
    expect(r[0].message).toMatch(/raw_land/);
  });
  it("business_purpose while the facts record says consumer = yes refuses", () => {
    expect(checks({ ...noAtr, exemptionCode: "business_purpose" })).toEqual(["exemption_contradicted"]);
  });
  it("the caller's contradiction finding is honoured too", () => {
    expect(checks({ ...noAtr, dwellingSecured: "no", exemptionCode: "raw_land", factsContradictCode: true })).toEqual(["exemption_contradicted"]);
  });
  it("legacy newly claimed refuses — on a consumer deal and on a non-consumer one", () => {
    expect(checks({ ...noAtr, exemptionCode: "legacy" })).toEqual(["legacy_claimed"]);
    expect(checks({ ...consumerNoClaim, exemptionCode: "legacy" })).toEqual(["legacy_claimed"]);
    expect(checks({ ...noAtr, consumerPurpose: "no", dwellingSecured: "no", exemptionCode: "legacy" })).toEqual(["legacy_claimed"]);
  });
  it("exemptionContradictedBy reads only an ANSWERED opposite fact", () => {
    expect(exemptionContradictedBy("raw_land", { dwellingSecured: "unanswered", consumerPurpose: "yes" })).toBe(false);
    expect(exemptionContradictedBy("raw_land", { dwellingSecured: "yes", consumerPurpose: "no" })).toBe(true);
    expect(exemptionContradictedBy("commercial_borrower", { dwellingSecured: "yes", consumerPurpose: "yes" })).toBe(true);
    expect(exemptionContradictedBy(null, { dwellingSecured: "yes", consumerPurpose: "yes" })).toBe(false);
  });
});

describe("terms elements under a claim", () => {
  const termsOf = (facts: GateFacts) => refusals(facts).filter((r) => r.check === "terms_element").map((r) => r.element);

  it("a balloon fails (a)(4)", () => {
    expect(termsOf({ ...claimA4, balloon: "yes" })).toEqual(["balloon"]);
  });
  it("a balloon passes (a)(5)", () => {
    expect(checks({ ...claimA5, balloon: "yes" })).toEqual([]);
    expect(checks({ ...claimA5, balloon: "unanswered" })).toEqual([]);
  });
  it("negative amortization fails both", () => {
    expect(termsOf({ ...claimA4, negativeAmortization: "yes" })).toEqual(["negative_amortization"]);
    expect(termsOf({ ...claimA5, negativeAmortization: "yes" })).toEqual(["negative_amortization"]);
  });
  it("adjustable first changing before 60 months fails both; at 60 it holds", () => {
    const adj = { rateType: "adjustable" as const, rateCapsStated: "yes" as const };
    expect(termsOf({ ...claimA4, ...adj, firstRateAdjustmentMonths: 59 })).toEqual(["rate_adjustment_timing"]);
    expect(termsOf({ ...claimA5, ...adj, firstRateAdjustmentMonths: 59 })).toEqual(["rate_adjustment_timing"]);
    expect(checks({ ...claimA4, ...adj, firstRateAdjustmentMonths: 60 })).toEqual([]);
    expect(checks({ ...claimA5, ...adj, firstRateAdjustmentMonths: 60 })).toEqual([]);
  });
  it("adjustable without stated caps fails (a)(4) and not (a)(5)", () => {
    const adj = { rateType: "adjustable" as const, firstRateAdjustmentMonths: 84, rateCapsStated: "no" as const };
    expect(termsOf({ ...claimA4, ...adj })).toEqual(["rate_caps"]);
    expect(checks({ ...claimA5, ...adj })).toEqual([]);
  });
  it("a seller-constructed dwelling fails both", () => {
    expect(termsOf({ ...claimA4, sellerConstructedDwelling: "yes" })).toEqual(["seller_constructed_dwelling"]);
    expect(termsOf({ ...claimA5, sellerConstructedDwelling: "yes" })).toEqual(["seller_constructed_dwelling"]);
  });
  it.each([
    ["balloon", { balloon: "unanswered" }, "balloon"],
    ["negativeAmortization", { negativeAmortization: "unanswered" }, "negative_amortization"],
    ["rateType", { rateType: "unanswered" }, "rate_adjustment_timing"],
    ["firstRateAdjustmentMonths", { rateType: "adjustable", rateCapsStated: "yes", firstRateAdjustmentMonths: null }, "rate_adjustment_timing"],
    ["rateCapsStated", { rateType: "adjustable", firstRateAdjustmentMonths: 84, rateCapsStated: "unanswered" }, "rate_caps"],
    ["sellerConstructedDwelling", { sellerConstructedDwelling: "unanswered" }, "seller_constructed_dwelling"],
  ] as const)("an unanswered %s refuses under (a)(4) and names itself", (_label, patch, element) => {
    const r = refusals({ ...claimA4, ...(patch as Partial<GateFacts>) }).filter((x) => x.check === "terms_element");
    expect(r.map((x) => x.element)).toContain(element);
    const mine = r.find((x) => x.element === element)!;
    expect(mine.message).toMatch(new RegExp(`${element} is unanswered`));
  });
  it("no terms refusal when nothing is claimed, even with every element unanswered", () => {
    expect(checks(consumerNoClaim)).toEqual([]);
  });
  it("the gate's terms refusals are exactly evaluateClaimedExclusion's non-met elements (one rule)", () => {
    const grid: Partial<GateFacts>[] = [
      {},
      { balloon: "yes", negativeAmortization: "yes" },
      { rateType: "adjustable", firstRateAdjustmentMonths: 12, rateCapsStated: "no", sellerConstructedDwelling: "yes" },
      { balloon: "unanswered", negativeAmortization: "unanswered", rateType: "unanswered", sellerConstructedDwelling: "unanswered" },
    ];
    for (const claim of ["a4", "a5"] as const) {
      for (const patch of grid) {
        const facts: GateFacts = { ...(claim === "a4" ? claimA4 : claimA5), ...patch };
        const expected = evaluateClaimedExclusion(claim, { ...facts, hasDwelling: facts.dwellingSecured })
          .filter((v) => v.verdict !== "met")
          .map((v) => v.element);
        expect(termsOf(facts)).toEqual(expected);
      }
    }
  });
});

describe("refusal copy", () => {
  const all: Refusal[] = [
    ...refusals({ ...claimA4, balloon: "yes", negativeAmortization: "unanswered", rateType: "adjustable", firstRateAdjustmentMonths: 12, rateCapsStated: "no", sellerConstructedDwelling: "yes", hasFactsRecord: false, exemptionCode: "raw_land", hasAtrDetermination: false }, { trackA: 3, unknownDwelling: 2, trackBCalendarYear: 6, unknownDwellingCalendarYear: 1 }),
    ...refusals({ ...claimA5, sellerType: "entity" }, { trackA: 4, unknownDwelling: 1 }),
    ...refusals({ ...claimA5, sellerType: "unanswered" }),
    ...refusals({ ...consumerNoClaim, exemptionCode: "legacy" }, { trackA: 3 }),
    ...refusals({ ...consumerNoClaim, attestedAt: "2027-01-01T00:00:00Z" }, { trackA: 3 }),
    ...refusals({ ...consumerNoClaim, hasAtrDetermination: false, exemptionCode: "business_purpose" }),
  ];
  const checksSeen = new Set(all.map((r) => r.check));

  it("covers every refusal check (vacuity floor)", () => {
    expect([...checksSeen].sort()).toEqual(
      ["atr_missing", "claim_unrecorded", "count_a4", "count_a5", "creditor_threshold", "exemption_contradicted", "legacy_claimed", "rmlo_required", "seller_type_a5", "terms_element"].sort(),
    );
  });
  it("every refusal names a curing fact", () => {
    for (const r of all) expect(r.curingFact.trim().length).toBeGreaterThan(10);
  });
  it("never uses the word 'compliance' and never claims a licence was verified", () => {
    for (const r of all) {
      const text = `${r.message} ${r.curingFact}`;
      expect(text).not.toMatch(/complian/i);
      expect(text).not.toMatch(/\bverified\b|licen[cs]e (?:is )?(?:valid|confirmed)/i);
    }
  });
  it("states the exclusions the way the Pax claims fence requires", () => {
    for (const r of all) {
      const text = `${r.message} ${r.curingFact}`;
      expect(text).not.toMatch(/balloon[^.;]{0,80}(?:break|breaking|disqualif|lose|void)[^.;]{0,40}(?:natural[- ]person|1-property|one-property)/i);
      expect(text).not.toMatch(/(?:1-property|one-property|natural[- ]person)[^.;]{0,60}1026\.36\(a\)\(4\)(?![^.;]{0,80}\(a\)\(5\))/i);
      if (/1026\.36\(a\)\(4\)/.test(text) && /property exclusion/.test(text)) expect(text).toMatch(/3-property exclusion, 12 CFR 1026\.36\(a\)\(4\)/);
      if (/1026\.36\(a\)\(5\)/.test(text) && /property exclusion/.test(text)) expect(text).toMatch(/1-property exclusion, 12 CFR 1026\.36\(a\)\(5\)/);
    }
  });
  it("the creditor threshold cites §1026.2(a)(17)(v)", () => {
    expect(all.find((r) => r.check === "creditor_threshold")!.message).toMatch(/1026\.2\(a\)\(17\)\(v\)/);
  });
});

describe("evaluateClaimedExclusion (shared element rule)", () => {
  it("the checker module re-exports the SAME function (one implementation)", () => {
    expect(checkerEvaluateClaimedExclusion).toBe(evaluateClaimedExclusion);
  });
  it("returns stable element codes in a stable order; rate_caps only under (a)(4)", () => {
    expect(evaluateClaimedExclusion("a4", {}).map((v) => v.element)).toEqual([...DODD_FRANK_ELEMENT_CODES]);
    expect(evaluateClaimedExclusion("a5", {}).map((v) => v.element)).toEqual(DODD_FRANK_ELEMENT_CODES.filter((c) => c !== "rate_caps"));
  });
  it("absence of an input is 'unanswered', never assumed", () => {
    expect(evaluateClaimedExclusion("a4", {}).every((v) => v.verdict === "unanswered")).toBe(true);
    const a5 = evaluateClaimedExclusion("a5", {});
    expect(a5.find((v) => v.element === "balloon")!.verdict).toBe("met");
    expect(a5.filter((v) => v.element !== "balloon").every((v) => v.verdict === "unanswered")).toBe(true);
  });
  const verdict = (claim: "a4" | "a5", facts: ClaimedExclusionFacts, element: string) =>
    evaluateClaimedExclusion(claim, facts).find((v) => v.element === element)?.verdict;

  it("balloon: failed under a4, met under a5", () => {
    expect(verdict("a4", { balloon: "yes" }, "balloon")).toBe("failed");
    expect(verdict("a4", { balloon: "no" }, "balloon")).toBe("met");
    expect(verdict("a5", { balloon: "yes" }, "balloon")).toBe("met");
  });
  it("rate timing: 59 failed, 60 met, missing month unanswered, NaN failed (the checker's original behaviour)", () => {
    for (const claim of ["a4", "a5"] as const) {
      expect(verdict(claim, { rateType: "adjustable", firstRateAdjustmentMonths: 59 }, "rate_adjustment_timing")).toBe("failed");
      expect(verdict(claim, { rateType: "adjustable", firstRateAdjustmentMonths: 60 }, "rate_adjustment_timing")).toBe("met");
      expect(verdict(claim, { rateType: "adjustable", firstRateAdjustmentMonths: null }, "rate_adjustment_timing")).toBe("unanswered");
      expect(verdict(claim, { rateType: "adjustable", firstRateAdjustmentMonths: Number.NaN }, "rate_adjustment_timing")).toBe("failed");
      expect(verdict(claim, { rateType: "fixed" }, "rate_adjustment_timing")).toBe("met");
    }
  });
  it("rate caps under a4: fixed met, adjustable yes met, no failed, unanswered unanswered", () => {
    expect(verdict("a4", { rateType: "fixed" }, "rate_caps")).toBe("met");
    expect(verdict("a4", { rateType: "adjustable", rateCapsStated: "yes" }, "rate_caps")).toBe("met");
    expect(verdict("a4", { rateType: "adjustable", rateCapsStated: "no" }, "rate_caps")).toBe("failed");
    expect(verdict("a4", { rateType: "adjustable" }, "rate_caps")).toBe("unanswered");
  });
  it("seller-constructed: no dwelling answered 'no' means there is no residence to have built", () => {
    expect(verdict("a4", { hasDwelling: "no" }, "seller_constructed_dwelling")).toBe("met");
    expect(verdict("a4", { hasDwelling: "yes" }, "seller_constructed_dwelling")).toBe("unanswered");
    expect(verdict("a4", { hasDwelling: "no", sellerConstructedDwelling: "yes" }, "seller_constructed_dwelling")).toBe("failed");
  });
});

describe("record detail shapes (migration 0307 vocabulary)", () => {
  it("has a schema for exactly the kinds the schema module and migration 0307's CHECK allow", () => {
    expect(Object.keys(ORIGINATION_RECORD_DETAIL_SCHEMAS).sort()).toEqual([...NOTE_ORIGINATION_RECORD_KINDS].sort());
    const sql = readFileSync("migrations/0307_notes_v2_seller_finance_gate_records.sql", "utf8");
    const m = sql.match(/"kind" IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const kinds = m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(kinds.length).toBeGreaterThanOrEqual(5);
    expect(kinds.sort()).toEqual(Object.keys(ORIGINATION_RECORD_DETAIL_SCHEMAS).sort());
  });

  const facts = {
    sellerKey: "smith land llc",
    sellerType: "entity",
    dwellingSecured: "yes",
    consumerPurpose: "yes",
    claimedExclusion: "a4",
    balloon: "no",
    negativeAmortization: "no",
    rateType: "adjustable",
    firstRateAdjustmentMonths: 84,
    rateCapsStated: "yes",
    sellerConstructedDwelling: "no",
    consummationDate: "2026-11-09",
  };

  it("origination_facts accepts a full record and a null seller key (the organization itself)", () => {
    expect(originationFactsDetail.safeParse(facts).success).toBe(true);
    expect(originationFactsDetail.safeParse({ ...facts, sellerKey: null }).success).toBe(true);
  });
  it("origination_facts: a missing element is not 'false' — it fails the shape", () => {
    const { balloon: _omit, ...rest } = facts;
    expect(originationFactsDetail.safeParse(rest).success).toBe(false);
  });
  it("origination_facts refuses booleans for tri-state elements, unknown keys and impossible dates", () => {
    expect(originationFactsDetail.safeParse({ ...facts, balloon: false }).success).toBe(false);
    expect(originationFactsDetail.safeParse({ ...facts, smuggled: 1 }).success).toBe(false);
    expect(originationFactsDetail.safeParse({ ...facts, consummationDate: "2026-13-01" }).success).toBe(false);
    expect(originationFactsDetail.safeParse({ ...facts, claimedExclusion: "a6" }).success).toBe(false);
    expect(originationFactsDetail.safeParse({ ...facts, firstRateAdjustmentMonths: -1 }).success).toBe(false);
  });

  const rmlo = { originatorName: "Pat Doe", licenceIdentifierAsStated: "NMLS 123456", engagementDate: "2026-11-01" };
  it("RMLO engagement: complete only when every stated field is non-empty", () => {
    expect(rmloEngagementDetail.safeParse(rmlo).success).toBe(true);
    expect(isCompleteRmloEngagement(rmlo)).toBe(true);
    expect(isCompleteRmloEngagement({ ...rmlo, licenceIdentifierAsStated: "   " })).toBe(false);
    expect(isCompleteRmloEngagement({ ...rmlo, originatorName: "" })).toBe(false);
    const { engagementDate: _omit, ...noDate } = rmlo;
    expect(isCompleteRmloEngagement(noDate)).toBe(false);
    expect(isCompleteRmloEngagement(null)).toBe(false);
  });

  it("threshold_release pins the threshold and needs a decision reference", () => {
    const ok = { threshold: "creditor_1026_2_a_17_v", sellerKey: "acme land llc", calendarYear: 2026, rollingCount: 7, calendarYearCount: 6, decisionRef: "docs/company/founder-decisions-2026-11-09.md" };
    expect(thresholdReleaseDetail.safeParse(ok).success).toBe(true);
    expect(thresholdReleaseDetail.safeParse({ ...ok, threshold: "other" }).success).toBe(false);
    expect(thresholdReleaseDetail.safeParse({ ...ok, decisionRef: " " }).success).toBe(false);
  });

  it("atr_determination_written needs an instant and an attestor", () => {
    expect(atrDeterminationWrittenDetail.safeParse({ attestedAt: "2026-11-09T14:00:00.000Z", attestorUserId: "u_1" }).success).toBe(true);
    expect(atrDeterminationWrittenDetail.safeParse({ attestedAt: "2026-11-09", attestorUserId: "u_1" }).success).toBe(false);
    expect(atrDeterminationWrittenDetail.safeParse({ attestedAt: "2026-11-09T14:00:00.000Z", attestorUserId: "" }).success).toBe(false);
  });

  it("activation_gate_passed snapshots the inputs; a legacy ATR basis cannot be recorded", () => {
    const ids = { trackA: [1, 2], trackBRolling: [2], trackBCalendarYear: [2], trackC: [1, 2, 3], unknownDwelling: [], unknownDwellingCalendarYear: [], legacyFlagged: [9] };
    const snap = {
      sellerKey: null,
      counts: { trackA: 2, trackBRolling: 1, trackBCalendarYear: 1, trackC: 3, unknownDwelling: 0, unknownDwellingCalendarYear: 0, legacyFlagged: 1 },
      contributingNoteIds: ids,
      factsRecordId: "7d7f8f3e-6a51-4a4c-9a8e-2f0b7d1f2c11",
      atrBasis: { kind: "determination", attestedAt: "2026-11-09T14:00:00.000Z" },
      elementVerdicts: evaluateClaimedExclusion("a4", { balloon: "no" }),
      engineVersion: ENGINE_VERSION,
      activatedAt: ACTIVATED_AT,
    };
    expect(activationGatePassedDetail.safeParse(snap).success).toBe(true);
    expect(activationGatePassedDetail.safeParse({ ...snap, atrBasis: null, factsRecordId: null }).success).toBe(true);
    expect(activationGatePassedDetail.safeParse({ ...snap, atrBasis: { kind: "exemption", code: "raw_land" } }).success).toBe(true);
    expect(activationGatePassedDetail.safeParse({ ...snap, atrBasis: { kind: "exemption", code: "legacy" } }).success).toBe(false);
    expect(activationGatePassedDetail.safeParse({ ...snap, counts: { ...snap.counts, trackA: -1 } }).success).toBe(false);
  });
});

describe("nextServicedStatus — the payment-side status write", () => {
  it.each([
    ["pending", 50_000, "pending"],
    ["pending", 0, "pending"],
    ["pending", -100, "pending"],
    ["defaulted", 50_000, "defaulted"],
    ["defaulted", 0, "paid_off"],
    ["active", 50_000, "active"],
    ["active", 0, "paid_off"],
    ["active", -1, "paid_off"],
    ["late", 50_000, "active"],
    ["delinquent", 50_000, "active"],
    ["suspended", 50_000, "active"],
    ["delinquent", 0, "paid_off"],
    // Preserved from today's three expressions (see the file's residual note):
    ["paid_off", 50_000, "active"],
    ["foreclosed", 0, "paid_off"],
  ])("%s with balance %i → %s", (prior, balance, expected) => {
    expect(nextServicedStatus(prior, balance)).toBe(expected);
  });
  it("never returns active from pending, at any balance", () => {
    for (const b of [-1e9, -1, 0, 1, 1e9, Number.NaN]) expect(nextServicedStatus("pending", b)).not.toBe("active");
  });
  it("a non-numeric balance lands in the positive-balance column, as the inline expressions did", () => {
    expect(nextServicedStatus("active", Number.NaN)).toBe("active");
    expect(nextServicedStatus("defaulted", Number.NaN)).toBe("defaulted");
  });
});
