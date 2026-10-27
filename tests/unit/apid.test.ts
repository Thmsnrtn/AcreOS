/**
 * D2c — APID minting and APN validity windows (shared/landData/apid.ts).
 *
 * The scenario drives one SYNTHETIC county through four releases built from
 * the golden lineage file, then asserts the three invariants the spec makes
 * load-bearing: an APID is never reused, windows never overlap for one APN
 * (or one APID), and identity is carried only where lineage says the land is
 * the same. ledgerViolations() is itself falsified on hand-broken ledgers.
 */
import { describe, expect, it } from "vitest";
import golden from "../../shared/landData/golden/lineage-golden.json";
import {
  apidForApnAt,
  applyRelease,
  emptyLedger,
  formatApid,
  ledgerViolations,
  parseApid,
  type ApidLedger,
  type Release,
} from "../../shared/landData/apid";
import { type LineageGeometry, type LineageInput, type LineageParcel, type LngLat } from "../../shared/landData/lineage";

type GoldenGeometry = { rect: number[] } | { rects: number[][] } | null;
interface GoldenCase { name: string; previous: Array<{ sourceId: string; geometry: GoldenGeometry }>; next: Array<{ sourceId: string; geometry: GoldenGeometry }> }
const G = golden as unknown as { unitDegrees: number; originLat: number; originLngStart: number; originLngStep: number; cases: GoldenCase[] };

function rectRing(r: number[], lng0: number): LngLat[] {
  const u = G.unitDegrees;
  const p = (x: number, y: number): LngLat => [lng0 + x * u, G.originLat + y * u];
  return [p(r[0], r[1]), p(r[2], r[1]), p(r[2], r[3]), p(r[0], r[3]), p(r[0], r[1])];
}
function expand(g: GoldenGeometry, lng0: number): LineageGeometry | null {
  if (g === null) return null;
  if ("rect" in g) return { type: "Polygon", coordinates: [rectRing(g.rect, lng0)] };
  return { type: "MultiPolygon", coordinates: g.rects.map((r) => [rectRing(r, lng0)]) };
}
const side = (k: "previous" | "next"): LineageParcel[] =>
  G.cases.flatMap((c, i) => c[k].map((r) => ({ sourceId: r.sourceId, geometry: expand(r.geometry, G.originLngStart + i * G.originLngStep) })));

const STATE = "FL";
const FIPS = "99999"; // not a real county — the scenario is synthetic
const R = (n: number): Release => ({ releaseId: `SYNTHETIC-R${n}`, ordinal: n });

function apply(ledger: ApidLedger, release: Release, input: LineageInput) {
  const r = applyRelease(ledger, release, input);
  if (!r.ok) throw new Error(`${r.reason}: ${r.detail}`);
  expect(ledgerViolations(r.ledger), `violations after ${release.releaseId}`).toEqual([]);
  return r;
}

/** Release 1 = every golden "previous", release 2 = every golden "next". */
function twoReleases() {
  const r1 = apply(emptyLedger(STATE, FIPS), R(1), { previous: [], next: side("previous") });
  const r2 = apply(r1.ledger, R(2), { previous: side("previous"), next: side("next") });
  return { r1, r2 };
}

describe("APID format", () => {
  it("round-trips and refuses malformed scope", () => {
    const a = formatApid("fl", "12089", 42);
    expect(a).toBe("APID-FL-12089-0000042");
    expect(parseApid(a)).toEqual({ state: "FL", countyFips: "12089", seq: 42 });
    expect(parseApid("FL-12089-513N270700000S0000")).toBeNull(); // a crosswalk parcel_key is not an APID
    expect(() => formatApid("FLA", "12089", 1)).toThrow();
    expect(() => formatApid("FL", "1208", 1)).toThrow();
    expect(() => formatApid("FL", "12089", 0)).toThrow();
  });
});

describe("applyRelease — identity follows lineage", () => {
  it("first release mints one APID per record, in order", () => {
    const { r1 } = twoReleases();
    const prevIds = side("previous").map((p) => p.sourceId);
    expect(Object.keys(r1.assignment).sort()).toEqual([...prevIds].sort());
    expect(new Set(Object.values(r1.assignment)).size).toBe(prevIds.length);
    expect(r1.ledger.nextSeq).toBe(prevIds.length + 1);
  });

  it("same and renumber keep the APID; renumber moves the APN window", () => {
    const { r1, r2 } = twoReleases();
    expect(r2.assignment["SYNTHETIC-01-A"]).toBe(r1.assignment["SYNTHETIC-01-A"]);
    expect(r2.assignment["SYNTHETIC-02-A"]).toBe(r1.assignment["SYNTHETIC-02-A"]);
    const apid = r1.assignment["SYNTHETIC-03-OLD"];
    expect(r2.assignment["SYNTHETIC-03-NEW"]).toBe(apid);
    const ws = r2.ledger.windows.filter((w) => w.apid === apid).map((w) => [w.apn, w.validFrom, w.validTo]);
    expect(ws).toEqual([["SYNTHETIC-03-OLD", 1, 2], ["SYNTHETIC-03-NEW", 2, null]]);
    expect(apidForApnAt(r2.ledger, "SYNTHETIC-03-OLD", 1)).toBe(apid);
    expect(apidForApnAt(r2.ledger, "SYNTHETIC-03-OLD", 2)).toBeNull();
    expect(apidForApnAt(r2.ledger, "SYNTHETIC-03-NEW", 1)).toBeNull();
  });

  it("split children get new APIDs whose parent is the retired parent — including the remainder that keeps the APN", () => {
    const { r1, r2 } = twoReleases();
    const parent = r1.assignment["SYNTHETIC-05-D"];
    const kid = r2.assignment["SYNTHETIC-05-D"];
    expect(kid).not.toBe(parent);
    expect(r2.ledger.apids[kid].parents).toEqual([parent]);
    expect(r2.ledger.apids[r2.assignment["SYNTHETIC-05-D-1"]].parents).toEqual([parent]);
    expect(r2.ledger.apids[parent].status).toBe("retired");
    // One APN, two APIDs over time, never at once.
    expect(apidForApnAt(r2.ledger, "SYNTHETIC-05-D", 1)).toBe(parent);
    expect(apidForApnAt(r2.ledger, "SYNTHETIC-05-D", 2)).toBe(kid);
  });

  it("merge: one new APID, both parents retired and linked", () => {
    const { r1, r2 } = twoReleases();
    const m = r2.ledger.apids[r2.assignment["SYNTHETIC-08-M"]];
    expect(m.parents.sort()).toEqual([r1.assignment["SYNTHETIC-08-P1"], r1.assignment["SYNTHETIC-08-P2"]].sort());
    for (const p of ["SYNTHETIC-08-P1", "SYNTHETIC-08-P2"]) expect(r2.ledger.apids[r1.assignment[p]].status).toBe("retired");
  });

  it("condo: the master record keeps the parent APID; units descend from it; a no-master conversion retires the parent", () => {
    const { r1, r2 } = twoReleases();
    const g = r1.assignment["SYNTHETIC-12-G"];
    expect(r2.assignment["SYNTHETIC-12-G"]).toBe(g);
    expect(r2.ledger.apids[g].status).toBe("active");
    expect(r2.ledger.apids[r2.assignment["SYNTHETIC-12-G-1"]].parents).toEqual([g]);
    const bldg = r1.assignment["SYNTHETIC-11-BLDG"];
    expect(r2.ledger.apids[bldg].status).toBe("retired");
    expect(r2.ledger.apids[r2.assignment["SYNTHETIC-11-U101"]].parents).toEqual([bldg]);
  });

  it("ambiguous: previous APIDs are HELD (not retired, not carried); next records get provisional APIDs with candidates only", () => {
    const { r1, r2 } = twoReleases();
    const j = r1.assignment["SYNTHETIC-18-J"];
    expect(r2.ledger.apids[j].status).toBe("held");
    const nj = r2.ledger.apids[r2.assignment["SYNTHETIC-18-J"]];
    expect(nj.apid).not.toBe(j);
    expect(nj).toMatchObject({ provisional: true, parents: [], candidateParents: [j] });
  });

  it("retired → retired; an APN reused on different land gets a NEW APID", () => {
    const { r1, r2 } = twoReleases();
    expect(r2.ledger.apids[r1.assignment["SYNTHETIC-15-GONE"]].status).toBe("retired");
    expect(r2.assignment["SYNTHETIC-17-R"]).not.toBe(r1.assignment["SYNTHETIC-17-R"]);
  });

  it("an unchanged release mints nothing and changes no window", () => {
    const { r2 } = twoReleases();
    const r3 = apply(r2.ledger, R(3), { previous: side("next"), next: side("next") });
    expect(r3.ledger.nextSeq).toBe(r2.ledger.nextSeq);
    expect(r3.ledger.windows).toEqual(r2.ledger.windows);
    expect(r3.assignment).toEqual(r2.assignment);
  });
});

describe("APID is never reused", () => {
  it("across four releases — including a county reusing a RETIRED APN — every APID is minted once and no ended APID returns", () => {
    const { r1, r2 } = twoReleases();
    // Release 3: the county hands the retired APN SYNTHETIC-15-GONE to fresh land
    // in the SAME place it used to be. Lineage sees "new" (nothing in release 2
    // covers it), so it must get a new APID — the old one stays retired.
    const lng15 = G.originLngStart + G.cases.findIndex((c) => c.name === "retired") * G.originLngStep;
    const back: LineageParcel = { sourceId: "SYNTHETIC-15-GONE", geometry: expand({ rect: [0, 0, 10, 10] }, lng15) };
    const r3 = apply(r2.ledger, R(3), { previous: side("next"), next: [...side("next"), back] });
    const old = r1.assignment["SYNTHETIC-15-GONE"];
    expect(r3.assignment["SYNTHETIC-15-GONE"]).not.toBe(old);
    expect(r3.ledger.apids[old].status).toBe("retired");
    // Release 4: it goes away again.
    const r4 = apply(r3.ledger, R(4), { previous: [...side("next"), back], next: side("next") });

    const minted = Object.keys(r4.ledger.apids);
    expect(new Set(minted.map((a) => parseApid(a)?.seq)).size).toBe(minted.length);
    expect(minted.length).toBe(r4.ledger.nextSeq - 1);
    const assignments = [r1, r2, r3, r4].map((r) => r.assignment);
    assignments.forEach((as, i) => {
      for (const a of Object.values(as)) {
        const rec = r4.ledger.apids[a];
        // An APID assigned in release i+1 had not ended BEFORE that release.
        if (rec.endedIn) expect(Number(rec.endedIn.replace("SYNTHETIC-R", ""))).toBeGreaterThan(i + 1);
      }
    });
    // The crosswalk's derivation would have re-made the retired key; APID cannot.
    expect(minted.filter((a) => a === old)).toHaveLength(1);
  });

  it("the input ledger is never mutated", () => {
    const { r1 } = twoReleases();
    const snapshot = JSON.stringify(r1.ledger);
    applyRelease(r1.ledger, R(2), { previous: side("previous"), next: side("next") });
    expect(JSON.stringify(r1.ledger)).toBe(snapshot);
  });
});

describe("applyRelease refuses rather than guesses", () => {
  it("a release that is not after the last one", () => {
    const { r1 } = twoReleases();
    const r = applyRelease(r1.ledger, R(1), { previous: side("previous"), next: side("previous") });
    expect(r).toMatchObject({ ok: false, reason: "release_not_after_last" });
  });

  it("a previous snapshot that is not what the ledger holds open", () => {
    const { r1 } = twoReleases();
    const r = applyRelease(r1.ledger, R(2), { previous: side("previous").slice(1), next: side("next") });
    expect(r).toMatchObject({ ok: false, reason: "previous_snapshot_mismatch" });
    const first = applyRelease(emptyLedger(STATE, FIPS), R(1), { previous: side("previous"), next: [] });
    expect(first).toMatchObject({ ok: false, reason: "previous_snapshot_mismatch" });
  });

  it("a release listing one APN twice", () => {
    const one = side("previous")[0];
    const r = applyRelease(emptyLedger(STATE, FIPS), R(1), { previous: [], next: [one, one] });
    expect(r).toMatchObject({ ok: false, reason: "duplicate_source_id" });
  });
});

describe("ledgerViolations catches each broken invariant (the checker is falsified, not trusted)", () => {
  const base = () => twoReleases().r2.ledger;
  it("a sound ledger has none", () => expect(ledgerViolations(base())).toEqual([]));

  it("overlapping windows for one APN", () => {
    const l = base();
    const w = l.windows.find((x) => x.apn === "SYNTHETIC-05-D" && x.validTo !== null)!;
    w.validTo = 3; // the APN's next window (the split remainder's APID) starts at 2
    expect(ledgerViolations(l).join("\n")).toMatch(/windows overlap/);
  });

  it("an APID minted twice / at or above nextSeq", () => {
    const l = base();
    l.nextSeq -= 1;
    expect(ledgerViolations(l).join("\n")).toMatch(/not below nextSeq/);
  });

  it("a retired APID still naming an APN", () => {
    const l = base();
    const retired = Object.values(l.apids).find((r) => r.status === "retired")!;
    l.windows.push({ apn: "SYNTHETIC-ZOMBIE", apid: retired.apid, validFrom: 2, validFromRelease: "SYNTHETIC-R2", validTo: null, validToRelease: null });
    expect(ledgerViolations(l).join("\n")).toMatch(/still names an APN/);
  });

  it("an active APID with two open windows", () => {
    const l = base();
    const active = Object.values(l.apids).find((r) => r.status === "active")!;
    l.windows.push({ apn: "SYNTHETIC-TWIN", apid: active.apid, validFrom: 2, validFromRelease: "SYNTHETIC-R2", validTo: null, validToRelease: null });
    expect(ledgerViolations(l).join("\n")).toMatch(/active with 2 open windows/);
  });
});
