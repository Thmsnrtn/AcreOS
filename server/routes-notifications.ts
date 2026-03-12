/**
 * T113 — Notification Preferences Routes
 *
 * GET  /api/notifications/preferences         — get user preferences
 * PUT  /api/notifications/preferences         — update preferences
 * GET  /api/notifications/preferences/schema  — event schema (categories + events)
 */

import { Router } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { notificationPrefsService } from "./services/notificationPreferences";

const router = Router();

// Get user's notification preferences
router.get("/preferences", isAuthenticated, getOrCreateOrg, (req, res) => {
  const user = (req as any).user;
  const org = (req as any).organization;
  const prefs = notificationPrefsService.getPreferences(String(user.id), org.id);
  res.json(prefs);
});

// Update preferences
router.put("/preferences", isAuthenticated, getOrCreateOrg, (req, res) => {
  const user = (req as any).user;
  const org = (req as any).organization;
  const updated = notificationPrefsService.updatePreferences(String(user.id), org.id, req.body);
  res.json(updated);
});

// Get notification event schema
router.get("/preferences/schema", isAuthenticated, (_req, res) => {
  res.json(notificationPrefsService.getSchema());
});

export default router;
