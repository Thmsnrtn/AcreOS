/**
 * T203 — Territory Service Tests
 * Tests territory assignment, county matching, and overlap detection.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface Territory {
  id: number;
  name: string;
  stateCode: string;
  counties: string[];
  assignedUserId?: number;
}

function normalizeCounty(county: string): string {
  return county.trim().toLowerCase().replace(/\s+county$/i, "").trim();
}

function matchesTerritory(stateCode: string, county: string, territory: Territory): boolean {
  if (territory.stateCode.toUpperCase() !== stateCode.toUpperCase()) return false;
  const normalizedCounty = normalizeCounty(county);
  return territory.counties.some(c => normalizeCounty(c) === normalizedCounty);
}

function findTerritoryForProperty(stateCode: string, county: string, territories: Territory[]): Territory | null {
  return territories.find(t => matchesTerritory(stateCode, county, t)) ?? null;
}

function detectOverlaps(territories: Territory[]): Array<{ t1: number; t2: number; overlappingCounties: string[] }> {
  const overlaps = [];
  for (let i = 0; i < territories.length; i++) {
    for (let j = i + 1; j < territories.length; j++) {
      const t1 = territories[i];
      const t2 = territories[j];
      if (t1.stateCode !== t2.stateCode) continue;
      const normalized1 = t1.counties.map(normalizeCounty);
      const normalized2 = t2.counties.map(normalizeCounty);
      const overlapping = normalized1.filter(c => normalized2.includes(c));
      if (overlapping.length > 0) {
        overlaps.push({ t1: t1.id, t2: t2.id, overlappingCounties: overlapping });
      }
    }
  }
  return overlaps;
}

function getTerritoryStats(territory: Territory, leads: Array<{ stateCode: string; county: string }>): {
  totalLeads: number;
  assignedLeads: number;
} {
  const totalLeads = leads.filter(l => matchesTerritory(l.stateCode, l.county, territory)).length;
  return {
    totalLeads,
    assignedLeads: territory.assignedUserId ? totalLeads : 0,
  };
}

function validateTerritoryName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim().length === 0) return { valid: false, error: "Name is required" };
  if (name.trim().length > 100) return { valid: false, error: "Name must be 100 chars or less" };
  return { valid: true };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("normalizeCounty", () => {
  it("trims whitespace", () => {
    expect(normalizeCounty("  Dallas  ")).toBe("dallas");
  });

  it("removes trailing 'County' suffix", () => {
    expect(normalizeCounty("Dallas County")).toBe("dallas");
  });

  it("case insensitive suffix removal", () => {
    expect(normalizeCounty("Travis COUNTY")).toBe("travis");
  });

  it("handles county with no suffix", () => {
    expect(normalizeCounty("King")).toBe("king");
  });
});

describe("matchesTerritory", () => {
  const territory: Territory = {
    id: 1,
    name: "North Texas",
    stateCode: "TX",
    counties: ["Dallas", "Collin", "Denton"],
  };

  it("returns true for matching state and county", () => {
    expect(matchesTerritory("TX", "Dallas", territory)).toBe(true);
  });

  it("returns false for wrong state", () => {
    expect(matchesTerritory("CA", "Dallas", territory)).toBe(false);
  });

  it("returns false for county not in territory", () => {
    expect(matchesTerritory("TX", "Harris", territory)).toBe(false);
  });

  it("is case insensitive for state", () => {
    expect(matchesTerritory("tx", "Dallas", territory)).toBe(true);
  });

  it("is case insensitive for county", () => {
    expect(matchesTerritory("TX", "dallas", territory)).toBe(true);
  });

  it("handles 'County' suffix in input", () => {
    expect(matchesTerritory("TX", "Dallas County", territory)).toBe(true);
  });
});

describe("findTerritoryForProperty", () => {
  const territories: Territory[] = [
    { id: 1, name: "North TX", stateCode: "TX", counties: ["Dallas", "Collin"] },
    { id: 2, name: "South TX", stateCode: "TX", counties: ["Harris", "Galveston"] },
    { id: 3, name: "Florida", stateCode: "FL", counties: ["Orange", "Osceola"] },
  ];

  it("finds correct territory", () => {
    const t = findTerritoryForProperty("TX", "Harris", territories);
    expect(t?.id).toBe(2);
  });

  it("returns null for unmatched", () => {
    expect(findTerritoryForProperty("TX", "Travis", territories)).toBeNull();
  });

  it("respects state boundary", () => {
    expect(findTerritoryForProperty("FL", "Dallas", territories)).toBeNull();
  });
});

describe("detectOverlaps", () => {
  it("detects overlapping counties in same state", () => {
    const territories: Territory[] = [
      { id: 1, name: "A", stateCode: "TX", counties: ["Dallas", "Tarrant"] },
      { id: 2, name: "B", stateCode: "TX", counties: ["Dallas", "Collin"] },
    ];
    const overlaps = detectOverlaps(territories);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].overlappingCounties).toContain("dallas");
  });

  it("returns empty array for non-overlapping territories", () => {
    const territories: Territory[] = [
      { id: 1, name: "A", stateCode: "TX", counties: ["Dallas"] },
      { id: 2, name: "B", stateCode: "TX", counties: ["Harris"] },
    ];
    expect(detectOverlaps(territories)).toHaveLength(0);
  });

  it("does not flag overlaps across different states", () => {
    const territories: Territory[] = [
      { id: 1, name: "A", stateCode: "TX", counties: ["Dallas"] },
      { id: 2, name: "B", stateCode: "GA", counties: ["Dallas"] },
    ];
    expect(detectOverlaps(territories)).toHaveLength(0);
  });
});

describe("getTerritoryStats", () => {
  const territory: Territory = {
    id: 1,
    name: "North TX",
    stateCode: "TX",
    counties: ["Dallas", "Collin"],
    assignedUserId: 5,
  };

  const leads = [
    { stateCode: "TX", county: "Dallas" },
    { stateCode: "TX", county: "Dallas" },
    { stateCode: "TX", county: "Collin" },
    { stateCode: "TX", county: "Harris" }, // not in territory
    { stateCode: "CA", county: "Dallas" }, // wrong state
  ];

  it("counts matching leads", () => {
    const stats = getTerritoryStats(territory, leads);
    expect(stats.totalLeads).toBe(3);
  });

  it("reports assigned leads when user assigned", () => {
    const stats = getTerritoryStats(territory, leads);
    expect(stats.assignedLeads).toBe(3);
  });

  it("reports 0 assigned leads when no user assigned", () => {
    const unassigned = { ...territory, assignedUserId: undefined };
    const stats = getTerritoryStats(unassigned, leads);
    expect(stats.assignedLeads).toBe(0);
  });
});

describe("validateTerritoryName", () => {
  it("accepts valid name", () => {
    expect(validateTerritoryName("North Texas").valid).toBe(true);
  });

  it("rejects empty name", () => {
    expect(validateTerritoryName("").valid).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    expect(validateTerritoryName("   ").valid).toBe(false);
  });

  it("rejects name over 100 chars", () => {
    expect(validateTerritoryName("A".repeat(101)).valid).toBe(false);
  });

  it("accepts name at exactly 100 chars", () => {
    expect(validateTerritoryName("A".repeat(100)).valid).toBe(true);
  });
});
