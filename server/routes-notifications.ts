/**
 * T113 — Notification Preferences Routes
 *
 * GET  /api/notifications/preferences         — get user preferences
 * PUT  /api/notifications/preferences         — update preferences
 * GET  /api/notifications/preferences/schema  — event schema (categories + events)
 * GET  /api/notifications/digest-subscription — is the weekly digest on for me?
 * PUT  /api/notifications/digest-subscription — opt in / out of the weekly digest
 */

import { Router } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { notificationPrefsService } from "./services/notificationPreferences";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import { digestService } from "./services/digest";
import { Errors } from "./utils/errors";
import { getUserId, getOrganizationId, type AuthenticatedRequest } from "./types/request";

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

// Weekly digest opt-in. Backed by digest_subscriptions — the table the weekly
// digest job actually reads (the `weeklyDigest` field on /preferences is not
// consulted by the job). Opt-in only: no row exists until the user turns it on.
router.get("/digest-subscription", isAuthenticated, getOrCreateOrg, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const sub = await digestService.getSubscription(getUserId(authReq), getOrganizationId(authReq));
    res.json({ enabled: digestService.isWeeklyDigestOn(sub) });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.put("/digest-subscription", isAuthenticated, getOrCreateOrg, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      return Errors.badRequest(res, "enabled must be true or false");
    }
    const userId = getUserId(authReq);
    const organizationId = getOrganizationId(authReq);
    const sub = await digestService.setWeeklyDigest(userId, organizationId, enabled);
    await auditFromRequest(req, {
      action: AuditActions.SETTINGS_NOTIFICATION_PREFS_CHANGED,
      target: { type: "settings", id: userId },
      metadata: { organizationId, changedKeys: ["weeklyDigestSubscription"], enabled },
    });
    res.json({ enabled: digestService.isWeeklyDigestOn(sub) });
  } catch (err) {
    Errors.internal(res, err);
  }
});

// Get notification event schema
router.get("/preferences/schema", isAuthenticated, (_req, res) => {
  res.json(notificationPrefsService.getSchema());
});

export default router;
