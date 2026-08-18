import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Proves the deal feed wires the REAL acquisition-radar scorer (not the old
// hardcoded `{ score: 50 }` stub), and that a scorer failure DEGRADES rather
// than crashing the feed.
//
// 2026-08-18 — the three failure cases below used to assert `50`, the
// "neutral default" the scorer fell open to. That default was itself the
// defect: 50 entered the composite at FULL WEIGHT, so a parcel the radar could
// not score was ranked as an average parcel on a surface whose whole claim is
// "the ten best parcels we found". The pillar is now left unscored (null) and
// `computeComposite` renormalises over the pillars that did answer.
//
// The assertions are REWRITTEN, not deleted, because the invariant they were
// really protecting is not "the value is 50" — it is "a scorer failure does
// not throw, and does not invent a high score". Both still hold, and the third
// property (it does not invent an average one either) is new. The mock-call
// assertions are unchanged: they are what proves the real scorer is wired.
// ---------------------------------------------------------------------------

const scoreParcelMock = vi.fn();

vi.mock("../../server/services/acquisitionRadar", () => ({
  acquisitionRadar: {
    scoreParcel: (...args: any[]) => scoreParcelMock(...args),
  },
}));

// db is imported transitively by dealFeedEngine; stub it so the module loads.
vi.mock("../../server/db", () => ({ db: {} }));

import { scoreParcelRadar } from "../../server/services/dealFeedEngine";

const fakeConfig: any = {
  id: 1,
  organizationId: 42,
  name: "Default",
  isActive: true,
  weights: {
    priceVsAssessed: 25,
    daysOnMarket: 15,
    sellerMotivation: 20,
    marketVelocity: 15,
    comparableSpreads: 15,
    environmentalRisk: -10,
    ownerSignals: 20,
  },
  thresholds: {
    hotOpportunity: 80,
    goodOpportunity: 60,
    minimumScore: 40,
    maxDaysOnMarket: 365,
    minPriceDiscount: 10,
    maxFloodRisk: 50,
  },
};

const knownParcel = {
  apn: "123-456",
  county: "Hudspeth",
  state: "TX",
  latitude: 31.5,
  longitude: -105.3,
  listPrice: "5000",
  assessedValue: "12000",
  sizeAcres: "10",
};

describe("dealFeedEngine — real radar wiring", () => {
  beforeEach(() => {
    scoreParcelMock.mockReset();
  });

  it("uses the REAL scorer's score (not the hardcoded 50) for a known parcel + known config", async () => {
    // Known weights + known parcel → scorer returns 87 (anything != 50 proves
    // the feed reads the real result rather than the old stub default).
    scoreParcelMock.mockResolvedValue({ score: 87, opportunityType: "undervalued", factors: {}, explanation: "", dataSources: [] });

    const score = await scoreParcelRadar(knownParcel, fakeConfig);

    expect(score).toBe(87);
    expect(score).not.toBe(50);
    // Scorer was called with the mapped ParcelData shape + the org's config.
    expect(scoreParcelMock).toHaveBeenCalledTimes(1);
    const [passedParcel, passedConfig] = scoreParcelMock.mock.calls[0];
    expect(passedParcel).toMatchObject({
      apn: "123-456",
      county: "Hudspeth",
      state: "TX",
      latitude: 31.5,
      longitude: -105.3,
      listPrice: 5000,        // string → number
      assessedValue: 12000,   // string → number
      acreage: 10,            // sizeAcres string → number
    });
    expect(passedConfig).toBe(fakeConfig);
  });

  it("leaves the pillar UNSCORED when the scorer throws — feed does not crash", async () => {
    scoreParcelMock.mockRejectedValue(new Error("data-source broker exploded"));

    const score = await scoreParcelRadar(knownParcel, fakeConfig);

    // Original invariant: it does not throw, and it does not invent a high
    // score. Both preserved. New: it does not invent an average one either.
    expect(score).toBeNull();
    expect(score).not.toBe(50);
    expect(scoreParcelMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the pillar UNSCORED when no radar config is available", async () => {
    const score = await scoreParcelRadar(knownParcel, null);

    expect(score).toBeNull();
    expect(score).not.toBe(50);
    // Scorer should not even be invoked without a config.
    expect(scoreParcelMock).not.toHaveBeenCalled();
  });

  it("leaves the pillar UNSCORED when the scorer returns a non-finite score", async () => {
    scoreParcelMock.mockResolvedValue({ score: NaN });

    const score = await scoreParcelRadar(knownParcel, fakeConfig);

    // NaN is the sharpest case: it is neither a score nor an absence until
    // something decides. Coercing it to 50 decided "average".
    expect(score).toBeNull();
    expect(score).not.toBe(50);
  });

  it("a real score of exactly 50 is still a SCORE, not an absence", async () => {
    // The old contract could not distinguish "the radar scored this parcel 50"
    // from "the radar could not score this parcel". This is the case that
    // proves the new one can.
    scoreParcelMock.mockResolvedValue({ score: 50 });

    const score = await scoreParcelRadar(knownParcel, fakeConfig);

    expect(score).toBe(50);
    expect(score).not.toBeNull();
  });
});
