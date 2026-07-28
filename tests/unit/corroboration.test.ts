/**
 * Corroboration Engine (ruling #9 wave 2) — cross-source triangulation of
 * independent free federal instruments.
 *
 * The module under test is PURE (no db/storage/fetch imports), so no mocks.
 *
 * Honesty invariants under test:
 *  - agreement across independent sources → CORROBORATED with full evidence
 *  - disagreement → CONTRADICTION surfaced as a finding, never smoothed
 *  - <2 usable independent sources → INSUFFICIENT naming what's missing;
 *    NEVER a verdict from one source
 *  - unknown/malformed values degrade to INSUFFICIENT — never crash/guess
 *  - findings are categorical: no numeric confidence scores anywhere
 *  - every finding carries a per-source evidence chain for every present source
 */

import { describe, it, expect } from "vitest";
import {
  corroborateParcel,
  bareFemaZone,
  SOURCE_NWI,
  SOURCE_SSURGO,
  SOURCE_NLCD,
  SOURCE_FEMA,
  type CorroborationFinding,
} from "../../server/services/openData/corroboration";

// ─── Fixtures mirroring the broker's real category result shapes ─────────────

const FEMA_AE = { zone: "Zone AE", riskLevel: "high", lastUpdated: "2026-07-01T00:00:00.000Z" };
const FEMA_X = { zone: "Zone X (Minimal Flood Hazard)", riskLevel: "low" };
const NWI_WET = { hasWetlands: true, classification: "Freshwater Emergent Wetland", percentage: 100 };
const NWI_DRY = { hasWetlands: false, classification: null, percentage: 0 };
const SOIL_HYDRIC_FLOODS = {
  hydricRating: "Yes",
  drainage: "Poorly drained",
  floodingFrequency: "Frequent",
  suitability: "limited",
  hydrologicGroup: "D",
  lastUpdated: "2026-06-15T00:00:00.000Z",
};
const SOIL_DRY = {
  hydricRating: "No",
  drainage: "Well drained",
  floodingFrequency: "None",
  suitability: "prime",
  hydrologicGroup: "B",
};
const NLCD_WETLAND = { nlcdClass: 95, className: "Emergent Herbaceous Wetlands", isWetland: true, year: 2021 };
const NLCD_SHRUB = { nlcdClass: 52, className: "Shrub/Scrub", isWetland: false, year: 2021 };

function findingById(report: ReturnType<typeof corroborateParcel>, ruleId: string): CorroborationFinding {
  const f = report.findings.find((x) => x.ruleId === ruleId);
  if (!f) throw new Error(`finding ${ruleId} not present`);
  return f;
}

describe("wetness triangle — agreement", () => {
  it("all three wet signals agree → CORROBORATED with 3-source evidence", () => {
    const report = corroborateParcel({
      wetlands: NWI_WET,
      soil: SOIL_HYDRIC_FLOODS,
      landCover: NLCD_WETLAND,
    });
    const f = findingById(report, "wetness_triangle");
    expect(f.status).toBe("corroborated");
    expect(f.agreeingSources).toEqual(
      expect.arrayContaining([SOURCE_NWI, SOURCE_SSURGO, SOURCE_NLCD])
    );
    expect(f.agreeingSources).toHaveLength(3);
    expect(f.disagreeingSources).toEqual([]);
    expect(f.evidence).toHaveLength(3);
    // confidenceBoost is a plain-words rationale, categorically NOT a number
    expect(typeof f.confidenceBoost).toBe("string");
    expect(f.confidenceBoost).toMatch(/independent/i);
  });

  it("all three dry signals agree → CORROBORATED (not-wet)", () => {
    const report = corroborateParcel({
      wetlands: NWI_DRY,
      soil: SOIL_DRY,
      landCover: NLCD_SHRUB,
    });
    const f = findingById(report, "wetness_triangle");
    expect(f.status).toBe("corroborated");
    expect(f.agreeingSources).toHaveLength(3);
    expect(f.fieldNote).toMatch(/no wetness signal/i);
  });

  it("two usable sources agree, third indeterminate → still CORROBORATED with 2, indeterminate named", () => {
    const report = corroborateParcel({
      wetlands: NWI_WET,
      soil: SOIL_HYDRIC_FLOODS,
      landCover: { nlcdClass: null, className: "Unknown", isWetland: false }, // unresolved pixel
    });
    const f = findingById(report, "wetness_triangle");
    expect(f.status).toBe("corroborated");
    expect(f.agreeingSources).toEqual(expect.arrayContaining([SOURCE_NWI, SOURCE_SSURGO]));
    expect(f.agreeingSources).toHaveLength(2);
    expect(f.missingSources.map((m) => m.source)).toContain(SOURCE_NLCD);
    // still full evidence for every PRESENT source
    expect(f.evidence).toHaveLength(3);
  });
});

describe("wetness triangle — contradiction (the product)", () => {
  it("NWI dry + hydric soil + FEMA zone AE → CONTRADICTION with the walk-the-parcel note", () => {
    const report = corroborateParcel({
      wetlands: NWI_DRY,
      soil: SOIL_HYDRIC_FLOODS,
      floodZone: FEMA_AE,
    });
    const f = findingById(report, "wetness_triangle");
    expect(f.status).toBe("contradiction");
    expect(f.disagreeingSources).toEqual(expect.arrayContaining([SOURCE_NWI, SOURCE_SSURGO]));
    expect(f.fieldNote).toMatch(/NWI shows no mapped wetlands/);
    expect(f.fieldNote).toMatch(/hydric/);
    expect(f.fieldNote).toMatch(/FEMA zone AE/);
    expect(f.fieldNote).toMatch(/walk the parcel before trusting the map/);
    // contradiction is never softened into a boost
    expect(f.confidenceBoost).toBeUndefined();
  });

  it("NWI wet + non-hydric soil + dry NLCD → CONTRADICTION, no smoothing to a majority vote", () => {
    const report = corroborateParcel({
      wetlands: NWI_WET,
      soil: SOIL_DRY,
      landCover: NLCD_SHRUB,
    });
    const f = findingById(report, "wetness_triangle");
    expect(f.status).toBe("contradiction");
    expect(f.disagreeingSources).toHaveLength(3);
    expect(f.fieldNote).toMatch(/walk the parcel/);
  });
});

describe("wetness triangle — insufficient", () => {
  it("one source only → INSUFFICIENT naming the missing sources; never a one-source verdict", () => {
    const report = corroborateParcel({ soil: SOIL_HYDRIC_FLOODS });
    const f = findingById(report, "wetness_triangle");
    expect(f.status).toBe("insufficient");
    const missingNames = f.missingSources.map((m) => m.source);
    expect(missingNames).toContain(SOURCE_NWI);
    expect(missingNames).toContain(SOURCE_NLCD);
    expect(f.fieldNote).toMatch(/no verdict is drawn from a single source/i);
    expect(f.agreeingSources).toEqual([]);
    expect(f.disagreeingSources).toEqual([]);
  });

  it("no sources at all → INSUFFICIENT everywhere; all four categories unchecked", () => {
    const report = corroborateParcel({});
    for (const f of report.findings) {
      expect(f.status).toBe("insufficient");
    }
    expect(report.unchecked.map((u) => u.category).sort()).toEqual(
      ["flood_zone", "land_cover", "soil", "wetlands"].sort()
    );
    expect(report.sourcesPresent).toEqual([]);
  });
});

describe("flood coherence — both ways", () => {
  it("FEMA high + SSURGO Frequent → CORROBORATED (floods)", () => {
    const report = corroborateParcel({ floodZone: FEMA_AE, soil: SOIL_HYDRIC_FLOODS });
    const f = findingById(report, "flood_coherence");
    expect(f.status).toBe("corroborated");
    expect(f.agreeingSources).toEqual(expect.arrayContaining([SOURCE_FEMA, SOURCE_SSURGO]));
    expect(f.fieldNote).toMatch(/agree this ground floods/i);
    expect(typeof f.confidenceBoost).toBe("string");
  });

  it("FEMA low + SSURGO None → CORROBORATED (does not flood)", () => {
    const report = corroborateParcel({ floodZone: FEMA_X, soil: SOIL_DRY });
    const f = findingById(report, "flood_coherence");
    expect(f.status).toBe("corroborated");
    expect(f.fieldNote).toMatch(/flooding is not indicated/i);
  });

  it("FEMA zone AE + SSURGO None → CONTRADICTION", () => {
    const report = corroborateParcel({ floodZone: FEMA_AE, soil: SOIL_DRY });
    const f = findingById(report, "flood_coherence");
    expect(f.status).toBe("contradiction");
    expect(f.disagreeingSources).toEqual(expect.arrayContaining([SOURCE_FEMA, SOURCE_SSURGO]));
    expect(f.fieldNote).toMatch(/zone AE/);
    expect(f.fieldNote).toMatch(/"None"/);
    expect(f.fieldNote).toMatch(/verify elevation/i);
  });

  it("FEMA zone X + SSURGO Frequent → CONTRADICTION (the other direction)", () => {
    const report = corroborateParcel({ floodZone: FEMA_X, soil: SOIL_HYDRIC_FLOODS });
    const f = findingById(report, "flood_coherence");
    expect(f.status).toBe("contradiction");
    expect(f.fieldNote).toMatch(/zone X/);
    expect(f.fieldNote).toMatch(/"Frequent"/);
  });

  it("only FEMA present → INSUFFICIENT naming SSURGO; never a one-instrument verdict", () => {
    const report = corroborateParcel({ floodZone: FEMA_AE });
    const f = findingById(report, "flood_coherence");
    expect(f.status).toBe("insufficient");
    expect(f.missingSources.map((m) => m.source)).toContain(SOURCE_SSURGO);
    expect(f.fieldNote).toMatch(/no verdict from one source/i);
  });

  it("intermediate signals (FEMA medium, SSURGO Rare) → INSUFFICIENT, stated as intermediate", () => {
    const report = corroborateParcel({
      floodZone: { zone: "Zone X500", riskLevel: "medium" },
      soil: { ...SOIL_DRY, floodingFrequency: "Rare" },
    });
    const f = findingById(report, "flood_coherence");
    expect(f.status).toBe("insufficient");
    const reasons = f.missingSources.map((m) => m.reason).join(" | ");
    expect(reasons).toMatch(/intermediate/i);
  });
});

describe("malformed / unknown values degrade — never crash, never guess", () => {
  it("garbage in every field → INSUFFICIENT with reasons, no throw", () => {
    const report = corroborateParcel({
      floodZone: { zone: 42 as any, riskLevel: "purple" },
      wetlands: { hasWetlands: "maybe" },
      soil: { hydricRating: "Banana", floodingFrequency: { nested: true } as any },
      landCover: { nlcdClass: "ninety" as any, className: 7 as any, isWetland: "yes" as any },
    });
    for (const f of report.findings) {
      expect(f.status).toBe("insufficient");
      expect(f.missingSources.length).toBeGreaterThan(0);
      for (const m of f.missingSources) {
        expect(m.reason).toBeTruthy();
      }
    }
  });

  it("null category values are treated as unchecked, not as readings", () => {
    const report = corroborateParcel({
      floodZone: null,
      wetlands: null,
      soil: SOIL_DRY,
      landCover: null,
    });
    expect(report.unchecked.map((u) => u.category)).toEqual(
      expect.arrayContaining(["flood_zone", "wetlands", "land_cover"])
    );
    expect(findingById(report, "wetness_triangle").status).toBe("insufficient");
  });
});

describe("evidence chain completeness", () => {
  it("every finding carries one evidence entry per present source with source/category/field/value/asOf", () => {
    const report = corroborateParcel({
      floodZone: FEMA_AE,
      wetlands: NWI_WET,
      soil: SOIL_HYDRIC_FLOODS,
      landCover: NLCD_WETLAND,
    });

    const wetness = findingById(report, "wetness_triangle");
    expect(wetness.evidence.map((e) => e.source).sort()).toEqual(
      [SOURCE_NLCD, SOURCE_NWI, SOURCE_SSURGO].sort()
    );
    const flood = findingById(report, "flood_coherence");
    expect(flood.evidence.map((e) => e.source).sort()).toEqual([SOURCE_FEMA, SOURCE_SSURGO].sort());

    for (const f of report.findings) {
      for (const e of f.evidence) {
        expect(typeof e.source).toBe("string");
        expect(typeof e.category).toBe("string");
        expect(typeof e.field).toBe("string");
        expect(e).toHaveProperty("value");
        expect(e).toHaveProperty("asOf");
        // asOf is a string when known, null when not — never invented
        expect(e.asOf === null || typeof e.asOf === "string").toBe(true);
      }
    }

    // asOf propagates from lastUpdated when the source carried one
    const soilEvidence = wetness.evidence.find((e) => e.source === SOURCE_SSURGO)!;
    expect(soilEvidence.asOf).toBe("2026-06-15T00:00:00.000Z");
    expect(soilEvidence.field).toBe("hydricRating");
    expect(soilEvidence.value).toBe("Yes");
  });

  it("no numeric confidence scores anywhere in findings — categorical only", () => {
    const report = corroborateParcel({
      floodZone: FEMA_AE,
      wetlands: NWI_WET,
      soil: SOIL_HYDRIC_FLOODS,
      landCover: NLCD_WETLAND,
    });
    for (const f of report.findings) {
      expect(["corroborated", "contradiction", "insufficient"]).toContain(f.status);
      expect((f as any).confidence).toBeUndefined();
      expect((f as any).score).toBeUndefined();
      expect((f as any).probability).toBeUndefined();
      if (f.confidenceBoost !== undefined) {
        expect(typeof f.confidenceBoost).toBe("string");
      }
    }
  });
});

describe("future-instrument seam", () => {
  it("extra instruments are accepted, echoed as noRuleYet, and do not affect v1 findings", () => {
    const base = corroborateParcel({ wetlands: NWI_WET, soil: SOIL_HYDRIC_FLOODS, landCover: NLCD_WETLAND });
    const withExtras = corroborateParcel({
      wetlands: NWI_WET,
      soil: SOIL_HYDRIC_FLOODS,
      landCover: NLCD_WETLAND,
      extraInstruments: [
        { category: "wildfire_hazard", source: "USFS Wildfire Hazard Potential", values: { whpClass: 4 } },
        { category: "broadband", source: "FCC BDC", values: { maxDownMbps: 100 }, asOf: "2026-01-01" },
      ],
    });
    expect(withExtras.extraInstruments).toHaveLength(2);
    for (const inst of withExtras.extraInstruments) {
      expect(inst.noRuleYet).toBe(true);
    }
    expect(findingById(withExtras, "wetness_triangle").status).toBe(
      findingById(base, "wetness_triangle").status
    );
  });
});

describe("bareFemaZone helper", () => {
  it("strips the broker's Zone prefix and suffix text", () => {
    expect(bareFemaZone("Zone AE")).toBe("AE");
    expect(bareFemaZone("Zone X (Minimal Flood Hazard)")).toBe("X");
    expect(bareFemaZone("AE")).toBe("AE");
    expect(bareFemaZone(null)).toBeNull();
    expect(bareFemaZone(42)).toBeNull();
  });
});
