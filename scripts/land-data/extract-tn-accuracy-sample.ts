/**
 * Build the W2 accuracy-gate fixture: a small, labelled sample of REAL
 * Tennessee parcels with (a) the context layers clipped around each one and
 * (b) labels established by INDEPENDENT checks against the source layers.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/land-data/extract-tn-accuracy-sample.ts \
 *     --out tests/fixtures/land-data/tn-accuracy-sample.json
 *
 * Independence: the fact engine computes on clipped GeoJSON in a local
 * projection (server/services/landData). The labels come from a different
 * computation — the publishing ArcGIS servers' own spatial operators
 * (`geometry=<parcel>&distance=<m>&units=esriSRUnit_Meter`) and the USGS
 * Elevation Point Query Service — so a geometry bug in our engine cannot
 * agree with itself.
 *
 * Terms: the parcels come from the TNMap "Property Boundaries Public Use"
 * service, which the state marks not intended for commercial use. This
 * script takes a small verification sample only (no owner names, no
 * addresses) and nothing from it is served; the showcase build ingests the
 * Comptroller's per-county download, whose terms permit commercial use.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  LAND_CONTEXT_SOURCES,
  fetchArcgisBbox,
  loadParcelContext,
  type Bbox,
} from "../../server/services/providers/land-context-sources";
import { readThreeDepWindows, elevationAt } from "../../server/services/landData/dem";
import { areaBbox, areaCentroid, type AreaGeometry } from "../../server/services/landData/geometry";
import { computeParcelFacts } from "../../server/services/landData/computeParcelFacts";
import { fetchGeo } from "../../server/services/providers/fetchGeo";
import { TN_PUBLIC_PARCEL_SERVICE } from "../../server/services/landData/tnParcelSources";

const args = process.argv.slice(2);
const outPath = args[args.indexOf("--out") + 1] || "tests/fixtures/land-data/tn-accuracy-sample.json";
// Sample area: rural DeKalb County, TN, between Smithville and Edgar Evins
// State Park (Center Hill Lake) — mixed road, lake, flood and public-land edges.
const SAMPLE_BBOX: Bbox = [-85.905, 35.99, -85.83, 36.04];
const SAMPLE_SIZE = 20;
const PADUS_POSITIVES = 4;
const FLOOD_POSITIVES = 4;
const NO_ROAD_POSITIVES = 4;

const today = new Date().toISOString().slice(0, 10);

async function postQuery(layerUrl: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams({ f: "json", ...params });
  const res = await fetchGeo(`${layerUrl}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    timeoutMs: 60_000,
    ratePerSec: 2,
  });
  if (!res.ok) throw new Error(`${layerUrl} HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`${layerUrl}: ${JSON.stringify(j.error)}`);
  return j;
}

function esriPolygon(g: AreaGeometry): string {
  const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  return JSON.stringify({ rings, spatialReference: { wkid: 4326 } });
}

async function countWithin(layerUrl: string, g: AreaGeometry, meters: number, where = "1=1"): Promise<number> {
  const j = await postQuery(layerUrl, {
    where,
    geometry: esriPolygon(g),
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    ...(meters > 0 ? { distance: String(meters), units: "esriSRUnit_Meter" } : {}),
    returnCountOnly: "true",
  });
  return Number(j.count ?? 0);
}

/** Does any feature of the layer intersect the parcel (server-side test)? */
async function intersects(layerUrl: string, g: AreaGeometry, where = "1=1"): Promise<boolean> {
  return (await countWithin(layerUrl, g, 0, where)) > 0;
}

async function epqs(lng: number, lat: number): Promise<number | null> {
  const res = await fetchGeo(
    `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&units=Meters&includeDate=false`,
    { timeoutMs: 30_000, ratePerSec: 2 },
  );
  if (!res.ok) return null;
  const j = (await res.json()) as { value?: string | number };
  const v = Number(j.value);
  return Number.isFinite(v) && v > -1000 ? v : null;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function overlaps(b: number[], a: number[], pad: number): boolean {
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}

function featureBbox(geom: { type: string; coordinates: any }): number[] {
  const pts: number[][] = [];
  const walk = (c: any) => (typeof c[0] === "number" ? pts.push(c) : c.forEach(walk));
  walk(geom.coordinates);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ── Clipping (fixture size only) ─────────────────────────────────────────
// Context features are clipped to a box PAD around each parcel. Every fact
// tolerance (20 m frontage, 30 m adjacency) is far inside PAD, so clipping
// cannot change an answer — the gate test re-checks this by comparing the
// engine on the clipped context with the engine on the full context
// (engineAtExtraction below is computed on the FULL context).
type XY = number[];
function clipLine(line: XY[], b: number[]): XY[][] {
  const inBox = (p: XY) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
  const out: XY[][] = [];
  let cur: XY[] = [];
  for (let i = 0; i < line.length; i++) {
    const keep = inBox(line[i]) || (i > 0 && inBox(line[i - 1])) || (i + 1 < line.length && inBox(line[i + 1]));
    if (keep) cur.push(line[i]);
    else if (cur.length) { if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
function clipRing(ring: XY[], b: number[]): XY[] {
  // Sutherland–Hodgman against the four box edges.
  const edges: Array<[(p: XY) => boolean, (a: XY, c: XY) => XY]> = [
    [(p) => p[0] >= b[0], (a, c) => [b[0], a[1] + ((c[1] - a[1]) * (b[0] - a[0])) / (c[0] - a[0])]],
    [(p) => p[0] <= b[2], (a, c) => [b[2], a[1] + ((c[1] - a[1]) * (b[2] - a[0])) / (c[0] - a[0])]],
    [(p) => p[1] >= b[1], (a, c) => [a[0] + ((c[0] - a[0]) * (b[1] - a[1])) / (c[1] - a[1]), b[1]]],
    [(p) => p[1] <= b[3], (a, c) => [a[0] + ((c[0] - a[0]) * (b[3] - a[1])) / (c[1] - a[1]), b[3]]],
  ];
  let pts = ring.slice(0, ring.length - 1);
  for (const [inside, cut] of edges) {
    const next: XY[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) {
        if (!inside(prev)) next.push(cut(prev, cur));
        next.push(cur);
      } else if (inside(prev)) next.push(cut(prev, cur));
    }
    pts = next;
    if (pts.length === 0) break;
  }
  if (pts.length < 3) return [];
  const r6 = (p: XY) => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7];
  const outRing = pts.map(r6);
  outRing.push(outRing[0]);
  return outRing;
}
function clipArea(g: any, b: number[]): any | null {
  const polys: XY[][][] = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const out: XY[][][] = [];
  for (const poly of polys) {
    const outer = clipRing(poly[0], b);
    if (outer.length === 0) continue;
    const holes = poly.slice(1).map((h) => clipRing(h, b)).filter((h) => h.length > 0);
    out.push([outer, ...holes]);
  }
  if (out.length === 0) return null;
  return out.length === 1 ? { type: "Polygon", coordinates: out[0] } : { type: "MultiPolygon", coordinates: out };
}
function clipLines(g: any, b: number[]): any | null {
  const lines: XY[][] = g.type === "LineString" ? [g.coordinates] : g.coordinates;
  const out = lines.flatMap((l) => clipLine(l, b));
  if (out.length === 0) return null;
  return out.length === 1 ? { type: "LineString", coordinates: out[0] } : { type: "MultiLineString", coordinates: out };
}

async function main() {
  const svc = TN_PUBLIC_PARCEL_SERVICE;
  const parcels = await fetchArcgisBbox(
    {
      licenseSource: svc.licenseSource,
      layerUrl: svc.layerUrl,
      outFields: "PARCELID,GISLINK,DEEDAC,SUBDIV,LOT,COUNTY_NAME",
      pageSize: 1000,
      searchPadDeg: 0,
      where: "DEEDAC >= 2",
    },
    SAMPLE_BBOX,
  );
  const inside = parcels.filter((p) => {
    if (!p.geometry || (p.geometry.type !== "Polygon" && p.geometry.type !== "MultiPolygon")) return false;
    const b = featureBbox(p.geometry as any);
    return b[0] >= SAMPLE_BBOX[0] && b[2] <= SAMPLE_BBOX[2] && b[1] >= SAMPLE_BBOX[1] && b[3] <= SAMPLE_BBOX[3];
  });
  console.log(`candidates fully inside the sample box: ${inside.length}`);

  // Deterministic, attribute-blind order (hash of the parcel id).
  inside.sort((a, b) => hash(String(a.properties?.GISLINK)) - hash(String(b.properties?.GISLINK)));

  // Strata, so every binary check sees both answers (a sample with no flood
  // parcel would "verify" flood acres vacuously). Each stratum is filled in
  // hash order from the server's own answer, then the rest in hash order.
  const S0 = LAND_CONTEXT_SOURCES;
  const roadsWhere0 = "MTFCC IN ('S1200','S1400','S1640')";
  const strata: Array<{ name: string; want: number; test: (g: any) => Promise<boolean> }> = [
    { name: "public land within 30 m", want: PADUS_POSITIVES, test: async (g) => (await countWithin(S0.publicLands.layerUrl, g, 30, S0.publicLands.where)) > 0 },
    { name: "1% flood zone intersects", want: FLOOD_POSITIVES, test: async (g) => intersects(S0.floodZones.layerUrl, g, S0.floodZones.where) },
    {
      name: "no access road within 20 m",
      want: NO_ROAD_POSITIVES,
      test: async (g) =>
        (await countWithin(S0.roadsSecondary.layerUrl, g, 20, roadsWhere0)) + (await countWithin(S0.roadsLocal.layerUrl, g, 20, roadsWhere0)) === 0,
    },
  ];
  const chosen: typeof inside = [];
  for (const st of strata) {
    let got = 0;
    for (const p of inside) {
      if (got >= st.want) break;
      if (chosen.includes(p)) continue;
      if (await st.test(p.geometry as any)) { chosen.push(p); got++; }
    }
    console.log(`stratum "${st.name}": ${got} of ${st.want}`);
  }
  for (const p of inside) {
    if (chosen.length >= SAMPLE_SIZE) break;
    if (!chosen.includes(p)) chosen.push(p);
  }

  const ctxBbox = SAMPLE_BBOX;
  const ctx = await loadParcelContext(ctxBbox, today, {
    onLayerError: (layer, err) => console.error(`layer ${layer} failed:`, err),
  });
  const dem = await readThreeDepWindows(ctxBbox);

  const S = LAND_CONTEXT_SOURCES;
  const out: any = {
    meta: {
      state: "TN",
      county: "DeKalb",
      extractedOn: today,
      sampleBbox: SAMPLE_BBOX,
      selection: `Parcels with DEEDAC >= 2 lying fully inside the sample box, ordered by an FNV-1a hash of GISLINK. Strata filled in that order from the servers' own answers: ${PADUS_POSITIVES} within 30 m of PAD-US public land, ${FLOOD_POSITIVES} intersecting a 1% flood zone, ${NO_ROAD_POSITIVES} with no access road within 20 m; then the rest in hash order, ${SAMPLE_SIZE} in all.`,
      parcelSource: {
        name: svc.licenseSource,
        url: svc.layerUrl,
        note: "Verification sample only — the service is marked not for commercial use; no owner names or addresses are kept.",
      },
      layers: {
        roads: ctx.roads?.source ?? null,
        wetlands: ctx.wetlands?.source ?? null,
        flood: ctx.flood?.source ?? null,
        publicLands: ctx.publicLands?.source ?? null,
        towns: ctx.towns?.source ?? null,
        slope: ctx.slope?.source ?? null,
      },
      labelMethod:
        "Labels are the publishing servers' own spatial answers (ArcGIS query with the parcel polygon and a metre buffer) and USGS EPQS elevations — computed independently of the fact engine.",
    },
    parcels: [] as any[],
  };

  for (const p of chosen) {
    const g = p.geometry as unknown as AreaGeometry;
    const id = String(p.properties?.GISLINK);
    const b = areaBbox(g);
    const near = (feat: { geometry: any }, padDeg: number) => overlaps(featureBbox(feat.geometry), b, padDeg);
    const PAD = 0.002; // ~200 m — far beyond every fact tolerance
    const facts = computeParcelFacts(
      { parcelKey: id, state: "TN", county: "DeKalb", sourceParcelId: String(p.properties?.PARCELID), geometry: g },
      ctx,
    );
    const townsByDist = (ctx.towns?.features ?? []).slice();
    const nearestTown = facts.distance_to_town_km.status === "computed" ? facts.distance_to_town_km.value : null;
    const c = areaCentroid(g);
    const demWindows = dem
      .map((grid) => {
        const pad = 0.0006;
        const c0 = Math.max(0, Math.floor((b[0] - pad - grid.west) / grid.resLng));
        const c1 = Math.min(grid.width, Math.ceil((b[2] + pad - grid.west) / grid.resLng));
        const r0 = Math.max(0, Math.floor((grid.north - (b[3] + pad)) / grid.resLat));
        const r1 = Math.min(grid.height, Math.ceil((grid.north - (b[1] - pad)) / grid.resLat));
        if (c1 <= c0 || r1 <= r0) return null;
        const w = c1 - c0, h = r1 - r0;
        const data = new Float32Array(w * h);
        for (let r = 0; r < h; r++) for (let cc = 0; cc < w; cc++) data[r * w + cc] = grid.data[(r0 + r) * grid.width + (c0 + cc)];
        return {
          width: w, height: h,
          west: grid.west + c0 * grid.resLng, north: grid.north - r0 * grid.resLat,
          resLng: grid.resLng, resLat: grid.resLat, noData: grid.noData,
          dataB64: Buffer.from(data.buffer).toString("base64"),
        };
      })
      .filter(Boolean);

    // Independent labels.
    const roadsWhere = "MTFCC IN ('S1200','S1400','S1640')";
    const roadWithin20 =
      (await countWithin(S.roadsSecondary.layerUrl, g, 20, roadsWhere)) +
      (await countWithin(S.roadsLocal.layerUrl, g, 20, roadsWhere));
    const padusWithin30 = await countWithin(S.publicLands.layerUrl, g, 30, S.publicLands.where);
    const sfha = await intersects(S.floodZones.layerUrl, g, S.floodZones.where);
    const firm = await intersects(S.firmPanels.layerUrl, g);
    const nwi = await intersects(S.wetlands.layerUrl, g);
    let townCheck: any = null;
    if (nearestTown) {
      const km = nearestTown.km;
      const outer = await countWithin(S.towns.layerUrl, g, Math.round(km * 1000 + 100));
      const innerM = Math.max(0, Math.round(km * 1000 - 100));
      const inner = innerM > 0 ? await countWithin(S.towns.layerUrl, g, innerM) : null;
      townCheck = { engineKm: km, placesWithinEnginePlus100m: outer, placesWithinEngineMinus100m: inner };
    }
    const elevEpqs = await epqs(c[0], c[1]);
    // Independent slope at the centroid: central differences of four EPQS
    // elevations 15 m east/west/north/south (EPQS serves the best available
    // 3DEP resolution, often 1 m lidar — not the 10 m COG the engine reads).
    const H = 15;
    const dLng = H / (111_320 * Math.cos((c[1] * Math.PI) / 180));
    const dLat = H / 110_574;
    const [eE, eW, eN, eS] = [
      await epqs(c[0] + dLng, c[1]), await epqs(c[0] - dLng, c[1]),
      await epqs(c[0], c[1] + dLat), await epqs(c[0], c[1] - dLat),
    ];
    const epqsSlopePct =
      eE !== null && eW !== null && eN !== null && eS !== null
        ? Math.round(100 * Math.hypot((eE - eW) / (2 * H), (eN - eS) / (2 * H)) * 10) / 10
        : null;
    const elevDem = (() => {
      for (const grid of dem) {
        const v = elevationAt(grid, c[0], c[1]);
        if (v !== null) return v;
      }
      return null;
    })();

    out.parcels.push({
      parcelKey: `TN-47041-${id}`,
      sourceParcelId: String(p.properties?.PARCELID),
      gisLink: id,
      county: "DeKalb",
      deededAcres: p.properties?.DEEDAC ?? null,
      subdivision: String(p.properties?.SUBDIV ?? "").trim() || null,
      lot: String(p.properties?.LOT ?? "").trim() || null,
      geometry: g,
      context: (() => {
        const box = [b[0] - PAD, b[1] - PAD, b[2] + PAD, b[3] + PAD];
        const areas = <T extends { geometry: any }>(fs: T[], keep: (f: T) => Record<string, unknown>) =>
          fs.filter((f) => near(f, PAD)).map((f) => ({ ...keep(f), geometry: clipArea(f.geometry, box) })).filter((f) => f.geometry);
        return {
          roads: (ctx.roads?.features ?? [])
            .filter((f) => near(f, PAD))
            .map((f) => ({ mtfcc: f.mtfcc, geometry: clipLines(f.geometry, box) }))
            .filter((f) => f.geometry),
          wetlands: areas(ctx.wetlands?.features ?? [], () => ({})),
          flood: {
            firmCovered: ctx.flood?.firmCovered ?? false,
            features: areas(ctx.flood?.features ?? [], (f) => ({ sfha: f.sfha, zone: f.zone })),
          },
          publicLands: areas(ctx.publicLands?.features ?? [], (f) => ({ name: f.name, manager: f.manager })),
          towns: townsByDist.filter((t) => nearestTown && t.name === nearestTown.town).map((t) => ({ name: t.name, geometry: t.geometry })),
          dem: demWindows,
        };
      })(),
      labels: {
        accessRoadWithin20m: roadWithin20 > 0,
        publicLandWithin30m: padusWithin30 > 0,
        sfhaIntersects: sfha,
        firmPanelCovers: firm,
        nwiIntersects: nwi,
        town: townCheck,
        centroidElevation: { epqsM: elevEpqs, demM: elevDem },
        centroidSlope: { epqsPct: epqsSlopePct, method: "EPQS central difference, 15 m" },
      },
      engineAtExtraction: Object.fromEntries(Object.entries(facts).map(([k, f]) => [k, f.status === "computed" ? f.value : null])),
    });
    console.log(id, JSON.stringify(out.parcels.at(-1).labels), JSON.stringify(out.parcels.at(-1).engineAtExtraction));
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out) + "\n");
  console.log(`wrote ${out.parcels.length} parcels → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
