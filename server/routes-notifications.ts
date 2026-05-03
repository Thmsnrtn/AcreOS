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
import { auditFromRequest, AuditActions } from "./utils/auditLog";

const router = Router();

// Get user's notification preferences
router.get("/preferences", isAuthenticated, getOrCreateOrg, async (req, res) => {
  const user = req.user;
  const org = req.organization;
  const prefs = await notificationPrefsService.getPreferences(String(user.id), org.id);
  res.json(prefs);
});

// Update preferences
router.put("/preferences", isAuthenticated, getOrCreateOrg, async (req, res) => {
  const user = req.user;
  const org = req.organization;
  const updated = await notificationPrefsService.updatePreferences(String(user.id), org.id, req.body);
  // Phase 3 Week 11 — settings change must land in audit_events.
  await auditFromRequest(req, {
    action: AuditActions.SETTINGS_NOTIFICATION_PREFS_CHANGED,
    target: { type: "settings", id: String(user.id) },
    metadata: { organizationId: org.id, changedKeys: Object.keys(req.body ?? {}) },
  });
  res.json(updated);
});

// Get notification event schema
router.get("/preferences/schema", isAuthenticated, (_req, res) => {
  res.json(notificationPrefsService.getSchema());
});

export default router;
