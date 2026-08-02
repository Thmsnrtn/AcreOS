import { describe, it, expect } from "vitest";
import { computeConfidence, computeSimilarity } from "../../server/services/acreOSValuation";

/**
 * Phase 2 valuation-honesty guards (audit critique #12 — Staff Appraiser;
 * charter §5.5 provenance / INV-TRUTH-1). The AVM used to fabricate a comp
 * distance of 0 (auto-awarding a +15 "nearest comp within 5 miles" confidence
 * bonus every run) and to hand a +30 zip-similarity bonus off two empty strings.
 */
describe("computeConfidence — no fabricated proximity bonus", () => {
  it("awards NO proximity bonus when the nearest distance is unknown (null)", () => {
    const withUnknown = computeConfidence(5, null, 0.2);
    const withReal20mi = computeConfidence(5, 20, 0.2); // 20mi → also no bonus (>15 <30 = +5)
    // Unknown must never score higher than a genuinely-distant comp; specifically
    // it must NOT get the <5mi +15 that the fabricated 0 used to grant.
    const withFakeZero = computeConfidence(5, 0, 0.2);
    expect(withFakeZero).toBeGreaterThan(withUnknown); // a real 0 would earn +15
    expect(withUnknown).toBeLessThanOrEqual(withReal20mi + 5);
  });

  it("still rewards a genuinely close comp when distance IS known", () => {
    expect(computeConfidence(5, 3, 0.2)).toBeGreaterThan(computeConfidence(5, 40, 0.2));
  });

  it("stays within [10, 95]", () => {
    expect(computeConfidence(0, null, 0.9)).toBeGreaterThanOrEqual(10);
    expect(computeConfidence(50, 1, 0.01)).toBeLessThanOrEqual(95);
  });
});

describe("computeSimilarity — no spurious empty-zip bonus", () => {
  const subj = { county: "Polk", state: "FL", zipCode: "" };

  it("does NOT award the zip bonus when both zips are empty", () => {
    const bothEmpty = computeSimilarity(10, subj, 10, { county: "Polk", state: "FL", zipCode: "" });
    // Identical acreage (40) + same county (30) = 70; the empty-zip pair must
    // NOT add the +30 it used to via '' === ''.
    expect(bothEmpty).toBe(70);
  });

  it("awards the zip bonus only when both zips are known and equal", () => {
    const known = { county: "Polk", state: "FL", zipCode: "33801" };
    expect(computeSimilarity(10, known, 10, { county: "Polk", state: "FL", zipCode: "33801" })).toBe(100);
    expect(computeSimilarity(10, known, 10, { county: "Polk", state: "FL", zipCode: "33805" })).toBe(70);
  });

  it("same-state-different-county earns 15, not 30", () => {
    const s = computeSimilarity(10, subj, 10, { county: "Lee", state: "FL", zipCode: "" });
    expect(s).toBe(55); // 40 acreage + 15 state
  });
});
