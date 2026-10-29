/**
 * County watches and their triage — V-Tax-1 T1. Org-scoped reads and the one
 * write (stating a watch's terms).
 *
 *   - A watch's redemption period, sale type and auction cadence are each a
 *     STATED value with a source and an as-of, or absent (unknown). Never a
 *     national default; nothing here fills one in.
 *   - Triage reads the watch's lots and their observations (org-filtered),
 *     plus the public-record value of any matched parcel, and runs the pure
 *     ignorance map (shared/tax/triage.ts).
 *   - A watch outside the caller's organization is null (the route answers 404).
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { taxCountyWatches, taxLotObservations, taxSaleListings, type TaxCountyWatch, type TaxWatchTerms } from "@shared/schema";
import { triageLot, TRIAGE_ORDER_BASIS, type TriageFact, type TriageFactKey } from "@shared/tax/triage";
import { numericToCents } from "../taxSaleCsvImport";

export async function listWatches(organizationId: number): Promise<Array<TaxCountyWatch & { lotCount: number }>> {
  const { db } = await import("../../db");
  const watches = await db.select().from(taxCountyWatches).where(eq(taxCountyWatches.organizationId, organizationId)).orderBy(asc(taxCountyWatches.state), asc(taxCountyWatches.county));
  if (watches.length === 0) return [];
  const counts = await db
    .select({ state: taxSaleListings.state, county: sql<string>`lower(${taxSaleListings.county})`, n: sql<number>`count(*)::int` })
    .from(taxSaleListings)
    .where(eq(taxSaleListings.organizationId, organizationId))
    .groupBy(taxSaleListings.state, sql`lower(${taxSaleListings.county})`);
  const byKey = new Map(counts.map((c) => [`${c.state}|${c.county}`, c.n]));
  return watches.map((w) => ({ ...w, lotCount: byKey.get(`${w.state}|${w.county.toLowerCase()}`) ?? 0 }));
}

/** Replace a watch's stated terms. Returns null when the watch is not the org's. */
export async function setWatchTerms(organizationId: number, watchId: string, terms: TaxWatchTerms): Promise<TaxCountyWatch | null> {
  const { db } = await import("../../db");
  const [row] = await db
    .update(taxCountyWatches)
    .set({ terms, updatedAt: sql`now()` })
    .where(and(eq(taxCountyWatches.id, watchId), eq(taxCountyWatches.organizationId, organizationId)))
    .returning();
  return row ?? null;
}

export interface WatchTriage {
  watch: TaxCountyWatch;
  basis: string;
  lots: Array<{
    listingId: number;
    apn: string;
    address: string | null;
    saleDate: string | null;
    delinquentYears: string[];
    facts: TriageFact[];
    unknownsInOrder: TriageFactKey[];
  }>;
}

export async function buildWatchTriage(organizationId: number, watchId: string): Promise<WatchTriage | null> {
  const { db } = await import("../../db");
  const [watch] = await db
    .select()
    .from(taxCountyWatches)
    .where(and(eq(taxCountyWatches.id, watchId), eq(taxCountyWatches.organizationId, organizationId)))
    .limit(1);
  if (!watch) return null;

  const lots = await db
    .select()
    .from(taxSaleListings)
    .where(and(eq(taxSaleListings.organizationId, organizationId), eq(taxSaleListings.state, watch.state), sql`lower(${taxSaleListings.county}) = lower(${watch.county})`))
    .orderBy(asc(taxSaleListings.id));
  const ids = lots.map((l) => l.id);
  const parcelObs = ids.length
    ? await db
        .select()
        .from(taxLotObservations)
        .where(and(eq(taxLotObservations.organizationId, organizationId), inArray(taxLotObservations.listingId, ids), eq(taxLotObservations.field, "parcel.apid")))
        .orderBy(asc(taxLotObservations.observedAt))
    : [];
  const latestParcel = new Map<number, (typeof parcelObs)[number]>();
  for (const o of parcelObs) latestParcel.set(o.listingId, o);

  const { findOwnedParcelByKey } = await import("../landData/ownedParcelView");
  const period = watch.terms.redemptionPeriodMonths;
  const out: WatchTriage["lots"] = [];
  for (const l of lots) {
    const o = latestParcel.get(l.id);
    let parcel: Parameters<typeof triageLot>[0]["parcel"];
    if (!o) parcel = { status: "not_searched", reason: "the list gave no parcel id, state and county to search by" };
    else if (o.kind === "searched_none") parcel = { status: "searched_none", reason: String((o.sourceRef as { reason?: string }).reason ?? "no matching parcel") };
    else {
      const key = (o.value as { parcelKey: string }).parcelKey;
      const snap = await findOwnedParcelByKey(key);
      const raw = (snap?.rawData ?? {}) as Record<string, unknown>;
      parcel = {
        status: "matched",
        marketValueCents: snap?.marketValue == null ? null : Math.round(Number(snap.marketValue) * 100),
        valueSource: typeof raw.sourceName === "string" ? raw.sourceName : snap ? "public record" : null,
      };
    }
    const t = triageLot({
      parcel,
      listMarketValueCents: numericToCents(l.marketValue),
      amountOwedCents: numericToCents(l.totalTaxOwed),
      redemptionPeriod: period ? { months: period.value, source: period.source } : null,
    });
    out.push({ listingId: l.id, apn: l.apn, address: l.address, saleDate: l.saleDate ?? null, delinquentYears: l.taxYearsDelinquent ?? [], ...t });
  }
  return { watch, basis: TRIAGE_ORDER_BASIS, lots: out };
}
