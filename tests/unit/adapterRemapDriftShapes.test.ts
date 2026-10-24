/**
 * D2d — adversarial drift shapes. One SYNTHETIC fixture per way a real ArcGIS
 * layer can drift (tests/fixtures/remap/*.json), each driven end to end:
 * the fixture's layer metadata goes through the REAL drift stop (streamCounty →
 * SchemaDriftError), and the error goes through the REAL heal (healDrift:
 * propose → verify against the FL golden county → decide). The live layer
 * serves the golden parcels' recorded attributes, restructured by the fixture
 * (values derived from them, never invented).
 *
 * Population: REQUIRED_SHAPES is the enumeration of drift shapes this gate
 * claims to cover. A shape with no fixture, or a fixture whose shape is not
 * listed, fails — so the claim and the files cannot drift apart.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { healDrift, type RemapAttempt } from "../../server/services/openData/adapterRemap";
import { SchemaDriftError, buildSpecFor, streamCounty, type CanonicalField, type LayerDeps } from "../../server/services/landData/statewideCadastral";
import type { BulkParcelRecord } from "../../shared/landData/bulkParcelRecord";
import { goldenCountyFor, goldenMismatches, verifiedParcels } from "../../shared/landData/goldenCounty";

const FIXTURE_DIR = path.join(__dirname, "../fixtures/remap");
const FL = buildSpecFor("FL");
const NOW = new Date("2026-10-24T12:00:00Z");
const GOLDEN = verifiedParcels(goldenCountyFor("FL"));

const REQUIRED_SHAPES = [
  "rename-punctuation",
  "case-change",
  "suffix-extension",
  "prefix-extension",
  "type-change-renamed",
  "type-change-same-name",
  "field-split-ambiguous",
  "field-split-one-similar",
  "field-merge",
  "field-dropped",
  "two-candidate-renames",
  "contested-candidate",
  "alias-only-change",
  "alias-carries-old-name",
  "alias-trap",
  "field-reordering",
  "objectid-change",
  "objectid-alias-trap",
  "objectid-as-integer-alias-trap",
  "semantic-wrong-jv-to-av",
] as const;

type Derive =
  | { op: "copy"; of: string }
  | { op: "string"; of: string }
  | { op: "firstToken"; of: string }
  | { op: "restTokens"; of: string }
  | { op: "concat"; of: string[]; sep: string };

interface Fixture {
  file: string;
  synthetic: boolean;
  shape: string;
  drift: string;
  layer: {
    drop?: string[];
    rename?: Record<string, string>;
    retype?: Record<string, string>;
    realias?: Record<string, string>;
    add?: Array<{ name: string; type: string; alias?: string }>;
    reverse?: boolean;
    objectIdField?: string;
  };
  values: { derive?: Record<string, Derive> };
  expect: {
    outcome: RemapAttempt["outcome"] | "no_drift";
    whyMatches?: string;
    mappingAfter?: Partial<Record<CanonicalField, string>>;
    proposed?: Partial<Record<CanonicalField, string>>;
    mismatchField?: string;
    mismatchSlots?: number[];
  };
}

const FIXTURES: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({ file: f, ...(JSON.parse(readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as Omit<Fixture, "file">) }));

/** The FL seed layer's fields (the shape the golden attributes were recorded from). */
function seedFields(): Array<{ name: string; type: string; alias: string | null }> {
  const numeric = new Set(["AV_NSD", "JV", "SALE_PRC1"]);
  const names = ["OBJECTID", "CO_NO", "PHY_CITY", ...Object.values(FL.mapping).filter((f): f is string => !!f)];
  return names.map((n) => ({ name: n, type: n === "OBJECTID" ? "esriFieldTypeOID" : numeric.has(n) ? "esriFieldTypeDouble" : "esriFieldTypeString", alias: null }));
}

function layerFields(fx: Fixture) {
  const L = fx.layer;
  let fields = seedFields().filter((f) => !(L.drop ?? []).includes(f.name));
  fields = fields.map((f) => ({ ...f, name: L.rename?.[f.name] ?? f.name }));
  fields = fields.map((f) => ({ ...f, type: L.retype?.[f.name] ?? f.type, alias: L.realias?.[f.name] ?? f.alias }));
  fields.push(...(L.add ?? []).map((a) => ({ name: a.name, type: a.type, alias: a.alias ?? null })));
  return L.reverse ? fields.reverse() : fields;
}

function derive(d: Derive, src: Record<string, unknown>): unknown {
  switch (d.op) {
    case "copy":
      return src[d.of];
    case "string":
      return String(src[d.of]);
    case "firstToken":
      return String(src[d.of]).split(" ")[0];
    case "restTokens":
      return String(src[d.of]).split(" ").slice(1).join(" ");
    case "concat":
      return d.of.map((k) => String(src[k])).join(d.sep);
  }
}

/** Each golden parcel's recorded attributes, restructured as the fixture's live layer serves them. */
function liveRows(fx: Fixture): Array<Record<string, unknown>> {
  const L = fx.layer;
  const oid = L.objectIdField ?? (L.rename?.OBJECTID ?? "OBJECTID");
  return GOLDEN.map((p) => {
    const src = p.sourceAttributes ?? {};
    const row: Record<string, unknown> = { [oid]: p.slot };
    for (const [k, v] of Object.entries(src)) if (!(L.drop ?? []).includes(k)) row[L.rename?.[k] ?? k] = v;
    for (const [k, d] of Object.entries(fx.values.derive ?? {})) row[k] = derive(d, src);
    return row;
  });
}

function liveLayer(fx: Fixture): LayerDeps & { goldenQueries: number } {
  const fields = layerFields(fx);
  const rows = liveRows(fx);
  const oid = fx.layer.objectIdField ?? fields.find((f) => f.type === "esriFieldTypeOID")?.name ?? "OBJECTID";
  const deps = {
    goldenQueries: 0,
    async getJson(url: string) {
      if (url.endsWith("?f=json")) return { ok: true, status: 200, body: { objectIdField: fx.layer.objectIdField ?? (fields.some((f) => f.type === "esriFieldTypeOID") ? undefined : "OBJECTID"), fields } };
      const q = new URLSearchParams(url.split("?")[1]);
      const where = q.get("where") ?? "";
      const page = new RegExp(`^${oid} > (\\d+) AND CO_NO = '55'$`).exec(where);
      if (page) {
        const after = Number(page[1]);
        return { ok: true, status: 200, body: { features: rows.filter((r) => Number(r[oid]) > after).map((properties) => ({ geometry: null, properties })) } };
      }
      const one = /^(\w+) = '(.*)'$/.exec(where);
      deps.goldenQueries += 1;
      const feats = one ? rows.filter((r) => String(r[one[1]]) === one[2].replace(/''/g, "'")) : [];
      return { ok: true, status: 200, body: { features: feats.map((attributes) => ({ attributes })) } };
    },
  };
  return deps;
}

async function run(fx: Fixture): Promise<{ attempt: RemapAttempt | null; records: BulkParcelRecord[]; deps: ReturnType<typeof liveLayer> }> {
  const deps = liveLayer(fx);
  const records: BulkParcelRecord[] = [];
  try {
    await streamCounty(FL, { countyField: "CO_NO", countyValue: "55" }, deps, async (r) => {
      records.push(r);
    });
    return { attempt: null, records, deps };
  } catch (err) {
    if (!(err instanceof SchemaDriftError)) throw err;
    return { attempt: await healDrift(FL, err, deps, NOW), records, deps };
  }
}

describe("drift-shape population (vacuity)", () => {
  it("the golden set is five verified parcels", () => {
    expect(GOLDEN).toHaveLength(5);
  });
  it("every required shape has exactly one fixture, every fixture is a required shape, and all are labelled synthetic", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(REQUIRED_SHAPES.length);
    expect(FIXTURES.map((f) => f.shape).sort()).toEqual([...REQUIRED_SHAPES].sort());
    for (const f of FIXTURES) expect(f.synthetic, f.file).toBe(true);
  });
  it("each fixture's expected outcome is reachable — the four outcomes are all exercised", () => {
    expect(new Set(FIXTURES.map((f) => f.expect.outcome))).toEqual(new Set(["promoted", "no_proposal", "rejected", "no_drift"]));
  });
});

describe.each(FIXTURES.map((f) => [f.shape, f] as const))("drift shape: %s", (_shape, fx) => {
  it(`→ ${fx.expect.outcome}`, async () => {
    const { attempt, records, deps } = await run(fx);
    const e = fx.expect;
    if (e.outcome === "no_drift") {
      // Not drift: the build streams, and every golden parcel still normalizes to ground truth.
      expect(attempt).toBeNull();
      expect(records).toHaveLength(5);
      for (const p of GOLDEN) expect(goldenMismatches(p, records.find((r) => r.identity.sourceParcelId === p.sourceParcelId) ?? null), `slot ${p.slot}`).toEqual([]);
      return;
    }
    expect(attempt, "the layer must drift").not.toBeNull();
    const a = attempt as RemapAttempt;
    expect(a.outcome).toBe(e.outcome);
    if (e.outcome === "promoted") {
      expect(a.mappingAfter).toMatchObject(e.mappingAfter ?? {});
      expect(a.verification?.passed).toBe(true);
      expect(a.verification?.checked).toHaveLength(5);
      expect(deps.goldenQueries).toBe(5);
      return;
    }
    expect(a.mappingAfter).toBeNull();
    if (e.outcome === "no_proposal") {
      expect(a.proposal.ok).toBe(false);
      expect(a.verification).toBeNull();
      expect(deps.goldenQueries, "no proposal = no live verification reads").toBe(0);
      expect(!a.proposal.ok && a.proposal.why).toMatch(new RegExp(e.whyMatches ?? "."));
      return;
    }
    // rejected: a proposal WAS made (type-compatible, similar) and golden verification refused it.
    expect(a.proposal.ok).toBe(true);
    expect(a.proposal.ok && a.proposal.mapping).toMatchObject(e.proposed ?? {});
    expect(a.verification?.passed).toBe(false);
    const bad = (a.verification?.checked ?? []).filter((c) => c.mismatches.length > 0);
    if (e.mismatchSlots) expect(bad.map((c) => c.slot)).toEqual(e.mismatchSlots);
    if (e.mismatchField) for (const c of bad) expect(c.mismatches.join("; ")).toContain(e.mismatchField);
  });
});

describe("the semantically wrong remap (JV → a field holding assessed values)", () => {
  const fx = FIXTURES.find((f) => f.shape === "semantic-wrong-jv-to-av") as Fixture;

  it("is a confident proposal — type-compatible, similar, unambiguous — so only ground truth can stop it", async () => {
    const { attempt } = await run(fx);
    expect(attempt?.proposal.ok).toBe(true);
    expect(attempt?.proposal.fields).toEqual([expect.objectContaining({ field: "marketValue", from: "JV", to: "JV_HMSTD", score: 0.85 })]);
  });

  it("is REJECTED by golden verification: slots 4 and 5 (where AV ≠ JV) do not reproduce the assessor's market value", async () => {
    const { attempt } = await run(fx);
    expect(attempt?.outcome).toBe("rejected");
    const bad = attempt?.verification?.checked.filter((c) => c.mismatches.length > 0) ?? [];
    expect(bad.map((c) => [c.slot, c.mismatches])).toEqual([
      [4, ["marketValueUsd: normalizer 246026 != assessor 404000"]],
      [5, ["marketValueUsd: normalizer 5300 != assessor 190000"]],
    ]);
  });
});
