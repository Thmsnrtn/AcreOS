/**
 * Plain-words rendering of a gated parcel fact, shared by every public surface
 * (the server-rendered /p report body, the SPA report page, the landlocked
 * checker and the county guides) so the words cannot drift between the HTML a
 * crawler reads and the page a person sees. Browser-safe.
 *
 * Input is ONLY what came out of the accuracy gate (projectFactsForCustomer via
 * serializeOwnedParcelForCustomer). A fact that is absent, withheld, or
 * "unavailable" renders as "Not available" with its reason — never estimated.
 */
import { PARCEL_FACT_KEYS, PARCEL_FACT_LABELS, type AccessIndication, type ParcelFactKey, type ParcelFactValueMap } from "./parcelFacts";
import type { ParcelTruth } from "./parcelTruths";
import type { TaxSaleSource } from "./taxSaleSources";
import type { CountyCoverage } from "./countySourceCensus";

export const NOT_AVAILABLE = "Not available";

export const ACCESS_TEXT: Record<AccessIndication, string> = {
  public_road_contact: "A public road touches the mapped parcel",
  non_access_road_contact_only: "Only a private drive, trail or limited-access highway touches it",
  no_road_contact: "No road touches the mapped parcel",
};

export interface PublicFactSource {
  name: string;
  url: string;
  retrievedOn: string;
  sourceAsOf?: string | null;
}

/** One row of the public fact table. */
export interface PublicFactRow {
  key: ParcelFactKey;
  label: string;
  /** "shown": a computed value that passed the gate. "not_available": anything else. */
  status: "shown" | "not_available";
  text: string;
  /** Why it is not available (status "not_available" only). */
  reason: string | null;
  confidence: "high" | "medium" | "low" | null;
  method: string | null;
  sources: PublicFactSource[];
  accuracy: { check: string; sampleSize: number; agreed: number; verifiedOn: string | null } | null;
}

/** The shape serializeOwnedParcelForCustomer gives each shown fact. */
interface GatedFact {
  key: ParcelFactKey;
  status: "computed" | "unavailable";
  value: unknown;
  confidence: "high" | "medium" | "low" | null;
  method: string;
  sources: PublicFactSource[];
  reason?: string;
  accuracy?: { check: string; sampleSize: number; agreed: number; verifiedOn: string | null };
}

function round(n: number, dp: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}

/** The value of a computed fact, in words. */
export function factValueText<K extends ParcelFactKey>(key: K, value: ParcelFactValueMap[K]): string {
  switch (key) {
    case "road_frontage_m": {
      const m = value as number;
      return m > 0 ? `${round(m, 0)} m (${round(m * 3.28084, 0)} ft) of road along the mapped line` : "No road frontage on the mapped line";
    }
    case "legal_access_indication":
      return ACCESS_TEXT[value as AccessIndication] ?? NOT_AVAILABLE;
    case "buildable_acres": {
      const v = value as ParcelFactValueMap["buildable_acres"];
      return `${round(v.acres, 2)} of ${round(v.breakdown.parcelAcres, 2)} acres, after removing slopes over ${v.breakdown.slopeThresholdPct}% (${round(v.breakdown.steepAcres, 2)} ac), mapped wetlands (${round(v.breakdown.wetlandAcres, 2)} ac) and the 1% flood zone (${round(v.breakdown.floodAcres, 2)} ac)`;
    }
    case "public_land_adjacent": {
      const v = value as ParcelFactValueMap["public_land_adjacent"];
      if (!v.adjacent) return "No public land within 30 m";
      const names = v.units.map((u) => u.name).filter(Boolean);
      return names.length ? `Yes — ${names.slice(0, 3).join(", ")}` : "Yes";
    }
    case "distance_to_transmission_km": {
      const v = value as ParcelFactValueMap["distance_to_transmission_km"];
      return `${round(v.km, 1)} km`;
    }
    case "distance_to_town_km": {
      const v = value as ParcelFactValueMap["distance_to_town_km"];
      return `${round(v.km, 1)} km to ${v.town}`;
    }
    case "out_of_state_owner":
      // Never rendered publicly — it is an owner attribute (and its gate has no
      // sample). Kept exhaustive so the switch is total.
      return NOT_AVAILABLE;
    default:
      return NOT_AVAILABLE;
  }
}

/** Facts never shown on a PUBLIC page, whatever their gate says. */
export const PUBLIC_EXCLUDED_FACTS: readonly ParcelFactKey[] = ["out_of_state_owner"];

/**
 * Every fact key, in order, as a public row: the gated value when the gate
 * shows a computed fact; otherwise "Not available" with the reason.
 */
export function publicFactRows(input: {
  facts: GatedFact[];
  withheldFacts: Array<{ key: ParcelFactKey; label: string; reason: string }>;
}): PublicFactRow[] {
  return PARCEL_FACT_KEYS.filter((k) => !PUBLIC_EXCLUDED_FACTS.includes(k)).map((key) => {
    const label = PARCEL_FACT_LABELS[key];
    const f = input.facts.find((x) => x.key === key);
    if (f && f.status === "computed" && f.value !== null && f.value !== undefined) {
      return {
        key,
        label,
        status: "shown",
        text: factValueText(key, f.value as never),
        reason: null,
        confidence: f.confidence,
        method: f.method,
        sources: f.sources,
        accuracy: f.accuracy ?? null,
      };
    }
    const withheld = input.withheldFacts.find((w) => w.key === key);
    const reason = f?.status === "unavailable"
      ? f.reason ?? "It could not be computed for this parcel."
      : withheld
        ? withheld.reason
        : "AcreOS has no value for this parcel.";
    return {
      key,
      label,
      status: "not_available",
      text: NOT_AVAILABLE,
      reason,
      confidence: null,
      method: f?.method ?? null,
      sources: f?.sources ?? [],
      accuracy: null,
    };
  });
}

/** What a public page shows about a parcel AcreOS keeps. */
export interface PublicLandFacts {
  parcelKey: string;
  state: string;
  /** Lowercase, hyphenated — the permalink county segment. */
  countySlug: string;
  countyLabel: string;
  /** The canonical (stored) county parcel id — the canonical URL's APN. */
  apn: string;
  centroid: { lat: number; lng: number } | null;
  gisAcres: number;
  deededAcres: number | null;
  source: { name: string; retrievedOn: string | null };
  /** Every public fact, in order: gated value, or "Not available" + reason. */
  rows: PublicFactRow[];
  truths: ParcelTruth[];
  taxSaleSources: TaxSaleSource[];
  countyCoverage: CountyCoverage | null;
  countyCoverageLabel: string | null;
  /** True when at least one gated fact is shown — else the page is noindex. */
  indexable: boolean;
}

