/**
 * Collateral watch (W5a) — the Finance door's view of what is watched on each
 * note's collateral, and the daily job that watches it. Alerts land in
 * `parcel_alerts`, which the Today feed already renders (ParcelAlerts).
 *
 * Coverage comes from shared/trust/collateralWatch.ts: tax delinquency where a
 * county GIS endpoint maps a tax-status field; liens and probate nowhere,
 * because no source for them exists in AcreOS. The job reads the parcel
 * through the provider registry (county-gis only — free, the registry's cache
 * and circuit breaker apply) and never through a side door.
 */
import { and, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { acquiredNotes, countyGisEndpoints, notes, parcelAlerts, parcelObservations, properties } from "@shared/schema";
import {
  classifyTaxStatus,
  collateralCoverage,
  type CollateralWatchCoverage,
  type CountyTaxSource,
} from "@shared/trust/collateralWatch";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

const CLOSED_NOTE_STATUSES = ["paid_off", "sold", "cancelled", "charged_off"];

async function countyTaxSources(): Promise<CountyTaxSource[]> {
  const rows = await db
    .select({ state: countyGisEndpoints.state, county: countyGisEndpoints.county, baseUrl: countyGisEndpoints.baseUrl })
    .from(countyGisEndpoints)
    .where(
      and(
        eq(countyGisEndpoints.isActive, true),
        sql`nullif(trim(${countyGisEndpoints.fieldMappings}->>'taxStatus'), '') is not null`,
      ),
    );
  const host = (u: string) => {
    try {
      return new URL(u).host;
    } catch {
      return "county server";
    }
  };
  return rows.filter((r) => r.county !== "*").map((r) => ({ state: r.state, county: r.county, name: `${r.county} County, ${host(r.baseUrl)}` }));
}

interface Collateral {
  noteLabel: string;
  propertyId: number;
  apn: string;
  state: string;
  county: string;
}

async function collateralFor(organizationId: number): Promise<Collateral[]> {
  const serviced = await db
    .select({ id: notes.id, propertyId: notes.propertyId })
    .from(notes)
    .where(and(eq(notes.organizationId, organizationId), isNotNull(notes.propertyId), notInArray(notes.status, CLOSED_NOTE_STATUSES)));
  const acquired = await db
    .select({ noteNumber: acquiredNotes.noteNumber, propertyId: acquiredNotes.propertyId })
    .from(acquiredNotes)
    .where(and(eq(acquiredNotes.organizationId, organizationId), isNotNull(acquiredNotes.propertyId), notInArray(acquiredNotes.status, CLOSED_NOTE_STATUSES)));
  const byProperty = new Map<number, string>();
  for (const n of serviced) if (n.propertyId != null) byProperty.set(n.propertyId, `Note #${n.id}`);
  for (const n of acquired) if (n.propertyId != null) byProperty.set(n.propertyId, `Note ${n.noteNumber}`);
  if (byProperty.size === 0) return [];
  const props = await db
    .select({ id: properties.id, apn: properties.apn, state: properties.state, county: properties.county })
    .from(properties)
    .where(and(eq(properties.organizationId, organizationId), inArray(properties.id, Array.from(byProperty.keys())), isNull(properties.deletedAt)));
  return props.map((p) => ({ noteLabel: byProperty.get(p.id)!, propertyId: p.id, apn: p.apn, state: p.state, county: p.county }));
}

export interface CollateralWatchRow {
  noteLabel: string;
  propertyId: number;
  apn: string;
  state: string;
  county: string;
  coverage: CollateralWatchCoverage[];
  /** The latest tax-status reading on record, with its source and date, if any. */
  lastTaxStatus: { value: string; reading: "delinquent" | "current" | "unknown"; source: string; observedAt: string } | null;
}

export async function collateralWatchForOrg(organizationId: number): Promise<CollateralWatchRow[]> {
  const [collateral, sources] = await Promise.all([collateralFor(organizationId), countyTaxSources()]);
  const out: CollateralWatchRow[] = [];
  for (const c of collateral) {
    const [obs] = await db
      .select({ value: parcelObservations.value, source: parcelObservations.source, observedAt: parcelObservations.observedAt })
      .from(parcelObservations)
      .where(
        and(
          eq(parcelObservations.apn, c.apn),
          eq(parcelObservations.state, c.state),
          eq(parcelObservations.county, c.county),
          eq(parcelObservations.field, "tax_status"),
          or(isNull(parcelObservations.organizationId), eq(parcelObservations.organizationId, organizationId)),
        ),
      )
      .orderBy(desc(parcelObservations.observedAt))
      .limit(1);
    const value = obs?.value == null ? null : String(obs.value);
    out.push({
      ...c,
      coverage: collateralCoverage(c, sources),
      lastTaxStatus: obs && value ? { value, reading: classifyTaxStatus(value), source: obs.source, observedAt: obs.observedAt.toISOString() } : null,
    });
  }
  return out;
}

/** Daily: read each watched collateral parcel and alert the org's Today feed. */
export async function runCollateralWatch(): Promise<{ parcels: number; checked: number; alerts: number; notWatched: number }> {
  const sources = await countyTaxSources();
  const orgRows = await unscopedForPlatformOps(
    "collateral watch: the daily job visits every org that holds a note with collateral",
  )
    .selectDistinct({ organizationId: notes.organizationId })
    .from(notes)
    .where(isNotNull(notes.propertyId));
  const orgRows2 = await unscopedForPlatformOps(
    "collateral watch: the daily job visits every org that holds an acquired note with collateral",
  )
    .selectDistinct({ organizationId: acquiredNotes.organizationId })
    .from(acquiredNotes)
    .where(isNotNull(acquiredNotes.propertyId));
  const orgIds = Array.from(new Set([...orgRows, ...orgRows2].map((r) => r.organizationId)));

  const { providerRegistry } = await import("../providers/provider-registry");
  let parcels = 0, checked = 0, alerts = 0, notWatched = 0;
  for (const organizationId of orgIds) {
    for (const c of await collateralFor(organizationId)) {
      parcels += 1;
      const tax = collateralCoverage(c, sources).find((x) => x.kind === "tax_delinquency");
      if (!tax?.watched) {
        notWatched += 1;
        continue;
      }
      try {
        const result = await providerRegistry.lookup(
          "parcel_data",
          { type: "apn", apn: c.apn, state: c.state, county: c.county },
          "free",
          0,
          organizationId,
          { allowProviders: ["county-gis"] },
        );
        checked += 1;
        const data = (result?.data ?? null) as { taxStatus?: string } | null;
        const value = data?.taxStatus ?? null;
        if (classifyTaxStatus(value) !== "delinquent") continue;
        const inserted = await db
          .insert(parcelAlerts)
          .values({
            organizationId,
            apn: c.apn,
            state: c.state,
            county: c.county,
            alertType: "collateral_tax_delinquent",
            field: "tax_status",
            previousValue: null,
            currentValue: value,
            source: "county_gis",
            confidence: null,
            propertyId: c.propertyId,
            dedupeKey: `collateral:tax_status:${c.state}:${c.county}:${c.apn}:${String(value).toLowerCase()}`,
            observedAt: clock.now(),
          })
          .onConflictDoNothing({ target: [parcelAlerts.organizationId, parcelAlerts.dedupeKey] })
          .returning({ id: parcelAlerts.id });
        alerts += inserted.length;
      } catch (err) {
        logger.warn("[collateralWatch] parcel read failed", {
          metadata: { organizationId, propertyId: c.propertyId, error: err instanceof Error ? err.message : String(err) },
        });
      }
    }
  }
  return { parcels, checked, alerts, notWatched };
}
