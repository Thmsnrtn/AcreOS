/**
 * Fraud-check signals for a deal (W5a) — gathers each input from the record
 * that holds it and hands it to the pure evaluator
 * (shared/trust/fraudSignals.ts). A missing input stays null so the signal
 * reads "not checked", never "clear".
 *
 * Sources, in the order the evaluator reads them:
 *   - owner mailing history, owner of record, ownership date →
 *     parcel_observations (owner_address / owner / deed_date), the append-only
 *     log every county-GIS and provider lookup writes, global or this org's;
 *   - offer amount → the deal (accepted, else offer);
 *   - parcel value → ONLY a fact that passed the W2 accuracy gate. None of
 *     the gated facts is a value today (shared/landData/parcelFacts.ts), so
 *     this signal reports "not checked" rather than reaching for an assessed
 *     or estimated number the gate has never verified;
 *   - signer → the seller lead on the deal's property;
 *   - vacant land → the property's structure type; free and clear → the
 *     org's own due-diligence checklist ("no liens");
 *   - wire-change reports → activity_log rows this route writes.
 */
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db";
import { activityLog, deals, leads, parcelObservations, properties } from "@shared/schema";
import { evaluateFraudSignals, stateFromMailingAddress, type Dated, type FraudSignal } from "@shared/trust/fraudSignals";
import { clock } from "../../utils/clock";

const WIRE_CHANGE_ACTION = "wire_change_reported";

const SOURCE_LABEL: Record<string, string> = {
  county_gis: "County GIS (assessor record)",
  regrid: "Regrid parcel record",
  manual: "Entered by your team",
};
const label = (s: string) => SOURCE_LABEL[s] ?? s;

export async function fraudCheckForDeal(organizationId: number, dealId: number): Promise<{ signals: FraudSignal[] } | null> {
  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.organizationId, organizationId), eq(deals.id, dealId), isNull(deals.deletedAt)))
    .limit(1);
  if (!deal) return null;
  const [property] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.organizationId, organizationId), eq(properties.id, deal.propertyId)))
    .limit(1);
  const seller = property?.sellerId
    ? (
        await db
          .select({ firstName: leads.firstName, lastName: leads.lastName, state: leads.state, updatedAt: leads.updatedAt })
          .from(leads)
          .where(and(eq(leads.organizationId, organizationId), eq(leads.id, property.sellerId)))
          .limit(1)
      )[0]
    : undefined;

  const obs = property
    ? await db
        .select({ field: parcelObservations.field, value: parcelObservations.value, source: parcelObservations.source, observedAt: parcelObservations.observedAt })
        .from(parcelObservations)
        .where(
          and(
            eq(parcelObservations.apn, property.apn),
            eq(parcelObservations.state, property.state),
            eq(parcelObservations.county, property.county),
            inArray(parcelObservations.field, ["owner_address", "owner", "deed_date"]),
            or(isNull(parcelObservations.organizationId), eq(parcelObservations.organizationId, organizationId)),
          ),
        )
        .orderBy(desc(parcelObservations.observedAt))
        .limit(200)
    : [];

  const asText = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
  // Distinct mailing addresses, newest first, each dated by its FIRST sighting.
  const history: Array<Dated<string>> = [];
  const addressRows = obs.filter((o) => o.field === "owner_address" && asText(o.value));
  for (let i = 0; i < addressRows.length; i++) {
    const v = asText(addressRows[i].value);
    if (history.length > 0 && history[history.length - 1].value.toUpperCase() === v.toUpperCase()) {
      // Same address seen earlier: move its date back to the earlier sighting.
      history[history.length - 1].observedAt = addressRows[i].observedAt.toISOString();
      continue;
    }
    if (history.some((h) => h.value.toUpperCase() === v.toUpperCase())) continue;
    history.push({ value: v, source: label(addressRows[i].source), observedAt: addressRows[i].observedAt.toISOString() });
  }
  const ownerRow = obs.find((o) => o.field === "owner" && asText(o.value));
  const deedRow = obs.find((o) => o.field === "deed_date" && asText(o.value));
  const mailingState = history[0] ? stateFromMailingAddress(history[0].value) : null;

  const wire = await db
    .select({ createdAt: activityLog.createdAt, description: activityLog.description })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.organizationId, organizationId),
        eq(activityLog.entityType, "deal"),
        eq(activityLog.entityId, dealId),
        eq(activityLog.action, WIRE_CHANGE_ACTION),
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(20);

  const offer = Number(deal.acceptedAmount ?? deal.offerAmount ?? NaN);
  const signals = evaluateFraudSignals({
    now: clock.now().toISOString(),
    ownerMailingHistory: history.length > 0 ? history : null,
    offerAmount: Number.isFinite(offer) ? offer : null,
    gatedValue: null,
    ownerSince: deedRow ? { value: asText(deedRow.value), source: label(deedRow.source), observedAt: deedRow.observedAt.toISOString() } : null,
    signerName: seller ? `${seller.firstName ?? ""} ${seller.lastName ?? ""}`.trim() || null : null,
    ownerOfRecord: ownerRow ? { value: asText(ownerRow.value), source: label(ownerRow.source), observedAt: ownerRow.observedAt.toISOString() } : null,
    isVacantLand:
      property?.structureType === "vacant_land"
        ? { value: true, source: "Property record (structure type)", observedAt: (property.updatedAt ?? clock.now()).toISOString() }
        : property?.structureType
          ? { value: false, source: "Property record (structure type)", observedAt: (property.updatedAt ?? clock.now()).toISOString() }
          : null,
    parcelState: property?.state ?? null,
    ownerMailingState: mailingState && history[0] ? { value: mailingState, source: history[0].source, observedAt: history[0].observedAt } : null,
    freeAndClear:
      property?.dueDiligenceData?.noLiens === true
        ? { value: true, source: "Your due-diligence checklist (no liens)", observedAt: (property.updatedAt ?? clock.now()).toISOString() }
        : property?.dueDiligenceData?.noLiens === false
          ? { value: false, source: "Your due-diligence checklist", observedAt: (property.updatedAt ?? clock.now()).toISOString() }
          : null,
    wireChangeReports: wire.map((w) => ({ reportedAt: (w.createdAt ?? clock.now()).toISOString(), note: w.description ?? null })),
  });
  return { signals };
}

export async function reportWireChange(organizationId: number, dealId: number, userId: string, note: string | null): Promise<boolean> {
  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.organizationId, organizationId), eq(deals.id, dealId)))
    .limit(1);
  if (!deal) return false;
  await db.insert(activityLog).values({
    organizationId,
    userId,
    action: WIRE_CHANGE_ACTION,
    entityType: "deal",
    entityId: dealId,
    description: note,
  });
  return true;
}
