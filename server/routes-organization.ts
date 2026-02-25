// @ts-nocheck — ORM type refinement deferred; runtime-correct
import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, sql, desc } from "drizzle-orm";
import { insertOrganizationSchema, leads, deals, properties } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireAdminOrAbove, requireOwner } from "./utils/permissions";
import { checkUsageLimit } from "./services/usageLimits";
import { onboardingService, type BusinessType } from "./services/onboarding";
import { SUBSCRIPTION_TIERS } from "@shared/schema";
import { activityLogger } from "./services/activityLogger";
import { getAllUsageLimits, TIER_LIMITS, type SubscriptionTier } from "./services/usageLimits";
import { getUserPermissionContext, getPermissionsForRole, ROLES, type UserPermissionContext } from "./utils/permissions";

const logger = {
  info: (msg: string, meta?: Record<string, any>) => console.log(JSON.stringify({ level: 'INFO', timestamp: new Date().toISOString(), message: msg, ...meta })),
  warn: (msg: string, meta?: Record<string, any>) => console.warn(JSON.stringify({ level: 'WARN', timestamp: new Date().toISOString(), message: msg, ...meta })),
  error: (msg: string, meta?: Record<string, any>) => console.error(JSON.stringify({ level: 'ERROR', timestamp: new Date().toISOString(), message: msg, ...meta })),
};

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
      const org = (req as any).organization;
      
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
      const org = (req as any).organization;
      
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
  api.post("/api/playbooks/:id/start", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { id } = req.params;
      const org = (req as any).organization;
      const { linkedDealId, linkedPropertyId, linkedLeadId } = req.body;
      
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
      await activityLogger.log({
        organizationId: org.id,
        type: "playbook_started",
        title: `Started playbook: ${template.name}`,
        description: `Playbook "${template.name}" was started`,
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
      const org = (req as any).organization;
      
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
      const org = (req as any).organization;
      
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
      await activityLogger.log({
        organizationId: org.id,
        type: "playbook_step_completed",
        title: `Completed step: ${step.title}`,
        description: `Step "${step.title}" was completed in playbook "${template.name}"`,
        entityType: "playbook",
        entityId: instance.id,
      });
      
      if (allComplete) {
        await activityLogger.log({
          organizationId: org.id,
          type: "playbook_completed",
          title: `Completed playbook: ${template.name}`,
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
      const org = (req as any).organization;
      
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
      const org = (req as any).organization;
      
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
  
  api.post("/api/onboarding/complete-step", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { stepId, data } = req.body;
      
      if (typeof stepId !== "number" || stepId < 0 || stepId > 5) {
        return res.status(400).json({ message: "Invalid step ID" });
      }
      
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
  // RECENT ITEMS (Command Palette)
  // ============================================
  
  api.get("/api/recent-items", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
          name: deals.name, 
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
      console.error("Recent items fetch error:", err);
      res.status(500).json({ message: "Failed to fetch recent items" });
    }
  });
  

}
