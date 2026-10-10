/**
 * W2 accuracy gate — no parcel fact is shown to a customer until a labelled
 * sample of REAL Tennessee parcels says the engine gets it right.
 *
 * The sample (tests/fixtures/land-data/tn-accuracy-sample.json) holds 20 real
 * DeKalb County parcels, the context layers clipped around each, and labels
 * taken INDEPENDENTLY from the publishing servers' own spatial operators and
 * USGS EPQS (scripts/land-data/extract-tn-accuracy-sample.ts). This test:
 *
 *  1. recomputes every fact with the shipping engine on the sample;
 *  2. compares each fact with its labels; a fact marked "passed" in
 *     FACT_ACCURACY must meet its threshold and minimum sample, and the
 *     counts recorded there must equal what was measured here;
 *  3. requires both answers in the sample for every binary check (a sample
 *     with no flood parcel would "verify" flood acres vacuously);
 *  4. pins that a fact without a passing sample is withheld from the
 *     customer projection AND from the real route serializer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeParcelFacts, type ParcelContext } from "../../server/services/landData/computeParcelFacts";
import { slopeSamplerFromGrids, type ElevationGrid } from "../../server/services/landData/dem";
import { areaCentroid } from "../../server/services/landData/geometry";
import { FACT_ACCURACY, projectFactsForCustomer } from "@shared/landData/factAccuracyGate";

const ACCURACY_SAMPLE_FIXTURE = "tests/fixtures/land-data/tn-accuracy-sample.json";
/** The gate's rule, restated by the test as the oracle the projection must match. */
const isFactPublishable = (k: ParcelFactKey) => FACT_ACCURACY[k].status === "passed";
import { PARCEL_FACT_KEYS, type ParcelFactKey, type ParcelFactSet } from "@shared/landData/parcelFacts";

const root = path.resolve(__dirname, "../..");
const fx = JSON.parse(readFileSync(path.join(root, ACCURACY_SAMPLE_FIXTURE), "utf8"));

function contextFor(p: any): ParcelContext {
  const L = fx.meta.layers;
  const grids: ElevationGrid[] = p.context.dem.map((g: any) => {
    const b = Buffer.from(g.dataB64, "base64");
    return { ...g, data: new Float32Array(b.buffer, b.byteOffset, b.length / 4) };
  });
  return {
    roads: { source: L.roads, features: p.context.roads },
    wetlands: { source: L.wetlands, features: p.context.wetlands },
    flood: { source: L.flood, features: p.context.flood.features, firmCovered: p.context.flood.firmCovered },
    publicLands: { source: L.publicLands, features: p.context.publicLands },
    transmission: null,
    towns: { source: L.towns, features: p.context.towns },
    slope: slopeSamplerFromGrids(grids, L.slope),
  };
}

function factsFor(p: any): { facts: ParcelFactSet; ctx: ParcelContext } {
  const ctx = contextFor(p);
  const facts = computeParcelFacts(
    { parcelKey: p.parcelKey, state: "TN", county: p.county, sourceParcelId: p.sourceParcelId, geometry: p.geometry, deededAcres: p.deededAcres },
    ctx,
  );
  return { facts, ctx };
}

/** Per-fact agreement with the independent labels. null = not checkable. */
const AGREES: Partial<Record<ParcelFactKey, (f: ParcelFactSet, p: any, ctx: ParcelContext) => boolean | null>> = {
  road_frontage_m: (f, p) =>
    f.road_frontage_m.status === "computed" ? f.road_frontage_m.value > 0 === p.labels.accessRoadWithin20m : false,
  legal_access_indication: (f, p) =>
    f.legal_access_indication.status === "computed"
      ? (f.legal_access_indication.value === "public_road_contact") === p.labels.accessRoadWithin20m
      : false,
  buildable_acres: (f, p, ctx) => {
    const b = f.buildable_acres;
    if (b.status !== "computed") return false;
    const floodOk = b.value.breakdown.floodAcres > 0 === p.labels.sfhaIntersects;
    const wetOk = b.value.breakdown.wetlandAcres > 0 === p.labels.nwiIntersects;
    const e = p.labels.centroidElevation;
    const elevOk = e.epqsM !== null && e.demM !== null && Math.abs(e.epqsM - e.demM) <= 5;
    const [cx, cy] = areaCentroid(p.geometry);
    const mine = ctx.slope!.slopePctAt(cx, cy);
    const ref = p.labels.centroidSlope.epqsPct;
    const slopeOk = mine !== null && ref !== null && ((mine > 15) === (ref > 15) || Math.abs(mine - ref) <= 10);
    return floodOk && wetOk && elevOk && slopeOk;
  },
  public_land_adjacent: (f, p) =>
    f.public_land_adjacent.status === "computed" ? f.public_land_adjacent.value.adjacent === p.labels.publicLandWithin30m : false,
  distance_to_town_km: (f, p) => {
    const t = p.labels.town;
    if (f.distance_to_town_km.status !== "computed" || !t) return false;
    return t.placesWithinEnginePlus100m >= 1 && (t.placesWithinEngineMinus100m === null || t.placesWithinEngineMinus100m === 0);
  },
};

/** Binary labels each check depends on — both answers must be present. */
const BINARY_LABELS: Partial<Record<ParcelFactKey, string[]>> = {
  road_frontage_m: ["accessRoadWithin20m"],
  legal_access_indication: ["accessRoadWithin20m"],
  buildable_acres: ["sfhaIntersects", "nwiIntersects"],
  public_land_adjacent: ["publicLandWithin30m"],
};

function measure(key: ParcelFactKey): { sampleSize: number; agreed: number } {
  const check = AGREES[key];
  if (!check) return { sampleSize: 0, agreed: 0 };
  let agreed = 0;
  for (const p of fx.parcels) {
    const { facts, ctx } = factsFor(p);
    if (check(facts, p, ctx)) agreed++;
  }
  return { sampleSize: fx.parcels.length, agreed };
}

describe("accuracy sample — population", () => {
  it("is real, sized and sourced: 20 TN parcels with geometry, labels and context", () => {
    expect(fx.meta.state).toBe("TN");
    expect(fx.parcels.length).toBe(20);
    for (const p of fx.parcels) {
      expect(p.geometry.type).toMatch(/Polygon/);
      expect(p.labels).toBeTruthy();
      expect(p.context.dem.length, p.parcelKey).toBeGreaterThan(0);
    }
    for (const k of ["roads", "wetlands", "flood", "publicLands", "towns", "slope"]) {
      expect(fx.meta.layers[k]?.url, k).toMatch(/^https:\/\//);
    }
  });

  it("every fact key has a gate entry, and every gate entry is a fact key", () => {
    expect(Object.keys(FACT_ACCURACY).sort()).toEqual([...PARCEL_FACT_KEYS].sort());
  });

  it("each binary check sees both answers in the sample (no vacuous pass)", () => {
    for (const [fact, labels] of Object.entries(BINARY_LABELS)) {
      for (const l of labels!) {
        const values = new Set(fx.parcels.map((p: any) => p.labels[l]));
        expect(values.has(true), `${fact}: no positive ${l}`).toBe(true);
        expect(values.has(false), `${fact}: no negative ${l}`).toBe(true);
      }
    }
  });
});

describe("accuracy gate — a 'passed' fact is measured, not trusted", () => {
  for (const key of PARCEL_FACT_KEYS) {
    const entry = FACT_ACCURACY[key];
    if (entry.status !== "passed") continue;
    it(`${key}: meets ${entry.threshold * 100}% on ≥ ${entry.minSample} parcels, and the recorded counts match`, () => {
      expect(AGREES[key], `${key} is marked passed but has no check`).toBeTruthy();
      const m = measure(key);
      expect(m.sampleSize).toBeGreaterThanOrEqual(entry.minSample);
      expect(m.agreed / m.sampleSize).toBeGreaterThanOrEqual(entry.threshold);
      expect({ sampleSize: entry.sampleSize, agreed: entry.agreed }).toEqual(m);
    });
  }

  it("the bar is policy, not self-declared: ≥ 90% agreement on ≥ 10 parcels", () => {
    // Fixed numbers, not read from the entry under test: an entry that lowers
    // its own threshold or minimum sample must turn this red, not ride along.
    for (const key of PARCEL_FACT_KEYS) {
      const e = FACT_ACCURACY[key];
      if (e.status !== "passed") continue;
      expect(e.threshold, `${key} threshold`).toBeGreaterThanOrEqual(0.9);
      expect(e.minSample, `${key} minSample`).toBeGreaterThanOrEqual(10);
    }
  });

  it("every 'passed' fact has a check in this test (no unverifiable pass)", () => {
    for (const key of PARCEL_FACT_KEYS) {
      if (isFactPublishable(key)) expect(AGREES[key], key).toBeTruthy();
    }
  });
});

describe("the customer sees only gated facts", () => {
  const { facts } = factsFor(fx.parcels[0]);

  it("projectFactsForCustomer withholds every fact whose sample has not passed", () => {
    const proj = projectFactsForCustomer(facts);
    const shown = new Set(proj.shown.map((f) => f.key));
    for (const key of PARCEL_FACT_KEYS) {
      expect(shown.has(key), key).toBe(isFactPublishable(key));
    }
    expect(proj.withheld.map((w) => w.key).sort()).toEqual(PARCEL_FACT_KEYS.filter((k) => !isFactPublishable(k)).sort());
  });

  it("every shown fact, on every sample parcel, carries dated sources and a confidence", () => {
    for (const p of fx.parcels) {
      const { facts } = factsFor(p);
      for (const f of projectFactsForCustomer(facts).shown) {
        if (f.status !== "computed") continue;
        expect(f.confidence, `${p.parcelKey} ${f.key}`).toMatch(/^(high|medium|low)$/);
        expect(f.sources.length, `${p.parcelKey} ${f.key} has no source`).toBeGreaterThan(0);
        for (const s of f.sources) {
          expect(s.retrievedOn, `${p.parcelKey} ${f.key}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(s.url, `${p.parcelKey} ${f.key}`).toMatch(/^https:\/\//);
        }
      }
    }
  });

  it("a computed fact without dated sources or a confidence is withheld, not shown bare", () => {
    const stripped = { ...facts, road_frontage_m: { ...facts.road_frontage_m, sources: [] } } as ParcelFactSet;
    const proj = projectFactsForCustomer(stripped);
    expect(proj.shown.map((f) => f.key)).not.toContain("road_frontage_m");
    expect(proj.withheld.map((w) => w.key)).toContain("road_frontage_m");
    const undated = {
      ...facts,
      public_land_adjacent: { ...facts.public_land_adjacent, sources: facts.public_land_adjacent.sources.map((s) => ({ ...s, retrievedOn: "" })) },
    } as ParcelFactSet;
    expect(projectFactsForCustomer(undated).shown.map((f) => f.key)).not.toContain("public_land_adjacent");
  });

  it("the real route serializer goes through the projection (adoption, not a parallel rule)", async () => {
    const { serializeOwnedParcelForCustomer } = await import("../../server/routes-land-data");
    const out = serializeOwnedParcelForCustomer({
      parcelKey: "TN-47041-x",
      state: "TN",
      county: "DeKalb",
      sourceParcelId: "x",
      sourceName: "TN Comptroller parcel download",
      retrievedAt: new Date("2026-10-10T00:00:00Z"),
      gisAcres: 5,
      deededAcres: 5,
      facts,
      attributes: {},
    });
    const servedKeys = out.facts.map((f: { key: string }) => f.key).sort();
    expect(servedKeys).toEqual(PARCEL_FACT_KEYS.filter((k) => isFactPublishable(k)).sort());
    expect(servedKeys).not.toContain("out_of_state_owner");
    expect(servedKeys).not.toContain("distance_to_transmission_km");
    // Each served fact carries the sample that let it through.
    for (const f of out.facts) expect(f.accuracy.sampleSize, f.key).toBe(FACT_ACCURACY[f.key as ParcelFactKey].sampleSize);
  });
});
