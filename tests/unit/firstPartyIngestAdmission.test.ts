/**
 * First-party parcel ingest (package 2026-11-03) — licensing-as-code at
 * ingest, the re-verification radar, the WI pilot dossier, the WI
 * published-suppression discipline, can_mail, and count reconciliation.
 *
 * Every fetch goes through a recording fake: a refusal is proven by an EMPTY
 * request list, not by an error message. Feature values are synthetic.
 */
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const fetchGeoCalls = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("../../server/services/providers/fetchGeo", () => ({
  fetchGeo: async (url: string) => {
    fetchGeoCalls.urls.push(url);
    throw new Error("tests never reach the network");
  },
}));
// The ETL handler reads the job's active mapping from the DB; none here.
vi.mock("../../server/services/openData/adapterRemap", async (orig) => ({ ...(await orig<object>()), loadActiveMapping: async () => null }));

import {
  buildCounty,
  buildSpecFor,
  IngestRefusedError,
  normalizeFeature,
  reconcileCountyBuild,
  type LayerDeps,
  type StatewideBuildSpec,
} from "../../server/services/landData/statewideCadastral";
import { readGeoParquetRows } from "../../server/services/landData/geoParquet";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";
import {
  isClearedForLookup,
  statewideIngestAdmission,
  statewideSource,
  type StatewideSourceEntry,
} from "../../server/services/openData/statewideSourceRegistry";
import { effectiveDossier, ingestAdmission, policyFromDossier, type SourceDossier } from "../../shared/openData/sourcePolicy";

// The population pins strip every server/ file: a repo sweep declares its budget.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const TODAY = new Date("2026-11-03T21:00:00Z");
const LAPSED = new Date("2027-06-30T00:00:00Z");
const COUNTY = { countyField: "CONAME", countyValue: "FIXTURE" };
const square = (x: number, y: number) => ({ type: "Polygon", coordinates: [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]] });

/** A synthetic ArcGIS layer that records every URL it is asked for. */
function recordingLayer(spec: StatewideBuildSpec, opts: { count?: number; owner?: (oid: number) => string } = {}) {
  const urls: string[] = [];
  const m = spec.mapping;
  const count = opts.count ?? 4;
  const deps: LayerDeps = {
    async getJson(url) {
      urls.push(url);
      if (url.endsWith("?f=json")) {
        const fields = ["OBJECTID", "CONAME", ...Object.values(m).filter((f): f is string => !!f)];
        return { ok: true, status: 200, body: { objectIdField: "OBJECTID", fields: fields.map((name) => ({ name, type: "esriFieldTypeString" })) } };
      }
      const after = Number(/OBJECTID > (\d+)/.exec(new URLSearchParams(url.split("?")[1]).get("where") ?? "")?.[1] ?? 0);
      const features = [];
      for (let oid = after + 1; oid <= Math.min(count, after + 1000); oid++) {
        features.push({
          geometry: square(-89.4 + oid * 0.002, 43.1),
          properties: {
            OBJECTID: oid,
            CONAME: "FIXTURE",
            [m.apn as string]: `SYN-${oid}`,
            ...(m.owner ? { [m.owner]: opts.owner ? opts.owner(oid) : `SYNTHETIC OWNER ${oid}` } : {}),
          },
        });
      }
      return { ok: true, status: 200, body: { features } };
    },
  };
  return { urls, deps };
}

const outDir = () => mkdtempSync(path.join(os.tmpdir(), "fp-ingest-"));
const build = (spec: StatewideBuildSpec, deps: LayerDeps, extra: Record<string, unknown> = {}) =>
  buildCounty(spec, COUNTY, { ...deps, outDir: outDir(), bucketConfigured: false, today: "2026-11-03", now: TODAY, ...extra });

describe("§6.1 licensing refusal: a source not admitted for internal use is refused BEFORE any fetch", () => {
  // Seeded + unresolved (FL), seeded + unresolved and named by the spec as an example (NY),
  // AR (Display conditions do not make Internal resolved).
  for (const st of ["FL", "NY", "AR", "NC", "MT", "WA", "NJ", "MD"]) {
    it(`${st}: refused, zero requests, the refusal names the state and the unresolved class`, async () => {
      const spec = buildSpecFor(st);
      const { urls, deps } = recordingLayer(spec);
      const err = await build(spec, deps).catch((e) => e);
      expect(err).toBeInstanceOf(IngestRefusedError);
      expect((err as IngestRefusedError).message).toMatch(new RegExp(`${st}: internal use UNRESOLVED`));
      expect(urls).toEqual([]);
    });
  }

  it("an unseeded state (OH, MA, CT, DE — no verified seed) is refused with no request: admission AND the spec refuse", () => {
    for (const st of ["OH", "MA", "CT", "DE"]) {
      expect(statewideIngestAdmission(st, TODAY)).toMatchObject({ admitted: false });
      expect(() => buildSpecFor(st)).toThrow(/no verified statewide layer/);
    }
  });

  it("a FORBIDDEN internal finding is refused, naming the terms", () => {
    const d: SourceDossier = {
      termsUrl: "https://example.invalid/terms",
      termsReadOn: "2026-11-03",
      useClasses: {
        internal: { status: "forbidden", evidence: "synthetic: no commercial use", readOn: "2026-11-03" },
        display: { status: "unresolved", why: "x" },
        redistribution: { status: "unresolved", why: "x" },
        resale: { status: "unresolved", why: "x" },
      },
      attributionRequired: null,
      restrictions: [],
    };
    expect(ingestAdmission("ZZ", d, TODAY)).toEqual({ admitted: false, reasons: ["ZZ: internal use FORBIDDEN by its terms — synthetic: no commercial use"] });
  });

  it("WI (the Wave A pilot) is admitted and builds; the requests are its own layer's", async () => {
    const spec = buildSpecFor("WI");
    const { urls, deps } = recordingLayer(spec);
    const report = await build(spec, deps);
    expect(report.summary.normalized).toBe(4);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith(spec.layerUrl)).toBe(true);
    // No bucket: built, never uploaded, never "ingested".
    expect(report.outcome.status).toBe("dry_run_only");
  });
});

describe("the WI pilot dossier: read from the publisher's own words; ingest is NOT lookup clearance", () => {
  const wi = statewideSource("WI", TODAY)!;

  it("every use class is allowed on quoted evidence with a read date; attribution not required", () => {
    for (const u of ["internal", "display", "redistribution", "resale"] as const) {
      const f = wi.dossier.useClasses[u];
      expect(f.status, u).toBe("allowed");
      if (f.status === "allowed") {
        expect(f.evidence).toContain('"The data is in the public domain."');
        expect(f.evidence).toContain('"There are no use restrictions."');
        expect(f.readOn).toBe("2026-11-03");
      }
    }
    expect(wi.dossier.termsUrl).toMatch(/^https:\/\/sco\.wisc\.edu\/.+V12_Wisconsin_Statewide_Parcels_Schema_Documentation\.pdf$/);
    expect(wi.policy.attribution_required).toBe(false);
    expect(wi.dossier.reverifyBy).toBe("2027-06-30");
    expect(wi.dossier.reverifyTriggers?.join(" ")).toMatch(/V13/);
  });

  it("WI stays GATED for live point lookup: admitting ingest clears nothing", () => {
    expect(wi.lookup.status).toBe("gated");
    expect(isClearedForLookup(wi)).toBe(false);
  });

  it("only WI is resolved: every other seeded state stays restrictive", () => {
    for (const st of ["FL", "MT", "NC", "WA", "NJ", "AR", "NY", "MD"]) {
      const e = statewideSource(st, TODAY)!;
      expect(statewideIngestAdmission(st, TODAY).admitted, st).toBe(false);
      expect(e.policy.can_cache, st).toBe(false);
    }
  });
});

describe("§5: can_mail stays restrictive — never derived from internal use", () => {
  it("WI allows internal use, yet can_mail is false (no explicit mail finding)", () => {
    const wi = statewideSource("WI", TODAY)!;
    expect(wi.policy.can_cache).toBe(true);
    expect(wi.policy.can_mail).toBe(false);
  });

  it("only an explicit allowed mail finding (with internal allowed) yields can_mail", () => {
    const base = statewideSource("WI", TODAY)!.recordedDossier;
    expect(policyFromDossier({ ...base, mail: { status: "allowed", evidence: "synthetic", readOn: "2026-11-03" } }).can_mail).toBe(true);
    expect(policyFromDossier({ ...base, mail: { status: "unresolved", why: "Q-12.3" } }).can_mail).toBe(false);
  });
});

describe("§6.8 the re-verification radar tightens to restrictive on lapse", () => {
  it("on and after reverifyBy, WI's policy is restrictive and its ingest is refused with zero requests", async () => {
    const lapsed = statewideSource("WI", LAPSED)!;
    expect(lapsed.policy).toEqual({ can_display: false, can_export: false, can_mail: false, can_resell: false, can_cache: false, attribution_required: true });
    expect(statewideIngestAdmission("WI", LAPSED).reasons.join(" ")).toMatch(/re-verification lapsed on 2027-06-30/);
    // The recorded findings are kept — only a person re-reading moves the date.
    expect(lapsed.recordedDossier.useClasses.internal.status).toBe("allowed");

    const spec = buildSpecFor("WI");
    const { urls, deps } = recordingLayer(spec);
    await expect(build(spec, deps, { now: LAPSED })).rejects.toBeInstanceOf(IngestRefusedError);
    expect(urls).toEqual([]);
  });

  it("the day before the date the dossier stands; a re-verification fixture (new reverifyBy) restores ingest", async () => {
    expect(statewideIngestAdmission("WI", new Date("2027-06-29T23:59:59Z")).admitted).toBe(true);
    const reverified: SourceDossier = { ...statewideSource("WI", TODAY)!.recordedDossier, reverifyBy: "2028-06-30" };
    const entry: StatewideSourceEntry = { ...statewideSource("WI", LAPSED)!, recordedDossier: reverified, dossier: effectiveDossier(reverified, LAPSED), policy: policyFromDossier(effectiveDossier(reverified, LAPSED)) };
    expect(statewideIngestAdmission("WI", LAPSED, entry).admitted).toBe(true);
    const spec = buildSpecFor("WI");
    const { urls, deps } = recordingLayer(spec);
    const report = await build(spec, deps, { now: LAPSED, sourceEntry: entry });
    expect(report.summary.normalized).toBe(4);
    expect(urls.length).toBeGreaterThan(0);
  });

  it("an unparseable reverifyBy cannot vouch for anything: lapsed", () => {
    const d = { ...statewideSource("WI", TODAY)!.recordedDossier, reverifyBy: "someday" };
    expect(ingestAdmission("WI", d, TODAY).admitted).toBe(false);
  });
});

describe("§6.3 WI published suppression is stored as published, flagged, never backfilled", () => {
  it('a "NOT AVAILABLE" owner is kept literally in the record AND the artifact, with suppressedUpstream provenance', async () => {
    const spec = buildSpecFor("WI");
    expect(spec.suppression?.values).toEqual(["NOT AVAILABLE"]);
    const { deps } = recordingLayer(spec, { count: 4, owner: (oid) => (oid % 2 === 0 ? "NOT AVAILABLE" : `SYNTHETIC OWNER ${oid}`) });
    const report = await build(spec, deps);
    const { rows } = await readGeoParquetRows<Record<string, unknown> & { geometry: never }>(report.artifacts.parquet.localPath);
    const byId = new Map(rows.map((r) => [r.source_parcel_id as string, r]));
    for (const oid of [2, 4]) {
      const r = byId.get(`SYN-${oid}`)!;
      expect(r.owner_name).toBe("NOT AVAILABLE");
      expect(JSON.parse(r.provenance_json as string).ownership.suppressedUpstream).toBe(true);
    }
    for (const oid of [1, 3]) {
      const r = byId.get(`SYN-${oid}`)!;
      expect(r.owner_name).toBe(`SYNTHETIC OWNER ${oid}`);
      expect(JSON.parse(r.provenance_json as string).ownership.suppressedUpstream).toBeUndefined();
    }
  });

  it("normalization has no second input: the record is a function of the one published feature (no backfill path)", () => {
    const spec = buildSpecFor("WI");
    expect(normalizeFeature.length).toBe(3);
    const rec = normalizeFeature(spec, { attributes: { PARCELID: "P1", OWNERNME1: "NOT AVAILABLE" }, geometry: square(-89, 43) }, { asOf: null, county: "KENOSHA" })!;
    expect(rec.ownership.ownerName).toBe("NOT AVAILABLE");
    expect(rec.provenance.ownership.suppressedUpstream).toBe(true);
    expect(rec.provenance.ownership.confidenceBasis).toMatch(/never backfilled/);
  });
});

describe("§6.4 count reconciliation: rows in = stored + rejected-with-reason = the publisher's figure", () => {
  const report = (fetched: number, stored: number, noId: number, noGeom: number) => ({
    summary: { fetched, skippedNoId: noId, skippedNoGeometry: noGeom } as never,
    artifacts: { rowsWritten: stored },
  });

  it("reconciled only when every row is accounted for AND matches the publisher", () => {
    expect(reconcileCountyBuild(report(10, 8, 1, 1), { count: 10, source: "s" }).status).toBe("reconciled");
  });

  it("a row lost inside the build is an unexplained delta", () => {
    const r = reconcileCountyBuild(report(10, 7, 1, 1), { count: 10, source: "s" });
    expect(r.status).toBe("unexplained_delta");
    expect(r.notes.join(" ")).toMatch(/rows lost inside the build/);
  });

  it("a publisher/fetch difference is an unexplained delta with the Δ named", () => {
    const r = reconcileCountyBuild(report(9, 9, 0, 0), { count: 10, source: "s" });
    expect(r).toMatchObject({ status: "unexplained_delta", sourceSideDelta: 1 });
  });

  it("no publisher figure is reported as such — never reconciled against our own fetch", () => {
    const r = reconcileCountyBuild(report(10, 10, 0, 0), null);
    expect(r.status).toBe("no_publisher_figure");
  });

  it("the live build's counters feed it: a WI fixture build reconciles to its own layer count", async () => {
    const spec = buildSpecFor("WI");
    const { deps } = recordingLayer(spec, { count: 7 });
    const rep = await build(spec, deps);
    expect(reconcileCountyBuild(rep, { count: 7, source: "fixture" }).status).toBe("reconciled");
  });
});

describe("§6.1 the ingest JOB refuses too — named, in the run's observation, zero requests", () => {
  for (const st of ["FL", "AR", "NC", "MT"]) {
    it(`${st}: the registered ETL handler throws IngestRefusedError and records statewide_ingest_refused`, async () => {
      const { registerReferenceEtlHandlers } = await import("../../server/services/etlHandlers");
      const { getEtlHandler } = await import("../../server/services/etlOrchestrator");
      registerReferenceEtlHandlers();
      const h = getEtlHandler(`${st.toLowerCase()}_statewide_cadastral_v1`)!;
      expect(h, st).toBeDefined();
      fetchGeoCalls.urls.length = 0;
      const runState: Record<string, unknown> = {};
      const gen = h.fetch({ config: { countyField: "CONAME", countyValue: "X" }, runState } as never);
      await expect(gen.next()).rejects.toBeInstanceOf(IngestRefusedError);
      expect(runState.failureObservation).toMatchObject({ kind: "statewide_ingest_refused", state: st, fetches: 0 });
      expect(fetchGeoCalls.urls).toEqual([]);
    });
  }
});

describe("the admission rule's population: every production fetch path of a statewide bulk build passes it", () => {
  const SERVER = path.join(__dirname, "../../server");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
    }
  };
  walk(SERVER);

  it("streamCounty (the paging loop, which has no admission check of its own) is called in production ONLY by buildCounty", () => {
    expect(files.length, "vacuity: the server population was read").toBeGreaterThan(500);
    const callers = files.filter((f) => /\bstreamCounty\s*\(/.test(stripComments(readFileSync(f, "utf8")))).map((f) => path.relative(SERVER, f));
    expect(callers).toEqual(["services/landData/statewideCadastral.ts"]);
    const src = stripComments(readFileSync(path.join(SERVER, "services/landData/statewideCadastral.ts"), "utf8"));
    const body = src.slice(src.indexOf("export async function buildCounty"));
    // Admission is decided before the stream starts inside buildCounty.
    expect(body.indexOf("statewideIngestAdmission(")).toBeGreaterThan(-1);
    expect(body.indexOf("statewideIngestAdmission(")).toBeLessThan(body.indexOf("streamCounty("));
    // The only other definition-site call is streamCounty's own declaration.
    expect(src.match(/\bstreamCounty\s*\(/g)!.length).toBe(2);
  });

  it("§5 owner fields: release/build parquet is read in production only by lineage (ids + geometry) and assembly (re-pack to the bucket) — no serving reader", () => {
    const readers = files.filter((f) => /\breadGeoParquetRows\s*[<(]/.test(stripComments(readFileSync(f, "utf8")))).map((f) => path.relative(SERVER, f)).sort();
    // A new reader here is the first surface that could serve WI owner names
    // from first-party data: spec §5 requires the purpose ledger to cover it
    // first. Add it only with that surface ledgered.
    expect(readers).toEqual(["services/landData/geoParquet.ts", "services/landData/releases/releaseAssembly.ts", "services/landData/releases/releaseLineage.ts"]);
  });
});

describe("audit follow-ups", () => {
  it("an allowed internal finding with NO reverifyBy is not admitted (a resolved dossier must carry its date)", () => {
    const d = { ...statewideSource("WI", TODAY)!.recordedDossier, reverifyBy: null };
    expect(ingestAdmission("WI", d, TODAY)).toMatchObject({ admitted: false });
    expect(ingestAdmission("WI", d, TODAY).reasons.join(" ")).toMatch(/no reverifyBy/);
  });

  it("internal admitted, display UNRESOLVED (an AR-like state): owner names are withheld from the artifact", async () => {
    const spec = buildSpecFor("AR");
    const d: SourceDossier = {
      termsUrl: "https://example.invalid/terms",
      termsReadOn: "2026-11-03",
      useClasses: {
        internal: { status: "allowed", evidence: "synthetic", readOn: "2026-11-03" },
        display: { status: "unresolved", why: "synthetic: display unresolved" },
        redistribution: { status: "unresolved", why: "x" },
        resale: { status: "unresolved", why: "x" },
      },
      attributionRequired: null,
      restrictions: [],
      reverifyBy: "2099-01-01",
    };
    const entry: StatewideSourceEntry = { ...statewideSource("AR", TODAY)!, recordedDossier: d, dossier: d, policy: policyFromDossier(d) };
    const { deps } = recordingLayer(spec, { count: 3 });
    const report = await buildCounty(spec, { countyField: "CONAME", countyValue: "FIXTURE" }, { ...deps, outDir: outDir(), bucketConfigured: false, today: "2026-11-03", now: TODAY, sourceEntry: entry });
    expect(report.gate.ownerNamesAllowed).toBe(false);
    const { rows } = await readGeoParquetRows<Record<string, unknown> & { geometry: never }>(report.artifacts.parquet.localPath);
    for (const r of rows) expect(r.owner_name).toBeUndefined();
  });
});
