import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import type { TeamMember, Organization } from "@shared/schema";

export type Role = "owner" | "admin" | "member" | "viewer";

export const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

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
  const validRole = ROLES.includes(role as Role) ? (role as Role) : "member";
  return ROLE_PERMISSIONS[validRole];
}

export function hasPermission(role: string, permission: keyof RolePermissions): boolean {
  const permissions = getPermissionsForRole(role);
  return permissions[permission];
}

export function isAdminOrAbove(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function isOwner(role: string): boolean {
  return role === "owner";
}

export function getRoleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
    default:
      return "Member";
  }
}

export function getRoleColor(role: string): string {
  switch (role) {
    case "owner":
      return "amber";
    case "admin":
      return "purple";
    case "member":
      return "blue";
    case "viewer":
      return "slate";
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
  const userId = user.claims?.sub || user.id;
  if (!userId) return null;

  const teamMember = await storage.getTeamMember(org.id, userId);
  if (!teamMember) return null;

  const role = ROLES.includes(teamMember.role as Role) 
    ? (teamMember.role as Role) 
    : "member";

  return {
    userId,
    organizationId: org.id,
    teamMemberId: teamMember.id,
    role,
    permissions: getPermissionsForRole(role),
  };
}

export function requirePermission(permission: keyof RolePermissions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    const org = (req as any).organization as Organization;

    if (!user || !org) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return res.status(403).json({ message: "You are not a member of this organization" });
    }

    (req as any).permissionContext = context;

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
    const org = (req as any).organization as Organization;

    if (!user || !org) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return res.status(403).json({ message: "You are not a member of this organization" });
    }

    (req as any).permissionContext = context;

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
    const org = (req as any).organization as Organization;

    if (!user || !org) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const context = await getUserPermissionContext(user, org);
    if (!context) {
      return res.status(403).json({ message: "You are not a member of this organization" });
    }

    (req as any).permissionContext = context;

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
    const org = (req as any).organization as Organization;

    if (!user || !org) {
      return next();
    }

    const context = await getUserPermissionContext(user, org);
    if (context) {
      (req as any).permissionContext = context;
    }

    next();
  };
}
