/**
 * The assigned-leads gate — ONE owner for a rule that had drifted.
 *
 * The effective assigned-only flag (`resolveViewOnlyAssignedLeads` in
 * permissions.ts: the `va` role's default, or a per-member override an owner
 * sets deliberately) means what it says: that person may see and act on the
 * leads assigned to them, and no others. By-id READS are held to the same rule
 * at the `getOrCreateOrg` chokepoint (middleware/assignedLeadScopeGate.ts).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The rule was enforced in five places across three files, each with its own
 * hand-written copy — and it was MISSING from four lead write paths:
 * `DELETE /api/leads/:id`, `PATCH /api/leads/:id/restore`,
 * `POST /api/leads/bulk-delete` and `POST /api/leads/bulk-update`. A VA gated to
 * their own leads could delete, restore or mass-update any lead in the org by
 * guessing a numeric id, and the bulk paths took an arbitrary id array.
 *
 * This is the same shape as the `/api/admin` MFA defect found earlier in this
 * program: a real gate, correctly written, applied to some surfaces and not
 * others — and invisible because each surface looked fine on its own. Five
 * copies of a security rule is not five times the safety; it is five chances to
 * forget the sixth.
 *
 * SEVERITY, STATED HONESTLY
 * -------------------------
 * INTRA-ORG, not cross-tenant. Every affected path is already org-scoped, so no
 * data crossed an organization boundary. What was bypassed is a permission the
 * org's own owner configured — which is a real boundary and a real defect, and
 * is not the same thing as a tenant leak.
 *
 * TWO SHAPES, BECAUSE THE HONEST ANSWERS DIFFER
 * ---------------------------------------------
 * `assertAssignedLeadWritable` is for a SINGLE lead whose row has been read:
 * the caller either owns it or does not.
 *
 * `refuseBulkLeadWrite` is for an id ARRAY. It refuses the whole operation
 * rather than silently filtering to the caller's own leads — a bulk call that
 * quietly does less than it was asked reports success for work it did not do,
 * which is worse than a refusal the caller can see. That is the choice
 * `routes-bulk.ts` already made; this generalises it rather than inventing a
 * second answer.
 */

import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/request";
import { Errors } from "./errors";

/** True when this caller is restricted to the leads assigned to them. */
export function isAssignedOnlyCaller(req: AuthenticatedRequest): boolean {
  return req.permissionContext?.permissions.viewOnlyAssignedLeads === true;
}

/**
 * Refuse when a restricted caller touches a lead that is not theirs.
 *
 * Returns `true` when the request was REFUSED (a response has been sent and the
 * handler must return immediately). Returns `false` when the caller may proceed
 * — including when they carry no restriction at all.
 *
 * An UNASSIGNED lead is not writable by a restricted caller. Treating "assigned
 * to nobody" as "assigned to everybody" would make the restriction meaningless
 * for exactly the leads most likely to be unclaimed.
 */
export function assertAssignedLeadWritable(
  req: AuthenticatedRequest,
  res: Response,
  lead: { assignedTo?: unknown } | null | undefined,
): boolean {
  if (!isAssignedOnlyCaller(req)) return false;
  if (!isLeadAssignedToCaller(req, lead)) {
    Errors.forbidden(res, "You can only modify leads assigned to you");
    return true;
  }
  return false;
}

/**
 * Is this lead assigned to the calling team member?
 *
 * `leads.assigned_to` stores a `team_members.id` (an integer — the list filter,
 * importer and auto-assigner all write and read it that way), so the caller's
 * identity here is `permissionContext.teamMemberId`, NOT `req.user.id` (a
 * users.id uuid). Comparing against the user id meant the two could never be
 * equal: an assigned-only caller could write none of their own leads.
 *
 * A missing team-member id is "not theirs" — the caller's identity could not be
 * established, and the safe answer to that is no.
 */
function isLeadAssignedToCaller(
  req: AuthenticatedRequest,
  lead: { assignedTo?: unknown } | null | undefined,
): boolean {
  const memberId = req.permissionContext?.teamMemberId;
  const assignedTo = lead?.assignedTo;
  if (assignedTo == null || memberId == null) return false;
  return Number(assignedTo) === memberId;
}

/**
 * Refuse a BULK lead write outright for a restricted caller.
 *
 * Returns `true` when refused. The message names the restriction rather than the
 * ids, so it cannot be used to probe which leads exist.
 */
export function refuseBulkLeadWrite(
  req: AuthenticatedRequest,
  res: Response,
  what = "Bulk lead updates",
): boolean {
  if (!isAssignedOnlyCaller(req)) return false;
  Errors.forbidden(res, `${what} are not available with assigned-only access`);
  return true;
}
