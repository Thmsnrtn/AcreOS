/**
 * T202 — Skip Tracing Logic Tests
 * Tests phone/email confidence scoring, result merging, and batch prioritization.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface TraceContact {
  phone?: string;
  email?: string;
  address?: string;
  source: string;
  confidence: number;
}

function mergeTraceResults(results: TraceContact[]): TraceContact | null {
  if (results.length === 0) return null;
  // Pick the highest-confidence result and merge fields
  const sorted = [...results].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];
  const merged: TraceContact = { ...best };

  for (const r of sorted.slice(1)) {
    if (!merged.phone && r.phone) merged.phone = r.phone;
    if (!merged.email && r.email) merged.email = r.email;
    if (!merged.address && r.address) merged.address = r.address;
  }
  return merged;
}

function scorePhoneConfidence(phone: string, sourceType: "county" | "public" | "premium"): number {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return 0;
  const sourceBonus = sourceType === "premium" ? 30 : sourceType === "county" ? 20 : 10;
  return Math.min(100, 60 + sourceBonus);
}

function scoreEmailConfidence(email: string, sourceType: "county" | "public" | "premium"): number {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return 0;
  const sourceBonus = sourceType === "premium" ? 25 : sourceType === "county" ? 15 : 5;
  return Math.min(100, 55 + sourceBonus);
}

function classifyTraceStatus(result: TraceContact | null): "found" | "partial" | "not_found" {
  if (!result) return "not_found";
  const hasPhone = !!result.phone;
  const hasEmail = !!result.email;
  const hasAddress = !!result.address;
  const count = [hasPhone, hasEmail, hasAddress].filter(Boolean).length;
  if (count >= 2) return "found";
  if (count === 1) return "partial";
  return "not_found";
}

function prioritizeLeadsForTracing(leads: Array<{ id: number; ownershipYears: number; propertyValueCents: number }>): number[] {
  // Prioritize: longer ownership + higher value = higher priority
  return [...leads]
    .sort((a, b) => {
      const scoreA = a.ownershipYears * 0.4 + (a.propertyValueCents / 100000) * 0.6;
      const scoreB = b.ownershipYears * 0.4 + (b.propertyValueCents / 100000) * 0.6;
      return scoreB - scoreA;
    })
    .map(l => l.id);
}

function calculateBatchTraceProgress(completed: number, total: number): {
  percent: number;
  remaining: number;
  isComplete: boolean;
} {
  return {
    percent: total === 0 ? 100 : Math.round((completed / total) * 100),
    remaining: Math.max(0, total - completed),
    isComplete: completed >= total,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("mergeTraceResults", () => {
  it("returns null for empty array", () => {
    expect(mergeTraceResults([])).toBeNull();
  });

  it("returns single result as-is", () => {
    const result = mergeTraceResults([{ phone: "555-1234", source: "public", confidence: 70 }]);
    expect(result?.phone).toBe("555-1234");
  });

  it("prefers highest confidence result", () => {
    const results: TraceContact[] = [
      { phone: "111-1111", source: "public", confidence: 50 },
      { phone: "222-2222", source: "premium", confidence: 90 },
    ];
    const merged = mergeTraceResults(results);
    expect(merged?.phone).toBe("222-2222");
  });

  it("fills in missing fields from lower-confidence sources", () => {
    const results: TraceContact[] = [
      { phone: "555-1234", source: "premium", confidence: 90 },
      { email: "owner@example.com", source: "public", confidence: 60 },
    ];
    const merged = mergeTraceResults(results);
    expect(merged?.phone).toBe("555-1234");
    expect(merged?.email).toBe("owner@example.com");
  });

  it("does not override existing field with lower-confidence source", () => {
    const results: TraceContact[] = [
      { phone: "555-HIGH", source: "premium", confidence: 90 },
      { phone: "555-LOW", source: "public", confidence: 50 },
    ];
    const merged = mergeTraceResults(results);
    expect(merged?.phone).toBe("555-HIGH");
  });
});

describe("scorePhoneConfidence", () => {
  it("returns 0 for invalid phone (< 10 digits)", () => {
    expect(scorePhoneConfidence("12345", "public")).toBe(0);
  });

  it("returns higher score for premium source", () => {
    const premium = scorePhoneConfidence("2125551234", "premium");
    const publicScore = scorePhoneConfidence("2125551234", "public");
    expect(premium).toBeGreaterThan(publicScore);
  });

  it("caps at 100", () => {
    expect(scorePhoneConfidence("2125551234", "premium")).toBeLessThanOrEqual(100);
  });

  it("county source has middle confidence", () => {
    const county = scorePhoneConfidence("2125551234", "county");
    const premium = scorePhoneConfidence("2125551234", "premium");
    const publicScore = scorePhoneConfidence("2125551234", "public");
    expect(county).toBeGreaterThan(publicScore);
    expect(county).toBeLessThan(premium);
  });
});

describe("scoreEmailConfidence", () => {
  it("returns 0 for invalid email", () => {
    expect(scoreEmailConfidence("notanemail", "public")).toBe(0);
  });

  it("scores valid email with premium source highest", () => {
    const premium = scoreEmailConfidence("user@example.com", "premium");
    const publicScore = scoreEmailConfidence("user@example.com", "public");
    expect(premium).toBeGreaterThan(publicScore);
  });
});

describe("classifyTraceStatus", () => {
  it("returns not_found for null", () => {
    expect(classifyTraceStatus(null)).toBe("not_found");
  });

  it("returns not_found for empty contact", () => {
    expect(classifyTraceStatus({ source: "public", confidence: 0 })).toBe("not_found");
  });

  it("returns partial for single field", () => {
    expect(classifyTraceStatus({ phone: "555-1234", source: "public", confidence: 70 })).toBe("partial");
  });

  it("returns found for 2+ fields", () => {
    expect(classifyTraceStatus({
      phone: "555-1234",
      email: "user@example.com",
      source: "premium",
      confidence: 90,
    })).toBe("found");
  });
});

describe("prioritizeLeadsForTracing", () => {
  it("returns lead IDs in priority order", () => {
    const leads = [
      { id: 1, ownershipYears: 5, propertyValueCents: 10_000_000 },
      { id: 2, ownershipYears: 20, propertyValueCents: 50_000_000 },
      { id: 3, ownershipYears: 1, propertyValueCents: 5_000_000 },
    ];
    const priority = prioritizeLeadsForTracing(leads);
    expect(priority[0]).toBe(2); // high ownership + high value
    expect(priority[priority.length - 1]).toBe(3); // low both
  });

  it("returns empty array for empty input", () => {
    expect(prioritizeLeadsForTracing([])).toEqual([]);
  });
});

describe("calculateBatchTraceProgress", () => {
  it("returns 0% for no completed", () => {
    const p = calculateBatchTraceProgress(0, 100);
    expect(p.percent).toBe(0);
    expect(p.remaining).toBe(100);
    expect(p.isComplete).toBe(false);
  });

  it("returns 100% when complete", () => {
    const p = calculateBatchTraceProgress(50, 50);
    expect(p.percent).toBe(100);
    expect(p.remaining).toBe(0);
    expect(p.isComplete).toBe(true);
  });

  it("returns 100% for empty batch", () => {
    const p = calculateBatchTraceProgress(0, 0);
    expect(p.percent).toBe(100);
    expect(p.isComplete).toBe(true);
  });

  it("rounds percentage", () => {
    const p = calculateBatchTraceProgress(1, 3);
    expect(p.percent).toBe(33);
  });
});
