/**
 * T265 — Cohort Analysis Tests
 * Tests cohort segmentation helpers, rate calculations, and label formatting.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type CohortSegment =
  | "source"
  | "state"
  | "county"
  | "campaign"
  | "import_month"
  | "import_quarter";

interface CohortRow {
  segment: string;
  totalLeads: number;
  contacted: number;
  offerSent: number;
  underContract: number;
  closed: number;
  contactedRate: number;
  offerRate: number;
  closedRate: number;
  avgDaysToClose: number | null;
}

function quarterLabel(date: Date): string {
  const q = Math.floor(date.getMonth() / 3) + 1;
  return `Q${q} ${date.getFullYear()}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

function calculateRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100; // 2 decimal places
}

function buildCohortRow(
  segment: string,
  totalLeads: number,
  contacted: number,
  offerSent: number,
  underContract: number,
  closed: number,
  avgDaysToClose: number | null = null
): CohortRow {
  return {
    segment,
    totalLeads,
    contacted,
    offerSent,
    underContract,
    closed,
    contactedRate: calculateRate(contacted, totalLeads),
    offerRate: calculateRate(offerSent, totalLeads),
    closedRate: calculateRate(closed, totalLeads),
    avgDaysToClose,
  };
}

function calculateOverallClosedRate(cohorts: CohortRow[]): number {
  const totalLeads = cohorts.reduce((s, c) => s + c.totalLeads, 0);
  const totalClosed = cohorts.reduce((s, c) => s + c.closed, 0);
  return calculateRate(totalClosed, totalLeads);
}

function rankCohortsByCloseRate(cohorts: CohortRow[]): CohortRow[] {
  return [...cohorts].sort((a, b) => b.closedRate - a.closedRate);
}

function filterCohortsByMinLeads(cohorts: CohortRow[], minLeads: number): CohortRow[] {
  return cohorts.filter(c => c.totalLeads >= minLeads);
}

function getTopPerformingSegment(cohorts: CohortRow[]): string | null {
  if (cohorts.length === 0) return null;
  return rankCohortsByCloseRate(cohorts)[0].segment;
}

function summarizeCohorts(cohorts: CohortRow[]): {
  totalLeads: number;
  totalClosed: number;
  overallClosedRate: number;
  bestSegment: string | null;
  worstSegment: string | null;
} {
  const totalLeads = cohorts.reduce((s, c) => s + c.totalLeads, 0);
  const totalClosed = cohorts.reduce((s, c) => s + c.closed, 0);
  const ranked = rankCohortsByCloseRate(cohorts);
  return {
    totalLeads,
    totalClosed,
    overallClosedRate: calculateRate(totalClosed, totalLeads),
    bestSegment: ranked[0]?.segment ?? null,
    worstSegment: ranked[ranked.length - 1]?.segment ?? null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("quarterLabel", () => {
  it("returns Q1 for January", () => {
    expect(quarterLabel(new Date("2024-01-15"))).toBe("Q1 2024");
  });

  it("returns Q2 for April", () => {
    expect(quarterLabel(new Date("2024-04-01"))).toBe("Q2 2024");
  });

  it("returns Q3 for July", () => {
    expect(quarterLabel(new Date("2024-07-20"))).toBe("Q3 2024");
  });

  it("returns Q4 for October", () => {
    expect(quarterLabel(new Date("2024-10-31"))).toBe("Q4 2024");
  });

  it("includes the year", () => {
    expect(quarterLabel(new Date("2025-03-01"))).toBe("Q1 2025");
  });
});

describe("monthLabel", () => {
  it("formats Jan 2024", () => {
    const label = monthLabel(new Date("2024-01-01"));
    expect(label).toContain("2024");
    expect(label.toLowerCase()).toContain("jan");
  });

  it("formats Dec 2023", () => {
    const label = monthLabel(new Date("2023-12-15"));
    expect(label).toContain("2023");
    expect(label.toLowerCase()).toContain("dec");
  });
});

describe("calculateRate", () => {
  it("calculates percentage to 2 decimal places", () => {
    expect(calculateRate(3, 10)).toBe(30);
    expect(calculateRate(1, 3)).toBeCloseTo(33.33, 1);
  });

  it("returns 0 for zero denominator", () => {
    expect(calculateRate(5, 0)).toBe(0);
  });

  it("returns 100 for equal numerator and denominator", () => {
    expect(calculateRate(10, 10)).toBe(100);
  });
});

describe("buildCohortRow", () => {
  it("builds a cohort row with computed rates", () => {
    const row = buildCohortRow("direct_mail", 100, 60, 20, 10, 5, 45);
    expect(row.segment).toBe("direct_mail");
    expect(row.totalLeads).toBe(100);
    expect(row.contactedRate).toBe(60);
    expect(row.offerRate).toBe(20);
    expect(row.closedRate).toBe(5);
    expect(row.avgDaysToClose).toBe(45);
  });

  it("defaults avgDaysToClose to null", () => {
    const row = buildCohortRow("email", 50, 30, 10, 5, 2);
    expect(row.avgDaysToClose).toBeNull();
  });
});

describe("calculateOverallClosedRate", () => {
  it("calculates weighted close rate across cohorts", () => {
    const cohorts = [
      buildCohortRow("sms", 100, 50, 20, 10, 10),
      buildCohortRow("direct_mail", 100, 60, 30, 15, 20),
    ];
    // 30 closed / 200 total = 15%
    expect(calculateOverallClosedRate(cohorts)).toBe(15);
  });

  it("returns 0 for empty cohort list", () => {
    expect(calculateOverallClosedRate([])).toBe(0);
  });
});

describe("rankCohortsByCloseRate", () => {
  it("sorts by closedRate descending", () => {
    const cohorts = [
      buildCohortRow("A", 100, 50, 20, 10, 5),  // 5%
      buildCohortRow("B", 100, 60, 40, 20, 20), // 20%
      buildCohortRow("C", 100, 40, 10, 5, 10),  // 10%
    ];
    const ranked = rankCohortsByCloseRate(cohorts);
    expect(ranked[0].segment).toBe("B");
    expect(ranked[1].segment).toBe("C");
    expect(ranked[2].segment).toBe("A");
  });

  it("does not mutate original array", () => {
    const cohorts = [
      buildCohortRow("X", 100, 50, 20, 10, 5),
      buildCohortRow("Y", 100, 60, 40, 20, 20),
    ];
    const original = cohorts.map(c => c.segment);
    rankCohortsByCloseRate(cohorts);
    expect(cohorts.map(c => c.segment)).toEqual(original);
  });
});

describe("filterCohortsByMinLeads", () => {
  it("filters out cohorts with fewer than minimum leads", () => {
    const cohorts = [
      buildCohortRow("small", 5, 3, 1, 0, 0),
      buildCohortRow("large", 100, 60, 20, 10, 5),
    ];
    const filtered = filterCohortsByMinLeads(cohorts, 10);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].segment).toBe("large");
  });

  it("includes cohorts meeting the threshold exactly", () => {
    const cohorts = [buildCohortRow("exact", 10, 5, 2, 1, 1)];
    expect(filterCohortsByMinLeads(cohorts, 10)).toHaveLength(1);
  });
});

describe("getTopPerformingSegment", () => {
  it("returns segment with highest close rate", () => {
    const cohorts = [
      buildCohortRow("sms", 100, 50, 20, 10, 2),
      buildCohortRow("email", 100, 60, 30, 15, 15),
    ];
    expect(getTopPerformingSegment(cohorts)).toBe("email");
  });

  it("returns null for empty list", () => {
    expect(getTopPerformingSegment([])).toBeNull();
  });
});

describe("summarizeCohorts", () => {
  it("computes totals and best/worst segments", () => {
    const cohorts = [
      buildCohortRow("direct_mail", 100, 60, 30, 15, 10),  // 10% close
      buildCohortRow("email", 200, 120, 60, 30, 40),        // 20% close
      buildCohortRow("cold_call", 50, 20, 5, 2, 2),         // 4% close
    ];
    const summary = summarizeCohorts(cohorts);
    expect(summary.totalLeads).toBe(350);
    expect(summary.totalClosed).toBe(52);
    expect(summary.overallClosedRate).toBeCloseTo(14.86, 1);
    expect(summary.bestSegment).toBe("email");
    expect(summary.worstSegment).toBe("cold_call");
  });
});
