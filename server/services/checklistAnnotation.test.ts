/**
 * Maren #6 (Tahoe) — tests for the confidence-aware checklist annotation mapper.
 *
 * Asserts the design invariants:
 *   - HIT maps to the right verdict + confidence + source + "verify" cue.
 *   - MISS / API-unavailable / no-coordinates maps to honest "unknown",
 *     never fabricating a value.
 *   - The mapper NEVER returns a status / completion — it only annotates.
 */
import { describe, expect, it } from "vitest";
import {
  annotateFlood,
  annotateWetlands,
  annotateSoil,
  annotateEnvironmental,
  annotateEnvironmentalChecklist,
} from "./checklistAnnotation";

describe("annotateFlood", () => {
  it("low risk → likely_clears, high confidence, FEMA source, verify cue", () => {
    const a = annotateFlood({
      zone: "Zone X (Minimal Flood Hazard)",
      riskLevel: "low",
      source: "FEMA NFHL",
      lastUpdated: "2024-03-01T00:00:00.000Z",
    });
    expect(a.itemId).toBe("env-flood");
    expect(a.verdict).toBe("likely_clears");
    expect(a.confidence).toBe("high");
    expect(a.source).toBe("FEMA NFHL");
    expect(a.asOf).toBe("2024-03-01T00:00:00.000Z");
    expect(a.summary).toMatch(/FEMA NFHL/);
    expect(a.summary).toMatch(/likely clears/i);
    expect(a.summary).toMatch(/verify$/i);
    expect(a.requiresVerification).toBe(true);
  });

  it("high risk → flagged", () => {
    const a = annotateFlood({ zone: "Zone AE", riskLevel: "high", source: "FEMA NFHL" });
    expect(a.verdict).toBe("flagged");
    expect(a.confidence).toBe("high");
    expect(a.summary).toMatch(/high flood risk/i);
  });

  it("medium risk → needs_attention", () => {
    const a = annotateFlood({ zone: "Zone X500", riskLevel: "medium", source: "FEMA NFHL" });
    expect(a.verdict).toBe("needs_attention");
    expect(a.confidence).toBe("medium");
  });

  it("unavailable source → unknown, no fabrication", () => {
    const a = annotateFlood({
      zone: "Zone X",
      riskLevel: "low",
      source: "Default (API Unavailable)",
    });
    expect(a.verdict).toBe("unknown");
    expect(a.confidence).toBe("none");
    expect(a.source).toBeNull();
    expect(a.requiresVerification).toBe(false);
    // Must NOT claim it clears even though the default blob says "low".
    expect(a.summary).not.toMatch(/clears/i);
  });

  it("null data → unknown", () => {
    const a = annotateFlood(null);
    expect(a.verdict).toBe("unknown");
    expect(a.summary).toMatch(/not yet looked up/i);
  });
});

describe("annotateWetlands", () => {
  it("wetlands present → flagged with percentage + classification", () => {
    const a = annotateWetlands({
      hasWetlands: true,
      classification: "Freshwater Emergent",
      percentage: 100,
      source: "NWI",
    });
    expect(a.itemId).toBe("env-wetlands");
    expect(a.verdict).toBe("flagged");
    expect(a.summary).toMatch(/wetlands present/i);
    expect(a.summary).toMatch(/Freshwater Emergent/);
    expect(a.summary).toMatch(/verify$/i);
  });

  it("no wetlands → likely_clears (medium)", () => {
    const a = annotateWetlands({ hasWetlands: false, classification: null, percentage: 0, source: "NWI" });
    expect(a.verdict).toBe("likely_clears");
    expect(a.confidence).toBe("medium");
  });

  it("unavailable → unknown", () => {
    const a = annotateWetlands({ hasWetlands: false, source: "Default (API Unavailable)" });
    expect(a.verdict).toBe("unknown");
    expect(a.source).toBeNull();
  });
});

describe("annotateSoil", () => {
  it("good suitability → likely_clears", () => {
    const a = annotateSoil({ soilType: "Loam", drainage: "well drained", suitability: "good", source: "USDA NRCS SSURGO" });
    expect(a.itemId).toBe("env-soil");
    expect(a.verdict).toBe("likely_clears");
    expect(a.summary).toMatch(/Loam/);
    expect(a.summary).toMatch(/well drained/);
  });

  it("poor suitability → needs_attention", () => {
    const a = annotateSoil({ soilType: "Clay", suitability: "poor", source: "USDA NRCS SSURGO" });
    expect(a.verdict).toBe("needs_attention");
  });

  it("retrieved but no suitability → needs_attention low-confidence (reports, doesn't conclude)", () => {
    const a = annotateSoil({ soilType: "Sandy loam", source: "USDA NRCS SSURGO" });
    expect(a.verdict).toBe("needs_attention");
    expect(a.confidence).toBe("low");
    expect(a.summary).not.toMatch(/clears/i);
  });
});

describe("annotateEnvironmental", () => {
  it("EPA sites nearby → flagged", () => {
    const a = annotateEnvironmental({
      superfundSites: [{ name: "Site A" }],
      nearestSiteDistance: 2.3,
      riskLevel: "high",
      source: "EPA Envirofacts",
    });
    expect(a.itemId).toBe("env-epa");
    expect(a.verdict).toBe("flagged");
    expect(a.summary).toMatch(/EPA site/i);
    expect(a.summary).toMatch(/2.3 mi/);
  });

  it("no sites + low risk → likely_clears", () => {
    const a = annotateEnvironmental({ superfundSites: [], riskLevel: "low", source: "EPA Envirofacts" });
    expect(a.verdict).toBe("likely_clears");
    expect(a.confidence).toBe("high");
  });
});

describe("annotateEnvironmentalChecklist", () => {
  it("maps all four items; missing categories become honest unknown", () => {
    const map = annotateEnvironmentalChecklist({
      flood: { zone: "Zone X", riskLevel: "low", source: "FEMA NFHL" },
      // wetlands/soil/environmental omitted
    });
    expect(map["env-flood"].verdict).toBe("likely_clears");
    expect(map["env-wetlands"].verdict).toBe("unknown");
    expect(map["env-soil"].verdict).toBe("unknown");
    expect(map["env-epa"].verdict).toBe("unknown");
    // Every key present so the UI can render consistently.
    expect(Object.keys(map).sort()).toEqual(
      ["env-epa", "env-flood", "env-soil", "env-wetlands"].sort(),
    );
  });

  it("never returns a checklist status / completion field (annotation only)", () => {
    const map = annotateEnvironmentalChecklist({
      flood: { zone: "Zone AE", riskLevel: "high", source: "FEMA NFHL" },
    });
    const a = map["env-flood"] as Record<string, unknown>;
    expect(a).not.toHaveProperty("status");
    expect(a).not.toHaveProperty("completed");
    expect(a).not.toHaveProperty("checked");
  });
});
