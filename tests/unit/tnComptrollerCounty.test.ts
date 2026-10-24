/**
 * D2a — the bounded Tennessee Comptroller county build.
 *
 * SYNTHETIC DATA. Every shapefile, roll and parcel here is generated in this
 * file (ids SYNTHETIC-n); none is real Comptroller data. County names and
 * FIPS are real only because the build refuses anything that is not a real,
 * Comptroller-maintained Tennessee county.
 */
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import {
  buildTnCounty,
  comptrollerDirSource,
  resolveTnCounty,
  TN_METRO_COUNTY_ORDER,
  type TnBuildDeps,
  type TnParcelSource,
  type TnSourceParcel,
} from "../../server/services/landData/tnComptrollerCounty";
import { TN_SELF_MAINTAINED_COUNTIES } from "../../server/services/landData/tnParcelSources";
import { readGeoParquetRows } from "../../server/services/landData/geoParquet";
import type { ParcelContext } from "../../server/services/landData/computeParcelFacts";
import type { ObjectStoreClient } from "../../server/services/landData/openDataBucket";
import { uploadFileAndConfirm } from "../../server/services/landData/openDataBucket";
import type { OwnedParcelInput } from "../../server/services/landData/ownedParcelStore";
import census from "../../shared/landData/countySourceCensus.tn.json";

const SUMNER = { fips: "47165", county: "Sumner" };
const emptyCtx = async (): Promise<ParcelContext> => ({ roads: null, wetlands: null, flood: null, publicLands: null, transmission: null, towns: null, slope: null });
const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));

// ── A synthetic Comptroller download (shp + dbf + prj + Assessment_Data) ──

type Field = { name: string; type: "C" | "N"; len: number };
function dbf(fields: Field[], rows: Array<{ deleted?: boolean; values: Record<string, string | number | null> }>): Buffer {
  const headerLen = 32 + fields.length * 32 + 1;
  const recordLen = 1 + fields.reduce((s, f) => s + f.len, 0);
  const b = Buffer.alloc(headerLen + rows.length * recordLen + 1, 0x20);
  b.fill(0, 0, headerLen);
  b[0] = 0x03;
  b.writeUInt32LE(rows.length, 4);
  b.writeUInt16LE(headerLen, 8);
  b.writeUInt16LE(recordLen, 10);
  fields.forEach((f, i) => {
    const p = 32 + i * 32;
    b.write(f.name, p, "latin1");
    b[p + 11] = f.type.charCodeAt(0);
    b[p + 16] = f.len;
  });
  b[headerLen - 1] = 0x0d;
  rows.forEach((r, i) => {
    let o = headerLen + i * recordLen;
    b[o] = r.deleted ? 0x2a : 0x20;
    o += 1;
    for (const f of fields) {
      const v = r.values[f.name];
      const s = v === null || v === undefined ? "" : String(v);
      b.write((f.type === "N" ? s.padStart(f.len) : s.padEnd(f.len)).slice(0, f.len), o, "latin1");
      o += f.len;
    }
  });
  b[b.length - 1] = 0x1a;
  return b;
}

function shp(shapes: Array<number[][] | null>): Buffer {
  const recs = shapes.map((ring, i) => {
    if (!ring) {
      const r = Buffer.alloc(12);
      r.writeInt32BE(i + 1, 0);
      r.writeInt32BE(2, 4);
      r.writeInt32LE(0, 8);
      return r;
    }
    const content = Buffer.alloc(44 + 4 + ring.length * 16);
    content.writeInt32LE(5, 0);
    content.writeInt32LE(1, 36);
    content.writeInt32LE(ring.length, 40);
    content.writeInt32LE(0, 44);
    ring.forEach(([x, y], k) => {
      content.writeDoubleLE(x, 48 + k * 16);
      content.writeDoubleLE(y, 48 + k * 16 + 8);
    });
    const h = Buffer.alloc(8);
    h.writeInt32BE(i + 1, 0);
    h.writeInt32BE(content.length / 2, 4);
    return Buffer.concat([h, content]);
  });
  const header = Buffer.alloc(100);
  const total = 100 + recs.reduce((s, r) => s + r.length, 0);
  header.writeInt32BE(9994, 0);
  header.writeInt32BE(total / 2, 24);
  header.writeInt32LE(1000, 28);
  header.writeInt32LE(5, 32);
  return Buffer.concat([header, ...recs]);
}

/** Clockwise square (a shapefile outer ring) ~40 m on a side. */
const ring = (i: number) => {
  const x = -86.5 + (i % 100) * 0.0004;
  const y = 36.4 + Math.floor(i / 100) * 0.0004;
  const d = 0.00036;
  return [[x, y], [x, y + d], [x + d, y + d], [x + d, y], [x, y]];
};

interface DirOpts {
  n: number;
  deletedAt?: number[];
  nullAt?: number[];
  county?: (i: number) => string;
  roll?: boolean;
  rollFields?: Field[];
}

/** Writes the download; returns the dir. Parcel i's roll: improvement 0 when i % 3 === 0, mailing "GA" when i % 2 === 0. */
function download(o: DirOpts): string {
  const dir = tmp("tn-dl-");
  const shapes = Array.from({ length: o.n }, (_, i) => (o.nullAt?.includes(i) ? null : ring(i)));
  writeFileSync(path.join(dir, "SYNTHETIC_Parcels.shp"), shp(shapes));
  writeFileSync(path.join(dir, "SYNTHETIC_Parcels.prj"), 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]');
  const pf: Field[] = [
    { name: "GISLINK", type: "C", len: 20 },
    { name: "PARCELID", type: "C", len: 20 },
    { name: "DEEDAC", type: "N", len: 10 },
    { name: "SUBDIV", type: "C", len: 10 },
    { name: "LOT", type: "C", len: 6 },
    { name: "COUNTY_NAME", type: "C", len: 20 },
  ];
  writeFileSync(
    path.join(dir, "SYNTHETIC_Parcels.dbf"),
    dbf(pf, Array.from({ length: o.n }, (_, i) => ({
      deleted: o.deletedAt?.includes(i),
      values: { GISLINK: `SYNTHETIC-${i}`, PARCELID: `SYNTHETIC-${i}`, DEEDAC: 2 + (i % 5), SUBDIV: null, LOT: null, COUNTY_NAME: o.county ? o.county(i) : "Sumner" },
    }))),
  );
  if (o.roll !== false) {
    const rf = o.rollFields ?? [
      { name: "GISLINK", type: "C", len: 20 },
      { name: "SYN_MAILST", type: "C", len: 2 },
      { name: "SYN_IMPVAL", type: "N", len: 10 },
    ];
    writeFileSync(
      path.join(dir, "Assessment_Data_83.dbf"),
      dbf(rf, Array.from({ length: o.n }, (_, i) => ({ values: { GISLINK: `SYNTHETIC-${i}`, SYN_MAILST: i % 2 === 0 ? "GA" : "TN", SYN_IMPVAL: i % 3 === 0 ? 0 : 50_000 + i } }))),
    );
  }
  return dir;
}

const FIELDS = { mailingStateField: "SYN_MAILST", improvementValueField: "SYN_IMPVAL" };
const baseDeps = (over: Partial<TnBuildDeps> = {}): TnBuildDeps => ({ outDir: tmp("tn-out-"), today: "2026-10-24", loadContext: emptyCtx, bucketConfigured: false, ...over });

function memoryStore() {
  const batches: OwnedParcelInput[][] = [];
  const completed: Array<{ stored: number; receipts: number }> = [];
  return {
    batches,
    completed,
    store: {
      async saveBatch(ps: OwnedParcelInput[]) {
        batches.push(ps);
        return ps.length;
      },
      async complete(stored: number, receipts: unknown[]) {
        completed.push({ stored, receipts: receipts.length });
        return { receiptsRecorded: receipts.length };
      },
    },
  };
}

// ── Which county ─────────────────────────────────────────────────────────

describe("county by county, metros first — never statewide", () => {
  const rows = (census as { rows: Array<{ countyFips: string; county: string; maintainedBy: string }> }).rows;

  it("every metro entry's FIPS and name match the county source census (TIGERweb GEOID), with no duplicates", () => {
    expect(TN_METRO_COUNTY_ORDER.length, "vacuity: the metro order is populated").toBeGreaterThanOrEqual(15);
    expect(new Set(TN_METRO_COUNTY_ORDER.map((c) => c.fips)).size).toBe(TN_METRO_COUNTY_ORDER.length);
    for (const c of TN_METRO_COUNTY_ORDER) {
      const row = rows.find((r) => r.countyFips === c.fips);
      expect(row?.county, `${c.fips}`).toBe(c.county);
      expect(row?.maintainedBy, `${c.county} must be Comptroller-maintained`).toBe("state");
      expect(resolveTnCounty({ countyFips: c.fips })).toEqual({ fips: c.fips, county: c.county });
    }
  });

  it("the self-maintained list and the census agree, and every self-maintained county is refused", () => {
    const censusSelf = rows.filter((r) => r.maintainedBy === "county").map((r) => r.county).sort();
    expect(censusSelf).toEqual([...TN_SELF_MAINTAINED_COUNTIES].sort());
    expect(censusSelf.length, "vacuity").toBe(9);
    for (const c of TN_SELF_MAINTAINED_COUNTIES) expect(() => resolveTnCounty({ countyName: c })).toThrow(/maintains its own parcels/);
  });

  it("refuses a statewide request in every spelling, an unnamed county, an unknown county and a FIPS/name mismatch", () => {
    for (const v of ["*", "all", "statewide", "Tennessee", "TN", "47", "47000"]) {
      expect(() => resolveTnCounty({ countyName: v }), v).toThrow(/statewide/);
      expect(() => resolveTnCounty({ countyFips: v }), v).toThrow(/statewide/);
    }
    expect(() => resolveTnCounty({})).toThrow(/one county/);
    expect(() => resolveTnCounty({ countyFips: "47999" })).toThrow(/not a Tennessee county FIPS/);
    expect(() => resolveTnCounty({ countyName: "Atlantis" })).toThrow(/not a Tennessee county/);
    expect(() => resolveTnCounty({ countyFips: "47165", countyName: "Wilson" })).toThrow(/one county per run/);
  });

  it("buildTnCounty re-checks its target: a self-maintained county is refused even when passed directly", async () => {
    const src = comptrollerDirSource(download({ n: 3 }), FIELDS, "2026-10-24");
    await expect(buildTnCounty({ fips: "47037", county: "Davidson" }, src, baseDeps())).rejects.toThrow(/maintains its own parcels/);
  });
});

// ── The paged reader ─────────────────────────────────────────────────────

describe("the Comptroller download is read a page at a time", () => {
  it("pages of at most 1,000; a deleted .dbf row and a null shape are skipped without shifting later parcels", async () => {
    const src = comptrollerDirSource(download({ n: 2_500, deletedAt: [5], nullAt: [9] }), FIELDS, "2026-10-24");
    const sizes: number[] = [];
    const all: TnSourceParcel[] = [];
    for await (const p of src.parcelPages()) {
      sizes.push(p.length);
      all.push(...p);
    }
    expect(sizes.every((s) => s <= 1000)).toBe(true);
    expect(sizes.length).toBe(3);
    expect(all.length).toBe(2_498);
    expect(src.skipped()).toEqual({ deleted: 1, nullShape: 1, noGisLink: 0 });
    // Alignment: SYNTHETIC-6's geometry is ring(6), not ring(7).
    const p6 = all.find((p) => p.gisLink === "SYNTHETIC-6");
    expect(p6?.geometry.type).toBe("Polygon");
    const xs = (p6?.geometry.coordinates as number[][][])[0].map((c) => c[0]);
    expect(Math.min(...xs)).toBeCloseTo(ring(6)[0][0], 9);
    expect(all.some((p) => p.gisLink === "SYNTHETIC-5")).toBe(false);
  });

  it("refuses a roll field the roll does not carry, and a roll field named with no roll", () => {
    expect(() => comptrollerDirSource(download({ n: 2 }), { improvementValueField: "NOT_A_FIELD" }, "2026-10-24")).toThrow(/no field "NOT_A_FIELD"/);
    expect(() => comptrollerDirSource(download({ n: 2, roll: false }), FIELDS, "2026-10-24")).toThrow(/no Assessment_Data/);
  });
});

// ── The build ────────────────────────────────────────────────────────────

describe("the bounded build", () => {
  it("joins the roll, keeps every parcel in batches, writes the rural/vacant showcase, and reads it back", async () => {
    const dir = download({ n: 1_200, deletedAt: [5] });
    const mem = memoryStore();
    const deps = baseDeps({ store: mem.store });
    const r = await buildTnCounty(SUMNER, comptrollerDirSource(dir, FIELDS, "2026-10-24"), deps);
    expect(r).toMatchObject({ county: "Sumner", countyFips: "47165", parcelsIn: 1_199, rollRecords: 1_200, joined: 1_199, rural: 1_199, urbanSkipped: 0, vacancyUnknown: 0 });
    // improvement 0 when i % 3 === 0 (i in 0..1199, minus deleted 5): 400 vacant.
    expect(r.vacant).toBe(400);
    expect(r.written).toBe(400);
    expect(r.geoparquet.rowsReadBack).toBe(400);
    expect(r.pmtiles.featuresInSampleTile).toBeGreaterThan(0);
    // Persisted per batch, never in one call; the total is what complete() records.
    expect(mem.batches.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...mem.batches.map((b) => b.length))).toBeLessThanOrEqual(500);
    expect(mem.batches.flat().length).toBe(1_199);
    expect(mem.completed).toEqual([{ stored: 1_199, receipts: 0 }]);
    // Out-of-state owner is read from the joined roll: SYNTHETIC-0 mails from GA.
    const p0 = mem.batches.flat().find((p) => p.sourceParcelId === "SYNTHETIC-0");
    expect(p0?.facts.out_of_state_owner).toMatchObject({ status: "computed", value: { outOfState: true, mailingState: "GA" } });
    expect(p0?.parcelKey).toBe("TN-47165-SYNTHETIC-0");
    const back = await readGeoParquetRows<{ geometry: never; parcel_key: string; county_fips: string; county: string }>(r.geoparquet.localPath);
    expect(back.rows.every((x) => x.county_fips === "47165" && x.county === "Sumner" && !x.parcel_key.includes("47000"))).toBe(true);
    expect(path.basename(r.geoparquet.localPath)).toBe("tn-sumner.parquet");
    expect(r.geoparquet.objectKey).toBe(`tn/sumner/2026-10-24/tn-sumner.${r.geoparquet.sha256.slice(0, 16)}.parquet`);
    // Showcase rows are ascending by source_parcel_id in UTF-8 byte order (the D2b diff order), not cell order.
    const ids = back.rows.map((x) => (x as unknown as { source_parcel_id: string }).source_parcel_id);
    expect(ids).toEqual([...ids].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
    expect(ids.slice(0, 3)).toEqual(["SYNTHETIC-0", "SYNTHETIC-1002", "SYNTHETIC-1005"]);
    // The spill directory is gone.
    expect(readdirSync(deps.outDir).filter((f) => f.startsWith("."))).toEqual([]);
    expect(r.outcome.status).toBe("dry_run_only");
  });

  it("a file that names a second county is refused mid-stream and the partial artifacts are discarded", async () => {
    const dir = download({ n: 1_500, county: (i) => (i === 1_400 ? "Wilson" : "Sumner") });
    const deps = baseDeps();
    await expect(buildTnCounty(SUMNER, comptrollerDirSource(dir, FIELDS, "2026-10-24"), deps)).rejects.toThrow(/also names Wilson/);
    expect(existsSync(path.join(deps.outDir, "tn-sumner.parquet"))).toBe(false);
    expect(readdirSync(deps.outDir)).toEqual([]);
  });

  it("FALSIFICATION: sample and synthetic sources are never stored or uploaded, whatever deps are passed", async () => {
    const real = comptrollerDirSource(download({ n: 30 }), FIELDS, "2026-10-24");
    for (const kind of ["sample", "synthetic"] as const) {
      const src: TnParcelSource = { ...real, kind, label: `SYNTHETIC ${kind}` };
      const mem = memoryStore();
      const upload = vi.fn();
      const r = await buildTnCounty(SUMNER, src, baseDeps({ store: mem.store, bucketConfigured: true, objectStore: async () => { throw new Error("must not be reached"); }, upload }));
      expect(mem.batches).toEqual([]);
      expect(mem.completed).toEqual([]);
      expect(upload).not.toHaveBeenCalled();
      expect(r.store).toMatch(/never/);
      expect(r.upload).toMatch(/never/);
      expect(r.outcome.status).toBe("dry_run_only");
    }
  });

  it("with a bucket, both artifacts are streamed up and HEAD-confirmed; the receipts reach complete() → 'ingested'", async () => {
    const objects = new Map<string, number>();
    const client: ObjectStoreClient = {
      bucket: "https://r2.example.invalid/acreos",
      async put() {
        throw new Error("bulk artifacts must stream, never buffer");
      },
      async putFile(key, _p, bytes) {
        objects.set(key, bytes);
        return { etag: "e" };
      },
      async headBytes(key) {
        return objects.get(key) ?? null;
      },
    };
    const mem = memoryStore();
    const r = await buildTnCounty(
      SUMNER,
      comptrollerDirSource(download({ n: 40 }), FIELDS, "2026-10-24"),
      baseDeps({ store: mem.store, bucketConfigured: true, objectStore: async () => client, upload: uploadFileAndConfirm }),
    );
    expect(r.outcome.status).toBe("ingested");
    expect([...objects.keys()].sort()).toEqual([
      `tn/sumner/2026-10-24/tn-sumner.${r.geoparquet.sha256.slice(0, 16)}.parquet`,
      `tn/sumner/2026-10-24/tn-sumner.${r.pmtiles.sha256.slice(0, 16)}.pmtiles`,
    ].sort());
    expect(mem.completed).toEqual([{ stored: 40, receipts: 2 }]);
  });

  it("a configured bucket with no object store refuses rather than reporting a local build as uploaded", async () => {
    await expect(buildTnCounty(SUMNER, comptrollerDirSource(download({ n: 10 }), FIELDS, "2026-10-24"), baseDeps({ bucketConfigured: true }))).rejects.toThrow(/no object store/);
  });

  it("refuses to emit empty artifacts (every parcel improved)", async () => {
    const src = comptrollerDirSource(download({ n: 2 }), FIELDS, "2026-10-24");
    const noVacant: TnParcelSource = {
      ...src,
      async *rollPages() {
        yield [{ gisLink: "SYNTHETIC-0", mailingState: null, improvementValue: 1 }, { gisLink: "SYNTHETIC-1", mailingState: null, improvementValue: 1 }];
      },
    };
    await expect(buildTnCounty(SUMNER, noVacant, baseDeps())).rejects.toThrow(/empty artifacts/);
  });

  it("reports peak RSS against the documented ceiling", async () => {
    let n = 100 * 1048576;
    const r = await buildTnCounty(SUMNER, comptrollerDirSource(download({ n: 20 }), FIELDS, "2026-10-24"), baseDeps({ rss: () => (n += 100 * 1048576) }));
    expect(r.rssCeilingMb).toBe(400);
    expect(r.peakRssMb).toBeGreaterThan(400);
    expect(r.overCeiling).toBe(true);
  });
});
