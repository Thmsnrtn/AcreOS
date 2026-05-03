import type { Express } from "express";
import { isAuthenticated, requireFounder } from "./clerkAuth";
import { isFounderIdentity } from "../services/founder";
import { db } from "../db";
import { teamMembers, organizations } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../utils/logger";
import { Errors } from "../utils/errors";
import { ACTIVE_ORG_COOKIE, ACTIVE_ORG_COOKIE_OPTS } from "../middleware/getOrCreateOrg";
import { auditFromRequest, AuditActions } from "../utils/auditLog";

// Process-local set of userIds that have already emitted an auth.login
// audit event. Cleared on process restart, which is acceptable: the audit
// log tolerates duplicate login events (and Clerk webhooks remain the
// authoritative source of session lifecycle).
const loggedLoginThisProcess = new Set<string>();

export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user (used by frontend useAuth hook)
  // Cache-Control: no-store is belt-and-suspenders. Safari / iOS have
  // historic Vary: Cookie bugs that can serve a stale signed-out 200
  // after sign-in, trapping the user on the auth page.
  app.get("/api/auth/user", isAuthenticated, (req: any, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const user = req.user as any;
    const userId = req.auth?.userId ?? user?.clerkUserId ?? null;
    const isFounder = isFounderIdentity({ email: user?.email, userId });
    // Phase 3 Week 11: emit auth.login on the first hit-after-sign-in for
    // each userId in this process. Subsequent polls are deduped by the
    // in-memory set; persistent login telemetry remains the responsibility
    // of Clerk webhooks. Best-effort, fire-and-forget — never blocks.
    if (userId && !loggedLoginThisProcess.has(userId)) {
      loggedLoginThisProcess.add(userId);
      void auditFromRequest(req, {
        action: AuditActions.AUTH_LOGIN,
        target: { type: "user", id: userId },
        metadata: { isFounder },
      });
    }
    res.json(isFounder ? { ...user, isFounder: true } : user);
  });

  // Founder-only existence probe. Returns 200 with { isFounder: true } for
  // founders; returns 404 (NOT 403) for everyone else so non-founders cannot
  // distinguish "endpoint exists but I lack access" from "endpoint missing".
  // Used by useIsFounder() on the client to gate founder-only UI.
  app.get("/api/auth/is-founder", isAuthenticated, requireFounder, (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.json({ isFounder: true });
  });

  // UTM attribution stub — kept for API compatibility; UTM tracking
  // can be re-implemented via Clerk user metadata when needed.
  app.post("/api/auth/attribution", (_req, res) => {
    res.json({ ok: true });
  });

  // Sign out: clear every Clerk session cookie on this response so a
  // subsequent __clerk_ticket sign-in truly takes effect. Clerk stamps
  // session cookies as `__session`, `__session_<suffix>`, `__client`,
  // `__client_uat`, and `__client_uat_<suffix>`. We can't enumerate
  // them from the request body alone (they're HttpOnly so the client
  // can't read the names either), so we clear the canonical names plus
  // any header-visible name that matches the prefix.
  app.post("/api/auth/logout", (req, res) => {
    const cookieHeader = req.headers.cookie || "";
    const seen = new Set<string>();
    for (const part of cookieHeader.split(";")) {
      const name = part.split("=")[0]?.trim();
      if (!name) continue;
      if (
        name === "__session" ||
        name === "__client" ||
        name === "__client_uat" ||
        name.startsWith("__session_") ||
        name.startsWith("__client_uat_") ||
        name.startsWith("__clerk_") ||
        name === "csrf_token"
      ) {
        seen.add(name);
      }
    }
    const opts = { path: "/" } as const;
    for (const name of seen) {
      res.clearCookie(name, opts);
      res.clearCookie(name, { path: "/", domain: ".acreos.io" });
    }
    // Phase 3 Week 11 — log the logout intent. The endpoint is not
    // isAuthenticated-gated, so the user object may be absent; in that
    // case we record the row as anonymous. Clerk webhooks remain the
    // authoritative source for session lifecycle.
    const userForLogout = (req as any).user as { clerkUserId?: string; id?: string } | undefined;
    const logoutTarget = userForLogout?.clerkUserId ?? userForLogout?.id ?? "anonymous";
    if (userForLogout?.clerkUserId) {
      loggedLoginThisProcess.delete(userForLogout.clerkUserId);
    }
    void auditFromRequest(req, {
      action: AuditActions.AUTH_LOGOUT,
      target: { type: "user", id: logoutTarget },
      metadata: { clearedCookies: Array.from(seen) },
    });
    res.json({ ok: true, cleared: Array.from(seen) });
  });

  /**
   * Reyna §2 — VAs work multiple orgs. List every active organization the
   * authenticated user is a verified member of (owner OR active team_member
   * row), so the topbar org-switcher can render real choices instead of
   * forcing them to log out + back in (8-12 min nightly cost).
   *
   * Returns: [{ id, name, slug, role, isActive }]
   */
  app.get("/api/auth/organizations", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user as any;
      const userId = user?.id as string | undefined;
      if (!userId) return Errors.unauthorized(res);

      // Two membership paths — ownership or an active team_members row.
      // Only surface orgs where the user is currently active; deactivated
      // seats must NOT appear in the switcher (Reyna §2 acceptance).
      const memberships = await db
        .select({
          organizationId: teamMembers.organizationId,
          role: teamMembers.role,
          isActive: teamMembers.isActive,
        })
        .from(teamMembers)
        .where(and(eq(teamMembers.userId, userId), eq(teamMembers.isActive, true)));

      const orgIds = Array.from(
        new Set(memberships.map((m) => m.organizationId).filter((id): id is number => typeof id === "number"))
      );

      const ownedOrgs = await db
        .select()
        .from(organizations)
        .where(eq(organizations.ownerId, userId));

      const memberOrgs = orgIds.length
        ? await db.select().from(organizations).where(inArray(organizations.id, orgIds))
        : [];

      const byId = new Map<number, any>();
      for (const o of ownedOrgs) byId.set(o.id, { ...o, role: "owner" });
      for (const o of memberOrgs) {
        const role = memberships.find((m) => m.organizationId === o.id)?.role ?? "member";
        if (!byId.has(o.id)) byId.set(o.id, { ...o, role });
      }

      const list = Array.from(byId.values()).map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        role: o.role,
        isOwner: o.ownerId === userId,
      }));

      // Mark the currently-active org so the topbar can highlight it.
      const activeId = req.organizationId ?? null;
      res.json({ organizations: list, activeOrganizationId: activeId });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  /**
   * Reyna §2 — switch the active organization for this session. The chosen
   * org is stored in a signed cookie that `getOrCreateOrg` consults on every
   * subsequent request; the middleware re-verifies the user is still an
   * active member of that org before honoring the cookie, so a revoked seat
   * cannot keep operating in someone else's org by holding onto the cookie.
   *
   * Body: { organizationId: number }
   */
  app.post("/api/auth/switch-organization", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user as any;
      const userId = user?.id as string | undefined;
      if (!userId) return Errors.unauthorized(res);

      const orgIdRaw = req.body?.organizationId;
      const orgId = typeof orgIdRaw === "number" ? orgIdRaw : Number(orgIdRaw);
      if (!Number.isFinite(orgId) || orgId <= 0) {
        return Errors.badRequest(res, "organizationId must be a positive integer");
      }

      // Verify the user is currently an active member of the target org.
      // Either they own it, or they have an active team_members row.
      const [ownedOrg] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.id, orgId), eq(organizations.ownerId, userId)))
        .limit(1);

      let allowed = !!ownedOrg;

      if (!allowed) {
        const [member] = await db
          .select()
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.organizationId, orgId),
              eq(teamMembers.userId, userId),
              eq(teamMembers.isActive, true),
            ),
          )
          .limit(1);
        allowed = !!member;
      }

      if (!allowed) {
        return Errors.forbidden(res, "You are not a verified member of that organization");
      }

      res.cookie(ACTIVE_ORG_COOKIE, String(orgId), ACTIVE_ORG_COOKIE_OPTS);
      logger.info("Active organization switched", {
        source: "switchOrganization",
        metadata: { userId, orgId },
      });
      res.json({ ok: true, activeOrganizationId: orgId });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
