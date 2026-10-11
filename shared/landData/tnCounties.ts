/**
 * Which Tennessee county a point falls in — from the simplified TIGER county
 * shapes the coverage map already ships (~1 km generalisation). Browser-safe.
 *
 * Used to route a TN coordinate lookup (founder decision 2026-10-11): TN
 * points are answered from AcreOS's own loaded county parcels, or the org's
 * own Regrid key, or refused in plain words — never from the state's
 * non-commercial public service. A point within ~1 km of the state line can
 * fall either side of the generalised border; that only changes which
 * permitted path answers it, never whether the blocked service is used (the
 * URL guard refuses it everywhere).
 */
import tnBoundaries from "./tnCountyBoundaries.json";

type Ring = number[][];
interface CountyFeature {
  properties: { fips: string; name: string };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  if (!rings.length || !inRing(lng, lat, rings[0])) return false;
  return !rings.slice(1).some((h) => inRing(lng, lat, h));
}

/** { fips, name } of the TN county containing the point, or null outside TN. */
export function tnCountyAt(lat: number, lng: number): { fips: string; name: string } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const f of (tnBoundaries as unknown as { features: CountyFeature[] }).features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (polys.some((p) => inPolygon(lng, lat, p))) return { fips: f.properties.fips, name: f.properties.name };
  }
  return null;
}
