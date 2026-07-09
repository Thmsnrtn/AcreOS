/**
 * Panel-300 #8 — role-scoped permission helper + middleware.
 *
 * customers-roles (Catalina 211 VA, Augusto 212 bookkeeper, Iolanda 214
 * attorney, Adelaide 224 family co-owner, etc.) need DIFFERENT views
 * of the same org. Today AcreOS has a coarse {owner, admin, member,
 * viewer, va} role on team_members; this middleware extends the role
 * model with explicit per-scope permissions ("financial_read",
 * "tenant_pii_read", "annotation_only", etc.) so a VA sees deals
 * but not bank-balance, a bookkeeper sees ledger but not screening
 * results, etc.
 *
 * Backward-compatible: if no scope is required, falls through. The
 * existing org-owner role automatically has all scopes.
 */

import type { Response, NextFunction } from "express";
import { db } from "../db";
import { teamMembers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../types/request";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";

export type Scope =
  | "financial_read" // P&L, revenue, COGS — visible to owner / admin / bookkeeper / accountant
  | "financial_write" // record payments, edit invoices — owner / admin / bookkeeper
  | "tenant_pii_read" // SSN, prior addresses, screening results — owner / property_manager / screening_specialist
  | "tenant_pii_write" // initiate screening, attestation — same set
  | "deal_read" // pipeline visibility — wide; default-deny for family-co-owner
  | "deal_write" // edit offer, status changes — owner / admin / member
  | "comms_read" // message history — owner / admin / member / VA
  | "comms_write" // send mailers / SMS — owner / admin / member
  | "settings_write" // org settings, billing, members — owner / admin only
  | "audit_read" // audit log — owner / admin / attorney
  | "annotation_only"; // read-only view + comment-only — family co-owner / external advisor

const ROLE_SCOPES: Record<string, Set<Scope>> = {
  owner: new Set([
    "financial_read", "financial_write",
    "tenant_pii_read", "tenant_pii_write",
    "deal_read", "deal_write",
    "comms_read", "comms_write",
    "settings_write", "audit_read",
  ]),
  admin: new Set([
    "financial_read", "financial_write",
    "tenant_pii_read", "tenant_pii_write",
    "deal_read", "deal_write",
    "comms_read", "comms_write",
    "settings_write", "audit_read",
  ]),
  member: new Set([
    "financial_read",
    "deal_read", "deal_write",
    "comms_read", "comms_write",
  ]),
  viewer: new Set([
    "deal_read", "comms_read", "annotation_only",
  ]),
  va: new Set([
    "deal_read", "deal_write",
    "comms_read", "comms_write",
  ]),
  // New role types panel-300 customers-roles surfaced:
  bookkeeper: new Set([
    "financial_read", "financial_write",
    "deal_read",
  ]),
  accountant: new Set([
    "financial_read", "audit_read", "deal_read",
  ]),
  attorney_advisor: new Set([
    "audit_read", "deal_read", "annotation_only",
  ]),
  property_manager: new Set([
    "tenant_pii_read", "tenant_pii_write",
    "deal_read", "comms_read", "comms_write",
  ]),
  screening_specialist: new Set([
    "tenant_pii_read", "tenant_pii_write",
  ]),
  family_co_owner: new Set([
    "annotation_only", "financial_read",
  ]),
  intern: new Set([
    "deal_read", "comms_read",
  ]),
};

/**
 * Check whether the requesting user has a given scope in the org
 * indicated on the request. Returns true/false; caller decides 403
 * vs softer denial.
 */
export async function hasRoleScope(req: AuthenticatedRequest, scope: Scope): Promise<boolean> {
  if (!req.user || !req.organization) return false;
  // Founders bypass — already gated upstream by requireFounder for
  // /founder/* routes; here we treat isFounder as "all scopes."
  if (req.isFounder) return true;
  // Org owner shortcut.
  if (req.organization.ownerId === (req.user as any).id) return true;
  try {
    const [member] = await db
      .select()
      .from(teamMembers)
      .where(and(
        eq(teamMembers.organizationId, req.organization.id),
        eq(teamMembers.userId, (req.user as any).id),
        eq(teamMembers.isActive, true),
      ))
      .limit(1);
    if (!member) return false;
    const scopes = ROLE_SCOPES[member.role] ?? new Set<Scope>();
    return scopes.has(scope);
  } catch (err) {
    logger.warn("[roleScope] lookup failed; falling closed", err instanceof Error ? err : undefined);
    return false;
  }
}

/**
 * Express middleware: require a specific scope. If absent, return 403
 * with code='ROLE_SCOPE_DENIED'.
 */
export function requireScope(scope: Scope) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const ok = await hasRoleScope(req, scope);
    if (!ok) {
      return Errors.forbidden(
        res,
        `Your role lacks the "${scope}" scope. Contact the org owner if this is a mistake.`,
      );
    }
    next();
  };
}
