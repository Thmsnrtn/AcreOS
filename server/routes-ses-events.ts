/**
 * SES bounce / complaint webhook (Gap 4 — product-truth audit).
 *
 * AcreOS sends transactional + outreach email through Amazon SES. SES reports
 * bounces and complaints via SNS → HTTPS. Until now the suppression list was
 * only fed by the SendGrid event webhook — but SES is the actual sender, so a
 * hard bounce or spam complaint on an SES send never reached the suppression
 * list. That silently degrades domain reputation: we'd keep mailing addresses
 * that already bounced or reported us.
 *
 * This route closes that loop. It:
 *   1. Verifies the SNS signature with the SAME airtight verifier the inbound-
 *      email webhook uses (cert-host allowlist + canonical string + RSA verify)
 *      — see middleware/snsVerification.ts. No shared-secret to leak.
 *   2. Auto-confirms SubscriptionConfirmation envelopes (host-validated URL).
 *   3. Drops SNS replays by MessageId.
 *   4. Parses the inner SES notification and seeds email_suppressions:
 *        - Permanent bounce  → hard suppress
 *        - Transient/Undetermined bounce → soft-bounce strike (3 → suppress)
 *        - Complaint         → suppress + founder alert
 *      Future sends consult that list before calling SES
 *      (services/emailService → filterSuppressed).
 *
 * The route is self-contained on body parsing: SNS posts `text/plain`, so we
 * mount a dedicated text parser and JSON.parse the envelope ourselves rather
 * than depend on the global application/json parser matching.
 */

import express, { type Express, type Request, type Response } from "express";
import {
  type SnsMessage,
  verifySnsMessage,
  confirmSubscription,
  isReplay,
} from "./middleware/snsVerification";
import {
  suppress,
  recordSoftBounce,
  alertFounderOnComplaint,
  type SuppressionSource,
  type BounceCategory,
} from "./services/emailSuppressions";
import { recordSense } from "./services/autopilot/perception";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";

// ────────────────────────────────────────────────────────────────────────
// SES notification shapes (only the fields we read)
// ────────────────────────────────────────────────────────────────────────

interface SesBouncedRecipient {
  emailAddress?: string;
  diagnosticCode?: string;
}
interface SesComplainedRecipient {
  emailAddress?: string;
}
interface SesNotification {
  notificationType?: string; // "Bounce" | "Complaint" | "Delivery"
  bounce?: {
    bounceType?: string; // "Permanent" | "Transient" | "Undetermined"
    bounceSubType?: string;
    bouncedRecipients?: SesBouncedRecipient[];
  };
  complaint?: {
    complainedRecipients?: SesComplainedRecipient[];
    complaintFeedbackType?: string;
  };
  mail?: {
    destination?: string[];
    tags?: Record<string, string[]>;
    headers?: Array<{ name?: string; value?: string }>;
  };
  [k: string]: unknown;
}

export interface SesRecipientSuppression {
  email: string;
  reason: string;
  source: SuppressionSource;
  bounceCategory: BounceCategory;
  /** When true, funnel through recordSoftBounce() instead of immediate suppress(). */
  softBounce?: true;
}

/**
 * Pure mapping: SES notification → the list of per-recipient suppression
 * actions it implies. Exposed for tests. Deliveries (and any unknown type)
 * produce no suppressions.
 */
export function sesNotificationToSuppressions(
  notification: SesNotification,
): SesRecipientSuppression[] {
  if (!notification || typeof notification !== "object") return [];

  const out: SesRecipientSuppression[] = [];

  switch (notification.notificationType) {
    case "Bounce": {
      const bounce = notification.bounce ?? {};
      const recipients = Array.isArray(bounce.bouncedRecipients) ? bounce.bouncedRecipients : [];
      // Per AWS: only "Permanent" bounces are durable failures. "Transient" and
      // "Undetermined" are treated as soft — a single one must NOT permanently
      // suppress (a full mailbox clears; an undetermined bounce may be noise).
      const permanent = bounce.bounceType === "Permanent";
      for (const r of recipients) {
        const email = (r.emailAddress ?? "").trim();
        if (!email) continue;
        if (permanent) {
          out.push({
            email,
            reason: r.diagnosticCode || `ses_hard_bounce:${bounce.bounceSubType ?? "unknown"}`,
            source: "bounce",
            bounceCategory: "hard",
          });
        } else {
          out.push({
            email,
            reason: r.diagnosticCode || `ses_soft_bounce:${bounce.bounceType ?? "transient"}`,
            source: "bounce",
            bounceCategory: "soft",
            softBounce: true,
          });
        }
      }
      break;
    }
    case "Complaint": {
      const complaint = notification.complaint ?? {};
      const recipients = Array.isArray(complaint.complainedRecipients)
        ? complaint.complainedRecipients
        : [];
      for (const r of recipients) {
        const email = (r.emailAddress ?? "").trim();
        if (!email) continue;
        out.push({
          email,
          reason: `ses_complaint:${complaint.complaintFeedbackType ?? "abuse"}`,
          source: "spam",
          bounceCategory: "complaint",
        });
      }
      break;
    }
    default:
      // Delivery, DeliveryDelay, Send, Open, Click, etc. — nothing to suppress.
      break;
  }

  return out;
}

/**
 * Best-effort org attribution from the SES `mail.tags` block. emailService can
 * stamp an `organization_id` SES message tag; if present we attach it to the
 * suppression so /founder/deliverability can show the bounce against the
 * originating tenant. Absence is fine — the suppression list is global.
 */
function orgIdFromNotification(notification: SesNotification): number | undefined {
  const tagVal = notification.mail?.tags?.organization_id?.[0];
  if (tagVal === undefined) return undefined;
  const n = Number(tagVal);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Apply a parsed SES notification to the suppression list. Exposed for tests.
 */
export async function ingestSesNotification(
  notification: SesNotification,
): Promise<{ type: string; suppressed: number; softStrikes: number; skipped: number }> {
  const type = String(notification?.notificationType ?? "unknown");
  const actions = sesNotificationToSuppressions(notification);
  const orgId = orgIdFromNotification(notification);

  let suppressed = 0;
  let softStrikes = 0;
  let skipped = 0;

  for (const action of actions) {
    const email = action.email.toLowerCase();
    try {
      if (action.softBounce) {
        const result = await recordSoftBounce(email, action.reason, { organizationId: orgId });
        softStrikes++;
        if (result.suppressed) suppressed++;
        // Perception: the brain perceives deliverability risk (non-PII: org + category).
        void recordSense("email_bounce", 1, { organizationId: orgId, category: "soft" });
      } else {
        await suppress(email, action.reason, action.source, {
          bounceCategory: action.bounceCategory,
          organizationId: orgId,
        });
        suppressed++;

        if (action.bounceCategory === "complaint") {
          void recordSense("email_complaint", 1, { organizationId: orgId });
        } else {
          void recordSense("email_bounce", 1, { organizationId: orgId, category: action.bounceCategory });
        }

        // Credit the REAL failure consequence onto the autopilot send that
        // targeted this recipient (no-op unless a witnessed send_email stamped
        // target_ref="email:<recipient>"). Mirrors the SendGrid path.
        void import("./services/autopilot/experienceLog")
          .then(({ recordConsequenceByTarget }) =>
            recordConsequenceByTarget(`email:${email}`, { deliveryBounced: true }),
          )
          .catch(() => {});

        if (action.bounceCategory === "complaint") {
          await alertFounderOnComplaint({ email, organizationId: orgId, reason: action.reason });
        }
      }
    } catch (err) {
      logger.error(
        "[ses-events] failed to apply suppression",
        err instanceof Error ? err : new Error(String(err)),
        { metadata: { email, type } },
      );
      skipped++;
    }
  }

  return { type, suppressed, softStrikes, skipped };
}

export function registerSesEventRoutes(app: Express): void {
  /**
   * SES → SNS bounce/complaint webhook.
   *
   * Dedicated text parser: SNS posts `text/plain; charset=UTF-8`, which the
   * global application/json parser skips. We read the raw text and JSON.parse
   * the SNS envelope ourselves, then verify its signature.
   */
  app.post(
    "/api/webhooks/ses/events",
    express.text({ type: () => true, limit: "1mb" }),
    async (req: Request, res: Response) => {
      // Parse the SNS envelope. req.body may already be an object (if some
      // upstream parser matched) or the raw string from express.text().
      let msg: SnsMessage;
      try {
        const raw = req.body;
        msg =
          typeof raw === "string"
            ? (JSON.parse(raw) as SnsMessage)
            : (raw as SnsMessage);
      } catch {
        return Errors.badRequest(res, "Invalid SNS envelope");
      }
      if (!msg || typeof msg !== "object" || typeof msg.Type !== "string") {
        return Errors.badRequest(res, "Invalid SNS envelope");
      }

      // Authenticate: verify the SNS signature. Fail-closed on any problem.
      const verdict = await verifySnsMessage(msg);
      if (!verdict.ok) {
        logger.warn("[ses-events] SNS signature invalid", {
          metadata: { reason: verdict.reason, messageId: msg.MessageId },
        });
        return Errors.unauthorized(res);
      }

      // Replay protection. (res.json defaults to 200.)
      if (isReplay(`ses-sns:${msg.MessageId}`)) {
        return res.json({ deduped: true });
      }

      // Subscription lifecycle.
      if (msg.Type === "SubscriptionConfirmation") {
        if (msg.SubscribeURL) {
          try {
            await confirmSubscription(msg.SubscribeURL);
          } catch (err) {
            logger.error(
              "[ses-events] failed to confirm SNS subscription",
              err instanceof Error ? err : new Error(String(err)),
            );
            return Errors.internal(res, err);
          }
        }
        return res.json({ confirmed: true });
      }
      if (msg.Type !== "Notification") {
        // UnsubscribeConfirmation and anything else — ack and stop.
        return res.json({ ignored: msg.Type });
      }

      // Notification: the inner Message is the SES event JSON.
      let notification: SesNotification;
      try {
        notification = JSON.parse(String(msg.Message ?? "{}")) as SesNotification;
      } catch {
        logger.warn("[ses-events] SNS Notification Message is not JSON", {
          metadata: { messageId: msg.MessageId },
        });
        return Errors.badRequest(res, "SNS Message body is not JSON");
      }

      try {
        const result = await ingestSesNotification(notification);
        logger.info("[ses-events] processed SES notification", { metadata: result });
        return res.json({ ok: true, ...result });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
