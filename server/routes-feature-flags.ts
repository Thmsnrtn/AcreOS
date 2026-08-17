/**
 * /api/feature-flags — design-system §8 feature flag API.
 *
 * GET    /api/feature-flags                      → list of { key, state, enabled }
 *                                                  resolved for the requesting user
 *                                                  (per-user evaluation; not the raw table)
 * GET    /api/feature-flags/admin                → full table (founder only)
 * PATCH  /api/feature-flags/admin/:key           → update state / audience (founder only)
 *
 * Read endpoint is intentionally lean — clients only need to know which
 * flags are on for them. Audience details, change history etc. live on the
 * admin endpoint behind the founder check.
 */

import { Router, type Response } from "express";
import { z } from "zod";
import {
  featureFlagService,
  buildFlagContext,
  RetiredFeatureFlagError,
} from "./services/featureFlags";
import { FEATURE_FLAG_STATES, type FeatureFlagState } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const all = await featureFlagService.getAll();
    const ctx = buildFlagContext(req);
    const resolved = all.map((flag) => ({
      key: flag.key,
      state: flag.state,
      enabled: (() => {
        // Inline evaluation against ctx without importing evaluateFlag here
        // so the response is decoupled from internal helpers.
        switch (flag.state) {
          case "on": return true;
          case "off": return false;
          case "founder-only": return !!ctx.isFounder;
          case "beta":
            return !!ctx.isFounder ||
              !!(ctx.userId && (flag.audience.betaUserIds ?? []).includes(ctx.userId));
          case "tier:free":
          case "tier:starter":
          case "tier:pro":
          case "tier:scale":
            return !!ctx.isFounder || ctx.tier === flag.state.split(":")[1];
          default:
            return false;
        }
      })(),
    }));
    res.json(resolved);
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.get("/admin", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = buildFlagContext(req);
    if (!ctx.isFounder) return Errors.forbidden(res, "Founder access required");
    const all = await featureFlagService.getAll();
    res.json(all);
  } catch (error) {
    Errors.internal(res, error);
  }
});

const adminPatchSchema = z.object({
  state: z.enum(FEATURE_FLAG_STATES).optional(),
  audience: z.object({
    betaUserIds: z.array(z.string()).max(10000).optional(),
  }).strict().optional(),
  enabled: z.boolean().optional(),
}).strict();

router.patch("/admin/:key", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ctx = buildFlagContext(req);
    if (!ctx.isFounder) return Errors.forbidden(res, "Founder access required");

    const parsed = adminPatchSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    const update = parsed.data;
    if (Object.keys(update).length === 0) return Errors.badRequest(res, "Empty flag update");

    const updated = await featureFlagService.setFlag(req.params.key, update as Partial<{
      state: FeatureFlagState;
      audience: { betaUserIds?: string[] };
      enabled: boolean;
    }>, ctx.userId);
    if (!updated) return Errors.notFound(res, "Feature flag");

    logger.info("Feature flag updated", {
      key: req.params.key,
      changedBy: ctx.userId,
      newState: updated.state,
    });
    res.json(updated);
  } catch (error) {
    // A flag whose subsystem is deleted answers 404, not 500 and not 200. 404
    // is the same answer `getByKey` gives for it, and it is the truth: as far
    // as this system is concerned the flag is not there.
    if (error instanceof RetiredFeatureFlagError) {
      return Errors.notFound(res, "Feature flag");
    }
    Errors.internal(res, error);
  }
});

export default router;
