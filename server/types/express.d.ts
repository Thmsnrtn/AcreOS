// Augment Express Request with our DB user and organization (attached by middleware chain)
import type { User } from "@shared/models/auth";
import type { Organization } from "@shared/schema";
import type { UserPermissionContext } from "../utils/permissions";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      organization?: Organization;
      organizationId?: number;
      permissionContext?: UserPermissionContext;
      isFounder?: boolean;
    }
  }
}

export {};
