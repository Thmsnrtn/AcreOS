import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, desc, sql, lt } from "drizzle-orm";
import {
  insertTeamConversationSchema, insertTeamMessageSchema, insertTeamMemberPresenceSchema,
  teamConversations, teamMessages, teamMemberPresence, teamMembers, notifications,
  insertOfferLetterSchema, insertOfferTemplateSchema,
  insertPropertyListingSchema,
  properties, organizations,
  SUBSCRIPTION_TIERS, type SubscriptionTier,
} from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { idempotencyMiddleware } from "./middleware/idempotency";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { shouldSimulate, recordSimulatedAction } from "./utils/simulationMode";
import * as listingSyndication from "./services/listingSyndication";
import type { NextFunction } from "express";
import { inArray } from "drizzle-orm";
import { wsServer } from "./websocket";

export function registerTeamMessagingRoutes(app: Express): void {
  const api = app;

  // TEAM MESSAGING API
  // ============================================
  
  // Tier gating middleware for team messaging (requires 2+ seats)
  const requireMessagingTier = async (req: Request, res: Response, next: NextFunction) => {
    const org = req.organization;
    if (!org) {
      return Errors.unauthorized(res);
    }

    const { checkTeamMessagingAccess } = await import("./services/usageLimits");
    const hasAccess = await checkTeamMessagingAccess(org.id);

    if (!hasAccess) {
      return Errors.forbidden(res, "Team messaging requires a plan with 2 or more seats. Upgrade to Starter or higher to access this feature.");
    }
    next();
  };

  // GET /api/team-messaging/conversations - List all conversations for the current user
  api.get("/api/team-messaging/conversations", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const conversations = await db
        .select()
        .from(teamConversations)
        .where(eq(teamConversations.organizationId, org.id))
        .orderBy(desc(teamConversations.lastMessageAt));
      
      // Filter to only conversations where user is a participant
      const userConversations = conversations.filter(conv => 
        conv.participantIds?.includes(userId)
      );
      
      res.json(userConversations);
    } catch (error: any) {
      logger.error("Get team conversations error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/team-messaging/conversations - Create a new conversation
  api.post("/api/team-messaging/conversations", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const createSchema = z.object({
        name: z.string().optional(),
        isDirect: z.boolean().default(true),
        participantIds: z.array(z.string()).min(1),
      });
      
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid request body", parsed.error.errors);
      }
      
      const { name, isDirect, participantIds } = parsed.data;
      
      // Ensure creator is in participants
      const allParticipants = Array.from(new Set([userId, ...participantIds]));
      
      // For direct messages, check if a conversation already exists
      if (isDirect && allParticipants.length === 2) {
        const existing = await db
          .select()
          .from(teamConversations)
          .where(and(
            eq(teamConversations.organizationId, org.id),
            eq(teamConversations.isDirect, true)
          ));
        
        const existingConv = existing.find(conv => {
          const pIds = conv.participantIds || [];
          return pIds.length === 2 && 
            pIds.includes(allParticipants[0]) && 
            pIds.includes(allParticipants[1]);
        });
        
        if (existingConv) {
          return res.json(existingConv);
        }
      }
      
      const [conversation] = await db
        .insert(teamConversations)
        .values({
          organizationId: org.id,
          name: isDirect ? null : name,
          isDirect,
          createdBy: userId,
          participantIds: allParticipants,
          status: "active",
        })
        .returning();
      
      res.status(201).json(conversation);
    } catch (error: any) {
      logger.error("Create team conversation error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/team-messaging/conversations/:id/messages - Get messages (cursor-based pagination)
  api.get("/api/team-messaging/conversations/:id/messages", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const conversationId = parseInt(req.params.id, 10);
      
      if (isNaN(conversationId)) {
        return Errors.badRequest(res, "Invalid conversation ID");
      }
      
      // Verify conversation exists and user is a participant
      const [conversation] = await db
        .select()
        .from(teamConversations)
        .where(and(
          eq(teamConversations.id, conversationId),
          eq(teamConversations.organizationId, org.id)
        ));
      
      if (!conversation) {
        return Errors.notFound(res, "Conversation");
      }
      
      if (!conversation.participantIds?.includes(userId)) {
        return Errors.forbidden(res, "Not a participant of this conversation");
      }
      
      // Parse pagination params
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const cursor = req.query.cursor ? parseInt(req.query.cursor as string, 10) : undefined;
      
      // Build query
      let query = db
        .select()
        .from(teamMessages)
        .where(
          cursor
            ? and(
                eq(teamMessages.conversationId, conversationId),
                eq(teamMessages.isDeleted, false),
                lt(teamMessages.id, cursor)
              )
            : and(
                eq(teamMessages.conversationId, conversationId),
                eq(teamMessages.isDeleted, false)
              )
        )
        .orderBy(desc(teamMessages.id))
        .limit(limit + 1);
      
      const messages = await query;
      
      // Check if there are more results
      const hasMore = messages.length > limit;
      if (hasMore) {
        messages.pop();
      }
      
      const nextCursor = hasMore && messages.length > 0 ? messages[messages.length - 1].id : null;
      
      res.json({
        messages,
        nextCursor,
        hasMore,
      });
    } catch (error: any) {
      logger.error("Get team messages error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/team-messaging/conversations/:id/messages - Send a message
  api.post("/api/team-messaging/conversations/:id/messages", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const conversationId = parseInt(req.params.id, 10);
      
      if (isNaN(conversationId)) {
        return Errors.badRequest(res, "Invalid conversation ID");
      }
      
      // Verify conversation exists and user is a participant
      const [conversation] = await db
        .select()
        .from(teamConversations)
        .where(and(
          eq(teamConversations.id, conversationId),
          eq(teamConversations.organizationId, org.id)
        ));
      
      if (!conversation) {
        return Errors.notFound(res, "Conversation");
      }
      
      if (!conversation.participantIds?.includes(userId)) {
        return Errors.forbidden(res, "Not a participant of this conversation");
      }
      
      const messageSchema = z.object({
        body: z.string().min(1).max(10000),
        attachments: z.array(z.object({
          type: z.string(),
          url: z.string(),
          name: z.string(),
          size: z.number().optional(),
        })).optional(),
      });
      
      const parsed = messageSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid request body", parsed.error.errors);
      }
      
      const { body, attachments } = parsed.data;
      
      // Insert the message
      const [message] = await db
        .insert(teamMessages)
        .values({
          conversationId,
          senderId: userId,
          body,
          attachments: attachments || null,
        })
        .returning();
      
      // Update conversation's lastMessageAt
      await db
        .update(teamConversations)
        .set({
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(teamConversations.id, conversationId));

      // Broadcast via WebSocket so recipients get the message in real-time
      wsServer.broadcastToOrg(org.id, "message.new", {
        conversationId,
        message,
      });

      // Parse @mentions and create notifications
      const mentionPattern = /@(\w+)/g;
      let match;
      const mentionedUsernames: string[] = [];
      while ((match = mentionPattern.exec(body)) !== null) {
        mentionedUsernames.push(match[1].toLowerCase());
      }
      if (mentionedUsernames.length > 0) {
        const allMembers = await db
          .select()
          .from(teamMembers)
          .where(eq(teamMembers.organizationId, org.id));
        const convName = conversation.name ?? (conversation.isDirect ? "direct message" : "group");
        const notificationsToInsert = allMembers
          .filter(m =>
            m.userId !== userId &&
            mentionedUsernames.some(u =>
              (m.displayName ?? m.email ?? "").toLowerCase().replace(/\s+/g, "").startsWith(u)
            )
          )
          .map(m => ({
            organizationId: org.id,
            userId: m.userId,
            type: "team_mention" as const,
            title: `You were mentioned in ${convName}`,
            message: body.slice(0, 80) + (body.length > 80 ? "…" : ""),
            entityType: "conversation",
            entityId: conversationId,
            metadata: { conversationId, senderId: userId },
          }));
        if (notificationsToInsert.length > 0) {
          await db.insert(notifications).values(notificationsToInsert);
        }
      }

      res.status(201).json(message);
    } catch (error: any) {
      logger.error("Send team message error", error);
      Errors.internal(res, error);
    }
  });

  // PATCH /api/team-messaging/conversations/:id/read - Mark messages as read
  api.patch("/api/team-messaging/conversations/:id/read", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const conversationId = parseInt(req.params.id, 10);
      
      if (isNaN(conversationId)) {
        return Errors.badRequest(res, "Invalid conversation ID");
      }
      
      // Verify conversation exists and user is a participant
      const [conversation] = await db
        .select()
        .from(teamConversations)
        .where(and(
          eq(teamConversations.id, conversationId),
          eq(teamConversations.organizationId, org.id)
        ));
      
      if (!conversation) {
        return Errors.notFound(res, "Conversation");
      }
      
      if (!conversation.participantIds?.includes(userId)) {
        return Errors.forbidden(res, "Not a participant of this conversation");
      }
      
      const readSchema = z.object({
        messageIds: z.array(z.number()).optional(),
        upToMessageId: z.number().optional(),
      });
      
      const parsed = readSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid request body", parsed.error.errors);
      }
      
      const { messageIds, upToMessageId } = parsed.data;
      const now = new Date().toISOString();
      
      // Get messages to update
      let messagesToUpdate: typeof teamMessages.$inferSelect[] = [];
      
      if (messageIds && messageIds.length > 0) {
        messagesToUpdate = await db
          .select()
          .from(teamMessages)
          .where(and(
            eq(teamMessages.conversationId, conversationId),
            inArray(teamMessages.id, messageIds)
          ));
      } else if (upToMessageId) {
        messagesToUpdate = await db
          .select()
          .from(teamMessages)
          .where(and(
            eq(teamMessages.conversationId, conversationId),
            lt(teamMessages.id, upToMessageId + 1)
          ));
      } else {
        // Mark all messages in conversation as read
        messagesToUpdate = await db
          .select()
          .from(teamMessages)
          .where(eq(teamMessages.conversationId, conversationId));
      }
      
      // Update readBy for each message
      let updatedCount = 0;
      for (const msg of messagesToUpdate) {
        const currentReadBy = (msg.readBy as { userId: string; readAt: string; }[]) || [];
        const alreadyRead = currentReadBy.some(r => r.userId === userId);
        
        if (!alreadyRead) {
          const newReadBy = [...currentReadBy, { userId, readAt: now }];
          await db
            .update(teamMessages)
            .set({ readBy: newReadBy })
            .where(eq(teamMessages.id, msg.id));
          updatedCount++;
        }
      }
      
      res.json({ success: true, updatedCount });
    } catch (error: any) {
      logger.error("Mark messages read error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/team-messaging/presence - Get team member presence statuses
  api.get("/api/team-messaging/presence", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      
      const presenceStatuses = await db
        .select()
        .from(teamMemberPresence)
        .where(eq(teamMemberPresence.organizationId, org.id));
      
      res.json(presenceStatuses);
    } catch (error: any) {
      logger.error("Get presence error", error);
      Errors.internal(res, error);
    }
  });

  // PATCH /api/team-messaging/presence - Update current user's presence status
  api.patch("/api/team-messaging/presence", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const presenceSchema = z.object({
        status: z.enum(["online", "away", "offline"]),
        deviceInfo: z.string().optional(),
      });
      
      const parsed = presenceSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid request body", parsed.error.errors);
      }
      
      const { status, deviceInfo } = parsed.data;
      
      // Check if presence record exists
      const [existing] = await db
        .select()
        .from(teamMemberPresence)
        .where(and(
          eq(teamMemberPresence.organizationId, org.id),
          eq(teamMemberPresence.userId, userId)
        ));
      
      let presence;
      if (existing) {
        // Update existing
        [presence] = await db
          .update(teamMemberPresence)
          .set({
            status,
            lastSeenAt: new Date(),
            deviceInfo: deviceInfo || existing.deviceInfo,
          })
          .where(eq(teamMemberPresence.id, existing.id))
          .returning();
      } else {
        // Insert new
        [presence] = await db
          .insert(teamMemberPresence)
          .values({
            organizationId: org.id,
            userId,
            status,
            lastSeenAt: new Date(),
            deviceInfo: deviceInfo || null,
          })
          .returning();
      }
      
      res.json(presence);
    } catch (error: any) {
      logger.error("Update presence error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // OFFER LETTERS & TEMPLATES (Phase 2.2-2.3 Acquisition)
  // ============================================

  // GET /api/offer-letters - List offer letters with optional filters
  api.get("/api/offer-letters", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { status, batchId } = req.query;
      
      const filters: { status?: string; batchId?: string } = {};
      if (typeof status === 'string') filters.status = status;
      if (typeof batchId === 'string') filters.batchId = batchId;
      
      const letters = await storage.getOfferLetters(org.id, filters);
      res.json(letters);
    } catch (error: any) {
      logger.error("Get offer letters error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/offer-letters - Create a single offer letter
  api.post("/api/offer-letters", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = insertOfferLetterSchema.omit({ organizationId: true }).safeParse(req.body);
      
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid offer letter data", parsed.error.errors);
      }
      
      const letter = await storage.createOfferLetter({
        ...parsed.data,
        organizationId: org.id,
      });
      
      res.status(201).json(letter);
    } catch (error: any) {
      logger.error("Create offer letter error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/offer-letters/batch - Create batch of offer letters
  api.post("/api/offer-letters/batch", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      
      const batchSchema = z.object({
        leadIds: z.array(z.number()).min(1),
        offerPercent: z.number().min(5).max(100),
        expirationDays: z.number().min(7).max(90).default(30),
        templateId: z.string().optional(),
        deliveryMethod: z.enum(["direct_mail", "email", "both"]).default("direct_mail"),
      });
      
      const parsed = batchSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid batch data", parsed.error.errors);
      }
      
      const { leadIds, offerPercent, expirationDays, templateId, deliveryMethod } = parsed.data;
      
      // Get leads with properties to calculate offers
      const allLeads = await storage.getLeads(org.id);
      const selectedLeads = allLeads.filter(lead => leadIds.includes(lead.id));
      
      if (selectedLeads.length === 0) {
        return Errors.badRequest(res, "No valid leads found for batch");
      }
      
      // Get properties for the leads
      const allProperties = await storage.getProperties(org.id);
      const propertyMap = new Map(allProperties.map(p => [p.sellerId, p]));
      
      // Generate batch ID
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + expirationDays);
      
      // Create offer letters for each lead
      const lettersToCreate = selectedLeads.map(lead => {
        const property = propertyMap.get(lead.id);
        const assessedValue = property?.assessedValue ? Number(property.assessedValue) : 0;
        const offerAmount = Math.round(assessedValue * (offerPercent / 100));
        
        return {
          organizationId: org.id,
          leadId: lead.id,
          propertyId: property?.id || null,
          offerAmount: offerAmount.toString(),
          offerPercent: offerPercent.toString(),
          assessedValue: assessedValue.toString(),
          expirationDays,
          expirationDate,
          templateId: templateId || null,
          status: "draft",
          deliveryMethod,
          batchId,
        };
      });
      
      const createdLetters = await storage.createOfferLettersBatch(lettersToCreate as any);
      
      res.status(201).json({
        batchId,
        count: createdLetters.length,
        letters: createdLetters,
      });
    } catch (error: any) {
      logger.error("Create batch offer letters error", error);
      Errors.internal(res, error);
    }
  });

  // PUT /api/offer-letters/:id - Update an offer letter
  api.put("/api/offer-letters/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid offer letter ID");
      }
      
      const existing = await storage.getOfferLetter(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Offer letter");
      }
      
      const parsed = insertOfferLetterSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid update data", parsed.error.errors);
      }
      
      const updated = await storage.updateOfferLetter(id, parsed.data);
      res.json(updated);
    } catch (error: any) {
      logger.error("Update offer letter error", error);
      Errors.internal(res, error);
    }
  });

  // DELETE /api/offer-letters/:id - Delete an offer letter
  api.delete("/api/offer-letters/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid offer letter ID");
      }
      
      const existing = await storage.getOfferLetter(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Offer letter");
      }
      
      await storage.deleteOfferLetter(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete offer letter error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/offer-letters/:id/send - Queue offer letter for sending
  api.post("/api/offer-letters/:id/send", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid offer letter ID");
      }
      
      const letter = await storage.getOfferLetter(org.id, id);
      if (!letter) {
        return Errors.notFound(res, "Offer letter");
      }
      
      if (letter.status !== "draft") {
        return Errors.badRequest(res, "Only draft offers can be queued for sending");
      }
      
      // Queue for sending (in real implementation, this would integrate with Lob)
      const updated = await storage.updateOfferLetter(id, {
        status: "queued",
      });
      
      res.json(updated);
    } catch (error: any) {
      logger.error("Send offer letter error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/offer-templates - List offer templates
  api.get("/api/offer-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const templates = await storage.getOfferTemplates(org.id);
      res.json(templates);
    } catch (error: any) {
      logger.error("Get offer templates error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/offer-templates - Create offer template
  api.post("/api/offer-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = insertOfferTemplateSchema.omit({ organizationId: true }).safeParse(req.body);
      
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid template data", parsed.error.errors);
      }
      
      const template = await storage.createOfferTemplate({
        ...parsed.data,
        organizationId: org.id,
      });
      
      res.status(201).json(template);
    } catch (error: any) {
      logger.error("Create offer template error", error);
      Errors.internal(res, error);
    }
  });

  // PUT /api/offer-templates/:id - Update offer template
  api.put("/api/offer-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }
      
      const existing = await storage.getOfferTemplate(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Template");
      }
      
      const parsed = insertOfferTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid update data", parsed.error.errors);
      }
      
      const updated = await storage.updateOfferTemplate(id, parsed.data);
      res.json(updated);
    } catch (error: any) {
      logger.error("Update offer template error", error);
      Errors.internal(res, error);
    }
  });

  // DELETE /api/offer-templates/:id - Delete offer template
  api.delete("/api/offer-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid template ID");
      }
      
      const existing = await storage.getOfferTemplate(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Template");
      }
      
      await storage.deleteOfferTemplate(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete offer template error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // PROPERTY LISTINGS (Phase 4.1)
  // ============================================

  // GET /api/listings - List all listings with optional status filter
  api.get("/api/listings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const status = req.query.status as string | undefined;
      const listings = await storage.getPropertyListings(org.id, status ? { status } : undefined);
      res.json(listings);
    } catch (error: any) {
      logger.error("Get listings error", error);
      Errors.internal(res, error);
    }
  });

  // GET /api/listings/:id - Get listing by ID
  api.get("/api/listings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid listing ID");
      }
      
      const listing = await storage.getPropertyListing(org.id, id);
      if (!listing) {
        return Errors.notFound(res, "Listing");
      }
      
      res.json(listing);
    } catch (error: any) {
      logger.error("Get listing error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/listings - Create new listing
  api.post("/api/listings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = insertPropertyListingSchema.omit({ organizationId: true }).safeParse(req.body);
      
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid listing data", parsed.error.errors);
      }
      
      // Verify property belongs to this org
      const property = await storage.getProperty(org.id, parsed.data.propertyId);
      if (!property) {
        return Errors.badRequest(res, "Property not found or doesn't belong to your organization");
      }
      
      // Check if listing already exists for this property
      const existing = await storage.getPropertyListingByPropertyId(org.id, parsed.data.propertyId);
      if (existing) {
        return Errors.badRequest(res, "A listing already exists for this property");
      }
      
      const listing = await storage.createPropertyListing({
        ...parsed.data,
        organizationId: org.id,
      });
      
      res.status(201).json(listing);
    } catch (error: any) {
      logger.error("Create listing error", error);
      Errors.internal(res, error);
    }
  });

  // PUT /api/listings/:id - Update listing
  api.put("/api/listings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid listing ID");
      }
      
      const existing = await storage.getPropertyListing(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Listing");
      }
      
      const parsed = insertPropertyListingSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Invalid update data", parsed.error.errors);
      }
      
      const updated = await storage.updatePropertyListing(id, parsed.data);
      res.json(updated);
    } catch (error: any) {
      logger.error("Update listing error", error);
      Errors.internal(res, error);
    }
  });

  // DELETE /api/listings/:id - Delete listing
  api.delete("/api/listings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid listing ID");
      }
      
      const existing = await storage.getPropertyListing(org.id, id);
      if (!existing) {
        return Errors.notFound(res, "Listing");
      }
      
      await storage.deletePropertyListing(id);
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete listing error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/listings/:id/publish - Publish to syndication targets
  //
  // Real syndication: looks up the listing's underlying property, builds a
  // NormalizedListing, then calls listingSyndication.syndicateListing() for
  // each requested platform. Per-platform results are written back to the
  // listing's syndicationTargets jsonb log so the UI can render history.
  //
  // - Honors SIMULATION_MODE (category "listings"): test orgs never POST to
  //   real partner APIs; would-have-happened payloads are written to
  //   simulated_actions instead.
  // - Idempotent against rapid clicks: any platform attempted in the last
  //   60s for this same listing is skipped with status "idempotent_skip".
  // - Returns { platforms: [{ platform, status, error?, listingUrl?, listingId? }] }
  //   per syndication call site contract.
  api.post(
    "/api/listings/:id/publish",
    isAuthenticated,
    getOrCreateOrg,
    idempotencyMiddleware,
    async (req, res) => {
      try {
        const org = req.organization;
        const id = parseInt(req.params.id);

        if (isNaN(id)) {
          return Errors.badRequest(res, "Invalid listing ID");
        }

        const listing = await storage.getPropertyListing(org.id, id);
        if (!listing) {
          return Errors.notFound(res, "Listing");
        }

        // ── Plan-tier gate: marketplace_syndication is Scale+ only.
        // Lower tiers can still preview (dryRun) but real fan-out is blocked.
        const tier = (org.subscriptionTier ?? "free") as SubscriptionTier;
        const tierFeatures: readonly string[] =
          SUBSCRIPTION_TIERS[tier]?.features ?? [];
        const hasSyndicationFeature = tierFeatures.includes(
          "marketplace_syndication"
        );

        // Accept BOTH the legacy { targets } shape and the new { platforms } shape
        // so we don't break any existing callers (the legacy stub used "targets").
        const platformsInput: unknown =
          req.body?.platforms ?? req.body?.targets;
        const dryRun: boolean = req.body?.dryRun === true;

        if (!Array.isArray(platformsInput) || platformsInput.length === 0) {
          return Errors.badRequest(
            res,
            "Please specify at least one syndication platform"
          );
        }

        // Coerce + validate against known PLATFORMS registry
        const knownIds = new Set(
          Object.keys(listingSyndication.PLATFORMS)
        ) as Set<string>;
        const platforms = (platformsInput as unknown[])
          .filter((p): p is string => typeof p === "string")
          .filter((p) => knownIds.has(p)) as listingSyndication.LegacySyndicationPlatform[];

        if (platforms.length === 0) {
          return Errors.badRequest(
            res,
            "No recognized syndication platforms in request"
          );
        }

        // ── Idempotency: skip platforms already attempted in the last 60s.
        // Without this, double-clicking "Publish" creates duplicate listings.
        const existingTargets = (listing.syndicationTargets ?? []) as Array<{
          platform: string;
          status: string;
          postedAt?: string;
          listingId?: string;
          listingUrl?: string;
          error?: string;
        }>;
        const now = Date.now();
        const recentByPlatform = new Map<string, (typeof existingTargets)[number]>();
        for (const t of existingTargets) {
          if (!t.postedAt) continue;
          const ageMs = now - new Date(t.postedAt).getTime();
          if (Number.isFinite(ageMs) && ageMs < 60_000) {
            recentByPlatform.set(t.platform, t);
          }
        }

        // Load the underlying property + org for the NormalizedListing builder
        const [property] = await db
          .select()
          .from(properties)
          .where(
            and(
              eq(properties.id, listing.propertyId),
              eq(properties.organizationId, org.id)
            )
          );

        if (!property) {
          return Errors.notFound(res, "Property for listing");
        }

        const [orgRow] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, org.id));

        const normalizedListing =
          await listingSyndication.buildNormalizedListing(property, orgRow, {
            askingPrice: parseFloat(listing.askingPrice || "0"),
            sellerFinancingAvailable:
              listing.sellerFinancingAvailable || false,
            downPaymentMin: listing.downPaymentMin
              ? parseFloat(listing.downPaymentMin)
              : undefined,
            monthlyPaymentMin: listing.monthlyPaymentMin
              ? parseFloat(listing.monthlyPaymentMin)
              : undefined,
            interestRate: listing.interestRate
              ? parseFloat(listing.interestRate)
              : undefined,
            termYears: listing.termMonths
              ? Math.round(listing.termMonths / 12)
              : undefined,
          });

        // ── Per-platform fan-out
        const simulated = shouldSimulate("listings", orgRow ?? null);
        const platformsToSyndicate: typeof platforms = [];
        const earlyResults: Array<{
          platform: string;
          status: "sent" | "missing_credentials" | "failed" | "idempotent_skip" | "simulated" | "dry_run";
          error?: string;
          listingId?: string;
          listingUrl?: string;
          deepLinkUrl?: string;
          manualInstructions?: string;
        }> = [];

        for (const p of platforms) {
          // 1. Idempotency check
          if (recentByPlatform.has(p)) {
            earlyResults.push({
              platform: p,
              status: "idempotent_skip",
            });
            continue;
          }

          // 2. Plan-tier gate (skip everything for non-Scale+ users except
          // dry-run previews). Craigslist is allowed on every tier because
          // it generates a copy/paste template, no API call.
          if (!hasSyndicationFeature && p !== "craigslist" && !dryRun) {
            earlyResults.push({
              platform: p,
              status: "missing_credentials",
              error: "Marketplace syndication requires a Scale plan or higher",
              manualInstructions: `Upgrade your plan to enable ${listingSyndication.PLATFORMS[p].name} syndication.`,
            });
            continue;
          }

          // 3. Credential gate (env vars listed in PLATFORMS registry)
          const cfg = listingSyndication.PLATFORMS[p];
          const missingEnv = (cfg.envKeys || []).filter(
            (k) => !process.env[k]
          );
          // Craigslist + any platform with no envKeys requires no creds
          if (cfg.envKeys.length > 0 && missingEnv.length === cfg.envKeys.length) {
            earlyResults.push({
              platform: p,
              status: "missing_credentials",
              error: `Missing env vars: ${missingEnv.join(", ")}`,
              manualInstructions: `Add ${cfg.envKeys.join(", ")} in Settings → Integrations to enable ${cfg.name}.`,
            });
            continue;
          }

          // 4. Dry run mode (UI preview)
          if (dryRun) {
            earlyResults.push({ platform: p, status: "dry_run" });
            continue;
          }

          // 5. Simulation mode (test org / SIMULATION_MODE=true)
          if (simulated) {
            await recordSimulatedAction(
              "listings",
              `syndicate.${p}`,
              {
                listingId: listing.id,
                propertyId: listing.propertyId,
                platform: p,
                askingPrice: normalizedListing.askingPrice,
                acreage: normalizedListing.acreage,
              },
              orgRow ?? { id: org.id }
            );
            earlyResults.push({ platform: p, status: "simulated" });
            continue;
          }

          // Otherwise, queue for real syndication
          platformsToSyndicate.push(p);
        }

        // 6. Real fan-out for whatever survived the gates
        const realResults = platformsToSyndicate.length
          ? await listingSyndication.syndicateListing(
              normalizedListing,
              platformsToSyndicate
            )
          : [];

        const realResultsByPlatform = new Map(
          realResults.map((r) => [r.platform, r])
        );

        // Combine early-decided + real-fanout, preserving the request order
        const finalResults = platforms.map((p) => {
          const early = earlyResults.find((r) => r.platform === p);
          if (early) return early;
          const r = realResultsByPlatform.get(p);
          if (!r) {
            return {
              platform: p,
              status: "failed" as const,
              error: "No result returned from syndication service",
            };
          }
          return {
            platform: r.platform,
            status: r.success
              ? ("sent" as const)
              : r.error?.toLowerCase().includes("not configured")
              ? ("missing_credentials" as const)
              : ("failed" as const),
            error: r.error,
            listingId: r.listingId,
            listingUrl: r.listingUrl,
            deepLinkUrl: r.deepLinkUrl,
            manualInstructions: r.manualInstructions,
          };
        });

        // 7. Persist results into the listing's syndicationTargets log
        // Merge: keep any pre-existing entries for other platforms, replace
        // entries for platforms we just touched.
        const touched = new Set(finalResults.map((r) => r.platform));
        const carriedOver = existingTargets.filter(
          (t) => !touched.has(t.platform)
        );
        const stamp = new Date().toISOString();
        const newEntries = finalResults.map((r) => ({
          platform: r.platform,
          listingId: r.listingId,
          listingUrl: r.listingUrl,
          status:
            r.status === "sent"
              ? "active"
              : r.status === "simulated"
              ? "simulated"
              : r.status === "dry_run"
              ? "preview"
              : r.status === "idempotent_skip"
              ? "duplicate_suppressed"
              : r.status === "missing_credentials"
              ? "needs_credentials"
              : "failed",
          postedAt: stamp,
          error: r.error,
        }));

        const merged = [...carriedOver, ...newEntries];
        const anySent = finalResults.some(
          (r) => r.status === "sent" || r.status === "simulated"
        );

        await storage.updatePropertyListing(id, {
          status: anySent ? "active" : listing.status,
          syndicationTargets: merged,
          publishedAt: anySent ? new Date() : listing.publishedAt ?? null,
        });

        logger.info("Listing publish fan-out complete", {
          source: "routes-team-messaging",
          metadata: {
            listingId: id,
            orgId: org.id,
            simulated,
            dryRun,
            platforms: finalResults.map((r) => ({
              platform: r.platform,
              status: r.status,
            })),
          },
        });

        return res.json({ platforms: finalResults });
      } catch (error: any) {
        logger.error("Publish listing error", error);
        Errors.internal(res, error);
      }
    }
  );

  // POST /api/listings/:id/unpublish - Remove from syndication
  api.post("/api/listings/:id/unpublish", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return Errors.badRequest(res, "Invalid listing ID");
      }
      
      const listing = await storage.getPropertyListing(org.id, id);
      if (!listing) {
        return Errors.notFound(res, "Listing");
      }
      
      // Mark all syndication targets as removed
      const syndicationTargets = listing.syndicationTargets?.map((target: any) => ({
        ...target,
        status: "removed",
      })) || [];
      
      const updated = await storage.updatePropertyListing(id, {
        status: "withdrawn",
        syndicationTargets,
      });
      
      res.json(updated);
    } catch (error: any) {
      logger.error("Unpublish listing error", error);
      Errors.internal(res, error);
    }
  });

  // ============================================

  // ── Named Channels ─────────────────────────────────────────────────────────
  // Channels are teamConversations with isDirect=false and a name.
  // Three seed channels (#general, #acquisitions, #closings) are created when
  // an org is provisioned. These routes let users create more and list them.

  // GET /api/team-messaging/channels - List named channels for the org
  api.get("/api/team-messaging/channels", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;

      // Ensure seed channels exist for this org
      const existing = await db
        .select()
        .from(teamConversations)
        .where(and(
          eq(teamConversations.organizationId, org.id),
          eq(teamConversations.isDirect, false),
        ));

      if (existing.length === 0) {
        const seeds = ["#general", "#acquisitions", "#closings"];
        for (const name of seeds) {
          await db.insert(teamConversations).values({
            organizationId: org.id,
            name,
            isDirect: false,
            createdBy: userId,
            participantIds: [userId],
            status: "active",
          }).onConflictDoNothing();
        }
        const seeded = await db
          .select()
          .from(teamConversations)
          .where(and(
            eq(teamConversations.organizationId, org.id),
            eq(teamConversations.isDirect, false),
          ))
          .orderBy(teamConversations.name);
        return res.json(seeded);
      }

      const channels = existing.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
      res.json(channels);
    } catch (error: any) {
      logger.error("Get channels error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/team-messaging/channels - Create a new named channel
  api.post("/api/team-messaging/channels", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;

      const schema = z.object({
        name: z.string().min(1).max(80).transform(n => n.startsWith("#") ? n : `#${n}`),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.badRequest(res, "Name is required", parsed.error.errors);
      }

      const { name } = parsed.data;

      // Check for duplicate channel name in org
      const [dupe] = await db
        .select()
        .from(teamConversations)
        .where(and(
          eq(teamConversations.organizationId, org.id),
          eq(teamConversations.isDirect, false),
          eq(teamConversations.name, name),
        ));
      if (dupe) {
        return res.status(409).json({ message: `Channel ${name} already exists` });
      }

      const [channel] = await db
        .insert(teamConversations)
        .values({
          organizationId: org.id,
          name,
          isDirect: false,
          createdBy: userId,
          participantIds: [userId],
          status: "active",
        })
        .returning();

      wsServer.broadcastToOrg(org.id, "channel.created", { channel });
      res.status(201).json(channel);
    } catch (error: any) {
      logger.error("Create channel error", error);
      Errors.internal(res, error);
    }
  });

  // POST /api/team-messaging/channels/:id/join - Join a channel
  api.post("/api/team-messaging/channels/:id/join", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const channelId = parseInt(req.params.id, 10);

      const [channel] = await db
        .select()
        .from(teamConversations)
        .where(and(
          eq(teamConversations.id, channelId),
          eq(teamConversations.organizationId, org.id),
          eq(teamConversations.isDirect, false),
        ));
      if (!channel) return Errors.notFound(res, "Channel");

      const participants: string[] = Array.from(new Set([...(channel.participantIds ?? []), userId]));
      const [updated] = await db
        .update(teamConversations)
        .set({ participantIds: participants, updatedAt: new Date() })
        .where(eq(teamConversations.id, channelId))
        .returning();

      res.json(updated);
    } catch (error: any) {
      logger.error("Join channel error", error);
      Errors.internal(res, error);
    }
  });

}
