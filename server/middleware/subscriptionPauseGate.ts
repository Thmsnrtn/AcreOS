/**
 * Tahoe E11 — subscription-pause mutation gate.
 *
 * When the org has elected a 30/60/90-day pause via the cancellation
 * dialog's 4th rung, AcreOS becomes read-only: existing data viewable but
 * no new business actions allowed (no new mail, no new comps, no Pax
 * messages, no new acquisitions).
 * Stripe handles billing-side pause via `subscription.pause_collection`;
 * this middleware handles the API-side gate.
 *
 * ONE CARVE-OUT — servicing continuations on notes the org already holds.
 * A hybrid org also services notes it owns. Recording a borrower payment,
 * quoting a payoff, or working a loss-mitigation case fulfils an obligation
 * to a borrower; it is not new business. Blocking those writes breaks live
 * servicing and produces the churn the pause exists to prevent. Those paths
 * (PAUSE_SERVICING_PATH_PATTERNS) stay writable while paused. Everything
 * else — acquiring or originating notes, splits, assignments, basis/yield
 * analytics, and the whole non-notes surface — still 402s.
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
import { pathIsExempt } from "./gateExemptions";

/**
 * Routes that remain reachable while paused. Reads (GET) are always
 * allowed; this list captures non-GET endpoints that must stay open
 * (billing portal access, resume flow, support-contact, audit log
 * exports). The match is a startsWith — order matters only for clarity.
 */
export const PAUSE_GATE_EXEMPT_PREFIXES = [
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
 * Mutating routes that SERVICE an existing note, as segment patterns.
 *
 * Containment rule (the reason this is not a prefix list): `/api/notes/` also
 * holds acquisition (`/api/notes/acquired`, `/from-deal/:dealId`), transfers
 * (`/:id/splits`, `/:id/assignments`) and acquisition analytics
 * (`/:id/basis`, `/:id/yield`), so a prefix would exempt them too. A pattern
 * matches only when the path has EXACTLY the pattern's segment count, every
 * literal segment is equal, and `:id` stands for one non-empty segment.
 * Each entry below is a verified mutating route (routes-notes.ts,
 * routes-note-workout.ts); GET-only candidates need no entry because reads
 * always pass.
 */
export const PAUSE_SERVICING_PATH_PATTERNS: readonly string[] = [
  "/api/notes/:id/payments",                    // POST — record a borrower payment
  "/api/notes/:id/payoff/quotes",               // POST — issue a payoff quote
  "/api/notes/:id/loss-mit-case",               // POST — open a case on a note already held (defaulted-note servicing)
  "/api/loss-mit-cases/:id",                    // PATCH — update an existing case
  "/api/loss-mit-cases/:id/actions",            // POST — log an action on an existing case
  "/api/notes/:id/workout-analyses",            // POST — workout analysis for a held note
];

/**
 * True when `path` is a servicing continuation. Query strings are ignored,
 * one trailing slash is tolerated, empty interior segments (`//`) never match.
 */
export function pathIsServicingContinuation(path: string): boolean {
  const clean = path.split("?")[0].replace(/\/+$/, "");
  const actual = clean.split("/");
  return PAUSE_SERVICING_PATH_PATTERNS.some((pattern) => {
    const want = pattern.split("/");
    if (want.length !== actual.length) return false;
    return want.every((seg, i) =>
      seg === ":id" ? actual[i] !== "" : seg === actual[i],
    );
  });
}

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
  if (pathIsExempt(path, PAUSE_GATE_EXEMPT_PREFIXES)) return next();

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

  // Servicing continuations on existing notes stay open (see header).
  if (pathIsServicingContinuation(path)) return next();

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
