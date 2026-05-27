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
import { Errors } from "./utils/errors";

const router = Router();


function getUser(req: Request) {
  return req.user;
}

// Get all active alerts for the organization
router.get("/alerts", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const filters: any = {};
    if (req.query.severity) filters.severity = req.query.severity;
    if (req.query.alertType) filters.alertType = req.query.alertType;
    if (req.query.propertyId) filters.propertyId = parseInt(req.query.propertyId as string);
    const alerts = await portfolioSentinelService.getActiveAlerts(org.id, filters);
    res.json({ alerts });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Alert summary narrative
router.get("/alerts/summary", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const summary = await portfolioSentinelService.generateAlertSummary(org.id);
    res.json({ summary });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Monitor a single property
router.get("/property/:id", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const result = await portfolioSentinelService.monitorProperty(org.id, propertyId);
    res.json({ result });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Get alerts for a specific property
router.get("/property/:id/alerts", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const propertyId = parseInt(req.params.id);
    if (isNaN(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const alerts = await portfolioSentinelService.getPropertyAlerts(org.id, propertyId);
    res.json({ alerts });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Run full portfolio monitor
router.post("/monitor", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const results = await portfolioSentinelService.monitorPortfolio(org.id);
    res.json({ results });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Acknowledge an alert
router.patch("/alerts/:id/ack", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const user = getUser(req);
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return Errors.badRequest(res, "Invalid alert ID");
    const alert = await portfolioSentinelService.acknowledgeAlert(alertId, user.id);
    if (!alert) return Errors.notFound(res, "Alert");
    res.json({ alert });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Resolve an alert
router.patch("/alerts/:id/resolve", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return Errors.badRequest(res, "Invalid alert ID");
    const { resolution } = req.body;
    if (!resolution) return Errors.badRequest(res, "resolution is required");
    const alert = await portfolioSentinelService.resolveAlert(alertId, resolution);
    if (!alert) return Errors.notFound(res, "Alert");
    res.json({ alert });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Dismiss an alert
router.patch("/alerts/:id/dismiss", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return Errors.badRequest(res, "Invalid alert ID");
    const alert = await portfolioSentinelService.dismissAlert(alertId);
    if (!alert) return Errors.notFound(res, "Alert");
    res.json({ alert });
  } catch (err: any) {
    Errors.badRequest(res, err.message ?? "Bad request");
  }
});

// Get suggested actions for an alert
router.get("/alerts/:id/suggest", isAuthenticated, getOrCreateOrg, async (req: Request, res: Response) => {
  try {
    const alertId = parseInt(req.params.id);
    if (isNaN(alertId)) return Errors.badRequest(res, "Invalid alert ID");
    const suggestions = await portfolioSentinelService.suggestActions(alertId);
    res.json({ suggestions });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
