import { describe, it, expect } from "vitest";
import {
  screenParcel,
  screenParcels,
  hasActiveRules,
  computeSpendSavedCents,
  type DisqualifierRules,
} from "../../server/services/parcelScreening";

/**
 * Pre-spend parcel-quality screening (charter §7.2). The two invariants that
 * make this safe: OFF by default (no rules → nothing disqualified) and
 * FAIL-OPEN (a missing signal never disqualifies — bad data can only let mail
 * through, never silently suppress a lead the investor wanted).
 */
const FLOOD_RULES: DisqualifierRules = {
  floodZones: ["VE", "AE"],
  maxWetlandsPercent: 60,
  excludeLandlocked: true,
  maxSlopePercent: 30,
};

describe("screenParcel", () => {
  it("disqualifies on a banned flood zone (case-insensitive)", () => {
    expect(screenParcel({ floodZone: "ve" }, FLOOD_RULES).disqualified).toBe(true);
    expect(screenParcel({ floodZone: "X" }, FLOOD_RULES).disqualified).toBe(false);
  });

  it("disqualifies at/above the wetlands and slope thresholds", () => {
    expect(screenParcel({ wetlandsPercentage: 60 }, FLOOD_RULES).disqualified).toBe(true);
    expect(screenParcel({ wetlandsPercentage: 59 }, FLOOD_RULES).disqualified).toBe(false);
    expect(screenParcel({ slopePercent: 45 }, FLOOD_RULES).disqualified).toBe(true);
  });

  it("disqualifies landlocked only when explicitly true", () => {
    expect(screenParcel({ landlocked: true }, FLOOD_RULES).disqualified).toBe(true);
    expect(screenParcel({ landlocked: false }, FLOOD_RULES).disqualified).toBe(false);
    expect(screenParcel({ landlocked: null }, FLOOD_RULES).disqualified).toBe(false);
  });

  it("FAIL-OPEN: missing/unknown signals never disqualify", () => {
    expect(screenParcel({}, FLOOD_RULES).disqualified).toBe(false);
    expect(screenParcel({ floodZone: null, wetlandsPercentage: null, slopePercent: null }, FLOOD_RULES).disqualified).toBe(false);
  });

  it("returns categorized reasons", () => {
    const r = screenParcel({ floodZone: "VE", landlocked: true }, FLOOD_RULES);
    expect(r.reasons.map((x) => x.category).sort()).toEqual(["flood", "landlocked"]);
  });
});

describe("hasActiveRules / OFF by default", () => {
  it("is false for empty rules and true when any rule is set", () => {
    expect(hasActiveRules({})).toBe(false);
    expect(hasActiveRules({ floodZones: [] })).toBe(false);
    expect(hasActiveRules({ excludeLandlocked: true })).toBe(true);
    expect(hasActiveRules({ maxWetlandsPercent: 50 })).toBe(true);
  });
});

describe("screenParcels + spend-saved metric", () => {
  const items = [
    { id: 1, signals: { floodZone: "VE" } },
    { id: 2, signals: { floodZone: "X" } },
    { id: 3, signals: {} }, // unknown → kept (fail-open)
    { id: 4, signals: { landlocked: true } },
  ];

  it("disqualifies nothing and saves nothing when rules are off", () => {
    const r = screenParcels(items, {}, 75);
    expect(r.disqualified).toEqual([]);
    expect(r.keptIds).toEqual([1, 2, 3, 4]);
    expect(r.spendSavedCents).toBe(0);
  });

  it("disqualifies matching parcels and reports spend saved = count × cost", () => {
    const r = screenParcels(items, FLOOD_RULES, 75); // 75¢/piece
    expect(r.disqualified.map((d) => d.id).sort()).toEqual([1, 4]);
    expect(r.keptIds.sort()).toEqual([2, 3]);
    expect(r.byCategory.flood).toBe(1);
    expect(r.byCategory.landlocked).toBe(1);
    expect(r.spendSavedCents).toBe(150); // 2 × 75¢
  });

  it("computeSpendSavedCents clamps negatives to 0 and rounds", () => {
    expect(computeSpendSavedCents(3, 79)).toBe(237);
    expect(computeSpendSavedCents(-1, 79)).toBe(0);
    expect(computeSpendSavedCents(2, -5)).toBe(0);
  });
});
