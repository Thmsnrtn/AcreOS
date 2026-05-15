import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import type { TeamMember, Organization } from "@shared/schema";

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
  // flag defaulted on. The flag can be toggled per-user from the Settings UI
  // (e.g. trusted VA gets the full pool); the canonical source of truth is
  // team_members.view_only_assigned_leads.
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
  const userId = user?.id || user.id;
  if (!userId) return null;

  const teamMember = await storage.getTeamMember(org.id, userId);
  if (!teamMember) return null;
  if (!teamMember.isActive) return null; // Block deactivated team members

  const role = normalizeRole(teamMember.role);

  // Reyna §1: per-user `viewOnlyAssignedLeads` override. Default permissions
  // come from the role table; if the team_members row has the flag set
  // explicitly (true OR false), that wins. This is what lets an admin trust
  // a specific VA with the full lead pool, or restrict a regular member
  // who works narrowly with one campaign.
  const basePermissions = getPermissionsForRole(role);
  const perUserFlag = (teamMember as any).viewOnlyAssignedLeads;
  const permissions: RolePermissions = {
    ...basePermissions,
    viewOnlyAssignedLeads:
      typeof perUserFlag === "boolean" ? perUserFlag : basePermissions.viewOnlyAssignedLeads,
  };

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
      return res.status(401).json({ message: "Unauthorized" });
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return res.status(403).json({ message: "You are not a member of this organization" });
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
      return res.status(401).json({ message: "Unauthorized" });
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return res.status(403).json({ message: "You are not a member of this organization" });
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
      return res.status(401).json({ message: "Unauthorized" });
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return res.status(403).json({ message: "You are not a member of this organization" });
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
