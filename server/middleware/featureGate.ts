/**
 * Server-side feature flag gate middleware.
 *
 * Uses the 5-state feature flag system (design-system §8) via
 * featureFlagService. Off / founder-only / beta / tier / on.
 *
 * Founders always bypass — they're operators provisioning flags. Enterprise
 * tier gets a soft bypass for legacy reseller / white-label routes that
 * existed before the port and are part of the enterprise contract.
 *
 * Usage:
 *   import { featureGate, requireFlag } from "./middleware/featureGate";
 *   app.use("/api/marketplace", featureGate("module.marketplace"), marketplaceRouter);
 *
 * `featureGate` is the legacy alias kept for back-compat; `requireFlag` is
 * the post-port name. Both are identical.
 */

import type { Request, Response, NextFunction } from "express";
import { featureFlagService, buildFlagContext } from "../services/featureFlags";
import { isFounderEmail } from "../services/founder";

export function requireFlag(flagKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Founder bypass — provision-time access while flags are being set up.
    const email = (req.user as any)?.email || (req.user as any)?.email;
    if (isFounderEmail(email)) return next();

    // Enterprise-tier orgs continue to bypass legacy reseller / white-label
    // routes (kept for back-compat with the original featureGate). Future
    // flags should not rely on this — set state to "tier:scale" or similar.
    const tier = (req.organization as any)?.subscriptionTier;
    if (tier === "enterprise") return next();

    try {
      const ctx = buildFlagContext(req);
      // Prime isFounder if email matched but the request lacks organization.
      if (!ctx.isFounder && isFounderEmail(ctx.email)) ctx.isFounder = true;
      const enabled = await featureFlagService.isEnabled(flagKey, ctx);
      if (enabled) return next();
      return res.status(404).json({ message: "Feature not available" });
    } catch {
      // DB unavailable — fail open to avoid breaking the app during initial
      // setup (mirrors the original behavior). Production should not hit
      // this path.
      return next();
    }
  };
}

/** Legacy alias — pre-port code uses this name. */
export const featureGate = requireFlag;
