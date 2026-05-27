/**
 * Customer letter routes — user-facing (not founder-facing).
 * Mounted at /api/my-letter with isAuthenticated + getOrCreateOrg
 * middleware, so every handler gets req.organization already resolved.
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";

const router = Router();

// Current letter for the caller's org.
router.get("/current", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return Errors.unauthorized(res);
    const { getCustomerLetter } = await import("./services/customerNarrative");
    const letter = await getCustomerLetter(org.id);
    res.json({ letter });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Specific month.
router.get("/month/:monthKey", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return Errors.unauthorized(res);
    const { getCustomerLetter } = await import("./services/customerNarrative");
    const letter = await getCustomerLetter(org.id, req.params.monthKey);
    if (!letter) return Errors.notFound(res, "letter");
    res.json({ letter });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Archive.
router.get("/archive", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return Errors.unauthorized(res);
    const { listCustomerLetterArchive } = await import("./services/customerNarrative");
    const letters = await listCustomerLetterArchive(org.id);
    res.json({ letters });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Generate on demand (useful the first time; cron handles monthly going forward).
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return Errors.unauthorized(res);
    const { generateCustomerLetter } = await import("./services/customerNarrative");
    const result = await generateCustomerLetter(org.id, req.body?.monthKey);
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Email-deliver the current letter on demand. Useful if auto-delivery
// was disabled or the customer never received it.
router.post("/:monthKey/deliver", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return Errors.unauthorized(res);
    const { deliverCustomerLetter } = await import("./services/customerNarrative");
    const result = await deliverCustomerLetter(org.id, req.params.monthKey);
    res.json(result);
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Mark current letter as opened.
router.post("/:monthKey/opened", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return Errors.unauthorized(res);
    const { markCustomerLetterOpened } = await import("./services/customerNarrative");
    await markCustomerLetterOpened(org.id, req.params.monthKey);
    res.json({ ok: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
