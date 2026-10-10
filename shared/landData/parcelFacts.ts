/**
 * Parcel facts — the W2 land-data fact model (Tennessee showcase).
 *
 * Every derived fact AcreOS computes about a parcel from free public layers
 * carries, on the fact itself:
 *   - its SOURCES (name, URL, the date WE retrieved it, the source's own
 *     as-of date where the layer publishes one);
 *   - a CONFIDENCE drawn from the rubric below — never a free-floating number;
 *   - the METHOD in one sentence, so a customer (or an auditor) can repeat it.
 *
 * A fact that cannot be computed honestly is `status: "unavailable"` with a
 * reason and a null value. It is never defaulted, guessed, or filled from a
 * paid feed (refuse-not-fabricate; Regrid data never builds or validates the
 * owned dataset — licence).
 *
 * This module is browser-safe (shared/): types and pure helpers only.
 */

/** The facts the W2 pipeline computes. Stable ids — never renamed. */
export const PARCEL_FACT_KEYS = [
  "road_frontage_m",
  "legal_access_indication",
  "buildable_acres",
  "public_land_adjacent",
  "distance_to_transmission_km",
  "distance_to_town_km",
  "out_of_state_owner",
] as const;

export type ParcelFactKey = (typeof PARCEL_FACT_KEYS)[number];

/**
 * Confidence rubric (one vocabulary, every fact):
 *  - "high":   computed from an authoritative layer whose positional accuracy
 *              is finer than the threshold the fact depends on.
 *  - "medium": computed from authoritative layers, but the answer depends on
 *              a geometric tolerance comparable to the layers' accuracy (GIS
 *              parcel lines and TIGER centerlines are not survey-grade).
 *  - "low":    computed, but at least one input is stale (an archived layer)
 *              or a proxy (transmission lines standing in for "power").
 */
export type FactConfidence = "high" | "medium" | "low";

export interface FactSource {
  /** Canonical source name — must exist in the data-licence register. */
  name: string;
  /** The service or file the bytes came from. */
  url: string;
  /** ISO date (YYYY-MM-DD) we retrieved the layer. */
  retrievedOn: string;
  /** The layer's own published as-of / edition, when it states one. */
  sourceAsOf?: string | null;
}

export type AccessIndication =
  /** A public road centerline runs along or through the parcel. */
  | "public_road_contact"
  /**
   * Only a road class that does not give access touches it: a private drive,
   * a 4WD trail, a walkway, or a limited-access highway (no driveway rights).
   */
  | "non_access_road_contact_only"
  /** No road centerline within the tolerance — possibly landlocked. */
  | "no_road_contact";

export interface BuildableBreakdown {
  parcelAcres: number;
  steepAcres: number;
  wetlandAcres: number;
  floodAcres: number;
  /** Slope threshold (percent) above which ground counts as not buildable. */
  slopeThresholdPct: number;
}

export interface ParcelFactValueMap {
  road_frontage_m: number;
  legal_access_indication: AccessIndication;
  buildable_acres: { acres: number; breakdown: BuildableBreakdown };
  public_land_adjacent: { adjacent: boolean; units: Array<{ name: string; manager: string }> };
  distance_to_transmission_km: { km: number; voltageClass: string | null };
  distance_to_town_km: { km: number; town: string };
  out_of_state_owner: { outOfState: boolean; mailingState: string };
}

interface FactBase<K extends ParcelFactKey> {
  key: K;
  method: string;
  sources: FactSource[];
}

export interface ComputedFact<K extends ParcelFactKey> extends FactBase<K> {
  status: "computed";
  value: ParcelFactValueMap[K];
  confidence: FactConfidence;
}

export interface UnavailableFact<K extends ParcelFactKey> extends FactBase<K> {
  status: "unavailable";
  value: null;
  confidence: null;
  /** Plain-words reason the fact could not be computed. */
  reason: string;
}

export type ParcelFact<K extends ParcelFactKey = ParcelFactKey> = K extends ParcelFactKey
  ? ComputedFact<K> | UnavailableFact<K>
  : never;

export type ParcelFactSet = { [K in ParcelFactKey]: ComputedFact<K> | UnavailableFact<K> };

/** Customer-facing labels — plain words, no jargon. */
export const PARCEL_FACT_LABELS: Record<ParcelFactKey, string> = {
  road_frontage_m: "Road frontage",
  legal_access_indication: "Road access (indication)",
  buildable_acres: "Buildable acres",
  public_land_adjacent: "Next to public land",
  distance_to_transmission_km: "Distance to a transmission line",
  distance_to_town_km: "Distance to the nearest town",
  out_of_state_owner: "Out-of-state owner",
};

export function unavailable<K extends ParcelFactKey>(
  key: K,
  reason: string,
  method: string,
  sources: FactSource[] = [],
): UnavailableFact<K> {
  return { key, status: "unavailable", value: null, confidence: null, reason, method, sources };
}

export function isComputed<K extends ParcelFactKey>(
  f: ComputedFact<K> | UnavailableFact<K>,
): f is ComputedFact<K> {
  return f.status === "computed";
}
