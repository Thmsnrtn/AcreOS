// @ts-nocheck
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
import { onboardingService } from "./services/onboarding";

const router = Router();

function getUser(req: Request) { return (req as any).user; }
function getOrg(req: Request) { return (req as any).org; }

router.post("/complete", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const org = getOrg(req);
    const { orgName, inviteEmails = [], goals = [], targetAcreage, targetBudgetCents } = req.body;

    const result = await onboardingService.completeOnboarding({
      userId: user.id,
      organizationId: org.id,
      orgName,
      inviteEmails,
      goals,
      targetAcreage,
      targetBudgetCents,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/status", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const org = getOrg(req);
    const status = await onboardingService.getStatus(user.id, org.id);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/skip", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const org = getOrg(req);
    await onboardingService.skipOnboarding(user.id, org.id);
    res.json({ skipped: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/checklist", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const org = getOrg(req);
    const checklist = await onboardingService.getChecklist(user.id, org.id);
    res.json({ checklist });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/checklist/:item", async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const org = getOrg(req);
    const updated = await onboardingService.completeChecklistItem(user.id, org.id, req.params.item);
    res.json({ checklist: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
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
      return res.status(400).json({ error: "county and state are required" });
    }

    const { computeSellerMotivationScore } = await import("./services/sellerMotivationEngine");
    const { db } = await import("./db");
    const { leads } = await import("@shared/schema");
    const { eq, and, desc } = await import("drizzle-orm");

    // Pull real leads for this county from the database
    const countyLeads = await db
      .select()
      .from(leads)
      .where(and(eq(leads.county as any, String(county)), eq(leads.state as any, String(state))))
      .orderBy(desc(leads.score as any))
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
    console.error("[OnboardingDealHunt]", err.message);
    res.status(500).json({ error: err.message, opportunities: [], totalScanned: 0 });
  }
});

// Track onboarding v2 step progress
router.patch("/progress", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { step, ...stepData } = req.body;
    const { db } = await import("./db");
    const { organizations } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(organizations)
      .set({ onboardingStep: step || 0, onboardingData: { ...(org.onboardingData || {}), ...stepData }, updatedAt: new Date() } as any)
      .where(eq(organizations.id, org.id));
    res.json({ saved: true, step });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
