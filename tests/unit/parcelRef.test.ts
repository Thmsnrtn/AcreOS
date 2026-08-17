/**
 * One definition of "the same parcel".
 *
 * `shared/parcel/parcelRef.ts` exists because three call sites each resolved a
 * parcel's natural key (state, county, APN) with a DIFFERENT normalisation, and
 * they disagreed about real parcels. The tests below re-create each historical
 * rule and assert the disagreement, so this file documents the defect rather
 * than just guarding the fix — if someone later decides the canonical rule
 * should change, these show exactly whose behaviour they are changing.
 *
 * The measured rules at HEAD before this landed:
 *
 *   dueDiligence.ts:255        state.toUpperCase() · county.toLowerCase() · apn.trim()
 *   taxDelinquentPipeline:261  state.toLowerCase() · county.toLowerCase() · apn.toLowerCase().trim()
 *   publicParcelReport.ts:139  apn.toUpperCase().replace(/[^A-Z0-9]/g, "")
 */

import { describe, it, expect } from "vitest";
import {
  normalizeParcelRef,
  parcelKey,
  parcelMatchKey,
  sameParcel,
  type ParcelRef,
} from "../../shared/parcel/parcelRef";

/** Convenience: normalise or throw, for cases that must succeed. */
function ref(state: string, county: string, apn: string): ParcelRef {
  const r = normalizeParcelRef({ state, county, apn });
  if (!r.ok) throw new Error(`expected a valid ref, got ${r.problems.join(",")}`);
  return r.ref;
}

// ── The historical rules, re-created exactly ────────────────────────────────
const dueDiligenceKey = (s: string, c: string, a: string) =>
  `${s.toUpperCase()}|${c.toLowerCase()}|${a.trim()}`;
const taxPipelineKey = (s: string, c: string, a: string) =>
  `${s.toLowerCase().trim()}|${c.toLowerCase().trim()}|${a.toLowerCase().trim()}`;
const publicReportApn = (a: string) => a.toUpperCase().replace(/[^A-Z0-9]/g, "");

describe("the disagreement this file exists to end (vacuity guard, first)", () => {
  it("the three historical rules really did disagree — else there was nothing to fix", () => {
    // If these ever stop disagreeing, the premise of parcelRef.ts is gone and
    // someone should re-read it rather than trust the tests below.
    expect(
      dueDiligenceKey("CA", "Fresno", "a-1-2"),
      "dueDiligence preserved APN case; the tax pipeline lower-cased it",
    ).not.toBe(taxPipelineKey("CA", "Fresno", "a-1-2"));

    expect(
      publicReportApn("12-345-678"),
      "publicParcelReport stripped punctuation; nobody else did",
    ).toBe(publicReportApn("12345678"));
    expect("12-345-678".trim()).not.toBe("12345678".trim());
  });

  it("a state written by one rule could never match a row written by the other", () => {
    // dueDiligence stored/compared UPPER, the tax pipeline lower. A tuple key
    // from one side simply never matched the other side's rows.
    expect(dueDiligenceKey("ca", "Fresno", "1").startsWith("CA")).toBe(true);
    expect(taxPipelineKey("CA", "Fresno", "1").startsWith("ca")).toBe(true);
  });
});

describe("normalizeParcelRef", () => {
  it("upper-cases state, lower-cases county, upper-cases APN", () => {
    expect(ref("ca", "FRESNO", "a-1-2")).toEqual({
      state: "CA",
      county: "fresno",
      apn: "A-1-2",
    });
  });

  it("collapses whitespace rather than trusting the caller's spacing", () => {
    expect(ref(" ca ", "  San   Bernardino ", " 12  345 ")).toEqual({
      state: "CA",
      county: "san bernardino",
      apn: "12 345",
    });
  });

  it('treats "Travis County" and "Travis" as one county', () => {
    // Callers genuinely supply both spellings — county GIS endpoints return the
    // long form, CSV imports usually the short one. Two identities for one
    // place silently splits every downstream comparison.
    expect(sameParcel(ref("TX", "Travis County", "12-345"), ref("TX", "Travis", "12-345"))).toBe(
      true,
    );
    expect(ref("TX", "TRAVIS COUNTY", "12-345").county).toBe("travis");
  });

  it("strips the suffix only when something is left of the name", () => {
    // A county whose whole name is "County" must not normalise to the empty
    // string and then be refused as county-missing: that turns a merely odd
    // input into an unusable one.
    expect(ref("TX", "County", "12-345").county).toBe("county");
    expect(ref("TX", "  County  ", "12-345").county).toBe("county");
  });

  it("does not strip a county whose name merely ENDS in those letters", () => {
    // The rule is a trailing WORD, not a substring — otherwise a real place
    // name is quietly truncated into a different one.
    expect(ref("TX", "Montcounty", "12-345").county).toBe("montcounty");
  });

  it("REFUSES with reasons instead of guessing", () => {
    // A fabricated identity attaches evidence, decisions and money to the wrong
    // piece of land. Refusing is the only safe answer.
    const r = normalizeParcelRef({ state: "", county: "", apn: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems).toEqual(
        expect.arrayContaining(["state-missing", "county-missing", "apn-missing"]),
      );
    }
  });

  it("rejects a state that is not a two-letter code", () => {
    const r = normalizeParcelRef({ state: "California", county: "fresno", apn: "1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain("state-malformed");
  });

  it("rejects an APN with no digit in it", () => {
    // Guards against a county name or a placeholder arriving in the APN slot.
    const r = normalizeParcelRef({ state: "CA", county: "fresno", apn: "UNKNOWN" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain("apn-implausible");
  });

  it("reports EVERY problem, not just the first", () => {
    const r = normalizeParcelRef({ state: "California", county: "", apn: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parcelKey is an identity", () => {
  it("case and spacing differences do not make a different parcel", () => {
    expect(sameParcel(ref("ca", "Fresno", "a-1"), ref("CA", "FRESNO", " A-1 "))).toBe(true);
  });

  it("PUNCTUATION DOES make a different parcel, deliberately", () => {
    // publicParcelReport stripped it. That merges parcels in any county where a
    // separator is significant, and a wrong merge is unrecoverable — two
    // parcels' evidence lands on one identity with nothing to separate them.
    expect(sameParcel(ref("CA", "fresno", "12-345-678"), ref("CA", "fresno", "12345678"))).toBe(
      false,
    );
  });

  it("cannot be collided by a separator inside a field", () => {
    // The reason the separator is a space and not a pipe: with a pipe,
    // ("a|b","c") and ("a","b|c") produce the same string, and a collision here
    // attaches one parcel's evidence to another parcel's identity.
    const a = ref("CA", "a|b", "1|2");
    const b = ref("CA", "a", "b|1|2");
    expect(parcelKey(a)).not.toBe(parcelKey(b));
  });

  it("different counties in the same state are different parcels", () => {
    expect(sameParcel(ref("CA", "fresno", "1-1"), ref("CA", "kern", "1-1"))).toBe(false);
  });

  it("the same APN in different states is a different parcel", () => {
    expect(sameParcel(ref("CA", "fresno", "1-1"), ref("TX", "fresno", "1-1"))).toBe(false);
  });
});

describe("parcelMatchKey is a lookup, not an identity", () => {
  it("collides punctuation variants on purpose", () => {
    expect(parcelMatchKey(ref("CA", "fresno", "12-345-678"))).toBe(
      parcelMatchKey(ref("CA", "fresno", "12345678")),
    );
  });

  it("but still separates state and county", () => {
    // A loose APN match must not become a loose PARCEL match.
    expect(parcelMatchKey(ref("CA", "fresno", "12-345"))).not.toBe(
      parcelMatchKey(ref("CA", "kern", "12345")),
    );
  });

  it("is not the identity key, so it cannot be used as one by accident", () => {
    const r = ref("CA", "fresno", "12-345");
    expect(parcelMatchKey(r)).not.toBe(parcelKey(r));
  });
});
