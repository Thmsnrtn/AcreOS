/**
 * `canAssignLeads` — declared for every role, consulted nowhere.
 *
 * `RolePermissions` grants it to `owner` and `admin` and denies it to `member`,
 * `va` and `viewer`. `client/src/hooks/use-organization.ts` exposes it to the
 * UI. **No server route has ever checked it**, so any member could assign or
 * re-assign any lead to anyone, through three different paths, while the UI
 * hid the control from them.
 *
 * This is the last of the class that produced units 30–35: a rule that exists
 * and is applied to some surfaces and not others — except here it was applied
 * to NONE, which is the same defect at its limit. A permission the UI honours
 * and the server ignores is worse than no permission at all: it reads as
 * enforced to everyone who looks at the product, and the API is open.
 *
 * WHY LEAD ASSIGNMENT IS WORTH A PERMISSION. Assignment is who works a lead, so
 * it decides whose pipeline it lands in, who is measured on it, and — for a `va`
 * or anyone with `viewOnlyAssignedLeads` — **who can see it at all**. Assigning a
 * lead to a restricted user grants them access to it; assigning it away removes
 * theirs. It is an access-control operation wearing a workflow name.
 *
 * GATED BY FIELD, NOT WHOLESALE
 * -----------------------------
 * The same trade as `ORG_WIDE_SETTINGS` in the organization settings route.
 * `PUT /api/leads/:id` legitimately carries a member's edits to a phone number
 * or a status; refusing the whole request because the payload also happens to
 * contain `assignedTo` would break ordinary work to close a narrow gap. So the
 * refusal fires only when the request actually SETS an assignee.
 *
 * `assignedTo: null` counts. Unassigning changes who works the lead and, for a
 * restricted user, revokes their access to it — it is an assignment decision in
 * the direction that removes something.
 *
 * WHAT IS DELIBERATELY NOT GATED
 * ------------------------------
 *   - `services/leadAssigner.assignLead` — the rules-based auto-assign that runs
 *     on create when the caller named nobody. It applies the ORG'S OWN
 *     configured rules; a member creating a lead has not chosen an assignee, and
 *     denying the org's rules the right to run would break intake for exactly
 *     the roles that most need it.
 *   - `services/territoryService` — automation acting under its own authority,
 *     not a user's. A user permission is the wrong instrument for it.
 *   - `services/importExport` — already behind `canImportData` (unit 35).
 *   - Property and deal assignment on the bulk routes. There is no declared
 *     permission for those, and inventing one here would be a different change
 *     smuggled in. Recorded rather than done.
 */

import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/request";
import { Errors } from "./errors";

/** Does this payload set an assignee? `undefined` means "not touching it". */
export function setsAssignee(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  return (payload as Record<string, unknown>).assignedTo !== undefined;
}

/**
 * Refuse an assignment the caller is not permitted to make.
 *
 * Returns `true` when it REFUSED and has already written the response — the
 * same shape as `assertAssignedLeadWritable`, so call sites read
 * `if (refuseUnpermittedAssignment(...)) return;`.
 *
 * FAILS CLOSED. A missing permission context means the role could not be
 * resolved, and the safe reading of "we do not know who this is" is no. The
 * viewer gate learned this the hard way: its first draft read a context that is
 * attached per-route and therefore later than the chokepoint, found `undefined`,
 * and would have passed everything through while looking correct.
 */
export function refuseUnpermittedAssignment(
  req: AuthenticatedRequest,
  res: Response,
  payload: unknown,
  what = "Assigning leads",
): boolean {
  if (!setsAssignee(payload)) return false;

  const permissions = req.permissionContext?.permissions;
  if (permissions?.canAssignLeads === true) return false;

  Errors.forbidden(
    res,
    `${what} requires lead-assignment access. Your other changes were not saved — ` +
      `resend them without the assignee, or ask an owner or admin to reassign.`,
  );
  return true;
}
