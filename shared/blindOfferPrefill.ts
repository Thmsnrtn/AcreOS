/**
 * Land Snapshot → blind-offer prefill mapping (Maren CPO #5).
 *
 * Single source of truth for carrying a parcel's confident, provenanced fields
 * into the blind-offer wizard so the operator goes parcel → offer in under a
 * minute. Pure (no React / DOM) so it is shared by the wizard (parse) and the
 * parcel-detail "Make an offer with these numbers" button (build), and is
 * directly unit-testable.
 *
 * HONESTY CONTRACT: only REAL fields ride along.
 *   • state, county — from the parcel record (system-of-record).
 *   • acres         — from the parcel's authoritative acreage / Land Snapshot
 *                     `acreage` LandField.
 * A missing, empty, non-numeric, or non-positive value is OMITTED — never a
 * fabricated default. The wizard still pulls live comps itself; we never inject
 * an estimate (e.g. USDA ag value) as a fake sold comp.
 */

export interface SnapshotPrefill {
  state?: string;
  county?: string;
  acres?: number;
}

/**
 * Build the wizard querystring from a parcel's fields. Returns the query
 * portion WITHOUT a leading "?" (callers prepend the route). Omits any field
 * that isn't real + valid, preserving the honesty contract.
 */
export function buildBlindOfferPrefillSearch(input: {
  state?: string | null;
  county?: string | null;
  acres?: number | string | null;
}): string {
  const params = new URLSearchParams();

  const state = typeof input.state === "string" ? input.state.trim() : "";
  if (state) params.set("state", state.toUpperCase());

  const county = typeof input.county === "string" ? input.county.trim() : "";
  if (county) params.set("county", county);

  const acres =
    input.acres == null || input.acres === ""
      ? NaN
      : Number(input.acres);
  if (Number.isFinite(acres) && acres > 0) {
    params.set("acres", String(acres));
  }

  return params.toString();
}

/**
 * Parse the prefill from a URL query string (e.g. "?state=AZ&county=Mohave&acres=5").
 * Returns only the fields that are present AND valid — an absent or malformed
 * field is simply omitted (no default).
 */
export function parseSnapshotPrefill(search: string): SnapshotPrefill {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: SnapshotPrefill = {};

  const state = params.get("state")?.trim();
  if (state) out.state = state.toUpperCase();

  const county = params.get("county")?.trim();
  if (county) out.county = county;

  const acresRaw = params.get("acres");
  if (acresRaw != null && acresRaw.trim() !== "") {
    const acres = Number.parseFloat(acresRaw);
    if (Number.isFinite(acres) && acres > 0) out.acres = acres;
  }

  return out;
}
