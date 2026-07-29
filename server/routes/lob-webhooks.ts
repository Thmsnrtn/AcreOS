/**
 * Wave B — Lob delivery-event ingest: `POST /api/webhooks/lob`.
 *
 * THE PROBLEM THIS SOLVES: the In-Flight tracker rendered a five-stage
 * printed → in transit → expected → delivered → response timeline whose
 * "USPS scan timestamps" were, by the component's own admission, UI-only.
 * `mail_shipment_pieces.printed_at / in_transit_at / delivered_at` were
 * declared and never written, so the timeline was a shape with nothing
 * behind it. This endpoint is the missing feed.
 *
 * ── Signature verification (Lob's documented scheme) ─────────────────────
 *
 * Lob signs every webhook POST with two headers:
 *
 *   Lob-Signature-Timestamp: <unix millis>
 *   Lob-Signature:           <hex HMAC-SHA256>
 *
 * where the HMAC is taken over `${timestamp}.${rawRequestBody}` keyed by the
 * webhook's secret (Lob dashboard → Webhooks → the endpoint's secret).
 * We recompute it over the EXACT bytes Express buffered (`req.rawBody`,
 * captured by the `express.json({ verify })` hook in server/index.ts) —
 * re-serialising the parsed object would change key order and whitespace and
 * break the comparison.
 *
 * Unverified posts are rejected. No secret configured → every post is
 * rejected: an unauthenticated writer into the attribution tables could
 * fabricate deliveries for any campaign, which is exactly the failure mode
 * this wave exists to close.
 *
 * ── Idempotence ──────────────────────────────────────────────────────────
 *
 * Lob retries, and USPS events arrive out of order. Status only ever moves
 * FORWARD through the rank below, and each timestamp column is written only
 * when it is still NULL — so a re-delivered "mailed" event after a
 * "delivered" event cannot walk a piece backwards or overwrite a real scan
 * time with a later replay.
 *
 * Mounted by `registerOutreachMailRoutes` — see the note in
 * server/routes/public-qr-redirect.ts for why these live under
 * server/routes/ rather than the `server/routes-*.ts` manifest convention.
 */

import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { mailShipmentPieces } from "@shared/schema";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";

/** Reject posts whose signed timestamp is older than this (replay guard). */
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;

/** Monotonic piece lifecycle. A webhook may only move a piece up this list. */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  printed: 1,
  in_transit: 2,
  delivered: 3,
  returned: 4,
  failed: 4,
};

/**
 * Lob event type → the piece state it proves.
 *
 * `re-routed` and `in_local_area` are genuine USPS scans but do not advance
 * beyond in_transit. `*.created` is Lob accepting the job, not USPS touching
 * paper — it maps to `printed` because that is what it means operationally
 * (the piece exists in the print queue), and `rendered_pdf` confirms it.
 */
const EVENT_MAP: Record<string, { status: string; stamp: StampColumn | null }> = {
  created: { status: "printed", stamp: "printedAt" },
  rendered_pdf: { status: "printed", stamp: "printedAt" },
  mailed: { status: "in_transit", stamp: "inTransitAt" },
  in_transit: { status: "in_transit", stamp: "inTransitAt" },
  in_local_area: { status: "in_transit", stamp: null },
  processed_for_delivery: { status: "in_transit", stamp: null },
  "re-routed": { status: "in_transit", stamp: null },
  rerouted: { status: "in_transit", stamp: null },
  delivered: { status: "delivered", stamp: "deliveredAt" },
  returned_to_sender: { status: "returned", stamp: "returnedAt" },
  failed: { status: "failed", stamp: null },
};

type StampColumn = "printedAt" | "inTransitAt" | "deliveredAt" | "returnedAt";

/** `postcard.processed_for_delivery` → `processed_for_delivery`. */
function normalizeEventType(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const idx = raw.indexOf(".");
  return (idx >= 0 ? raw.slice(idx + 1) : raw).toLowerCase();
}

/**
 * Verify Lob's HMAC. Returns a reason string when the post must be rejected,
 * or null when the signature is good.
 */
export function verifyLobSignature(args: {
  secret: string | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: Buffer | string | undefined;
  now?: number;
}): string | null {
  const { secret, signature, timestamp, rawBody } = args;
  const now = args.now ?? Date.now();

  if (!secret) return "webhook_secret_not_configured";
  if (!signature || !timestamp) return "missing_signature_headers";
  if (rawBody === undefined || rawBody === null) return "missing_raw_body";

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return "invalid_timestamp";
  if (Math.abs(now - ts) > MAX_SIGNATURE_AGE_MS) return "stale_timestamp";

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.toLowerCase(), "utf8");
  if (a.length !== b.length) return "signature_mismatch";
  if (!timingSafeEqual(a, b)) return "signature_mismatch";

  return null;
}

/** Pull the provider piece id + event timestamp out of a Lob event body. */
export function readLobEvent(body: unknown): {
  eventType: string | null;
  providerPieceId: string | null;
  occurredAt: Date;
  expectedDeliveryAt: Date | null;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const evt = (b.event_type ?? {}) as Record<string, unknown>;
  const resource = (b.body ?? {}) as Record<string, unknown>;

  const providerPieceId =
    (typeof b.reference_id === "string" && b.reference_id) ||
    (typeof resource.id === "string" && resource.id) ||
    null;

  const rawDate = typeof b.date_created === "string" ? b.date_created : null;
  const parsedDate = rawDate ? new Date(rawDate) : null;

  const rawExpected =
    typeof resource.expected_delivery_date === "string"
      ? resource.expected_delivery_date
      : null;
  const parsedExpected = rawExpected ? new Date(rawExpected) : null;

  return {
    eventType: normalizeEventType(evt.id ?? b.event_type),
    providerPieceId,
    occurredAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date(),
    expectedDeliveryAt:
      parsedExpected && !Number.isNaN(parsedExpected.getTime()) ? parsedExpected : null,
  };
}

export function registerLobWebhookRoutes(app: Express): void {
  // Unauthenticated by necessity — Lob posts server-to-server with no
  // session. The HMAC IS the authentication; there is no fallback path that
  // accepts an unsigned body.
  app.post("/api/webhooks/lob", async (req: Request, res: Response) => {
    const header = (name: string): string | undefined => {
      const v = req.get(name);
      return v === null ? undefined : v;
    };

    const rejection = verifyLobSignature({
      secret: process.env.LOB_WEBHOOK_SECRET,
      signature: header("lob-signature"),
      timestamp: header("lob-signature-timestamp"),
      rawBody: (req.rawBody as Buffer | string | undefined) ?? undefined,
    });

    if (rejection) {
      logger.warn("[lob-webhook] rejected unverified post", {
        metadata: { reason: rejection },
      });
      return Errors.unauthorized(res);
    }

    try {
      const { eventType, providerPieceId, occurredAt, expectedDeliveryAt } = readLobEvent(
        req.body,
      );

      if (!eventType || !providerPieceId) {
        return Errors.badRequest(res, "Lob event is missing event_type or piece reference");
      }

      const mapped = EVENT_MAP[eventType];
      if (!mapped) {
        // A Lob event we don't model (e.g. address verification). Ack so Lob
        // stops retrying; record nothing rather than guess a stage.
        logger.info("[lob-webhook] unmodelled event ignored", {
          metadata: { eventType },
        });
        return res.json({ received: true, applied: false, reason: "unmodelled_event" });
      }

      const [piece] = await db
        .select({
          id: mailShipmentPieces.id,
          organizationId: mailShipmentPieces.organizationId,
          shipmentId: mailShipmentPieces.shipmentId,
          status: mailShipmentPieces.status,
        })
        .from(mailShipmentPieces)
        .where(eq(mailShipmentPieces.providerPieceId, providerPieceId))
        .limit(1);

      if (!piece) {
        // Mail sent from another environment (test vs live keys) or before
        // provider ids were written back. Ack — retrying will never match.
        logger.warn("[lob-webhook] no piece for provider id", {
          metadata: { eventType },
        });
        return res.json({ received: true, applied: false, reason: "unknown_piece" });
      }

      const currentRank = STATUS_RANK[piece.status] ?? 0;
      const nextRank = STATUS_RANK[mapped.status] ?? 0;

      // Timestamp columns: write-once. A retry cannot overwrite the first
      // (real) scan time with a replay's clock.
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (nextRank > currentRank) set.status = mapped.status;
      if (mapped.stamp) {
        set[mapped.stamp] = sql`COALESCE(${mailShipmentPieces[mapped.stamp]}, ${occurredAt})`;
      }
      if (expectedDeliveryAt) {
        set.expectedDeliveryAt = sql`COALESCE(${mailShipmentPieces.expectedDeliveryAt}, ${expectedDeliveryAt})`;
      }

      await db
        .update(mailShipmentPieces)
        .set(set)
        .where(eq(mailShipmentPieces.id, piece.id));

      logger.info("[lob-webhook] delivery event applied", {
        metadata: {
          organizationId: piece.organizationId,
          shipmentId: piece.shipmentId,
          pieceId: piece.id,
          eventType,
          status: nextRank > currentRank ? mapped.status : piece.status,
        },
      });

      res.json({ received: true, applied: true });
    } catch (err) {
      Errors.internal(res, err);
    }
  });
}
