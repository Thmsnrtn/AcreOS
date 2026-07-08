/**
 * SendGrid Event Webhook ingestion (Hessam §2.3).
 *
 * SendGrid POSTs an array of event objects per delivery decision. We:
 *   1. Verify the Ed25519 signature on `timestamp + raw body` using the
 *      public key from process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY.
 *      Header is `X-Twilio-Email-Event-Webhook-Signature` (yes, Twilio-
 *      prefixed — that's SendGrid's actual header after the acquisition).
 *      Timestamp lives in `X-Twilio-Email-Event-Webhook-Timestamp`.
 *   2. Parse the JSON body and insert one row per event into email_events,
 *      using ON CONFLICT (sg_event_id) DO NOTHING for idempotency.
 *   3. For hard bounce / spamreport / unsubscribe events, also seed the
 *      email_suppressions list. Future sends consult that list before
 *      calling SES (see services/emailSuppressions.ts).
 *
 * Security notes:
 *   - The route is wired into the global JSON body parser, which captures
 *     `req.rawBody` (server/index.ts). We hash that exact buffer; never
 *     re-stringify the parsed JSON, which would break the signature.
 *   - Missing pubkey → service returns 503 (configuration error). We
 *     intentionally do NOT fall through to "accept anything" in that
 *     state; an unconfigured webhook is a closed door.
 */

import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { db } from "./db";
import { emailEvents } from "@shared/schema";
import {
  suppress,
  suppressionFromEvent,
  recordSoftBounce,
  alertFounderOnComplaint,
} from "./services/emailSuppressions";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { recordSense } from "./services/autopilot/perception";

const SIG_HEADER = "x-twilio-email-event-webhook-signature";
const TS_HEADER = "x-twilio-email-event-webhook-timestamp";

interface SendGridEvent {
  email: string;
  event: string;
  sg_event_id?: string;
  sg_message_id?: string;
  timestamp?: number; // epoch seconds
  reason?: string;
  status?: string;
  response?: string;
  type?: string;
  [k: string]: unknown;
}

/**
 * Convert SendGrid's base64-encoded Ed25519 public key (DER-wrapped) into
 * a Node KeyObject. SendGrid emits the key as a base64-encoded DER
 * SubjectPublicKeyInfo block; the simplest portable way to import it is
 * to wrap it in PEM and let crypto.createPublicKey parse it.
 */
function loadPublicKey(b64: string): crypto.KeyObject {
  // Already PEM? Use as-is.
  if (b64.includes("BEGIN PUBLIC KEY")) {
    return crypto.createPublicKey(b64);
  }
  // Strip whitespace, wrap as PEM.
  const clean = b64.replace(/\s+/g, "");
  const pem = `-----BEGIN PUBLIC KEY-----\n${clean.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----\n`;
  return crypto.createPublicKey(pem);
}

/**
 * Verify the Ed25519 signature on (timestamp + rawBody).
 * Returns true on success, false on any failure (missing bits, bad sig,
 * malformed key). Never throws.
 */
export function verifySendGridSignature(opts: {
  publicKeyB64: string;
  signatureB64: string;
  timestamp: string;
  rawBody: Buffer | string;
}): boolean {
  try {
    const key = loadPublicKey(opts.publicKeyB64);
    const message = Buffer.concat([
      Buffer.from(opts.timestamp, "utf8"),
      typeof opts.rawBody === "string" ? Buffer.from(opts.rawBody, "utf8") : opts.rawBody,
    ]);
    const signature = Buffer.from(opts.signatureB64, "base64");
    return crypto.verify(null, message, key, signature);
  } catch (err) {
    logger.warn("[sendgrid-events] signature verify threw", {
      metadata: { error: (err as Error).message },
    });
    return false;
  }
}

/**
 * Insert events + seed suppressions. Exposed for tests.
 * Returns counts: { inserted, suppressed, skipped }.
 */
export async function ingestSendGridEvents(events: SendGridEvent[]): Promise<{
  inserted: number;
  suppressed: number;
  skipped: number;
}> {
  let inserted = 0;
  let suppressed = 0;
  let skipped = 0;

  for (const evt of events) {
    if (!evt || typeof evt.email !== "string" || typeof evt.event !== "string") {
      skipped++;
      continue;
    }
    const email = evt.email.trim().toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }

    try {
      const rows = await db
        .insert(emailEvents)
        .values({
          email,
          event: evt.event,
          sgEventId: evt.sg_event_id ?? null,
          sgMessageId: evt.sg_message_id ?? null,
          timestamp: typeof evt.timestamp === "number" ? new Date(evt.timestamp * 1000) : null,
          reason: evt.reason ?? null,
          status: evt.status ?? null,
          response: evt.response ?? null,
          metadata: evt as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing({ target: emailEvents.sgEventId })
        .returning({ id: emailEvents.id });
      if (rows.length > 0) inserted++;
      else skipped++;
    } catch (err) {
      logger.error("[sendgrid-events] insert failed", err instanceof Error ? err : undefined, {
        metadata: { email, event: evt.event },
      });
      skipped++;
      continue;
    }

    const sup = suppressionFromEvent(evt);
    if (sup) {
      // Per-org isolation: if SendGrid passed our org-id custom arg, attach
      // it to the suppression record so /founder/deliverability can show
      // the bounce against the originating tenant.
      const orgIdRaw = (evt as Record<string, unknown>).organization_id;
      const orgId = typeof orgIdRaw === "number" ? orgIdRaw : Number(orgIdRaw) || undefined;

      if (sup.softBounce) {
        // Soft bounce: 3 strikes within 30 days → suppress.
        const result = await recordSoftBounce(email, sup.reason, { organizationId: orgId });
        if (result.suppressed) suppressed++;
      } else {
        await suppress(email, sup.reason, sup.source, {
          bounceCategory: sup.bounceCategory,
          organizationId: orgId,
        });
        suppressed++;
        // Hands roadmap P0.2 — feed the autopilot perception bus so the brain
        // perceives deliverability risk (best-effort, non-PII: org + category).
        if (sup.bounceCategory === "complaint") {
          void recordSense("email_complaint", 1, { organizationId: orgId });
        } else {
          void recordSense("email_bounce", 1, { organizationId: orgId, category: sup.bounceCategory });
        }
        // kernel-elevation T0.1: credit the REAL failure consequence onto the
        // autopilot send that targeted this recipient (no-op unless a witnessed
        // send_email stamped target_ref="email:<recipient>").
        void import("./services/autopilot/experienceLog").then(({ recordConsequenceByTarget }) =>
          recordConsequenceByTarget(`email:${email.toLowerCase()}`, { deliveryBounced: true }),
        ).catch(() => {});
        // Complaint = spam report. Immediate founder alert in addition to
        // the suppression itself (see alertFounderOnComplaint comments).
        if (sup.bounceCategory === "complaint") {
          await alertFounderOnComplaint({
            email,
            organizationId: orgId,
            reason: sup.reason,
          });
        }
      }
    }
  }

  return { inserted, suppressed, skipped };
}

export function registerSendGridEventRoutes(app: Express): void {
  /**
   * SendGrid Event Webhook endpoint.
   *
   * Mounted under /api so it picks up the existing JSON body parser
   * (which captures req.rawBody via the verify callback). The CSRF
   * middleware exempts this path (see middleware/csrf.ts).
   */
  app.post(
    "/api/webhooks/sendgrid/events",
    async (req: Request, res: Response) => {
      const publicKey = process.env.SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY;
      if (!publicKey) {
        logger.warn("[sendgrid-events] webhook hit but SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY not set");
        return res
          .status(503)
          .json({ error: "NOT_CONFIGURED", message: "SendGrid event webhook not configured", statusCode: 503 });
      }

      const sig = req.headers[SIG_HEADER];
      const ts = req.headers[TS_HEADER];
      const sigStr = Array.isArray(sig) ? sig[0] : sig;
      const tsStr = Array.isArray(ts) ? ts[0] : ts;

      if (!sigStr || !tsStr) {
        return Errors.unauthorized(res);
      }

      const rawBody = (req as unknown as { rawBody?: Buffer | string }).rawBody;
      if (!rawBody) {
        // Without the raw body the signature can't be verified. Reject hard.
        logger.error("[sendgrid-events] rawBody missing on webhook request");
        return Errors.unauthorized(res);
      }

      const ok = verifySendGridSignature({
        publicKeyB64: publicKey,
        signatureB64: sigStr,
        timestamp: tsStr,
        rawBody,
      });
      if (!ok) {
        return Errors.unauthorized(res);
      }

      // Parse — Express has already done so via the global json parser, but
      // be defensive in case the body slot was stomped by another middleware.
      let body: unknown = req.body;
      if (Buffer.isBuffer(body)) {
        try {
          body = JSON.parse(body.toString("utf8"));
        } catch {
          return Errors.badRequest(res, "Invalid JSON body");
        }
      }
      if (!Array.isArray(body)) {
        return Errors.badRequest(res, "Expected an array of events");
      }

      try {
        const result = await ingestSendGridEvents(body as SendGridEvent[]);
        logger.info("[sendgrid-events] ingested", { metadata: result });
        return res.status(200).json({ ok: true, ...result });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );
}
