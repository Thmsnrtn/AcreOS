/**
 * POST /api/stripe/webhook: the route around WebhookHandlers.processWebhook.
 *
 * Two kinds of failure reach this route, and only one is an incident:
 *
 *   - A delivery that cannot be authenticated as Stripe's (no signature, or a
 *     signature that does not verify). It answers 400, is counted on its own
 *     metric, and is logged at most once a minute. It never pages: nothing
 *     about it says a customer was affected.
 *   - A VERIFIED event that failed to process, or a configuration fault that
 *     stops any event from verifying. That can mean charged-but-not-provisioned,
 *     so it pages P0 — once per key per window, because Stripe re-delivers the
 *     same failing event on its retry ladder and every retry would otherwise
 *     page again.
 *
 * Mounted in server/index.ts before the JSON body parser (the signature is
 * computed over the raw bytes).
 */
import express, { type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  WebhookHandlers,
  StripeWebhookProcessingError,
  StripeWebhookSignatureError,
} from "./webhookHandlers";
import {
  recordStripeWebhookFailure,
  recordStripeWebhookSignatureRejected,
  recordStripeWebhookVerified,
} from "./metrics";
import { notifyOnCall } from "./services/oncall";
import { logger } from "./utils/logger";
import { getClientIp } from "./utils/clientIp";
import { sendError } from "./utils/errors";

/**
 * One page per failure key per this window. The window is held in process
 * memory, so each running machine pages at most once per key per window.
 */
const STRIPE_WEBHOOK_PAGE_WINDOW_MS = 30 * 60 * 1000;
const lastPagedAt = new Map<string, number>();

/** True when this key has not paged inside the window; records the page. */
function shouldPageStripeWebhookFailure(key: string, now: number = Date.now()): boolean {
  const last = lastPagedAt.get(key);
  if (last !== undefined && now - last < STRIPE_WEBHOOK_PAGE_WINDOW_MS) return false;
  lastPagedAt.set(key, now);
  return true;
}

/** Test seam: forget every page so each case starts from a clean window. */
export function resetStripeWebhookPageWindow(): void {
  lastPagedAt.clear();
  lastRejectWarnAt = 0;
  suppressedRejectWarns = 0;
}

const REJECT_WARN_INTERVAL_MS = 60 * 1000;
let lastRejectWarnAt = 0;
let suppressedRejectWarns = 0;

function noteUnauthenticatedDelivery(reason: string): void {
  recordStripeWebhookSignatureRejected();
  const now = Date.now();
  if (now - lastRejectWarnAt < REJECT_WARN_INTERVAL_MS) {
    suppressedRejectWarns++;
    return;
  }
  logger.warn("[StripeWebhook] Rejected a delivery that did not verify", {
    reason,
    suppressedSinceLastWarn: suppressedRejectWarns,
  });
  lastRejectWarnAt = now;
  suppressedRejectWarns = 0;
}

/**
 * Per-IP limiter for deliveries that did not verify. It is consulted only
 * AFTER verification has failed, so a verified Stripe delivery never reaches
 * it and can never be throttled, whatever the state of its address's bucket.
 */
const stripeWebhookRejectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
  message: { message: "Webhook rate limit exceeded." },
});

/** 400 for a delivery that did not verify, or 429 once its address is over the limit. */
function rejectUnauthenticated(req: Request, res: Response, reason: string, message: string): void {
  noteUnauthenticatedDelivery(reason);
  void stripeWebhookRejectLimiter(req, res, () => {
    sendError(res, 400, "BAD_REQUEST", message);
  });
}

async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers["stripe-signature"];

  if (!signature) {
    rejectUnauthenticated(req, res, "missing signature", "Missing stripe-signature");
    return;
  }

  try {
    const sig = Array.isArray(signature) ? signature[0] : signature;

    if (!Buffer.isBuffer(req.body)) {
      logger.error("[StripeWebhook] req.body is not a Buffer");
      sendError(res, 500, "INTERNAL_ERROR", "Webhook processing error");
      return;
    }

    await WebhookHandlers.processWebhook(req.body as Buffer, sig);

    recordStripeWebhookVerified();
    res.status(200).json({ received: true });
  } catch (error: unknown) {
    if (error instanceof StripeWebhookSignatureError) {
      rejectUnauthenticated(req, res, "signature did not verify", "Webhook signature verification failed");
      return;
    }

    const message = error instanceof Error ? error.message : "unknown";
    logger.error("[StripeWebhook] Webhook processing failed", error);
    recordStripeWebhookFailure();

    const verified = error instanceof StripeWebhookProcessingError;
    if (verified) recordStripeWebhookVerified();
    const pageKey = verified ? `event:${error.eventType}` : "before-verification";
    if (shouldPageStripeWebhookFailure(pageKey)) {
      const what = verified
        ? `A verified Stripe event (${error.eventType}, ${error.eventId}) failed to process and returned non-2xx (Stripe will retry).`
        : "A Stripe webhook delivery failed before its event could be verified and claimed (configuration or infrastructure).";
      // Fire-and-forget so a slow alert delivery never holds the HTTP response
      // (Stripe retries on non-2xx regardless).
      void notifyOnCall(
        "P0",
        "Stripe webhook processing failed",
        `${what}\nA customer may have been charged but not provisioned.\n\nError: ${message}`,
        { source: "stripe_webhook", dedupeKey: pageKey },
      ).catch((notifyErr) => {
        logger.error("[StripeWebhook] notifyOnCall failed", notifyErr);
      });
    }
    sendError(res, 400, "BAD_REQUEST", "Webhook processing error");
  }
}

/** Mounts the route with its raw-body parser. */
export function mountStripeWebhook(app: express.Express): void {
  app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleStripeWebhook);
}
