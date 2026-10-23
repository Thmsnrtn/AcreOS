/**
 * D1b — Florida statewide cadastral build: stop conditions, A1 provenance,
 * local artifacts + receipt shape, and the corporaStatus honesty contract.
 *
 * SYNTHETIC LAYER. Every feature here is built in this file using the field
 * names the seed verified (statewideParcelEndpoints.ts FL row); no value is
 * Florida data. The live dry run needs the FDOR host, which the D1 build
 * container cannot reach — so this proves the build's logic, and the live
 * dry run is a separate, still-owed step.
 */
import { mkdtempSync, readFileSync } from "node:fs";
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

import { buildDryRunArtifacts, fetchFlCounty, ingestOutcome, type FlRunDeps } from "../../server/services/landData/flStatewideCadastral";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../../server/services/statewideParcelEndpoints";
import { readGeoParquetRows } from "../../server/services/landData/geoParquet";
import type { UploadReceipt } from "../../server/services/landData/openDataBucket";

/** The FL row's verified field map — what the build reads. */
const MAPPED = Object.values(STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === "FL")!.fieldMappings).filter((f): f is string => !!f);
const LAYER_FIELDS = ["OBJECTID", "CO_FIXTURE", ...MAPPED];
const square = (x: number, y: number) => ({
  type: "Polygon",
  coordinates: [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]],
});
const feature = (oid: number, over: Record<string, unknown> = {}) => ({
  geometry: square(-84.9 + oid * 0.002, 30.2),
  properties: {
    OBJECTID: oid,
    CO_FIXTURE: "FIXTURE",
    PARCEL_ID: `SYN-${oid}`,
    OWN_NAME: `SYNTHETIC OWNER ${oid}`,
    PHY_ADDR1: `${oid} SYNTHETIC RD`,
    AV_NSD: 10_000 * oid,
    JV: 12_000 * oid,
    SALE_PRC1: 9_000 * oid,
    S_LEGAL: `SYNTHETIC LOT ${oid}`,
    ...over,
  },
});

function layer(opts: { fields?: string[]; features?: ReturnType<typeof feature>[]; lastEdit?: number } = {}): FlRunDeps & { urls: string[] } {
  const urls: string[] = [];
  const feats = opts.features ?? [feature(1), feature(2), feature(3)];
  return {
    urls,
    async getJson(url) {
      urls.push(url);
      if (url.endsWith("?f=json")) {
        return {
          ok: true,
          status: 200,
          body: {
            objectIdField: "OBJECTID",
            fields: (opts.fields ?? LAYER_FIELDS).map((name) => ({ name, type: name === "OBJECTID" ? "esriFieldTypeOID" : "esriFieldTypeString" })),
            editingInfo: opts.lastEdit ? { lastEditDate: opts.lastEdit } : undefined,
          },
        };
      }
      const after = Number(/OBJECTID > (\d+)/.exec(decodeURIComponent(url.replace(/\+/g, " ")))?.[1] ?? 0);
      return { ok: true, status: 200, body: { features: feats.filter((f) => (f.properties.OBJECTID as number) > after) } };
    },
  };
}

const COUNTY = { countyField: "CO_FIXTURE", countyValue: "FIXTURE" };

describe("stop conditions — decided before anything is built", () => {
  it("conformance: every mapped field present → ok, and the report says which were checked", async () => {
    expect(MAPPED.length).toBeGreaterThanOrEqual(7); // vacuity floor: the seed's verified field map
    const fetched = await fetchFlCounty(COUNTY, layer());
    expect(fetched.conformance).toEqual({ ok: true, present: MAPPED, missing: [] });
  });

  it("FALSIFICATION: the live layer renames a mapped field → STOP, no mapping is guessed", async () => {
    const renamed = LAYER_FIELDS.map((f) => (f === "JV" ? "JUST_VALUE" : f));
    await expect(fetchFlCounty(COUNTY, layer({ fields: renamed }))).rejects.toThrow(/STOP: .*JV/);
  });

  it("refuses an unbounded run (no county) and a county field the layer does not carry", async () => {
    await expect(fetchFlCounty({}, layer())).rejects.toThrow(/bounded to one county/);
    await expect(fetchFlCounty({ countyField: "CO_NO", countyValue: "42" }, layer())).rejects.toThrow(/no field "CO_NO"/);
  });
});

describe("normalization (A1 provenance per field group)", () => {
  const one = async (over: Record<string, unknown>, opts: { lastEdit?: number; noGeometry?: boolean } = {}) => {
    const f = feature(7, over);
    const feats = [opts.noGeometry ? { ...f, geometry: null as unknown as ReturnType<typeof square> } : f];
    return fetchFlCounty(COUNTY, layer({ features: feats, lastEdit: opts.lastEdit }));
  };

  it("maps the seed's fields onto the canonical record, with a provenance block per group", async () => {
    const { records } = await one({}, { lastEdit: Date.parse("2026-08-15T00:00:00Z") });
    const r = records[0];
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

  it("a value the source does not carry is null with null confidence — never 0", async () => {
    const { records } = await one({ JV: "", AV_NSD: null }, { noGeometry: true });
    const r = records[0];
    expect(r.valuation.marketValueUsd).toBeNull();
    expect(r.tax.assessedValueUsd).toBeNull();
    expect(r.provenance.valuation.confidence).toBeNull();
    expect(r.geometry).toBeNull();
    expect(r.provenance.tax.asOf).toBeNull();
  });

  it("a parcel with no id cannot be keyed and is skipped (counted, not dropped silently)", async () => {
    const fetched = await one({ PARCEL_ID: "  " });
    expect(fetched.records).toHaveLength(0);
    expect(fetched.skippedNoId).toBe(1);
  });
});

describe("dry run: local artifacts + the receipt shape (no upload)", () => {
  it("pages the bounded county, writes GeoParquet + PMTiles, and receipts match the bytes on disk", async () => {
    const fetched = await fetchFlCounty(COUNTY, layer({ lastEdit: Date.parse("2026-08-15T00:00:00Z") }));
    expect(fetched).toMatchObject({ fetched: 3, skippedNoId: 0, asOf: "2026-08-15T00:00:00.000Z", county: "FIXTURE" });

    const out = mkdtempSync(path.join(os.tmpdir(), "fl-dryrun-test-"));
    const a = await buildDryRunArtifacts(fetched.records, out, "test");
    expect(a.rowsWritten).toBe(3);
    expect(a.rowsReadBack).toBe(3);
    expect(a.tileCount).toBeGreaterThan(0);
    expect(a.receipts.map((r) => r.contentType)).toEqual(["application/vnd.apache.parquet", "application/vnd.pmtiles"]);
    for (const r of a.receipts) {
      const onDisk = readFileSync(r.localPath);
      expect(r.bytes).toBe(onDisk.length);
      expect(r.sha256).toBe(createHash("sha256").update(onDisk).digest("hex"));
      expect(r.uploaded).toBe(false);
      expect(r.bucket).toBeNull();
    }
    const back = await readGeoParquetRows<Record<string, unknown> & { geometry: never }>(a.receipts[0].localPath);
    expect(back.geo.primary_column).toBe("geometry");
    // Owner names are withheld from artifacts while FL display/internal use is unresolved.
    for (const row of back.rows) {
      expect(row).not.toHaveProperty("owner_name");
      expect(JSON.stringify(row)).not.toMatch(/SYNTHETIC OWNER/);
      expect(JSON.parse(row.provenance_json as string).tax.decayClass).toBe("months");
    }
  });

  it("refuses to emit empty artifacts", async () => {
    await expect(buildDryRunArtifacts([], mkdtempSync(path.join(os.tmpdir(), "fl-empty-")), "t")).rejects.toThrow(/empty artifacts/);
  });
});

describe("honesty contract: never 'ingested' without a bucket-confirmed receipt", () => {
  const art = [{ corpusKey: "statewide-parcels-bulk" as const, objectKey: "fl/x.parquet", localPath: "/tmp/x", bytes: 10, sha256: "a".repeat(64), contentType: "x", uploaded: false as const, bucket: null }];

  it("dry-run receipts alone are dry_run_only, with every reason stated", () => {
    const o = ingestOutcome({ artifacts: art, uploadReceipts: [], bucketConfigured: false });
    expect(o.status).toBe("dry_run_only");
    if (o.status === "dry_run_only") {
      expect(o.reasons.join(" | ")).toMatch(/use classes unresolved/);
      expect(o.reasons.join(" | ")).toMatch(/not provisioned/);
      expect(o.reasons.join(" | ")).toMatch(/no bucket-confirmed upload receipt/);
    }
  });

  it("FALSIFICATION: even with storage configured AND matching confirmed receipts, unresolved use classes keep it dry-run", () => {
    const confirmed: UploadReceipt = { corpusKey: "statewide-parcels-bulk", objectKey: "fl/x.parquet", bytes: 10, sha256: "a".repeat(64), bucket: "https://r2/bkt", etag: null, uploadedAt: new Date() };
    const o = ingestOutcome({ artifacts: art, uploadReceipts: [confirmed], bucketConfigured: true });
    expect(o.status).toBe("dry_run_only");
    if (o.status === "dry_run_only") expect(o.reasons).toHaveLength(1);
  });

  it("a receipt for different bytes does not cover the artifact", () => {
    const wrong: UploadReceipt = { corpusKey: "statewide-parcels-bulk", objectKey: "fl/x.parquet", bytes: 11, sha256: "b".repeat(64), bucket: "https://r2/bkt", etag: null, uploadedAt: new Date() };
    const o = ingestOutcome({ artifacts: art, uploadReceipts: [wrong], bucketConfigured: true });
    expect(o.status === "dry_run_only" && o.reasons.some((r) => /no bucket-confirmed/.test(r))).toBe(true);
  });
});
