/**
 * Terrain service — REAL multi-point slope/aspect from USGS 3DEP via the
 * Elevation Point Query Service (EPQS, epqs.nationalmap.gov — free, keyless).
 *
 * Replaces the old land-cover/wetlands proxy for slope. Honesty contract:
 * we NEVER extrapolate terrain from too few points and NEVER fall back to a
 * modeled guess — when sampling fails the caller gets `{ ok: false, reason }`
 * and must surface an honest gap/unknown.
 *
 * ── Sampling geometry ────────────────────────────────────────────────
 * The parcel is modeled as a square of `acres` (1 acre = 4046.8564224 m²)
 * centred on the centroid; side = sqrt(area).
 *   - acreage >= 5 acres  → 9-point 3×3 grid, offsets x,y ∈ {-r, 0, +r}
 *   - smaller / unknown   → 5-point cross (center + N/S/E/W at ±r)
 * with r = clamp(side / 3, 30 m, 500 m) so the outer ring stays inside the
 * parcel; unknown acreage uses r = 60 m. 5–9 requests total — deliberately
 * small out of courtesy to a free federal service, and throttled through the
 * shared per-host token bucket in fetchGeo (3 concurrent, 4 req/s).
 *
 * ── Math (pure, unit-testable — no fetching) ─────────────────────────
 *   - EPQS returns -1000000 for no-data; any elevation ≤ -99 999 m is
 *     discarded as no-data (deepest land on Earth is ≈ -430 m).
 *   - MIN_VALID_POINTS = 4: with fewer real points we return a reasoned
 *     failure, never a 1–2 point "slope".
 *   - Least-squares plane fit z = a·x + b·y + c over the valid points
 *     (x east-metres, y north-metres, z metres; solved via Cramer's rule).
 *       meanSlopePercent = 100 · √(a² + b²)   (the fitted cross-parcel grade)
 *       aspect           = azimuth of the DOWNSLOPE direction, i.e. the
 *                          direction the slope faces: atan2(-a, -b) from
 *                          north, clockwise, in degrees. Real gradient
 *                          azimuth — never a coordinate hash. Omitted
 *                          (null) when meanSlope < 0.5% (flat ground has no
 *                          meaningful aspect).
 *       maxSlopePercent  = steepest grade over all sampled point pairs,
 *                          100 · |Δz| / distance.
 *   - elevation min/max/range from the valid samples (reported in feet).
 * Cross-parcel grades at 30–500 m spacing understate short micro-slopes but
 * honestly classify buildability — which is what land buyers ask.
 */

import { fetchGeo } from "./providers/fetchGeo";
import { logger } from "../utils/logger";

// ── Constants (exported so tests + callers share one truth) ────────────

/** EPQS sentinel for "no elevation data at this point". */
export const EPQS_NO_DATA = -1000000;
/** Any elevation at/below this (metres) is treated as EPQS no-data. */
export const NO_DATA_FLOOR_METERS = -99999;
/** Fewer real points than this → honest failure, never an extrapolation. */
export const MIN_VALID_POINTS = 4;
/** Below this fitted slope (%) the aspect is numerically meaningless. */
export const FLAT_ASPECT_THRESHOLD_PERCENT = 0.5;

const SQ_METERS_PER_ACRE = 4046.8564224;
const FEET_PER_METER = 3.28084;
const EPQS_HOST = "epqs.nationalmap.gov";

// ── Types ──────────────────────────────────────────────────────────────

/** One sample point: planar offsets from the centroid + fetched elevation. */
export interface TerrainPoint {
  /** East offset from centroid, metres. */
  xMeters: number;
  /** North offset from centroid, metres. */
  yMeters: number;
  /** Elevation in metres; null = fetch failed or EPQS no-data. */
  elevationMeters: number | null;
}

export type SlopeBand =
  | "flat (<3%)"
  | "gentle (3-8%)"
  | "moderate (8-15%)"
  | "steep (>15%)";

export interface TerrainSummary {
  /** Fitted cross-parcel grade, percent (1 decimal). */
  meanSlopePercent: number;
  /** Steepest sampled point-to-point grade, percent (1 decimal). */
  maxSlopePercent: number;
  /** Band classified from maxSlopePercent (matches DD conventions). */
  slopeBand: SlopeBand;
  /**
   * Real downslope azimuth (deg from north, clockwise) from the fitted
   * elevation gradient — the direction the slope faces. Null when the
   * ground is effectively flat (< FLAT_ASPECT_THRESHOLD_PERCENT).
   */
  aspectDegrees: number | null;
  /** 8-wind compass label for aspectDegrees ("SW" etc.), null when flat. */
  aspectCompass: string | null;
  elevationMinFeet: number;
  elevationMaxFeet: number;
  elevationRangeFeet: number;
  /** Elevation at the centroid sample, feet; null if that point failed. */
  centerElevationFeet: number | null;
  validPoints: number;
  totalPoints: number;
  spacingMeters: number;
  pattern: "cross5" | "grid9";
  source: string;
}

export type TerrainFailReason = "lookup_failed" | "no_data";

export type TerrainSampleResult =
  | { ok: true; summary: TerrainSummary }
  | {
      ok: false;
      /**
       * "lookup_failed" — at least one request errored and we fell below the
       * point threshold; "no_data" — the service answered but 3DEP has no
       * usable coverage (or spread) here.
       */
      reason: TerrainFailReason;
      /** Human detail for logs/notes (never presented as a value). */
      detail: string;
      validPoints: number;
      totalPoints: number;
      /** Centroid elevation if that single point DID resolve (real datum). */
      centerElevationFeet: number | null;
    };

// ── Pure geometry: the sampling pattern ────────────────────────────────

export interface SamplePlan {
  /** Offsets in metres from the centroid (east = +x, north = +y). */
  offsets: Array<{ xMeters: number; yMeters: number }>;
  spacingMeters: number;
  pattern: "cross5" | "grid9";
}

/**
 * Build the sample offsets for a parcel. Documented geometry: square-parcel
 * model, r = clamp(sqrt(acres·4046.86)/3, 30, 500); 3×3 grid at ≥5 acres,
 * 5-point cross below / when acreage is unknown (r = 60 m default).
 */
export function buildSamplePlan(acres: number | null | undefined): SamplePlan {
  const hasAcres = typeof acres === "number" && Number.isFinite(acres) && acres > 0;
  const spacingMeters = hasAcres
    ? Math.min(500, Math.max(30, Math.sqrt(acres * SQ_METERS_PER_ACRE) / 3))
    : 60;

  if (hasAcres && acres >= 5) {
    const offsets: Array<{ xMeters: number; yMeters: number }> = [];
    for (const y of [spacingMeters, 0, -spacingMeters]) {
      for (const x of [-spacingMeters, 0, spacingMeters]) {
        offsets.push({ xMeters: x, yMeters: y });
      }
    }
    return { offsets, spacingMeters, pattern: "grid9" };
  }

  return {
    offsets: [
      { xMeters: 0, yMeters: 0 },
      { xMeters: 0, yMeters: spacingMeters }, // N
      { xMeters: 0, yMeters: -spacingMeters }, // S
      { xMeters: spacingMeters, yMeters: 0 }, // E
      { xMeters: -spacingMeters, yMeters: 0 }, // W
    ],
    spacingMeters,
    pattern: "cross5",
  };
}

// ── Pure math: derive slope / aspect / range from canned elevations ────

export interface TerrainDerivation {
  meanSlopePercent: number;
  maxSlopePercent: number;
  aspectDegrees: number | null;
  aspectCompass: string | null;
  elevationMinMeters: number;
  elevationMaxMeters: number;
  validPoints: number;
}

const COMPASS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function compassLabel(azimuthDegrees: number): string {
  const idx = Math.round(((azimuthDegrees % 360) + 360) % 360 / 45) % 8;
  return COMPASS_8[idx];
}

function isUsableElevation(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > NO_DATA_FLOOR_METERS;
}

export function classifySlopeBand(maxSlopePercent: number): SlopeBand {
  if (maxSlopePercent < 3) return "flat (<3%)";
  if (maxSlopePercent < 8) return "gentle (3-8%)";
  if (maxSlopePercent < 15) return "moderate (8-15%)";
  return "steep (>15%)";
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Derive terrain metrics from sampled points. PURE — no fetching. Filters
 * no-data (EPQS -1000000 sentinel / null) internally, then requires
 * MIN_VALID_POINTS real points AND spatial spread sufficient for a plane fit.
 * Returns a reasoned failure instead of ever extrapolating.
 */
export function deriveTerrainMetrics(
  points: TerrainPoint[],
):
  | { ok: true; derivation: TerrainDerivation }
  | { ok: false; reason: "insufficient_points" | "insufficient_spread"; validPoints: number } {
  const valid = points.filter((p) => isUsableElevation(p.elevationMeters)) as Array<
    TerrainPoint & { elevationMeters: number }
  >;

  if (valid.length < MIN_VALID_POINTS) {
    return { ok: false, reason: "insufficient_points", validPoints: valid.length };
  }

  // Least-squares plane fit z = a·x + b·y + c (Cramer's rule on the normal
  // equations). Singularity (all points collinear) = insufficient spread.
  let Sx = 0, Sy = 0, Sz = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxz = 0, Syz = 0;
  for (const p of valid) {
    Sx += p.xMeters;
    Sy += p.yMeters;
    Sz += p.elevationMeters;
    Sxx += p.xMeters * p.xMeters;
    Syy += p.yMeters * p.yMeters;
    Sxy += p.xMeters * p.yMeters;
    Sxz += p.xMeters * p.elevationMeters;
    Syz += p.yMeters * p.elevationMeters;
  }
  const n = valid.length;
  const det =
    Sxx * (Syy * n - Sy * Sy) - Sxy * (Sxy * n - Sy * Sx) + Sx * (Sxy * Sy - Syy * Sx);
  if (Math.abs(det) < 1e-6) {
    return { ok: false, reason: "insufficient_spread", validPoints: valid.length };
  }
  const detA =
    Sxz * (Syy * n - Sy * Sy) - Sxy * (Syz * n - Sy * Sz) + Sx * (Syz * Sy - Syy * Sz);
  const detB =
    Sxx * (Syz * n - Sz * Sy) - Sxz * (Sxy * n - Sy * Sx) + Sx * (Sxy * Sz - Syz * Sx);
  const a = detA / det; // dz/dx (east)
  const b = detB / det; // dz/dy (north)

  const meanSlopePercent = Math.hypot(a, b) * 100;

  // Aspect: azimuth of the DOWNSLOPE direction (the way the slope faces).
  // Gradient (a, b) points uphill; downhill is (-a, -b) in (east, north).
  let aspectDegrees: number | null = null;
  let aspectCompass: string | null = null;
  if (meanSlopePercent >= FLAT_ASPECT_THRESHOLD_PERCENT) {
    aspectDegrees = Math.round(((Math.atan2(-a, -b) * 180) / Math.PI + 360) % 360);
    aspectCompass = compassLabel(aspectDegrees);
  }

  // Steepest sampled grade over all point pairs.
  let maxSlopePercent = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const run = Math.hypot(
        valid[i].xMeters - valid[j].xMeters,
        valid[i].yMeters - valid[j].yMeters,
      );
      if (run <= 0) continue;
      const grade =
        (Math.abs(valid[i].elevationMeters - valid[j].elevationMeters) / run) * 100;
      if (grade > maxSlopePercent) maxSlopePercent = grade;
    }
  }

  const elevations = valid.map((p) => p.elevationMeters);
  return {
    ok: true,
    derivation: {
      meanSlopePercent: round1(meanSlopePercent),
      maxSlopePercent: round1(maxSlopePercent),
      aspectDegrees,
      aspectCompass,
      elevationMinMeters: Math.min(...elevations),
      elevationMaxMeters: Math.max(...elevations),
      validPoints: valid.length,
    },
  };
}

// ── Fetching (thin, isolated from the math) ────────────────────────────

function safeCoord(value: number, kind: "lat" | "lng"): string {
  const n = Number(value);
  const limit = kind === "lat" ? 90 : 180;
  if (!Number.isFinite(n) || Math.abs(n) > limit) {
    throw new Error(`terrain: invalid ${kind} coordinate`);
  }
  return n.toFixed(6);
}

type PointFetch =
  | { status: "ok"; elevationMeters: number }
  | { status: "no_data" }
  | { status: "error" };

async function fetchElevationMeters(lat: number, lng: number): Promise<PointFetch> {
  const url = `https://${EPQS_HOST}/v1/json?x=${safeCoord(lng, "lng")}&y=${safeCoord(lat, "lat")}&wkid=4326&units=Meters&includeDate=false`;
  try {
    const resp = await fetchGeo(url, {
      timeoutMs: 6000,
      retries: 1,
      // Federal courtesy: small parallelism + modest sustained rate shared
      // across ALL terrain sampling in the process via the per-host bucket.
      maxConcurrentPerHost: 3,
      ratePerSec: 4,
    });
    if (!resp.ok) return { status: "error" };
    const data: any = await resp.json().catch(() => null);
    const raw = data?.value;
    const v = typeof raw === "string" ? parseFloat(raw) : typeof raw === "number" ? raw : NaN;
    if (!Number.isFinite(v)) return { status: "no_data" };
    if (v <= NO_DATA_FLOOR_METERS) return { status: "no_data" }; // EPQS -1000000 sentinel
    return { status: "ok", elevationMeters: v };
  } catch {
    return { status: "error" };
  }
}

/**
 * Sample real 3DEP terrain around a parcel centroid. See the header for the
 * geometry + thresholds. Returns a reasoned failure — never a proxy value —
 * when fewer than MIN_VALID_POINTS real elevations come back.
 */
export async function sampleParcelTerrain(
  lat: number,
  lng: number,
  acres?: number | null,
): Promise<TerrainSampleResult> {
  // Validates + throws on garbage coordinates before any network I/O.
  safeCoord(lat, "lat");
  safeCoord(lng, "lng");

  const plan = buildSamplePlan(acres ?? null);
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.max(0.2, Math.cos(latRad));

  const results = await Promise.all(
    plan.offsets.map((o) =>
      fetchElevationMeters(lat + o.yMeters / metersPerDegLat, lng + o.xMeters / metersPerDegLng),
    ),
  );

  let fetchErrors = 0;
  let noData = 0;
  let centerElevationFeet: number | null = null;
  const points: TerrainPoint[] = plan.offsets.map((o, i) => {
    const r = results[i];
    if (r.status === "error") fetchErrors += 1;
    if (r.status === "no_data") noData += 1;
    const elevationMeters = r.status === "ok" ? r.elevationMeters : null;
    if (o.xMeters === 0 && o.yMeters === 0 && elevationMeters !== null) {
      centerElevationFeet = Math.round(elevationMeters * FEET_PER_METER);
    }
    return { xMeters: o.xMeters, yMeters: o.yMeters, elevationMeters };
  });

  const derived = deriveTerrainMetrics(points);
  if (!derived.ok) {
    const reason: TerrainFailReason = fetchErrors > 0 ? "lookup_failed" : "no_data";
    const detail =
      derived.reason === "insufficient_spread"
        ? `3DEP points lacked spatial spread for a slope fit (${derived.validPoints}/${plan.offsets.length})`
        : `only ${derived.validPoints}/${plan.offsets.length} 3DEP points returned (min ${MIN_VALID_POINTS}); ${fetchErrors} errors, ${noData} no-data`;
    logger.warn("[terrain] EPQS sampling below threshold", {
      source: "terrain",
      metadata: { lat, lng, pattern: plan.pattern, validPoints: derived.validPoints, fetchErrors, noData },
    });
    return {
      ok: false,
      reason,
      detail,
      validPoints: derived.validPoints,
      totalPoints: plan.offsets.length,
      centerElevationFeet,
    };
  }

  const d = derived.derivation;
  return {
    ok: true,
    summary: {
      meanSlopePercent: d.meanSlopePercent,
      maxSlopePercent: d.maxSlopePercent,
      slopeBand: classifySlopeBand(d.maxSlopePercent),
      aspectDegrees: d.aspectDegrees,
      aspectCompass: d.aspectCompass,
      elevationMinFeet: Math.round(d.elevationMinMeters * FEET_PER_METER),
      elevationMaxFeet: Math.round(d.elevationMaxMeters * FEET_PER_METER),
      elevationRangeFeet: Math.round((d.elevationMaxMeters - d.elevationMinMeters) * FEET_PER_METER),
      centerElevationFeet,
      validPoints: d.validPoints,
      totalPoints: plan.offsets.length,
      spacingMeters: Math.round(plan.spacingMeters * 10) / 10,
      pattern: plan.pattern,
      source: "USGS 3DEP (EPQS)",
    },
  };
}

/** Customer-facing slope string, e.g. "gentle (3-8%) — 4.2% avg, 7.1% max, SW-facing". */
export function formatSlopeValue(s: TerrainSummary): string {
  const aspect = s.aspectCompass ? `, ${s.aspectCompass}-facing` : "";
  return `${s.slopeBand} — ${s.meanSlopePercent}% avg, ${s.maxSlopePercent}% max${aspect}`;
}
