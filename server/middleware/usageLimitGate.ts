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

import type { Request, Response, NextFunction } from "express";
import { checkUsageLimit, type ResourceType } from "../services/usageLimits";

/**
 * Returns Express middleware that checks the organization's usage limit
 * for the given resource type. Returns 429 if the limit is exceeded.
 */
export function usageLimitGate(resourceType: ResourceType) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = (req as any).organizationId ?? (req as any).user?.organizationId;

      if (!organizationId) {
        return res.status(401).json({ error: "organization_required" });
      }

      const result = await checkUsageLimit(organizationId, resourceType);

      if (!result.allowed) {
        return res.status(429).json({
          error: "limit_exceeded",
          resourceType: result.resourceType,
          current: result.current,
          limit: result.limit,
          tier: result.tier,
          upgradeUrl: "/settings#billing",
        });
      }

      next();
    } catch (err) {
      console.error(`[usageLimitGate] Error checking ${resourceType} limit:`, err);
      // Fail open — don't block the request if the limit check itself errors
      next();
    }
  };
}
