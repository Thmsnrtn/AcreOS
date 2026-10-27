/**
 * D2a acceptance gate — a large-county build under a 512 MB cap.
 *
 * Runs the PRODUCTION build (buildCounty, the streamed page → normalize →
 * write → release path) against a synthetic ArcGIS layer that generates each
 * page on demand, so the only thing that can hold the county is the code under
 * test. Default: 400,000 parcels of 24-vertex polygons at suburban density —
 * roughly eight Nassau Counties and larger than all but a handful of US
 * counties.
 *
 *   npx tsx scripts/d2-bounded-memory-gate.ts                   # runs the gate (parent)
 *   npx tsx scripts/d2-bounded-memory-gate.ts --parcels 100000
 *
 * The parent re-launches itself as a child with --max-old-space-size=448 (V8
 * cannot grow the heap past it) and reads the child's kernel peak RSS
 * (VmHWM in /proc/self/status, which counts every byte the process ever held
 * resident, not a sample). PASS = the build completed AND VmHWM < 512 MB.
 * Exit status: 0 pass, 1 fail. The verdict line is printed either way.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CAP_MB = 512;
const HEAP_MB = 448;

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}

function vmHwmMb(): number {
  const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
  return m ? Math.round(Number(m[1]) / 1024) : -1;
}

async function child(parcels: number): Promise<void> {
  const { buildCounty, buildSpecFor } = await import("../server/services/landData/statewideCadastral");
  const spec = buildSpecFor("NC");
  const mapped = Object.values(spec.mapping).filter((f): f is string => !!f);
  const m = spec.mapping;
  const SPACING = 0.0004; // ~40 m lots: dense suburban fabric
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
  const dir = mkdtempSync(path.join(os.tmpdir(), "d2-gate-"));
  const t0 = Date.now();
  try {
    const report = await buildCounty(
      spec,
      { countyField: "CNTY", countyValue: "GATE" },
      {
        outDir: dir,
        bucketConfigured: false,
        today: "2026-10-24",
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
                [m.apn as string]: `GATE-${oid}`,
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
        parcels: report.summary.normalized,
        pages: report.summary.pages,
        rowsReadBack: report.artifacts.rowsReadBack,
        tiles: report.artifacts.tileCount,
        partitions: report.artifacts.partitions,
        maxPartitionFeatures: report.artifacts.maxPartitionFeatures,
        parquetMb: Math.round(report.artifacts.parquet.bytes / 1048576),
        pmtilesMb: Math.round(report.artifacts.pmtiles.bytes / 1048576),
        peakRssSampledMb: report.summary.peakRssMb,
        vmHwmMb: vmHwmMb(),
        seconds: Math.round((Date.now() - t0) / 1000),
      })}\n`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parent(parcels: number): void {
  const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, ...process.execArgv, process.argv[1], "--child", "--parcels", String(parcels)], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const line = (r.stdout ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
  const result = line ? JSON.parse(line) : null;
  const pass = r.status === 0 && result?.ok === true && result.vmHwmMb > 0 && result.vmHwmMb < CAP_MB && result.rowsReadBack === parcels;
  process.stdout.write(`${JSON.stringify({ gate: "d2a-bounded-memory", capMb: CAP_MB, heapLimitMb: HEAP_MB, parcels, childExit: r.status, signal: r.signal, result, stderrTail: (r.stderr ?? "").slice(-1500) || null }, null, 2)}\n`);
  process.stdout.write(`[d2a-bounded-memory] ${pass ? "PASS" : "FAIL"} — ${result ? `${result.parcels} parcels, kernel peak RSS ${result.vmHwmMb} MB (cap ${CAP_MB})` : "the build did not complete"}\n`);
  process.exit(pass ? 0 : 1);
}

const parcels = arg("--parcels", 400_000);
if (process.argv.includes("--child")) {
  child(parcels).catch((e) => {
    process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
    process.exit(2);
  });
} else {
  parent(parcels);
}
