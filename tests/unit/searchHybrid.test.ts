/**
 * Phase 3 Week 14 — vector + fuzzy search infra tests.
 *
 * Covers:
 *   • Reciprocal Rank Fusion ranking (vector ⊕ keyword 50/50)
 *   • toVectorLiteral wire-format encoding (pgvector "[1,2,3]")
 *   • Phone normalization (digitsOnly + isPhoneShaped)
 *   • Accent-folding helper (mirrors what unaccent() does at the DB
 *     layer so we can assert call-site equivalence in unit tests).
 *
 * Pure-logic tests only — no DB. The DB-dependent paths (findSimilar,
 * searchHybrid keyword arm) are exercised in integration tests.
 */

import { describe, it, expect } from "vitest";
import {
  reciprocalRankFusion,
  toVectorLiteral,
  type VectorMatch,
} from "../../server/services/vectorSearch";
import {
  digitsOnly,
  isPhoneShaped,
} from "../../server/services/fullTextSearch";

// ── pure-helper accent-fold mirror ────────────────────────────────────────
// Postgres unaccent() strips combining diacritics. We mirror that
// transformation in JS for unit-test assertions about input that the
// search service will normalize before hitting the index.
function jsUnaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

describe("toVectorLiteral", () => {
  it("encodes a small array in pgvector wire format", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("handles negatives and zeros", () => {
    expect(toVectorLiteral([0, -1, 1])).toBe("[0,-1,1]");
  });

  it("handles a 1536-dim embedding without losing length", () => {
    const v = Array(1536).fill(0).map((_, i) => i / 1536);
    const out = toVectorLiteral(v);
    expect(out.startsWith("[")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
    expect(out.split(",").length).toBe(1536);
  });
});

describe("reciprocalRankFusion", () => {
  const mk = (id: number): VectorMatch => ({
    patternId: id,
    organizationId: 1,
    cosineDistance: 0,
    similarityScore: 1,
  });

  it("returns empty array on empty inputs", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });

  it("ranks a doc that appears in both lists higher than singletons", () => {
    const vector = [mk(1), mk(2), mk(3)];
    const keyword = [mk(2), mk(4), mk(5)];

    const out = reciprocalRankFusion(vector, keyword);
    // Pattern 2 is rank 2 in vector + rank 1 in keyword — should win.
    expect(out[0].patternId).toBe(2);
    expect(out[0].vectorRank).toBe(2);
    expect(out[0].keywordRank).toBe(1);
  });

  it("preserves a vector-only doc that doesn't appear in keyword", () => {
    const out = reciprocalRankFusion([mk(1)], []);
    expect(out).toHaveLength(1);
    expect(out[0].patternId).toBe(1);
    expect(out[0].keywordRank).toBeNull();
    expect(out[0].vectorRank).toBe(1);
  });

  it("preserves a keyword-only doc that doesn't appear in vector", () => {
    const out = reciprocalRankFusion([], [mk(7)]);
    expect(out).toHaveLength(1);
    expect(out[0].patternId).toBe(7);
    expect(out[0].vectorRank).toBeNull();
    expect(out[0].keywordRank).toBe(1);
  });

  it("monotonically decreases score with rank", () => {
    const out = reciprocalRankFusion(
      [mk(1), mk(2), mk(3), mk(4)],
      [],
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].fusedScore).toBeGreaterThanOrEqual(out[i].fusedScore);
    }
  });

  it("uses k=60 default constant from the original RRF paper", () => {
    // Score for rank-1 = 1 / (60 + 1) = 1/61
    const out = reciprocalRankFusion([mk(1)], []);
    expect(out[0].fusedScore).toBeCloseTo(1 / 61, 6);
  });

  it("equally weights vector and keyword arms (50/50)", () => {
    // Same doc at rank 1 in both arms ⇒ score = 2 * (1/61).
    const out = reciprocalRankFusion([mk(9)], [mk(9)]);
    expect(out[0].fusedScore).toBeCloseTo(2 / 61, 6);
  });
});

describe("phone normalization", () => {
  it("strips formatting characters", () => {
    expect(digitsOnly("(555) 123-4567")).toBe("5551234567");
    expect(digitsOnly("+1 555.123.4567")).toBe("15551234567");
    expect(digitsOnly("555-123-4567")).toBe("5551234567");
  });

  it("returns empty string for non-digit input", () => {
    expect(digitsOnly("anais")).toBe("");
  });

  it("recognizes a phone-shaped query with separators", () => {
    expect(isPhoneShaped("555-123-4567")).toBe(true);
    expect(isPhoneShaped("(555) 123-4567")).toBe(true);
    expect(isPhoneShaped("555.123.4567")).toBe(true);
  });

  it("recognizes a 10-digit run as phone-shaped", () => {
    expect(isPhoneShaped("5551234567")).toBe(true);
  });

  it("rejects short numeric strings as phone-shaped", () => {
    expect(isPhoneShaped("123")).toBe(false);
    expect(isPhoneShaped("12345")).toBe(false);
  });

  it("normalizes equivalent phone formats to the same key", () => {
    const stored = digitsOnly("(555) 123-4567");
    const queried = digitsOnly("555-123-4567");
    expect(stored).toBe(queried);
  });

  it("does not classify alphabetic queries as phone-shaped", () => {
    expect(isPhoneShaped("anais")).toBe(false);
    expect(isPhoneShaped("hello world")).toBe(false);
  });
});

describe("accent folding (jsUnaccent — mirrors Postgres unaccent())", () => {
  it("strips combining diacritics", () => {
    expect(jsUnaccent("Anaïs")).toBe("Anais");
    expect(jsUnaccent("café")).toBe("cafe");
    expect(jsUnaccent("São Paulo")).toBe("Sao Paulo");
  });

  it("is idempotent on already-folded input", () => {
    expect(jsUnaccent("anais")).toBe("anais");
    expect(jsUnaccent("cafe")).toBe("cafe");
  });

  it("preserves case", () => {
    expect(jsUnaccent("ÉLISE")).toBe("ELISE");
  });

  it("makes a folded query match a folded indexed value", () => {
    const indexed = jsUnaccent("Café Anaïs");
    const queried = jsUnaccent("cafe anais");
    expect(indexed.toLowerCase().includes(queried.toLowerCase())).toBe(true);
  });
});
