import type { Express } from "express";
import { storage, db } from "./storage";
import { z } from "zod";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { insertOrganizationSchema, leads, deals, properties, npsResponses, npsPromptQueue, organizations, type InsertTeamMember } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireAdminOrAbove, requireOwner, requirePermission, attachPermissionContext } from "./utils/permissions";
import { requireScope } from "./middleware/roleScope";
import { checkUsageLimit } from "./services/usageLimits";
import { onboardingService, type BusinessType } from "./services/onboarding";
import { BUSINESS_TYPES } from "@shared/models/persona-mapping";
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
  getSplitConfigSummary,
  saveSplitConfig,
  getGciForecast,
} from "./services/commissionService";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import { customerAuditFromRequest, CustomerAuditActions } from "./utils/customerAudit";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import type { Response } from "express";
import {
  generateInviteToken,
  hashInviteToken,
  inviteTokenLast4,
  redactToken,
  tokenMatchesRow,
} from "./utils/inviteTokens";
import { checkInviteCreateLimit, checkInviteAcceptLimit } from "./services/inviteRateLimit";
import { encrypt, decrypt, isEncrypted } from "./services/fieldEncryption";
import {
  taxIdentitySchema,
  taxIdLast4,
  maskTaxId,
  type TaxIdType,
} from "@shared/taxIdentity";

// Customer-safe slice of the organizations.settings jsonb blob. The Settings
// page sends the whole current blob back with one key changed, so this schema
// (default zod semantics: unknown keys are STRIPPED, not rejected) drops
// anything privileged that got echoed back — e.g. simulationMode, which lives
// in the same blob but must never be customer-writable. The PATCH handler then
// MERGES the parsed slice over the stored blob so privileged keys survive
// from the DB, never from the client.
const orgSettingsPatchSchema = z.object({
  timezone: z.string().max(64).optional(),
  currency: z.string().max(8).optional(),
  defaultInterestRate: z.number().optional(),
  defaultTermMonths: z.number().int().optional(),
  companyAddress: z.string().max(500).optional(),
  companyPhone: z.string().max(50).optional(),
  companyEmail: z.string().max(255).optional(),
  onboardingCompleted: z.boolean().optional(),
  showTips: z.boolean().optional(),
  checklistDismissed: z.boolean().optional(),
  notificationsConfigured: z.boolean().optional(),
  mailMode: z.enum(["test", "live"]).optional(),
  retentionPolicies: z.record(z.string(), z.unknown()).optional(),
  aiSettings: z.record(z.string(), z.unknown()).optional(),
});

// Zod schema for safe organization updates via PATCH /api/organization.
// Sensitive fields (subscriptionTier, isFounder, stripeCustomerId, creditBalance, etc.)
// are deliberately excluded — they must be updated through dedicated endpoints.
// `settings` was missing entirely until the WS1 interactive pass (2026-07-07):
// the .strict() schema 422'd every Settings-page save ("Unrecognized key:
// settings") and the UI reverted silently.
const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  onboardingCompleted: z.boolean().optional(),
  onboardingStep: z.number().int().min(0).optional(),
  onboardingData: z.record(z.string(), z.unknown()).optional(),
  autoTopUpEnabled: z.boolean().optional(),
  autoTopUpThresholdCents: z.number().int().min(0).optional(),
  autoTopUpAmountCents: z.number().int().min(0).optional(),
  settings: orgSettingsPatchSchema.optional(),
  // Note Investor vertical (Phase 5 §5). Captured during onboarding step 0;
  // also editable later from Settings for orgs that pivot. Constrained to
  // the three canonical values so the sidebar / persona registry can read
  // it without defensive parsing.
  investorType: z.enum(["land", "notes", "both"]).optional(),
}).strict();

export function registerOrganizationRoutes(app: Express): void {
  const api = app;

  // Founder-facing safety status: which kill-switches are on, and
  // how many simulated actions got recorded in the last 7 days.
  // Used by the testing suite to prove "yes, the harness is live"
  // before a scenario run.
  // FOUNDER-GATED. This lives under /api/founder/ and reads `simulated_actions`
  // across EVERY organization (the query is deliberately un-scoped — a founder
  // safety dashboard is meant to see the whole platform). It carried
  // isAuthenticated + getOrCreateOrg only, so any authenticated user of any org
  // could read ten recent rows from other tenants, payloads included — and a
  // simulated Lob payload carries a recipient name and mailing address.
  //
  // The fix is the missing guard, NOT an org filter: scoping the query would
  // break the view this endpoint exists to provide. The cross-org read is
  // correct once the caller is provably the founder.
  api.get("/api/founder/safety-status", isAuthenticated, getOrCreateOrg, requireFounder, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const {
        isGlobalSimulationMode,
        isCategorySimulated,
        isOrgSimulated,
      } = await import("./utils/simulationMode");
      const { simulatedActions } = await import("@shared/schema");
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recent = await db
        .select()
        .from(simulatedActions)
        .where(sql`${simulatedActions.createdAt} >= ${since}`)
        .orderBy(desc(simulatedActions.createdAt))
        .limit(100);
      const categoryCounts: Record<string, number> = {};
      for (const r of recent) {
        categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
      }
      const categories = ["stripe", "lob", "sms", "email", "ai_paid", "webhook_outbound", "billing_mutation"] as const;
      res.json({
        simulationModeActive: isGlobalSimulationMode() || isOrgSimulated(org),
        globalEnvFlag: isGlobalSimulationMode(),
        orgFlag: isOrgSimulated(org),
        categories: Object.fromEntries(
          categories.map((c) => [c, isCategorySimulated(c) || isOrgSimulated(org)])
        ),
        recentSimulatedActions: {
          last7Days: recent.length,
          byCategory: categoryCounts,
          sample: recent.slice(0, 10),
        },
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

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
      Errors.internal(res, error);
    }
  });

  // GET /api/playbooks/:id - Get playbook template details with steps
  api.get("/api/playbooks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { id } = req.params;
      const org = req.organization;

      const template = PLAYBOOK_TEMPLATES_DATA.find(t => t.id === id);
      if (!template) {
        return Errors.notFound(res, "Playbook template");
      }

      // Check for active instance
      const activeInstance = await storage.getPlaybookInstanceByTemplate(org.id, id);

      res.json({
        template,
        activeInstance,
      });
    } catch (error: any) {
      logger.error("Get playbook error", { error: error.message });
      Errors.internal(res, error);
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
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { linkedDealId, linkedPropertyId, linkedLeadId } = parsed.data;
      
      const template = PLAYBOOK_TEMPLATES_DATA.find(t => t.id === id);
      if (!template) {
        return Errors.notFound(res, "Playbook template");
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
      Errors.internal(res, new Error('Failed to start playbook'));
    }
  });

  // GET /api/playbooks/instances/:instanceId - Get specific playbook instance
  api.get("/api/playbooks/instances/:instanceId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { instanceId } = req.params;
      const org = req.organization;
      
      const instance = await storage.getPlaybookInstanceById(org.id, parseInt(instanceId));
      if (!instance) {
        return Errors.notFound(res, "Playbook instance");
      }
      
      const template = PLAYBOOK_TEMPLATES_DATA.find(t => t.id === instance.templateId);
      
      res.json({
        instance,
        template,
      });
    } catch (error: any) {
      logger.error("Get playbook instance error", { error: error.message });
      Errors.internal(res, new Error('Failed to get playbook instance'));
    }
  });

  // POST /api/playbooks/instances/:instanceId/steps/:stepId/complete - Mark step complete
  api.post("/api/playbooks/instances/:instanceId/steps/:stepId/complete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { instanceId, stepId } = req.params;
      const org = req.organization;
      
      const instance = await storage.getPlaybookInstanceById(org.id, parseInt(instanceId));
      if (!instance) {
        return Errors.notFound(res, "Playbook instance");
      }
      
      const template = PLAYBOOK_TEMPLATES_DATA.find(t => t.id === instance.templateId);
      if (!template) {
        return Errors.notFound(res, "Playbook template");
      }
      
      // Verify step exists in template
      const step = template.steps.find((s: any) => s.id === stepId);
      if (!step) {
        return Errors.notFound(res, "Step in playbook");
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
      Errors.internal(res, new Error('Failed to complete step'));
    }
  });

  // POST /api/playbooks/instances/:instanceId/steps/:stepId/uncomplete - Undo step completion
  api.post("/api/playbooks/instances/:instanceId/steps/:stepId/uncomplete", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { instanceId, stepId } = req.params;
      const org = req.organization;
      
      const instance = await storage.getPlaybookInstanceById(org.id, parseInt(instanceId));
      if (!instance) {
        return Errors.notFound(res, "Playbook instance");
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
      Errors.internal(res, new Error('Failed to uncomplete step'));
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
      Errors.internal(res, new Error('Failed to delete playbook instance'));
    }
  });
  
  // ============================================
  // ORGANIZATION
  // ============================================
  
  api.get("/api/organization", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    res.json(org);
  });
  
  api.patch("/api/organization", isAuthenticated, getOrCreateOrg, requireScope("settings_write"), async (req, res) => {
    const org = req.organization;
    const parsed = updateOrganizationSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const updates: typeof parsed.data = { ...parsed.data };
    if (updates.settings) {
      // Merge the whitelisted slice over the stored blob — privileged keys
      // (simulationMode etc.) are preserved from the DB, never client-set.
      updates.settings = { ...((org.settings as Record<string, unknown>) ?? {}), ...updates.settings };
    }
    const updated = await storage.updateOrganization(org.id, updates);

    try {
      const user = req.user as any;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.id || user?.id)?.toString() || null,
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
  
  // ─── Tax Identity (1099 issuer fields) ───────────────────────────────────
  //
  // Captures the org-side fields required to issue a valid Form 1099-INT:
  //   - legalEntityName  (exact IRS filing name)
  //   - taxIdType + ein  (EIN ciphertext via fieldEncryption)
  //   - taxAddress       (jsonb)
  //
  // GET   returns a redacted view (last4 + masked) — never the plaintext EIN.
  // PATCH validates with the shared Zod schema and encrypts before insert.
  // POST  /skip stores onboardingData.skippedTaxIdentity = {skipped:true, ts}.
  //
  // Owner-gated. The 1099 generator still 422s when these are unset.

  api.get(
    "/api/organization/tax-identity",
    isAuthenticated,
    getOrCreateOrg,
    requireOwner(),
    async (req, res) => {
      try {
        const authReq = req as AuthenticatedRequest;
        const org = authReq.organization;
        let last4: string | null = null;
        if (org.ein) {
          try {
            const plain = decrypt(org.ein);
            last4 = taxIdLast4(plain);
          } catch (err) {
            // Bad ciphertext or wrong key — surface as missing rather than 500.
            logger.warn(
              "[tax-identity] failed to decrypt stored EIN — treating as missing",
              { orgId: org.id, error: (err as Error).message },
            );
            last4 = null;
          }
        }
        res.json({
          legalEntityName: org.legalEntityName ?? null,
          taxIdType: (org.taxIdType as TaxIdType | null) ?? null,
          taxIdLast4: last4,
          taxIdMasked: last4 ? maskTaxId(`000-00-${last4}`) : null,
          taxAddress: org.taxAddress ?? null,
          captured: !!org.ein && !!org.legalEntityName,
          skipped: !!org.onboardingData?.skippedTaxIdentity?.skipped,
          skippedAt: org.onboardingData?.skippedTaxIdentity?.skippedAt ?? null,
          capturedAt: org.onboardingData?.taxIdentityCapturedAt ?? null,
        });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  api.patch(
    "/api/organization/tax-identity",
    isAuthenticated,
    getOrCreateOrg,
    requireOwner(),
    async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const org = authReq.organization;
      const parsed = taxIdentitySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { legalEntityName, taxIdType, taxId, taxAddress } = parsed.data;

      try {
        // Encrypt the tax ID via the canonical fieldEncryption module.
        // Idempotent guard: never double-encrypt if a caller passed an
        // already-enveloped value.
        const cipher = isEncrypted(taxId) ? taxId : encrypt(taxId);

        // Merge the captured-at timestamp into onboardingData and clear any
        // prior "skipped" flag — capturing always supersedes skipping.
        const now = new Date().toISOString();
        const existingData = org.onboardingData ?? {};
        const nextData = {
          ...existingData,
          taxIdentityCapturedAt: now,
          skippedTaxIdentity: undefined,
        };

        const updated = await storage.updateOrganization(org.id, {
          ein: cipher,
          taxIdType,
          legalEntityName,
          taxAddress,
          onboardingData: nextData as typeof org.onboardingData,
        });

        // Phase 3 W10 — mirror the tax address onto the Stripe customer so
        // Stripe Tax computes correct rates on the next invoice. Best-effort:
        // any failure logs but does not roll back the DB write.
        try {
          const { syncTaxAddressToStripe } = await import("./services/stripeTax");
          await syncTaxAddressToStripe(updated);
        } catch (e) {
          logger.warn("[tax-identity] stripe customer tax sync failed (non-fatal)", {
            orgId: org.id,
            error: (e as Error).message,
          });
        }

        // Audit log — redacted last-4 only, never the plaintext.
        try {
          const user = authReq.user as any;
          await storage.createAuditLogEntry({
            organizationId: org.id,
            userId: (user?.id || user?.id)?.toString() || null,
            action: "update",
            entityType: "organization_tax_identity",
            entityId: org.id,
            changes: {
              fields: ["legalEntityName", "taxIdType", "ein", "taxAddress"],
              after: {
                taxIdType,
                taxIdLast4: taxIdLast4(taxId),
                legalEntityName,
                taxAddress: {
                  city: taxAddress.city,
                  state: taxAddress.state,
                  zip: taxAddress.zip,
                },
              },
            },
            ipAddress: req.ip || null,
            userAgent: req.headers["user-agent"] || null,
            metadata: { source: "tax-identity-form" },
          });
        } catch (e) {
          logger.warn("[tax-identity] audit-log entry failed (non-fatal)", {
            orgId: org.id,
            error: (e as Error).message,
          });
        }

        // Phase 3 Week 11 — sensitive settings change. Records the
        // last-4 only; the plaintext tax ID never lands in audit_events.
        await auditFromRequest(req, {
          action: AuditActions.SETTINGS_TAX_IDENTITY_CHANGED,
          target: { type: "settings", id: org.id },
          metadata: {
            taxIdType,
            taxIdLast4: taxIdLast4(taxId),
            legalEntityName,
          },
        });

        // Tahoe / Beatrice — customer-visible security activity. tax_id_type
        // is sensitive_financial and legal_entity_name is pii in the registry;
        // both are reduced to class labels by the writer.
        void customerAuditFromRequest(req, {
          organizationId: org.id,
          action: CustomerAuditActions.SECURITY_TAX_IDENTITY_CHANGED,
          category: "security",
          targetLabel: "Tax identity",
          metadataTable: "organizations",
          metadata: { tax_id_type: taxIdType, legal_entity_name: legalEntityName },
        });

        logger.info("[tax-identity] captured", {
          orgId: org.id,
          taxIdType,
          taxIdLast4: taxIdLast4(taxId),
        });

        res.json({
          success: true,
          legalEntityName: updated.legalEntityName,
          taxIdType: updated.taxIdType,
          taxIdLast4: taxIdLast4(taxId),
          taxAddress: updated.taxAddress,
          capturedAt: now,
        });
      } catch (err) {
        logger.error(
          "[tax-identity] failed to update org tax identity",
          err instanceof Error ? err : undefined,
        );
        Errors.internal(res, err);
      }
    },
  );

  api.post(
    "/api/organization/tax-identity/skip",
    isAuthenticated,
    getOrCreateOrg,
    requireOwner(),
    async (req, res) => {
      try {
        const authReq = req as AuthenticatedRequest;
        const org = authReq.organization;
        const now = new Date().toISOString();
        const existingData = org.onboardingData ?? {};
        const nextData = {
          ...existingData,
          skippedTaxIdentity: { skipped: true, skippedAt: now },
        };
        await storage.updateOrganization(org.id, {
          onboardingData: nextData as typeof org.onboardingData,
        });

        try {
          const user = authReq.user as any;
          await storage.createAuditLogEntry({
            organizationId: org.id,
            userId: (user?.id || user?.id)?.toString() || null,
            action: "skip",
            entityType: "organization_tax_identity",
            entityId: org.id,
            changes: { after: { skipped: true, skippedAt: now } },
            ipAddress: req.ip || null,
            userAgent: req.headers["user-agent"] || null,
            metadata: { source: "tax-identity-form" },
          });
        } catch (e) {
          /* non-fatal */
        }

        logger.info("[tax-identity] skipped during onboarding", {
          orgId: org.id,
        });

        res.json({ success: true, skipped: true, skippedAt: now });
      } catch (err) {
        Errors.internal(res, err);
      }
    },
  );

  // Update AI settings for the organization
  api.patch("/api/organization/ai-settings", isAuthenticated, getOrCreateOrg, requirePermission("canAccessSettings"), async (req, res) => {
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
          userId: (user?.id || user?.id)?.toString() || null,
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
        return Errors.validationFailed(res, error.issues);
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
      Errors.internal(res, error);
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
      Errors.internal(res, error);
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
      
      // Stripe being unconfigured/unreachable must not 500 the Settings
      // page — pricing is informational here. Degrade to "not available"
      // (2026-07-11 sweep: this 500'd /settings whenever STRIPE_SECRET_KEY
      // was absent — which it is until the founder provisions keys).
      let prices;
      try {
        const { getUncachableStripeClient } = await import("./stripeClient");
        const stripe = await getUncachableStripeClient();
        prices = await stripe.prices.search({
          query: `metadata['type']:'seat_addon' AND metadata['tier']:'${tier}' AND active:'true'`,
        });
      } catch (stripeErr) {
        logger.warn(
          "Seat pricing unavailable — Stripe not configured/reachable",
          stripeErr instanceof Error ? stripeErr : undefined,
        );
        return res.json({
          canPurchaseSeats: false,
          message: "Seat purchases aren't available right now.",
        });
      }

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
      Errors.internal(res, error);
    }
  });
  
  // Purchase additional seats
  const purchaseSeatsSchema = z.object({
    quantity: z.number().int().min(1, "Quantity must be at least 1"),
    billingPeriod: z.enum(["monthly", "yearly"], { message: "Billing period must be 'monthly' or 'yearly'" }),
  });

  api.post("/api/organization/seats/purchase", isAuthenticated, getOrCreateOrg, requirePermission("canManageBilling"), async (req, res) => {
    try {
      const org = req.organization;
      const parsed = purchaseSeatsSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { quantity, billingPeriod } = parsed.data;
      
      const tier = org.subscriptionTier || "free";
      if (tier === "free" || tier === "enterprise") {
        return Errors.badRequest(
          res,
          tier === "free"
            ? "Upgrade to a paid plan first"
            : "Contact sales for enterprise seat additions",
        );
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
        return Errors.badRequest(res, `Seat add-on pricing not available for ${tier} ${billingPeriod}`);
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
        // Phase 3 W10 — Stripe Tax on seat add-ons.
        automatic_tax: { enabled: true },
        customer_update: { address: "auto", name: "auto" },
        tax_id_collection: { enabled: true },
      });
      
      logger.info(`[seats] Org ${org.id} initiating seat purchase: ${quantity} seats, ${billingPeriod}, price ${validPrice.id}`);
      res.json({ url: session.url });
    } catch (error: any) {
      logger.error("Purchase seats error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
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
      Errors.internal(res, error);
    }
  });
  
  const onboardingStepSchema = z.object({
    step: z.number().int().min(0).max(4),
    data: z.record(z.string(), z.unknown()).optional(),
    skipped: z.boolean().optional(),
  });

  api.put("/api/onboarding/step", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = onboardingStepSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
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
      Errors.internal(res, error);
    }
  });
  
  const completeStepSchema = z.object({
    stepId: z.number().int().min(0).max(5),
    data: z.record(z.string(), z.unknown()).optional(),
  });

  api.post("/api/onboarding/complete-step", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = completeStepSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
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
      Errors.internal(res, error);
    }
  });
  
  // Validate against the canonical 15-value businessType list (shared source of
  // truth). The old inline enum had drifted — it listed "vacation_rental"
  // (never a client value) and omitted "subdivider" + "agent_investor", so a
  // user picking those secondary verticals got a silent 422 from provision
  // (swallowed by the onboarding Promise.allSettled) and never got templates.
  const provisionSchema = z.object({
    businessType: z.enum(BUSINESS_TYPES as unknown as [string, ...string[]]),
  });

  api.post("/api/onboarding/provision", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = provisionSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { businessType } = parsed.data;
      
      const result = await onboardingService.provisionTemplates(org.id, businessType as BusinessType);
      res.json(result);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // POST /api/onboarding/complete lives in server/routes-onboarding.ts — the
  // single code path. A duplicate handler here was dead code (the onboarding
  // router mounts at /api/onboarding before this function runs, so it always
  // shadowed this one) and was removed; do not re-add it.

  const tipsSchema = z.object({
    step: z.number().int().min(0).optional(),
  });

  api.post("/api/onboarding/tips", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const parsed = tipsSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const stepNumber = parsed.data.step ?? 0;
      const tips = await onboardingService.generatePersonalizedTips(org.id, stepNumber);
      res.json({ tips });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  api.post("/api/onboarding/reset", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      await onboardingService.resetOnboarding(org.id);
      res.json({ success: true });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  api.post("/api/onboarding/sample-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const result = await onboardingService.generateSampleData(org.id);
      res.json(result);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  api.delete("/api/onboarding/sample-data", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const result = await onboardingService.clearSampleData(org.id);
      res.json(result);
    } catch (error: any) {
      Errors.internal(res, error);
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
        ai_requests: "Monthly Pax Messages",
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
      return Errors.forbidden(res, "You are not a member of this organization");
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
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const { role } = parsed.data;
    const context = req.permissionContext as UserPermissionContext;

    if (!(ROLES as readonly string[]).includes(role)) {
      return Errors.badRequest(res, `Invalid role. Must be one of: ${ROLES.join(", ")}`);
    }

    const members = await storage.getTeamMembers(org.id);
    const targetMember = members.find(m => m.id === memberId);

    if (!targetMember) {
      return Errors.notFound(res, "Team member");
    }

    if (targetMember.role === "owner" && context.role !== "owner") {
      return Errors.forbidden(res, "Only the owner can change the owner's role");
    }

    if (role === "owner" && context.role !== "owner") {
      return Errors.forbidden(res, "Only the owner can assign the owner role");
    }

    // Liana §1: admins can promote between member and va (and to viewer), but
    // they cannot grant `admin` — only the owner can elevate someone to admin.
    if (context.role === "admin" && role === "admin") {
      return Errors.forbidden(res, "Only the owner can grant the admin role");
    }

    const owners = members.filter(m => m.role === "owner");
    if (targetMember.role === "owner" && owners.length === 1 && role !== "owner") {
      return Errors.badRequest(res, "Cannot remove the only owner. Transfer ownership first.");
    }

    // When assigning the `va` role, default the assigned-leads-only flag on.
    // When moving away from `va`, leave the per-user flag alone — admins may
    // have explicitly toggled it for a member and we don't want to silently
    // clear that intent.
    const updates: Partial<InsertTeamMember> = { role } as any;
    if (role === "va" && !((targetMember as any).viewOnlyAssignedLeads)) {
      (updates as any).viewOnlyAssignedLeads = true;
    }

    const updated = await storage.updateTeamMember(memberId, updates);

    try {
      const user = req.user as any;
      await storage.createAuditLogEntry({
        organizationId: org.id,
        userId: (user?.id || user?.id)?.toString() || null,
        action: "update",
        entityType: "team_member",
        entityId: memberId,
        changes: { before: { role: targetMember.role }, after: { role }, fields: ["role"] },
        ipAddress: req.ip || null,
        userAgent: req.headers["user-agent"] || null,
        metadata: {},
      });
    } catch (e) { /* non-fatal */ }

    // Phase 3 Week 11 — role transition is a sensitive event. Promotion to
    // or demotion from owner is treated as ownership transfer.
    const isOwnerTransition = targetMember.role === "owner" || role === "owner";
    await auditFromRequest(req, {
      action: isOwnerTransition
        ? AuditActions.ORG_OWNERSHIP_TRANSFERRED
        : AuditActions.ORG_MEMBER_ADDED,
      target: { type: "organization", id: org.id },
      metadata: {
        op: "role_change",
        memberId,
        fromRole: targetMember.role,
        toRole: role,
      },
    });

    // Tahoe / Beatrice — customer-visible security activity. Member name/email
    // are not included here (only memberId + roles), and metadata is class-
    // labelled by the writer regardless.
    void customerAuditFromRequest(req, {
      organizationId: org.id,
      action: CustomerAuditActions.MEMBER_ROLE_CHANGED,
      category: "members",
      targetLabel: `Member #${memberId}`,
      metadata: { fromRole: targetMember.role, toRole: role },
    });

    res.json(updated);
  });

  // Reyna §1: per-user assigned-leads-only toggle. Admin/owner can flip the
  // flag for any non-owner team member. The default is set automatically
  // when assigning the `va` role above; this endpoint exists for the
  // Settings → Members "VA can see all leads" override.
  const viewOnlyToggleSchema = z.object({
    viewOnlyAssignedLeads: z.boolean(),
  });

  api.patch(
    "/api/team/:id/view-only-assigned-leads",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      const org = req.organization;
      const memberId = Number(req.params.id);
      const parsed = viewOnlyToggleSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }

      const members = await storage.getTeamMembers(org.id);
      const targetMember = members.find((m) => m.id === memberId);
      if (!targetMember) {
        return Errors.notFound(res, "Team member");
      }

      // Never restrict the owner — the row makes no sense, and we don't want
      // to accidentally hide leads from the org's owner.
      if (targetMember.role === "owner") {
        return Errors.badRequest(
          res,
          "Cannot restrict the organization owner's lead visibility",
        );
      }

      const updated = await storage.updateTeamMember(memberId, {
        viewOnlyAssignedLeads: parsed.data.viewOnlyAssignedLeads,
      } as Partial<InsertTeamMember>);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
          action: "update",
          entityType: "team_member",
          entityId: memberId,
          changes: {
            before: {
              viewOnlyAssignedLeads:
                (targetMember as any).viewOnlyAssignedLeads ?? false,
            },
            after: { viewOnlyAssignedLeads: parsed.data.viewOnlyAssignedLeads },
            fields: ["viewOnlyAssignedLeads"],
          },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: {},
        });
      } catch {
        /* non-fatal */
      }

      res.json(updated);
    },
  );

  // ─── Co-Owners (Blanco §1) ────────────────────────────────────────────
  // Co-ownership is owner-managed: only the org owner can add or remove
  // co-owners. Listing is owner-or-admin (admins need to know the dual-
  // billing posture without being able to mutate it).
  api.get(
    "/api/organization/co-owners",
    isAuthenticated,
    getOrCreateOrg,
    requireAdminOrAbove(),
    async (req, res) => {
      const org = req.organization;
      const rows = await storage.listOrgCoOwners(org.id);
      res.json(rows);
    },
  );

  const addCoOwnerSchema = z.object({
    userId: z.string().min(1),
  });

  api.post(
    "/api/organization/co-owners",
    isAuthenticated,
    getOrCreateOrg,
    requireOwner(),
    async (req, res) => {
      const org = req.organization;
      const parsed = addCoOwnerSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }

      // The candidate must already be a team member of this org (we don't
      // create co-ownership for users who aren't on the team).
      const member = await storage.getTeamMember(org.id, parsed.data.userId);
      if (!member) {
        return Errors.badRequest(
          res,
          "User must be a team member of this organization before they can be added as a co-owner",
        );
      }

      const adder = req.user as any;
      const adderUserId = String(adder?.id || adder?.id || "");

      const row = await storage.addOrgCoOwner({
        organizationId: org.id,
        userId: parsed.data.userId,
        addedBy: adderUserId,
      });

      try {
        await auditFromRequest(req, {
          action: AuditActions.ORG_MEMBER_ADDED,
          target: { type: "organization", id: org.id },
          metadata: {
            op: "co_owner_added",
            userId: parsed.data.userId,
          },
        });
      } catch {
        /* non-fatal */
      }

      res.status(201).json(row);
    },
  );

  api.delete(
    "/api/organization/co-owners/:userId",
    isAuthenticated,
    getOrCreateOrg,
    requireOwner(),
    async (req, res) => {
      const org = req.organization;
      const { userId } = req.params;
      if (!userId) return Errors.badRequest(res, "userId required");

      await storage.removeOrgCoOwner(org.id, userId);

      try {
        await auditFromRequest(req, {
          action: AuditActions.ORG_MEMBER_ADDED,
          target: { type: "organization", id: org.id },
          metadata: { op: "co_owner_removed", userId },
        });
      } catch {
        /* non-fatal */
      }

      res.json({ ok: true });
    },
  );

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
      Errors.internal(res, error);
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
      Errors.internal(res, new Error('Failed to fetch recent items'));
    }
  });

  // ── Organization settings (lightweight JSONB patch) ───────────────────────
  // Used by feature-hints and other UI toggles (showTips, checklistDismissed…)
  api.patch("/api/organization/settings", isAuthenticated, getOrCreateOrg, attachPermissionContext(), async (req, res) => {
    try {
      const org = req.organization;
      // MIXED-CONCERN ENDPOINT, gated by FIELD rather than wholesale.
      //
      // Most of what this accepts is per-org UI state any member legitimately
      // toggles (showTips, checklistDismissed, notificationsConfigured).
      // `mailMode`, `timezone` and `currency` are not: they are org-wide
      // operational settings, and `canAccessSettings` is false for member, va
      // and viewer precisely to deny them.
      //
      // Gating the whole route would stop a member dismissing their own
      // checklist — a real regression to fix a real gap, which is the trade a
      // blunt gate makes. Splitting the endpoint is the right long-term shape;
      // refusing just the org-wide subset is the honest fix that costs nobody
      // anything today.
      const ORG_WIDE_SETTINGS = ["mailMode", "timezone", "currency"] as const;
      const touchesOrgWide = ORG_WIDE_SETTINGS.some(
        (k) => (req.body ?? {})[k] !== undefined,
      );
      if (touchesOrgWide && !(req as AuthenticatedRequest).permissionContext?.permissions.canAccessSettings) {
        return Errors.forbidden(
          res,
          "Changing organization-wide settings requires settings access. Your own display preferences can still be saved.",
        );
      }

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
        return Errors.validationFailed(res, parsed.error.issues);
      }
      // Merge patch into the existing settings JSONB
      const current = await storage.getOrganization(org.id);
      const merged = { ...(current?.settings ?? {}), ...parsed.data };
      const updated = await storage.updateOrganization(org.id, { settings: merged } as any);

      try {
        const user = req.user as any;
        await storage.createAuditLogEntry({
          organizationId: org.id,
          userId: (user?.id || user?.id)?.toString() || null,
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
      Errors.internal(res, err);
    }
  });

  // ── Seat Invitations ──────────────────────────────────────────────────────
  // Owner/admin can invite an email to join the org. Invitee gets a token
  // link; on first sign-in with that token query param, they're attached
  // as a team member with the assigned role.

  // Phase 3 Week 14 (Liana §1+§3, Reyna §1): standardized to 4 pragmatic
  // roles + va. Legacy values (acquisitions, marketing, finance) remain in
  // the enum ONLY to avoid breaking pending in-flight invite payloads from
  // older clients — they're remapped to `member` at acceptance time. New
  // surfaces (Settings → Members) emit only the canonical 5.
  const createInvitationSchema = z.object({
    email: z.string().email(),
    role: z
      .enum([
        "admin",
        "member",
        "viewer",
        "va",
        "acquisitions",
        "marketing",
        "finance",
      ])
      .default("member"),
  });

  const bulkInvitationSchema = z.object({
    invites: z.array(createInvitationSchema).min(1).max(200),
  });

  // Pelle G/H/I: invite-token generation now lives in utils/inviteTokens.ts
  // so it's shared with the accept path and unit tests. The plaintext is
  // produced once here, returned to the caller in the response (so the UI
  // can build the email link), and only its SHA-256 hash is persisted.

  // GET /api/organization/invitations — list pending invites
  api.get("/api/organization/invitations", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
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
  api.post("/api/organization/invitations", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const org = req.organization;
      if (!org) return Errors.unauthorized(res);
      const inviterId = req.user?.id ?? null;
      // Accept either a single invite or { invites: [...] } for bulk.
      const bulkParsed = bulkInvitationSchema.safeParse(req.body);
      const singleParsed = createInvitationSchema.safeParse(req.body);
      let invites: Array<{ email: string; role: string }>;
      if (bulkParsed.success) {
        invites = bulkParsed.data.invites;
      } else if (singleParsed.success) {
        invites = [singleParsed.data];
      } else {
        return Errors.validationFailed(res, (bulkParsed.error ?? singleParsed.error).issues);
      }
      // Phase 5 §5 (team readiness) — backend seat enforcement. If the
      // pending invite(s) would push (active members + pending invites)
      // above the org's seatCount, prompt for an upgrade BEFORE persisting
      // anything. Surfaces upgrade requirement to the UI as a 402.
      try {
        const { tierForSubscriptionTier, canAddSeats } = await import("@shared/billing/tier-pricing");
        const tier = tierForSubscriptionTier(org.subscriptionTier);
        const seatCount = (org as any).seatCount ?? 1;
        const { teamMembers: tmTable, organizationInvitations: invTable } = await import("@shared/schema");
        const [activeRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(tmTable)
          .where(and(eq(tmTable.organizationId, org.id), eq(tmTable.isActive, true)));
        const [pendingRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(invTable)
          .where(and(eq(invTable.organizationId, org.id), eq(invTable.status, "pending")));
        const projected = (activeRow?.count ?? 0) + (pendingRow?.count ?? 0) + invites.length;
        if (!tier) {
          return res.status(402).json({
            error: "upgrade_required",
            message: "Free tier cannot invite teammates. Upgrade to Pro or Scale to add seats.",
            statusCode: 402,
            details: { projected, seatCount, tier: null },
          });
        }
        if (!canAddSeats(tier, projected)) {
          return res.status(402).json({
            error: "upgrade_required",
            message: tier === "starter"
              ? "Starter tier is single-user only. Upgrade to Pro or Scale to invite teammates."
              : `Tier ${tier} is capped at ${projected - 1} seats. Upgrade to add more.`,
            statusCode: 402,
            details: { projected, seatCount, tier },
          });
        }
        if (projected > seatCount) {
          return res.status(402).json({
            error: "seat_purchase_required",
            message: `Inviting ${invites.length} teammate(s) would require ${projected} paid seats; you currently have ${seatCount}. Increase your seat count from billing first.`,
            statusCode: 402,
            details: { projected, seatCount, tier, additionalSeatsNeeded: projected - seatCount },
          });
        }
      } catch (err) {
        // Non-fatal: defensive — if the tier-pricing import fails, fall
        // back to the original rate-limit-only behaviour rather than
        // wedging the invite path.
        logger.warn("seat preflight failed (non-fatal)", { error: (err as Error).message });
      }

      // Pelle G/H/I: per-org invite-creation rate limit (100/day).
      // Cost = number of invites in this request so bulk callers can't
      // sneak past with a single API call.
      const rl = await checkInviteCreateLimit(org.id, invites.length);
      if (!rl.allowed) {
        res.setHeader("Retry-After", String(rl.retryAfterSeconds));
        return Errors.limitExceeded(res, {
          limit: rl.limit,
          windowSeconds: 24 * 60 * 60,
          retryAfterSeconds: rl.retryAfterSeconds,
          message: "Too many invites created for this organization in the last 24 hours",
        }, { docsSlug: "limit-invites-per-day" });
      }

      const { organizationInvitations } = await import("@shared/schema");
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

      // Generate one plaintext token per invite, persist only the hash +
      // last4. The plaintext lives in memory just long enough to build the
      // response link below; it never touches the DB or the audit log.
      const prepared = invites.map((i) => {
        const plaintext = generateInviteToken();
        return {
          plaintext,
          values: {
            organizationId: org.id,
            email: i.email.toLowerCase(),
            role: i.role,
            // token: legacy plaintext column — left NULL on new rows so we
            // never persist plaintext. Tolerant accept path handles either.
            token: null,
            inviteTokenHash: hashInviteToken(plaintext),
            inviteTokenLast4: inviteTokenLast4(plaintext),
            invitedByUserId: inviterId,
            status: "pending",
            expiresAt,
          },
        };
      });

      const rows = await db
        .insert(organizationInvitations)
        .values(prepared.map((p) => p.values))
        .returning();

      // Non-fatal: log activity so Dolores's audit-log export captures each invite.
      // Tokens are REDACTED — we log only the last4. Anyone with audit-log
      // read access can no longer hijack outstanding invites.
      try {
        for (let idx = 0; idx < rows.length; idx++) {
          const row = rows[idx];
          const last4 = prepared[idx]?.values.inviteTokenLast4 ?? null;
          await storage.createAuditLogEntry({
            organizationId: org.id,
            userId: inviterId,
            action: "create",
            entityType: "organization_invitation",
            entityId: row.id,
            changes: { after: { email: row.email, role: row.role }, fields: ["email", "role"] },
            ipAddress: req.ip || null,
            userAgent: req.headers["user-agent"] || null,
            metadata: { tokenLast4: last4, tokenRedacted: redactToken(prepared[idx]?.plaintext) },
          });
        }
      } catch { /* non-fatal */ }

      // Phase 3 Week 11 — member-add invitation is a sensitive event.
      for (const row of rows) {
        await auditFromRequest(req, {
          action: AuditActions.ORG_MEMBER_ADDED,
          target: { type: "organization", id: org.id },
          metadata: { stage: "invited", invitationId: row.id, email: row.email, role: row.role },
        });
        // Tahoe / Beatrice — customer-visible security activity. `email` is
        // PII; the writer reduces it to "[Personal]" via the classification
        // registry, so the customer sees that an invite was sent + the role
        // without the raw address being stored in the security log.
        void customerAuditFromRequest(req, {
          organizationId: org.id,
          action: CustomerAuditActions.MEMBER_INVITED,
          category: "members",
          targetLabel: `Invitation #${row.id}`,
          metadata: { email: row.email, role: row.role },
        });
      }

      // Phase 3 Week 14 — Activation telemetry. First team-member invite
      // sent. Idempotent FIRST-occurrence on (org, eventName).
      if (rows.length > 0) {
        try {
          const { recordActivationEventAsync } = await import("./services/activation");
          recordActivationEventAsync({
            orgId: org.id,
            userId: inviterId,
            eventName: "first_team_member_invited",
            eventValue: { invitationId: rows[0]!.id, email: rows[0]!.email, role: rows[0]!.role },
          });
        } catch { /* non-fatal */ }
      }

      // The plaintext token is returned to the caller exactly once so the
      // UI / email-template layer can compose the invite link. After this
      // response, the only persisted reference is the SHA-256 hash.
      const origin = (req.headers.origin as string) || `https://${req.headers.host}`;
      res.status(201).json({
        created: rows.length,
        invitations: rows.map((r, idx) => ({
          id: r.id,
          email: r.email,
          role: r.role,
          token: prepared[idx].plaintext,
          tokenLast4: prepared[idx].values.inviteTokenLast4,
          expiresAt: r.expiresAt,
          link: `${origin}/auth?invite=${prepared[idx].plaintext}`,
        })),
      });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // DELETE /api/organization/invitations/:id — revoke a pending invite
  api.delete("/api/organization/invitations/:id", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
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
      // Phase 3 Week 11 — member-removal (revoke pending invite) is sensitive.
      await auditFromRequest(req, {
        action: AuditActions.ORG_MEMBER_REMOVED,
        target: { type: "organization", id: org.id },
        metadata: { stage: "invitation_revoked", invitationId: id, email: updated.email },
      });
      // Tahoe / Beatrice — customer-visible security activity (member removed).
      void customerAuditFromRequest(req, {
        organizationId: org.id,
        action: CustomerAuditActions.MEMBER_REMOVED,
        category: "members",
        targetLabel: `Invitation #${id}`,
        metadata: { stage: "invitation_revoked", email: updated.email },
      });
      res.json({ ok: true, id });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // POST /api/organization/invitations/accept — called by a signed-in user
  // after landing on /auth?invite=<token>. Attaches them to the inviting org.
  api.post("/api/organization/invitations/accept", isAuthenticated, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user;
      const userId = user?.id;
      const userEmail = (user?.email ?? "").toLowerCase();
      const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      // Pelle G/H/I: per-user accept-rate limit (10/hr) — defends against
      // a leaked / brute-forced token from being burned through by an
      // attacker iterating tokens against this endpoint.
      if (userId) {
        const rl = await checkInviteAcceptLimit(String(userId));
        if (!rl.allowed) {
          res.setHeader("Retry-After", String(rl.retryAfterSeconds));
          return Errors.limitExceeded(res, {
            limit: rl.limit,
            windowSeconds: 60 * 60,
            retryAfterSeconds: rl.retryAfterSeconds,
            message: "Too many invitation accept attempts. Try again later.",
          }, { docsSlug: "limit-invite-accept-attempts" });
        }
      }

      const { organizationInvitations, teamMembers } = await import("@shared/schema");
      const plaintext = parsed.data.token;
      const tokenHash = hashInviteToken(plaintext);

      // Tolerant lookup: try hashed-row path first (new invites), then
      // legacy plaintext column (old invites). On a legacy hit we lazy-
      // migrate by writing the hash + last4 in place — eventually all
      // outstanding invites end up in the hashed bucket and a follow-up
      // migration can drop the plaintext column.
      let invite = (
        await db
          .select()
          .from(organizationInvitations)
          .where(eq(organizationInvitations.inviteTokenHash, tokenHash))
          .limit(1)
      )[0];

      if (!invite) {
        const [legacy] = await db
          .select()
          .from(organizationInvitations)
          .where(eq(organizationInvitations.token, plaintext))
          .limit(1);
        if (legacy && tokenMatchesRow(plaintext, legacy)) {
          invite = legacy;
          // Lazy migration: rehash the row and clear plaintext.
          try {
            await db
              .update(organizationInvitations)
              .set({
                inviteTokenHash: tokenHash,
                inviteTokenLast4: inviteTokenLast4(plaintext),
                token: null,
              })
              .where(eq(organizationInvitations.id, legacy.id));
          } catch (err) {
            logger.warn("[invite-accept] lazy hash migration failed", {
              metadata: { id: legacy.id, error: (err as Error).message },
            });
          }
        }
      }

      if (!invite) return Errors.notFound(res, "Invitation");
      if (invite.status !== "pending") return Errors.badRequest(res, `Invitation is ${invite.status}`);
      if (invite.expiresAt < new Date()) {
        await db.update(organizationInvitations).set({ status: "expired" }).where(eq(organizationInvitations.id, invite.id));
        return Errors.badRequest(res, "Invitation has expired");
      }
      if (userEmail && invite.email.toLowerCase() !== userEmail) {
        return Errors.forbidden(res, "Invitation email does not match the signed-in account", { docsSlug: "invite-email-mismatch" });
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

      // Cycle 14: if the invitee still has the auto-created shadow org
      // that `getOrCreateOrg` spun up on their very first sign-in, and
      // that org is completely empty, make them switch to the inviting
      // org by default. Without this, a seat user lands on their own
      // zero-data org after signing in via an invite link and has no
      // way to "enter" the company they were invited to.
      try {
        const { organizations: orgsTable, leads, properties, deals, notes } = await import("@shared/schema");
        const shadow = await db
          .select()
          .from(orgsTable)
          .where(eq(orgsTable.ownerId, userId))
          .limit(1);
        if (shadow[0] && shadow[0].id !== invite.organizationId) {
          const shadowId = shadow[0].id;
          const counts = await Promise.all([
            db.select().from(leads).where(eq(leads.organizationId, shadowId)).limit(1),
            db.select().from(properties).where(eq(properties.organizationId, shadowId)).limit(1),
            db.select().from(deals).where(eq(deals.organizationId, shadowId)).limit(1),
            db.select().from(notes).where(eq(notes.organizationId, shadowId)).limit(1),
          ]);
          const isEmpty = counts.every((c) => c.length === 0);
          if (isEmpty) {
            // Delete the shadow org (cascades to team_members). The user
            // becomes only a member of the inviting org; getOrCreateOrg
            // will now fall through to their team membership on next
            // request instead of resurrecting the shadow.
            await db.delete(orgsTable).where(eq(orgsTable.id, shadowId));
          }
        }
      } catch (err) {
        logger.warn("shadow-org cleanup failed on invite accept", {
          userId,
          error: (err as Error).message,
        });
      }

      await db
        .update(organizationInvitations)
        .set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: userId })
        .where(eq(organizationInvitations.id, invite.id));

      // Audit-log the acceptance with the token redacted to last4 only.
      try {
        await storage.createAuditLogEntry({
          organizationId: invite.organizationId,
          userId: userId || null,
          action: "update",
          entityType: "organization_invitation",
          entityId: invite.id,
          changes: { after: { status: "accepted" }, fields: ["status", "acceptedByUserId"] },
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
          metadata: { tokenLast4: inviteTokenLast4(plaintext) },
        });
      } catch { /* non-fatal */ }

      res.json({ ok: true, organizationId: invite.organizationId, role: invite.role });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // ── Web Push subscriptions ────────────────────────────────────────────────
  // VAPID public key — returned to browser to create a PushSubscription
  api.get("/api/push/vapid-public-key", isAuthenticated, (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return Errors.serviceUnavailable(res, "Push notifications not configured");
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
      const userId = (user as any)?.id ?? user?.id ?? "unknown";
      const parsed = pushSubscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
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
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { endpoint } = parsed.data;
      await db.execute(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // Commission Tracking (T54)
  // -----------------------------------------------------------------------

  // GET /api/commissions/config — get tier configuration
  api.get("/api/commissions/config", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const config = await getCommissionConfig(req.organization.id);
      res.json(config);
    } catch (err: any) {
      Errors.internal(res, err);
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

  api.put("/api/commissions/config", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const parsed = commissionConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      // Map the request shape (tiers: {name,minDealsClosed,commissionRate}) onto
      // the service's CommissionConfig (tiers: {label,minDeals,ratePercent} +
      // trackingPeriod). trackingPeriod defaults to monthly when not supplied.
      const body = parsed.data as {
        tiers?: { name: string; minDealsClosed: number; commissionRate: number }[];
        trackingPeriod?: "monthly" | "quarterly" | "annual";
        baseFlatAmount?: number;
      };
      await saveCommissionConfig(req.organization.id, {
        tiers: (body.tiers ?? []).map((t) => ({
          label: t.name,
          minDeals: t.minDealsClosed,
          ratePercent: t.commissionRate,
        })),
        trackingPeriod: body.trackingPeriod ?? "monthly",
        baseFlatAmount: body.baseFlatAmount,
      });
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // -----------------------------------------------------------------------
  // Commission SPLIT (agent net-of-split) — Stage 0
  // -----------------------------------------------------------------------

  // GET /api/commissions/split — the org's split config + a computed
  // net-of-split YTD summary. Honest empty state: when nothing is configured
  // `config` is null and `configured` is false — never an assumed split.
  api.get("/api/commissions/split", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const summary = await getSplitConfigSummary(req.organization.id, year);
      res.json(summary);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // PUT /api/commissions/split/config — save the org's OWN split arrangement.
  // Admin-scoped like the tier-config PUT (requireAdminOrAbove), not widened.
  const splitConfigSchema = z.object({
    // Agent's share of the (franchise-adjusted) gross, in basis points.
    agentSplitBps: z.number().int().min(0).max(10000),
    // Annual company-dollar cap in cents; null/omitted = uncapped.
    annualCapCents: z.number().int().min(0).nullable().optional(),
    // Flat per-transaction fee in cents; null/omitted = none.
    transactionFeeCents: z.number().int().min(0).nullable().optional(),
    // Franchise/royalty fee in basis points; null/omitted = none.
    franchiseFeeBps: z.number().int().min(0).max(10000).nullable().optional(),
  });

  api.put("/api/commissions/split/config", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const parsed = splitConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const body = parsed.data;
      await saveSplitConfig(req.organization.id, {
        agentSplitBps: body.agentSplitBps,
        annualCapCents: body.annualCapCents ?? null,
        transactionFeeCents: body.transactionFeeCents ?? null,
        franchiseFeeBps: body.franchiseFeeBps ?? null,
      });
      res.json({ success: true });
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // GET /api/commissions/forecast — pipeline GCI forecast (Stage 2). Projects
  // gross commission over under-contract client-book deals, and agent net when a
  // split is configured. REFUSES (applicable:false) when no commission config is
  // saved — no assumed rate, no invented deals.
  api.get("/api/commissions/forecast", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const forecast = await getGciForecast(req.organization.id, year);
      res.json(forecast);
    } catch (err) {
      Errors.internal(res, err);
    }
  });

  // GET /api/commissions/summaries — YTD summary per agent
  api.get("/api/commissions/summaries", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const summaries = await getAgentCommissionSummaries(req.organization.id, year);
      res.json(summaries);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/commissions — list records, optional filters
  api.get("/api/commissions", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
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
      Errors.internal(res, err);
    }
  });

  // POST /api/commissions — manually record a commission
  const recordCommissionSchema = z.object({
    teamMemberId: z.number().int().positive(),
    dealId: z.number().int().positive(),
    salePriceCents: z.number().int().positive(),
    closedAt: z.string().optional(),
  });

  api.post("/api/commissions", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const parsed = recordCommissionSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
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
      Errors.internal(res, err);
    }
  });

  // POST /api/commissions/:id/pay — record a payment against a commission
  const commissionPaymentSchema = z.object({
    paidCents: z.number().int().positive("paidCents must be a positive number"),
  });

  api.post("/api/commissions/:id/pay", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const parsed = commissionPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { paidCents } = parsed.data;
      const updated = await recordCommissionPayment(
        req.organization.id,
        req.params.id,
        paidCents
      );
      res.json(updated);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/commissions/statement/:teamMemberId — download plain-text statement
  api.get("/api/commissions/statement/:teamMemberId", isAuthenticated, getOrCreateOrg, requireAdminOrAbove(), async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const summaries = await getAgentCommissionSummaries(req.organization.id, year);
      const summary = summaries.find(s => s.teamMemberId === parseInt(req.params.teamMemberId));
      if (!summary) return Errors.notFound(res, "Team member");

      const org = req.organization;
      const statement = generateCommissionStatement(summary, org.name || "Organization", year);

      res.setHeader("Content-Type", "text/plain");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="commission-${summary.displayName.replace(/\s+/g, "-")}-${year}.txt"`
      );
      res.send(statement);
    } catch (err: any) {
      Errors.internal(res, err);
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
        return Errors.validationFailed(res, parsed.error.issues);
      }

      const { score, feedback, trigger } = parsed.data;

      const [inserted] = await db.insert(npsResponses).values({
        organizationId: orgId,
        userId,
        score,
        feedback: feedback || null,
        trigger,
      }).returning();

      // Tahoe E3 Sub-3 — mark any pending prompt-queue row as
      // submitted so we don't double-prompt the same user.
      try {
        await db.update(npsPromptQueue)
          .set({ status: "submitted", consumedAt: new Date() })
          .where(and(
            eq(npsPromptQueue.organizationId, orgId),
            eq(npsPromptQueue.userId, userId),
            eq(npsPromptQueue.status, "pending"),
          ));
      } catch (queueErr) {
        // Queue write is best-effort; never fail the submit.
        logger.warn("NPS prompt queue consume failed", { metadata: { detail: String(queueErr) } });
      }

      // RAFE (P0): a detractor (≤6) is a same-day-call trigger. Persisting the
      // score isn't enough — it must REACH the founder. This is THE live path
      // (the dialog POSTs /api/nps); the old /api/nps/submit had this wired but
      // no client calls it. Drop a founder-visible system_alerts row with the
      // VERBATIM feedback attached. Best-effort: never block the customer submit.
      try {
        const { notifyFounderOfDetractor } = await import("./services/supportNotifications");
        await notifyFounderOfDetractor({
          orgId,
          score,
          comment: feedback ?? null,
          surveyTrigger: trigger,
        });
      } catch (notifyErr) {
        logger.warn("NPS detractor founder notification failed", { metadata: { detail: String(notifyErr) } });
      }

      // Autopilot follow-up (wire-for-real: measurementLoops.npsActionFor +
      // lifecyclePlaybook). A detractor score queues a GATED, witnessed-send
      // win-back draft. Best-effort — never blocks the customer submit.
      try {
        const { enqueueNpsFollowup } = await import("./services/autopilot/measurementLoops");
        const r = await enqueueNpsFollowup({ score, organizationId: orgId, userId, feedback: feedback ?? null });
        if (r.enqueued) logger.info("NPS follow-up dispatch enqueued", { orgId, score, playId: r.playId, dispatchId: r.dispatchId });
      } catch (followErr) {
        logger.warn("NPS follow-up enqueue failed", { metadata: { detail: String(followErr) } });
      }

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

      // Tahoe E3 Sub-3 — the daily scheduler enqueues prompts in
      // nps_prompt_queue. If a row is pending for this (org, user)
      // and is due, surface it immediately and mark shown_at. The
      // legacy heuristic below (day_14 / upgrade / quarterly) stays
      // as a safety net for orgs whose first scheduler run hasn't
      // fired yet.
      try {
        const [queued] = await db.select()
          .from(npsPromptQueue)
          .where(and(
            eq(npsPromptQueue.organizationId, orgId),
            eq(npsPromptQueue.userId, userId),
            eq(npsPromptQueue.status, "pending"),
            sql`${npsPromptQueue.scheduledFor} <= now()`,
          ))
          .orderBy(desc(npsPromptQueue.scheduledFor))
          .limit(1);

        if (queued) {
          await db.update(npsPromptQueue)
            .set({ status: "shown", shownAt: new Date() })
            .where(eq(npsPromptQueue.id, queued.id));
          return res.json({ shouldShow: true, trigger: queued.trigger });
        }
      } catch (queueErr) {
        // Queue read failure should never break NPS — fall through.
        logger.warn("NPS prompt queue read failed", { metadata: { detail: String(queueErr) } });
      }

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

  // POST /api/nps/dismiss — RAFE (P0): persist a dismiss on the queue row so it
  // survives a browser-data clear (the client localStorage flag alone re-nags on
  // a new device / after clearing). Marks any pending|shown queue row dismissed.
  api.post("/api/nps/dismiss", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const orgId = getOrganizationId(authReq);
      const userId = String(authReq.user.id);

      await db.update(npsPromptQueue)
        .set({ status: "dismissed", consumedAt: new Date() })
        .where(and(
          eq(npsPromptQueue.organizationId, orgId),
          eq(npsPromptQueue.userId, userId),
          inArray(npsPromptQueue.status, ["pending", "shown"]),
        ));

      logger.info("NPS prompt dismissed", { orgId, userId });
      res.json({ success: true });
    } catch (err: any) {
      logger.error("NPS dismiss failed", { error: err.message });
      return Errors.internal(res, err);
    }
  });

}
