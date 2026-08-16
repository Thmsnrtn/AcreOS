import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated, getOrCreateOrg } from "./auth";
import { AuthenticatedRequest, getOrganization, getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  processInboundEmail,
  getLeadEmailThread,
  markEmailsRead,
  getUnreadEmailCount,
  storeOutboundEmail,
  generateReplyToAddress,
} from "./services/inboundEmailService";
import { sendEmail } from "./services/emailService";
import { db } from "./storage";
import { leadEmails, leads } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import {
  verifyInboundEmailSignature,
  assertInboundEmailSecretsConfigured,
  isReplay,
} from "./middleware/inboundEmailSignature";

const inboundEmailSchema = z.object({
  from: z.string().email(),
  to: z.union([z.string(), z.array(z.string())]),
  subject: z.string().optional(),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  messageId: z.string().optional(),
  inReplyTo: z.string().optional(),
});

export function registerInboundEmailRoutes(app: Express): void {
  // F2: refuse to mount this surface without proper secret config in prod.
  assertInboundEmailSecretsConfigured();

  // Webhook: receive inbound email from SES/SNS.
  // verifyInboundEmailSignature MUST run first — it authenticates the request
  // (SNS signature OR HMAC fallback), confirms SNS subscriptions, drops replays,
  // and unwraps the SNS Notification envelope into req.body.
  app.post(
    "/api/webhooks/inbound-email",
    verifyInboundEmailSignature,
    async (req, res) => {
      try {
        const parsed = inboundEmailSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }

        // Body-level replay protection: even if the outer SNS/HMAC envelope was
        // unique, the same email Message-ID could be re-sent through different
        // envelopes. Drop duplicates by RFC 5322 Message-ID.
        if (parsed.data.messageId && isReplay(`email:${parsed.data.messageId}`)) {
          logger.info("[InboundEmail] dropping duplicate Message-ID", {
            metadata: { messageId: parsed.data.messageId },
          });
          return res.json({ success: true, deduped: true });
        }

        const result = await processInboundEmail(parsed.data);
        if (!result.success) {
          return Errors.badRequest(res, result.error || "Failed to process inbound email");
        }

        res.json({ success: true, leadId: result.leadId });
      } catch (error) {
        Errors.internal(res, error);
      }
    },
  );

  // Get email thread for a lead
  app.get(
    "/api/leads/:leadId/emails",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res) => {
      try {
        const orgId = getOrganizationId(req);
        const leadId = parseInt(req.params.leadId, 10);
        if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");

        const emails = await getLeadEmailThread(leadId, orgId);
        res.json(emails);
      } catch (error) {
        Errors.internal(res, error);
      }
    }
  );

  // Mark emails as read
  app.post(
    "/api/leads/:leadId/emails/mark-read",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res) => {
      try {
        const orgId = getOrganizationId(req);
        const { emailIds } = req.body;
        if (!Array.isArray(emailIds)) return Errors.badRequest(res, "emailIds must be an array");

        await markEmailsRead(emailIds, orgId);
        res.json({ success: true });
      } catch (error) {
        Errors.internal(res, error);
      }
    }
  );

  // Get unread count
  app.get(
    "/api/emails/unread-count",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res) => {
      try {
        const orgId = getOrganizationId(req);
        const count = await getUnreadEmailCount(orgId);
        res.json({ count });
      } catch (error) {
        Errors.internal(res, error);
      }
    }
  );

  // Send reply email from lead thread
  app.post(
    "/api/leads/:leadId/emails/reply",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res) => {
      try {
        const org = getOrganization(req);
        const leadId = parseInt(req.params.leadId, 10);
        if (isNaN(leadId)) return Errors.badRequest(res, "Invalid lead ID");

        const schema = z.object({
          to: z.string().email(),
          subject: z.string().min(1),
          body: z.string().min(1),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const { to, subject, body } = parsed.data;
        const replyTo = generateReplyToAddress(leadId, org.id);

        // Send via SES.
        //
        // COUNTERPARTY (founder decision 2026-07-17). `to` is the other side of
        // a lead email thread — the client fills it from the inbound message's
        // fromEmail or the lead's own address (client/src/components/
        // deal-inbox.tsx), i.e. the org's seller/buyer, never an AcreOS user.
        // organizationId is the sending org's own id — the same one already
        // baked into the reply-to address above — so the send rides the org's
        // BYO SES credentials / verified sending identity. With no connected
        // identity emailService refuses rather than falling back to @acreos.io.
        const sendResult = await sendEmail({
          to,
          subject,
          html: body,
          text: body,
          replyTo,
          organizationId: org.id,
          purpose: 'counterparty',
        });

        // A refused send must NOT leave an outbound record behind: the thread
        // would then show a reply the seller never received. Report the
        // service's own actionable message instead.
        if (!sendResult.success) {
          logger.warn("[InboundEmail] reply not sent", {
            metadata: { leadId, organizationId: org.id, errorType: sendResult.errorType },
          });
          return Errors.unprocessable(
            res,
            sendResult.error || "Reply could not be sent.",
          );
        }

        // Store outbound record
        await storeOutboundEmail({
          organizationId: org.id,
          leadId,
          fromEmail: replyTo,
          toEmail: to,
          subject,
          bodyText: body,
        });

        res.json({ success: true });
      } catch (error) {
        Errors.internal(res, error);
      }
    }
  );
}
