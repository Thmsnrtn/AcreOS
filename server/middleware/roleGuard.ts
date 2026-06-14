/**
 * Role-Based API Enforcement Middleware
 *
 * Phase 3 Week 14 (Liana §1+§3, Reyna §1): standardized to 4 pragmatic roles
 * + `va`. The legacy fan-out (acquisitions / marketing / finance) is collapsed
 * to `member` at read time. Pre-built guards (`financeGuard`, etc.) remain as
 * thin aliases so callers don't have to be migrated in lockstep — but the
 * canonical entry point is now `requireRole(['owner', 'admin', ...])`.
 *
 * Roles:
 *   owner   — full access; only role that can transfer ownership / delete org
 *   admin   — full operational access except billing & ownership transfer
 *   member  — full operational, can't change member roles
 *   viewer  — read-only across the CRM
 *   va      — like member, but typically gated to assigned-leads-only via
 *             team_members.view_only_assigned_leads (honored in storage.ts
 *             and routes-leads.ts via permissionContext)
 *
 * Usage:
 *   import { requireRole } from "../middleware/roleGuard";
 *
 *   router.get("/sensitive-data",
 *     isAuthenticated,
 *     requireRole(['owner', 'admin']),
 *     handler
 *   );
 */

import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/errors";
import { db } from "../db";
import { teamMembers } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export type OrgRole = "owner" | "admin" | "member" | "viewer" | "va";

const CANONICAL_ROLES: OrgRole[] = ["owner", "admin", "member", "viewer", "va"];

const LEGACY_ROLE_REMAP: Record<string, OrgRole> = {
  acquisitions: "member",
  marketing: "member",
  finance: "member",
};

function normalizeRole(role: string): OrgRole {
  if (CANONICAL_ROLES.includes(role as OrgRole)) return role as OrgRole;
  return LEGACY_ROLE_REMAP[role] ?? "member";
}

// Role hierarchy: higher index = more permissive. `va` ties with member on
// rank — the assigned-leads-only restriction is handled at the data layer,
// not via rank-based gating.
const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  va: 1,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * Middleware factory: require that the user has one of the listed roles.
 *
 * Accepts either an array (the canonical form) or a variadic list (legacy
 * call sites that pre-date the standardization). Both forms are permitted
 * to keep the migration surface small.
 */
export function requireRole(allowedRoles: OrgRole[] | OrgRole, ...rest: OrgRole[]) {
  const allowed: OrgRole[] = Array.isArray(allowedRoles)
    ? allowedRoles
    : [allowedRoles, ...rest];

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      const org = req.organization;

      if (!user || !org) {
        return Errors.unauthorized(res);
      }

      const userId = String(user?.id || user.id);

      // SEC: must filter to is_active = true so deactivated/off-boarded
      // members can't continue to authenticate against the org. Lens 23
      // finding #2 — without the isActive predicate, a row that's been
      // flagged inactive (admin removed them, employee left, etc.) still
      // satisfies the role check and grants full role-gated access.
      const [member] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.organizationId, org.id),
            eq(teamMembers.userId, userId),
            eq(teamMembers.isActive, true)
          )
        );

      if (!member) {
        return res
          .status(403)
          .json({ message: "Not a member of this organization" });
      }

      const userRole = normalizeRole(member.role);

      if (!allowed.includes(userRole)) {
        return Errors.forbidden(res, `Access denied. Required role: ${allowed.join(" or ")}`);
      }

      // Attach role to request for downstream use
      req.userRole = userRole;
      next();
    } catch (err: any) {
      Errors.internal(res, err);
    }
  };
}

// ─── Pre-built role guards ────────────────────────────────────────────────────
// Kept as thin aliases over the standardized 5-role model. `financeGuard`,
// `acquisitionsGuard`, `marketingGuard` now resolve to the same set
// (admin + owner) since the legacy verticals collapsed into `member`.

/** Finance routes: only admin/owner (legacy `finance` collapsed to member) */
export const financeGuard = requireRole(["admin", "owner"]);

/** Acquisitions routes: admin/owner */
export const acquisitionsGuard = requireRole(["admin", "owner"]);

/** Marketing routes: admin/owner (members create campaigns via per-permission gates in routes-campaigns) */
export const marketingGuard = requireRole(["admin", "owner"]);

/** Admin-only routes: admin, owner */
export const adminGuard = requireRole(["admin", "owner"]);

/** Owner-only routes */
export const ownerGuard = requireRole(["owner"]);

/** Read-only: all roles (including va + viewer) */
export const anyRoleGuard = requireRole(["owner", "admin", "member", "viewer", "va"]);

export { ROLE_RANK, normalizeRole };
