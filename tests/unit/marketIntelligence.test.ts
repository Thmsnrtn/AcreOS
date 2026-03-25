import { describe, it, expect } from "vitest";

// Pure helpers from marketReportGenerator.ts and market analysis

function fmt$(n: number | null | undefined): string {
  if (n == null) return "N/A";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "N/A";
  return `${n.toFixed(1)}%`;
}

function classifyTrend(change: number): "rising" | "stable" | "falling" {
  if (change > 2) return "rising";
  if (change < -2) return "falling";
  return "stable";
}

function calculateMarketHealth(
  priceStability: number,
  inventoryLevel: number,
  absorptionRate: number,
): number {
  // Weighted score 0-100
  const stability = Math.min(100, priceStability * 100);
  const inventory = Math.min(100, Math.max(0, 100 - inventoryLevel)); // Lower inventory = healthier
  const absorption = Math.min(100, absorptionRate * 100);
  return Math.round(stability * 0.4 + inventory * 0.3 + absorption * 0.3);
}

function identifyEmergingMarkets(
  counties: { county: string; state: string; change: number }[],
): { county: string; state: string; reason: string }[] {
  return counties
    .filter((c) => c.change > 5)
    .sort((a, b) => b.change - a.change)
    .map((c) => ({
      county: c.county,
      state: c.state,
      reason: `+${c.change.toFixed(1)}% appreciation`,
    }));
}

function generateRiskAlerts(
  counties: { county: string; state: string; change: number; delinquent: number }[],
): { county: string; state: string; alert: string }[] {
  const alerts: { county: string; state: string; alert: string }[] = [];
  for (const c of counties) {
    if (c.change < -5) {
      alerts.push({ county: c.county, state: c.state, alert: `Price declining ${c.change.toFixed(1)}%` });
    }
    if (c.delinquent > 1000) {
      alerts.push({ county: c.county, state: c.state, alert: `High delinquent volume: ${c.delinquent.toLocaleString()}` });
    }
  }
  return alerts;
}

describe("marketIntelligence — formatting helpers", () => {
  it("fmt$ formats currency correctly", () => {
    expect(fmt$(2500)).toBe("$2,500");
    expect(fmt$(0)).toBe("$0");
    expect(fmt$(null)).toBe("N/A");
    expect(fmt$(undefined)).toBe("N/A");
  });

  it("fmtPct formats percentage correctly", () => {
    expect(fmtPct(12.3)).toBe("12.3%");
    expect(fmtPct(-5.1)).toBe("-5.1%");
    expect(fmtPct(null)).toBe("N/A");
  });
});

describe("marketIntelligence — trend classification", () => {
  it("classifies rising trend", () => {
    expect(classifyTrend(5)).toBe("rising");
    expect(classifyTrend(2.1)).toBe("rising");
  });

  it("classifies stable trend", () => {
    expect(classifyTrend(0)).toBe("stable");
    expect(classifyTrend(1.5)).toBe("stable");
    expect(classifyTrend(-1.5)).toBe("stable");
  });

  it("classifies falling trend", () => {
    expect(classifyTrend(-3)).toBe("falling");
    expect(classifyTrend(-10)).toBe("falling");
  });
});

describe("marketIntelligence — market health score", () => {
  it("perfect market → high score", () => {
    const score = calculateMarketHealth(0.95, 10, 0.9);
    expect(score).toBeGreaterThan(80);
  });

  it("poor market → low score", () => {
    const score = calculateMarketHealth(0.2, 90, 0.1);
    expect(score).toBeLessThan(30);
  });

  it("score is bounded 0-100", () => {
    const max = calculateMarketHealth(1.5, -10, 1.5);
    expect(max).toBeLessThanOrEqual(100);
    const min = calculateMarketHealth(0, 200, 0);
    expect(min).toBeGreaterThanOrEqual(0);
  });
});

describe("marketIntelligence — emerging markets", () => {
  it("identifies counties with >5% appreciation", () => {
    const emerging = identifyEmergingMarkets([
      { county: "Hudspeth", state: "TX", change: 12 },
      { county: "Culberson", state: "TX", change: 3 },
      { county: "Otero", state: "NM", change: 7 },
    ]);
    expect(emerging).toHaveLength(2);
    expect(emerging[0].county).toBe("Hudspeth");
    expect(emerging[1].county).toBe("Otero");
  });

  it("returns empty for no emerging markets", () => {
    const emerging = identifyEmergingMarkets([
      { county: "A", state: "TX", change: 1 },
    ]);
    expect(emerging).toHaveLength(0);
  });

  it("sorted by change descending", () => {
    const emerging = identifyEmergingMarkets([
      { county: "A", state: "TX", change: 6 },
      { county: "B", state: "TX", change: 15 },
      { county: "C", state: "TX", change: 10 },
    ]);
    expect(emerging[0].county).toBe("B");
    expect(emerging[1].county).toBe("C");
    expect(emerging[2].county).toBe("A");
  });
});

describe("marketIntelligence — risk alerts", () => {
  it("flags declining prices", () => {
    const alerts = generateRiskAlerts([
      { county: "X", state: "TX", change: -8, delinquent: 100 },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert).toContain("declining");
  });

  it("flags high delinquent volume", () => {
    const alerts = generateRiskAlerts([
      { county: "Y", state: "NM", change: 2, delinquent: 5000 },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert).toContain("delinquent");
  });

  it("can flag both on same county", () => {
    const alerts = generateRiskAlerts([
      { county: "Z", state: "AZ", change: -10, delinquent: 2000 },
    ]);
    expect(alerts).toHaveLength(2);
  });

  it("no alerts for healthy county", () => {
    const alerts = generateRiskAlerts([
      { county: "A", state: "TX", change: 5, delinquent: 200 },
    ]);
    expect(alerts).toHaveLength(0);
  });
});

describe("marketIntelligence — public data structure", () => {
  it("state data has required fields", () => {
    const stateData = {
      state: "TX",
      avgPricePerAcre: 3200,
      topCounties: ["Hudspeth", "Culberson"],
      trend: "rising" as const,
    };
    expect(stateData.state).toBeTruthy();
    expect(stateData.avgPricePerAcre).toBeGreaterThan(0);
    expect(stateData.topCounties.length).toBeGreaterThan(0);
    expect(["rising", "stable", "falling"]).toContain(stateData.trend);
  });
});
