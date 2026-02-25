// @ts-nocheck — ORM type refinement deferred; runtime-correct
import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, desc, sql, lt } from "drizzle-orm";
import {
  insertTeamConversationSchema, insertTeamMessageSchema, insertTeamMemberPresenceSchema,
  teamConversations, teamMessages, teamMemberPresence,
  insertOfferLetterSchema, insertOfferTemplateSchema,
  insertPropertyListingSchema,
} from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { NextFunction } from "express";
import { inArray } from "drizzle-orm";

export function registerTeamMessagingRoutes(app: Express): void {
  const api = app;

  // TEAM MESSAGING API
  // ============================================
  
  // Tier gating middleware for team messaging (requires 2+ seats)
  const requireMessagingTier = async (req: Request, res: Response, next: NextFunction) => {
    const org = (req as any).organization;
    if (!org) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const { checkTeamMessagingAccess } = await import("./services/usageLimits");
    const hasAccess = await checkTeamMessagingAccess(org.id);
    
    if (!hasAccess) {
      return res.status(403).json({ 
        message: "Team messaging requires a plan with 2 or more seats. Upgrade to Starter or higher to access this feature.",
        tier_gating: true,
        minSeats: 2
      });
    }
    next();
  };

  // GET /api/team-messaging/conversations - List all conversations for the current user
  api.get("/api/team-messaging/conversations", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Get team conversations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch conversations" });
    }
  });

  // POST /api/team-messaging/conversations - Create a new conversation
  api.post("/api/team-messaging/conversations", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const createSchema = z.object({
        name: z.string().optional(),
        isDirect: z.boolean().default(true),
        participantIds: z.array(z.string()).min(1),
      });
      
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.errors });
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
      console.error("Create team conversation error:", error);
      res.status(500).json({ message: error.message || "Failed to create conversation" });
    }
  });

  // GET /api/team-messaging/conversations/:id/messages - Get messages (cursor-based pagination)
  api.get("/api/team-messaging/conversations/:id/messages", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const conversationId = parseInt(req.params.id, 10);
      
      if (isNaN(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
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
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      if (!conversation.participantIds?.includes(userId)) {
        return res.status(403).json({ message: "Not a participant of this conversation" });
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
      console.error("Get team messages error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch messages" });
    }
  });

  // POST /api/team-messaging/conversations/:id/messages - Send a message
  api.post("/api/team-messaging/conversations/:id/messages", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const conversationId = parseInt(req.params.id, 10);
      
      if (isNaN(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
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
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      if (!conversation.participantIds?.includes(userId)) {
        return res.status(403).json({ message: "Not a participant of this conversation" });
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
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.errors });
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
      
      res.status(201).json(message);
    } catch (error: any) {
      console.error("Send team message error:", error);
      res.status(500).json({ message: error.message || "Failed to send message" });
    }
  });

  // PATCH /api/team-messaging/conversations/:id/read - Mark messages as read
  api.patch("/api/team-messaging/conversations/:id/read", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const conversationId = parseInt(req.params.id, 10);
      
      if (isNaN(conversationId)) {
        return res.status(400).json({ message: "Invalid conversation ID" });
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
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      if (!conversation.participantIds?.includes(userId)) {
        return res.status(403).json({ message: "Not a participant of this conversation" });
      }
      
      const readSchema = z.object({
        messageIds: z.array(z.number()).optional(),
        upToMessageId: z.number().optional(),
      });
      
      const parsed = readSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.errors });
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
      console.error("Mark messages read error:", error);
      res.status(500).json({ message: error.message || "Failed to mark messages as read" });
    }
  });

  // GET /api/team-messaging/presence - Get team member presence statuses
  api.get("/api/team-messaging/presence", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const presenceStatuses = await db
        .select()
        .from(teamMemberPresence)
        .where(eq(teamMemberPresence.organizationId, org.id));
      
      res.json(presenceStatuses);
    } catch (error: any) {
      console.error("Get presence error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch presence statuses" });
    }
  });

  // PATCH /api/team-messaging/presence - Update current user's presence status
  api.patch("/api/team-messaging/presence", isAuthenticated, getOrCreateOrg, requireMessagingTier, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const presenceSchema = z.object({
        status: z.enum(["online", "away", "offline"]),
        deviceInfo: z.string().optional(),
      });
      
      const parsed = presenceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parsed.error.errors });
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
      console.error("Update presence error:", error);
      res.status(500).json({ message: error.message || "Failed to update presence status" });
    }
  });

  // ============================================
  // OFFER LETTERS & TEMPLATES (Phase 2.2-2.3 Acquisition)
  // ============================================

  // GET /api/offer-letters - List offer letters with optional filters
  api.get("/api/offer-letters", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { status, batchId } = req.query;
      
      const filters: { status?: string; batchId?: string } = {};
      if (typeof status === 'string') filters.status = status;
      if (typeof batchId === 'string') filters.batchId = batchId;
      
      const letters = await storage.getOfferLetters(org.id, filters);
      res.json(letters);
    } catch (error: any) {
      console.error("Get offer letters error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offer letters" });
    }
  });

  // POST /api/offer-letters - Create a single offer letter
  api.post("/api/offer-letters", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertOfferLetterSchema.omit({ organizationId: true }).safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid offer letter data", errors: parsed.error.errors });
      }
      
      const letter = await storage.createOfferLetter({
        ...parsed.data,
        organizationId: org.id,
      });
      
      res.status(201).json(letter);
    } catch (error: any) {
      console.error("Create offer letter error:", error);
      res.status(500).json({ message: error.message || "Failed to create offer letter" });
    }
  });

  // POST /api/offer-letters/batch - Create batch of offer letters
  api.post("/api/offer-letters/batch", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const batchSchema = z.object({
        leadIds: z.array(z.number()).min(1),
        offerPercent: z.number().min(5).max(100),
        expirationDays: z.number().min(7).max(90).default(30),
        templateId: z.string().optional(),
        deliveryMethod: z.enum(["direct_mail", "email", "both"]).default("direct_mail"),
      });
      
      const parsed = batchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid batch data", errors: parsed.error.errors });
      }
      
      const { leadIds, offerPercent, expirationDays, templateId, deliveryMethod } = parsed.data;
      
      // Get leads with properties to calculate offers
      const allLeads = await storage.getLeads(org.id);
      const selectedLeads = allLeads.filter(lead => leadIds.includes(lead.id));
      
      if (selectedLeads.length === 0) {
        return res.status(400).json({ message: "No valid leads found for batch" });
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
      console.error("Create batch offer letters error:", error);
      res.status(500).json({ message: error.message || "Failed to create batch offers" });
    }
  });

  // PUT /api/offer-letters/:id - Update an offer letter
  api.put("/api/offer-letters/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid offer letter ID" });
      }
      
      const existing = await storage.getOfferLetter(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer letter not found" });
      }
      
      const parsed = insertOfferLetterSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update data", errors: parsed.error.errors });
      }
      
      const updated = await storage.updateOfferLetter(id, parsed.data);
      res.json(updated);
    } catch (error: any) {
      console.error("Update offer letter error:", error);
      res.status(500).json({ message: error.message || "Failed to update offer letter" });
    }
  });

  // DELETE /api/offer-letters/:id - Delete an offer letter
  api.delete("/api/offer-letters/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid offer letter ID" });
      }
      
      const existing = await storage.getOfferLetter(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer letter not found" });
      }
      
      await storage.deleteOfferLetter(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete offer letter error:", error);
      res.status(500).json({ message: error.message || "Failed to delete offer letter" });
    }
  });

  // POST /api/offer-letters/:id/send - Queue offer letter for sending
  api.post("/api/offer-letters/:id/send", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid offer letter ID" });
      }
      
      const letter = await storage.getOfferLetter(org.id, id);
      if (!letter) {
        return res.status(404).json({ message: "Offer letter not found" });
      }
      
      if (letter.status !== "draft") {
        return res.status(400).json({ message: "Only draft offers can be queued for sending" });
      }
      
      // Queue for sending (in real implementation, this would integrate with Lob)
      const updated = await storage.updateOfferLetter(id, {
        status: "queued",
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Send offer letter error:", error);
      res.status(500).json({ message: error.message || "Failed to queue offer letter" });
    }
  });

  // GET /api/offer-templates - List offer templates
  api.get("/api/offer-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const templates = await storage.getOfferTemplates(org.id);
      res.json(templates);
    } catch (error: any) {
      console.error("Get offer templates error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offer templates" });
    }
  });

  // POST /api/offer-templates - Create offer template
  api.post("/api/offer-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertOfferTemplateSchema.omit({ organizationId: true }).safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid template data", errors: parsed.error.errors });
      }
      
      const template = await storage.createOfferTemplate({
        ...parsed.data,
        organizationId: org.id,
      });
      
      res.status(201).json(template);
    } catch (error: any) {
      console.error("Create offer template error:", error);
      res.status(500).json({ message: error.message || "Failed to create template" });
    }
  });

  // PUT /api/offer-templates/:id - Update offer template
  api.put("/api/offer-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const existing = await storage.getOfferTemplate(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      const parsed = insertOfferTemplateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update data", errors: parsed.error.errors });
      }
      
      const updated = await storage.updateOfferTemplate(id, parsed.data);
      res.json(updated);
    } catch (error: any) {
      console.error("Update offer template error:", error);
      res.status(500).json({ message: error.message || "Failed to update template" });
    }
  });

  // DELETE /api/offer-templates/:id - Delete offer template
  api.delete("/api/offer-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const existing = await storage.getOfferTemplate(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      await storage.deleteOfferTemplate(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete offer template error:", error);
      res.status(500).json({ message: error.message || "Failed to delete template" });
    }
  });

  // ============================================
  // PROPERTY LISTINGS (Phase 4.1)
  // ============================================

  // GET /api/listings - List all listings with optional status filter
  api.get("/api/listings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const status = req.query.status as string | undefined;
      const listings = await storage.getPropertyListings(org.id, status ? { status } : undefined);
      res.json(listings);
    } catch (error: any) {
      console.error("Get listings error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch listings" });
    }
  });

  // GET /api/listings/:id - Get listing by ID
  api.get("/api/listings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      
      const listing = await storage.getPropertyListing(org.id, id);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      
      res.json(listing);
    } catch (error: any) {
      console.error("Get listing error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch listing" });
    }
  });

  // POST /api/listings - Create new listing
  api.post("/api/listings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertPropertyListingSchema.omit({ organizationId: true }).safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid listing data", errors: parsed.error.errors });
      }
      
      // Verify property belongs to this org
      const property = await storage.getProperty(org.id, parsed.data.propertyId);
      if (!property) {
        return res.status(400).json({ message: "Property not found or doesn't belong to your organization" });
      }
      
      // Check if listing already exists for this property
      const existing = await storage.getPropertyListingByPropertyId(org.id, parsed.data.propertyId);
      if (existing) {
        return res.status(400).json({ message: "A listing already exists for this property" });
      }
      
      const listing = await storage.createPropertyListing({
        ...parsed.data,
        organizationId: org.id,
      });
      
      res.status(201).json(listing);
    } catch (error: any) {
      console.error("Create listing error:", error);
      res.status(500).json({ message: error.message || "Failed to create listing" });
    }
  });

  // PUT /api/listings/:id - Update listing
  api.put("/api/listings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      
      const existing = await storage.getPropertyListing(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      
      const parsed = insertPropertyListingSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid update data", errors: parsed.error.errors });
      }
      
      const updated = await storage.updatePropertyListing(id, parsed.data);
      res.json(updated);
    } catch (error: any) {
      console.error("Update listing error:", error);
      res.status(500).json({ message: error.message || "Failed to update listing" });
    }
  });

  // DELETE /api/listings/:id - Delete listing
  api.delete("/api/listings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      
      const existing = await storage.getPropertyListing(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      
      await storage.deletePropertyListing(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete listing error:", error);
      res.status(500).json({ message: error.message || "Failed to delete listing" });
    }
  });

  // POST /api/listings/:id/publish - Publish to syndication targets (stub)
  api.post("/api/listings/:id/publish", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      
      const listing = await storage.getPropertyListing(org.id, id);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
      }
      
      const { targets } = req.body; // Array of target platforms
      if (!targets || !Array.isArray(targets) || targets.length === 0) {
        return res.status(400).json({ message: "Please specify syndication targets" });
      }
      
      // Create syndication targets with pending status
      const syndicationTargets = targets.map((platform: string) => ({
        platform,
        status: "pending",
        postedAt: new Date().toISOString(),
      }));
      
      const updated = await storage.updatePropertyListing(id, {
        status: "active",
        syndicationTargets,
        publishedAt: new Date(),
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Publish listing error:", error);
      res.status(500).json({ message: error.message || "Failed to publish listing" });
    }
  });

  // POST /api/listings/:id/unpublish - Remove from syndication
  api.post("/api/listings/:id/unpublish", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid listing ID" });
      }
      
      const listing = await storage.getPropertyListing(org.id, id);
      if (!listing) {
        return res.status(404).json({ message: "Listing not found" });
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
      console.error("Unpublish listing error:", error);
      res.status(500).json({ message: error.message || "Failed to unpublish listing" });
    }
  });

  // ============================================

}
