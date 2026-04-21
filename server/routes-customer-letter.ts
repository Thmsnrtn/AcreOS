/**
 * Customer letter routes — user-facing (not founder-facing).
 * Mounted at /api/my-letter with isAuthenticated + getOrCreateOrg
 * middleware, so every handler gets req.organization already resolved.
 */

import { Router, type Request, type Response } from "express";

const router = Router();

// Current letter for the caller's org.
router.get("/current", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return res.status(401).json({ error: "No organization context" });
    const { getCustomerLetter } = await import("./services/customerNarrative");
    const letter = await getCustomerLetter(org.id);
    res.json({ letter });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Specific month.
router.get("/month/:monthKey", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return res.status(401).json({ error: "No organization context" });
    const { getCustomerLetter } = await import("./services/customerNarrative");
    const letter = await getCustomerLetter(org.id, req.params.monthKey);
    if (!letter) return res.status(404).json({ error: "No letter for that month" });
    res.json({ letter });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Archive.
router.get("/archive", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return res.status(401).json({ error: "No organization context" });
    const { listCustomerLetterArchive } = await import("./services/customerNarrative");
    const letters = await listCustomerLetterArchive(org.id);
    res.json({ letters });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate on demand (useful the first time; cron handles monthly going forward).
router.post("/generate", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return res.status(401).json({ error: "No organization context" });
    const { generateCustomerLetter } = await import("./services/customerNarrative");
    const result = await generateCustomerLetter(org.id, req.body?.monthKey);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Email-deliver the current letter on demand. Useful if auto-delivery
// was disabled or the customer never received it.
router.post("/:monthKey/deliver", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return res.status(401).json({ error: "No organization context" });
    const { deliverCustomerLetter } = await import("./services/customerNarrative");
    const result = await deliverCustomerLetter(org.id, req.params.monthKey);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mark current letter as opened.
router.post("/:monthKey/opened", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    if (!org) return res.status(401).json({ error: "No organization context" });
    const { markCustomerLetterOpened } = await import("./services/customerNarrative");
    await markCustomerLetterOpened(org.id, req.params.monthKey);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
