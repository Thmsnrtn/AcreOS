/**
 * Data-license register guard (Beatrice CRO lens).
 * Pins the redistribution posture so we can never silently bulk-cache and
 * re-serve data we don't have the right to redistribute.
 */
import { describe, it, expect } from "vitest";
import {
  licenseFor,
  redistributableFor,
  attributionFor,
  mayCacheAndRedistribute,
} from "./data-licenses";

describe("data-license register", () => {
  it("federal sources are public-domain and redistributable: yes", () => {
    expect(redistributableFor("FEMA NFHL")).toBe("yes");
    expect(redistributableFor("USDA SSURGO")).toBe("yes");
    expect(redistributableFor("US Census ACS")).toBe("yes");
    expect(licenseFor("FEMA NFHL").license).toBe("public-domain-usgov");
  });

  it("OpenStreetMap is ODbL, attribution-required", () => {
    expect(licenseFor("OpenStreetMap").license).toBe("odbl");
    expect(redistributableFor("OpenStreetMap")).toBe("attribution");
    expect(attributionFor("OpenStreetMap")).toBe("© OpenStreetMap contributors");
  });

  it("proprietary feeds are not redistributable by default", () => {
    expect(redistributableFor("Regrid")).toBe("no");
    expect(redistributableFor("ATTOM Data")).toBe("no");
    expect(redistributableFor("BatchData")).toBe("no");
  });

  it("an unknown source defaults to review-required (conservative)", () => {
    expect(redistributableFor("Some County Portal")).toBe("review-required");
    expect(licenseFor("Some County Portal").license).toBe("county-tos");
  });

  describe("mayCacheAndRedistribute — the cache guard", () => {
    it("allows yes + attribution sources", () => {
      expect(mayCacheAndRedistribute("FEMA NFHL")).toBe(true); // yes
      expect(mayCacheAndRedistribute("OpenStreetMap")).toBe(true); // attribution
    });

    it("refuses no + review-required sources (live-passthrough only)", () => {
      expect(mayCacheAndRedistribute("Regrid")).toBe(false); // no
      expect(mayCacheAndRedistribute("BatchData")).toBe(false); // no
      expect(mayCacheAndRedistribute("Some County Portal")).toBe(false); // review-required
    });
  });
});
