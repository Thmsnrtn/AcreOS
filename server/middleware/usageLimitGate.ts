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
import {
  checkUsageLimit,
  checkAiTurnGate,
  type ResourceType,
  type AiTurnGateResult,
} from "../services/usageLimits";
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

/**
 * Tier 1I — Economics guardrail (2026-06-10 founder decision).
 *
 * Enforces the mandatory-BYOK-past-threshold model on AI chat turns:
 *  - founder orgs and orgs with an active AI BYOK key are never blocked
 *  - under the tier's `aiTurnsByokThreshold`: allowed (warning flag at ≥80%)
 *  - at/over threshold WITHOUT BYOK: 429 with `reason: "byok_required"` and
 *    a deep link to the BYOK settings surface — a structured, recoverable
 *    refusal, never a silent failure. Existing drafts/data stay readable
 *    (this gate only sits on turn-generating POST routes).
 *
 * The gate result is stashed in `res.locals.aiTurnGate` so downstream
 * handlers can skip platform-credit checks when `mode === "byok"`.
 *
 * Fail-open on gate errors (matches usageLimitGate): an internal error in
 * the threshold machinery must never take Pax down.
 */
export function aiByokThresholdGate() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        return Errors.unauthorized(res);
      }

      const gate: AiTurnGateResult = await checkAiTurnGate(organizationId, {
        isFounder: req.isFounder,
      });
      res.locals.aiTurnGate = gate;

      if (!gate.allowed) {
        return Errors.limitExceeded(res, {
          reason: "byok_required" as const,
          resourceType: "ai_requests" as const,
          currentTier: gate.tier,
          current: gate.current,
          threshold: gate.threshold,
          remaining: 0,
          byokAvailable: gate.byokAvailable,
          byokSettingsUrl: "/settings/byok",
          message: gate.byokAvailable
            ? "You've used this month's included Pax turns. Add your own Anthropic, OpenRouter, or OpenAI key in Settings → Your provider keys to keep chatting without limits — your data and drafts stay fully accessible either way."
            : "You've used this month's included Pax turns. Upgrade your plan to unlock bring-your-own-key for unlimited Pax — your data and drafts stay fully accessible either way.",
          upgradeUrl: "/settings#billing",
        });
      }

      next();
    } catch (err) {
      logger.error("[aiByokThresholdGate] Error checking AI turn threshold", err);
      // Fail open — never block Pax on a gate malfunction.
      next();
    }
  };
}
