/**
 * The anti-corruption boundary between the provider layer and the Evidence
 * Fabric (BI175).
 *
 * This is the ONE place an `EnrichmentResult` — a provider-shaped object — is
 * allowed to become AcreOS `EvidenceClaimInput`s. Everything downstream
 * (resolution, decision snapshots, Pax context, the evidence chip) sees only
 * the canonical vocabulary, which is what keeps Law 10 true as vendors change.
 *
 * TWO RULES THIS FILE OBEYS ABSOLUTELY
 * ------------------------------------
 * 1. NO SOURCE, NO CLAIM. A value is emitted only when
 *    `EnrichmentResult.provenance[category]` names the authoritative source it
 *    came from. A claim whose provenance is "somewhere in an enrichment run" is
 *    not evidence — it is the unattributed field this whole layer exists to
 *    abolish. Values without provenance are skipped, not guessed at, not
 *    attributed to the adapter. (refuse-not-fabricate.)
 *
 * 2. RAW FACTS ONLY, NEVER DERIVED SCORES. `hazards.floodRisk`
 *    ("low"|"medium"|"high"), `overallRiskScore`, `accessScore` and the other
 *    computed fields are AcreOS's own arithmetic over the raw layers, not
 *    observations of the world. Recording them as claims would let a derived
 *    score become an evidence-backed fact — exactly the failure BI177 forbids
 *    ("never let a derived AI score become the only surviving fact"). They stay
 *    where they are, recomputable from the claims that back them.
 *
 * WHY `asOf` PARSING IS CONSERVATIVE
 * ----------------------------------
 * The broker's `asOf` is a grab-bag: an ISO date, a bare year ("2024"), or the
 * cache timestamp. A year is widened to its January 1st — deliberately the
 * EARLIEST instant it could mean, so a fact never reads fresher than it is.
 * Anything unparseable becomes `null`, and the resolution policy then ages the
 * claim from `fetchedAt` instead, which is also conservative.
 */

import type {
  EnrichmentResult,
  EnrichmentProvenance,
} from "../propertyEnrichment";
import type {
  EvidenceAuthority,
  EvidenceClaimInput,
} from "@shared/evidence/claim";

/**
 * Open/government layers reached through the broker are systems of record for
 * the facts they publish, so their observations are `authoritative`. This is
 * the same judgement `DataClassification` already encodes for the registry
 * providers; the broker path had no equivalent, so it is stated here once.
 */
const BROKER_AUTHORITY: EvidenceAuthority = "authoritative";

/** ISO date, bare year, or nothing. Never invents precision it does not have. */
function parseAsOf(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  // A bare 4-digit year means "sometime in that year" — take Jan 1, the
  // earliest instant it could mean, so the fact never reads fresher than it is.
  if (/^\d{4}$/.test(raw)) {
    const y = Number(raw);
    if (y < 1900 || y > 2200) return null;
    return new Date(Date.UTC(y, 0, 1));
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface EmitContext {
  propertyId: number;
  fetchedAt: Date;
  provenance: Record<string, EnrichmentProvenance> | undefined;
}

/**
 * Build one claim, or nothing at all.
 *
 * Returns `null` — emitting no claim — when the value is absent OR when the
 * category has no named provenance. Both are the honest outcome: an
 * unattributed value is not evidence, and a missing value must stay missing so
 * that resolution reports `unknown` rather than a coerced default.
 */
function emit(
  ctx: EmitContext,
  category: string,
  predicate: string,
  subjectType: "property" | "parcel",
  value: string | number | boolean | null | undefined,
): EvidenceClaimInput | null {
  if (value === undefined || value === null) return null;
  const prov = ctx.provenance?.[category];
  if (!prov?.source) return null; // rule 1: no source, no claim

  return {
    subjectType,
    // Parcel has no table of its own yet (it is conflated into `properties` —
    // see CANONICAL_OBJECTS in shared/architecture/canon.ts), so a parcel claim
    // is keyed by the property id that currently carries the cadastral identity.
    // When Parcel separates, this becomes a backfill of subject_id, not a
    // re-interpretation of what was claimed.
    subjectId: ctx.propertyId,
    predicate,
    value,
    provider: "open-data-broker",
    source: prov.source,
    authority: BROKER_AUTHORITY,
    observedAt: parseAsOf(prov.asOf),
    fetchedAt: ctx.fetchedAt,
    providerConfidence: null,
    license: null,
    // Broker categories are free/open sources; paid lookups arrive through the
    // provider registry, which carries its own costCents.
    costCents: 0,
  };
}

/**
 * Convert one enrichment run into claims.
 *
 * Emits ONLY raw observations that carry named provenance. An enrichment that
 * produced twelve fields but attributed none of them yields zero claims — and
 * that is the correct, honest result, not a bug to work around.
 */
export function claimsFromEnrichment(
  propertyId: number,
  enrichment: EnrichmentResult,
): EvidenceClaimInput[] {
  const ctx: EmitContext = {
    propertyId,
    fetchedAt: enrichment.enrichedAt ? new Date(enrichment.enrichedAt) : new Date(),
    provenance: enrichment.provenance,
  };

  const out: (EvidenceClaimInput | null)[] = [
    // ── Cadastral identity + assessment (category: parcel_data) ──
    emit(ctx, "parcel_data", "parcel.apn", "parcel", enrichment.parcel?.apn),
    emit(
      ctx,
      "parcel_data",
      "parcel.legal_description",
      "parcel",
      enrichment.parcel?.legalDescription,
    ),
    emit(ctx, "parcel_data", "parcel.acreage", "parcel", enrichment.parcel?.acreage),
    emit(ctx, "parcel_data", "parcel.owner_name", "parcel", enrichment.parcel?.owner),
    emit(
      ctx,
      "parcel_data",
      "property.assessed_value",
      "property",
      enrichment.parcel?.assessedValue,
    ),
    emit(
      ctx,
      "parcel_data",
      "property.tax_amount",
      "property",
      enrichment.parcel?.taxAmount,
    ),

    // ── Hazard layers (raw only — floodRisk/overallRisk* are DERIVED) ──
    emit(
      ctx,
      "flood_zone",
      "property.flood_zone",
      "property",
      enrichment.hazards?.floodZone,
    ),
    emit(
      ctx,
      "wetlands",
      "property.wetlands_present",
      "property",
      enrichment.hazards?.wetlandsPresent,
    ),
    emit(
      ctx,
      "wetlands",
      "property.wetlands_percentage",
      "property",
      enrichment.hazards?.wetlandsPercentage,
    ),

    // ── Soil / environment ──
    emit(ctx, "soil", "property.soil_type", "property", enrichment.environment?.soilType),
    emit(
      ctx,
      "soil",
      "property.septic_rating",
      "property",
      enrichment.environment?.septicRating,
    ),

    // NOTE ON ZONING: `property.zoning` is a registered predicate, but the
    // enrichment pipeline does not currently produce a zoning observation —
    // there is no `zoning` field on EnrichmentResult, only a "zoning" category
    // in the broker's DataCategory union that nothing populates into the
    // result. So no zoning claim is emitted here. The predicate stays
    // registered because `properties.zoning` is a real column that other write
    // paths set; when a source starts producing an attributed zoning
    // observation, it lands here and resolution picks it up with no other
    // change. Emitting an unattributed zoning claim to "fill the gap" is
    // precisely the fabrication this layer exists to abolish.
  ];

  // ── Layers that carry their OWN source string rather than a broker
  //    provenance entry. Handled separately so the "no source, no claim" rule
  //    still holds: the source comes from the sub-object itself.
  const wildfire = enrichment.wildfireHazard;
  if (wildfire?.source && wildfire.whpLabel) {
    out.push({
      subjectType: "property",
      subjectId: propertyId,
      predicate: "property.wildfire_hazard_class",
      value: wildfire.whpLabel,
      provider: "open-data-broker",
      source: wildfire.source,
      authority: BROKER_AUTHORITY,
      observedAt: null,
      fetchedAt: ctx.fetchedAt,
      providerConfidence: null,
      license: null,
      costCents: 0,
    });
  }

  const broadband = enrichment.broadband;
  if (broadband?.source) {
    // `served` is genuinely tri-state upstream: null means UNKNOWN, and it must
    // stay unknown rather than becoming "not served". Only a real boolean is
    // recorded; null emits nothing and resolution reports `unknown`.
    if (typeof broadband.served === "boolean") {
      out.push({
        subjectType: "property",
        subjectId: propertyId,
        predicate: "property.broadband_served",
        value: broadband.served,
        provider: "open-data-broker",
        source: broadband.source,
        authority: BROKER_AUTHORITY,
        observedAt: null,
        fetchedAt: ctx.fetchedAt,
        providerConfidence: null,
        license: null,
        costCents: 0,
      });
    }
    if (typeof broadband.maxDownMbps === "number") {
      out.push({
        subjectType: "property",
        subjectId: propertyId,
        predicate: "property.broadband_max_down_mbps",
        value: broadband.maxDownMbps,
        provider: "open-data-broker",
        source: broadband.source,
        authority: BROKER_AUTHORITY,
        observedAt: null,
        fetchedAt: ctx.fetchedAt,
        providerConfidence: null,
        license: null,
        costCents: 0,
      });
    }
  }

  return out.filter((c): c is EvidenceClaimInput => c !== null);
}
