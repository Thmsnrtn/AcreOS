/**
 * The customer view of an OWNED parcel — the one projection every surface
 * that shows AcreOS's kept parcel facts goes through.
 *
 * Moved here from server/routes-land-data.ts (W3) so the public parcel report
 * and the landlocked checker render the same gated facts the Map door does,
 * instead of re-implementing the gate. Facts reach any reader ONLY through
 * projectFactsForCustomer() — the W2 accuracy gate — and each shown fact
 * carries the accuracy sample that let it through.
 *
 * Readers:
 *   - routes-land-data.ts      (signed-in, Map door)
 *   - publicParcelReport.ts    (public /p report + landlocked checker)
 *   - publicCountyGuide.ts     (public county guides)
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { parcelSnapshots, type ParcelSnapshot } from "@shared/schema";
import { censusRowFor } from "@shared/landData/countySourceCensus";
import { FACT_ACCURACY, projectFactsForCustomer } from "@shared/landData/factAccuracyGate";
import { parcelTruths } from "@shared/landData/parcelTruths";
import { taxSaleSourcesFor } from "@shared/landData/taxSaleSources";
import type { ParcelFactSet } from "@shared/landData/parcelFacts";
import { normalizeCountyName, ownedApn, OWNED_SNAPSHOT_SOURCE } from "./ownedParcelStore";

/** The owned-parcel fields a customer view needs, from a parcel_snapshots row. */
export interface OwnedParcelView {
  parcelKey: string;
  state: string;
  county: string;
  sourceParcelId: string;
  sourceName: string;
  retrievedAt: Date | null;
  gisAcres: number;
  deededAcres: number | null;
  facts: unknown;
  attributes: unknown;
}

export function ownedViewOf(row: ParcelSnapshot): OwnedParcelView {
  const raw = (row.rawData ?? {}) as Record<string, unknown>;
  return {
    parcelKey: row.parcelKey ?? "",
    state: row.state,
    county: row.county,
    sourceParcelId: row.apn,
    sourceName: typeof raw.sourceName === "string" ? raw.sourceName : "unknown",
    retrievedAt: row.fetchedAt ?? null,
    gisAcres: Number(row.acres ?? 0),
    deededAcres: typeof raw.deededAcres === "number" ? raw.deededAcres : null,
    facts: row.facts,
    attributes: raw.attributes ?? {},
  };
}

/** Serialize an owned parcel for a customer: gated facts + truths. */
export function serializeOwnedParcelForCustomer(row: OwnedParcelView) {
  const facts = (row.facts ?? {}) as Partial<ParcelFactSet>;
  const projection = projectFactsForCustomer(facts);
  const attrs = (row.attributes ?? {}) as Record<string, unknown>;
  const access = facts.legal_access_indication?.status === "computed" ? facts.legal_access_indication.value : null;
  return {
    parcelKey: row.parcelKey,
    state: row.state,
    county: row.county,
    sourceParcelId: row.sourceParcelId,
    source: { name: row.sourceName, retrievedAt: row.retrievedAt },
    gisAcres: row.gisAcres,
    deededAcres: row.deededAcres,
    // Each shown fact carries the accuracy sample that let it through.
    facts: projection.shown.map((f) => {
      const a = FACT_ACCURACY[f.key];
      return { ...f, accuracy: { check: a.check, sampleSize: a.sampleSize ?? 0, agreed: a.agreed ?? 0, verifiedOn: a.verifiedOn ?? null } };
    }),
    withheldFacts: projection.withheld,
    countyCoverage: censusRowFor(row.state, row.county)?.coverage ?? null,
    truths: parcelTruths({
      state: row.state,
      county: row.county,
      gisAcres: row.gisAcres,
      deededAcres: row.deededAcres,
      subdivision: typeof attrs.SUBDIV === "string" ? attrs.SUBDIV : null,
      lot: typeof attrs.LOT === "string" ? attrs.LOT : null,
      accessIndication: access,
    }),
    taxSaleSources: taxSaleSourcesFor(row.state, row.county),
  };
}

export type CustomerOwnedParcel = ReturnType<typeof serializeOwnedParcelForCustomer>;

/**
 * The kept parcel for (state, county, county parcel id), through the
 * crosswalk — the current id OR any id this parcel carried before, so a
 * renumbered parcel still resolves to the same land. Null when the id is not
 * usable or AcreOS holds no such parcel. Read-only.
 */
export async function findOwnedParcelRow(state: string, county: string, apnRaw: string): Promise<ParcelSnapshot | null> {
  const st = state.toUpperCase();
  const c = normalizeCountyName(county);
  const apn = ownedApn(st, c, apnRaw);
  if (!apn) return null;
  const [row] = await db
    .select()
    .from(parcelSnapshots)
    .where(
      and(
        // Owned parcels are GLOBAL public-record rows (organization_id NULL):
        // never another tenant's data.
        isNull(parcelSnapshots.organizationId),
        eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE),
        eq(parcelSnapshots.state, st),
        eq(parcelSnapshots.county, c),
        sql`(${parcelSnapshots.apn} = ${apn} OR jsonb_exists(${parcelSnapshots.rawData}->'sourceIdHistory', ${apn}))`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The kept parcel with this AcreOS parcel key. Read-only. */
export async function findOwnedParcelByKey(parcelKey: string): Promise<ParcelSnapshot | null> {
  const [row] = await db
    .select()
    .from(parcelSnapshots)
    .where(and(isNull(parcelSnapshots.organizationId), eq(parcelSnapshots.source, OWNED_SNAPSHOT_SOURCE), eq(parcelSnapshots.parcelKey, parcelKey)))
    .limit(1);
  return row ?? null;
}
