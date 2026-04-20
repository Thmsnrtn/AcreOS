import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { insertOrganizationSchema, leads, deals, properties, npsResponses, organizations } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireAdminOrAbove, requireOwner } from "./utils/permissions";
import { checkUsageLimit } from "./services/usageLimits";
import { onboardingService, type BusinessType } from "./services/onboarding";
import { SUBSCRIPTION_TIERS } from "@shared/schema";
import { activityLogger } from "./services/activityLogger";
import { getAllUsageLimits, TIER_LIMITS, type SubscriptionTier } from "./services/usageLimits";
import { getUserPermissionContext, getPermissionsForRole, ROLES, type UserPermissionContext } from "./utils/permissions";
import {
  getCommissionConfig,
  saveCommissionConfig,
  getCommissionRecords,
  getAgentCommissionSummaries,
  recordDealCommission,
  recordCommissionPayment,
  generateCommissionStatement,
} from "./services/commissionService";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";

// Zod schema for safe organization updates via PATCH /api/organization.
// Sensitive fields (subscriptionTier, isFounder, stripeCustomerId, creditBalance, etc.)
// are deliberately excluded — they must be updated through dedicated endpoints.
const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  onboardingCompleted: z.boolean().optional(),
  onboardingStep: z.number().int().min(0).optional(),
  onboardingData: z.record(z.unknown()).optional(),
  autoTopUpEnabled: z.boolean().optional(),
  autoTopUpThresholdCents: z.number().int().min(0).optional(),
  autoTopUpAmountCents: z.number().int().min(0).optional(),
}).strict();

export function registerOrganizationRoutes(app: Express): void {
  const api = app;

  // PLAYBOOKS
  // ============================================
  
  // Playbook templates data (static)
  const PLAYBOOK_TEMPLATES_DATA = [
    {
      id: "acquisition_sprint",
      name: "Acquisition Sprint",
      description: "A complete workflow to find, research, and make an offer on a land parcel in 7 days or less.",
      category: "acquisition",
      estimatedDuration: "7 days",
      steps: [
        { id: "identify_target_county", title: "Identify Target County", description: "Research and select a county with favorable market conditions.", actionType: "navigate", actionLabel: "Browse Counties", actionUrl: "/counties", icon: "MapPin", estimatedMinutes: 60 },
        { id: "pull_tax_delinquent_list", title: "Pull Tax Delinquent List", description: "Download or import the tax delinquent property list.", actionType: "navigate", actionLabel: "Import Leads", actionUrl: "/leads", icon: "FileSpreadsheet", estimatedMinutes: 30 },
        { id: "skip_trace_leads", title: "Skip Trace Leads", description: "Run skip tracing on your imported leads.", actionType: "navigate", actionLabel: "Skip Trace", actionUrl: "/leads", icon: "Search", estimatedMinutes: 15 },
        { id: "send_mail_campaign", title: "Send Mail Campaign", description: "Create and send your direct mail campaign.", actionType: "navigate", actionLabel: "Create Campaign", actionUrl: "/campaigns", icon: "Mail", estimatedMinutes: 45 },
        { id: "track_responses", title: "Track Responses", description: "Monitor incoming calls, texts, and mail responses.", actionType: "navigate", actionLabel: "View Inbox", actionUrl: "/inbox", icon: "MessageSquare", estimatedMinutes: 20 },
        { id: "research_property", title: "Research Property", description: "Research the property thoroughly: verify ownership, check for liens, review GIS data.", actionType: "navigate", actionLabel: "Property Research", actionUrl: "/properties", icon: "FileSearch", estimatedMinutes: 60 },
        { id: "generate_offer", title: "Generate Offer", description: "Use AI to generate a competitive offer based on market comps.", actionType: "navigate", actionLabel: "Create Offer", actionUrl: "/offers", icon: "DollarSign", estimatedMinutes: 15 },
        { id: "create_deal", title: "Create Deal", description: "Convert the accepted offer into a deal.", actionType: "create_deal", actionLabel: "Create Deal", actionUrl: "/deals", icon: "Handshake", estimatedMinutes: 10 },
      ],
    },
    {
      id: "due_diligence",
      name: "Due Diligence Checklist",
      description: "Comprehensive checklist to verify property ownership, check for issues, and ensure a clean transaction.",
      category: "due_diligence",
      estimatedDuration: "3-5 days",
      steps: [
        { id: "verify_ownership", title: "Verify Ownership", description: "Confirm the seller is the actual owner.", actionType: "manual", actionLabel: "Mark Complete", icon: "UserCheck", estimatedMinutes: 30 },
        { id: "title_search", title: "Title Search", description: "Run a title search to check for liens and encumbrances.", actionType: "manual", actionLabel: "Mark Complete", icon: "FileText", estimatedMinutes: 60 },
        { id: "check_back_taxes", title: "Check Back Taxes", description: "Verify the amount of back taxes owed.", actionType: "manual", actionLabel: "Mark Complete", icon: "Receipt", estimatedMinutes: 20 },
        { id: "survey_review", title: "Survey Review", description: "Review existing survey or order a new one.", actionType: "manual", actionLabel: "Mark Complete", icon: "Ruler", estimatedMinutes: 45 },
        { id: "environmental_check", title: "Environmental Check", description: "Check for wetlands, flood zones, and contamination risks.", actionType: "navigate", actionLabel: "View GIS Data", actionUrl: "/properties", icon: "Leaf", estimatedMinutes: 30 },
        { id: "zoning_verification", title: "Zoning Verification", description: "Verify current zoning and permitted uses.", actionType: "manual", actionLabel: "Mark Complete", icon: "Building", estimatedMinutes: 20 },
        { id: "access_verification", title: "Verify Legal Access", description: "Confirm the property has legal road access.", actionType: "manual", actionLabel: "Mark Complete", icon: "Route", estimatedMinutes: 30 },
        { id: "utilities_check", title: "Utilities Check", description: "Determine availability of power, water, sewer, and internet.", actionType: "manual", actionLabel: "Mark Complete", icon: "Plug", estimatedMinutes: 30 },
      ],
    },
    {
      id: "disposition_launch",
      name: "Disposition Launch",
      description: "Step-by-step process to list, market, and close on your land sale.",
      category: "disposition",
      estimatedDuration: "30-90 days",
      steps: [
        { id: "prepare_listing", title: "Prepare Listing", description: "Create compelling listing content with photos and descriptions.", actionType: "navigate", actionLabel: "Create Listing", actionUrl: "/listings", icon: "Image", estimatedMinutes: 60 },
        { id: "set_pricing", title: "Set Pricing Strategy", description: "Analyze comparable sales and set your asking price.", actionType: "navigate", actionLabel: "Price Analysis", actionUrl: "/properties", icon: "TrendingUp", estimatedMinutes: 30 },
        { id: "list_on_marketplaces", title: "List on Marketplaces", description: "Post to Facebook Marketplace, Craigslist, LandWatch.", actionType: "manual", actionLabel: "Mark Complete", icon: "Share2", estimatedMinutes: 45 },
        { id: "contact_buyer_list", title: "Contact Buyer List", description: "Reach out to your existing buyer list.", actionType: "navigate", actionLabel: "Send Campaign", actionUrl: "/campaigns", icon: "Users", estimatedMinutes: 20 },
        { id: "handle_inquiries", title: "Handle Inquiries", description: "Respond to buyer inquiries and answer questions.", actionType: "navigate", actionLabel: "View Inbox", actionUrl: "/inbox", icon: "MessageCircle", estimatedMinutes: 30 },
        { id: "qualify_buyers", title: "Qualify Buyers", description: "Pre-qualify interested buyers for financing.", actionType: "manual", actionLabel: "Mark Complete", icon: "ClipboardCheck", estimatedMinutes: 30 },
        { id: "negotiate_terms", title: "Negotiate Terms", description: "Negotiate final price and terms with your buyer.", actionType: "navigate", actionLabel: "Deal Calculator", actionUrl: "/tools", icon: "Calculator", estimatedMinutes: 30 },
        { id: "generate_documents", title: "Generate Documents", description: "Create purchase agreement, promissory note, and deed.", actionType: "navigate", actionLabel: "Documents", actionUrl: "/documents", icon: "FileSignature", estimatedMinutes: 45 },
        { id: "close_deal", title: "Close the Deal", description: "Collect signatures, record the deed, and set up payments.", actionType: "create_deal", actionLabel: "Complete Sale", actionUrl: "/deals", icon: "CheckCircle2", estimatedMinutes: 60 },
      ],
    },
  ];

  // GET /api/playbooks - List available playbook templates with user's active instances
  api.get("/api/playbooks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      
      // Get all playbook instances for this organization
      const instances = await storage.getPlaybookInstances(org.id);
      
      // Map templates with their active instances
      const templatesWithProgress = PLAYBOOK_TEMPLATES_DATA.map(template => {
        const activeInstance = instances.find(
          i => i.templateId === template.id && i.status === "in_progress"
        );
        return {
          template,
          activeInstance: activeInstance || null,
        };
      });
      
      res.json({
        templates: templatesWithProgress,
        activeInstances: instances.filter(i => i.status === "in_progress"),
      });
    } catch (error: any) {
      logger.error("Get playbooks error", { error: error.message });
      res.status(500).json({ message: "Failed to get playbooks" });
    }
  });

  // GET /api/playbooks/:id - Get playbook template details with steps
  api.get("/api/playbooks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { id } = req.params;
      const org = req.organization;
      
      const template = PLAYBOOK_TEMPLATES_DATA.find(t => t.id === id);
      if (!template) {
        return res.status(404).json({ message: "Playbook template not found" });
      }
      
      // Check for active instance
      const activeInstance = await storage.getPlaybookInstanceByTemplate(org.id, id);
      
      res.json({
        template,
        activeInstance,
      });
    } catch (error: any) {
      logger.error("Get playbook error", { error: error.message });
      res.status(500).json({ message: "Failed to get playbook" });
    }
  });

  // POST /api/playbooks/:id/start - Start a playbook (creates instance)
  const startPlaybookSchema = z.object({
    linkedDealId: z.number().int().positive().optional().nullable(),
    linkedPropertyId: z.number().int().positive().optional().nullable(),
    linkedLeadId: z.number().int().positive().optional().nullable(),
  });

  api.post("/api/playbooks/:id/start", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { id } = req.params;
      const org = req.organization;
      const parsed = startPlaybookSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { linkedDealId, linkedPropertyId, linkedLeadId } = parsed.data;
      
      const template = PLAYBOOK_TEMPLATES_DATA.find(t => t.id === id);
      if (!template) {
        return res.status(404).json({ message: "Playbook template not found" });
      }
      
      // Check if there's already an active instance
      const existingInstance = await storage.getPlaybookInstanceByTemplate(org.id, id);
      if (existingInstance) {
        return res.json(existingInstance);
      }
      
      // Create new playbook instance
      const instance = await storage.createPlaybookInstance({
        organizationId: org.id,
        templateId: id,
        name: template.name,
        status: "in_progress",
        linkedDealId: linkedDealId || null,
        linkedPropertyId: linkedPropertyId || null,
        linkedLeadId: linkedLeadId || null,
        completedSteps: [],
        stepData: {},
        startedAt: new Date(),
      });
      
      // Log activity
      await activityLogger.logEvent({
        organizationId: org.id,
        eventType: "playbook_started",
        description: `Started playbook: ${template.name}`,
        entityType: "playbook",
        entityId: instance.id,
      });
      
      res.json(instance);
    } catch (error: any) {
      logger.error("Start playbook error", { error: error.message });
      res.status(500).json({ message: "Failed to start playbook" });
    }
  });

  // GET /api/playbooks/instances/:instanceId - Get specific playbook instance
  api.get("/api/playbooks/instances/:instanceId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { instanceId } = req.params;
      const org = req.organization;
      
      const instance = await storage.getPlaybookInstanceById(org.id, parseInt(instanceId));
      if (!instance) {
        return res.status(404).json({ message: "Playbook instance not found" });
      }
      
      const template = PLAYBOOK_TEMPLATES_DATA.find(t => t.id === instance.templateId);
      
      res.json({
        instance,
        template,
      });
    } catch (error: any) {
      logger.error("Get playbook instance error", { error: error.message });
      res.status(500).json({ message: "Failed to get playbook instance" });
    }
  });

  // POST /api/playbooks/instances/:instanceId/steps/:stepId/complete - Mark step complete
  api.post("/api/playbooks/instances/:instanceId/steps/:stepId/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { instanceId, stepId } = req.params;
      const org = req.organization;
      
      const instance = await storage.getPlaybookInstanceById(org.id, parseInt(instanceId));
      if (!instance) {
        return res.status(404).json({ message: "Playbook instance not found" });
      }
      
      const template = PLAYBOOK_TEMPLATES_DATA.find(t => t.id === instance.templateId);
      if (!template) {
        return res.status(404).json({ message: "Playbook template not found" });
      }
      
      // Verify step exists in template
      const step = template.steps.find((s: any) => s.id === stepId);
      if (!step) {
        return res.status(404).json({ message: "Step not found in playbook" });
      }
      
      // Add step to completed steps if not already
      const completedSteps = (instance.completedSteps as string[]) || [];
      if (!completedSteps.includes(stepId)) {
        completedSteps.push(stepId);
      }
      
      // Check if all steps are complete
      const allComplete = template.steps.every((s: any) => completedSteps.includes(s.id));
      
      const updatedInstance = await storage.updatePlaybookInstance(org.id, instance.id, {
        completedSteps,
        status: allComplete ? "completed" : "in_progress",
        completedAt: allComplete ? new Date() : null,
      });
      
      // Log activity
      await activityLogger.logEvent({
        organizationId: org.id,
        eventType: "playbook_step_completed",
        description: `Step "${step.title}" was completed in playbook "${template.name}"`,
        entityType: "playbook",
        entityId: instance.id,
      });
      
      if (allComplete) {
        await activityLogger.logEvent({
          organizationId: org.id,
          eventType: "playbook_completed",
          description: `All steps in playbook "${template.name}" have been completed`,
          entityType: "playbook",
          entityId: instance.id,
        });
      }
      
      res.json(updatedInstance);
    } catch (error: any) {
      logger.error("Complete step error", { error: error.message });
      res.status(500).json({ message: "Failed to complete step" });
    }
  });

  // POST /api/playbooks/instances/:instanceId/steps/:stepId/uncomplete - Undo step completion
  api.post("/api/playbooks/instances/:instanceId/steps/:stepId/uncomplete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { instanceId, stepId } = req.params;
      const org = req.organization;
      
      const instance = await storage.getPlaybookInstanceById(org.id, parseInt(instanceId));
      if (!instance) {
        return res.status(404).json({ message: "Playbook instance not found" });
      }
      
      // Remove step from completed steps
      const completedSteps = ((instance.completedSteps as string[]) || []).filter(id => id !== stepId);
      
      const updatedInstance = await storage.updatePlaybookInstance(org.id, instance.id, {
        completedSteps,
        status: "in_progress",
        completedAt: null,
      });
      
      res.json(updatedInstance);
    } catch (error: any) {
      logger.error("Uncomplete step error", { error: error.message });
      res.status(500).json({ message: "Failed to uncomplete step" });
    }
  });

  // DELETE /api/playbooks/instances/:instanceId - Cancel/delete a playbook instance
  api.delete("/api/playbooks/instances/:instanceId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { instanceId } = req.params;
      const org = req.organization;
      
      await storage.deletePlaybookInstance(org.id, parseInt(instanceId));
      
      res.json({ success: true });
    } catch (error: any) {
      logger.error("Delete playbook instance error", { error: error.message });
      res.status(500).json({ message: "Failed to delete playbook instance" });
    }
  });
  
  // ============================================
  // ORGANIZATION
  // ============================================
  
  api.get("/api/organization", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    res.json(org);
  });
  
  api.patch("/api/organization", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const parsed = updateOrganizationSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.errors);
    }
    const updates = parsed.data;
    const updated = await storage.updateOrganization(org.id, updates);

    try {
      const user = req.user as any;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.claims?.sub || user?.id)?.toString() || null,
        action: "update",
        entityType: "organization",
        entityId: org.id,
        changes: { before: org, after: updates, fields: Object.keys(updates) },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        metadata: {},
      });
    } catch (e) { /* non-fatal */ }

    res.json(updated);
  });
  
  // Update AI settings for the organization
  api.patch("/api/organization/ai-settings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const aiSettings = req.body;

      const aiSettingsSchema = z.object({
        responseStyle: z.enum(["concise", "detailed", "balanced"]).optional(),
        defaultAgent: z.string().optional(),
        autoSuggestions: z.boolean().optional(),
        rememberContext: z.boolean().optional(),
      });

      const validatedSettings = aiSettingsSchema.parse(aiSettings);
      await storage.updateOrganizationAISettings(org.id, validatedSettings);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.claims?.sub || user?.id)?.toString() || null,
          action: "update",
          entityType: "organization_ai_settings",
          entityId: org.id,
          changes: { after: validatedSettings, fields: Object.keys(validatedSettings) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ success: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return Errors.validationFailed(res, error.errors);
      }
      logger.error("Update AI settings error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
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
      logger.error("Get provider status error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to get provider status" });
    }
  });
  
  // Get seat information for the organization
  api.get("/api/organization/seats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { getSeatInfo } = await import("./services/usageLimits");
      const seatInfo = await getSeatInfo(org.id);
      res.json(seatInfo);
    } catch (error: any) {
      logger.error("Get seat info error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to fetch seat info" });
    }
  });
  
  // Get seat add-on pricing for the organization's tier
  api.get("/api/organization/seats/pricing", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
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
      logger.error("Get seat pricing error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to fetch seat pricing" });
    }
  });
  
  // Purchase additional seats
  const purchaseSeatsSchema = z.object({
    quantity: z.number().int().min(1, "Quantity must be at least 1"),
    billingPeriod: z.enum(["monthly", "yearly"], { required_error: "Billing period must be 'monthly' or 'yearly'" }),
  });

  api.post("/api/organization/seats/purchase", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = purchaseSeatsSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { quantity, billingPeriod } = parsed.data;
      
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
      
      logger.info(`[seats] Org ${org.id} initiating seat purchase: ${quantity} seats, ${billingPeriod}, price ${validPrice.id}`);
      res.json({ url: session.url });
    } catch (error: any) {
      logger.error("Purchase seats error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to create checkout session" });
    }
  });
  
  // ============================================
  // ONBOARDING
  // ============================================
  
  api.get("/api/onboarding/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const status = await onboardingService.getOnboardingStatus(org.id);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  const onboardingStepSchema = z.object({
    step: z.number().int().min(0).max(4),
    data: z.record(z.unknown()).optional(),
    skipped: z.boolean().optional(),
  });

  api.put("/api/onboarding/step", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = onboardingStepSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { step, data, skipped } = parsed.data;
      
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
  
  const completeStepSchema = z.object({
    stepId: z.number().int().min(0).max(5),
    data: z.record(z.unknown()).optional(),
  });

  api.post("/api/onboarding/complete-step", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = completeStepSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { stepId, data } = parsed.data;
      
      const skipped = data?.skipped === true;
      const status = await onboardingService.updateOnboardingStep(
        org.id, 
        stepId, 
        data || {},
        skipped
      );
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  const provisionSchema = z.object({
    businessType: z.enum([
      "land_flipper", "note_investor", "hybrid",
      "residential_wholesaler", "fix_and_flip", "buy_and_hold",
      "commercial", "short_term_rental", "creative_finance",
      "developer", "tax_lien_deed", "multifamily",
      "mobile_home", "vacation_rental",
    ]),
  });

  api.post("/api/onboarding/provision", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = provisionSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { businessType } = parsed.data;
      
      const result = await onboardingService.provisionTemplates(org.id, businessType as BusinessType);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/onboarding/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      await onboardingService.completeOnboarding(org.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  const tipsSchema = z.object({
    step: z.number().int().min(0).optional(),
  });

  api.post("/api/onboarding/tips", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = tipsSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const stepNumber = parsed.data.step ?? 0;
      const tips = await onboardingService.generatePersonalizedTips(org.id, stepNumber);
      res.json({ tips });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/onboarding/reset", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      await onboardingService.resetOnboarding(org.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.post("/api/onboarding/sample-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const result = await onboardingService.generateSampleData(org.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  api.delete("/api/onboarding/sample-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
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
    const org = req.organization;
    const usage = await getAllUsageLimits(org.id);
    res.json(usage);
  });
  
  api.get("/api/usage/limits", async (req, res) => {
    res.json(TIER_LIMITS);
  });

  // Usage status for in-app limit banners
  api.get("/api/usage/status", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res) => {
    try {
      const orgId = getOrganizationId(req);
      const allUsage = await getAllUsageLimits(orgId, { isFounder: req.isFounder });

      const RESOURCE_LABELS: Record<string, string> = {
        leads: "Leads",
        properties: "Properties",
        notes: "Notes",
        ai_requests: "Daily AI Requests",
      };

      const limits = Object.entries(allUsage.usage).map(([resource, info]) => ({
        resource,
        current: info.current,
        limit: info.limit,
        percentUsed: info.percentage ?? 0,
        label: RESOURCE_LABELS[resource] || resource,
      }));

      res.json({ limits, tier: allUsage.tier });
    } catch (error) {
      logger.error("Failed to fetch usage status", { error });
      return Errors.internal(res, error);
    }
  });

  // ============================================
  // TEAM MEMBERS
  // ============================================
  
  api.get("/api/team", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const members = await storage.getTeamMembers(org.id);
    res.json(members);
  });
  
  api.get("/api/me/permissions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
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
  
  const updateRoleSchema = z.object({
    role: z.string().min(1, "Role is required"),
  });

  api.patch("/api/team/:id/role", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    const org = req.organization;
    const memberId = Number(req.params.id);
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.errors);
    }
    const { role } = parsed.data;
    const context = req.permissionContext as UserPermissionContext;

    if (!ROLES.includes(role)) {
      return Errors.badRequest(res, `Invalid role. Must be one of: ${ROLES.join(", ")}`);
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

    try {
      const user = req.user as any;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.claims?.sub || user?.id)?.toString() || null,
        action: "update",
        entityType: "team_member",
        entityId: memberId,
        changes: { before: { role: targetMember.role }, after: { role }, fields: ["role"] },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        metadata: {},
      });
    } catch (e) { /* non-fatal */ }

    res.json(updated);
  });
  
  // ============================================
  // TEAM PERFORMANCE DASHBOARD (18.1-18.3)
  // ============================================
  
  const teamPerformanceCache = new Map<string, { data: any; timestamp: number }>();
  const CACHE_TTL_MS = 5 * 60 * 1000;
  
  api.get("/api/team/performance", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
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
      logger.error("Team performance error", error instanceof Error ? error : undefined);
      res.status(500).json({ message: error.message || "Failed to fetch team performance" });
    }
  });
  
  // ============================================
  // RECENT ITEMS (Command Palette)
  // ============================================
  
  api.get("/api/recent-items", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const limit = 5;
      
      const [recentLeads, recentProperties, recentDeals] = await Promise.all([
        db.select({ 
          id: leads.id, 
          name: sql`CONCAT(${leads.firstName}, ' ', ${leads.lastName})`,
          type: sql`'lead'` 
        })
          .from(leads)
          .where(eq(leads.organizationId, org.id))
          .orderBy(desc(leads.updatedAt))
          .limit(limit),
        db.select({ 
          id: properties.id, 
          name: sql`COALESCE(${properties.address}, 'Unnamed Property')`, 
          type: sql`'property'` 
        })
          .from(properties)
          .where(eq(properties.organizationId, org.id))
          .orderBy(desc(properties.updatedAt))
          .limit(limit),
        db.select({
          id: deals.id,
          name: sql<string>`concat('Deal #', ${deals.id}::text)`,
          type: sql`'deal'`
        })
          .from(deals)
          .where(eq(deals.organizationId, org.id))
          .orderBy(desc(deals.updatedAt))
          .limit(limit),
      ]);
      
      res.json({
        leads: recentLeads,
        properties: recentProperties,
        deals: recentDeals,
      });
    } catch (err) {
      logger.error("Recent items fetch error", err instanceof Error ? err : undefined);
      res.status(500).json({ message: "Failed to fetch recent items" });
    }
  });

  // ── Organization settings (lightweight JSONB patch) ───────────────────────
  // Used by feature-hints and other UI toggles (showTips, checklistDismissed…)
  api.patch("/api/organization/settings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const allowed = z.object({
        showTips: z.boolean().optional(),
        checklistDismissed: z.boolean().optional(),
        notificationsConfigured: z.boolean().optional(),
        mailMode: z.enum(["test", "live"]).optional(),
        timezone: z.string().optional(),
        currency: z.string().optional(),
      }).strict();
      const parsed = allowed.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      // Merge patch into the existing settings JSONB
      const current = await storage.getOrganization(org.id);
      const merged = { ...(current?.settings ?? {}), ...parsed.data };
      const updated = await storage.updateOrganization(org.id, { settings: merged } as any);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.claims?.sub || user?.id)?.toString() || null,
          action: "update",
          entityType: "organization_settings",
          entityId: org.id,
          changes: { after: parsed.data, fields: Object.keys(parsed.data) },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch (e) { /* non-fatal */ }

      res.json({ settings: updated.settings });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to update settings" });
    }
  });

  // ── Seat Invitations ──────────────────────────────────────────────────────
  // Owner/admin can invite an email to join the org. Invitee gets a token
  // link; on first sign-in with that token query param, they're attached
  // as a team member with the assigned role.

  const createInvitationSchema = z.object({
    email: z.string().email(),
    role: z.enum(["admin", "member", "viewer", "acquisitions", "marketing", "finance"]).default("member"),
  });

  const bulkInvitationSchema = z.object({
    invites: z.array(createInvitationSchema).min(1).max(200),
  });

  // Helper: generate a short, URL-safe token
  function generateInviteToken(): string {
    const bytes = new Uint8Array(24);
    // Node 18+ globalThis.crypto
    globalThis.crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString("base64url");
  }

  // GET /api/organization/invitations — list pending invites
  api.get("/api/organization/invitations", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      if (!org) return Errors.unauthorized(res);
      const { organizationInvitations } = await import("@shared/schema");
      const rows = await db
        .select()
        .from(organizationInvitations)
        .where(eq(organizationInvitations.organizationId, org.id))
        .orderBy(desc(organizationInvitations.createdAt));
      res.json({ invitations: rows });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // POST /api/organization/invitations — create one or many invites
  api.post("/api/organization/invitations", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      if (!org) return Errors.unauthorized(res);
      const user = (req as any).user;
      const inviterId = user?.claims?.sub || user?.id || null;
      // Accept either a single invite or { invites: [...] } for bulk.
      const bulkParsed = bulkInvitationSchema.safeParse(req.body);
      const singleParsed = createInvitationSchema.safeParse(req.body);
      let invites: Array<{ email: string; role: string }>;
      if (bulkParsed.success) {
        invites = bulkParsed.data.invites;
      } else if (singleParsed.success) {
        invites = [singleParsed.data];
      } else {
        return Errors.validationFailed(res, (bulkParsed.error ?? singleParsed.error).errors);
      }
      const { organizationInvitations } = await import("@shared/schema");
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
      const rows = await db
        .insert(organizationInvitations)
        .values(
          invites.map((i) => ({
            organizationId: org.id,
            email: i.email.toLowerCase(),
            role: i.role,
            token: generateInviteToken(),
            invitedByUserId: inviterId,
            status: "pending",
            expiresAt,
          }))
        )
        .returning();

      // Non-fatal: log activity so Dolores's audit-log export captures each invite.
      try {
        for (const row of rows) {
          await storage.createAuditLogEntry({
            organizationId: org.id,
            userId: inviterId,
            action: "create",
            entityType: "organization_invitation",
            entityId: row.id,
            changes: { after: { email: row.email, role: row.role }, fields: ["email", "role"] },
            ipAddress: req.ip || null,
            userAgent: req.headers["user-agent"] || null,
            metadata: { token: row.token },
          });
        }
      } catch { /* non-fatal */ }

      // TODO: send actual invitation emails (SendGrid). For now, the link is
      // surfaced in the response so an operator UI can copy/share it.
      const origin = (req.headers.origin as string) || `https://${req.headers.host}`;
      res.status(201).json({
        created: rows.length,
        invitations: rows.map((r) => ({
          id: r.id,
          email: r.email,
          role: r.role,
          token: r.token,
          expiresAt: r.expiresAt,
          link: `${origin}/auth?invite=${r.token}`,
        })),
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // DELETE /api/organization/invitations/:id — revoke a pending invite
  api.delete("/api/organization/invitations/:id", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      if (!org) return Errors.unauthorized(res);
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid invitation id");
      const { organizationInvitations } = await import("@shared/schema");
      const [updated] = await db
        .update(organizationInvitations)
        .set({ status: "revoked" })
        .where(and(eq(organizationInvitations.id, id), eq(organizationInvitations.organizationId, org.id)))
        .returning();
      if (!updated) return Errors.notFound(res, "Invitation");
      res.json({ ok: true, id });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // POST /api/organization/invitations/accept — called by a signed-in user
  // after landing on /auth?invite=<token>. Attaches them to the inviting org.
  api.post("/api/organization/invitations/accept", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub || user?.id;
      const userEmail = (user?.claims?.email || user?.email || "").toLowerCase();
      const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);
      const { organizationInvitations, teamMembers } = await import("@shared/schema");
      const [invite] = await db
        .select()
        .from(organizationInvitations)
        .where(eq(organizationInvitations.token, parsed.data.token))
        .limit(1);
      if (!invite) return Errors.notFound(res, "Invitation");
      if (invite.status !== "pending") return Errors.badRequest(res, `Invitation is ${invite.status}`);
      if (invite.expiresAt < new Date()) {
        await db.update(organizationInvitations).set({ status: "expired" }).where(eq(organizationInvitations.id, invite.id));
        return Errors.badRequest(res, "Invitation has expired");
      }
      if (userEmail && invite.email.toLowerCase() !== userEmail) {
        return Errors.forbidden(res, "Invitation email does not match the signed-in account");
      }

      // Attach user as team member (idempotent: skip if already present).
      const existing = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.organizationId, invite.organizationId), eq(teamMembers.userId, userId)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(teamMembers).values({
          organizationId: invite.organizationId,
          userId,
          email: userEmail || null,
          displayName: user?.firstName || user?.email || null,
          role: invite.role,
          isActive: true,
          joinedAt: new Date(),
        });
      }

      await db
        .update(organizationInvitations)
        .set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: userId })
        .where(eq(organizationInvitations.id, invite.id));

      res.json({ ok: true, organizationId: invite.organizationId, role: invite.role });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Web Push subscriptions ────────────────────────────────────────────────
  // VAPID public key — returned to browser to create a PushSubscription
  api.get("/api/push/vapid-public-key", isAuthenticated, (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return res.status(503).json({ message: "Push notifications not configured" });
    res.json({ publicKey: key });
  });

  // Subscribe — store endpoint + keys
  const pushSubscribeSchema = z.object({
    endpoint: z.string().url("endpoint must be a valid URL"),
    keys: z.object({
      p256dh: z.string().min(1, "keys.p256dh is required"),
      auth: z.string().min(1, "keys.auth is required"),
    }),
  });

  api.post("/api/push/subscribe", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const userId = (user as any)?.claims?.sub ?? user?.id ?? "unknown";
      const parsed = pushSubscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { endpoint, keys } = parsed.data;
      // Upsert: ignore if same endpoint already registered
      await db.execute(
        sql`INSERT INTO push_subscriptions (organization_id, user_id, endpoint, p256dh, auth)
            VALUES (${org.id}, ${userId}, ${endpoint}, ${keys.p256dh}, ${keys.auth})
            ON CONFLICT (endpoint) DO NOTHING`
      );
      res.status(201).json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Unsubscribe — remove endpoint
  const pushUnsubscribeSchema = z.object({
    endpoint: z.string().url("endpoint must be a valid URL"),
  });

  api.post("/api/push/unsubscribe", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const parsed = pushUnsubscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { endpoint } = parsed.data;
      await db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to remove subscription" });
    }
  });

  // -----------------------------------------------------------------------
  // Commission Tracking (T54)
  // -----------------------------------------------------------------------

  // GET /api/commissions/config — get tier configuration
  api.get("/api/commissions/config", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const config = await getCommissionConfig(req.organization.id);
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PUT /api/commissions/config — save tier configuration
  const commissionConfigSchema = z.object({
    tiers: z.array(z.object({
      name: z.string().min(1),
      minDealsClosed: z.number().int().min(0),
      commissionRate: z.number().min(0).max(100),
    })).optional(),
    defaultRate: z.number().min(0).max(100).optional(),
  }).passthrough();

  api.put("/api/commissions/config", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const parsed = commissionConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      await saveCommissionConfig(req.organization.id, parsed.data);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/commissions/summaries — YTD summary per agent
  api.get("/api/commissions/summaries", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const summaries = await getAgentCommissionSummaries(req.organization.id, year);
      res.json(summaries);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/commissions — list records, optional filters
  api.get("/api/commissions", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const { teamMemberId, dealId, status, fromDate, toDate } = req.query;
      const records = await getCommissionRecords(req.organization.id, {
        teamMemberId: teamMemberId ? parseInt(teamMemberId as string) : undefined,
        dealId: dealId ? parseInt(dealId as string) : undefined,
        status: status as any,
        fromDate: fromDate ? new Date(fromDate as string) : undefined,
        toDate: toDate ? new Date(toDate as string) : undefined,
      });
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/commissions — manually record a commission
  const recordCommissionSchema = z.object({
    teamMemberId: z.number().int().positive(),
    dealId: z.number().int().positive(),
    salePriceCents: z.number().int().positive(),
    closedAt: z.string().optional(),
  });

  api.post("/api/commissions", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const parsed = recordCommissionSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { teamMemberId, dealId, salePriceCents, closedAt } = parsed.data;
      const record = await recordDealCommission(
        req.organization.id,
        teamMemberId,
        dealId,
        salePriceCents,
        closedAt ? new Date(closedAt) : undefined
      );
      res.status(201).json(record);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/commissions/:id/pay — record a payment against a commission
  const commissionPaymentSchema = z.object({
    paidCents: z.number().int().positive("paidCents must be a positive number"),
  });

  api.post("/api/commissions/:id/pay", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const parsed = commissionPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }
      const { paidCents } = parsed.data;
      const updated = await recordCommissionPayment(
        req.organization.id,
        req.params.id,
        paidCents
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/commissions/statement/:teamMemberId — download plain-text statement
  api.get("/api/commissions/statement/:teamMemberId", isAuthenticated, getOrCreateOrg, requireAdminOrAbove, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const summaries = await getAgentCommissionSummaries(req.organization.id, year);
      const summary = summaries.find(s => s.teamMemberId === parseInt(req.params.teamMemberId));
      if (!summary) return res.status(404).json({ message: "Team member not found" });

      const org = req.organization;
      const statement = generateCommissionStatement(summary, org.name || "Organization", year);

      res.setHeader("Content-Type", "text/plain");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="commission-${summary.displayName.replace(/\s+/g, "-")}-${year}.txt"`
      );
      res.send(statement);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // NPS FEEDBACK COLLECTION
  // ============================================

  // POST /api/nps — Submit an NPS response
  api.post("/api/nps", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = getOrganizationId(authReq);
      const userId = String(authReq.user.id);

      const schema = z.object({
        score: z.number().int().min(0).max(10),
        feedback: z.string().optional(),
        trigger: z.string().min(1),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.errors);
      }

      const { score, feedback, trigger } = parsed.data;

      const [inserted] = await db.insert(npsResponses).values({
        organizationId: orgId,
        userId,
        score,
        feedback: feedback || null,
        trigger,
      }).returning();

      logger.info("NPS response submitted", { orgId, userId, score, trigger });
      res.json({ success: true, id: inserted.id });
    } catch (err: any) {
      logger.error("NPS submission failed", { error: err.message });
      return Errors.internal(res, err);
    }
  });

  // GET /api/nps/pending — Check if user has a pending NPS prompt
  api.get("/api/nps/pending", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = getOrganizationId(authReq);
      const userId = String(authReq.user.id);

      const org = authReq.organization;
      const now = new Date();
      const createdAt = org.createdAt ? new Date(org.createdAt) : now;
      const daysSinceCreation = Math.floor(
        (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check for any NPS dismissed within last 7 days (stored in query param or localStorage on client)
      // Server only checks: have they submitted for this trigger already?

      // Trigger: day_14 — org created >= 14 days ago, no existing day_14 response
      if (daysSinceCreation >= 14) {
        const [existing] = await db.select({ id: npsResponses.id })
          .from(npsResponses)
          .where(and(
            eq(npsResponses.organizationId, orgId),
            eq(npsResponses.trigger, "day_14"),
          ))
          .limit(1);

        if (!existing) {
          return res.json({ shouldShow: true, trigger: "day_14" });
        }
      }

      // Trigger: upgrade — check if subscriptionTier changed recently (use subscriptionEvents)
      // We check if there's a recent upgrade event and no NPS for it
      try {
        const { subscriptionEvents } = await import("@shared/schema");
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const [recentUpgrade] = await db.select({ id: subscriptionEvents.id })
          .from(subscriptionEvents)
          .where(and(
            eq(subscriptionEvents.organizationId, orgId),
            eq(subscriptionEvents.eventType, "plan_upgraded"),
            sql`${subscriptionEvents.createdAt} >= ${sevenDaysAgo}`,
          ))
          .limit(1);

        if (recentUpgrade) {
          const [existingUpgradeNps] = await db.select({ id: npsResponses.id })
            .from(npsResponses)
            .where(and(
              eq(npsResponses.organizationId, orgId),
              eq(npsResponses.trigger, "upgrade"),
              sql`${npsResponses.createdAt} >= ${sevenDaysAgo}`,
            ))
            .limit(1);

          if (!existingUpgradeNps) {
            return res.json({ shouldShow: true, trigger: "upgrade" });
          }
        }
      } catch {
        // subscriptionEvents may not exist in all environments
      }

      // Trigger: quarterly — every 90 days, check last NPS of any type
      if (daysSinceCreation >= 90) {
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const [recentAny] = await db.select({ id: npsResponses.id })
          .from(npsResponses)
          .where(and(
            eq(npsResponses.organizationId, orgId),
            sql`${npsResponses.createdAt} >= ${ninetyDaysAgo}`,
          ))
          .limit(1);

        if (!recentAny) {
          return res.json({ shouldShow: true, trigger: "quarterly" });
        }
      }

      return res.json({ shouldShow: false, trigger: null });
    } catch (err: any) {
      logger.error("NPS pending check failed", { error: err.message });
      return Errors.internal(res, err);
    }
  });

}
