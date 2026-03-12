/**
 * T273 — A/B Test Engine Tests
 * Tests deterministic variant assignment, outcome tracking, and result calculation.
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface AbVariant {
  id: string;
  name: string;
  description: string;
  weight: number; // 0-100, weights should sum to 100
}

interface AbTest {
  id: string;
  name: string;
  orgId: number;
  variants: AbVariant[];
  metric: "open_rate" | "response_rate" | "conversion_rate";
  startedAt: Date;
  status: "active" | "paused" | "completed";
}

interface AbOutcome {
  testId: string;
  variantId: string;
  leadId: number;
  event: "sent" | "opened" | "replied" | "converted" | "unsubscribed";
  timestamp: Date;
}

function getVariant(test: AbTest, leadId: number): AbVariant {
  const hash = crypto
    .createHash("sha256")
    .update(`${test.id}:${leadId}`)
    .digest();
  const bucket = hash[0] % 100;

  let cumulative = 0;
  for (const variant of test.variants) {
    cumulative += variant.weight;
    if (bucket < cumulative) return variant;
  }
  return test.variants[test.variants.length - 1];
}

function calculateConfidence(
  controlConversions: number,
  controlTotal: number,
  variantConversions: number,
  variantTotal: number
): number {
  if (controlTotal === 0 || variantTotal === 0) return 0;

  const p1 = controlConversions / controlTotal;
  const p2 = variantConversions / variantTotal;
  const p = (controlConversions + variantConversions) / (controlTotal + variantTotal);

  if (p === 0 || p === 1) return 0;

  const se = Math.sqrt(p * (1 - p) * (1 / controlTotal + 1 / variantTotal));
  if (se === 0) return 0;

  const z = Math.abs(p1 - p2) / se;
  if (z >= 2.576) return 0.99;
  if (z >= 1.96) return 0.95;
  if (z >= 1.645) return 0.90;
  if (z >= 1.282) return 0.80;
  return Math.min(0.79, (z / 1.282) * 0.80);
}

function getResults(test: AbTest, outcomes: AbOutcome[]) {
  const MIN_SAMPLE = 50;
  const testOutcomes = outcomes.filter(o => o.testId === test.id);

  const variantStats = test.variants.map(v => {
    const vOutcomes = testOutcomes.filter(o => o.variantId === v.id);
    const sent = vOutcomes.filter(o => o.event === "sent").length;
    const opened = vOutcomes.filter(o => o.event === "opened").length;
    const replied = vOutcomes.filter(o => o.event === "replied").length;
    const converted = vOutcomes.filter(o => o.event === "converted").length;

    return {
      id: v.id,
      name: v.name,
      sent,
      opened,
      replied,
      converted,
      openRate: sent > 0 ? opened / sent : 0,
      replyRate: sent > 0 ? replied / sent : 0,
      conversionRate: sent > 0 ? converted / sent : 0,
      isWinner: false,
      confidenceVsControl: 0,
    };
  });

  const control = variantStats[0];
  let winnerIdx = 0;
  let maxRate = control?.conversionRate ?? 0;

  for (let i = 1; i < variantStats.length; i++) {
    const v = variantStats[i];
    if (control) {
      v.confidenceVsControl = calculateConfidence(
        control.converted, control.sent,
        v.converted, v.sent
      );
    }
    if (v.conversionRate > maxRate && v.confidenceVsControl >= 0.95) {
      maxRate = v.conversionRate;
      winnerIdx = i;
    }
  }

  const totalSent = variantStats.reduce((s, v) => s + v.sent, 0);
  const hasSignificantResult =
    totalSent >= MIN_SAMPLE && variantStats.some(v => v.confidenceVsControl >= 0.95);

  if (hasSignificantResult) variantStats[winnerIdx].isWinner = true;

  return { testId: test.id, variants: variantStats, totalSent, winnerDeclared: hasSignificantResult, minSampleSize: MIN_SAMPLE, hasSignificantResult };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const sampleTest: AbTest = {
  id: "test-001",
  name: "Subject Line Test",
  orgId: 42,
  variants: [
    { id: "control", name: "Control", description: "Original subject", weight: 50 },
    { id: "variant_a", name: "Variant A", description: "Personalized subject", weight: 50 },
  ],
  metric: "open_rate",
  startedAt: new Date("2024-01-01"),
  status: "active",
};

describe("getVariant", () => {
  it("returns a valid variant for any lead ID", () => {
    const variant = getVariant(sampleTest, 123);
    expect(["control", "variant_a"]).toContain(variant.id);
  });

  it("is deterministic — same lead always gets same variant", () => {
    const v1 = getVariant(sampleTest, 456);
    const v2 = getVariant(sampleTest, 456);
    expect(v1.id).toBe(v2.id);
  });

  it("different leads can get different variants", () => {
    const variants = new Set(
      Array.from({ length: 200 }, (_, i) => getVariant(sampleTest, i).id)
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it("respects weight distribution (50/50 gives roughly equal splits)", () => {
    const counts: Record<string, number> = { control: 0, variant_a: 0 };
    for (let i = 0; i < 1000; i++) {
      const v = getVariant(sampleTest, i);
      counts[v.id]++;
    }
    // With 50/50 split, each should be roughly 400-600
    expect(counts.control).toBeGreaterThan(300);
    expect(counts.variant_a).toBeGreaterThan(300);
  });

  it("handles unequal weights (70/30)", () => {
    const skewedTest: AbTest = {
      ...sampleTest,
      variants: [
        { id: "control", name: "Control", description: "", weight: 70 },
        { id: "heavy", name: "Heavy", description: "", weight: 30 },
      ],
    };
    const counts: Record<string, number> = { control: 0, heavy: 0 };
    for (let i = 0; i < 1000; i++) {
      const v = getVariant(skewedTest, i);
      counts[v.id]++;
    }
    expect(counts.control).toBeGreaterThan(counts.heavy);
  });
});

describe("calculateConfidence", () => {
  it("returns 0 for zero sample sizes", () => {
    expect(calculateConfidence(0, 0, 5, 10)).toBe(0);
    expect(calculateConfidence(5, 10, 0, 0)).toBe(0);
  });

  it("returns high confidence for large significant difference", () => {
    // control: 5% conversion, variant: 30% conversion, 1000 each
    const conf = calculateConfidence(50, 1000, 300, 1000);
    expect(conf).toBeGreaterThanOrEqual(0.99);
  });

  it("returns 0 for equal rates", () => {
    const conf = calculateConfidence(50, 1000, 50, 1000);
    expect(conf).toBe(0);
  });

  it("returns low confidence for small sample with small difference", () => {
    // control: 10%, variant: 12%, only 10 each
    const conf = calculateConfidence(1, 10, 1.2, 10);
    expect(conf).toBeLessThan(0.9);
  });
});

describe("getResults", () => {
  it("counts sent/opened/replied/converted by variant", () => {
    const now = new Date();
    const outcomes: AbOutcome[] = [
      { testId: "test-001", variantId: "control", leadId: 1, event: "sent", timestamp: now },
      { testId: "test-001", variantId: "control", leadId: 1, event: "opened", timestamp: now },
      { testId: "test-001", variantId: "variant_a", leadId: 2, event: "sent", timestamp: now },
    ];
    const results = getResults(sampleTest, outcomes);
    const control = results.variants.find(v => v.id === "control")!;
    const variantA = results.variants.find(v => v.id === "variant_a")!;

    expect(control.sent).toBe(1);
    expect(control.opened).toBe(1);
    expect(control.openRate).toBe(1);
    expect(variantA.sent).toBe(1);
    expect(variantA.opened).toBe(0);
  });

  it("totalSent sums across all variants", () => {
    const now = new Date();
    const outcomes: AbOutcome[] = Array.from({ length: 10 }, (_, i) => ({
      testId: "test-001",
      variantId: i % 2 === 0 ? "control" : "variant_a",
      leadId: i,
      event: "sent" as const,
      timestamp: now,
    }));
    const results = getResults(sampleTest, outcomes);
    expect(results.totalSent).toBe(10);
  });

  it("declares winner when statistically significant", () => {
    const now = new Date();
    // Generate 50+ sent outcomes with variant_a having dramatically higher conversion
    const outcomes: AbOutcome[] = [];
    for (let i = 0; i < 100; i++) {
      outcomes.push({ testId: "test-001", variantId: "control", leadId: i, event: "sent", timestamp: now });
      if (i < 5) outcomes.push({ testId: "test-001", variantId: "control", leadId: i, event: "converted", timestamp: now });
    }
    for (let i = 100; i < 200; i++) {
      outcomes.push({ testId: "test-001", variantId: "variant_a", leadId: i, event: "sent", timestamp: now });
      if (i < 170) outcomes.push({ testId: "test-001", variantId: "variant_a", leadId: i, event: "converted", timestamp: now });
    }
    const results = getResults(sampleTest, outcomes);
    expect(results.hasSignificantResult).toBe(true);
    const winner = results.variants.find(v => v.isWinner);
    expect(winner?.id).toBe("variant_a");
  });

  it("does not declare winner with insufficient sample", () => {
    const now = new Date();
    const outcomes: AbOutcome[] = [
      { testId: "test-001", variantId: "control", leadId: 1, event: "sent", timestamp: now },
    ];
    const results = getResults(sampleTest, outcomes);
    expect(results.hasSignificantResult).toBe(false);
    expect(results.winnerDeclared).toBe(false);
  });
});
