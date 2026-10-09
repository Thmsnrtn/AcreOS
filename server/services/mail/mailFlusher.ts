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

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { leads, mailShipments, mailShipmentPieces, marketingSpend, organizations } from "@shared/schema";
import { MailRouter, PartialMailSendError, type MailShipment, type MailPiece, type MailShipmentSpeed } from "./router";
import { qrRedirectUrl } from "./qrCodes";
import { refundPoolDebit } from "../creditPool";
import { logger } from "../../utils/logger";
import { leadNotOptedOutSql } from "../leadContactability";
import { mergeMailCopy } from "@shared/parcel/ownerName";
import { clock } from "../../utils/clock";

/** Minimal shipment shape the flusher needs (raw claim row OR a mapped row). */
export interface FlushShipment {
  id: number;
  organizationId: number;
  pieceType: string;
  speed: string;
  copySnapshot: string | null;
  debitEventKey: string | null;
  debitedCents: number | null;
  /** Pieces the debit paid for — the denominator of every per-piece refund share. */
  pieceCount?: number | null;
}

export interface FlushPiece {
  id: number;
  recipientName: string | null;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  /**
   * The per-piece attribution code minted at queue time
   * (`mail_shipment_pieces.qr_code`). NULL when this deployment has no
   * signing secret, or when the piece predates instrumentation — in which
   * case nothing about attribution is printed and every downstream surface
   * reports the piece as "not instrumented".
   */
  qrCode?: string | null;
}

/**
 * The response block actually PRINTED on an instrumented piece.
 *
 * Wave B audit (2026-07-29): the QR short code was minted, stored and read
 * back by the analytics surfaces, but NOTHING ever put it on the paper — the
 * flusher selected five address columns and fanned only the copy snapshot
 * into the provider payload. `/r/:code` was therefore unreachable by the one
 * person it exists for (the human holding the postcard), so
 * `qr_scan_count` could only ever stay zero while the API reported
 * `qrTrackingEnabled: true`. This is the missing half.
 *
 * It prints the short link as TEXT, not as a QR image: this codebase has no
 * QR encoder and inventing one here would be a bigger change than the audit
 * warrants. A typed short link is a real, honest attribution path — a scan of
 * it is a scan — and the day a renderer lands it draws from the same code.
 */
export function responseBlockHtml(qrCode: string | null | undefined): string {
  if (!qrCode) return "";
  const url = qrRedirectUrl(qrCode);
  // The code is `[0-9a-z]+-[0-9a-z]{8}` by construction (services/mail/qrCodes.ts)
  // and the base URL is operator config, so there is nothing to escape — but
  // keep the markup trivial so no template engine can be tricked by it.
  return (
    `<div class="acreos-response-block">` +
    `<p>Respond online: <strong>${url.replace(/^https?:\/\//i, "")}</strong></p>` +
    `</div>`
  );
}

/**
 * Pure: map a persisted shipment + its pending pieces into the router's
 * MailShipment. The copy snapshot is fanned to every piece's content vars (the
 * lob adapter reads htmlContent for letters, frontHtml/backHtml for
 * postcards). An instrumented piece also carries its response block — on the
 * BACK for postcards (the front is the operator's artwork) and appended to the
 * body for letters. Pieces keep their DB order so the router's index-aligned
 * result maps straight back.
 */
export function buildRouterShipment(ship: FlushShipment, pieces: FlushPiece[]): MailShipment {
  const copy = ship.copySnapshot ?? "";
  const mailPieces: MailPiece[] = pieces.map((p) => {
    const [firstName, ...rest] = (p.recipientName ?? "").trim().split(/\s+/);
    const responseBlock = responseBlockHtml(p.qrCode);
    // Per piece: the same merge the composer's preview renders.
    const pieceCopy = mergeMailCopy(copy, { name: p.recipientName, city: p.city, state: p.state }, { html: true });
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
      pieceRef: `mail_piece:${p.id}`,
      vars: {
        htmlContent: pieceCopy + responseBlock,
        frontHtml: pieceCopy,
        backHtml: responseBlock,
      },
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
async function refundShipment(ship: FlushShipment, reason: string, alreadyRefundedCents = 0): Promise<void> {
  if (!ship.debitEventKey || !ship.debitedCents || ship.debitedCents <= 0) return;
  await refundPoolDebit({
    organizationId: ship.organizationId,
    originalEventId: ship.debitEventKey,
    amountCents: ship.debitedCents - alreadyRefundedCents,
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
      spentAt: clock.now(),
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

/** Share of the shipment's debit that `pieces` of it paid for. */
function debitShareCents(ship: FlushShipment, pieces: number): number {
  const total = ship.pieceCount && ship.pieceCount > 0 ? ship.pieceCount : null;
  if (!ship.debitedCents || ship.debitedCents <= 0 || !total || pieces <= 0) return 0;
  return Math.floor((ship.debitedCents * pieces) / total);
}

/**
 * The hold exists so a send can be stopped. A seller who texts STOP (or is
 * deleted) AFTER the queue and before the provider handoff must not be
 * mailed: the queue's suppression check ran 30 minutes ago. Returns the
 * pending pieces whose lead is now suppressed; a piece with no lead (legacy
 * rows) is not second-guessed. Quality directive 2026-09-29.
 */
async function suppressedPieceIds(
  ship: FlushShipment,
  pieces: Array<{ id: number; leadId: number | null }>,
): Promise<Set<number>> {
  const leadIds = Array.from(new Set(pieces.map((p) => p.leadId).filter((x): x is number => x != null)));
  if (leadIds.length === 0) return new Set();
  const live = await db
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, ship.organizationId),
        inArray(leads.id, leadIds),
        sql`${leads.deletedAt} IS NULL`,
        leadNotOptedOutSql(),
      ),
    );
  const mailable = new Set(live.map((l) => l.id));
  return new Set(pieces.filter((p) => p.leadId != null && !mailable.has(p.leadId)).map((p) => p.id));
}

/**
 * The org's first PHYSICAL mail: a provider accepted a live piece. Recorded
 * here, from the provider's acceptance — not at queue time (the hold can be
 * cancelled, the provider can refuse) and never for a test-key send. Only
 * Lob and PostGrid distinguish live from test keys; any other provider's
 * acceptance is not claimed as live.
 */
async function recordFirstLiveLetter(ship: FlushShipment, provider: string, acceptedPieces: number): Promise<void> {
  if (acceptedPieces <= 0) return;
  let live = false;
  if (provider === "lob") live = (await import("./providers/lob")).lobSendsLive();
  else if (provider === "postgrid") live = (process.env.POSTGRID_API_KEY ?? "").startsWith("live_");
  if (!live) return;
  try {
    const { recordActivationEventAsync } = await import("../activation");
    recordActivationEventAsync({
      orgId: ship.organizationId,
      eventName: "first_letter_sent",
      eventValue: { shipmentId: ship.id, provider, acceptedPieces, source: "mail_flusher:provider_accepted" },
    });
  } catch {
    /* telemetry never fails a sent shipment */
  }
}

/**
 * Send one claimed shipment through the router; writeback or fail+refund.
 *
 * TENANCY. Every query below is pinned with `eq(<table>.organizationId,
 * ship.organizationId)` alongside the id. The claim query in
 * `flushDueMailShipments` already RETURNS `organization_id`, so the org is
 * carried in the `ship` row this function is handed — it was simply never put
 * in a WHERE clause. That made the safety of a send, a piece-status
 * writeback, a refund and a COGS booking depend on the ONE caller having
 * claimed the rows itself; a second caller passing a hand-built
 * `FlushShipment` would have mailed, and refunded against, another tenant's
 * shipment. `mail_shipments.organization_id` and
 * `mail_shipment_pieces.organization_id` are both NOT NULL, so the predicate
 * always applies and an org-mismatched `ship` now writes nothing.
 */
async function flushOne(ship: FlushShipment): Promise<"sent" | "failed"> {
  const pieces = await db
    .select({
      id: mailShipmentPieces.id,
      recipientName: mailShipmentPieces.recipientName,
      addressLine1: mailShipmentPieces.addressLine1,
      city: mailShipmentPieces.city,
      state: mailShipmentPieces.state,
      zip: mailShipmentPieces.zip,
      // Wave B audit fix: without this column the minted code never reached
      // the printed piece, so the public /r/:code scan path was unreachable.
      qrCode: mailShipmentPieces.qrCode,
      leadId: mailShipmentPieces.leadId,
    })
    .from(mailShipmentPieces)
    .where(
      and(
        eq(mailShipmentPieces.shipmentId, ship.id),
        eq(mailShipmentPieces.organizationId, ship.organizationId),
        eq(mailShipmentPieces.status, "pending"),
      ),
    )
    .orderBy(asc(mailShipmentPieces.id));

  // ── 0. Suppression during the hold. ─────────────────────────────────────
  let suppressedRefundCents = 0;
  const suppressed = await suppressedPieceIds(ship, pieces as Array<{ id: number; leadId: number | null }>);
  if (suppressed.size > 0) {
    await db
      .update(mailShipmentPieces)
      .set({ status: "suppressed" })
      .where(
        and(
          inArray(mailShipmentPieces.id, Array.from(suppressed)),
          eq(mailShipmentPieces.organizationId, ship.organizationId),
        ),
      );
    suppressedRefundCents = debitShareCents(ship, suppressed.size);
    if (ship.debitEventKey && suppressedRefundCents > 0) {
      await refundPoolDebit({
        organizationId: ship.organizationId,
        // Its own refund key: the refund ledger keeps ONE refund per event, and
        // a later partial-send refund must not be swallowed by this one.
        // The debit itself; this refund's own key keeps it apart from a
        // later failure refund of the same shipment (audit of 1694a0b).
        originalEventId: ship.debitEventKey,
        refundKey: `${ship.debitEventKey}:suppressed:refund`,
        amountCents: suppressedRefundCents,
        reason: `${suppressed.size} piece(s) not sent — the recipient opted out or was removed during the hold`,
      }).catch((e) =>
        logger.error("[mailFlusher] suppression refund failed", e instanceof Error ? e : undefined, {
          metadata: { shipmentId: ship.id },
        }),
      );
    }
    logger.info(`[mailFlusher] shipment ${ship.id}: ${suppressed.size} piece(s) suppressed during the hold`);
    for (let i = pieces.length - 1; i >= 0; i--) if (suppressed.has(pieces[i].id)) pieces.splice(i, 1);
    if (pieces.length === 0) {
      await db
        .update(mailShipments)
        .set({ status: "cancelled", cancelledAt: clock.now(), cancellationReason: "every recipient opted out or was removed during the hold" })
        .where(and(eq(mailShipments.id, ship.id), eq(mailShipments.organizationId, ship.organizationId)));
      return "sent";
    }
  }

  if (pieces.length === 0) {
    // Nothing to send (already flushed / empty) — mark sent, no charge change.
    await db
      .update(mailShipments)
      .set({ status: "sent", sentAt: clock.now() })
      .where(and(eq(mailShipments.id, ship.id), eq(mailShipments.organizationId, ship.organizationId)));
    return "sent";
  }

  // ── 1. The provider call. Only a failure HERE — nothing accepted — is a
  //    whole-shipment failure with a full refund (DEFECT-0105). ──────────
  let route: Awaited<ReturnType<MailRouter["route"]>>;
  try {
    route = await router.route(buildRouterShipment(ship, pieces as FlushPiece[]));
  } catch (err) {
    if (err instanceof PartialMailSendError) {
      await recordFirstLiveLetter(ship, err.provider, err.accepted.length);
      return settlePartialShipment(ship, pieces, err);
    }
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(mailShipmentPieces)
      .set({ status: "failed" })
      .where(
        and(
          eq(mailShipmentPieces.shipmentId, ship.id),
          eq(mailShipmentPieces.organizationId, ship.organizationId),
        ),
      );
    await db
      .update(mailShipments)
      .set({ status: "failed", cancellationReason: reason.slice(0, 500) })
      .where(and(eq(mailShipments.id, ship.id), eq(mailShipments.organizationId, ship.organizationId)));
    await refundShipment(
      ship,
      `mail send failed — refunded (never charge-without-send): ${reason.slice(0, 120)}`,
      suppressedRefundCents,
    );
    logger.warn(`[mailFlusher] shipment ${ship.id} FAILED + refunded: ${reason}`);
    return "failed";
  }

  // ── 2. Everything below runs AFTER the provider accepted every piece. A
  //    failure here is a bookkeeping failure on mail that WAS sent: it is
  //    logged loudly with the provider ids for reconciliation and is never
  //    turned into "failed" + a refund, which used to reverse the charge on
  //    printed mail. ───────────────────────────────────────────────────────
  const sentPieces = route.result.pieces;
  try {
    // Index-aligned writeback (lobAdapter preserves order).
    for (let i = 0; i < pieces.length; i++) {
      const providerPieceId = sentPieces[i]?.providerPieceId ?? null;
      await db
        .update(mailShipmentPieces)
        .set({ status: "sent", providerPieceId })
        .where(
          and(
            eq(mailShipmentPieces.id, pieces[i].id),
            eq(mailShipmentPieces.organizationId, ship.organizationId),
          ),
        );
    }
    await db
      .update(mailShipments)
      .set({ status: "sent", sentAt: clock.now(), provider: route.chosenProvider })
      .where(and(eq(mailShipments.id, ship.id), eq(mailShipments.organizationId, ship.organizationId)));
  } catch (err) {
    logger.error(
      "[mailFlusher] provider ACCEPTED the shipment but the write-back failed — NOT refunded; reconcile by provider piece id",
      err instanceof Error ? err : undefined,
      {
        metadata: {
          shipmentId: ship.id,
          organizationId: ship.organizationId,
          provider: route.chosenProvider,
          providerPieceIds: sentPieces.map((p) => p.providerPieceId),
        },
      },
    );
    return "sent";
  }
  await bookFreeSendAcquisitionCogs(ship);
  await recordFirstLiveLetter(ship, route.chosenProvider, sentPieces.length);
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
}

/**
 * A provider accepted the first k pieces and then failed (DEFECT-0105). The k
 * accepted pieces are printed: they are written back as `sent` with their
 * provider ids and are neither re-sent nor refunded. The rest are `failed`,
 * and ONLY their share of the debit is refunded. The shipment reads `sent`
 * (mail went out) with the partial outcome stated in its reason.
 */
async function settlePartialShipment(
  ship: FlushShipment,
  pieces: Array<{ id: number }>,
  err: PartialMailSendError,
): Promise<"sent"> {
  const k = Math.min(err.accepted.length, pieces.length);
  for (let i = 0; i < pieces.length; i++) {
    const pieceScope = and(eq(mailShipmentPieces.id, pieces[i].id), eq(mailShipmentPieces.organizationId, ship.organizationId));
    if (i < k) {
      await db
        .update(mailShipmentPieces)
        .set({ status: "sent", providerPieceId: err.accepted[i].providerPieceId })
        .where(pieceScope);
    } else {
      await db.update(mailShipmentPieces).set({ status: "failed" }).where(pieceScope);
    }
  }
  const unsent = pieces.length - k;
  const reason =
    `partially sent: ${k} of ${pieces.length} piece(s) accepted by ${err.provider}; ` +
    `${unsent} failed and were refunded — ${err.causeMessage}`;
  await db
    .update(mailShipments)
    .set({ status: "sent", sentAt: clock.now(), provider: err.provider, cancellationReason: reason.slice(0, 500) })
    .where(and(eq(mailShipments.id, ship.id), eq(mailShipments.organizationId, ship.organizationId)));
  if (ship.debitEventKey && ship.debitedCents && ship.debitedCents > 0 && unsent > 0) {
    // Against the pieces the debit PAID for, not those left after suppression.
    const shareCents = ship.pieceCount ? debitShareCents(ship, unsent) : Math.floor((ship.debitedCents * unsent) / pieces.length);
    await refundPoolDebit({
      organizationId: ship.organizationId,
      originalEventId: ship.debitEventKey,
      amountCents: shareCents,
      reason: `mail partially sent — refunded ${unsent} of ${pieces.length} unsent piece(s)`,
    }).catch((e) =>
      logger.error("[mailFlusher] partial refund failed", e instanceof Error ? e : undefined, {
        metadata: { shipmentId: ship.id },
      }),
    );
  }
  logger.warn(`[mailFlusher] shipment ${ship.id} PARTIALLY sent: ${reason}`);
  return "sent";
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
export async function flushDueMailShipments(now: Date = clock.now(), limit = 50): Promise<FlushSummary> {
  // ── Outreach stop-loss gate (founder rulings #4/#5, 2026-07-28) ──────────
  // Checked BEFORE claiming so a paused cycle leaves every due shipment in
  // 'queued' — skipped, never dropped, never marked failed, never refunded.
  // getOutreachStopLossStatus never throws and fails CLOSED (unreadable
  // ledger → paused) per the capitalTracker precedent.
  const { getOutreachStopLossStatus, notifyOutreachPausedOnce } = await import("../outreachStopLoss");
  const stopLoss = await getOutreachStopLossStatus();
  if (stopLoss.paused) {
    logger.warn("[mailFlusher] outreach stop-loss paused — leaving due shipments queued", {
      metadata: {
        reason: stopLoss.reason,
        lineCents: stopLoss.lineCents,
        mtdSpendCents: stopLoss.mtdSpendCents,
        monthKey: stopLoss.monthKey,
      },
    });
    void notifyOutreachPausedOnce(stopLoss);
    return { claimed: 0, sent: 0, failed: 0 };
  }

  const claimed = await db.execute(sql`
    UPDATE mail_shipments SET status = 'sending'
    WHERE id IN (
      SELECT id FROM mail_shipments
      WHERE status = 'queued' AND leaves_at <= ${now}
      ORDER BY leaves_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, organization_id, piece_type, speed, copy_snapshot, debit_event_key, debited_cents, piece_count
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
      pieceCount: r.piece_count ?? null,
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
