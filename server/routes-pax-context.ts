/**
 * SERVER/ROUTES-PAX-CONTEXT.TS
 * ----------------------------------------------------------------------------
 * Phase D1 — endpoint that PaxContextStep posts to during onboarding to
 * capture the user's vertical / experience / goals / geography / displayed
 * name and persist via captureUserContext.
 *
 * Auth: isAuthenticated (no founder gate — every user can write their own
 * context). The endpoint NEVER lets one user write context for another;
 * userId is always taken from the authenticated session, never from
 * the request body.
 *
 * Privacy: per immutable §3 (data minimization), only the 5 declared
 * fields are persisted. Per immutable §8 (data deletion within 7 days),
 * the deletion endpoint hard-deletes the row.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  PAX_VERTICALS,
  PAX_EXPERIENCE_LEVELS,
  PAX_INVESTMENT_GOALS,
  type PaxVertical,
  type PaxExperienceLevel,
  type PaxInvestmentGoal,
} from "@shared/schema/pax-verticals";
import {
  captureUserContext,
  loadUserContext,
  setPersonalizationOptOut,
  deleteUserContext,
} from "./services/pax/userContext";

// ── Zod validation ──────────────────────────────────────────────────────

const captureBody = z.object({
  vertical: z.enum(PAX_VERTICALS).optional(),
  experienceLevel: z.enum(PAX_EXPERIENCE_LEVELS).optional(),
  investmentGoals: z.array(z.enum(PAX_INVESTMENT_GOALS)).max(6).optional(),
  geographicFocus: z.string().trim().max(200).optional(),
  displayedName: z.string().trim().max(80).optional(),
});

const optOutBody = z.object({
  optOut: z.boolean(),
});

// ── Route registration ──────────────────────────────────────────────────

export function registerPaxContextRoutes(app: Express): void {
  // POST /api/onboarding/pax-context — capture or update the user's
  // Pax context. PaxContextStep posts here on submit.
  app.post(
    "/api/onboarding/pax-context",
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.id;
      const organizationId = req.organizationId;
      if (!userId || !organizationId) {
        return Errors.unauthorized(res);
      }

      const parsed = captureBody.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }

      try {
        const ctx = await captureUserContext({
          userId,
          organizationId: String(organizationId),
          vertical: parsed.data.vertical as PaxVertical | undefined,
          experienceLevel: parsed.data.experienceLevel as PaxExperienceLevel | undefined,
          investmentGoals: parsed.data.investmentGoals as PaxInvestmentGoal[] | undefined,
          geographicFocus: parsed.data.geographicFocus,
          displayedName: parsed.data.displayedName,
        });

        if (!ctx) {
          // captureUserContext swallows DB errors + returns null per the
          // fire-and-forget contract. Surface as 500 here.
          return Errors.internal(res, new Error("Failed to persist Pax context"));
        }

        logger.info("[pax-context] captured", {
          metadata: {
            userId,
            organizationId,
            vertical: ctx.vertical ?? "(skipped)",
            experienceLevel: ctx.experienceLevel ?? "(skipped)",
            goalsCount: ctx.investmentGoals.length,
            hasGeo: Boolean(ctx.geographicFocus),
            hasName: Boolean(ctx.displayedName),
          },
        });

        return res.status(204).end();
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/onboarding/pax-context — read the current user's context
  // (used by Settings page to render the opt-out toggle + current values).
  app.get(
    "/api/onboarding/pax-context",
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.id;
      if (!userId) return Errors.unauthorized(res);

      try {
        const ctx = await loadUserContext(userId);
        return res.json({ context: ctx });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/onboarding/pax-context/opt-out — Settings toggle. When
  // optOut=true, Pax appendix falls back to default land_investing voice
  // (no personalization). The row stays so re-enabling restores prior context.
  app.post(
    "/api/onboarding/pax-context/opt-out",
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.id;
      if (!userId) return Errors.unauthorized(res);

      const parsed = optOutBody.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }

      try {
        await setPersonalizationOptOut(userId, parsed.data.optOut);
        return res.status(204).end();
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // DELETE /api/onboarding/pax-context — hard-delete the row per
  // immutable §8 (data deletion within 7 days). Distinct from opt-out.
  app.delete(
    "/api/onboarding/pax-context",
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user?.id;
      if (!userId) return Errors.unauthorized(res);

      try {
        await deleteUserContext(userId);
        return res.status(204).end();
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
