/**
 * The tax lot record — V-Tax-1 T4. One org-scoped read for a lot's tax page:
 * each tax fact with every source that stated it, the disagreements between
 * them, and what is known, searched-and-absent, or never searched.
 *
 *   - The field rule is the one the note record uses
 *     (shared/provenance/fieldRecord.ts): every value from every source is
 *     kept with its provenance; when they differ, all are shown and the book
 *     value is named. Nothing is resolved, averaged or overwritten.
 *   - Sources for one lot: this lot's own list observations, the lists of the
 *     SAME parcel imported for other sales (sibling listings: same state,
 *     county and APN in this organization), values the operator recorded from
 *     the county, and the warehouse's own figures for the matched parcel.
 *   - Negative knowledge: the triage facts (shared/tax/triage.ts) say known,
 *     searched-none or never-searched for each diligence fact, the lien line
 *     included; a lien never searched is unknown — never clean, never zero.
 *   - Org-private: another organization's lot is null (the route answers 404),
 *     and every read filters on the organization.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { taxCountyWatches, taxLotObservations, taxSaleListings, type TaxLotObservation } from "@shared/schema";
import { recordedField, type ObservationView, type RecordedValue } from "@shared/provenance/fieldRecord";
import { triageLot, type TriageFact } from "@shared/tax/triage";
import { numericToCents } from "../taxSaleCsvImport";

/** The lot fields with a typed value both the list and the book carry. */
export const LOT_RECORD_FIELDS = ["totalTaxOwed", "delinquentYears", "saleDate", "marketValue", "assessedValue", "minimumBid"] as const;
export type LotRecordField = (typeof LOT_RECORD_FIELDS)[number];

const LABEL: Record<LotRecordField, string> = {
  totalTaxOwed: "Amount owed",
  delinquentYears: "Delinquent years",
  saleDate: "Sale date",
  marketValue: "Market value",
  assessedValue: "Assessed value",
  minimumBid: "Minimum bid",
};

const view = (o: TaxLotObservation, siblingOf: number | null): ObservationView => ({
  value: o.value,
  kind: o.kind,
  source: o.source,
  sourceRef: siblingOf === null ? o.sourceRef : { ...o.sourceRef, otherListingId: o.listingId },
  asOf: o.asOf ?? null,
  confidence: o.confidence,
  basis: siblingOf === null ? o.confidenceBasis : `${o.confidenceBasis} — from the list for another sale of the same parcel`,
  decayClass: o.decayClass,
  observedAt: o.observedAt.toISOString(),
});

export interface LotRecord {
  listingId: number;
  apn: string;
  county: string;
  state: string;
  fields: RecordedValue[];
  /** Known / searched-none / never-searched, for each diligence fact. */
  facts: TriageFact[];
  /** Other listings of the same parcel in this organization (other sales' lists). */
  otherListings: Array<{ listingId: number; saleDate: string | null; status: string }>;
}

export async function buildLotRecord(organizationId: number, listingId: number): Promise<LotRecord | null> {
  const { db } = await import("../../db");
  const [lot] = await db
    .select()
    .from(taxSaleListings)
    .where(and(eq(taxSaleListings.id, listingId), eq(taxSaleListings.organizationId, organizationId)))
    .limit(1);
  if (!lot) return null;

  const siblings = await db
    .select({ id: taxSaleListings.id, saleDate: taxSaleListings.saleDate, status: taxSaleListings.status })
    .from(taxSaleListings)
    .where(
      and(
        eq(taxSaleListings.organizationId, organizationId),
        eq(taxSaleListings.state, lot.state),
        sql`lower(${taxSaleListings.county}) = lower(${lot.county})`,
        eq(taxSaleListings.apn, lot.apn),
        sql`${taxSaleListings.id} <> ${lot.id}`,
      ),
    )
    .orderBy(asc(taxSaleListings.id));
  const ids = [lot.id, ...siblings.map((s) => s.id)];
  const obs = await db
    .select()
    .from(taxLotObservations)
    .where(and(eq(taxLotObservations.organizationId, organizationId), inArray(taxLotObservations.listingId, ids)))
    .orderBy(asc(taxLotObservations.observedAt));

  const byField = new Map<string, ObservationView[]>();
  for (const o of obs) byField.set(o.field, [...(byField.get(o.field) ?? []), view(o, o.listingId === lot.id ? null : lot.id)]);

  // The warehouse's own figures for the matched parcel, as one more source.
  const parcelObs = obs.filter((o) => o.listingId === lot.id && o.field === "parcel.apid").at(-1);
  let parcel: Parameters<typeof triageLot>[0]["parcel"] = { status: "not_searched", reason: "the list gave no parcel id, state and county to search by" };
  if (parcelObs?.kind === "searched_none") {
    parcel = { status: "searched_none", reason: String((parcelObs.sourceRef as { reason?: string }).reason ?? "no matching parcel") };
  } else if (parcelObs?.kind === "value") {
    const parcelKey = (parcelObs.value as { parcelKey: string }).parcelKey;
    const { findOwnedParcelByKey } = await import("../landData/ownedParcelView");
    const snap = await findOwnedParcelByKey(parcelKey);
    const raw = (snap?.rawData ?? {}) as Record<string, unknown>;
    const sourceName = typeof raw.sourceName === "string" ? raw.sourceName : "AcreOS public-record parcel";
    const retrieved = snap?.fetchedAt ?? null;
    const warehouse = (field: LotRecordField, cents: number | null) => {
      if (cents === null) return;
      const merged: ObservationView[] = [
        ...(byField.get(field) ?? []),
        {
          value: cents,
          kind: "value",
          source: "warehouse",
          sourceRef: { parcelKey, sourceName },
          asOf: retrieved ? retrieved.toISOString().slice(0, 10) : null,
          confidence: "medium",
          basis: `the matched public-record parcel (${sourceName}); not the county's tax list`,
          decayClass: "about_a_year",
          observedAt: (retrieved ?? new Date(0)).toISOString(),
        },
      ];
      byField.set(field, merged.sort((a, b) => a.observedAt.localeCompare(b.observedAt))); // oldest first, as the field-record rule states
    };
    const toCents = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 100));
    warehouse("marketValue", toCents(snap?.marketValue));
    warehouse("assessedValue", toCents(snap?.assessedValue));
    parcel = { status: "matched", marketValueCents: toCents(snap?.marketValue), valueSource: snap ? sourceName : null };
  }

  const book: Record<LotRecordField, unknown> = {
    totalTaxOwed: numericToCents(lot.totalTaxOwed),
    delinquentYears: lot.taxYearsDelinquent ? lot.taxYearsDelinquent.map(Number) : null,
    saleDate: lot.saleDate ?? null,
    marketValue: numericToCents(lot.marketValue),
    assessedValue: numericToCents(lot.assessedValue),
    minimumBid: numericToCents(lot.minimumBid),
  };
  const fields = LOT_RECORD_FIELDS.map((f) => recordedField(f, LABEL[f], book[f], byField.get(f) ?? []));

  // The redemption period is a county term, stated (with its source) on the
  // org's county watch — the same read the watch's own triage makes, so the
  // lot record and the watch panel never disagree about whether it is stated.
  const [watch] = await db
    .select({ terms: taxCountyWatches.terms })
    .from(taxCountyWatches)
    .where(and(eq(taxCountyWatches.organizationId, organizationId), eq(taxCountyWatches.state, lot.state), sql`lower(${taxCountyWatches.county}) = lower(${lot.county})`))
    .limit(1);
  const period = watch?.terms.redemptionPeriodMonths;

  const { facts } = triageLot({
    parcel,
    listMarketValueCents: numericToCents(lot.marketValue),
    amountOwedCents: numericToCents(lot.totalTaxOwed),
    redemptionPeriod: period ? { months: period.value, source: period.source } : null,
    survivingLiens: lot.maxBidBasis?.input.survivingLiens ?? null,
  });

  return {
    listingId: lot.id,
    apn: lot.apn,
    county: lot.county,
    state: lot.state,
    fields,
    facts,
    otherListings: siblings.map((s) => ({ listingId: s.id, saleDate: s.saleDate ?? null, status: s.status })),
  };
}

/** A value the operator read from the county, appended as its own observation. The book value is not changed. */
export async function recordCountyValue(
  organizationId: number,
  listingId: number,
  a: { field: LotRecordField; kind: "value" | "searched_none"; value: unknown; reference: string; asOf: string; userId: string },
): Promise<boolean> {
  const { db } = await import("../../db");
  const [lot] = await db
    .select({ id: taxSaleListings.id })
    .from(taxSaleListings)
    .where(and(eq(taxSaleListings.id, listingId), eq(taxSaleListings.organizationId, organizationId)))
    .limit(1);
  if (!lot) return false;
  await db.insert(taxLotObservations).values({
    organizationId,
    listingId,
    field: a.field,
    kind: a.kind,
    value: a.kind === "value" ? a.value : null,
    source: "operator_correction",
    sourceRef: { statedBy: "county_record", reference: a.reference },
    asOf: a.asOf,
    confidence: "high",
    confidenceBasis: "read from the county's own record by the operator",
    decayClass: a.field === "saleDate" ? "event" : a.field === "delinquentYears" || a.field === "totalTaxOwed" ? "months" : "about_a_year",
    recordedBy: a.userId,
  });
  return true;
}
