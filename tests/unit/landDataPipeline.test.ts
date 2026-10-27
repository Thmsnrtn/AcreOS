/**
 * W2 land-data pipeline — artifacts, loader, crosswalk, refusals, uploads.
 *
 *  - GeoParquet: written by the streaming writer (StreamingArtifactWriter —
 *    the only artifact writer since D2a), read back, geometry identical,
 *    "geo" metadata valid.
 *  - PMTiles: same writer, read back with the `pmtiles` reader the client
 *    uses, a tile under a parcel decodes to MVT features carrying only gated
 *    facts.
 *  - Shapefile loader: the Lambert Conformal Conic inverse reproduces the
 *    EPSG Guidance Note 7-2 worked example; a polygon .shp/.dbf round-trips.
 *  - Crosswalk: a renumbered parcel keeps its key; a split gets a new one.
 *  - County pipeline: refusal before any fetch for each refusal reason;
 *    a page is keyed, faceted and saved.
 *  - Upload: the artifact is streamed from its file, and there is no receipt
 *    unless the bucket confirms the byte count.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("../../server/db", () => ({ db: {} }));

import { readGeoParquetRows, encodeWkb, decodeWkb, type ParquetColumnDef } from "../../server/services/landData/geoParquet";
import { StreamingArtifactWriter } from "../../server/services/landData/streamingArtifacts";
import { lccInverse, readDbf, readShpPolygons } from "../../server/services/landData/shapefile";
import { areaSqM, areaCentroid, type AreaGeometry } from "../../server/services/landData/geometry";
import { reconcileCrosswalk, newParcelKey } from "@shared/landData/parcelCrosswalk";
import {
  decideCountyProcessing,
  processCountyPage,
  PAGE_SIZE,
  MAX_CONCURRENT_COUNTIES,
  type EndpointView,
} from "../../server/services/landData/countyPipeline";
import { uploadFileAndConfirm, bucketConfigFromEnv, type ObjectStoreClient } from "../../server/services/landData/openDataBucket";
import type { ParcelContext } from "../../server/services/landData/computeParcelFacts";

const root = path.resolve(__dirname, "../..");
const fx = JSON.parse(readFileSync(path.join(root, "tests/fixtures/land-data/tn-accuracy-sample.json"), "utf8"));
const sampleGeoms: AreaGeometry[] = fx.parcels.slice(0, 3).map((p: any) => p.geometry);

interface FactRow {
  parcel_key: string;
  state: string;
  county_fips: string;
  county: string;
  source_parcel_id: string;
  source_name: string;
  retrieved_on: string;
  gis_acres: number;
  deeded_acres: number | null;
  facts_json: string;
  truths_json: string;
  geometry: AreaGeometry;
}
const FACT_SCHEMA: Record<string, ParquetColumnDef> = {
  parcel_key: { type: "UTF8" },
  state: { type: "UTF8" },
  county_fips: { type: "UTF8" },
  county: { type: "UTF8" },
  source_parcel_id: { type: "UTF8" },
  source_name: { type: "UTF8" },
  retrieved_on: { type: "UTF8" },
  gis_acres: { type: "DOUBLE" },
  deeded_acres: { type: "DOUBLE", optional: true },
  facts_json: { type: "UTF8" },
  truths_json: { type: "UTF8" },
  geometry: { type: "BYTE_ARRAY" },
};
const factRows = (): FactRow[] =>
  sampleGeoms.map((g, i) => ({
    parcel_key: `TN-47041-${i}`, state: "TN", county_fips: "47041", county: "DeKalb",
    source_parcel_id: String(i), source_name: "TN Comptroller parcel download", retrieved_on: "2026-10-10",
    gis_acres: areaSqM(g) / 4046.8564224, deeded_acres: i === 0 ? null : 5,
    facts_json: JSON.stringify({ i }), truths_json: "[]", geometry: g,
  }));
async function writeArtifacts(dir: string, rows: FactRow[]) {
  const w = new StreamingArtifactWriter<FactRow>(
    { outDir: dir, stem: "t", schemaDef: FACT_SCHEMA, layerName: "parcels", tileName: "t", tileDescription: "t", attribution: "t" },
    (r) => ({ parcel_key: r.parcel_key, access: "public_road_contact" }),
  );
  await w.open();
  for (const r of rows) await w.write(r);
  return w.finish();
}

describe("GeoParquet writer + loader", () => {
  it("round-trips rows and geometry exactly, with GeoParquet 1.1 metadata", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "w2-pq-"));
    try {
      const rows = factRows();
      const built = await writeArtifacts(dir, rows);
      const back = await readGeoParquetRows<FactRow>(built.parquet.localPath);
      expect(back.rows).toHaveLength(3);
      expect(back.geo.version).toBe("1.1.0");
      expect(back.geo.primary_column).toBe("geometry");
      expect(back.geo.columns.geometry.encoding).toBe("WKB");
      back.rows.forEach((r, i) => {
        expect(r.geometry).toEqual(rows[i].geometry);
        // An absent optional cell reads back undefined; it was written from null.
        expect(r.deeded_acres ?? null).toBe(rows[i].deeded_acres);
        expect(r.parcel_key).toBe(rows[i].parcel_key);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("WKB encode/decode is lossless for Polygon and MultiPolygon", () => {
    const multi: AreaGeometry = { type: "MultiPolygon", coordinates: [(sampleGeoms[1] as any).coordinates ?? (sampleGeoms[1] as any).coordinates[0], [[[0, 0], [1, 0], [1, 1], [0, 0]]]] } as any;
    for (const g of [...sampleGeoms, multi]) expect(decodeWkb(encodeWkb(g))).toEqual(g);
  });
});

describe("PMTiles writer + loader", () => {
  it("archive opens with the pmtiles reader and a tile decodes to MVT features", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "w2-pm-"));
    try {
      const out = await writeArtifacts(dir, factRows());
      expect(out.tileCount).toBeGreaterThan(0);
      const { PMTiles } = await import("pmtiles");
      const bytes = readFileSync(out.pmtiles.localPath);
      const arch = new PMTiles({
        getKey: () => "t",
        getBytes: async (o: number, l: number) => ({ data: bytes.buffer.slice(bytes.byteOffset + o, bytes.byteOffset + o + l) }),
      } as any);
      const h = await arch.getHeader();
      // The streaming writer tiles at its partition grain, z14–15.
      expect([h.minZoom, h.maxZoom, h.tileType]).toEqual([14, 15, 1]);
      const [cx, cy] = areaCentroid(sampleGeoms[0]);
      const z = 14, n = 2 ** z;
      const x = Math.floor(((cx + 180) / 360) * n);
      const y = Math.floor(((1 - Math.log(Math.tan((cy * Math.PI) / 180) + 1 / Math.cos((cy * Math.PI) / 180)) / Math.PI) / 2) * n);
      const tile = await arch.getZxy(z, x, y);
      expect(tile?.data.byteLength).toBeGreaterThan(0);
      const { VectorTile } = await import("@mapbox/vector-tile");
      const pbf: any = await import("pbf");
      const vt = new VectorTile(new (pbf.PbfReader ?? pbf.default)(new Uint8Array(tile!.data)));
      expect(vt.layers.parcels.length).toBeGreaterThan(0);
      expect(vt.layers.parcels.feature(0).properties.access).toBe("public_road_contact");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to build an empty archive", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "w2-pm0-"));
    try {
      await expect(writeArtifacts(dir, [])).rejects.toThrow(/empty/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Comptroller shapefile loader", () => {
  it("LCC inverse reproduces the EPSG Guidance Note 7-2 worked example (Texas South Central, NAD27)", () => {
    const inv = lccInverse({
      a: 6378206.4, invF: 294.9786982, lat1: 28 + 23 / 60, lat2: 30 + 17 / 60, lat0: 27 + 50 / 60, lon0: -99,
      falseE: 2000000, falseN: 0, unitToMetre: 0.3048006096,
    });
    const [lon, lat] = inv(2963503.91, 254759.8);
    expect(lon).toBeCloseTo(-96, 6);
    expect(lat).toBeCloseTo(28.5, 6);
  });

  it("reads a polygon .shp (ring orientation → outer/hole) and its .dbf", () => {
    // Build a one-record polygon shapefile in memory: outer CW square + CCW hole.
    const outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
    const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    const pts = [...outer, ...hole];
    const content = 4 + 32 + 4 + 4 + 2 * 4 + pts.length * 16;
    const shp = Buffer.alloc(100 + 8 + content);
    shp.writeInt32BE(9994, 0);
    shp.writeInt32BE(shp.length / 2, 24);
    shp.writeInt32LE(1000, 28);
    shp.writeInt32LE(5, 32);
    shp.writeInt32BE(1, 100);
    shp.writeInt32BE(content / 2, 104);
    let o = 108;
    shp.writeInt32LE(5, o); o += 4 + 32;
    shp.writeInt32LE(2, o); o += 4;
    shp.writeInt32LE(pts.length, o); o += 4;
    shp.writeInt32LE(0, o); o += 4;
    shp.writeInt32LE(outer.length, o); o += 4;
    for (const [x, y] of pts) { shp.writeDoubleLE(x, o); shp.writeDoubleLE(y, o + 8); o += 16; }
    const geoms = readShpPolygons(shp, (x, y) => [x, y]);
    expect(geoms).toHaveLength(1);
    expect(geoms[0]!.type).toBe("Polygon");
    expect((geoms[0] as any).coordinates).toHaveLength(2);

    // dBASE: one C field GISLINK(10) and one N field DEEDAC(8).
    const header = 32 + 32 * 2 + 1;
    const recLen = 1 + 10 + 8;
    const dbf = Buffer.alloc(header + recLen + 1);
    dbf.writeUInt8(3, 0);
    dbf.writeUInt32LE(1, 4);
    dbf.writeUInt16LE(header, 8);
    dbf.writeUInt16LE(recLen, 10);
    dbf.write("GISLINK", 32, "latin1"); dbf.write("C", 32 + 11, "latin1"); dbf.writeUInt8(10, 32 + 16);
    dbf.write("DEEDAC", 64, "latin1"); dbf.write("N", 64 + 11, "latin1"); dbf.writeUInt8(8, 64 + 16);
    dbf.writeUInt8(0x0d, header - 1);
    dbf.write(" ", header, "latin1");
    dbf.write("021045    ".padEnd(10), header + 1, "latin1");
    dbf.write("    6.14", header + 11, "latin1");
    expect(readDbf(dbf)).toEqual([{ GISLINK: "021045", DEEDAC: 6.14 }]);
  });
});

describe("parcel-id crosswalk", () => {
  const g = sampleGeoms[0];
  const rec = (sourceId: string, geom: AreaGeometry) => ({ sourceId, centroid: areaCentroid(geom) as [number, number], areaSqM: areaSqM(geom) });
  const mint = (sid: string) => newParcelKey("TN", "47041", sid);

  it("a renumbered parcel keeps its key and records the alias", () => {
    const prev = [{ ...rec("OLD-1", g), parcelKey: "TN-47041-OLD-1" }];
    const r = reconcileCrosswalk(prev, [rec("NEW-9", g)], mint);
    expect(r.assigned).toEqual([{ sourceId: "NEW-9", parcelKey: "TN-47041-OLD-1", how: "renumbered" }]);
    expect(r.aliases).toEqual([{ parcelKey: "TN-47041-OLD-1", previousSourceId: "OLD-1", newSourceId: "NEW-9" }]);
  });

  it("a split (shape changed) gets a new key and retires the old one", () => {
    const prev = [{ ...rec("A", g), parcelKey: "TN-47041-A" }];
    const half = { ...rec("A", g), areaSqM: rec("A", g).areaSqM / 2 };
    const r = reconcileCrosswalk(prev, [half], mint);
    expect(r.assigned[0].how).toBe("new");
    expect(r.retired).toEqual(["TN-47041-A"]);
    // The property, not the label: a retired key is never handed out again.
    expect(r.assigned[0].parcelKey).not.toBe("TN-47041-A");
  });
});

describe("county pipeline — refusal is decided before any fetch", () => {
  const ep = (o: Partial<EndpointView>): EndpointView => ({
    id: 1, state: "TN", county: "dekalb", baseUrl: "https://example.test/FeatureServer", layerId: "0",
    isActive: true, redistributable: "attribution", licenseSource: null, ...o,
  });

  it("caps concurrency at one county and pages small", () => {
    expect(MAX_CONCURRENT_COUNTIES).toBe(1);
    expect(PAGE_SIZE).toBeLessThanOrEqual(500);
  });

  it("no endpoint → refused as no_free_source", () => {
    const d = decideCountyProcessing("TN", "DeKalb County", []);
    expect(d).toMatchObject({ action: "refuse", code: "no_free_source" });
  });

  it("an inactive endpoint → review_pending", () => {
    expect(decideCountyProcessing("TN", "DeKalb", [ep({ isActive: false })])).toMatchObject({ code: "review_pending" });
  });

  it("an un-reviewed county row → terms_forbid_storing", () => {
    expect(decideCountyProcessing("TN", "DeKalb", [ep({ redistributable: "review-required" })])).toMatchObject({ code: "terms_forbid_storing" });
  });

  it("the TN statewide service is refused: its terms say not for commercial use", () => {
    const sw = ep({ county: "*", redistributable: "attribution", licenseSource: "TN Property Boundaries Public Use service" });
    expect(decideCountyProcessing("TN", "DeKalb", [sw])).toMatchObject({ code: "terms_forbid_storing" });
  });

  it("the TN non-commercial service is refused by its URL, whatever row carries it", () => {
    // The refusal is about the SOURCE, not the row shape: discovery-on-miss can
    // insert the same statewide service as a COUNTY row, and a reviewer can
    // mark it redistributable. Neither may make it storable.
    const tnUrl = "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/";
    const asCounty = ep({ baseUrl: tnUrl, redistributable: "yes", licenseSource: null });
    expect(decideCountyProcessing("TN", "DeKalb", [asCounty])).toMatchObject({ code: "terms_forbid_storing" });
    const asStatewideUnmapped = ep({ county: "*", baseUrl: tnUrl.toUpperCase(), redistributable: "yes", licenseSource: null });
    expect(decideCountyProcessing("TN", "DeKalb", [asStatewideUnmapped])).toMatchObject({ code: "terms_forbid_storing" });
  });

  it("a reviewed county row is processed; a statewide one needs a verified county field", () => {
    expect(decideCountyProcessing("TN", "DeKalb", [ep({})])).toMatchObject({ action: "process", countyWhere: null });
    const sw = ep({ county: "*", state: "XX", licenseSource: null });
    expect(decideCountyProcessing("XX", "Any", [sw])).toMatchObject({ code: "no_county_filter" });
  });

  it("processes a page: keys through the crosswalk, computes facts, saves", async () => {
    const saved: any[] = [];
    const ctx: ParcelContext = { roads: null, wetlands: null, flood: null, publicLands: null, transmission: null, towns: null, slope: null };
    const r = await processCountyPage(
      { state: "TN", county: "dekalb", countyFips: "47041", nextOffset: 0 },
      { apn: "GISLINK", acres: "DEEDAC", keep: [] },
      {
        fetchPage: async () => sampleGeoms.map((g, i) => ({ objectId: 10 + i, geometry: g, attributes: { GISLINK: `G${i}`, DEEDAC: 5 } })),
        loadContext: async () => ctx,
        existingNear: async () => [],
        save: async (ps) => { saved.push(...ps); },
      },
    );
    // A non-empty page never ends the county: a server whose maxRecordCount
    // is below PAGE_SIZE returns short pages mid-county. Only an empty page does.
    expect(r).toEqual({ stored: 3, lastObjectId: 12, done: false });
    expect(saved.map((s) => s.parcelKey)).toEqual(["TN-47041-G0", "TN-47041-G1", "TN-47041-G2"]);
    // No layers → every fact refuses honestly rather than defaulting.
    expect(saved[0].facts.buildable_acres.status).toBe("unavailable");
    expect(saved[0].facts.road_frontage_m.status).toBe("unavailable");
  });
});

describe("county pipeline — paging", () => {
  const ctx: ParcelContext = { roads: null, wetlands: null, flood: null, publicLands: null, transmission: null, towns: null, slope: null };
  const deps = (pages: Array<Array<{ objectId: number; geometry: AreaGeometry | null; attributes: Record<string, unknown> }>>) => {
    const saved: any[] = [];
    let i = 0;
    return {
      saved,
      deps: {
        fetchPage: async () => pages[i++] ?? [],
        loadContext: async () => ctx,
        existingNear: async () => [],
        save: async (ps: any[]) => { saved.push(...ps); },
      },
    };
  };

  it("a parcel with no geometry is skipped, and the cursor still moves past it", async () => {
    const page = [
      { objectId: 1, geometry: sampleGeoms[0], attributes: { GISLINK: "A" } },
      { objectId: 2, geometry: null, attributes: { GISLINK: "B" } },
    ];
    const { saved, deps: d } = deps([page]);
    const r = await processCountyPage({ state: "TN", county: "dekalb", countyFips: "47041", nextOffset: 0 }, { apn: "GISLINK", keep: [] }, d as any);
    expect(r).toEqual({ stored: 1, lastObjectId: 2, done: false });
    expect(saved.map((s) => s.sourceParcelId)).toEqual(["A"]);
  });

  it("only an empty page completes the county", async () => {
    const { deps: d } = deps([]);
    const r = await processCountyPage({ state: "TN", county: "dekalb", countyFips: "47041", nextOffset: 7 }, { apn: "GISLINK", keep: [] }, d as any);
    expect(r).toEqual({ stored: 0, lastObjectId: 7, done: true });
  });
});

describe("open-data bucket — no receipt without the bucket's confirmation", () => {
  const body = Buffer.from("parquet bytes");

  it("bucket config needs all four keys", () => {
    expect(bucketConfigFromEnv({})).toBeNull();
    expect(bucketConfigFromEnv({ OPEN_DATA_BUCKET_ENDPOINT: "e", OPEN_DATA_BUCKET_NAME: "b", OPEN_DATA_BUCKET_ACCESS_KEY_ID: "k" })).toBeNull();
  });

  const artifactFile = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "w2-up-"));
    const localPath = path.join(dir, "a.parquet");
    writeFileSync(localPath, body);
    return { dir, artifact: { localPath, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), contentType: "application/octet-stream" } };
  };

  it("returns a receipt with the SHA-256 when HEAD confirms the byte count", async () => {
    const { dir, artifact } = artifactFile();
    try {
      const client: ObjectStoreClient = { bucket: "https://e/b", put: async () => ({ etag: null }), putFile: async () => ({ etag: '"x"' }), headBytes: async () => body.length };
      const r = await uploadFileAndConfirm(client, "statewide-parcels-bulk", "tn/a.parquet", artifact);
      expect(r.bytes).toBe(body.length);
      expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.sha256).toBe(artifact.sha256);
      expect(r.bucket).toBe("https://e/b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws (no receipt) when the bucket reports a different size", async () => {
    const { dir, artifact } = artifactFile();
    try {
      const client: ObjectStoreClient = { bucket: "https://e/b", put: async () => ({ etag: null }), putFile: async () => ({ etag: null }), headBytes: async () => body.length - 1 };
      await expect(uploadFileAndConfirm(client, "statewide-parcels-bulk", "tn/a.parquet", artifact)).rejects.toThrow(/not ingested/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
