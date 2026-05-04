/**
 * ⌘K v2 matcher unit tests (Phase 4 Week 19-20).
 *
 * Pure-logic coverage for the scoring helpers in `shared/cmdkMatcher.ts`.
 * No DOM, no React — just the deterministic math the palette uses to
 * re-rank the server's pg_trgm candidate set.
 */

import { describe, it, expect } from "vitest";
import {
  acronymScore,
  bigrams,
  detectEntity,
  diceCoefficient,
  looksImperative,
  looksLikeQuestion,
  normalize,
  parseScope,
  rankItems,
  recencyScore,
  scoreItem,
  tokenize,
  RECENCY_WINDOW_MS,
  type MatchableItem,
} from "../../shared/cmdkMatcher";

describe("normalize", () => {
  it("lowercases and trims", () => {
    expect(normalize("  Hello WORLD  ")).toBe("hello world");
  });

  it("strips diacritics (accent fold)", () => {
    expect(normalize("Pícking")).toBe("picking");
    expect(normalize("café")).toBe("cafe");
  });
});

describe("tokenize", () => {
  it("splits on whitespace and punctuation", () => {
    expect(tokenize("Tax Delinquent Counties")).toEqual(["tax", "delinquent", "counties"]);
    expect(tokenize("send-letter / new_lead")).toEqual(["send", "letter", "new", "lead"]);
  });

  it("returns empty array for blank input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("bigrams + diceCoefficient", () => {
  it("emits character pairs", () => {
    expect(bigrams("leaf")).toEqual(["le", "ea", "af"]);
  });

  it("scores identical strings as 1.0", () => {
    expect(diceCoefficient("leaflet", "leaflet")).toBe(1);
  });

  it("scores 'leaf' high against 'leaflet' (substring family)", () => {
    expect(diceCoefficient("leaf", "leaflet")).toBeGreaterThan(0.6);
  });

  it("survives a 1-edit typo (target task)", () => {
    // 'leafl' (typo for 'leaf' or 'leaflet') still resembles 'leaflet'
    expect(diceCoefficient("leafl", "leaflet")).toBeGreaterThan(0.5);
  });

  it("returns 0 for empty inputs", () => {
    expect(diceCoefficient("", "anything")).toBe(0);
    expect(diceCoefficient("anything", "")).toBe(0);
  });
});

describe("acronymScore", () => {
  it("matches 'tdc' to 'tax delinquent counties' fully (the canonical case)", () => {
    expect(acronymScore("tdc", "tax delinquent counties")).toBe(1);
  });

  it("partial acronym scores lower but non-zero", () => {
    const partial = acronymScore("td", "tax delinquent counties");
    const full = acronymScore("tdc", "tax delinquent counties");
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(full);
  });

  it("rejects mismatching first letter", () => {
    expect(acronymScore("xyz", "tax delinquent counties")).toBe(0);
  });

  it("ignores single-token targets (acronyms need ≥ 2 tokens)", () => {
    expect(acronymScore("ab", "abracadabra")).toBe(0);
  });

  it("ignores 1-character queries", () => {
    expect(acronymScore("t", "tax delinquent counties")).toBe(0);
  });
});

describe("recencyScore", () => {
  const NOW = 1_700_000_000_000;

  it("returns 1.0 for a just-clicked item", () => {
    expect(recencyScore("a", [{ id: "a", at: NOW }], NOW)).toBe(1);
  });

  it("returns 0 outside the 7-day window", () => {
    expect(
      recencyScore("a", [{ id: "a", at: NOW - RECENCY_WINDOW_MS - 1 }], NOW),
    ).toBe(0);
  });

  it("decays linearly across the window", () => {
    const half = recencyScore(
      "a",
      [{ id: "a", at: NOW - RECENCY_WINDOW_MS / 2 }],
      NOW,
    );
    expect(half).toBeGreaterThan(0.45);
    expect(half).toBeLessThan(0.55);
  });

  it("returns 0 for unknown ids", () => {
    expect(recencyScore("zzz", [{ id: "a", at: NOW }], NOW)).toBe(0);
  });
});

describe("scoreItem", () => {
  const baseItem: MatchableItem = {
    id: "page:tax-delinquent-counties",
    title: "Tax Delinquent Counties",
    kind: "page",
  };

  it("ranks an exact-prefix match higher than a fuzzy match", () => {
    const exact = scoreItem("tax delinquent counties", baseItem);
    const fuzzy = scoreItem("counties", baseItem);
    expect(exact.score).toBeGreaterThan(fuzzy.score);
    expect(exact.breakdown.exact).toBe(1);
    expect(exact.breakdown.prefix).toBe(1);
  });

  it("acronym query finds the page (the canonical task)", () => {
    const r = scoreItem("tdc", baseItem);
    expect(r.breakdown.acronym).toBeGreaterThan(0.9);
    expect(r.score).toBeGreaterThan(0.4);
  });

  it("substring query 'leaf' still scores 'Leaflet' (1-edit family)", () => {
    const item: MatchableItem = { id: "p:leaflet", title: "Leaflet" };
    const r = scoreItem("leaf", item);
    expect(r.breakdown.substring).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThan(0.3);
  });

  it("verb boost only fires for imperative-leading queries on verb items", () => {
    const verb: MatchableItem = { id: "v:add-lead", title: "Add lead", kind: "verb" };
    const page: MatchableItem = { id: "p:leads", title: "Leads", kind: "page" };
    const verbHit = scoreItem("add lead", verb);
    const pageHit = scoreItem("leads", page);
    expect(verbHit.breakdown.verbBoost).toBe(1);
    expect(pageHit.breakdown.verbBoost).toBe(0);
  });

  it("recency lifts a stale candidate over a slightly better fresh non-clicked one", () => {
    const NOW = 1_700_000_000_000;
    const a: MatchableItem = { id: "a", title: "Acme Lead Smith" };
    const b: MatchableItem = { id: "b", title: "Acme Lead Smithy" };
    const ra = scoreItem("acme lead smith", a, {
      now: NOW,
      recents: [{ id: "a", at: NOW - 1000 }],
    });
    const rb = scoreItem("acme lead smith", b, { now: NOW });
    // Both will substring-match; recency tips it.
    expect(ra.score).toBeGreaterThan(rb.score);
  });

  it("returns recency-only ranking when query is empty", () => {
    const NOW = 1_700_000_000_000;
    const r = scoreItem("", baseItem, {
      now: NOW,
      recents: [{ id: baseItem.id, at: NOW }],
    });
    expect(r.score).toBeGreaterThan(0);
    expect(r.breakdown.exact).toBe(0);
  });
});

describe("rankItems", () => {
  it("filters items below cutoff and sorts by score desc", () => {
    const items: MatchableItem[] = [
      { id: "a", title: "Tax Delinquent Counties" },
      { id: "b", title: "Settings" },
      { id: "c", title: "Tax Researcher" },
    ];
    const r = rankItems("tdc", items);
    // 'tdc' is an acronym for the first; not for the others.
    expect(r[0]?.item.id).toBe("a");
    expect(r.find((s) => s.item.id === "b")).toBeUndefined();
  });

  it("keepAll preserves zeros for inspection", () => {
    const items: MatchableItem[] = [
      { id: "a", title: "Tax Delinquent Counties" },
      { id: "b", title: "Unrelated" },
    ];
    const r = rankItems("tdc", items, { keepAll: true });
    expect(r).toHaveLength(2);
  });
});

describe("looksImperative", () => {
  it("detects common verb leads", () => {
    expect(looksImperative("add lead")).toBe(true);
    expect(looksImperative("send letter to John")).toBe(true);
    expect(looksImperative("close won")).toBe(true);
  });

  it("rejects non-verbs", () => {
    expect(looksImperative("john smith")).toBe(false);
    expect(looksImperative("")).toBe(false);
  });
});

describe("looksLikeQuestion", () => {
  it("trips on '?' suffix", () => {
    expect(looksLikeQuestion("anything goes?")).toBe(true);
  });

  it("trips on question words at the start", () => {
    expect(looksLikeQuestion("what is my pipeline value")).toBe(true);
    expect(looksLikeQuestion("how do I send a letter")).toBe(true);
    expect(looksLikeQuestion("Why are leads stuck")).toBe(true);
  });

  it("does not trip on regular searches", () => {
    expect(looksLikeQuestion("john smith")).toBe(false);
    expect(looksLikeQuestion("")).toBe(false);
  });
});

describe("detectEntity", () => {
  it("finds an email anywhere in the query", () => {
    expect(detectEntity("send to John foo@bar.com")).toEqual({
      kind: "email",
      value: "foo@bar.com",
    });
  });

  it("finds a phone number with formatting", () => {
    const r = detectEntity("call (555) 123-4567");
    expect(r?.kind).toBe("phone");
    expect(r?.value).toBe("5551234567");
  });

  it("returns null for plain text", () => {
    expect(detectEntity("john smith")).toBeNull();
  });
});

describe("parseScope", () => {
  it("extracts a leading scope chip", () => {
    expect(parseScope(":leads john")).toEqual({ scope: "leads", remainder: "john" });
    expect(parseScope(":deals  ")).toEqual({ scope: "deals", remainder: "" });
  });

  it("returns null scope for unknown chips", () => {
    expect(parseScope(":bogus query")).toEqual({
      scope: null,
      remainder: ":bogus query",
    });
  });

  it("passes through non-chip queries untouched", () => {
    expect(parseScope("regular search")).toEqual({
      scope: null,
      remainder: "regular search",
    });
  });
});
