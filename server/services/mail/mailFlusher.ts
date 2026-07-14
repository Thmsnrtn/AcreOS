/**
 * Mail flusher worker (product-truth audit — the "charged-but-never-sent" fix).
 *
 * The /api/outreach/mail endpoint persists a `mail_shipments` row (status
 * `queued`), per-recipient `mail_shipment_pieces` (status `pending`), and debits
 * the customer's credit pool — then waits out a 30-minute hold window so the
 * send can be CANCELLED. The audit found there was NO worker on the other side:
 * once the window passed, queued shipments sat forever — charged, never mailed.
 *
 * This is that worker. Every cycle it atomically CLAIMS due shipments
 * (`queued` + `leaves_at <= now`, FOR UPDATE SKIP LOCKED so two workers never
 * double-fire), routes each through the real MailRouter → Lob, writes the
 * provider piece ids back, and marks the shipment `sent`. On a send FAILURE it
 * marks the shipment `failed` and REFUNDS the exact enqueue debit — the
 * load-bearing guarantee: a shipment is never charged-without-sent.
 *
 * The piece↔result mapping is by INDEX: lobAdapter.send emits results in the
 * same order it consumes `shipment.pieces`, and we build that array in the
 * pieces' `id` order. Config/identity failures (the common case) throw BEFORE
 * any piece is sent, so refund-full-on-failure is honest.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { mailShipments, mailShipmentPieces, marketingSpend, organizations } from "@shared/schema";
import { MailRouter, type MailShipment, type MailPiece, type MailShipmentSpeed } from "./router";
import { refundPoolDebit } from "../creditPool";
import { logger } from "../../utils/logger";

/** Minimal shipment shape the flusher needs (raw claim row OR a mapped row). */
export interface FlushShipment {
  id: number;
  organizationId: number;
  pieceType: string;
  speed: string;
  copySnapshot: string | null;
  debitEventKey: string | null;
  debitedCents: number | null;
}

export interface FlushPiece {
  id: number;
  recipientName: string | null;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Pure: map a persisted shipment + its pending pieces into the router's
 * MailShipment. The copy snapshot is fanned to every piece's content vars (the
 * lob adapter reads htmlContent for letters, frontHtml for postcards). Pieces
 * keep their DB order so the router's index-aligned result maps straight back.
 */
export function buildRouterShipment(ship: FlushShipment, pieces: FlushPiece[]): MailShipment {
  const copy = ship.copySnapshot ?? "";
  const mailPieces: MailPiece[] = pieces.map((p) => {
    const [firstName, ...rest] = (p.recipientName ?? "").trim().split(/\s+/);
    return {
      recipient: {
        firstName: firstName || undefined,
        lastName: rest.length ? rest.join(" ") : undefined,
        address1: p.addressLine1,
        city: p.city,
        state: p.state,
        zip: p.zip,
      },
      pieceType: ship.pieceType as MailPiece["pieceType"],
      vars: { htmlContent: copy, frontHtml: copy, backHtml: "" },
    };
  });
  return {
    customerId: ship.organizationId,
    organizationId: ship.organizationId,
    pieces: mailPieces,
    speed: ship.speed as MailShipmentSpeed,
    personalizationRequired: false,
    feature: "outreach_mail_queue",
  };
}

const router = new MailRouter();

/** Refund the exact enqueue debit for a shipment that did not (fully) send. */
async function refundShipment(ship: FlushShipment, reason: string): Promise<void> {
  if (!ship.debitEventKey || !ship.debitedCents || ship.debitedCents <= 0) return;
  await refundPoolDebit({
    organizationId: ship.organizationId,
    originalEventId: ship.debitEventKey,
    amountCents: ship.debitedCents,
    reason,
  }).catch((err) =>
    logger.error("[mailFlusher] refund failed", err instanceof Error ? err : undefined, {
      metadata: { shipmentId: ship.id },
    }),
  );
}

/**
 * D4 (founder decision 2026-07-11): a FREE-tier org's send rides the capped
 * free first-send allowance, so its real postage cost is OUR acquisition
 * spend — book it into the marketing_spend ledger (channel "other",
 * campaignRef tags it machine-readably) so CAC math sees it. Actuals only:
 * booked on successful send, from the locked quote total, never at queue
 * time. Idempotent per shipment via the campaignRef tag. Best-effort — a
 * ledger hiccup must never fail a sent shipment.
 */
async function bookFreeSendAcquisitionCogs(ship: FlushShipment): Promise<void> {
  try {
    const [org] = await db
      .select({ tier: organizations.subscriptionTier })
      .from(organizations)
      .where(eq(organizations.id, ship.organizationId));
    if (((org?.tier ?? "free").toLowerCase()) !== "free") return;

    const [row] = await db
      .select({ totalCents: mailShipments.totalCents })
      .from(mailShipments)
      .where(eq(mailShipments.id, ship.id));
    const totalCents = row?.totalCents ?? 0;
    if (totalCents <= 0) return;

    const campaignRef = `free_first_send:ship=${ship.id}`;
    const existing = await db
      .select({ id: marketingSpend.id })
      .from(marketingSpend)
      .where(eq(marketingSpend.campaignRef, campaignRef));
    if (existing.length > 0) return;

    await db.insert(marketingSpend).values({
      channel: "other",
      amountCents: totalCents,
      spentAt: new Date(),
      source: "autopilot",
      campaignRef,
      note: `Free first-send postage (D4 acquisition COGS) — org ${ship.organizationId}, shipment ${ship.id}`,
    });
  } catch (err) {
    logger.error("[mailFlusher] free-send COGS booking failed (send unaffected)", err instanceof Error ? err : undefined, {
      metadata: { shipmentId: ship.id },
    });
  }
}

/** Send one claimed shipment through the router; writeback or fail+refund. */
async function flushOne(ship: FlushShipment): Promise<"sent" | "failed"> {
  const pieces = await db
    .select({
      id: mailShipmentPieces.id,
      recipientName: mailShipmentPieces.recipientName,
      addressLine1: mailShipmentPieces.addressLine1,
      city: mailShipmentPieces.city,
      state: mailShipmentPieces.state,
      zip: mailShipmentPieces.zip,
    })
    .from(mailShipmentPieces)
    .where(and(eq(mailShipmentPieces.shipmentId, ship.id), eq(mailShipmentPieces.status, "pending")))
    .orderBy(asc(mailShipmentPieces.id));

  if (pieces.length === 0) {
    // Nothing to send (already flushed / empty) — mark sent, no charge change.
    await db.update(mailShipments).set({ status: "sent", sentAt: new Date() }).where(eq(mailShipments.id, ship.id));
    return "sent";
  }

  try {
    const route = await router.route(buildRouterShipment(ship, pieces as FlushPiece[]));
    const sentPieces = route.result.pieces;
    // Index-aligned writeback (lobAdapter preserves order).
    for (let i = 0; i < pieces.length; i++) {
      const providerPieceId = sentPieces[i]?.providerPieceId ?? null;
      await db
        .update(mailShipmentPieces)
        .set({ status: "sent", providerPieceId })
        .where(eq(mailShipmentPieces.id, pieces[i].id));
    }
    await db
      .update(mailShipments)
      .set({ status: "sent", sentAt: new Date(), provider: route.chosenProvider })
      .where(eq(mailShipments.id, ship.id));
    await bookFreeSendAcquisitionCogs(ship);
    logger.info(`[mailFlusher] sent shipment ${ship.id} (${pieces.length} pieces via ${route.chosenProvider})`);
    // CP3 of Jarvis Phase 1 (Verified Act-and-Confirm) — after a REAL send,
    // enqueue an independent READ-ONLY verification of the shipment's own
    // record (piece accounting vs the locked quote, debit-ledger consistency,
    // compliance posture). Fire-and-forget: a verify hiccup must never fail a
    // shipment that already sent; verification only observes.
    void import("../solene/verifyQueue")
      .then(({ enqueueMailShipmentVerify }) => enqueueMailShipmentVerify(ship.id))
      .catch((err) =>
        logger.warn(
          `[mailFlusher] verify enqueue failed for shipment ${ship.id} (send unaffected): ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    return "sent";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(mailShipmentPieces)
      .set({ status: "failed" })
      .where(eq(mailShipmentPieces.shipmentId, ship.id));
    await db
      .update(mailShipments)
      .set({ status: "failed", cancellationReason: reason.slice(0, 500) })
      .where(eq(mailShipments.id, ship.id));
    await refundShipment(ship, `mail send failed — refunded (never charge-without-send): ${reason.slice(0, 120)}`);
    logger.warn(`[mailFlusher] shipment ${ship.id} FAILED + refunded: ${reason}`);
    return "failed";
  }
}

export interface FlushSummary {
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * Claim + flush all due mail shipments. Atomic claim (queued→sending, FOR
 * UPDATE SKIP LOCKED) makes it safe to run on every worker; bounded batch so a
 * single cycle can't run unbounded. Best-effort per shipment — one failure
 * never blocks the rest.
 */
export async function flushDueMailShipments(now: Date = new Date(), limit = 50): Promise<FlushSummary> {
  const claimed = await db.execute(sql`
    UPDATE mail_shipments SET status = 'sending'
    WHERE id IN (
      SELECT id FROM mail_shipments
      WHERE status = 'queued' AND leaves_at <= ${now}
      ORDER BY leaves_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, organization_id, piece_type, speed, copy_snapshot, debit_event_key, debited_cents
  `);
  const rows: any[] = Array.isArray(claimed) ? claimed : ((claimed as { rows?: unknown[] })?.rows ?? []);
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const ship: FlushShipment = {
      id: r.id,
      organizationId: r.organization_id,
      pieceType: r.piece_type,
      speed: r.speed,
      copySnapshot: r.copy_snapshot ?? null,
      debitEventKey: r.debit_event_key ?? null,
      debitedCents: r.debited_cents ?? null,
    };
    try {
      const outcome = await flushOne(ship);
      if (outcome === "sent") sent++;
      else failed++;
    } catch (err) {
      // A flushOne that throws OUTSIDE the send (e.g. a DB write error) leaves
      // the shipment 'sending'; surface it. The next cycle won't re-claim it
      // (status != queued) — a stuck 'sending' is visible + reapable later.
      failed++;
      logger.error("[mailFlusher] flushOne threw unexpectedly", err instanceof Error ? err : undefined, {
        metadata: { shipmentId: ship.id },
      });
    }
  }
  if (rows.length > 0) logger.info(`[mailFlusher] cycle: claimed=${rows.length} sent=${sent} failed=${failed}`);
  return { claimed: rows.length, sent, failed };
}
