/**
 * Tests for the paid-data eval harness (Iyari #6 / Lena #3).
 *
 * Covers the two metric definitions the buy-decision hinges on:
 *   1. Field divergence math — eligible / divergent / fill / numeric tolerance
 *      / mean abs %diff.
 *   2. Decision-flip detection — recommendation-bucket flips + deal-killer
 *      flips (flood AE appearing/clearing, dominant wetlands, landlocked).
 *
 * Everything runs against the MockPaidProvider — no DB, no network, no spend.
 */

import { describe, it, expect } from "vitest";
import {
  compareField,
  relDiff,
  deriveDecision,
  recommendationToBucket,
  evaluateCorpus,
  factsFromReportRow,
  mergePaid,
  type ParcelFacts,
  type DecisionBucket,
} from "../../server/services/paidDataEvalHarness";
import { MockPaidProvider, RegridPaidProvider } from "../../server/services/paidDataProviders";

function facts(partial: Partial<ParcelFacts> & { parcelKey: string }): ParcelFacts {
  return {
    apn: null,
    state: "AZ",
    county: "Cochise",
    latitude: 31.5,
    longitude: -109.7,
    acres: 40,
    assessedValue: null,
    ownerName: null,
    floodZone: null,
    wetlandPercent: null,
    hasRoadAccess: null,
    ...partial,
  };
}

// ─── relDiff ────────────────────────────────────────────────────────────────

describe("relDiff", () => {
  it("is 0 for equal values", () => {
    expect(relDiff(100, 100)).toBe(0);
  });
  it("computes relative difference against the larger magnitude", () => {
    expect(relDiff(100, 130)).toBeCloseTo(0.2307, 3); // 30/130
  });
  it("does not divide by zero when both are 0", () => {
    expect(relDiff(0, 0)).toBe(0);
  });
});

// ─── compareField ───────────────────────────────────────────────────────────

describe("compareField", () => {
  it("numeric drift within tolerance is NOT divergent", () => {
    const r = compareField("acres", 40, 41); // 2.4% < 5% tol
    expect(r.eligible).toBe(true);
    expect(r.divergent).toBe(false);
    expect(r.absPctDiff).toBeNull();
  });

  it("numeric drift beyond tolerance IS divergent and reports magnitude", () => {
    const r = compareField("assessedValue", 100_000, 130_000); // 23% > 5% tol
    expect(r.eligible).toBe(true);
    expect(r.divergent).toBe(true);
    expect(r.absPctDiff).toBeCloseTo(0.2307, 3);
  });

  it("paid missing → not eligible, not a fill", () => {
    const r = compareField("ownerName", "ACME LLC", null);
    expect(r.eligible).toBe(false);
    expect(r.fill).toBe(false);
    expect(r.divergent).toBe(false);
  });

  it("free missing + paid present → a fill, not a divergence", () => {
    const r = compareField("ownerName", null, "ACME LLC");
    expect(r.eligible).toBe(false);
    expect(r.fill).toBe(true);
    expect(r.divergent).toBe(false);
  });

  it("categorical compares case/space-insensitively", () => {
    expect(compareField("floodZone", "ae", " AE ").divergent).toBe(false);
    expect(compareField("floodZone", "X", "AE").divergent).toBe(true);
  });

  it("boolean strict mismatch is divergent", () => {
    expect(compareField("hasRoadAccess", true, false).divergent).toBe(true);
    expect(compareField("hasRoadAccess", true, true).divergent).toBe(false);
  });
});

// ─── recommendationToBucket ─────────────────────────────────────────────────

describe("recommendationToBucket", () => {
  it("maps the fusion enum to 3 buckets", () => {
    expect(recommendationToBucket("buy_aggressively")).toBe("buy");
    expect(recommendationToBucket("buy_selectively")).toBe("buy");
    expect(recommendationToBucket("conduct_due_diligence")).toBe("caution");
    expect(recommendationToBucket("pass")).toBe("no_buy");
    expect(recommendationToBucket("dealbreaker")).toBe("no_buy");
    expect(recommendationToBucket(null)).toBe("caution");
    expect(recommendationToBucket("garbage")).toBe("caution");
  });
});

// ─── deriveDecision (deal-killer rules) ─────────────────────────────────────

describe("deriveDecision", () => {
  it("flood AE forces no_buy + dealbreaker", () => {
    const d = deriveDecision(facts({ parcelKey: "p", floodZone: "AE" }), "buy");
    expect(d.bucket).toBe("no_buy");
    expect(d.hasDealbreaker).toBe(true);
  });

  it("benign flood zone preserves the baseline", () => {
    const d = deriveDecision(facts({ parcelKey: "p", floodZone: "X" }), "buy");
    expect(d.bucket).toBe("buy");
    expect(d.hasDealbreaker).toBe(false);
  });

  it("wetlands > 75% is a dealbreaker; 50-75 caps a buy to caution", () => {
    expect(deriveDecision(facts({ parcelKey: "p", wetlandPercent: 80 }), "buy").hasDealbreaker).toBe(true);
    const mid = deriveDecision(facts({ parcelKey: "p", wetlandPercent: 60 }), "buy");
    expect(mid.bucket).toBe("caution");
    expect(mid.hasDealbreaker).toBe(false);
  });

  it("no road access downgrades a buy to caution", () => {
    expect(deriveDecision(facts({ parcelKey: "p", hasRoadAccess: false }), "buy").bucket).toBe("caution");
  });

  it("a no_buy baseline floors the bucket but does NOT inherit a dealbreaker flag", () => {
    // The bucket is floored at the baseline (no_buy reflects non-compared
    // fields), but hasDealbreaker is derived solely from the compared-field
    // rules — so a paid correction of a compared field can clear it.
    const d = deriveDecision(facts({ parcelKey: "p" }), "no_buy");
    expect(d.bucket).toBe("no_buy");
    expect(d.hasDealbreaker).toBe(false);
  });
});

// ─── mergePaid ──────────────────────────────────────────────────────────────

describe("mergePaid", () => {
  it("paid values win where present; free retained where paid is null", () => {
    const free = facts({ parcelKey: "p", floodZone: "X", acres: 40 });
    const merged = mergePaid(free, { floodZone: "AE" });
    expect(merged.floodZone).toBe("AE");
    expect(merged.acres).toBe(40);
  });
});

// ─── factsFromReportRow ─────────────────────────────────────────────────────

describe("factsFromReportRow", () => {
  it("lifts the narrow projection out of the persisted report JSON", () => {
    const f = factsFromReportRow({
      parcelKey: "key1",
      apn: "123-45-678",
      state: "AZ",
      county: "Cochise",
      latitude: "31.5",
      longitude: "-109.7",
      acres: "40",
      report: {
        ownerName: "ACME LLC",
        dueDiligence: {
          floodZone: { zone: "AE" },
          wetlands: { percent: 12 },
          roadAccess: { hasAccess: true },
        },
      },
    });
    expect(f.apn).toBe("123-45-678");
    expect(f.acres).toBe(40);
    expect(f.floodZone).toBe("AE");
    expect(f.wetlandPercent).toBe(12);
    expect(f.hasRoadAccess).toBe(true);
    expect(f.ownerName).toBe("ACME LLC");
  });

  it("is null-safe against a partial / empty report", () => {
    const f = factsFromReportRow({
      parcelKey: "key2",
      apn: null,
      state: "TX",
      county: "Travis",
      latitude: null,
      longitude: null,
      acres: null,
      report: {},
    });
    expect(f.floodZone).toBeNull();
    expect(f.wetlandPercent).toBeNull();
    expect(f.hasRoadAccess).toBeNull();
    expect(f.acres).toBeNull();
  });
});

// ─── evaluateCorpus — divergence aggregation ────────────────────────────────

describe("evaluateCorpus — field divergence", () => {
  it("never flips and only drifts within tolerance when mock fully agrees", async () => {
    // flipPropensity 0 + assessedDrift 0 + free has its own assessed value →
    // acres drift is within ±2% (tolerance 5%), so zero divergence everywhere.
    const provider = new MockPaidProvider({ flipPropensity: 0, assessedDrift: 0 });
    const corpus = Array.from({ length: 20 }, (_, i) => ({
      facts: facts({
        parcelKey: `p${i}`,
        floodZone: "X",
        assessedValue: 50_000,
        wetlandPercent: 5,
        hasRoadAccess: true,
        ownerName: "OWNER",
      }),
      baselineBucket: "buy" as DecisionBucket,
    }));
    const res = await evaluateCorpus({ provider, mode: "sample", corpus });
    expect(res.parcelsCompared).toBe(20);
    expect(res.decisionFlipCount).toBe(0);
    const flood = res.fieldDivergence.find((f) => f.field === "floodZone")!;
    expect(flood.divergent).toBe(0);
    const acres = res.fieldDivergence.find((f) => f.field === "acres")!;
    expect(acres.divergent).toBe(0); // within tolerance
  });

  it("assessed-value drift beyond tolerance registers as divergent with magnitude", async () => {
    const provider = new MockPaidProvider({ flipPropensity: 0, assessedDrift: 0.3 });
    const corpus = Array.from({ length: 10 }, (_, i) => ({
      facts: facts({ parcelKey: `p${i}`, floodZone: "X", assessedValue: 100_000 }),
      baselineBucket: "buy" as DecisionBucket,
    }));
    const res = await evaluateCorpus({ provider, mode: "sample", corpus });
    const av = res.fieldDivergence.find((f) => f.field === "assessedValue")!;
    expect(av.eligible).toBe(10);
    expect(av.divergent).toBe(10); // 30% > 5% tol on every parcel
    expect(av.divergenceRate).toBe(1);
    expect(av.meanAbsPctDiff).toBeCloseTo(0.2307, 3); // relDiff(100k, 130k)
  });

  it("counts fills when free is missing a field the paid source supplies", async () => {
    // free.assessedValue null on all → mock fills every one.
    const provider = new MockPaidProvider({ flipPropensity: 0, ownerFillRate: 1 });
    const corpus = Array.from({ length: 8 }, (_, i) => ({
      facts: facts({ parcelKey: `p${i}`, floodZone: "X", assessedValue: null, ownerName: null }),
      baselineBucket: "buy" as DecisionBucket,
    }));
    const res = await evaluateCorpus({ provider, mode: "sample", corpus });
    const av = res.fieldDivergence.find((f) => f.field === "assessedValue")!;
    expect(av.fillCount).toBe(8);
    expect(av.fillRate).toBe(1);
    expect(av.eligible).toBe(0); // free never had it → nothing to diverge on
    const owner = res.fieldDivergence.find((f) => f.field === "ownerName")!;
    expect(owner.fillCount).toBe(8); // ownerFillRate 1
  });
});

// ─── evaluateCorpus — decision-flip detection ───────────────────────────────

describe("evaluateCorpus — decision flips", () => {
  it("flips every parcel from buy to no_buy when paid corrects flood to AE", async () => {
    const provider = new MockPaidProvider({ flipPropensity: 1, assessedDrift: 0 });
    const corpus = Array.from({ length: 12 }, (_, i) => ({
      facts: facts({ parcelKey: `p${i}`, floodZone: "X", assessedValue: 50_000 }),
      baselineBucket: "buy" as DecisionBucket,
    }));
    const res = await evaluateCorpus({ provider, mode: "sample", corpus });
    expect(res.decisionFlipCount).toBe(12);
    expect(res.decisionFlipRate).toBe(1);
    for (const flip of res.decisionFlips) {
      expect(flip.freeBucket).toBe("buy");
      expect(flip.paidBucket).toBe("no_buy");
      expect(flip.dealKillerFlip).toBe(true);
      expect(flip.divergentFields).toContain("floodZone");
    }
    // flood field should be attributed every flip → top of the value ranking.
    expect(res.fieldDivergence[0].field).toBe("floodZone");
    expect(res.fieldDivergence[0].flipsParticipated).toBe(12);
  });

  it("flips can CLEAR a deal-killer (free AE → paid X)", async () => {
    const provider = new MockPaidProvider({ flipPropensity: 1, assessedDrift: 0 });
    const corpus = [
      {
        // Free flagged AE (a deal-killer); paid corrects to X.
        facts: facts({ parcelKey: "clear-1", floodZone: "AE", assessedValue: 50_000 }),
        baselineBucket: "no_buy" as DecisionBucket,
      },
    ];
    const res = await evaluateCorpus({ provider, mode: "sample", corpus });
    expect(res.decisionFlipCount).toBe(1);
    const flip = res.decisionFlips[0];
    expect(flip.freeBucket).toBe("no_buy");
    expect(flip.dealKillerFlip).toBe(true);
    expect(flip.reason).toMatch(/cleared a deal-killer/i);
  });

  it("reports zero flips + a 'free already covers it' recommendation when mock agrees", async () => {
    const provider = new MockPaidProvider({ flipPropensity: 0, assessedDrift: 0 });
    const corpus = Array.from({ length: 5 }, (_, i) => ({
      facts: facts({ parcelKey: `p${i}`, floodZone: "X", assessedValue: 50_000 }),
      baselineBucket: "buy" as DecisionBucket,
    }));
    const res = await evaluateCorpus({ provider, mode: "sample", corpus });
    expect(res.decisionFlipCount).toBe(0);
    expect(res.recommendation).toMatch(/free data already covers/i);
  });

  it("projects trial cost = parcels compared × per-parcel cost", async () => {
    const provider = new MockPaidProvider({ flipPropensity: 0, estCostCents: 8 });
    const corpus = Array.from({ length: 25 }, (_, i) => ({
      facts: facts({ parcelKey: `p${i}`, floodZone: "X" }),
      baselineBucket: "buy" as DecisionBucket,
    }));
    const res = await evaluateCorpus({ provider, mode: "trial", corpus });
    expect(res.estTrialCostCents).toBe(25 * 8);
    expect(res.mode).toBe("trial");
  });

  it("counts provider errors and excludes failed parcels from the denominator", async () => {
    const throwing = new RegridPaidProvider("not-a-real-key", 8); // lookup() throws
    const corpus = Array.from({ length: 4 }, (_, i) => ({
      facts: facts({ parcelKey: `p${i}`, floodZone: "X" }),
      baselineBucket: "buy" as DecisionBucket,
    }));
    const res = await evaluateCorpus({ provider: throwing, mode: "trial", corpus });
    expect(res.errors).toBe(4);
    expect(res.parcelsCompared).toBe(0);
    expect(res.decisionFlipRate).toBe(0); // guarded against /0
    expect(res.estTrialCostCents).toBe(0);
  });
});

// ─── determinism ────────────────────────────────────────────────────────────

describe("MockPaidProvider determinism", () => {
  it("yields the same paid view for the same parcelKey across runs", async () => {
    const a = new MockPaidProvider({ flipPropensity: 0.5 });
    const b = new MockPaidProvider({ flipPropensity: 0.5 });
    const f = facts({ parcelKey: "stable-key", floodZone: "X", assessedValue: 60_000 });
    expect(await a.lookup(f)).toEqual(await b.lookup(f));
  });
});
