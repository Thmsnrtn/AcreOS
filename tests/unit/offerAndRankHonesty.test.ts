/**
 * The two places a fabricated default became a COMMITMENT.
 *
 * Everything else this campaign has fixed inflated a score, a report or a
 * ranking. These two spent money:
 *
 * 1. `computeOfferIntelligence` (leadIntelligenceEngine) read
 *    `parseFloat(lead.acres || lead.acreage || "5")` and
 *    `nassData?.pasturePerAcre || 1000`. For a lead with no acreage on file in
 *    a county USDA has no value for, that is 1000 × 0.25 × 5 = a $1,250 offer —
 *    and `offerPrice` is interpolated verbatim into the outreach message sent
 *    to the property owner: "My offer for your X County property is $1,250."
 *    A dollar figure quoted to a counterparty, from two constants.
 *
 * 2. `rankCountiesForCampaign` (parcelIntelligenceFusion) read
 *    `profileData?.opportunityScore || 50`, and 50 lands on "Test with 500
 *    letters" — an instruction to spend money, issued for a county nothing had
 *    scored. That file's own header documents refusing to feed a scoring model
 *    placeholder constants; the rule was written down six hundred lines above
 *    the place that broke it.
 *
 * Both now refuse, and the refusal is asserted on the RENDERED TEXT, because
 * the text is what reaches the counterparty and the operator.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { scoreLeadIntelligence } from "../../server/services/leadIntelligenceEngine";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

function code(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

describe("no offer is quoted that no measurement supports", () => {
  const src = code("server/services/leadIntelligenceEngine.ts");

  it("vacuity guard: the source is readable and still computes offers", () => {
    expect(src.length).toBeGreaterThan(5000);
    expect(src).toMatch(/function computeOfferIntelligence\(/);
    expect(src).toMatch(/function generateMessageHook\(/);
  });

  /**
   * BEHAVIOURAL, not textual.
   *
   * The first version of this assertion matched the source for
   * `lead.acres || lead.acreage || "5"` — and a mutation that restored the
   * default as `lead?.acres || lead?.acreage || "5"` sailed straight past it,
   * because the regex governed one SPELLING rather than the behaviour. There
   * is always another spelling. `scoreLeadIntelligence` touches no database on
   * this path, so the real function can simply be called.
   */
  const LEAD_NO_ACREAGE = {
    id: 1,
    ownerName: "Dana Rivers",
    county: "Franklin",
    state: "OH",
    // no acres / acreage at all
  };

  it("a lead with no acreage yields NO offer, and the message quotes no price", async () => {
    const profile = await scoreLeadIntelligence(LEAD_NO_ACREAGE, { pasturePerAcre: 3000 });
    expect(profile.acres, "an acreage was invented").toBeNull();
    expect(profile.estimatedOfferPrice, "an offer was computed without an acreage").toBeNull();
    expect(profile.estimatedFlipPrice).toBeNull();
    expect(profile.estimatedOwnerFinanceMonthly).toBeNull();
    // The message reaches the property owner. It must not name a figure.
    expect(profile.recommendedMessage, "the outreach message quotes a price").not.toMatch(/\$[\d,]/);
    expect(profile.nextBestAction).toMatch(/establish the number before mailing/);
  });

  it("a county with no USDA value yields NO offer either — both inputs are required", async () => {
    const profile = await scoreLeadIntelligence(
      { ...LEAD_NO_ACREAGE, acres: "12" },
      undefined, // no NASS snapshot
    );
    expect(profile.acres).toBe(12);
    expect(profile.estimatedOfferPrice, "an offer was computed with no per-acre value").toBeNull();
    expect(profile.recommendedMessage).not.toMatch(/\$[\d,]/);
    expect(profile.countyContext.usdaLandValuePerAcre).toBeNull();
  });

  it("with BOTH inputs real, the offer is computed and quoted", async () => {
    // The other direction: a fix that simply stopped offering would pass every
    // assertion above. 3000 × 0.25 × 12 = 9,000.
    const profile = await scoreLeadIntelligence(
      { ...LEAD_NO_ACREAGE, acres: "12" },
      { pasturePerAcre: 3000 },
    );
    expect(profile.estimatedOfferPrice).toBe(9000);
    expect(profile.recommendedMessage).toMatch(/\$9,000/);
    expect(profile.countyContext.usdaLandValuePerAcre).toBe(3000);
  });

  it("the offer is null when either input is missing", () => {
    // The refusal must cover BOTH inputs — a guard on only one leaves the
    // other free to carry a constant into the offer.
    expect(src).toMatch(/offerPrice: null, flipPrice: null, ownerFinanceMonthly: null/);
    expect(src).toMatch(/acres === null/);
    expect(src).toMatch(/!Number\.isFinite\(usdaPerAcre\)/);
  });

  it("the outreach message has a variant that quotes no price", () => {
    expect(src).toMatch(/function hookWithoutPrice\(/);
    expect(src).toMatch(/if \(offerPrice === null\) return hookWithoutPrice\(/);
    // And that variant must not smuggle a number back in.
    const start = src.indexOf("function hookWithoutPrice(");
    const end = src.indexOf("function generateMessageHook(", start);
    const body = src.slice(start, end);
    expect(body.length, "the price-free variant is empty").toBeGreaterThan(500);
    expect(body, "the price-free message quotes a dollar figure").not.toMatch(/\$\$\{|\$\d/);
    expect(body).not.toMatch(/offerFmt/);
  });

  it("the operator's next-best-action does not name a price it does not have", () => {
    expect(src).toMatch(/offerPrice === null \? null :/);
    expect(src).toMatch(/establish the number before mailing/);
  });
});

describe("no campaign instruction is issued for an unscored county", () => {
  const src = code("server/services/parcelIntelligenceFusion.ts");

  it("vacuity guard: the ranking function is still here", () => {
    expect(src.length).toBeGreaterThan(5000);
    expect(src).toMatch(/opportunityScore/);
    expect(src).toMatch(/Test with 500 letters/);
  });

  it("the opportunity score is not defaulted", () => {
    expect(src, "the score default is back").not.toMatch(
      /opportunityScore\s*(\|\||\?\?)\s*\d/,
    );
  });

  it("an unscored county gets 'Not scored', not a spend instruction", () => {
    expect(src).toMatch(/score === null \? "Not scored/);
    // The branch must come FIRST, or a null score falls through the numeric
    // comparisons — where `null >= 70` is false but `null >= 35` is also
    // false, landing it on "Skip", which is itself a finding.
    const nullBranch = src.indexOf('score === null ? "Not scored');
    const spendBranch = src.indexOf('"Test with 500 letters"');
    expect(nullBranch).toBeGreaterThan(-1);
    expect(nullBranch).toBeLessThan(spendBranch);
  });

  it("an unscored county is not given a rank", () => {
    // `b.score - a.score` on a null yields NaN and leaves the sort undefined;
    // more importantly a county nobody scored must not hold a rank position.
    expect(src).toMatch(/typeof r\.score === "number"/);
    expect(src).toMatch(/rank: null/);
  });
});

describe("the blind offer's USDA basis is the field the pages actually render", () => {
  /**
   * `blindOfferCalculator.marketContext.usdaLandValuePerAcre` — NOT the
   * identically-named field on `leadIntelligenceEngine`'s profile. The first
   * version of this fix annotated the wrong one; `maps.tsx` and
   * `blind-offer-wizard.tsx` read THIS shape, and a source-only assertion let
   * a mutation restoring `|| 0` survive. So it is exercised.
   */
  async function offerFor(nass: { pasturePerAcre?: number } | null) {
    vi.resetModules();
    vi.doMock("../../server/services/usdaNassService", () => ({
      getCachedCountySnapshot: async () => nass,
      getCachedLandTrend: async () => null,
    }));
    const { calculateBlindOffer } = await import(
      "../../server/services/blindOfferCalculator"
    );
    return calculateBlindOffer({ state: "OH", county: "Franklin", targetAcres: 10 });
  }

  it("a county with no USDA snapshot reports a null land value, not $0/ac", async () => {
    const out = await offerFor(null);
    // `|| 0` rendered "Offer modeled from USDA land values ($0/ac)" — land
    // priced at nothing, presented as the basis for an offer.
    expect(out.marketContext.usdaLandValuePerAcre).toBeNull();
    expect(out.marketContext.usdaLandValuePerAcre).not.toBe(0);
  });

  it("a county WITH a USDA value still reports it", async () => {
    const out = await offerFor({ pasturePerAcre: 3400 });
    expect(out.marketContext.usdaLandValuePerAcre).toBe(3400);
  });
});

describe("a market health score of 50 is a finding, not a neutral", () => {
  const src = code("server/services/marketIntelligence.ts");

  it("the health score is not defaulted", () => {
    expect(src).not.toMatch(/marketHealthScore\s*\|\|\s*\d/);
    expect(src).toMatch(/marketHealthScore \?\? null/);
  });
});
