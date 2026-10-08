/**
 * By-id lead routes are scoped to the caller's assigned leads.
 *
 * A caller whose effective `viewOnlyAssignedLeads` is true (a VA by default)
 * sees, in the list endpoints, only leads where `assignedTo = teamMemberId`.
 * This gate applies the same rule to every route that names a lead in its path
 * — the detail read, its activities / timeline / properties / scores, and the
 * lead-keyed routes on other prefixes (seller intent, skip traces, seller
 * communications, …) — so the list and the detail agree.
 *
 * WHY A CHOKEPOINT
 * ----------------
 * These routes span a dozen files, and new ones are added regularly. So, like
 * `viewerReadOnlyGate`, the rule is chained from `getOrCreateOrg` — the one
 * middleware every org-scoped route runs — and decides from the PATH.
 * `tests/unit/vaRolePath.test.ts` enumerates every lead-id route registration
 * under server/ and requires each to be covered by `LEAD_ID_PATH_PREFIXES`.
 *
 * WHAT IT DOES
 * ------------
 *   - the path names no lead id → next() (no cost: no read at all);
 *   - the caller is not assigned-only, or has no membership → next() (the
 *     route's own authorization decides);
 *   - the id segment is not in canonical form (`^[1-9]\d*$`) but some parser a
 *     handler uses would still read an integer from it → 404 for an
 *     assigned-only caller, without a read;
 *   - otherwise the named lead is read, org-scoped, and a lead not assigned to
 *     the caller's team member is a 404 — the same answer as a lead that does
 *     not exist.
 *
 * Handlers parse the decoded param with `Number(...)`, `parseInt(...)` (with
 * and without a radix) and occasionally `parseFloat(...)`, and those disagree on
 * non-canonical input (`parseInt("0x1F")` is 31, `parseInt("0x1F", 10)` is 0).
 * Rather than predict which parser a given handler uses, an assigned-only
 * caller is held to the canonical form.
 *
 * FAILS CLOSED: if the membership or the lead cannot be read, the request is
 * refused and logged, for the same reason the viewer gate gives.
 */
import type { NextFunction, Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { leads } from "@shared/schema";
import { db } from "../db";
import type { AuthenticatedRequest } from "../types/request";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";
import { getUserPermissionContext } from "../utils/permissions";

/**
 * Every path prefix under which the NEXT segment is a lead id. Lower-case:
 * Express matches routes case-insensitively, so the comparison does too.
 */
const LEAD_ID_PATH_PREFIXES: readonly string[] = [
  "/api/leads/",
  "/api/skip-traces/lead/",
  "/api/seller-communications/lead/",
  "/api/buyer-prequalifications/lead/",
  "/api/seller-intent/",
  "/api/ai/intent/lead/",
  "/api/skip-tracing/trace/",
  "/api/data-intel/prospect/",
  "/api/seller-motivation/",
];

const CANONICAL_ID = /^[1-9]\d*$/;

export interface LeadIdSegment {
  /** Every positive integer a handler's parser could read from the segment. */
  ids: number[];
  /** True only for `^[1-9]\d*$` — the one form every parser reads the same way. */
  canonical: boolean;
}

/**
 * Read the lead-id segment of a request path, or `null` when the path names no
 * lead (no recognised prefix, or a segment no parser reads as an integer, such
 * as `/api/leads/export`).
 */
export function parseLeadIdSegment(rawPath: string): LeadIdSegment | null {
  const path = rawPath.toLowerCase();
  const prefix = LEAD_ID_PATH_PREFIXES.find((p) => path.startsWith(p));
  if (!prefix) return null;
  // Split on the RAW slash first: Express does the same before it decodes a
  // param, so `12%2Fx` is one segment whose decoded value is `12/x`.
  const rawSegment = rawPath.slice(prefix.length).split("/")[0] ?? "";
  if (rawSegment === "") return null;
  let segment: string;
  try {
    segment = decodeURIComponent(rawSegment);
  } catch {
    return null; // Express answers a malformed escape with 400 before any handler runs.
  }
  if (CANONICAL_ID.test(segment)) return { ids: [Number(segment)], canonical: true };
  const parsed = [
    Number(segment),
    // Deliberately radix-less: many handlers call it this way.
    Number.parseInt(segment),
    Number.parseInt(segment, 10),
    Number.parseFloat(segment),
  ];
  if (!parsed.some((n) => Number.isInteger(n))) return null;
  const ids = [...new Set(parsed.filter((n) => Number.isSafeInteger(n) && n > 0))];
  return { ids, canonical: false };
}

export async function assignedLeadScopeGate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const fullPath = `${req.baseUrl ?? ""}${req.path ?? ""}`;
  const segment = parseLeadIdSegment(fullPath);
  if (!segment) return next();

  const authed = req as AuthenticatedRequest;
  const user = authed.user;
  const org = authed.organization;
  if (!user || !org) return next();

  try {
    const context = authed.permissionContext ?? (await getUserPermissionContext(user, org)) ?? undefined;
    if (context) authed.permissionContext = context;
    if (context?.permissions.viewOnlyAssignedLeads) {
      if (!segment.canonical || segment.ids.length === 0) {
        Errors.notFound(res, "Lead");
        return;
      }
      const rows = await db
        .select({ id: leads.id, assignedTo: leads.assignedTo })
        .from(leads)
        .where(and(eq(leads.organizationId, org.id), inArray(leads.id, segment.ids)));
      if (rows.some((r) => r.assignedTo == null || r.assignedTo !== context.teamMemberId)) {
        Errors.notFound(res, "Lead");
        return;
      }
    }
  } catch (err) {
    logger.error(
      `[assigned-lead-scope] could not verify lead access for ${req.method} ${fullPath} — refusing`,
      err instanceof Error ? err : undefined,
    );
    Errors.forbidden(res, "We could not verify your access to this lead just now. Please retry in a moment.");
    return;
  }
  // Outside the try: a synchronous throw downstream is the route's error, not
  // a failure to verify access.
  next();
}
