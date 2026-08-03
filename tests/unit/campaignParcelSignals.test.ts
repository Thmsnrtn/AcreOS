import { describe, it, expect } from "vitest";
import {
  parseOrgScreeningRules,
  enrichmentToSignals,
} from "../../server/services/campaignParcelSignals";

/**
 * Wiring of pre-spend screening into campaigns (charter §7.2, part A). Screening
 * is OFF unless the org set rules, and reads signals defensively from the one
 * real cached source (properties.enrichmentData.hazards). These pin the two
 * pure edges of that wiring.
 */
describe("parseOrgScreeningRules — off by default", () => {
  it("returns no rules for empty/absent settings", () => {
    expect(parseOrgScreeningRules(undefined)).toEqual({});
    expect(parseOrgScreeningRules(null)).toEqual({});
    expect(parseOrgScreeningRules({})).toEqual({});
    expect(parseOrgScreeningRules({ parcelScreening: {} })).toEqual({});
    expect(parseOrgScreeningRules({ parcelScreening: { floodZones: [] } })).toEqual({});
  });

  it("passes through configured rules, dropping malformed values", () => {
    const rules = parseOrgScreeningRules({
      parcelScreening: {
        floodZones: ["VE", "AE"],
        maxWetlandsPercent: 60,
        excludeLandlocked: true,
        maxSlopePercent: 30,
      },
    });
    expect(rules).toEqual({
      floodZones: ["VE", "AE"],
      maxWetlandsPercent: 60,
      excludeLandlocked: true,
      maxSlopePercent: 30,
    });
  });

  it("ignores non-string flood zones and non-boolean landlocked", () => {
    const rules = parseOrgScreeningRules({
      parcelScreening: { floodZones: ["VE", 5 as unknown as string], excludeLandlocked: "yes" as unknown as boolean },
    });
    expect(rules.floodZones).toEqual(["VE"]);
    expect(rules.excludeLandlocked).toBeUndefined();
  });
});

describe("enrichmentToSignals — defensive mapping", () => {
  it("maps hazards.floodZone and wetlandsPercentage", () => {
    expect(enrichmentToSignals({ hazards: { floodZone: "VE", wetlandsPercentage: 42 } })).toEqual({
      floodZone: "VE",
      wetlandsPercentage: 42,
    });
  });

  it("returns empty signals for missing/garbage enrichment (fail-open)", () => {
    expect(enrichmentToSignals(null)).toEqual({});
    expect(enrichmentToSignals({})).toEqual({});
    expect(enrichmentToSignals({ hazards: {} })).toEqual({});
    expect(enrichmentToSignals({ hazards: { floodZone: 5, wetlandsPercentage: "hi" } })).toEqual({});
    expect(enrichmentToSignals("nonsense")).toEqual({});
  });
});
