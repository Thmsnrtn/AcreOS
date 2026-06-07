/**
 * curated-sample-parcels — unit tests (RAFE, Tahoe Wave-2).
 *
 * These parcels power the "See a sample" affordance: a REAL free-data lookup
 * that must never land empty. The invariants below guard the data shape so a
 * typo'd coordinate or duplicate id can't silently break the first-impression
 * demo (or Soren's landing screenshots, which reuse this set).
 */

import { describe, it, expect } from "vitest";
import {
  CURATED_SAMPLE_PARCELS,
  DEFAULT_SAMPLE_PARCEL,
  getCuratedSampleParcel,
} from "@shared/curated-sample-parcels";

describe("curated-sample-parcels", () => {
  it("provides between 3 and 5 curated parcels", () => {
    expect(CURATED_SAMPLE_PARCELS.length).toBeGreaterThanOrEqual(3);
    expect(CURATED_SAMPLE_PARCELS.length).toBeLessThanOrEqual(5);
  });

  it("has unique ids", () => {
    const ids = CURATED_SAMPLE_PARCELS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses 5-digit county FIPS codes", () => {
    for (const p of CURATED_SAMPLE_PARCELS) {
      expect(p.fips).toMatch(/^\d{5}$/);
    }
  });

  it("has 2-letter state codes", () => {
    for (const p of CURATED_SAMPLE_PARCELS) {
      expect(p.state).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("places every parcel inside the continental US bounding box", () => {
    for (const p of CURATED_SAMPLE_PARCELS) {
      // Continental US rough bounds.
      expect(p.latitude).toBeGreaterThan(24);
      expect(p.latitude).toBeLessThan(50);
      expect(p.longitude).toBeGreaterThan(-125);
      expect(p.longitude).toBeLessThan(-66);
    }
  });

  it("has a positive approximate acreage and non-empty labels", () => {
    for (const p of CURATED_SAMPLE_PARCELS) {
      expect(p.approxAcres).toBeGreaterThan(0);
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.blurb.trim().length).toBeGreaterThan(0);
      expect(p.county.trim().length).toBeGreaterThan(0);
    }
  });

  it("resolves a parcel by id and returns undefined for unknown ids", () => {
    const first = CURATED_SAMPLE_PARCELS[0];
    expect(getCuratedSampleParcel(first.id)).toEqual(first);
    expect(getCuratedSampleParcel("does-not-exist")).toBeUndefined();
  });

  it("exposes a default sample parcel that is one of the curated set", () => {
    expect(CURATED_SAMPLE_PARCELS).toContain(DEFAULT_SAMPLE_PARCEL);
  });
});
