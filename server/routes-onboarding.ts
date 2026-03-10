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

export default router;
