/**
 * Feeds pre-spend parcel-quality screening (server/services/parcelScreening.ts)
 * from the data that actually exists in production.
 *
 * Signals live on ENRICHED PROPERTIES, not on leads — a lead carries an APN and
 * an address but no environmental signals. So we resolve a campaign's leads to
 * the org's own enriched properties by APN and read `enrichmentData.hazards`
 * (FEMA flood zone, NWI wetlands %). Slope and landlocked need a per-lead
 * LandProfile computation that doesn't exist yet (documented follow-up) — until
 * then those rules simply never fire (fail-open), which is safe.
 *
 * Everything here is defensive: any read failure yields no signals for that
 * lead, so screening can only ever LET MAIL THROUGH on missing data, never
 * suppress a lead the investor wanted.
 */
import { db } from "../db";
import { properties, leads } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../utils/logger";
import { hasActiveRules, type DisqualifierRules, type ParcelSignals } from "./parcelScreening";

/** Read an org's screening rules from its settings. Default = off (no rules). */
export function parseOrgScreeningRules(
  settings: { parcelScreening?: DisqualifierRules } | null | undefined,
): DisqualifierRules {
  const r = settings?.parcelScreening;
  if (!r || typeof r !== "object") return {};
  const rules: DisqualifierRules = {};
  if (Array.isArray(r.floodZones) && r.floodZones.length) {
    rules.floodZones = r.floodZones.filter((z) => typeof z === "string");
  }
  if (typeof r.maxWetlandsPercent === "number") rules.maxWetlandsPercent = r.maxWetlandsPercent;
  if (r.excludeLandlocked === true) rules.excludeLandlocked = true;
  if (typeof r.maxSlopePercent === "number") rules.maxSlopePercent = r.maxSlopePercent;
  return rules;
}

/** Pure, defensive map from a property's enrichmentData jsonb to parcel signals. */
export function enrichmentToSignals(enrichmentData: unknown): ParcelSignals {
  const e = enrichmentData as { hazards?: { floodZone?: unknown; wetlandsPercentage?: unknown } } | null;
  const hazards = e && typeof e === "object" ? e.hazards : undefined;
  const signals: ParcelSignals = {};
  if (hazards && typeof hazards === "object") {
    if (typeof hazards.floodZone === "string") signals.floodZone = hazards.floodZone;
    if (typeof hazards.wetlandsPercentage === "number") signals.wetlandsPercentage = hazards.wetlandsPercentage;
  }
  return signals;
}

/**
 * Resolve cached parcel signals for a set of campaign leads by matching each
 * lead's APN to one of the org's enriched properties. Self-contained (takes
 * leadIds), org-scoped, and fail-open — returns {} for any lead without an
 * enriched match, and {} entirely on any error.
 */
export async function fetchParcelSignalsForLeads(
  organizationId: number,
  leadIds: number[],
): Promise<Record<number, ParcelSignals>> {
  const out: Record<number, ParcelSignals> = {};
  if (leadIds.length === 0) return out;

  try {
    // One org-scoped join: lead.apn → property.apn → enrichmentData.
    const rows = await db
      .select({ leadId: leads.id, enrichmentData: properties.enrichmentData })
      .from(leads)
      .innerJoin(
        properties,
        and(eq(properties.organizationId, organizationId), eq(properties.apn, leads.apn)),
      )
      .where(and(eq(leads.organizationId, organizationId), inArray(leads.id, leadIds)));

    for (const row of rows) {
      if (row.leadId != null) out[row.leadId] = enrichmentToSignals(row.enrichmentData);
    }
  } catch (err) {
    // Fail-open: a lookup failure yields no signals, so nothing is disqualified.
    logger.warn("[campaignParcelSignals] signal fetch failed (non-fatal, fail-open)", {
      metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
    });
  }
  return out;
}

/**
 * Build the optional `parcelScreening` input for runPreMailDedupe. Returns
 * undefined when the org has no active rules (screening OFF → the dedupe call is
 * byte-identical to before). When on, fetches cached signals for the leads.
 * `costPerPieceCents` is used only to compute the projected spend saved.
 */
export async function buildParcelScreeningInput(
  organizationId: number,
  leadIds: number[],
  settings: { parcelScreening?: DisqualifierRules } | null | undefined,
  costPerPieceCents: number,
): Promise<
  | { rules: DisqualifierRules; signalsByLeadId: Record<number, ParcelSignals>; costPerPieceCents: number }
  | undefined
> {
  const rules = parseOrgScreeningRules(settings);
  if (!hasActiveRules(rules)) return undefined;
  const signalsByLeadId = await fetchParcelSignalsForLeads(organizationId, leadIds);
  return { rules, signalsByLeadId, costPerPieceCents };
}
