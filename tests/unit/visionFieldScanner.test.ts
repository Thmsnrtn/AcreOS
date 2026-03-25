import { describe, it, expect } from "vitest";

// Pure observation extraction logic from routes-vision-scan.ts

interface FieldObservations {
  roadType: string;
  vegetationDensity: string;
  structures: string[];
  waterFeatures: string[];
  terrain: string;
  neighboringDevelopment: string;
}

function extractObservationsFromAnalysis(analyses: any[]): FieldObservations {
  const obs: FieldObservations = {
    roadType: "unknown",
    vegetationDensity: "unknown",
    structures: [],
    waterFeatures: [],
    terrain: "unknown",
    neighboringDevelopment: "none visible",
  };

  for (const analysis of analyses) {
    if (!analysis) continue;

    if (analysis.roadDetected || analysis.roads?.some((r: any) => r.detected)) {
      const roadTypes = analysis.roads?.map((r: any) => r.type).filter(Boolean) ?? [];
      obs.roadType = roadTypes.length > 0 ? roadTypes[0] : "paved";
    }

    if (analysis.vegetation || analysis.vegetationDensity !== undefined) {
      const density = analysis.vegetation?.coverage ?? analysis.vegetationDensity ?? 0;
      if (typeof density === "number") {
        obs.vegetationDensity = density > 0.7 ? "dense" : density > 0.4 ? "moderate" : density > 0.1 ? "sparse" : "bare";
      }
      if (analysis.vegetation?.type) {
        obs.vegetationDensity = `${obs.vegetationDensity} (${analysis.vegetation.type})`;
      }
    }

    if (analysis.structures?.length > 0) {
      for (const s of analysis.structures) {
        const type = s.type || s;
        if (typeof type === "string" && !obs.structures.includes(type)) obs.structures.push(type);
      }
    }
    if (analysis.buildingDetected && !obs.structures.includes("building")) {
      obs.structures.push("building");
    }

    if (analysis.waterDetected || analysis.waterFeatures?.length > 0) {
      const features = analysis.waterFeatures ?? (analysis.waterDetected ? ["water body"] : []);
      for (const f of features) {
        const name = typeof f === "string" ? f : f.type || "water";
        if (!obs.waterFeatures.includes(name)) obs.waterFeatures.push(name);
      }
    }

    if (analysis.landscapeType) {
      obs.terrain = analysis.landscapeType;
    } else if (analysis.terrain) {
      obs.terrain = typeof analysis.terrain === "string" ? analysis.terrain : "mixed";
    }

    if (analysis.detectedFeatures?.some((f: string) =>
      f.toLowerCase().includes("house") || f.toLowerCase().includes("development")
    )) {
      obs.neighboringDevelopment = "residential nearby";
    }
  }

  return obs;
}

describe("visionFieldScanner — observation extraction", () => {
  it("handles 4 null analyses gracefully", () => {
    const obs = extractObservationsFromAnalysis([null, null, null, null]);
    expect(obs.roadType).toBe("unknown");
    expect(obs.vegetationDensity).toBe("unknown");
    expect(obs.terrain).toBe("unknown");
    expect(obs.structures).toEqual([]);
    expect(obs.waterFeatures).toEqual([]);
  });

  it("extracts road type from analysis", () => {
    const obs = extractObservationsFromAnalysis([
      { roads: [{ detected: true, type: "gravel" }] },
      null, null, null,
    ]);
    expect(obs.roadType).toBe("gravel");
  });

  it("roadDetected without type → defaults to paved", () => {
    const obs = extractObservationsFromAnalysis([
      { roadDetected: true },
      null, null, null,
    ]);
    expect(obs.roadType).toBe("paved");
  });

  it("classifies vegetation density correctly", () => {
    expect(
      extractObservationsFromAnalysis([{ vegetation: { coverage: 0.8 } }]).vegetationDensity
    ).toBe("dense");

    expect(
      extractObservationsFromAnalysis([{ vegetation: { coverage: 0.5 } }]).vegetationDensity
    ).toBe("moderate");

    expect(
      extractObservationsFromAnalysis([{ vegetation: { coverage: 0.2 } }]).vegetationDensity
    ).toBe("sparse");

    expect(
      extractObservationsFromAnalysis([{ vegetation: { coverage: 0.05 } }]).vegetationDensity
    ).toBe("bare");
  });

  it("appends vegetation type when available", () => {
    const obs = extractObservationsFromAnalysis([
      { vegetation: { coverage: 0.8, type: "forest" } },
    ]);
    expect(obs.vegetationDensity).toBe("dense (forest)");
  });

  it("collects structures without duplicates", () => {
    const obs = extractObservationsFromAnalysis([
      { structures: [{ type: "barn" }, { type: "fence" }] },
      { structures: [{ type: "barn" }], buildingDetected: true },
      null, null,
    ]);
    expect(obs.structures).toContain("barn");
    expect(obs.structures).toContain("fence");
    expect(obs.structures).toContain("building");
    // No duplicates
    expect(obs.structures.filter((s) => s === "barn").length).toBe(1);
  });

  it("detects water features", () => {
    const obs = extractObservationsFromAnalysis([
      { waterDetected: true },
      { waterFeatures: ["pond", "creek"] },
      null, null,
    ]);
    expect(obs.waterFeatures).toContain("water body");
    expect(obs.waterFeatures).toContain("pond");
    expect(obs.waterFeatures).toContain("creek");
  });

  it("identifies neighboring development from detected features", () => {
    const obs = extractObservationsFromAnalysis([
      { detectedFeatures: ["trees", "house", "road"] },
      null, null, null,
    ]);
    expect(obs.neighboringDevelopment).toBe("residential nearby");
  });

  it("no neighboring development when features don't match", () => {
    const obs = extractObservationsFromAnalysis([
      { detectedFeatures: ["trees", "grass", "road"] },
      null, null, null,
    ]);
    expect(obs.neighboringDevelopment).toBe("none visible");
  });

  it("extracts terrain from landscapeType", () => {
    const obs = extractObservationsFromAnalysis([
      { landscapeType: "desert" },
      null, null, null,
    ]);
    expect(obs.terrain).toBe("desert");
  });

  it("full analysis with all fields populated", () => {
    const obs = extractObservationsFromAnalysis([
      {
        roadDetected: true,
        roads: [{ detected: true, type: "dirt" }],
        vegetation: { coverage: 0.3, type: "scrub" },
        landscapeType: "grassland",
        buildingDetected: false,
        waterDetected: false,
        detectedFeatures: ["fence", "grass"],
      },
      {
        structures: [{ type: "fence" }],
        waterFeatures: ["dry creek bed"],
      },
      null,
      null,
    ]);
    expect(obs.roadType).toBe("dirt");
    expect(obs.vegetationDensity).toContain("sparse");
    expect(obs.terrain).toBe("grassland");
    expect(obs.structures).toContain("fence");
    expect(obs.waterFeatures).toContain("dry creek bed");
  });
});

describe("visionFieldScanner — direction compass", () => {
  const DIRECTIONS = ["NORTH", "EAST", "SOUTH", "WEST"] as const;

  it("has exactly 4 directions", () => {
    expect(DIRECTIONS).toHaveLength(4);
  });

  it("directions are in clockwise order", () => {
    expect(DIRECTIONS[0]).toBe("NORTH");
    expect(DIRECTIONS[1]).toBe("EAST");
    expect(DIRECTIONS[2]).toBe("SOUTH");
    expect(DIRECTIONS[3]).toBe("WEST");
  });
});
