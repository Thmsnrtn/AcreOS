/**
 * LandProfile — the canonical, decision-grade parcel object.
 *
 * Investors want ONE answer to "should I look harder at this parcel?", not
 * nine scattered cards. The LandProfile is the single normalized object the
 * product assembles, server-side, from the EXISTING free open-data enrichment
 * (FEMA NFHL flood, USDA SSURGO soils, USFWS NWI wetlands, USGS 3DEP
 * elevation, NLCD land cover, USDA NASS ag value, county GIS parcel, …).
 *
 * Every field carries its own provenance — { value, source, asOf, confidence,
 * classification } — so the customer sees exactly where each number came from,
 * how old it is, and how much we trust it. A real "Unknown" outperforms a fake
 * number: when we don't have a field we OMIT it and list it in `gaps`, we never
 * fabricate a default.
 *
 * This type is shared (client + server). The server populates it; the client
 * renders the "Land Snapshot". Pax reads it; it never reads raw provider blobs.
 */

/**
 * Provenance classification for a single datum (mirrors
 * server/services/providers/types.ts DataClassification — kept structurally
 * identical so a LandField can be fed straight into <DataProvenanceChip>).
 *  - "authoritative": a system-of-record fact (federal/open layer, county
 *    assessor of record). Reliable modulo freshness.
 *  - "estimate": data-backed but derived/heuristic.
 *  - "modeled": output of a computed score/model — NEVER present as a fact.
 *  - "unknown": we have no value. Such a field is OMITTED from the profile and
 *    surfaced in `gaps` instead; it should not appear as a populated LandField.
 */
export type LandFieldClassification =
  | "authoritative"
  | "estimate"
  | "modeled"
  | "unknown";

/**
 * A single decision-grade datum with its full provenance. Generic over the
 * value type so e.g. `acreage` is a LandField<number> and `floodZone` is a
 * LandField<string>.
 */
export interface LandField<T> {
  /** The actual value. Never a fabricated default — if unknown, the field is omitted. */
  value: T;
  /**
   * Human-readable authoritative source name, e.g. "FEMA NFHL", "USDA SSURGO",
   * "County GIS". This is what the provenance chip shows the customer.
   */
  source: string;
  /**
   * ISO date (or year-only string) the AUTHORITATIVE source last updated this
   * fact — e.g. the FEMA effective date or county tax year. Null when the
   * upstream layer exposes no freshness metadata. Distinct from when WE pulled.
   */
  asOf: string | null;
  /** 0–100 confidence, derived from source authority + data age. */
  confidence: number;
  /** How the customer should treat the value. */
  classification: LandFieldClassification;
}

/** A known field we could NOT populate, with the reason (honest-gaps list). */
export interface LandProfileGap {
  /** Stable key matching the LandProfile field name, e.g. "soilCapabilityClass". */
  field: keyof LandProfileFields;
  /** Customer-facing label, e.g. "Soil capability class". */
  label: string;
  /**
   * Why it's missing: "not_looked_up" (no enrichment run / category not
   * attempted), "no_data" (looked up, source had no value here), or
   * "lookup_failed" (the source errored / was unavailable).
   */
  reason: "not_looked_up" | "no_data" | "lookup_failed";
}

/**
 * The decision fields. Each is OPTIONAL: present (a populated LandField) when we
 * have an honest value, absent when we don't (then it appears in `gaps`).
 *
 * Six fields decide a land deal — flood, soil, wetlands, acreage, slope/
 * buildable, and road/water/power access — so those lead. The rest are
 * supporting context, all from the same free sources we already query.
 */
export interface LandProfileFields {
  // ── Identity / size ──────────────────────────────────────────
  acreage?: LandField<number>;
  owner?: LandField<string>;
  legalDescription?: LandField<string>;
  /** PLSS section / township / range, formatted, e.g. "SEC 14 T2N R3W". */
  plss?: LandField<string>;

  // ── The buy/no-buy decision fields ───────────────────────────
  /** FEMA flood zone, e.g. "Zone X", "Zone AE". */
  floodZone?: LandField<string>;
  /** Percentage of the parcel mapped as wetlands (0–100). */
  wetlandsPercentage?: LandField<number>;
  /** USDA land capability class, e.g. "II", "IV". */
  soilCapabilityClass?: LandField<string>;
  /** Estimated buildable percentage derived from slope/elevation (modeled). */
  buildablePercentage?: LandField<number>;
  /** Slope characterization, e.g. "Gentle (<8%)" or an elevation note. */
  slope?: LandField<string>;

  // ── Access flags ─────────────────────────────────────────────
  roadAccess?: LandField<boolean>;
  waterAccess?: LandField<boolean>;
  powerAccess?: LandField<boolean>;

  // ── Supporting context ───────────────────────────────────────
  /** NLCD land-cover class name, e.g. "Pasture/Hay", "Deciduous Forest". */
  landCover?: LandField<string>;
  /** USDA NASS ag land value, $/acre (estimate). */
  agValuePerAcre?: LandField<number>;
}

export interface LandProfile extends LandProfileFields {
  propertyId?: number;
  latitude: number;
  longitude: number;
  /** When this profile was assembled (ISO). */
  assembledAt: string;
  /** True when assembled from a cache hit (the warm, fast path). */
  fromCache: boolean;
  /** Honest "what we don't know yet" — fields we could not populate. */
  gaps: LandProfileGap[];
  /** Count of populated decision fields / total tracked, for a completeness read. */
  fieldsPopulated: number;
  fieldsTotal: number;
}

/** Ordered list of the fields we track + their customer-facing labels. */
export const LAND_PROFILE_FIELD_LABELS: Record<keyof LandProfileFields, string> = {
  acreage: "Acreage",
  owner: "Owner of record",
  legalDescription: "Legal description",
  plss: "PLSS legal (section/township/range)",
  floodZone: "Flood zone",
  wetlandsPercentage: "Wetlands",
  soilCapabilityClass: "Soil capability class",
  buildablePercentage: "Buildable area",
  slope: "Slope / terrain",
  roadAccess: "Road access",
  waterAccess: "Water access",
  powerAccess: "Power access",
  landCover: "Land cover",
  agValuePerAcre: "Ag land value",
};

/** The fields, in display order. */
export const LAND_PROFILE_FIELD_ORDER: Array<keyof LandProfileFields> = [
  "acreage",
  "floodZone",
  "wetlandsPercentage",
  "soilCapabilityClass",
  "buildablePercentage",
  "slope",
  "roadAccess",
  "waterAccess",
  "powerAccess",
  "owner",
  "plss",
  "legalDescription",
  "landCover",
  "agValuePerAcre",
];
