/**
 * Terrain math tests — PURE, no network, no DB.
 *
 * The terrain service separates the EPQS fetching from the slope/aspect
 * math precisely so this file can verify the math against canned elevation
 * grids: flat ground, known inclines (slope % + real gradient azimuth),
 * the EPQS -1000000 no-data sentinel, and the honesty threshold (fewer
 * than MIN_VALID_POINTS real points → reasoned failure, never a slope
 * extrapolated from 1–2 points).
 */

import { describe, it, expect } from "vitest";
import {
  buildSamplePlan,
  deriveTerrainMetrics,
  classifySlopeBand,
  compassLabel,
  formatSlopeValue,
  EPQS_NO_DATA,
  MIN_VALID_POINTS,
  type TerrainPoint,
  type TerrainSummary,
} from "../../server/services/terrain";

/** Build a 3×3 grid at ±r with z = f(x, y). */
function grid9(r: number, f: (x: number, y: number) => number | null): TerrainPoint[] {
  const pts: TerrainPoint[] = [];
  for (const y of [r, 0, -r]) {
    for (const x of [-r, 0, r]) {
      pts.push({ xMeters: x, yMeters: y, elevationMeters: f(x, y) });
    }
  }
  return pts;
}

describe("buildSamplePlan — sampling geometry", () => {
  it("unknown acreage → conservative 5-point cross at 60 m", () => {
    const plan = buildSamplePlan(null);
    expect(plan.pattern).toBe("cross5");
    expect(plan.offsets).toHaveLength(5);
    expect(plan.spacingMeters).toBe(60);
    // Contains the centroid + four cardinal offsets.
    expect(plan.offsets).toContainEqual({ xMeters: 0, yMeters: 0 });
    expect(plan.offsets).toContainEqual({ xMeters: 0, yMeters: 60 });
    expect(plan.offsets).toContainEqual({ xMeters: -60, yMeters: 0 });
  });

  it("small parcel (1 acre) → cross with the 30 m floor", () => {
    const plan = buildSamplePlan(1);
    expect(plan.pattern).toBe("cross5");
    // side = sqrt(4046.86) ≈ 63.6 m; side/3 ≈ 21.2 → clamped up to 30.
    expect(plan.spacingMeters).toBe(30);
  });

  it("10 acres → 9-point 3×3 grid scaled to the parcel", () => {
    const plan = buildSamplePlan(10);
    expect(plan.pattern).toBe("grid9");
    expect(plan.offsets).toHaveLength(9);
    // side = sqrt(10 · 4046.8564) ≈ 201.2 m; r = side/3 ≈ 67.05 m.
    expect(plan.spacingMeters).toBeCloseTo(67.05, 0);
    expect(plan.offsets).toContainEqual({ xMeters: 0, yMeters: 0 });
  });

  it("huge parcel (640 acres) → spacing capped at 500 m", () => {
    const plan = buildSamplePlan(640);
    expect(plan.pattern).toBe("grid9");
    expect(plan.spacingMeters).toBe(500);
  });
});

describe("deriveTerrainMetrics — canned grids", () => {
  it("flat grid → ~0% slope, no aspect (flat ground has none)", () => {
    const res = deriveTerrainMetrics(grid9(100, () => 250));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.derivation.meanSlopePercent).toBe(0);
    expect(res.derivation.maxSlopePercent).toBe(0);
    expect(res.derivation.aspectDegrees).toBeNull();
    expect(res.derivation.aspectCompass).toBeNull();
    expect(res.derivation.elevationMaxMeters - res.derivation.elevationMinMeters).toBe(0);
    expect(res.derivation.validPoints).toBe(9);
  });

  it("5% east-rising incline → 5% slope, west-facing (270°) aspect", () => {
    // z = 0.05·x: rises to the east, so the slope FACES west (downhill).
    const res = deriveTerrainMetrics(grid9(100, (x) => 100 + 0.05 * x));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.derivation.meanSlopePercent).toBeCloseTo(5.0, 1);
    // Steepest sampled grade is along the x axis: Δz=10 m over 200 m = 5%.
    expect(res.derivation.maxSlopePercent).toBeCloseTo(5.0, 1);
    expect(res.derivation.aspectDegrees).toBe(270);
    expect(res.derivation.aspectCompass).toBe("W");
    // Elevation range: 95 → 105 m.
    expect(res.derivation.elevationMinMeters).toBeCloseTo(95, 5);
    expect(res.derivation.elevationMaxMeters).toBeCloseTo(105, 5);
  });

  it("10% north-rising incline → south-facing (180°) aspect", () => {
    const res = deriveTerrainMetrics(grid9(100, (_x, y) => 500 + 0.1 * y));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.derivation.meanSlopePercent).toBeCloseTo(10.0, 1);
    expect(res.derivation.aspectDegrees).toBe(180);
    expect(res.derivation.aspectCompass).toBe("S");
  });

  it("mixed gradient (3% east + 4% north) → 5% slope, SW aspect", () => {
    const res = deriveTerrainMetrics(grid9(100, (x, y) => 0.03 * x + 0.04 * y));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // |∇z| = √(0.03² + 0.04²) = 0.05 → 5%.
    expect(res.derivation.meanSlopePercent).toBeCloseTo(5.0, 1);
    // Downhill azimuth: atan2(-0.03, -0.04) → ≈ 216.9° → SW.
    expect(res.derivation.aspectDegrees).toBe(217);
    expect(res.derivation.aspectCompass).toBe("SW");
  });

  it("EPQS -1000000 no-data points are discarded, never used as elevations", () => {
    // Center is no-data; the four cross arms carry z = 0.04·y.
    const pts: TerrainPoint[] = [
      { xMeters: 0, yMeters: 0, elevationMeters: EPQS_NO_DATA },
      { xMeters: 0, yMeters: 100, elevationMeters: 4 },
      { xMeters: 0, yMeters: -100, elevationMeters: -4 },
      { xMeters: 100, yMeters: 0, elevationMeters: 0 },
      { xMeters: -100, yMeters: 0, elevationMeters: 0 },
    ];
    const res = deriveTerrainMetrics(pts);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.derivation.validPoints).toBe(4);
    expect(res.derivation.meanSlopePercent).toBeCloseTo(4.0, 1);
    // Had -1000000 leaked in, the range would be ~1e6 m and slope absurd.
    expect(res.derivation.elevationMinMeters).toBe(-4);
    expect(res.derivation.elevationMaxMeters).toBe(4);
    expect(res.derivation.maxSlopePercent).toBeLessThan(100);
  });

  it("fewer than MIN_VALID_POINTS real points → reasoned failure, no extrapolation", () => {
    const pts: TerrainPoint[] = [
      { xMeters: 0, yMeters: 0, elevationMeters: 100 },
      { xMeters: 0, yMeters: 100, elevationMeters: 105 },
      { xMeters: 100, yMeters: 0, elevationMeters: null }, // fetch failed
      { xMeters: -100, yMeters: 0, elevationMeters: EPQS_NO_DATA },
      { xMeters: 0, yMeters: -100, elevationMeters: 99 },
    ];
    const res = deriveTerrainMetrics(pts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("insufficient_points");
    expect(res.validPoints).toBe(3);
    expect(res.validPoints).toBeLessThan(MIN_VALID_POINTS);
  });

  it("collinear points (no 2-D spread) → insufficient_spread, not a fake plane", () => {
    const pts: TerrainPoint[] = [-100, -50, 0, 50, 100].map((x) => ({
      xMeters: x,
      yMeters: 0,
      elevationMeters: 0.05 * x,
    }));
    const res = deriveTerrainMetrics(pts);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("insufficient_spread");
  });
});

describe("classifySlopeBand / compass / formatting", () => {
  it("band thresholds match the DD conventions", () => {
    expect(classifySlopeBand(0)).toBe("flat (<3%)");
    expect(classifySlopeBand(2.9)).toBe("flat (<3%)");
    expect(classifySlopeBand(3)).toBe("gentle (3-8%)");
    expect(classifySlopeBand(7.9)).toBe("gentle (3-8%)");
    expect(classifySlopeBand(8)).toBe("moderate (8-15%)");
    expect(classifySlopeBand(14.9)).toBe("moderate (8-15%)");
    expect(classifySlopeBand(15)).toBe("steep (>15%)");
  });

  it("compass labels wrap correctly", () => {
    expect(compassLabel(0)).toBe("N");
    expect(compassLabel(45)).toBe("NE");
    expect(compassLabel(90)).toBe("E");
    expect(compassLabel(217)).toBe("SW");
    expect(compassLabel(350)).toBe("N");
  });

  it("formatSlopeValue includes band, percents and aspect", () => {
    const summary: TerrainSummary = {
      meanSlopePercent: 4.2,
      maxSlopePercent: 7.1,
      slopeBand: "gentle (3-8%)",
      aspectDegrees: 225,
      aspectCompass: "SW",
      elevationMinFeet: 900,
      elevationMaxFeet: 940,
      elevationRangeFeet: 40,
      centerElevationFeet: 920,
      validPoints: 9,
      totalPoints: 9,
      spacingMeters: 67,
      pattern: "grid9",
      source: "USGS 3DEP (EPQS)",
    };
    expect(formatSlopeValue(summary)).toBe("gentle (3-8%) — 4.2% avg, 7.1% max, SW-facing");
    // Flat: no fabricated aspect in the string.
    expect(
      formatSlopeValue({ ...summary, aspectDegrees: null, aspectCompass: null }),
    ).toBe("gentle (3-8%) — 4.2% avg, 7.1% max");
  });
});
