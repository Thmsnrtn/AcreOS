/**
 * The tax → Land exit and the redeemable-deed spend gate — V-Tax-1 T4b
 * (founder decisions 2026-10-29, docs/company/founder-decisions-2026-10-28-tax.md §3).
 *
 *   - THE EXIT IS AN OPERATOR ACTION. "Move to Land inventory" is available
 *     only once the deed is held (the clock's phase `deed_held`). It links the
 *     org's existing property for the same parcel (the one parcel matcher,
 *     shared with lead conversion) or creates one as `owned`; the certificate
 *     — and with it the tax calendar, position record and bid log — points at
 *     that property. Nothing moves on a status change alone.
 *   - A created property needs its acreage. The lot's list states it, or the
 *     operator states it with its source; AcreOS never invents one.
 *   - THE GATE. While any certificate on a property is not yet marketable in
 *     AcreOS (still redeemable, expired without a deed, or deed held without a
 *     quiet-title filing or attorney exception), feasibility / plat / due-
 *     diligence / rehab spend and the marketing paths are refused. "Marketable"
 *     is the clock's own answer (clockForCertificate), so the gate refuses
 *     exactly what the clock shows as locked. Redeemed and cancelled positions
 *     do not hold a property.
 *   - The prior tax history is carried as a priced input: what the position
 *     has cost so far (purchase + subsequent taxes paid), each with its basis.
 *   - Org-scoped throughout.
 */
import type { Response } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { activityEvents, auctionBidLog, properties, taxCertificates, taxEvents } from "@shared/schema";
import { normalizeParcelRef } from "@shared/parcel/parcelRef";
import type { Clock } from "@shared/tax/clock";
import { Errors } from "../../utils/errors";
import { clock as houseClock } from "../../utils/clock";
import { clockForCertificate } from "./certificateClock";

type CertRow = typeof taxCertificates.$inferSelect;

async function loadCertificate(organizationId: number, certificateId: string): Promise<CertRow | null> {
  const { db } = await import("../../db");
  const [row] = await db
    .select()
    .from(taxCertificates)
    .where(and(eq(taxCertificates.id, certificateId), eq(taxCertificates.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export type MoveToLandResult =
  | { status: "not_found" }
  | { status: "not_ready"; reason: string; phase: Clock["phase"] }
  | { status: "invalid_parcel"; reason: string }
  | { status: "needs_acreage"; reason: string }
  | { status: "linked"; propertyId: number; created: boolean; alreadyLinked: boolean };

/** The acreage a created property gets: the lot's stated acreage, or the operator's, with its source. */
async function statedAcreage(organizationId: number, cert: CertRow, given: { value: string; source: string } | null): Promise<{ value: string; source: string } | null> {
  if (given) return given;
  if (!cert.listingId) return null;
  const { db } = await import("../../db");
  const { taxSaleListings } = await import("@shared/schema");
  const [lot] = await db
    .select({ acreage: taxSaleListings.acreage })
    .from(taxSaleListings)
    .where(and(eq(taxSaleListings.id, cert.listingId), eq(taxSaleListings.organizationId, organizationId)))
    .limit(1);
  return lot?.acreage && Number(lot.acreage) > 0 ? { value: String(lot.acreage), source: "the tax list the lot was imported from" } : null;
}

export async function moveToLand(organizationId: number, certificateId: string, userId: string, a: { sizeAcres: { value: string; source: string } | null }): Promise<MoveToLandResult> {
  const cert = await loadCertificate(organizationId, certificateId);
  if (!cert) return { status: "not_found" };
  if (cert.propertyId) return { status: "linked", propertyId: cert.propertyId, created: false, alreadyLinked: true };
  const c = await clockForCertificate(organizationId, cert);
  if (c.phase !== "deed_held") {
    const reason =
      c.phase === "redeemable" ? `still redeemable until ${c.deadline} — the land is not yours yet`
        : c.phase === "redemption_expired" ? "redemption has expired, but the deed is not recorded as held — record the deed first"
          : c.phase === "redeemed" ? "the owner redeemed — there is no parcel to move" : "the certificate was cancelled";
    return { status: "not_ready", reason, phase: c.phase };
  }
  const ref = normalizeParcelRef({ apn: cert.apn, county: cert.county, state: cert.state });
  if (!ref.ok) return { status: "invalid_parcel", reason: "the certificate's parcel id, county and state do not form a parcel AcreOS can match" };

  const { withTransaction } = await import("../../db");
  const { findParcelProperties } = await import("../leads/convertLeadToDeal");
  const acreage = await statedAcreage(organizationId, cert, a.sizeAcres);
  return withTransaction(async (tx) => {
    // Re-read under the transaction: a concurrent move links once.
    const [fresh] = await tx.select({ propertyId: taxCertificates.propertyId }).from(taxCertificates).where(and(eq(taxCertificates.id, cert.id), eq(taxCertificates.organizationId, organizationId))).for("update");
    if (fresh?.propertyId) return { status: "linked", propertyId: fresh.propertyId, created: false, alreadyLinked: true } as const;
    const [existing] = await findParcelProperties(tx, organizationId, ref.ref);
    let propertyId: number;
    let created = false;
    if (existing) {
      propertyId = existing.id;
      // The parcel is now held: a property still in the acquisition pipeline
      // becomes owned. One already owned, listed or sold keeps its status.
      if (["prospect", "due_diligence", "offer_sent", "under_contract"].includes(existing.status)) {
        await tx.update(properties).set({ status: "owned", updatedAt: houseClock.now() }).where(and(eq(properties.id, existing.id), eq(properties.organizationId, organizationId)));
        // Every property-status writer withdraws listings for land that is no
        // longer held; "owned" is held, so this withdraws nothing — the rule
        // stays uniform for when it is not.
        const { withdrawListingsForUnheldProperty } = await import("../listingWithdrawal");
        await withdrawListingsForUnheldProperty(organizationId, existing.id, "owned");
      }
    } else {
      if (!acreage) return { status: "needs_acreage", reason: "the lot's list states no acreage — give the parcel's acreage and where it came from" } as const;
      const [row] = await tx
        .insert(properties)
        .values({
          organizationId,
          apn: cert.apn,
          county: cert.county,
          state: cert.state,
          sizeAcres: acreage.value,
          status: "owned",
          purchasePrice: (cert.purchaseAmountCents / 100).toFixed(2),
          purchaseDate: new Date(`${cert.saleDate as unknown as string}T00:00:00Z`),
        })
        .returning({ id: properties.id });
      propertyId = row.id;
      created = true;
    }
    await tx.update(taxCertificates).set({ propertyId, updatedAt: houseClock.now() }).where(and(eq(taxCertificates.id, cert.id), eq(taxCertificates.organizationId, organizationId)));
    const saleKind = cert.saleType.replace(/_/g, " ");
    await tx.insert(activityEvents).values({
      organizationId,
      entityType: "property",
      entityId: propertyId,
      eventType: "tax_position_moved_to_land",
      description: `Moved to Land from a tax ${saleKind} (${cert.county} County, ${cert.state}, APN ${cert.apn}); its tax history is attached.`,
      metadata: { certificateId: cert.id, created, ...(created && acreage ? { acreageSource: acreage.source } : {}) },
      userId,
    });
    return { status: "linked", propertyId, created, alreadyLinked: false } as const;
  });
}

// ── The spend and marketing gate ──────────────────────────────────────────

export interface HeldPosition {
  certificateId: string;
  apn: string;
  phase: Clock["phase"];
  reason: string;
  clears: string[];
}

/** Positions on this property that are not yet marketable in AcreOS (empty = clear). */
async function heldPositions(organizationId: number, propertyId: number): Promise<HeldPosition[]> {
  const { db } = await import("../../db");
  const certs = await db
    .select()
    .from(taxCertificates)
    .where(and(eq(taxCertificates.organizationId, organizationId), eq(taxCertificates.propertyId, propertyId)));
  const held: HeldPosition[] = [];
  for (const cert of certs) {
    const c = await clockForCertificate(organizationId, cert);
    if (c.phase === "redeemed" || c.phase === "cancelled" || c.marketable.eligible) continue;
    held.push({
      certificateId: cert.id,
      apn: cert.apn,
      phase: c.phase,
      reason: c.marketable.reason,
      clears: c.lock?.clears ?? ["the quiet-title petition is filed, or an attorney-reviewed exception is recorded"],
    });
  }
  return held;
}

/** Why this property may not be spent on or marketed yet, or null when it may. */
export async function taxHoldRefusal(organizationId: number, propertyId: number | null | undefined, what: string): Promise<{ message: string; held: HeldPosition[] } | null> {
  if (!propertyId) return null;
  const held = await heldPositions(organizationId, propertyId);
  if (held.length === 0) return null;
  return {
    message: `Not yet: ${what} waits until this parcel is marketable in AcreOS. ${held.map((h) => `APN ${h.apn}: ${h.reason}`).join("; ")}. What clears it: ${[...new Set(held.flatMap((h) => h.clears))].join("; ")}.`,
    held,
  };
}

/** Every property in the organization a tax position still holds — for the bulk marketing paths. */
export async function heldPropertyIds(organizationId: number): Promise<Set<number>> {
  const { db } = await import("../../db");
  const { isNotNull } = await import("drizzle-orm");
  const linked = await db
    .select({ propertyId: taxCertificates.propertyId })
    .from(taxCertificates)
    .where(and(eq(taxCertificates.organizationId, organizationId), isNotNull(taxCertificates.propertyId)));
  const out = new Set<number>();
  for (const id of new Set(linked.map((l) => l.propertyId!))) {
    if ((await heldPositions(organizationId, id)).length > 0) out.add(id);
  }
  return out;
}

/**
 * THE chokepoint every gated spend and marketing route calls before it writes.
 * Returns true to proceed; otherwise it has answered 422 with what holds the
 * property and what clears it. The routes it covers are enumerated in
 * tests/unit/redeemableDeedGate.test.ts — a new spend route must be added there.
 */
export async function refuseRedeemableDeedSpend(res: Response, organizationId: number, propertyId: number | null | undefined, what: string): Promise<boolean> {
  const refusal = await taxHoldRefusal(organizationId, propertyId, what);
  if (!refusal) return true;
  Errors.unprocessable(res, refusal.message, { redeemableDeedGate: true, held: refusal.held });
  return false;
}

// ── The tax history a property carries ────────────────────────────────────

export interface PropertyTaxHistory {
  positions: Array<{
    certificateId: string;
    apn: string;
    saleType: string;
    saleDate: string;
    status: string;
    clock: Clock;
    events: Array<{ eventType: string; eventDate: string; source: string | null; recordedAt: string }>;
    bids: Array<{ action: string; amountCents: number | null; performedAt: string; overMaxReason: string | null }>;
  }>;
  /** What the tax positions have cost so far — a priced input to the parcel's next offer. */
  moneyIn: { purchaseCents: number; subsequentTaxesCents: number; totalCents: number; basis: string };
}

export async function propertyTaxHistory(organizationId: number, propertyId: number): Promise<PropertyTaxHistory | null> {
  const { db } = await import("../../db");
  const [prop] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId))).limit(1);
  if (!prop) return null;
  const certs = await db
    .select()
    .from(taxCertificates)
    .where(and(eq(taxCertificates.organizationId, organizationId), eq(taxCertificates.propertyId, propertyId)))
    .orderBy(asc(taxCertificates.saleDate));
  const ids = certs.map((c) => c.id);
  const events = ids.length ? await db.select().from(taxEvents).where(and(eq(taxEvents.organizationId, organizationId), inArray(taxEvents.certificateId, ids))).orderBy(asc(taxEvents.eventDate)) : [];
  const listingIds = certs.map((c) => c.listingId).filter((x): x is number => x != null);
  const bids = listingIds.length ? await db.select().from(auctionBidLog).where(and(eq(auctionBidLog.organizationId, organizationId), inArray(auctionBidLog.listingId, listingIds))).orderBy(asc(auctionBidLog.performedAt)) : [];
  let purchaseCents = 0;
  let subsequentTaxesCents = 0;
  const positions: PropertyTaxHistory["positions"] = [];
  for (const cert of certs) {
    const mine = events.filter((e) => e.certificateId === cert.id);
    purchaseCents += cert.purchaseAmountCents;
    subsequentTaxesCents += mine.filter((e) => e.eventType === "subsequent_tax_paid").reduce((s, e) => s + Number((e.detail as { amountCents?: number }).amountCents ?? 0), 0);
    positions.push({
      certificateId: cert.id,
      apn: cert.apn,
      saleType: cert.saleType,
      saleDate: cert.saleDate as unknown as string,
      status: cert.status,
      clock: await clockForCertificate(organizationId, cert),
      events: mine.map((e) => ({ eventType: e.eventType, eventDate: e.eventDate as unknown as string, source: (e.ruleCited as { source?: string }).source ?? null, recordedAt: e.recordedAt.toISOString() })),
      bids: bids.filter((b) => b.listingId === cert.listingId).map((b) => ({ action: b.action, amountCents: b.amountCents ?? null, performedAt: b.performedAt.toISOString(), overMaxReason: b.overMaxReason ?? null })),
    });
  }
  return {
    positions,
    moneyIn: {
      purchaseCents,
      subsequentTaxesCents,
      totalCents: purchaseCents + subsequentTaxesCents,
      basis: "what you paid for the tax position(s) plus the subsequent taxes you recorded paying — costs not recorded in AcreOS are not included",
    },
  };
}
