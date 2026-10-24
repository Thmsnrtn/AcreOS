/**
 * D2d — self-healing source adapters: propose from live metadata, verify
 * against the golden county, promote only on a pass.
 *
 * The live layer here is SYNTHETIC in structure (field names renamed in this
 * file to simulate drift) but serves the FL golden county's REAL recorded
 * attributes (shared/landData/golden/fl-golden-county.json), so verification
 * compares against the assessor-verified values exactly as production does.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { activeMappingFromRuns, healDrift, proposeRemap, type RemapAttempt } from "../../server/services/openData/adapterRemap";
import { SchemaDriftError, buildSpecFor, streamCounty, type LayerDeps, type LayerField } from "../../server/services/landData/statewideCadastral";
import { goldenCountyFor, verifiedParcels } from "../../shared/landData/goldenCounty";

const FL = buildSpecFor("FL");
const NOW = new Date("2026-10-24T12:00:00Z");
const GOLDEN = verifiedParcels(goldenCountyFor("FL"));

const field = (name: string, type = "esriFieldTypeString", alias: string | null = null): LayerField => ({ name, type, alias });
/** The FL seed's live fields, with `rename` applied (old → new [, type, alias]). */
function liveFields(rename: Record<string, [string, string?, string?]> = {}, extra: LayerField[] = []): LayerField[] {
  const numeric = new Set(["AV_NSD", "JV", "SALE_PRC1"]);
  const base = ["OBJECTID", "CO_NO", "PHY_CITY", ...Object.values(FL.mapping).filter((f): f is string => !!f)];
  return [
    ...base.map((n) => {
      const r = rename[n];
      const t = n === "OBJECTID" ? "esriFieldTypeOID" : numeric.has(n) ? "esriFieldTypeDouble" : "esriFieldTypeString";
      return r ? field(r[0], r[1] ?? t, r[2] ?? null) : field(n, t);
    }),
    ...extra,
  ];
}
const drift = (fields: LayerField[]) => {
  const have = new Set(fields.map((f) => f.name));
  const missing = Object.values(FL.mapping).filter((f): f is string => !!f && !have.has(f));
  return new SchemaDriftError("FL", missing, fields, FL.mapping);
};

/** A live layer serving the golden parcels with `rename` applied to their recorded attributes. */
function goldenLayer(rename: Record<string, string>, extraAttrs: (attrs: Record<string, unknown>) => Record<string, unknown> = () => ({})): LayerDeps & { urls: string[] } {
  const urls: string[] = [];
  const rows = GOLDEN.map((p) => {
    const a: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p.sourceAttributes ?? {})) a[rename[k] ?? k] = v;
    return { ...a, ...extraAttrs(p.sourceAttributes ?? {}) };
  });
  return {
    urls,
    async getJson(url) {
      urls.push(url);
      const where = new URLSearchParams(url.split("?")[1]).get("where") ?? "";
      const m = /^(\w+) = '(.*)'$/.exec(where);
      const feats = m ? rows.filter((r) => String(r[m[1]]) === m[2].replace(/''/g, "'")) : [];
      return { ok: true, status: 200, body: { features: feats.map((attributes) => ({ attributes })) } };
    },
  };
}

describe("the golden set the adapter verifies against (vacuity)", () => {
  it("FL's golden county is established with five verified parcels", () => {
    expect(goldenCountyFor("FL")?.status).toBe("established");
    expect(GOLDEN).toHaveLength(5);
  });
});

describe("proposal — a clear, type-compatible match or nothing", () => {
  it("a field renamed only in punctuation/case is proposed (PARCEL_ID → PARCELID)", () => {
    const p = proposeRemap(drift(liveFields({ PARCEL_ID: ["PARCELID"] })));
    expect(p.ok).toBe(true);
    expect(p.fields).toEqual([expect.objectContaining({ field: "apn", from: "PARCEL_ID", to: "PARCELID", basis: "same name modulo case/punctuation" })]);
  });

  it("a renamed field whose ALIAS still names the old field is proposed", () => {
    const p = proposeRemap(drift(liveFields({ AV_NSD: ["ASMT_NONSCHOOL", "esriFieldTypeDouble", "AV_NSD"] })));
    expect(p.ok && p.mapping.assessedValue).toBe("ASMT_NONSCHOOL");
  });

  it("two equally good candidates are AMBIGUOUS — no proposal", () => {
    const p = proposeRemap(drift(liveFields({ JV: ["JV_2025", "esriFieldTypeDouble"] }, [field("JV_2024", "esriFieldTypeDouble")])));
    expect(p.ok).toBe(false);
    expect(!p.ok && p.why).toMatch(/ambiguous/);
  });

  it("one live column is never proposed for TWO canonical fields (contested) — even when it is each one's sole candidate", () => {
    // AV_NSD and JV both gone; JV_AV_NSD is the only numeric candidate for either.
    const fields = liveFields({}, [field("JV_AV_NSD", "esriFieldTypeDouble")]).filter((f) => f.name !== "AV_NSD" && f.name !== "JV");
    const p = proposeRemap(drift(fields));
    expect(p.ok).toBe(false);
    expect(!p.ok && p.why).toMatch(/^contested: JV_AV_NSD/);
  });

  it("an empty drift is no proposal — a 'remap' that changes nothing must not be promoted and counted as a heal", () => {
    const p = proposeRemap({ missing: [], liveFields: liveFields(), mapping: FL.mapping });
    expect(p.ok).toBe(false);
    expect(!p.ok && p.why).toMatch(/nothing to remap/);
  });

  it("a candidate of the wrong type is never proposed (a numeric field to a text column)", () => {
    const p = proposeRemap(drift(liveFields({ JV: ["J_V", "esriFieldTypeString"] })));
    expect(p.ok).toBe(false);
    expect(!p.ok && p.why).toMatch(/no live field is a clear match/);
  });
});

describe("verification against the golden county — promote only on a pass", () => {
  it("a true rename (values unchanged) re-reads all five golden parcels and is PROMOTED", async () => {
    const deps = goldenLayer({ JV: "JV_" });
    const a = await healDrift(FL, drift(liveFields({ JV: ["JV_", "esriFieldTypeDouble"] })), deps, NOW);
    expect(a.outcome).toBe("promoted");
    expect(a.mappingAfter?.marketValue).toBe("JV_");
    expect(a.verification?.checked).toHaveLength(5);
    expect(a.verification?.checked.every((c) => c.found === 1 && c.mismatches.length === 0)).toBe(true);
    expect(deps.urls).toHaveLength(5);
  });

  it("FALSIFICATION: a plausible-looking remap to a field holding DIFFERENT values is REJECTED", async () => {
    // JV is gone; JV_PRIOR looks like a rename but holds last year's values.
    const deps = goldenLayer({ JV: "JV_PRIOR" }, (a) => ({ JV_PRIOR: Number(a.JV) + 1 }));
    const a = await healDrift(FL, drift(liveFields({ JV: ["JV_PRIOR", "esriFieldTypeDouble"] })), deps, NOW);
    expect(a.outcome).toBe("rejected");
    expect(a.mappingAfter).toBeNull();
    expect(a.verification?.checked.some((c) => c.mismatches.some((m) => /marketValueUsd/.test(m)))).toBe(true);
  });

  it("a remap of a field the golden set never verifies (legal description) cannot be promoted", async () => {
    const a = await healDrift(FL, drift(liveFields({ S_LEGAL: ["SLEGAL"] })), goldenLayer({ S_LEGAL: "SLEGAL" }), NOW);
    expect(a.outcome).toBe("rejected");
    expect(a.verification?.unprovable).toEqual(["legalDescription"]);
  });

  it("a state with no established golden county never auto-remaps", async () => {
    const nc = buildSpecFor("NC");
    const fields = [field("OBJECTID", "esriFieldTypeOID"), ...Object.values(nc.mapping).map((f) => field(f === nc.mapping.apn ? "PARNO" : (f as string)))];
    const d = new SchemaDriftError("NC", [nc.mapping.apn as string], fields, nc.mapping);
    const a = await healDrift(nc, d, goldenLayer({}), NOW);
    expect(a.outcome).toBe("rejected");
    expect(a.verification?.why).toMatch(/no established golden county/);
  });

  it("a golden parcel missing from the live layer fails verification", async () => {
    const deps = goldenLayer({ JV: "JV_" });
    const orig = deps.getJson;
    let n = 0;
    deps.getJson = async (u) => (++n === 3 ? { ok: true, status: 200, body: { features: [] } } : orig(u));
    const a = await healDrift(FL, drift(liveFields({ JV: ["JV_", "esriFieldTypeDouble"] })), deps, NOW);
    expect(a.outcome).toBe("rejected");
  });
});

describe("the active mapping comes from the run series", () => {
  // A promoted record carries its passing verification (what healDrift writes); one without it is never adopted
  // (tests/unit/adapterRemapObservation.test.ts).
  const attempt = (outcome: RemapAttempt["outcome"], mv: string): Record<string, unknown> => ({
    remap: { outcome, mappingAfter: outcome === "promoted" ? { ...FL.mapping, marketValue: mv } : null, verification: outcome === "promoted" ? { passed: true } : null },
  });

  it("the newest PROMOTED remap wins; rejected attempts and plain runs are skipped; none = the seed", () => {
    expect(activeMappingFromRuns([attempt("rejected", "X"), { kind: "statewide_cadastral_build" }, attempt("promoted", "JV_B"), attempt("promoted", "JV_A")])?.marketValue).toBe("JV_B");
    expect(activeMappingFromRuns([attempt("rejected", "X"), null])).toBeNull();
  });

  it("the build refuses on drift with a typed error carrying the live field list (what healing reads)", async () => {
    const fields = liveFields({ JV: ["JV_", "esriFieldTypeDouble"] });
    const deps: LayerDeps = {
      async getJson() {
        return { ok: true, status: 200, body: { objectIdField: "OBJECTID", fields: fields.map((f) => ({ name: f.name, type: f.type })) } };
      },
    };
    const err = await streamCounty(FL, { countyField: "CO_NO", countyValue: "55" }, deps, async () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(SchemaDriftError);
    expect((err as SchemaDriftError).missing).toEqual(["JV"]);
    expect((err as SchemaDriftError).liveFields.map((f) => f.name)).toContain("JV_");
  });
});
