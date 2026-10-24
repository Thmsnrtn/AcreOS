/**
 * D2a — statewide cadastral builds (the D1b template applied to bulk wave 1),
 * streamed with bounded memory, with a dossier-gated live-upload path.
 *
 * Ports every invariant of the D1 FL test (tests/unit/flStatewideCadastral,
 * retired with the accumulate-then-build module) onto the generic builder,
 * and adds the D2a ones: one spec per seeded wave-1 state, the IN/OH refusal,
 * the ingest gate, and the streamed upload with HEAD confirmation.
 *
 * SYNTHETIC LAYERS. Every feature is built in this file with each state's
 * verified field names; no value is real parcel data. The live runs need the
 * state hosts, which this build container cannot reach.
 */
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/providers/fetchGeo", () => ({
  fetchGeo: async () => {
    throw new Error("tests never reach the network");
  },
}));

import {
  buildCounty,
  buildOutcome,
  buildSpecFor,
  ingestGate,
  statewideJobName,
  streamCounty,
  type LayerDeps,
  type StatewideBuildSpec,
} from "../../server/services/landData/statewideCadastral";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../../server/services/statewideParcelEndpoints";
import { readGeoParquetRows } from "../../server/services/landData/geoParquet";
import { uploadFileAndConfirm, type ObjectStoreClient, type UploadReceipt } from "../../server/services/landData/openDataBucket";
import { statewideSource, type StatewideSourceEntry } from "../../server/services/openData/statewideSourceRegistry";
import { policyFromDossier, type SourceDossier } from "../../shared/openData/sourcePolicy";
import { STATEWIDE_BUILD_STATES } from "../../server/services/etlHandlers";
import type { BulkParcelRecord } from "../../shared/landData/bulkParcelRecord";

const WAVE1_SEEDED = ["FL", "NC", "WI", "AR", "MT"];
const mappedOf = (spec: StatewideBuildSpec) => Object.values(spec.mapping).filter((f): f is string => !!f);
const square = (x: number, y: number) => ({
  type: "Polygon",
  coordinates: [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]],
});

/** A synthetic ArcGIS layer for `spec`: every mapped field carries a synthetic value. */
function layer(spec: StatewideBuildSpec, opts: { fields?: string[]; count?: number; over?: (oid: number) => Record<string, unknown>; lastEdit?: number; rss?: () => number } = {}) {
  const urls: string[] = [];
  const count = opts.count ?? 3;
  const fields = opts.fields ?? ["OBJECTID", "CO_FIXTURE", ...mappedOf(spec)];
  const m = spec.mapping;
  const feature = (oid: number) => ({
    geometry: square(-84.9 + (oid % 200) * 0.002, 30.2 + Math.floor(oid / 200) * 0.002),
    properties: {
      OBJECTID: oid,
      CO_FIXTURE: "FIXTURE",
      ...(m.apn ? { [m.apn]: `SYN-${oid}` } : {}),
      ...(m.owner ? { [m.owner]: `SYNTHETIC OWNER ${oid}` } : {}),
      ...(m.address ? { [m.address]: `${oid} SYNTHETIC RD` } : {}),
      ...(m.assessedValue ? { [m.assessedValue]: 10_000 * oid } : {}),
      ...(m.marketValue ? { [m.marketValue]: 12_000 * oid } : {}),
      ...(m.lastSalePrice ? { [m.lastSalePrice]: 9_000 * oid } : {}),
      ...(m.legalDescription ? { [m.legalDescription]: `SYNTHETIC LOT ${oid}` } : {}),
      ...(opts.over ? opts.over(oid) : {}),
    },
  });
  const deps: LayerDeps & { urls: string[] } = {
    urls,
    rss: opts.rss,
    async getJson(url) {
      urls.push(url);
      if (url.endsWith("?f=json")) {
        return {
          ok: true,
          status: 200,
          body: {
            objectIdField: "OBJECTID",
            fields: fields.map((name) => ({ name, type: name === "OBJECTID" ? "esriFieldTypeOID" : "esriFieldTypeString" })),
            editingInfo: opts.lastEdit ? { lastEditDate: opts.lastEdit } : undefined,
          },
        };
      }
      const q = new URLSearchParams(url.split("?")[1]);
      const after = Number(/OBJECTID > (\d+)/.exec(q.get("where") ?? "")?.[1] ?? 0);
      const n = Number(q.get("resultRecordCount") ?? 1000);
      const feats = [];
      for (let oid = after + 1; oid <= Math.min(count, after + n); oid++) feats.push(feature(oid));
      return { ok: true, status: 200, body: { features: feats } };
    },
  };
  return deps;
}

const COUNTY = { countyField: "CO_FIXTURE", countyValue: "FIXTURE" };
const collect = async (spec: StatewideBuildSpec, deps: LayerDeps, cfg = COUNTY) => {
  const recs: BulkParcelRecord[] = [];
  const summary = await streamCounty(spec, cfg, deps, async (r) => {
    recs.push(r);
  });
  return { summary, recs };
};

describe("one build spec per seeded wave-1 state (population pinned)", () => {
  it("every wave-1 state with a verified statewide layer has a registered job; the job set is exactly that", () => {
    expect([...STATEWIDE_BUILD_STATES].sort()).toEqual([...WAVE1_SEEDED].sort());
    for (const st of WAVE1_SEEDED) {
      const spec = buildSpecFor(st);
      expect(spec.job).toBe(statewideJobName(st));
      expect(spec.mapping.apn, st).toBeTruthy();
      expect(mappedOf(spec).length, `${st} vacuity: mapped fields`).toBeGreaterThanOrEqual(3);
      expect(STATEWIDE_PARCEL_ENDPOINTS.some((e) => e.state === st)).toBe(true);
    }
    // FL keeps D1's job name, so the seeded etl_jobs row still resolves.
    expect(statewideJobName("FL")).toBe("fl_statewide_cadastral_v1");
  });

  it("every build job is seeded in a migration AND its mirror (no handler without a job row, no job without a handler)", () => {
    const sql = ["0287_d1_data_sourcing_foundation.sql", "0288_d2a_statewide_wave1_jobs.sql"].map((f) => readFileSync(path.join(__dirname, "../../migrations", f), "utf8")).join("\n");
    const mirror = readFileSync(path.join(__dirname, "../../scripts/migrate.mjs"), "utf8");
    const seeded = new Set(Array.from(sql.matchAll(/\('([a-z]{2}_statewide_cadastral_v1)'/g)).map((m) => m[1]));
    expect(seeded.size, "vacuity: the parser found seeded jobs").toBeGreaterThanOrEqual(5);
    expect([...seeded].sort()).toEqual(STATEWIDE_BUILD_STATES.map(statewideJobName).sort());
    for (const j of seeded) expect(mirror.includes(`('${j}', '${j}'`), `${j} mirrored in migrate.mjs`).toBe(true);
  });

  it("IN and OH (wave 1, no verified statewide layer) are refused, not discovered at build time", () => {
    for (const st of ["IN", "OH"]) {
      expect(STATEWIDE_PARCEL_ENDPOINTS.some((e) => e.state === st), `${st} must not be seeded without verification`).toBe(false);
      expect(() => buildSpecFor(st)).toThrow(/no verified statewide layer/);
    }
    expect(() => buildSpecFor("TX")).toThrow(/no verified statewide layer/);
  });
});

describe("stop conditions — decided before any feature page is read", () => {
  for (const st of WAVE1_SEEDED) {
    it(`${st}: a renamed mapped field STOPs the build; no mapping is guessed`, async () => {
      const spec = buildSpecFor(st);
      const victim = spec.mapping.apn as string;
      const deps = layer(spec, { fields: ["OBJECTID", "CO_FIXTURE", ...mappedOf(spec).map((f) => (f === victim ? `${f}_RENAMED` : f))] });
      await expect(collect(spec, deps)).rejects.toThrow(new RegExp(`STOP: .*${victim}`));
      expect(deps.urls.filter((u) => u.includes("/query?"))).toHaveLength(0);
    });
  }

  it("refuses an unbounded run, a county field the layer lacks, and a layer with no object id", async () => {
    const spec = buildSpecFor("NC");
    await expect(collect(spec, layer(spec), {} as typeof COUNTY)).rejects.toThrow(/bounded to one county/);
    await expect(collect(spec, layer(spec), { countyField: "CO_NO", countyValue: "1" })).rejects.toThrow(/no field "CO_NO"/);
    const noOid = layer(spec, { fields: ["CO_FIXTURE", ...mappedOf(spec)] });
    const orig = noOid.getJson;
    noOid.getJson = async (u) => {
      const r = await orig(u);
      if (u.endsWith("?f=json")) (r.body as { objectIdField?: string }).objectIdField = undefined;
      return r;
    };
    await expect(collect(spec, noOid)).rejects.toThrow(/no object-id field/);
  });
});

describe("normalization (A1 provenance per field group)", () => {
  it("maps the seed's fields onto the canonical record with a provenance block per group", async () => {
    const spec = buildSpecFor("FL");
    const { recs } = await collect(spec, layer(spec, { count: 7, lastEdit: Date.parse("2026-08-15T00:00:00Z") }));
    const r = recs[6];
    expect(r).toMatchObject({
      state: "FL",
      county: "FIXTURE",
      identity: { sourceParcelId: "SYN-7" },
      ownership: { ownerName: "SYNTHETIC OWNER 7", situsAddress: "7 SYNTHETIC RD" },
      tax: { assessedValueUsd: 70_000 },
      valuation: { marketValueUsd: 84_000 },
      sale: { lastSalePriceUsd: 63_000 },
      legalDescription: "SYNTHETIC LOT 7",
    });
    expect(r.provenance.tax).toMatchObject({ sourceFields: ["AV_NSD"], decayClass: "months", confidence: "medium", asOf: "2026-08-15T00:00:00.000Z" });
    expect(r.provenance.ownership.decayClass).toBe("about_a_year");
    expect(r.provenance.valuation.decayClass).toBe("continuous");
    expect(r.provenance.geometry.decayClass).toBe("years");
    expect(r.provenance.identity.confidence).toBe("high");
    for (const g of Object.values(r.provenance)) expect(g.confidenceBasis.length).toBeGreaterThan(10);
  });

  it("a field the source does not map (NC: no market value) is null with null confidence — never 0", async () => {
    const spec = buildSpecFor("NC");
    expect(spec.mapping.marketValue).toBeUndefined();
    const { recs } = await collect(spec, layer(spec, { count: 1 }));
    expect(recs[0].valuation.marketValueUsd).toBeNull();
    expect(recs[0].provenance.valuation.confidence).toBeNull();
  });

  it("a parcel with no id is skipped and counted", async () => {
    const spec = buildSpecFor("AR");
    const { summary, recs } = await collect(spec, layer(spec, { count: 3, over: (oid) => (oid === 2 ? { [spec.mapping.apn as string]: "  " } : {}) }));
    expect(recs).toHaveLength(2);
    expect(summary.skippedNoId).toBe(1);
    expect(summary.fetched).toBe(3);
  });
});

describe("streamed, bounded build: local artifacts and the receipt shape", () => {
  const outDir = () => mkdtempSync(path.join(os.tmpdir(), "d2a-test-"));

  it("pages a 2,500-parcel county (3 pages) without holding it, and every artifact digest matches its bytes on disk", async () => {
    const spec = buildSpecFor("MT");
    const deps = layer(spec, { count: 2_500 });
    const report = await buildCounty(spec, COUNTY, { ...deps, outDir: outDir(), bucketConfigured: false, today: "2026-10-24" });
    expect(report.summary).toMatchObject({ fetched: 2_500, normalized: 2_500, pages: 3, skippedNoId: 0 });
    expect(report.artifacts.rowsWritten).toBe(2_500);
    expect(report.artifacts.rowsReadBack).toBe(2_500);
    expect(report.artifacts.tileCount).toBeGreaterThan(0);
    expect(report.artifacts.partitions).toBeGreaterThan(1);
    for (const a of [report.artifacts.parquet, report.artifacts.pmtiles]) {
      const onDisk = readFileSync(a.localPath);
      expect(a.bytes).toBe(onDisk.length);
      expect(a.sha256).toBe(createHash("sha256").update(onDisk).digest("hex"));
      expect(a.objectKey).toMatch(/^statewide\/mt\/fixture\/2026-10-24\/mt-fixture\.[0-9a-f]{16}\.(parquet|pmtiles)$/);
      expect(a.objectKey).toContain(`.${a.sha256.slice(0, 16)}.`);
    }
    // The PMTiles header is a v3 archive whose tile count matches the build.
    const head = readFileSync(report.artifacts.pmtiles.localPath).subarray(0, 127);
    expect(head.toString("ascii", 0, 7)).toBe("PMTiles");
    expect(head.readUInt8(7)).toBe(3);
    expect(Number(head.readBigUInt64LE(72))).toBe(report.artifacts.tileCount);
    expect(head.readUInt8(96)).toBe(1); // clustered
  });

  it("owner names are withheld from artifacts while the state's display use is unresolved", async () => {
    const spec = buildSpecFor("FL");
    const report = await buildCounty(spec, COUNTY, { ...layer(spec, { count: 5 }), outDir: outDir(), bucketConfigured: false, today: "2026-10-24" });
    expect(report.gate.ownerNamesAllowed).toBe(false);
    const back = await readGeoParquetRows<Record<string, unknown> & { geometry: never }>(report.artifacts.parquet.localPath);
    expect(back.geo.primary_column).toBe("geometry");
    for (const row of back.rows) {
      expect(row.owner_name).toBeUndefined();
      expect(JSON.stringify(row)).not.toMatch(/SYNTHETIC OWNER/);
      expect(JSON.parse(row.provenance_json as string).tax.decayClass).toBe("months");
    }
  });

  it("a partition denser than the cap is refused and the partial artifacts are discarded", async () => {
    const spec = buildSpecFor("WI");
    const dir = outDir();
    const { StreamingArtifactWriter } = await import("../../server/services/landData/streamingArtifacts");
    const w = new StreamingArtifactWriter<{ geometry: never; id: string }>(
      { outDir: dir, stem: "dense", schemaDef: { id: { type: "UTF8" }, geometry: { type: "BYTE_ARRAY" } }, layerName: "p", tileName: "t", tileDescription: "d", attribution: "a", maxPartitionFeatures: 5 },
      (r) => ({ id: r.id }),
    );
    await w.open();
    const write = async (i: number) => w.write({ id: String(i), geometry: square(-84.9, 30.2) as never });
    for (let i = 0; i < 5; i++) await write(i);
    await expect(write(5)).rejects.toThrow(/too dense to tile/);
    w.discard();
    expect(() => statSync(w.parquetPath)).toThrow();
    void spec;
  });

  it("rows land in ascending source_parcel_id by UTF-8 byte order (not OBJECTID, not UTF-16), across spilled sort runs", async () => {
    const spec = buildSpecFor("NC");
    // Ids out of OBJECTID order, including a BMP private-use char vs an astral
    // char: UTF-16 puts the emoji (0xD83D…) first, UTF-8 puts U+FFFD first.
    const ids = ["SYN-\u{1F600}", "SYN-\uFFFD", "SYN-B", "SYN-a", "SYN-A", "SYN-10", "SYN-9", "SYN-é"];
    const n = 600;
    const idOf = (oid: number) => (oid <= ids.length ? ids[oid - 1] : `SYN-${String((oid * 7919) % 100_003).padStart(6, "0")}`);
    const report = await buildCounty(spec, COUNTY, {
      ...layer(spec, { count: n, over: (oid) => ({ [spec.mapping.apn as string]: idOf(oid) }) }),
      outDir: outDir(),
      bucketConfigured: false,
      today: "2026-10-24",
      sortRunChars: 50_000, // force several spilled runs through the k-way merge
    });
    const back = await readGeoParquetRows<Record<string, unknown> & { geometry: never }>(report.artifacts.parquet.localPath);
    const got = back.rows.map((r) => r.source_parcel_id as string);
    expect(got).toHaveLength(n);
    const byUtf8 = [...got].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    expect(got).toEqual(byUtf8);
    expect(got.indexOf("SYN-\uFFFD")).toBeLessThan(got.indexOf("SYN-\u{1F600}"));
    expect(new Set(got).size, "no row lost or duplicated by the merge").toBe(n);
  });

  it("refuses to emit empty artifacts", async () => {
    const spec = buildSpecFor("NC");
    await expect(buildCounty(spec, COUNTY, { ...layer(spec, { count: 0 }), outDir: outDir(), bucketConfigured: false, today: "2026-10-24" })).rejects.toThrow(/empty artifacts/);
  });

  it("reports peak RSS against the documented ceiling", async () => {
    const spec = buildSpecFor("NC");
    let n = 100 * 1048576;
    const deps = layer(spec, { count: 1_200, rss: () => (n += 100 * 1048576) });
    const report = await buildCounty(spec, COUNTY, { ...deps, outDir: outDir(), bucketConfigured: false, today: "2026-10-24" });
    expect(report.summary.peakRssMb).toBeGreaterThan(report.rssCeilingMb);
    expect(report.overCeiling).toBe(true);
  });
});

// ── The ingest decision ──────────────────────────────────────────────────

const allowedDossier = (internal: "allowed" | "forbidden" = "allowed"): SourceDossier => {
  const f = (status: "allowed" | "forbidden") => ({ status, evidence: "synthetic terms text", readOn: "2026-10-24" });
  return { termsUrl: "https://example.invalid/terms", termsReadOn: "2026-10-24", useClasses: { internal: f(internal), display: f("forbidden"), redistribution: f("forbidden"), resale: f("forbidden") }, attributionRequired: true, restrictions: [] };
};
const entryWith = (state: string, d: SourceDossier): StatewideSourceEntry => ({ ...statewideSource(state)!, dossier: d, policy: policyFromDossier(d) });

describe("the ingest gate: no resolved dossier, no upload; no receipts, no 'ingested'", () => {
  it("every wave-1 state is dry-run only today — its use classes are unresolved even with the bucket live", () => {
    for (const st of WAVE1_SEEDED) {
      const g = ingestGate(st, true);
      expect(g.upload, st).toBe(false);
      expect(g.reasons.join(" | ")).toMatch(/use classes unresolved/);
    }
  });

  it("FALSIFICATION: a resolved dossier that forbids internal use still never uploads", () => {
    const g = ingestGate("NC", true, false, entryWith("NC", allowedDossier("forbidden")));
    expect(g.upload).toBe(false);
    expect(g.reasons.join(" ")).toMatch(/does not allow internal use/);
  });

  it("a resolved dossier allowing internal use + a configured bucket opens the gate; dryRun:true closes it", () => {
    expect(ingestGate("NC", true, false, entryWith("NC", allowedDossier())).upload).toBe(true);
    expect(ingestGate("NC", false, false, entryWith("NC", allowedDossier())).upload).toBe(false);
    expect(ingestGate("NC", true, true, entryWith("NC", allowedDossier())).reasons.join(" ")).toMatch(/dryRun/);
  });

  it("FALSIFICATION: an open gate without receipts for the exact bytes is not 'ingested'", () => {
    const g = { upload: true, ownerNamesAllowed: false, reasons: [] };
    const a = { localPath: "/x", bytes: 10, sha256: "a".repeat(64), contentType: "x" };
    const good: UploadReceipt = { corpusKey: "statewide-parcels-bulk", objectKey: "k", bytes: 10, sha256: "a".repeat(64), bucket: "https://r2/acreos", etag: null, uploadedAt: new Date() };
    expect(buildOutcome(g, [a], []).status).toBe("dry_run_only");
    expect(buildOutcome(g, [a], [{ ...good, bytes: 11 }]).status).toBe("dry_run_only");
    expect(buildOutcome(g, [a], [{ ...good, bucket: "" }]).status).toBe("dry_run_only");
    expect(buildOutcome(g, [a], [good]).status).toBe("ingested");
  });
});

describe("the live-upload path (streamed file, HEAD-confirmed)", () => {
  function memoryStore(opts: { truncate?: boolean } = {}): ObjectStoreClient & { objects: Map<string, Buffer> } {
    const objects = new Map<string, Buffer>();
    return {
      objects,
      bucket: "https://r2.example.invalid/acreos",
      async put() {
        throw new Error("bulk artifacts must stream, never buffer");
      },
      async putFile(key, filePath) {
        const b = readFileSync(filePath);
        objects.set(key, opts.truncate ? b.subarray(0, b.length - 1) : b);
        return { etag: "e1" };
      },
      async headBytes(key) {
        return objects.get(key)?.length ?? null;
      },
    };
  }

  it("with an open gate, both artifacts are streamed up, HEAD-confirmed, receipted and recorded → 'ingested'", async () => {
    const spec = buildSpecFor("NC");
    const store = memoryStore();
    const recorded: UploadReceipt[] = [];
    const report = await buildCounty(spec, COUNTY, {
      ...layer(spec, { count: 40 }),
      outDir: mkdtempSync(path.join(os.tmpdir(), "d2a-up-")),
      bucketConfigured: true,
      objectStore: async () => store,
      upload: (c, k, o, a) => uploadFileAndConfirm(c, k, o, a),
      recordReceipt: async (_s, _c, r) => {
        recorded.push(r);
      },
      today: "2026-10-24",
      sourceEntry: entryWith("NC", allowedDossier()),
    });
    expect(report.outcome.status).toBe("ingested");
    expect(recorded).toHaveLength(2);
    expect(store.objects.get(report.artifacts.parquet.objectKey)?.length).toBe(report.artifacts.parquet.bytes);
  });

  it("FALSIFICATION: two same-day builds of one county with different bytes get different keys, and BOTH receipts still resolve", async () => {
    const spec = buildSpecFor("NC");
    const store = memoryStore();
    const run = (count: number) =>
      buildCounty(spec, COUNTY, {
        ...layer(spec, { count }),
        outDir: mkdtempSync(path.join(os.tmpdir(), "d2a-twice-")),
        bucketConfigured: true,
        objectStore: async () => store,
        upload: (c, k, o, a) => uploadFileAndConfirm(c, k, o, a),
        today: "2026-10-24",
        sourceEntry: entryWith("NC", allowedDossier()),
      });
    const first = await run(40);
    const second = await run(41);
    if (first.outcome.status !== "ingested" || second.outcome.status !== "ingested") throw new Error("both builds must ingest");
    const receipts = [...first.outcome.receipts, ...second.outcome.receipts];
    expect(new Set(receipts.map((r) => r.objectKey)).size).toBe(4);
    for (const r of receipts) {
      const obj = store.objects.get(r.objectKey);
      expect(obj?.length, r.objectKey).toBe(r.bytes);
      expect(createHash("sha256").update(obj as Buffer).digest("hex"), r.objectKey).toBe(r.sha256);
    }
  });

  it("FALSIFICATION: a bucket that lands fewer bytes yields no receipt and fails the run", async () => {
    const spec = buildSpecFor("NC");
    await expect(
      buildCounty(spec, COUNTY, {
        ...layer(spec, { count: 10 }),
        outDir: mkdtempSync(path.join(os.tmpdir(), "d2a-trunc-")),
        bucketConfigured: true,
        objectStore: async () => memoryStore({ truncate: true }),
        upload: (c, k, o, a) => uploadFileAndConfirm(c, k, o, a),
        today: "2026-10-24",
        sourceEntry: entryWith("NC", allowedDossier()),
      }),
    ).rejects.toThrow(/not ingested/);
  });

  it("an artifact changed after build is refused before upload", async () => {
    const store = memoryStore();
    const p = path.join(mkdtempSync(path.join(os.tmpdir(), "d2a-chg-")), "f.bin");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(p, "abc");
    await expect(uploadFileAndConfirm(store, "c", "k", { localPath: p, bytes: 3, sha256: "0".repeat(64), contentType: "x" })).rejects.toThrow(/changed after it was built/);
    expect(store.objects.size).toBe(0);
  });

  it("a gate that allows upload but no object store refuses rather than reporting a dry run as a build", async () => {
    const spec = buildSpecFor("NC");
    await expect(
      buildCounty(spec, COUNTY, { ...layer(spec, { count: 3 }), outDir: mkdtempSync(path.join(os.tmpdir(), "d2a-nos-")), bucketConfigured: true, today: "2026-10-24", sourceEntry: entryWith("NC", allowedDossier()) }),
    ).rejects.toThrow(/no object store/);
  });
});
