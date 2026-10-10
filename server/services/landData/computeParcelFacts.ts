/**
 * computeParcelFacts — the W2 per-parcel fact engine (pure, no I/O).
 *
 * Inputs are a normalized parcel plus the context layers a loader fetched for
 * the parcel's neighbourhood (see server/services/providers/land-context-sources.ts).
 * A layer the loader could not obtain arrives as `null`, and every fact that
 * depends on it is returned `unavailable` with the reason — never defaulted.
 *
 * The same function runs in the on-demand county pipeline (worker), the
 * Tennessee showcase builder (scripts/land-data/build-tn-showcase.ts) and the
 * accuracy gate (tests/unit/landDataAccuracyGate.test.ts), so the gate measures
 * the code that ships.
 */

import {
  PARCEL_FACT_LABELS,
  unavailable,
  type AccessIndication,
  type ComputedFact,
  type FactSource,
  type ParcelFactKey,
  type ParcelFactSet,
  type UnavailableFact,
} from "@shared/landData/parcelFacts";
import {
  SQ_M_PER_ACRE,
  areaBbox,
  areaCentroid,
  areaSqM,
  areaToAreaDistance,
  bboxesOverlap,
  boundaryPieces,
  distToPolylinesXY,
  linesOf,
  localProjection,
  pointInProjectedArea,
  polylineEntersArea,
  projectArea,
  type AreaGeometry,
  type LineGeometry,
  type LocalProjection,
  type ProjectedArea,
} from "./geometry";

// ── Tunables (documented, test-pinned) ─────────────────────────────────────

/** A road centerline this close to the parcel line counts as touching it. */
export const FRONTAGE_TOLERANCE_M = 20;
/** Frontage shorter than this is treated as a corner touch, not access. */
export const MIN_ACCESS_FRONTAGE_M = 6;
/** Ground steeper than this (percent rise) is not counted as buildable. */
export const BUILDABLE_MAX_SLOPE_PCT = 15;
/** Public land within this distance of the parcel line counts as adjacent. */
export const PUBLIC_LAND_ADJACENCY_M = 30;
/** Cap on buildable-area sample points per parcel (memory/time bound). */
export const MAX_BUILDABLE_SAMPLES = 40_000;

/**
 * TIGER MTFCC road classes that give a parcel legal-access potential. S1100
 * (limited-access primary roads) is deliberately absent: abutting an
 * interstate does not give driveway rights. Private roads (S1740), 4WD
 * trails (S1500), alleys, walkways and parking lots do not either.
 */
export const ACCESS_ROAD_MTFCC: ReadonlySet<string> = new Set(["S1200", "S1400", "S1640"]);

// ── Input shapes ───────────────────────────────────────────────────────────

export interface ParcelInput {
  parcelKey: string;
  state: string;
  county: string;
  sourceParcelId: string;
  geometry: AreaGeometry;
  deededAcres?: number | null;
  /** Owner MAILING state from the assessor roll, when the source carries it. */
  ownerMailingState?: string | null;
  subdivision?: string | null;
  lot?: string | null;
}

export interface LayerOf<F> {
  source: FactSource;
  features: F[];
}

export interface RoadFeature { geometry: LineGeometry; mtfcc: string; name?: string | null }
export interface AreaFeature { geometry: AreaGeometry }
export interface FloodFeature { geometry: AreaGeometry; sfha: boolean; zone: string }
export interface PublicLandFeature { geometry: AreaGeometry; name: string; manager: string }
export interface TransmissionFeature { geometry: LineGeometry; voltClass: string | null }
export interface TownFeature { geometry: AreaGeometry; name: string }

/**
 * A slope sampler over a DEM window. Returns percent slope at a point, or
 * null outside the window / on a no-data cell.
 */
export interface SlopeSampler {
  source: FactSource;
  slopePctAt(lng: number, lat: number): number | null;
}

export interface ParcelContext {
  roads: LayerOf<RoadFeature> | null;
  wetlands: LayerOf<AreaFeature> | null;
  /**
   * Flood hazard polygons. `null` = the layer could not be read; an empty
   * feature list with `firmCovered: false` = the area has no digitized FIRM,
   * which is NOT the same as "not in a flood zone".
   */
  flood: (LayerOf<FloodFeature> & { firmCovered: boolean }) | null;
  publicLands: LayerOf<PublicLandFeature> | null;
  transmission: LayerOf<TransmissionFeature> | null;
  towns: LayerOf<TownFeature> | null;
  slope: SlopeSampler | null;
  /**
   * Why a null layer is null, when the loader knows better than "could not be
   * read" — e.g. a layer refused on licence terms. Rendered verbatim.
   */
  layerReasons?: Partial<Record<"roads" | "wetlands" | "flood" | "publicLands" | "transmission" | "towns" | "slope", string>>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const METHODS: Record<ParcelFactKey, string> = {
  road_frontage_m:
    `Length of the GIS parcel line lying within ${FRONTAGE_TOLERANCE_M} m of a TIGER road centerline of an access-giving class (secondary, local, or service road).`,
  legal_access_indication:
    `Public-road contact if an access-giving TIGER road runs along at least ${MIN_ACCESS_FRONTAGE_M} m of the parcel line or crosses into the parcel. An indication only: legal access is settled by the deed and recorded easements.`,
  buildable_acres:
    `Parcel area minus ground steeper than ${BUILDABLE_MAX_SLOPE_PCT}% (USGS 3DEP slope), mapped wetlands (USFWS NWI) and the FEMA 1% annual-chance flood zone, sampled on a regular grid.`,
  public_land_adjacent:
    `A PAD-US fee-owned public unit lies within ${PUBLIC_LAND_ADJACENCY_M} m of the parcel line.`,
  distance_to_transmission_km:
    "Straight-line distance from the parcel line to the nearest mapped electric transmission line (HIFLD archive). Distribution lines are not mapped, so power may be closer than this.",
  distance_to_town_km:
    "Straight-line distance from the parcel line to the nearest incorporated place boundary (Census TIGER).",
  out_of_state_owner:
    "Owner mailing state on the county assessment roll compared with the parcel's state.",
};

function computed<K extends ParcelFactKey>(
  key: K,
  value: ComputedFact<K>["value"],
  confidence: ComputedFact<K>["confidence"],
  sources: FactSource[],
): ComputedFact<K> {
  return { key, status: "computed", value, confidence, method: METHODS[key], sources };
}

function missing<K extends ParcelFactKey>(key: K, what: string, sources: FactSource[] = []): UnavailableFact<K> {
  return unavailable(key, `${PARCEL_FACT_LABELS[key]} not computed: ${what}.`, METHODS[key], sources);
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

interface Prepared {
  proj: LocalProjection;
  area: ProjectedArea;
  sqm: number;
}

function prepare(p: ParcelInput): Prepared {
  const c = areaCentroid(p.geometry);
  const proj = localProjection(c[0], c[1]);
  return { proj, area: projectArea(p.geometry, proj), sqm: areaSqM(p.geometry, proj) };
}

// ── Access & frontage ──────────────────────────────────────────────────────

function accessFacts(
  prep: Prepared,
  roads: LayerOf<RoadFeature> | null,
): [ParcelFactSet["road_frontage_m"], ParcelFactSet["legal_access_indication"]] {
  if (!roads) {
    return [
      missing("road_frontage_m", "the road centerline layer could not be read"),
      missing("legal_access_indication", "the road centerline layer could not be read"),
    ];
  }
  const accessLines: Array<Array<[number, number]>> = [];
  const otherLines: Array<Array<[number, number]>> = [];
  const pad = FRONTAGE_TOLERANCE_M + 1;
  for (const r of roads.features) {
    for (const line of linesOf(r.geometry)) {
      const xy = line.map(prep.proj.fwd);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of xy) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (!bboxesOverlap([minX, minY, maxX, maxY], prep.area.bbox, pad)) continue;
      (ACCESS_ROAD_MTFCC.has(r.mtfcc) ? accessLines : otherLines).push(xy);
    }
  }
  let frontage = 0;
  if (accessLines.length > 0) {
    for (const piece of boundaryPieces(prep.area, 2)) {
      if (distToPolylinesXY(piece.x, piece.y, accessLines) <= FRONTAGE_TOLERANCE_M) frontage += piece.len;
    }
  }
  const crosses = accessLines.some((l) => polylineEntersArea(l, prep.area));
  let indication: AccessIndication;
  if (frontage >= MIN_ACCESS_FRONTAGE_M || crosses) indication = "public_road_contact";
  else {
    let otherTouch = false;
    for (const piece of boundaryPieces(prep.area, 5)) {
      if (distToPolylinesXY(piece.x, piece.y, otherLines) <= FRONTAGE_TOLERANCE_M) { otherTouch = true; break; }
    }
    if (!otherTouch) otherTouch = otherLines.some((l) => polylineEntersArea(l, prep.area));
    indication = otherTouch ? "non_access_road_contact_only" : "no_road_contact";
  }
  const src = [roads.source];
  return [
    computed("road_frontage_m", round(frontage, 0), "medium", src),
    computed("legal_access_indication", indication, "medium", src),
  ];
}

// ── Buildable acres ────────────────────────────────────────────────────────

function buildableFact(p: ParcelInput, prep: Prepared, ctx: ParcelContext): ParcelFactSet["buildable_acres"] {
  const absent: string[] = [];
  if (!ctx.slope) absent.push("the 3DEP elevation window could not be read");
  if (!ctx.wetlands) absent.push("the wetlands layer could not be read");
  if (!ctx.flood) absent.push("the flood hazard layer could not be read");
  else if (!ctx.flood.firmCovered) absent.push("FEMA has no digitized flood map for this location");
  if (absent.length > 0) return missing("buildable_acres", absent.join("; "));
  const slope = ctx.slope!;
  const flood = ctx.flood!;
  const wetlands = ctx.wetlands!;

  const nearby = (g: AreaGeometry) => {
    const a = projectArea(g, prep.proj);
    return bboxesOverlap(a.bbox, prep.area.bbox) ? a : null;
  };
  const wet = wetlands.features.map((f) => nearby(f.geometry)).filter((a): a is ProjectedArea => !!a);
  const sfha = flood.features.filter((f) => f.sfha).map((f) => nearby(f.geometry)).filter((a): a is ProjectedArea => !!a);

  const [minX, minY, maxX, maxY] = prep.area.bbox;
  const step = Math.max(10, Math.sqrt(((maxX - minX) * (maxY - minY)) / MAX_BUILDABLE_SAMPLES));
  let inside = 0, steep = 0, wetN = 0, floodN = 0, ok = 0, noData = 0;
  const kx = 1 / (6_371_008.8 * (Math.PI / 180) * Math.cos(prep.proj.lat0 * (Math.PI / 180)));
  const ky = 1 / (6_371_008.8 * (Math.PI / 180));
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      if (!pointInProjectedArea(x, y, prep.area)) continue;
      inside++;
      const s = slope.slopePctAt(prep.proj.lng0 + x * kx, prep.proj.lat0 + y * ky);
      if (s === null) { noData++; continue; }
      const isSteep = s > BUILDABLE_MAX_SLOPE_PCT;
      const isWet = wet.some((a) => pointInProjectedArea(x, y, a));
      const isFlood = sfha.some((a) => pointInProjectedArea(x, y, a));
      if (isSteep) steep++;
      if (isWet) wetN++;
      if (isFlood) floodN++;
      if (!isSteep && !isWet && !isFlood) ok++;
    }
  }
  if (inside === 0) return missing("buildable_acres", "the parcel is too small to sample at the elevation resolution");
  if (noData / inside > 0.05) {
    return missing("buildable_acres", "the elevation window has no data over more than 5% of the parcel");
  }
  const valid = inside - noData;
  const acres = prep.sqm / SQ_M_PER_ACRE;
  const frac = (n: number) => round((n / valid) * acres, 2);
  return computed(
    "buildable_acres",
    {
      acres: frac(ok),
      breakdown: {
        parcelAcres: round(acres, 2),
        steepAcres: frac(steep),
        wetlandAcres: frac(wetN),
        floodAcres: frac(floodN),
        slopeThresholdPct: BUILDABLE_MAX_SLOPE_PCT,
      },
    },
    "medium",
    [slope.source, wetlands.source, flood.source],
  );
}

// ── Public land adjacency ──────────────────────────────────────────────────

function publicLandFact(prep: Prepared, lands: LayerOf<PublicLandFeature> | null): ParcelFactSet["public_land_adjacent"] {
  if (!lands) return missing("public_land_adjacent", "the PAD-US layer could not be read");
  const units: Array<{ name: string; manager: string }> = [];
  for (const f of lands.features) {
    const a = projectArea(f.geometry, prep.proj);
    if (!bboxesOverlap(a.bbox, prep.area.bbox, PUBLIC_LAND_ADJACENCY_M + 1)) continue;
    if (areaToAreaDistance(prep.area, a) <= PUBLIC_LAND_ADJACENCY_M) {
      if (!units.some((u) => u.name === f.name && u.manager === f.manager)) units.push({ name: f.name, manager: f.manager });
    }
  }
  return computed("public_land_adjacent", { adjacent: units.length > 0, units }, "medium", [lands.source]);
}

// ── Distances ──────────────────────────────────────────────────────────────

function nearestLineKm<F extends { geometry: LineGeometry }>(prep: Prepared, feats: F[]): { km: number; f: F } | null {
  let best: { km: number; f: F } | null = null;
  const boundary = boundaryPieces(prep.area, 25);
  for (const f of feats) {
    const lines = linesOf(f.geometry).map((l) => l.map(prep.proj.fwd));
    if (lines.some((l) => polylineEntersArea(l, prep.area))) return { km: 0, f };
    for (const piece of boundary) {
      const d = distToPolylinesXY(piece.x, piece.y, lines);
      if (!best || d / 1000 < best.km) best = { km: d / 1000, f };
    }
  }
  return best;
}

function transmissionFact(
  prep: Prepared,
  layer: LayerOf<TransmissionFeature> | null,
  reason?: string,
): ParcelFactSet["distance_to_transmission_km"] {
  if (!layer) return missing("distance_to_transmission_km", reason ?? "the transmission line layer could not be read");
  const n = nearestLineKm(prep, layer.features);
  if (!n) return missing("distance_to_transmission_km", "no transmission line inside the searched area", [layer.source]);
  return computed(
    "distance_to_transmission_km",
    { km: round(n.km, 2), voltageClass: n.f.voltClass },
    "low",
    [layer.source],
  );
}

function townFact(prep: Prepared, layer: LayerOf<TownFeature> | null): ParcelFactSet["distance_to_town_km"] {
  if (!layer) return missing("distance_to_town_km", "the Census places layer could not be read");
  let best: { km: number; town: string } | null = null;
  for (const t of layer.features) {
    const a = projectArea(t.geometry, prep.proj);
    const d = areaToAreaDistance(prep.area, a) / 1000;
    if (!best || d < best.km) best = { km: d, town: t.name };
  }
  if (!best) return missing("distance_to_town_km", "no incorporated place inside the searched area", [layer.source]);
  return computed("distance_to_town_km", { km: round(best.km, 2), town: best.town }, "high", [layer.source]);
}

// ── Owner ──────────────────────────────────────────────────────────────────

const US_STATE = /^[A-Z]{2}$/;

function ownerFact(p: ParcelInput, rollSource: FactSource | null): ParcelFactSet["out_of_state_owner"] {
  const mailing = (p.ownerMailingState ?? "").trim().toUpperCase();
  if (!rollSource || !mailing) {
    return missing(
      "out_of_state_owner",
      "this parcel source carries no owner mailing address (the county assessment roll is needed)",
    );
  }
  if (!US_STATE.test(mailing)) return missing("out_of_state_owner", `the mailing state "${mailing}" is not a US state code`, [rollSource]);
  return computed(
    "out_of_state_owner",
    { outOfState: mailing !== p.state.toUpperCase(), mailingState: mailing },
    "medium",
    [rollSource],
  );
}

// ── Entry point ────────────────────────────────────────────────────────────

export function computeParcelFacts(
  parcel: ParcelInput,
  ctx: ParcelContext,
  opts: { assessmentRollSource?: FactSource | null } = {},
): ParcelFactSet {
  const prep = prepare(parcel);
  const [frontage, access] = accessFacts(prep, ctx.roads);
  return {
    road_frontage_m: frontage,
    legal_access_indication: access,
    buildable_acres: buildableFact(parcel, prep, ctx),
    public_land_adjacent: publicLandFact(prep, ctx.publicLands),
    distance_to_transmission_km: transmissionFact(prep, ctx.transmission, ctx.layerReasons?.transmission),
    distance_to_town_km: townFact(prep, ctx.towns),
    out_of_state_owner: ownerFact(parcel, opts.assessmentRollSource ?? null),
  };
}

/** GIS-computed acreage of a parcel (for the alignment check and storage). */
export function gisAcres(g: AreaGeometry): number {
  return round(areaSqM(g) / SQ_M_PER_ACRE, 3);
}

export { areaBbox, areaCentroid };
