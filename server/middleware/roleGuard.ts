/**
 * T16 — Role-Based API Enforcement Middleware
 *
 * Enforces that the requesting user's team role has access to the operation.
 * Every route that returns sensitive or financial data should use this.
 *
 * Roles (from schema):
 *   owner    — full access to everything
 *   admin    — full access except billing/founder routes
 *   acquisitions — CRM, leads, properties, deals, offers
 *   marketing  — campaigns, sequences, ab-tests, lead contact only
 *   finance  — notes, payments, cash flow, portfolio only
 *   member   — read-only CRM access
 *
 * Usage:
 *   import { requireRole } from "../middleware/roleGuard";
 *
 *   router.get("/sensitive-data",
 *     isAuthenticated,
 *     requireRole("finance", "admin", "owner"),
 *     handler
 *   );
 *
 *   // Or use the pre-built guards:
 *   router.delete("/leads/:id", isAuthenticated, financeGuard, handler);
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { teamMembers } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export type OrgRole =
  | "owner"
  | "admin"
  | "acquisitions"
  | "marketing"
  | "finance"
  | "member";

// Role hierarchy: higher index = more permissive
const ROLE_RANK: Record<OrgRole, number> = {
  member: 0,
  marketing: 1,
  finance: 1,
  acquisitions: 2,
  admin: 3,
  owner: 4,
};

/**
 * Middleware factory: require that the user has at least one of the listed roles.
 */
export function requireRole(...allowedRoles: OrgRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const org = (req as any).organization;

      if (!user || !org) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const userId = String(user.claims?.sub || user.id);

      const [member] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.organizationId, org.id),
            eq(teamMembers.userId, userId)
          )
        );

      if (!member) {
        return res.status(403).json({ message: "Not a member of this organization" });
      }

      const userRole = member.role as OrgRole;
      const allowed = allowedRoles.includes(userRole);

      if (!allowed) {
        return res
          .status(403)
          .json({ message: `Access denied. Required role: ${allowedRoles.join(" or ")}` });
      }

      // Attach role to request for downstream use
      (req as any).userRole = userRole;
      next();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  };
}

// ─── Pre-built role guards ────────────────────────────────────────────────────

/** Finance routes: only finance, admin, owner */
export const financeGuard = requireRole("finance", "admin", "owner");

/** Acquisitions routes: acquisitions, admin, owner */
export const acquisitionsGuard = requireRole("acquisitions", "admin", "owner");

/** Marketing routes: marketing, acquisitions, admin, owner */
export const marketingGuard = requireRole("marketing", "acquisitions", "admin", "owner");

/** Admin-only routes: admin, owner */
export const adminGuard = requireRole("admin", "owner");

/** Owner-only routes */
export const ownerGuard = requireRole("owner");

/** Read-only: all roles */
export const anyRoleGuard = requireRole("member", "marketing", "finance", "acquisitions", "admin", "owner");
