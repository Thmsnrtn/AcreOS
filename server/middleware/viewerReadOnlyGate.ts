/**
 * The viewer role, actually made read-only.
 *
 * `server/middleware/roleGuard.ts` has documented `viewer — read-only across the
 * CRM` since it was written. It was not. `canEditLeads`, `canEditProperties`,
 * `canEditDeals`, `canEditNotes` and every `canCreate*` are FALSE for `viewer`
 * and TRUE for every other role — and **none of them was enforced by any server
 * code on any path**. A viewer could create and edit leads, properties, deals
 * and notes across the whole CRM.
 *
 * SEVERITY, STATED HONESTLY: intra-org, not cross-tenant. Every route involved
 * is already org-scoped, so nothing crossed an organization boundary. What was
 * unenforced is the org owner's own configuration — the whole reason to invite
 * somebody as a viewer rather than a member.
 *
 * WHY A GATE AND NOT SIXTY `requirePermission` CALLS
 * --------------------------------------------------
 * The destructive-delete gaps found alongside this were fixed route by route,
 * because there were four of them and each names a specific permission. Read-only
 * is different in kind: it is a statement about a ROLE, not about a resource, and
 * the set of routes it covers is "every mutation that is not explicitly exempt."
 * Enforcing that on each route would mean touching sixty-plus handlers and would
 * leave the sixty-first open by default — which is exactly how the four
 * destructive routes came to be unguarded.
 *
 * **The polarity is the design.** A new write route is DENIED to viewers unless
 * someone deliberately exempts it. Every alternative fails open.
 *
 * WHERE IT RUNS
 * -------------
 * Chained from `getOrCreateOrg`, alongside `subscriptionPauseGate` and
 * `dunningAccessGate`. That module's own comment already names the reason:
 * getOrCreateOrg is the single chokepoint that sets `req.organization` across
 * every org-scoped route, and there is no global `/api` org middleware because
 * org is attached per-route. This reuses that established seam rather than
 * inventing a second one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not touch any other role. `member` and `va` keep every write they had;
 * their restrictions are the per-resource permissions and the assigned-leads
 * gate, which are enforced elsewhere. This gate answers one question only: is
 * this caller the read-only role?
 */

import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/request";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";
import { getUserPermissionContext } from "../utils/permissions";

/** Methods that mutate. Mirrors subscriptionPauseGate deliberately. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The only non-GET paths a viewer may reach.
 *
 * Deliberately tiny. Each entry is a write that is about the PERSON rather than
 * the organization's records — a viewer changing their own session or
 * preferences is not writing to the CRM, and denying it would make the role
 * unusable rather than read-only.
 *
 * A `startsWith` match, like the pause gate's list. Adding an entry is a
 * deliberate act and should come with a reason, because every entry is a hole in
 * a read-only guarantee.
 */
export const VIEWER_WRITE_EXEMPT_PREFIXES = [
  "/api/auth/", // session refresh / logout — not CRM state
  "/api/user/preferences", // their own UI preferences
  "/api/notifications/", // marking their OWN notifications read
  "/api/support/", // contacting support about what they can see
  "/api/audit/export", // right to access their data
] as const;

/**
 * Refuse CRM writes for the read-only role.
 *
 * Calls `next()` for every non-viewer, every read, and every exempt path. Only a
 * viewer attempting a non-exempt mutation is refused.
 *
 * IT RESOLVES THE ROLE ITSELF, which is the part that has to be right.
 * `req.permissionContext` is attached by `attachPermissionContext()` and
 * `requirePermission()`, both of which run PER-ROUTE and therefore AFTER this
 * chokepoint. Reading it here would find `undefined` on essentially every
 * request, the role would never equal "viewer", and the gate would pass
 * everything through while looking correct — the same fail-open shape as a
 * missing `attachPermissionContext()`.
 *
 * The resolved context is CACHED onto the request, so a later
 * `requirePermission` reuses it instead of reading the membership again. On
 * routes that already gate, this is net-neutral; on the rest it is one extra
 * read per MUTATING request, and reads are untouched.
 */
export async function viewerReadOnlyGate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!MUTATING_METHODS.has(req.method)) return next();

  const path = req.path || req.url || "";
  for (const prefix of VIEWER_WRITE_EXEMPT_PREFIXES) {
    if (path.startsWith(prefix)) return next();
  }

  const authed = req as AuthenticatedRequest;
  const user = authed.user;
  const org = authed.organization;
  // No user or no org yet: this request has not been authenticated or
  // provisioned, and the existing handlers reject it. Nothing to decide here.
  if (!user || !org) return next();

  let role: string | undefined;
  try {
    const context =
      authed.permissionContext ?? (await getUserPermissionContext(user, org)) ?? undefined;
    if (context) {
      // Cache it so requirePermission does not re-read the membership.
      authed.permissionContext = context;
      role = context.role;
    }
  } catch (err) {
    // FAIL CLOSED, and the trade is deliberate. If the membership cannot be
    // read we do not know whether this caller is read-only, and a security gate
    // that guesses is not a gate. The cost is that writes are refused during a
    // membership-store outage — but during such an outage the writes themselves
    // would be failing anyway, so refusing loses little and assuming loses the
    // guarantee. Logged as an error because a gate that starts refusing
    // everyone must be visible immediately.
    logger.error(
      `[viewer-read-only] could not resolve the role for ${req.method} ${path} — refusing`,
      err instanceof Error ? err : undefined,
    );
    Errors.forbidden(
      res,
      "We could not verify your access level just now. Please retry in a moment.",
    );
    return;
  }

  // A caller with no membership row is not this gate's problem — the route's own
  // authorization rejects them. Deciding here would duplicate that rule.
  if (role !== "viewer") return next();

  logger.warn(
    `[viewer-read-only] refused ${req.method} ${path} for a viewer in org ${org.id}`,
  );
  Errors.forbidden(
    res,
    "Your access is read-only. Ask an owner or admin to change your role if you need to make edits.",
  );
}
