/**
 * Usage Limit Gate Middleware
 *
 * Factory function that returns Express middleware to enforce usage limits
 * based on the organization's subscription tier.
 *
 * Usage:
 *   import { usageLimitGate } from "../middleware/usageLimitGate";
 *
 *   router.post("/leads",
 *     isAuthenticated,
 *     usageLimitGate("leads"),
 *     handler
 *   );
 *
 * NOTE: Existing routes already have inline usage checks. This middleware
 * provides a cleaner pattern for future use — do NOT remove the inline checks.
 */

import type { Response, NextFunction } from "express";
import { checkUsageLimit, type ResourceType } from "../services/usageLimits";
import {
  TIER_LIMITS,
  nextPaidTier,
  type SubscriptionTier,
} from "@shared/billing/tier-limits";
import { TIER_PRICES_CENTS, type Tier } from "@shared/billing/tier-pricing";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";
import type { AuthenticatedRequest } from "../types/request";

/**
 * Shape of the `details` payload attached to every 429 `LIMIT_EXCEEDED`
 * response. Mirrored on the client so the upgrade toast / banner / modal
 * can render a real diff message ("Pro unlocks 500 leads vs. your 50 cap
 * at $49/mo") instead of generic "You've reached the plan limit" copy.
 *
 * The full `Tier` price object is intentionally NOT inlined — only the
 * monthly price cents — so we don't accidentally leak Stripe price IDs
 * through the public error envelope.
 */
export interface LimitExceededDetails {
  resourceType: ResourceType;
  currentTier: SubscriptionTier;
  currentCount: number;
  currentLimit: number | null;
  nextTier: SubscriptionTier | null;
  nextTierLimit: number | null;
  nextTierMonthlyPriceCents: number | null;
  upgradeUrl: string;
}

/**
 * Returns Express middleware that checks the organization's usage limit
 * for the given resource type. Returns 429 if the limit is exceeded with
 * the rich upsell payload described in {@link LimitExceededDetails}.
 */
export function usageLimitGate(resourceType: ResourceType) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.organizationId;

      if (!organizationId) {
        return Errors.unauthorized(res);
      }

      const result = await checkUsageLimit(organizationId, resourceType, {
        isFounder: req.isFounder,
      });

      if (!result.allowed) {
        const target = nextPaidTier(result.tier);
        const nextLimits = target ? TIER_LIMITS[target] : null;
        const nextPricing =
          target && target !== "free" && target !== "enterprise"
            ? TIER_PRICES_CENTS[target as Tier]
            : null;
        const upgradeUrl = target
          ? `/settings#billing?tier=${target}`
          : "/settings#billing";

        const details: LimitExceededDetails = {
          resourceType: result.resourceType,
          currentTier: result.tier,
          currentCount: result.current,
          currentLimit: result.limit,
          nextTier: target,
          nextTierLimit: nextLimits ? (nextLimits[resourceType] ?? null) : null,
          nextTierMonthlyPriceCents: nextPricing?.priceMonthlyCents ?? null,
          upgradeUrl,
        };

        return Errors.limitExceeded(res, details);
      }

      next();
    } catch (err) {
      logger.error(`[usageLimitGate] Error checking ${resourceType} limit`, err);
      // Fail open — don't block the request if the limit check itself errors
      next();
    }
  };
}
