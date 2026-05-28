/**
 * GET /api/me/needs-onboarding — single canonical answer to "should this
 * user be force-routed through /onboarding-v2 before they see /today?"
 *
 * History: W5-7 shipped a client-side gate that consulted multiple legacy
 * completion signals because pre-W5-7 onboarding wrote state into three
 * different places. Migration 0098 backfilled the canonical column so the
 * client doesn't have to OR signals anymore — but we keep this endpoint
 * (rather than letting the client read `/api/organization` directly) so:
 *   1. The decision is centralized and testable on the server
 *   2. Future signals (e.g. "user accepted TOS v2") can be added without
 *      a client-side gate refactor
 *   3. The endpoint is cheap + cacheable — 60s staleTime on the client
 *      means the org-table read happens once per minute per session
 *
 * Returns: { needsOnboarding: boolean }
 *
 * Founders always get `false` — the persona-architecture rule. The client
 * mirrors this check via useAuth().isFounder, but the server enforces it
 * here so a client bug can't trick a founder into the customer wizard.
 */

import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { organizations } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { Errors } from "./utils/errors";

const router = Router();

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Founder bypass — enforced server-side so a client bug can't
    // force-onboard a founder.
    if (req.isFounder) {
      return res.json({ needsOnboarding: false });
    }

    const orgId = getOrganizationId(req);
    const [row] = await db
      .select({
        onboardingCompleted: organizations.onboardingCompleted,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    // Defensive default: if we can't find the org row, render the app
    // (don't force-redirect into a wizard a user might be unable to
    // complete from a broken state).
    if (!row) {
      return res.json({ needsOnboarding: false });
    }

    return res.json({ needsOnboarding: row.onboardingCompleted !== true });
  } catch (error) {
    return Errors.internal(res, error);
  }
});

export default router;
