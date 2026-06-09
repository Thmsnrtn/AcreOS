import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Proves the deal feed wires the REAL acquisition-radar scorer (not the old
// hardcoded `{ score: 50 }` stub), and that a scorer error falls OPEN to the
// neutral default rather than crashing the feed.
//
// We mock acquisitionRadar so the test needs no DB / no paid lookups, then
// drive the real scoreParcelRadar wiring exported from dealFeedEngine.
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

  it("falls OPEN to neutral (50) when the scorer throws — feed does not crash", async () => {
    scoreParcelMock.mockRejectedValue(new Error("data-source broker exploded"));

    const score = await scoreParcelRadar(knownParcel, fakeConfig);

    expect(score).toBe(50);
    expect(scoreParcelMock).toHaveBeenCalledTimes(1);
  });

  it("falls OPEN to neutral (50) when no radar config is available", async () => {
    const score = await scoreParcelRadar(knownParcel, null);

    expect(score).toBe(50);
    // Scorer should not even be invoked without a config.
    expect(scoreParcelMock).not.toHaveBeenCalled();
  });

  it("falls OPEN to neutral when the scorer returns a non-finite score", async () => {
    scoreParcelMock.mockResolvedValue({ score: NaN });

    const score = await scoreParcelRadar(knownParcel, fakeConfig);

    expect(score).toBe(50);
  });
});
