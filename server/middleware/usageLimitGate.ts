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
  type UsageLimitResult,
} from "../services/usageLimits";
import { planLimitDetails } from "@shared/billing/plan-limit-copy";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";
import type { AuthenticatedRequest } from "../types/request";

/**
 * Send the plan-limit refusal for a `checkUsageLimit` result.
 *
 * Every route that checks a plan cap inline answers through this, so the
 * refusal is the same `PLAN_LIMIT_REACHED` envelope — code, message and
 * numbers from the canonical tier table — whether the gate middleware or the
 * handler caught it. `requested` is for bulk imports that would overshoot.
 */
export function refusePlanLimit(
  res: Response,
  result: UsageLimitResult,
  opts: { requested?: number } = {},
): void {
  Errors.planLimitReached(
    res,
    planLimitDetails({
      resourceType: result.resourceType,
      tier: result.tier,
      current: result.current,
      limit: result.limit,
      requested: opts.requested,
    }),
  );
}

/**
 * Returns Express middleware that checks the organization's usage limit
 * for the given resource type. Returns 429 `PLAN_LIMIT_REACHED` if the limit
 * is reached, with the `PlanLimitDetails` payload (shared/billing/plan-limit-copy.ts) —
 * numbers from the canonical tier table, never restated here.
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
        return refusePlanLimit(res, result);
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
 *  - under the tier's shared monthly AI allowance (`aiAllowanceCents`, in
 *    cents of customer-triggered AI spend — founder decision 2026-10-08):
 *    allowed (warning flag at ≥80%)
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
          unit: gate.unit,
          remaining: 0,
          byokAvailable: gate.byokAvailable,
          byokSettingsUrl: "/settings/byok",
          message: gate.byokAvailable
            ? "You've used this month's included AI. Add your own Anthropic, OpenRouter, or OpenAI key in Settings → Your provider keys to keep going without limits — your data and drafts stay fully accessible either way."
            : "You've used this month's included AI. Upgrade your plan to unlock bring-your-own-key for unlimited AI — your data and drafts stay fully accessible either way.",
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
