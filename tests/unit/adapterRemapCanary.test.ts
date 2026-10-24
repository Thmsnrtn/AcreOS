/**
 * D2d — fail-closed canaries. Verification must never read as a pass when it
 * read nothing, read less than the golden rule demands, or read something
 * that cannot tell a right mapping from a wrong one.
 *
 * The golden registry is swapped per test (vi.mock of goldenCountyFor only —
 * verifiedParcels, goldenMismatches and the adapter are the real code). Every
 * injected golden set is DERIVED from the real FL golden county by a labelled
 * mutation (a slot dropped, duplicated, or a verified value withheld); no
 * value is invented.
 */
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ golden: null as unknown }));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../shared/landData/goldenCounty", async (orig) => {
  const real = await orig<typeof import("../../shared/landData/goldenCounty")>();
  return { ...real, goldenCountyFor: (s: string) => (state.golden === undefined ? real.goldenCountyFor(s) : state.golden) };
});

import { healDrift } from "../../server/services/openData/adapterRemap";
import { SchemaDriftError, buildSpecFor, type LayerDeps, type LayerField } from "../../server/services/landData/statewideCadastral";
import type { GoldenCounty, GoldenParcel } from "../../shared/landData/goldenCounty";
import flGolden from "../../shared/landData/golden/fl-golden-county.json";

const FL = buildSpecFor("FL");
const NOW = new Date("2026-10-24T12:00:00Z");
const REAL = flGolden as unknown as GoldenCounty;
const clone = (): GoldenCounty => JSON.parse(JSON.stringify(REAL)) as GoldenCounty;

const f = (name: string, type: string): LayerField => ({ name, type, alias: null });
const NUM = "esriFieldTypeDouble";
const TXT = "esriFieldTypeString";
/** FL seed fields with JV replaced by `to` (a double). */
const fieldsWith = (to: string) => [f("OBJECTID", "esriFieldTypeOID"), f("CO_NO", TXT), f("PHY_CITY", TXT), f("PARCEL_ID", TXT), f("OWN_NAME", TXT), f("PHY_ADDR1", TXT), f("AV_NSD", NUM), f(to, NUM), f("SALE_PRC1", NUM), f("S_LEGAL", TXT)];
const jvDrift = (to: string) => new SchemaDriftError("FL", ["JV"], fieldsWith(to), FL.mapping);

/** A live layer serving the REAL golden parcels' attributes, JV renamed to `to` and holding `jvFrom`'s values. */
function layer(to: string, jvFrom: "JV" | "AV_NSD" = "JV"): LayerDeps & { queries: number } {
  const rows = REAL.parcels.map((p) => {
    const a = { ...(p.sourceAttributes ?? {}) };
    const v = a[jvFrom];
    delete a.JV;
    return { ...a, [to]: v };
  });
  const deps = {
    queries: 0,
    async getJson(url: string) {
      deps.queries += 1;
      const m = /^(\w+) = '(.*)'$/.exec(new URLSearchParams(url.split("?")[1]).get("where") ?? "");
      const feats = m ? rows.filter((r) => String(r[m[1]]) === m[2]) : [];
      return { ok: true, status: 200, body: { features: feats.map((attributes) => ({ attributes })) } };
    },
  };
  return deps;
}

const withGolden = async <T,>(g: GoldenCounty | null | undefined, fn: () => Promise<T>): Promise<T> => {
  state.golden = g;
  try {
    return await fn();
  } finally {
    state.golden = undefined;
  }
};

describe("control: the real golden county promotes a true rename (so every red below is the mutation's)", () => {
  it("JV → JV_ with unchanged values is promoted after five live reads", async () => {
    const deps = layer("JV_");
    const a = await withGolden(undefined, () => healDrift(FL, jvDrift("JV_"), deps, NOW));
    expect(a.outcome).toBe("promoted");
    expect(a.verification?.checked).toHaveLength(5);
    expect(deps.queries).toBe(5);
  });
});

describe("golden POPULATION canaries — fewer than the rule demands is no ground truth", () => {
  const cases: Array<[string, () => GoldenCounty | null]> = [
    ["no golden county at all", () => null],
    ["status pending_verification (five verified slots notwithstanding)", () => ({ ...clone(), status: "pending_verification" })],
    ["established with four slots (slot 5 dropped)", () => ({ ...clone(), parcels: clone().parcels.slice(0, 4) })],
    ["established with slot 5 emptied", () => {
      const g = clone();
      g.parcels[4] = { slot: 5, sourceParcelId: null, sourceAttributes: null, assessorVerified: null, verifiedBy: null, verifiedOn: null, assessorRecordUrl: null };
      return g;
    }],
    ["established with five slots but only four distinct parcels (slot 5 duplicates slot 4)", () => {
      const g = clone();
      g.parcels[4] = { ...(g.parcels[3] as GoldenParcel), slot: 5 };
      return g;
    }],
    ["the three slots where AV == JV only (the set that would certify JV → AV)", () => ({ ...clone(), parcels: clone().parcels.slice(0, 3) })],
  ];
  it.each(cases)("%s → rejected with no ground truth, zero live reads, nothing checked", async (_label, make) => {
    const deps = layer("JV_");
    const a = await withGolden(make(), () => healDrift(FL, jvDrift("JV_"), deps, NOW));
    expect(a.outcome).toBe("rejected");
    expect(a.mappingAfter).toBeNull();
    expect(a.verification?.passed).toBe(false);
    expect(a.verification?.why).toMatch(/no ground truth/);
    expect(a.verification?.checked).toEqual([]);
    expect(deps.queries).toBe(0);
  });
});

describe("PROOF canaries — a field verified only where right and wrong agree proves nothing", () => {
  it("marketValue verified only on slots 1 and 3 (both 100, where AV == JV): JV → assessed-valued field is NOT promoted", async () => {
    const g = clone();
    for (const p of g.parcels) if (p.slot !== 1 && p.slot !== 3 && p.assessorVerified) delete p.assessorVerified.marketValueUsd;
    const deps = layer("JV_HMSTD", "AV_NSD");
    const a = await withGolden(g, () => healDrift(FL, jvDrift("JV_HMSTD"), deps, NOW));
    expect(a.outcome).toBe("rejected");
    expect(a.verification?.unprovable).toEqual(["marketValue"]);
    expect(deps.queries).toBe(0);
  });

  it("a field verified on all five parcels but with ONE distinct value is degenerate — a constant column would pass (SYNTHETIC golden, labelled)", async () => {
    // Fully synthetic: no derived set can show this (FL's verified values are distinct), so the
    // parcels are SYNTHETIC-1..5 at example.invalid. Every market value is 100; the candidate
    // column also reads 100 everywhere — it reproduces "truth" and proves nothing.
    const synthetic: GoldenCounty = {
      state: "FL",
      county: "SYNTHETIC",
      status: "established",
      parcels: [1, 2, 3, 4, 5].map((n) => ({
        slot: n,
        sourceParcelId: `SYNTHETIC-${n}`,
        sourceAttributes: { PARCEL_ID: `SYNTHETIC-${n}`, JV: 100, AV_NSD: 1000 * n, CO_NO: "SYNTHETIC" },
        assessorVerified: { marketValueUsd: 100, assessedValueUsd: 1000 * n },
        verifiedBy: "synthetic",
        verifiedOn: "2026-10-24",
        assessorRecordUrl: `https://example.invalid/synthetic-${n}`,
      })),
    };
    const rows = synthetic.parcels.map((p) => ({ PARCEL_ID: p.sourceParcelId, AV_NSD: p.sourceAttributes?.AV_NSD, JV_FLOOR: 100 }));
    const deps = {
      queries: 0,
      async getJson(url: string) {
        deps.queries += 1;
        const m = /^(\w+) = '(.*)'$/.exec(new URLSearchParams(url.split("?")[1]).get("where") ?? "");
        return { ok: true, status: 200, body: { features: (m ? rows.filter((r) => String(r[m[1] as keyof typeof r]) === m[2]) : []).map((attributes) => ({ attributes })) } };
      },
    };
    const a = await withGolden(synthetic, () => healDrift(FL, jvDrift("JV_FLOOR"), deps, NOW));
    expect(a.proposal.ok).toBe(true);
    expect(a.outcome).toBe("rejected");
    expect(a.verification?.unprovable).toEqual(["marketValue"]);
    expect(deps.queries).toBe(0);
  });

  it("owner (verified on three slots with three distinct values in the real set) stays provable", async () => {
    const d = new SchemaDriftError("FL", ["OWN_NAME"], [...fieldsWith("JV").filter((x) => x.name !== "OWN_NAME"), f("own_name", TXT)], FL.mapping);
    const rows = REAL.parcels.map((p) => {
      const a = { ...(p.sourceAttributes ?? {}) };
      const v = a.OWN_NAME;
      delete a.OWN_NAME;
      return { ...a, own_name: v };
    });
    const deps: LayerDeps = {
      async getJson(url) {
        const m = /^(\w+) = '(.*)'$/.exec(new URLSearchParams(url.split("?")[1]).get("where") ?? "");
        return { ok: true, status: 200, body: { features: (m ? rows.filter((r) => String(r[m[1]]) === m[2]) : []).map((attributes) => ({ attributes })) } };
      },
    };
    const a = await withGolden(undefined, () => healDrift(FL, d, deps, NOW));
    expect(a.outcome).toBe("promoted");
  });
});

describe("LIVE-READ canaries — a read that returned nothing is a failure, never a pass", () => {
  const verdict = async (getJson: LayerDeps["getJson"]) => withGolden(undefined, () => healDrift(FL, jvDrift("JV_"), { getJson }, NOW));

  it("every golden query returns zero features → rejected, five parcels checked, all found 0", async () => {
    const a = await verdict(async () => ({ ok: true, status: 200, body: { features: [] } }));
    expect(a.outcome).toBe("rejected");
    expect(a.verification?.checked.map((c) => c.found)).toEqual([0, 0, 0, 0, 0]);
  });

  it("every golden query returns a body with no features key → rejected", async () => {
    const a = await verdict(async () => ({ ok: true, status: 200, body: {} }));
    expect(a.outcome).toBe("rejected");
  });

  it("the layer answers with an ArcGIS error / HTTP 500 → rejected", async () => {
    expect((await verdict(async () => ({ ok: true, status: 200, body: { error: { message: "Invalid query" } } }))).outcome).toBe("rejected");
    expect((await verdict(async () => ({ ok: false, status: 500, body: null }))).outcome).toBe("rejected");
  });

  it("the live read THROWS (timeout / network) → healDrift still resolves 'rejected' with the reason recorded — it never throws", async () => {
    const a = await verdict(async () => {
      throw new Error("fetch timed out after 60000ms");
    });
    expect(a.outcome).toBe("rejected");
    expect(a.verification?.checked).toHaveLength(5);
    expect(a.verification?.checked[0].mismatches[0]).toMatch(/live query failed.*timed out/);
  });

  it("a feature returned for a DIFFERENT parcel id than asked is a mismatch, not a pass", async () => {
    const deps = layer("JV_");
    const a = await verdict(async (url) => {
      const res = await deps.getJson(url.replace(/where=[^&]*/, `where=${encodeURIComponent(`PARCEL_ID = '${REAL.parcels[0].sourceParcelId}'`)}`));
      return res;
    });
    expect(a.outcome).toBe("rejected");
  });
});
