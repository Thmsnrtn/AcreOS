import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  insertMailSenderIdentitySchema, insertMailingOrderSchema,
  insertWorkflowSchema, WORKFLOW_TRIGGER_EVENTS, WORKFLOW_ACTION_TYPES,
} from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";
import { exportLeadsToCSV, exportPropertiesToCSV, exportDealsToCSV, exportNotesToCSV, type ExportFilters } from "./services/importExport";
import { workflowEngine } from "./services/workflow-engine";
import { processMentions } from "./services/mentionService";

export function registerCommunicationRoutes(app: Express): void {
  const api = app;

  // EMAIL SENDER IDENTITIES
  // ============================================

  // GET /api/email-identities - Get all email sender identities for org
  api.get("/api/email-identities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const identities = await storage.getEmailSenderIdentities(org.id);
      res.json(identities);
    } catch (error: any) {
      console.error("Get email identities error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch email identities" });
    }
  });

  // POST /api/email-identities - Create new email sender identity
  api.post("/api/email-identities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const teamMember = await storage.getTeamMember(org.id, user.claims?.sub || user.id);
      
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
        fromName: fromName || memberName || 'Acreage Land Co.',
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
      
      res.status(201).json(identity);
    } catch (error: any) {
      console.error("Create email identity error:", error);
      res.status(500).json({ message: error.message || "Failed to create email identity" });
    }
  });

  // GET /api/email-identities/:id - Get single email sender identity
  api.get("/api/email-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const identity = await storage.getEmailSenderIdentity(id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!identity || identity.organizationId !== org.id) {
        return res.status(404).json({ message: "Email identity not found" });
      }
      res.json(identity);
    } catch (error: any) {
      console.error("Get email identity error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch email identity" });
    }
  });

  // PATCH /api/email-identities/:id - Update email sender identity
  api.patch("/api/email-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getEmailSenderIdentity(id);
      if (!existing || existing.organizationId !== org.id) {
        return res.status(404).json({ message: "Email identity not found" });
      }
      const { fromName, replyToEmail, replyRoutingMode, isActive } = req.body;
      const identity = await storage.updateEmailSenderIdentity(id, {
        fromName,
        replyToEmail,
        replyRoutingMode,
        isActive,
      });
      res.json(identity);
    } catch (error: any) {
      console.error("Update email identity error:", error);
      res.status(500).json({ message: error.message || "Failed to update email identity" });
    }
  });

  // POST /api/email-identities/:id/set-default - Set identity as default
  api.post("/api/email-identities/:id/set-default", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      await storage.setDefaultEmailSenderIdentity(org.id, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Set default email identity error:", error);
      res.status(500).json({ message: error.message || "Failed to set default email identity" });
    }
  });

  // DELETE /api/email-identities/:id - Delete email sender identity
  api.delete("/api/email-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getEmailSenderIdentity(id);
      if (!existing || existing.organizationId !== org.id) {
        return res.status(404).json({ message: "Email identity not found" });
      }
      await storage.deleteEmailSenderIdentity(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete email identity error:", error);
      res.status(500).json({ message: error.message || "Failed to delete email identity" });
    }
  });

  // ============================================
  // MAIL SENDER IDENTITIES (Direct Mail)
  // ============================================

  // GET /api/mail-identities - Get all mail sender identities for org
  api.get("/api/mail-identities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const identities = await storage.getMailSenderIdentities(org.id);
      res.json(identities);
    } catch (error: any) {
      console.error("Get mail identities error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch mail identities" });
    }
  });

  // POST /api/mail-identities - Create new mail sender identity
  api.post("/api/mail-identities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertMailSenderIdentitySchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const identity = await storage.createMailSenderIdentity(parsed);
      res.status(201).json(identity);
    } catch (error: any) {
      console.error("Create mail identity error:", error);
      res.status(500).json({ message: error.message || "Failed to create mail identity" });
    }
  });

  // GET /api/mail-identities/:id - Get single identity
  api.get("/api/mail-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const identity = await storage.getMailSenderIdentity(id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!identity || identity.organizationId !== org.id) {
        return res.status(404).json({ message: "Mail identity not found" });
      }
      res.json(identity);
    } catch (error: any) {
      console.error("Get mail identity error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch mail identity" });
    }
  });

  // PATCH /api/mail-identities/:id - Update identity
  api.patch("/api/mail-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getMailSenderIdentity(id);
      if (!existing || existing.organizationId !== org.id) {
        return res.status(404).json({ message: "Mail identity not found" });
      }
      const identity = await storage.updateMailSenderIdentity(id, req.body);
      res.json(identity);
    } catch (error: any) {
      console.error("Update mail identity error:", error);
      res.status(500).json({ message: error.message || "Failed to update mail identity" });
    }
  });

  // POST /api/mail-identities/:id/set-default - Set as default
  api.post("/api/mail-identities/:id/set-default", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      await storage.setDefaultMailSenderIdentity(org.id, id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Set default mail identity error:", error);
      res.status(500).json({ message: error.message || "Failed to set default mail identity" });
    }
  });

  // DELETE /api/mail-identities/:id - Delete identity
  api.delete("/api/mail-identities/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getMailSenderIdentity(id);
      if (!existing || existing.organizationId !== org.id) {
        return res.status(404).json({ message: "Mail identity not found" });
      }
      await storage.deleteMailSenderIdentity(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete mail identity error:", error);
      res.status(500).json({ message: error.message || "Failed to delete mail identity" });
    }
  });

  // POST /api/mail-identities/:id/verify - Trigger Lob address verification
  api.post("/api/mail-identities/:id/verify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const identity = await storage.getMailSenderIdentity(id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!identity || identity.organizationId !== org.id) {
        return res.status(404).json({ message: "Mail identity not found" });
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
      console.error("Verify mail identity error:", error);
      res.status(500).json({ message: error.message || "Failed to trigger verification" });
    }
  });

  // ============================================
  // MAILING ORDERS (Direct Mail)
  // ============================================

  // GET /api/mailing-orders - Get all mailing orders for org
  api.get("/api/mailing-orders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Get mailing orders error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch mailing orders" });
    }
  });

  // GET /api/mailing-orders/:id - Get single order with pieces
  api.get("/api/mailing-orders/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const order = await storage.getMailingOrder(id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!order || order.organizationId !== org.id) {
        return res.status(404).json({ message: "Mailing order not found" });
      }
      res.json(order);
    } catch (error: any) {
      console.error("Get mailing order error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch mailing order" });
    }
  });

  // POST /api/mailing-orders - Create new mailing order
  api.post("/api/mailing-orders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertMailingOrderSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const order = await storage.createMailingOrder(parsed);
      res.status(201).json(order);
    } catch (error: any) {
      console.error("Create mailing order error:", error);
      res.status(500).json({ message: error.message || "Failed to create mailing order" });
    }
  });

  // PATCH /api/mailing-orders/:id - Update order
  api.patch("/api/mailing-orders/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      const existing = await storage.getMailingOrder(id);
      if (!existing || existing.organizationId !== org.id) {
        return res.status(404).json({ message: "Mailing order not found" });
      }
      const order = await storage.updateMailingOrder(id, req.body);
      res.json(order);
    } catch (error: any) {
      console.error("Update mailing order error:", error);
      res.status(500).json({ message: error.message || "Failed to update mailing order" });
    }
  });

  // GET /api/mailing-orders/:id/pieces - Get all pieces for an order
  api.get("/api/mailing-orders/:id/pieces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const orderId = parseInt(req.params.id);
      // Task #2: IDOR prevention — verify order belongs to requesting org
      const order = await storage.getMailingOrder(orderId);
      if (!order || order.organizationId !== org.id) {
        return res.status(404).json({ message: "Mailing order not found" });
      }
      const pieces = await storage.getMailingOrderPieces(orderId);
      res.json(pieces);
    } catch (error: any) {
      console.error("Get mailing order pieces error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch mailing order pieces" });
    }
  });

  // ============================================
  // INBOX MESSAGES
  // ============================================

  // GET /api/inbox - Get inbox messages
  api.get("/api/inbox", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Get inbox messages error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch inbox messages" });
    }
  });

  // GET /api/inbox/unread-count - Get unread count
  api.get("/api/inbox/unread-count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const count = await storage.getUnreadInboxCount(org.id);
      res.json({ count });
    } catch (error: any) {
      console.error("Get unread count error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch unread count" });
    }
  });

  // GET /api/inbox/:id - Get single inbox message
  api.get("/api/inbox/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const message = await storage.getInboxMessage(id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!message || message.organizationId !== org.id) {
        return res.status(404).json({ message: "Message not found" });
      }
      res.json(message);
    } catch (error: any) {
      console.error("Get inbox message error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch message" });
    }
  });

  // POST /api/inbox/:id/read - Mark message as read
  api.post("/api/inbox/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getInboxMessage(id);
      if (!existing || existing.organizationId !== org.id) {
        return res.status(404).json({ message: "Message not found" });
      }
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const message = await storage.markInboxMessageRead(id, userId);
      res.json(message);
    } catch (error: any) {
      console.error("Mark message read error:", error);
      res.status(500).json({ message: error.message || "Failed to mark message as read" });
    }
  });

  // POST /api/inbox/:id/unread - Mark message as unread
  api.post("/api/inbox/:id/unread", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getInboxMessage(id);
      if (!existing || existing.organizationId !== org.id) {
        return res.status(404).json({ message: "Message not found" });
      }
      const message = await storage.markInboxMessageUnread(id);
      res.json(message);
    } catch (error: any) {
      console.error("Mark message unread error:", error);
      res.status(500).json({ message: error.message || "Failed to mark message as unread" });
    }
  });

  // POST /api/inbox/:id/star - Toggle star
  api.post("/api/inbox/:id/star", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const currentMessage = await storage.getInboxMessage(id);
      // Task #2: IDOR prevention — verify resource belongs to requesting org
      if (!currentMessage || currentMessage.organizationId !== org.id) {
        return res.status(404).json({ message: "Message not found" });
      }
      const message = await storage.starInboxMessage(id, !currentMessage.isStarred);
      res.json(message);
    } catch (error: any) {
      console.error("Toggle star error:", error);
      res.status(500).json({ message: error.message || "Failed to toggle star" });
    }
  });

  // POST /api/inbox/:id/archive - Archive message
  api.post("/api/inbox/:id/archive", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getInboxMessage(id);
      if (!existing || existing.organizationId !== org.id) {
        return res.status(404).json({ message: "Message not found" });
      }
      const message = await storage.archiveInboxMessage(id);
      res.json(message);
    } catch (error: any) {
      console.error("Archive message error:", error);
      res.status(500).json({ message: error.message || "Failed to archive message" });
    }
  });

  // POST /api/send-email - Send email reply
  api.post("/api/send-email", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { to, subject, html, text, replyTo, inReplyToMessageId } = req.body;
      
      if (!to || !subject || (!html && !text)) {
        return res.status(400).json({ message: "Missing required fields: to, subject, and html or text" });
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
        res.json({ success: true, messageId: result.messageId });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Send email error:", error);
      res.status(500).json({ message: error.message || "Failed to send email" });
    }
  });

  // ============================================
  // ACTIVITY FEED (Phase 8.3)
  // ============================================

  // GET /api/activity-feed - Get activity feed
  api.get("/api/activity-feed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entityType = req.query.entityType as string | undefined;
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

      const activities = await storage.getActivityFeed(org.id, { entityType, limit, offset });
      res.json(activities);
    } catch (error: any) {
      console.error("Get activity feed error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch activity feed" });
    }
  });

  // POST /api/activity-feed — Add a note/activity entry with @mention support (T57)
  api.post("/api/activity-feed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user?.claims?.sub ?? user?.id ?? "";
      const { entityType, entityId, content, eventType = "note_added" } = req.body;

      if (!entityType || !entityId || !content) {
        return res.status(400).json({ message: "entityType, entityId, and content are required" });
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
            console.error("[Mention] processMentions failed:", err);
          }
        });
      }

      res.status(201).json(event);
    } catch (error: any) {
      console.error("Create activity event error:", error);
      res.status(500).json({ message: error.message || "Failed to create activity event" });
    }
  });

  // ============================================
  // EXPORT ROUTES (Phase 7.3)
  // ============================================

  // GET /api/export/leads - Export leads to CSV
  api.get("/api/export/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Export leads error:", error);
      res.status(500).json({ message: error.message || "Failed to export leads" });
    }
  });

  // GET /api/export/properties - Export properties to CSV
  api.get("/api/export/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Export properties error:", error);
      res.status(500).json({ message: error.message || "Failed to export properties" });
    }
  });

  // GET /api/export/deals - Export deals to CSV
  api.get("/api/export/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Export deals error:", error);
      res.status(500).json({ message: error.message || "Failed to export deals" });
    }
  });

  // GET /api/export/notes - Export notes/finance to CSV
  api.get("/api/export/notes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Export notes error:", error);
      res.status(500).json({ message: error.message || "Failed to export notes" });
    }
  });

  // GET /api/export/report - Generate PDF report (placeholder)
  api.get("/api/export/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reportType = req.query.type as string || 'executive';
      const format = req.query.format as string || 'pdf';
      
      if (format === 'pdf') {
        res.json({
          message: "PDF export is a premium feature. Please upgrade your plan.",
          placeholder: true,
          reportType,
        });
      } else {
        res.status(400).json({ message: "Unsupported format" });
      }
    } catch (error: any) {
      console.error("Export report error:", error);
      res.status(500).json({ message: error.message || "Failed to export report" });
    }
  });

  // ============================================
  // WORKFLOW AUTOMATION (Event-based Triggers)
  // ============================================

  // GET /api/workflows - List organization's workflows
  api.get("/api/workflows", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const workflows = await storage.getWorkflows(org.id);
      res.json(workflows);
    } catch (error: any) {
      console.error("Get workflows error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch workflows" });
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
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const workflow = await storage.getWorkflow(org.id, id);
      if (!workflow) {
        return res.status(404).json({ message: "Workflow not found" });
      }
      res.json(workflow);
    } catch (error: any) {
      console.error("Get workflow error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch workflow" });
    }
  });

  // POST /api/workflows - Create workflow
  api.post("/api/workflows", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertWorkflowSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const workflow = await storage.createWorkflow(parsed);
      res.status(201).json(workflow);
    } catch (error: any) {
      console.error("Create workflow error:", error);
      res.status(400).json({ message: error.message || "Failed to create workflow" });
    }
  });

  // PUT /api/workflows/:id - Update workflow
  api.put("/api/workflows/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getWorkflow(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Workflow not found" });
      }
      const workflow = await storage.updateWorkflow(id, req.body);
      res.json(workflow);
    } catch (error: any) {
      console.error("Update workflow error:", error);
      res.status(400).json({ message: error.message || "Failed to update workflow" });
    }
  });

  // DELETE /api/workflows/:id - Delete workflow
  api.delete("/api/workflows/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getWorkflow(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Workflow not found" });
      }
      await storage.deleteWorkflow(id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete workflow error:", error);
      res.status(500).json({ message: error.message || "Failed to delete workflow" });
    }
  });

  // POST /api/workflows/:id/toggle - Enable/disable workflow
  api.post("/api/workflows/:id/toggle", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getWorkflow(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Workflow not found" });
      }
      const isActive = req.body.isActive !== undefined ? req.body.isActive : !existing.isActive;
      const workflow = await storage.toggleWorkflow(org.id, id, isActive);
      res.json(workflow);
    } catch (error: any) {
      console.error("Toggle workflow error:", error);
      res.status(500).json({ message: error.message || "Failed to toggle workflow" });
    }
  });

  // GET /api/workflows/:id/runs - Get workflow run history
  api.get("/api/workflows/:id/runs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getWorkflow(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Workflow not found" });
      }
      const limit = Math.min(100, req.query.limit ? parseInt(req.query.limit as string) : 50);
      const runs = await storage.getWorkflowRuns(id, limit);
      res.json(runs);
    } catch (error: any) {
      console.error("Get workflow runs error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch workflow runs" });
    }
  });

  // POST /api/workflows/:id/test - Test run a workflow manually
  api.post("/api/workflows/:id/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const workflow = await storage.getWorkflow(org.id, id);
      if (!workflow) {
        return res.status(404).json({ message: "Workflow not found" });
      }
      const testData = req.body.testData || {};
      const run = await workflowEngine.testWorkflow(workflow, testData);
      res.json(run);
    } catch (error: any) {
      console.error("Test workflow error:", error);
      res.status(500).json({ message: error.message || "Failed to test workflow" });
    }
  });

  // ============================================
  // SCHEDULED TASKS ROUTES
  // ============================================

  // GET /api/scheduled-tasks - List organization's scheduled tasks
  api.get("/api/scheduled-tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const tasks = await storage.getScheduledTasks(org.id);
      res.json(tasks);
    } catch (error: any) {
      console.error("Get scheduled tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch scheduled tasks" });
    }
  });

  // GET /api/scheduled-tasks/:id - Get single scheduled task
  api.get("/api/scheduled-tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const task = await storage.getScheduledTaskByOrg(org.id, id);
      if (!task) {
        return res.status(404).json({ message: "Scheduled task not found" });
      }
      res.json(task);
    } catch (error: any) {
      console.error("Get scheduled task error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch scheduled task" });
    }
  });

  // POST /api/scheduled-tasks - Create scheduled task
  api.post("/api/scheduled-tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { taskRunnerService, parseSchedule } = await import("./services/task-runner");
      
      const nextRunAt = req.body.nextRunAt ? new Date(req.body.nextRunAt) : parseSchedule(req.body.schedule);
      const task = await taskRunnerService.scheduleTask({
        ...req.body,
        organizationId: org.id,
        nextRunAt,
      });
      res.status(201).json(task);
    } catch (error: any) {
      console.error("Create scheduled task error:", error);
      res.status(500).json({ message: error.message || "Failed to create scheduled task" });
    }
  });

  // PUT /api/scheduled-tasks/:id - Update scheduled task
  api.put("/api/scheduled-tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Scheduled task not found" });
      }
      
      const updates = { ...req.body };
      delete updates.organizationId;
      delete updates.id;
      
      if (updates.schedule && updates.schedule !== existing.schedule) {
        const { parseSchedule } = await import("./services/task-runner");
        updates.nextRunAt = parseSchedule(updates.schedule);
      }
      
      const task = await storage.updateScheduledTask(id, updates);
      res.json(task);
    } catch (error: any) {
      console.error("Update scheduled task error:", error);
      res.status(500).json({ message: error.message || "Failed to update scheduled task" });
    }
  });

  // DELETE /api/scheduled-tasks/:id - Delete scheduled task
  api.delete("/api/scheduled-tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Scheduled task not found" });
      }
      await storage.deleteScheduledTask(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete scheduled task error:", error);
      res.status(500).json({ message: error.message || "Failed to delete scheduled task" });
    }
  });

  // POST /api/scheduled-tasks/:id/pause - Pause task
  api.post("/api/scheduled-tasks/:id/pause", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Scheduled task not found" });
      }
      const { taskRunnerService } = await import("./services/task-runner");
      const task = await taskRunnerService.pauseTask(id);
      res.json(task);
    } catch (error: any) {
      console.error("Pause scheduled task error:", error);
      res.status(500).json({ message: error.message || "Failed to pause scheduled task" });
    }
  });

  // POST /api/scheduled-tasks/:id/resume - Resume task
  api.post("/api/scheduled-tasks/:id/resume", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Scheduled task not found" });
      }
      const { taskRunnerService } = await import("./services/task-runner");
      const task = await taskRunnerService.resumeTask(id);
      res.json(task);
    } catch (error: any) {
      console.error("Resume scheduled task error:", error);
      res.status(500).json({ message: error.message || "Failed to resume scheduled task" });
    }
  });

  // POST /api/scheduled-tasks/:id/run-now - Run task immediately
  api.post("/api/scheduled-tasks/:id/run-now", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getScheduledTaskByOrg(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Scheduled task not found" });
      }
      const { taskRunnerService } = await import("./services/task-runner");
      const result = await taskRunnerService.runTask(id);
      res.json(result);
    } catch (error: any) {
      console.error("Run scheduled task error:", error);
      res.status(500).json({ message: error.message || "Failed to run scheduled task" });
    }
  });

  // ============================================

}
