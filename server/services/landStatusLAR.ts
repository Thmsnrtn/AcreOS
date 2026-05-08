/**
 * P0-18 Phase B — LAR (BIA Land Area Representations) overlay.
 *
 * The BIA publishes a shapefile of every federally-recognized reservation,
 * tribal-trust block, individual-trust allotment, and restricted-fee parcel
 * boundary. AcreOS downloads it as a (server-side) GeoJSON, simplifies it
 * to manageable polygon counts, and runs point-in-polygon on every parcel
 * lat/lng to surface trust status BEFORE a manual operator review.
 *
 * This service is the interface; the data file is loaded at boot from
 * `data/bia-lar.geojson` if present. When the file is absent (the default
 * for fresh checkouts), every detection returns `"unknown"` so the existing
 * `assertFeeSimpleOrThrow` guard in `server/utils/landStatus.ts` keeps
 * working unchanged. Ops loads the BIA shapefile via the runbook at
 * `docs/runbooks/load-bia-lar-overlay.md`.
 *
 * Why static + simplified rather than PostGIS: the BIA dataset is small
 * enough (~57MB raw, ~8MB simplified to 0.001-degree tolerance) to keep
 * fully in-process, the queries are O(log N) with a region tree, and we
 * avoid adding the postgis extension to the production cluster.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger";
import type { LandStatus } from "@shared/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LAR_GEOJSON_PATH = process.env.BIA_LAR_GEOJSON_PATH
  ?? join(__dirname, "..", "..", "data", "bia-lar.geojson");

export interface LarDetectionResult {
  /** Detected land status. `unknown` when no LAR polygon contains the point. */
  status: LandStatus;
  /** 0-1 — 1.0 for direct LAR-polygon match, 0 for no match. */
  confidence: number;
  /** Where the call resolved from. */
  source: "lar_overlay" | "no_overlay_loaded" | "no_match";
  /** Tribal name when a LAR polygon hit. */
  tribeName?: string;
  /** BIA-assigned ID (LARID/REGION_ID) when available. */
  larId?: string;
  /** ISO timestamp of the underlying dataset. */
  datasetVersion?: string;
}

interface LarFeature {
  type: "Feature";
  properties: {
    LARID?: string;
    LARNAME?: string;
    LARTYPE?: "tribal_trust" | "individual_trust" | "restricted_fee" | "fee_within_reservation" | "off_reservation_trust";
    NAME?: string;
    TRIBE?: string;
    [k: string]: unknown;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  // Pre-computed bounding box for fast bbox-reject filtering.
  bbox?: [number, number, number, number];
}

interface LarFeatureCollection {
  type: "FeatureCollection";
  metadata?: {
    datasetVersion?: string;
    sourceUrl?: string;
  };
  features: LarFeature[];
}

let cachedFc: LarFeatureCollection | null = null;
let loadAttempted = false;
let datasetVersion: string | undefined;

function loadOverlay(): LarFeatureCollection | null {
  if (loadAttempted) return cachedFc;
  loadAttempted = true;
  try {
    if (!existsSync(LAR_GEOJSON_PATH)) {
      logger.warn(`[LAR] BIA shapefile not loaded — file missing at ${LAR_GEOJSON_PATH}. Detection returns "unknown" for every parcel; manual landStatus verification still required. See docs/runbooks/load-bia-lar-overlay.md.`);
      return null;
    }
    const raw = readFileSync(LAR_GEOJSON_PATH, "utf-8");
    const fc = JSON.parse(raw) as LarFeatureCollection;
    if (!fc.features || !Array.isArray(fc.features)) {
      logger.error("[LAR] BIA shapefile is not a valid FeatureCollection");
      return null;
    }
    // Pre-compute bounding boxes for fast rejection.
    for (const f of fc.features) {
      if (!f.bbox) f.bbox = computeBBox(f.geometry);
    }
    datasetVersion = fc.metadata?.datasetVersion;
    cachedFc = fc;
    logger.info(`[LAR] Loaded ${fc.features.length} BIA LAR features from ${LAR_GEOJSON_PATH} (version: ${datasetVersion ?? "unknown"})`);
    return fc;
  } catch (err) {
    logger.error(`[LAR] Failed to load BIA shapefile from ${LAR_GEOJSON_PATH}`, err instanceof Error ? err : undefined);
    return null;
  }
}

function computeBBox(geom: LarFeature["geometry"]): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const visit = (coord: number[]) => {
    minLng = Math.min(minLng, coord[0]);
    maxLng = Math.max(maxLng, coord[0]);
    minLat = Math.min(minLat, coord[1]);
    maxLat = Math.max(maxLat, coord[1]);
  };
  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates as number[][][]) for (const c of ring) visit(c);
  } else {
    for (const poly of geom.coordinates as number[][][][]) for (const ring of poly) for (const c of ring) visit(c);
  }
  return [minLng, minLat, maxLng, maxLat];
}

function pointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
  // Standard ray-casting. Polygons in GeoJSON are closed (first === last).
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > lat) !== (yj > lat)
      && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFeature(lng: number, lat: number, feature: LarFeature): boolean {
  const bbox = feature.bbox;
  if (bbox) {
    if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) return false;
  }
  if (feature.geometry.type === "Polygon") {
    const rings = feature.geometry.coordinates as number[][][];
    if (rings.length === 0) return false;
    if (!pointInPolygon(lng, lat, rings[0])) return false;
    // Check holes.
    for (let i = 1; i < rings.length; i++) {
      if (pointInPolygon(lng, lat, rings[i])) return false;
    }
    return true;
  } else {
    // MultiPolygon
    for (const poly of feature.geometry.coordinates as number[][][][]) {
      if (poly.length === 0) continue;
      if (!pointInPolygon(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInPolygon(lng, lat, poly[i])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
    return false;
  }
}

/**
 * Detect a parcel's land status from its lat/lng using the BIA LAR overlay.
 * Returns `{ status: 'unknown', source: 'no_overlay_loaded' }` when the
 * dataset is absent — the operator's manual-verification workflow stays
 * authoritative.
 */
export function detectLandStatusFromCoords(lat: number, lng: number): LarDetectionResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { status: "unknown", confidence: 0, source: "no_match" };
  }
  const fc = loadOverlay();
  if (!fc) return { status: "unknown", confidence: 0, source: "no_overlay_loaded", datasetVersion };

  for (const feature of fc.features) {
    if (pointInFeature(lng, lat, feature)) {
      const props = feature.properties;
      const inferredStatus: LandStatus =
        (props.LARTYPE as LandStatus | undefined) ?? "tribal_trust";
      return {
        status: inferredStatus,
        confidence: 1,
        source: "lar_overlay",
        tribeName: props.TRIBE ?? props.LARNAME ?? props.NAME,
        larId: props.LARID,
        datasetVersion,
      };
    }
  }
  return { status: "unknown", confidence: 1, source: "no_match", datasetVersion };
}

/**
 * Test seam — flushes the in-process cache so a follow-up call reloads.
 * Useful in tests + the ops "reload BIA overlay" admin endpoint.
 */
export function _resetLarOverlayCache(): void {
  cachedFc = null;
  loadAttempted = false;
  datasetVersion = undefined;
}
