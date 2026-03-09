/**
 * T189 — Commission Service Tests
 * Tests tiered commission rate lookup, commission calculation, and statement generation.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface CommissionTier {
  minDeals: number;
  ratePercent: number;
  label: string;
}

interface CommissionConfig {
  tiers: CommissionTier[];
  baseFlatAmount?: number;
  trackingPeriod: "monthly" | "quarterly" | "annual";
}

const DEFAULT_CONFIG: CommissionConfig = {
  tiers: [
    { minDeals: 0,  ratePercent: 3.0, label: "Standard" },
    { minDeals: 5,  ratePercent: 4.0, label: "Silver"   },
    { minDeals: 10, ratePercent: 5.0, label: "Gold"     },
    { minDeals: 20, ratePercent: 6.0, label: "Platinum" },
  ],
  trackingPeriod: "annual",
};

function getCurrentTier(closedDeals: number, config: CommissionConfig): CommissionTier {
  const sorted = [...config.tiers].sort((a, b) => b.minDeals - a.minDeals);
  return sorted.find(t => closedDeals >= t.minDeals) ?? config.tiers[0];
}

function calculateCommission(
  salePriceCents: number,
  closedDeals: number,
  config: CommissionConfig
): { ratePercent: number; commissionCents: number; flatBonusCents: number; totalCents: number; tier: string } {
  const tier = getCurrentTier(closedDeals, config);
  const commissionCents = Math.round(salePriceCents * (tier.ratePercent / 100));
  const flatBonusCents = config.baseFlatAmount ?? 0;
  return {
    ratePercent: tier.ratePercent,
    commissionCents,
    flatBonusCents,
    totalCents: commissionCents + flatBonusCents,
    tier: tier.label,
  };
}

function formatCentsAsDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function summarizeCommissions(records: Array<{ totalOwedCents: number; paidCents: number; status: string }>): {
  totalOwedCents: number;
  totalPaidCents: number;
  outstandingCents: number;
  paidCount: number;
  owedCount: number;
} {
  const totalOwedCents = records.reduce((s, r) => s + r.totalOwedCents, 0);
  const totalPaidCents = records.reduce((s, r) => s + r.paidCents, 0);
  return {
    totalOwedCents,
    totalPaidCents,
    outstandingCents: totalOwedCents - totalPaidCents,
    paidCount: records.filter(r => r.status === "paid").length,
    owedCount: records.filter(r => r.status === "owed").length,
  };
}

function determineCommissionStatus(totalOwedCents: number, paidCents: number): "owed" | "partial" | "paid" {
  if (paidCents <= 0) return "owed";
  if (paidCents >= totalOwedCents) return "paid";
  return "partial";
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getCurrentTier", () => {
  it("returns Standard tier for 0 deals", () => {
    const tier = getCurrentTier(0, DEFAULT_CONFIG);
    expect(tier.label).toBe("Standard");
    expect(tier.ratePercent).toBe(3.0);
  });

  it("returns Standard for 4 deals (below Silver threshold)", () => {
    expect(getCurrentTier(4, DEFAULT_CONFIG).label).toBe("Standard");
  });

  it("returns Silver for exactly 5 deals", () => {
    const tier = getCurrentTier(5, DEFAULT_CONFIG);
    expect(tier.label).toBe("Silver");
    expect(tier.ratePercent).toBe(4.0);
  });

  it("returns Gold for 10-19 deals", () => {
    expect(getCurrentTier(10, DEFAULT_CONFIG).label).toBe("Gold");
    expect(getCurrentTier(15, DEFAULT_CONFIG).label).toBe("Gold");
  });

  it("returns Platinum for 20+ deals", () => {
    expect(getCurrentTier(20, DEFAULT_CONFIG).label).toBe("Platinum");
    expect(getCurrentTier(50, DEFAULT_CONFIG).label).toBe("Platinum");
  });
});

describe("calculateCommission", () => {
  it("calculates standard 3% commission", () => {
    // $100,000 sale, 0 deals = Standard 3%
    const result = calculateCommission(10_000_000, 0, DEFAULT_CONFIG);
    expect(result.ratePercent).toBe(3.0);
    expect(result.commissionCents).toBe(300_000); // $3,000
    expect(result.flatBonusCents).toBe(0);
    expect(result.totalCents).toBe(300_000);
    expect(result.tier).toBe("Standard");
  });

  it("calculates Silver 4% commission", () => {
    const result = calculateCommission(10_000_000, 7, DEFAULT_CONFIG);
    expect(result.ratePercent).toBe(4.0);
    expect(result.commissionCents).toBe(400_000);
  });

  it("includes flat bonus in total", () => {
    const configWithBonus: CommissionConfig = {
      ...DEFAULT_CONFIG,
      baseFlatAmount: 50_000, // $500 flat
    };
    const result = calculateCommission(10_000_000, 0, configWithBonus);
    expect(result.totalCents).toBe(300_000 + 50_000);
  });

  it("calculates Platinum 6% for 20+ deals", () => {
    const result = calculateCommission(5_000_000, 25, DEFAULT_CONFIG); // $50k sale
    expect(result.ratePercent).toBe(6.0);
    expect(result.commissionCents).toBe(300_000);
  });

  it("rounds commission to nearest cent", () => {
    // $33.33 sale at 3% = $0.9999 → $1.00 = 100 cents
    const result = calculateCommission(3333, 0, DEFAULT_CONFIG);
    expect(result.commissionCents).toBe(Math.round(3333 * 0.03));
  });
});

describe("formatCentsAsDollars", () => {
  it("formats whole dollars", () => {
    expect(formatCentsAsDollars(100_00)).toBe("$100.00");
  });

  it("formats thousands with commas", () => {
    expect(formatCentsAsDollars(1_000_000)).toBe("$10,000.00");
  });

  it("formats zero", () => {
    expect(formatCentsAsDollars(0)).toBe("$0.00");
  });

  it("formats cents correctly", () => {
    expect(formatCentsAsDollars(50)).toBe("$0.50");
  });
});

describe("summarizeCommissions", () => {
  const records = [
    { totalOwedCents: 500_00, paidCents: 500_00, status: "paid" },
    { totalOwedCents: 300_00, paidCents: 0, status: "owed" },
    { totalOwedCents: 400_00, paidCents: 200_00, status: "partial" },
  ];

  it("sums total owed correctly", () => {
    const summary = summarizeCommissions(records);
    expect(summary.totalOwedCents).toBe(1200_00);
  });

  it("sums total paid correctly", () => {
    const summary = summarizeCommissions(records);
    expect(summary.totalPaidCents).toBe(700_00);
  });

  it("calculates outstanding", () => {
    const summary = summarizeCommissions(records);
    expect(summary.outstandingCents).toBe(500_00);
  });

  it("counts paid and owed records", () => {
    const summary = summarizeCommissions(records);
    expect(summary.paidCount).toBe(1);
    expect(summary.owedCount).toBe(1);
  });

  it("handles empty records", () => {
    const summary = summarizeCommissions([]);
    expect(summary.totalOwedCents).toBe(0);
    expect(summary.outstandingCents).toBe(0);
  });
});

describe("determineCommissionStatus", () => {
  it("returns owed when nothing paid", () => {
    expect(determineCommissionStatus(100_00, 0)).toBe("owed");
  });

  it("returns paid when fully paid", () => {
    expect(determineCommissionStatus(100_00, 100_00)).toBe("paid");
  });

  it("returns paid when overpaid", () => {
    expect(determineCommissionStatus(100_00, 150_00)).toBe("paid");
  });

  it("returns partial when partially paid", () => {
    expect(determineCommissionStatus(100_00, 50_00)).toBe("partial");
  });
});
