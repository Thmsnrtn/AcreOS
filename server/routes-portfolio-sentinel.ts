/**
 * T143 — Portfolio Sentinel Routes
 *
 * GET  /api/portfolio-sentinel/alerts              — all active alerts
 * GET  /api/portfolio-sentinel/alerts/summary      — alert summary narrative
 * GET  /api/portfolio-sentinel/property/:id        — monitor single property
 * GET  /api/portfolio-sentinel/property/:id/alerts — alerts for a property
 * POST /api/portfolio-sentinel/monitor             — run full portfolio monitor
 * PATCH /api/portfolio-sentinel/alerts/:id/ack     — acknowledge alert
 * PATCH /api/portfolio-sentinel/alerts/:id/resolve — resolve alert
 * PATCH /api/portfolio-sentinel/alerts/:id/dismiss — dismiss alert
 * GET  /api/portfolio-sentinel/alerts/:id/suggest  — suggested actions for alert
 */

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { portfolioSentinelService } from "./services/portfolioSentinel";

const router = Router();

function getOrg(req: Request) {
  const org = (req as any).organization;
  if (!org) throw new Error("Organization not found");
  return org;
}

function getUser(req: Request) {
  return (req as any).user;
}

// Get all active alerts for the organization
router.get("/alerts", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const filters: any = {};
    if (req.query.severity) filters.severity = req.query.severity;
    if (req.query.alertType) filters.alertType = req.query.alertType;
    if (req.query.propertyId) filters.propertyId = parseInt(req.query.propertyId as string);
    const alerts = await portfolioSentinelService.getActiveAlerts(org.id, filters);
    res.json({ alerts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Alert summary narrative
router.get("/alerts/summary", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const summary = await portfolioSentinelService.generateAlertSummary(org.id);
    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Monitor a single property
router.get("/property/:id", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const result = await portfolioSentinelService.monitorProperty(org.id, propertyId);
    res.json({ result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get alerts for a specific property
router.get("/property/:id/alerts", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return res.status(400).json({ error: "Invalid property ID" });
    const alerts = await portfolioSentinelService.getPropertyAlerts(org.id, propertyId);
    res.json({ alerts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run full portfolio monitor
router.post("/monitor", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const results = await portfolioSentinelService.monitorPortfolio(org.id);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Acknowledge an alert
router.patch("/alerts/:id/ack", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return res.status(400).json({ error: "Invalid alert ID" });
    const alert = await portfolioSentinelService.acknowledgeAlert(alertId, user.id);
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json({ alert });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Resolve an alert
router.patch("/alerts/:id/resolve", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return res.status(400).json({ error: "Invalid alert ID" });
    const { resolution } = req.body;
    if (!resolution) return res.status(400).json({ error: "resolution is required" });
    const alert = await portfolioSentinelService.resolveAlert(alertId, resolution);
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json({ alert });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Dismiss an alert
router.patch("/alerts/:id/dismiss", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return res.status(400).json({ error: "Invalid alert ID" });
    const alert = await portfolioSentinelService.dismissAlert(alertId);
    if (!alert) return res.status(404).json({ error: "Alert not found" });
    res.json({ alert });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Get suggested actions for an alert
router.get("/alerts/:id/suggest", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return res.status(400).json({ error: "Invalid alert ID" });
    const suggestions = await portfolioSentinelService.suggestActions(alertId);
    res.json({ suggestions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
