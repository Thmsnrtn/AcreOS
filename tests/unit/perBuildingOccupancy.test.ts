/**
 * PER-BUILDING OCCUPANCY (Wave 3, multifamily → core, stage 4).
 *
 * WHAT CHANGED
 * ------------
 * `GET /api/rent-roll/occupancy` reported ONE org-wide ratio, which averages
 * every building into a single number and hides the specific failure this
 * vertical exists to surface: a building with no rentable stock is diluted away
 * inside a portfolio-wide percentage instead of reading `measurable:false` on
 * its own. The endpoint now ALSO returns a `byProperty` array — the same
 * semi-join GROUPed BY property, each group run through the SAME pure
 * computeOccupancySnapshot with propertyCount 1 — and snapshotForProperty
 * returns a per-building `occupancy` block the analytics table renders.
 *
 * WHAT THIS FILE PINS
 * -------------------
 *   1. computeOccupancySnapshot, reused PER building, reports each building on
 *      its own: a full one, a half-empty one, and an all-offline one that is
 *      measurable:false per building rather than averaged away.
 *   2. The org-wide aggregate still holds — adding byProperty did not change it.
 *   3. WIRING (source): the endpoint groups by property and maps each group
 *      through computeOccupancySnapshot, keeps the org-wide aggregate at the top
 *      level (backward compatible), and snapshotForProperty returns an occupancy
 *      block for its single property.
 *
 * computeOccupancySnapshot is pure and exported, so the arithmetic is a test
 * rather than a database fixture (there is no DATABASE_URL here).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  computeOccupancySnapshot,
  type OccupancyUnitFacts,
} from "../../server/routes-rentals";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

/** One building's facts. propertyCount 1 — this is a single building, not the org. */
function building(over: Partial<OccupancyUnitFacts> = {}): OccupancyUnitFacts {
  return {
    rentableUnits: 4,
    occupiedUnits: 4,
    offlineUnits: 0,
    retiredUnits: 0,
    vacantUnitsWithMarketRent: 0,
    vacantMarketRentMonthlyCents: 0,
    propertyCount: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Each building reports on its own — the whole point of byProperty.
// ---------------------------------------------------------------------------

describe("computeOccupancySnapshot, reused per building", () => {
  it("a full building and a half-empty building each report correctly", () => {
    const full = computeOccupancySnapshot(building({ rentableUnits: 4, occupiedUnits: 4 }));
    const half = computeOccupancySnapshot(building({ rentableUnits: 4, occupiedUnits: 2 }));

    if (!full.measurable) throw new Error("expected full building measurable");
    expect(full.occupancyPct).toBe(100);
    expect(full.vacantUnits).toBe(0);

    if (!half.measurable) throw new Error("expected half building measurable");
    expect(half.occupancyPct).toBe(50);
    expect(half.vacantUnits).toBe(2);
  });

  it("an all-offline building is measurable:false PER BUILDING, not averaged away", () => {
    // Three units down for renovation, nothing rentable. Inside an org-wide
    // average this building simply adds 0 to both sides and vanishes; on its own
    // it must say, explicitly, that there is no rentable stock to measure over.
    const offline = computeOccupancySnapshot(building({ rentableUnits: 0, occupiedUnits: 0, offlineUnits: 3 }));
    expect(offline.measurable).toBe(false);
    if (offline.measurable) throw new Error("expected unmeasurable");
    expect(offline.reason).toBe("no_rentable_units");
    expect(offline.occupancyPct).toBeNull();
  });

  it("a building with no units modelled is a DIFFERENT unmeasurable reason", () => {
    const bare = computeOccupancySnapshot(building({ rentableUnits: 0, occupiedUnits: 0 }));
    if (bare.measurable) throw new Error("expected unmeasurable");
    expect(bare.reason).toBe("no_units_modelled");
  });
});

// ---------------------------------------------------------------------------
// 2. The org-wide aggregate still holds.
// ---------------------------------------------------------------------------

describe("the org-wide aggregate is unchanged by byProperty", () => {
  it("aggregates all rentable stock into one honest ratio", () => {
    // Building A 4/4, building B 4/2, building C all-offline (0 rentable). The
    // org-wide read sums rentable = 8, occupied = 6 → 75%; C neither dilutes the
    // ratio nor disappears — its offline units are reported separately.
    const orgWide = computeOccupancySnapshot({
      rentableUnits: 8,
      occupiedUnits: 6,
      offlineUnits: 3,
      retiredUnits: 0,
      vacantUnitsWithMarketRent: 0,
      vacantMarketRentMonthlyCents: 0,
      propertyCount: 3,
    });
    if (!orgWide.measurable) throw new Error("expected measurable");
    expect(orgWide.occupancyPct).toBe(75);
    expect(orgWide.vacantUnits).toBe(2);
    expect(orgWide.offlineUnits).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Wiring — the endpoint adds byProperty; snapshotForProperty adds occupancy.
// ---------------------------------------------------------------------------

describe("the occupancy endpoint returns a byProperty array", () => {
  const RENTALS = read("server/routes-rentals.ts");

  it("adds a GROUP BY property_id query alongside the org-wide aggregate", () => {
    expect(RENTALS).toMatch(/GROUP BY u\.property_id/);
  });

  it("maps each group through the SAME computeOccupancySnapshot, propertyCount 1", () => {
    expect(RENTALS).toContain("byProperty");
    expect(RENTALS).toMatch(/propertyId: toCount\(r\.property_id\)/);
    expect(RENTALS).toMatch(/computeOccupancySnapshot\(\{[\s\S]*?propertyCount: 1/);
  });

  it("keeps the org-wide aggregate at the top level (backward compatible)", () => {
    // Spreading the org-wide snapshot keeps every existing field exactly where
    // it was — a client reading occupancyPct off the top level is untouched.
    expect(RENTALS).toMatch(/\{ \.\.\.snapshot, byProperty \}/);
  });
});

describe("snapshotForProperty returns a per-building occupancy block", () => {
  const INV = read("server/routes-investor-analytics.ts");

  it("computes occupancy via computeOccupancySnapshot for its single property", () => {
    expect(INV).toContain("computeOccupancySnapshot({");
    expect(INV).toMatch(/propertyCount: 1,/);
    // …and returns it on the payload.
    expect(INV).toMatch(/\n\s*occupancy,\n/);
  });
});
