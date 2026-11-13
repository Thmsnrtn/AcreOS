/**
 * Coverage-demand refusal taxonomy (P1-7 / A-2 — gate-refusal demand wiring).
 *
 * Why this exists: the demand machinery (county_coverage_requests +
 * county_discovery_queue, migration 0125) was built where capture was easy —
 * the Maps empty state. The refusal that matters most, a statewide-gate
 * refusal, wrote NO demand artefact: in parcel.ts a gated statewide row is
 * filtered out exactly like a missing endpoint, so downstream a gate refusal
 * was indistinguishable from a genuine not-found, and the founder demand view
 * could not tell "customers are asking for counties the licence gate refuses"
 * from "customers searched APNs that do not exist".
 *
 * This module is the ONE vocabulary for that distinction, shared by the
 * lookup layer (server/services/parcel.ts), the request endpoint
 * (server/routes-county-coverage.ts), the founder feed
 * (server/routes-founder-coverage.ts), the passport refusal shape and the
 * client CTA. Pure and browser-safe: no imports, no I/O.
 *
 * The gate itself is NOT here and is never loosened by anything in this
 * module — a refusal stays a refusal; this only names it and routes the
 * demand signal it generates.
 */

/** Why a parcel lookup refused / missed, in demand terms. */
export type CoverageRefusalReason =
  /** A statewide source exists for the state but the lookup gate
   *  (LOOKUP_CLEARANCE) does not clear it, so it served nothing. */
  | "gated"
  /** No county GIS endpoint (and no servable statewide source) exists. */
  | "no_endpoint"
  /** No source could run and no Regrid key (org or platform) is configured. */
  | "no_key"
  /** Sources ran and the parcel genuinely was not found. Terminal — this is
   *  deliberately distinguishable from every refusal above. */
  | "not_found";

export const COVERAGE_REFUSAL_REASONS: readonly CoverageRefusalReason[] = [
  "gated",
  "no_endpoint",
  "no_key",
  "not_found",
] as const;

/** The product surface a demand signal came from. */
export type CoverageDemandSurface =
  | "maps"
  | "parcel_lookup"
  | "pax"
  | "passport"
  | "drive_mode"
  | "property"
  | "other";

export const COVERAGE_DEMAND_SURFACES: readonly CoverageDemandSurface[] = [
  "maps",
  "parcel_lookup",
  "pax",
  "passport",
  "drive_mode",
  "property",
  "other",
] as const;

/** The customer request endpoint every affordance points at. */
const COUNTY_COVERAGE_REQUEST_ENDPOINT = "/api/county-coverage/request";

/**
 * The request affordance returned ON a refusal: everything a surface needs to
 * render "request this county" at the moment of refusal and to attribute the
 * resulting request. `county` is null when the lookup never learned one
 * (a coordinate lookup) — the CTA then asks the user for it.
 */
export interface CoverageDemandAffordance {
  state: string;
  county: string | null;
  reason: CoverageRefusalReason;
  surface: CoverageDemandSurface;
  endpoint: typeof COUNTY_COVERAGE_REQUEST_ENDPOINT;
}

export function coverageDemandAffordance(input: {
  state: string;
  county?: string | null;
  reason: CoverageRefusalReason;
  surface: CoverageDemandSurface;
}): CoverageDemandAffordance {
  return {
    state: input.state.toUpperCase(),
    county: input.county ?? null,
    reason: input.reason,
    surface: input.surface,
    endpoint: COUNTY_COVERAGE_REQUEST_ENDPOINT,
  };
}

/**
 * May this refusal carry a request affordance? A terminal not-found means the
 * sources ran and the parcel is not there — requesting the county would not
 * change that answer, so no affordance is offered for it. Every true refusal
 * (gated / no endpoint / no key) can be moved by coverage work, so it can.
 */
export function refusalAffordanceEligible(reason: CoverageRefusalReason): boolean {
  return reason !== "not_found";
}

/**
 * The terminal reason for an APN/coordinate lookup that fell through every
 * layer. Precedence, deliberately conservative:
 *  - a configured Regrid key means the paid statewide source actually ran and
 *    missed → the honest terminal reason is `not_found`, even when the free
 *    county layer also refused (the parcel was looked for everywhere it
 *    could be);
 *  - with no key, the county layer's own reason (gated / no_endpoint) is the
 *    refusal the customer actually hit;
 *  - with neither, `no_key` is the whole story.
 */
export function terminalRefusalReason(input: {
  countyLayerReason: CoverageRefusalReason | null;
  regridKeyPresent: boolean;
}): CoverageRefusalReason {
  if (input.regridKeyPresent) return "not_found";
  if (input.countyLayerReason === "gated" || input.countyLayerReason === "no_endpoint") {
    return input.countyLayerReason;
  }
  return "no_key";
}

/** Plain-language line per reason, for refusal surfaces that name the reason. */
export const REFUSAL_REASON_COPY: Record<CoverageRefusalReason, string> = {
  gated:
    "A statewide parcel source exists for this state, but its licence review has not cleared it for lookup, so it served nothing.",
  no_endpoint: "No free parcel source is connected for this county yet.",
  no_key: "No parcel data key is configured, so the paid lookup source could not run.",
  not_found: "The parcel sources ran and did not find this parcel.",
};
