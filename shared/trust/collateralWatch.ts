/**
 * Collateral watch for note investors (W5a) — what is watched on each note's
 * collateral parcel, and from which source. NEVER IMPLY COVERAGE: a kind is
 * "watched" only when a source that already exists in AcreOS can answer it
 * for that county; otherwise it says "not watched: no source for <county>".
 *
 * Today's sources, checked against code:
 *   - tax delinquency: a county GIS endpoint (county_gis_endpoints, the W2
 *     land-data registry, served through the provider registry's county-gis
 *     provider) whose field mapping NAMES a tax-status field. A layer whose
 *     tax status is only guessed from common field names is not coverage.
 *   - liens and probate: no provider in the registry, and no W2 source,
 *     reads lien filings or probate dockets for any county. Not watched.
 *
 * Browser-safe and pure.
 */

export type CollateralWatchKind = "tax_delinquency" | "liens" | "probate";

const COLLATERAL_WATCH_KINDS: readonly CollateralWatchKind[] = ["tax_delinquency", "liens", "probate"];

export const COLLATERAL_KIND_LABEL: Record<CollateralWatchKind, string> = {
  tax_delinquency: "Tax delinquency",
  liens: "Liens",
  probate: "Probate",
};

export interface CountyTaxSource {
  state: string;
  county: string;
  /** The endpoint's name, shown as the source. */
  name: string;
}

export interface CollateralWatchCoverage {
  kind: CollateralWatchKind;
  watched: boolean;
  /** "County GIS: <name>" when watched; "not watched: no source for <county>" otherwise. */
  text: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+county$/, "");

export function collateralCoverage(
  parcel: { state: string; county: string },
  taxSources: CountyTaxSource[],
): CollateralWatchCoverage[] {
  const countyLabel = `${parcel.county.replace(/\s+county$/i, "")} County, ${parcel.state.toUpperCase()}`;
  const tax = taxSources.find((s) => s.state.toUpperCase() === parcel.state.toUpperCase() && norm(s.county) === norm(parcel.county));
  return COLLATERAL_WATCH_KINDS.map((kind) => {
    if (kind === "tax_delinquency" && tax) {
      return { kind, watched: true, text: `Watched daily: County GIS (${tax.name})` };
    }
    return { kind, watched: false, text: `Not watched: no source for ${countyLabel}` };
  });
}

/**
 * Reads a county's tax-status value. "unknown" when the wording is not one we
 * recognise — an unrecognised value never raises an alert and never reads as
 * current.
 */
export function classifyTaxStatus(raw: string | null | undefined): "delinquent" | "current" | "unknown" {
  const s = (raw ?? "").trim();
  if (!s) return "unknown";
  if (/delinq|unpaid|past\s*due|tax\s*sale|in\s*default|certificate\s*sold|forfeit/i.test(s)) return "delinquent";
  if (/^(paid|current|good\s*standing|paid\s*in\s*full)$/i.test(s)) return "current";
  return "unknown";
}

/**
 * The county tax-status value from a county-gis registry result. The provider
 * returns the PARCEL (server/services/parcel.ts `ParcelLookupResult["parcel"]`)
 * as `result.data`, and the tax status lives on the parcel's OWN `data`.
 * Reading `result.data.taxStatus` is always undefined — a watch that says
 * "Watched daily" and can never alert. Pinned against the real provider's
 * output in tests/unit/collateralWatchReadsRealParcelShape.test.ts.
 */
export function taxStatusOfCountyGisParcel(parcel: unknown): string | null {
  const p = parcel as { data?: { taxStatus?: unknown } } | null | undefined;
  const v = p?.data?.taxStatus;
  return typeof v === "string" && v.trim() ? v : null;
}
