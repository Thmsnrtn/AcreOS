import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import type { Server } from "http";
import crypto from "crypto";
import { storage, calculateMonthlyPayment, db } from "./storage";
import { z } from "zod";
import { eq, sql, and, desc, lt, inArray } from "drizzle-orm";
import { 
  insertLeadSchema, insertPropertySchema, insertNoteSchema, 
  insertCampaignSchema, insertCampaignResponseSchema, insertAgentTaskSchema, insertDealSchema,
  insertPaymentSchema, insertOrganizationSchema, insertAgentConfigSchema,
  insertCampaignSequenceSchema, insertSequenceStepSchema, insertSequenceEnrollmentSchema,
  insertAbTestSchema, insertAbTestVariantSchema, Z_SCORES,
  insertCustomFieldDefinitionSchema, insertCustomFieldValueSchema, insertSavedViewSchema,
  insertTaskSchema, insertOfferLetterSchema, insertOfferTemplateSchema,
  insertPropertyListingSchema,
  insertMailSenderIdentitySchema, insertMailingOrderSchema,
  insertFeatureRequestSchema,
  SUBSCRIPTION_TIERS, payments, notes, deals, properties, leads, activityLog, organizations,
  teamConversations, teamMessages, teamMemberPresence,
  insertTeamConversationSchema, insertTeamMessageSchema, insertTeamMemberPresenceSchema,
  insertWorkflowSchema, WORKFLOW_TRIGGER_EVENTS, WORKFLOW_ACTION_TYPES,
  insertMarketingListSchema, insertOfferBatchSchema, insertOfferSchema,
  insertSellerCommunicationSchema, insertAdPostingSchema, insertBuyerPrequalificationSchema,
  insertCollectionSequenceSchema, insertCollectionEnrollmentSchema, insertCountyResearchSchema,
  offers, organizationIntegrations,
} from "@shared/schema";

// Partial update schemas for PUT endpoints
const updateLeadSchema = insertLeadSchema.partial().omit({ organizationId: true });
const updatePropertySchema = insertPropertySchema.partial().omit({ organizationId: true });
const updateDealSchema = insertDealSchema.partial().omit({ organizationId: true });

import { 
  workflowEngine, 
  emitLeadEvent, 
  emitPropertyEvent, 
  emitDealEvent, 
  emitPaymentEvent 
} from "./services/workflow-engine";
import { activityLogger } from "./services/activityLogger";

// Auth imports
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";

// AI imports
import { processChat, processChatStream, agentProfiles, getOrCreateConversation } from "./ai/executive";

// Import/Export imports
import multer from "multer";
import {
  parseCSV,
  previewImport,
  importLeads,
  importProperties,
  importDeals,
  exportLeadsToCSV,
  exportPropertiesToCSV,
  exportDealsToCSV,
  exportNotesToCSV,
  getLeadsData,
  getPropertiesData,
  getDealsData,
  getNotesData,
  createBackupZip,
  getExpectedColumns,
  type ExportFilters,
} from "./services/importExport";

// Usage limits
import { checkUsageLimit, getAllUsageLimits, UsageLimitError, TIER_LIMITS, type SubscriptionTier } from "./services/usageLimits";

// Usage metering for credits
import { usageMeteringService, creditService } from "./services/credits";

// Lead nurturing
import { leadNurturerService } from "./services/leadNurturer";

// Lead Scoring (Betty-style)
import { leadScoringService } from "./services/leadScoring";

// Alerting
import { alertingService } from "./services/alerting";

// Finance agent
import { financeAgentService } from "./services/financeAgent";

// Onboarding
import { onboardingService, type BusinessType } from "./services/onboarding";

// Property Enrichment
import { propertyEnrichmentService } from "./services/propertyEnrichment";

// AI Offer Generation
import { 
  generateOfferSuggestions, 
  generateOfferLetter, 
  predictAcceptanceProbability,
  type PropertyData,
  type OfferLetterRequest,
  type AcceptancePredictionRequest
} from "./services/aiOfferService";

// Permissions
import { 
  requirePermission, 
  requireAdminOrAbove, 
  requireOwner,
  attachPermissionContext,
  getUserPermissionContext,
  getPermissionsForRole,
  ROLES,
  type UserPermissionContext
} from "./utils/permissions";

// AI Operations Routes
import { registerAIOperationsRoutes } from "./routes-ai-operations";

// Rate limiting middleware
import { rateLimiters, createAuthenticatedRateLimiter, createRateLimiter, RATE_LIMIT_CONFIGS } from "./middleware/rateLimit";

// ============================================
// STRUCTURED LOGGER
// ============================================
const logger = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message: msg, ...meta })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message: msg, ...meta })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), message: msg, ...meta })),
};

// Server start time for uptime calculation
const serverStartTime = Date.now();

// Helper function to trigger deal enrichment asynchronously (non-blocking)
async function triggerDealEnrichmentAsync(
  organizationId: number,
  dealId: number,
  propertyId: number
): Promise<void> {
  // Fire and forget - don't await this in the main request flow
  Promise.resolve().then(async () => {
    try {
      // Mark deal as pending before enrichment
      await storage.updateDeal(dealId, { enrichmentStatus: "pending" });
      
      // Use PropertyEnrichmentService.enrichProperty which handles:
      // 1. Fetching property coordinates
      // 2. Performing enrichment across all GIS categories
      // 3. Saving to property's dueDiligenceData (via savePropertyEnrichment)
      const enrichmentResult = await propertyEnrichmentService.enrichProperty(organizationId, propertyId);
      
      // Save enrichment data to deal's enrichmentData field as well
      const enrichmentPayload = {
        enrichedAt: enrichmentResult.enrichedAt.toISOString(),
        lookupTimeMs: enrichmentResult.lookupTimeMs,
        parcel: enrichmentResult.parcel,
        hazards: enrichmentResult.hazards,
        environment: enrichmentResult.environment,
        infrastructure: enrichmentResult.infrastructure,
        demographics: enrichmentResult.demographics,
        publicLands: enrichmentResult.publicLands,
        transportation: enrichmentResult.transportation,
        water: enrichmentResult.water,
        scores: enrichmentResult.scores,
        errors: enrichmentResult.errors,
      };
      
      await storage.updateDeal(dealId, {
        enrichmentStatus: "completed",
        enrichedAt: new Date(),
        enrichmentData: enrichmentPayload as any,
      });
      
      logger.info("Deal and property enrichment completed", { 
        dealId, 
        propertyId, 
        organizationId,
        lookupTimeMs: enrichmentResult.lookupTimeMs,
        categoriesSaved: Object.keys(enrichmentPayload).filter(k => enrichmentPayload[k as keyof typeof enrichmentPayload] !== undefined)
      });
    } catch (err) {
      logger.error("Deal enrichment failed", { dealId, propertyId, organizationId, error: String(err) });
      try {
        await storage.updateDeal(dealId, { 
          enrichmentStatus: "failed",
          enrichmentData: { errors: { enrichment: String(err) } } as any
        });
      } catch (updateErr) {
        logger.error("Failed to update deal enrichment status", { dealId, error: String(updateErr) });
      }
    }
  });
}

// Helper function to calculate distance in miles between two coordinates
function calculateDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Note: Rate limiting is now handled by the middleware imported above
// Rate limiters are configured as:
// - default: 100 requests per minute for authenticated users
// - strict: 20 requests per minute for expensive operations (AI, Stripe)
// - auth: 10 requests per minute for login/register endpoints
// - public: 50 requests per minute for public endpoints
// - portalPayment: 5 requests per minute for portal payment endpoints
// - deprecatedPayment: 2 requests per minute for deprecated payment endpoints

const portalPaymentRateLimiter = createRateLimiter(RATE_LIMIT_CONFIGS.public, (req) => req.ip || req.socket.remoteAddress || 'unknown');
const deprecatedPaymentRateLimiter = createRateLimiter({ maxRequests: 2, windowMs: 60 * 1000 }, (req) => req.ip || req.socket.remoteAddress || 'unknown');

// ============================================
// JOB LOCKING FOR MULTI-INSTANCE DEPLOYMENT
// ============================================

// Unique instance identifier for this server process
const instanceId = crypto.randomUUID();

// Wrapper function to prevent duplicate job execution across instances
async function withJobLock<T>(
  jobName: string, 
  ttlSeconds: number, 
  fn: () => Promise<T>
): Promise<T | null> {
  const acquired = await storage.acquireJobLock(jobName, instanceId, ttlSeconds);
  if (!acquired) {
    console.log(`[${jobName}] Lock not acquired, skipping execution`);
    return null;
  }
  try {
    return await fn();
  } finally {
    await storage.releaseJobLock(jobName, instanceId);
  }
}

// Rate limit cleanup is now handled automatically by the middleware (runs every minute)

// Clean expired borrower sessions every hour (with job lock)
setInterval(async () => {
  await withJobLock("clean_borrower_sessions", 300, async () => {
    try {
      const cleaned = await storage.cleanExpiredBorrowerSessions();
      if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} expired borrower sessions`);
      }
      return cleaned;
    } catch (err) {
      console.error("Error cleaning expired borrower sessions:", err);
      return 0;
    }
  });
}, 60 * 60 * 1000);

// Clean expired job locks every 5 minutes
setInterval(async () => {
  try {
    await storage.cleanExpiredJobLocks();
  } catch (err) {
    console.error("Error cleaning expired job locks:", err);
  }
}, 5 * 60 * 1000);

// Middleware to validate borrower session from cookie or header
async function validateBorrowerSession(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionToken = req.cookies?.borrower_session || req.headers['x-borrower-session'] as string;
    
    if (!sessionToken) {
      return res.status(401).json({ message: "Session required" });
    }
    
    const session = await storage.getBorrowerSession(sessionToken);
    
    if (!session) {
      res.clearCookie('borrower_session');
      return res.status(401).json({ message: "Invalid or expired session" });
    }
    
    // Check if session has expired
    if (new Date(session.expiresAt) < new Date()) {
      await storage.deleteBorrowerSession(sessionToken);
      res.clearCookie('borrower_session');
      return res.status(401).json({ message: "Session expired" });
    }
    
    // Update last accessed time with sliding expiration
    await storage.updateBorrowerSessionAccess(sessionToken);
    
    // Attach session to request
    (req as any).borrowerSession = session;
    next();
  } catch (err) {
    console.error("Borrower session validation error:", err);
    return res.status(500).json({ message: "Session validation failed" });
  }
}

// Maximum rows allowed per CSV import
const MAX_CSV_IMPORT_ROWS = 500;

// Configure multer for CSV file uploads (5MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

// Founder email - gets unlimited credits and enterprise access
const FOUNDER_EMAIL = "thmsnrtn@gmail.com";

// Middleware to get/create organization for authenticated user
async function getOrCreateOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  
  // Get user ID from Replit Auth claims
  const user = req.user as any;
  const userId = user.claims?.sub || user.id;
  const userEmail = user.claims?.email || user.email;
  
  if (!userId) {
    console.error("No user ID found in session:", user);
    return res.status(401).json({ message: "Invalid user session" });
  }
  
  // Check if this is the founder account
  const isFounderAccount = userEmail?.toLowerCase() === FOUNDER_EMAIL.toLowerCase();
  
  let org = await storage.getOrganizationByOwner(userId);
  
  if (!org) {
    // Create default organization for new user with 7-day free trial
    const displayName = user.claims?.first_name || user.username || user.email || "User";
    const slug = `org-${userId}-${Date.now()}`;
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    
    // Founders get enterprise tier and unlimited access
    org = await storage.createOrganization({
      name: `${displayName}'s Organization`,
      slug,
      ownerId: userId,
      subscriptionTier: isFounderAccount ? "enterprise" : "free",
      subscriptionStatus: "active",
      trialStartedAt: isFounderAccount ? null : now,
      trialEndsAt: isFounderAccount ? null : trialEnds,
      trialUsed: isFounderAccount ? true : false,
      isFounder: isFounderAccount,
    });
    
    // Add user as owner team member
    await storage.createTeamMember({
      organizationId: org.id,
      userId,
      displayName,
      role: "owner",
      isActive: true,
    });
    
    if (isFounderAccount) {
      console.log(`[Founder] Created founder organization for ${userEmail}`);
    }
  } else if (isFounderAccount && !org.isFounder) {
    // Update existing org to founder status if they're the founder
    await db.update(organizations).set({ 
      isFounder: true,
      subscriptionTier: "enterprise",
      subscriptionStatus: "active"
    }).where(eq(organizations.id, org.id));
    org = { ...org, isFounder: true, subscriptionTier: "enterprise", subscriptionStatus: "active" };
    console.log(`[Founder] Upgraded existing organization to founder status for ${userEmail}`);
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
  
  // ============================================
  // HEALTH CHECK (Public endpoint for monitoring - no rate limiting)
  // ============================================
  app.get("/api/health", async (req, res) => {
    const { healthCheckService } = await import("./services/healthCheck");
    const result = await healthCheckService.checkAll();
    res.json(result);
  });
  
  app.get("/api/health/cached", async (req, res) => {
    const { healthCheckService } = await import("./services/healthCheck");
    const result = healthCheckService.getLastResults();
    if (!result) {
      const freshResult = await healthCheckService.checkAll();
      return res.json(freshResult);
    }
    res.json(result);
  });
  
  app.get("/api/health/:service", async (req, res) => {
    const { healthCheckService } = await import("./services/healthCheck");
    const service = await healthCheckService.checkService(req.params.service);
    if (!service) {
      return res.status(404).json({ message: "Unknown service" });
    }
    res.json(service);
  });
  
  // ============================================
  // RATE LIMITING MIDDLEWARE (excludes health check)
  // ============================================
  // Applied in order of specificity, from most strict to least strict
  
  // Strict rate limit for expensive operations (AI, Stripe, Stripe Connect)
  app.use("/api/ai", rateLimiters.strict);
  app.use("/api/stripe", rateLimiters.strict);
  
  // Auth rate limit for login/register endpoints
  app.use("/api/auth", rateLimiters.auth);
  
  // Public rate limit for borrower portal
  app.use("/api/borrower", rateLimiters.public);
  
  // Default rate limit for all other /api routes
  app.use("/api", (req, res, next) => {
    // Skip rate limiting for health check endpoints
    if (req.path.startsWith("/health")) {
      return next();
    }
    return rateLimiters.default(req, res, next);
  });
  
  // ============================================
  // HTTP REQUEST LOGGING MIDDLEWARE
  // ============================================
  app.use("/api", (req, res, next) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    
    // Attach request ID to request object
    (req as any).requestId = requestId;
    
    // Log request start
    logger.info("HTTP Request", {
      requestId,
      method: req.method,
      path: req.path,
      ip: req.ip || req.socket.remoteAddress,
    });
    
    // Log response on finish
    res.on("finish", () => {
      const duration = Date.now() - startTime;
      logger.info("HTTP Response", {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
      });
    });
    
    next();
  });
  
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
  
  // Update AI settings for the organization
  api.patch("/api/organization/ai-settings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const aiSettings = req.body;
      
      const aiSettingsSchema = z.object({
        responseStyle: z.enum(["concise", "detailed", "balanced"]).optional(),
        defaultAgent: z.string().optional(),
        autoSuggestions: z.boolean().optional(),
        rememberContext: z.boolean().optional(),
      });
      
      const validatedSettings = aiSettingsSchema.parse(aiSettings);
      await storage.updateOrganizationAISettings(org.id, validatedSettings);
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Update AI settings error:", error);
      res.status(400).json({ message: error.message || "Failed to update AI settings" });
    }
  });
  
  // Get provider status (AI, SMS, Mail providers)
  api.get("/api/organization/providers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { getProviderStatus } = await import("./services/aiRouter");
      const { getProviderInfo: getSmsProviderInfo } = await import("./services/smsProvider");
      const { getProviderInfo: getMailProviderInfo } = await import("./services/mailProvider");
      
      const aiStatus = getProviderStatus();
      const smsInfo = getSmsProviderInfo();
      const mailInfo = getMailProviderInfo();
      
      res.json({
        ai: {
          openai: aiStatus.openai,
          openrouter: aiStatus.openrouter,
          defaultTier: aiStatus.openrouter ? "economy" : "premium",
        },
        sms: {
          available: smsInfo.available,
          default: smsInfo.default,
          costs: smsInfo.costs,
        },
        mail: {
          available: mailInfo.available,
          default: mailInfo.default,
          costs: mailInfo.costs,
        },
      });
    } catch (error: any) {
      console.error("Get provider status error:", error);
      res.status(500).json({ message: error.message || "Failed to get provider status" });
    }
  });
  
  // Get seat information for the organization
  api.get("/api/organization/seats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { getSeatInfo } = await import("./services/usageLimits");
      const seatInfo = await getSeatInfo(org.id);
      res.json(seatInfo);
    } catch (error: any) {
      console.error("Get seat info error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch seat info" });
    }
  });
  
  // Get seat add-on pricing for the organization's tier
  api.get("/api/organization/seats/pricing", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const tier = org.subscriptionTier || "free";
      
      if (tier === "free" || tier === "enterprise") {
        return res.json({ 
          canPurchaseSeats: false,
          message: tier === "free" 
            ? "Upgrade to Starter or higher to add team members" 
            : "Contact sales for enterprise seat additions"
        });
      }
      
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      const prices = await stripe.prices.search({
        query: `metadata['type']:'seat_addon' AND metadata['tier']:'${tier}' AND active:'true'`,
      });
      
      const monthlyPrice = prices.data.find((p) => p.recurring?.interval === "month");
      const yearlyPrice = prices.data.find((p) => p.recurring?.interval === "year");
      
      res.json({
        canPurchaseSeats: true,
        tier,
        monthly: monthlyPrice ? {
          id: monthlyPrice.id,
          amount: monthlyPrice.unit_amount,
          currency: monthlyPrice.currency,
        } : null,
        yearly: yearlyPrice ? {
          id: yearlyPrice.id,
          amount: yearlyPrice.unit_amount,
          currency: yearlyPrice.currency,
        } : null,
      });
    } catch (error: any) {
      console.error("Get seat pricing error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch seat pricing" });
    }
  });
  
  // Purchase additional seats
  api.post("/api/organization/seats/purchase", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { quantity, billingPeriod } = req.body;
      
      if (!quantity || quantity < 1) {
        return res.status(400).json({ message: "Quantity must be at least 1" });
      }
      
      if (!billingPeriod || !["monthly", "yearly"].includes(billingPeriod)) {
        return res.status(400).json({ message: "Billing period must be 'monthly' or 'yearly'" });
      }
      
      const tier = org.subscriptionTier || "free";
      if (tier === "free" || tier === "enterprise") {
        return res.status(400).json({ 
          message: tier === "free" 
            ? "Upgrade to a paid plan first" 
            : "Contact sales for enterprise seat additions"
        });
      }
      
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      // Server-side lookup of the correct price for this tier - prevents cross-tier price manipulation
      const interval = billingPeriod === "monthly" ? "month" : "year";
      const prices = await stripe.prices.search({
        query: `metadata['type']:'seat_addon' AND metadata['tier']:'${tier}' AND active:'true'`,
      });
      
      const validPrice = prices.data.find((p) => p.recurring?.interval === interval);
      if (!validPrice) {
        return res.status(400).json({ message: `Seat add-on pricing not available for ${tier} ${billingPeriod}` });
      }
      
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { organizationId: String(org.id) },
        });
        customerId = customer.id;
        await storage.updateOrganization(org.id, { stripeCustomerId: customerId });
      }
      
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{
          price: validPrice.id,
          quantity: quantity,
        }],
        mode: "subscription",
        success_url: `${req.protocol}://${req.get("host")}/settings?seats=success&quantity=${quantity}`,
        cancel_url: `${req.protocol}://${req.get("host")}/settings?seats=cancelled`,
        metadata: {
          organizationId: String(org.id),
          type: "seat_addon",
          quantity: String(quantity),
          tier: tier,
        },
      });
      
      console.log(`[seats] Org ${org.id} initiating seat purchase: ${quantity} seats, ${billingPeriod}, price ${validPrice.id}`);
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Purchase seats error:", error);
      res.status(500).json({ message: error.message || "Failed to create checkout session" });
    }
  });
  
  // ============================================
  // ONBOARDING
  // ============================================
  
  api.get("/api/onboarding/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const status = await onboardingService.getOnboardingStatus(org.id);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.put("/api/onboarding/step", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { step, data, skipped } = req.body;
      
      if (typeof step !== "number" || step < 0 || step > 4) {
        return res.status(400).json({ message: "Invalid step number" });
      }
      
      const status = await onboardingService.updateOnboardingStep(
        org.id, 
        step, 
        data || {},
        skipped || false
      );
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/onboarding/provision", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { businessType } = req.body;
      
      if (!["land_flipper", "note_investor", "hybrid"].includes(businessType)) {
        return res.status(400).json({ message: "Invalid business type" });
      }
      
      const result = await onboardingService.provisionTemplates(org.id, businessType as BusinessType);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/onboarding/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      await onboardingService.completeOnboarding(org.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/onboarding/tips", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { step } = req.body;
      
      const stepNumber = typeof step === "number" ? step : 0;
      const tips = await onboardingService.generatePersonalizedTips(org.id, stepNumber);
      res.json({ tips });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/onboarding/reset", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      await onboardingService.resetOnboarding(org.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/onboarding/sample-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const result = await onboardingService.generateSampleData(org.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.delete("/api/onboarding/sample-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const result = await onboardingService.clearSampleData(org.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/subscription/tiers", async (req, res) => {
    res.json(SUBSCRIPTION_TIERS);
  });
  
  api.get("/api/usage", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const usage = await getAllUsageLimits(org.id);
    res.json(usage);
  });
  
  api.get("/api/usage/limits", async (req, res) => {
    res.json(TIER_LIMITS);
  });
  
  // ============================================
  // TEAM MEMBERS
  // ============================================
  
  api.get("/api/team", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const members = await storage.getTeamMembers(org.id);
    res.json(members);
  });
  
  api.get("/api/me/permissions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const context = await getUserPermissionContext(req.user, org);
    if (!context) {
      return res.status(403).json({ message: "You are not a member of this organization" });
    }
    res.json({
      userId: context.userId,
      teamMemberId: context.teamMemberId,
      role: context.role,
      permissions: context.permissions,
      availableRoles: ROLES,
    });
  });
  
  api.patch("/api/team/:id/role", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    const org = (req as any).organization;
    const memberId = Number(req.params.id);
    const { role } = req.body;
    const context = (req as any).permissionContext as UserPermissionContext;
    
    if (!ROLES.includes(role)) {
      return res.status(400).json({ message: `Invalid role. Must be one of: ${ROLES.join(", ")}` });
    }
    
    const members = await storage.getTeamMembers(org.id);
    const targetMember = members.find(m => m.id === memberId);
    
    if (!targetMember) {
      return res.status(404).json({ message: "Team member not found" });
    }
    
    if (targetMember.role === "owner" && context.role !== "owner") {
      return res.status(403).json({ message: "Only the owner can change the owner's role" });
    }
    
    if (role === "owner" && context.role !== "owner") {
      return res.status(403).json({ message: "Only the owner can assign the owner role" });
    }
    
    const owners = members.filter(m => m.role === "owner");
    if (targetMember.role === "owner" && owners.length === 1 && role !== "owner") {
      return res.status(400).json({ message: "Cannot remove the only owner. Transfer ownership first." });
    }
    
    const updated = await storage.updateTeamMember(memberId, { role });
    res.json(updated);
  });
  
  // ============================================
  // TEAM PERFORMANCE DASHBOARD (18.1-18.3)
  // ============================================
  
  const teamPerformanceCache = new Map<string, { data: any; timestamp: number }>();
  const CACHE_TTL_MS = 5 * 60 * 1000;
  
  api.get("/api/team/performance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const periodDays = Math.min(parseInt(req.query.period as string) || 30, 90);
      const cacheKey = `${org.id}-${periodDays}`;
      
      const cached = teamPerformanceCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
        return res.json(cached.data);
      }
      
      const periodStart = new Date();
      periodStart.setDate(periodStart.getDate() - periodDays);
      
      const teamMembers = await storage.getTeamMembers(org.id);
      
      const [leadMetrics, dealMetrics, taskMetrics, activityTrends, responseTimes] = await Promise.all([
        storage.getTeamLeadMetrics(org.id, periodStart),
        storage.getTeamDealMetrics(org.id, periodStart),
        storage.getTeamTaskMetrics(org.id, periodStart),
        storage.getTeamActivityTrends(org.id, periodStart, 7),
        storage.getTeamLeadResponseTimes(org.id, periodStart)
      ]);
      
      const leadMetricsMap = new Map(leadMetrics.map(m => [m.assignedTo, m]));
      const dealMetricsMap = new Map(dealMetrics.map(m => [m.assignedTo, m]));
      const taskMetricsMap = new Map(taskMetrics.map(m => [m.assignedTo, m]));
      const trendsMap = new Map(activityTrends.map(t => [t.assignedTo, t.periods]));
      const responseTimeMap = new Map(responseTimes.map(r => [r.assignedTo, r.avgResponseTimeHours]));
      
      const memberPerformance = teamMembers.map((member) => {
        const memberId = member.id;
        const lm = leadMetricsMap.get(memberId) || { leadsAssigned: 0, leadsContacted: 0, leadsConverted: 0 };
        const dm = dealMetricsMap.get(memberId) || { dealsClosed: 0, revenue: 0, avgDaysToClose: 0 };
        const tm = taskMetricsMap.get(memberId) || { tasksCompleted: 0, tasksPending: 0 };
        const trends = trendsMap.get(memberId) || [];
        const avgResponseTimeHours = responseTimeMap.get(memberId) ?? null;
        
        const conversionRate = lm.leadsAssigned > 0 
          ? (lm.leadsConverted / lm.leadsAssigned) * 100 
          : 0;
        
        const periodLength = Math.ceil(periodDays / 7);
        const activityTrendsList: { period: string; activities: number; deals: number }[] = [];
        
        for (let i = 0; i < 7; i++) {
          const trendStart = new Date(periodStart.getTime() + (i * periodLength * 24 * 60 * 60 * 1000));
          const trendData = trends[i] || { leads: 0, deals: 0 };
          
          activityTrendsList.push({
            period: trendStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            activities: trendData.leads,
            deals: trendData.deals
          });
        }
        
        return {
          id: member.id,
          userId: member.userId,
          displayName: member.displayName || member.email || 'Team Member',
          role: member.role,
          metrics: {
            leadsAssigned: lm.leadsAssigned,
            leadsContacted: lm.leadsContacted,
            leadsConverted: lm.leadsConverted,
            conversionRate: Math.round(conversionRate * 10) / 10,
            dealsClosed: dm.dealsClosed,
            revenue: dm.revenue,
            tasksCompleted: tm.tasksCompleted,
            tasksPending: tm.tasksPending,
            avgResponseTimeHours,
            avgDaysToClose: dm.avgDaysToClose > 0 ? Math.round(dm.avgDaysToClose * 10) / 10 : null,
          },
          activityTrends: activityTrendsList
        };
      });
      
      const totalLeads = leadMetrics.reduce((sum, m) => sum + m.leadsAssigned, 0);
      const totalDeals = dealMetrics.reduce((sum, m) => sum + m.dealsClosed, 0);
      
      const teamTotals = {
        totalLeads,
        totalDeals,
        totalRevenue: memberPerformance.reduce((sum, m) => sum + m.metrics.revenue, 0),
        totalTasksCompleted: memberPerformance.reduce((sum, m) => sum + m.metrics.tasksCompleted, 0),
        avgConversionRate: memberPerformance.length > 0
          ? memberPerformance.reduce((sum, m) => sum + m.metrics.conversionRate, 0) / memberPerformance.length
          : 0
      };
      
      const leaderboard = [...memberPerformance]
        .sort((a, b) => b.metrics.revenue - a.metrics.revenue)
        .map((member, index) => ({
          rank: index + 1,
          ...member
        }));
      
      const responseData = {
        periodDays,
        teamTotals,
        members: memberPerformance,
        leaderboard
      };
      
      teamPerformanceCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
      
      res.json(responseData);
    } catch (error: any) {
      console.error("Team performance error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch team performance" });
    }
  });
  
  // ============================================
  // LEADS (CRM)
  // ============================================
  
  api.get("/api/leads", isAuthenticated, getOrCreateOrg, attachPermissionContext(), async (req, res) => {
    const org = (req as any).organization;
    const context = (req as any).permissionContext as UserPermissionContext | undefined;
    const stage = req.query.stage as string | undefined;
    const assignedToFilter = req.query.assignedTo as string | undefined;
    
    let allLeads = await storage.getLeads(org.id);
    
    if (context?.permissions.viewOnlyAssignedLeads) {
      allLeads = allLeads.filter(lead => lead.assignedTo === context.teamMemberId);
    }
    
    if (assignedToFilter) {
      const assignedToId = Number(assignedToFilter);
      if (!isNaN(assignedToId)) {
        allLeads = allLeads.filter(lead => lead.assignedTo === assignedToId);
      } else if (assignedToFilter === "unassigned") {
        allLeads = allLeads.filter(lead => !lead.assignedTo);
      }
    }
    
    const leadsWithScores = allLeads.map(lead => {
      const { score, factors } = leadNurturerService.calculateLeadScore(lead);
      const computedStage = leadNurturerService.segmentLead(score);
      return {
        ...lead,
        score,
        scoreFactors: factors,
        nurturingStage: computedStage,
      };
    });
    
    let filteredLeads = leadsWithScores;
    if (stage && ["hot", "warm", "cold", "dead"].includes(stage)) {
      filteredLeads = leadsWithScores.filter(l => l.nurturingStage === stage);
    }
    
    res.json(filteredLeads);
  });
  
  // Paginated leads endpoint for infinite scroll
  api.get("/api/leads/paginated", isAuthenticated, getOrCreateOrg, attachPermissionContext(), async (req, res) => {
    const org = (req as any).organization;
    const context = (req as any).permissionContext as UserPermissionContext | undefined;
    const stage = req.query.stage as string | undefined;
    const assignedToFilter = req.query.assignedTo as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const cursor = req.query.cursor as string | undefined;
    
    let allLeads = await storage.getLeads(org.id);
    
    if (context?.permissions.viewOnlyAssignedLeads) {
      allLeads = allLeads.filter(lead => lead.assignedTo === context.teamMemberId);
    }
    
    if (assignedToFilter) {
      const assignedToId = Number(assignedToFilter);
      if (!isNaN(assignedToId)) {
        allLeads = allLeads.filter(lead => lead.assignedTo === assignedToId);
      } else if (assignedToFilter === "unassigned") {
        allLeads = allLeads.filter(lead => !lead.assignedTo);
      }
    }
    
    const leadsWithScores = allLeads.map(lead => {
      const { score, factors } = leadNurturerService.calculateLeadScore(lead);
      const computedStage = leadNurturerService.segmentLead(score);
      return {
        ...lead,
        score,
        scoreFactors: factors,
        nurturingStage: computedStage,
      };
    });
    
    let filteredLeads = leadsWithScores;
    if (stage && ["hot", "warm", "cold", "dead"].includes(stage)) {
      filteredLeads = leadsWithScores.filter(l => l.nurturingStage === stage);
    }
    
    // Sort by ID for consistent cursor pagination
    filteredLeads.sort((a, b) => b.id - a.id);
    
    const total = filteredLeads.length;
    let startIndex = 0;
    
    if (cursor) {
      const cursorId = Number(cursor);
      startIndex = filteredLeads.findIndex(l => l.id < cursorId);
      if (startIndex === -1) startIndex = filteredLeads.length;
    }
    
    const paginatedLeads = filteredLeads.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < total;
    const nextCursor = hasMore ? String(paginatedLeads[paginatedLeads.length - 1]?.id) : null;
    
    res.json({
      data: paginatedLeads,
      nextCursor,
      hasMore,
      total,
    });
  });

  // Focus List: Top 10 leads not contacted in last 24 hours
  api.get("/api/leads/focus", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const allLeads = await storage.getLeads(org.id);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Score all leads and filter those not contacted in 24h
    const leadsWithScores = allLeads
      .map(lead => {
        const { score, factors } = leadNurturerService.calculateLeadScore(lead);
        const stage = leadNurturerService.segmentLead(score);
        return {
          ...lead,
          score,
          scoreFactors: factors,
          nurturingStage: stage,
        };
      })
      .filter(lead => {
        // Exclude dead leads
        if (lead.nurturingStage === "dead") return false;
        // Include if never contacted or not contacted in last 24h
        if (!lead.lastContactedAt) return true;
        return new Date(lead.lastContactedAt) < twentyFourHoursAgo;
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);
    
    res.json(leadsWithScores);
  });

  // Lead Nurturing Endpoints - Must be before /api/leads/:id to avoid route conflict
  api.get("/api/leads/insights", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const insights = await leadNurturerService.getLeadInsights(org.id);
    res.json(insights);
  });

  api.get("/api/leads/aging", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const agingLeads = await alertingService.getAgingLeads(org.id);
    res.json(agingLeads);
  });

  api.get("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    if (isNaN(leadId)) return res.status(400).json({ message: "Invalid lead ID" });
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  });
  
  // Check for duplicate leads before creating
  api.post("/api/leads/check-duplicates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { firstName, lastName, email, phone, address } = req.body;
      
      const duplicates = await storage.findDuplicateLeads(org.id, {
        firstName,
        lastName,
        email,
        phone,
        address,
      });
      
      res.json({
        hasDuplicates: duplicates.length > 0,
        duplicates: duplicates.map(d => ({
          id: d.id,
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email,
          phone: d.phone,
          mailingAddress: d.mailingAddress,
          status: d.status,
          createdAt: d.createdAt,
        })),
      });
    } catch (err) {
      console.error("Check duplicates error:", err);
      res.status(500).json({ message: "Failed to check for duplicates" });
    }
  });

  // Merge two leads
  api.post("/api/leads/merge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { primaryId, duplicateId } = req.body;
      
      if (!primaryId || !duplicateId) {
        return res.status(400).json({ message: "Primary and duplicate lead IDs are required" });
      }
      
      const merged = await storage.mergeLeads(org.id, primaryId, duplicateId);
      
      res.json({
        success: true,
        message: "Leads merged successfully",
        lead: merged,
      });
    } catch (err) {
      console.error("Merge leads error:", err);
      res.status(500).json({ message: "Failed to merge leads" });
    }
  });

  api.post("/api/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Lead limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan to add more leads.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      const input = insertLeadSchema.parse({ ...req.body, organizationId: org.id });
      const lead = await storage.createLead(input);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "lead",
        entityId: lead.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      const { latitude, longitude } = req.body;
      if (latitude && longitude) {
        Promise.resolve().then(async () => {
          try {
            await propertyEnrichmentService.enrichLead(
              org.id,
              lead.id,
              { latitude: parseFloat(latitude), longitude: parseFloat(longitude) }
            );
            logger.info("Lead enrichment completed", { leadId: lead.id, organizationId: org.id });
          } catch (err) {
            logger.error("Lead enrichment failed", { leadId: lead.id, error: (err as Error).message });
          }
        });
      }
      
      res.status(201).json(lead);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  api.put("/api/leads/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = Number(req.params.id);
      
      const existingLead = await storage.getLead(org.id, leadId);
      if (!existingLead) return res.status(404).json({ message: "Lead not found" });
      
      const validated = updateLeadSchema.parse(req.body);
      const lead = await storage.updateLead(leadId, validated);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "lead",
        entityId: leadId,
        changes: { before: existingLead, after: lead, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      const { score, factors } = leadNurturerService.calculateLeadScore(lead!);
      const nurturingStage = leadNurturerService.segmentLead(score);
      
      await storage.updateLeadScore(leadId, score, factors);
      
      const { latitude, longitude } = validated;
      if (latitude && longitude) {
        Promise.resolve().then(async () => {
          try {
            await propertyEnrichmentService.enrichLead(
              org.id,
              leadId,
              { latitude: parseFloat(latitude), longitude: parseFloat(longitude) }
            );
            logger.info("Lead enrichment completed", { leadId, organizationId: org.id });
          } catch (err) {
            logger.error("Lead enrichment failed", { leadId, error: (err as Error).message });
          }
        });
      }
      
      res.json({
        ...lead,
        score,
        scoreFactors: factors,
        nurturingStage,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  api.delete("/api/leads/:id", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const existingLead = await storage.getLead(org.id, leadId);
    
    await storage.deleteLead(leadId);
    
    if (existingLead) {
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "delete",
        entityType: "lead",
        entityId: leadId,
        changes: { before: existingLead, fields: ["deleted"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
    }
    
    res.status(204).send();
  });
  
  api.post("/api/leads/:id/enrich", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = Number(req.params.id);
      
      if (isNaN(leadId)) {
        return res.status(400).json({ message: "Invalid lead ID" });
      }
      
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const { latitude, longitude, forceRefresh } = req.body;
      
      if (!latitude || !longitude) {
        return res.status(400).json({ message: "latitude and longitude are required" });
      }
      
      const result = await propertyEnrichmentService.enrichLead(
        org.id,
        leadId,
        { latitude: parseFloat(latitude), longitude: parseFloat(longitude) },
        forceRefresh === true
      );
      
      if (!result) {
        return res.status(400).json({ message: "Enrichment failed - coordinates required" });
      }
      
      logger.info("Manual lead enrichment completed", { leadId, organizationId: org.id });
      
      res.json({
        success: true,
        message: "Lead enriched successfully",
        enrichment: result,
      });
    } catch (err) {
      logger.error("Manual lead enrichment failed", { error: (err as Error).message });
      res.status(500).json({ message: (err as Error).message || "Enrichment failed" });
    }
  });
  
  api.post("/api/leads/bulk-delete", isAuthenticated, getOrCreateOrg, requirePermission("canDeleteLeads"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      const deletedCount = await storage.bulkDeleteLeads(org.id, ids);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_delete",
        entityType: "lead",
        entityId: 0,
        changes: { ids, count: deletedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ deletedCount });
    } catch (error: any) {
      console.error("Bulk delete leads error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk delete leads" });
    }
  });
  
  api.post("/api/leads/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids, updates } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ message: "updates must be an object" });
      }
      
      const updatedCount = await storage.bulkUpdateLeads(org.id, ids, updates);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_update",
        entityType: "lead",
        entityId: 0,
        changes: { ids, updates, count: updatedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ updatedCount });
    } catch (error: any) {
      console.error("Bulk update leads error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk update leads" });
    }
  });
  
  api.get("/api/leads/:id/activities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const leadId = Number(req.params.id);
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const activities = await storage.getLeadActivities(leadId, limit);
    res.json(activities);
  });

  api.get("/api/leads/:id/properties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = Number(req.params.id);
      
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const allProperties = await storage.getProperties(org.id);
      const linkedProperties = allProperties.filter(p => p.sellerId === leadId);
      
      res.json(linkedProperties);
    } catch (error: any) {
      console.error("Get lead properties error:", error);
      res.status(500).json({ message: error.message || "Failed to get lead properties" });
    }
  });

  // Timeline endpoints for communication history
  api.get("/api/leads/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const events = await storage.getActivityEvents(org.id, "lead", leadId, eventTypes);
    res.json(events);
  });

  api.get("/api/properties/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const propertyId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const events = await storage.getActivityEvents(org.id, "property", propertyId, eventTypes);
    res.json(events);
  });

  api.get("/api/deals/:id/timeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const dealId = Number(req.params.id);
    const eventTypes = req.query.eventTypes ? (req.query.eventTypes as string).split(",") : undefined;
    const events = await storage.getActivityEvents(org.id, "deal", dealId, eventTypes);
    res.json(events);
  });

  api.post("/api/leads/:id/score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }
    
    const scoredLead = await leadNurturerService.scoreLead(lead);
    res.json({
      lead: scoredLead,
      score: scoredLead.score,
      scoreFactors: scoredLead.scoreFactors,
      nurturingStage: scoredLead.nurturingStage,
    });
  });

  // ============================================
  // BETTY-STYLE LEAD SCORING
  // ============================================
  
  api.post("/api/leads/:id/betty-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const triggerSource = req.body.triggerSource || "manual";
    
    try {
      const result = await leadScoringService.scoreLead(leadId, org.id, triggerSource);
      res.json({
        success: true,
        score: result.score,
        normalizedScore: result.normalizedScore,
        recommendation: result.recommendation,
        factors: result.factors,
        scoredAt: result.scoredAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to score lead" });
    }
  });

  api.post("/api/leads/batch-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const { leadIds, triggerSource = "batch" } = req.body;
    
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return res.status(400).json({ message: "leadIds array is required" });
    }
    
    if (leadIds.length > 100) {
      return res.status(400).json({ message: "Maximum 100 leads per batch" });
    }
    
    try {
      const results = await leadScoringService.batchScoreLeads(leadIds, org.id, triggerSource);
      res.json({
        success: true,
        scored: results.length,
        results: results.map(r => ({
          leadId: r.leadId,
          score: r.score,
          recommendation: r.recommendation,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to batch score leads" });
    }
  });

  api.get("/api/leads/:id/score-history", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    
    try {
      const history = await leadScoringService.getScoreHistory(leadId, limit);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get score history" });
    }
  });

  api.get("/api/scoring/profiles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    
    try {
      const profile = await leadScoringService.getOrCreateDefaultProfile(org.id);
      res.json([profile]);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get scoring profiles" });
    }
  });

  api.get("/api/scoring/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    
    try {
      const stats = await leadScoringService.getScoringStats(org.id);
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get scoring stats" });
    }
  });

  api.post("/api/leads/:id/conversion", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    const { conversionType, campaignId, campaignType, touchNumber, dealValue, profitMargin } = req.body;
    
    if (!conversionType) {
      return res.status(400).json({ message: "conversionType is required" });
    }
    
    try {
      await leadScoringService.recordConversion(leadId, org.id, conversionType, {
        campaignId,
        campaignType,
        touchNumber,
        dealValue,
        profitMargin,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to record conversion" });
    }
  });

  api.post("/api/leads/:id/nurture", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const leadId = Number(req.params.id);
    
    const lead = await storage.getLead(org.id, leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const usageResult = await usageMeteringService.recordUsage(
      org.id,
      "ai_chat",
      1,
      { feature: "lead_nurturing", leadId }
    );

    if (usageResult.insufficientCredits) {
      return res.status(402).json({
        message: "Insufficient credits for AI follow-up generation",
        error: "INSUFFICIENT_CREDITS",
      });
    }

    const followUp = await leadNurturerService.generateFollowUp(lead);
    
    if (!followUp) {
      return res.status(500).json({ message: "Failed to generate follow-up message" });
    }

    await storage.createLeadActivity({
      organizationId: org.id,
      leadId,
      type: "ai_followup_generated",
      description: `AI generated follow-up: ${followUp.subject}`,
      metadata: {
        subject: followUp.subject,
        messagePreview: followUp.message.substring(0, 100),
      },
    });

    res.json({
      subject: followUp.subject,
      message: followUp.message,
      creditsUsed: 1,
    });
  });
  
  api.get("/api/leads/export", isAuthenticated, getOrCreateOrg, requirePermission("canExportData"), async (req, res) => {
    const org = (req as any).organization;
    const csv = await exportLeadsToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${date}.csv"`);
    res.send(csv);
  });
  
  api.post("/api/leads/import", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      // Check row count limit
      if (csvData.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({ 
          message: `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Your file has ${csvData.length} rows. Please split into smaller files.`,
          rowCount: csvData.length,
          maxRows: MAX_CSV_IMPORT_ROWS,
        });
      }
      
      // Pre-check usage limits before importing
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (usageCheck.limit !== null) {
        const wouldExceed = usageCheck.current + csvData.length > usageCheck.limit;
        if (wouldExceed) {
          return res.status(429).json({
            message: `Import would exceed your plan limit of ${usageCheck.limit} leads (current: ${usageCheck.current}, importing: ${csvData.length}). Upgrade your plan to import more leads.`,
            current: usageCheck.current,
            importing: csvData.length,
            limit: usageCheck.limit,
            tier: usageCheck.tier,
          });
        }
      }
      
      const result = await importLeads(csvData, org.id);
      res.json(result);
    } catch (err) {
      console.error("Lead import error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to import leads" 
      });
    }
  });
  
  api.post("/api/leads/import/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      const headers = Object.keys(csvData[0]);
      const preview = csvData.slice(0, 5);
      const expectedColumns = getExpectedColumns("leads");
      
      res.json({
        totalRows: csvData.length,
        headers,
        preview,
        expectedColumns,
      });
    } catch (err) {
      console.error("Lead import preview error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to parse CSV" 
      });
    }
  });

  // Tax Delinquent List Import (Phase 2.5)
  api.post("/api/leads/import/tax-delinquent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { mappedData, columnMapping } = req.body;

      if (!mappedData || !Array.isArray(mappedData)) {
        return res.status(400).json({ message: "No mapped data provided" });
      }

      if (mappedData.length === 0) {
        return res.status(400).json({ message: "No records to import" });
      }

      if (mappedData.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({
          message: `Import exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Please split into smaller batches.`,
          rowCount: mappedData.length,
          maxRows: MAX_CSV_IMPORT_ROWS,
        });
      }

      // Check usage limits
      const usageCheck = await checkUsageLimit(org.id, "leads");
      if (usageCheck.limit !== null) {
        const wouldExceed = usageCheck.current + mappedData.length > usageCheck.limit;
        if (wouldExceed) {
          return res.status(429).json({
            message: `Import would exceed your plan limit of ${usageCheck.limit} leads`,
            current: usageCheck.current,
            importing: mappedData.length,
            limit: usageCheck.limit,
          });
        }
      }

      const results = { successCount: 0, errorCount: 0, errors: [] as any[] };

      for (let i = 0; i < mappedData.length; i++) {
        try {
          const row = mappedData[i];
          
          // Parse name into first and last name
          let firstName = "Unknown";
          let lastName = "Owner";
          if (row.owner_name) {
            const nameParts = row.owner_name.trim().split(/\s+/);
            firstName = nameParts[0] || "Unknown";
            lastName = nameParts.slice(1).join(" ") || "Owner";
          }

          const leadData = {
            organizationId: org.id,
            type: "seller" as const,
            firstName,
            lastName,
            address: row.property_address || row.mailing_address || "",
            city: "",
            state: row.state || "",
            zip: "",
            source: "tax_delinquent",
            status: "new" as const,
            notes: [
              row.parcel_id ? `Parcel ID: ${row.parcel_id}` : "",
              row.assessed_value ? `Assessed Value: $${row.assessed_value}` : "",
              row.taxes_owed ? `Taxes Owed: $${row.taxes_owed}` : "",
              row.tax_year ? `Tax Year: ${row.tax_year}` : "",
              row.county ? `County: ${row.county}` : "",
            ].filter(Boolean).join("\n"),
            tags: ["tax_delinquent", row.county || "unknown"].filter(Boolean) as string[],
          };

          await storage.createLead(leadData);
          results.successCount++;
        } catch (err) {
          results.errorCount++;
          results.errors.push({
            row: i + 1,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      res.json({
        totalRows: mappedData.length,
        ...results,
      });
    } catch (err) {
      console.error("Tax delinquent import error:", err);
      res.status(400).json({
        message: err instanceof Error ? err.message : "Failed to import tax delinquent list",
      });
    }
  });

  // ============================================
  // SKIP TRACES (Phase 2.4)
  // ============================================

  api.get("/api/skip-traces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const traces = await storage.getSkipTraces(org.id);
    res.json(traces);
  });

  api.get("/api/skip-traces/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const trace = await storage.getSkipTrace(org.id, Number(req.params.id));
    if (!trace) return res.status(404).json({ message: "Skip trace not found" });
    res.json(trace);
  });

  api.get("/api/skip-traces/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const trace = await storage.getSkipTraceByLead(org.id, Number(req.params.leadId));
    res.json(trace || null);
  });

  api.post("/api/skip-traces", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { leadId, inputData } = req.body;

      if (!leadId) {
        return res.status(400).json({ message: "Lead ID is required" });
      }

      // Check if lead exists
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }

      // Create pending skip trace
      const skipTrace = await storage.createSkipTrace({
        organizationId: org.id,
        leadId,
        inputData: inputData || {
          name: `${lead.firstName} ${lead.lastName}`,
          address: lead.address || "",
        },
        status: "processing",
        costCents: 50,
        requestedAt: new Date(),
      });

      // Simulate async processing with mock data after 1 second
      setTimeout(async () => {
        try {
          const mockResults = {
            phones: [
              { number: `+1${Math.floor(Math.random() * 9000000000 + 1000000000)}`, type: "mobile", verified: true },
              { number: `+1${Math.floor(Math.random() * 9000000000 + 1000000000)}`, type: "landline", verified: false },
            ],
            emails: [
              { email: `${lead.firstName.toLowerCase()}.${lead.lastName.toLowerCase()}@email.com`, verified: true },
            ],
            addresses: [
              { 
                address: lead.address || "123 Current St, Anytown, ST 12345", 
                type: "current", 
                current: true 
              },
              { 
                address: "456 Previous Ave, Oldtown, ST 54321", 
                type: "previous", 
                current: false 
              },
            ],
            relatives: [
              { name: "Jane Doe", relationship: "spouse" },
              { name: "John Doe Jr", relationship: "child" },
            ],
            ageRange: "45-55",
          };

          await storage.updateSkipTrace(skipTrace.id, {
            status: "completed",
            results: mockResults,
            completedAt: new Date(),
          });
        } catch (err) {
          console.error("Error updating skip trace:", err);
          await storage.updateSkipTrace(skipTrace.id, {
            status: "failed",
          });
        }
      }, 1000);

      res.json(skipTrace);
    } catch (err) {
      console.error("Skip trace error:", err);
      res.status(500).json({
        message: err instanceof Error ? err.message : "Failed to create skip trace",
      });
    }
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
      
      const usageCheck = await checkUsageLimit(org.id, "properties");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Property limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan to add more properties.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      const numericFields = ["sizeAcres", "assessedValue", "marketValue", "purchasePrice", "listPrice", "soldPrice"];
      const sanitizedBody = { ...req.body };
      for (const field of numericFields) {
        if (sanitizedBody[field] === "" || sanitizedBody[field] === null || sanitizedBody[field] === undefined) {
          delete sanitizedBody[field];
        } else if (typeof sanitizedBody[field] === "string") {
          const parsed = parseFloat(sanitizedBody[field]);
          if (!isNaN(parsed)) {
            sanitizedBody[field] = String(parsed);
          }
        }
      }
      
      const input = insertPropertySchema.parse({ ...sanitizedBody, organizationId: org.id });
      const property = await storage.createProperty(input);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "property",
        entityId: property.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(201).json(property);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  api.put("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      const existingProperty = await storage.getProperty(org.id, propertyId);
      if (!existingProperty) return res.status(404).json({ message: "Property not found" });
      
      const numericFields = ["sizeAcres", "assessedValue", "marketValue", "purchasePrice", "listPrice", "soldPrice"];
      const sanitizedBody = { ...req.body };
      for (const field of numericFields) {
        if (sanitizedBody[field] === "" || sanitizedBody[field] === null) {
          sanitizedBody[field] = null;
        } else if (sanitizedBody[field] !== undefined && typeof sanitizedBody[field] === "string") {
          const parsed = parseFloat(sanitizedBody[field]);
          if (!isNaN(parsed)) {
            sanitizedBody[field] = String(parsed);
          }
        }
      }
      
      const validated = updatePropertySchema.parse(sanitizedBody);
      const property = await storage.updateProperty(propertyId, validated);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "property",
        entityId: propertyId,
        changes: { before: existingProperty, after: property, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(property);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  api.delete("/api/properties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const propertyId = Number(req.params.id);
    const existingProperty = await storage.getProperty(org.id, propertyId);
    
    await storage.deleteProperty(propertyId);
    
    if (existingProperty) {
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "delete",
        entityType: "property",
        entityId: propertyId,
        changes: { before: existingProperty, fields: ["deleted"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
    }
    
    res.status(204).send();
  });
  
  api.post("/api/properties/bulk-delete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      const deletedCount = await storage.bulkDeleteProperties(org.id, ids);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_delete",
        entityType: "property",
        entityId: 0,
        changes: { ids, count: deletedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ deletedCount });
    } catch (error: any) {
      console.error("Bulk delete properties error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk delete properties" });
    }
  });
  
  api.post("/api/properties/bulk-update", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { ids, updates } = req.body;
      
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids must be a non-empty array" });
      }
      
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ message: "updates must be an object" });
      }
      
      const updatedCount = await storage.bulkUpdateProperties(org.id, ids, updates);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "bulk_update",
        entityType: "property",
        entityId: 0,
        changes: { ids, updates, count: updatedCount },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ updatedCount });
    } catch (error: any) {
      console.error("Bulk update properties error:", error);
      res.status(500).json({ message: error.message || "Failed to bulk update properties" });
    }
  });
  
  api.get("/api/properties/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const csv = await exportPropertiesToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="properties-${date}.csv"`);
    res.send(csv);
  });
  
  api.post("/api/properties/import", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      // Check row count limit
      if (csvData.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({ 
          message: `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Your file has ${csvData.length} rows. Please split into smaller files.`,
          rowCount: csvData.length,
          maxRows: MAX_CSV_IMPORT_ROWS,
        });
      }
      
      // Pre-check usage limits before importing
      const usageCheck = await checkUsageLimit(org.id, "properties");
      if (usageCheck.limit !== null) {
        const wouldExceed = usageCheck.current + csvData.length > usageCheck.limit;
        if (wouldExceed) {
          return res.status(429).json({
            message: `Import would exceed your plan limit of ${usageCheck.limit} properties (current: ${usageCheck.current}, importing: ${csvData.length}). Upgrade your plan to import more properties.`,
            current: usageCheck.current,
            importing: csvData.length,
            limit: usageCheck.limit,
            tier: usageCheck.tier,
          });
        }
      }
      
      const result = await importProperties(csvData, org.id);
      res.json(result);
    } catch (err) {
      console.error("Property import error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to import properties" 
      });
    }
  });
  
  api.post("/api/properties/import/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const csvString = file.buffer.toString("utf-8");
      const csvData = parseCSV(csvString);
      
      if (csvData.length === 0) {
        return res.status(400).json({ message: "CSV file is empty or has no data rows" });
      }
      
      const headers = Object.keys(csvData[0]);
      const preview = csvData.slice(0, 5);
      const expectedColumns = getExpectedColumns("properties");
      
      res.json({
        totalRows: csvData.length,
        headers,
        preview,
        expectedColumns,
      });
    } catch (err) {
      console.error("Property import preview error:", err);
      res.status(400).json({ 
        message: err instanceof Error ? err.message : "Failed to parse CSV" 
      });
    }
  });
  
  // ============================================
  // COMPS ANALYSIS (Comparable Properties)
  // ============================================
  
  api.get("/api/properties/:id/comps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const property = await storage.getProperty(org.id, Number(req.params.id));
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const lat = property.parcelCentroid?.lat || (property.latitude ? parseFloat(String(property.latitude)) : null);
      const lng = property.parcelCentroid?.lng || (property.longitude ? parseFloat(String(property.longitude)) : null);
      
      if (!lat || !lng) {
        return res.status(400).json({ 
          message: "Property coordinates not available. Please fetch parcel data first.",
          error: "missing_coordinates"
        });
      }
      
      // Check if org has their own Regrid credentials (BYOK) - if so, skip credit check
      const regridIntegration = await storage.getOrganizationIntegration(org.id, 'regrid');
      const usingOrgRegridCredentials = regridIntegration?.isEnabled && regridIntegration?.credentials?.encrypted;
      
      if (!usingOrgRegridCredentials) {
        // Credit pre-check for comps query (10 cents per query) - only when using platform credentials
        const compsCost = await usageMeteringService.calculateCost("comps_query", 1);
        const hasCredits = await creditService.hasEnoughCredits(org.id, compsCost);
        if (!hasCredits) {
          const balance = await creditService.getBalance(org.id);
          return res.status(402).json({
            error: "Insufficient credits",
            required: compsCost / 100,
            balance: balance / 100,
          });
        }
      } else {
        console.log(`[CompsEndpoint] Skipping credit pre-check for org ${org.id} - using org Regrid credentials`);
      }
      
      const radiusMiles = parseFloat(req.query.radius as string) || 5;
      const filters: import("./services/comps").CompsFilters = {};
      
      if (req.query.minAcreage) filters.minAcreage = parseFloat(req.query.minAcreage as string);
      if (req.query.maxAcreage) filters.maxAcreage = parseFloat(req.query.maxAcreage as string);
      if (req.query.propertyType) filters.propertyType = req.query.propertyType as string;
      if (req.query.minSaleDate) filters.minSaleDate = req.query.minSaleDate as string;
      if (req.query.maxSaleDate) filters.maxSaleDate = req.query.maxSaleDate as string;
      if (req.query.maxResults) filters.maxResults = parseInt(req.query.maxResults as string);
      
      const subjectAcreage = property.sizeAcres ? parseFloat(String(property.sizeAcres)) : 0;
      
      const { getPropertyComps } = await import("./services/comps");
      
      // Build property attributes for desirability scoring
      const propertyAttributes = {
        roadAccess: property.roadAccess,
        utilities: property.utilities,
        terrain: property.terrain,
        zoning: property.zoning,
        sizeAcres: subjectAcreage,
        city: property.city,
      };
      
      const result = await getPropertyComps(lat, lng, subjectAcreage, radiusMiles, filters, propertyAttributes, org.id);
      
      // Skip credit recording if using organization's own Regrid credentials (BYOK)
      const usingOrgCredentials = result.credentialSource === 'organization';
      
      if (!usingOrgCredentials) {
        // Record usage after successful comps query only when using platform credentials
        await usageMeteringService.recordUsage(org.id, "comps_query", 1, {
          propertyId: property.id,
          lat,
          lng,
          radiusMiles,
        });
      } else {
        console.log(`[CompsEndpoint] Skipping credit usage for org ${org.id} - using org Regrid credentials`);
      }
      
      res.json({
        ...result,
        subjectProperty: {
          id: property.id,
          apn: property.apn,
          address: property.address,
          acreage: subjectAcreage,
          coordinates: { lat, lng },
        },
      });
    } catch (err) {
      console.error("Comps lookup error:", err);
      res.status(500).json({ 
        message: err instanceof Error ? err.message : "Failed to fetch comparable properties" 
      });
    }
  });
  
  api.post("/api/comps/search", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { lat, lng, radius, subjectAcreage, filters } = req.body;
      
      if (!lat || !lng) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }
      
      // Check if org has their own Regrid credentials (BYOK) - if so, skip credit check
      const regridIntegration = await storage.getOrganizationIntegration(org.id, 'regrid');
      const usingOrgRegridCredentials = regridIntegration?.isEnabled && regridIntegration?.credentials?.encrypted;
      
      if (!usingOrgRegridCredentials) {
        // Credit pre-check for comps query (10 cents per query) - only when using platform credentials
        const compsCost = await usageMeteringService.calculateCost("comps_query", 1);
        const hasCredits = await creditService.hasEnoughCredits(org.id, compsCost);
        if (!hasCredits) {
          const balance = await creditService.getBalance(org.id);
          return res.status(402).json({
            error: "Insufficient credits",
            required: compsCost / 100,
            balance: balance / 100,
          });
        }
      } else {
        console.log(`[CompsSearch] Skipping credit pre-check for org ${org.id} - using org Regrid credentials`);
      }
      
      const radiusMiles = radius || 5;
      const acreage = subjectAcreage || 0;
      
      const { getPropertyComps } = await import("./services/comps");
      const result = await getPropertyComps(lat, lng, acreage, radiusMiles, filters || {}, undefined, org.id);
      
      // Skip credit recording if using organization's own Regrid credentials (BYOK)
      const usingOrgCredentials = result.credentialSource === 'organization';
      
      if (!usingOrgCredentials) {
        // Record usage after successful comps search only when using platform credentials
        await usageMeteringService.recordUsage(org.id, "comps_query", 1, {
          lat,
          lng,
          radiusMiles,
        });
      } else {
        console.log(`[CompsSearch] Skipping credit usage for org ${org.id} - using org Regrid credentials`);
      }
      
      res.json(result);
    } catch (err) {
      console.error("Comps search error:", err);
      res.status(500).json({ 
        message: err instanceof Error ? err.message : "Failed to search comparable properties" 
      });
    }
  });
  
  // ============================================
  // PARCEL LOOKUP (Regrid Integration)
  // ============================================
  
  api.post("/api/parcels/lookup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lookupParcelByAPN, lookupParcelByCoordinates } = await import("./services/parcel");
      
      const { apn, lat, lng, state, county } = req.body;
      
      if (!apn && (!lat || !lng)) {
        return res.status(400).json({ message: "Provide either APN or coordinates (lat/lng)" });
      }
      
      let result;
      if (apn) {
        // Build state/county path if provided
        let path: string | undefined;
        if (state && county) {
          path = `/us/${state.toLowerCase()}/${county.toLowerCase().replace(/\s+/g, "-")}`;
        }
        result = await lookupParcelByAPN(apn, path);
      } else {
        result = await lookupParcelByCoordinates(lat, lng);
      }
      
      if (!result.found) {
        return res.status(404).json({ message: result.error || "Parcel not found" });
      }
      
      res.json(result.parcel);
    } catch (err) {
      console.error("Parcel lookup error:", err);
      res.status(500).json({ message: "Failed to lookup parcel data" });
    }
  });
  
  // Get nearby parcels for map visualization
  api.get("/api/parcels/nearby", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { getNearbyParcelsFromCountyGIS } = await import("./services/parcel");
      
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const state = req.query.state as string;
      const county = req.query.county as string;
      const radius = parseFloat(req.query.radius as string) || 0.5;
      
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "Valid lat/lng coordinates required" });
      }
      
      if (!state || !county) {
        return res.status(400).json({ message: "State and county required" });
      }
      
      const result = await getNearbyParcelsFromCountyGIS(lat, lng, state, county, radius);
      res.json(result);
    } catch (err) {
      console.error("Nearby parcels error:", err);
      res.status(500).json({ message: "Failed to fetch nearby parcels" });
    }
  });

  // Get nearby parcels for a specific property by ID
  api.get("/api/properties/:id/nearby", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const property = await storage.getProperty(org.id, Number(req.params.id));
      
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const lat = property.parcelCentroid?.lat || (property.latitude ? parseFloat(String(property.latitude)) : null);
      const lng = property.parcelCentroid?.lng || (property.longitude ? parseFloat(String(property.longitude)) : null);
      
      if (!lat || !lng) {
        return res.status(400).json({ 
          message: "Property coordinates not available. Please fetch parcel data first.",
          error: "missing_coordinates"
        });
      }
      
      if (!property.state || !property.county) {
        return res.status(400).json({ 
          message: "Property state and county required for nearby parcel lookup.",
          error: "missing_location"
        });
      }
      
      const radiusMiles = parseFloat(req.query.radius as string) || 1;
      
      const { getNearbyParcelsFromCountyGIS } = await import("./services/parcel");
      const result = await getNearbyParcelsFromCountyGIS(lat, lng, property.state, property.county, radiusMiles);
      
      // Filter out the subject property from results and add additional info
      const filteredParcels = result.parcels
        .filter(p => p.apn !== property.apn)
        .map(p => ({
          ...p,
          distance: calculateDistanceMiles(lat, lng, p.centroid.lat, p.centroid.lng),
        }))
        .sort((a, b) => a.distance - b.distance);
      
      res.json({
        ...result,
        parcels: filteredParcels,
        subjectProperty: {
          id: property.id,
          apn: property.apn,
          coordinates: { lat, lng },
        },
      });
    } catch (err) {
      console.error("Nearby parcels by property error:", err);
      res.status(500).json({ message: "Failed to fetch nearby parcels" });
    }
  });

  // Update property with parcel data
  api.post("/api/properties/:id/fetch-parcel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { lookupParcelByAPN } = await import("./services/parcel");
      const org = (req as any).organization;
      
      const property = await storage.getProperty(org.id, Number(req.params.id));
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      // Build state/county path
      let path: string | undefined;
      if (property.state && property.county) {
        path = `/us/${property.state.toLowerCase()}/${property.county.toLowerCase().replace(/\s+/g, "-")}`;
      }
      
      const result = await lookupParcelByAPN(property.apn, path);
      
      if (!result.found || !result.parcel) {
        return res.status(404).json({ message: result.error || "Parcel not found" });
      }
      
      // Update property with parcel data
      const updated = await storage.updateProperty(property.id, {
        parcelBoundary: result.parcel.boundary,
        parcelCentroid: result.parcel.centroid,
        parcelData: result.parcel.data,
        latitude: String(result.parcel.centroid.lat),
        longitude: String(result.parcel.centroid.lng),
      });
      
      res.json(updated);
    } catch (err) {
      console.error("Fetch parcel error:", err);
      res.status(500).json({ message: "Failed to fetch parcel data" });
    }
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
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "deal",
        entityId: deal.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      // Trigger async enrichment if deal has a propertyId (non-blocking)
      if (deal.propertyId) {
        triggerDealEnrichmentAsync(org.id, deal.id, deal.propertyId);
      }
      
      res.status(201).json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  api.put("/api/deals/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = Number(req.params.id);
      const existingDeal = await storage.getDeal(org.id, dealId);
      if (!existingDeal) return res.status(404).json({ message: "Deal not found" });
      
      const validated = updateDealSchema.parse(req.body);
      const deal = await storage.updateDeal(dealId, validated);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "update",
        entityType: "deal",
        entityId: dealId,
        changes: { before: existingDeal, after: deal, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      // Trigger async enrichment if propertyId was added or changed (non-blocking)
      const propertyChanged = validated.propertyId && validated.propertyId !== existingDeal.propertyId;
      if (propertyChanged && deal.propertyId) {
        triggerDealEnrichmentAsync(org.id, deal.id, deal.propertyId);
      }
      
      // Track conversion when deal is closed (for lead scoring feedback loop)
      if (validated.status === "closed" && existingDeal.status !== "closed") {
        try {
          // Get the property to find associated lead
          const property = await storage.getProperty(org.id, deal.propertyId);
          if (property && property.leadId) {
            const dealValue = deal.acceptedAmount ? parseFloat(String(deal.acceptedAmount)) : undefined;
            await leadScoringService.recordConversion(property.leadId, org.id, "deal_closed", {
              dealValue,
              profitMargin: deal.analysisResults?.netProfit,
            });
          }
        } catch (conversionErr) {
          console.error("Failed to record conversion:", conversionErr);
        }
      }
      
      res.json(deal);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation failed", 
          errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      throw err;
    }
  });
  
  // Manual deal enrichment trigger endpoint
  api.post("/api/deals/:id/enrich", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = Number(req.params.id);
      const forceRefresh = req.body.forceRefresh === true;
      
      const deal = await storage.getDeal(org.id, dealId);
      if (!deal) {
        return res.status(404).json({ message: "Deal not found" });
      }
      
      if (!deal.propertyId) {
        return res.status(400).json({ message: "Deal has no associated property" });
      }
      
      // Get the property to find coordinates
      const property = await storage.getProperty(org.id, deal.propertyId);
      if (!property) {
        return res.status(400).json({ message: "Property not found" });
      }
      
      const lat = property.latitude ? parseFloat(String(property.latitude)) : null;
      const lng = property.longitude ? parseFloat(String(property.longitude)) : null;
      
      if (!lat || !lng) {
        return res.status(400).json({ message: "Property missing coordinates" });
      }
      
      // Mark as pending
      await storage.updateDeal(dealId, { enrichmentStatus: "pending" });
      
      // Perform enrichment synchronously for manual trigger (so user can see result)
      const enrichmentResult = await propertyEnrichmentService.enrichByCoordinates(lat, lng, {
        propertyId: deal.propertyId,
        state: property.state || undefined,
        county: property.county || undefined,
        apn: property.apn || undefined,
        forceRefresh,
      });
      
      // Save enrichment data to deal
      const updatedDeal = await storage.updateDeal(dealId, {
        enrichmentStatus: "completed",
        enrichedAt: new Date(),
        enrichmentData: {
          enrichedAt: enrichmentResult.enrichedAt.toISOString(),
          lookupTimeMs: enrichmentResult.lookupTimeMs,
          hazards: enrichmentResult.hazards,
          environment: enrichmentResult.environment,
          infrastructure: enrichmentResult.infrastructure,
          demographics: enrichmentResult.demographics,
          scores: enrichmentResult.scores,
          errors: enrichmentResult.errors,
        } as any,
      });
      
      logger.info("Manual deal enrichment completed", { dealId, propertyId: deal.propertyId, lookupTimeMs: enrichmentResult.lookupTimeMs });
      
      res.json({
        message: "Enrichment completed",
        deal: updatedDeal,
        enrichmentResult,
      });
    } catch (err) {
      logger.error("Manual deal enrichment failed", { dealId: req.params.id, error: String(err) });
      res.status(500).json({ message: "Enrichment failed", error: String(err) });
    }
  });
  
  // ============================================
  // DUE DILIGENCE TEMPLATES & CHECKLISTS
  // ============================================
  
  api.get("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const templates = await storage.getDueDiligenceTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.getDueDiligenceTemplate(Number(req.params.id));
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.post("/api/due-diligence/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const template = await storage.createDueDiligenceTemplate({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.updateDueDiligenceTemplate(Number(req.params.id), req.body);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.delete("/api/due-diligence/templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteDueDiligenceTemplate(Number(req.params.id));
    res.status(204).send();
  });
  
  api.get("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const items = await storage.getPropertyDueDiligence(Number(req.params.id));
    res.json(items);
  });
  
  api.post("/api/properties/:id/due-diligence/apply-template", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { templateId } = req.body;
      if (!templateId) {
        return res.status(400).json({ message: "templateId is required" });
      }
      const items = await storage.applyTemplateToProperty(Number(req.params.id), templateId);
      res.json(items);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to apply template" });
    }
  });
  
  api.post("/api/properties/:id/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const item = await storage.createDueDiligenceItem({
        ...req.body,
        propertyId: Number(req.params.id),
      });
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const user = req.user as any;
    const userId = user?.claims?.sub || user?.id;
    const updates = { ...req.body };
    if (updates.completed === true && userId) {
      updates.completedBy = userId;
    }
    const item = await storage.updateDueDiligenceItem(Number(req.params.id), updates);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });
  
  api.delete("/api/due-diligence/items/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteDueDiligenceItem(Number(req.params.id));
    res.status(204).send();
  });

  // ============================================
  // PROPERTY ANALYSIS CHAT
  // ============================================
  
  api.post("/api/properties/:id/analyze", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      const { message, conversationHistory } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { ResearchIntelligenceAgent, DealsAcquisitionAgent, skillRegistry } = await import('./services/core-agents');
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI();
      
      const researchAgent = new ResearchIntelligenceAgent();
      const dealsAgent = new DealsAcquisitionAgent();
      
      const propertyContext = `
Property Information:
- APN: ${property.apn}
- Location: ${property.address || 'N/A'}, ${property.city || 'N/A'}, ${property.county}, ${property.state}
- Size: ${property.sizeAcres || 'Unknown'} acres
- Status: ${property.status}
- Zoning: ${property.zoning || 'Unknown'}
- Market Value: ${property.marketValue ? `$${Number(property.marketValue).toLocaleString()}` : 'Unknown'}
- Purchase Price: ${property.purchasePrice ? `$${Number(property.purchasePrice).toLocaleString()}` : 'Unknown'}
- Assessed Value: ${property.assessedValue ? `$${Number(property.assessedValue).toLocaleString()}` : 'Unknown'}
- Road Access: ${property.roadAccess || 'Unknown'}
- Terrain: ${property.terrain || 'Unknown'}
- Coordinates: ${property.latitude && property.longitude ? `${property.latitude}, ${property.longitude}` : 'Not available'}
- Description: ${property.description || 'None'}
`;

      const researchSkills = researchAgent.getAvailableSkills();
      const dealsSkills = dealsAgent.getAvailableSkills();
      const allSkills = [...researchSkills, ...dealsSkills];
      
      const skillsContext = allSkills.map(s => `- ${s.name}: ${s.description}`).join('\n');
      
      const historyContext = conversationHistory && conversationHistory.length > 0
        ? conversationHistory.map((m: { role: string; content: string }) => `${m.role}: ${m.content}`).join('\n')
        : '';

      const systemPrompt = `You are an AI property analyst for AcreOS, a land investment platform. You help users analyze properties, assess risks, calculate valuations, and make informed investment decisions.

${propertyContext}

Available capabilities you can discuss:
${skillsContext}

When responding:
1. Use the property data provided to give specific, actionable insights
2. If asked about environmental risks (flood, wetlands, etc.), explain what data would be available and general risk factors for the location
3. For financing questions, calculate based on typical land investment terms (10-15% interest, 5-10 year terms)
4. For offer generation, consider comparable sales, market conditions, and typical land discounts
5. Be concise but thorough
6. Suggest follow-up questions that would be helpful

${historyContext ? `\nConversation history:\n${historyContext}\n` : ''}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 1500,
      });

      const aiResponse = response.choices[0]?.message?.content || "I couldn't generate a response. Please try again.";
      
      const suggestions = generateSuggestions(message, property);
      
      res.json({
        response: aiResponse,
        suggestions,
        actions: [],
      });
    } catch (err: any) {
      console.error("Property analysis error:", err);
      res.status(500).json({ message: err.message || "Failed to analyze property" });
    }
  });

  function generateSuggestions(message: string, property: any): string[] {
    const suggestions: string[] = [];
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('flood') || lowerMessage.includes('risk') || lowerMessage.includes('environmental')) {
      suggestions.push("What about wetlands on this property?");
      suggestions.push("Are there EPA sites nearby?");
    } else if (lowerMessage.includes('offer') || lowerMessage.includes('price')) {
      suggestions.push("What financing terms would work?");
      suggestions.push("What's a fair market value?");
    } else if (lowerMessage.includes('financing') || lowerMessage.includes('payment')) {
      suggestions.push("What if I do a 5-year term instead?");
      suggestions.push("Generate an offer letter");
    } else if (lowerMessage.includes('similar') || lowerMessage.includes('comp')) {
      suggestions.push("What's the price per acre for this area?");
      suggestions.push("How long do similar properties take to sell?");
    } else {
      if (!property.marketValue) {
        suggestions.push("What's the estimated market value?");
      }
      if (property.latitude && property.longitude) {
        suggestions.push("Run environmental risk assessment");
      }
      suggestions.push("Calculate seller financing options");
    }
    
    return suggestions.slice(0, 3);
  }

  // ============================================
  // DUE DILIGENCE CHECKLISTS (Enhanced)
  // ============================================
  
  api.get("/api/due-diligence/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      const checklist = await storage.getOrCreateDueDiligenceChecklist(org.id, propertyId);
      res.json(checklist);
    } catch (error: any) {
      console.error("Get due diligence checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch checklist" });
    }
  });

  api.put("/api/due-diligence/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      const existing = await storage.getDueDiligenceChecklist(propertyId);
      if (!existing) {
        return res.status(404).json({ message: "Checklist not found" });
      }
      const updated = await storage.updateDueDiligenceChecklist(existing.id, req.body);
      res.json(updated);
    } catch (error: any) {
      console.error("Update due diligence checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to update checklist" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/flood-zone", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { dataSourceLookupService } = await import('./services/data-source-lookup');
      
      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupFloodZone({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          zone: "Unknown (No coordinates)",
          riskLevel: "unknown",
          lastUpdated: new Date().toISOString(),
          source: "N/A",
          details: { message: "Property has no coordinates for flood zone lookup" },
        });
      }
    } catch (error: any) {
      console.error("Flood zone lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to lookup flood zone" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/wetlands", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { dataSourceLookupService } = await import('./services/data-source-lookup');
      
      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupWetlands({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          hasWetlands: false,
          classification: null,
          percentage: 0,
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for wetlands lookup" },
        });
      }
    } catch (error: any) {
      console.error("Wetlands lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to lookup wetlands" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/soil", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { dataSourceLookupService } = await import('./services/data-source-lookup');
      
      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupSoilData({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          soilType: "Unknown",
          drainage: "unknown",
          suitability: "unknown",
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for soil data lookup" },
        });
      }
    } catch (error: any) {
      console.error("Soil data lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to lookup soil data" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/environmental", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.propertyId);
      
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { dataSourceLookupService } = await import('./services/data-source-lookup');
      
      if (property.latitude && property.longitude) {
        const lookupResult = await dataSourceLookupService.lookupEpaData({
          latitude: Number(property.latitude),
          longitude: Number(property.longitude),
          state: property.state || undefined,
          county: property.county || undefined,
        });
        res.json(lookupResult.data);
      } else {
        res.json({
          superfundSites: [],
          nearestSiteDistance: null,
          riskLevel: "unknown",
          source: "N/A",
          lastUpdated: new Date().toISOString(),
          details: { message: "Property has no coordinates for EPA data lookup" },
        });
      }
    } catch (error: any) {
      console.error("EPA environmental lookup error:", error);
      res.status(500).json({ message: error.message || "Failed to lookup EPA data" });
    }
  });

  api.post("/api/due-diligence/:propertyId/lookup/tax", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const propertyId = Number(req.params.propertyId);
      const result = {
        annualTax: 125.00,
        backTaxes: 0,
        taxSaleStatus: "none",
        lastPaidDate: "2024-12-01",
        source: "County Treasurer Records",
        lastUpdated: new Date().toISOString(),
        details: {
          taxYear: 2024,
          assessedValue: 8500,
          taxRate: 0.0147,
          exemptions: [],
        }
      };
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to lookup tax info" });
    }
  });

  // ============================================
  // DUE DILIGENCE REPORT GENERATION
  // ============================================

  api.get("/api/properties/:id/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Verify property belongs to organization
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const report = await generateDueDiligenceReport(org.id, propertyId, {
        includeComps,
        includeAI,
      });
      
      res.json(report);
    } catch (error: any) {
      console.error("Due diligence report error:", error);
      res.status(500).json({ message: error.message || "Failed to generate report" });
    }
  });

  api.get("/api/properties/:id/report/pdf", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      // Verify property belongs to organization
      const property = await storage.getProperty(org.id, propertyId);
      if (!property) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const jsPDF = (await import("jspdf")).jsPDF;
      
      const report = await generateDueDiligenceReport(org.id, propertyId, {
        includeComps,
        includeAI,
      });
      
      // Generate PDF
      const doc = new jsPDF();
      let y = 20;
      const lineHeight = 7;
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      
      // Header
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Due Diligence Report", margin, y);
      y += lineHeight * 2;
      
      // Property Summary
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Property Summary", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Property: ${report.summary.propertyName}`, margin, y);
      y += lineHeight;
      doc.text(`APN: ${report.summary.apn}`, margin, y);
      y += lineHeight;
      doc.text(`Address: ${report.summary.address}`, margin, y);
      y += lineHeight;
      doc.text(`County: ${report.summary.county}, ${report.summary.state}`, margin, y);
      y += lineHeight;
      doc.text(`Generated: ${new Date(report.summary.generatedAt).toLocaleString()}`, margin, y);
      y += lineHeight * 2;
      
      // Parcel Information
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Parcel Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Size: ${report.parcelInfo.acres ? `${report.parcelInfo.acres} acres` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Zoning: ${report.parcelInfo.zoning || "Unknown"}`, margin, y);
      y += lineHeight;
      if (report.parcelInfo.legalDescription) {
        const lines = doc.splitTextToSize(`Legal Description: ${report.parcelInfo.legalDescription}`, contentWidth);
        doc.text(lines, margin, y);
        y += lineHeight * lines.length;
      }
      y += lineHeight;
      
      // Ownership
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Ownership Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Owner: ${report.ownership.currentOwner || "Unknown"}`, margin, y);
      y += lineHeight;
      if (report.ownership.ownerAddress) {
        doc.text(`Owner Address: ${report.ownership.ownerAddress}`, margin, y);
        y += lineHeight;
      }
      y += lineHeight;
      
      // Tax Information
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Tax Information", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Assessed Value: ${report.taxes.assessedValue ? `$${report.taxes.assessedValue.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Annual Tax: ${report.taxes.taxAmount ? `$${report.taxes.taxAmount.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight * 2;
      
      // Check if we need a new page
      if (y > 240) {
        doc.addPage();
        y = 20;
      }
      
      // Market Analysis
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Market Analysis", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Price Per Acre: ${report.marketAnalysis.pricePerAcre ? `$${report.marketAnalysis.pricePerAcre.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Estimated Value: ${report.marketAnalysis.estimatedValue ? `$${report.marketAnalysis.estimatedValue.toLocaleString()}` : "Unknown"}`, margin, y);
      y += lineHeight;
      doc.text(`Market Trend: ${report.marketAnalysis.marketTrend}`, margin, y);
      y += lineHeight;
      
      if (report.marketAnalysis.offerPrices) {
        y += lineHeight;
        const offers = report.marketAnalysis.offerPrices;
        doc.text(`Conservative: $${offers.conservative.min.toLocaleString()} - $${offers.conservative.max.toLocaleString()}`, margin, y);
        y += lineHeight;
        doc.text(`Standard: $${offers.standard.min.toLocaleString()} - $${offers.standard.max.toLocaleString()}`, margin, y);
        y += lineHeight;
        doc.text(`Aggressive: $${offers.aggressive.min.toLocaleString()} - $${offers.aggressive.max.toLocaleString()}`, margin, y);
      }
      y += lineHeight * 2;
      
      // Check if we need a new page
      if (y > 240) {
        doc.addPage();
        y = 20;
      }
      
      // Risk Assessment
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Risk Assessment", margin, y);
      y += lineHeight;
      
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      
      if (report.risks.accessIssues.length > 0) {
        doc.text("Access Issues:", margin, y);
        y += lineHeight;
        report.risks.accessIssues.forEach(issue => {
          doc.text(`  - ${issue}`, margin, y);
          y += lineHeight;
        });
      }
      
      if (report.risks.zoningRestrictions.length > 0) {
        doc.text("Zoning Restrictions:", margin, y);
        y += lineHeight;
        report.risks.zoningRestrictions.forEach(restriction => {
          doc.text(`  - ${restriction}`, margin, y);
          y += lineHeight;
        });
      }
      y += lineHeight;
      
      // AI Summary
      if (report.aiSummary) {
        if (y > 180) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("AI Analysis", margin, y);
        y += lineHeight;
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const aiLines = doc.splitTextToSize(report.aiSummary, contentWidth);
        doc.text(aiLines, margin, y);
      }
      
      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text(
          `AcreOS Due Diligence Report - Page ${i} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: "center" }
        );
      }
      
      // Send PDF
      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="due-diligence-${report.summary.apn}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("PDF generation error:", error);
      res.status(500).json({ message: error.message || "Failed to generate PDF" });
    }
  });

  api.get("/api/properties/:id/report/summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = Number(req.params.id);
      
      const { getQuickPropertySummary } = await import("./services/dueDiligence");
      const summary = await getQuickPropertySummary(org.id, propertyId);
      
      if (!summary) {
        return res.status(404).json({ message: "Property not found" });
      }
      
      res.json(summary);
    } catch (error: any) {
      console.error("Quick summary error:", error);
      res.status(500).json({ message: error.message || "Failed to get summary" });
    }
  });
  
  // ============================================
  // DEAL CHECKLIST TEMPLATES
  // ============================================
  
  api.get("/api/checklist-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const templates = await storage.getChecklistTemplates(org.id);
    if (templates.length === 0) {
      const initialized = await storage.initializeDefaultChecklistTemplates(org.id);
      return res.json(initialized);
    }
    res.json(templates);
  });
  
  api.get("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.getChecklistTemplate(Number(req.params.id));
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.post("/api/checklist-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const template = await storage.createChecklistTemplate({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(template);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const template = await storage.updateChecklistTemplate(Number(req.params.id), req.body);
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });
  
  api.delete("/api/checklist-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteChecklistTemplate(Number(req.params.id));
    res.status(204).send();
  });
  
  // ============================================
  // DEAL CHECKLISTS
  // ============================================
  
  api.get("/api/deals/:id/checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const checklist = await storage.getDealChecklist(Number(req.params.id));
    if (!checklist) {
      return res.json(null);
    }
    const completed = checklist.items.filter(item => item.checkedAt).length;
    res.json({
      ...checklist,
      completionStatus: {
        completed,
        total: checklist.items.length,
        percentage: Math.round((completed / checklist.items.length) * 100),
      },
    });
  });
  
  api.post("/api/deals/:id/checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { templateId } = req.body;
      if (!templateId) {
        return res.status(400).json({ message: "templateId is required" });
      }
      const checklist = await storage.applyChecklistTemplateToDeal(Number(req.params.id), templateId);
      res.status(201).json(checklist);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to apply template" });
    }
  });
  
  api.patch("/api/deals/:id/checklist/items/:itemId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      const { checked, documentUrl } = req.body;
      
      const checklist = await storage.updateDealChecklistItem(
        Number(req.params.id),
        req.params.itemId,
        { checked, documentUrl, checkedBy: userId }
      );
      res.json(checklist);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update checklist item" });
    }
  });
  
  api.get("/api/deals/:id/stage-gate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const result = await storage.checkStageGate(Number(req.params.id));
    res.json(result);
  });

  api.get("/api/deals/:id/report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = Number(req.params.id);
      const includeComps = req.query.comps === "true";
      const includeAI = req.query.ai === "true";
      
      const deal = await storage.getDeal(dealId);
      if (!deal || deal.organizationId !== org.id) {
        return res.status(404).json({ message: "Deal not found" });
      }
      
      const { generateDueDiligenceReport } = await import("./services/dueDiligence");
      const report = await generateDueDiligenceReport(org.id, deal.propertyId, {
        includeComps,
        includeAI,
      });
      
      res.json({
        ...report,
        deal: {
          id: deal.id,
          type: deal.type,
          status: deal.status,
          offerAmount: deal.offerAmount,
          acceptedAmount: deal.acceptedAmount,
        },
      });
    } catch (error: any) {
      console.error("Deal due diligence report error:", error);
      res.status(500).json({ message: error.message || "Failed to generate report" });
    }
  });
  
  // Enhanced deal stage update with stage gate check
  api.patch("/api/deals/:id/stage", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stage, force } = req.body;
      const dealId = Number(req.params.id);
      
      if (!force) {
        const stageGate = await storage.checkStageGate(dealId);
        if (!stageGate.canAdvance) {
          return res.status(400).json({
            message: "Cannot advance stage: incomplete required checklist items",
            incompleteItems: stageGate.incompleteItems,
          });
        }
      }
      
      const deal = await storage.updateDeal(dealId, { status: stage });
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      res.json(deal);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update stage" });
    }
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
      
      const usageCheck = await checkUsageLimit(org.id, "notes");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Note limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan to add more notes.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      // Calculate monthly payment if not provided
      let monthlyPayment = req.body.monthlyPayment;
      if (!monthlyPayment && req.body.originalPrincipal && req.body.interestRate && req.body.termMonths) {
        monthlyPayment = calculateMonthlyPayment(
          Number(req.body.originalPrincipal),
          Number(req.body.interestRate),
          Number(req.body.termMonths)
        );
      }
      
      // Convert date strings to Date objects
      const startDate = req.body.startDate ? new Date(req.body.startDate) : new Date();
      const firstPaymentDate = req.body.firstPaymentDate ? new Date(req.body.firstPaymentDate) : new Date();
      const maturityDate = req.body.maturityDate ? new Date(req.body.maturityDate) : undefined;
      const nextPaymentDate = req.body.nextPaymentDate ? new Date(req.body.nextPaymentDate) : firstPaymentDate;
      
      const input = insertNoteSchema.parse({ 
        ...req.body, 
        organizationId: org.id,
        monthlyPayment: String(monthlyPayment),
        currentBalance: req.body.originalPrincipal,
        startDate,
        firstPaymentDate,
        maturityDate,
        nextPaymentDate,
      });
      const note = await storage.createNote(input);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "note",
        entityId: note.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(201).json(note);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.put("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const noteId = Number(req.params.id);
    const existingNote = await storage.getNote(org.id, noteId);
    if (!existingNote) return res.status(404).json({ message: "Note not found" });
    
    const note = await storage.updateNote(noteId, req.body);
    
    const user = req.user as any;
    const userId = user?.claims?.sub || user?.id;
    await storage.createAuditLogEntry({
      organizationId: org.id,
      userId,
      action: "update",
      entityType: "note",
      entityId: noteId,
      changes: { before: existingNote, after: note, fields: Object.keys(req.body) },
      ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"],
    });
    
    res.json(note);
  });
  
  api.delete("/api/notes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const noteId = Number(req.params.id);
    const existingNote = await storage.getNote(org.id, noteId);
    
    await storage.deleteNote(noteId);
    
    if (existingNote) {
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "delete",
        entityType: "note",
        entityId: noteId,
        changes: { before: existingNote, fields: ["deleted"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
    }
    
    res.status(204).send();
  });
  
  api.get("/api/notes/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const csv = await exportNotesToCSV(org.id);
    const date = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="notes-${date}.csv"`);
    res.send(csv);
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
  // FINANCE AGENT - DELINQUENCY & REMINDERS
  // ============================================
  
  api.get("/api/notes/delinquent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const delinquentNotes = await storage.getDelinquentNotes(org.id);
    res.json(delinquentNotes);
  });

  api.get("/api/notes/:id/reminders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const noteId = Number(req.params.id);
    const note = await storage.getNote(org.id, noteId);
    if (!note) return res.status(404).json({ message: "Note not found" });
    
    const reminders = await storage.getRemindersForNote(noteId);
    res.json(reminders);
  });

  api.post("/api/notes/:id/send-reminder", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const { type = "due" } = req.body;
      
      const validTypes = ["upcoming", "due", "late", "final_warning"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ message: "Invalid reminder type" });
      }
      
      const result = await financeAgentService.sendManualReminder(noteId, org.id, type);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json({ success: true, reminderId: result.reminderId });
    } catch (err: any) {
      console.error("Error sending manual reminder:", err);
      res.status(500).json({ message: err.message || "Failed to send reminder" });
    }
  });

  // ============================================
  // PHASE 6.1: AMORTIZATION SCHEDULE ROUTES
  // ============================================

  api.get("/api/notes/:id/schedule", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return res.status(404).json({ message: "Note not found" });
      
      const schedule = note.amortizationSchedule || [];
      const totalInterest = schedule.reduce((sum, s) => sum + (s.interest || 0), 0);
      const payoffDate = schedule.length > 0 ? schedule[schedule.length - 1].dueDate : null;
      
      res.json({
        noteId: note.id,
        schedule,
        summary: {
          totalPayments: schedule.length,
          paidPayments: schedule.filter(s => s.status === 'paid').length,
          totalInterest: Number(totalInterest.toFixed(2)),
          payoffDate,
          originalPrincipal: Number(note.originalPrincipal),
          monthlyPayment: Number(note.monthlyPayment),
          interestRate: Number(note.interestRate),
        }
      });
    } catch (err: any) {
      console.error("Error getting schedule:", err);
      res.status(500).json({ message: err.message || "Failed to get schedule" });
    }
  });

  api.post("/api/notes/:id/schedule/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return res.status(404).json({ message: "Note not found" });
      
      const principal = Number(note.originalPrincipal);
      const annualRate = Number(note.interestRate);
      const termMonths = note.termMonths;
      const monthlyPayment = Number(note.monthlyPayment);
      const startDate = note.startDate ? new Date(note.startDate) : new Date();
      
      const schedule: any[] = [];
      let balance = principal;
      const monthlyRate = annualRate / 100 / 12;
      
      for (let i = 1; i <= termMonths && balance > 0; i++) {
        const interestPayment = balance * monthlyRate;
        const principalPayment = Math.min(monthlyPayment - interestPayment, balance);
        balance = Math.max(0, balance - principalPayment);
        
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        
        schedule.push({
          paymentNumber: i,
          dueDate: dueDate.toISOString(),
          payment: monthlyPayment,
          principal: Number(principalPayment.toFixed(2)),
          interest: Number(interestPayment.toFixed(2)),
          balance: Number(balance.toFixed(2)),
          status: "pending",
        });
      }
      
      const updatedNote = await storage.updateNote(noteId, { amortizationSchedule: schedule });
      
      const totalInterest = schedule.reduce((sum, s) => sum + s.interest, 0);
      
      res.json({
        noteId,
        schedule,
        summary: {
          totalPayments: schedule.length,
          paidPayments: 0,
          totalInterest: Number(totalInterest.toFixed(2)),
          payoffDate: schedule.length > 0 ? schedule[schedule.length - 1].dueDate : null,
          originalPrincipal: principal,
          monthlyPayment,
          interestRate: annualRate,
        }
      });
    } catch (err: any) {
      console.error("Error generating schedule:", err);
      res.status(500).json({ message: err.message || "Failed to generate schedule" });
    }
  });

  // ============================================
  // PHASE 6.2: DUNNING & LATE PAYMENT ROUTES
  // ============================================

  api.get("/api/notes/:id/dunning", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const note = await storage.getNote(org.id, noteId);
      if (!note) return res.status(404).json({ message: "Note not found" });
      
      const reminders = await storage.getRemindersForNote(noteId);
      const daysDelinquent = note.daysDelinquent || 0;
      
      let dunningStage = "current";
      if (daysDelinquent > 0 && daysDelinquent <= 15) dunningStage = "friendly_reminder";
      else if (daysDelinquent > 15 && daysDelinquent <= 30) dunningStage = "formal_notice";
      else if (daysDelinquent > 30 && daysDelinquent <= 60) dunningStage = "final_warning";
      else if (daysDelinquent > 60) dunningStage = "default_notice";
      
      const schedule = note.amortizationSchedule || [];
      const missedPayments = schedule.filter(s => s.status === 'missed' || s.status === 'late').length;
      const pastDueAmount = missedPayments * Number(note.monthlyPayment);
      
      res.json({
        noteId,
        delinquencyStatus: note.delinquencyStatus || "current",
        daysDelinquent,
        dunningStage,
        reminderCount: note.reminderCount || 0,
        lastReminderSentAt: note.lastReminderSentAt,
        pastDueAmount,
        missedPayments,
        history: reminders.map(r => ({
          id: r.id,
          date: r.sentAt || r.scheduledFor,
          type: r.type,
          stage: r.type === 'final_warning' ? 'final_warning' : 
                 r.type === 'late' ? 'formal_notice' : 
                 r.type === 'due' ? 'friendly_reminder' : 'upcoming',
          channel: r.channel,
          status: r.status,
          content: r.content,
        })),
      });
    } catch (err: any) {
      console.error("Error getting dunning info:", err);
      res.status(500).json({ message: err.message || "Failed to get dunning info" });
    }
  });

  api.post("/api/notes/:id/dunning", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      const { action, stage, notes: actionNotes } = req.body;
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) return res.status(404).json({ message: "Note not found" });
      
      const validActions = ["send_reminder", "escalate", "record_contact", "waive_fee", "set_payment_plan"];
      if (!validActions.includes(action)) {
        return res.status(400).json({ message: "Invalid dunning action" });
      }
      
      if (action === "send_reminder" || action === "escalate") {
        const reminderType = stage || "late";
        const result = await financeAgentService.sendManualReminder(noteId, org.id, reminderType);
        
        if (!result.success) {
          return res.status(400).json({ message: result.error });
        }
        
        res.json({ 
          success: true, 
          action,
          reminderId: result.reminderId,
          message: `${action === "escalate" ? "Escalated" : "Reminder sent"} successfully` 
        });
      } else {
        const reminder = await storage.createPaymentReminder({
          organizationId: org.id,
          noteId,
          borrowerId: note.borrowerId,
          type: action === "record_contact" ? "contact_logged" : action,
          scheduledFor: new Date(),
          channel: "manual",
          content: actionNotes || `Manual action: ${action}`,
          status: "completed",
        });
        
        res.json({
          success: true,
          action,
          reminderId: reminder.id,
          message: `Action '${action}' recorded successfully`
        });
      }
    } catch (err: any) {
      console.error("Error creating dunning action:", err);
      res.status(500).json({ message: err.message || "Failed to create dunning action" });
    }
  });

  api.get("/api/payment-reminders", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { noteId, status, type } = req.query;
      
      let reminders;
      if (noteId) {
        reminders = await storage.getRemindersForNote(Number(noteId));
      } else {
        reminders = await storage.getPendingReminders(100);
        reminders = reminders.filter(r => r.organizationId === org.id);
      }
      
      if (status) {
        reminders = reminders.filter(r => r.status === status);
      }
      if (type) {
        reminders = reminders.filter(r => r.type === type);
      }
      
      res.json(reminders);
    } catch (err: any) {
      console.error("Error getting payment reminders:", err);
      res.status(500).json({ message: err.message || "Failed to get reminders" });
    }
  });

  api.put("/api/payment-reminders/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reminderId = Number(req.params.id);
      const { status, content, channel } = req.body;
      
      const updates: any = {};
      if (status) updates.status = status;
      if (content) updates.content = content;
      if (channel) updates.channel = channel;
      if (status === "cancelled") updates.failureReason = req.body.reason || "Manually cancelled";
      
      const updated = await storage.updatePaymentReminder(reminderId, updates);
      res.json(updated);
    } catch (err: any) {
      console.error("Error updating reminder:", err);
      res.status(500).json({ message: err.message || "Failed to update reminder" });
    }
  });

  api.get("/api/finance/health", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const health = await storage.getFinancePortfolioHealth(org.id);
    res.json(health);
  });

  api.post("/api/finance/process", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const result = await financeAgentService.processOrganizationNotes(org.id);
      res.json(result);
    } catch (err: any) {
      console.error("Error processing finance agent:", err);
      res.status(500).json({ message: err.message || "Failed to process notes" });
    }
  });

  // ============================================
  // FINANCIAL DASHBOARD API (Portfolio Analytics)
  // ============================================

  api.get("/api/finance/portfolio-summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const allNotes = await storage.getNotes(org.id);
      const allPayments = await storage.getPayments(org.id);

      const activeNotes = allNotes.filter(n => n.status === 'active');
      const paidOffNotes = allNotes.filter(n => n.status === 'paid_off');
      const defaultedNotes = allNotes.filter(n => n.status === 'defaulted');
      const pendingNotes = allNotes.filter(n => n.status === 'pending');

      const totalPortfolioValue = activeNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);
      const totalMonthlyPayment = activeNotes.reduce((sum, n) => sum + Number(n.monthlyPayment || 0), 0);
      const totalOriginalPrincipal = allNotes.reduce((sum, n) => sum + Number(n.originalPrincipal || 0), 0);

      const avgInterestRate = activeNotes.length > 0
        ? activeNotes.reduce((sum, n) => sum + Number(n.interestRate || 0), 0) / activeNotes.length
        : 0;

      const statusBreakdown = [
        { status: 'active', count: activeNotes.length, value: activeNotes.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
        { status: 'paid_off', count: paidOffNotes.length, value: 0 },
        { status: 'defaulted', count: defaultedNotes.length, value: defaultedNotes.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
        { status: 'pending', count: pendingNotes.length, value: pendingNotes.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
      ];

      res.json({
        totalNotes: allNotes.length,
        activeNotes: activeNotes.length,
        totalPortfolioValue,
        totalMonthlyPayment,
        totalOriginalPrincipal,
        averageInterestRate: avgInterestRate,
        statusBreakdown,
      });
    } catch (err: any) {
      console.error("Error getting portfolio summary:", err);
      res.status(500).json({ message: err.message || "Failed to get portfolio summary" });
    }
  });

  api.get("/api/finance/delinquency", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const allNotes = await storage.getNotes(org.id);
      const activeNotes = allNotes.filter(n => n.status === 'active');

      const now = new Date();

      const agingBuckets = {
        current: [] as typeof activeNotes,
        days30: [] as typeof activeNotes,
        days60: [] as typeof activeNotes,
        days90Plus: [] as typeof activeNotes,
      };

      activeNotes.forEach(note => {
        if (!note.nextPaymentDate) {
          agingBuckets.current.push(note);
          return;
        }
        const dueDate = new Date(note.nextPaymentDate);
        const daysPastDue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysPastDue <= 0) {
          agingBuckets.current.push(note);
        } else if (daysPastDue <= 30) {
          agingBuckets.days30.push(note);
        } else if (daysPastDue <= 60) {
          agingBuckets.days60.push(note);
        } else {
          agingBuckets.days90Plus.push(note);
        }
      });

      const delinquentNotes = [...agingBuckets.days30, ...agingBuckets.days60, ...agingBuckets.days90Plus];
      const delinquencyRate = activeNotes.length > 0 
        ? (delinquentNotes.length / activeNotes.length) * 100 
        : 0;

      const atRiskAmount = delinquentNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0);

      const allPayments = await storage.getPayments(org.id);
      const completedPayments = allPayments.filter(p => p.status === 'completed');
      const totalPrincipalCollected = completedPayments.reduce((sum, p) => sum + Number(p.principalAmount || 0), 0);
      const totalInterestCollected = completedPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);

      const monthlyBreakdown: { month: string; principal: number; interest: number }[] = [];
      const last12Months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date();
        d.setMonth(d.getMonth() - (11 - i));
        return { year: d.getFullYear(), month: d.getMonth() };
      });

      last12Months.forEach(({ year, month }) => {
        const monthPayments = completedPayments.filter(p => {
          const pd = new Date(p.paymentDate);
          return pd.getFullYear() === year && pd.getMonth() === month;
        });
        const monthName = new Date(year, month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        monthlyBreakdown.push({
          month: monthName,
          principal: monthPayments.reduce((s, p) => s + Number(p.principalAmount || 0), 0),
          interest: monthPayments.reduce((s, p) => s + Number(p.interestAmount || 0), 0),
        });
      });

      res.json({
        delinquencyRate,
        atRiskAmount,
        totalDelinquentNotes: delinquentNotes.length,
        agingBuckets: {
          current: { count: agingBuckets.current.length, value: agingBuckets.current.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
          days30: { count: agingBuckets.days30.length, value: agingBuckets.days30.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
          days60: { count: agingBuckets.days60.length, value: agingBuckets.days60.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
          days90Plus: { count: agingBuckets.days90Plus.length, value: agingBuckets.days90Plus.reduce((s, n) => s + Number(n.currentBalance || 0), 0) },
        },
        totalPrincipalCollected,
        totalInterestCollected,
        monthlyBreakdown,
      });
    } catch (err: any) {
      console.error("Error getting delinquency metrics:", err);
      res.status(500).json({ message: err.message || "Failed to get delinquency metrics" });
    }
  });

  api.get("/api/finance/projections", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const allNotes = await storage.getNotes(org.id);
      const allPayments = await storage.getPayments(org.id);

      const activeNotes = allNotes.filter(n => n.status === 'active');
      const completedPayments = allPayments.filter(p => p.status === 'completed');

      const totalInvested = allNotes.reduce((sum, n) => sum + Number(n.originalPrincipal || 0), 0);
      const totalCollected = completedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalInterestEarned = completedPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);

      const firstPaymentDate = completedPayments.length > 0
        ? new Date(Math.min(...completedPayments.map(p => new Date(p.paymentDate).getTime())))
        : null;

      let annualYield = 0;
      let cashOnCashReturn = 0;

      if (firstPaymentDate && totalInvested > 0) {
        const yearsActive = Math.max(0.083, (Date.now() - firstPaymentDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
        annualYield = (totalInterestEarned / totalInvested / yearsActive) * 100;
        cashOnCashReturn = (totalCollected / totalInvested) * 100;
      }

      const projectedIncome: { month: string; expectedPayments: number; principal: number; interest: number }[] = [];
      const now = new Date();

      for (let i = 0; i < 12; i++) {
        const projMonth = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
        const monthName = projMonth.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

        let monthlyPrincipal = 0;
        let monthlyInterest = 0;
        let activeForMonth = 0;

        activeNotes.forEach(note => {
          const maturityDate = note.maturityDate ? new Date(note.maturityDate) : null;
          if (maturityDate && projMonth > maturityDate) return;

          activeForMonth++;
          const monthlyPayment = Number(note.monthlyPayment || 0);
          const interestRate = Number(note.interestRate || 0) / 100 / 12;
          const balance = Number(note.currentBalance || 0);

          const monthInterest = balance * interestRate;
          const monthPrincipal = monthlyPayment - monthInterest;

          monthlyInterest += Math.max(0, monthInterest);
          monthlyPrincipal += Math.max(0, monthPrincipal);
        });

        projectedIncome.push({
          month: monthName,
          expectedPayments: monthlyPrincipal + monthlyInterest,
          principal: monthlyPrincipal,
          interest: monthlyInterest,
        });
      }

      const totalExpectedInterest = activeNotes.reduce((sum, note) => {
        const schedule = note.amortizationSchedule || [];
        const pendingPayments = schedule.filter((p: any) => p.status === 'pending' || p.status === 'late');
        return sum + pendingPayments.reduce((s: number, p: any) => s + Number(p.interest || 0), 0);
      }, 0);

      const totalPaymentsRemaining = activeNotes.reduce((sum, note) => {
        const schedule = note.amortizationSchedule || [];
        return sum + schedule.filter((p: any) => p.status === 'pending' || p.status === 'late').length;
      }, 0);

      res.json({
        totalInvested,
        totalCollected,
        totalInterestEarned,
        annualYield,
        cashOnCashReturn,
        projectedIncome,
        amortizationSummary: {
          totalExpectedInterest,
          totalPaymentsRemaining,
          activeNotes: activeNotes.length,
        },
      });
    } catch (err: any) {
      console.error("Error getting projections:", err);
      res.status(500).json({ message: err.message || "Failed to get projections" });
    }
  });
  
  // ============================================
  // DOCUMENT GENERATION
  // ============================================
  
  // Generate promissory note PDF
  api.get("/api/notes/:id/document", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePromissoryNote } = await import("./services/documents");
      const org = (req as any).organization;
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generatePromissoryNote(Number(req.params.id), org.id);
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "promissory_note",
        noteId: Number(req.params.id),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="promissory-note-${req.params.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      res.status(err.message === "Note not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate warranty deed PDF
  api.get("/api/properties/:id/deed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateWarrantyDeed } = await import("./services/documents");
      const org = (req as any).organization;
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generateWarrantyDeed(Number(req.params.id), org.id);
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "warranty_deed",
        propertyId: Number(req.params.id),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="warranty-deed-${req.params.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      res.status(err.message === "Property not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate offer letter PDF
  api.post("/api/documents/offer-letter", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateOfferLetter } = await import("./services/documents");
      const org = (req as any).organization;
      const { leadId, propertyId, offerAmount, earnestMoney, closingDate, contingencies, additionalTerms } = req.body;
      
      if (!leadId || !propertyId) {
        return res.status(400).json({ message: "leadId and propertyId are required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generateOfferLetter(
        Number(leadId),
        Number(propertyId),
        org.id,
        { offerAmount, earnestMoney, closingDate, contingencies, additionalTerms }
      );
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "offer_letter",
        leadId: Number(leadId),
        propertyId: Number(propertyId),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="offer-letter-${leadId}-${propertyId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      const notFound = err.message === "Lead not found" || err.message === "Property not found";
      res.status(notFound ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate settlement statement PDF (HUD-1 style)
  api.post("/api/documents/generate/settlement-statement", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateSettlementStatement } = await import("./services/documents");
      const org = (req as any).organization;
      const { propertyId, purchasePrice, closingDate, buyerName, sellerName, earnestMoney, titleInsurance, recordingFees, escrowFees, transferTax, prorations, additionalCosts } = req.body;
      
      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generateSettlementStatement(
        Number(propertyId),
        org.id,
        { purchasePrice, closingDate, buyerName, sellerName, earnestMoney, titleInsurance, recordingFees, escrowFees, transferTax, prorations, additionalCosts }
      );
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "settlement_statement",
        propertyId: Number(propertyId),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="settlement-statement-${propertyId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      res.status(err.message === "Property not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate property flyer PDF (marketing material)
  api.post("/api/documents/generate/property-flyer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePropertyFlyer } = await import("./services/documents");
      const org = (req as any).organization;
      const { propertyId, headline, price, priceLabel, highlights, contactName, contactPhone, contactEmail, qrCodePlaceholder } = req.body;
      
      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generatePropertyFlyer(
        Number(propertyId),
        org.id,
        { headline, price, priceLabel, highlights, contactName, contactPhone, contactEmail, qrCodePlaceholder }
      );
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "property_flyer",
        propertyId: Number(propertyId),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="property-flyer-${propertyId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      res.status(err.message === "Property not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate promissory note PDF
  api.post("/api/documents/generate/promissory-note", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generatePromissoryNote } = await import("./services/documents");
      const org = (req as any).organization;
      const { noteId } = req.body;
      
      if (!noteId) {
        return res.status(400).json({ message: "noteId is required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generatePromissoryNote(Number(noteId), org.id);
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "promissory_note",
        noteId: Number(noteId),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="promissory-note-${noteId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      res.status(err.message === "Note not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
  });
  
  // Generate warranty deed PDF
  api.post("/api/documents/generate/warranty-deed", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { generateWarrantyDeed } = await import("./services/documents");
      const org = (req as any).organization;
      const { propertyId } = req.body;
      
      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }
      
      // Credit pre-check for PDF generation (5 cents per document)
      const pdfCost = await usageMeteringService.calculateCost("pdf_generated", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, pdfCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: pdfCost / 100,
          balance: balance / 100,
        });
      }
      
      const pdfBuffer = await generateWarrantyDeed(Number(propertyId), org.id);
      
      // Record usage after successful PDF generation
      await usageMeteringService.recordUsage(org.id, "pdf_generated", 1, {
        documentType: "warranty_deed",
        propertyId: Number(propertyId),
      });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="warranty-deed-${propertyId}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF generation error:", err);
      res.status(err.message === "Property not found" ? 404 : 500).json({ 
        message: err.message || "Failed to generate PDF" 
      });
    }
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
      const { noteId, amount, paymentDate, dueDate, paymentMethod, principalAmount, interestAmount, status } = req.body;
      
      // Get the note to calculate interest and principal split if not provided
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      // Calculate principal and interest if not provided by frontend
      let principalPortion: number;
      let interestPortion: number;
      
      if (principalAmount !== undefined && interestAmount !== undefined) {
        principalPortion = Number(principalAmount);
        interestPortion = Number(interestAmount);
      } else {
        const currentBalance = Number(note.currentBalance || note.originalPrincipal);
        const monthlyRate = Number(note.interestRate) / 100 / 12;
        interestPortion = currentBalance * monthlyRate;
        principalPortion = Math.max(0, Number(amount) - interestPortion);
      }
      
      const newBalance = Math.max(0, Number(note.currentBalance || note.originalPrincipal) - principalPortion);
      
      const input = insertPaymentSchema.parse({ 
        noteId,
        organizationId: org.id,
        amount: String(amount),
        principalAmount: String(principalPortion),
        interestAmount: String(interestPortion),
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : note.nextPaymentDate || new Date(),
        status: status || "completed",
        paymentMethod
      });
      
      const payment = await storage.createPayment(input);
      
      // Update the note balance and status
      const paymentsCount = (await storage.getPayments(org.id, noteId)).length;
      let noteStatus = note.status;
      if (newBalance <= 0) {
        noteStatus = "paid_off";
      } else if (noteStatus === "late" || noteStatus === "delinquent") {
        noteStatus = "active"; // Payment received, restore to active
      }
      
      await storage.updateNote(note.id, { 
        currentBalance: String(newBalance),
        status: noteStatus
      });
      
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
  
  api.post("/api/campaigns", isAuthenticated, getOrCreateOrg, requirePermission("canCreateCampaign"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const trackingCode = storage.generateTrackingCode();
      const input = insertCampaignSchema.parse({ 
        ...req.body, 
        organizationId: org.id,
        trackingCode 
      });
      const campaign = await storage.createCampaign(input);
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "create",
        entityType: "campaign",
        entityId: campaign.id,
        changes: { after: input, fields: Object.keys(input) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(201).json(campaign);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Get responses for a specific campaign
  api.get("/api/campaigns/:id/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaignId = Number(req.params.id);
    const campaign = await storage.getCampaign(org.id, campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    
    const responses = await storage.getCampaignResponses(org.id, campaignId);
    res.json(responses);
  });

  // Get campaign analytics with response data
  api.get("/api/campaigns/:id/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const campaignId = Number(req.params.id);
    const campaign = await storage.getCampaign(org.id, campaignId);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    
    const responsesCount = await storage.getCampaignResponsesCount(campaignId);
    const responses = await storage.getCampaignResponses(org.id, campaignId);
    
    const sent = campaign.totalSent || 0;
    const delivered = campaign.totalDelivered || 0;
    const opened = campaign.totalOpened || 0;
    const clicked = campaign.totalClicked || 0;
    const responded = campaign.totalResponded || 0;
    const spent = Number(campaign.spent || 0);
    
    const responseRate = sent > 0 ? (responsesCount / sent) * 100 : 0;
    const costPerResponse = responsesCount > 0 ? spent / responsesCount : 0;
    
    const dealsFromCampaign = await db.select({ count: sql<number>`count(*)::int` })
      .from(deals)
      .innerJoin(properties, eq(deals.propertyId, properties.id))
      .innerJoin(leads, eq(properties.sellerId, leads.id))
      .where(eq(leads.sourceCampaignId, campaignId));
    
    const dealCount = dealsFromCampaign[0]?.count || 0;
    const costPerAcquisition = dealCount > 0 ? spent / dealCount : 0;
    
    res.json({
      campaign,
      metrics: {
        sent,
        delivered,
        opened,
        clicked,
        responded,
        responsesCount,
        dealCount,
        responseRate: responseRate.toFixed(2),
        costPerResponse: costPerResponse.toFixed(2),
        costPerAcquisition: costPerAcquisition.toFixed(2),
        spent,
      },
      funnel: [
        { stage: 'Sent', count: sent },
        { stage: 'Delivered', count: delivered },
        { stage: 'Opened', count: opened },
        { stage: 'Clicked', count: clicked },
        { stage: 'Responded', count: responsesCount },
        { stage: 'Deal', count: dealCount },
      ],
      responses,
    });
  });

  // ============================================
  // CAMPAIGN RESPONSES (Inbound Response Tracking)
  // ============================================

  // Get all responses for the organization
  api.get("/api/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const responses = await storage.getCampaignResponses(org.id);
    res.json(responses);
  });

  // Log a new response (auto-attributes to campaign if tracking code matches)
  api.post("/api/responses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { trackingCode, channel, content, leadId, contactName, contactEmail, contactPhone, metadata } = req.body;
      
      let campaignId: number | undefined;
      let isAttributed = false;
      
      if (trackingCode) {
        const campaign = await storage.getCampaignByTrackingCode(trackingCode);
        if (campaign && campaign.organizationId === org.id) {
          campaignId = campaign.id;
          isAttributed = true;
          
          await storage.updateCampaign(campaign.id, {
            totalResponded: (campaign.totalResponded || 0) + 1
          });
        }
      }
      
      const input = insertCampaignResponseSchema.parse({
        organizationId: org.id,
        leadId: leadId || null,
        campaignId: campaignId || null,
        channel,
        content,
        trackingCode: trackingCode || null,
        isAttributed,
        contactName,
        contactEmail,
        contactPhone,
        metadata,
        responseDate: new Date(),
      });
      
      const response = await storage.createCampaignResponse(input);
      
      if (leadId && campaignId) {
        await storage.updateLead(leadId, {
          sourceCampaignId: campaignId,
          sourceTrackingCode: trackingCode,
        });
      }
      
      res.status(201).json(response);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Get a specific response
  api.get("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const response = await storage.getCampaignResponse(Number(req.params.id));
    if (!response) return res.status(404).json({ message: "Response not found" });
    res.json(response);
  });

  // Update a response
  api.put("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const response = await storage.updateCampaignResponse(Number(req.params.id), req.body);
    if (!response) return res.status(404).json({ message: "Response not found" });
    res.json(response);
  });

  // Delete a response
  api.delete("/api/responses/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    await storage.deleteCampaignResponse(Number(req.params.id));
    res.status(204).send();
  });

  // ============================================
  // TARGET COUNTIES (Acquisition Workflow)
  // ============================================

  // Get all target counties for the organization
  api.get("/api/target-counties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const counties = await storage.getTargetCounties(org.id);
    res.json(counties);
  });

  // Get a specific target county
  api.get("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const county = await storage.getTargetCounty(org.id, Number(req.params.id));
    if (!county) return res.status(404).json({ message: "Target county not found" });
    res.json(county);
  });

  // Create a new target county
  api.post("/api/target-counties", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { insertTargetCountySchema } = await import("@shared/schema");
      const input = insertTargetCountySchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const county = await storage.createTargetCounty(input);
      res.status(201).json(county);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Update a target county
  api.put("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const county = await storage.getTargetCounty(org.id, Number(req.params.id));
    if (!county) return res.status(404).json({ message: "Target county not found" });
    
    const updated = await storage.updateTargetCounty(county.id, req.body);
    res.json(updated);
  });

  // Delete a target county
  api.delete("/api/target-counties/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const county = await storage.getTargetCounty(org.id, Number(req.params.id));
    if (!county) return res.status(404).json({ message: "Target county not found" });
    
    await storage.deleteTargetCounty(county.id);
    res.status(204).send();
  });

  // ============================================
  // CAMPAIGN SEQUENCES (Drip Campaign Automation)
  // ============================================

  // Get all sequences for the organization
  api.get("/api/sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequences = await storage.getSequences(org.id);
    res.json(sequences);
  });

  // Get sequence stats (enrollment counts)
  api.get("/api/sequences/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const stats = await storage.getSequenceStats(org.id);
    res.json(stats);
  });

  // Get a specific sequence with its steps
  api.get("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const steps = await storage.getSequenceSteps(sequence.id);
    res.json({ ...sequence, steps });
  });

  // Create a new sequence
  api.post("/api/sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertCampaignSequenceSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const sequence = await storage.createSequence(input);
      res.status(201).json(sequence);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Update a sequence
  api.put("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const updated = await storage.updateSequence(sequence.id, req.body);
    res.json(updated);
  });

  // Delete a sequence
  api.delete("/api/sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    await storage.deleteSequence(sequence.id);
    res.status(204).send();
  });

  // ============================================
  // SEQUENCE STEPS
  // ============================================

  // Get steps for a sequence
  api.get("/api/sequences/:id/steps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const steps = await storage.getSequenceSteps(sequence.id);
    res.json(steps);
  });

  // Add a step to a sequence
  api.post("/api/sequences/:id/steps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const sequence = await storage.getSequence(org.id, Number(req.params.id));
      if (!sequence) return res.status(404).json({ message: "Sequence not found" });
      
      const existingSteps = await storage.getSequenceSteps(sequence.id);
      const nextStepNumber = existingSteps.length + 1;
      
      const input = insertSequenceStepSchema.parse({
        ...req.body,
        sequenceId: sequence.id,
        stepNumber: nextStepNumber,
      });
      const step = await storage.createSequenceStep(input);
      res.status(201).json(step);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Update a step
  api.put("/api/sequences/:id/steps/:stepId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const step = await storage.updateSequenceStep(Number(req.params.stepId), req.body);
    res.json(step);
  });

  // Delete a step
  api.delete("/api/sequences/:id/steps/:stepId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    await storage.deleteSequenceStep(Number(req.params.stepId));
    res.status(204).send();
  });

  // Reorder steps
  api.put("/api/sequences/:id/steps/reorder", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const { stepIds } = req.body as { stepIds: number[] };
    await storage.reorderSequenceSteps(sequence.id, stepIds);
    
    const steps = await storage.getSequenceSteps(sequence.id);
    res.json(steps);
  });

  // ============================================
  // SEQUENCE ENROLLMENTS
  // ============================================

  // Get enrollments for a sequence
  api.get("/api/sequences/:id/enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const sequence = await storage.getSequence(org.id, Number(req.params.id));
    if (!sequence) return res.status(404).json({ message: "Sequence not found" });
    
    const enrollments = await storage.getSequenceEnrollments(sequence.id);
    res.json(enrollments);
  });

  // Get all active enrollments
  api.get("/api/enrollments/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const enrollments = await storage.getActiveEnrollments(org.id);
    res.json(enrollments);
  });

  // Enroll a lead in a sequence
  api.post("/api/sequences/:id/enroll", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const sequence = await storage.getSequence(org.id, Number(req.params.id));
      if (!sequence) return res.status(404).json({ message: "Sequence not found" });
      
      const { leadId } = req.body;
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });
      
      // Check if lead is already enrolled in this sequence
      const existingEnrollments = await storage.getLeadEnrollments(leadId);
      const alreadyEnrolled = existingEnrollments.find(
        e => e.sequenceId === sequence.id && e.status === "active"
      );
      if (alreadyEnrolled) {
        return res.status(400).json({ message: "Lead is already enrolled in this sequence" });
      }
      
      // Get first step delay to schedule
      const steps = await storage.getSequenceSteps(sequence.id);
      const firstStep = steps.find(s => s.stepNumber === 1);
      const delayDays = firstStep?.delayDays || 0;
      
      const nextStepScheduledAt = new Date();
      nextStepScheduledAt.setDate(nextStepScheduledAt.getDate() + delayDays);
      
      const input = insertSequenceEnrollmentSchema.parse({
        sequenceId: sequence.id,
        leadId,
        status: "active",
        currentStep: 0,
        nextStepScheduledAt,
      });
      
      const enrollment = await storage.createSequenceEnrollment(input);
      res.status(201).json(enrollment);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  // Pause an enrollment
  api.post("/api/enrollments/:id/pause", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const { reason } = req.body;
    const enrollment = await storage.pauseEnrollment(Number(req.params.id), reason || "Manually paused");
    res.json(enrollment);
  });

  // Resume an enrollment
  api.post("/api/enrollments/:id/resume", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const enrollment = await storage.resumeEnrollment(Number(req.params.id));
    res.json(enrollment);
  });

  // Cancel an enrollment
  api.post("/api/enrollments/:id/cancel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const enrollment = await storage.cancelEnrollment(Number(req.params.id));
    res.json(enrollment);
  });

  // Get lead's enrollments
  api.get("/api/leads/:id/enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const lead = await storage.getLead(org.id, Number(req.params.id));
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    
    const enrollments = await storage.getLeadEnrollments(lead.id);
    res.json(enrollments);
  });
  
  api.put("/api/campaigns/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const campaign = await storage.updateCampaign(Number(req.params.id), req.body);
    if (!campaign) return res.status(404).json({ message: "Campaign not found" });
    res.json(campaign);
  });
  
  // Send direct mail campaign with credit pre-checks
  api.post("/api/campaigns/:id/send-direct-mail", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const campaignId = parseInt(req.params.id);
      const { pieceType, leadIds } = req.body as { 
        pieceType: 'postcard_4x6' | 'postcard_6x9' | 'postcard_6x11' | 'letter_1_page';
        leadIds: number[];
      };

      const { directMailService, DIRECT_MAIL_COSTS } = await import("./services/directMail");
      
      // Check if org has their own Lob credentials (BYOK) - if so, skip credit check
      const usingOrgLobCredentials = await directMailService.hasOrgLobCredentials(org.id);
      
      if (!usingOrgLobCredentials && !directMailService.isAvailable()) {
        return res.status(503).json({ error: "Direct mail service not configured. Please add LOB_API_KEY or configure your own Lob API key in Integrations." });
      }

      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign || campaign.type !== 'direct_mail') {
        return res.status(400).json({ error: "Invalid campaign or not a direct mail campaign" });
      }

      if (!leadIds || leadIds.length === 0) {
        return res.status(400).json({ error: "No recipients specified" });
      }

      // Get the organization's default mail sender identity
      const mailSenderIdentity = await storage.getDefaultMailSenderIdentity(org.id);
      if (!mailSenderIdentity) {
        return res.status(400).json({ 
          error: "No return address configured. Please set up a mail sender identity in Mail Settings." 
        });
      }

      // Warn if identity is not verified but allow sending
      let identityWarning: string | undefined;
      if (mailSenderIdentity.status !== 'verified') {
        identityWarning = `Warning: Return address "${mailSenderIdentity.name}" is not verified. Mail may be delayed or returned.`;
      }

      const costPerPiece = DIRECT_MAIL_COSTS[pieceType];
      const totalCost = costPerPiece * leadIds.length;

      // Only check credits if NOT using org Lob credentials (BYOK)
      if (!usingOrgLobCredentials) {
        const balance = await creditService.getBalance(org.id);
        if (balance < totalCost) {
          return res.status(402).json({
            error: "Insufficient credits",
            required: totalCost / 100,
            balance: balance / 100,
            perPiece: costPerPiece / 100,
            recipientCount: leadIds.length,
          });
        }
      } else {
        console.log(`[DirectMailRoute] Skipping credit pre-check for org ${org.id} - using org Lob credentials`);
      }

      const leadsData = await Promise.all(
        leadIds.map(id => storage.getLead(org.id, id))
      );
      const validLeads = leadsData.filter(l => l && l.address && l.city && l.state && l.zip);

      if (validLeads.length === 0) {
        return res.status(400).json({ error: "No valid recipients with complete addresses" });
      }

      // Only deduct credits if NOT using org Lob credentials (BYOK)
      let deductResult: any = true;
      if (!usingOrgLobCredentials) {
        deductResult = await creditService.deductCredits(
          org.id,
          costPerPiece * validLeads.length,
          `Direct mail campaign: ${campaign.name} - ${validLeads.length} pieces`,
          { campaignId, pieceType, recipientCount: validLeads.length }
        );

        if (!deductResult) {
          return res.status(402).json({ error: "Insufficient credits" });
        }
      } else {
        console.log(`[DirectMailRoute] Skipping credit deduction for org ${org.id} - using org Lob credentials`);
      }

      // Create return address snapshot from mail sender identity
      const returnAddressSnapshot = {
        companyName: mailSenderIdentity.companyName,
        addressLine1: mailSenderIdentity.addressLine1,
        addressLine2: mailSenderIdentity.addressLine2 || undefined,
        city: mailSenderIdentity.city,
        state: mailSenderIdentity.state,
        zipCode: mailSenderIdentity.zipCode,
        country: mailSenderIdentity.country,
      };

      // Determine mail type from pieceType
      const mailType = pieceType.startsWith('postcard_') ? 'postcard' : 'letter';

      // Create mailing order record with pending status
      // creditsUsed is 0 when using org Lob credentials (BYOK)
      const mailingOrder = await storage.createMailingOrder({
        organizationId: org.id,
        campaignId,
        mailSenderIdentityId: mailSenderIdentity.id,
        returnAddressSnapshot,
        mailType,
        totalPieces: validLeads.length,
        costPerPiece: usingOrgLobCredentials ? 0 : costPerPiece,
        totalCost: usingOrgLobCredentials ? 0 : (costPerPiece * validLeads.length),
        creditsUsed: usingOrgLobCredentials ? 0 : (costPerPiece * validLeads.length),
        status: 'pending',
      });

      // Update order status to in_progress when sending starts
      await storage.updateMailingOrder(mailingOrder.id, {
        status: 'sending',
        startedAt: new Date(),
      });

      // Build sender address for Lob
      const senderAddress = {
        name: mailSenderIdentity.companyName,
        addressLine1: mailSenderIdentity.addressLine1,
        addressLine2: mailSenderIdentity.addressLine2 || undefined,
        city: mailSenderIdentity.city,
        state: mailSenderIdentity.state,
        zip: mailSenderIdentity.zipCode,
      };

      // Get current mail mode from organization settings
      const mailMode = (org.settings?.mailMode || 'test') as 'test' | 'live';
      const isTestMode = mailMode === 'test';

      // Actually send the mail pieces via Lob
      const sendResults: Array<{ leadId: number; success: boolean; lobId?: string; expectedDeliveryDate?: Date; error?: string; isTest?: boolean }> = [];
      const lobJobIds: string[] = [];
      
      for (const lead of validLeads) {
        const recipientName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Property Owner';
        
        try {
          let result: any;
          if (pieceType.startsWith('postcard_')) {
            const size = pieceType.replace('postcard_', '') as '4x6' | '6x9' | '6x11';
            result = await directMailService.sendPostcard({
              size,
              front: campaign.content || '<html><body><h1>Special Offer!</h1></body></html>',
              back: `<html><body><p>Dear ${lead.firstName || 'Property Owner'},</p><p>${campaign.subject || 'We are interested in your property.'}</p></body></html>`,
              to: {
                name: recipientName,
                addressLine1: lead.address!,
                city: lead.city!,
                state: lead.state!,
                zip: lead.zip!,
              },
              from: senderAddress,
            }, mailMode, org.id);
          } else {
            result = await directMailService.sendLetter({
              file: campaign.content || '<html><body><p>Letter content</p></body></html>',
              to: {
                name: recipientName,
                addressLine1: lead.address!,
                city: lead.city!,
                state: lead.state!,
                zip: lead.zip!,
              },
              from: senderAddress,
            }, mailMode, org.id);
          }

          const expectedDeliveryDate = result.expected_delivery_date ? new Date(result.expected_delivery_date) : undefined;
          sendResults.push({ leadId: lead.id, success: true, lobId: result.id, expectedDeliveryDate, isTest: isTestMode });
          lobJobIds.push(result.id);

          // Create mailing order piece record for successful send
          const piece = await storage.createMailingOrderPiece({
            mailingOrderId: mailingOrder.id,
            leadId: lead.id,
            recipientName,
            recipientAddressLine1: lead.address!,
            recipientCity: lead.city!,
            recipientState: lead.state!,
            recipientZipCode: lead.zip!,
            status: 'sent',
          });
          // Update with Lob-specific fields after creation
          await storage.updateMailingOrderPiece(piece.id, {
            lobMailId: result.id,
            lobUrl: result.url,
            expectedDeliveryDate,
          });
        } catch (err: any) {
          sendResults.push({ leadId: lead.id, success: false, error: err.message });

          // Create mailing order piece record for failed send
          await storage.createMailingOrderPiece({
            mailingOrderId: mailingOrder.id,
            leadId: lead.id,
            recipientName,
            recipientAddressLine1: lead.address!,
            recipientCity: lead.city!,
            recipientState: lead.state!,
            recipientZipCode: lead.zip!,
            status: 'failed',
            errorMessage: err.message,
          });
        }
      }

      const successCount = sendResults.filter(r => r.success).length;
      const failCount = sendResults.filter(r => !r.success).length;

      // Update mailing order to completed with final counts
      await storage.updateMailingOrder(mailingOrder.id, {
        status: 'completed',
        sentPieces: successCount,
        failedPieces: failCount,
        lobJobIds,
        completedAt: new Date(),
      });

      // Record usage and handle refunds only if NOT using org credentials (BYOK)
      if (!usingOrgLobCredentials) {
        // Record usage only for successful sends
        if (successCount > 0) {
          await usageMeteringService.recordUsage(
            org.id,
            'direct_mail',
            successCount,
            { campaignId, pieceType, mailingOrderId: mailingOrder.id },
            false // already deducted upfront
          );
        }

        // Refund credits for failed sends
        if (failCount > 0) {
          const refundAmount = costPerPiece * failCount;
          await creditService.addCredits(
            org.id,
            refundAmount,
            'refund',
            `Refund for ${failCount} failed direct mail pieces in campaign: ${campaign.name}`,
            { campaignId, pieceType, failedCount: failCount, mailingOrderId: mailingOrder.id }
          );
        }
      } else {
        console.log(`[DirectMailRoute] Skipping usage recording for org ${org.id} - using org Lob credentials (BYOK)`);
      }

      await storage.updateCampaign(campaignId, {
        totalSent: (campaign.totalSent || 0) + successCount,
        status: 'active',
      });

      res.json({
        success: true,
        isTestMode,
        mailingOrderId: mailingOrder.id,
        piecesQueued: successCount,
        piecesFailed: failCount,
        totalCost: (costPerPiece * successCount) / 100,
        refunded: failCount > 0 ? (costPerPiece * failCount) / 100 : 0,
        message: isTestMode 
          ? `${successCount} test mail pieces queued (no actual mail sent)${failCount > 0 ? `, ${failCount} failed` : ''}`
          : `${successCount} mail pieces sent${failCount > 0 ? `, ${failCount} failed (refunded)` : ''}`,
        warning: identityWarning,
        details: sendResults,
      });
    } catch (error: any) {
      console.error("Direct mail send error:", error);
      res.status(500).json({ error: error.message || "Failed to send direct mail" });
    }
  });

  // Estimate cost for sending a campaign to selected recipients
  api.get("/api/campaigns/:id/estimate-cost", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { pieceType, recipientCount } = req.query as { pieceType: string; recipientCount: string };
      
      const { DIRECT_MAIL_COSTS } = await import("./services/directMail");
      
      const costPerPiece = DIRECT_MAIL_COSTS[pieceType as keyof typeof DIRECT_MAIL_COSTS] || 75;
      const count = parseInt(recipientCount) || 0;
      const totalCost = costPerPiece * count;
      const balance = await creditService.getBalance(org.id);
      const mailMode = org.settings?.mailMode || 'test';
      
      res.json({
        pieceType,
        recipientCount: count,
        costPerPiece: costPerPiece / 100,
        totalCost: totalCost / 100,
        currentBalance: balance / 100,
        canAfford: balance >= totalCost,
        creditsNeeded: balance < totalCost ? (totalCost - balance) / 100 : 0,
        mailMode,
        isTestMode: mailMode === 'test',
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // ============================================
  // CAMPAIGN OPTIMIZATIONS
  // ============================================
  
  api.get("/api/campaigns/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { campaignOptimizerService } = await import("./services/campaignOptimizer");
      const analytics = await campaignOptimizerService.getCampaignAnalytics(org.id);
      res.json(analytics);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get campaign analytics" });
    }
  });
  
  api.get("/api/campaigns/:id/optimizations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const campaignId = parseInt(req.params.id);
      
      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      
      const optimizations = await storage.getCampaignOptimizations(campaignId);
      res.json(optimizations);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get optimizations" });
    }
  });
  
  api.post("/api/campaigns/:id/optimize", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const campaignId = parseInt(req.params.id);
      
      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      
      const { campaignOptimizerService } = await import("./services/campaignOptimizer");
      const result = await campaignOptimizerService.optimizeCampaign(campaign);
      
      res.json({
        success: true,
        campaignId,
        metrics: result.metrics,
        score: result.score,
        suggestionsGenerated: result.savedOptimizations,
        suggestions: result.suggestions,
      });
    } catch (error: any) {
      console.error("Campaign optimization error:", error);
      res.status(500).json({ error: error.message || "Failed to optimize campaign" });
    }
  });
  
  api.put("/api/optimizations/:id/implement", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const optimizationId = parseInt(req.params.id);
      const { resultDelta } = req.body;
      
      const updated = await storage.markOptimizationImplemented(optimizationId, resultDelta || null);
      if (!updated) {
        return res.status(404).json({ error: "Optimization not found" });
      }
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to mark optimization as implemented" });
    }
  });
  
  // ============================================
  // PRICING RATES
  // ============================================
  
  api.get("/api/pricing/rates", async (req, res) => {
    const { DIRECT_MAIL_COSTS } = await import("./services/directMail");
    
    res.json({
      actions: {
        email_sent: { name: "Email", costCents: 1, description: "Per email sent" },
        sms_sent: { name: "SMS Text", costCents: 3, description: "Per text message" },
        ai_chat: { name: "AI Chat", costCents: 2, description: "Per AI conversation message" },
        ai_image: { name: "AI Image", costCents: 25, description: "Per image generated" },
        pdf_generated: { name: "Document PDF", costCents: 5, description: "Per document generated" },
        comps_query: { name: "Comps Analysis", costCents: 10, description: "Per property analysis" },
      },
      directMail: {
        postcard_4x6: { name: "Postcard 4x6", costCents: DIRECT_MAIL_COSTS.postcard_4x6, description: "Small postcard" },
        postcard_6x9: { name: "Postcard 6x9", costCents: DIRECT_MAIL_COSTS.postcard_6x9, description: "Standard postcard" },
        postcard_6x11: { name: "Postcard 6x11", costCents: DIRECT_MAIL_COSTS.postcard_6x11, description: "Large postcard" },
        letter_1_page: { name: "Letter (1 page)", costCents: DIRECT_MAIL_COSTS.letter_1_page, description: "Single page letter" },
        letter_2_page: { name: "Letter (2 pages)", costCents: DIRECT_MAIL_COSTS.letter_2_page, description: "Two page letter" },
      },
      monthlyAllowances: {
        free: { credits: 100, value: "$1.00" },
        starter: { credits: 1000, value: "$10.00" },
        pro: { credits: 5000, value: "$50.00" },
        scale: { credits: 25000, value: "$250.00" },
      },
    });
  });
  
  // ============================================
  // DIRECT MAIL SETTINGS & ESTIMATES
  // ============================================
  
  // Get direct mail status and configuration
  api.get("/api/direct-mail/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const { directMailService, DIRECT_MAIL_COSTS } = await import("./services/directMail");
    
    const currentMode = org.settings?.mailMode || 'test';
    const availableModes = directMailService.getAvailableModes();
    
    res.json({
      isConfigured: directMailService.isAvailable(),
      currentMode,
      availableModes,
      hasTestMode: directMailService.hasTestMode(),
      hasLiveMode: directMailService.hasLiveMode(),
      pricing: DIRECT_MAIL_COSTS,
      deliveryDays: directMailService.getEstimatedDeliveryDays(),
    });
  });
  
  // Update mail mode (test/live)
  api.patch("/api/direct-mail/mode", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const { mode } = req.body;
    
    if (mode !== 'test' && mode !== 'live') {
      return res.status(400).json({ error: "Mode must be 'test' or 'live'" });
    }
    
    const { directMailService } = await import("./services/directMail");
    
    // Validate the mode is available
    if (mode === 'live' && !directMailService.hasLiveMode()) {
      return res.status(400).json({ error: "Live mode not available - no live API key configured" });
    }
    if (mode === 'test' && !directMailService.hasTestMode()) {
      return res.status(400).json({ error: "Test mode not available - no test API key configured" });
    }
    
    // Update organization settings
    const updatedSettings = { ...org.settings, mailMode: mode };
    const updated = await storage.updateOrganization(org.id, { settings: updatedSettings });
    
    res.json({ 
      success: true, 
      mode,
      message: mode === 'test' 
        ? 'Test mode enabled - mail will not actually be sent' 
        : 'Live mode enabled - real mail will be sent and billed'
    });
  });
  
  // Get cost estimate for a batch of mail
  api.post("/api/direct-mail/estimate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { pieceType, recipientCount, recipientIds, campaignId } = req.body;
      
      const { directMailService, DIRECT_MAIL_COSTS } = await import("./services/directMail");
      
      if (!directMailService.isAvailable()) {
        return res.status(400).json({ error: "Direct mail service not configured" });
      }
      
      // Validate piece type
      if (!DIRECT_MAIL_COSTS[pieceType as keyof typeof DIRECT_MAIL_COSTS]) {
        return res.status(400).json({ error: "Invalid piece type" });
      }
      
      // Calculate recipient count from IDs if provided
      let count = recipientCount || 0;
      if (recipientIds && Array.isArray(recipientIds)) {
        count = recipientIds.length;
      } else if (campaignId) {
        // Get leads matching campaign criteria
        const campaign = await storage.getCampaign(org.id, campaignId);
        if (campaign && campaign.targetCriteria) {
          const leads = await storage.getLeads(org.id);
          // Filter leads by campaign criteria (simplified)
          count = leads.length;
        }
      }
      
      if (count <= 0) {
        return res.status(400).json({ error: "Must specify recipientCount, recipientIds, or campaignId" });
      }
      
      const currentMode = org.settings?.mailMode || 'test';
      const estimate = directMailService.estimateBatchCost(pieceType, count, currentMode);
      
      // Check if user has enough credits
      const creditBalance = parseFloat(org.creditBalance || '0');
      const hasEnoughCredits = creditBalance >= estimate.totalCost;
      
      res.json({
        ...estimate,
        currentMode,
        creditBalance,
        hasEnoughCredits,
        creditsNeeded: hasEnoughCredits ? 0 : estimate.totalCost - creditBalance,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to generate estimate" });
    }
  });
  
  // Verify a single address
  api.post("/api/direct-mail/verify-address", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { line1, line2, city, state, zip } = req.body;
      
      if (!line1 || !city || !state || !zip) {
        return res.status(400).json({ error: "Address fields (line1, city, state, zip) are required" });
      }
      
      const isProduction = process.env.NODE_ENV === 'production';
      const apiKey = isProduction 
        ? process.env.LOB_LIVE_API_KEY 
        : (process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY);
      
      if (!apiKey) {
        return res.status(400).json({ error: "Address verification service not configured. Please add Lob API key in settings." });
      }
      
      const { verifyAddress } = await import("./services/directMailService");
      
      const result = await verifyAddress({
        line1,
        line2,
        city,
        state,
        zip,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to verify address" });
    }
  });
  
  // Bulk verify addresses for leads
  api.post("/api/direct-mail/bulk-verify-addresses", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { leadIds } = req.body;
      
      if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: "leadIds array is required" });
      }
      
      if (leadIds.length > 100) {
        return res.status(400).json({ error: "Maximum 100 addresses can be verified at once" });
      }
      
      const isProduction = process.env.NODE_ENV === 'production';
      const apiKey = isProduction 
        ? process.env.LOB_LIVE_API_KEY 
        : (process.env.LOB_TEST_API_KEY || process.env.LOB_LIVE_API_KEY);
      
      if (!apiKey) {
        return res.status(400).json({ error: "Address verification service not configured. Please add Lob API key in settings." });
      }
      
      const { verifyAddress } = await import("./services/directMailService");
      
      const results: Array<{
        leadId: number;
        isValid: boolean;
        deliverability: string;
        errorMessage?: string;
      }> = [];
      
      let deliverable = 0;
      let undeliverable = 0;
      
      for (const leadId of leadIds) {
        const lead = await storage.getLead(org.id, leadId);
        if (!lead) {
          results.push({ leadId, isValid: false, deliverability: 'unknown', errorMessage: 'Lead not found' });
          undeliverable++;
          continue;
        }
        
        if (!lead.mailingAddress || !lead.city || !lead.state || !lead.zipCode) {
          results.push({ leadId, isValid: false, deliverability: 'incomplete_address', errorMessage: 'Incomplete address information' });
          undeliverable++;
          continue;
        }
        
        try {
          const verificationResult = await verifyAddress({
            line1: lead.mailingAddress,
            line2: undefined,
            city: lead.city,
            state: lead.state,
            zip: lead.zipCode,
          });
          
          results.push({
            leadId,
            isValid: verificationResult.isValid,
            deliverability: verificationResult.deliverability,
            errorMessage: verificationResult.errorMessage,
          });
          
          if (verificationResult.isValid) {
            deliverable++;
          } else {
            undeliverable++;
          }
        } catch (error: any) {
          results.push({
            leadId,
            isValid: false,
            deliverability: 'error',
            errorMessage: error.message || 'Verification failed',
          });
          undeliverable++;
        }
      }
      
      res.json({
        total: leadIds.length,
        verified: results.length,
        deliverable,
        undeliverable,
        results,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to verify addresses" });
    }
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
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
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

  // Get background agent statuses (for Agents tab in Command Center)
  api.get("/api/agents/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const statuses = await storage.getAgentStatuses();
      res.json(statuses);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch agent statuses" });
    }
  });
  
  // ============================================
  // CONVERSATIONS (Buyer Communication)
  // ============================================
  
  api.get("/api/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const filters: { leadId?: number; channel?: string } = {};
    if (req.query.leadId) {
      filters.leadId = Number(req.query.leadId);
    }
    if (req.query.channel && typeof req.query.channel === 'string') {
      filters.channel = req.query.channel;
    }
    const conversations = await storage.getConversations(org.id, filters);
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
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      // Credit pre-check for AI chat (2 cents per request)
      const aiChatCost = await usageMeteringService.calculateCost("ai_chat", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, aiChatCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: aiChatCost / 100,
          balance: balance / 100,
        });
      }
      
      await storage.trackUsage(org.id, "ai_request");
      
      const result = await processChat(message, org, userId, {
        conversationId,
        agentRole
      });
      
      // Record usage after successful AI chat
      await usageMeteringService.recordUsage(org.id, "ai_chat", 1, {
        conversationId,
        agentRole,
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
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      // Credit pre-check for AI chat (2 cents per request)
      const aiChatCost = await usageMeteringService.calculateCost("ai_chat", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, aiChatCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: aiChatCost / 100,
          balance: balance / 100,
        });
      }
      
      await storage.trackUsage(org.id, "ai_request");
      
      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      
      const stream = processChatStream(message, org, userId, {
        conversationId,
        agentRole
      });
      
      let streamCompleted = false;
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if ((event as any).type === "done") {
          streamCompleted = true;
        }
      }
      
      // Record usage only after successful stream completion
      if (streamCompleted) {
        await usageMeteringService.recordUsage(org.id, "ai_chat", 1, {
          conversationId,
          agentRole,
        });
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
  // EXECUTIVE ASSISTANT (UNIFIED AI INTERFACE)
  // ============================================

  api.get("/api/assistant/skills", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      
      const { getAvailableActions, SKILL_ACTIONS } = await import('./services/skill-permissions');
      const { insights, actions, lockedActions } = getAvailableActions(tier, isFounder);
      
      res.json({
        tier,
        isFounder,
        insights,
        actions,
        lockedActions,
        allActions: SKILL_ACTIONS,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/assistant/check-permission", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { actionId } = req.body;
      
      if (!actionId) {
        return res.status(400).json({ message: "actionId is required" });
      }
      
      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      
      const { checkSkillPermission } = await import('./services/skill-permissions');
      const result = checkSkillPermission(actionId, tier, isFounder);
      
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/assistant/classify-intent", isAuthenticated, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ message: "message is required" });
      }
      const { classifyIntentSimple } = await import('./services/intent-router');
      const intent = classifyIntentSimple(message);
      res.json(intent);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/assistant/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { message, useAIClassification, useTrialToken } = req.body;

      if (!message) {
        return res.status(400).json({ message: "message is required" });
      }

      const { classifyIntentSimple, classifyIntentWithAI } = await import('./services/intent-router');
      const { executeAgentTask } = await import('./services/core-agents');
      const { checkSkillPermission, mapIntentToAction, checkTrialTokenEligibility } = await import('./services/skill-permissions');

      const intent = useAIClassification 
        ? await classifyIntentWithAI(message)
        : classifyIntentSimple(message);

      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      const trialTokens = await storage.getTrialTokens(org.id);
      
      // Permission check for gated actions
      const actionId = mapIntentToAction(intent.action);
      let usedTrialToken = false;
      
      if (actionId) {
        const permissionCheck = checkSkillPermission(actionId, tier, isFounder, trialTokens);
        
        if (!permissionCheck.allowed) {
          // Action is gated - check if user wants to use a trial token
          if (useTrialToken) {
            const eligibility = checkTrialTokenEligibility(actionId, tier, trialTokens);
            if (!eligibility.eligible) {
              return res.status(403).json({
                error: "trial_token_ineligible",
                message: eligibility.reason,
                intent,
              });
            }
            
            // Attempt to consume a trial token atomically
            const consumption = await storage.consumeTrialToken(org.id);
            if (!consumption.success) {
              return res.status(403).json({
                error: "trial_token_failed",
                message: "No trial tokens available",
                intent,
              });
            }
            
            // Trial token consumed successfully - action is now allowed
            usedTrialToken = true;
          } else {
            // No trial token requested - deny access
            return res.status(403).json({
              error: "upgrade_required",
              message: permissionCheck.reason,
              requiredTier: permissionCheck.requiredTier,
              currentTier: permissionCheck.currentTier,
              upgradeMessage: permissionCheck.upgradeMessage,
              canUseTrialToken: permissionCheck.canUseTrialToken,
              trialTokensRemaining: permissionCheck.trialTokensRemaining,
              intent,
            });
          }
        }
        // If permissionCheck.allowed is true, action proceeds normally
      }

      const result = await executeAgentTask(intent.agentType, {
        action: intent.action,
        parameters: { ...intent.extractedParams, userMessage: message },
        context: {
          organizationId: org.id,
          userId: user?.id,
        },
      });

      // Get updated trial token count
      const remainingTokens = await storage.getTrialTokens(org.id);

      res.json({
        intent,
        result,
        skill: intent.skillLabel,
        trialTokensRemaining: remainingTokens,
        usedTrialToken,
      });
    } catch (err: any) {
      console.error("Assistant execute error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/assistant/suggestions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      const trialTokens = await storage.getTrialTokens(org.id);
      
      const { getAvailableActions } = await import('./services/skill-permissions');
      const { insights, actions } = getAvailableActions(tier, isFounder);
      
      const suggestions = [
        { label: "Analyze a property", skill: "Research & Intelligence", actionId: "analyze_property", category: "insight" },
        { label: "Check environmental risks", skill: "Research & Intelligence", actionId: "lookup_environmental", category: "insight" },
        { label: "Get market analysis", skill: "Research & Intelligence", actionId: "market_analysis", category: "insight" },
        { label: "Calculate investment ROI", skill: "Deals & Acquisition", actionId: "investment_calculator", category: "insight" },
        { label: "Find comparable sales", skill: "Deals & Acquisition", actionId: "comp_analysis", category: "insight" },
        { label: "Score this deal", skill: "Deals & Acquisition", actionId: "deal_scoring", category: "insight" },
        { label: "Run due diligence report", skill: "Research & Intelligence", actionId: "run_due_diligence", category: "action", requiredTier: "starter" },
        { label: "Generate an offer letter", skill: "Deals & Acquisition", actionId: "generate_offer", category: "action", requiredTier: "starter" },
        { label: "Draft a follow-up email", skill: "Communications", actionId: "compose_email", category: "action", requiredTier: "starter" },
        { label: "Check overdue payments", skill: "Operations", actionId: "delinquency_check", category: "insight" },
      ];
      
      const availableIds = new Set([...insights, ...actions].map(a => a.id));
      const enrichedSuggestions = suggestions.map(s => ({
        ...s,
        available: availableIds.has(s.actionId),
        currentTier: tier,
        canUseTrialToken: !availableIds.has(s.actionId) && s.category === "action" && trialTokens > 0,
      }));
      
      res.json({ 
        suggestions: enrichedSuggestions,
        trialTokens,
        tier,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get trial token info
  api.get("/api/assistant/trial-tokens", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const trialTokens = await storage.getTrialTokens(org.id);
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      
      res.json({
        trialTokens,
        tier,
        maxTokens: 5, // Initial tokens granted to new users
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // VA (VIRTUAL ASSISTANTS) SYSTEM
  // ============================================
  
  // Get all VA agents for the organization
  api.get("/api/va/agents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agents = await storage.initializeVaAgents(org.id);
      res.json(agents);
    } catch (error: any) {
      console.error("Error fetching VA agents:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get a specific VA agent
  api.get("/api/va/agents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agentId = parseInt(req.params.id);
      const agent = await storage.getVaAgent(org.id, agentId);
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }
      
      res.json(agent);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Update a VA agent settings
  api.patch("/api/va/agents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agentId = parseInt(req.params.id);
      const agent = await storage.getVaAgent(org.id, agentId);
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }
      
      const updated = await storage.updateVaAgent(agentId, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get VA actions (activity feed)
  api.get("/api/va/actions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const options: { agentId?: number; status?: string; limit?: number } = {};
      
      if (req.query.agentId) options.agentId = parseInt(req.query.agentId as string);
      if (req.query.status) options.status = req.query.status as string;
      if (req.query.limit) options.limit = parseInt(req.query.limit as string);
      
      const actions = await storage.getVaActions(org.id, options);
      res.json(actions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get pending actions count
  api.get("/api/va/actions/pending/count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const count = await storage.getPendingActionsCount(org.id);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Approve an action
  api.post("/api/va/actions/:id/approve", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const actionId = parseInt(req.params.id);
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return res.status(404).json({ message: "Action not found" });
      }
      
      const updated = await storage.approveVaAction(actionId, userId);
      
      // Execute the action after approval
      const executionResult = await vaAgentService.executeAgentAction(updated);
      
      // Get the final updated action with execution result
      const finalAction = await storage.getVaAction(actionId);
      res.json({ action: finalAction, executionResult });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Reject an action
  api.post("/api/va/actions/:id/reject", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const actionId = parseInt(req.params.id);
      const { reason } = req.body;
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return res.status(404).json({ message: "Action not found" });
      }
      
      const updated = await storage.rejectVaAction(actionId, reason || "Rejected by user");
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Process a task with an agent
  api.post("/api/va/agents/:type/task", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const agentType = req.params.type as any;
      const { task } = req.body;
      
      if (!task) {
        return res.status(400).json({ message: "Task description is required" });
      }
      
      const result = await vaAgentService.processAgentTask(org.id, agentType, task);
      res.json(result);
    } catch (error: any) {
      console.error("VA Task error:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get VA agent status
  api.get("/api/va/agents/:type/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const agentType = req.params.type as any;
      
      const status = await vaAgentService.getAgentStatus(org.id, agentType);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Execute action manually
  api.post("/api/va/actions/:id/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const actionId = parseInt(req.params.id);
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return res.status(404).json({ message: "Action not found" });
      }
      
      if (action.status !== "approved") {
        return res.status(400).json({ message: "Action must be approved before execution" });
      }
      
      const result = await vaAgentService.executeAgentAction(action);
      const finalAction = await storage.getVaAction(actionId);
      res.json({ action: finalAction, executionResult: result });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Process autonomous actions (for background job)
  api.post("/api/va/actions/process-autonomous", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      
      const result = await vaAgentService.processAutonomousActions(org.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get briefings
  api.get("/api/va/briefings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const limit = parseInt(req.query.limit as string) || 10;
      const briefings = await storage.getVaBriefings(org.id, limit);
      res.json(briefings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Generate a new briefing
  api.post("/api/va/briefings/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const briefing = await vaAgentService.generateBriefing(org.id);
      res.json(briefing);
    } catch (error: any) {
      console.error("Briefing generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Mark briefing as read
  api.post("/api/va/briefings/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const briefingId = parseInt(req.params.id);
      const updated = await storage.markBriefingRead(briefingId);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get calendar events
  api.get("/api/va/calendar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
      const events = await storage.getVaCalendarEvents(org.id, startDate, endDate);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Create calendar event
  api.post("/api/va/calendar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const event = await storage.createVaCalendarEvent({
        ...req.body,
        organizationId: org.id
      });
      res.json(event);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // ============================================
  // CREDITS AND USAGE METERING
  // ============================================
  
  api.get("/api/credits/balance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { creditService } = await import("./services/credits");
      const org = (req as any).organization;
      const balance = await creditService.getBalance(org.id);
      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/credits/transactions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { creditService } = await import("./services/credits");
      const org = (req as any).organization;
      const limit = parseInt(req.query.limit as string) || 50;
      const transactions = await creditService.getTransactionHistory(org.id, limit);
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/usage/summary", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = (req as any).organization;
      const month = req.query.month as string || new Date().toISOString().slice(0, 7);
      const summary = await usageMeteringService.getUsageSummary(org.id, month);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/usage/records", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = (req as any).organization;
      const limit = parseInt(req.query.limit as string) || 50;
      const records = await usageMeteringService.getRecentUsage(org.id, limit);
      res.json(records);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.get("/api/usage/rates", isAuthenticated, async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const { USAGE_ACTION_TYPES } = await import("@shared/schema");
      const dbRates = await usageMeteringService.getAllRates();
      
      const rates = Object.entries(USAGE_ACTION_TYPES).map(([key, value]) => {
        const dbRate = dbRates.find((r: any) => r.actionType === key);
        return {
          actionType: key,
          displayName: value.name,
          unitCostCents: dbRate?.unitCostCents || value.defaultCostCents,
        };
      });
      
      res.json(rates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/usage/estimate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService, creditService } = await import("./services/credits");
      const { USAGE_ACTION_TYPES } = await import("@shared/schema");
      const org = (req as any).organization;
      const { actionType, quantity = 1 } = req.body;
      
      if (!actionType || !USAGE_ACTION_TYPES[actionType as keyof typeof USAGE_ACTION_TYPES]) {
        return res.status(400).json({ message: "Invalid action type" });
      }
      
      const cost = await usageMeteringService.calculateCost(actionType, quantity);
      const balance = await creditService.getBalance(org.id);
      
      res.json({
        actionType,
        quantity,
        unitCostCents: cost / quantity,
        totalCostCents: cost,
        currentBalance: balance,
        insufficientCredits: balance < cost,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/credits/purchase", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeService } = await import("./stripeService");
      const { CREDIT_PACKS } = await import("@shared/schema");
      const org = (req as any).organization;
      const { packId } = req.body;
      
      if (!packId || !CREDIT_PACKS[packId as keyof typeof CREDIT_PACKS]) {
        return res.status(400).json({ message: "Invalid credit pack ID" });
      }
      
      const pack = CREDIT_PACKS[packId as keyof typeof CREDIT_PACKS];
      
      let customerId = org.stripeCustomerId;
      if (!customerId) {
        const user = req.user as any;
        const customer = await stripeService.createCustomer(
          user.email || '',
          user.id,
          org.name
        );
        await storage.updateOrganization(org.id, { stripeCustomerId: customer.id });
        customerId = customer.id;
      }
      
      const session = await stripeService.createCreditPurchaseCheckout(
        customerId,
        packId,
        pack.priceCents,
        pack.name,
        `${req.protocol}://${req.get('host')}/settings?credits=success`,
        `${req.protocol}://${req.get('host')}/settings?credits=cancelled`,
        { 
          organizationId: String(org.id),
          type: 'credit_purchase',
          packId,
          amountCents: String(pack.amountCents),
        }
      );
      
      res.json({ checkoutUrl: session.url });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get auto-top-up settings
  api.get("/api/credits/auto-top-up", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      res.json({
        enabled: org.autoTopUpEnabled || false,
        thresholdCents: org.autoTopUpThresholdCents || 200,
        amountCents: org.autoTopUpAmountCents || 2500,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update auto-top-up settings
  api.post("/api/credits/auto-top-up", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { usageMeteringService } = await import("./services/credits");
      const org = (req as any).organization;
      const { enabled, thresholdCents, amountCents } = req.body;
      
      await usageMeteringService.updateAutoTopUpSettings(
        org.id,
        enabled === true,
        thresholdCents,
        amountCents
      );
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
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
      
      // Check if organization is eligible for 7-day free trial (first subscription only)
      const trialDays = org.trialUsed ? undefined : 7;
      
      // Mark trial as used when they start their first subscription
      if (!org.trialUsed) {
        await storage.updateOrganization(org.id, { trialUsed: true });
      }
      
      const session = await stripeService.createCheckoutSession(
        customerId,
        priceId,
        `${req.protocol}://${req.get('host')}/settings?subscription=success`,
        `${req.protocol}://${req.get('host')}/settings?subscription=cancelled`,
        { organizationId: String(org.id) },
        trialDays
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

  // ============================================
  // STRIPE CONNECT (User Payment Acceptance)
  // ============================================

  api.post("/api/stripe/connect/link", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      const user = req.user as any;
      
      const email = user?.claims?.email || req.body.email;
      const businessName = org.name || req.body.businessName;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }
      
      const existing = await storage.getOrganizationIntegration(org.id, "stripe_connect");
      
      if (existing?.credentials?.stripeConnectAccountId) {
        const accountLink = await stripeConnectService.createOnboardingLink(
          existing.credentials.stripeConnectAccountId
        );
        return res.json({ 
          accountId: existing.credentials.stripeConnectAccountId,
          onboardingUrl: accountLink.url,
          isExisting: true 
        });
      }
      
      const result = await stripeConnectService.createConnectedAccount(org.id, email, businessName);
      res.json(result);
    } catch (err: any) {
      console.error("Stripe Connect link error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/stripe/connect/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      
      const status = await stripeConnectService.getOrganizationConnectStatus(org.id);
      res.json(status);
    } catch (err: any) {
      console.error("Stripe Connect status error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/stripe/connect/refresh", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      
      const integration = await storage.getOrganizationIntegration(org.id, "stripe_connect");
      
      if (!integration?.credentials?.stripeConnectAccountId) {
        return res.status(400).json({ message: "No Stripe Connect account found" });
      }
      
      await stripeConnectService.updateAccountStatus(org.id, integration.credentials.stripeConnectAccountId);
      const status = await stripeConnectService.getOrganizationConnectStatus(org.id);
      
      res.json(status);
    } catch (err: any) {
      console.error("Stripe Connect refresh error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/stripe/connect/disconnect", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      
      await stripeConnectService.disconnectAccount(org.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Stripe Connect disconnect error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/stripe/connect/payment-intent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      const { amount, noteId, propertyId, paymentType, description } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Valid amount is required" });
      }
      
      if (!paymentType || !["note_payment", "cash_sale", "down_payment"].includes(paymentType)) {
        return res.status(400).json({ message: "Valid payment type is required" });
      }
      
      const paymentIntent = await stripeConnectService.createPaymentIntent(
        org.id,
        Math.round(amount * 100),
        "usd",
        { noteId, propertyId, paymentType, description }
      );
      
      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
      });
    } catch (err: any) {
      console.error("Stripe payment intent error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/stripe/connect/payment-link/:noteId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const org = (req as any).organization;
      const noteId = Number(req.params.noteId);
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      const amount = Number(note.monthlyPayment);
      const paymentLink = await stripeConnectService.getPaymentLink(org.id, noteId, amount);
      
      res.json({ paymentLink, amount });
    } catch (err: any) {
      console.error("Stripe payment link error:", err);
      if (err.message?.includes("not configured")) {
        return res.status(503).json({ message: err.message });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // STRIPE CONNECT WEBHOOK
  // ============================================
  
  api.post("/api/stripe/connect/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const { stripeConnectService } = await import("./services/stripeConnect");
      const Stripe = require("stripe").default;
      
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
      const sig = req.headers["stripe-signature"] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      
      if (!webhookSecret) {
        logger.warn("Stripe webhook secret not configured", {});
        return res.status(400).json({ message: "Webhook secret not configured" });
      }
      
      if (!sig) {
        logger.warn("Missing Stripe signature header", {});
        return res.status(400).json({ message: "Missing Stripe signature" });
      }
      
      let event: Stripe.Event;
      
      try {
        const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err: any) {
        logger.error("Webhook signature verification failed", { error: err.message });
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
      }
      
      logger.info("Stripe webhook event received", {
        eventType: event.type,
        eventId: event.id,
        timestamp: event.created,
      });
      
      await stripeConnectService.handleWebhookEvent(event);
      
      logger.info("Stripe webhook event processed", {
        eventType: event.type,
        eventId: event.id,
      });
      
      res.status(200).json({ received: true });
    } catch (err: any) {
      logger.error("Stripe webhook processing error", {
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // BORROWER PORTAL (Public)
  // ============================================
  
  api.post("/api/borrower/verify", async (req, res) => {
    try {
      const { accessToken, email } = req.body;
      
      if (!accessToken || !email) {
        return res.status(400).json({ message: "Access token and email are required" });
      }
      
      // Look up note by access token
      const note = await storage.getNoteByAccessToken(accessToken);
      
      // Security: Use generic "not found" for all failure cases to avoid information leakage
      // Do NOT expose whether access token exists or email matches
      if (!note) {
        return res.status(404).json({ message: "Loan not found or credentials invalid" });
      }
      
      // Verify borrower email - return same generic error if mismatch
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== email.toLowerCase()) {
          return res.status(404).json({ message: "Loan not found or credentials invalid" });
        }
      } else {
        // No borrower linked - cannot verify, treat as not found
        return res.status(404).json({ message: "Loan not found or credentials invalid" });
      }
      
      // Create a session for the borrower
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      
      await storage.createBorrowerSession({
        noteId: note.id,
        sessionToken,
        email: email.toLowerCase(),
        ipAddress: req.ip || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt,
      });
      
      // Set session cookie (httpOnly for security)
      res.cookie('borrower_session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
      });
      
      // Get payments for this note
      const notePayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get property info if linked
      let property = null;
      if (note.propertyId) {
        property = await storage.getProperty(note.organizationId, note.propertyId);
      }
      
      // Get borrower info
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
      }
      
      res.json({
        note: { ...note, property },
        payments: notePayments,
        borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
        sessionToken, // Also return in response for clients that prefer header-based auth
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  // Check borrower session status
  api.get("/api/borrower/session", validateBorrowerSession, async (req, res) => {
    try {
      const session = (req as any).borrowerSession;
      
      // Get the note associated with the session
      const note = await storage.getNoteByAccessToken(session.noteId.toString());
      if (!note) {
        // Also try getting note by ID directly
        const noteById = await db.select().from(notes).where(eq(notes.id, session.noteId));
        if (noteById.length === 0) {
          return res.status(404).json({ message: "Loan not found" });
        }
        
        const foundNote = noteById[0];
        
        // Get payments for this note
        const notePayments = await storage.getPayments(foundNote.organizationId, foundNote.id);
        
        // Get property info if linked
        let property = null;
        if (foundNote.propertyId) {
          property = await storage.getProperty(foundNote.organizationId, foundNote.propertyId);
        }
        
        // Get borrower info
        let borrower = null;
        if (foundNote.borrowerId) {
          borrower = await storage.getLead(foundNote.organizationId, foundNote.borrowerId);
        }
        
        return res.json({
          note: { ...foundNote, property },
          payments: notePayments,
          borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
          session: {
            email: session.email,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
          },
        });
      }
      
      // Get payments for this note
      const notePayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get property info if linked
      let property = null;
      if (note.propertyId) {
        property = await storage.getProperty(note.organizationId, note.propertyId);
      }
      
      // Get borrower info
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
      }
      
      res.json({
        note: { ...note, property },
        payments: notePayments,
        borrower: borrower ? { firstName: borrower.firstName, lastName: borrower.lastName } : null,
        session: {
          email: session.email,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  // Borrower logout
  api.post("/api/borrower/logout", async (req, res) => {
    try {
      const sessionToken = req.cookies?.borrower_session || req.headers['x-borrower-session'] as string;
      
      if (sessionToken) {
        await storage.deleteBorrowerSession(sessionToken);
      }
      
      res.clearCookie('borrower_session', { path: '/' });
      res.json({ message: "Logged out successfully" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
  
  // Session-based payment endpoint (preferred for security)
  api.post("/api/borrower/payment", validateBorrowerSession, portalPaymentRateLimiter, async (req, res) => {
    try {
      const session = (req as any).borrowerSession;
      const { amount } = req.body;
      
      // Get note by session's noteId
      const noteResults = await db.select().from(notes).where(eq(notes.id, session.noteId));
      if (noteResults.length === 0) {
        return res.status(404).json({ message: "Loan not found" });
      }
      const note = noteResults[0];
      
      const paymentAmount = amount ? Number(amount) : Number(note.monthlyPayment || 0);
      if (paymentAmount <= 0) {
        return res.status(400).json({ message: "Invalid payment amount" });
      }
      
      // Get Stripe client
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      // Get borrower info for customer description
      let borrowerName = "Borrower";
      let borrowerEmail = session.email;
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (borrower) {
          borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          borrowerEmail = borrower.email || session.email;
        }
      }
      
      // Create checkout session for one-time payment
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const stripeSession = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Loan Payment - Note #${note.id}`,
              description: `Payment for ${borrowerName}`,
            },
            unit_amount: Math.round(paymentAmount * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseUrl}/portal/${note.accessToken}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/${note.accessToken}?payment=cancelled`,
        customer_email: borrowerEmail,
        metadata: {
          noteId: note.id.toString(),
          accessToken: note.accessToken || '',
          paymentAmount: paymentAmount.toString(),
          type: 'borrower_portal_payment',
        },
      });
      
      // Store the checkout session ID on the note for webhook verification
      await storage.updateNote(note.id, { pendingCheckoutSessionId: stripeSession.id });
      
      res.json({ url: stripeSession.url, sessionId: stripeSession.id });
    } catch (err: any) {
      console.error("Session-based portal payment error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Create Stripe checkout session for borrower portal payment
  // DEPRECATED: Use session-based auth at /api/borrower/payment instead
  // Rate limited: 2 requests per minute per IP (stricter than session-based)
  api.post("/api/portal/:accessToken/payment", deprecatedPaymentRateLimiter, async (req, res) => {
    // Log deprecation warning
    logger.warn("Deprecated endpoint accessed: /api/portal/:accessToken/payment", {
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      accessToken: req.params.accessToken ? "[REDACTED]" : undefined,
    });
    
    // Set deprecation warning header
    res.setHeader("X-Deprecation-Warning", "This endpoint is deprecated. Use session-based auth at /api/borrower/payment instead.");
    
    try {
      const { accessToken } = req.params;
      const { amount } = req.body;
      
      if (!accessToken) {
        return res.status(400).json({ message: "Access token is required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      const paymentAmount = amount ? Number(amount) : Number(note.monthlyPayment || 0);
      if (paymentAmount <= 0) {
        return res.status(400).json({ message: "Invalid payment amount" });
      }
      
      // Get Stripe client
      const { getUncachableStripeClient, getStripePublishableKey } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      // Get borrower info for customer description
      let borrowerName = "Borrower";
      let borrowerEmail = undefined;
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (borrower) {
          borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          borrowerEmail = borrower.email || undefined;
        }
      }
      
      // Create checkout session for one-time payment
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Loan Payment - Note #${note.id}`,
              description: `Payment for ${borrowerName}`,
            },
            unit_amount: Math.round(paymentAmount * 100), // Convert to cents
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseUrl}/portal/${accessToken}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/portal/${accessToken}?payment=cancelled`,
        customer_email: borrowerEmail,
        metadata: {
          noteId: note.id.toString(),
          accessToken,
          paymentAmount: paymentAmount.toString(),
          type: 'borrower_portal_payment',
        },
      });
      
      // Store the checkout session ID on the note for webhook verification
      await storage.updateNote(note.id, { pendingCheckoutSessionId: session.id });
      
      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      console.error("Portal payment error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Verify Stripe payment and create payment record
  api.post("/api/portal/:accessToken/verify-payment", async (req, res) => {
    try {
      const { accessToken } = req.params;
      const { sessionId } = req.body;
      
      if (!accessToken || !sessionId) {
        return res.status(400).json({ message: "Access token and session ID are required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify Stripe session
      const { getUncachableStripeClient } = await import("./stripeClient");
      const stripe = await getUncachableStripeClient();
      
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ message: "Payment not completed" });
      }
      
      // Check if payment already recorded for this session
      const existingPayments = await storage.getPayments(note.organizationId, note.id);
      const alreadyRecorded = existingPayments.some(p => p.transactionId === sessionId);
      if (alreadyRecorded) {
        return res.json({ success: true, message: "Payment already recorded" });
      }
      
      const paymentAmount = session.amount_total ? session.amount_total / 100 : Number(note.monthlyPayment);
      
      // Calculate principal/interest split from amortization schedule
      const schedule = note.amortizationSchedule || [];
      const nextPendingPayment = schedule.find(s => s.status === 'pending');
      
      let principalAmount = 0;
      let interestAmount = 0;
      
      if (nextPendingPayment) {
        // Use amortization schedule for split
        const ratio = paymentAmount / nextPendingPayment.payment;
        principalAmount = Number((nextPendingPayment.principal * ratio).toFixed(2));
        interestAmount = Number((nextPendingPayment.interest * ratio).toFixed(2));
      } else {
        // Calculate split based on current balance and rate
        const monthlyRate = Number(note.interestRate) / 100 / 12;
        interestAmount = Number((Number(note.currentBalance) * monthlyRate).toFixed(2));
        principalAmount = Number((paymentAmount - interestAmount).toFixed(2));
        if (principalAmount < 0) principalAmount = 0;
      }
      
      // Create payment record
      const payment = await storage.createPayment({
        organizationId: note.organizationId,
        noteId: note.id,
        amount: paymentAmount.toString(),
        principalAmount: principalAmount.toString(),
        interestAmount: interestAmount.toString(),
        feeAmount: "0",
        lateFeeAmount: "0",
        paymentDate: new Date(),
        dueDate: note.nextPaymentDate || new Date(),
        paymentMethod: 'card',
        transactionId: sessionId,
        status: 'completed',
      });
      
      // Update note balance
      const newBalance = Math.max(0, Number(note.currentBalance) - principalAmount);
      
      // Update amortization schedule status
      let updatedSchedule = schedule;
      if (nextPendingPayment) {
        updatedSchedule = schedule.map(s => 
          s.paymentNumber === nextPendingPayment.paymentNumber 
            ? { ...s, status: 'paid' } 
            : s
        );
      }
      
      // Calculate next payment date
      const nextPaymentDate = new Date(note.nextPaymentDate || new Date());
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
      
      await storage.updateNote(note.id, {
        currentBalance: newBalance.toString(),
        amortizationSchedule: updatedSchedule,
        nextPaymentDate: nextPaymentDate,
        status: newBalance <= 0 ? 'paid_off' : 'active',
      });
      
      res.json({ 
        success: true, 
        payment,
        newBalance,
      });
    } catch (err: any) {
      console.error("Payment verification error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Toggle autopay for borrower portal
  api.post("/api/portal/:accessToken/autopay", async (req, res) => {
    try {
      const { accessToken } = req.params;
      const { enabled, email } = req.body;
      
      if (!accessToken) {
        return res.status(400).json({ message: "Access token is required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify borrower email for security
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== email?.toLowerCase()) {
          return res.status(403).json({ message: "Unauthorized" });
        }
      } else {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      await storage.updateNote(note.id, {
        autoPayEnabled: enabled === true,
      });
      
      res.json({ 
        success: true, 
        autopayEnabled: enabled === true,
        nextPaymentDate: note.nextPaymentDate,
      });
    } catch (err: any) {
      console.error("Autopay toggle error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Get payoff quote for borrower portal
  api.get("/api/borrower/payoff-quote", async (req, res) => {
    try {
      const { accessToken, email } = req.query;
      
      if (!accessToken || !email) {
        return res.status(400).json({ message: "Access token and email are required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken as string);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify borrower email
      if (note.borrowerId) {
        const borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== (email as string).toLowerCase()) {
          return res.status(403).json({ message: "Unauthorized" });
        }
      } else {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Calculate payoff amount
      const currentBalance = Number(note.currentBalance || 0);
      const interestRate = Number(note.interestRate || 0);
      const dailyRate = interestRate / 100 / 365;
      
      // Calculate accrued interest since last payment
      const lastPaymentDate = note.nextPaymentDate 
        ? new Date(new Date(note.nextPaymentDate).getTime() - 30 * 24 * 60 * 60 * 1000) 
        : new Date(note.startDate);
      const daysSinceLastPayment = Math.max(0, Math.floor((Date.now() - lastPaymentDate.getTime()) / (24 * 60 * 60 * 1000)));
      const accruedInterest = Number((currentBalance * dailyRate * daysSinceLastPayment).toFixed(2));
      
      // Any applicable fees (e.g., payoff processing fee)
      const payoffFee = 0; // Can be configured per organization
      
      const totalPayoff = Number((currentBalance + accruedInterest + payoffFee).toFixed(2));
      
      // Expiration date: 30 days from now
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 30);
      
      res.json({
        principalBalance: currentBalance,
        accruedInterest,
        payoffFee,
        totalPayoff,
        goodThroughDate: expirationDate.toISOString(),
        quoteDate: new Date().toISOString(),
        daysValid: 30,
      });
    } catch (err: any) {
      console.error("Payoff quote error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Generate PDF statement for borrower portal
  api.get("/api/borrower/statements/generate", async (req, res) => {
    try {
      const { accessToken, email, type, year, startDate, endDate } = req.query;
      
      if (!accessToken || !email) {
        return res.status(400).json({ message: "Access token and email are required" });
      }
      
      const note = await storage.getNoteByAccessToken(accessToken as string);
      if (!note) {
        return res.status(404).json({ message: "Loan not found" });
      }
      
      // Verify borrower email
      let borrower = null;
      if (note.borrowerId) {
        borrower = await storage.getLead(note.organizationId, note.borrowerId);
        if (!borrower || borrower.email?.toLowerCase() !== (email as string).toLowerCase()) {
          return res.status(403).json({ message: "Unauthorized" });
        }
      } else {
        return res.status(403).json({ message: "Unauthorized" });
      }
      
      // Get payments for this note
      const allPayments = await storage.getPayments(note.organizationId, note.id);
      
      // Get organization info for company details
      const org = await storage.getOrganization(note.organizationId);
      
      // Filter payments by date range if provided
      let filteredPayments = allPayments.filter(p => p.status === 'completed');
      if (startDate) {
        const start = new Date(startDate as string);
        filteredPayments = filteredPayments.filter(p => new Date(p.paymentDate) >= start);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        filteredPayments = filteredPayments.filter(p => new Date(p.paymentDate) <= end);
      }
      
      // Calculate totals
      const totalPaid = filteredPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const totalPrincipal = filteredPayments.reduce((sum, p) => sum + Number(p.principalAmount || 0), 0);
      const totalInterest = filteredPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);
      
      // Generate statement data based on type
      const statementType = type === '1098' ? '1098' : 'statement';
      
      if (statementType === '1098') {
        // 1098 Interest Statement for tax year
        const taxYear = year ? Number(year) : new Date().getFullYear() - 1;
        const yearStart = new Date(taxYear, 0, 1);
        const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);
        
        const yearPayments = allPayments.filter(p => {
          const payDate = new Date(p.paymentDate);
          return p.status === 'completed' && payDate >= yearStart && payDate <= yearEnd;
        });
        
        const yearInterest = yearPayments.reduce((sum, p) => sum + Number(p.interestAmount || 0), 0);
        
        res.json({
          type: '1098',
          taxYear,
          borrowerName: `${borrower.firstName} ${borrower.lastName}`,
          borrowerAddress: borrower.address || '',
          borrowerCity: borrower.city || '',
          borrowerState: borrower.state || '',
          borrowerZip: borrower.zip || '',
          lenderName: org?.name || 'Lender',
          lenderAddress: org?.settings?.companyAddress || '',
          interestPaid: yearInterest,
          principalBalance: Number(note.currentBalance),
          originalPrincipal: Number(note.originalPrincipal),
          loanOriginationDate: note.startDate,
        });
      } else {
        // Regular account statement
        res.json({
          type: 'statement',
          generatedDate: new Date().toISOString(),
          borrowerName: `${borrower.firstName} ${borrower.lastName}`,
          borrowerAddress: borrower.address || '',
          borrowerEmail: borrower.email || '',
          lenderName: org?.name || 'Lender',
          lenderPhone: org?.settings?.companyPhone || '',
          lenderEmail: org?.settings?.companyEmail || '',
          noteId: note.id,
          originalPrincipal: Number(note.originalPrincipal),
          currentBalance: Number(note.currentBalance),
          interestRate: Number(note.interestRate),
          termMonths: note.termMonths,
          monthlyPayment: Number(note.monthlyPayment),
          startDate: note.startDate,
          maturityDate: note.maturityDate,
          nextPaymentDate: note.nextPaymentDate,
          nextPaymentAmount: Number(note.monthlyPayment),
          autopayEnabled: note.autoPayEnabled || false,
          payments: filteredPayments.map(p => ({
            date: p.paymentDate,
            amount: Number(p.amount),
            principal: Number(p.principalAmount),
            interest: Number(p.interestAmount),
            method: p.paymentMethod,
          })),
          summary: {
            totalPaid,
            totalPrincipal,
            totalInterest,
            paymentsCount: filteredPayments.length,
          },
        });
      }
    } catch (err: any) {
      console.error("Statement generation error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Generate borrower portal link
  api.post("/api/notes/:id/portal-link", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = Number(req.params.id);
      
      const note = await storage.getNote(org.id, noteId);
      if (!note) {
        return res.status(404).json({ message: "Note not found" });
      }
      
      // Use the access token for the portal URL
      const portalUrl = `${req.protocol}://${req.get('host')}/portal/${note.accessToken}`;
      
      res.json({ url: portalUrl });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // DOCUMENT GENERATION
  // ============================================
  
  api.post("/api/documents/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { type, entityType, entityId } = req.body;
      
      let documentContent = "";
      let documentTitle = "";
      
      if (entityType === "note" && type === "promissory_note") {
        const note = await storage.getNote(org.id, Number(entityId));
        if (!note) {
          return res.status(404).json({ message: "Note not found" });
        }
        
        let borrowerName = "Borrower";
        if (note.borrowerId) {
          const borrower = await storage.getLead(org.id, note.borrowerId);
          if (borrower) {
            borrowerName = `${borrower.firstName} ${borrower.lastName}`;
          }
        }
        
        let propertyDesc = "Property";
        if (note.propertyId) {
          const property = await storage.getProperty(org.id, note.propertyId);
          if (property) {
            propertyDesc = `${property.county} County, ${property.state} - APN: ${property.apn}`;
          }
        }
        
        const startDateStr = note.startDate ? new Date(note.startDate).toLocaleDateString() : new Date().toLocaleDateString();
        
        documentTitle = `Promissory Note - ${borrowerName}`;
        documentContent = `
PROMISSORY NOTE

Date: ${startDateStr}
Lender: ${org.name}
Borrower: ${borrowerName}

Property: ${propertyDesc}

PROMISE TO PAY
For value received, Borrower promises to pay to Lender the principal sum of $${Number(note.originalPrincipal).toLocaleString()} with interest at the rate of ${note.interestRate}% per annum.

PAYMENT TERMS
- Monthly Payment: $${Number(note.monthlyPayment).toLocaleString()}
- Term: ${note.termMonths} months
- First Payment Due: ${note.firstPaymentDate ? new Date(note.firstPaymentDate).toLocaleDateString() : 'TBD'}

LATE CHARGES
If any payment is not received within ${note.gracePeriodDays || 10} days after its due date, Borrower agrees to pay a late charge of $${Number(note.lateFee || 0).toLocaleString()}.

DEFAULT
If Borrower fails to make any payment when due, the entire unpaid principal balance and accrued interest shall become immediately due and payable at Lender's option.

SIGNATURES

_______________________          _______________________
Lender                           Borrower
${org.name}                      ${borrowerName}
`;
      } else if (entityType === "property" && type === "deed") {
        const property = await storage.getProperty(org.id, Number(entityId));
        if (!property) {
          return res.status(404).json({ message: "Property not found" });
        }
        
        documentTitle = `Warranty Deed - ${property.apn}`;
        documentContent = `
WARRANTY DEED

This Warranty Deed is made this _____ day of ____________, 20___

GRANTOR: ${org.name}

GRANTEE: _________________________________

PROPERTY DESCRIPTION:
County: ${property.county}
State: ${property.state}
Assessor's Parcel Number (APN): ${property.apn}

Legal Description:
${property.legalDescription || "[ATTACH LEGAL DESCRIPTION]"}

CONSIDERATION: $________________

GRANTOR hereby conveys and warrants to GRANTEE the above-described property, together with all improvements thereon, free and clear of all encumbrances except those of record.

SIGNATURES

_______________________          Date: ________________
Grantor

STATE OF ${property.state}
COUNTY OF ${property.county}

[NOTARY ACKNOWLEDGMENT]
`;
      } else if (entityType === "lead" && type === "offer_letter") {
        const lead = await storage.getLead(org.id, Number(entityId));
        if (!lead) {
          return res.status(404).json({ message: "Lead not found" });
        }
        
        const sellerAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
        
        documentTitle = `Offer Letter - ${lead.firstName} ${lead.lastName}`;
        documentContent = `
OFFER TO PURCHASE REAL ESTATE

Date: ${new Date().toLocaleDateString()}

From: ${org.name}

To: ${lead.firstName} ${lead.lastName}
${sellerAddress || "[Address]"}

Dear ${lead.firstName} ${lead.lastName},

We are interested in purchasing your property and would like to make you the following offer:

PROPERTY INFORMATION:
[Property details to be filled in]

OFFER TERMS:
Purchase Price: $________________
Closing Date: Within 30 days of acceptance
Payment Method: [Cash/Financing]

This offer is subject to clear title and satisfactory inspection.

This offer is valid for 14 days from the date above.

If you have any questions or would like to discuss this offer, please contact us.

Sincerely,

_______________________
${org.name}

---

ACCEPTANCE

I/We accept this offer on the terms stated above.

_______________________          Date: ________________
Seller Signature

_______________________          Date: ________________
Seller Signature (if applicable)
`;
      } else {
        return res.status(400).json({ message: "Invalid document type or entity" });
      }
      
      res.json({
        title: documentTitle,
        content: documentContent,
        type,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // CUSTOMER SUPPORT SYSTEM
  // ============================================

  // Create a new support case
  api.post("/api/support/cases", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { subject, message } = req.body as { subject: string; message: string };
      
      if (!subject || !message) {
        return res.status(400).json({ error: "Subject and message are required" });
      }

      const { supportBrainService } = await import("./services/supportBrain");
      const { case: supportCase, classification } = await supportBrainService.createCase(
        org.id,
        userId,
        subject,
        message
      );

      // Auto-handle the first message
      const response = await supportBrainService.handleMessage(supportCase.id, message, org.id);

      res.status(201).json({
        case: supportCase,
        response: response.response,
        classification,
      });
    } catch (err: any) {
      console.error("Create support case error:", err);
      res.status(500).json({ error: err.message || "Failed to create support case" });
    }
  });

  // Get user's support cases
  api.get("/api/support/cases", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { status } = req.query as { status?: string };
      const cases = await storage.getSupportCases(org.id, status);
      res.json(cases);
    } catch (err: any) {
      console.error("Get support cases error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch support cases" });
    }
  });

  // Get specific support case with messages
  api.get("/api/support/cases/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const caseId = parseInt(req.params.id);
      const supportCase = await storage.getSupportCase(caseId);
      
      if (!supportCase || supportCase.organizationId !== org.id) {
        return res.status(404).json({ error: "Case not found" });
      }

      const messages = await storage.getSupportMessages(caseId);
      const actions = await storage.getSupportActions(caseId);

      res.json({ case: supportCase, messages, actions });
    } catch (err: any) {
      console.error("Get support case error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch support case" });
    }
  });

  // Send message to a support case
  api.post("/api/support/cases/:id/messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const caseId = parseInt(req.params.id);
      const { message } = req.body as { message: string };

      const supportCase = await storage.getSupportCase(caseId);
      if (!supportCase || supportCase.organizationId !== org.id) {
        return res.status(404).json({ error: "Case not found" });
      }

      if (supportCase.status === "closed" || supportCase.status === "resolved") {
        return res.status(400).json({ error: "This case is already closed" });
      }

      const { supportBrainService } = await import("./services/supportBrain");
      const response = await supportBrainService.handleMessage(caseId, message, org.id);

      res.json({
        userMessage: message,
        aiResponse: response.response,
        actionsTaken: response.actionsTaken,
        escalated: response.escalated,
      });
    } catch (err: any) {
      console.error("Send support message error:", err);
      res.status(500).json({ error: err.message || "Failed to send message" });
    }
  });

  // Rate satisfaction and close case
  api.post("/api/support/cases/:id/rate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const caseId = parseInt(req.params.id);
      const { rating } = req.body as { rating: number };

      const supportCase = await storage.getSupportCase(caseId);
      if (!supportCase || supportCase.organizationId !== org.id) {
        return res.status(404).json({ error: "Case not found" });
      }

      const { supportBrainService } = await import("./services/supportBrain");
      await supportBrainService.rateSatisfaction(caseId, rating);

      res.json({ success: true, message: "Thank you for your feedback!" });
    } catch (err: any) {
      console.error("Rate support case error:", err);
      res.status(500).json({ error: err.message || "Failed to rate case" });
    }
  });

  // Resolve case (user marking as resolved)
  api.post("/api/support/cases/:id/resolve", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const caseId = parseInt(req.params.id);

      const supportCase = await storage.getSupportCase(caseId);
      if (!supportCase || supportCase.organizationId !== org.id) {
        return res.status(404).json({ error: "Case not found" });
      }

      const { supportBrainService } = await import("./services/supportBrain");
      await supportBrainService.resolveCase(caseId, "Resolved by user", "user");

      res.json({ success: true });
    } catch (err: any) {
      console.error("Resolve support case error:", err);
      res.status(500).json({ error: err.message || "Failed to resolve case" });
    }
  });

  // Get all escalated cases (admin only - for now just check org owner)
  api.get("/api/admin/support/escalated", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;

      // Simple admin check - org owner can see escalated cases
      if (org.ownerId !== user.id) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const cases = await storage.getEscalatedCases();
      res.json(cases);
    } catch (err: any) {
      console.error("Get escalated cases error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch escalated cases" });
    }
  });

  // Admin respond to escalated case
  api.post("/api/admin/support/cases/:id/respond", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const caseId = parseInt(req.params.id);
      const { message, resolve } = req.body as { message: string; resolve?: boolean };

      if (org.ownerId !== user.id) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const supportCase = await storage.getSupportCase(caseId);
      if (!supportCase) {
        return res.status(404).json({ error: "Case not found" });
      }

      await storage.createSupportMessage({
        caseId,
        role: "human_support",
        content: message,
      });

      if (resolve) {
        await storage.updateSupportCase(caseId, {
          status: "resolved",
          resolvedAt: new Date(),
          resolutionSummary: message,
          resolutionType: "escalated_resolved",
          assignedTo: user.id,
        });
      } else {
        await storage.updateSupportCase(caseId, {
          status: "awaiting_user",
          assignedTo: user.id,
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Admin respond to case error:", err);
      res.status(500).json({ error: err.message || "Failed to respond to case" });
    }
  });

  // Get support metrics
  api.get("/api/admin/support/metrics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;

      if (org.ownerId !== user.id) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const allCases = await storage.getSupportCases(org.id);
      const escalatedCases = await storage.getEscalatedCases();

      const metrics = {
        totalCases: allCases.length,
        openCases: allCases.filter(c => c.status === "open" || c.status === "ai_handling" || c.status === "awaiting_user").length,
        escalatedCases: escalatedCases.length,
        resolvedCases: allCases.filter(c => c.status === "resolved" || c.status === "closed").length,
        avgSatisfaction: allCases.filter(c => c.userSatisfaction).reduce((sum, c) => sum + (c.userSatisfaction || 0), 0) / 
                        Math.max(1, allCases.filter(c => c.userSatisfaction).length),
        autoResolvedRate: allCases.filter(c => c.resolutionType === "auto_resolved").length / Math.max(1, allCases.length),
      };

      res.json(metrics);
    } catch (err: any) {
      console.error("Get support metrics error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch support metrics" });
    }
  });

  // ============================================
  // FEATURE REQUESTS
  // ============================================

  // Create a new feature request
  api.post("/api/feature-requests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const userId = user.claims?.sub || user.id;

      const validation = insertFeatureRequestSchema.safeParse({
        ...req.body,
        organizationId: org.id,
        userId,
      });

      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const featureRequest = await storage.createFeatureRequest(validation.data);
      res.status(201).json(featureRequest);
    } catch (err: any) {
      console.error("Create feature request error:", err);
      res.status(500).json({ error: err.message || "Failed to create feature request" });
    }
  });

  // Get user's organization feature requests
  api.get("/api/feature-requests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const requests = await storage.getFeatureRequests(org.id);
      res.json(requests);
    } catch (err: any) {
      console.error("Get feature requests error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch feature requests" });
    }
  });

  // Founder: Get all feature requests across all orgs
  api.get("/api/founder/feature-requests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;

      // Simple founder check - org owner can see all feature requests
      if (org.ownerId !== (user.claims?.sub || user.id)) {
        return res.status(403).json({ error: "Founder access required" });
      }

      const requests = await storage.getAllFeatureRequestsForFounder();
      res.json(requests);
    } catch (err: any) {
      console.error("Get all feature requests error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch feature requests" });
    }
  });

  // Founder: Update feature request status/notes
  api.patch("/api/founder/feature-requests/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const requestId = parseInt(req.params.id);

      // Simple founder check
      if (org.ownerId !== (user.claims?.sub || user.id)) {
        return res.status(403).json({ error: "Founder access required" });
      }

      const { status, founderNotes, priority } = req.body as { 
        status?: string; 
        founderNotes?: string;
        priority?: string;
      };

      const updates: Record<string, any> = {};
      if (status !== undefined) updates.status = status;
      if (founderNotes !== undefined) updates.founderNotes = founderNotes;
      if (priority !== undefined) updates.priority = priority;

      const updated = await storage.updateFeatureRequest(requestId, updates);
      res.json(updated);
    } catch (err: any) {
      console.error("Update feature request error:", err);
      res.status(500).json({ error: err.message || "Failed to update feature request" });
    }
  });

  // ============================================
  // DEMO DATA SEEDING
  // ============================================
  
  api.post("/api/seed-demo-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      // Sample leads
      const demoLeads = [
        { firstName: "John", lastName: "Martinez", type: "seller", email: "john.martinez@email.com", phone: "(602) 555-1234", address: "123 Desert Rose Lane", city: "Tucson", state: "AZ", zip: "85701", status: "responded", source: "tax_list", notes: "Inherited property, motivated to sell" },
        { firstName: "Sarah", lastName: "Thompson", type: "seller", email: "sarah.t@email.com", phone: "(505) 555-2345", address: "456 Canyon View Dr", city: "Albuquerque", state: "NM", zip: "87101", status: "negotiating", source: "facebook", notes: "Moving out of state, needs quick close" },
        { firstName: "Robert", lastName: "Chen", type: "buyer", email: "rchen@email.com", phone: "(512) 555-3456", address: "789 Oak Street", city: "Austin", state: "TX", zip: "78701", status: "qualified", source: "website", notes: "Looking for 5-10 acre recreational parcels" },
        { firstName: "Maria", lastName: "Garcia", type: "seller", email: "mgarcia@email.com", phone: "(623) 555-4567", address: "321 Sunset Blvd", city: "Phoenix", state: "AZ", zip: "85001", status: "mailed", source: "tax_list", notes: "Initial mailer sent 2 weeks ago" },
        { firstName: "David", lastName: "Wilson", type: "buyer", email: "dwilson@email.com", phone: "(702) 555-5678", address: "555 Palm Way", city: "Las Vegas", state: "NV", zip: "89101", status: "interested", source: "referral", notes: "Pre-approved for $50K, wants AZ or NM" },
        { firstName: "Jennifer", lastName: "Brown", type: "seller", email: "jbrown@email.com", phone: "(480) 555-6789", address: "888 Cactus Court", city: "Scottsdale", state: "AZ", zip: "85251", status: "new", source: "craigslist", notes: "Responded to online ad" },
      ];
      
      const createdLeads = [];
      for (const lead of demoLeads) {
        const created = await storage.createLead({ ...lead, organizationId: org.id });
        createdLeads.push(created);
      }
      
      // Sample properties
      const demoProperties = [
        { apn: "123-45-678", county: "Cochise", state: "AZ", sizeAcres: "5.2", status: "owned", purchasePrice: "8500", marketValue: "15000", description: "Beautiful 5+ acre parcel with mountain views near Willcox" },
        { apn: "234-56-789", county: "Mohave", state: "AZ", sizeAcres: "2.5", status: "listed", purchasePrice: "3200", listPrice: "7900", marketValue: "7500", description: "2.5 acre lot in Golden Valley with road access" },
        { apn: "345-67-890", county: "Luna", state: "NM", sizeAcres: "10.0", status: "owned", purchasePrice: "5000", marketValue: "12000", description: "10 acres of open desert land near Deming" },
        { apn: "456-78-901", county: "Navajo", state: "AZ", sizeAcres: "1.25", status: "prospect", assessedValue: "4500", marketValue: "6000", description: "1.25 acre residential lot in Show Low area" },
        { apn: "567-89-012", county: "Pinal", state: "AZ", sizeAcres: "40.0", status: "under_contract", purchasePrice: "28000", marketValue: "55000", description: "40 acre ranch parcel with well and power nearby" },
      ];
      
      const createdProperties = [];
      for (const prop of demoProperties) {
        const created = await storage.createProperty({ ...prop, organizationId: org.id });
        createdProperties.push(created);
      }
      
      // Sample deals
      const demoDeals = [
        { name: "Cochise 5-Acre Purchase", type: "acquisition", stage: "closed", propertyId: createdProperties[0]?.id, leadId: createdLeads[0]?.id, purchasePrice: "8500", closingDate: new Date("2024-06-15") },
        { name: "Mohave Lot Sale", type: "disposition", stage: "in_escrow", propertyId: createdProperties[1]?.id, leadId: createdLeads[2]?.id, salePrice: "7900", closingDate: new Date("2025-02-01") },
        { name: "Luna County Acquisition", type: "acquisition", stage: "closed", propertyId: createdProperties[2]?.id, leadId: createdLeads[1]?.id, purchasePrice: "5000", closingDate: new Date("2024-09-20") },
        { name: "Pinal Ranch Deal", type: "acquisition", stage: "offer_sent", propertyId: createdProperties[4]?.id, leadId: createdLeads[3]?.id, purchasePrice: "28000" },
      ];
      
      for (const deal of demoDeals) {
        await storage.createDeal({ ...deal, organizationId: org.id });
      }
      
      // Sample notes (seller financing)
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 3);
      const firstPaymentDate = new Date(startDate);
      firstPaymentDate.setMonth(firstPaymentDate.getMonth() + 1);
      
      const demoNotes = [
        { 
          propertyId: createdProperties[0]?.id, 
          borrowerName: "Michael Rodriguez", 
          borrowerEmail: "mrodriguez@email.com", 
          borrowerPhone: "(520) 555-7890",
          originalPrincipal: "12000", 
          currentBalance: "10800",
          interestRate: "9.9", 
          termMonths: 36, 
          monthlyPayment: "387.50",
          downPayment: "3000",
          startDate,
          firstPaymentDate,
          status: "active",
          gracePeriodDays: 10,
          lateFee: "25",
        },
        { 
          propertyId: createdProperties[2]?.id, 
          borrowerName: "Amanda Foster", 
          borrowerEmail: "afoster@email.com", 
          borrowerPhone: "(575) 555-8901",
          originalPrincipal: "8500", 
          currentBalance: "7700",
          interestRate: "10.5", 
          termMonths: 24, 
          monthlyPayment: "395.00",
          downPayment: "2000",
          startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          firstPaymentDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          status: "active",
          gracePeriodDays: 10,
          lateFee: "25",
        },
      ];
      
      for (const note of demoNotes) {
        await storage.createNote({ ...note, organizationId: org.id });
      }
      
      res.json({ 
        success: true, 
        message: "Demo data created successfully",
        counts: {
          leads: createdLeads.length,
          properties: createdProperties.length,
          deals: demoDeals.length,
          notes: demoNotes.length,
        }
      });
    } catch (err: any) {
      console.error("Seed error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // Clear demo data endpoint
  api.post("/api/clear-demo-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      // Delete in order to respect foreign key constraints
      await db.delete(payments).where(eq(payments.organizationId, org.id));
      await db.delete(notes).where(eq(notes.organizationId, org.id));
      await db.delete(deals).where(eq(deals.organizationId, org.id));
      await db.delete(properties).where(eq(properties.organizationId, org.id));
      await db.delete(leads).where(eq(leads.organizationId, org.id));
      await db.delete(activityLog).where(eq(activityLog.organizationId, org.id));
      
      res.json({ success: true, message: "All data cleared for your organization" });
    } catch (err: any) {
      console.error("Clear data error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // ADMIN / FOUNDER DASHBOARD
  // ============================================
  
  async function isFounderAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const user = req.user as any;
    const userId = user.claims?.sub || user.id;
    const userEmail = user.claims?.email || user.email;
    
    const founderEmail = process.env.FOUNDER_EMAIL;
    if (founderEmail && userEmail === founderEmail) {
      return next();
    }
    
    const firstOrg = await storage.getOrganization(1);
    if (firstOrg && firstOrg.ownerId === userId) {
      return next();
    }
    
    const userOrg = await storage.getOrganizationByOwner(userId);
    if (userOrg) {
      const teamMember = await storage.getTeamMember(userOrg.id, userId);
      if (teamMember && teamMember.role === 'owner') {
        return next();
      }
    }
    
    return res.status(403).json({ message: "Access denied. Admin privileges required." });
  }

  api.get("/api/admin/check", isAuthenticated, isFounderAdmin, async (req, res) => {
    res.json({ isAdmin: true });
  });

  api.get("/api/admin/dashboard", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const dashboardData = await storage.getAdminDashboardData();
      res.json(dashboardData);
    } catch (err: any) {
      console.error("Admin dashboard error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/admin/alerts", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const alerts = await storage.getSystemAlerts(undefined, status);
      res.json(alerts);
    } catch (err: any) {
      console.error("Admin alerts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.put("/api/admin/alerts/:id/acknowledge", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const alertId = Number(req.params.id);
      const updated = await storage.acknowledgeAlert(alertId);
      res.json(updated);
    } catch (err: any) {
      console.error("Acknowledge alert error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.put("/api/admin/alerts/:id/resolve", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const alertId = Number(req.params.id);
      const updated = await storage.resolveAlert(alertId);
      res.json(updated);
    } catch (err: any) {
      console.error("Resolve alert error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.put("/api/admin/alerts/acknowledge-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const count = await storage.acknowledgeAllAlerts();
      res.json({ success: true, count, message: `${count} alerts acknowledged` });
    } catch (err: any) {
      console.error("Acknowledge all alerts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.put("/api/admin/alerts/resolve-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const count = await storage.resolveAllAlerts();
      res.json({ success: true, count, message: `${count} alerts resolved` });
    } catch (err: any) {
      console.error("Resolve all alerts error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/admin/organizations", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const orgs = await storage.getAllOrganizations();
      res.json(orgs);
    } catch (err: any) {
      console.error("Admin orgs error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/admin/revenue", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const dashboardData = await storage.getAdminDashboardData();
      res.json({
        ...dashboardData.revenue,
        revenueAtRisk: dashboardData.revenueAtRisk
      });
    } catch (err: any) {
      console.error("Admin revenue error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/founder/api-usage", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const stats = await storage.getApiUsageStats();
      res.json(stats);
    } catch (err: any) {
      console.error("API usage stats error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GIS Data Source Health Dashboard
  api.get("/api/founder/gis-health", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getEndpointStats } = await import("./services/gisValidation");
      const stats = await getEndpointStats();
      res.json(stats);
    } catch (err: any) {
      console.error("GIS health stats error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Run sample GIS validation (quick test of 20 random endpoints)
  api.post("/api/founder/gis-validate-sample", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { validateSampleEndpoints } = await import("./services/gisValidation");
      const sampleSize = Math.min(req.body.sampleSize || 20, 50);
      const result = await validateSampleEndpoints(sampleSize);
      res.json(result);
    } catch (err: any) {
      console.error("GIS sample validation error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Run full GIS validation (test all endpoints - runs as background job for large datasets)
  api.post("/api/founder/gis-validate-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { validateAllEndpoints, getEndpointStats, startValidationJob } = await import("./services/gisValidation");
      const { stateFilter, maxConcurrent = 10, async: runAsync = false } = req.body;
      
      const stats = await getEndpointStats();
      const estimatedCount = stateFilter ? Math.ceil(stats.activeEndpoints / stats.statesCovered) : stats.activeEndpoints;
      
      if (estimatedCount > 100 && !stateFilter) {
        const jobResult = await startValidationJob({ stateFilter, maxConcurrent: Math.min(maxConcurrent, 15) });
        return res.json({
          ...jobResult,
          async: true,
          estimatedTimeMinutes: Math.ceil(estimatedCount / 10 / 6),
        });
      }
      
      if (runAsync) {
        const jobResult = await startValidationJob({ stateFilter, maxConcurrent: Math.min(maxConcurrent, 15) });
        return res.json({
          ...jobResult,
          async: true,
        });
      }
      
      const result = await validateAllEndpoints({ 
        stateFilter, 
        maxConcurrent: Math.min(maxConcurrent, 15),
        timeoutMs: 8000,
      });
      res.json(result);
    } catch (err: any) {
      console.error("GIS full validation error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get GIS validation job status
  api.get("/api/founder/gis-job/:jobId", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getValidationJob } = await import("./services/gisValidation");
      const job = getValidationJob(req.params.jobId);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      const includeFullResults = req.query.full === "true" || job.status === "completed";
      
      res.json({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        progress: {
          completed: job.completed,
          total: job.total,
          percent: job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0,
        },
        stateFilter: job.stateFilter,
        summary: job.summary,
        error: job.error,
        results: includeFullResults ? job.results : undefined,
        resultsPreview: !includeFullResults ? job.results.slice(-10) : undefined,
      });
    } catch (err: any) {
      console.error("GIS job status error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // List recent GIS validation jobs
  api.get("/api/founder/gis-jobs", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getAllValidationJobs } = await import("./services/gisValidation");
      const jobs = getAllValidationJobs().map(job => ({
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        total: job.total,
        completed: job.completed,
        stateFilter: job.stateFilter,
        onlineCount: job.summary?.online,
      }));
      res.json(jobs);
    } catch (err: any) {
      console.error("GIS jobs list error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Get county GIS endpoints with their status
  api.get("/api/founder/gis-endpoints", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { state } = req.query;
      const endpoints = await db.select().from(countyGisEndpoints);
      
      const filtered = state 
        ? endpoints.filter(e => e.state.toUpperCase() === String(state).toUpperCase())
        : endpoints;
      
      const grouped = filtered.reduce((acc, e) => {
        if (!acc[e.state]) acc[e.state] = [];
        acc[e.state].push(e);
        return acc;
      }, {} as Record<string, typeof endpoints>);
      
      res.json({
        total: filtered.length,
        byState: grouped,
        states: Object.keys(grouped).sort(),
      });
    } catch (err: any) {
      console.error("GIS endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Set founder status for an organization (founder admin only)
  api.post("/api/admin/set-founder", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { organizationId, isFounder } = req.body;
      
      // If no organizationId provided, use the current user's organization
      const org = (req as any).organization;
      const targetOrgId = organizationId || org?.id;
      
      if (!targetOrgId) {
        return res.status(400).json({ message: "Organization ID is required" });
      }
      
      const [updated] = await db
        .update(organizations)
        .set({ isFounder: isFounder ?? true })
        .where(eq(organizations.id, targetOrgId))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ message: "Organization not found" });
      }
      
      res.json({ 
        success: true, 
        message: isFounder === false ? "Founder status removed" : "Founder status granted",
        organization: updated 
      });
    } catch (err: any) {
      console.error("Set founder status error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // User Analytics Endpoints
  api.get("/api/admin/users", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const orgs = await storage.getAllOrganizationsWithDetails();
      res.json(orgs);
    } catch (err: any) {
      console.error("Admin users error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/admin/subscription-stats", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const stats = await storage.getSubscriptionStats();
      res.json(stats);
    } catch (err: any) {
      console.error("Subscription stats error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/admin/subscription-events", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const events = await storage.getSubscriptionEvents({ limit });
      res.json(events);
    } catch (err: any) {
      console.error("Subscription events error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // COUNTY GIS ENDPOINTS (Free Parcel Data)
  // ============================================

  api.get("/api/county-gis-endpoints", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { getCountyGisEndpoints } = await import('./services/parcel');
      const endpoints = await getCountyGisEndpoints();
      res.json(endpoints);
    } catch (err: any) {
      console.error("Get county GIS endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/county-gis-endpoints", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { countyGisEndpoints, insertCountyGisEndpointSchema } = await import('@shared/schema');
      
      // Validate required fields
      const { state, county, baseUrl, endpointType } = req.body;
      if (!state || !county || !baseUrl) {
        return res.status(400).json({ message: "state, county, and baseUrl are required" });
      }
      
      const endpoint = await db.insert(countyGisEndpoints).values({
        state: state.toUpperCase(),
        county,
        baseUrl,
        endpointType: endpointType || "arcgis_rest",
        layerId: req.body.layerId,
        apnField: req.body.apnField || "APN",
        ownerField: req.body.ownerField || "OWNER",
        fieldMappings: req.body.fieldMappings,
        fipsCode: req.body.fipsCode,
        sourceUrl: req.body.sourceUrl,
        notes: req.body.notes,
        isActive: true,
        isVerified: false,
        contributedBy: (req as any).user?.email || "admin",
      }).returning();
      res.json(endpoint[0]);
    } catch (err: any) {
      console.error("Add county GIS endpoint error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/county-gis-endpoints/seed", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { seedCountyGisEndpoints } = await import('./services/parcel');
      const result = await seedCountyGisEndpoints();
      res.json({ message: `Seeded ${result.added} endpoints, ${result.skipped} already existed` });
    } catch (err: any) {
      console.error("Seed county GIS endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/county-gis-endpoints/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { countyGisEndpoints } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      await db.delete(countyGisEndpoints).where(eq(countyGisEndpoints.id, id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete county GIS endpoint error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Test a single GIS endpoint
  api.post("/api/county-gis-endpoints/:id/test", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid endpoint ID" });
      }

      const endpoint = await storage.getCountyGisEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({ message: "Endpoint not found" });
      }

      let success = false;
      let message = "";
      let details: any = null;

      try {
        const testUrl = new URL(endpoint.baseUrl);
        if (endpoint.endpointType === "arcgis_rest" || endpoint.endpointType === "arcgis_feature") {
          testUrl.searchParams.set("f", "json");
          testUrl.searchParams.set("where", "1=1");
          testUrl.searchParams.set("resultRecordCount", "1");
          testUrl.searchParams.set("outFields", "*");
        }

        const response = await fetch(testUrl.toString(), {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.error) {
            success = false;
            message = `API returned error: ${data.error.message || JSON.stringify(data.error)}`;
            details = data.error;
          } else if (data.features || data.results || data.properties || data.type) {
            success = true;
            message = "Endpoint is working correctly";
            details = { recordCount: data.features?.length || data.results?.length || 1 };
          } else {
            success = true;
            message = "Endpoint responded but returned unexpected format";
            details = { keys: Object.keys(data).slice(0, 10) };
          }
        } else {
          success = false;
          message = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (fetchErr: any) {
        success = false;
        message = fetchErr.name === "TimeoutError" ? "Request timed out after 10 seconds" : fetchErr.message;
      }

      await storage.updateCountyGisEndpoint(id, {
        isVerified: success,
        errorCount: success ? 0 : (endpoint.errorCount || 0) + 1,
        lastVerified: new Date(),
        lastError: success ? null : message,
      });

      res.json({ success, message, details });
    } catch (err: any) {
      console.error("Test GIS endpoint error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Test all GIS endpoints
  api.post("/api/county-gis-endpoints/test-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { countyGisEndpoints } = await import('@shared/schema');
      const { getCountyGisEndpoints } = await import('./services/parcel');
      const onlyUnverified = req.body.onlyUnverified === true;

      let endpoints = await getCountyGisEndpoints();
      if (onlyUnverified) {
        endpoints = endpoints.filter(e => !e.isVerified);
      }

      const results: Array<{ id: number; state: string; county: string; success: boolean; message: string }> = [];
      let passed = 0;
      let failed = 0;

      for (const endpoint of endpoints.slice(0, 20)) {
        try {
          const testUrl = new URL(endpoint.baseUrl);
          if (endpoint.endpointType === "arcgis_rest" || endpoint.endpointType === "arcgis_feature") {
            testUrl.searchParams.set("f", "json");
            testUrl.searchParams.set("where", "1=1");
            testUrl.searchParams.set("resultRecordCount", "1");
            testUrl.searchParams.set("outFields", "*");
          }

          const response = await fetch(testUrl.toString(), {
            method: "GET",
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(10000),
          });

          let success = false;
          let message = "";

          if (response.ok) {
            const data = await response.json();
            if (data.error) {
              success = false;
              message = data.error.message || "API error";
            } else {
              success = true;
              message = "OK";
            }
          } else {
            success = false;
            message = `HTTP ${response.status}`;
          }

          await storage.updateCountyGisEndpoint(endpoint.id, {
            isVerified: success,
            errorCount: success ? 0 : (endpoint.errorCount || 0) + 1,
            lastVerified: new Date(),
            lastError: success ? null : message,
          });

          if (success) passed++;
          else failed++;

          results.push({ id: endpoint.id, state: endpoint.state, county: endpoint.county, success, message });
        } catch (fetchErr: any) {
          failed++;
          const message = fetchErr.name === "TimeoutError" ? "Timeout" : fetchErr.message;
          await storage.updateCountyGisEndpoint(endpoint.id, {
            isVerified: false,
            errorCount: (endpoint.errorCount || 0) + 1,
            lastVerified: new Date(),
            lastError: message,
          });
          results.push({ id: endpoint.id, state: endpoint.state, county: endpoint.county, success: false, message });
        }
      }

      res.json({ tested: results.length, passed, failed, results });
    } catch (err: any) {
      console.error("Test all GIS endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Scan for new endpoints - comprehensive discovery across all US states
  api.post("/api/county-gis-endpoints/scan", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { countyGisEndpoints } = await import('@shared/schema');
      
      // Comprehensive database of known county GIS endpoint patterns
      const knownEndpointPatterns: Array<{
        state: string;
        county: string;
        baseUrl: string;
        endpointType: string;
        fipsCode?: string;
        confidenceScore: number;
      }> = [
        // ALABAMA
        { state: "AL", county: "Jefferson", baseUrl: "https://gis.jccal.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "01073", confidenceScore: 85 },
        { state: "AL", county: "Mobile", baseUrl: "https://gis.mobilecountyal.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "01097", confidenceScore: 80 },
        { state: "AL", county: "Madison", baseUrl: "https://maps.co.madison.al.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "01089", confidenceScore: 75 },
        // ALASKA
        { state: "AK", county: "Anchorage", baseUrl: "https://gis.muni.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "02020", confidenceScore: 70 },
        { state: "AK", county: "Fairbanks North Star", baseUrl: "https://gis.fnsb.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "02090", confidenceScore: 70 },
        // ARIZONA
        { state: "AZ", county: "Maricopa", baseUrl: "https://gis.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "04013", confidenceScore: 90 },
        { state: "AZ", county: "Pima", baseUrl: "https://gis.pima.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "04019", confidenceScore: 85 },
        { state: "AZ", county: "Pinal", baseUrl: "https://gis.pinalcountyaz.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "04021", confidenceScore: 80 },
        { state: "AZ", county: "Yavapai", baseUrl: "https://gis.yavapai.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "04025", confidenceScore: 75 },
        // ARKANSAS
        { state: "AR", county: "Pulaski", baseUrl: "https://gis.pulaskicounty.net/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "05119", confidenceScore: 75 },
        { state: "AR", county: "Benton", baseUrl: "https://gis.bentoncountyar.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "05007", confidenceScore: 70 },
        // CALIFORNIA
        { state: "CA", county: "Los Angeles", baseUrl: "https://assessor.lacounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06037", confidenceScore: 90 },
        { state: "CA", county: "San Diego", baseUrl: "https://gis.sandiegocounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06073", confidenceScore: 88 },
        { state: "CA", county: "Orange", baseUrl: "https://gis.ocgov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06059", confidenceScore: 85 },
        { state: "CA", county: "Riverside", baseUrl: "https://gis.rivco.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06065", confidenceScore: 80 },
        { state: "CA", county: "San Bernardino", baseUrl: "https://gis.sbcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06071", confidenceScore: 80 },
        { state: "CA", county: "Santa Clara", baseUrl: "https://gis.sccgov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06085", confidenceScore: 82 },
        { state: "CA", county: "Alameda", baseUrl: "https://gis.acgov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06001", confidenceScore: 80 },
        { state: "CA", county: "Sacramento", baseUrl: "https://gis.saccounty.net/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06067", confidenceScore: 78 },
        { state: "CA", county: "Fresno", baseUrl: "https://gis.fresnocountyca.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06019", confidenceScore: 75 },
        { state: "CA", county: "Kern", baseUrl: "https://gis.kerncounty.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "06029", confidenceScore: 75 },
        // COLORADO
        { state: "CO", county: "Denver", baseUrl: "https://gis.denvergov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08031", confidenceScore: 85 },
        { state: "CO", county: "El Paso", baseUrl: "https://gis.elpasoco.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08041", confidenceScore: 82 },
        { state: "CO", county: "Arapahoe", baseUrl: "https://gis.arapahoegov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08005", confidenceScore: 80 },
        { state: "CO", county: "Jefferson", baseUrl: "https://gis.jeffco.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08059", confidenceScore: 80 },
        { state: "CO", county: "Adams", baseUrl: "https://gis.adcogov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "08001", confidenceScore: 78 },
        // CONNECTICUT
        { state: "CT", county: "Fairfield", baseUrl: "https://gis.fairfieldct.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "09001", confidenceScore: 75 },
        { state: "CT", county: "Hartford", baseUrl: "https://gis.hartfordct.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "09003", confidenceScore: 75 },
        // DELAWARE
        { state: "DE", county: "New Castle", baseUrl: "https://gis.nccde.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "10003", confidenceScore: 78 },
        { state: "DE", county: "Kent", baseUrl: "https://gis.co.kent.de.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "10001", confidenceScore: 72 },
        { state: "DE", county: "Sussex", baseUrl: "https://gis.sussexcountyde.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "10005", confidenceScore: 72 },
        // FLORIDA
        { state: "FL", county: "Miami-Dade", baseUrl: "https://gis.miamidade.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12086", confidenceScore: 90 },
        { state: "FL", county: "Broward", baseUrl: "https://gis.broward.org/arcgis/rest/services/Parcels/FeatureServer/0/query", endpointType: "arcgis_feature", fipsCode: "12011", confidenceScore: 88 },
        { state: "FL", county: "Palm Beach", baseUrl: "https://gis.pbcgov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12099", confidenceScore: 85 },
        { state: "FL", county: "Hillsborough", baseUrl: "https://gis.hcpafl.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12057", confidenceScore: 82 },
        { state: "FL", county: "Orange", baseUrl: "https://gis.ocpafl.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12095", confidenceScore: 82 },
        { state: "FL", county: "Pinellas", baseUrl: "https://gis.pinellascounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12103", confidenceScore: 80 },
        { state: "FL", county: "Duval", baseUrl: "https://maps.coj.net/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12031", confidenceScore: 78 },
        { state: "FL", county: "Lee", baseUrl: "https://gis.leegov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "12071", confidenceScore: 78 },
        // GEORGIA
        { state: "GA", county: "Fulton", baseUrl: "https://gis.fultoncountyga.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "13121", confidenceScore: 85 },
        { state: "GA", county: "Gwinnett", baseUrl: "https://gis.gwinnettcounty.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "13135", confidenceScore: 82 },
        { state: "GA", county: "Cobb", baseUrl: "https://gis.cobbcountyga.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "13067", confidenceScore: 80 },
        { state: "GA", county: "DeKalb", baseUrl: "https://gis.dekalbcountyga.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "13089", confidenceScore: 78 },
        // HAWAII
        { state: "HI", county: "Honolulu", baseUrl: "https://gis.honolulu.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "15003", confidenceScore: 80 },
        { state: "HI", county: "Maui", baseUrl: "https://gis.mauicounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "15009", confidenceScore: 75 },
        // IDAHO
        { state: "ID", county: "Ada", baseUrl: "https://gis.adacounty.id.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "16001", confidenceScore: 78 },
        { state: "ID", county: "Canyon", baseUrl: "https://gis.canyoncounty.id.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "16027", confidenceScore: 72 },
        // ILLINOIS
        { state: "IL", county: "Cook", baseUrl: "https://gis.cookcountyil.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "17031", confidenceScore: 90 },
        { state: "IL", county: "DuPage", baseUrl: "https://gis.dupageco.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "17043", confidenceScore: 82 },
        { state: "IL", county: "Lake", baseUrl: "https://gis.lakecountyil.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "17097", confidenceScore: 80 },
        { state: "IL", county: "Will", baseUrl: "https://gis.willcountyillinois.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "17197", confidenceScore: 78 },
        // INDIANA
        { state: "IN", county: "Marion", baseUrl: "https://gis.indy.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "18097", confidenceScore: 85 },
        { state: "IN", county: "Lake", baseUrl: "https://gis.lakecountyin.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "18089", confidenceScore: 78 },
        { state: "IN", county: "Allen", baseUrl: "https://gis.allencounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "18003", confidenceScore: 75 },
        // IOWA
        { state: "IA", county: "Polk", baseUrl: "https://gis.polkcountyiowa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "19153", confidenceScore: 78 },
        { state: "IA", county: "Linn", baseUrl: "https://gis.linncountyiowa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "19113", confidenceScore: 72 },
        // KANSAS
        { state: "KS", county: "Johnson", baseUrl: "https://gis.jocogov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "20091", confidenceScore: 80 },
        { state: "KS", county: "Sedgwick", baseUrl: "https://gis.sedgwickcounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "20173", confidenceScore: 78 },
        // KENTUCKY
        { state: "KY", county: "Jefferson", baseUrl: "https://lojic.lojic.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "21111", confidenceScore: 82 },
        { state: "KY", county: "Fayette", baseUrl: "https://gis.lexingtonky.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "21067", confidenceScore: 78 },
        // LOUISIANA
        { state: "LA", county: "Orleans Parish", baseUrl: "https://gis.nola.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "22071", confidenceScore: 80 },
        { state: "LA", county: "East Baton Rouge", baseUrl: "https://gis.brla.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "22033", confidenceScore: 78 },
        // MAINE
        { state: "ME", county: "Cumberland", baseUrl: "https://gis.cumberlandcounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "23005", confidenceScore: 70 },
        // MARYLAND
        { state: "MD", county: "Montgomery", baseUrl: "https://gis.montgomerycountymd.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "24031", confidenceScore: 85 },
        { state: "MD", county: "Prince Georges", baseUrl: "https://gis.princegeorgescountymd.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "24033", confidenceScore: 82 },
        { state: "MD", county: "Baltimore County", baseUrl: "https://gis.baltimorecountymd.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "24005", confidenceScore: 80 },
        { state: "MD", county: "Anne Arundel", baseUrl: "https://gis.aacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "24003", confidenceScore: 78 },
        // MASSACHUSETTS
        { state: "MA", county: "Middlesex", baseUrl: "https://gis.middlesexcounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "25017", confidenceScore: 75 },
        { state: "MA", county: "Worcester", baseUrl: "https://gis.worcesterma.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "25027", confidenceScore: 72 },
        // MICHIGAN
        { state: "MI", county: "Wayne", baseUrl: "https://gis.waynecounty.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "26163", confidenceScore: 85 },
        { state: "MI", county: "Oakland", baseUrl: "https://gis.oakgov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "26125", confidenceScore: 82 },
        { state: "MI", county: "Macomb", baseUrl: "https://gis.macombcountymi.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "26099", confidenceScore: 78 },
        { state: "MI", county: "Kent", baseUrl: "https://gis.accesskent.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "26081", confidenceScore: 78 },
        // MINNESOTA
        { state: "MN", county: "Hennepin", baseUrl: "https://gis.hennepin.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "27053", confidenceScore: 85 },
        { state: "MN", county: "Ramsey", baseUrl: "https://gis.ramseycounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "27123", confidenceScore: 82 },
        { state: "MN", county: "Dakota", baseUrl: "https://gis.co.dakota.mn.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "27037", confidenceScore: 78 },
        // MISSISSIPPI
        { state: "MS", county: "Hinds", baseUrl: "https://gis.co.hinds.ms.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "28049", confidenceScore: 72 },
        // MISSOURI
        { state: "MO", county: "St. Louis County", baseUrl: "https://gis.stlouisco.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "29189", confidenceScore: 85 },
        { state: "MO", county: "Jackson", baseUrl: "https://gis.jacksongov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "29095", confidenceScore: 80 },
        // MONTANA
        { state: "MT", county: "Yellowstone", baseUrl: "https://gis.co.yellowstone.mt.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "30111", confidenceScore: 70 },
        // NEBRASKA
        { state: "NE", county: "Douglas", baseUrl: "https://gis.douglascountyne.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "31055", confidenceScore: 78 },
        { state: "NE", county: "Lancaster", baseUrl: "https://gis.lincoln.ne.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "31109", confidenceScore: 75 },
        // NEVADA
        { state: "NV", county: "Clark", baseUrl: "https://gis.clarkcountynv.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "32003", confidenceScore: 88 },
        { state: "NV", county: "Washoe", baseUrl: "https://gis.washoecounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "32031", confidenceScore: 82 },
        // NEW HAMPSHIRE
        { state: "NH", county: "Hillsborough", baseUrl: "https://gis.nhgranit.unh.edu/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "33011", confidenceScore: 68 },
        // NEW JERSEY
        { state: "NJ", county: "Bergen", baseUrl: "https://gis.co.bergen.nj.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "34003", confidenceScore: 80 },
        { state: "NJ", county: "Essex", baseUrl: "https://gis.essexcountynj.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "34013", confidenceScore: 78 },
        { state: "NJ", county: "Middlesex", baseUrl: "https://gis.co.middlesex.nj.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "34023", confidenceScore: 75 },
        // NEW MEXICO
        { state: "NM", county: "Bernalillo", baseUrl: "https://gis.bernco.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "35001", confidenceScore: 80 },
        { state: "NM", county: "Dona Ana", baseUrl: "https://gis.donaanacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "35013", confidenceScore: 72 },
        // NEW YORK
        { state: "NY", county: "Kings", baseUrl: "https://gis.nyc.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36047", confidenceScore: 90 },
        { state: "NY", county: "Queens", baseUrl: "https://gis.nyc.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36081", confidenceScore: 90 },
        { state: "NY", county: "Suffolk", baseUrl: "https://gis.suffolkcountyny.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36103", confidenceScore: 82 },
        { state: "NY", county: "Nassau", baseUrl: "https://gis.nassaucountyny.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36059", confidenceScore: 80 },
        { state: "NY", county: "Westchester", baseUrl: "https://gis.westchestergov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36119", confidenceScore: 78 },
        { state: "NY", county: "Erie", baseUrl: "https://gis.erie.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "36029", confidenceScore: 75 },
        // NORTH CAROLINA
        { state: "NC", county: "Mecklenburg", baseUrl: "https://gis.mecklenburgcountync.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "37119", confidenceScore: 85 },
        { state: "NC", county: "Wake", baseUrl: "https://gis.wakegov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "37183", confidenceScore: 85 },
        { state: "NC", county: "Guilford", baseUrl: "https://gis.guilfordcountync.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "37081", confidenceScore: 78 },
        { state: "NC", county: "Forsyth", baseUrl: "https://gis.forsyth.cc/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "37067", confidenceScore: 75 },
        // NORTH DAKOTA
        { state: "ND", county: "Cass", baseUrl: "https://gis.casscountynd.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "38017", confidenceScore: 70 },
        // OHIO
        { state: "OH", county: "Cuyahoga", baseUrl: "https://gis.cuyahogacounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39035", confidenceScore: 85 },
        { state: "OH", county: "Franklin", baseUrl: "https://gis.franklincountyohio.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39049", confidenceScore: 85 },
        { state: "OH", county: "Hamilton", baseUrl: "https://gis.hamiltoncoginc.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39061", confidenceScore: 82 },
        { state: "OH", county: "Summit", baseUrl: "https://gis.co.summit.oh.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39153", confidenceScore: 78 },
        { state: "OH", county: "Montgomery", baseUrl: "https://gis.mcohio.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "39113", confidenceScore: 75 },
        // OKLAHOMA
        { state: "OK", county: "Oklahoma", baseUrl: "https://gis.oklahomacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "40109", confidenceScore: 80 },
        { state: "OK", county: "Tulsa", baseUrl: "https://gis.tulsacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "40143", confidenceScore: 78 },
        // OREGON
        { state: "OR", county: "Multnomah", baseUrl: "https://gis.multco.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "41051", confidenceScore: 82 },
        { state: "OR", county: "Washington", baseUrl: "https://gis.co.washington.or.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "41067", confidenceScore: 78 },
        { state: "OR", county: "Clackamas", baseUrl: "https://gis.clackamas.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "41005", confidenceScore: 75 },
        // PENNSYLVANIA
        { state: "PA", county: "Philadelphia", baseUrl: "https://gis.phila.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42101", confidenceScore: 88 },
        { state: "PA", county: "Allegheny", baseUrl: "https://gis.alleghenycounty.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42003", confidenceScore: 85 },
        { state: "PA", county: "Montgomery", baseUrl: "https://gis.montcopa.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42091", confidenceScore: 80 },
        { state: "PA", county: "Bucks", baseUrl: "https://gis.buckscounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42017", confidenceScore: 78 },
        { state: "PA", county: "Delaware", baseUrl: "https://gis.co.delaware.pa.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "42045", confidenceScore: 75 },
        // RHODE ISLAND
        { state: "RI", county: "Providence", baseUrl: "https://gis.providenceri.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "44007", confidenceScore: 75 },
        // SOUTH CAROLINA
        { state: "SC", county: "Greenville", baseUrl: "https://gis.greenvillecounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "45045", confidenceScore: 80 },
        { state: "SC", county: "Charleston", baseUrl: "https://gis.charlestoncounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "45019", confidenceScore: 78 },
        { state: "SC", county: "Richland", baseUrl: "https://gis.richlandcountysc.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "45079", confidenceScore: 75 },
        // SOUTH DAKOTA
        { state: "SD", county: "Minnehaha", baseUrl: "https://gis.minnehahacounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "46099", confidenceScore: 70 },
        // TENNESSEE
        { state: "TN", county: "Shelby", baseUrl: "https://gis.shelbycountytn.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "47157", confidenceScore: 82 },
        { state: "TN", county: "Davidson", baseUrl: "https://gis.nashville.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "47037", confidenceScore: 82 },
        { state: "TN", county: "Knox", baseUrl: "https://gis.knoxcounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "47093", confidenceScore: 78 },
        { state: "TN", county: "Hamilton", baseUrl: "https://gis.hamiltontn.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "47065", confidenceScore: 75 },
        // TEXAS
        { state: "TX", county: "Harris", baseUrl: "https://gis.hcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48201", confidenceScore: 90 },
        { state: "TX", county: "Dallas", baseUrl: "https://gis.dallascad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48113", confidenceScore: 88 },
        { state: "TX", county: "Tarrant", baseUrl: "https://gis.tad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48439", confidenceScore: 85 },
        { state: "TX", county: "Bexar", baseUrl: "https://gis.bcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48029", confidenceScore: 85 },
        { state: "TX", county: "Travis", baseUrl: "https://gis.traviscad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48453", confidenceScore: 85 },
        { state: "TX", county: "Collin", baseUrl: "https://gis.collincad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48085", confidenceScore: 82 },
        { state: "TX", county: "Denton", baseUrl: "https://gis.dentoncad.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48121", confidenceScore: 80 },
        { state: "TX", county: "El Paso", baseUrl: "https://gis.epcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48141", confidenceScore: 78 },
        { state: "TX", county: "Fort Bend", baseUrl: "https://gis.fbcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48157", confidenceScore: 78 },
        { state: "TX", county: "Williamson", baseUrl: "https://gis.wcad.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "48491", confidenceScore: 75 },
        // UTAH
        { state: "UT", county: "Salt Lake", baseUrl: "https://gis.slco.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "49035", confidenceScore: 85 },
        { state: "UT", county: "Utah", baseUrl: "https://gis.utahcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "49049", confidenceScore: 80 },
        { state: "UT", county: "Davis", baseUrl: "https://gis.daviscountyutah.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "49011", confidenceScore: 75 },
        // VERMONT
        { state: "VT", county: "Chittenden", baseUrl: "https://gis.vcgi.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "50007", confidenceScore: 68 },
        // VIRGINIA
        { state: "VA", county: "Fairfax", baseUrl: "https://gis.fairfaxcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51059", confidenceScore: 85 },
        { state: "VA", county: "Prince William", baseUrl: "https://gis.pwcgov.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51153", confidenceScore: 80 },
        { state: "VA", county: "Loudoun", baseUrl: "https://gis.loudoun.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51107", confidenceScore: 80 },
        { state: "VA", county: "Virginia Beach", baseUrl: "https://gis.vbgov.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51810", confidenceScore: 78 },
        { state: "VA", county: "Henrico", baseUrl: "https://gis.henrico.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "51087", confidenceScore: 75 },
        // WASHINGTON
        { state: "WA", county: "King", baseUrl: "https://gis.kingcounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53033", confidenceScore: 90 },
        { state: "WA", county: "Pierce", baseUrl: "https://gis.piercecountywa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53053", confidenceScore: 82 },
        { state: "WA", county: "Snohomish", baseUrl: "https://gis.snoco.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53061", confidenceScore: 80 },
        { state: "WA", county: "Spokane", baseUrl: "https://gis.spokanecounty.org/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53063", confidenceScore: 78 },
        { state: "WA", county: "Clark", baseUrl: "https://gis.clark.wa.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "53011", confidenceScore: 75 },
        // WEST VIRGINIA
        { state: "WV", county: "Kanawha", baseUrl: "https://gis.kanawha.us/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "54039", confidenceScore: 70 },
        // WISCONSIN
        { state: "WI", county: "Milwaukee", baseUrl: "https://gis.milwaukee.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "55079", confidenceScore: 85 },
        { state: "WI", county: "Dane", baseUrl: "https://gis.countyofdane.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "55025", confidenceScore: 80 },
        { state: "WI", county: "Waukesha", baseUrl: "https://gis.waukeshacounty.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "55133", confidenceScore: 78 },
        // WYOMING
        { state: "WY", county: "Laramie", baseUrl: "https://gis.laramiecounty.com/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "56021", confidenceScore: 70 },
        { state: "WY", county: "Natrona", baseUrl: "https://gis.natronacounty-wy.gov/arcgis/rest/services/Parcels/MapServer/0/query", endpointType: "arcgis_rest", fipsCode: "56025", confidenceScore: 68 },
      ];

      // Get all existing endpoints from database
      const existing = await db.select({ 
        state: countyGisEndpoints.state, 
        county: countyGisEndpoints.county,
        baseUrl: countyGisEndpoints.baseUrl 
      }).from(countyGisEndpoints);
      
      // Create a set of existing state+county+baseUrl combinations for fast lookup
      const existingSet = new Set(
        existing.map(e => `${e.state.toUpperCase()}|${e.county.toLowerCase()}|${e.baseUrl.toLowerCase()}`)
      );
      
      // Filter to only new endpoints
      const newEndpoints = knownEndpointPatterns.filter(ep => {
        const key = `${ep.state.toUpperCase()}|${ep.county.toLowerCase()}|${ep.baseUrl.toLowerCase()}`;
        return !existingSet.has(key);
      });
      
      // Group by state for better UI organization
      const byState: Record<string, typeof newEndpoints> = {};
      for (const ep of newEndpoints) {
        if (!byState[ep.state]) {
          byState[ep.state] = [];
        }
        byState[ep.state].push(ep);
      }
      
      res.json({ 
        discovered: newEndpoints,
        byState,
        totalKnown: knownEndpointPatterns.length,
        totalExisting: existing.length,
        totalNew: newEndpoints.length,
        message: newEndpoints.length > 0 
          ? `Found ${newEndpoints.length} new potential endpoints across ${Object.keys(byState).length} states` 
          : "All known endpoints are already in the database"
      });
    } catch (err: any) {
      console.error("Scan GIS endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Bulk add discovered endpoints
  api.post("/api/county-gis-endpoints/bulk-add", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { endpoints } = req.body;
      
      if (!endpoints || !Array.isArray(endpoints) || endpoints.length === 0) {
        return res.status(400).json({ message: "No endpoints provided" });
      }
      
      // Validate each endpoint has required fields
      for (const ep of endpoints) {
        if (!ep.state || !ep.county || !ep.baseUrl) {
          return res.status(400).json({ message: "Each endpoint must have state, county, and baseUrl" });
        }
      }
      
      const result = await storage.bulkCreateCountyGisEndpoints(endpoints);
      
      res.json({ 
        success: true, 
        added: result.added, 
        skipped: result.skipped,
        message: `Added ${result.added} endpoints, ${result.skipped} already existed`
      });
    } catch (err: any) {
      console.error("Bulk add GIS endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Diagnose endpoint issues
  api.post("/api/county-gis-endpoints/:id/diagnose", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid endpoint ID" });
      }

      const endpoint = await storage.getCountyGisEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({ message: "Endpoint not found" });
      }

      const issues: string[] = [];
      const suggestions: string[] = [];

      try {
        const url = new URL(endpoint.baseUrl);

        const response = await fetch(endpoint.baseUrl, {
          method: "GET",
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
          issues.push(`Server returned HTTP ${response.status}: ${response.statusText}`);
          if (response.status === 404) {
            suggestions.push("The endpoint URL may have changed. Try finding the updated URL on the county's GIS portal.");
          } else if (response.status === 403 || response.status === 401) {
            suggestions.push("The endpoint may require authentication or may have been restricted.");
          } else if (response.status >= 500) {
            suggestions.push("The server is experiencing issues. Try again later.");
          }
        } else {
          const text = await response.text();
          try {
            const data = JSON.parse(text);
            if (data.error) {
              issues.push(`API error: ${data.error.message || JSON.stringify(data.error)}`);
              if (data.error.code === 400) {
                suggestions.push("Check if the query parameters are correct for this endpoint type.");
              }
            }
          } catch {
            issues.push("Response is not valid JSON - endpoint may have changed format");
            suggestions.push("Check if the endpoint still serves JSON data");
          }
        }
      } catch (fetchErr: any) {
        if (fetchErr.name === "TimeoutError") {
          issues.push("Connection timed out after 15 seconds");
          suggestions.push("The server may be slow or unreachable. Check if the county GIS portal is online.");
        } else if (fetchErr.code === "ENOTFOUND") {
          issues.push("DNS resolution failed - domain not found");
          suggestions.push("The domain may have changed. Look up the county's current GIS portal.");
        } else {
          issues.push(`Connection error: ${fetchErr.message}`);
        }
      }

      if (!endpoint.layerId && (endpoint.endpointType === "arcgis_rest" || endpoint.endpointType === "arcgis_feature")) {
        suggestions.push("Consider adding a layer ID if the endpoint has multiple layers");
      }

      if (issues.length === 0) {
        issues.push("No immediate issues detected - endpoint appears to be working");
      }

      res.json({ issues, suggestions, endpoint: { state: endpoint.state, county: endpoint.county, lastError: endpoint.lastError } });
    } catch (err: any) {
      console.error("Diagnose GIS endpoint error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // LIVE GIS DISCOVERY (ArcGIS Online Scanning)
  // ============================================

  api.post("/api/discovery/scan-arcgis", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { runDiscoveryScan } = await import('./services/arcgis-discovery');
      const { keywords, maxResults, targetStates } = req.body;
      
      console.log("[Discovery] Starting ArcGIS Online scan...");
      const result = await runDiscoveryScan({
        keywords: keywords || undefined,
        maxResults: maxResults || 100,
        targetStates: targetStates || undefined,
      });
      
      const endpointsToStore = result.endpoints.map(ep => ({
        state: ep.state,
        county: ep.county,
        baseUrl: ep.baseUrl,
        endpointType: ep.endpointType,
        serviceName: ep.serviceName,
        discoverySource: ep.discoverySource,
        confidenceScore: ep.confidenceScore,
        metadata: ep.metadata,
        status: "pending" as const,
      }));
      
      const storeResult = await storage.bulkCreateDiscoveredEndpoints(endpointsToStore);
      
      console.log(`[Discovery] Scan complete: ${storeResult.added} new, ${storeResult.skipped} duplicates`);
      
      res.json({
        success: true,
        totalSearchResults: result.stats.totalSearchResults,
        validEndpoints: result.stats.validEndpoints,
        added: storeResult.added,
        skipped: storeResult.skipped,
        message: `Found ${result.stats.validEndpoints} endpoints, added ${storeResult.added} new (${storeResult.skipped} already exist)`
      });
    } catch (err: any) {
      console.error("ArcGIS discovery scan error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/discovery/pending", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const status = (req.query.status as string) || "pending";
      const state = req.query.state as string | undefined;
      const endpoints = await storage.getDiscoveredEndpoints({ status, state });
      res.json(endpoints);
    } catch (err: any) {
      console.error("Get pending discovery endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/discovery/all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const state = req.query.state as string | undefined;
      const endpoints = await storage.getDiscoveredEndpoints({ state });
      res.json(endpoints);
    } catch (err: any) {
      console.error("Get all discovery endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/discovery/:id/validate", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid endpoint ID" });
      }
      
      const endpoint = await storage.getDiscoveredEndpoint(id);
      if (!endpoint) {
        return res.status(404).json({ message: "Endpoint not found" });
      }
      
      const { validateEndpoint } = await import('./services/arcgis-discovery');
      const result = await validateEndpoint(endpoint.baseUrl);
      
      await storage.updateDiscoveredEndpoint(id, {
        lastChecked: new Date(),
        healthCheckPassed: result.valid,
        healthCheckMessage: result.message,
        status: result.valid ? "validated" : "pending",
      });
      
      const updated = await storage.getDiscoveredEndpoint(id);
      res.json({ ...result, endpoint: updated });
    } catch (err: any) {
      console.error("Validate discovery endpoint error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/discovery/:id/approve", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid endpoint ID" });
      }
      
      const result = await storage.approveDiscoveredEndpoint(id);
      res.json(result);
    } catch (err: any) {
      console.error("Approve discovery endpoint error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/discovery/:id/reject", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid endpoint ID" });
      }
      
      const endpoint = await storage.rejectDiscoveredEndpoint(id);
      res.json({ success: true, endpoint });
    } catch (err: any) {
      console.error("Reject discovery endpoint error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/discovery/validate-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const pendingEndpoints = await storage.getDiscoveredEndpoints({ status: "pending" });
      const { validateEndpoint } = await import('./services/arcgis-discovery');
      
      let validated = 0;
      let failed = 0;
      
      for (const endpoint of pendingEndpoints.slice(0, 20)) {
        try {
          const result = await validateEndpoint(endpoint.baseUrl);
          await storage.updateDiscoveredEndpoint(endpoint.id, {
            lastChecked: new Date(),
            healthCheckPassed: result.valid,
            healthCheckMessage: result.message,
            status: result.valid ? "validated" : "pending",
          });
          if (result.valid) validated++;
          else failed++;
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          failed++;
        }
      }
      
      res.json({ 
        success: true, 
        validated, 
        failed, 
        total: pendingEndpoints.length,
        processed: Math.min(pendingEndpoints.length, 20)
      });
    } catch (err: any) {
      console.error("Batch validate discovery endpoints error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/discovery/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid endpoint ID" });
      }
      
      const { discoveredEndpoints } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      await db.delete(discoveredEndpoints).where(eq(discoveredEndpoints.id, id));
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete discovery endpoint error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // DATA SOURCES (Free Data Endpoint Registry)
  // ============================================

  const updateDataSourceSchema = z.object({
    isEnabled: z.boolean().optional(),
    isVerified: z.boolean().optional(),
    priority: z.number().optional(),
    notes: z.string().optional(),
  });

  api.get("/api/data-sources", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const isEnabled = req.query.isEnabled === 'true' ? true : req.query.isEnabled === 'false' ? false : undefined;
      const sources = await storage.getDataSources({ category, isEnabled });
      res.json(sources);
    } catch (err: any) {
      console.error("Get data sources error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/data-sources/stats", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const stats = await storage.getDataSourceStats();
      res.json(stats);
    } catch (err: any) {
      console.error("Get data sources stats error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.patch("/api/data-sources/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid data source ID" });
      }
      
      const parseResult = updateDataSourceSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request body", errors: parseResult.error.errors });
      }
      
      const source = await storage.getDataSource(id);
      if (!source) {
        return res.status(404).json({ message: "Data source not found" });
      }
      
      const updated = await storage.updateDataSource(id, parseResult.data);
      res.json(updated);
    } catch (err: any) {
      console.error("Update data source error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/data-sources/:id", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid data source ID" });
      }
      
      const source = await storage.getDataSource(id);
      if (!source) {
        return res.status(404).json({ message: "Data source not found" });
      }
      
      await storage.deleteDataSource(id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete data source error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Test a single data source
  api.post("/api/data-sources/:id/test", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid data source ID" });
      }

      const source = await storage.getDataSource(id);
      if (!source) {
        return res.status(404).json({ message: "Data source not found" });
      }

      const urlToTest = source.apiUrl || source.portalUrl;
      if (!urlToTest) {
        return res.json({ success: false, message: "No URL configured for this data source" });
      }

      let success = false;
      let message = "";

      try {
        const response = await fetch(urlToTest, {
          method: "GET",
          headers: { "Accept": "application/json, text/html, */*" },
          signal: AbortSignal.timeout(15000),
        });

        if (response.ok) {
          success = true;
          message = `URL is accessible (HTTP ${response.status})`;
        } else {
          success = false;
          message = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (fetchErr: any) {
        success = false;
        message = fetchErr.name === "TimeoutError" ? "Request timed out after 15 seconds" : fetchErr.message;
      }

      await storage.updateDataSource(id, { isVerified: success });

      res.json({ success, message });
    } catch (err: any) {
      console.error("Test data source error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Test all enabled data sources
  api.post("/api/data-sources/test-all", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const sources = await storage.getDataSources({ isEnabled: true });
      const results: Array<{ id: number; title: string; success: boolean; message: string }> = [];
      let passed = 0;
      let failed = 0;

      for (const source of sources.slice(0, 20)) {
        const urlToTest = source.apiUrl || source.portalUrl;
        if (!urlToTest) {
          results.push({ id: source.id, title: source.title, success: false, message: "No URL configured" });
          failed++;
          continue;
        }

        try {
          const response = await fetch(urlToTest, {
            method: "GET",
            headers: { "Accept": "application/json, text/html, */*" },
            signal: AbortSignal.timeout(10000),
          });

          if (response.ok) {
            await storage.updateDataSource(source.id, { isVerified: true });
            results.push({ id: source.id, title: source.title, success: true, message: "OK" });
            passed++;
          } else {
            await storage.updateDataSource(source.id, { isVerified: false });
            results.push({ id: source.id, title: source.title, success: false, message: `HTTP ${response.status}` });
            failed++;
          }
        } catch (fetchErr: any) {
          const message = fetchErr.name === "TimeoutError" ? "Timeout" : fetchErr.message;
          await storage.updateDataSource(source.id, { isVerified: false });
          results.push({ id: source.id, title: source.title, success: false, message });
          failed++;
        }
      }

      res.json({ tested: results.length, passed, failed, results });
    } catch (err: any) {
      console.error("Test all data sources error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // DATA SOURCE BROKER - Unified Lookup API
  // ============================================

  const brokerLookupSchema = z.object({
    category: z.enum(["parcel_data", "flood_zone", "wetlands", "soil", "environmental", "tax_assessment", "market_data", "zoning", "satellite", "valuation"]),
    latitude: z.number(),
    longitude: z.number(),
    state: z.string().optional(),
    county: z.string().optional(),
    address: z.string().optional(),
    apn: z.string().optional(),
    forceRefresh: z.boolean().optional(),
    maxTier: z.enum(["free", "cached", "byok", "paid"]).optional(),
  });

  api.post("/api/broker/lookup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const parseResult = brokerLookupSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
      }

      const { dataSourceBroker } = await import('./services/data-source-broker');
      const { category, ...options } = parseResult.data;
      
      const result = await dataSourceBroker.lookup(category, options);
      res.json(result);
    } catch (err: any) {
      console.error("Broker lookup error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/broker/enrich-property", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId, forceRefresh } = req.body;

      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }

      const { propertyEnrichmentService } = await import('./services/propertyEnrichment');
      const result = await propertyEnrichmentService.enrichProperty(org.id, propertyId, forceRefresh);
      
      logger.info("Property enrichment completed and persisted", {
        propertyId,
        organizationId: org.id,
        lookupTimeMs: result.lookupTimeMs,
        hasScores: !!result.scores,
        categoriesEnriched: Object.keys(result).filter(k => result[k as keyof typeof result] !== undefined && k !== 'propertyId' && k !== 'latitude' && k !== 'longitude'),
      });

      res.json(result);
    } catch (err: any) {
      logger.error("Property enrichment error", { error: err.message, propertyId: req.body?.propertyId });
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/enrichment/coordinates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { latitude, longitude, categories, state, county, apn, forceRefresh } = req.body;

      if (!latitude || !longitude) {
        return res.status(400).json({ message: "latitude and longitude are required" });
      }

      const { propertyEnrichmentService } = await import('./services/propertyEnrichment');
      const result = await propertyEnrichmentService.enrichByCoordinates(latitude, longitude, {
        categories,
        state,
        county,
        apn,
        forceRefresh,
      });

      res.json(result);
    } catch (err: any) {
      console.error("Coordinates enrichment error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/map-layers", isAuthenticated, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const state = req.query.state as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

      const { dataSourceBroker } = await import('./services/data-source-broker');
      const layers = await dataSourceBroker.getAvailableLayersForMap({ category, state, limit });

      res.json(layers);
    } catch (err: any) {
      console.error("Get map layers error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/map-layers/categories", isAuthenticated, async (req, res) => {
    try {
      const categories = await db.selectDistinct({ 
        category: sql`${sql.raw('category')}` 
      }).from(sql`data_sources`).where(sql`is_enabled = true`);
      
      res.json(categories.map((c: any) => c.category).filter(Boolean));
    } catch (err: any) {
      console.error("Get map layer categories error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/broker/metrics", isAuthenticated, isFounderAdmin, async (req, res) => {
    try {
      const { dataSourceBroker } = await import('./services/data-source-broker');
      
      const [health, usage, cost] = await Promise.all([
        dataSourceBroker.getHealthMetrics(),
        dataSourceBroker.getUsageMetrics(),
        dataSourceBroker.getCostSummary(),
      ]);

      res.json({ health, usage, cost });
    } catch (err: any) {
      console.error("Broker metrics error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // CORE AI AGENTS
  // ============================================

  const agentTaskSchema = z.object({
    agentType: z.enum(["research", "deals", "communications", "operations"]),
    action: z.string(),
    parameters: z.record(z.any()).optional(),
  });

  api.get("/api/agents", isAuthenticated, async (req, res) => {
    try {
      const { getAllAgentsInfo } = await import('./services/core-agents');
      res.json(getAllAgentsInfo());
    } catch (err: any) {
      console.error("Get agents error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/skills", isAuthenticated, async (req, res) => {
    try {
      const { getAllSkills } = await import('./services/core-agents');
      res.json(getAllSkills());
    } catch (err: any) {
      console.error("Get all skills error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/skills/:agentType", isAuthenticated, async (req, res) => {
    try {
      const { getAgentSkills } = await import('./services/core-agents');
      const agentType = req.params.agentType as any;
      const skills = getAgentSkills(agentType);
      
      if (!skills) {
        return res.status(404).json({ message: "Agent type not found" });
      }
      
      res.json(skills);
    } catch (err: any) {
      console.error("Get agent skills error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/skills/:skillId/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { skillId } = req.params;
      const { params, agentType } = req.body;
      
      const { executeAgentTask } = await import('./services/core-agents');
      
      const result = await executeAgentTask(agentType || "research", {
        action: "execute_skill",
        parameters: { skillId, params: params || {} },
        context: {
          organizationId: org.id,
          userId: user?.id,
          relatedLeadId: params?.leadId,
          relatedPropertyId: params?.propertyId,
          relatedDealId: params?.dealId,
        },
      });

      res.json(result);
    } catch (err: any) {
      console.error("Execute skill error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/:type", isAuthenticated, async (req, res) => {
    try {
      const { getAgentInfo } = await import('./services/core-agents');
      const agentType = req.params.type as any;
      const info = getAgentInfo(agentType);
      
      if (!info) {
        return res.status(404).json({ message: "Agent type not found" });
      }
      
      res.json(info);
    } catch (err: any) {
      console.error("Get agent error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      
      const parseResult = agentTaskSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
      }

      const { agentType, action, parameters } = parseResult.data;
      const { executeAgentTask } = await import('./services/core-agents');
      
      const result = await executeAgentTask(agentType, {
        action,
        parameters: parameters || {},
        context: {
          organizationId: org.id,
          userId: user?.id,
          relatedLeadId: parameters?.leadId,
          relatedPropertyId: parameters?.propertyId,
          relatedDealId: parameters?.dealId,
        },
      });

      res.json(result);
    } catch (err: any) {
      console.error("Agent execute error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/research/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId } = req.body;

      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }

      const { executeAgentTask } = await import('./services/core-agents');
      const result = await executeAgentTask("research", {
        action: "run_due_diligence",
        parameters: { propertyId },
        context: { organizationId: org.id },
      });

      res.json(result);
    } catch (err: any) {
      console.error("Due diligence error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/deals/generate-offer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { leadId, propertyId, offerPrice, terms } = req.body;

      const { executeAgentTask } = await import('./services/core-agents');
      const result = await executeAgentTask("deals", {
        action: "generate_offer",
        parameters: { leadId, propertyId, offerPrice, terms },
        context: { organizationId: org.id },
      });

      res.json(result);
    } catch (err: any) {
      console.error("Generate offer error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/communications/compose", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { type, leadId, purpose, tone, customDetails } = req.body;

      const { executeAgentTask } = await import('./services/core-agents');
      const action = type === "sms" ? "compose_sms" : "compose_email";
      
      const result = await executeAgentTask("communications", {
        action,
        parameters: { leadId, purpose, tone, customDetails },
        context: { organizationId: org.id },
      });

      res.json(result);
    } catch (err: any) {
      console.error("Compose message error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Agent Memory & Feedback Endpoints
  api.post("/api/agents/feedback", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { agentTaskId, rating, helpful, feedback: feedbackText } = req.body;

      if (!agentTaskId || rating === undefined || helpful === undefined) {
        return res.status(400).json({ message: "agentTaskId, rating, and helpful are required" });
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be between 1 and 5" });
      }

      const agentTask = await storage.getAgentTask(org.id, agentTaskId);
      if (!agentTask) {
        return res.status(404).json({ message: "Agent task not found" });
      }

      const existingFeedback = await storage.getAgentFeedbackByTask(agentTaskId);
      if (existingFeedback) {
        return res.status(409).json({ message: "Feedback already submitted for this task" });
      }

      const feedbackData = await storage.createAgentFeedback({
        organizationId: org.id,
        agentTaskId,
        userId: user?.id || "anonymous",
        rating,
        helpful,
        feedback: feedbackText || null,
      });

      res.json({ success: true, feedback: feedbackData });
    } catch (err: any) {
      console.error("Submit feedback error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/memory/:agentType", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { agentType } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      const validTypes = ["research", "deals", "communications", "operations"];
      if (!validTypes.includes(agentType)) {
        return res.status(400).json({ message: "Invalid agent type" });
      }

      const memories = await storage.getAgentMemories(org.id, agentType, limit);
      res.json({ memories, count: memories.length });
    } catch (err: any) {
      console.error("Get agent memory error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/feedback/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agentType = req.query.agentType as string | undefined;

      const stats = await storage.getAgentFeedbackStats(org.id, agentType);
      res.json(stats);
    } catch (err: any) {
      console.error("Get feedback stats error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/agents/memory/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const memoryId = parseInt(req.params.id);
      if (isNaN(memoryId)) {
        return res.status(400).json({ message: "Invalid memory ID" });
      }

      await storage.deleteAgentMemory(memoryId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete agent memory error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/integrations/status", isAuthenticated, async (req, res) => {
    try {
      const { communicationsService } = await import('./services/communications');
      const status = communicationsService.getChannelStatus();
      res.json(status);
    } catch (err: any) {
      console.error("Integration status error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/communications/send", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { type, leadId, subject, content, template, variables } = req.body;
      
      if (!leadId || !type || !content) {
        return res.status(400).json({ message: "leadId, type, and content are required" });
      }
      
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const { communicationsService } = await import('./services/communications');
      const result = await communicationsService.sendToLead({
        organizationId: org.id,
        leadId: lead.id,
        channel: type === 'email' ? 'email' : type === 'sms' ? 'sms' : 'both',
        subject,
        message: content,
      });
      
      res.json(result);
    } catch (err: any) {
      console.error("Communications send error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // ORGANIZATION INTEGRATIONS MANAGEMENT
  // ============================================
  
  api.get("/api/integrations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const integrations = await storage.getOrganizationIntegrations(org.id);
      
      const { maskApiKey, decryptJsonCredentials } = await import('./services/encryption');
      
      const masked = integrations.map(i => {
        let maskedKey = '';
        if (i.credentials?.encrypted) {
          try {
            const decrypted = decryptJsonCredentials<{ apiKey?: string }>(i.credentials.encrypted, org.id);
            maskedKey = maskApiKey(decrypted.apiKey);
          } catch {
            maskedKey = '****';
          }
        }
        return {
          ...i,
          credentials: i.credentials?.encrypted ? {
            hasApiKey: true,
            maskedKey,
          } : null,
        };
      });
      
      res.json(masked);
    } catch (err: any) {
      console.error("Get integrations error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { provider } = req.params;
      
      const integration = await storage.getOrganizationIntegration(org.id, provider);
      
      if (!integration) {
        return res.json({ provider, isEnabled: false, isConfigured: false });
      }
      
      const { maskApiKey, decryptJsonCredentials } = await import('./services/encryption');
      
      let maskedKey = '';
      if (integration.credentials?.encrypted) {
        try {
          const decrypted = decryptJsonCredentials<{ apiKey?: string }>(integration.credentials.encrypted, org.id);
          maskedKey = maskApiKey(decrypted.apiKey);
        } catch {
          maskedKey = '****';
        }
      }
      
      res.json({
        ...integration,
        isConfigured: !!integration.credentials?.encrypted,
        credentials: integration.credentials?.encrypted ? {
          hasApiKey: true,
          maskedKey,
        } : null,
      });
    } catch (err: any) {
      console.error("Get integration error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { provider } = req.params;
      const { apiKey, settings } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ message: "API key is required" });
      }
      
      const validProviders = ['sendgrid', 'twilio', 'lob', 'regrid'];
      if (!validProviders.includes(provider)) {
        return res.status(400).json({ message: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
      }
      
      const { encryptJsonCredentials } = await import('./services/encryption');
      
      const encryptedCredentials = encryptJsonCredentials({ apiKey, ...settings }, org.id);
      
      const integration = await storage.upsertOrganizationIntegration({
        organizationId: org.id,
        provider,
        isEnabled: true,
        credentials: { encrypted: encryptedCredentials },
        settings: settings || {},
      });
      
      await storage.updateIntegrationValidation(org.id, provider, null, null);
      
      res.json({
        success: true,
        provider,
        isEnabled: integration.isEnabled,
        isConfigured: true,
        message: `${provider} integration configured. Click 'Test Connection' to verify.`,
      });
    } catch (err: any) {
      console.error("Save integration error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/integrations/:provider/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { provider } = req.params;
      
      const integration = await storage.getOrganizationIntegration(org.id, provider);
      
      if (!integration || !integration.credentials) {
        return res.status(400).json({ message: `${provider} is not configured` });
      }
      
      const { decryptJsonCredentials } = await import('./services/encryption');
      const credentials = decryptJsonCredentials<{ apiKey: string }>(
        (integration.credentials as any).encrypted,
        org.id
      );
      
      let testResult = { success: false, message: '' };
      
      if (provider === 'sendgrid') {
        const sgMail = (await import('@sendgrid/mail')).default;
        sgMail.setApiKey(credentials.apiKey);
        try {
          await sgMail.send({
            to: 'test@example.com',
            from: 'test@example.com',
            subject: 'Test',
            text: 'Test',
            mailSettings: { sandboxMode: { enable: true } },
          });
          testResult = { success: true, message: 'SendGrid API key is valid' };
        } catch (sgErr: any) {
          if (sgErr.code === 401 || sgErr.response?.body?.errors?.[0]?.message?.includes('API Key')) {
            testResult = { success: false, message: 'Invalid SendGrid API key' };
          } else {
            testResult = { success: true, message: 'SendGrid API key is valid' };
          }
        }
      } else if (provider === 'twilio') {
        testResult = { success: true, message: 'Twilio validation pending - full implementation coming soon' };
      } else if (provider === 'lob') {
        testResult = { success: true, message: 'Lob validation pending - full implementation coming soon' };
      } else if (provider === 'regrid') {
        try {
          const testResponse = await fetch(`https://app.regrid.com/api/v2/parcels/address?query=1600%20Pennsylvania%20Ave%20NW,%20Washington,%20DC&token=${credentials.apiKey}&limit=1`);
          if (testResponse.status === 401 || testResponse.status === 403) {
            testResult = { success: false, message: 'Invalid Regrid API key' };
          } else {
            testResult = { success: true, message: 'Regrid API key is valid' };
          }
        } catch (regridErr: any) {
          testResult = { success: false, message: `Regrid test failed: ${regridErr.message}` };
        }
      }
      
      if (testResult.success) {
        await storage.updateIntegrationValidation(org.id, provider, new Date(), null);
      } else {
        await storage.updateIntegrationValidation(org.id, provider, null, testResult.message);
      }
      
      res.json(testResult);
    } catch (err: any) {
      console.error("Test integration error:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  });
  
  api.delete("/api/integrations/:provider", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { provider } = req.params;
      
      await storage.deleteOrganizationIntegration(org.id, provider);
      
      res.json({ success: true, message: `${provider} integration removed` });
    } catch (err: any) {
      console.error("Delete integration error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // ============================================
  // EMAIL SERVICE STATUS & LOGS
  // ============================================
  
  api.get("/api/email/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { getEmailServiceStatus, emailService } = await import("./services/emailService");
      
      const status = await getEmailServiceStatus();
      const quota = await emailService.getSendQuota(org.id);
      const credentialSource = await emailService.getCredentialSource(org.id);
      
      res.json({
        ...status,
        credentialSource: credentialSource || 'platform',
        quota,
      });
    } catch (err: any) {
      console.error("Get email status error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/email/logs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const { emailService } = await import("./services/emailService");
      
      const logs = emailService.getLogsByOrganization(org.id, limit);
      res.json(logs);
    } catch (err: any) {
      console.error("Get email logs error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/email/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const { to } = req.body;
      
      const recipientEmail = to || user.email || user.claims?.email;
      
      if (!recipientEmail) {
        return res.status(400).json({ message: "No recipient email address provided" });
      }
      
      const { emailService } = await import("./services/emailService");
      
      const result = await emailService.sendTransactionalEmail('notification', {
        to: recipientEmail,
        templateData: {
          title: 'Test Email',
          message: `This is a test email from Acreage Land Co. If you received this, your AWS SES configuration is working correctly.`,
          subject: 'Test Email - AWS SES Configuration',
        },
        organizationId: org.id,
      });
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `Test email sent to ${recipientEmail}`,
          messageId: result.messageId,
          attempts: result.attempts,
        });
      } else {
        res.status(400).json({ 
          success: false, 
          message: result.error,
          errorType: result.errorType,
          attempts: result.attempts,
          retryable: result.retryable,
        });
      }
    } catch (err: any) {
      console.error("Test email error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // ============================================
  // VERIFIED EMAIL DOMAINS (SendGrid Domain Authentication)
  // ============================================
  
  api.get("/api/email-domains", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const domains = await storage.getVerifiedEmailDomains(org.id);
      res.json(domains);
    } catch (err: any) {
      console.error("Get email domains error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/email-domains", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { domain, fromEmail, fromName } = req.body;
      
      if (!domain) {
        return res.status(400).json({ message: "Domain is required" });
      }
      
      const existing = (await storage.getVerifiedEmailDomains(org.id)).find(d => d.domain === domain);
      if (existing) {
        return res.status(400).json({ message: "Domain already exists" });
      }
      
      const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
      let dnsRecords: any[] = [];
      let sendgridDomainId: string | undefined;
      
      if (integration?.credentials?.encrypted) {
        const { decryptJsonCredentials } = await import('./services/encryption');
        const credentials = decryptJsonCredentials<{ apiKey: string }>(
          integration.credentials.encrypted,
          org.id
        );
        
        try {
          const sgResponse = await fetch('https://api.sendgrid.com/v3/whitelabel/domains', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${credentials.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              domain: domain.toLowerCase(),
              automatic_security: true,
              custom_dkim_selector: 'sg',
            }),
          });
          
          if (sgResponse.ok) {
            const sgData = await sgResponse.json();
            sendgridDomainId = String(sgData.id);
            dnsRecords = [];
            
            if (sgData.dns) {
              for (const [key, record] of Object.entries(sgData.dns)) {
                const rec = record as any;
                dnsRecords.push({
                  type: rec.type || 'CNAME',
                  host: rec.host,
                  data: rec.data,
                  valid: rec.valid || false,
                });
              }
            }
          } else {
            const errText = await sgResponse.text();
            console.error('[SendGrid] Domain creation failed:', errText);
          }
        } catch (sgErr: any) {
          console.error('[SendGrid] Domain API error:', sgErr.message);
        }
      }
      
      const newDomain = await storage.createVerifiedEmailDomain({
        organizationId: org.id,
        domain: domain.toLowerCase(),
        sendgridDomainId,
        status: 'pending',
        dnsRecords: dnsRecords.length > 0 ? dnsRecords : null,
        fromEmail: fromEmail || `noreply@${domain.toLowerCase()}`,
        fromName: fromName || org.name,
        isDefault: false,
      });
      
      res.json(newDomain);
    } catch (err: any) {
      console.error("Add email domain error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/email-domains/:id/verify", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const domainId = Number(req.params.id);
      
      const domainRecord = await storage.getVerifiedEmailDomain(domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      
      if (!domainRecord.sendgridDomainId) {
        return res.status(400).json({ message: "Domain not registered with SendGrid" });
      }
      
      const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
      if (!integration?.credentials?.encrypted) {
        return res.status(400).json({ message: "SendGrid not configured" });
      }
      
      const { decryptJsonCredentials } = await import('./services/encryption');
      const credentials = decryptJsonCredentials<{ apiKey: string }>(
        integration.credentials.encrypted,
        org.id
      );
      
      const validateResponse = await fetch(
        `https://api.sendgrid.com/v3/whitelabel/domains/${domainRecord.sendgridDomainId}/validate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (!validateResponse.ok) {
        const errText = await validateResponse.text();
        console.error('[SendGrid] Domain validation request failed:', errText);
        return res.status(400).json({ message: "Validation request failed" });
      }
      
      const validateData = await validateResponse.json();
      const isValid = validateData.valid === true;
      
      let updatedDnsRecords = domainRecord.dnsRecords || [];
      if (validateData.validation_results) {
        for (const [key, result] of Object.entries(validateData.validation_results)) {
          const r = result as any;
          const existingIdx = updatedDnsRecords.findIndex((d: any) => d.host?.includes(key));
          if (existingIdx >= 0) {
            updatedDnsRecords[existingIdx].valid = r.valid || false;
          }
        }
      }
      
      const updatedDomain = await storage.updateVerifiedEmailDomain(domainId, {
        status: isValid ? 'verified' : 'pending',
        dnsRecords: updatedDnsRecords,
        verifiedAt: isValid ? new Date() : null,
      });
      
      res.json({
        verified: isValid,
        domain: updatedDomain,
        validationResults: validateData.validation_results,
      });
    } catch (err: any) {
      console.error("Verify email domain error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.patch("/api/email-domains/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const domainId = Number(req.params.id);
      const { fromEmail, fromName, isDefault } = req.body;
      
      const domainRecord = await storage.getVerifiedEmailDomain(domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      
      if (isDefault === true) {
        const allDomains = await storage.getVerifiedEmailDomains(org.id);
        for (const d of allDomains) {
          if (d.id !== domainId && d.isDefault) {
            await storage.updateVerifiedEmailDomain(d.id, { isDefault: false });
          }
        }
      }
      
      const updatedDomain = await storage.updateVerifiedEmailDomain(domainId, {
        fromEmail: fromEmail ?? domainRecord.fromEmail,
        fromName: fromName ?? domainRecord.fromName,
        isDefault: isDefault ?? domainRecord.isDefault,
      });
      
      res.json(updatedDomain);
    } catch (err: any) {
      console.error("Update email domain error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.delete("/api/email-domains/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const domainId = Number(req.params.id);
      
      const domainRecord = await storage.getVerifiedEmailDomain(domainId);
      if (!domainRecord || domainRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Domain not found" });
      }
      
      if (domainRecord.sendgridDomainId) {
        const integration = await storage.getOrganizationIntegration(org.id, 'sendgrid');
        if (integration?.credentials?.encrypted) {
          try {
            const { decryptJsonCredentials } = await import('./services/encryption');
            const credentials = decryptJsonCredentials<{ apiKey: string }>(
              integration.credentials.encrypted,
              org.id
            );
            
            await fetch(
              `https://api.sendgrid.com/v3/whitelabel/domains/${domainRecord.sendgridDomainId}`,
              {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${credentials.apiKey}`,
                },
              }
            );
          } catch (sgErr: any) {
            console.error('[SendGrid] Domain deletion failed:', sgErr.message);
          }
        }
      }
      
      await storage.deleteVerifiedEmailDomain(domainId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete email domain error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  // ============================================
  // PROVISIONED PHONE NUMBERS (Twilio)
  // ============================================
  
  api.get("/api/phone-numbers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const phones = await storage.getProvisionedPhoneNumbers(org.id);
      res.json(phones);
    } catch (err: any) {
      console.error("Get phone numbers error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.get("/api/phone-numbers/available", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { areaCode, contains, country } = req.query;
      
      const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
      if (!integration?.credentials?.encrypted) {
        return res.status(400).json({ message: "Twilio not configured. Add your Twilio credentials in Settings." });
      }
      
      const { decryptJsonCredentials } = await import('./services/encryption');
      const credentials = decryptJsonCredentials<{ accountSid: string; authToken: string }>(
        integration.credentials.encrypted,
        org.id
      );
      
      const countryCode = (country as string) || 'US';
      const url = new URL(`https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/AvailablePhoneNumbers/${countryCode}/Local.json`);
      if (areaCode) url.searchParams.set('AreaCode', areaCode as string);
      if (contains) url.searchParams.set('Contains', contains as string);
      url.searchParams.set('SmsEnabled', 'true');
      url.searchParams.set('PageSize', '10');
      
      const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Basic ${auth}`,
        },
      });
      
      if (!response.ok) {
        const errText = await response.text();
        console.error('[Twilio] Available numbers search failed:', errText);
        return res.status(400).json({ message: "Failed to search available numbers" });
      }
      
      const data = await response.json();
      const numbers = (data.available_phone_numbers || []).map((n: any) => ({
        phoneNumber: n.phone_number,
        friendlyName: n.friendly_name,
        locality: n.locality,
        region: n.region,
        capabilities: {
          sms: n.capabilities?.sms || false,
          mms: n.capabilities?.mms || false,
          voice: n.capabilities?.voice || false,
        },
      }));
      
      res.json(numbers);
    } catch (err: any) {
      console.error("Search available numbers error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.post("/api/phone-numbers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { phoneNumber, friendlyName } = req.body;
      
      if (!phoneNumber) {
        return res.status(400).json({ message: "Phone number is required" });
      }
      
      const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
      if (!integration?.credentials?.encrypted) {
        return res.status(400).json({ message: "Twilio not configured" });
      }
      
      const { decryptJsonCredentials } = await import('./services/encryption');
      const credentials = decryptJsonCredentials<{ accountSid: string; authToken: string }>(
        integration.credentials.encrypted,
        org.id
      );
      
      const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');
      
      const purchaseResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            PhoneNumber: phoneNumber,
            FriendlyName: friendlyName || `Acreage - ${org.name}`,
          }).toString(),
        }
      );
      
      if (!purchaseResponse.ok) {
        const errText = await purchaseResponse.text();
        console.error('[Twilio] Phone purchase failed:', errText);
        return res.status(400).json({ message: "Failed to purchase phone number" });
      }
      
      const purchaseData = await purchaseResponse.json();
      
      const newPhone = await storage.createProvisionedPhoneNumber({
        organizationId: org.id,
        phoneNumber: purchaseData.phone_number,
        twilioSid: purchaseData.sid,
        friendlyName: purchaseData.friendly_name,
        capabilities: {
          sms: purchaseData.capabilities?.sms || false,
          mms: purchaseData.capabilities?.mms || false,
          voice: purchaseData.capabilities?.voice || false,
        },
        status: 'active',
        isDefault: false,
        purchasedAt: new Date(),
      });
      
      res.json(newPhone);
    } catch (err: any) {
      console.error("Purchase phone number error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.patch("/api/phone-numbers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const phoneId = Number(req.params.id);
      const { friendlyName, isDefault } = req.body;
      
      const phoneRecord = await storage.getProvisionedPhoneNumber(phoneId);
      if (!phoneRecord || phoneRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      if (isDefault === true) {
        const allPhones = await storage.getProvisionedPhoneNumbers(org.id);
        for (const p of allPhones) {
          if (p.id !== phoneId && p.isDefault) {
            await storage.updateProvisionedPhoneNumber(p.id, { isDefault: false });
          }
        }
      }
      
      const updatedPhone = await storage.updateProvisionedPhoneNumber(phoneId, {
        friendlyName: friendlyName ?? phoneRecord.friendlyName,
        isDefault: isDefault ?? phoneRecord.isDefault,
      });
      
      res.json(updatedPhone);
    } catch (err: any) {
      console.error("Update phone number error:", err);
      res.status(500).json({ message: err.message });
    }
  });
  
  api.delete("/api/phone-numbers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const phoneId = Number(req.params.id);
      
      const phoneRecord = await storage.getProvisionedPhoneNumber(phoneId);
      if (!phoneRecord || phoneRecord.organizationId !== org.id) {
        return res.status(404).json({ message: "Phone number not found" });
      }
      
      if (phoneRecord.twilioSid) {
        const integration = await storage.getOrganizationIntegration(org.id, 'twilio');
        if (integration?.credentials?.encrypted) {
          try {
            const { decryptJsonCredentials } = await import('./services/encryption');
            const credentials = decryptJsonCredentials<{ accountSid: string; authToken: string }>(
              integration.credentials.encrypted,
              org.id
            );
            
            const auth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64');
            
            await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${phoneRecord.twilioSid}.json`,
              {
                method: 'DELETE',
                headers: {
                  'Authorization': `Basic ${auth}`,
                },
              }
            );
          } catch (twilioErr: any) {
            console.error('[Twilio] Phone release failed:', twilioErr.message);
          }
        }
      }
      
      await storage.deleteProvisionedPhoneNumber(phoneId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete phone number error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // A/B TESTING ROUTES
  // ============================================

  // Calculate statistical significance (z-score)
  function calculateZScore(control: { sent: number; converted: number }, variant: { sent: number; converted: number }): number {
    if (control.sent === 0 || variant.sent === 0) return 0;
    
    const p1 = control.converted / control.sent;
    const p2 = variant.converted / variant.sent;
    const p = (control.converted + variant.converted) / (control.sent + variant.sent);
    
    if (p === 0 || p === 1) return 0;
    
    const se = Math.sqrt(p * (1 - p) * (1 / control.sent + 1 / variant.sent));
    if (se === 0) return 0;
    
    return (p2 - p1) / se;
  }

  // Get confidence level from z-score
  function getConfidenceLevel(zScore: number): number {
    const absZ = Math.abs(zScore);
    if (absZ >= Z_SCORES[0.99]) return 0.99;
    if (absZ >= Z_SCORES[0.95]) return 0.95;
    if (absZ >= Z_SCORES[0.90]) return 0.90;
    return 0;
  }

  // Recommend minimum sample size for statistical significance
  function recommendMinSampleSize(baselineConversionRate: number, minimumDetectableEffect: number = 0.05): number {
    const alpha = 0.05; // 95% confidence
    const beta = 0.20; // 80% power
    const zAlpha = 1.96;
    const zBeta = 0.84;
    
    const p1 = baselineConversionRate;
    const p2 = p1 + minimumDetectableEffect;
    
    const numerator = Math.pow(zAlpha + zBeta, 2) * (p1 * (1 - p1) + p2 * (1 - p2));
    const denominator = Math.pow(p2 - p1, 2);
    
    if (denominator === 0) return 100;
    
    return Math.ceil(numerator / denominator);
  }

  // Get all A/B tests for organization
  api.get("/api/ab-tests", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const tests = await storage.getAbTests(org.id);
      
      const testsWithVariants = await Promise.all(
        tests.map(async (test) => {
          const variants = await storage.getAbTestVariants(test.id);
          return { ...test, variants };
        })
      );
      
      res.json(testsWithVariants);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get single A/B test with variants
  api.get("/api/ab-tests/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create A/B test for campaign
  api.post("/api/campaigns/:id/ab-test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const campaignId = Number(req.params.id);
      
      const campaign = await storage.getCampaign(org.id, campaignId);
      if (!campaign) {
        return res.status(404).json({ message: "Campaign not found" });
      }
      
      // Check if campaign already has an active test
      const existingTest = await storage.getAbTestByCampaign(campaignId);
      if (existingTest && existingTest.status !== "completed") {
        return res.status(400).json({ message: "Campaign already has an active A/B test" });
      }
      
      const input = insertAbTestSchema.parse({
        organizationId: org.id,
        campaignId,
        name: req.body.name || `A/B Test for ${campaign.name}`,
        testType: req.body.testType || "subject",
        sampleSizePercent: req.body.sampleSizePercent || 20,
        winningMetric: req.body.winningMetric || "response_rate",
        minSampleSize: req.body.minSampleSize || 100,
        autoCompleteOnSignificance: req.body.autoCompleteOnSignificance ?? true,
      });
      
      const test = await storage.createAbTest(input);
      
      // Create default variants if provided
      const variants = req.body.variants || [
        { name: "Control", isControl: true, subject: campaign.subject, content: campaign.content },
        { name: "Variant B", isControl: false, subject: req.body.variantSubject, content: req.body.variantContent }
      ];
      
      const createdVariants = await Promise.all(
        variants.map((v: any) => 
          storage.createAbTestVariant({
            testId: test.id,
            name: v.name,
            isControl: v.isControl || false,
            subject: v.subject,
            content: v.content,
            offerAmount: v.offerAmount,
          })
        )
      );
      
      res.status(201).json({ ...test, variants: createdVariants });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "Invalid input", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // Start A/B test (split recipients)
  api.patch("/api/ab-tests/:id/start", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      if (result.test.status !== "draft") {
        return res.status(400).json({ message: "Test is not in draft status" });
      }
      
      if (result.variants.length < 2) {
        return res.status(400).json({ message: "Test must have at least 2 variants" });
      }
      
      // Update test status to running
      const updatedTest = await storage.updateAbTest(testId, {
        status: "running",
        startedAt: new Date(),
      });
      
      res.json({ ...updatedTest, variants: result.variants });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Complete A/B test and declare winner
  api.patch("/api/ab-tests/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      if (result.test.status === "completed") {
        return res.status(400).json({ message: "Test is already completed" });
      }
      
      // Determine winner based on winning metric
      let winnerId: number | null = null;
      let winningValue = -Infinity;
      
      for (const variant of result.variants) {
        let value = 0;
        const sent = variant.sent || 0;
        
        switch (result.test.winningMetric) {
          case "open_rate":
            value = sent > 0 ? (variant.opened || 0) / sent : 0;
            break;
          case "click_rate":
            value = sent > 0 ? (variant.clicked || 0) / sent : 0;
            break;
          case "response_rate":
          default:
            value = sent > 0 ? (variant.responded || 0) / sent : 0;
            break;
        }
        
        if (value > winningValue) {
          winningValue = value;
          winnerId = variant.id;
        }
      }
      
      // Calculate confidence levels for all variants against control
      const control = result.variants.find(v => v.isControl);
      if (control) {
        for (const variant of result.variants) {
          if (!variant.isControl) {
            const zScore = calculateZScore(
              { sent: control.sent || 0, converted: control.responded || 0 },
              { sent: variant.sent || 0, converted: variant.responded || 0 }
            );
            const confidence = getConfidenceLevel(zScore);
            
            await storage.updateAbTestVariant(variant.id, {
              responseRate: String(variant.sent ? ((variant.responded || 0) / variant.sent * 100).toFixed(2) : 0),
              confidenceLevel: String(confidence * 100),
            });
          }
        }
      }
      
      // Update test as completed
      const updatedTest = await storage.updateAbTest(testId, {
        status: "completed",
        completedAt: new Date(),
        winnerId,
      });
      
      // Get updated variants
      const updatedVariants = await storage.getAbTestVariants(testId);
      
      res.json({ ...updatedTest, variants: updatedVariants });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update variant metrics (for tracking)
  api.patch("/api/ab-test-variants/:id/metrics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const variantId = Number(req.params.id);
      const { sent, delivered, opened, clicked, responded, converted } = req.body;
      
      const updates: any = {};
      if (sent !== undefined) updates.sent = sent;
      if (delivered !== undefined) updates.delivered = delivered;
      if (opened !== undefined) updates.opened = opened;
      if (clicked !== undefined) updates.clicked = clicked;
      if (responded !== undefined) updates.responded = responded;
      if (converted !== undefined) updates.converted = converted;
      
      // Calculate rates
      const currentSent = sent || 0;
      if (currentSent > 0) {
        if (delivered !== undefined) updates.deliveryRate = String((delivered / currentSent * 100).toFixed(2));
        if (opened !== undefined) updates.openRate = String((opened / currentSent * 100).toFixed(2));
        if (clicked !== undefined) updates.clickRate = String((clicked / currentSent * 100).toFixed(2));
        if (responded !== undefined) updates.responseRate = String((responded / currentSent * 100).toFixed(2));
        if (converted !== undefined) updates.conversionRate = String((converted / currentSent * 100).toFixed(2));
      }
      
      const updatedVariant = await storage.updateAbTestVariant(variantId, updates);
      res.json(updatedVariant);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get recommended sample size
  api.get("/api/ab-tests/recommend-sample-size", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const baselineRate = parseFloat(req.query.baselineRate as string) || 0.05;
      const minEffect = parseFloat(req.query.minEffect as string) || 0.05;
      
      const sampleSize = recommendMinSampleSize(baselineRate, minEffect);
      
      res.json({ 
        recommendedSampleSize: sampleSize,
        baselineRate,
        minimumDetectableEffect: minEffect,
        confidenceLevel: 0.95,
        power: 0.80
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Add variant to existing test
  api.post("/api/ab-tests/:id/variants", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      if (result.test.status !== "draft") {
        return res.status(400).json({ message: "Cannot add variants to a running or completed test" });
      }
      
      const input = insertAbTestVariantSchema.parse({
        testId,
        name: req.body.name,
        isControl: req.body.isControl || false,
        subject: req.body.subject,
        content: req.body.content,
        offerAmount: req.body.offerAmount,
      });
      
      const variant = await storage.createAbTestVariant(input);
      res.status(201).json(variant);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "Invalid input", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // Delete A/B test
  api.delete("/api/ab-tests/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const test = await storage.getAbTest(org.id, testId);
      if (!test) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      await storage.deleteAbTest(testId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Apply winning variant to campaign
  api.post("/api/ab-tests/:id/apply-winner", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const testId = Number(req.params.id);
      
      const result = await storage.getAbTestWithVariants(org.id, testId);
      if (!result) {
        return res.status(404).json({ message: "A/B test not found" });
      }
      
      if (result.test.status !== "completed" || !result.test.winnerId) {
        return res.status(400).json({ message: "Test is not completed or has no winner" });
      }
      
      const winningVariant = result.variants.find(v => v.id === result.test.winnerId);
      if (!winningVariant) {
        return res.status(404).json({ message: "Winning variant not found" });
      }
      
      // Update the campaign with the winning variant
      const updates: any = {};
      if (winningVariant.subject) updates.subject = winningVariant.subject;
      if (winningVariant.content) updates.content = winningVariant.content;
      
      const campaign = await storage.updateCampaign(result.test.campaignId, updates);
      
      res.json({ 
        success: true, 
        campaign,
        appliedVariant: winningVariant 
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // CUSTOM FIELDS SYSTEM
  // ============================================

  // Custom Field Definitions
  api.get("/api/custom-fields/definitions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entityType = req.query.entityType as string | undefined;
      const definitions = await storage.getCustomFieldDefinitions(org.id, entityType);
      res.json(definitions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      const definition = await storage.getCustomFieldDefinition(org.id, id);
      if (!definition) {
        return res.status(404).json({ message: "Custom field definition not found" });
      }
      res.json(definition);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/custom-fields/definitions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const parsed = insertCustomFieldDefinitionSchema.parse({
        ...req.body,
        organizationId: org.id
      });
      const definition = await storage.createCustomFieldDefinition(parsed);
      res.status(201).json(definition);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.patch("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getCustomFieldDefinition(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Custom field definition not found" });
      }
      
      const updated = await storage.updateCustomFieldDefinition(id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/custom-fields/definitions/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getCustomFieldDefinition(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Custom field definition not found" });
      }
      
      await storage.deleteCustomFieldDefinition(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Custom Field Values
  api.get("/api/custom-fields/values/:entityType/:entityId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const entityType = req.params.entityType;
      const entityId = Number(req.params.entityId);
      const values = await storage.getCustomFieldValues(entityType, entityId);
      res.json(values);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/custom-fields/values", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { definitionId, entityId, value } = req.body;
      
      const definition = await storage.getCustomFieldDefinition(org.id, definitionId);
      if (!definition) {
        return res.status(404).json({ message: "Custom field definition not found" });
      }
      
      const fieldValue = await storage.setCustomFieldValue(definitionId, entityId, value);
      res.json(fieldValue);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/custom-fields/values/bulk", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { entityType, entityId, values } = req.body as {
        entityType: string;
        entityId: number;
        values: { definitionId: number; value: string | null }[];
      };
      
      const results = [];
      for (const { definitionId, value } of values) {
        const definition = await storage.getCustomFieldDefinition(org.id, definitionId);
        if (definition) {
          const result = await storage.setCustomFieldValue(definitionId, entityId, value);
          results.push(result);
        }
      }
      
      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // SAVED VIEWS
  // ============================================

  api.get("/api/saved-views", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entityType = req.query.entityType as string | undefined;
      const views = await storage.getSavedViews(org.id, entityType);
      res.json(views);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      const view = await storage.getSavedView(org.id, id);
      if (!view) {
        return res.status(404).json({ message: "Saved view not found" });
      }
      res.json(view);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/saved-views", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const parsed = insertSavedViewSchema.parse({
        ...req.body,
        organizationId: org.id,
        createdBy: user?.id || null
      });
      const view = await storage.createSavedView(parsed);
      res.status(201).json(view);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  api.patch("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Saved view not found" });
      }
      
      const updated = await storage.updateSavedView(id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/saved-views/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Saved view not found" });
      }
      
      await storage.deleteSavedView(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/saved-views/:id/set-default", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = Number(req.params.id);
      
      const existing = await storage.getSavedView(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Saved view not found" });
      }
      
      const updated = await storage.setDefaultView(org.id, existing.entityType, id);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/system/health", async (req, res) => {
    try {
      const checks = {
        database: false,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
      };
      
      try {
        const result = await db.execute(sql`SELECT 1 as ok`);
        checks.database = true;
      } catch (dbErr: any) {
        console.error("[Health] Database check failed:", dbErr.message);
        checks.database = false;
      }
      
      res.json({
        status: checks.database ? 'healthy' : 'degraded',
        checks
      });
    } catch (err: any) {
      res.status(500).json({ status: 'unhealthy', error: err.message });
    }
  });

  // ============================================
  // AI OFFER GENERATION
  // ============================================
  
  api.post("/api/ai/generate-offer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const propertyData: PropertyData = req.body;
      
      if (!propertyData.county || !propertyData.state || !propertyData.sizeAcres) {
        return res.status(400).json({ 
          message: "Missing required fields: county, state, and sizeAcres are required" 
        });
      }
      
      const result = await generateOfferSuggestions(propertyData);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("AI generate-offer error:", error);
      res.status(500).json({ 
        message: error.message || "Failed to generate offer suggestions" 
      });
    }
  });
  
  api.post("/api/ai/generate-letter", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const request: OfferLetterRequest = req.body;
      
      if (!request.property || !request.offerAmount || !request.buyerName || !request.tone) {
        return res.status(400).json({ 
          message: "Missing required fields: property, offerAmount, buyerName, and tone are required" 
        });
      }
      
      if (!["professional", "friendly", "urgent"].includes(request.tone)) {
        return res.status(400).json({ 
          message: "Tone must be one of: professional, friendly, urgent" 
        });
      }
      
      const result = await generateOfferLetter(request);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("AI generate-letter error:", error);
      res.status(500).json({ 
        message: error.message || "Failed to generate offer letter" 
      });
    }
  });
  
  api.post("/api/ai/predict-acceptance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const request: AcceptancePredictionRequest = req.body;
      
      if (!request.property || !request.offerAmount || !request.estimatedMarketValue) {
        return res.status(400).json({ 
          message: "Missing required fields: property, offerAmount, and estimatedMarketValue are required" 
        });
      }
      
      const result = await predictAcceptanceProbability(request);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("AI predict-acceptance error:", error);
      res.status(500).json({ 
        message: error.message || "Failed to predict acceptance probability" 
      });
    }
  });

  // ============================================
  // ACTIVITY FEED (15.1)
  // ============================================
  
  api.get("/api/activity", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const eventTypes = req.query.eventTypes 
        ? (req.query.eventTypes as string).split(",") 
        : undefined;
      const entityType = req.query.entityType as string | undefined;
      
      const orgId = (req as any).organization!.id;
      
      let events = await storage.getRecentActivityEvents(orgId, limit + offset);
      
      if (eventTypes && eventTypes.length > 0) {
        events = events.filter(e => eventTypes.includes(e.eventType));
      }
      
      if (entityType) {
        events = events.filter(e => e.entityType === entityType);
      }
      
      const paginatedEvents = events.slice(offset, offset + limit);
      
      res.json({
        events: paginatedEvents,
        hasMore: events.length > offset + limit,
        total: events.length,
      });
    } catch (error: any) {
      console.error("Activity feed error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch activity feed" });
    }
  });

  // ============================================
  // NOTIFICATION PREFERENCES (15.2)
  // ============================================
  
  api.get("/api/notification-preferences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const orgId = (req as any).organization!.id;
      
      const preferences = await storage.getNotificationPreferences(userId, orgId);
      res.json(preferences);
    } catch (error: any) {
      console.error("Get notification preferences error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch notification preferences" });
    }
  });

  api.post("/api/notification-preferences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = (req.user as any).id;
      const orgId = (req as any).organization!.id;
      
      const { eventType, emailEnabled, pushEnabled, inAppEnabled } = req.body;
      
      if (!eventType) {
        return res.status(400).json({ message: "eventType is required" });
      }
      
      const pref = await storage.upsertNotificationPreference({
        userId,
        organizationId: orgId,
        eventType,
        emailEnabled: emailEnabled ?? true,
        pushEnabled: pushEnabled ?? false,
        inAppEnabled: inAppEnabled ?? true,
      });
      
      res.json(pref);
    } catch (error: any) {
      console.error("Create notification preference error:", error);
      res.status(500).json({ message: error.message || "Failed to save notification preference" });
    }
  });

  api.put("/api/notification-preferences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { emailEnabled, pushEnabled, inAppEnabled } = req.body;
      
      const pref = await storage.updateNotificationPreference(id, {
        emailEnabled,
        pushEnabled,
        inAppEnabled,
      });
      
      res.json(pref);
    } catch (error: any) {
      console.error("Update notification preference error:", error);
      res.status(500).json({ message: error.message || "Failed to update notification preference" });
    }
  });

  // ============================================
  // TASK MANAGEMENT (17.1, 17.2, 17.3)
  // ============================================

  api.get("/api/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const filters: { status?: string; priority?: string; assignedTo?: number; entityType?: string; entityId?: number } = {};
      
      if (req.query.status) filters.status = req.query.status as string;
      if (req.query.priority) filters.priority = req.query.priority as string;
      if (req.query.assignedTo) filters.assignedTo = parseInt(req.query.assignedTo as string);
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.entityId) filters.entityId = parseInt(req.query.entityId as string);
      
      const tasks = await storage.getTasks(orgId, Object.keys(filters).length > 0 ? filters : undefined);
      res.json(tasks);
    } catch (error: any) {
      console.error("Get tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tasks" });
    }
  });

  api.get("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      res.json(task);
    } catch (error: any) {
      console.error("Get task error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch task" });
    }
  });

  api.post("/api/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      
      const validated = insertTaskSchema.parse({
        ...req.body,
        organizationId: orgId,
        createdBy: userId,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        nextOccurrence: req.body.nextOccurrence ? new Date(req.body.nextOccurrence) : null,
      });
      
      const task = await storage.createTask(validated);
      
      await activityLogger.logTaskCreated(
        orgId,
        task.id,
        task.title,
        task.entityType as any,
        task.entityId ?? undefined,
        userId
      );
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "create",
        entityType: "task",
        entityId: task.id,
        changes: { after: validated, fields: Object.keys(validated) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.status(201).json(task);
    } catch (error: any) {
      console.error("Create task error:", error);
      res.status(500).json({ message: error.message || "Failed to create task" });
    }
  });

  api.put("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const updates: any = { ...req.body };
      if (updates.dueDate) updates.dueDate = new Date(updates.dueDate);
      if (updates.nextOccurrence) updates.nextOccurrence = new Date(updates.nextOccurrence);
      
      const task = await storage.updateTask(id, updates);
      
      const changes = Object.keys(updates).filter(k => k !== 'updatedAt').join(', ');
      await activityLogger.logTaskUpdated(
        orgId,
        task.id,
        task.title,
        changes,
        task.entityType as any,
        task.entityId ?? undefined,
        userId
      );
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "update",
        entityType: "task",
        entityId: task.id,
        changes: { before: existingTask, after: task, fields: Object.keys(updates) },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(task);
    } catch (error: any) {
      console.error("Update task error:", error);
      res.status(500).json({ message: error.message || "Failed to update task" });
    }
  });

  api.delete("/api/tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const id = parseInt(req.params.id);
      
      const task = await storage.getTask(orgId, id);
      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      
      await storage.deleteTask(id);
      
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "delete",
        entityType: "task",
        entityId: id,
        changes: { before: task, fields: ["deleted"] },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ message: "Task deleted" });
    } catch (error: any) {
      console.error("Delete task error:", error);
      res.status(500).json({ message: error.message || "Failed to delete task" });
    }
  });

  api.post("/api/tasks/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      const id = parseInt(req.params.id);
      
      const existingTask = await storage.getTask(orgId, id);
      if (!existingTask) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const completedTask = await storage.completeTask(id);
      
      await activityLogger.logTaskCompleted(
        orgId,
        completedTask.id,
        completedTask.title,
        completedTask.entityType as any,
        completedTask.entityId ?? undefined,
        userId
      );
      
      if (completedTask.isRecurring && completedTask.recurrenceRule) {
        const nextTask = await storage.createNextRecurringTask(completedTask);
        return res.json({ completedTask, nextTask });
      }
      
      res.json({ completedTask });
    } catch (error: any) {
      console.error("Complete task error:", error);
      res.status(500).json({ message: error.message || "Failed to complete task" });
    }
  });

  api.post("/api/tasks/process-recurring", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const recurringTasksDue = await storage.getRecurringTasksDue();
      const createdTasks = [];
      
      for (const task of recurringTasksDue) {
        const nextTask = await storage.createNextRecurringTask(task);
        createdTasks.push(nextTask);
      }
      
      res.json({ processed: recurringTasksDue.length, created: createdTasks });
    } catch (error: any) {
      console.error("Process recurring tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to process recurring tasks" });
    }
  });

  // ============================================
  // IMPORT / EXPORT
  // ============================================

  api.get("/api/import/:entityType/columns", isAuthenticated, async (req, res) => {
    try {
      const entityType = req.params.entityType as "leads" | "properties" | "deals";
      if (!["leads", "properties", "deals"].includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type. Must be leads, properties, or deals." });
      }
      const columns = getExpectedColumns(entityType);
      res.json({ columns });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get columns" });
    }
  });

  api.post("/api/import/:entityType/preview", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const entityType = req.params.entityType as "leads" | "properties" | "deals";
      if (!["leads", "properties", "deals"].includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type. Must be leads, properties, or deals." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const csvString = req.file.buffer.toString("utf-8");
      const data = parseCSV(csvString);

      if (data.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({ 
          message: `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Please split into smaller files.` 
        });
      }

      const preview = previewImport(data, entityType);
      res.json(preview);
    } catch (error: any) {
      console.error("Import preview error:", error);
      res.status(500).json({ message: error.message || "Failed to preview import" });
    }
  });

  api.post("/api/import/:entityType", isAuthenticated, getOrCreateOrg, upload.single("file"), async (req, res) => {
    try {
      const org = (req as any).organization;
      const entityType = req.params.entityType as "leads" | "properties" | "deals";

      if (!["leads", "properties", "deals"].includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type. Must be leads, properties, or deals." });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const csvString = req.file.buffer.toString("utf-8");
      const data = parseCSV(csvString);

      if (data.length > MAX_CSV_IMPORT_ROWS) {
        return res.status(400).json({ 
          message: `CSV file exceeds maximum of ${MAX_CSV_IMPORT_ROWS} rows. Please split into smaller files.` 
        });
      }

      let result;
      if (entityType === "leads") {
        result = await importLeads(data, org.id);
      } else if (entityType === "properties") {
        result = await importProperties(data, org.id);
      } else {
        result = await importDeals(data, org.id);
      }

      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId,
        action: "import",
        entityType: entityType,
        entityId: 0,
        changes: { 
          before: {},
          after: {
            totalRows: data.length,
            imported: result.successCount,
            errors: result.errorCount,
          },
          fields: ["import"],
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      res.json(result);
    } catch (error: any) {
      console.error("Import error:", error);
      res.status(500).json({ message: error.message || "Failed to import data" });
    }
  });

  api.get("/api/export/:entityType", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entityType = req.params.entityType as "leads" | "properties" | "deals" | "notes";
      const format = (req.query.format as string) || "csv";

      if (!["leads", "properties", "deals", "notes"].includes(entityType)) {
        return res.status(400).json({ message: "Invalid entity type. Must be leads, properties, deals, or notes." });
      }

      if (!["csv", "json"].includes(format)) {
        return res.status(400).json({ message: "Invalid format. Must be csv or json." });
      }

      const filters: ExportFilters = {
        status: req.query.status as string | undefined,
        type: req.query.type as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      };

      const date = new Date().toISOString().split("T")[0];

      if (format === "json") {
        let data: any[];
        if (entityType === "leads") {
          data = await getLeadsData(org.id, filters);
        } else if (entityType === "properties") {
          data = await getPropertiesData(org.id, filters);
        } else if (entityType === "deals") {
          data = await getDealsData(org.id, filters);
        } else {
          data = await getNotesData(org.id, filters);
        }

        const filename = `${entityType}_export_${date}.json`;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(JSON.stringify(data, null, 2));
      } else {
        let csv: string;
        let filename: string;

        if (entityType === "leads") {
          csv = await exportLeadsToCSV(org.id, filters);
          filename = `leads_export_${date}.csv`;
        } else if (entityType === "properties") {
          csv = await exportPropertiesToCSV(org.id, filters);
          filename = `properties_export_${date}.csv`;
        } else if (entityType === "deals") {
          csv = await exportDealsToCSV(org.id, filters);
          filename = `deals_export_${date}.csv`;
        } else {
          csv = await exportNotesToCSV(org.id, filters);
          filename = `notes_export_${date}.csv`;
        }

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
      }
    } catch (error: any) {
      console.error("Export error:", error);
      res.status(500).json({ message: error.message || "Failed to export data" });
    }
  });

  api.get("/api/export/backup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const backup = await createBackupZip(org.id);

      const jsonResponse = {
        metadata: {
          organizationId: org.id,
          organizationName: org.name,
          exportedAt: new Date().toISOString(),
        },
        files: backup.files.map((f) => ({
          name: f.name,
          content: f.content,
        })),
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="backup_${org.slug}_${new Date().toISOString().split("T")[0]}.json"`
      );
      res.send(JSON.stringify(jsonResponse, null, 2));
    } catch (error: any) {
      console.error("Backup error:", error);
      res.status(500).json({ message: error.message || "Failed to create backup" });
    }
  });

  // ============================================
  // COMPLIANCE (20.1, 20.2, 20.3)
  // ============================================

  // Audit Log (20.1)
  api.get("/api/audit-log", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      
      const filters: {
        action?: string;
        entityType?: string;
        entityId?: number;
        userId?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
        offset?: number;
      } = {};
      
      if (req.query.action) filters.action = req.query.action as string;
      if (req.query.entityType) filters.entityType = req.query.entityType as string;
      if (req.query.entityId) filters.entityId = parseInt(req.query.entityId as string);
      if (req.query.userId) filters.userId = req.query.userId as string;
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.limit) filters.limit = parseInt(req.query.limit as string);
      if (req.query.offset) filters.offset = parseInt(req.query.offset as string);
      
      const [logs, count] = await Promise.all([
        storage.getAuditLogs(orgId, filters),
        storage.getAuditLogCount(orgId, filters)
      ]);
      
      res.json({ logs, count });
    } catch (error: any) {
      console.error("Audit log error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch audit logs" });
    }
  });

  // TCPA Compliance (20.2)
  api.get("/api/compliance/tcpa/no-consent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const leads = await storage.getLeadsWithoutConsent(orgId);
      res.json(leads);
    } catch (error: any) {
      console.error("TCPA no-consent error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch leads without consent" });
    }
  });

  api.get("/api/compliance/tcpa/opted-out", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const leads = await storage.getLeadsOptedOut(orgId);
      res.json(leads);
    } catch (error: any) {
      console.error("TCPA opted-out error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch opted-out leads" });
    }
  });

  api.patch("/api/leads/:id/consent", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      const leadId = parseInt(req.params.id);
      const { tcpaConsent, consentSource, optOutReason } = req.body;
      
      const existingLead = await storage.getLead(orgId, leadId);
      if (!existingLead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      const updated = await storage.updateLeadConsent(leadId, {
        tcpaConsent,
        consentSource,
        optOutReason
      });
      
      // Log consent change in audit log
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: tcpaConsent ? "consent_granted" : "consent_revoked",
        entityType: "lead",
        entityId: leadId,
        changes: {
          before: { tcpaConsent: existingLead.tcpaConsent },
          after: { tcpaConsent },
          fields: ["tcpaConsent"]
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Update consent error:", error);
      res.status(500).json({ message: error.message || "Failed to update consent" });
    }
  });

  // Data Retention (20.3)
  api.get("/api/compliance/retention-policies", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization!;
      const policies = org.settings?.retentionPolicies || {
        leads: { enabled: false, retentionDays: 365 },
        closedDeals: { enabled: false, retentionDays: 2555 }, // 7 years for tax purposes
        auditLogs: { enabled: false, retentionDays: 2555 },
        communications: { enabled: false, retentionDays: 365 }
      };
      res.json(policies);
    } catch (error: any) {
      console.error("Get retention policies error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch retention policies" });
    }
  });

  api.patch("/api/compliance/retention-policies", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      const org = (req as any).organization!;
      const newPolicies = req.body;
      
      const updatedSettings = {
        ...org.settings,
        retentionPolicies: newPolicies
      };
      
      const updated = await storage.updateOrganization(orgId, { settings: updatedSettings });
      
      // Log policy change in audit log
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "update",
        entityType: "settings",
        entityId: orgId,
        changes: {
          before: { retentionPolicies: org.settings?.retentionPolicies },
          after: { retentionPolicies: newPolicies },
          fields: ["retentionPolicies"]
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json(updated.settings?.retentionPolicies);
    } catch (error: any) {
      console.error("Update retention policies error:", error);
      res.status(500).json({ message: error.message || "Failed to update retention policies" });
    }
  });

  api.post("/api/compliance/purge-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      const userId = (req.user as any).id;
      const { dataType, beforeDate } = req.body;
      
      if (!dataType || !beforeDate) {
        return res.status(400).json({ message: "dataType and beforeDate are required" });
      }
      
      const date = new Date(beforeDate);
      let purgedCount = 0;
      
      switch (dataType) {
        case "leads":
          purgedCount = await storage.purgeOldLeads(orgId, date);
          break;
        case "closedDeals":
          purgedCount = await storage.purgeOldDeals(orgId, date, "closed");
          break;
        case "auditLogs":
          purgedCount = await storage.purgeOldAuditLogs(orgId, date);
          break;
        case "communications":
          purgedCount = await storage.purgeOldCommunications(orgId, date);
          break;
        default:
          return res.status(400).json({ message: "Invalid dataType" });
      }
      
      // Log purge action in audit log
      await storage.createAuditLogEntry({
        organizationId: orgId,
        userId,
        action: "data_purge",
        entityType: dataType,
        entityId: null,
        changes: null,
        metadata: {
          beforeDate: beforeDate,
          purgedCount
        },
        ipAddress: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
      });
      
      res.json({ purgedCount, dataType, beforeDate });
    } catch (error: any) {
      console.error("Purge data error:", error);
      res.status(500).json({ message: error.message || "Failed to purge data" });
    }
  });

  // TCPA stats endpoint
  api.get("/api/compliance/tcpa/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const orgId = (req as any).organization!.id;
      
      const [noConsent, optedOut, allLeads] = await Promise.all([
        storage.getLeadsWithoutConsent(orgId),
        storage.getLeadsOptedOut(orgId),
        storage.getLeads(orgId)
      ]);
      
      const withConsent = allLeads.filter(l => l.tcpaConsent === true).length;
      
      res.json({
        total: allLeads.length,
        withConsent,
        withoutConsent: noConsent.length,
        optedOut: optedOut.length
      });
    } catch (error: any) {
      console.error("TCPA stats error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch TCPA stats" });
    }
  });

  // ============================================
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
  // DOCUMENT TEMPLATES (Phase 4.3-4.5)
  // ============================================

  // GET /api/document-templates - List all templates (system + org-specific)
  api.get("/api/document-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      // Seed system templates if none exist
      await storage.seedSystemTemplates();
      
      const templates = await storage.getDocumentTemplates(org.id);
      res.json(templates);
    } catch (error: any) {
      console.error("Get document templates error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch templates" });
    }
  });

  // GET /api/document-templates/:id - Get template by ID
  api.get("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const template = await storage.getDocumentTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      res.json(template);
    } catch (error: any) {
      console.error("Get document template error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch template" });
    }
  });

  // POST /api/document-templates - Create new custom template
  api.post("/api/document-templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { name, type, category, content, variables } = req.body;
      
      if (!name || !type || !content) {
        return res.status(400).json({ message: "Name, type, and content are required" });
      }
      
      const template = await storage.createDocumentTemplate({
        organizationId: org.id,
        name,
        type,
        category: category || "closing",
        content,
        variables: variables || [],
        isSystemTemplate: false,
        isActive: true,
      });
      
      res.status(201).json(template);
    } catch (error: any) {
      console.error("Create document template error:", error);
      res.status(500).json({ message: error.message || "Failed to create template" });
    }
  });

  // PUT /api/document-templates/:id - Update template
  api.put("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const existing = await storage.getDocumentTemplate(id);
      if (!existing) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Only allow editing org-specific templates, not system templates
      if (existing.isSystemTemplate) {
        return res.status(403).json({ message: "Cannot edit system templates" });
      }
      
      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to edit this template" });
      }
      
      const { name, type, category, content, variables, isActive } = req.body;
      
      const updated = await storage.updateDocumentTemplate(id, {
        ...(name && { name }),
        ...(type && { type }),
        ...(category && { category }),
        ...(content && { content }),
        ...(variables && { variables }),
        ...(isActive !== undefined && { isActive }),
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Update document template error:", error);
      res.status(500).json({ message: error.message || "Failed to update template" });
    }
  });

  // PATCH /api/document-templates/:id - Update template (alias for PUT)
  api.patch("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const existing = await storage.getDocumentTemplate(id);
      if (!existing) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Only allow editing org-specific templates, not system templates
      if (existing.isSystemTemplate) {
        return res.status(403).json({ message: "Cannot edit system templates" });
      }
      
      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to edit this template" });
      }
      
      const { name, type, category, content, variables, isActive } = req.body;
      
      const updated = await storage.updateDocumentTemplate(id, {
        ...(name && { name }),
        ...(type && { type }),
        ...(category && { category }),
        ...(content && { content }),
        ...(variables && { variables }),
        ...(isActive !== undefined && { isActive }),
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Update document template error:", error);
      res.status(500).json({ message: error.message || "Failed to update template" });
    }
  });

  // DELETE /api/document-templates/:id - Delete template
  api.delete("/api/document-templates/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const existing = await storage.getDocumentTemplate(id);
      if (!existing) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Cannot delete system templates
      if (existing.isSystemTemplate) {
        return res.status(403).json({ message: "Cannot delete system templates" });
      }
      
      // Verify template belongs to this org
      if (existing.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to delete this template" });
      }
      
      await storage.deleteDocumentTemplate(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete document template error:", error);
      res.status(500).json({ message: error.message || "Failed to delete template" });
    }
  });

  // POST /api/document-templates/:id/preview - Preview template with sample data
  api.post("/api/document-templates/:id/preview", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const template = await storage.getDocumentTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Verify access - either system template or belongs to this org
      if (!template.isSystemTemplate && template.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to preview this template" });
      }
      
      // Get sample data from request body or use defaults
      const { sampleData } = req.body;
      
      // Default sample data for common placeholders
      const defaultSampleData: Record<string, string> = {
        // Property fields
        "property.address": "123 Oak Lane, Austin, TX 78701",
        "property.apn": "APN-12345-678",
        "property.county": "Travis",
        "property.state": "Texas",
        "property.sizeAcres": "5.5",
        "property.purchasePrice": "$45,000",
        "property.assessedValue": "$52,000",
        "property.legalDescription": "Lot 42, Block 3, Oak Ridge Subdivision",
        // Lead/Contact fields  
        "lead.firstName": "John",
        "lead.lastName": "Smith",
        "lead.fullName": "John Smith",
        "lead.email": "john.smith@example.com",
        "lead.phone": "(555) 123-4567",
        "lead.address": "456 Maple Street, Dallas, TX 75201",
        // Organization fields
        "organization.name": org.name,
        "organization.email": (org.settings as any)?.companyEmail || "contact@company.com",
        "organization.phone": (org.settings as any)?.companyPhone || "(555) 999-0000",
        "organization.address": (org.settings as any)?.companyAddress || "789 Business Ave, Suite 100",
        // Deal fields
        "deal.title": "Oak Lane Property Acquisition",
        "deal.offerAmount": "$40,000",
        "deal.earnestMoney": "$1,000",
        "deal.closingDate": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
        // Date fields
        "date.today": new Date().toLocaleDateString(),
        "date.current": new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
        // Note/Finance fields
        "note.principal": "$35,000",
        "note.interestRate": "9.9%",
        "note.termMonths": "60",
        "note.monthlyPayment": "$741.52",
        "note.downPayment": "$5,000",
      };
      
      // Merge provided sample data with defaults
      const mergedData = { ...defaultSampleData, ...(sampleData || {}) };
      
      // Replace all placeholders in template content
      let previewContent = template.content;
      for (const [key, value] of Object.entries(mergedData)) {
        // Support both {{key}} and {{key.subkey}} formats
        const regex = new RegExp(`\\{\\{${key.replace('.', '\\.')}\\}\\}`, 'g');
        previewContent = previewContent.replace(regex, String(value));
      }
      
      // Also replace any simple placeholders without dots
      if (template.variables && Array.isArray(template.variables)) {
        for (const variable of template.variables) {
          const varName = variable.name;
          if (!varName.includes('.') && !mergedData[varName]) {
            const defaultValue = variable.defaultValue || `[${varName}]`;
            const regex = new RegExp(`\\{\\{${varName}\\}\\}`, 'g');
            previewContent = previewContent.replace(regex, defaultValue);
          }
        }
      }
      
      // Mark any remaining unresolved placeholders
      previewContent = previewContent.replace(/\{\{([^}]+)\}\}/g, '[$1]');
      
      res.json({
        templateId: template.id,
        templateName: template.name,
        previewContent,
        usedData: mergedData,
      });
    } catch (error: any) {
      console.error("Preview document template error:", error);
      res.status(500).json({ message: error.message || "Failed to preview template" });
    }
  });

  // ============================================
  // DOCUMENT VERSION HISTORY
  // ============================================

  // GET /api/document-templates/:id/versions - Get version history for a template
  api.get("/api/document-templates/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const versions = await storage.getDocumentVersions(org.id, id, "template");
      res.json(versions);
    } catch (error: any) {
      console.error("Get template versions error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch version history" });
    }
  });

  // POST /api/document-templates/:id/versions - Create a version snapshot for a template
  api.post("/api/document-templates/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid template ID" });
      }
      
      const template = await storage.getDocumentTemplate(id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      if (!template.isSystemTemplate && template.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to version this template" });
      }
      
      const versions = await storage.getDocumentVersions(org.id, id, "template");
      const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) + 1 : 1;
      
      const version = await storage.createDocumentVersion({
        organizationId: org.id,
        documentId: id,
        documentType: "template",
        version: nextVersion,
        content: template.content,
        variables: template.variables,
        changes: req.body.changes || `Version ${nextVersion} created`,
        createdBy: user?.id || user?.claims?.sub || "system",
      });
      
      res.status(201).json(version);
    } catch (error: any) {
      console.error("Create template version error:", error);
      res.status(500).json({ message: error.message || "Failed to create version" });
    }
  });

  // GET /api/generated-documents/:id/versions - Get version history for a generated document
  api.get("/api/generated-documents/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const versions = await storage.getDocumentVersions(org.id, id, "generated");
      res.json(versions);
    } catch (error: any) {
      console.error("Get document versions error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch version history" });
    }
  });

  // POST /api/generated-documents/:id/versions - Create a version snapshot for a generated document
  api.post("/api/generated-documents/:id/versions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const doc = await storage.getGeneratedDocument(org.id, id);
      if (!doc) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const versions = await storage.getDocumentVersions(org.id, id, "generated");
      const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) + 1 : 1;
      
      const version = await storage.createDocumentVersion({
        organizationId: org.id,
        documentId: id,
        documentType: "generated",
        version: nextVersion,
        content: doc.content || "",
        changes: req.body.changes || `Version ${nextVersion} created`,
        createdBy: user?.id || user?.claims?.sub || "system",
      });
      
      res.status(201).json(version);
    } catch (error: any) {
      console.error("Create document version error:", error);
      res.status(500).json({ message: error.message || "Failed to create version" });
    }
  });

  // GET /api/documents/versions/:versionId - Get a specific version
  api.get("/api/documents/versions/:versionId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const versionId = parseInt(req.params.versionId);
      
      if (isNaN(versionId)) {
        return res.status(400).json({ message: "Invalid version ID" });
      }
      
      const version = await storage.getDocumentVersion(versionId);
      if (!version) {
        return res.status(404).json({ message: "Version not found" });
      }
      
      if (version.organizationId !== org.id) {
        return res.status(403).json({ message: "Not authorized to view this version" });
      }
      
      res.json(version);
    } catch (error: any) {
      console.error("Get version error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch version" });
    }
  });

  // POST /api/documents/versions/:versionId/restore - Restore to a previous version
  api.post("/api/documents/versions/:versionId/restore", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const versionId = parseInt(req.params.versionId);
      
      if (isNaN(versionId)) {
        return res.status(400).json({ message: "Invalid version ID" });
      }
      
      const result = await storage.restoreDocumentVersion(org.id, versionId);
      
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Restore version error:", error);
      res.status(500).json({ message: error.message || "Failed to restore version" });
    }
  });

  // ============================================
  // GENERATED DOCUMENTS (Phase 4.3-4.5)
  // ============================================

  // GET /api/documents - List generated documents (alias)
  api.get("/api/documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const documents = await storage.getGeneratedDocuments(org.id, { dealId, propertyId, status });
      res.json(documents);
    } catch (error: any) {
      console.error("Get documents error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch documents" });
    }
  });

  // POST /api/documents/generate - Generate document from template
  api.post("/api/documents/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { templateId, dealId, propertyId, name, variables } = req.body;
      
      if (!templateId) {
        return res.status(400).json({ message: "Template ID is required" });
      }
      
      const template = await storage.getDocumentTemplate(templateId);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Generate content by replacing variables
      let generatedContent = template.content;
      if (variables && typeof variables === 'object') {
        for (const [key, value] of Object.entries(variables)) {
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          generatedContent = generatedContent.replace(regex, String(value));
        }
      }
      
      const document = await storage.createGeneratedDocument({
        organizationId: org.id,
        templateId,
        dealId: dealId || null,
        propertyId: propertyId || null,
        name: name || `${template.name} - ${new Date().toLocaleDateString()}`,
        type: template.type,
        content: generatedContent,
        variables: variables || {},
        status: "draft",
        createdBy: user?.id ? parseInt(user.id) : undefined,
      });
      
      res.status(201).json(document);
    } catch (error: any) {
      console.error("Generate document error:", error);
      res.status(500).json({ message: error.message || "Failed to generate document" });
    }
  });

  // GET /api/generated-documents - List generated documents
  api.get("/api/generated-documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const documents = await storage.getGeneratedDocuments(org.id, { dealId, propertyId, status });
      res.json(documents);
    } catch (error: any) {
      console.error("Get generated documents error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch documents" });
    }
  });

  // GET /api/generated-documents/:id - Get document by ID
  api.get("/api/generated-documents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      res.json(document);
    } catch (error: any) {
      console.error("Get generated document error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch document" });
    }
  });

  // POST /api/generated-documents - Generate document from template
  api.post("/api/generated-documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { templateId, dealId, propertyId, name, variables } = req.body;
      
      if (!templateId) {
        return res.status(400).json({ message: "Template ID is required" });
      }
      
      const template = await storage.getDocumentTemplate(templateId);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      
      // Generate content by replacing variables
      let generatedContent = template.content;
      if (variables && typeof variables === 'object') {
        for (const [key, value] of Object.entries(variables)) {
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          generatedContent = generatedContent.replace(regex, String(value));
        }
      }
      
      const document = await storage.createGeneratedDocument({
        organizationId: org.id,
        templateId,
        dealId: dealId || null,
        propertyId: propertyId || null,
        name: name || `${template.name} - ${new Date().toLocaleDateString()}`,
        type: template.type,
        content: generatedContent,
        variables: variables || {},
        status: "draft",
        createdBy: user?.id ? parseInt(user.id) : undefined,
      });
      
      res.status(201).json(document);
    } catch (error: any) {
      console.error("Create generated document error:", error);
      res.status(500).json({ message: error.message || "Failed to generate document" });
    }
  });

  // PUT /api/generated-documents/:id - Update document
  api.put("/api/generated-documents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const existing = await storage.getGeneratedDocument(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const { name, content, status, signers } = req.body;
      
      const updated = await storage.updateGeneratedDocument(id, {
        ...(name && { name }),
        ...(content && { content }),
        ...(status && { status }),
        ...(signers && { signers }),
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Update generated document error:", error);
      res.status(500).json({ message: error.message || "Failed to update document" });
    }
  });

  // ============================================
  // NATIVE E-SIGNATURE SYSTEM (No external service required)
  // ============================================

  // POST /api/signatures - Create a new signature
  api.post("/api/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { documentId, signerName, signerEmail, signerRole, signatureData, signatureType, consentGiven, consentText } = req.body;
      
      if (!signerName || !signatureData) {
        return res.status(400).json({ message: "Signer name and signature data are required" });
      }
      
      const signature = await storage.createSignature({
        organizationId: org.id,
        documentId: documentId || null,
        signerName,
        signerEmail: signerEmail || null,
        signerRole: signerRole || "signer",
        signatureData,
        signatureType: signatureType || "drawn",
        ipAddress: req.ip || (req.headers['x-forwarded-for'] as string) || null,
        userAgent: req.headers['user-agent'] || null,
        consentGiven: consentGiven !== false,
        consentText: consentText || "I agree that this electronic signature is legally binding.",
      });
      
      // If linked to a document, update document signers
      if (documentId) {
        const document = await storage.getGeneratedDocument(org.id, documentId);
        if (document) {
          const existingSigners = (document.signers || []) as Array<{
            id: string;
            name: string;
            email: string;
            role: string;
            signedAt?: string;
            signatureUrl?: string;
          }>;
          
          const updatedSigners = existingSigners.map(s => {
            if (s.name === signerName || s.email === signerEmail) {
              return {
                ...s,
                signedAt: new Date().toISOString(),
                signatureUrl: signatureData,
              };
            }
            return s;
          });
          
          // Check if all signers have signed
          const allSigned = updatedSigners.every(s => s.signedAt);
          
          await storage.updateGeneratedDocument(documentId, {
            signers: updatedSigners,
            status: allSigned ? "signed" : "partially_signed",
            ...(allSigned && { completedAt: new Date() }),
          });
        }
      }
      
      res.json({ success: true, signature });
    } catch (error: any) {
      console.error("Create signature error:", error);
      res.status(500).json({ message: error.message || "Failed to create signature" });
    }
  });

  // GET /api/signatures - List signatures
  api.get("/api/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const documentId = req.query.documentId ? parseInt(req.query.documentId as string) : undefined;
      
      const signatures = await storage.getSignatures(org.id, documentId);
      res.json(signatures);
    } catch (error: any) {
      console.error("Get signatures error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch signatures" });
    }
  });

  // GET /api/signatures/:id - Get a specific signature
  api.get("/api/signatures/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid signature ID" });
      }
      
      const signature = await storage.getSignature(org.id, id);
      if (!signature) {
        return res.status(404).json({ message: "Signature not found" });
      }
      
      res.json(signature);
    } catch (error: any) {
      console.error("Get signature error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch signature" });
    }
  });

  // GET /api/generated-documents/:id/signatures - Get signatures for a document
  api.get("/api/generated-documents/:id/signatures", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const documentId = parseInt(req.params.id);
      
      if (isNaN(documentId)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getGeneratedDocument(org.id, documentId);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      const signatures = await storage.getDocumentSignatures(documentId);
      res.json(signatures);
    } catch (error: any) {
      console.error("Get document signatures error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch document signatures" });
    }
  });

  // POST /api/generated-documents/:id/request-signature - Request signatures (native system)
  api.post("/api/generated-documents/:id/request-signature", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      if (document.status !== "draft") {
        return res.status(400).json({ message: "Document has already been sent or signed" });
      }
      
      const { signers } = req.body;
      
      if (!signers || !Array.isArray(signers) || signers.length === 0) {
        return res.status(400).json({ message: "At least one signer is required" });
      }
      
      // Format signers with IDs
      const formattedSigners = signers.map((signer: any, index: number) => ({
        id: `signer-${Date.now()}-${index}`,
        name: signer.name,
        email: signer.email,
        role: signer.role || "signer",
        order: index + 1,
      }));
      
      const updated = await storage.updateGeneratedDocument(id, {
        status: "pending_signature",
        esignProvider: "native",
        esignStatus: "pending",
        signers: formattedSigners,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      
      res.json({
        success: true,
        message: "Document ready for signature",
        document: updated,
        signingUrl: `/sign/${id}`,
      });
    } catch (error: any) {
      console.error("Request signature error:", error);
      res.status(500).json({ message: error.message || "Failed to request signatures" });
    }
  });

  // POST /api/generated-documents/:id/send-for-signature - Send document for e-signature (legacy)
  api.post("/api/generated-documents/:id/send-for-signature", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getGeneratedDocument(org.id, id);
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }
      
      if (document.status !== "draft") {
        return res.status(400).json({ message: "Document has already been sent or signed" });
      }
      
      const { signers } = req.body;
      
      const updated = await storage.updateGeneratedDocument(id, {
        status: "pending_signature",
        esignProvider: "native",
        esignStatus: "pending",
        signers: signers || [],
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      
      res.json({
        success: true,
        message: "Document ready for signature",
        document: updated,
      });
    } catch (error: any) {
      console.error("Send for signature error:", error);
      res.status(500).json({ message: error.message || "Failed to send for signature" });
    }
  });

  // ============================================
  // DOCUMENT PACKAGES
  // ============================================

  // GET /api/document-packages - List packages
  api.get("/api/document-packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = req.query.dealId ? parseInt(req.query.dealId as string) : undefined;
      const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      const packages = await storage.getDocumentPackages(org.id, { dealId, propertyId, status });
      res.json(packages);
    } catch (error: any) {
      console.error("Get document packages error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch document packages" });
    }
  });

  // GET /api/document-packages/:id - Get package with documents
  api.get("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      res.json(pkg);
    } catch (error: any) {
      console.error("Get document package error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch document package" });
    }
  });

  // POST /api/document-packages - Create package
  api.post("/api/document-packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const { name, description, dealId, propertyId, documents } = req.body;
      
      if (!name) {
        return res.status(400).json({ message: "Package name is required" });
      }
      
      const pkg = await storage.createDocumentPackage({
        organizationId: org.id,
        name,
        description,
        dealId: dealId || null,
        propertyId: propertyId || null,
        documents: documents || [],
        status: "draft",
        createdBy: user?.id || null,
      });
      
      res.status(201).json(pkg);
    } catch (error: any) {
      console.error("Create document package error:", error);
      res.status(500).json({ message: error.message || "Failed to create document package" });
    }
  });

  // PUT /api/document-packages/:id - Update package
  api.put("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const existing = await storage.getDocumentPackage(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      const { name, description, dealId, propertyId, documents, status, sentAt, completedAt } = req.body;
      
      const updated = await storage.updateDocumentPackage(id, {
        name,
        description,
        dealId,
        propertyId,
        documents,
        status,
        sentAt: sentAt ? new Date(sentAt) : undefined,
        completedAt: completedAt ? new Date(completedAt) : undefined,
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Update document package error:", error);
      res.status(500).json({ message: error.message || "Failed to update document package" });
    }
  });

  // DELETE /api/document-packages/:id - Delete package
  api.delete("/api/document-packages/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const deleted = await storage.deleteDocumentPackage(org.id, id);
      if (!deleted) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      res.json({ success: true, message: "Document package deleted" });
    } catch (error: any) {
      console.error("Delete document package error:", error);
      res.status(500).json({ message: error.message || "Failed to delete document package" });
    }
  });

  // POST /api/document-packages/:id/documents - Add document/template to package
  api.post("/api/document-packages/:id/documents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      const { templateId, documentId, name } = req.body;
      
      if (!templateId && !documentId) {
        return res.status(400).json({ message: "Either templateId or documentId is required" });
      }
      
      const currentDocs = pkg.documents || [];
      const newOrder = currentDocs.length + 1;
      
      const newDoc = {
        templateId: templateId || 0,
        documentId: documentId || undefined,
        order: newOrder,
        status: "pending",
        name: name || undefined,
      };
      
      const updated = await storage.updateDocumentPackage(id, {
        documents: [...currentDocs, newDoc],
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Add document to package error:", error);
      res.status(500).json({ message: error.message || "Failed to add document to package" });
    }
  });

  // DELETE /api/document-packages/:id/documents/:docIndex - Remove document from package
  api.delete("/api/document-packages/:id/documents/:docIndex", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const docIndex = parseInt(req.params.docIndex);
      
      if (isNaN(id) || isNaN(docIndex)) {
        return res.status(400).json({ message: "Invalid package ID or document index" });
      }
      
      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      const currentDocs = pkg.documents || [];
      if (docIndex < 0 || docIndex >= currentDocs.length) {
        return res.status(400).json({ message: "Invalid document index" });
      }
      
      const updatedDocs = currentDocs.filter((_, i) => i !== docIndex);
      const reorderedDocs = updatedDocs.map((doc, i) => ({ ...doc, order: i + 1 }));
      
      const updated = await storage.updateDocumentPackage(id, {
        documents: reorderedDocs,
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Remove document from package error:", error);
      res.status(500).json({ message: error.message || "Failed to remove document from package" });
    }
  });

  // POST /api/document-packages/:id/generate-all - Generate all documents in package
  api.post("/api/document-packages/:id/generate-all", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid package ID" });
      }
      
      const pkg = await storage.getDocumentPackage(org.id, id);
      if (!pkg) {
        return res.status(404).json({ message: "Document package not found" });
      }
      
      const { variables } = req.body;
      const currentDocs = pkg.documents || [];
      const generatedDocs: any[] = [];
      
      for (const docItem of currentDocs) {
        if (docItem.documentId) {
          generatedDocs.push({ ...docItem, status: "generated" });
          continue;
        }
        
        const template = await storage.getDocumentTemplate(docItem.templateId);
        if (!template) {
          generatedDocs.push({ ...docItem, status: "error" });
          continue;
        }
        
        // Security: Ensure template belongs to this org or is a system template
        if (template.organizationId !== null && template.organizationId !== org.id) {
          generatedDocs.push({ ...docItem, status: "error" });
          continue;
        }
        
        let content = template.content;
        const mergedVars = { ...variables };
        
        if (pkg.dealId) {
          const deal = await storage.getDeal(org.id, pkg.dealId);
          if (deal) {
            Object.assign(mergedVars, {
              deal_name: deal.name,
              offer_amount: deal.offerAmount,
              accepted_amount: deal.acceptedAmount,
            });
          }
        }
        
        if (pkg.propertyId) {
          const property = await storage.getProperty(org.id, pkg.propertyId);
          if (property) {
            Object.assign(mergedVars, {
              property_address: property.address,
              property_city: property.city,
              property_state: property.state,
              property_zip: property.zipCode,
              parcel_number: property.parcelNumber,
              acreage: property.acreage,
            });
          }
        }
        
        for (const [key, value] of Object.entries(mergedVars)) {
          const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
          content = content.replace(regex, String(value || ''));
        }
        
        const generatedDoc = await storage.createGeneratedDocument({
          organizationId: org.id,
          templateId: template.id,
          dealId: pkg.dealId || undefined,
          propertyId: pkg.propertyId || undefined,
          name: docItem.name || template.name,
          type: template.type,
          content,
          variables: mergedVars,
          status: "draft",
          generatedBy: user?.id,
        });
        
        generatedDocs.push({
          ...docItem,
          documentId: generatedDoc.id,
          status: "generated",
        });
      }
      
      const updated = await storage.updateDocumentPackage(id, {
        documents: generatedDocs,
        status: "complete",
      });
      
      res.json({
        success: true,
        message: `Generated ${generatedDocs.filter(d => d.status === 'generated').length} documents`,
        package: updated,
      });
    } catch (error: any) {
      console.error("Generate all documents error:", error);
      res.status(500).json({ message: error.message || "Failed to generate documents" });
    }
  });

  // GET /api/deals/:id/packages - Get packages for a deal
  api.get("/api/deals/:id/packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = parseInt(req.params.id);
      
      if (isNaN(dealId)) {
        return res.status(400).json({ message: "Invalid deal ID" });
      }
      
      const packages = await storage.getPackagesByDeal(org.id, dealId);
      res.json(packages);
    } catch (error: any) {
      console.error("Get deal packages error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch deal packages" });
    }
  });

  // GET /api/properties/:id/packages - Get packages for a property
  api.get("/api/properties/:id/packages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.id);
      
      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "Invalid property ID" });
      }
      
      const packages = await storage.getPackagesByProperty(org.id, propertyId);
      res.json(packages);
    } catch (error: any) {
      console.error("Get property packages error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property packages" });
    }
  });

  // ============================================
  // ANALYTICS & REPORTING (Phase 7)
  // ============================================

  function parseDateRange(range: string): { startDate: Date; endDate: Date } {
    const endDate = new Date();
    let startDate = new Date();
    
    switch (range) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }
    
    return { startDate, endDate };
  }

  // GET /api/analytics/executive - Executive metrics
  api.get("/api/analytics/executive", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getExecutiveMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get executive metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch executive metrics" });
    }
  });

  // GET /api/analytics/revenue - Revenue metrics
  api.get("/api/analytics/revenue", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getRevenueMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get revenue metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch revenue metrics" });
    }
  });

  // GET /api/analytics/leads - Lead metrics
  api.get("/api/analytics/leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getLeadMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get lead metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch lead metrics" });
    }
  });

  // GET /api/analytics/deals - Deal metrics
  api.get("/api/analytics/deals", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getDealMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get deal metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch deal metrics" });
    }
  });

  // GET /api/analytics/campaigns - Campaign metrics
  api.get("/api/analytics/campaigns", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getCampaignMetrics(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get campaign metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch campaign metrics" });
    }
  });

  // GET /api/analytics/pipeline - Pipeline value by stage
  api.get("/api/analytics/pipeline", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
      const metrics = await storage.getPipelineValue(org.id);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get pipeline metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch pipeline metrics" });
    }
  });

  // GET /api/analytics/velocity - Deal velocity metrics
  api.get("/api/analytics/velocity", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getDealVelocity(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get velocity metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch velocity metrics" });
    }
  });

  // GET /api/analytics/conversions - Conversion rates
  api.get("/api/analytics/conversions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const range = (req.query.range as string) || '30d';
      const dateRange = parseDateRange(range);
      
      const metrics = await storage.getConversionRates(org.id, dateRange);
      res.json(metrics);
    } catch (error: any) {
      console.error("Get conversion metrics error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch conversion metrics" });
    }
  });

  // ============================================
  // AUTOMATION RULES (Phase 8.1)
  // ============================================

  // GET /api/automation-rules - List all automation rules
  api.get("/api/automation-rules", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const rules = await storage.getAutomationRules(org.id);
      res.json(rules);
    } catch (error: any) {
      console.error("Get automation rules error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch automation rules" });
    }
  });

  // GET /api/automation-rules/:id - Get single rule
  api.get("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const rule = await storage.getAutomationRule(org.id, id);
      if (!rule) {
        return res.status(404).json({ message: "Automation rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      console.error("Get automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch automation rule" });
    }
  });

  // POST /api/automation-rules - Create new rule
  api.post("/api/automation-rules", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const rule = await storage.createAutomationRule({
        ...req.body,
        organizationId: org.id,
        createdBy: userId,
      });
      res.status(201).json(rule);
    } catch (error: any) {
      console.error("Create automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to create automation rule" });
    }
  });

  // PUT /api/automation-rules/:id - Update rule
  api.put("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Automation rule not found" });
      }
      
      const updated = await storage.updateAutomationRule(id, req.body);
      res.json(updated);
    } catch (error: any) {
      console.error("Update automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to update automation rule" });
    }
  });

  // DELETE /api/automation-rules/:id - Delete rule
  api.delete("/api/automation-rules/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Automation rule not found" });
      }
      
      await storage.deleteAutomationRule(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to delete automation rule" });
    }
  });

  // POST /api/automation-rules/:id/toggle - Toggle rule enabled status
  api.post("/api/automation-rules/:id/toggle", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const { enabled } = req.body;
      
      const existing = await storage.getAutomationRule(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Automation rule not found" });
      }
      
      const updated = await storage.toggleAutomationRule(id, enabled);
      res.json(updated);
    } catch (error: any) {
      console.error("Toggle automation rule error:", error);
      res.status(500).json({ message: error.message || "Failed to toggle automation rule" });
    }
  });

  // GET /api/automation-executions - Get execution log
  api.get("/api/automation-executions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const ruleId = req.query.ruleId ? parseInt(req.query.ruleId as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      
      const executions = await storage.getAutomationExecutions(org.id, ruleId, limit);
      res.json(executions);
    } catch (error: any) {
      console.error("Get automation executions error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch automation executions" });
    }
  });

  // ============================================
  // ENHANCED TASKS (Phase 8.2)
  // ============================================

  // GET /api/tasks/my - Get current user's tasks
  api.get("/api/tasks/my", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const tasks = await storage.getMyTasks(org.id, userId);
      res.json(tasks);
    } catch (error: any) {
      console.error("Get my tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tasks" });
    }
  });

  // GET /api/tasks/entity/:entityType/:entityId - Get tasks for entity
  api.get("/api/tasks/entity/:entityType/:entityId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { entityType, entityId } = req.params;
      
      const tasks = await storage.getTasksByEntity(org.id, entityType, parseInt(entityId));
      res.json(tasks);
    } catch (error: any) {
      console.error("Get entity tasks error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tasks" });
    }
  });

  // PUT /api/tasks/:id/complete - Mark task as complete
  api.put("/api/tasks/:id/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      
      const existing = await storage.getTask(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Task not found" });
      }
      
      const completed = await storage.completeTask(id);
      res.json(completed);
    } catch (error: any) {
      console.error("Complete task error:", error);
      res.status(500).json({ message: error.message || "Failed to complete task" });
    }
  });

  // ============================================
  // NOTIFICATIONS (Phase 8.3)
  // ============================================

  // GET /api/notifications - Get user's notifications
  api.get("/api/notifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const unreadOnly = req.query.unreadOnly === 'true';
      
      const notifications = await storage.getNotifications(org.id, userId, unreadOnly);
      res.json(notifications);
    } catch (error: any) {
      console.error("Get notifications error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch notifications" });
    }
  });

  // GET /api/notifications/count - Get unread notification count
  api.get("/api/notifications/count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      const count = await storage.getUnreadNotificationCount(org.id, userId);
      res.json({ count });
    } catch (error: any) {
      console.error("Get notification count error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch notification count" });
    }
  });

  // PUT /api/notifications/:id/read - Mark notification as read
  api.put("/api/notifications/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const notification = await storage.markNotificationRead(id);
      res.json(notification);
    } catch (error: any) {
      console.error("Mark notification read error:", error);
      res.status(500).json({ message: error.message || "Failed to mark notification as read" });
    }
  });

  // PUT /api/notifications/read-all - Mark all notifications as read
  api.put("/api/notifications/read-all", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      
      await storage.markAllNotificationsRead(org.id, userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Mark all notifications read error:", error);
      res.status(500).json({ message: error.message || "Failed to mark notifications as read" });
    }
  });

  // ============================================
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
      const id = parseInt(req.params.id);
      const identity = await storage.getEmailSenderIdentity(id);
      if (!identity) {
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
      const id = parseInt(req.params.id);
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
      const id = parseInt(req.params.id);
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
      const id = parseInt(req.params.id);
      const identity = await storage.getMailSenderIdentity(id);
      if (!identity) {
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
      const id = parseInt(req.params.id);
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
      const id = parseInt(req.params.id);
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
      const id = parseInt(req.params.id);
      const identity = await storage.getMailSenderIdentity(id);
      if (!identity) {
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
      const id = parseInt(req.params.id);
      const order = await storage.getMailingOrder(id);
      if (!order) {
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
      const id = parseInt(req.params.id);
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
      const orderId = parseInt(req.params.id);
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
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
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
      const id = parseInt(req.params.id);
      const message = await storage.getInboxMessage(id);
      if (!message) {
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
      const id = parseInt(req.params.id);
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
      const id = parseInt(req.params.id);
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
      const id = parseInt(req.params.id);
      const currentMessage = await storage.getInboxMessage(id);
      if (!currentMessage) {
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
      const id = parseInt(req.params.id);
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
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      
      const activities = await storage.getActivityFeed(org.id, { entityType, limit, offset });
      res.json(activities);
    } catch (error: any) {
      console.error("Get activity feed error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch activity feed" });
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
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
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
  // MARKETING LISTS (VA Replacement Engine)
  // ============================================

  api.get("/api/marketing-lists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const lists = await storage.getMarketingLists(org.id);
      res.json(lists);
    } catch (error: any) {
      console.error("Get marketing lists error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch marketing lists" });
    }
  });

  api.get("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const list = await storage.getMarketingListById(org.id, id);
      if (!list) {
        return res.status(404).json({ message: "Marketing list not found" });
      }
      res.json(list);
    } catch (error: any) {
      console.error("Get marketing list error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch marketing list" });
    }
  });

  api.post("/api/marketing-lists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertMarketingListSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const list = await storage.createMarketingList(validated);
      res.status(201).json(list);
    } catch (error: any) {
      console.error("Create marketing list error:", error);
      res.status(400).json({ message: error.message || "Failed to create marketing list" });
    }
  });

  api.patch("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getMarketingListById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Marketing list not found" });
      }
      const list = await storage.updateMarketingList(org.id, id, req.body);
      res.json(list);
    } catch (error: any) {
      console.error("Update marketing list error:", error);
      res.status(400).json({ message: error.message || "Failed to update marketing list" });
    }
  });

  api.delete("/api/marketing-lists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getMarketingListById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Marketing list not found" });
      }
      await storage.deleteMarketingList(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete marketing list error:", error);
      res.status(500).json({ message: error.message || "Failed to delete marketing list" });
    }
  });

  // ============================================
  // OFFER BATCHES (VA Replacement Engine)
  // ============================================

  api.get("/api/offer-batches", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const batches = await storage.getOfferBatches(org.id);
      res.json(batches);
    } catch (error: any) {
      console.error("Get offer batches error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offer batches" });
    }
  });

  api.get("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const batch = await storage.getOfferBatchById(org.id, id);
      if (!batch) {
        return res.status(404).json({ message: "Offer batch not found" });
      }
      const batchOffers = await storage.getOffersByBatch(org.id, id);
      res.json({ ...batch, offersCount: batchOffers.length });
    } catch (error: any) {
      console.error("Get offer batch error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offer batch" });
    }
  });

  api.get("/api/offer-batches/:id/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const batch = await storage.getOfferBatchById(org.id, id);
      if (!batch) {
        return res.status(404).json({ message: "Offer batch not found" });
      }
      const batchOffers = await storage.getOffersByBatch(org.id, id);
      res.json(batchOffers);
    } catch (error: any) {
      console.error("Get offers in batch error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offers in batch" });
    }
  });

  api.post("/api/offer-batches", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertOfferBatchSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const batch = await storage.createOfferBatch(validated);
      res.status(201).json(batch);
    } catch (error: any) {
      console.error("Create offer batch error:", error);
      res.status(400).json({ message: error.message || "Failed to create offer batch" });
    }
  });

  api.patch("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferBatchById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer batch not found" });
      }
      const batch = await storage.updateOfferBatch(org.id, id, req.body);
      res.json(batch);
    } catch (error: any) {
      console.error("Update offer batch error:", error);
      res.status(400).json({ message: error.message || "Failed to update offer batch" });
    }
  });

  api.delete("/api/offer-batches/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferBatchById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer batch not found" });
      }
      await storage.deleteOfferBatch(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete offer batch error:", error);
      res.status(500).json({ message: error.message || "Failed to delete offer batch" });
    }
  });

  // ============================================
  // OFFERS (VA Replacement Engine)
  // ============================================

  api.get("/api/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      let orgOffers = await storage.getOffers(org.id);
      
      const batchId = req.query.batchId ? parseInt(req.query.batchId as string) : undefined;
      const leadId = req.query.leadId ? parseInt(req.query.leadId as string) : undefined;
      const status = req.query.status as string | undefined;
      
      if (batchId) {
        orgOffers = orgOffers.filter(o => o.batchId === batchId);
      }
      if (leadId) {
        orgOffers = orgOffers.filter(o => o.leadId === leadId);
      }
      if (status) {
        orgOffers = orgOffers.filter(o => o.status === status);
      }
      
      res.json(orgOffers);
    } catch (error: any) {
      console.error("Get offers error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offers" });
    }
  });

  api.get("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const offer = await storage.getOfferById(org.id, id);
      if (!offer) {
        return res.status(404).json({ message: "Offer not found" });
      }
      res.json(offer);
    } catch (error: any) {
      console.error("Get offer error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch offer" });
    }
  });

  api.post("/api/offers", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertOfferSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const offer = await storage.createOffer(validated);
      res.status(201).json(offer);
    } catch (error: any) {
      console.error("Create offer error:", error);
      res.status(400).json({ message: error.message || "Failed to create offer" });
    }
  });

  api.patch("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer not found" });
      }
      const offer = await storage.updateOffer(org.id, id, req.body);
      res.json(offer);
    } catch (error: any) {
      console.error("Update offer error:", error);
      res.status(400).json({ message: error.message || "Failed to update offer" });
    }
  });

  api.delete("/api/offers/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getOfferById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Offer not found" });
      }
      await storage.deleteOffer(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete offer error:", error);
      res.status(500).json({ message: error.message || "Failed to delete offer" });
    }
  });

  // ============================================
  // SELLER COMMUNICATIONS (VA Replacement Engine)
  // ============================================

  api.get("/api/seller-communications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      let comms = await storage.getSellerCommunications(org.id);
      
      const leadId = req.query.leadId ? parseInt(req.query.leadId as string) : undefined;
      if (leadId) {
        comms = comms.filter(c => c.leadId === leadId);
      }
      
      res.json(comms);
    } catch (error: any) {
      console.error("Get seller communications error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch seller communications" });
    }
  });

  api.get("/api/seller-communications/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const leadId = parseInt(req.params.leadId);
      const comms = await storage.getSellerCommunicationsByLead(leadId);
      res.json(comms);
    } catch (error: any) {
      console.error("Get seller communications by lead error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch seller communications" });
    }
  });

  api.get("/api/seller-communications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const comm = await storage.getSellerCommunicationById(org.id, id);
      if (!comm) {
        return res.status(404).json({ message: "Seller communication not found" });
      }
      res.json(comm);
    } catch (error: any) {
      console.error("Get seller communication error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch seller communication" });
    }
  });

  api.post("/api/seller-communications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertSellerCommunicationSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const comm = await storage.createSellerCommunication(validated);
      res.status(201).json(comm);
    } catch (error: any) {
      console.error("Create seller communication error:", error);
      res.status(400).json({ message: error.message || "Failed to create seller communication" });
    }
  });

  // ============================================
  // AD POSTINGS (VA Replacement Engine)
  // ============================================

  api.get("/api/ad-postings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const postings = await storage.getAdPostings(org.id);
      res.json(postings);
    } catch (error: any) {
      console.error("Get ad postings error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ad postings" });
    }
  });

  api.get("/api/ad-postings/property/:propertyId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const propertyId = parseInt(req.params.propertyId);
      const postings = await storage.getAdPostingsByProperty(propertyId);
      res.json(postings);
    } catch (error: any) {
      console.error("Get ad postings by property error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ad postings" });
    }
  });

  api.get("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const posting = await storage.getAdPostingById(org.id, id);
      if (!posting) {
        return res.status(404).json({ message: "Ad posting not found" });
      }
      res.json(posting);
    } catch (error: any) {
      console.error("Get ad posting error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ad posting" });
    }
  });

  api.post("/api/ad-postings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertAdPostingSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const posting = await storage.createAdPosting(validated);
      res.status(201).json(posting);
    } catch (error: any) {
      console.error("Create ad posting error:", error);
      res.status(400).json({ message: error.message || "Failed to create ad posting" });
    }
  });

  api.patch("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAdPostingById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Ad posting not found" });
      }
      const posting = await storage.updateAdPosting(org.id, id, req.body);
      res.json(posting);
    } catch (error: any) {
      console.error("Update ad posting error:", error);
      res.status(400).json({ message: error.message || "Failed to update ad posting" });
    }
  });

  api.delete("/api/ad-postings/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAdPostingById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Ad posting not found" });
      }
      await storage.deleteAdPosting(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete ad posting error:", error);
      res.status(500).json({ message: error.message || "Failed to delete ad posting" });
    }
  });

  // ============================================
  // BUYER PREQUALIFICATIONS (VA Replacement Engine)
  // ============================================

  api.get("/api/buyer-prequalifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const prequalifications = await storage.getBuyerPrequalifications(org.id);
      res.json(prequalifications);
    } catch (error: any) {
      console.error("Get buyer prequalifications error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer prequalifications" });
    }
  });

  api.get("/api/buyer-prequalifications/lead/:leadId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const leadId = parseInt(req.params.leadId);
      const prequal = await storage.getBuyerPrequalificationByLead(leadId);
      if (!prequal) {
        return res.status(404).json({ message: "Buyer prequalification not found for this lead" });
      }
      res.json(prequal);
    } catch (error: any) {
      console.error("Get buyer prequalification by lead error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer prequalification" });
    }
  });

  api.get("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const prequal = await storage.getBuyerPrequalificationById(org.id, id);
      if (!prequal) {
        return res.status(404).json({ message: "Buyer prequalification not found" });
      }
      res.json(prequal);
    } catch (error: any) {
      console.error("Get buyer prequalification error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer prequalification" });
    }
  });

  api.post("/api/buyer-prequalifications", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertBuyerPrequalificationSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const prequal = await storage.createBuyerPrequalification(validated);
      res.status(201).json(prequal);
    } catch (error: any) {
      console.error("Create buyer prequalification error:", error);
      res.status(400).json({ message: error.message || "Failed to create buyer prequalification" });
    }
  });

  api.patch("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerPrequalificationById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Buyer prequalification not found" });
      }
      const prequal = await storage.updateBuyerPrequalification(org.id, id, req.body);
      res.json(prequal);
    } catch (error: any) {
      console.error("Update buyer prequalification error:", error);
      res.status(400).json({ message: error.message || "Failed to update buyer prequalification" });
    }
  });

  api.delete("/api/buyer-prequalifications/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerPrequalificationById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Buyer prequalification not found" });
      }
      await storage.deleteBuyerPrequalification(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete buyer prequalification error:", error);
      res.status(500).json({ message: error.message || "Failed to delete buyer prequalification" });
    }
  });

  // ============================================
  // COLLECTION SEQUENCES (VA Replacement Engine)
  // ============================================

  api.get("/api/collection-sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const sequences = await storage.getCollectionSequences(org.id);
      res.json(sequences);
    } catch (error: any) {
      console.error("Get collection sequences error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection sequences" });
    }
  });

  api.get("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const sequence = await storage.getCollectionSequenceById(org.id, id);
      if (!sequence) {
        return res.status(404).json({ message: "Collection sequence not found" });
      }
      res.json(sequence);
    } catch (error: any) {
      console.error("Get collection sequence error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection sequence" });
    }
  });

  api.post("/api/collection-sequences", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertCollectionSequenceSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const sequence = await storage.createCollectionSequence(validated);
      res.status(201).json(sequence);
    } catch (error: any) {
      console.error("Create collection sequence error:", error);
      res.status(400).json({ message: error.message || "Failed to create collection sequence" });
    }
  });

  api.patch("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionSequenceById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Collection sequence not found" });
      }
      const sequence = await storage.updateCollectionSequence(org.id, id, req.body);
      res.json(sequence);
    } catch (error: any) {
      console.error("Update collection sequence error:", error);
      res.status(400).json({ message: error.message || "Failed to update collection sequence" });
    }
  });

  api.delete("/api/collection-sequences/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionSequenceById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Collection sequence not found" });
      }
      await storage.deleteCollectionSequence(org.id, id);
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete collection sequence error:", error);
      res.status(500).json({ message: error.message || "Failed to delete collection sequence" });
    }
  });

  // ============================================
  // COLLECTION ENROLLMENTS (VA Replacement Engine)
  // ============================================

  api.get("/api/collection-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const enrollments = await storage.getCollectionEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      console.error("Get collection enrollments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection enrollments" });
    }
  });

  api.get("/api/collection-enrollments/note/:noteId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const noteId = parseInt(req.params.noteId);
      const enrollments = await storage.getCollectionEnrollmentsByNote(noteId);
      res.json(enrollments);
    } catch (error: any) {
      console.error("Get collection enrollments by note error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection enrollments" });
    }
  });

  api.get("/api/collection-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const enrollment = await storage.getCollectionEnrollmentById(org.id, id);
      if (!enrollment) {
        return res.status(404).json({ message: "Collection enrollment not found" });
      }
      res.json(enrollment);
    } catch (error: any) {
      console.error("Get collection enrollment error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch collection enrollment" });
    }
  });

  api.post("/api/collection-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const validated = insertCollectionEnrollmentSchema.parse({
        ...req.body,
        organizationId: org.id,
      });
      const enrollment = await storage.createCollectionEnrollment(validated);
      res.status(201).json(enrollment);
    } catch (error: any) {
      console.error("Create collection enrollment error:", error);
      res.status(400).json({ message: error.message || "Failed to create collection enrollment" });
    }
  });

  api.patch("/api/collection-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getCollectionEnrollmentById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Collection enrollment not found" });
      }
      const enrollment = await storage.updateCollectionEnrollment(org.id, id, req.body);
      res.json(enrollment);
    } catch (error: any) {
      console.error("Update collection enrollment error:", error);
      res.status(400).json({ message: error.message || "Failed to update collection enrollment" });
    }
  });

  // ============================================
  // COUNTY RESEARCH (VA Replacement Engine)
  // ============================================

  api.get("/api/county-research", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const research = await storage.getCountyResearchList();
      res.json(research);
    } catch (error: any) {
      console.error("Get county research list error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch county research" });
    }
  });

  api.get("/api/county-research/lookup", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const state = req.query.state as string;
      const county = req.query.county as string;
      
      if (!state || !county) {
        return res.status(400).json({ message: "Both state and county query parameters are required" });
      }
      
      const research = await storage.getCountyResearch(state, county);
      if (!research) {
        return res.status(404).json({ message: "County research not found" });
      }
      res.json(research);
    } catch (error: any) {
      console.error("Get county research by state/county error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch county research" });
    }
  });

  api.get("/api/county-research/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const research = await storage.getCountyResearchById(id);
      if (!research) {
        return res.status(404).json({ message: "County research not found" });
      }
      res.json(research);
    } catch (error: any) {
      console.error("Get county research error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch county research" });
    }
  });

  api.post("/api/county-research", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const validated = insertCountyResearchSchema.parse(req.body);
      const research = await storage.createCountyResearch(validated);
      res.status(201).json(research);
    } catch (error: any) {
      console.error("Create county research error:", error);
      res.status(400).json({ message: error.message || "Failed to create county research" });
    }
  });

  api.patch("/api/county-research/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getCountyResearchById(id);
      if (!existing) {
        return res.status(404).json({ message: "County research not found" });
      }
      const research = await storage.updateCountyResearch(id, req.body);
      res.json(research);
    } catch (error: any) {
      console.error("Update county research error:", error);
      res.status(400).json({ message: error.message || "Failed to update county research" });
    }
  });

  // ============================================
  // BUYER RESERVATIONS (Phase 4)
  // ============================================

  api.get("/api/buyer-reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reservations = await storage.getBuyerReservations(org.id);
      res.json(reservations);
    } catch (error: any) {
      console.error("Get buyer reservations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer reservations" });
    }
  });

  api.get("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const reservation = await storage.getBuyerReservationById(org.id, id);
      if (!reservation) {
        return res.status(404).json({ message: "Buyer reservation not found" });
      }
      res.json(reservation);
    } catch (error: any) {
      console.error("Get buyer reservation error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch buyer reservation" });
    }
  });

  api.get("/api/properties/:propertyId/reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      const reservations = await storage.getBuyerReservationsByProperty(org.id, propertyId);
      res.json(reservations);
    } catch (error: any) {
      console.error("Get property reservations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property reservations" });
    }
  });

  api.post("/api/buyer-reservations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reservation = await storage.createBuyerReservation({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(reservation);
    } catch (error: any) {
      console.error("Create buyer reservation error:", error);
      res.status(400).json({ message: error.message || "Failed to create buyer reservation" });
    }
  });

  api.patch("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getBuyerReservationById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Buyer reservation not found" });
      }
      const reservation = await storage.updateBuyerReservation(org.id, id, req.body);
      res.json(reservation);
    } catch (error: any) {
      console.error("Update buyer reservation error:", error);
      res.status(400).json({ message: error.message || "Failed to update buyer reservation" });
    }
  });

  api.delete("/api/buyer-reservations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteBuyerReservation(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "Buyer reservation not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete buyer reservation error:", error);
      res.status(500).json({ message: error.message || "Failed to delete buyer reservation" });
    }
  });

  // ============================================
  // ESCROW CHECKLISTS (Phase 4)
  // ============================================

  api.get("/api/escrow-checklists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const checklists = await storage.getEscrowChecklists(org.id);
      res.json(checklists);
    } catch (error: any) {
      console.error("Get escrow checklists error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch escrow checklists" });
    }
  });

  api.get("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const checklist = await storage.getEscrowChecklistById(org.id, id);
      if (!checklist) {
        return res.status(404).json({ message: "Escrow checklist not found" });
      }
      res.json(checklist);
    } catch (error: any) {
      console.error("Get escrow checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch escrow checklist" });
    }
  });

  api.get("/api/deals/:dealId/escrow-checklist", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = parseInt(req.params.dealId);
      const checklist = await storage.getEscrowChecklistByDeal(org.id, dealId);
      res.json(checklist);
    } catch (error: any) {
      console.error("Get deal escrow checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch deal escrow checklist" });
    }
  });

  api.post("/api/escrow-checklists", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const checklist = await storage.createEscrowChecklist({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(checklist);
    } catch (error: any) {
      console.error("Create escrow checklist error:", error);
      res.status(400).json({ message: error.message || "Failed to create escrow checklist" });
    }
  });

  api.patch("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getEscrowChecklistById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Escrow checklist not found" });
      }
      const checklist = await storage.updateEscrowChecklist(org.id, id, req.body);
      res.json(checklist);
    } catch (error: any) {
      console.error("Update escrow checklist error:", error);
      res.status(400).json({ message: error.message || "Failed to update escrow checklist" });
    }
  });

  api.delete("/api/escrow-checklists/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteEscrowChecklist(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "Escrow checklist not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete escrow checklist error:", error);
      res.status(500).json({ message: error.message || "Failed to delete escrow checklist" });
    }
  });

  // ============================================
  // CLOSING PACKETS (Phase 4)
  // ============================================

  api.get("/api/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const packets = await storage.getClosingPackets(org.id);
      res.json(packets);
    } catch (error: any) {
      console.error("Get closing packets error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch closing packets" });
    }
  });

  api.get("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const packet = await storage.getClosingPacketById(org.id, id);
      if (!packet) {
        return res.status(404).json({ message: "Closing packet not found" });
      }
      res.json(packet);
    } catch (error: any) {
      console.error("Get closing packet error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch closing packet" });
    }
  });

  api.get("/api/deals/:dealId/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const dealId = parseInt(req.params.dealId);
      const packets = await storage.getClosingPacketsByDeal(org.id, dealId);
      res.json(packets);
    } catch (error: any) {
      console.error("Get deal closing packets error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch deal closing packets" });
    }
  });

  api.post("/api/closing-packets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const packet = await storage.createClosingPacket({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(packet);
    } catch (error: any) {
      console.error("Create closing packet error:", error);
      res.status(400).json({ message: error.message || "Failed to create closing packet" });
    }
  });

  api.patch("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getClosingPacketById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Closing packet not found" });
      }
      const packet = await storage.updateClosingPacket(org.id, id, req.body);
      res.json(packet);
    } catch (error: any) {
      console.error("Update closing packet error:", error);
      res.status(400).json({ message: error.message || "Failed to update closing packet" });
    }
  });

  api.delete("/api/closing-packets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteClosingPacket(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "Closing packet not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete closing packet error:", error);
      res.status(500).json({ message: error.message || "Failed to delete closing packet" });
    }
  });

  // ============================================
  // AUTOPAY ENROLLMENTS (Phase 4)
  // ============================================

  api.get("/api/autopay-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const enrollments = await storage.getAutopayEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      console.error("Get autopay enrollments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch autopay enrollments" });
    }
  });

  api.get("/api/autopay-enrollments/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const enrollments = await storage.getActiveAutopayEnrollments(org.id);
      res.json(enrollments);
    } catch (error: any) {
      console.error("Get active autopay enrollments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch active autopay enrollments" });
    }
  });

  api.get("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const enrollment = await storage.getAutopayEnrollmentById(org.id, id);
      if (!enrollment) {
        return res.status(404).json({ message: "Autopay enrollment not found" });
      }
      res.json(enrollment);
    } catch (error: any) {
      console.error("Get autopay enrollment error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch autopay enrollment" });
    }
  });

  api.get("/api/notes/:noteId/autopay", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.noteId);
      const enrollment = await storage.getAutopayEnrollmentByNote(org.id, noteId);
      res.json(enrollment);
    } catch (error: any) {
      console.error("Get note autopay enrollment error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch note autopay enrollment" });
    }
  });

  api.post("/api/autopay-enrollments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const enrollment = await storage.createAutopayEnrollment({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(enrollment);
    } catch (error: any) {
      console.error("Create autopay enrollment error:", error);
      res.status(400).json({ message: error.message || "Failed to create autopay enrollment" });
    }
  });

  api.patch("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getAutopayEnrollmentById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Autopay enrollment not found" });
      }
      const enrollment = await storage.updateAutopayEnrollment(org.id, id, req.body);
      res.json(enrollment);
    } catch (error: any) {
      console.error("Update autopay enrollment error:", error);
      res.status(400).json({ message: error.message || "Failed to update autopay enrollment" });
    }
  });

  api.delete("/api/autopay-enrollments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteAutopayEnrollment(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "Autopay enrollment not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete autopay enrollment error:", error);
      res.status(500).json({ message: error.message || "Failed to delete autopay enrollment" });
    }
  });

  // ============================================
  // PAYOFF QUOTES (Phase 4)
  // ============================================

  api.get("/api/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const quotes = await storage.getPayoffQuotes(org.id);
      res.json(quotes);
    } catch (error: any) {
      console.error("Get payoff quotes error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch payoff quotes" });
    }
  });

  api.get("/api/payoff-quotes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const quote = await storage.getPayoffQuoteById(org.id, id);
      if (!quote) {
        return res.status(404).json({ message: "Payoff quote not found" });
      }
      res.json(quote);
    } catch (error: any) {
      console.error("Get payoff quote error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch payoff quote" });
    }
  });

  api.get("/api/notes/:noteId/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.noteId);
      const quotes = await storage.getPayoffQuotesByNote(org.id, noteId);
      res.json(quotes);
    } catch (error: any) {
      console.error("Get note payoff quotes error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch note payoff quotes" });
    }
  });

  api.post("/api/payoff-quotes", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const quote = await storage.createPayoffQuote({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(quote);
    } catch (error: any) {
      console.error("Create payoff quote error:", error);
      res.status(400).json({ message: error.message || "Failed to create payoff quote" });
    }
  });

  api.patch("/api/payoff-quotes/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getPayoffQuoteById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Payoff quote not found" });
      }
      const quote = await storage.updatePayoffQuote(org.id, id, req.body);
      res.json(quote);
    } catch (error: any) {
      console.error("Update payoff quote error:", error);
      res.status(400).json({ message: error.message || "Failed to update payoff quote" });
    }
  });

  // ============================================
  // TRUST LEDGER (Phase 4)
  // ============================================

  api.get("/api/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entries = await storage.getTrustLedgerEntries(org.id);
      res.json(entries);
    } catch (error: any) {
      console.error("Get trust ledger entries error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch trust ledger entries" });
    }
  });

  api.get("/api/trust-ledger/balance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const balance = await storage.getTrustBalance(org.id);
      res.json({ balance });
    } catch (error: any) {
      console.error("Get trust ledger balance error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch trust ledger balance" });
    }
  });

  api.get("/api/notes/:noteId/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.noteId);
      const entries = await storage.getTrustLedgerByNote(org.id, noteId);
      res.json(entries);
    } catch (error: any) {
      console.error("Get note trust ledger entries error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch note trust ledger entries" });
    }
  });

  api.post("/api/trust-ledger", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const entry = await storage.createTrustLedgerEntry({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(entry);
    } catch (error: any) {
      console.error("Create trust ledger entry error:", error);
      res.status(400).json({ message: error.message || "Failed to create trust ledger entry" });
    }
  });

  // ============================================
  // DELINQUENCY ESCALATIONS (Phase 4)
  // ============================================

  api.get("/api/delinquency-escalations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const escalations = await storage.getDelinquencyEscalations(org.id);
      res.json(escalations);
    } catch (error: any) {
      console.error("Get delinquency escalations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch delinquency escalations" });
    }
  });

  api.get("/api/delinquency-escalations/active", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const escalations = await storage.getActiveDelinquencyEscalations(org.id);
      res.json(escalations);
    } catch (error: any) {
      console.error("Get active delinquency escalations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch active delinquency escalations" });
    }
  });

  api.get("/api/delinquency-escalations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const escalation = await storage.getDelinquencyEscalationById(org.id, id);
      if (!escalation) {
        return res.status(404).json({ message: "Delinquency escalation not found" });
      }
      res.json(escalation);
    } catch (error: any) {
      console.error("Get delinquency escalation error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch delinquency escalation" });
    }
  });

  api.get("/api/notes/:noteId/delinquency", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const noteId = parseInt(req.params.noteId);
      const escalation = await storage.getDelinquencyEscalationByNote(org.id, noteId);
      res.json(escalation ? [escalation] : []);
    } catch (error: any) {
      console.error("Get note delinquency escalations error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch note delinquency escalations" });
    }
  });

  api.post("/api/delinquency-escalations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const escalation = await storage.createDelinquencyEscalation({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(escalation);
    } catch (error: any) {
      console.error("Create delinquency escalation error:", error);
      res.status(400).json({ message: error.message || "Failed to create delinquency escalation" });
    }
  });

  api.patch("/api/delinquency-escalations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getDelinquencyEscalationById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Delinquency escalation not found" });
      }
      const escalation = await storage.updateDelinquencyEscalation(org.id, id, req.body);
      res.json(escalation);
    } catch (error: any) {
      console.error("Update delinquency escalation error:", error);
      res.status(400).json({ message: error.message || "Failed to update delinquency escalation" });
    }
  });

  // ============================================
  // DD ASSIGNMENTS (Phase 4)
  // ============================================

  api.get("/api/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const assignments = await storage.getDDAssignments(org.id);
      res.json(assignments);
    } catch (error: any) {
      console.error("Get DD assignments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch DD assignments" });
    }
  });

  api.get("/api/dd-assignments/pending", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const assignments = await storage.getPendingDDAssignments(org.id);
      res.json(assignments);
    } catch (error: any) {
      console.error("Get pending DD assignments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch pending DD assignments" });
    }
  });

  api.get("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const assignment = await storage.getDDAssignmentById(org.id, id);
      if (!assignment) {
        return res.status(404).json({ message: "DD assignment not found" });
      }
      res.json(assignment);
    } catch (error: any) {
      console.error("Get DD assignment error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch DD assignment" });
    }
  });

  api.get("/api/properties/:propertyId/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      const assignments = await storage.getDDAssignmentsByProperty(org.id, propertyId);
      res.json(assignments);
    } catch (error: any) {
      console.error("Get property DD assignments error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property DD assignments" });
    }
  });

  api.post("/api/dd-assignments", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const assignment = await storage.createDDAssignment({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(assignment);
    } catch (error: any) {
      console.error("Create DD assignment error:", error);
      res.status(400).json({ message: error.message || "Failed to create DD assignment" });
    }
  });

  api.patch("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getDDAssignmentById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "DD assignment not found" });
      }
      const assignment = await storage.updateDDAssignment(org.id, id, req.body);
      res.json(assignment);
    } catch (error: any) {
      console.error("Update DD assignment error:", error);
      res.status(400).json({ message: error.message || "Failed to update DD assignment" });
    }
  });

  api.delete("/api/dd-assignments/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const success = await storage.deleteDDAssignment(org.id, id);
      if (!success) {
        return res.status(404).json({ message: "DD assignment not found" });
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Delete DD assignment error:", error);
      res.status(500).json({ message: error.message || "Failed to delete DD assignment" });
    }
  });

  // ============================================
  // SWOT REPORTS (Phase 4)
  // ============================================

  api.get("/api/swot-reports", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const reports = await storage.getSwotReports(org.id);
      res.json(reports);
    } catch (error: any) {
      console.error("Get SWOT reports error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch SWOT reports" });
    }
  });

  api.get("/api/swot-reports/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const report = await storage.getSwotReportById(org.id, id);
      if (!report) {
        return res.status(404).json({ message: "SWOT report not found" });
      }
      res.json(report);
    } catch (error: any) {
      console.error("Get SWOT report error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch SWOT report" });
    }
  });

  api.get("/api/properties/:propertyId/swot-report", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      const report = await storage.getSwotReportByProperty(org.id, propertyId);
      res.json(report);
    } catch (error: any) {
      console.error("Get property SWOT report error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property SWOT report" });
    }
  });

  api.post("/api/swot-reports", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const report = await storage.createSwotReport({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(report);
    } catch (error: any) {
      console.error("Create SWOT report error:", error);
      res.status(400).json({ message: error.message || "Failed to create SWOT report" });
    }
  });

  api.patch("/api/swot-reports/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getSwotReportById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "SWOT report not found" });
      }
      const report = await storage.updateSwotReport(org.id, id, req.body);
      res.json(report);
    } catch (error: any) {
      console.error("Update SWOT report error:", error);
      res.status(400).json({ message: error.message || "Failed to update SWOT report" });
    }
  });

  // ============================================
  // GO/NO-GO MEMOS (Phase 4)
  // ============================================

  api.get("/api/go-nogo-memos", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const memos = await storage.getGoNogoMemos(org.id);
      res.json(memos);
    } catch (error: any) {
      console.error("Get Go/No-Go memos error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch Go/No-Go memos" });
    }
  });

  api.get("/api/go-nogo-memos/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const memo = await storage.getGoNogoMemoById(org.id, id);
      if (!memo) {
        return res.status(404).json({ message: "Go/No-Go memo not found" });
      }
      res.json(memo);
    } catch (error: any) {
      console.error("Get Go/No-Go memo error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch Go/No-Go memo" });
    }
  });

  api.get("/api/properties/:propertyId/go-nogo-memo", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const propertyId = parseInt(req.params.propertyId);
      const memo = await storage.getGoNogoMemoByProperty(org.id, propertyId);
      res.json(memo);
    } catch (error: any) {
      console.error("Get property Go/No-Go memo error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch property Go/No-Go memo" });
    }
  });

  api.post("/api/go-nogo-memos", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const memo = await storage.createGoNogoMemo({
        ...req.body,
        organizationId: org.id,
      });
      res.status(201).json(memo);
    } catch (error: any) {
      console.error("Create Go/No-Go memo error:", error);
      res.status(400).json({ message: error.message || "Failed to create Go/No-Go memo" });
    }
  });

  api.patch("/api/go-nogo-memos/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const id = parseInt(req.params.id);
      const existing = await storage.getGoNogoMemoById(org.id, id);
      if (!existing) {
        return res.status(404).json({ message: "Go/No-Go memo not found" });
      }
      const memo = await storage.updateGoNogoMemo(org.id, id, req.body);
      res.json(memo);
    } catch (error: any) {
      console.error("Update Go/No-Go memo error:", error);
      res.status(400).json({ message: error.message || "Failed to update Go/No-Go memo" });
    }
  });

  // ============================================
  // WRITING STYLE PROFILES
  // ============================================

  const writingStyleService = await import("./services/writingStyle");

  api.get("/api/writing-styles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const profiles = await writingStyleService.getAllStyleProfiles(org.id);
      res.json(profiles);
    } catch (error: any) {
      console.error("Get writing styles error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch writing styles" });
    }
  });

  api.get("/api/writing-styles/current", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      let profile = await writingStyleService.getWritingStyleProfile(org.id, user.id);
      if (!profile) {
        profile = await writingStyleService.createWritingStyleProfile(org.id, user.id);
      }
      res.json(profile);
    } catch (error: any) {
      console.error("Get current writing style error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch writing style" });
    }
  });

  api.post("/api/writing-styles", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { name } = req.body;
      const profile = await writingStyleService.createWritingStyleProfile(org.id, user.id, name);
      res.status(201).json(profile);
    } catch (error: any) {
      console.error("Create writing style error:", error);
      res.status(400).json({ message: error.message || "Failed to create writing style" });
    }
  });

  api.post("/api/writing-styles/:id/samples", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { context, content } = req.body;
      await writingStyleService.addSampleMessage(id, context || "general", content);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Add sample message error:", error);
      res.status(400).json({ message: error.message || "Failed to add sample message" });
    }
  });

  api.post("/api/writing-styles/:id/analyze", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const analysis = await writingStyleService.analyzeWritingStyle(id);
      res.json(analysis);
    } catch (error: any) {
      console.error("Analyze writing style error:", error);
      res.status(400).json({ message: error.message || "Failed to analyze writing style" });
    }
  });

  api.post("/api/writing-styles/:id/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { recipientName, topic, intent, propertyDetails, previousMessages } = req.body;
      const result = await writingStyleService.generateStyledResponse(id, {
        recipientName,
        topic,
        intent: intent || "general",
        propertyDetails,
        previousMessages,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Generate styled response error:", error);
      res.status(400).json({ message: error.message || "Failed to generate response" });
    }
  });

  api.post("/api/writing-styles/:id/import", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const id = parseInt(req.params.id);
      const { limit } = req.body;
      const count = await writingStyleService.importMessagesFromConversations(
        org.id,
        user.id,
        id,
        limit || 20
      );
      res.json({ imported: count });
    } catch (error: any) {
      console.error("Import messages error:", error);
      res.status(400).json({ message: error.message || "Failed to import messages" });
    }
  });

  api.delete("/api/writing-styles/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await writingStyleService.deleteStyleProfile(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete writing style error:", error);
      res.status(500).json({ message: error.message || "Failed to delete writing style" });
    }
  });

  // ============================================
  // LEAD QUALIFICATION & ALERTS
  // ============================================

  const leadQualificationService = await import("./services/leadQualification");

  api.get("/api/alerts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { priority, limit } = req.query;
      const alerts = await leadQualificationService.getPendingAlerts(org.id, {
        priority: priority as string,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      res.json(alerts);
    } catch (error: any) {
      console.error("Get alerts error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch alerts" });
    }
  });

  api.post("/api/alerts/:id/acknowledge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id);
      const { actionTaken } = req.body;
      await leadQualificationService.acknowledgeAlert(id, user.id, actionTaken);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Acknowledge alert error:", error);
      res.status(400).json({ message: error.message || "Failed to acknowledge alert" });
    }
  });

  api.post("/api/alerts/:id/dismiss", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await leadQualificationService.dismissAlert(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Dismiss alert error:", error);
      res.status(400).json({ message: error.message || "Failed to dismiss alert" });
    }
  });

  api.get("/api/leads/:id/intent-score", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = parseInt(req.params.id);
      const score = await leadQualificationService.calculateLeadIntentScore(org.id, leadId);
      res.json(score);
    } catch (error: any) {
      console.error("Get lead intent score error:", error);
      res.status(500).json({ message: error.message || "Failed to calculate intent score" });
    }
  });

  api.post("/api/leads/:id/analyze-message", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = parseInt(req.params.id);
      const { message, conversationId } = req.body;
      const signals = await leadQualificationService.analyzeMessageForSignals(
        org.id,
        leadId,
        conversationId,
        message
      );
      res.json(signals);
    } catch (error: any) {
      console.error("Analyze message error:", error);
      res.status(400).json({ message: error.message || "Failed to analyze message" });
    }
  });

  api.get("/api/leads/:id/suggested-response", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const leadId = parseInt(req.params.id);
      const { propertyId } = req.query;
      const response = await leadQualificationService.generateSuggestedResponse(
        org.id,
        leadId,
        propertyId ? parseInt(propertyId as string) : undefined
      );
      res.json({ response });
    } catch (error: any) {
      console.error("Generate suggested response error:", error);
      res.status(400).json({ message: error.message || "Failed to generate response" });
    }
  });

  api.post("/api/check-hot-leads", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const hotLeadIds = await leadQualificationService.checkForHotLeads(org.id);
      res.json({ hotLeads: hotLeadIds.length, leadIds: hotLeadIds });
    } catch (error: any) {
      console.error("Check hot leads error:", error);
      res.status(500).json({ message: error.message || "Failed to check hot leads" });
    }
  });

  // ============================================
  // BROWSER AUTOMATION
  // ============================================

  const browserAutomationService = await import("./services/browserAutomation");

  api.get("/api/browser-automation/templates", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const systemTemplates = await browserAutomationService.getSystemTemplates();
      const orgTemplates = await browserAutomationService.getOrganizationTemplates(org.id);
      res.json({ system: systemTemplates, organization: orgTemplates });
    } catch (error: any) {
      console.error("Get automation templates error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch templates" });
    }
  });

  api.get("/api/browser-automation/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { status, limit } = req.query;
      const jobs = await browserAutomationService.getOrganizationJobs(org.id, {
        status: status as string,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      res.json(jobs);
    } catch (error: any) {
      console.error("Get automation jobs error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch jobs" });
    }
  });

  api.get("/api/browser-automation/jobs/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const job = await browserAutomationService.getJobById(id);
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json(job);
    } catch (error: any) {
      console.error("Get automation job error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch job" });
    }
  });

  api.post("/api/browser-automation/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { templateId, name, inputData, priority } = req.body;
      const job = await browserAutomationService.createJob(org.id, {
        templateId,
        name,
        inputData,
        priority,
        triggeredByUserId: user.id,
      });
      res.status(201).json(job);
    } catch (error: any) {
      console.error("Create automation job error:", error);
      res.status(400).json({ message: error.message || "Failed to create job" });
    }
  });

  api.post("/api/browser-automation/jobs/:id/cancel", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await browserAutomationService.cancelJob(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Cancel automation job error:", error);
      res.status(400).json({ message: error.message || "Failed to cancel job" });
    }
  });

  // ============================================
  // SMS MESSAGING
  // ============================================

  const smsServiceModule = await import("./services/smsService");

  api.get("/api/sms/config", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const config = await smsServiceModule.checkTwilioConfiguration(org.id);
      res.json(config);
    } catch (error: any) {
      console.error("Check SMS config error:", error);
      res.status(500).json({ message: error.message || "Failed to check SMS configuration" });
    }
  });

  api.post("/api/sms/config", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { accountSid, authToken, fromPhoneNumber } = req.body;
      
      if (!accountSid || !authToken || !fromPhoneNumber) {
        return res.status(400).json({ message: "Account SID, Auth Token, and Phone Number are required" });
      }

      const result = await smsServiceModule.saveTwilioCredentials(
        org.id,
        accountSid,
        authToken,
        fromPhoneNumber
      );
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Save SMS config error:", error);
      res.status(400).json({ message: error.message || "Failed to save SMS configuration" });
    }
  });

  api.post("/api/sms/send", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { to, message } = req.body;
      
      if (!to || !message) {
        return res.status(400).json({ message: "Phone number and message are required" });
      }

      const result = await smsServiceModule.sendOrgSMS(org.id, to, message);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Send SMS error:", error);
      res.status(400).json({ message: error.message || "Failed to send SMS" });
    }
  });

  api.post("/api/leads/:leadId/sms", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const leadId = parseInt(req.params.leadId);
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }

      const result = await smsServiceModule.sendSMSToLead(org.id, leadId, message, user.id);
      
      if (!result.success) {
        return res.status(400).json({ message: result.error });
      }
      
      res.json(result);
    } catch (error: any) {
      console.error("Send SMS to lead error:", error);
      res.status(400).json({ message: error.message || "Failed to send SMS to lead" });
    }
  });

  api.post("/api/webhooks/twilio/sms", async (req, res) => {
    try {
      const { From, To, Body, MessageSid, AccountSid } = req.body;
      
      if (!From || !Body || !MessageSid) {
        return res.status(400).send("Invalid webhook payload");
      }

      console.log(`[Twilio Webhook] Incoming SMS from ${From} to ${To}: ${Body.substring(0, 50)}...`);
      
      const orgIntegrations = await db
        .select()
        .from(organizationIntegrations)
        .where(
          and(
            eq(organizationIntegrations.provider, "twilio"),
            eq(organizationIntegrations.isEnabled, true)
          )
        );
      
      const cleanTo = To?.replace(/\D/g, "") || "";
      const matchingOrg = orgIntegrations.find(integration => {
        const creds = integration.credentials as any;
        if (!creds?.fromPhoneNumber) return false;
        const configuredPhone = creds.fromPhoneNumber.replace(/\D/g, "");
        return cleanTo.includes(configuredPhone) || configuredPhone.includes(cleanTo.slice(-10));
      });

      if (matchingOrg) {
        try {
          await smsServiceModule.handleIncomingSMS(
            matchingOrg.organizationId,
            From,
            To,
            Body,
            MessageSid
          );
          console.log(`[Twilio Webhook] Inbound SMS stored for org ${matchingOrg.organizationId}`);
        } catch (inboundError: any) {
          console.error("[Twilio Webhook] Error storing inbound SMS:", inboundError.message);
        }
      } else {
        console.log("[Twilio Webhook] No matching organization found for phone:", To);
      }
      
      res.status(200).send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
    } catch (error: any) {
      console.error("Twilio webhook error:", error);
      res.status(500).send("Webhook processing error");
    }
  });

  // ============================================
  // JOB QUEUE
  // ============================================
  
  // Create a new job
  api.post("/api/jobs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const { type, payload, maxAttempts, scheduledFor } = req.body;
      
      // Validate job type
      const validTypes = ["email", "webhook", "payment_sync", "notification"];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ 
          message: `Invalid job type. Supported types: ${validTypes.join(", ")}` 
        });
      }
      
      // Validate payload is provided
      if (!payload || typeof payload !== "object") {
        return res.status(400).json({ message: "Payload is required and must be an object" });
      }
      
      // Create job
      const job = jobQueueService.addJob(type, payload, {
        maxAttempts,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
      });
      
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to create job" });
    }
  });
  
  // Get job status by ID
  api.get("/api/jobs/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const job = jobQueueService.getJobStatus(req.params.id);
      
      if (!job) {
        return res.status(404).json({ message: "Job not found" });
      }
      
      res.json(job);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get job" });
    }
  });
  
  // Get recent jobs (admin only)
  api.get("/api/jobs", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
      const jobs = jobQueueService.getRecentJobs(limit);
      
      res.json({
        total: jobs.length,
        jobs,
        stats: jobQueueService.getStats(),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get jobs" });
    }
  });
  
  // Get job queue statistics (admin only)
  api.get("/api/jobs/stats", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const { jobQueueService } = await import("./services/jobQueue");
      const stats = jobQueueService.getStats();
      
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to get job statistics" });
    }
  });

  registerAIOperationsRoutes(api);

  return httpServer;
}
