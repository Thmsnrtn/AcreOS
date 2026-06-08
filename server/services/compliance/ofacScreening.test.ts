/**
 * ofacScreening tests — the ADVISORY name-matcher.
 *
 * Covers the pure (no-DB) engine: normalization, similarity, and the
 * screenName() bucketing into clear / potential_match. The DB-backed
 * screenAndPersist / listOpenPotentialMatches paths are integration tests by
 * nature and are not exercised here.
 *
 * Framing reminder: a `potential_match` is ADVISORY, not a legal
 * determination — these tests assert the engine flags candidates for human
 * review, NOT that any name is conclusively sanctioned.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeName,
  normalizeTokens,
  jaroWinkler,
  nameSimilarity,
  screenName,
  DEFAULT_MATCH_THRESHOLD,
  type SanctionsEntry,
} from "./ofacScreening";

const FIXTURE: SanctionsEntry[] = [
  { name: "Viktor Bout", program: "SDNTK", source: "test-fixture" },
  { name: "Bank Melli Iran", program: "IRAN", source: "test-fixture" },
];

describe("normalizeName / normalizeTokens", () => {
  it("strips diacritics, lowercases, drops punctuation", () => {
    expect(normalizeName("Víktor Boùt")).toBe("bout viktor");
    expect(normalizeName("BOUT, VIKTOR")).toBe("bout viktor");
  });

  it("is word-order independent (sorted token set)", () => {
    expect(normalizeName("Viktor Bout")).toBe(normalizeName("Bout Viktor"));
  });

  it("drops org stopwords/honorifics", () => {
    expect(normalizeTokens("Tango Trading Company LLC")).toEqual(["tango"]);
    expect(normalizeTokens("Mr. John")).toEqual(["john"]);
  });

  it("returns empty tokens for blank / punctuation-only input", () => {
    expect(normalizeTokens("")).toEqual([]);
    expect(normalizeTokens("   ---  ")).toEqual([]);
  });
});

describe("jaroWinkler", () => {
  it("is 1 for identical strings and 0 for empty", () => {
    expect(jaroWinkler("bout", "bout")).toBe(1);
    expect(jaroWinkler("", "bout")).toBe(0);
  });

  it("rewards a common prefix (winkler boost)", () => {
    const withPrefix = jaroWinkler("martha", "marhta");
    expect(withPrefix).toBeGreaterThan(0.9);
  });

  it("scores unrelated strings low", () => {
    expect(jaroWinkler("apple", "zzzzz")).toBeLessThan(0.4);
  });
});

describe("nameSimilarity", () => {
  it("scores an exact (order-flipped) name at 1", () => {
    expect(nameSimilarity("Viktor Bout", "Bout, Viktor")).toBeCloseTo(1, 5);
  });

  it("floors a full subset match high (screened name contained in entry)", () => {
    // "Viktor Bout" fully contained in a longer list entry.
    expect(nameSimilarity("Viktor Bout", "Viktor Anatolyevich Bout")).toBeGreaterThanOrEqual(0.9);
  });

  it("tolerates a single-character typo", () => {
    expect(nameSimilarity("Viktor Bout", "Viktor Buot")).toBeGreaterThan(0.8);
  });

  it("scores unrelated names low", () => {
    expect(nameSimilarity("Jane Smith", "Viktor Bout")).toBeLessThan(0.4);
  });

  it("returns 0 when either name normalizes to empty", () => {
    expect(nameSimilarity("", "Viktor Bout")).toBe(0);
    expect(nameSimilarity("Mr.", "Viktor Bout")).toBe(0);
  });
});

describe("screenName (advisory bucketing)", () => {
  it("flags an exact-match name as potential_match with matched entry", async () => {
    const out = await screenName("Viktor Bout", { entries: FIXTURE });
    expect(out.result).toBe("potential_match");
    expect(out.score).toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLD);
    expect(out.matchedEntry?.name).toBe("Viktor Bout");
    expect(out.matchedEntry?.program).toBe("SDNTK");
  });

  it("flags an order-flipped / typo'd name as potential_match", async () => {
    const out = await screenName("Bout, Viktor", { entries: FIXTURE });
    expect(out.result).toBe("potential_match");
  });

  it("clears an unrelated name", async () => {
    const out = await screenName("Jane Q. Public", { entries: FIXTURE });
    expect(out.result).toBe("clear");
    expect(out.matchedEntry).toBeNull();
    expect(out.score).toBeLessThan(DEFAULT_MATCH_THRESHOLD);
  });

  it("clears blank input without error", async () => {
    const out = await screenName("   ", { entries: FIXTURE });
    expect(out.result).toBe("clear");
    expect(out.score).toBe(0);
  });

  it("respects a custom threshold", async () => {
    // A near-miss that clears at the default threshold should flag at a low one.
    const lenient = await screenName("Bank Iran", { entries: FIXTURE, threshold: 0.3 });
    expect(lenient.result).toBe("potential_match");
  });

  it("records the engine version, threshold, and list source on the outcome", async () => {
    const out = await screenName("Viktor Bout", { entries: FIXTURE });
    expect(out.engineVersion).toBe("v1");
    expect(out.threshold).toBe(DEFAULT_MATCH_THRESHOLD);
    expect(out.listSource).toBe("test-fixture");
  });

  it("falls back to the bundled fixture when no entries supplied", async () => {
    // Guzman Loera is in the bundled fixture.
    const out = await screenName("Joaquin Guzman Loera");
    expect(out.result).toBe("potential_match");
    expect(out.listSource).toBe("bundled-fixture");
  });
});
