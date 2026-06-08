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

import { describe, it, expect, vi } from "vitest";

// loadSanctionsEntries() reads sanctions_list_entries from the DB. In unit
// tests we DON'T have a live DB, so we mock it to return an EMPTY result — that
// deterministically exercises the bundled-fixture FALLBACK path (and keeps
// tests off any network/DB). Tests that supply explicit `entries` never touch
// this. `db.select(...).from(...)` is awaited directly, so `from` must resolve
// to an array.
vi.mock("../../db", () => {
  const fromArr: any[] = [];
  return {
    db: {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockResolvedValue(fromArr),
      }),
    },
  };
});

import {
  normalizeName,
  normalizeTokens,
  jaroWinkler,
  nameSimilarity,
  screenName,
  screeningProvenance,
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

  it("falls back to the bundled fixture when the live table is empty", async () => {
    // The db mock returns [] → loadSanctionsEntries() yields the bundled
    // fixture. Guzman Loera is in that fixture.
    const out = await screenName("Joaquin Guzman Loera");
    expect(out.result).toBe("potential_match");
    expect(out.listSource).toBe("bundled-fixture");
  });
});

// ── Live-data shape: aliases + provenance ────────────────────────────────────
// Entries mirror what loadSanctionsEntries() builds from sanctions_list_entries:
// a primary name, aliases (AKAs), a source LIST ("SDN"/"CONSOLIDATED"), and the
// list's published date for "current as of" provenance.
const LIVE_LIKE: SanctionsEntry[] = [
  {
    name: "Joaquin Archivaldo Guzman Loera",
    program: "SDNTK",
    source: "SDN",
    aliases: ["El Chapo", "Guzman, Joaquin"],
    listPublishedAt: new Date("2024-05-01T00:00:00Z"),
  },
  {
    name: "Bank Melli Iran",
    program: "IRAN, SDGT",
    source: "CONSOLIDATED",
    aliases: ["Melli Bank"],
    listPublishedAt: new Date("2024-04-15T00:00:00Z"),
  },
];

describe("screenName — alias matching", () => {
  it("flags a screened name that matches an ALIAS, not the primary name", async () => {
    const out = await screenName("El Chapo", { entries: LIVE_LIKE });
    expect(out.result).toBe("potential_match");
    expect(out.matchedEntry?.name).toBe("Joaquin Archivaldo Guzman Loera");
  });

  it("flags an order-flipped alias", async () => {
    const out = await screenName("Joaquin Guzman", { entries: LIVE_LIKE });
    expect(out.result).toBe("potential_match");
  });
});

describe("screenName — provenance / as-of", () => {
  it("surfaces the matched entry's list source + published date", async () => {
    const out = await screenName("El Chapo", { entries: LIVE_LIKE });
    expect(out.listSource).toBe("SDN");
    expect(out.listPublishedAt?.toISOString().slice(0, 10)).toBe("2024-05-01");
  });

  it("provenance copy renders a 'current as of' line", async () => {
    const out = await screenName("Bank Melli Iran", { entries: LIVE_LIKE });
    expect(out.listSource).toBe("CONSOLIDATED");
    expect(screeningProvenance(out)).toBe(
      "Screened against the OFAC CONSOLIDATED list, current as of 2024-04-15.",
    );
  });

  it("clears carry no list published date", async () => {
    const out = await screenName("Completely Unrelated Person", { entries: LIVE_LIKE });
    expect(out.result).toBe("clear");
    expect(out.listPublishedAt).toBeNull();
  });
});

// ── Matcher precision / recall on known names + known false-positive pairs ───
describe("matcher precision / recall", () => {
  // RECALL: each of these SHOULD flag against the entry it targets.
  const trueMatches: Array<[string, string]> = [
    ["Viktor Bout", "Viktor Anatolyevich Bout"], // subset / middle name
    ["Bout, Viktor", "Viktor Bout"], // order flip
    ["Viktor Buot", "Viktor Bout"], // single-char typo
    ["Joaquín Guzmán Loera", "Joaquin Guzman Loera"], // diacritics
  ];

  // PRECISION: these are KNOWN FALSE-POSITIVE pairs that must NOT flag — common
  // names that share a token or look superficially similar but are different
  // people. A miss here is a wasted manual review; the advisory bias tolerates
  // some, but these clearly-distinct pairs must clear.
  const falsePositivePairs: Array<[string, string]> = [
    ["John Smith", "Viktor Bout"],
    ["Maria Garcia", "Bank Melli Iran"],
    ["Robert Johnson", "Joaquin Guzman Loera"],
    ["Viktor Petrov", "Viktor Bout"], // shared first name only
  ];

  it("RECALL — known matches all flag at the default threshold", () => {
    for (const [screened, entry] of trueMatches) {
      expect(
        nameSimilarity(screened, entry),
        `expected "${screened}" ~ "${entry}" to flag`,
      ).toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLD);
    }
  });

  it("PRECISION — known false-positive pairs all clear the default threshold", () => {
    for (const [screened, entry] of falsePositivePairs) {
      expect(
        nameSimilarity(screened, entry),
        `expected "${screened}" ≠ "${entry}" to clear`,
      ).toBeLessThan(DEFAULT_MATCH_THRESHOLD);
    }
  });
});
