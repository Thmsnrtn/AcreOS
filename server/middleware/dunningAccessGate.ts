/**
 * W4.4 (2026-07 audit) — dunning read-only gate.
 *
 * The dunning warning email has promised "Day 8-14: Limited access
 * (read-only for some features)" since it shipped, and DUNNING_STAGES has
 * carried an `accessLevel` map the whole time — but nothing ever ENFORCED
 * it: `dunningService.hasRestrictedAccess` had zero callers, so a
 * `restricted`-stage org retained full write access until the day-15
 * free-tier downgrade. A promise in a payment-pressure email that the
 * product doesn't keep is worse than no promise.
 *
 * Same shape as subscriptionPauseGate (delegated from getOrCreateOrg, the
 * single org chokepoint): reads always pass; mutations on business
 * surfaces 402 while `dunningStage` maps to a non-"full" accessLevel.
 * Everything a customer needs to FIX the payment stays open — billing,
 * subscription, auth, support — because the entire point of the gate is
 * to route them there.
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/request";
import { DUNNING_STAGES } from "@shared/schema";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";
import { pathIsExempt } from "./gateExemptions";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Non-GET endpoints that must stay reachable while restricted. */
export const DUNNING_GATE_EXEMPT_PREFIXES = [
  "/api/subscription/", // fix the payment / change plan
  "/api/billing/",      // portal / update card / invoices
  "/api/credits/",      // billing-adjacent
  "/api/auth/",         // session refresh / org switch
  "/api/webhook/",      // Stripe → us, never gated
  "/api/stripe/",       // Stripe surfaces
  "/api/founder/",      // founder surfaces never gated
  "/api/audit/export",  // right-to-access data export
  "/api/support/",      // contact / ticket
  "/api/health",        // liveness
];

export function dunningAccessGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Read-only means reads WORK. Only mutations are gated.
  if (!MUTATING_METHODS.has(req.method)) return next();

  const path = req.path || req.url || "";
  if (pathIsExempt(path, DUNNING_GATE_EXEMPT_PREFIXES)) return next();

  const org = (req as AuthenticatedRequest).organization;
  if (!org) return next(); // pre-org request — auth handler will reject
  if ((req as AuthenticatedRequest).isFounder) return next();

  // Only the "restricted" window gates here — exactly what the day-8 email
  // promises. "suspended"/"cancelled" are handled by the existing day-15
  // free-tier downgrade (and "cancelled" is ALSO set on voluntary cancels,
  // which downgrade to free and must keep working within free limits — an
  // accessLevel:"none" block here would brick them).
  const stage = (org.dunningStage ?? "none") as keyof typeof DUNNING_STAGES;
  const stageConfig = DUNNING_STAGES[stage];
  if (!stageConfig || stage !== "restricted" || stageConfig.accessLevel === "full") return next();

  logger.info(
    `[dunning-gate] org=${org.id} blocked ${req.method} ${path} (stage=${stage}, accessLevel=${stageConfig.accessLevel})`,
  );

  Errors.paymentRequired(
    res,
    "Your account is read-only while a payment is past due. Update your payment method in Settings → Billing to restore full access — your data is untouched.",
    { reason: "dunning_restricted", dunningStage: stage, billingUrl: "/settings#billing" },
  );
}
