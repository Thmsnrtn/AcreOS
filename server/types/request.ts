import type { Request } from "express";
import type { User } from "@shared/models/auth";
import type { Organization } from "@shared/schema";
import type { UserPermissionContext } from "../utils/permissions";

/**
 * Express request with authenticated user, organization, and permission context.
 * Use this instead of `(req as any)` in all route handlers.
 */
export interface AuthenticatedRequest extends Request {
  user: User;
  organization: Organization;
  organizationId: number;
  permissionContext?: UserPermissionContext;
  isFounder?: boolean;
}

/**
 * Single source of truth for extracting the organization from a request.
 * Replaces all per-file getOrg() functions.
 */
export function getOrganization(req: AuthenticatedRequest): Organization {
  const org = req.organization;
  if (!org) {
    throw new Error("Organization not found on request — is getOrCreateOrg middleware applied?");
  }
  return org;
}

/**
 * Extract the user ID from the request, handling both direct id and claims patterns.
 */
export function getUserId(req: AuthenticatedRequest): number {
  const user = req.user;
  if (!user?.id) {
    throw new Error("User not found on request — is isAuthenticated middleware applied?");
  }
  return user.id;
}

/**
 * Extract the organization ID from the request.
 */
export function getOrganizationId(req: AuthenticatedRequest): number {
  const org = req.organization;
  if (!org?.id) {
    throw new Error("Organization not found on request — is getOrCreateOrg middleware applied?");
  }
  return org.id;
}
