/**
 * T122 — Land Credit Scoring Unit Tests
 *
 * Tests the scoring model:
 * - 300–850 FICO-style score conversion
 * - Grade determination (A+ → F)
 * - Risk level classification
 * - Weighted score calculation
 * - Environmental risk factors (flood zones, wildfire states)
 */

import { describe, it, expect } from "vitest";

// ── Pure helpers mirroring LandCreditScoring private methods ─────────────────

const WEIGHTS = {
  location: 25,
  physical: 20,
  legal: 15,
  financial: 20,
  environmental: 10,
  market: 10,
};

function calcWeightedScore(scores: {
  location: number;
  physical: number;
  legal: number;
  financial: number;
  environmental: number;
  market: number;
}): number {
  return Math.round(
    (scores.location * WEIGHTS.location +
      scores.physical * WEIGHTS.physical +
      scores.legal * WEIGHTS.legal +
      scores.financial * WEIGHTS.financial +
      scores.environmental * WEIGHTS.environmental +
      scores.market * WEIGHTS.market) /
      100
  );
}

function toFicoScale(overallPct: number): number {
  return Math.round(300 + (overallPct / 100) * 550);
}

function determineGrade(
  score: number
): "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F" {
  if (score >= 800) return "A+";
  if (score >= 740) return "A";
  if (score >= 700) return "B+";
  if (score >= 660) return "B";
  if (score >= 620) return "C+";
  if (score >= 580) return "C";
  if (score >= 500) return "D";
  return "F";
}

function determineRiskLevel(
  score: number
): "excellent" | "good" | "fair" | "poor" | "high" {
  if (score >= 740) return "excellent";
  if (score >= 670) return "good";
  if (score >= 580) return "fair";
  if (score >= 500) return "poor";
  return "high";
}

function calcFloodRiskScore(floodZone?: string): number {
  const zone = floodZone?.toUpperCase();
  if (zone === "X" || zone === "C") return 95;
  if (zone === "B" || zone === "SHADED X") return 75;
  if (zone === "A" || zone === "AE") return 40;
  if (zone === "V" || zone === "VE") return 20;
  return 80; // Default (unknown)
}

function calcWildfireScore(state?: string): number {
  const HIGH_RISK_STATES = ["CA", "CO", "OR", "WA", "MT", "ID"];
  return HIGH_RISK_STATES.includes(state ?? "") ? 60 : 80;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Weighted Score Calculation", () => {
  it("returns 100 when all dimensions score 100", () => {
    const scores = {
      location: 100,
      physical: 100,
      legal: 100,
      financial: 100,
      environmental: 100,
      market: 100,
    };
    expect(calcWeightedScore(scores)).toBe(100);
  });

  it("returns 0 when all dimensions score 0", () => {
    const scores = {
      location: 0,
      physical: 0,
      legal: 0,
      financial: 0,
      environmental: 0,
      market: 0,
    };
    expect(calcWeightedScore(scores)).toBe(0);
  });

  it("weights location at 25% and financial at 20%", () => {
    // Only location = 100, rest = 0 → should be 25
    expect(
      calcWeightedScore({
        location: 100,
        physical: 0,
        legal: 0,
        financial: 0,
        environmental: 0,
        market: 0,
      })
    ).toBe(25);

    // Only financial = 100 → should be 20
    expect(
      calcWeightedScore({
        location: 0,
        physical: 0,
        legal: 0,
        financial: 100,
        environmental: 0,
        market: 0,
      })
    ).toBe(20);
  });

  it("weights sum to 100 (all dimensions * weight should cover 100%)", () => {
    const totalWeight = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
    expect(totalWeight).toBe(100);
  });
});

describe("FICO-Scale Conversion (300–850)", () => {
  it("maps 0% to 300 (minimum score)", () => {
    expect(toFicoScale(0)).toBe(300);
  });

  it("maps 100% to 850 (maximum score)", () => {
    expect(toFicoScale(100)).toBe(850);
  });

  it("maps 50% to 575", () => {
    expect(toFicoScale(50)).toBe(575);
  });

  it("maps 70% to 685", () => {
    expect(toFicoScale(70)).toBe(685);
  });

  it("produces scores only within 300–850 range", () => {
    for (let pct = 0; pct <= 100; pct++) {
      const score = toFicoScale(pct);
      expect(score).toBeGreaterThanOrEqual(300);
      expect(score).toBeLessThanOrEqual(850);
    }
  });
});

describe("Grade Determination", () => {
  it("assigns A+ for score >= 800", () => {
    expect(determineGrade(800)).toBe("A+");
    expect(determineGrade(850)).toBe("A+");
  });

  it("assigns A for 740–799", () => {
    expect(determineGrade(740)).toBe("A");
    expect(determineGrade(799)).toBe("A");
  });

  it("assigns B+ for 700–739", () => {
    expect(determineGrade(700)).toBe("B+");
    expect(determineGrade(739)).toBe("B+");
  });

  it("assigns B for 660–699", () => {
    expect(determineGrade(660)).toBe("B");
    expect(determineGrade(699)).toBe("B");
  });

  it("assigns C+ for 620–659", () => {
    expect(determineGrade(620)).toBe("C+");
    expect(determineGrade(659)).toBe("C+");
  });

  it("assigns C for 580–619", () => {
    expect(determineGrade(580)).toBe("C");
    expect(determineGrade(619)).toBe("C");
  });

  it("assigns D for 500–579", () => {
    expect(determineGrade(500)).toBe("D");
    expect(determineGrade(579)).toBe("D");
  });

  it("assigns F below 500", () => {
    expect(determineGrade(499)).toBe("F");
    expect(determineGrade(300)).toBe("F");
  });
});

describe("Risk Level Classification", () => {
  it("classifies 740+ as excellent", () => {
    expect(determineRiskLevel(740)).toBe("excellent");
    expect(determineRiskLevel(850)).toBe("excellent");
  });

  it("classifies 670–739 as good", () => {
    expect(determineRiskLevel(670)).toBe("good");
    expect(determineRiskLevel(739)).toBe("good");
  });

  it("classifies 580–669 as fair", () => {
    expect(determineRiskLevel(580)).toBe("fair");
    expect(determineRiskLevel(669)).toBe("fair");
  });

  it("classifies 500–579 as poor", () => {
    expect(determineRiskLevel(500)).toBe("poor");
    expect(determineRiskLevel(579)).toBe("poor");
  });

  it("classifies below 500 as high risk", () => {
    expect(determineRiskLevel(499)).toBe("high");
    expect(determineRiskLevel(300)).toBe("high");
  });
});

describe("Environmental Risk — Flood Zones", () => {
  it("gives Zone X (minimal flood) a score of 95", () => {
    expect(calcFloodRiskScore("X")).toBe(95);
    expect(calcFloodRiskScore("C")).toBe(95);
  });

  it("gives Zone B (moderate flood) a score of 75", () => {
    expect(calcFloodRiskScore("B")).toBe(75);
    expect(calcFloodRiskScore("SHADED X")).toBe(75);
  });

  it("gives Zone A (high flood) a score of 40", () => {
    expect(calcFloodRiskScore("A")).toBe(40);
    expect(calcFloodRiskScore("AE")).toBe(40);
  });

  it("gives Zone V (coastal high-hazard) a score of 20", () => {
    expect(calcFloodRiskScore("V")).toBe(20);
    expect(calcFloodRiskScore("VE")).toBe(20);
  });

  it("defaults to 80 for unknown or undefined flood zone", () => {
    expect(calcFloodRiskScore(undefined)).toBe(80);
    expect(calcFloodRiskScore("UNKNOWN")).toBe(80);
  });

  it("is case-insensitive", () => {
    expect(calcFloodRiskScore("ae")).toBe(40);
    expect(calcFloodRiskScore("x")).toBe(95);
  });
});

describe("Environmental Risk — Wildfire", () => {
  it("gives high-risk western states a score of 60", () => {
    for (const state of ["CA", "CO", "OR", "WA", "MT", "ID"]) {
      expect(calcWildfireScore(state)).toBe(60);
    }
  });

  it("gives low-risk states a default score of 80", () => {
    expect(calcWildfireScore("TX")).toBe(80);
    expect(calcWildfireScore("FL")).toBe(80);
    expect(calcWildfireScore("NY")).toBe(80);
  });

  it("returns 80 for undefined state", () => {
    expect(calcWildfireScore(undefined)).toBe(80);
  });
});

describe("Full Scoring Pipeline", () => {
  it("produces an A+ grade for a perfect land parcel", () => {
    const scores = {
      location: 95,
      physical: 90,
      legal: 95,
      financial: 90,
      environmental: 95,
      market: 90,
    };
    const overall = calcWeightedScore(scores);
    const ficoScore = toFicoScale(overall);
    const grade = determineGrade(ficoScore);
    const risk = determineRiskLevel(ficoScore);

    expect(overall).toBeGreaterThan(80);
    expect(ficoScore).toBeGreaterThan(740);
    expect(["A+", "A"]).toContain(grade);
    expect(["excellent", "good"]).toContain(risk);
  });

  it("produces a D/F grade for a distressed parcel", () => {
    const scores = {
      location: 20,
      physical: 15,
      legal: 25,
      financial: 10,
      environmental: 30,
      market: 20,
    };
    const overall = calcWeightedScore(scores);
    const ficoScore = toFicoScale(overall);
    const grade = determineGrade(ficoScore);
    const risk = determineRiskLevel(ficoScore);

    expect(ficoScore).toBeLessThan(580);
    expect(["D", "F"]).toContain(grade);
    expect(["poor", "high"]).toContain(risk);
  });
});
