/**
 * D2a acceptance gate, Tennessee — the Comptroller county build under a 512 MB cap.
 *
 * Runs the PRODUCTION TN build (buildTnCounty: paged read → GISLINK-bucket
 * spill → join → cell spill → per-cell facts, batched persistence and
 * streamed artifacts) against a SYNTHETIC source that generates each page on
 * demand, so the only thing that can hold the county is the code under test.
 * Default: 400,000 parcels of 24-vertex polygons (~40 m lots) plus a
 * 400,000-record assessment roll — larger than any Comptroller-maintained
 * Tennessee county.
 *
 * SYNTHETIC DATA, LABELLED: ids are SYNTHETIC-n, the label says so, the store
 * is an in-memory counter (no database), no bucket is configured, and the
 * output directory is deleted. The source declares kind "comptroller" ONLY so
 * the batched-persistence path — the one the production run takes — is
 * inside the measurement.
 *
 *   npx tsx scripts/d2-tn-memory-gate.ts                      # build + both mutants
 *   npx tsx scripts/d2-tn-memory-gate.ts --parcels 100000
 *   npx tsx scripts/d2-tn-memory-gate.ts --only build         # or: --only mutant-source | mutant-store
 *
 * Each case runs as a child with --max-old-space-size=448 (V8 cannot grow the
 * heap past it); the child reports its kernel peak RSS (VmHWM — every byte it
 * ever held resident, not a sample).
 *   build          PASS = completed, every row read back, VmHWM < 512 MB.
 *   mutant-source  holds the whole county before yielding it (the pre-D2a
 *                  loader's readFileSync + parcels[] shape). PASS = it does NOT
 *                  complete under the cap.
 *   mutant-store   persists by accumulating every parcel (the pre-D2a owned[]
 *                  → one persistLoadedCounty call). PASS = it does NOT complete.
 *   statewide-build        the statewide buildCounty (NC spec, synthetic layer, parcel
 *                          ids scrambled against OBJECTID) through the bounded
 *                          external sort by source_parcel_id. PASS = completed,
 *                          every row read back, VmHWM < 512 MB.
 *   statewide-sort-mutant  the same with sortRunChars = Infinity — one run, i.e. an
 *                          in-memory sort of the whole county. PASS = it does NOT complete.
 * A mutant that completes means the gate cannot see accumulation — FAIL.
 * Exit status: 0 when every case run passes, 1 otherwise.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CAP_MB = 512;
const HEAP_MB = 448;
type Case = "build" | "mutant-source" | "mutant-store" | "statewide-build" | "statewide-sort-mutant";
const CASES: readonly Case[] = ["build", "mutant-source", "mutant-store", "statewide-build", "statewide-sort-mutant"];

function argNum(name: string, dflt: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}
function argStr(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function vmHwmMb(): number {
  const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
  return m ? Math.round(Number(m[1]) / 1024) : -1;
}

/** The statewide template under the sort: a synthetic NC layer generated page by page. */
async function statewideChild(parcels: number, which: Case): Promise<void> {
  const { buildCounty, buildSpecFor } = await import("../server/services/landData/statewideCadastral");
  const spec = buildSpecFor("NC");
  const mapped = Object.values(spec.mapping).filter((f): f is string => !!f);
  const m = spec.mapping;
  const SPACING = 0.0004;
  const PER_ROW = 1000;
  const polygon = (oid: number) => {
    const x0 = -79.0 + (oid % PER_ROW) * SPACING;
    const y0 = 35.5 + Math.floor(oid / PER_ROW) * SPACING;
    const r = SPACING * 0.45;
    const ring: number[][] = [];
    for (let k = 0; k < 24; k++) ring.push([x0 + r + r * Math.cos((k / 24) * 2 * Math.PI), y0 + r + r * Math.sin((k / 24) * 2 * Math.PI)]);
    ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] };
  };
  // Parcel ids scrambled against OBJECTID, so the sort has real work to do.
  const idOf = (oid: number) => `SYNTHETIC-${String((oid * 2_654_435_761) % 4_294_967_291).padStart(10, "0")}`;
  const dir = mkdtempSync(path.join(os.tmpdir(), "d2-sw-gate-"));
  const t0 = Date.now();
  try {
    const report = await buildCounty(
      spec,
      { countyField: "CNTY", countyValue: "GATE" },
      {
        outDir: dir,
        bucketConfigured: false,
        today: "2026-10-24",
        sortRunChars: which === "statewide-sort-mutant" ? Infinity : undefined, // MUTANT: one in-memory run
        async getJson(url) {
          if (url.endsWith("?f=json")) {
            return { ok: true, status: 200, body: { objectIdField: "OBJECTID", fields: ["OBJECTID", "CNTY", ...mapped].map((name) => ({ name, type: name === "OBJECTID" ? "esriFieldTypeOID" : "esriFieldTypeString" })) } };
          }
          const q = new URLSearchParams(url.split("?")[1]);
          const after = Number(/OBJECTID > (\d+)/.exec(q.get("where") ?? "")?.[1] ?? 0);
          const n = Number(q.get("resultRecordCount") ?? 1000);
          const features = [];
          for (let oid = after + 1; oid <= Math.min(parcels, after + n); oid++) {
            features.push({
              geometry: polygon(oid),
              properties: {
                OBJECTID: oid,
                CNTY: "GATE",
                [m.apn as string]: idOf(oid),
                ...(m.owner ? { [m.owner]: `SYNTHETIC OWNER ${oid}` } : {}),
                ...(m.address ? { [m.address]: `${oid} SYNTHETIC RD` } : {}),
                ...(m.assessedValue ? { [m.assessedValue]: 1000 + oid } : {}),
                ...(m.legalDescription ? { [m.legalDescription]: `SYNTHETIC LOT ${oid} OF THE GATE SUBDIVISION` } : {}),
              },
            });
          }
          return { ok: true, status: 200, body: { features } };
        },
      },
    );
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        case: which,
        parcelsIn: report.summary.normalized,
        stored: report.summary.normalized,
        written: report.artifacts.rowsWritten,
        rowsReadBack: report.artifacts.rowsReadBack,
        tiles: report.artifacts.tileCount,
        parquetMb: Math.round(report.artifacts.parquet.bytes / 1048576),
        peakRssSampledMb: report.summary.peakRssMb,
        vmHwmMb: vmHwmMb(),
        seconds: Math.round((Date.now() - t0) / 1000),
      })}\n`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function child(parcels: number, which: Case): Promise<void> {
  if (which === "statewide-build" || which === "statewide-sort-mutant") return statewideChild(parcels, which);
  const { buildTnCounty } = await import("../server/services/landData/tnComptrollerCounty");
  type Src = import("../server/services/landData/tnComptrollerCounty").TnParcelSource;
  type Parcel = import("../server/services/landData/tnComptrollerCounty").TnSourceParcel;
  type Owned = import("../server/services/landData/ownedParcelStore").OwnedParcelInput;
  const SPACING = 0.0004;
  const PER_ROW = 1000;
  const polygon = (i: number): Parcel["geometry"] => {
    const x0 = -86.6 + (i % PER_ROW) * SPACING;
    const y0 = 36.3 + Math.floor(i / PER_ROW) * SPACING;
    const r = SPACING * 0.45;
    const ring: Array<[number, number]> = [];
    for (let k = 0; k < 24; k++) ring.push([x0 + r + r * Math.cos((k / 24) * 2 * Math.PI), y0 + r + r * Math.sin((k / 24) * 2 * Math.PI)]);
    ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] };
  };
  const PAGE = 1000;
  async function* generatedParcels(): AsyncIterable<Parcel[]> {
    for (let a = 0; a < parcels; a += PAGE) {
      const page: Parcel[] = [];
      for (let i = a; i < Math.min(parcels, a + PAGE); i++) {
        page.push({ gisLink: `SYNTHETIC-${i}`, sourceParcelId: `SYNTHETIC-${i}`, county: "Sumner", geometry: polygon(i), deededAcres: 0.4, subdivision: `SYNTHETIC SUBDIVISION ${i % 50}`, lot: String(i % 200) });
      }
      yield page;
    }
  }
  const source: Src = {
    kind: "comptroller",
    label: "SYNTHETIC gate source — generated parcels, never real Comptroller data",
    sourceName: "SYNTHETIC gate source",
    rollSource: { name: "SYNTHETIC gate roll", url: "https://example.invalid/synthetic", retrievedOn: "2026-10-24", sourceAsOf: null },
    skipped: () => ({ deleted: 0, nullShape: 0, noGisLink: 0 }),
    parcelPages:
      which === "mutant-source"
        ? async function* () {
            const all: Parcel[] = []; // MUTANT: the whole county, held
            for await (const p of generatedParcels()) all.push(...p);
            for (let a = 0; a < all.length; a += PAGE) yield all.slice(a, a + PAGE);
          }
        : generatedParcels,
    async *rollPages() {
      for (let a = 0; a < parcels; a += PAGE) {
        const page = [];
        for (let i = a; i < Math.min(parcels, a + PAGE); i++) page.push({ gisLink: `SYNTHETIC-${i}`, mailingState: i % 7 === 0 ? "GA" : "TN", improvementValue: i % 3 === 0 ? 0 : 75_000 });
        yield page;
      }
    },
  };
  const held: Owned[] = [];
  let counted = 0;
  const dir = mkdtempSync(path.join(os.tmpdir(), "d2-tn-gate-"));
  const t0 = Date.now();
  try {
    const r = await buildTnCounty({ fips: "47165", county: "Sumner" }, source, {
      outDir: dir,
      today: "2026-10-24",
      bucketConfigured: false,
      loadContext: async () => ({ roads: null, wetlands: null, flood: null, publicLands: null, transmission: null, towns: null, slope: null }),
      store: {
        async saveBatch(ps) {
          if (which === "mutant-store") held.push(...ps); // MUTANT: the whole county, held
          counted += ps.length;
          return ps.length;
        },
        async complete() {
          return { receiptsRecorded: 0 };
        },
      },
    });
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        case: which,
        parcelsIn: r.parcelsIn,
        joined: r.joined,
        cells: r.cells,
        stored: counted,
        written: r.written,
        rowsReadBack: r.geoparquet.rowsReadBack,
        tiles: r.pmtiles.tiles,
        partitions: r.pmtiles.partitions,
        parquetMb: Math.round(r.geoparquet.bytes / 1048576),
        pmtilesMb: Math.round(r.pmtiles.bytes / 1048576),
        peakRssSampledMb: r.peakRssMb,
        vmHwmMb: vmHwmMb(),
        heldByMutant: held.length,
        seconds: Math.round((Date.now() - t0) / 1000),
      })}\n`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface CaseResult {
  case: Case;
  pass: boolean;
  childExit: number | null;
  signal: string | null;
  result: { ok: boolean; vmHwmMb: number; parcelsIn: number; rowsReadBack: number; written: number; stored: number } | null;
  stderrTail: string | null;
}

function runCase(parcels: number, which: Case): CaseResult {
  const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, ...process.execArgv, process.argv[1], "--child", which, "--parcels", String(parcels)], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const line = (r.stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
  const result = line ? JSON.parse(line) : null;
  const completedUnderCap =
    r.status === 0 && result?.ok === true && result.vmHwmMb > 0 && result.vmHwmMb < CAP_MB && result.parcelsIn === parcels && result.stored === parcels && result.rowsReadBack === result.written;
  return {
    case: which,
    pass: which === "build" || which === "statewide-build" ? completedUnderCap : !completedUnderCap,
    childExit: r.status,
    signal: r.signal,
    result,
    stderrTail: (r.stderr ?? "").slice(-800) || null,
  };
}

function parent(parcels: number): void {
  const only = argStr("--only") as Case | undefined;
  if (only && !CASES.includes(only)) throw new Error(`--only must be one of ${CASES.join(", ")}`);
  const results = (only ? [only] : CASES).map((c) => runCase(parcels, c));
  process.stdout.write(`${JSON.stringify({ gate: "d2a-tn-bounded-memory", capMb: CAP_MB, heapLimitMb: HEAP_MB, parcels, results }, null, 2)}\n`);
  for (const r of results) {
    const what = r.result ? `completed, kernel peak RSS ${r.result.vmHwmMb} MB` : `did not complete (exit ${r.childExit}${r.signal ? `, ${r.signal}` : ""})`;
    process.stdout.write(`[d2a-tn-bounded-memory] ${r.case}: ${r.pass ? "PASS" : "FAIL"} — ${parcels} parcels, ${what} (cap ${CAP_MB})\n`);
  }
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

const parcels = argNum("--parcels", 400_000);
const childCase = argStr("--child") as Case | undefined;
if (childCase) {
  child(parcels, childCase).catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(2);
  });
} else {
  parent(parcels);
}
