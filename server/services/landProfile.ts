/**
 * Land Profile service — assemble the canonical, decision-grade LandProfile from
 * the EXISTING free open-data enrichment. No new data sources: this composes the
 * current `EnrichmentResult` (FEMA flood, SSURGO soil, NWI wetlands, 3DEP
 * elevation, NLCD land cover, NASS ag value, PLSS, county parcel) into ONE
 * normalized object with per-field provenance + an honest "what we don't know
 * yet" gaps list.
 *
 * Honesty contract (Maren/Quinn lens): we NEVER fabricate a value. If a field
 * cannot be honestly populated it is OMITTED from the profile and surfaced in
 * `gaps` with a reason. A real "Unknown" outperforms a fake number.
 */

import type {
  LandProfile,
  LandField,
  LandFieldClassification,
  LandProfileGap,
  LandProfileFields,
} from "@shared/landProfile";
import {
  LAND_PROFILE_FIELD_LABELS,
  LAND_PROFILE_FIELD_ORDER,
} from "@shared/landProfile";
import type { Property } from "@shared/schema";
import type { EnrichmentResult, EnrichmentProvenance } from "./propertyEnrichment";

/**
 * Default confidence by source authority. Federal/open system-of-record layers
 * are high; modeled/derived values are lower. Used when the broker doesn't carry
 * a numeric confidence (it currently doesn't on the free path).
 */
const SOURCE_CONFIDENCE: Array<{ match: RegExp; confidence: number }> = [
  { match: /fema/i, confidence: 90 },
  { match: /nwi|fish.*wildlife|usfws/i, confidence: 88 },
  { match: /nrcs|ssurgo|sda|usda soil/i, confidence: 85 },
  { match: /3dep|usgs/i, confidence: 90 },
  { match: /nlcd|mrlc/i, confidence: 82 },
  { match: /nass|ers/i, confidence: 70 },
  { match: /blm|cadnsdi|plss/i, confidence: 85 },
  { match: /county|assessor|gis/i, confidence: 80 },
  { match: /open-elevation|srtm/i, confidence: 65 },
];

function confidenceForSource(source: string | undefined): number {
  if (!source) return 70;
  for (const { match, confidence } of SOURCE_CONFIDENCE) {
    if (match.test(source)) return confidence;
  }
  return 70;
}

/**
 * Build one provenanced LandField. Returns undefined when the value is missing
 * (null/undefined/empty/NaN) so the caller can record a gap instead — we never
 * emit a LandField with a fabricated value.
 */
function field<T>(
  value: T | null | undefined,
  prov: EnrichmentProvenance | undefined,
  opts: {
    fallbackSource: string;
    classification: LandFieldClassification;
    /** Override confidence (e.g. for modeled values). */
    confidence?: number;
  }
): LandField<T> | undefined {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value === "number" && Number.isNaN(value))
  ) {
    return undefined;
  }
  const source = prov?.source || opts.fallbackSource;
  const confidence =
    opts.confidence ?? confidenceForSource(source);
  return {
    value,
    source,
    asOf: prov?.asOf ?? null,
    confidence,
    classification: opts.classification,
  };
}

/** Map a USDA soil suitability/capability into a capability-class string. */
function soilCapabilityClass(env: EnrichmentResult["environment"]): string | null {
  // The broker exposes capabilityClass inside the soil category's raw data, but
  // EnrichmentResult only carries soilType + soilSuitability. We surface the
  // suitability as the honest, available signal when no explicit class exists.
  const suitability = env?.soilSuitability;
  if (!suitability) return null;
  return suitability;
}

/**
 * Derive a buildable-percentage estimate from slope/land cover. This is a
 * MODELED value — flagged as such so it never reads as an authoritative fact.
 * Honest: returns null when we have nothing to base it on.
 */
function buildableEstimate(enrichment: EnrichmentResult): {
  buildablePct: number | null;
  slopeNote: string | null;
} {
  const landCover = enrichment.landCover;
  // Without slope rasters we lean on land cover + wetlands as a coarse proxy.
  const wetlandsPct = enrichment.hazards?.wetlandsPercentage;
  if (landCover?.isWetland || (typeof wetlandsPct === "number" && wetlandsPct >= 50)) {
    return { buildablePct: 20, slopeNote: "Wetland-dominated — limited buildable area" };
  }
  if (landCover?.isDeveloped) {
    return { buildablePct: 90, slopeNote: "Developed / open land cover" };
  }
  if (landCover?.isForested) {
    return { buildablePct: 70, slopeNote: "Forested — clearing likely required" };
  }
  if (landCover?.isAgricultural || landCover?.className) {
    return { buildablePct: 85, slopeNote: "Open / agricultural land cover" };
  }
  return { buildablePct: null, slopeNote: null };
}

/**
 * Assemble a LandProfile from a property record + its enrichment result.
 *
 * @param property   the property (for coordinates + any owner/legal from county)
 * @param enrichment the (possibly cached) EnrichmentResult; may be null/empty
 * @param fromCache  whether the enrichment came from a cache hit / persisted DB
 */
export function assembleLandProfile(
  property: Pick<
    Property,
    "id" | "latitude" | "longitude" | "sizeAcres" | "legalDescription"
  >,
  enrichment: EnrichmentResult | null | undefined,
  fromCache: boolean
): LandProfile {
  const lat = property.latitude ? parseFloat(String(property.latitude)) : NaN;
  const lng = property.longitude ? parseFloat(String(property.longitude)) : NaN;
  const prov = enrichment?.provenance ?? {};
  const errors = enrichment?.errors ?? {};

  const fields: LandProfileFields = {};

  // ── Acreage (county parcel > the property record's own size) ──
  const parcelAcreage = enrichment?.parcel?.acreage;
  const sizeAcres = property.sizeAcres ? parseFloat(String(property.sizeAcres)) : null;
  fields.acreage = field<number>(
    parcelAcreage ?? sizeAcres,
    prov["parcel_data"],
    {
      fallbackSource: parcelAcreage ? "County GIS" : "Owner-entered",
      classification: parcelAcreage ? "authoritative" : "estimate",
    }
  );

  // ── Owner / legal (county parcel) ─────────────────────────────
  fields.owner = field<string>(enrichment?.parcel?.owner, prov["parcel_data"], {
    fallbackSource: "County GIS",
    classification: "authoritative",
  });
  fields.legalDescription = field<string>(
    enrichment?.parcel?.legalDescription ?? property.legalDescription,
    prov["parcel_data"],
    { fallbackSource: "County GIS", classification: "authoritative" }
  );

  // ── PLSS legal ────────────────────────────────────────────────
  const plss = enrichment?.plss;
  const plssStr = plss
    ? [plss.section && `SEC ${plss.section}`, plss.township, plss.range]
        .filter(Boolean)
        .join(" ") || plss.legalDescription
    : null;
  fields.plss = field<string>(plssStr, prov["plss"], {
    fallbackSource: "BLM CadNSDI",
    classification: "authoritative",
  });

  // ── Flood zone (FEMA) ─────────────────────────────────────────
  fields.floodZone = field<string>(enrichment?.hazards?.floodZone, prov["flood_zone"], {
    fallbackSource: "FEMA NFHL",
    classification: "authoritative",
  });

  // ── Wetlands % (USFWS NWI) ────────────────────────────────────
  fields.wetlandsPercentage = field<number>(
    enrichment?.hazards?.wetlandsPercentage,
    prov["wetlands"],
    { fallbackSource: "USFWS NWI", classification: "authoritative" }
  );

  // ── Soil capability class (USDA SSURGO) ───────────────────────
  fields.soilCapabilityClass = field<string>(
    soilCapabilityClass(enrichment?.environment),
    prov["soil"],
    { fallbackSource: "USDA NRCS SDA", classification: "authoritative" }
  );

  // ── Buildable % + slope (MODELED from elevation/land cover) ───
  const { buildablePct, slopeNote } = buildableEstimate(
    enrichment ?? ({} as EnrichmentResult)
  );
  fields.buildablePercentage = field<number>(buildablePct, prov["elevation"], {
    fallbackSource: "AcreOS (modeled from land cover)",
    classification: "modeled",
    confidence: 50,
  });
  fields.slope = field<string>(slopeNote, prov["elevation"], {
    fallbackSource: "AcreOS (modeled from land cover)",
    classification: "modeled",
    confidence: 50,
  });

  // ── Access flags ──────────────────────────────────────────────
  // Road access: derived from transportation distance to nearest highway.
  const hwMiles = enrichment?.transportation?.nearestHighwayMiles;
  fields.roadAccess = field<boolean>(
    typeof hwMiles === "number" ? hwMiles <= 1 : null,
    prov["transportation"],
    { fallbackSource: "Census TIGER", classification: "estimate", confidence: 60 }
  );
  // Water access: nearest stream/water body within reach.
  const waterMiles =
    enrichment?.water?.nearestStreamMiles ?? enrichment?.water?.nearestWaterBodyMiles;
  fields.waterAccess = field<boolean>(
    typeof waterMiles === "number" ? waterMiles <= 0.25 : null,
    prov["water_resources"],
    { fallbackSource: "USGS NHD", classification: "estimate", confidence: 55 }
  );
  // Power access is not in any free coordinate layer — intentionally omitted
  // (it lands in `gaps`). We never guess utility availability.

  // ── Land cover (NLCD) ─────────────────────────────────────────
  fields.landCover = field<string>(enrichment?.landCover?.className, prov["land_cover"], {
    fallbackSource: "USGS NLCD",
    classification: "authoritative",
  });

  // ── Ag land value (USDA NASS) ─────────────────────────────────
  const agValue =
    enrichment?.agriculturalValues?.countyAvgPerAcre ??
    enrichment?.agriculturalValues?.stateAvgPerAcre;
  fields.agValuePerAcre = field<number>(agValue, prov["agricultural_values"], {
    fallbackSource: "USDA NASS",
    classification: "estimate",
  });

  // ── Honest gaps: every tracked field we could NOT populate ────
  const gaps: LandProfileGap[] = [];
  let populated = 0;
  for (const key of LAND_PROFILE_FIELD_ORDER) {
    if (fields[key] !== undefined) {
      populated += 1;
      continue;
    }
    gaps.push({
      field: key,
      label: LAND_PROFILE_FIELD_LABELS[key],
      reason: gapReason(key, errors, enrichment),
    });
  }

  return {
    propertyId: property.id,
    latitude: lat,
    longitude: lng,
    assembledAt: new Date().toISOString(),
    fromCache,
    gaps,
    fieldsPopulated: populated,
    fieldsTotal: LAND_PROFILE_FIELD_ORDER.length,
    ...fields,
  };
}

/**
 * Map a missing field to an honest reason:
 *  - "lookup_failed" when the backing category errored,
 *  - "no_data" when enrichment ran but the source had no value here,
 *  - "not_looked_up" when there's no enrichment at all (cold parcel).
 */
function gapReason(
  fieldKey: keyof LandProfileFields,
  errors: Record<string, string>,
  enrichment: EnrichmentResult | null | undefined
): LandProfileGap["reason"] {
  const category = FIELD_TO_CATEGORY[fieldKey];
  if (!enrichment) return "not_looked_up";
  if (category && errors[category]) return "lookup_failed";
  // power access has no backing free category — it's a structural gap, present
  // it as "no_data" (we looked at what we have and have nothing).
  return "no_data";
}

/** Which broker category backs each LandProfile field (for gap reasons). */
const FIELD_TO_CATEGORY: Partial<Record<keyof LandProfileFields, string>> = {
  acreage: "parcel_data",
  owner: "parcel_data",
  legalDescription: "parcel_data",
  plss: "plss",
  floodZone: "flood_zone",
  wetlandsPercentage: "wetlands",
  soilCapabilityClass: "soil",
  buildablePercentage: "elevation",
  slope: "elevation",
  roadAccess: "transportation",
  waterAccess: "water_resources",
  landCover: "land_cover",
  agValuePerAcre: "agricultural_values",
};
