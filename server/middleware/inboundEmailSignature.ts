import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../utils/logger";
import {
  type SnsMessage,
  verifySnsMessage,
  confirmSubscription,
  isReplay,
  _resetReplayCache,
  _setCertFetcherForTests,
  _setSubscribeConfirmerForTests,
  _resetTestOverrides,
} from "./snsVerification";

export type { SnsMessage };

// Re-export the shared SNS primitives so existing importers (and tests) that
// reach for them on this module keep working after the extraction.
export {
  isReplay,
  _resetReplayCache,
  _setCertFetcherForTests,
  _setSubscribeConfirmerForTests,
  _resetTestOverrides,
};

/**
 * F2 — Inbound email webhook signature verification + replay protection.
 *
 * The inbound-email webhook (POST /api/webhooks/inbound-email) was previously
 * unauthenticated, allowing any internet caller to POST a spoofed email body
 * and trigger downstream effects (lead creation, AI auto-reply, billing
 * notifications).
 *
 * AcreOS receives inbound mail via AWS SES → SNS → HTTPS, so this middleware
 * implements full SNS signature verification per the AWS spec. For non-SNS
 * forwarders (and tests), a generic HMAC-SHA256 fallback is supported using
 * the `INBOUND_EMAIL_WEBHOOK_SECRET` env var.
 *
 * Behavior:
 *   - Requests with `x-amz-sns-message-type` header are validated as SNS:
 *       * SigningCertURL host must match `^sns(\.|-fips\.|-fips-)?[a-z0-9-]+\.amazonaws\.com$`
 *       * Build canonical string per AWS spec for the message Type
 *       * Verify SHA1withRSA signature against the certificate
 *       * `SubscriptionConfirmation` types are auto-confirmed by GETting SubscribeURL
 *       * `Notification` types: parse the inner `Message` JSON and replace req.body
 *       * `MessageId` is checked against the replay cache
 *   - Otherwise, expect headers:
 *       * `x-acreos-timestamp` — unix seconds
 *       * `x-acreos-signature` — hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *       * Reject if timestamp drift > 5 minutes (replay window)
 *       * Reject if HMAC mismatch
 *       * Replay cache key derived from body.messageId or x-acreos-message-id
 *   - Fail-closed: missing/invalid signature → 401.
 */

const TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

// The SNS verification core (canonical string, cert allowlist + fetch,
// signature verify, subscription confirm, and the replay cache) lives in
// ./snsVerification and is shared with the SES bounce/complaint webhook.
// isReplay / _resetReplayCache and the test override setters are re-exported
// at the top of this file so existing importers keep working.

// ────────────────────────────────────────────────────────────────────────
// Generic HMAC fallback (inbound-email specific)
// ────────────────────────────────────────────────────────────────────────

function timingSafeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

function verifyHmac(
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
): { ok: boolean; reason?: string } {
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  const now = Date.now();
  const tsMs = ts * 1000;
  if (Math.abs(now - tsMs) > TIMESTAMP_DRIFT_MS) {
    return { ok: false, reason: "timestamp outside replay window" };
  }
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
  if (!timingSafeEqHex(expected, signature)) {
    return { ok: false, reason: "hmac mismatch" };
  }
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────
// Express middleware
// ────────────────────────────────────────────────────────────────────────

export function verifyInboundEmailSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  void (async () => {
    try {
      const snsType = req.headers["x-amz-sns-message-type"] as string | undefined;

      if (snsType) {
        // SNS path. Body should be the SNS envelope.
        const msg = req.body as SnsMessage;
        if (!msg || typeof msg !== "object") {
          logger.warn("[InboundEmailSig] SNS body not parsed");
          return res.status(401).json({ error: "Invalid SNS payload" });
        }

        const result = await verifySnsMessage(msg);
        if (!result.ok) {
          logger.warn("[InboundEmailSig] SNS signature invalid", {
            metadata: { reason: result.reason, messageId: msg.MessageId },
          });
          return res.status(401).json({ error: "Invalid SNS signature" });
        }

        // Replay protection
        if (isReplay(`sns:${msg.MessageId}`)) {
          logger.info("[InboundEmailSig] dropping duplicate SNS message", {
            metadata: { messageId: msg.MessageId },
          });
          return res.status(200).json({ deduped: true });
        }

        // Handle SubscriptionConfirmation: confirm and short-circuit
        if (msg.Type === "SubscriptionConfirmation") {
          if (msg.SubscribeURL) {
            try {
              await confirmSubscription(msg.SubscribeURL);
            } catch (err) {
              logger.error(
                "[InboundEmailSig] failed to confirm SNS subscription",
                err instanceof Error ? err : new Error(String(err)),
              );
              return res.status(500).json({ error: "Subscription confirmation failed" });
            }
          }
          return res.status(200).json({ confirmed: true });
        }

        if (msg.Type !== "Notification") {
          // Not something we handle (e.g. UnsubscribeConfirmation) — ack and stop.
          return res.status(200).json({ ignored: msg.Type });
        }

        // Notification: parse inner Message into req.body for the handler.
        let inner: unknown;
        try {
          inner = JSON.parse(String(msg.Message ?? "{}"));
        } catch {
          logger.warn("[InboundEmailSig] SNS Notification Message is not JSON");
          return res.status(400).json({ error: "SNS Message body is not JSON" });
        }
        req.body = inner;
        return next();
      }

      // HMAC fallback path
      const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
      if (!secret) {
        logger.error(
          "[InboundEmailSig] INBOUND_EMAIL_WEBHOOK_SECRET not set — rejecting (fail-closed)",
        );
        return res.status(401).json({ error: "Inbound email signature verification unavailable" });
      }

      const timestamp = req.headers["x-acreos-timestamp"] as string | undefined;
      const signature = req.headers["x-acreos-signature"] as string | undefined;
      if (!timestamp || !signature) {
        return res.status(401).json({ error: "Missing inbound email signature" });
      }

      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody || !Buffer.isBuffer(rawBody)) {
        logger.error("[InboundEmailSig] req.rawBody missing — body parser misconfigured");
        return res.status(500).json({ error: "Server misconfigured" });
      }

      const result = verifyHmac(rawBody, timestamp, signature, secret);
      if (!result.ok) {
        logger.warn("[InboundEmailSig] HMAC verification failed", {
          metadata: { reason: result.reason },
        });
        return res.status(401).json({ error: "Invalid inbound email signature" });
      }

      // Replay protection — prefer body.messageId, then x-acreos-message-id header
      const headerMid = req.headers["x-acreos-message-id"] as string | undefined;
      const bodyMid =
        req.body && typeof req.body === "object"
          ? ((req.body as { messageId?: unknown }).messageId as string | undefined)
          : undefined;
      const replayKey = bodyMid || headerMid;
      if (replayKey && isReplay(`hmac:${replayKey}`)) {
        logger.info("[InboundEmailSig] dropping duplicate inbound email", {
          metadata: { messageId: replayKey },
        });
        return res.status(200).json({ deduped: true });
      }

      next();
    } catch (err) {
      logger.error(
        "[InboundEmailSig] unexpected error",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).json({ error: "Signature verification error" });
    }
  })();
}

/**
 * Asserted at boot when inbound-email routes are mounted. We do NOT require
 * INBOUND_EMAIL_WEBHOOK_SECRET in development (HMAC fallback is optional if SNS
 * is the only path), but in production we require either:
 *   - INBOUND_EMAIL_WEBHOOK_SECRET (for HMAC fallback), or
 *   - explicit acknowledgement that only SNS will be used (set
 *     INBOUND_EMAIL_SNS_ONLY=1).
 */
export function assertInboundEmailSecretsConfigured(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;
  const hasHmac = Boolean(process.env.INBOUND_EMAIL_WEBHOOK_SECRET);
  const snsOnly = process.env.INBOUND_EMAIL_SNS_ONLY === "1";
  if (!hasHmac && !snsOnly) {
    throw new Error(
      "Inbound email webhook is mounted but neither INBOUND_EMAIL_WEBHOOK_SECRET " +
        "nor INBOUND_EMAIL_SNS_ONLY=1 is set. Refusing to boot — see F2.",
    );
  }
}
