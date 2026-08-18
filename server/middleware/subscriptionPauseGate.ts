/**
 * Tahoe E11 — subscription-pause mutation gate.
 *
 * When the org has elected a 30/60/90-day pause via the cancellation
 * dialog's 4th rung, AcreOS becomes read-only: existing data viewable but
 * no new actions allowed (no new mail, no new comps, no Pax messages).
 * Stripe handles billing-side pause via `subscription.pause_collection`;
 * this middleware handles the API-side gate.
 *
 * Returns HTTP 402 ("Payment Required") with `{ error: "subscription_paused",
 * subscriptionPauseEndsAt }` so the customer banner can render the
 * remaining-days countdown without an extra round-trip.
 *
 * Reads, billing routes, and a small set of resume-the-pause routes are
 * exempt (those are listed in PAUSE_GATE_EXEMPT_PATHS below). The exempt
 * list is intentionally narrow — auto-resume happens via Stripe webhook
 * and the resumeExpiredPauses worker; we don't need a customer-facing
 * "resume now" endpoint inside the paused state.
 *
 * Honesty: the middleware reads the org from req.organization (set by
 * getOrCreateOrg). If the org isn't present yet (e.g. the request is
 * pre-org), the middleware no-ops — downstream auth handlers will reject
 * appropriately.
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/request";
import { logger } from "../utils/logger";
import { orgActRefusal } from "../services/orgOperating";

/**
 * Routes that remain reachable while paused. Reads (GET) are always
 * allowed; this list captures non-GET endpoints that must stay open
 * (billing portal access, resume flow, support-contact, audit log
 * exports). The match is a startsWith — order matters only for clarity.
 */
const PAUSE_GATE_EXEMPT_PREFIXES = [
  "/api/subscription/",       // resume / cancel / reactivate / refund
  "/api/billing/",            // portal / invoices
  "/api/credits/",            // billing-adjacent reads + buys
  "/api/auth/",               // session refresh
  "/api/webhook/",            // Stripe → us, never gated
  "/api/founder/",            // founder dashboard never gated
  "/api/audit/export",        // user data export (right to access)
  "/api/support/",            // contact / ticket
  "/api/health",              // liveness
];

/**
 * Methods that mutate. PATCH is included; we also gate PATCH because some
 * routes use it for "create-if-missing" semantics.
 */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function subscriptionPauseGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Reads are always allowed. The pause posture is "read-only AcreOS,"
  // not "no access."
  if (!MUTATING_METHODS.has(req.method)) return next();

  // Exempt the small allow-list of routes that must stay reachable
  // (resume, billing portal, support, etc.).
  const path = req.path || req.url || "";
  for (const prefix of PAUSE_GATE_EXEMPT_PREFIXES) {
    if (path.startsWith(prefix)) return next();
  }

  const org = (req as AuthenticatedRequest).organization;
  if (!org) return next(); // pre-org request — auth handler will reject

  // ONE PREDICATE, shared with every background job that acts for a customer.
  //
  // This decision used to live only here, in the HTTP path — and the HTTP path
  // is chained from the session chokepoint in getOrCreateOrg, which a cron by
  // construction never traverses. So the gate promised "no new actions allowed
  // (no new mail, no new comps, no Pax messages)" while fifteen background
  // queries selected on `subscriptionStatus = 'active'` alone and kept acting.
  // The elapsed-window allowance below moved into `orgActRefusal` with it, so
  // the jobs read a closed pause the same way this gate always has.
  if (orgActRefusal(org) !== "subscription_paused") return next();

  logger.info(
    `[pause-gate] org=${org.id} blocked ${req.method} ${path} (paused until ${
      org.subscriptionPauseEndsAt ?? "?"
    })`,
  );

  res.status(402).json({
    error: "subscription_paused",
    message:
      "Your subscription is paused. Resume anytime from Settings → Billing to take new actions.",
    subscriptionPauseEndsAt: org.subscriptionPauseEndsAt ?? null,
    statusCode: 402,
  });
}
