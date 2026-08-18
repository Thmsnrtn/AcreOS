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
 * AUTHORITY BELONGS TO THE SOURCE, NOT TO THE TRANSPORT.
 *
 * This used to be a single module constant holding "authoritative" for every
 * claim that arrived through the broker, justified as "open government layers
 * are systems of record for the facts they publish". That is true of most of
 * them, and the constant named the PIPE rather than the publisher, so it could
 * not express the case where it is not.
 *
 * The broker is a pipe. A pipe has no authority. Which layer published the fact
 * is what decides.
 *
 * Why this is not a style point: `authorityRank` in `@shared/evidence/claim`
 * ranks `authoritative` (3) above `estimate` (2), and resolution takes the
 * higher. So a self-reported figure recorded as `authoritative` does not merely
 * read as overconfident — it WINS against an honest estimate of the same fact.
 */
const SOURCE_AUTHORITY_DEMOTIONS: Array<{
  match: RegExp;
  authority: EvidenceAuthority;
  why: string;
}> = [
  {
    // Matches the broker's own label for the category — "FCC Broadband Data
    // Collection" (SOURCE_LABELS in providers/open-data-provider.ts).
    match: /\bfcc\b|broadband data collection/i,
    authority: "estimate",
    why:
      "The FCC BDC is the federal system of record for availability FILINGS, " +
      "but the coverage it publishes is ISP-SELF-REPORTED and known to " +
      "overstate service. This is not a new judgement: landProfile.ts already " +
      "scores it 75, below county GIS at 80, and says so in as many words. The " +
      "evidence layer contradicted that assessment by recording the same data " +
      "as `authoritative` — the top tier, alongside FEMA flood zones — so a " +
      "carrier's own filing about its own coverage outranked any honest " +
      "estimate of the same fact. Demoted 2026-08-18.",
  },
];

/**
 * The authority of a claim, taken from the layer that published it.
 *
 * Defaults to `authoritative`: the broker's other categories (FEMA NFHL, USDA
 * SSURGO, USFWS NWI, USGS 3DEP, BLM PLSS, county assessor) are genuine systems
 * of record for the facts they publish, and demoting them wholesale would be
 * the same error pointing the other way.
 */
function authorityForSource(source: string | null | undefined): EvidenceAuthority {
  if (!source) return "unknown";
  for (const d of SOURCE_AUTHORITY_DEMOTIONS) {
    if (d.match.test(source)) return d.authority;
  }
  return "authoritative";
}

// Neither the register nor `authorityForSource` is exported. An earlier draft
// exported both so the test could read them directly, and the reachability gate
// said what that shape is: a symbol whose only consumer is its own test. The
// assertions run through `claimsFromEnrichment` instead, which is the surface
// production uses and therefore the stronger place to assert.

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
    authority: authorityForSource(prov.source),
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
      authority: authorityForSource(wildfire.source),
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
        authority: authorityForSource(broadband.source),
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
        authority: authorityForSource(broadband.source),
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
