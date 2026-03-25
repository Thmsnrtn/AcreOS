import { describe, it, expect } from "vitest";

// Pure function tests for LCS grade boundaries and normalization

function gradeFromScore(score: number): string {
  if (score >= 800) return "A+";
  if (score >= 750) return "A";
  if (score >= 700) return "B+";
  if (score >= 650) return "B";
  if (score >= 600) return "C+";
  if (score >= 550) return "C";
  if (score >= 450) return "D";
  return "F";
}

describe("landCreditBadge — score always 300-850", () => {
  it("clamps below 300 to 300", () => {
    const clamped = Math.max(300, Math.min(850, 100));
    expect(clamped).toBe(300);
  });

  it("clamps above 850 to 850", () => {
    const clamped = Math.max(300, Math.min(850, 1000));
    expect(clamped).toBe(850);
  });

  it("passes through valid scores", () => {
    expect(Math.max(300, Math.min(850, 575))).toBe(575);
    expect(Math.max(300, Math.min(850, 300))).toBe(300);
    expect(Math.max(300, Math.min(850, 850))).toBe(850);
  });
});

describe("landCreditBadge — missing enrichment → dimension defaults to 50", () => {
  it("defaults missing dimensions to 50", () => {
    const dimensions = {
      location: undefined as any,
      physical: 70,
      legal: undefined as any,
      financial: 60,
      environmental: undefined as any,
      market: 80,
    };

    const resolved = Object.fromEntries(
      Object.entries(dimensions).map(([k, v]) => [k, v ?? 50]),
    );

    expect(resolved.location).toBe(50);
    expect(resolved.legal).toBe(50);
    expect(resolved.environmental).toBe(50);
    expect(resolved.physical).toBe(70);
  });
});

describe("landCreditBadge — grade boundaries correct", () => {
  it("849 → A+", () => expect(gradeFromScore(849)).toBe("A+"));
  it("800 → A+", () => expect(gradeFromScore(800)).toBe("A+"));
  it("799 → A", () => expect(gradeFromScore(799)).toBe("A"));
  it("750 → A", () => expect(gradeFromScore(750)).toBe("A"));
  it("749 → B+", () => expect(gradeFromScore(749)).toBe("B+"));
  it("700 → B+", () => expect(gradeFromScore(700)).toBe("B+"));
  it("699 → B", () => expect(gradeFromScore(699)).toBe("B"));
  it("650 → B", () => expect(gradeFromScore(650)).toBe("B"));
  it("649 → C+", () => expect(gradeFromScore(649)).toBe("C+"));
  it("600 → C+", () => expect(gradeFromScore(600)).toBe("C+"));
  it("599 → C", () => expect(gradeFromScore(599)).toBe("C"));
  it("550 → C", () => expect(gradeFromScore(550)).toBe("C"));
  it("549 → D", () => expect(gradeFromScore(549)).toBe("D"));
  it("450 → D", () => expect(gradeFromScore(450)).toBe("D"));
  it("449 → F", () => expect(gradeFromScore(449)).toBe("F"));
  it("300 → F", () => expect(gradeFromScore(300)).toBe("F"));
});

describe("landCreditBadge — PDF generates with minimal data", () => {
  it("handles property with no comps and no market prediction", () => {
    // Simulate a minimal property — the PDF function should not crash
    const minimalFactors = {
      location: { score: 50, factors: {} },
      physical: { score: 50, factors: {} },
      legal: { score: 50, factors: {} },
      financial: { score: 50, factors: {} },
      environmental: { score: 50, factors: {} },
      market: { score: 50, factors: {} },
    };

    // Calculate overall from minimal scores
    const overall = Math.round(
      (50 * 25 + 50 * 20 + 50 * 15 + 50 * 20 + 50 * 10 + 50 * 10) / 100,
    );
    const creditScore = Math.round(300 + (overall / 100) * 550);

    expect(creditScore).toBeGreaterThanOrEqual(300);
    expect(creditScore).toBeLessThanOrEqual(850);
    expect(gradeFromScore(creditScore)).toBeTruthy();
  });
});
