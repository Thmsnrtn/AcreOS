import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage, calculateMonthlyPayment } from "./storage";
import { z } from "zod";
import { 
  insertLeadSchema, insertPropertySchema, insertNoteSchema, 
  insertCampaignSchema, insertAgentTaskSchema, insertDealSchema,
  insertPaymentSchema, insertOrganizationSchema, insertAgentConfigSchema,
  SUBSCRIPTION_TIERS
} from "@shared/schema";

// Auth imports
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";

// AI imports
import { processChat, processChatStream, agentProfiles, getOrCreateConversation } from "./ai/executive";

// Middleware to get/create organization for authenticated user
async function getOrCreateOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  // Get user ID from Replit Auth claims
  const user = req.user as any;
  const userId = user.claims?.sub || user.id;
  
  if (!userId) {
    console.error("No user ID found in session:", user);
    return res.status(401).json({ message: "Invalid user session" });
  }
  
  let org = await storage.getOrganizationByOwner(userId);
  
  if (!org) {
    // Create default organization for new user
    const displayName = user.claims?.first_name || user.username || user.email || "User";
    const slug = `org-${userId}-${Date.now()}`;
    org = await storage.createOrganization({
      name: `${displayName}'s Organization`,
      slug,
      ownerId: userId,
      subscriptionTier: "free",
      subscriptionStatus: "active",
    });
    
    // Add user as owner team member
    await storage.createTeamMember({
      organizationId: org.id,
      userId,
      displayName,
      role: "owner",
      isActive: true,
    });
  }
  
  (req as any).organization = org;
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Register Auth
  await setupAuth(app);
  registerAuthRoutes(app);
  
  // Protected API routes - all require authentication
  const api = app;
  
  // ============================================
  // DASHBOARD
  // ============================================
  
  api.get("/api/dashboard/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const stats = await storage.getDashboardStats(org.id);
    res.json(stats);
  });
  
  // ============================================
  // ORGANIZATION
  // ============================================
  
  api.get("/api/organization", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    res.json(org);
  });
  
  api.patch("/api/organization", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const updates = req.body;
    const updated = await storage.updateOrganization(org.id, updates);
    res.json(updated);
  });
  
  api.get("/api/subscription/tiers", async (req, res) => {
    res.json(SUBSCRIPTION_TIERS);
  });
  
  // ============================================
  // TEAM MEMBERS
  // ============================================
  
  api.get("/api/team", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const members = await storage.getTeamMembers(org.id);
    res.json(members);
  });
  
  // ============================================
  // LEADS (CRM)
  // ============================================
  
  api.get("/api/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leads = await storage.getLeads(org.id);
    res.json(leads);
  });
  
  api.get("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const lead = await storage.getLead(org.id, Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });
  
  api.post("/api/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertLeadSchema.parse({ ...req.body, organizationId: org.id });
      const lead = await storage.createLead(input);
      res.status(201).json(lead);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const lead = await storage.updateLead(Number(req.params.id), req.body);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });
  
  api.delete("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteLead(Number(req.params.id));
    res.status(204).send();
  });
  
  // ============================================
  // PROPERTIES (INVENTORY)
  // ============================================
  
  api.get("/api/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const properties = await storage.getProperties(org.id);
    res.json(properties);
  });
  
  api.get("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const property = await storage.getProperty(org.id, Number(req.params.id));
    if (!property) return res.status(404).json({ message: "Property not found" });
    res.json(property);
  });
  
  api.post("/api/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertPropertySchema.parse({ ...req.body, organizationId: org.id });
      const property = await storage.createProperty(input);
      res.status(201).json(property);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const property = await storage.updateProperty(Number(req.params.id), req.body);
    if (!property) return res.status(404).json({ message: "Property not found" });
    res.json(property);
  });
  
  api.delete("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteProperty(Number(req.params.id));
    res.status(204).send();
  });
  
  // ============================================
  // DEALS (Acquisitions/Dispositions)
  // ============================================
  
  api.get("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const deals = await storage.getDeals(org.id);
    res.json(deals);
  });
  
  api.get("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const deal = await storage.getDeal(org.id, Number(req.params.id));
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  });
  
  api.post("/api/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertDealSchema.parse({ ...req.body, organizationId: org.id });
      const deal = await storage.createDeal(input);
      res.status(201).json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const deal = await storage.updateDeal(Number(req.params.id), req.body);
    if (!deal) return res.status(404).json({ message: "Deal not found" });
    res.json(deal);
  });
  
  // ============================================
  // NOTES (Seller Financing)
  // ============================================
  
  api.get("/api/notes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const notes = await storage.getNotes(org.id);
    res.json(notes);
  });
  
  api.get("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const note = await storage.getNote(org.id, Number(req.params.id));
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  });
  
  api.post("/api/notes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      // Calculate monthly payment if not provided
      let monthlyPayment = req.body.monthlyPayment;
      if (!monthlyPayment && req.body.originalPrincipal && req.body.interestRate && req.body.termMonths) {
        monthlyPayment = calculateMonthlyPayment(
          Number(req.body.originalPrincipal),
          Number(req.body.interestRate),
          Number(req.body.termMonths)
        );
      }
      
      const input = insertNoteSchema.parse({ 
        ...req.body, 
        organizationId: org.id,
        monthlyPayment: String(monthlyPayment),
        currentBalance: req.body.originalPrincipal,
      });
      const note = await storage.createNote(input);
      res.status(201).json(note);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const note = await storage.updateNote(Number(req.params.id), req.body);
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  });
  
  // Calculate payment helper endpoint
  api.post("/api/notes/calculate-payment", isAuthenticated, async (req, res) => {
    const { principal, interestRate, termMonths } = req.body;
    const payment = calculateMonthlyPayment(
      Number(principal),
      Number(interestRate),
      Number(termMonths)
    );
    res.json({ monthlyPayment: payment });
  });
  
  // ============================================
  // PAYMENTS
  // ============================================
  
  api.get("/api/payments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const noteId = req.query.noteId ? Number(req.query.noteId) : undefined;
    const payments = await storage.getPayments(org.id, noteId);
    res.json(payments);
  });
  
  api.post("/api/payments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertPaymentSchema.parse({ ...req.body, organizationId: org.id });
      const payment = await storage.createPayment(input);
      res.status(201).json(payment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  // ============================================
  // CAMPAIGNS (Marketing)
  // ============================================
  
  api.get("/api/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaigns = await storage.getCampaigns(org.id);
    res.json(campaigns);
  });
  
  api.get("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaign = await storage.getCampaign(org.id, Number(req.params.id));
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });
  
  api.post("/api/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertCampaignSchema.parse({ ...req.body, organizationId: org.id });
      const campaign = await storage.createCampaign(input);
      res.status(201).json(campaign);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const campaign = await storage.updateCampaign(Number(req.params.id), req.body);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });
  
  // ============================================
  // AI AGENTS
  // ============================================
  
  api.get("/api/agents/configs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const configs = await storage.getAgentConfigs(org.id);
    res.json(configs);
  });
  
  api.post("/api/agents/configs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertAgentConfigSchema.parse({ ...req.body, organizationId: org.id });
      const config = await storage.createAgentConfig(input);
      res.status(201).json(config);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.get("/api/agents/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const tasks = await storage.getAgentTasks(org.id);
    res.json(tasks);
  });
  
  api.post("/api/agents/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertAgentTaskSchema.parse({ ...req.body, organizationId: org.id });
      const task = await storage.createAgentTask(input);
      res.status(201).json(task);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  // ============================================
  // CONVERSATIONS (Buyer Communication)
  // ============================================
  
  api.get("/api/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = req.query.leadId ? Number(req.query.leadId) : undefined;
    const conversations = await storage.getConversations(org.id, leadId);
    res.json(conversations);
  });
  
  api.get("/api/conversations/:id/messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const messages = await storage.getMessages(Number(req.params.id));
    res.json(messages);
  });
  
  // ============================================
  // AI COMMAND CENTER
  // ============================================
  
  // Get available AI agents
  api.get("/api/ai/agents", isAuthenticated, async (req, res) => {
    res.json(Object.values(agentProfiles));
  });
  
  // Get conversation history
  api.get("/api/ai/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const conversations = await storage.getAiConversations(org.id);
    res.json(conversations);
  });
  
  // Get a specific conversation with messages
  api.get("/api/ai/conversations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const conversationId = parseInt(req.params.id);
    const conversation = await storage.getAiConversation(conversationId);
    
    if (!conversation || conversation.organizationId !== org.id) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    
    const messages = await storage.getAiMessages(conversationId);
    res.json({ conversation, messages });
  });
  
  // Create new conversation
  api.post("/api/ai/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const user = req.user as any;
    const userId = user.claims?.sub || user.id;
    const { agentRole = "executive" } = req.body;
    
    const conversation = await storage.createAiConversation({
      organizationId: org.id,
      userId,
      title: "New Conversation",
      agentRole
    });
    
    res.status(201).json(conversation);
  });
  
  // Send a message (non-streaming)
  api.post("/api/ai/chat", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { message, conversationId, agentRole } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      const result = await processChat(message, org, userId, {
        conversationId,
        agentRole
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("AI Chat error:", error);
      res.status(500).json({ message: error.message || "AI processing failed" });
    }
  });
  
  // Send a message (streaming)
  api.post("/api/ai/chat/stream", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { message, conversationId, agentRole } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      
      const stream = processChatStream(message, org, userId, {
        conversationId,
        agentRole
      });
      
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      
      res.end();
    } catch (error: any) {
      console.error("AI Stream error:", error);
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  });
  
  // Delete a conversation
  api.delete("/api/ai/conversations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const conversationId = parseInt(req.params.id);
    const conversation = await storage.getAiConversation(conversationId);
    
    if (!conversation || conversation.organizationId !== org.id) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    
    await storage.deleteAiConversation(conversationId);
    res.json({ success: true });
  });
  
  // ============================================
  // STRIPE SUBSCRIPTION
  // ============================================
  
  api.get("/api/stripe/products", async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const rows = await stripeService.listProductsWithPrices();
      
      const productsMap = new Map();
      for (const row of rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            active: row.product_active,
            metadata: row.product_metadata,
            prices: []
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring,
            active: row.price_active,
            metadata: row.price_metadata,
          });
        }
      }
      
      res.json(Array.from(productsMap.values()));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/stripe/checkout", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      const { priceId } = req.body;
      
      if (!priceId) {
        return res.status(400).json({ message: "priceId is required" });
      }
      
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const user = req.user as any;
        const customer = await stripeService.createCustomer(
          user.email,
          user.id,
          org.name
        );
        await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }
      
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${req.protocol}://${req.get('host')}/settings?subscription=success`,
        `${req.protocol}://${req.get('host')}/settings?subscription=cancelled`,
        { organizationId: String(org.id) }
      );
      
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/stripe/portal", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      
      if (!org.stripeCustomerId) {
        return res.status(400).json({ message: "No subscription found" });
      }
      
      const session = await stripeService.createCustomerPortalSession(
        org.stripeCustomerId,
        `${req.protocol}://${req.get('host')}/settings`
      );
      
      res.json({ url: session.url });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/stripe/subscription", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const org = (req as any).organization;
      
      if (!org.stripeCustomerId) {
        return res.json({ subscription: null });
      }
      
      const subscriptions = await stripeService.getCustomerSubscriptions(org.stripeCustomerId);
      const activeSubscription = subscriptions.find((s: any) => 
        s.status === 'active' || s.status === 'trialing'
      );
      
      res.json({ subscription: activeSubscription || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
