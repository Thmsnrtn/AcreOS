/**
 * T151 — Portfolio Health Routes
 *
 * POST /api/portfolio-health/run   — run health check job and generate alerts
 * GET  /api/portfolio-health/alerts — get active (non-dismissed) portfolio alerts
 * DELETE /api/portfolio-health/alerts/:id — dismiss an alert
 */

import { Router, type Request, type Response } from "express";
import { Errors } from "./utils/errors";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { runPortfolioHealthJob, getActiveAlerts, dismissAlert } from "./services/portfolioHealth";

const router = Router();


// Run portfolio health scan for the organization
router.post("/run", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    await runPortfolioHealthJob(org.id);
    const alerts = await getActiveAlerts(org.id);
    res.json({ success: true, alertsGenerated: alerts.length, alerts });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Get active portfolio health alerts
router.get("/alerts", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const alerts = await getActiveAlerts(org.id);
    res.json({ alerts });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Dismiss an alert
router.delete("/alerts/:id", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return res.status(400).json({ error: "Invalid alert id" });

    await dismissAlert(org.id, alertId);
    res.json({ success: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
