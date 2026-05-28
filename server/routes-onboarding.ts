/**
 * T215 — Onboarding Routes
 *
 * POST /api/onboarding/complete    — mark onboarding complete + save preferences
 * GET  /api/onboarding/status      — get onboarding status for current user
 * POST /api/onboarding/skip        — skip onboarding wizard
 * GET  /api/onboarding/checklist   — get onboarding checklist items
 * POST /api/onboarding/checklist/:item — mark checklist item as done
 */

import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { onboardingService } from "./services/onboarding";
import { storage } from "./storage";
import { logger } from "./utils/logger";
import { db } from "./db";
import { users } from "@shared/schema";
import type { Persona } from "@shared/models/auth";
import { Errors } from "./utils/errors";

const router = Router();

function getUser(req: Request) { return req.user; }

/**
 * Server-side mirror of `client/src/components/onboarding/OnboardingWizard.tsx`
 * `derivePersona`. Keep these two in sync. The client PUTs to
 * /api/me/persona at step 0; this function is the safety net so a user
 * who finishes onboarding offline (or whose step-0 PUT failed silently)
 * still ends up with the correct persona on /onboarding/complete.
 */
function derivePersona(businessType: string | undefined, investorType: string | undefined): Persona {
  if (investorType === "notes" && businessType === "note_investor") return "note_investor";
  switch (businessType) {
    case "note_investor":          return "note_investor";
    case "residential_wholesaler": return "wholesaler";
    case "fix_and_flip":           return "fix_flipper";
    case "buy_and_hold":
    case "short_term_rental":
    case "multifamily":
    case "mobile_home":            return "landlord";
    case "subdivider":
    case "developer":              return "subdivider";
    case "tax_lien_deed":          return "tax_delinquent";
    default:                       return "land_investor";
  }
}

router.post("/complete", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const org = req.organization;

    // Support both v1 (flat fields) and v2 (formData wrapper) formats
    const body = req.body || {};
    const formData = body.formData || body;
    const businessType = formData.businessType || formData.investorType || body.businessType;
    const orgName = formData.orgName || body.orgName;
    const inviteEmails = formData.inviteEmails || body.inviteEmails || [];
    const goals = formData.goals || body.goals || [];

    // Store onboarding preferences before completing
    const onboardingData = {
      ...(org.onboardingData as any || {}),
      businessType,
      orgName,
      inviteEmails: Array.isArray(inviteEmails) ? inviteEmails : [],
      goals: Array.isArray(goals) ? goals : [],
      path: body.path,
      userName: user?.firstName || user?.email,
    };

    try {
      await storage.updateOrganization(org.id, {
        onboardingData,
        ...(businessType ? { businessType } : {}),
      });
    } catch (updateErr: any) {
      logger.warn("Non-fatal: failed to save onboarding data", { error: updateErr.message });
    }

    // Safety-net persona write. The client also PUTs /api/me/persona at
    // step 0; this catches the case where that call failed (offline,
    // 401-recovery race, etc.) and the user is now closing out the
    // wizard with users.persona still on its "land_investor" default.
    // No-op when the current value already matches the derived one.
    if (user?.id && businessType) {
      try {
        const investorType = formData.investorType || body.investorType;
        const persona = derivePersona(businessType, investorType);
        await db
          .update(users)
          .set({ persona, updatedAt: new Date() })
          .where(eq(users.id, user.id));
      } catch (personaErr: any) {
        logger.warn("Non-fatal: failed to derive/persist persona", { error: personaErr.message });
      }
    }

    await onboardingService.completeOnboarding(org.id);
    res.json({ success: true });
  } catch (err) {
    Errors.badRequest(res, err instanceof Error ? err.message : "Bad request");
  }
});

router.get("/status", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const org = req.organization;
    const status = await onboardingService.getOnboardingStatus(org.id);
    res.json(status);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/skip", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    // onboardingService has no skipOnboarding; skipping marks onboarding
    // complete for the org (org-scoped onboarding state).
    await onboardingService.completeOnboarding(org.id);
    res.json({ skipped: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// TODO(tsc): onboardingService has no getChecklist/completeChecklistItem
// methods. The checklist-status endpoint below computes checklist completion
// directly. These endpoints return 501 until per-item checklist mutation is
// implemented on the service.
router.get("/checklist", async (_req: Request, res: Response) => {
  res.status(501).json({ error: "Checklist endpoint not implemented" });
});

router.post("/checklist/:item", async (_req: Request, res: Response) => {
  res.status(501).json({ error: "Checklist item endpoint not implemented" });
});

// ============================================================================
// Checklist status — single endpoint for the GettingStartedChecklist component
// Returns completion state of all 5 onboarding items
// ============================================================================
router.get("/checklist-status", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const orgId = org?.id;
    if (!orgId) {
      return Errors.unauthorized(res);
    }

    const { db } = await import("./storage");
    const { leads, campaigns, deals, payments } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");

    const [leadResult, importResult, campaignResult, dealResult, notePaymentResult] = await Promise.all([
      // hasLead: org has >= 1 lead
      db.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.organizationId, orgId)).then(r => r[0]?.count > 0),
      // hasImport: any lead with source = 'csv_import' or 'import'
      db.select({ count: sql<number>`count(*)` }).from(leads).where(
        sql`${leads.organizationId} = ${orgId} AND (${leads.source} = 'csv_import' OR ${leads.source} = 'import')`
      ).then(r => r[0]?.count > 0),
      // hasCampaign: org has >= 1 campaign
      db.select({ count: sql<number>`count(*)` }).from(campaigns).where(eq(campaigns.organizationId, orgId)).then(r => r[0]?.count > 0),
      // hasDeal: org has >= 1 deal
      db.select({ count: sql<number>`count(*)` }).from(deals).where(eq(deals.organizationId, orgId)).then(r => r[0]?.count > 0),
      // hasNotePayment: org has >= 1 payment recorded
      db.select({ count: sql<number>`count(*)` }).from(payments)
        .where(eq(payments.organizationId, orgId))
        .then(r => r[0]?.count > 0),
    ]);

    res.json({
      hasLead: leadResult,
      hasImport: importResult,
      hasCampaign: campaignResult,
      hasDeal: dealResult,
      hasNotePayment: notePaymentResult,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// ============================================================================
// EPIC 9: Instant Deal Hunt — the onboarding "aha moment"
// Shows real motivated seller opportunities in user's target county in < 2 min
// ============================================================================
router.get("/instant-deal-hunt", async (req: Request, res: Response) => {
  try {
    const { county, state } = req.query;
    if (!county || !state) {
      return Errors.badRequest(res, "county and state are required");
    }

    const { computeSellerMotivationScore } = await import("./services/sellerMotivationEngine");
    const { db } = await import("./db");
    const { leads } = await import("@shared/schema");
    const { eq, and, desc } = await import("drizzle-orm");

    // Pull real leads for this state from the database.
    // TODO(tsc): the leads table has no `county` column, so county-level
    // filtering is not possible here — filtering by state only. A leads.county
    // column (or a property join) is needed for true county scoping.
    const countyLeads = await db
      .select()
      .from(leads)
      .where(eq(leads.state, String(state)))
      .orderBy(desc(leads.score))
      .limit(10);

    if (countyLeads.length > 0) {
      const opportunities = countyLeads.slice(0, 5).map((lead: any) => {
        const assessedValue = parseFloat(lead.assessedValue || "5000");
        const result = computeSellerMotivationScore({
          isTaxDelinquent: lead.taxDelinquent ?? false,
          isOutOfState: lead.ownerState ? lead.ownerState !== String(state) : false,
          ownershipYears: lead.ownershipYears || 8,
          assessedValue,
          estimatedCurrentValue: assessedValue * 1.5,
          lastSalePrice: assessedValue * 0.3,
          countyCompetitionLevel: "low",
        });
        const offerPrice = Math.round(assessedValue * (result.recommendedOfferPercent / 100));
        const resaleValue = Math.round(assessedValue * 0.8);
        return {
          county: String(county), state: String(state),
          ownerName: lead.ownerName || "Unknown Owner",
          acreage: parseFloat(lead.acreage || "5"),
          assessedValue,
          motivationScore: result.score, motivationGrade: result.grade,
          topSignal: result.topSignals[0] || "Delinquent property",
          estimatedOfferPrice: offerPrice, estimatedResaleValue: resaleValue,
          potentialProfit: resaleValue - offerPrice,
        };
      });
      return res.json({ opportunities, totalScanned: countyLeads.length, source: "live_database" });
    }

    // Illustrative sample based on county expert data
    const { TOP_LAND_COUNTIES } = await import("./jobs/countyAssessorIngest");
    const cfg = TOP_LAND_COUNTIES.find(
      (c: any) => c.county.toLowerCase() === String(county).toLowerCase() &&
                  c.state.toUpperCase() === String(state).toUpperCase()
    );
    const mp = cfg?.medianSalePrice || 8000;
    const aa = cfg?.avgAcreage || 10;
    res.json({
      opportunities: [
        { county: String(county), state: String(state), ownerName: "Multi-Heir Estate", acreage: aa * 1.5, assessedValue: mp * 1.2, motivationScore: 87, motivationGrade: "A", topSignal: "Inherited + tax delinquent + out-of-state heirs", estimatedOfferPrice: Math.round(mp * 0.28), estimatedResaleValue: Math.round(mp * 0.85), potentialProfit: Math.round(mp * 0.57) },
        { county: String(county), state: String(state), ownerName: "Out-of-State LLC", acreage: aa, assessedValue: mp, motivationScore: 74, motivationGrade: "B+", topSignal: "Corporate owner + 15yr tenure + no permits", estimatedOfferPrice: Math.round(mp * 0.32), estimatedResaleValue: Math.round(mp * 0.80), potentialProfit: Math.round(mp * 0.48) },
        { county: String(county), state: String(state), ownerName: "Tax Delinquent Owner", acreage: aa * 0.75, assessedValue: mp * 0.8, motivationScore: 68, motivationGrade: "B+", topSignal: "3 years delinquent — facing tax sale", estimatedOfferPrice: Math.round(mp * 0.24), estimatedResaleValue: Math.round(mp * 0.64), potentialProfit: Math.round(mp * 0.40) },
      ],
      totalScanned: 0, source: "county_intelligence",
    });
  } catch (err: any) {
    logger.error("[OnboardingDealHunt]", err);
    res.status(500).json({ error: err.message, opportunities: [], totalScanned: 0 });
  }
});

// Track onboarding-v2 step ENTRY (paired with the existing /progress endpoint
// which records step completion). Together, entered + completed events let
// the funnel compute per-step bail rate as orgs_with_entered_N MINUS
// orgs_with_completed_N. Pre-condition for the C.2 redesign revisit trigger
// "per-step telemetry shows >50% bail rate at a single step."
//
// Idempotent (first-occurrence wins) per the activation_events unique
// constraint. Safe to call from a useEffect that fires on every step change.
router.post("/step-entered", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { step, path } = req.body || {};
    if (typeof step !== "number" || step < 1) {
      res.json({ recorded: false, reason: "step must be a positive number" });
      return;
    }
    const { recordActivationEventAsync, onboardingStepEnteredEvent } = await import("./services/activation");
    const userId = (req.user as any)?.id || (req.user as any)?.id || null;
    recordActivationEventAsync({
      orgId: org.id,
      userId,
      eventName: onboardingStepEnteredEvent(step),
      eventValue: { step, ...(path ? { path } : {}) },
    });
    // Pillar E / E5 — mirror into the lifecycle firehose.
    try {
      const { recordLifecycleEvent } = await import("./services/lifecycleEvents");
      void recordLifecycleEvent({
        organizationId: org.id,
        userId,
        eventType: `onboarding.step_${step}_entered`,
        stage: "onboarding",
        metadata: { step, ...(path ? { path } : {}) },
        sourceTable: "organizations",
        sourceId: String(org.id),
      });
    } catch { /* non-fatal */ }
    res.json({ recorded: true, step });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Track onboarding-v2 path selection (the Wave 12 land/notes/both fork).
// Fires once on first path pick. Drives the C.2 revisit trigger #3:
// "any notes/both customer reports onboarding friction" — without this we
// can't even tell which orgs took which fork.
router.post("/path-selected", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { path } = req.body || {};
    if (typeof path !== "string" || !path) {
      res.json({ recorded: false, reason: "path must be a non-empty string" });
      return;
    }
    const { recordActivationEventAsync } = await import("./services/activation");
    const userId = (req.user as any)?.id || (req.user as any)?.id || null;
    recordActivationEventAsync({
      orgId: org.id,
      userId,
      eventName: "onboarding_path_selected",
      eventValue: { path },
    });
    res.json({ recorded: true, path });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Track onboarding v2 step progress
router.patch("/progress", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { step, ...stepData } = req.body;
    const { db } = await import("./db");
    const { organizations } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(organizations)
      .set({ onboardingStep: step || 0, onboardingData: { ...(org.onboardingData || {}), ...stepData }, updatedAt: new Date() } as any)
      .where(eq(organizations.id, org.id));

    // Phase 3 Week 14 — Activation telemetry. Each canonical step gets its
    // own first-occurrence event; subsequent visits are no-op'd by the
    // unique constraint. Step is 1-indexed against the wizard.
    if (typeof step === "number" && step > 0) {
      try {
        const { recordActivationEventAsync, onboardingStepCompletedEvent } = await import("./services/activation");
        const userId = (req.user as any)?.id || (req.user as any)?.id || null;
        recordActivationEventAsync({
          orgId: org.id,
          userId,
          eventName: onboardingStepCompletedEvent(step),
          eventValue: { step, stepData },
        });
        // Pillar E / E5 — mirror into the lifecycle firehose so cohort
        // retention + LTV endpoints see the engagement signal.
        const { recordLifecycleEvent } = await import("./services/lifecycleEvents");
        void recordLifecycleEvent({
          organizationId: org.id,
          userId,
          eventType: `onboarding.step_${step}_completed`,
          stage: "onboarding",
          metadata: { step, stepData },
          sourceTable: "organizations",
          sourceId: String(org.id),
        });
      } catch { /* non-fatal */ }
    }

    res.json({ saved: true, step });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
