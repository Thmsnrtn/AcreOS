import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  insertMailSenderIdentitySchema, insertMailingOrderSchema,
  insertWorkflowSchema, WORKFLOW_TRIGGER_EVENTS, WORKFLOW_ACTION_TYPES,
  workflows, workflowRuns,
} from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { omitProtectedFields } from "./utils/updatePayload";
import { logger } from "./utils/logger";
import { usageMeteringService, creditService } from "./services/credits";
import { exportLeadsToCSV, exportPropertiesToCSV, exportDealsToCSV, exportNotesToCSV, type ExportFilters } from "./services/importExport";
import { workflowEngine, LAND_INVESTING_WORKFLOW_TEMPLATES } from "./services/workflow-engine";
import { processMentions } from "./services/mentionService";

export function registerCommunicationRoutes(app: Express): void {
  const api = app;

  // EMAIL SENDER IDENTITIES
  // ============================================

  // GET /api/email-identities - Get all email sender identities for org
  api.get("/api/email-identities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const identities = await storage.getEmailSenderIdentities(org.id);
      res.json(identities);
    } catch (error: any) {
      logger.error("Get email identities error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch email identities"));
    }
  });

  // POST /api/email-identities - Create new email sender identity
  api.post("/api/email-identities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const teamMember = await storage.getTeamMember(org.id, user?.id || user.id);

      const { type, fromEmail, fromName, replyToEmail, replyRoutingMode } = req.body;

      // For platform_alias type, auto-generate email if not provided
      let finalFromEmail = fromEmail;
      const memberName = teamMember?.displayName || 'User';
      if (type === 'platform_alias' && !fromEmail && teamMember) {
        const firstName = (memberName.split(' ')[0] || 'user').toLowerCase().replace(/[^a-z]/g, '');
        const lastName = (memberName.split(' ').slice(1).join('') || '').toLowerCase().replace(/[^a-z]/g, '');
        finalFromEmail = lastName ? `${firstName}.${lastName}@acreage.pro` : `${firstName}@acreage.pro`;
      }

      const identity = await storage.createEmailSenderIdentity({
        organizationId: org.id,
        teamMemberId: teamMember?.id,
        type,
        fromEmail: finalFromEmail,
        fromName: fromName || memberName || 'AcreOS',
        replyToEmail,
        replyRoutingMode: replyRoutingMode || 'in_app',
        status: type === 'platform_alias' ? 'verified' : 'pending',
        isDefault: false,
        isActive: true,
      });

      // If this is the first identity, make it default
      const allIdentities = await storage.getEmailSenderIdentities(org.id);
      if (allIdentities.length === 1) {
        await storage.setDefaultEmailSenderIdentity(org.id, identity.id);
      }

      try {
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "email_identity",
          entityId: identity.id,
          changes: { after: { type, fromEmail: finalFromEmail, fromName }, fields: ["type", "fromEmail", "fromName", "replyToEmail", "replyRoutingMode"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(identity);
    } catch (error: any) {
      logger.error("Create email identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to create email identity"));
    }
  });

  // GET /api/email-identities/:id - Get single email sender identity
  api.get("/api/email-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const identity = await storage.getEmailSenderIdentity(org.id, id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!identity || identity.organizationId !== org.id) {
        return Errors.notFound(res, "Email identity");
      }
      res.json(identity);
    } catch (error: any) {
      logger.error("Get email identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch email identity"));
    }
  });

  // PATCH /api/email-identities/:id - Update email sender identity
  api.patch("/api/email-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getEmailSenderIdentity(org.id, id);
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Email identity");
      }
      const { fromName, replyToEmail, replyRoutingMode, isActive } = req.body;

      const identity = await storage.updateEmailSenderIdentity(id, {
        fromName,
        replyToEmail,
        replyRoutingMode,
        isActive,
      });

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "email_identity",
          entityId: id,
          changes: { after: { fromName, replyToEmail, replyRoutingMode, isActive }, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(identity);
    } catch (error: any) {
      logger.error("Update email identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to update email identity"));
    }
  });

  // POST /api/email-identities/:id/set-default - Set identity as default
  api.post("/api/email-identities/:id/set-default", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      await storage.setDefaultEmailSenderIdentity(org.id, id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "email_identity",
          entityId: id,
          changes: { after: { isDefault: true }, fields: ["isDefault"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (error: any) {
      logger.error("Set default email identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to set default email identity"));
    }
  });

  // DELETE /api/email-identities/:id - Delete email sender identity
  api.delete("/api/email-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getEmailSenderIdentity(org.id, id);
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Email identity");
      }
      await storage.deleteEmailSenderIdentity(id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "email_identity",
          entityId: id,
          changes: { before: { id }, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete email identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to delete email identity"));
    }
  });

  // ============================================
  // MAIL SENDER IDENTITIES (Direct Mail)
  // ============================================

  // GET /api/mail-identities - Get all mail sender identities for org
  api.get("/api/mail-identities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const identities = await storage.getMailSenderIdentities(org.id);
      res.json(identities);
    } catch (error: any) {
      logger.error("Get mail identities error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch mail identities"));
    }
  });

  // POST /api/mail-identities - Create new mail sender identity
  api.post("/api/mail-identities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = insertMailSenderIdentitySchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const identity = await storage.createMailSenderIdentity(parsed);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "mail_identity",
          entityId: identity.id,
          changes: { after: parsed, fields: Object.keys(parsed) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(identity);
    } catch (error: any) {
      logger.error("Create mail identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to create mail identity"));
    }
  });

  // GET /api/mail-identities/:id - Get single identity
  api.get("/api/mail-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const identity = await storage.getMailSenderIdentity(org.id, id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!identity || identity.organizationId !== org.id) {
        return Errors.notFound(res, "Mail identity");
      }
      res.json(identity);
    } catch (error: any) {
      logger.error("Get mail identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch mail identity"));
    }
  });

  // PATCH /api/mail-identities/:id - Update identity
  api.patch("/api/mail-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getMailSenderIdentity(org.id, id);
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Mail identity");
      }
      const identity = await storage.updateMailSenderIdentity(id, omitProtectedFields(req.body));

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "mail_identity",
          entityId: id,
          changes: { after: req.body, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(identity);
    } catch (error: any) {
      logger.error("Update mail identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to update mail identity"));
    }
  });

  // POST /api/mail-identities/:id/set-default - Set as default
  api.post("/api/mail-identities/:id/set-default", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      await storage.setDefaultMailSenderIdentity(org.id, id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "mail_identity",
          entityId: id,
          changes: { after: { isDefault: true }, fields: ["isDefault"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (error: any) {
      logger.error("Set default mail identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to set default mail identity"));
    }
  });

  // DELETE /api/mail-identities/:id - Delete identity
  api.delete("/api/mail-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getMailSenderIdentity(org.id, id);
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Mail identity");
      }
      await storage.deleteMailSenderIdentity(id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "mail_identity",
          entityId: id,
          changes: { before: { id }, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete mail identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to delete mail identity"));
    }
  });

  // POST /api/mail-identities/:id/verify - Trigger Lob address verification
  api.post("/api/mail-identities/:id/verify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const identity = await storage.getMailSenderIdentity(org.id, id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!identity || identity.organizationId !== org.id) {
        return Errors.notFound(res, "Mail identity");
      }

      // Set status to pending_verification
      await storage.updateMailSenderIdentity(id, {
        status: "pending_verification",
      });
      
      // Call Lob address verification
      const { verifyAddress } = await import("./services/directMailService");
      const verificationResult = await verifyAddress({
        line1: identity.addressLine1,
        line2: identity.addressLine2 || undefined,
        city: identity.city,
        state: identity.state,
        zip: identity.zipCode,
      });
      
      let updated;
      if (verificationResult.isValid) {
        updated = await storage.updateMailSenderIdentity(id, {
          status: "verified",
          verifiedAt: new Date(),
          lobAddressId: verificationResult.details.lobAddressId || null,
          verificationDetails: {
            deliverability: verificationResult.deliverability,
            deliverabilityAnalysis: verificationResult.details.deliverabilityAnalysis,
            components: verificationResult.details.components,
          },
        });
      } else {
        updated = await storage.updateMailSenderIdentity(id, {
          status: "failed",
          verificationDetails: {
            deliverability: verificationResult.deliverability,
            deliverabilityAnalysis: verificationResult.details.deliverabilityAnalysis,
            components: verificationResult.details.components,
            errorMessage: verificationResult.errorMessage || "Address verification failed",
          },
        });
      }
      
      res.json(updated);
    } catch (error: any) {
      logger.error("Verify mail identity error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to trigger verification"));
    }
  });

  // ============================================
  // MAILING ORDERS (Direct Mail)
  // ============================================

  // GET /api/mailing-orders - Get all mailing orders for org
  api.get("/api/mailing-orders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const filters: { campaignId?: number; status?: string } = {};
      if (req.query.campaignId) {
        filters.campaignId = parseInt(req.query.campaignId as string);
      }
      if (req.query.status) {
        filters.status = req.query.status as string;
      }
      const orders = await storage.getMailingOrders(org.id, filters);
      res.json(orders);
    } catch (error: any) {
      logger.error("Get mailing orders error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch mailing orders"));
    }
  });

  // GET /api/mailing-orders/:id - Get single order with pieces
  api.get("/api/mailing-orders/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const order = await storage.getMailingOrder(org.id, id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!order || order.organizationId !== org.id) {
        return Errors.notFound(res, "Mailing order");
      }
      res.json(order);
    } catch (error: any) {
      logger.error("Get mailing order error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch mailing order"));
    }
  });

  // POST /api/mailing-orders - Create new mailing order
  api.post("/api/mailing-orders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = insertMailingOrderSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const order = await storage.createMailingOrder(parsed);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "mailing_order",
          entityId: order.id,
          changes: { after: parsed, fields: Object.keys(parsed) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(order);
    } catch (error: any) {
      logger.error("Create mailing order error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to create mailing order"));
    }
  });

  // PATCH /api/mailing-orders/:id - Update order
  api.patch("/api/mailing-orders/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getMailingOrder(org.id, id);
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Mailing order");
      }
      const order = await storage.updateMailingOrder(id, omitProtectedFields(req.body));

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "mailing_order",
          entityId: id,
          changes: { after: req.body, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(order);
    } catch (error: any) {
      logger.error("Update mailing order error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to update mailing order"));
    }
  });

  // GET /api/mailing-orders/:id/pieces - Get all pieces for an order
  api.get("/api/mailing-orders/:id/pieces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const orderId = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify order belongs to requesting org
      const order = await storage.getMailingOrder(org.id, orderId);
      if (!order || order.organizationId !== org.id) {
        return Errors.notFound(res, "Mailing order");
      }
      const pieces = await storage.getMailingOrderPieces(orderId);
      res.json(pieces);
    } catch (error: any) {
      logger.error("Get mailing order pieces error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch mailing order pieces"));
    }
  });

  // ============================================
  // INBOX MESSAGES
  // ============================================

  // GET /api/inbox - Get inbox messages
  api.get("/api/inbox", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const isRead = req.query.isRead !== undefined ? req.query.isRead === 'true' : undefined;
      const isArchived = req.query.isArchived !== undefined ? req.query.isArchived === 'true' : undefined;
      const isStarred = req.query.isStarred !== undefined ? req.query.isStarred === 'true' : undefined;
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      
      let messages = await storage.getInboxMessages(org.id, { isRead, isArchived, limit, offset });
      
      // Filter by starred if specified
      if (isStarred !== undefined) {
        messages = messages.filter(m => m.isStarred === isStarred);
      }
      
      res.json(messages);
    } catch (error: any) {
      logger.error("Get inbox messages error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch inbox messages"));
    }
  });

  // GET /api/inbox/unified — the Inbox page's single-round-trip aggregate:
  // email messages + SMS conversations together (the client previously
  // fired two parallel list queries and merged them in JS). `channel`
  // mirrors the page's channel filter so a filtered view doesn't pay for
  // the other channel's fetch. Registered before /api/inbox/:id so the
  // param route can't swallow "unified".
  api.get("/api/inbox/unified", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const channel = typeof req.query.channel === "string" ? req.query.channel : "all";
      const wantEmail = channel === "all" || channel === "email";
      const wantSms = channel === "all" || channel === "sms";

      const isRead = req.query.isRead !== undefined ? req.query.isRead === 'true' : undefined;
      const isArchived = req.query.isArchived !== undefined ? req.query.isArchived === 'true' : undefined;
      const isStarred = req.query.isStarred !== undefined ? req.query.isStarred === 'true' : undefined;
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      const [emailsRaw, smsConversations] = await Promise.all([
        wantEmail ? storage.getInboxMessages(org.id, { isRead, isArchived, limit, offset }) : Promise.resolve([]),
        wantSms ? storage.getConversations(org.id, { channel: "sms" }) : Promise.resolve([]),
      ]);
      const emails = isStarred !== undefined ? emailsRaw.filter(m => m.isStarred === isStarred) : emailsRaw;

      res.json({ emails, smsConversations, generatedAt: new Date().toISOString() });
    } catch (error: any) {
      logger.error("Get unified inbox error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch unified inbox"));
    }
  });

  // GET /api/inbox/unread-count - Get unread count
  api.get("/api/inbox/unread-count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const count = await storage.getUnreadInboxCount(org.id);
      res.json({ count });
    } catch (error: any) {
      logger.error("Get unread count error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch unread count"));
    }
  });

  // GET /api/inbox/:id - Get single inbox message
  api.get("/api/inbox/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) {
        return Errors.notFound(res, "Message");
      }
      const message = await storage.getInboxMessage(org.id, id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!message || message.organizationId !== org.id) {
        return Errors.notFound(res, "Message");
      }
      res.json(message);
    } catch (error: any) {
      logger.error("Get inbox message error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch message"));
    }
  });

  // POST /api/inbox/:id/read - Mark message as read
  api.post("/api/inbox/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getInboxMessage(org.id, id);
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Message");
      }
      const user = req.user as any;
      const userId = user?.id || user.id;
      const message = await storage.markInboxMessageRead(id, userId);
      res.json(message);
    } catch (error: any) {
      logger.error("Mark message read error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to mark message as read"));
    }
  });

  // POST /api/inbox/:id/unread - Mark message as unread
  api.post("/api/inbox/:id/unread", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getInboxMessage(org.id, id);
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Message");
      }
      const message = await storage.markInboxMessageUnread(id);
      res.json(message);
    } catch (error: any) {
      logger.error("Mark message unread error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to mark message as unread"));
    }
  });

  // POST /api/inbox/:id/star - Toggle star
  api.post("/api/inbox/:id/star", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const currentMessage = await storage.getInboxMessage(org.id, id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!currentMessage || currentMessage.organizationId !== org.id) {
        return Errors.notFound(res, "Message");
      }
      const message = await storage.starInboxMessage(id, !currentMessage.isStarred);
      res.json(message);
    } catch (error: any) {
      logger.error("Toggle star error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to toggle star"));
    }
  });

  // POST /api/inbox/:id/archive - Archive message
  api.post("/api/inbox/:id/archive", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getInboxMessage(org.id, id);
      if (!existing || existing.organizationId !== org.id) {
        return Errors.notFound(res, "Message");
      }
      const message = await storage.archiveInboxMessage(id);
      res.json(message);
    } catch (error: any) {
      logger.error("Archive message error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to archive message"));
    }
  });

  // POST /api/send-email - Send email reply
  api.post("/api/send-email", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { to, subject, html, text, replyTo, inReplyToMessageId } = req.body;

      if (!to || !subject || (!html && !text)) {
        return Errors.badRequest(res, "Missing required fields: to, subject, and html or text");
      }

      const { emailService } = await import("./services/emailService");
      const result = await emailService.sendEmail({
        to,
        subject,
        html: html || `<p>${text}</p>`,
        text,
        replyTo,
        organizationId: org.id,
      });

      if (result.success) {
        try {
          const user = req.user as any;
          await storage.createAuditLogEntry({
            organizationId: org.id,
            userId: (user?.id || user?.id)?.toString() || null,
            action: "create",
            entityType: "email_send",
            entityId: org.id,
            changes: { after: { to, subject, messageId: result.messageId }, fields: ["to", "subject"] },
            ipAddress: req.ip || null,
            userAgent: req.headers["user-agent"] || null,
            metadata: {},
          });
        } catch (e) { /* non-fatal */ }

        res.json({ success: true, messageId: result.messageId });
      } else {
        Errors.internal(res, new Error(result.error || "Email send failed"));
      }
    } catch (error: any) {
      logger.error("Send email error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to send email"));
    }
  });

  // ============================================
  // ACTIVITY FEED (Phase 8.3)
  // ============================================

  // GET /api/activity-feed - Get activity feed
  api.get("/api/activity-feed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const entityType = req.query.entityType as string | undefined;
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      const activities = await storage.getActivityFeed(org.id, { entityType, limit, offset });
      res.json(activities);
    } catch (error: any) {
      logger.error("Get activity feed error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch activity feed"));
    }
  });

  // POST /api/activity-feed — Add a note/activity entry with @mention support (T57)
  api.post("/api/activity-feed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user?.id ?? user?.id ?? "";
      const { entityType, entityId, content, eventType = "note_added" } = req.body;

      if (!entityType || !entityId || !content) {
        return Errors.badRequest(res, "entityType, entityId, and content are required");
      }

      const event = await storage.createActivityEvent({
        organizationId: org.id,
        entityType,
        entityId: parseInt(entityId),
        eventType,
        description: content,
        userId,
        eventDate: new Date(),
        metadata: { hasContent: true },
      });

      // Process @mentions asynchronously (non-blocking)
      if (content.includes("@")) {
        const authorName = user?.displayName || user?.email?.split("@")[0] || "A team member";
        setImmediate(async () => {
          try {
            await processMentions(org.id, content, {
              entityType,
              entityId: parseInt(entityId),
              authorName,
              notePreview: content,
            });
          } catch (err) {
            logger.error("processMentions failed", err instanceof Error ? err : undefined);
          }
        });
      }

      res.status(201).json(event);
    } catch (error: any) {
      logger.error("Create activity event error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to create activity event"));
    }
  });

  // ============================================
  // EXPORT ROUTES (Phase 7.3)
  // ============================================

  // GET /api/export/leads - Export leads to CSV
  api.get("/api/export/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const status = req.query.status as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      
      const filters: ExportFilters = {};
      if (status) filters.status = status;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      
      const csv = await exportLeadsToCSV(org.id, filters);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error: any) {
      logger.error("Export leads error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to export leads"));
    }
  });

  // GET /api/export/properties - Export properties to CSV
  api.get("/api/export/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const status = req.query.status as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      
      const filters: ExportFilters = {};
      if (status) filters.status = status;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      
      const csv = await exportPropertiesToCSV(org.id, filters);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="properties-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error: any) {
      logger.error("Export properties error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to export properties"));
    }
  });

  // GET /api/export/deals - Export deals to CSV
  api.get("/api/export/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const status = req.query.status as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      
      const filters: ExportFilters = {};
      if (status) filters.status = status;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      
      const csv = await exportDealsToCSV(org.id, filters);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="deals-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error: any) {
      logger.error("Export deals error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to export deals"));
    }
  });

  // GET /api/export/notes - Export notes/finance to CSV
  api.get("/api/export/notes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const status = req.query.status as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      
      const filters: ExportFilters = {};
      if (status) filters.status = status;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;
      
      const csv = await exportNotesToCSV(org.id, filters);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="notes-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error: any) {
      logger.error("Export notes error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to export notes"));
    }
  });

  // GET /api/export/report - Generate PDF report (placeholder)
  api.get("/api/export/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const reportType = req.query.type as string || 'executive';
      const format = req.query.format as string || 'pdf';
      
      if (format === 'pdf') {
        res.json({
          message: "PDF export is a premium feature. Please upgrade your plan.",
          placeholder: true,
          reportType,
        });
      } else {
        Errors.badRequest(res, "Unsupported format");
      }
    } catch (error: any) {
      logger.error("Export report error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to export report"));
    }
  });

  // ============================================
  // WORKFLOW AUTOMATION (Event-based Triggers)
  // ============================================

  // GET /api/workflows - List organization's workflows
  api.get("/api/workflows", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const workflows = await storage.getWorkflows(org.id);
      res.json(workflows);
    } catch (error: any) {
      logger.error("Get workflows error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch workflows"));
    }
  });

  // GET /api/workflows/trigger-types - Get available trigger events
  api.get("/api/workflows/trigger-types", isAuthenticated, async (req, res) => {
    res.json({
      triggers: WORKFLOW_TRIGGER_EVENTS,
      actions: WORKFLOW_ACTION_TYPES,
    });
  });

  // GET /api/workflows/:id - Get single workflow
  api.get("/api/workflows/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const workflow = await storage.getWorkflow(org.id, id);
      if (!workflow) {
        return Errors.notFound(res, "Workflow");
      }
      res.json(workflow);
    } catch (error: any) {
      logger.error("Get workflow error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch workflow"));
    }
  });

  // POST /api/workflows - Create workflow
  api.post("/api/workflows", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = insertWorkflowSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const workflow = await storage.createWorkflow(parsed);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "workflow",
          entityId: workflow.id,
          changes: { after: parsed, fields: Object.keys(parsed) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(workflow);
    } catch (error: any) {
      logger.error("Create workflow error", error instanceof Error ? error : undefined);
      Errors.badRequest(res, error.message || "Failed to create workflow");
    }
  });

  // PUT /api/workflows/:id - Update workflow
  api.put("/api/workflows/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getWorkflow(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Workflow");
      }
      const workflow = await storage.updateWorkflow(id, omitProtectedFields(req.body));

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "workflow",
          entityId: id,
          changes: { before: existing, after: req.body, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(workflow);
    } catch (error: any) {
      logger.error("Update workflow error", error instanceof Error ? error : undefined);
      Errors.badRequest(res, error.message || "Failed to update workflow");
    }
  });

  // DELETE /api/workflows/:id - Delete workflow
  api.delete("/api/workflows/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getWorkflow(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Workflow");
      }
      await storage.deleteWorkflow(id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "workflow",
          entityId: id,
          changes: { before: existing, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(204).send();
    } catch (error: any) {
      logger.error("Delete workflow error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to delete workflow"));
    }
  });

  // POST /api/workflows/:id/toggle - Enable/disable workflow
  api.post("/api/workflows/:id/toggle", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getWorkflow(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Workflow");
      }
      const isActive = req.body.isActive !== undefined ? req.body.isActive : !existing.isActive;
      const workflow = await storage.toggleWorkflow(org.id, id, isActive);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "workflow",
          entityId: id,
          changes: { before: { isActive: existing.isActive }, after: { isActive }, fields: ["isActive"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(workflow);
    } catch (error: any) {
      logger.error("Toggle workflow error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to toggle workflow"));
    }
  });

  // GET /api/workflows/:id/runs - Get workflow run history
  api.get("/api/workflows/:id/runs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getWorkflow(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Workflow");
      }
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      const runs = await storage.getWorkflowRuns(id, limit);
      res.json(runs);
    } catch (error: any) {
      logger.error("Get workflow runs error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch workflow runs"));
    }
  });

  // POST /api/workflows/:id/test - Test run a workflow manually
  api.post("/api/workflows/:id/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const workflow = await storage.getWorkflow(org.id, id);
      if (!workflow) {
        return Errors.notFound(res, "Workflow");
      }
      const testData = req.body.testData || {};
      const run = await workflowEngine.testWorkflow(workflow, testData);
      res.json(run);
    } catch (error: any) {
      logger.error("Test workflow error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to test workflow"));
    }
  });

  // GET /api/workflow-templates - List pre-built land-investing workflow templates
  api.get("/api/workflow-templates", isAuthenticated, async (req, res) => {
    res.json(LAND_INVESTING_WORKFLOW_TEMPLATES);
  });

  // POST /api/workflow-templates/:templateId/install - Install a template as a live workflow
  api.post("/api/workflow-templates/:templateId/install", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { templateId } = req.params;
      const template = LAND_INVESTING_WORKFLOW_TEMPLATES.find(t => t.id === templateId);
      if (!template) {
        return Errors.notFound(res, "Template");
      }
      const workflow = await storage.createWorkflow({
        organizationId: org.id,
        name: template.name,
        description: template.description,
        trigger: template.trigger as any,
        actions: template.actions as any,
        isActive: true,
      });

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "workflow",
          entityId: workflow.id,
          changes: { after: { templateId, name: template.name }, fields: ["templateId", "name"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: { source: "template" },
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(workflow);
    } catch (error: any) {
      logger.error("Install workflow template error", error instanceof Error ? error : undefined);
      Errors.badRequest(res, error.message || "Failed to install template");
    }
  });

  // GET /api/workflows/analytics - Workflow usage stats
  api.get("/api/workflows/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;

      // Total workflows and active/inactive counts
      const allWorkflows = await db
        .select({
          id: workflows.id,
          name: workflows.name,
          isActive: workflows.isActive,
          createdAt: workflows.createdAt,
          updatedAt: workflows.updatedAt,
        })
        .from(workflows)
        .where(eq(workflows.organizationId, org.id))
        .orderBy(desc(workflows.updatedAt));

      const totalWorkflows = allWorkflows.length;
      const activeCount = allWorkflows.filter(w => w.isActive).length;
      const inactiveCount = totalWorkflows - activeCount;

      // Recent workflow runs (last 50 across all workflows)
      const recentRuns = await db
        .select({
          id: workflowRuns.id,
          workflowId: workflowRuns.workflowId,
          status: workflowRuns.status,
          startedAt: workflowRuns.startedAt,
          completedAt: workflowRuns.completedAt,
          error: workflowRuns.error,
        })
        .from(workflowRuns)
        .innerJoin(workflows, eq(workflowRuns.workflowId, workflows.id))
        .where(eq(workflows.organizationId, org.id))
        .orderBy(desc(workflowRuns.startedAt))
        .limit(50);

      // Run counts per workflow
      const runCountMap: Record<number, { total: number; succeeded: number; failed: number }> = {};
      for (const run of recentRuns) {
        if (!runCountMap[run.workflowId]) {
          runCountMap[run.workflowId] = { total: 0, succeeded: 0, failed: 0 };
        }
        runCountMap[run.workflowId].total++;
        if (run.status === "completed") runCountMap[run.workflowId].succeeded++;
        if (run.status === "failed") runCountMap[run.workflowId].failed++;
      }

      // Enrich workflows with run stats
      const workflowsWithStats = allWorkflows.map(w => ({
        ...w,
        runCount: runCountMap[w.id]?.total ?? 0,
        successCount: runCountMap[w.id]?.succeeded ?? 0,
        failureCount: runCountMap[w.id]?.failed ?? 0,
        successRate: runCountMap[w.id]?.total
          ? Math.round((runCountMap[w.id].succeeded / runCountMap[w.id].total) * 100)
          : null,
      }));

      // Most recently triggered (workflows that have runs, sorted by latest run)
      const workflowLastRun: Record<number, string | null> = {};
      for (const run of recentRuns) {
        if (!workflowLastRun[run.workflowId] && run.startedAt) {
          workflowLastRun[run.workflowId] = run.startedAt.toISOString();
        }
      }

      const mostRecentlyTriggered = workflowsWithStats
        .filter(w => workflowLastRun[w.id])
        .sort((a, b) => {
          const aTime = workflowLastRun[a.id] ? new Date(workflowLastRun[a.id]!).getTime() : 0;
          const bTime = workflowLastRun[b.id] ? new Date(workflowLastRun[b.id]!).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 5)
        .map(w => ({ ...w, lastTriggeredAt: workflowLastRun[w.id] }));

      // Overall run statistics
      const totalRuns = recentRuns.length;
      const successfulRuns = recentRuns.filter(r => r.status === "completed").length;
      const failedRuns = recentRuns.filter(r => r.status === "failed").length;
      const overallSuccessRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : null;

      res.json({
        summary: {
          totalWorkflows,
          activeCount,
          inactiveCount,
          totalRuns,
          successfulRuns,
          failedRuns,
          overallSuccessRate,
        },
        workflows: workflowsWithStats,
        mostRecentlyTriggered,
        generatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error("Workflow analytics error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch workflow analytics"));
    }
  });

  // ============================================
  // SCHEDULED TASKS ROUTES
  // ============================================

  // GET /api/scheduled-tasks - List organization's scheduled tasks
  api.get("/api/scheduled-tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const tasks = await storage.getScheduledTasks(org.id);
      res.json(tasks);
    } catch (error: any) {
      logger.error("Get scheduled tasks error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch scheduled tasks"));
    }
  });

  // GET /api/scheduled-tasks/:id - Get single scheduled task
  api.get("/api/scheduled-tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const task = await storage.getScheduledTaskByOrg(org.id, id);
      if (!task) {
        return Errors.notFound(res, "Scheduled task");
      }
      res.json(task);
    } catch (error: any) {
      logger.error("Get scheduled task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to fetch scheduled task"));
    }
  });

  // POST /api/scheduled-tasks - Create scheduled task
  api.post("/api/scheduled-tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { taskRunnerService, parseSchedule } = await import("./services/task-runner");

      const nextRunAt = req.body.nextRunAt ? new Date(req.body.nextRunAt) : parseSchedule(req.body.schedule);
      const task = await taskRunnerService.scheduleTask({
        ...req.body,
        organizationId: org.id,
        nextRunAt,
      });

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "create",
          entityType: "scheduled_task",
          entityId: task.id,
          changes: { after: req.body, fields: Object.keys(req.body) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.status(201).json(task);
    } catch (error: any) {
      logger.error("Create scheduled task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to create scheduled task"));
    }
  });

  // PUT /api/scheduled-tasks/:id - Update scheduled task
  api.put("/api/scheduled-tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Scheduled task");
      }

      const updates = { ...req.body };
      delete updates.organizationId;
      delete updates.id;

      if (updates.schedule && updates.schedule !== existing.schedule) {
        const { parseSchedule } = await import("./services/task-runner");
        updates.nextRunAt = parseSchedule(updates.schedule);
      }

      const task = await storage.updateScheduledTask(id, updates);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "scheduled_task",
          entityId: id,
          changes: { before: existing, after: updates, fields: Object.keys(updates) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json(task);
    } catch (error: any) {
      logger.error("Update scheduled task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to update scheduled task"));
    }
  });

  // DELETE /api/scheduled-tasks/:id - Delete scheduled task
  api.delete("/api/scheduled-tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Scheduled task");
      }
      await storage.deleteScheduledTask(id);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "delete",
          entityType: "scheduled_task",
          entityId: id,
          changes: { before: existing, fields: ["deleted"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete scheduled task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to delete scheduled task"));
    }
  });

  // POST /api/scheduled-tasks/:id/pause - Pause task
  api.post("/api/scheduled-tasks/:id/pause", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Scheduled task");
      }
      const { taskRunnerService } = await import("./services/task-runner");
      const task = await taskRunnerService.pauseTask(id);
      res.json(task);
    } catch (error: any) {
      logger.error("Pause scheduled task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to pause scheduled task"));
    }
  });

  // POST /api/scheduled-tasks/:id/resume - Resume task
  api.post("/api/scheduled-tasks/:id/resume", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Scheduled task");
      }
      const { taskRunnerService } = await import("./services/task-runner");
      const task = await taskRunnerService.resumeTask(id);
      res.json(task);
    } catch (error: any) {
      logger.error("Resume scheduled task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to resume scheduled task"));
    }
  });

  // POST /api/scheduled-tasks/:id/run-now - Run task immediately
  api.post("/api/scheduled-tasks/:id/run-now", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Scheduled task");
      }
      const { taskRunnerService } = await import("./services/task-runner");
      const result = await taskRunnerService.runTask(id);
      res.json(result);
    } catch (error: any) {
      logger.error("Run scheduled task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error instanceof Error ? error : new Error(error.message || "Failed to run scheduled task"));
    }
  });

  // ============================================

}
