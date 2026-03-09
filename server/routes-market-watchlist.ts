/**
 * T117 — Market Watchlist Routes
 *
 * GET    /api/market/watchlist              — list watchlist entries
 * POST   /api/market/watchlist              — add to watchlist
 * PATCH  /api/market/watchlist/:id          — update entry
 * DELETE /api/market/watchlist/:id          — remove entry
 * GET    /api/market/watchlist/alerts       — recent alerts
 * POST   /api/market/watchlist/alerts/read  — mark as read
 * POST   /api/market/watchlist/:id/test     — test alert
 * GET    /api/market/watchlist/unread       — unread count
 */

import { Router } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { marketWatchlistService } from "./services/marketWatchlist";
import { z } from "zod";

const router = Router();

const addSchema = z.object({
  state: z.string().length(2),
  county: z.string().min(1).max(100),
  alertOnTaxDelinquent: z.boolean().optional(),
  alertOnPriceDrop: z.boolean().optional(),
  priceDropThresholdPct: z.number().min(1).max(50).optional(),
  alertOnDemandIncrease: z.boolean().optional(),
  demandScoreThreshold: z.number().min(1).max(100).optional(),
  alertOnForeclosure: z.boolean().optional(),
  emailAlert: z.boolean().optional(),
  pushAlert: z.boolean().optional(),
});

router.get("/", isAuthenticated, getOrCreateOrg, (req, res) => {
  const org = (req as any).organization;
  res.json(marketWatchlistService.getWatchlist(org.id));
});

router.post("/", isAuthenticated, getOrCreateOrg, (req, res) => {
  const org = (req as any).organization;
  const user = (req as any).user;
  try {
    const data = addSchema.parse(req.body);
    const entry = marketWatchlistService.addToWatchlist(org.id, String(user.id), data);
    res.status(201).json(entry);
  } catch (err: any) {
    if (err.errors) return res.status(400).json({ message: "Validation failed", errors: err.errors });
    res.status(500).json({ message: err.message });
  }
});

router.patch("/:id", isAuthenticated, getOrCreateOrg, (req, res) => {
  const org = (req as any).organization;
  const entry = marketWatchlistService.updateEntry(org.id, req.params.id, req.body);
  if (!entry) return res.status(404).json({ message: "Watchlist entry not found" });
  res.json(entry);
});

router.delete("/:id", isAuthenticated, getOrCreateOrg, (req, res) => {
  const org = (req as any).organization;
  const removed = marketWatchlistService.removeFromWatchlist(org.id, req.params.id);
  if (!removed) return res.status(404).json({ message: "Watchlist entry not found" });
  res.json({ success: true });
});

router.get("/alerts", isAuthenticated, getOrCreateOrg, (req, res) => {
  const org = (req as any).organization;
  const limit = parseInt((req.query.limit as string) || "50", 10);
  res.json(marketWatchlistService.getAlerts(org.id, limit));
});

router.post("/alerts/read", isAuthenticated, getOrCreateOrg, (req, res) => {
  const org = (req as any).organization;
  const { alertIds } = req.body;
  if (!Array.isArray(alertIds)) return res.status(400).json({ message: "alertIds must be an array" });
  marketWatchlistService.markAlertsRead(org.id, alertIds);
  res.json({ success: true });
});

router.get("/unread", isAuthenticated, getOrCreateOrg, (req, res) => {
  const org = (req as any).organization;
  res.json({ count: marketWatchlistService.getUnreadCount(org.id) });
});

router.post("/:id/test", isAuthenticated, getOrCreateOrg, (req, res) => {
  const org = (req as any).organization;
  const alert = marketWatchlistService.testAlert(org.id, req.params.id);
  if (!alert) return res.status(404).json({ message: "Watchlist entry not found" });
  res.json(alert);
});

export default router;
