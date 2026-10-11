/**
 * Stage 0 — the vintage recorder. Starts the clock.
 *
 * Once a month it records two things AS KNOWN that day, append-only:
 *
 *  1. Every public series the models read (shared/forecasting/publicSeries.ts),
 *     fetched through the provider registry (cached, circuit-broken). Only
 *     values that are new or revised since the last recording are appended
 *     (vintage.ts `revisionsToRecord`); nothing recorded is ever overwritten.
 *     A family whose free key is missing is REFUSED with the reason — no
 *     value is invented for it.
 *
 *  2. Every customer outcome AcreOS can see, per organisation: closed deals,
 *     accepted and declined offers, responses to outreach — read from the
 *     existing tables (deals, offers, campaign_responses) and frozen with
 *     only the OUTCOME_FIELDS (shared/forecasting/models.ts). The source
 *     tables are mutable; this is what makes "what was the close price as
 *     known in March" answerable.
 *
 * Tenancy: outcomes are read one organisation at a time, every query carrying
 * that organisation's id.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import {
  campaignResponses,
  customerOutcomeObservations,
  deals,
  leads,
  offers,
  organizations,
  properties,
  propertyListings,
  publicSeriesVintages,
} from "@shared/schema";
import { PUBLIC_SERIES, STATE_CODES, type SeriesFamilyId } from "@shared/forecasting/publicSeries";
import { revisionsToRecord, type VintageRow } from "@shared/forecasting/vintage";
import { OUTCOME_FIELD_KEYS, type OutcomeField, type OutcomeKind } from "@shared/forecasting/models";
import { providerRegistry } from "../providers/provider-registry";
import { publicSeriesReadiness, type SeriesLookupData } from "./publicSeriesProvider";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

export interface PublicRecordingReport {
  asOf: string;
  families: Array<{
    family: SeriesFamilyId;
    refused: string | null;
    seriesRead: number;
    seriesFailed: number;
    rowsAppended: number;
  }>;
}

/** Record every public series family once, as known today. */
export async function recordPublicVintages(): Promise<PublicRecordingReport> {
  const asOf = clock.now().toISOString().slice(0, 10);
  const report: PublicRecordingReport = { asOf, families: [] };
  for (const fam of PUBLIC_SERIES) {
    const refused = publicSeriesReadiness(fam.id);
    const entry = { family: fam.id, refused, seriesRead: 0, seriesFailed: 0, rowsAppended: 0 };
    report.families.push(entry);
    if (refused) {
      logger.info(`[forecasting] ${fam.id} refused: ${refused}`, { source: "vintageRecorder" });
      continue;
    }
    for (const st of STATE_CODES) {
      const seriesId = fam.seriesIdFor(st);
      const r = await providerRegistry
        .lookup("macro_series", { type: "series", seriesId, family: fam.id, state: st }, "free", 0)
        .catch(() => null);
      const data = r?.data as SeriesLookupData | undefined;
      if (!r || !data || data.seriesId !== seriesId) {
        entry.seriesFailed++;
        continue;
      }
      entry.seriesRead++;
      const known = await db
        .select({
          seriesId: publicSeriesVintages.seriesId,
          observationDate: publicSeriesVintages.observationDate,
          vintageDate: publicSeriesVintages.vintageDate,
          value: publicSeriesVintages.value,
        })
        .from(publicSeriesVintages)
        .where(eq(publicSeriesVintages.seriesId, seriesId));
      const rows = revisionsToRecord(
        known as VintageRow[],
        data.observations.map((o) => ({ seriesId, observationDate: o.observationDate, value: o.value })),
        data.knownOn,
      );
      if (rows.length > 0) {
        const res = await db
          .insert(publicSeriesVintages)
          .values(rows.map((x) => ({ ...x, family: fam.id, source: fam.licenseSource })))
          .onConflictDoNothing()
          .returning({ id: publicSeriesVintages.id });
        entry.rowsAppended += res.length;
      }
    }
  }
  return report;
}

// ── Customer outcomes ─────────────────────────────────────────────────────

const toCents = (v: string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const toNum = (v: string | null | undefined): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const days = (a: Date | null | undefined, b: Date | null | undefined): number | null =>
  a && b && b.getTime() >= a.getTime() ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : null;

/** Keep only OUTCOME_FIELDS with real values — absence stays absence, never zero. */
export function outcomeValues(v: Partial<Record<OutcomeField, number | string | null>>): Partial<Record<OutcomeField, number | string>> {
  const out: Partial<Record<OutcomeField, number | string>> = {};
  for (const k of OUTCOME_FIELD_KEYS) {
    const x = v[k];
    if (x != null && x !== "") out[k] = x;
  }
  return out;
}

export interface OutcomeObservation {
  organizationId: number;
  kind: OutcomeKind;
  subjectTable: "deals" | "offers" | "campaign_responses";
  subjectId: number;
  state: string | null;
  county: string | null;
  observedAt: Date;
  values: Partial<Record<OutcomeField, number | string>>;
}

const PER_KIND_LIMIT = 5000;

/** One organisation's outcomes, every query scoped to it. */
export async function readOrgOutcomes(organizationId: number): Promise<OutcomeObservation[]> {
  const out: OutcomeObservation[] = [];

  const closed = await db
    .select({
      id: deals.id,
      type: deals.type,
      acceptedAmount: deals.acceptedAmount,
      offerAmount: deals.offerAmount,
      closingDate: deals.closingDate,
      updatedAt: deals.updatedAt,
      propertyId: deals.propertyId,
      state: properties.state,
      county: properties.county,
      sizeAcres: properties.sizeAcres,
      purchaseDate: properties.purchaseDate,
      soldDate: properties.soldDate,
      soldPrice: properties.soldPrice,
      purchasePrice: properties.purchasePrice,
    })
    .from(deals)
    .innerJoin(properties, and(eq(properties.id, deals.propertyId), eq(properties.organizationId, organizationId)))
    .where(and(eq(deals.organizationId, organizationId), eq(deals.status, "closed")))
    .orderBy(desc(deals.id))
    .limit(PER_KIND_LIMIT);

  const propIds = [...new Set(closed.map((d) => d.propertyId))];
  const listings = propIds.length
    ? await db
        .select({ propertyId: propertyListings.propertyId, publishedAt: propertyListings.publishedAt, soldAt: propertyListings.soldAt })
        .from(propertyListings)
        .where(and(eq(propertyListings.organizationId, organizationId), inArray(propertyListings.propertyId, propIds), isNotNull(propertyListings.publishedAt), isNotNull(propertyListings.soldAt)))
    : [];
  const domByProperty = new Map<number, number>();
  for (const l of listings) {
    const d = days(l.publishedAt, l.soldAt);
    if (d != null) domByProperty.set(l.propertyId, d);
  }

  for (const d of closed) {
    const observedAt = d.closingDate ?? d.updatedAt;
    if (!observedAt) continue;
    const disposition = d.type === "disposition";
    out.push({
      organizationId,
      kind: "deal_closed",
      subjectTable: "deals",
      subjectId: d.id,
      state: d.state,
      county: d.county,
      observedAt,
      values: outcomeValues({
        priceCents: disposition ? (toCents(d.soldPrice) ?? toCents(d.acceptedAmount)) : (toCents(d.acceptedAmount) ?? toCents(d.purchasePrice) ?? toCents(d.offerAmount)),
        acres: toNum(d.sizeAcres),
        daysHeld: disposition ? days(d.purchaseDate, d.soldDate) : null,
        daysOnMarket: disposition ? (domByProperty.get(d.propertyId) ?? null) : null,
        result: disposition ? "sold" : "bought",
      }),
    });
  }

  const responded = await db
    .select({
      id: offers.id,
      status: offers.status,
      cashOffer: offers.cashOffer,
      respondedAt: offers.respondedAt,
      updatedAt: offers.updatedAt,
      state: properties.state,
      county: properties.county,
      sizeAcres: properties.sizeAcres,
    })
    .from(offers)
    .leftJoin(properties, and(eq(properties.id, offers.propertyId), eq(properties.organizationId, organizationId)))
    .where(and(eq(offers.organizationId, organizationId), inArray(offers.status, ["accepted", "rejected"])))
    .orderBy(desc(offers.id))
    .limit(PER_KIND_LIMIT);
  for (const o of responded) {
    const observedAt = o.respondedAt ?? o.updatedAt;
    if (!observedAt) continue;
    const accepted = o.status === "accepted";
    out.push({
      organizationId,
      kind: accepted ? "offer_accepted" : "offer_declined",
      subjectTable: "offers",
      subjectId: o.id,
      state: o.state ?? null,
      county: o.county ?? null,
      observedAt,
      values: outcomeValues({ priceCents: toCents(o.cashOffer), acres: toNum(o.sizeAcres), result: accepted ? "accepted" : "declined" }),
    });
  }

  const responses = await db
    .select({
      id: campaignResponses.id,
      channel: campaignResponses.channel,
      responseDate: campaignResponses.responseDate,
      state: leads.state,
      county: leads.county,
    })
    .from(campaignResponses)
    .leftJoin(leads, and(eq(leads.id, campaignResponses.leadId), eq(leads.organizationId, organizationId)))
    .where(eq(campaignResponses.organizationId, organizationId))
    .orderBy(desc(campaignResponses.id))
    .limit(PER_KIND_LIMIT);
  for (const r of responses) {
    if (!r.responseDate) continue;
    out.push({
      organizationId,
      kind: "outreach_response",
      subjectTable: "campaign_responses",
      subjectId: r.id,
      state: r.state ?? null,
      county: r.county ?? null,
      observedAt: r.responseDate,
      values: outcomeValues({ channel: r.channel }),
    });
  }
  return out;
}

export interface OutcomeRecordingReport {
  organizations: number;
  seen: number;
  appended: number;
}

/** Record every organisation's outcomes; an outcome already recorded is left exactly as it was. */
export async function recordCustomerOutcomes(): Promise<OutcomeRecordingReport> {
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  const report: OutcomeRecordingReport = { organizations: orgs.length, seen: 0, appended: 0 };
  for (const { id: organizationId } of orgs) {
    try {
      const obs = await readOrgOutcomes(organizationId);
      report.seen += obs.length;
      for (let i = 0; i < obs.length; i += 500) {
        const chunk = obs.slice(i, i + 500);
        const res = await db
          .insert(customerOutcomeObservations)
          .values(chunk)
          .onConflictDoNothing()
          .returning({ id: customerOutcomeObservations.id });
        report.appended += res.length;
      }
    } catch (err) {
      logger.warn(`[forecasting] outcome recording failed for one organisation`, {
        source: "vintageRecorder",
        metadata: { organizationId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  return report;
}
