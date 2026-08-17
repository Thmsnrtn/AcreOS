/**
 * The parcelRef adoption, proved rather than asserted.
 *
 * `shared/parcel/parcelRef.ts` became the one owner of "the same parcel" and
 * three call sites adopted it. Two of those adoptions changed the rule a live
 * surface runs on, and each carries a claim in its own comments:
 *
 *   publicParcelReport.ts:127  `looseApnKey` IS `parcelMatchKey`'s APN segment,
 *                              taken from parcelRef rather than re-derived, so
 *                              the punctuation rule has exactly one owner.
 *   publicParcelReport.ts:161  the accept/reject set is UNCHANGED by the
 *                              adoption, differentially against the old rule.
 *   taxDelinquentPipeline.ts   the re-key MERGES and never SPLITS, so no row
 *                              that deduped before stops deduping now.
 *
 * Both files named THIS FILE as the thing that proves them, and for one commit
 * this file did not exist — a comment citing a guard that was never written.
 * That is the fabrication failure mode the repo bans, in its quietest form: the
 * next reader trusts the citation and does not add the check they were about to
 * add. Written here so the citations are true.
 *
 * Each claim is checked DIFFERENTIALLY against the rule that was actually
 * replaced — reproduced verbatim below from `git show fea8fb82~1` — because
 * "unchanged" is a statement about two functions, and only one of them is the
 * one still in the tree.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { normalizeReportKey } from "../../server/services/publicParcelReport";
import {
  normalizeParcelRef,
  parcelMatchKey,
  parcelKey,
} from "../../shared/parcel/parcelRef";

// ── The rules that were replaced, verbatim ──────────────────────────────────

/**
 * `safeDecode` from publicParcelReport.ts — private there, reproduced here
 * because both the old rule below and the parcelMatchKey comparison must see
 * the value the production path actually normalises. A raw `decodeURIComponent`
 * throws on the deliberately malformed escape in the corpus.
 */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(String(v || ""));
  } catch {
    return String(v || "");
  }
}

/** publicParcelReport.ts BEFORE the adoption (fea8fb82~1). */
function oldNormalizeReportKey(
  stateRaw: string,
  countyRaw: string,
  apnRaw: string,
): { state: string; countySlug: string; countyLabel: string; apn: string; apnKey: string } | null {
  const state = String(stateRaw || "").trim().toUpperCase();
  if (!US_STATE_CODES.has(state)) return null;

  const countyDecoded = safeDecode(countyRaw).trim();
  const countySlug = countyDecoded
    .toLowerCase()
    .replace(/\s+county$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!countySlug || countySlug.length > 64) return null;
  const countyLabel = countySlug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

  const apn = safeDecode(apnRaw).trim();
  const apnKey = apn.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (apnKey.length < 2 || apnKey.length > 64) return null;
  if (!/\d/.test(apnKey)) return null;

  return { state, countySlug, countyLabel, apn, apnKey };
}

/** taxDelinquentPipeline.ts BEFORE the adoption (fea8fb82~1). */
const oldDedupKey = (
  state: string | null | undefined,
  county: string | null | undefined,
  apn: string | null | undefined,
): string =>
  `${(state ?? "").toLowerCase().trim()}|${(county ?? "").toLowerCase().trim()}|${(apn ?? "").toLowerCase().trim()}`;

/**
 * MUST match `US_STATE_CODES` in publicParcelReport.ts, which is private there.
 * The state check is byte-identical in the old and new rules, so a copy that
 * drifts does not fail the differential — it silently compares two different
 * rules on the inputs it disagrees about. The territories are the easy ones to
 * drop by hand; `the reproduced state set has not drifted` below catches it.
 */
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC",
  "PR", "VI", "GU", "AS", "MP",
]);

/**
 * The corpus both rules are run over. Deliberately mixes shapes that must be
 * ACCEPTED with shapes that must be REJECTED — a differential test over inputs
 * that all reject would agree perfectly and prove nothing, so the vacuity guard
 * below counts both outcomes before any comparison is trusted.
 */
const CORPUS: Array<[string, string, string]> = [
  // ordinary
  ["tx", "travis", "123-45-678"],
  ["TX", "Travis County", "12345678"],
  ["pr", "san juan", "12-345"], // a territory, not a state — see the set below
  ["ca", "Fresno", "a-1-2"],
  ["ca", "San Bernardino", "0405-121-33-0000"],
  // whitespace, the thing parcelRef collapses and the old rule did not
  ["  tx  ", " travis ", " 123  45 "],
  ["tx", "San   Bernardino", "12\t345"],
  ["tx", "travis\n", "\n12 345\n"],
  // url-encoded, exercising safeDecode on both sides
  ["tx", "san%20bernardino", "123%2D45"],
  ["tx", "%E0%A4%A", "12-34"], // malformed escape → safeDecode falls back
  // rejects: state
  ["zz", "travis", "12345"],
  ["california", "fresno", "12345"],
  ["", "travis", "12345"],
  // rejects: county
  ["tx", "", "12345"],
  ["tx", "   ", "12345"],
  ["tx", "---", "12345"],
  ["tx", "!!!", "12345"],
  // rejects: apn
  ["tx", "travis", ""],
  ["tx", "travis", "about"],
  ["tx", "travis", "UNKNOWN"],
  ["tx", "travis", "-"],
  ["tx", "travis", "5"], // one char after stripping → under the length bound
  ["tx", "travis", "1"],
  // bounds
  ["tx", "travis", "1".repeat(64)],
  ["tx", "travis", "1".repeat(65)],
  ["tx", "a".repeat(64), "12345"],
  ["tx", "a".repeat(65), "12345"],
  // county whose only content is the stripped suffix
  ["tx", "County", "12345"],
  ["tx", " County", "12345"],
];

describe("publicParcelReport: the adoption did not move the accept/reject set", () => {
  it("exercises BOTH outcomes before anything is compared (vacuity guard)", () => {
    const results = CORPUS.map(([s, c, a]) => normalizeReportKey(s, c, a));
    const accepted = results.filter((r) => r !== null).length;
    const rejected = results.length - accepted;
    expect(
      accepted,
      "no input in the corpus is ACCEPTED, so an agreement between the two " +
        "rules would only mean they both reject everything.",
    ).toBeGreaterThan(5);
    expect(
      rejected,
      "no input in the corpus is REJECTED, so the corpus cannot show a " +
        "difference in what the two rules refuse.",
    ).toBeGreaterThan(5);
  });

  it("the reproduced state set has not drifted from the real one", () => {
    // Every code this file claims is valid must really be accepted by the
    // production function. Without this, dropping a territory from the copy
    // above would make the differential quietly stop covering those inputs
    // instead of failing.
    const rejected = [...US_STATE_CODES].filter(
      (code) => normalizeReportKey(code, "travis", "12-345") === null,
    );
    expect(
      rejected,
      "this file's US_STATE_CODES contains codes publicParcelReport.ts does " +
        "NOT accept, so the two rules are being compared on different inputs.",
    ).toEqual([]);
    expect(normalizeReportKey("ZZ", "travis", "12-345"), "a non-state was accepted").toBeNull();
  });

  it("agrees with the pre-adoption rule on EVERY input, field for field", () => {
    // The comment claims the accept/reject set is unchanged. The returned value
    // is unchanged too, and asserting the stronger thing costs nothing: if a
    // later edit moves a countySlug or an apnKey, the permalinks that already
    // exist stop resolving, which is a worse failure than a changed verdict.
    const divergences: string[] = [];
    for (const [s, c, a] of CORPUS) {
      const now = normalizeReportKey(s, c, a);
      const before = oldNormalizeReportKey(s, c, a);
      if (JSON.stringify(now) !== JSON.stringify(before)) {
        divergences.push(
          `(${JSON.stringify(s)}, ${JSON.stringify(c)}, ${JSON.stringify(a)}): ` +
            `now=${JSON.stringify(now)} before=${JSON.stringify(before)}`,
        );
      }
    }
    expect(
      divergences,
      "the parcelRef adoption changed what this surface accepts or what it " +
        "returns. Every saved permalink is keyed on `apn_key`, so a changed " +
        "key ORPHANS existing public report rows — that is a data migration, " +
        "not an edit. If the change is intended, migrate first and then " +
        "rewrite this test to the new truth.\n  " + divergences.join("\n  "),
    ).toEqual([]);
  });
});

describe("publicParcelReport: the loose APN has exactly one owner", () => {
  it("the returned apnKey IS parcelMatchKey's APN segment", () => {
    // The claim at publicParcelReport.ts:127. `looseApnKey` is private, so this
    // reaches it the only way a caller can — through the returned key — and
    // pins it against parcelMatchKey so a change to the separator or to the
    // punctuation rule in parcelRef.ts cannot leave a second copy behind here.
    let checked = 0;
    for (const [s, c, a] of CORPUS) {
      const key = normalizeReportKey(s, c, a);
      if (!key) continue;
      // Decode first, exactly as the call site does: normalizeReportKey runs
      // safeDecode BEFORE parcelRef sees the value, so comparing against a raw
      // percent-encoded string would compare two different inputs and read the
      // difference as drift.
      const ref = normalizeParcelRef({
        state: s.trim().toUpperCase(),
        county: safeDecode(c),
        apn: safeDecode(a),
      });
      if (!ref.ok) continue;
      const segments = parcelMatchKey(ref.ref).split(" ");
      expect(
        key.apnKey,
        `apnKey drifted from parcelMatchKey for (${s}, ${c}, ${a})`,
      ).toBe(segments[segments.length - 1]);
      checked++;
    }
    expect(checked, "the comparison ran over no inputs at all").toBeGreaterThan(5);
  });

  it("the loose key is never the strict identity, so it cannot be mistaken for one", () => {
    // publicParcelReport deliberately keys permalinks on the LOOSE rule: two
    // parcels differing only in APN punctuation share one public page. That is
    // recorded as a known cost at the call site; what must never happen is the
    // loose key being read as a claim that they are the same parcel.
    const dashed = normalizeParcelRef({ state: "TX", county: "travis", apn: "123-45-678" });
    const plain = normalizeParcelRef({ state: "TX", county: "travis", apn: "12345678" });
    expect(dashed.ok && plain.ok).toBe(true);
    if (!dashed.ok || !plain.ok) return;

    expect(parcelMatchKey(dashed.ref)).toBe(parcelMatchKey(plain.ref));
    expect(
      parcelKey(dashed.ref),
      "the strict identity collapsed punctuation. Two parcels' evidence would " +
        "land on one identity with nothing able to separate them again.",
    ).not.toBe(parcelKey(plain.ref));
  });
});

describe("taxDelinquentPipeline: the re-key MERGES and never SPLITS", () => {
  /**
   * The property that makes the re-key safe to run against rows already
   * imported under the old rule. Two records the OLD rule called duplicates
   * must still be duplicates under the new one; the reverse is allowed, because
   * merging removes a duplicate import and splitting CREATES one.
   */
  type Triple = [string, string, string];
  const PAIRS: Array<{ a: Triple; b: Triple; label: string }> = [
    { a: ["TX", "Travis", "12-345"], b: ["tx", "travis", "12-345"], label: "state + county case" },
    { a: ["TX", "Travis", "A-1"], b: ["TX", "Travis", "a-1"], label: "APN case" },
    { a: ["TX", "TRAVIS", "12-345"], b: ["TX", "travis", "12-345"], label: "county case" },
    { a: ["tx", "travis", "12-345"], b: ["TX", "TRAVIS", "12-345"], label: "all three cases" },
    // Whitespace pairs: the OLD rule kept these APART, so they are skipped by
    // the no-split property below and asserted separately as a MERGE.
    { a: ["TX", "Travis", "12  345"], b: ["TX", "Travis", "12 345"], label: "APN whitespace run" },
    { a: ["TX", "San  Bernardino", "1-2"], b: ["TX", "San Bernardino", "1-2"], label: "county whitespace run" },
  ];

  /**
   * `parcelDedupKey` is MODULE-PRIVATE — it was exported only so this file
   * could import it, which the reachability gate counts as "exists only for its
   * test". So the properties are checked against the two things that actually
   * carry them: `parcelKey`, which IS the new rule, and the production source
   * for the refusal fallback, which is the only part not owned by parcelRef.
   */
  const dedupSource = (() => {
    const src = readFileSync(
      path.resolve(__dirname, "../../server/services/taxDelinquentPipeline.ts"),
      "utf8",
    );
    const at = src.indexOf("function parcelDedupKey");
    expect(at, "parcelDedupKey is gone from taxDelinquentPipeline.ts").toBeGreaterThan(-1);
    return src.slice(at, at + 1600);
  })();

  it("the pipeline keys on the STRICT identity, never the loose match key", () => {
    // Treating a row as a duplicate DROPS it. `parcelMatchKey` collapses
    // "12-345-678" into "12345678", so in a county where the separator is
    // significant it would silently discard a DIFFERENT parcel's lead.
    expect(dedupSource).toContain("parcelKey(ref.ref)");
    expect(
      dedupSource,
      "the import dedup switched to the loose candidate key — that drops real leads",
    ).not.toContain("parcelMatchKey");
  });

  it("every pair the OLD rule deduped, the NEW rule still dedupes", () => {
    // Asserted on `parcelKey`, which is what parcelDedupKey returns for any
    // ref parcelRef accepts. Merging removes a duplicate import; SPLITTING
    // creates one, which is the direction that must be impossible.
    let sameUnderOld = 0;
    for (const { a, b, label } of PAIRS) {
      if (oldDedupKey(...a) !== oldDedupKey(...b)) continue;
      sameUnderOld++;
      const ra = normalizeParcelRef({ state: a[0], county: a[1], apn: a[2] });
      const rb = normalizeParcelRef({ state: b[0], county: b[1], apn: b[2] });
      expect(ra.ok && rb.ok, `fixture "${label}" is not a valid parcel ref`).toBe(true);
      if (!ra.ok || !rb.ok) continue;
      expect(
        parcelKey(ra.ref),
        `SPLIT: "${label}" deduped under the old rule and does not any more. ` +
          "That re-imports rows that were already skipped.",
      ).toBe(parcelKey(rb.ref));
    }
    expect(
      sameUnderOld,
      "no pair in this set deduped under the old rule, so the property was " +
        "never actually tested.",
    ).toBeGreaterThan(0);
  });

  it("collapsing a whitespace run MERGES two keys that used to differ", () => {
    // The direction the adoption deliberately moves in, pinned so it cannot be
    // silently reversed. Named in taxDelinquentPipeline.ts's own comment.
    expect(oldDedupKey("TX", "Travis", "12  345")).not.toBe(oldDedupKey("TX", "Travis", "12 345"));
    const wide = normalizeParcelRef({ state: "TX", county: "Travis", apn: "12  345" });
    const tight = normalizeParcelRef({ state: "TX", county: "Travis", apn: "12 345" });
    expect(wide.ok && tight.ok).toBe(true);
    if (wide.ok && tight.ok) expect(parcelKey(wide.ref)).toBe(parcelKey(tight.ref));
  });

  it("a REFUSED key falls back to the pre-parcelRef rule, byte for byte", () => {
    // Imported county lists genuinely arrive with no county or no state, and
    // parcelRef refuses those. A refusal must not read as "not a duplicate" —
    // that re-imports the same rows on every retry. The fallback is the only
    // part of this key parcelRef does not own, so it is pinned literally.
    expect(normalizeParcelRef({ state: "TX", county: "", apn: "12-345" }).ok).toBe(false);
    expect(dedupSource).toContain(
      '`unnormalized|${(state ?? "").toLowerCase().trim()}|${(county ?? "").toLowerCase().trim()}|${(apn ?? "").toLowerCase().trim()}`',
    );
  });

  it("the refusal prefix can never collide with a real parcelKey", () => {
    // A parcelKey always starts with a two-letter upper-case state code and a
    // space, so it can never begin "unnormalized|". A collision would let a
    // refused row silently dedupe against a properly-keyed one — a WRONG MERGE,
    // the unrecoverable direction.
    const real = normalizeParcelRef({ state: "TX", county: "travis", apn: "12-345" });
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(parcelKey(real.ref).startsWith("unnormalized|")).toBe(false);
    expect(parcelKey(real.ref)).toMatch(/^[A-Z]{2} /);
  });
});

describe("the two readers of `parcel_snapshots` agree about which row is which", () => {
  // The defect this ends: `gisRepo.ts` and `dueDiligence.ts` both read and write
  // ONE table with DIFFERENT identity rules, so each could miss rows the other
  // had written and write duplicates the other could not find. Two writers
  // disagreeing about identity is not untidiness — in a data cache it serves
  // one parcel's acreage, zoning and owner under another parcel's name.
  const gis = readFileSync(
    path.resolve(__dirname, "../../server/storage/gisRepo.ts"),
    "utf8",
  );
  const dd = readFileSync(
    path.resolve(__dirname, "../../server/services/dueDiligence.ts"),
    "utf8",
  );

  it("both match the APN with UPPER() and punctuation PRESERVED", () => {
    const apnPredicate = "UPPER(${parcelSnapshots.apn}) = ";
    expect(gis, "gisRepo no longer matches the APN the way dueDiligence does").toContain(
      apnPredicate,
    );
    expect(dd, "dueDiligence no longer matches the APN the way gisRepo does").toContain(
      apnPredicate,
    );
  });

  it("NEITHER strips APN punctuation in SQL any more", () => {
    // `REPLACE(REPLACE(apn,'-',''),' ','')` is the wrong-merge rule: it makes
    // "12-345" and "12345" one row in counties where the separator is
    // significant, and a wrong merge cannot be undone from the merged data.
    for (const [name, src] of [["gisRepo", gis], ["dueDiligence", dd]] as const) {
      expect(
        /REPLACE\s*\(\s*REPLACE\s*\(/i.test(src),
        `${name} strips APN punctuation in SQL again — that merges distinct parcels`,
      ).toBe(false);
    }
  });

  it("both tolerate the stored county suffix, and identically", () => {
    // Rows predate normalisation, so "Travis", "travis" and "Travis County" all
    // exist. Matching only the canonical form orphans the long spellings.
    const tolerant = "IN (${normalizedCounty}, ${`${normalizedCounty} county`})";
    expect(dd).toContain(tolerant);
    expect(gis).toContain("IN (${normalizedCounty}, ${`${normalizedCounty} county`})");
  });

  it("no case-SENSITIVE county REPLACE survives (it could not strip its own writes)", () => {
    // The original bug inside gisRepo: JS lower-cased the county on the way in,
    // while the SQL looked for a capital-C ' County' — so the query could not
    // find rows the same function had written.
    expect(
      /REPLACE\s*\(\s*\$\{parcelSnapshots\.county\}\s*,\s*' County'/.test(gis),
      "the case-sensitive county REPLACE is back",
    ).toBe(false);
  });

  it("both WRITE the normalised triple, so the stored key is the searched key", () => {
    // The deeper half of the old defect: gisRepo normalised for the LOOKUP but
    // stored `...data` verbatim, so the string it searched for was never the
    // string it had written.
    expect(gis, "gisRepo writes un-normalised parcel columns again").toContain("...normalized,");
    expect(dd).toContain("apn: normalizedApn,");
    expect(dd).toContain("county: normalizedCounty,");
  });
});

// ── The adoption ratchet ────────────────────────────────────────────────────
//
// The two adoptions above are worth little on their own: the reason parcelRef
// exists is that a parcel key kept being re-invented, and nothing stopped the
// next one. This counts the call sites that still open-code a parcel natural
// key and freezes the number DOWN-ONLY.
//
// SCOPE: APN normalisation specifically. The APN is the part of the natural key
// with no other job in this repo — state and county strings get normalised in a
// hundred places that have nothing to do with parcels, but an APN being
// case-folded or stripped of punctuation is always somebody deciding what
// counts as the same parcel. Scoping to the APN is what makes the number mean
// something rather than drift with unrelated code.

/** An APN-bearing identifier that is immediately case-folded. */
const APN_CASE_FOLD =
  /apn[A-Za-z0-9_]*['"]?\s*(?:\)|\]|\??\.)*\s*\.\s*(?:toLowerCase|toUpperCase)\s*\(\s*\)/i;
/** Any APN-bearing identifier on the line (paired with the strips below). */
const APN_TOKEN = /\bapn\b|\bapns\b|apnKey|apnRaw|parcelNumber/i;
/** A JS character-class strip, e.g. `.replace(/[-\s]/g, "")`. */
const JS_STRIP = /\.\s*replace\s*\(\s*\//;
/** The same rule pushed down into SQL, e.g. `REPLACE(REPLACE(apn,'-',''),' ','')`. */
const SQL_STRIP = /\bREPLACE\s*\(/;
/**
 * Normalising for a substring search is a FILTER, not a key — it never decides
 * that two rows are one parcel. Excluded on purpose, so the number stays a
 * count of identity rules rather than a count of `toLowerCase` calls.
 */
const SEARCH_PREDICATE = /\.(?:includes|startsWith|endsWith|indexOf|search|match)\s*\(/;

function isOpenCodedParcelKey(line: string): boolean {
  if (SEARCH_PREDICATE.test(line)) return false;
  if (APN_CASE_FOLD.test(line)) return true;
  return APN_TOKEN.test(line) && (JS_STRIP.test(line) || SQL_STRIP.test(line));
}

const REPO_ROOT = path.resolve(__dirname, "../..");
const SCAN_ROOTS = ["server", "shared", "client/src"];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walkTsFiles(p, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

interface OpenCodedSite {
  file: string;
  line: number;
  text: string;
}

function scanOpenCodedSites(): { files: string[]; sites: OpenCodedSite[] } {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) files.push(...walkTsFiles(path.join(REPO_ROOT, root)));

  const sites: OpenCodedSite[] = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    // parcelRef.ts IS the owner; its rule is not an open-coded competitor.
    if (rel.startsWith("shared/parcel/")) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (isOpenCodedParcelKey(line)) sites.push({ file: rel, line: i + 1, text: line.trim() });
      });
  }
  return { files, sites };
}

/**
 * MEASURED, not guessed: 10 sites before these two adoptions, 8 after (the two
 * that moved are exactly publicParcelReport.ts:140 and
 * taxDelinquentPipeline.ts:262). DOWN-ONLY — when you retire one, lower this in
 * the same commit.
 *
 * 8 -> 4 on 2026-08-17: `server/storage/gisRepo.ts` adopted parcelRef, retiring
 * all four of its sites at once. Not a tidy-up — it was a FOURTH LIVE RULE
 * (APN stripped of "-" and spaces then lower-cased, once in JS and again in
 * SQL) reading and writing `parcel_snapshots`, the SAME table dueDiligence.ts
 * matches with the strict rule, and the two disagreed about real rows:
 *   · gisRepo merged "12-345" with "12345"; dueDiligence keeps them apart. A
 *     wrong merge in a data cache serves one parcel's acreage, zoning and owner
 *     as another parcel's.
 *   · gisRepo stripped a " County" suffix; dueDiligence did not — so a row
 *     written by either was invisible to the other.
 *   · gisRepo disagreed WITH ITSELF: its JS used `/ county$/i` while its SQL
 *     used a case-SENSITIVE `REPLACE(county,' County','')`, so it could not
 *     find rows its own writes had lower-cased.
 * The suffix rule moved into parcelRef (it was open-coded at four sites with
 * four spellings), and both readers are now suffix-TOLERANT against rows
 * written before either writer normalised.
 *
 * 4 -> 2 on 2026-08-17: `server/services/taxSaleCsvImport.ts` adopted parcelRef,
 * retiring both of its sites. This one was DROPPING REAL PARCELS: the import
 * deduped on `apn.toUpperCase()` with neither state nor county in the key, and
 * an APN is unique only WITHIN a county. A state-level tax-sale list — the
 * ordinary shape of one — had the second county's parcel 123-45-678 rejected as
 * "already on this worksheet", and the row never imported. `county` and `state`
 * are REQUIRED import fields, so the whole key was on the row the entire time.
 *
 * What the remaining 2 are, so the next session need not re-derive them:
 *   server/services/parcel.ts ×2 — upstream query fan-out (stripped / trimmed /
 *     leading-zero-stripped APN variants). The most defensible of the set — it
 *     is deliberately trying several spellings against a vendor API rather than
 *     deciding an identity — but `parcelMatchKey` is precisely what it is
 *     reinventing, and a fan-out that disagrees with the repo's candidate rule
 *     will find rows the rest of the system then cannot match.
 */
const PARCEL_KEY_OPEN_CODED_BASELINE = 2;

describe("adoption ratchet: open-coded parcel natural keys", () => {
  const { files, sites } = scanOpenCodedSites();

  it("the scan is not vacuous — real files walked, and the matcher matches", () => {
    // A scanner that silently walks nothing reports a beautiful zero forever.
    expect(files.length, "the scan found no TypeScript files AT ALL").toBeGreaterThan(0);
    expect(files.length, "implausibly few files walked — check SCAN_ROOTS").toBeGreaterThan(500);

    // Positive controls: every rule this repo actually had, verbatim.
    expect(isOpenCodedParcelKey('const apnKey = apn.toUpperCase().replace(/[^A-Z0-9]/g, "");')).toBe(
      true,
    );
    expect(isOpenCodedParcelKey("`${s.toLowerCase()}|${c.toLowerCase()}|${apn.toLowerCase()}`")).toBe(
      true,
    );
    expect(isOpenCodedParcelKey('const cleanApn = apn.replace(/[-\\s]/g, "");')).toBe(true);
    expect(
      isOpenCodedParcelKey(
        "sql`LOWER(REPLACE(REPLACE(${parcelSnapshots.apn}, '-', ''), ' ', '')) = ${x}`",
      ),
    ).toBe(true);

    // Negative controls: routed through the owner, or not a key at all.
    expect(isOpenCodedParcelKey("return parcelKey(ref.ref);")).toBe(false);
    expect(isOpenCodedParcelKey("const apnKey = looseApnKey(parcelRef.ref);")).toBe(false);
    expect(isOpenCodedParcelKey("p.apn.toLowerCase().includes(needle)")).toBe(false);
  });

  it("the count may only shrink", () => {
    const listing = sites.map((s) => `${s.file}:${s.line}  ${s.text.slice(0, 100)}`).join("\n");
    expect(
      sites.length,
      "A new call site open-codes a parcel natural key. Route it through " +
        "shared/parcel/parcelRef.ts instead — parcelKey when the code is " +
        "deciding an IDENTITY, parcelMatchKey when it is finding CANDIDATES.\n" +
        listing,
    ).toBeLessThanOrEqual(PARCEL_KEY_OPEN_CODED_BASELINE);

    if (sites.length < PARCEL_KEY_OPEN_CODED_BASELINE) {
      throw new Error(
        `Open-coded parcel keys are down to ${sites.length}. Lower ` +
          `PARCEL_KEY_OPEN_CODED_BASELINE to ${sites.length} in this same commit — ` +
          "fix the occurrence AND the baseline, or the ratchet stops ratcheting.",
      );
    }
  });

  it("every file that adopted parcelRef stopped open-coding one", () => {
    // The adoption is only real if the old rule is GONE, not merely unused.
    for (const file of [
      "server/services/taxDelinquentPipeline.ts",
      "server/services/publicParcelReport.ts",
      "server/services/dueDiligence.ts",
      "server/storage/gisRepo.ts",
      "server/services/taxSaleCsvImport.ts",
    ]) {
      expect(
        sites.filter((s) => s.file === file),
        `${file} imports parcelRef but still normalises an APN itself`,
      ).toEqual([]);
      expect(
        readFileSync(path.join(REPO_ROOT, file), "utf8"),
        `${file} must import the parcel-identity owner`,
      ).toContain("@shared/parcel/parcelRef");
    }
  });
});
