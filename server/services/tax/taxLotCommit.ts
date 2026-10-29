/**
 * Tax-list commit — V-Tax-1 T1. Writes a validated tax list in ONE
 * transaction: a tax_sale_listings row per lot, a tax_lot_observations row per
 * field the list stated (with the file, row, column and raw cell it came
 * from), a recorded absence per optional column the list has but leaves blank,
 * the parcel/APID resolution, and a county watch for each county on the list.
 *
 *   - Missing is null, never 0: an amount owed the list does not state is not
 *     stated; it is never summed or stored as a figure.
 *   - Parcel resolution goes through the one resolver the note-tape import
 *     uses (landData/resolveOwnedParcelRef): matched, searched-none (a
 *     verified absence) or — with no APN/state/county — nothing (unknown).
 *     Nothing is linked on a guess; properties is never touched.
 *   - A county watch is created with NO terms: the redemption period, sale
 *     type and auction cadence are unknown until someone states them with a
 *     source. Never a national default.
 *   - Owner names are NOT copied into observations: the listing already holds
 *     the list's owner of record, and a second copy would widen where person
 *     data lives (D2e purpose-ledger discipline: no new person-data surface).
 *   - Org-private: every write carries the organization id.
 */

import { randomUUID } from "node:crypto";
import { taxCountyWatches, taxLotObservations, taxSaleListings, type InsertTaxLotObservation } from "@shared/schema";
import { centsToNumeric, type LotFieldKey, type PreparedLot } from "../taxSaleCsvImport";
import { resolveOwnedParcelRef, type ParcelRefResolution } from "../landData/resolveOwnedParcelRef";

/** How fast each stated fact goes stale (the decay classes 0294 accepts). */
const DECAY: Record<LotFieldKey, InsertTaxLotObservation["decayClass"]> = {
  apn: "stable",
  county: "stable",
  state: "stable",
  saleType: "stable",
  saleDate: "event",
  delinquentYears: "months",
  totalTaxOwed: "months",
  minimumBid: "event",
  openingBid: "event",
  assessedValue: "about_a_year",
  marketValue: "about_a_year",
  address: "years",
  city: "years",
  zip: "years",
  legalDescription: "stable",
  acreage: "stable",
  propertyType: "years",
  ownerName: "about_a_year",
  acquisitionSource: "stable",
  notes: "event",
};

/** Person-adjacent fields that are not copied into observations. */
const NOT_OBSERVED: ReadonlySet<LotFieldKey> = new Set(["ownerName"]);

/** The typed value the validator produced for a stated field. */
function typedValue(lot: PreparedLot, field: LotFieldKey): unknown {
  switch (field) {
    case "totalTaxOwed": return lot.totalTaxOwedCents;
    case "minimumBid": return lot.minimumBidCents;
    case "openingBid": return lot.openingBidCents;
    case "assessedValue": return lot.assessedValueCents;
    case "marketValue": return lot.marketValueCents;
    case "delinquentYears": return lot.delinquentYears;
    default: return (lot as unknown as Record<string, unknown>)[field] ?? null;
  }
}

export const TAX_LIST_CONFIDENCE = "medium" as const;
export const TAX_LIST_CONFIDENCE_BASIS = "stated on the tax list the operator imported; not independently verified";

export interface CommitTaxLotListArgs {
  organizationId: number;
  actorUserId: string;
  fileName: string;
  fileSha256: string;
  /** The list's own as-of date, when the operator states it. */
  asOf: string | null;
  auctionId: number | null;
  lots: PreparedLot[];
}

export interface CommitTaxLotListResult {
  importId: string;
  lots: Array<{ fileRow: number; listingId: number; apn: string; parcel: "matched" | "unmatched" | "not_searched" }>;
  watchesCreated: Array<{ state: string; county: string }>;
}

export async function commitTaxLotList(a: CommitTaxLotListArgs): Promise<CommitTaxLotListResult> {
  // Reads first (public-record parcels only, no tenant data).
  const resolutions = new Map<number, ParcelRefResolution | null>();
  for (const lot of a.lots) resolutions.set(lot.fileRow, await resolveOwnedParcelRef({ apn: lot.apn, state: lot.state, county: lot.county }));

  const importId = randomUUID();
  const { withTransaction } = await import("../../db");
  return withTransaction(async (tx) => {
    const out: CommitTaxLotListResult["lots"] = [];
    for (const lot of a.lots) {
      const [row] = await tx
        .insert(taxSaleListings)
        .values({
          organizationId: a.organizationId,
          auctionId: a.auctionId,
          importId,
          apn: lot.apn,
          county: lot.county,
          state: lot.state,
          saleType: lot.saleType,
          saleDate: lot.saleDate,
          taxYearsDelinquent: lot.delinquentYears.map(String),
          acquisitionSource: lot.acquisitionSource ?? "auction",
          totalTaxOwed: centsToNumeric(lot.totalTaxOwedCents),
          minimumBid: centsToNumeric(lot.minimumBidCents),
          openingBid: centsToNumeric(lot.openingBidCents),
          assessedValue: centsToNumeric(lot.assessedValueCents),
          marketValue: centsToNumeric(lot.marketValueCents),
          address: lot.address,
          city: lot.city,
          zip: lot.zip,
          legalDescription: lot.legalDescription,
          acreage: lot.acreage,
          propertyType: lot.propertyType,
          ownerName: lot.ownerName,
          notes: lot.notes,
          status: "available",
          // Provenance lives in tax_lot_observations; there is no URL to invent.
          sourceUrl: null,
        })
        .returning({ id: taxSaleListings.id });

      const base = { organizationId: a.organizationId, listingId: row.id, importId, recordedBy: a.actorUserId };
      const fileRef = { fileName: a.fileName, fileSha256: a.fileSha256, fileRow: lot.fileRow };
      const rows: InsertTaxLotObservation[] = [];
      for (const [field, cell] of Object.entries(lot.stated) as Array<[LotFieldKey, { column: string; raw: string }]>) {
        if (NOT_OBSERVED.has(field)) continue;
        rows.push({ ...base, field, kind: "value", value: typedValue(lot, field), source: "tax_list", sourceRef: { ...fileRef, column: cell.column, raw: cell.raw }, asOf: a.asOf, confidence: TAX_LIST_CONFIDENCE, confidenceBasis: TAX_LIST_CONFIDENCE_BASIS, decayClass: DECAY[field] });
      }
      if (lot.saleDateSource === "auction") {
        rows.push({ ...base, field: "saleDate", kind: "value", value: lot.saleDate, source: "auction", sourceRef: { auctionId: a.auctionId }, asOf: null, confidence: "medium", confidenceBasis: "the date of the auction this list was imported into; the list itself states no sale date", decayClass: "event" });
      }
      for (const b of lot.blankMapped) {
        if (NOT_OBSERVED.has(b.field)) continue;
        rows.push({ ...base, field: b.field, kind: "searched_none", value: null, source: "tax_list", sourceRef: { ...fileRef, column: b.column, raw: "" }, asOf: a.asOf, confidence: TAX_LIST_CONFIDENCE, confidenceBasis: "the tax list has a column for this field and it is blank for this lot", decayClass: DECAY[b.field] });
      }
      const res = resolutions.get(lot.fileRow) ?? null;
      if (res) {
        const p = { ...base, field: "parcel.apid", source: "warehouse" as const, asOf: null, decayClass: "years" as const };
        if (res.parcelKey) rows.push({ ...p, kind: "value", value: { parcelKey: res.parcelKey, apid: res.apid, apidReason: res.reason }, sourceRef: { searchedFor: res.searchedFor }, confidence: "high", confidenceBasis: "the list's county parcel id matched an AcreOS-held public-record parcel exactly" });
        else rows.push({ ...p, kind: "searched_none", value: null, sourceRef: { searchedFor: res.searchedFor, reason: res.reason }, confidence: "high", confidenceBasis: "searched AcreOS-held public-record parcels for this county parcel id; none found" });
      }
      if (rows.length > 0) await tx.insert(taxLotObservations).values(rows);
      out.push({ fileRow: lot.fileRow, listingId: row.id, apn: lot.apn, parcel: res === null ? "not_searched" : res.parcelKey ? "matched" : "unmatched" });
    }

    // One watch per county on the list, created with no terms (unknown).
    const counties = new Map<string, { state: string; county: string }>();
    for (const lot of a.lots) counties.set(`${lot.state}|${lot.county.toLowerCase()}`, { state: lot.state, county: lot.county });
    const watchesCreated: CommitTaxLotListResult["watchesCreated"] = [];
    for (const c of counties.values()) {
      const created = await tx
        .insert(taxCountyWatches)
        .values({ organizationId: a.organizationId, state: c.state, county: c.county, terms: {}, createdBy: a.actorUserId })
        .onConflictDoNothing()
        .returning({ id: taxCountyWatches.id });
      if (created.length > 0) watchesCreated.push(c);
    }
    return { importId, lots: out, watchesCreated };
  });
}
