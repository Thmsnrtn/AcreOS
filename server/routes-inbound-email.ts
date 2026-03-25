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
  // Webhook: receive inbound email from SES/SNS
  app.post("/api/webhooks/inbound-email", async (req, res) => {
    try {
      const parsed = inboundEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }

      const result = await processInboundEmail(parsed.data);
      if (!result.success) {
        return Errors.badRequest(res, result.error || "Failed to process inbound email");
      }

      res.json({ success: true, leadId: result.leadId });
    } catch (error) {
      Errors.internal(res, error);
    }
  });

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
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

        const { to, subject, body } = parsed.data;
        const replyTo = generateReplyToAddress(leadId, org.id);

        // Send via SES
        await sendEmail({
          to,
          subject,
          text: body,
          replyTo,
        });

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
