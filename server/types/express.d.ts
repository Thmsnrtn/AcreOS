// Augment Express Request with our DB user and organization.
//
// On authenticated routes the `isAuthenticated` + `getOrCreateOrg`
// middleware chain guarantees `user`, `organization`, and
// `organizationId` are set BEFORE any handler runs. Marking them
// non-optional here matches that runtime invariant and eliminates ~1600
// `'org' is possibly undefined` errors across protected handlers.
//
// Public routes (landing, health checks, webhook endpoints that don't
// require login) that need to express the possibility of an absent
// organization should explicitly type their handler param with
// `Request & { organization?: Organization }` or pull the property via
// an explicit `req.organization as Organization | undefined` cast at the
// call site.
//
// The middleware-enforced runtime guarantee is the source of truth; this
// declaration matches it. If middleware is bypassed (forgetting
// `isAuthenticated` on a new route, for example), the type signature
// becomes a lie and the handler will crash on first access — which is
// the loud, immediate failure mode we want during dev/testing.
import type { User } from "@shared/models/auth";
import type { Organization } from "@shared/schema";
import type { UserPermissionContext } from "../utils/permissions";

declare global {
  namespace Express {
    interface Request {
      user: User;
      organization: Organization;
      organizationId: number;
      permissionContext?: UserPermissionContext;
      isFounder?: boolean;
    }
  }
}

export {};
