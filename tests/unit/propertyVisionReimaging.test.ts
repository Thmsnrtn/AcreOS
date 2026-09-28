/**
 * Phase 8 Months 10-11 — Ingrid §1
 *
 * Pure-logic tests for the vision-AI re-imaging service. The DB-touching
 * pieces (`reimageProperty`, `runVisionReimagingPass`,
 * `findPropertiesDueForReimaging`) are integration-level and exercised
 * via the live job at runtime; here we just lock down the deterministic
 * change-score math + mock-imagery contract.
 */

import { describe, it, expect } from "vitest";
import {
  computeChangeScore,
  fetchAerialImagery,
  analyzeImage,
  runVisionReimagingPass,
  type VisionAnalysis,
} from "../../server/services/propertyVisionReimaging";

describe("propertyVisionReimaging.computeChangeScore", () => {
  const baseline: VisionAnalysis = {
    detectedFeatures: [],
    structureCount: 0,
    vegetationCoveragePct: 50,
    notableChanges: [],
  };

  it("returns 0 when no prior snapshot exists", () => {
    const r = computeChangeScore(null, baseline);
    expect(r.score).toBe(0);
    expect(r.summary).toMatch(/baseline/i);
  });

  it("returns 0 when nothing changed", () => {
    const r = computeChangeScore(baseline, baseline);
    expect(r.score).toBe(0);
  });

  it("flags new structure as a high-impact change", () => {
    const next: VisionAnalysis = { ...baseline, structureCount: 1 };
    const r = computeChangeScore(baseline, next);
    expect(r.score).toBeGreaterThanOrEqual(35);
    expect(r.notable.some((n) => /structure/i.test(n))).toBe(true);
  });

  it("flags large vegetation shifts", () => {
    const next: VisionAnalysis = { ...baseline, vegetationCoveragePct: 80 };
    const r = computeChangeScore(baseline, next);
    expect(r.score).toBeGreaterThan(0);
    expect(r.notable.some((n) => /vegetation/i.test(n))).toBe(true);
  });

  it("caps the score at 100", () => {
    const next: VisionAnalysis = {
      ...baseline,
      structureCount: 10,
      vegetationCoveragePct: 0,
    };
    const r = computeChangeScore(baseline, next);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("propertyVisionReimaging.fetchAerialImagery", () => {
  it("returns a mock provider when no Mapbox token is configured", async () => {
    const previous = process.env.MAPBOX_PUBLIC_TOKEN;
    delete process.env.MAPBOX_PUBLIC_TOKEN;
    delete process.env.VITE_MAPBOX_ACCESS_TOKEN;
    delete process.env.VITE_MAPBOX_TOKEN;

    try {
      const result = await fetchAerialImagery(123, 30.2672, -97.7431);
      expect(result.provider).toBe("mock");
      expect(result.imageS3Key).toContain("property-123");
    } finally {
      if (previous !== undefined) process.env.MAPBOX_PUBLIC_TOKEN = previous;
    }
  });
});

// DEFECT-0165: this pinned the STUB — "a deterministic, well-formed
// analysis" was seeded pseudo-random detections written for real properties.
// The invariant kept: analysis output must be well-formed. The new truth:
// with no vision model there is no analysis at all, and the pass writes
// nothing rather than an invented one.
describe("propertyVisionReimaging.analyzeImage", () => {
  it("refuses to invent detections when no vision model is configured", async () => {
    await expect(
      analyzeImage("https://mock/x.jpg", { id: 7, sizeAcres: "5.5", terrain: "flat" }),
    ).rejects.toThrow(/No vision analyzer/);
  });

  it("the daily pass writes no snapshot without an analyzer", async () => {
    const r = await runVisionReimagingPass();
    expect(r).toEqual({ propertiesScanned: 0, snapshotsCreated: 0, alertsRaised: 0, errors: 0 });
  });
});
