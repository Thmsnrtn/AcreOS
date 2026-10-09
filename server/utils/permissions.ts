import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import type { TeamMember, Organization } from "@shared/schema";
import { sendError } from "./errors";

// Phase 3 Week 14 (Liana §1+§3, Reyna §1): standardized to 4 pragmatic roles
// + `va`. Legacy values (`acquisitions`, `marketing`, `finance`) are remapped
// to `member` at read time for safety in case migration 0050 hasn't fully
// propagated through replicas.
export type Role = "owner" | "admin" | "member" | "viewer" | "va";

export const ROLES: Role[] = ["owner", "admin", "member", "viewer", "va"];

const LEGACY_ROLE_REMAP: Record<string, Role> = {
  acquisitions: "member",
  marketing: "member",
  finance: "member",
};

function normalizeRole(role: string): Role {
  if (ROLES.includes(role as Role)) return role as Role;
  return LEGACY_ROLE_REMAP[role] ?? "member";
}

export interface RolePermissions {
  canAccessSettings: boolean;
  canManageBilling: boolean;
  canDeleteOrg: boolean;
  canManageTeam: boolean;
  canCreateCampaign: boolean;
  canDeleteCampaign: boolean;
  canExportData: boolean;
  canImportData: boolean;
  canDeleteLeads: boolean;
  canDeleteProperties: boolean;
  canDeleteDeals: boolean;
  canDeleteNotes: boolean;
  canEditLeads: boolean;
  canEditProperties: boolean;
  canEditDeals: boolean;
  canEditNotes: boolean;
  canCreateLeads: boolean;
  canCreateProperties: boolean;
  canCreateDeals: boolean;
  canCreateNotes: boolean;
  canViewLeads: boolean;
  canViewProperties: boolean;
  canViewDeals: boolean;
  canViewNotes: boolean;
  canAssignLeads: boolean;
  viewOnlyAssignedLeads: boolean;
}

const ROLE_PERMISSIONS: Record<Role, RolePermissions> = {
  owner: {
    canAccessSettings: true,
    canManageBilling: true,
    canDeleteOrg: true,
    canManageTeam: true,
    canCreateCampaign: true,
    canDeleteCampaign: true,
    canExportData: true,
    canImportData: true,
    canDeleteLeads: true,
    canDeleteProperties: true,
    canDeleteDeals: true,
    canDeleteNotes: true,
    canEditLeads: true,
    canEditProperties: true,
    canEditDeals: true,
    canEditNotes: true,
    canCreateLeads: true,
    canCreateProperties: true,
    canCreateDeals: true,
    canCreateNotes: true,
    canViewLeads: true,
    canViewProperties: true,
    canViewDeals: true,
    canViewNotes: true,
    canAssignLeads: true,
    viewOnlyAssignedLeads: false,
  },
  admin: {
    canAccessSettings: true,
    canManageBilling: false,
    canDeleteOrg: false,
    canManageTeam: true,
    canCreateCampaign: true,
    canDeleteCampaign: true,
    canExportData: true,
    canImportData: true,
    canDeleteLeads: true,
    canDeleteProperties: true,
    canDeleteDeals: true,
    canDeleteNotes: true,
    canEditLeads: true,
    canEditProperties: true,
    canEditDeals: true,
    canEditNotes: true,
    canCreateLeads: true,
    canCreateProperties: true,
    canCreateDeals: true,
    canCreateNotes: true,
    canViewLeads: true,
    canViewProperties: true,
    canViewDeals: true,
    canViewNotes: true,
    canAssignLeads: true,
    viewOnlyAssignedLeads: false,
  },
  member: {
    canAccessSettings: false,
    canManageBilling: false,
    canDeleteOrg: false,
    canManageTeam: false,
    canCreateCampaign: false,
    canDeleteCampaign: false,
    canExportData: false,
    canImportData: false,
    canDeleteLeads: false,
    canDeleteProperties: false,
    canDeleteDeals: false,
    canDeleteNotes: false,
    canEditLeads: true,
    canEditProperties: true,
    canEditDeals: true,
    canEditNotes: true,
    canCreateLeads: true,
    canCreateProperties: true,
    canCreateDeals: true,
    canCreateNotes: true,
    canViewLeads: true,
    canViewProperties: true,
    canViewDeals: true,
    canViewNotes: true,
    canAssignLeads: false,
    // Liana §1: standard `member` is full operational; `va` (below) is the
    // restricted variant. An admin can still flip a member to assigned-only
    // via the per-user toggle stored on team_members.viewOnlyAssignedLeads.
    viewOnlyAssignedLeads: false,
  },
  // Reyna §1: `va` role is operationally a member with the assigned-leads-only
  // flag defaulted on. The flag can be overridden per-user from the Settings UI
  // (e.g. trusted VA gets the full pool) via team_members.view_only_assigned_leads
  // (NULL = this default); the effective value is resolveViewOnlyAssignedLeads.
  va: {
    canAccessSettings: false,
    canManageBilling: false,
    canDeleteOrg: false,
    canManageTeam: false,
    canCreateCampaign: false,
    canDeleteCampaign: false,
    canExportData: false,
    canImportData: false,
    canDeleteLeads: false,
    canDeleteProperties: false,
    canDeleteDeals: false,
    canDeleteNotes: false,
    canEditLeads: true,
    canEditProperties: true,
    canEditDeals: true,
    canEditNotes: true,
    canCreateLeads: true,
    canCreateProperties: true,
    canCreateDeals: true,
    canCreateNotes: true,
    canViewLeads: true,
    canViewProperties: true,
    canViewDeals: true,
    canViewNotes: true,
    canAssignLeads: false,
    viewOnlyAssignedLeads: true,
  },
  viewer: {
    canAccessSettings: false,
    canManageBilling: false,
    canDeleteOrg: false,
    canManageTeam: false,
    canCreateCampaign: false,
    canDeleteCampaign: false,
    canExportData: false,
    canImportData: false,
    canDeleteLeads: false,
    canDeleteProperties: false,
    canDeleteDeals: false,
    canDeleteNotes: false,
    canEditLeads: false,
    canEditProperties: false,
    canEditDeals: false,
    canEditNotes: false,
    canCreateLeads: false,
    canCreateProperties: false,
    canCreateDeals: false,
    canCreateNotes: false,
    canViewLeads: true,
    canViewProperties: true,
    canViewDeals: true,
    canViewNotes: true,
    canAssignLeads: false,
    viewOnlyAssignedLeads: true,
  },
};

export function getPermissionsForRole(role: string): RolePermissions {
  return ROLE_PERMISSIONS[normalizeRole(role)];
}

export function hasPermission(role: string, permission: keyof RolePermissions): boolean {
  const permissions = getPermissionsForRole(role);
  return permissions[permission];
}

export function isAdminOrAbove(role: string): boolean {
  const r = normalizeRole(role);
  return r === "owner" || r === "admin";
}

export function isOwner(role: string): boolean {
  return normalizeRole(role) === "owner";
}

export function getRoleLabel(role: string): string {
  switch (normalizeRole(role)) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
    case "va":
      return "VA";
    default:
      return "Member";
  }
}

export function getRoleColor(role: string): string {
  switch (normalizeRole(role)) {
    case "owner":
      return "amber";
    case "admin":
      return "purple";
    case "member":
      return "blue";
    case "viewer":
      return "slate";
    case "va":
      return "teal";
    default:
      return "slate";
  }
}

/**
 * The effective "assigned leads only" flag for a team member — the ONE place
 * it is computed.
 *
 * `team_members.view_only_assigned_leads` is a per-member OVERRIDE, and NULL
 * means "no override: use the role's default" (migration 0269; previously the
 * column was `NOT NULL DEFAULT false`, so a stored `false` took precedence over
 * the `va` role's default of `true`).
 *
 *   - an explicit boolean wins (an owner/admin chose it on purpose);
 *   - NULL / absent falls back to the role table (`va` → true; `owner`,
 *     `admin`, `member` → false);
 *   - an `owner` is never restricted. The toggle route already refuses to
 *     restrict an owner; holding it here as well means a member who carried an
 *     override when promoted to owner cannot end up an owner who sees nothing.
 */
export function resolveViewOnlyAssignedLeads(
  role: string,
  stored: boolean | null | undefined,
): boolean {
  const r = normalizeRole(role);
  if (r === "owner") return false;
  if (typeof stored === "boolean") return stored;
  return ROLE_PERMISSIONS[r].viewOnlyAssignedLeads;
}

/** The permissions a team member actually has: role table + the per-member override. */
export function effectivePermissions(
  teamMember: { role: string; viewOnlyAssignedLeads?: boolean | null },
): RolePermissions {
  return {
    ...getPermissionsForRole(teamMember.role),
    viewOnlyAssignedLeads: resolveViewOnlyAssignedLeads(teamMember.role, teamMember.viewOnlyAssignedLeads),
  };
}

export interface UserPermissionContext {
  userId: string;
  organizationId: number;
  teamMemberId: number;
  role: Role;
  permissions: RolePermissions;
}

export async function getUserPermissionContext(
  user: any,
  org: Organization
): Promise<UserPermissionContext | null> {
  // `user?.id` and not `user?.id || user.id`. The optional chain and the
  // `return null` below both say the same thing — this function tolerates an
  // absent user — and the `|| user.id` fallback threw before either could act:
  // when `user` is nullish the left side is `undefined`, which is falsy, so the
  // unguarded `user.id` runs and raises a TypeError. A fallback to the same
  // property cannot supply a value the first read did not, so the only thing it
  // could ever contribute was that throw.
  //
  // Latent rather than live: both callers (`viewerReadOnlyGate`, which returns
  // early on `!user || !org`, and `GET /api/me/permissions`, which sits behind
  // `isAuthenticated`) pass a real user today. Recorded as latent instead of
  // dressed up as a fix for a live crash.
  const userId = user?.id;
  if (!userId) return null;

  const teamMember = await storage.getTeamMember(org.id, userId);
  if (!teamMember) return null;
  if (!teamMember.isActive) return null; // Block deactivated team members

  const role = normalizeRole(teamMember.role);

  // ONE rule for the effective assigned-only flag — see
  // resolveViewOnlyAssignedLeads. /api/me/permissions serialises this same
  // context, so what the client is told and what the server enforces cannot
  // be computed two ways.
  const permissions = effectivePermissions(teamMember);

  return {
    userId,
    organizationId: org.id,
    teamMemberId: teamMember.id,
    role,
    permissions,
  };
}

export function requirePermission(permission: keyof RolePermissions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const org = req.organization as Organization;

    if (!user || !org) {
      return sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return sendError(res, 403, "FORBIDDEN", "You are not a member of this organization");
    }

    req.permissionContext = context;

    if (!context.permissions[permission]) {
      const permissionLabel = permission.replace(/([A-Z])/g, " $1").toLowerCase();
      return res.status(403).json({ 
        message: `You don't have permission to ${permissionLabel}. Contact your organization admin for access.`,
        requiredPermission: permission,
        userRole: context.role,
      });
    }

    next();
  };
}

export function requireAdminOrAbove() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const org = req.organization as Organization;

    if (!user || !org) {
      return sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return sendError(res, 403, "FORBIDDEN", "You are not a member of this organization");
    }

    req.permissionContext = context;

    if (!isAdminOrAbove(context.role)) {
      return res.status(403).json({ 
        message: "This action requires admin or owner privileges.",
        userRole: context.role,
      });
    }

    next();
  };
}

export function requireOwner() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const org = req.organization as Organization;

    if (!user || !org) {
      return sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return sendError(res, 403, "FORBIDDEN", "You are not a member of this organization");
    }

    req.permissionContext = context;

    if (!isOwner(context.role)) {
      return res.status(403).json({ 
        message: "This action requires owner privileges.",
        userRole: context.role,
      });
    }

    next();
  };
}

export function attachPermissionContext() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const org = req.organization as Organization;

    if (!user || !org) {
      return next();
    }

    const context = await getUserPermissionContext(user, org);
    if (context) {
      req.permissionContext = context;
    }

    next();
  };
}
