import type { Request } from "express";
import type { User } from "@shared/models/auth";
import type { Organization } from "@shared/schema";
import type { UserPermissionContext } from "../utils/permissions";

/**
 * Express request with authenticated user, organization, and permission context.
 * Use this instead of untyped request casts in all route handlers.
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
 * Extract the user ID from the request.
 *
 * There is ONE source: `req.user.id`. This comment used to promise "both direct
 * id and claims patterns", which was true under Replit OIDC, where the id also
 * arrived as `user.claims.sub`. The Clerk migration removed that second source —
 * correctly, and `authSurfaceIsClerk.test.ts` pins that Clerk is the only auth
 * surface — but the sentence survived it, so the single source of truth for
 * identity extraction advertised a shape no request carries. A reader writing
 * `req.user.claims.sub` handling on the strength of it would be coding against
 * a subsystem that is gone.
 *
 * The same migration left a population of expressions of the form
 * `user?.id || user?.id` across the repo: the operator that once separated the
 * two sources, still there with nothing on its right. They are inert
 * (`v || v === v` for every v) and are NOT worth churning. The `self-fallback`
 * ratchet owns the count — deliberately not restated here, since a number in
 * prose drifting away from the code is the very defect this comment records —
 * so the shape can only shrink, and the NEXT collapse of a fallback that still
 * matters shows up as a number going the wrong way.
 */
export function getUserId(req: AuthenticatedRequest): string {
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

/**
 * Narrow, normalized view of Clerk's auth state for a request — the one
 * shape every server caller reads. Produced only by `getClerkAuth`.
 *
 * Fields map 1:1 from @clerk/express 2.x's auth object
 * (`SignedInAuthObject | SignedOutAuthObject`, @clerk/backend 3.x), whose
 * signed-out form carries `null` for each; `null` is normalized to
 * `undefined` here so callers' `?.userId ?? …` chains are unchanged.
 */
export interface ClerkRequestAuth {
  userId?: string;
  sessionId?: string;
  /**
   * `[firstFactorAgeMinutes, secondFactorAgeMinutes]`, `-1` for a factor
   * never verified in this session; `null` when the instance does not emit
   * the claim or the request is signed out. Read only by requireClerkMFA.
   */
  factorVerificationAge?: [number, number] | null;
}

/** The fields we read off whatever `req.auth` yields, before normalization. */
interface RawClerkAuthFields {
  userId?: string | null;
  sessionId?: string | null;
  factorVerificationAge?: [number, number] | null;
}

type RawClerkAuth = RawClerkAuthFields | ((options?: unknown) => RawClerkAuthFields | null | undefined);

/**
 * Read Clerk's auth state for this request without an untyped request cast.
 *
 * @clerk/express 2.x installs `req.auth` as a FUNCTION (`req.auth()` returns
 * the auth object); reading `req.auth.userId` off it is always `undefined`.
 * This helper is the single normalization point:
 *   - callable (`@clerk/express` 2.x, and the E2E test-auth bypass) → invoked;
 *   - plain object (legacy shape, hand-built test requests) → read as-is;
 *   - absent → `undefined`, exactly as before.
 *
 * A signed-out verdict yields an object with no `userId`. That is NOT final:
 * hydrateUser still runs its `__session` JWT fallback when `userId` is absent
 * (a Clerk development instance reports signed-out for every cross-origin
 * API call — see server/auth/clerkAuth.ts).
 */
export function getClerkAuth(req: Request): ClerkRequestAuth | undefined {
  const raw = (req as Request & { auth?: RawClerkAuth | null }).auth;
  if (raw === undefined || raw === null) return undefined;
  const fields = typeof raw === "function" ? raw() : raw;
  if (!fields) return undefined;
  return {
    userId: fields.userId ?? undefined,
    sessionId: fields.sessionId ?? undefined,
    factorVerificationAge: fields.factorVerificationAge ?? null,
  };
}
