/**
 * maps-intel — the HONESTY CONTRACT for the Map door's property intelligence.
 *
 * This module is intentionally pure (no React, no UI imports) so the data-
 * honesty rules can be unit-tested in isolation. The single most dangerous
 * thing this product can do is show a land investor a confident, fabricated
 * parcel fact. This file is where we guarantee we never do.
 */

export interface PropertyIntelligence {
  estimatedValue?: number;
  /** True when estimatedValue is the customer's own list price, not a modeled AVM. */
  estimatedValueIsListPrice?: boolean;
  valueConfidence?: number;
  pricePerAcre?: number;
  marketTrend?: "up" | "down" | "flat";
  marketTrendPct?: number;
  slopeGrade?: number;
  slopeRisk?: "low" | "moderate" | "high";
  /** Real azimuth in degrees from terrain data, if pulled. Never derived from coordinates. */
  slopeAspect?: number;
  solarScore?: number;
  floodZone?: string;
  floodRisk?: "minimal" | "moderate" | "high";
  soilQuality?: number;
  waterAccess?: boolean;
  roadAccess?: boolean;
  powerAccess?: boolean;
  zoningCode?: string;
  zoningDescription?: string;
  opportunityScore?: number;
  daysOnMarket?: number;
  lastAssessedValue?: number;
  annualTaxes?: number;
  // Provenance (optional — populated when the data contract carries it).
  source?: string;
  sourceAsOf?: string | Date | null;
  classification?: "authoritative" | "estimate" | "modeled" | "unknown";
}

/** The numeric/score fields a customer could mistake for an authoritative fact. */
export const INTEL_NUMERIC_FIELDS = [
  "valueConfidence",
  "marketTrendPct",
  "slopeGrade",
  "slopeAspect",
  "solarScore",
  "soilQuality",
  "opportunityScore",
] as const;

/**
 * Pure mapping from the AVM/enrichment payload + property record into the
 * intelligence panel's view-model. This is the HONESTY CONTRACT in one place:
 *
 *   - Every field is either a value the lookup actually returned, or a value
 *     the customer themselves supplied (their list price, the zoning on the
 *     record). Nothing else.
 *   - We NEVER coalesce a missing fact to a plausible constant. A missing
 *     flood zone stays `undefined` (it does NOT default to "X"/safe); a missing
 *     slope stays `undefined` (it is NOT derived from a trig hash of the
 *     coordinates); access flags stay `undefined` (NOT silently `false`).
 *   - The UI renders every `undefined` as an explicit "Not yet pulled · Check
 *     now" affordance — never a number.
 *
 * A wrong number on a land deal is a five-figure mistake; an honest gap is just
 * an honest gap.
 */
export function deriveIntel(
  avmData: { valuation?: Record<string, any> | null } | null | undefined,
  property: {
    listPrice?: string | number | null;
    sizeAcres?: string | number | null;
    zoning?: string | null;
  },
): PropertyIntelligence {
  const avm = avmData?.valuation ?? undefined;
  const acres = parseFloat(String(property.sizeAcres || "0"));
  // List price is a customer-entered fact, so deriving estimatedValue /
  // pricePerAcre from it (clearly labelled in the UI as "list price") is honest.
  const listPriceRaw =
    property.listPrice != null && property.listPrice !== ""
      ? parseFloat(String(property.listPrice))
      : undefined;
  const listPrice =
    listPriceRaw != null && !Number.isNaN(listPriceRaw) ? listPriceRaw : undefined;
  const hasListPrice = listPrice != null;

  return {
    estimatedValue: avm?.estimatedValue ?? (acres > 0 && hasListPrice ? listPrice : undefined),
    estimatedValueIsListPrice: avm?.estimatedValue == null && acres > 0 && hasListPrice,
    valueConfidence: avm?.confidence,
    pricePerAcre:
      avm?.pricePerAcre ?? (acres > 0 && hasListPrice ? (listPrice as number) / acres : undefined),
    marketTrend: avm?.marketTrend,
    marketTrendPct: avm?.marketTrendPct,
    slopeGrade: avm?.slopeGrade,
    slopeRisk: avm?.slopeRisk,
    slopeAspect: avm?.slopeAspect,
    solarScore: avm?.solarScore,
    floodZone: avm?.floodZone,
    floodRisk: avm?.floodRisk,
    soilQuality: avm?.soilQuality,
    // Access flags only render when the lookup actually returned a boolean —
    // an absent flag is "unknown", not "false" (don't imply "no road access").
    waterAccess: typeof avm?.waterAccess === "boolean" ? avm.waterAccess : undefined,
    roadAccess: typeof avm?.roadAccess === "boolean" ? avm.roadAccess : undefined,
    powerAccess: typeof avm?.powerAccess === "boolean" ? avm.powerAccess : undefined,
    // Zoning on the property record is a customer/county fact; AVM may enrich it.
    zoningCode: property.zoning ?? avm?.zoningCode,
    zoningDescription: avm?.zoningDescription,
    opportunityScore: avm?.opportunityScore,
    // Provenance (optional — lights up when the server contract ships these).
    source: avm?.source,
    sourceAsOf: avm?.sourceAsOf,
    classification: avm?.classification,
    daysOnMarket: avm?.daysOnMarket,
    lastAssessedValue: avm?.lastAssessedValue,
    annualTaxes: avm?.annualTaxes,
  };
}
