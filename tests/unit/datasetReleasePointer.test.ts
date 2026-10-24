/**
 * D2b — release names and the release pointer.
 *
 *   - names: `acreos-parcels vYYYY.MM.N`, strict parse, N contiguous within a
 *     UTC month, never reused, never minted for an earlier month;
 *   - pointer: promotion and rollback are both a NEW entry; the input history
 *     is never mutated (deep-frozen input, byte-identical after, prefix kept
 *     by reference, output frozen); default rollback walks back one version
 *     at a time; a corrupted history is refused, never extended.
 *
 * Release ids here are sha256 of SYNTHETIC labels.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { auditReleaseNames, formatReleaseName, nextReleaseName, parseReleaseName } from "../../server/services/landData/releases/releaseName";
import {
  currentRelease,
  promote,
  rollback,
  verifyPointerHistory,
  type PointerEntry,
  type PointerHistory,
} from "../../server/services/landData/releases/releasePointer";

const rid = (label: string) => `sha256:${createHash("sha256").update(`SYNTHETIC release ${label}`).digest("hex")}`;
const A = rid("A");
const B = rid("B");
const C = rid("C");
const D = rid("D");
const CATALOG = new Set([A, B, C, D]);
const mv = (iso: string, reason = "synthetic test move") => ({ at: new Date(iso), actor: "synthetic-operator", reason });

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v as object)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** A → B → C, all in October 2026. */
function abc(): PointerHistory {
  let h: PointerHistory = [];
  h = promote(h, A, mv("2026-10-01T12:00:00Z"), CATALOG).history;
  h = promote(h, B, mv("2026-10-10T12:00:00Z"), CATALOG).history;
  h = promote(h, C, mv("2026-10-20T12:00:00Z"), CATALOG).history;
  return h;
}

describe("release names", () => {
  it("format and strict parse round-trip", () => {
    expect(formatReleaseName({ year: 2026, month: 3, seq: 12 })).toBe("acreos-parcels v2026.03.12");
    expect(parseReleaseName("acreos-parcels v2026.03.12")).toEqual({ year: 2026, month: 3, seq: 12 });
  });

  it.each(["acreos-parcels v2026.3.1", "acreos-parcels v2026.13.1", "acreos-parcels v2026.03.0", "acreos-parcels v2026.03.01", "acreos-parcel v2026.03.1", " acreos-parcels v2026.03.1"])(
    "rejects %j",
    (n) => {
      expect(parseReleaseName(n)).toBeNull();
    },
  );

  it("sequences within a month with no gaps, and restarts at 1 in a new month", () => {
    const names: string[] = [];
    for (const iso of ["2026-10-01T00:00:00Z", "2026-10-15T00:00:00Z", "2026-10-31T23:59:59Z", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"]) {
      names.push(nextReleaseName(names, new Date(iso)));
    }
    expect(names).toEqual([
      "acreos-parcels v2026.10.1",
      "acreos-parcels v2026.10.2",
      "acreos-parcels v2026.10.3",
      "acreos-parcels v2026.11.1",
      "acreos-parcels v2026.11.2",
    ]);
    expect(auditReleaseNames(names)).toEqual([]);
  });

  it("uses the UTC month", () => {
    // 23:30 on Oct 31 in New York is already November in UTC.
    expect(nextReleaseName([], new Date("2026-10-31T23:30:00-04:00"))).toBe("acreos-parcels v2026.11.1");
  });

  it("refuses to extend a history with a gap or a reuse", () => {
    expect(() => nextReleaseName(["acreos-parcels v2026.10.1", "acreos-parcels v2026.10.3"], new Date("2026-10-20Z"))).toThrow(/gap in 2026.10/);
    expect(() => nextReleaseName(["acreos-parcels v2026.10.1", "acreos-parcels v2026.10.1"], new Date("2026-10-20Z"))).toThrow(/reused/);
  });

  it("refuses a month earlier than the latest name (clock went backwards)", () => {
    expect(() => nextReleaseName(["acreos-parcels v2026.11.1"], new Date("2026-10-20Z"))).toThrow(/clock went backwards/);
  });
});

describe("promotion", () => {
  it("first promotion mints the name; the pointer is the last entry", () => {
    const h = abc();
    expect(h.map((e) => [e.seq, e.action, e.releaseName])).toEqual([
      [1, "promote", "acreos-parcels v2026.10.1"],
      [2, "promote", "acreos-parcels v2026.10.2"],
      [3, "promote", "acreos-parcels v2026.10.3"],
    ]);
    expect(h.map((e) => e.previousReleaseId)).toEqual([null, A, B]);
    expect(currentRelease(h)).toEqual({ releaseId: C, releaseName: "acreos-parcels v2026.10.3" });
    expect(verifyPointerHistory(h)).toEqual([]);
  });

  it("refuses an unknown release, a non-id, and a release that was current before", () => {
    const h = abc();
    expect(() => promote(h, rid("never-stored"), mv("2026-10-21Z"), CATALOG)).toThrow(/not a known release/);
    expect(() => promote(h, "v2026.10.4", mv("2026-10-21Z"), CATALOG)).toThrow(/not a release id/);
    expect(() => promote(h, A, mv("2026-10-21Z"), CATALOG)).toThrow(/use rollback|with rollback/);
  });

  it("refuses a move with no actor, no reason, or an instant before the last entry", () => {
    const h = abc();
    expect(() => promote(h, D, { ...mv("2026-10-21Z"), actor: " " }, CATALOG)).toThrow(/who made it/);
    expect(() => promote(h, D, mv("2026-10-21Z", ""), CATALOG)).toThrow(/says why/);
    expect(() => promote(h, D, mv("2026-10-19Z"), CATALOG)).toThrow(/predate/);
  });
});

describe("rollback is a new entry, never a deletion or edit", () => {
  it("default rollback walks back one version at a time, keeping names", () => {
    let h = abc();
    h = rollback(h, mv("2026-10-21T00:00:00Z")).history;
    expect(currentRelease(h)).toEqual({ releaseId: B, releaseName: "acreos-parcels v2026.10.2" });
    h = rollback(h, mv("2026-10-22T00:00:00Z")).history;
    expect(currentRelease(h)).toEqual({ releaseId: A, releaseName: "acreos-parcels v2026.10.1" });
    expect(() => rollback(h, mv("2026-10-23T00:00:00Z"))).toThrow(/first release ever promoted/);
    expect(h).toHaveLength(5);
    expect(h.map((e) => e.action)).toEqual(["promote", "promote", "promote", "rollback", "rollback"]);
    expect(h[3].previousReleaseId).toBe(C);
    expect(verifyPointerHistory(h)).toEqual([]);
  });

  it("explicit roll-forward to a once-current release reuses its name", () => {
    let h = abc();
    h = rollback(h, mv("2026-10-21Z")).history;
    const r = rollback(h, mv("2026-10-22Z"), C);
    expect(r.entry).toMatchObject({ action: "rollback", releaseId: C, releaseName: "acreos-parcels v2026.10.3", previousReleaseId: B });
  });

  it("refuses rollback to a release never current, to the current one, or with nothing promoted", () => {
    const h = abc();
    expect(() => rollback(h, mv("2026-10-21Z"), D)).toThrow(/never current/);
    expect(() => rollback(h, mv("2026-10-21Z"), C)).toThrow(/already current/);
    expect(() => rollback([], mv("2026-10-21Z"))).toThrow(/nothing to roll back/);
  });

  it("a later NEW release after a rollback still gets the next name (names are never reused)", () => {
    let h = abc();
    h = rollback(h, mv("2026-10-21Z")).history;
    const r = promote(h, D, mv("2026-10-22Z"), CATALOG);
    expect(r.entry.releaseName).toBe("acreos-parcels v2026.10.4");
    expect(r.entry.previousReleaseId).toBe(B);
  });

  it("never mutates its input: deep-frozen input, identical after, prefix by reference, output frozen", () => {
    const input = deepFreeze(abc().map((e) => ({ ...e })));
    const before = JSON.stringify(input);
    const r1 = rollback(input, mv("2026-10-21Z"));
    const r2 = promote(input, D, mv("2026-10-21Z"), CATALOG);
    expect(JSON.stringify(input)).toBe(before);
    expect(input).toHaveLength(3);
    for (const r of [r1, r2]) {
      expect(r.history).toHaveLength(4);
      r.history.slice(0, 3).forEach((e, i) => expect(e).toBe(input[i]));
      expect(r.history[3]).toBe(r.entry);
      expect(Object.isFrozen(r.history)).toBe(true);
      expect(Object.isFrozen(r.entry)).toBe(true);
      expect(() => (r.history as PointerEntry[]).push(r.entry)).toThrow(TypeError);
    }
  });
});

describe("a corrupted history is refused, never extended", () => {
  const tamper = (mut: (h: PointerEntry[]) => void) => {
    const h = abc().map((e) => ({ ...e }));
    mut(h);
    return h;
  };

  type Mut = (h: PointerEntry[]) => void;
  const cases: Array<[string, Mut, RegExp]> = [
    ["a deleted middle entry", (h) => { h.splice(1, 1); }, /seq is 3|previousReleaseId/],
    ["a rewritten target", (h) => { h[1].releaseId = D; }, /previousReleaseId/],
    ["a renamed release", (h) => { h[2].releaseName = "acreos-parcels v2026.10.9"; }, /should be acreos-parcels v2026.10.3/],
    ["a reordered instant", (h) => { h[2].at = "2026-09-01T00:00:00.000Z"; }, /backwards/],
    ["a promote of a once-current release", (h) => { h.push({ ...h[0], seq: 4, previousReleaseId: C, at: "2026-10-25T00:00:00.000Z" }); }, /that is a rollback/],
  ];
  it.each(cases)("%s", (_n, mut, re) => {
    const h = tamper(mut);
    expect(verifyPointerHistory(h).join(" | ")).toMatch(re);
    expect(() => rollback(h, mv("2026-10-30Z"))).toThrow(/not valid/);
    expect(() => promote(h, rid("E"), mv("2026-10-30Z"), new Set([...CATALOG, rid("E")]))).toThrow(/not valid/);
  });
});
