/**
 * Pre-Mail Dedupe Scanner — Tom Hsiao / Lens 36 fix
 *
 * Runs before any Lob send to keep land investors from accidentally
 * mailing letters to:
 *   1. their own owned parcels (lead.address ↔ properties.address)
 *   2. recipients they mailed in the last 90 days (returns are still
 *      attribution-tagged to the prior touch — don't waste postage)
 *   3. addresses that came back returned-to-sender on any prior piece
 *   4. anyone flagged do_not_contact / opted out
 *
 * Returns the filtered set + a per-bucket breakdown so the UI can show
 * the investor exactly which leads were skipped and why. No more silent
 * "letter to my own parcel" moments.
 */
import { db } from "../db";
import { leads, properties, mailingOrderPieces, mailingOrders } from "@shared/schema";
import { and, eq, inArray, gte, isNotNull, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import {
  screenParcels,
  hasActiveRules,
  type DisqualifierRules,
  type ParcelSignals,
  type DisqualifierReason,
  type DisqualifierCategory,
} from "./parcelScreening";

export interface PreMailDedupeInput {
  organizationId: number;
  leadIds: number[];
  /** Skip leads mailed within this many days (default 90). */
  recentMailWindowDays?: number;
  /**
   * Optional pre-spend parcel-quality screening (charter §7.2). OFF unless
   * supplied with active rules — when absent the result is byte-identical to
   * before. The caller supplies cached free-data signals per lead and the cost
   * per piece; disqualified parcels move to the `parcelDisqualified` bucket and
   * the projected spend saved is reported. Fail-open by construction (unknown
   * signals never disqualify).
   */
  parcelScreening?: {
    rules: DisqualifierRules;
    signalsByLeadId: Record<number, ParcelSignals>;
    costPerPieceCents: number;
  };
}

export interface DedupedLead {
  id: number;
  firstName: string | null;
  lastName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface PreMailDedupeResult {
  acceptedLeads: DedupedLead[];
  skipped: {
    ownedParcel: DedupedLead[];
    recentlyMailed: DedupedLead[];
    returnedMail: DedupedLead[];
    doNotContact: DedupedLead[];
    missingAddress: DedupedLead[];
    /** Disqualified by parcel-quality screening (flood/wetlands/landlocked/slope). Empty unless screening ran. */
    parcelDisqualified: DedupedLead[];
  };
  totals: {
    input: number;
    accepted: number;
    skipped: number;
  };
  /** Present only when parcel-quality screening ran (active rules supplied). */
  parcelScreening?: {
    spendSavedCents: number;
    byCategory: Record<DisqualifierCategory, number>;
    reasonsByLeadId: Record<number, DisqualifierReason[]>;
  };
}

function normalizeAddress(a?: string | null): string {
  if (!a) return "";
  return a
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function runPreMailDedupe(
  input: PreMailDedupeInput,
): Promise<PreMailDedupeResult> {
  const { organizationId, leadIds, recentMailWindowDays = 90 } = input;

  if (leadIds.length === 0) {
    return {
      acceptedLeads: [],
      skipped: { ownedParcel: [], recentlyMailed: [], returnedMail: [], doNotContact: [], missingAddress: [], parcelDisqualified: [] },
      totals: { input: 0, accepted: 0, skipped: 0 },
    };
  }

  // 1. Load the lead universe (org-scoped — never cross-tenant)
  const candidateRows = await db
    .select({
      id: leads.id,
      firstName: leads.firstName,
      lastName: leads.lastName,
      address: leads.address,
      city: leads.city,
      state: leads.state,
      zip: leads.zip,
      doNotContact: leads.doNotContact,
      optOutDate: leads.optOutDate,
    })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), inArray(leads.id, leadIds)));

  const skippedDnc: DedupedLead[] = [];
  const skippedMissing: DedupedLead[] = [];
  const survivors: DedupedLead[] = [];

  for (const row of candidateRows) {
    const dl: DedupedLead = {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
    };
    if (row.doNotContact === true || row.optOutDate) {
      skippedDnc.push(dl);
      continue;
    }
    if (!row.address || !row.city || !row.state || !row.zip) {
      skippedMissing.push(dl);
      continue;
    }
    survivors.push(dl);
  }

  if (survivors.length === 0) {
    const skipped =
      skippedDnc.length + skippedMissing.length;
    return {
      acceptedLeads: [],
      skipped: { ownedParcel: [], recentlyMailed: [], returnedMail: [], doNotContact: skippedDnc, missingAddress: skippedMissing, parcelDisqualified: [] },
      totals: { input: leadIds.length, accepted: 0, skipped },
    };
  }

  // 2. Pull owned parcels (status = owned/listed/sold) for this org, build
  //    a normalized address set. Anyone in the lead set whose mailing
  //    address matches a parcel we hold is skipped.
  let ownedAddressKeys = new Set<string>();
  try {
    const ownedRows = await db
      .select({ address: properties.address, city: properties.city, zip: properties.zip })
      .from(properties)
      .where(and(
        eq(properties.organizationId, organizationId),
        inArray(properties.status, ["owned", "listed", "sold"]),
      ));
    for (const p of ownedRows) {
      if (p.address) {
        ownedAddressKeys.add(`${normalizeAddress(p.address)}|${normalizeAddress(p.zip)}`);
      }
    }
  } catch (err) {
    logger.warn("[PreMailDedupe] owned-parcel lookup failed (non-fatal)", err instanceof Error ? err : undefined);
  }

  // 3. Pull mail pieces sent in the last N days for this org so we can
  //    skip re-mails inside the cooldown window.
  const since = new Date(Date.now() - recentMailWindowDays * 24 * 60 * 60 * 1000);
  let recentMailedLeadIds = new Set<number>();
  let returnedAddressKeys = new Set<string>();
  try {
    const recentPieces = await db
      .select({
        leadId: mailingOrderPieces.leadId,
        status: mailingOrderPieces.status,
        address: mailingOrderPieces.recipientAddressLine1,
        zip: mailingOrderPieces.recipientZipCode,
        createdAt: mailingOrderPieces.createdAt,
      })
      .from(mailingOrderPieces)
      .innerJoin(mailingOrders, eq(mailingOrderPieces.mailingOrderId, mailingOrders.id))
      .where(and(
        eq(mailingOrders.organizationId, organizationId),
        gte(mailingOrderPieces.createdAt, since),
      ));
    for (const p of recentPieces) {
      if (p.leadId != null) recentMailedLeadIds.add(p.leadId);
    }
    // Returned-mail lookup — broader window (the address is bad regardless of
    // when it returned). One year is the right horizon for USPS DPV churn.
    const returnedSince = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const returned = await db
      .select({ address: mailingOrderPieces.recipientAddressLine1, zip: mailingOrderPieces.recipientZipCode })
      .from(mailingOrderPieces)
      .innerJoin(mailingOrders, eq(mailingOrderPieces.mailingOrderId, mailingOrders.id))
      .where(and(
        eq(mailingOrders.organizationId, organizationId),
        eq(mailingOrderPieces.status, "returned"),
        gte(mailingOrderPieces.createdAt, returnedSince),
      ));
    for (const r of returned) {
      if (r.address) returnedAddressKeys.add(`${normalizeAddress(r.address)}|${normalizeAddress(r.zip)}`);
    }
  } catch (err) {
    logger.warn("[PreMailDedupe] mail history lookup failed (non-fatal)", err instanceof Error ? err : undefined);
  }

  // 4. Bucket each survivor
  const acceptedLeads: DedupedLead[] = [];
  const skippedOwned: DedupedLead[] = [];
  const skippedRecent: DedupedLead[] = [];
  const skippedReturned: DedupedLead[] = [];

  for (const lead of survivors) {
    const key = `${normalizeAddress(lead.address)}|${normalizeAddress(lead.zip)}`;
    if (ownedAddressKeys.has(key)) {
      skippedOwned.push(lead);
      continue;
    }
    if (returnedAddressKeys.has(key)) {
      skippedReturned.push(lead);
      continue;
    }
    if (recentMailedLeadIds.has(lead.id)) {
      skippedRecent.push(lead);
      continue;
    }
    acceptedLeads.push(lead);
  }

  // 5. Optional pre-spend parcel-quality screening over the ACCEPTED leads.
  //    OFF unless the caller supplies active rules — otherwise byte-identical.
  //    Fail-open: a lead with no cached signals is never disqualified.
  const skippedParcel: DedupedLead[] = [];
  let parcelScreeningSummary: PreMailDedupeResult["parcelScreening"];
  const screening = input.parcelScreening;
  if (screening && hasActiveRules(screening.rules)) {
    const items = acceptedLeads.map((l) => ({
      id: l.id,
      signals: screening.signalsByLeadId[l.id] ?? {},
    }));
    const result = screenParcels(items, screening.rules, screening.costPerPieceCents);
    const disqualifiedIds = new Set(result.disqualified.map((d) => d.id));
    const kept: DedupedLead[] = [];
    for (const lead of acceptedLeads) {
      if (disqualifiedIds.has(lead.id)) skippedParcel.push(lead);
      else kept.push(lead);
    }
    // Replace the accepted set with the screened-in leads.
    acceptedLeads.length = 0;
    acceptedLeads.push(...kept);
    parcelScreeningSummary = {
      spendSavedCents: result.spendSavedCents,
      byCategory: result.byCategory,
      reasonsByLeadId: Object.fromEntries(result.disqualified.map((d) => [d.id, d.reasons])),
    };
  }

  const skippedTotal =
    skippedOwned.length +
    skippedRecent.length +
    skippedReturned.length +
    skippedDnc.length +
    skippedMissing.length +
    skippedParcel.length;

  return {
    acceptedLeads,
    skipped: {
      ownedParcel: skippedOwned,
      recentlyMailed: skippedRecent,
      returnedMail: skippedReturned,
      doNotContact: skippedDnc,
      missingAddress: skippedMissing,
      parcelDisqualified: skippedParcel,
    },
    totals: {
      input: leadIds.length,
      accepted: acceptedLeads.length,
      skipped: skippedTotal,
    },
    parcelScreening: parcelScreeningSummary,
  };
}
