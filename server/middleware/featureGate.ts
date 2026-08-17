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
import { Errors } from "../utils/errors";

export function requireFlag(flagKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Founder bypass — provision-time access while flags are being set up.
    const email = req.user?.email || req.user?.email;
    if (isFounderEmail(email)) return next();

    // Enterprise-tier orgs continue to bypass legacy reseller / white-label
    // routes (kept for back-compat with the original featureGate). Future
    // flags should not rely on this — set state to "tier:scale" or similar.
    const tier = req.organization?.subscriptionTier;
    if (tier === "enterprise") return next();

    try {
      const ctx = buildFlagContext(req);
      // Prime isFounder if email matched but the request lacks organization.
      if (!ctx.isFounder && isFounderEmail(ctx.email)) ctx.isFounder = true;
      const enabled = await featureFlagService.isEnabled(flagKey, ctx);
      if (enabled) return next();
      return Errors.featureUnavailable(res);
    } catch {
      // DB unavailable — fail open to avoid breaking the app during initial
      // setup (mirrors the original behavior). Production should not hit
      // this path.
      return next();
    }
  };
}

/**
 * The strict variant, for gates that implement a FOUNDER DECISION rather than
 * a product feature flag.
 *
 * `requireFlag` above has two escape hatches that are reasonable for an
 * ordinary flag and wrong for a governance gate:
 *
 *   1. **The enterprise-tier bypass.** Its own comment calls it back-compat for
 *      legacy reseller / white-label routes. Applied to the marketplace it
 *      means a subscription tier silently overrides the approved expansion
 *      ladder ("no marketplace before ~25 customers") — a paid plan buying its
 *      way past a founder decision.
 *   2. **Failing OPEN when the flag store errors.** For a feature flag,
 *      staying usable through a blip is the kinder default. For an expansion
 *      gate it means a transient database error opens the marketplace.
 *
 * The founder bypass is deliberately KEPT: the founder must be able to look at
 * the surface they are deciding about.
 *
 * Enforced by `tests/unit/expansionLadder.test.ts`, which is also what turned
 * `expansion.marketplace-25-api-50` in the constitution registry from
 * `prose-only` into a real backstop.
 */
export function requireLadderFlag(flagKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const email = req.user?.email || req.user?.email;
    if (isFounderEmail(email)) return next();

    // NO enterprise-tier bypass here, on purpose. See the note above.

    try {
      const ctx = buildFlagContext(req);
      if (!ctx.isFounder && isFounderEmail(ctx.email)) ctx.isFounder = true;
      const enabled = await featureFlagService.isEnabled(flagKey, ctx);
      if (enabled) return next();
      return Errors.featureUnavailable(res);
    } catch {
      // FAIL CLOSED. An expansion gate that opens on an error is not a gate.
      return Errors.featureUnavailable(res);
    }
  };
}

/** Legacy alias — pre-port code uses this name. */
export const featureGate = requireFlag;
