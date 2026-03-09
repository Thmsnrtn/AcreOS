/**
 * T204 — Zoning Service Tests
 * Tests zoning code classification, use determination, and setback validation.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type ZoningCategory = "residential" | "commercial" | "industrial" | "agricultural" | "mixed" | "conservation" | "unknown";

function classifyZoningCode(code: string): ZoningCategory {
  const upper = code.toUpperCase().trim();
  if (/^A(\d|G|-R)/i.test(upper) || /^AG$|^AGRI/i.test(upper)) return "agricultural";
  if (/^R[1-9E]|^RS|^SF|^MF|^RM/i.test(upper)) return "residential";
  if (/^C[1-9]|^B[1-9]|^COM/i.test(upper)) return "commercial";
  if (/^I[1-9]|^M[1-9]|^IND/i.test(upper)) return "industrial";
  if (/^MU|^MX|^PUD/i.test(upper)) return "mixed";
  if (/^OS|^CON|^PRK|^NAT/i.test(upper)) return "conservation";
  return "unknown";
}

function isAllowedUse(zoningCategory: ZoningCategory, proposedUse: string): boolean {
  const use = proposedUse.toLowerCase();
  const allowedMap: Record<ZoningCategory, string[]> = {
    agricultural: ["farming", "livestock", "row crops", "hunting", "storage", "single family"],
    residential: ["single family", "multi-family", "rental", "home office"],
    commercial: ["retail", "office", "restaurant", "hotel", "storage", "mixed use"],
    industrial: ["warehouse", "manufacturing", "distribution", "storage", "heavy equipment"],
    mixed: ["residential", "commercial", "office", "retail"],
    conservation: ["hiking", "natural preserve", "hunting"],
    unknown: [],
  };

  return (allowedMap[zoningCategory] ?? []).some(allowed => use.includes(allowed) || allowed.includes(use));
}

function validateSetbacks(
  lotWidthFt: number,
  lotDepthFt: number,
  setbacks: { front: number; rear: number; side: number }
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const minBuildableWidth = lotWidthFt - setbacks.side * 2;
  const minBuildableDepth = lotDepthFt - setbacks.front - setbacks.rear;

  if (minBuildableWidth <= 0) issues.push("Side setbacks exceed lot width");
  if (minBuildableDepth <= 0) issues.push("Front/rear setbacks exceed lot depth");
  if (setbacks.front < 0 || setbacks.rear < 0 || setbacks.side < 0) issues.push("Setbacks cannot be negative");

  return { valid: issues.length === 0, issues };
}

function estimateDevelopmentPotential(
  acres: number,
  zoningCategory: ZoningCategory,
  minLotSizeAcres: number
): { unitsAllowed: number; category: string } {
  if (zoningCategory === "conservation") return { unitsAllowed: 0, category: "No development" };
  if (zoningCategory === "agricultural") return { unitsAllowed: 1, category: "Single farmstead" };

  const unitsAllowed = Math.floor(acres / minLotSizeAcres);

  if (unitsAllowed >= 20) return { unitsAllowed, category: "High density" };
  if (unitsAllowed >= 5) return { unitsAllowed, category: "Medium density" };
  if (unitsAllowed >= 2) return { unitsAllowed, category: "Low density" };
  return { unitsAllowed: Math.max(1, unitsAllowed), category: "Single unit" };
}

function isFloodZoneHigh(floodZone: string): boolean {
  const zone = floodZone.toUpperCase().trim();
  return zone.startsWith("A") || zone.startsWith("V");
}

function formatZoningDescription(code: string, category: ZoningCategory): string {
  const descriptions: Record<ZoningCategory, string> = {
    agricultural: "Agricultural",
    residential: "Residential",
    commercial: "Commercial",
    industrial: "Industrial",
    mixed: "Mixed Use",
    conservation: "Conservation/Open Space",
    unknown: "Unclassified",
  };
  return `${code} — ${descriptions[category]}`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("classifyZoningCode", () => {
  it("classifies agricultural codes", () => {
    expect(classifyZoningCode("AG")).toBe("agricultural");
    expect(classifyZoningCode("A1")).toBe("agricultural");
    expect(classifyZoningCode("AGRI")).toBe("agricultural");
  });

  it("classifies residential codes", () => {
    expect(classifyZoningCode("R1")).toBe("residential");
    expect(classifyZoningCode("RS1")).toBe("residential");
    expect(classifyZoningCode("MF")).toBe("residential");
  });

  it("classifies commercial codes", () => {
    expect(classifyZoningCode("C1")).toBe("commercial");
    expect(classifyZoningCode("B2")).toBe("commercial");
    expect(classifyZoningCode("COM")).toBe("commercial");
  });

  it("classifies industrial codes", () => {
    expect(classifyZoningCode("I1")).toBe("industrial");
    expect(classifyZoningCode("M2")).toBe("industrial");
    expect(classifyZoningCode("IND")).toBe("industrial");
  });

  it("classifies mixed use codes", () => {
    expect(classifyZoningCode("MU")).toBe("mixed");
    expect(classifyZoningCode("PUD")).toBe("mixed");
    expect(classifyZoningCode("MX2")).toBe("mixed");
  });

  it("classifies conservation codes", () => {
    expect(classifyZoningCode("OS")).toBe("conservation");
    expect(classifyZoningCode("CON")).toBe("conservation");
  });

  it("returns unknown for unrecognized codes", () => {
    expect(classifyZoningCode("XYZ")).toBe("unknown");
  });
});

describe("isAllowedUse", () => {
  it("allows farming in agricultural zone", () => {
    expect(isAllowedUse("agricultural", "farming")).toBe(true);
  });

  it("allows single family in residential zone", () => {
    expect(isAllowedUse("residential", "single family")).toBe(true);
  });

  it("blocks manufacturing in residential", () => {
    expect(isAllowedUse("residential", "manufacturing")).toBe(false);
  });

  it("blocks development in conservation", () => {
    expect(isAllowedUse("conservation", "retail")).toBe(false);
  });

  it("allows storage in commercial", () => {
    expect(isAllowedUse("commercial", "storage")).toBe(true);
  });

  it("returns false for unknown zone", () => {
    expect(isAllowedUse("unknown", "residential")).toBe(false);
  });
});

describe("validateSetbacks", () => {
  it("returns valid for reasonable setbacks", () => {
    const result = validateSetbacks(100, 150, { front: 25, rear: 20, side: 10 });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("rejects when side setbacks exceed lot width", () => {
    const result = validateSetbacks(20, 100, { front: 10, rear: 10, side: 15 });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Side setbacks exceed lot width");
  });

  it("rejects when front+rear setbacks exceed depth", () => {
    const result = validateSetbacks(100, 40, { front: 25, rear: 20, side: 5 });
    expect(result.valid).toBe(false);
    expect(result.issues).toContain("Front/rear setbacks exceed lot depth");
  });

  it("rejects negative setbacks", () => {
    const result = validateSetbacks(100, 100, { front: -5, rear: 10, side: 5 });
    expect(result.valid).toBe(false);
  });
});

describe("estimateDevelopmentPotential", () => {
  it("returns 0 for conservation zone", () => {
    const result = estimateDevelopmentPotential(100, "conservation", 1);
    expect(result.unitsAllowed).toBe(0);
  });

  it("returns single unit for agricultural", () => {
    const result = estimateDevelopmentPotential(50, "agricultural", 5);
    expect(result.unitsAllowed).toBe(1);
  });

  it("calculates correct unit count", () => {
    const result = estimateDevelopmentPotential(10, "residential", 0.5);
    expect(result.unitsAllowed).toBe(20);
    expect(result.category).toBe("High density");
  });

  it("classifies low density correctly", () => {
    const result = estimateDevelopmentPotential(2, "residential", 0.5);
    expect(result.unitsAllowed).toBe(4);
    expect(result.category).toBe("Low density");
  });
});

describe("isFloodZoneHigh", () => {
  it("returns true for Zone A", () => {
    expect(isFloodZoneHigh("A")).toBe(true);
    expect(isFloodZoneHigh("AE")).toBe(true);
    expect(isFloodZoneHigh("AH")).toBe(true);
  });

  it("returns true for Zone V (coastal)", () => {
    expect(isFloodZoneHigh("V")).toBe(true);
    expect(isFloodZoneHigh("VE")).toBe(true);
  });

  it("returns false for Zone X (minimal flood risk)", () => {
    expect(isFloodZoneHigh("X")).toBe(false);
    expect(isFloodZoneHigh("X500")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isFloodZoneHigh("ae")).toBe(true);
  });
});

describe("formatZoningDescription", () => {
  it("formats agricultural", () => {
    expect(formatZoningDescription("AG", "agricultural")).toBe("AG — Agricultural");
  });

  it("formats unknown", () => {
    expect(formatZoningDescription("XYZ", "unknown")).toBe("XYZ — Unclassified");
  });
});
