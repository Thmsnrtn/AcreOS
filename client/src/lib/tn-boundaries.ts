/**
 * Tennessee county boundary shapes for the coverage map (LandCoveragePanel).
 *
 * The shapes are data, not code: shared/landData/tnCountyBoundaries.json is
 * ~52 KB of simplified TIGER GeoJSON (95 counties). Importing it into the
 * client bundle put every byte inside the bundle gate's summed JS total
 * (scripts/check-bundle-size.js counts every emitted .js file), so the file
 * now ships as a static asset instead — vite.config.ts (tnBoundariesPlugin)
 * copies it verbatim into dist/public/land-data/ at build end and serves the
 * same URL from disk under the dev server — and this loader fetches it on
 * demand. fetch().json() yields the same object the bundle used to carry;
 * the panel draws the identical fills from it. The server keeps importing
 * the JSON directly (tnCountyAt, release lineage) and is untouched.
 *
 * A failed fetch REJECTS, never resolves an empty result: an unreadable
 * boundary file must not masquerade as a map with no counties. See the
 * empty-on-failure ratchet (scripts/ratchets/empty-on-failure.json).
 */

type Ring = number[][];

export interface TnCountyFeature {
  type: "Feature";
  properties: { fips: string; name: string };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
}

export interface TnCountyBoundaries {
  type: "FeatureCollection";
  features: TnCountyFeature[];
}

/** Where the boundary shapes are served from (dist/public/land-data/). */
export const TN_BOUNDARIES_URL = "/land-data/tn-county-boundaries.json";

let pending: Promise<TnCountyBoundaries> | null = null;

/**
 * Fetch the TN county boundaries, once per page load: concurrent callers
 * share the request, and a rejection clears the cache so a later caller
 * can retry.
 */
export function fetchTnBoundaries(): Promise<TnCountyBoundaries> {
  if (!pending) {
    pending = (async () => {
      const res = await fetch(TN_BOUNDARIES_URL);
      if (!res.ok) {
        throw new Error(`TN county boundaries failed to load: ${res.status}`);
      }
      return (await res.json()) as TnCountyBoundaries;
    })().catch((err: unknown) => {
      pending = null;
      throw err;
    });
  }
  return pending;
}
