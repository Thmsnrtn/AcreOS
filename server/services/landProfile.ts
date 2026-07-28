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
import {
  sampleParcelTerrain,
  formatSlopeValue,
  type TerrainSampleResult,
} from "./terrain";

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
  // USFS Wildfire Hazard Potential — federal open layer, same tier as the
  // other USDA/USFS system-of-record layers. (No collision with /usfws/:
  // "USFS" is not a substring match for the NWI entry above, and vice versa.)
  { match: /usfs|wildfire hazard/i, confidence: 85 },
  // FCC National Broadband Map (BDC) — the federal system of record for
  // availability, but the underlying coverage is ISP-SELF-REPORTED and known
  // to overstate service, so it sits below county GIS (80), well above
  // anything modeled.
  { match: /fcc|broadband/i, confidence: 75 },
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

/**
 * Format the USFS Wildfire Hazard Potential into a display value, 1:1 from
 * the layer's own class label — NEVER derived from land cover/climate. An
 * unknown or missing label returns null (honest gap), never a guess.
 */
const WHP_LABEL_DISPLAY: Record<string, string> = {
  very_low: "Very low",
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
};

export function formatWildfireHazardValue(
  whpLabel: string | null | undefined,
  whpClass: number | null | undefined
): string | null {
  const display = whpLabel ? WHP_LABEL_DISPLAY[whpLabel] : undefined;
  if (!display) return null;
  return typeof whpClass === "number" && Number.isFinite(whpClass)
    ? `${display} (WHP class ${whpClass} of 5)`
    : display;
}

/**
 * Format the FCC BDC broadband availability into a display value from ONLY
 * the parts the lookup actually returned. Unknown service status (`served`
 * not a real boolean) returns null — an honest gap, never "not served".
 */
export function formatBroadbandValue(bb: {
  served?: boolean | null;
  maxDownMbps?: number | null;
  maxUpMbps?: number | null;
  technologies?: string[];
  providerCount?: number | null;
}): string | null {
  if (typeof bb.served !== "boolean") return null;
  if (!bb.served) return "Not served (no fixed broadband reported)";
  const parts: string[] = ["Served"];
  if (typeof bb.maxDownMbps === "number" && Number.isFinite(bb.maxDownMbps)) {
    const up =
      typeof bb.maxUpMbps === "number" && Number.isFinite(bb.maxUpMbps)
        ? `/${bb.maxUpMbps}`
        : "";
    parts.push(`up to ${bb.maxDownMbps}${up} Mbps`);
  }
  if (typeof bb.providerCount === "number" && bb.providerCount > 0) {
    parts.push(`${bb.providerCount} provider${bb.providerCount === 1 ? "" : "s"}`);
  }
  if (Array.isArray(bb.technologies) && bb.technologies.length > 0) {
    parts.push(bb.technologies.join(", "));
  }
  return parts.join(" · ");
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
 * Derive a buildable-percentage BASE estimate from land cover/wetlands. This
 * is a MODELED value — flagged as such so it never reads as an authoritative
 * fact. Honest: returns null when we have nothing to base it on.
 *
 * NOTE: this no longer produces the `slope` field. Slope is REAL (multi-point
 * USGS 3DEP sampling via the terrain service) or an honest gap — never a
 * land-cover proxy.
 */
function buildableEstimate(enrichment: EnrichmentResult): number | null {
  const landCover = enrichment.landCover;
  const wetlandsPct = enrichment.hazards?.wetlandsPercentage;
  if (landCover?.isWetland || (typeof wetlandsPct === "number" && wetlandsPct >= 50)) {
    return 20; // Wetland-dominated — limited buildable area
  }
  if (landCover?.isDeveloped) return 90;
  if (landCover?.isForested) return 70; // clearing likely required
  if (landCover?.isAgricultural || landCover?.className) return 85;
  return null;
}

/**
 * Down-weight the land-cover buildable estimate by the REAL sampled max
 * grade. Conservative step factors, not a pretend engineering model.
 */
function slopeBuildableFactor(maxSlopePercent: number): number {
  if (maxSlopePercent < 8) return 1;
  if (maxSlopePercent < 15) return 0.85;
  if (maxSlopePercent < 25) return 0.6;
  return 0.35;
}

/**
 * Assemble a LandProfile from a property record + its enrichment result.
 *
 * @param property   the property (for coordinates + any owner/legal from county)
 * @param enrichment the (possibly cached) EnrichmentResult; may be null/empty
 * @param fromCache  whether the enrichment came from a cache hit / persisted DB
 * @param terrain    REAL multi-point USGS 3DEP sampling result (terrain
 *                   service). undefined/null = sampling not attempted on this
 *                   path (slope stays an honest "not_looked_up" gap);
 *                   `{ ok: false }` = attempted and failed (gap with the
 *                   sampler's reason). We NEVER fall back to the old
 *                   land-cover proxy for slope.
 */
export function assembleLandProfile(
  property: Pick<
    Property,
    "id" | "latitude" | "longitude" | "sizeAcres" | "legalDescription"
  >,
  enrichment: EnrichmentResult | null | undefined,
  fromCache: boolean,
  terrain?: TerrainSampleResult | null
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

  // ── Septic suitability (USDA SSURGO septic interpretation) ────
  // Rides on the existing "soil" category. The category can carry a per-datum
  // source for the septic rating specifically (septicRatingSource); prefer it
  // over the category-level provenance so the chip names the actual layer.
  const septicSource = enrichment?.environment?.septicRatingSource;
  fields.septicSuitability = field<string>(
    enrichment?.environment?.septicRating,
    septicSource
      ? {
          source: septicSource,
          asOf: prov["soil"]?.asOf ?? null,
          fromCache: prov["soil"]?.fromCache ?? false,
        }
      : prov["soil"],
    { fallbackSource: "USDA NRCS SDA", classification: "authoritative" }
  );

  // ── Wildfire hazard (USFS Wildfire Hazard Potential) ──────────
  // Formatted 1:1 from the layer's own class label — an unknown label is an
  // honest gap, never a guess from land cover or climate.
  fields.wildfireHazard = field<string>(
    formatWildfireHazardValue(
      enrichment?.wildfireHazard?.whpLabel,
      enrichment?.wildfireHazard?.whpClass
    ),
    prov["wildfire_hazard"],
    {
      fallbackSource: "USFS Wildfire Hazard Potential",
      classification: "authoritative",
    }
  );

  // ── Slope: REAL multi-point USGS 3DEP sampling, or an honest gap ──
  // Never the old land-cover proxy. Aspect is the real gradient azimuth.
  if (terrain?.ok) {
    fields.slope = {
      value: formatSlopeValue(terrain.summary),
      source: "USGS 3DEP (EPQS multi-point)",
      asOf: null,
      // Derived from authoritative 1m DEM samples — high, but below a pure
      // system-of-record fact (the /3dep|usgs/ point layers sit at 90).
      confidence: 85,
      classification: "estimate",
    };
  }

  // ── Buildable % (MODELED from land cover, refined by REAL slope) ──
  let buildablePct = buildableEstimate(enrichment ?? ({} as EnrichmentResult));
  let buildableSource = "AcreOS (modeled from land cover)";
  let buildableConfidence = 50;
  if (buildablePct !== null && terrain?.ok) {
    buildablePct = Math.round(
      buildablePct * slopeBuildableFactor(terrain.summary.maxSlopePercent)
    );
    buildableSource = "AcreOS (modeled from land cover + USGS 3DEP slope)";
    buildableConfidence = 60; // still modeled, but slope-backed
  }
  if (buildablePct !== null) {
    // Built directly (not via field()) so the source ALWAYS reads as the
    // AcreOS model — never inherits an upstream layer's name for a modeled
    // number.
    fields.buildablePercentage = {
      value: buildablePct,
      source: buildableSource,
      asOf: null,
      confidence: buildableConfidence,
      classification: "modeled",
    };
  }

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

  // ── Broadband (FCC National Broadband Map / BDC) ──────────────
  // Formatted from ONLY the parts the lookup returned; an unknown `served`
  // status stays a gap (never coalesced to "not served"). A REAL false is
  // honest and populates the field.
  fields.broadband = field<string>(
    enrichment?.broadband ? formatBroadbandValue(enrichment.broadband) : null,
    prov["broadband"],
    {
      fallbackSource: "FCC National Broadband Map (BDC)",
      classification: "authoritative",
    }
  );

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
      reason: gapReason(key, errors, enrichment, terrain),
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
  enrichment: EnrichmentResult | null | undefined,
  terrain?: TerrainSampleResult | null
): LandProfileGap["reason"] {
  // Slope is backed by the terrain sampler (real 3DEP), not the enrichment
  // "elevation" category: report ITS honest outcome.
  if (fieldKey === "slope") {
    if (terrain && !terrain.ok) {
      return terrain.reason === "lookup_failed" ? "lookup_failed" : "no_data";
    }
    // Sampling not attempted on this (sync/cached) path.
    return "not_looked_up";
  }
  const category = FIELD_TO_CATEGORY[fieldKey];
  if (!enrichment) return "not_looked_up";
  if (category && errors[category]) return "lookup_failed";
  // Wave-2 fields: an OLDER cached enrichment may simply never have attempted
  // their backing category. No provenance and no error for the category means
  // "not looked up" — NOT "no data at this location". (Pre-existing fields
  // keep their original semantics untouched.)
  if (
    WAVE2_FIELDS.has(fieldKey) &&
    category &&
    !enrichment.provenance?.[category]
  ) {
    return "not_looked_up";
  }
  // power access has no backing free category — it's a structural gap, present
  // it as "no_data" (we looked at what we have and have nothing).
  return "no_data";
}

/** Fields added in wave 2, whose category may be absent from older caches. */
const WAVE2_FIELDS: ReadonlySet<keyof LandProfileFields> = new Set([
  "wildfireHazard",
  "broadband",
  "septicSuitability",
]);

/**
 * Which broker category backs each LandProfile field (for gap reasons).
 * `slope` is intentionally absent — it is backed by the terrain sampler
 * (real 3DEP EPQS), handled explicitly in gapReason. `buildablePercentage`
 * maps to land_cover because that is the model's actual input.
 */
const FIELD_TO_CATEGORY: Partial<Record<keyof LandProfileFields, string>> = {
  acreage: "parcel_data",
  owner: "parcel_data",
  legalDescription: "parcel_data",
  plss: "plss",
  floodZone: "flood_zone",
  wetlandsPercentage: "wetlands",
  soilCapabilityClass: "soil",
  septicSuitability: "soil",
  wildfireHazard: "wildfire_hazard",
  broadband: "broadband",
  buildablePercentage: "land_cover",
  roadAccess: "transportation",
  waterAccess: "water_resources",
  landCover: "land_cover",
  agValuePerAcre: "agricultural_values",
};

/**
 * Assemble a LandProfile WITH live multi-point 3DEP terrain sampling.
 *
 * Async convenience over `assembleLandProfile`: samples real slope/aspect via
 * the terrain service (5–9 EPQS points scaled to parcel size) and feeds the
 * result in. On sampler failure the slope field stays an honest gap with the
 * sampler's reason — never the old land-cover proxy. Callers that must stay
 * sync (or serve pure cache hits) keep calling `assembleLandProfile` and get
 * a "not_looked_up" slope gap.
 */
export async function assembleLandProfileWithTerrain(
  property: Pick<
    Property,
    "id" | "latitude" | "longitude" | "sizeAcres" | "legalDescription"
  >,
  enrichment: EnrichmentResult | null | undefined,
  fromCache: boolean
): Promise<LandProfile> {
  const lat = property.latitude ? parseFloat(String(property.latitude)) : NaN;
  const lng = property.longitude ? parseFloat(String(property.longitude)) : NaN;
  let terrain: TerrainSampleResult | undefined;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const acres =
      enrichment?.parcel?.acreage ??
      (property.sizeAcres ? parseFloat(String(property.sizeAcres)) : null);
    try {
      terrain = await sampleParcelTerrain(lat, lng, Number.isFinite(acres as number) ? (acres as number) : null);
    } catch {
      terrain = {
        ok: false,
        reason: "lookup_failed",
        detail: "terrain sampler threw",
        validPoints: 0,
        totalPoints: 0,
        centerElevationFeet: null,
      };
    }
  }
  return assembleLandProfile(property, enrichment, fromCache, terrain);
}
