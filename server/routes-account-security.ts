/**
 * RS-4 (post-may1-resweep): customer-side `/account/security` surface.
 *
 * The founder console (`server/routes-admin-recovery.ts`) lets support
 * staff revoke sessions, reset 2FA, freeze autopay. RS-4 ships the
 * customer-facing twin so an Asher-type incident can be self-served at
 * hour 1 instead of escalated at hour 6.
 *
 * Endpoints (all gated to the requesting user only — never arbitrary :id):
 *   GET    /api/account/sessions        — list this user's Clerk sessions
 *   POST   /api/account/sessions/:sid/revoke — revoke one session
 *   POST   /api/account/sessions/revoke-others — revoke all except current
 *   GET    /api/account/security/summary — 2FA enrolled? recent logins?
 *                                          stale-attestation? export rate-
 *                                          limit headroom?
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { users } from "@shared/schema";
import { chainAndInsertAuditEvent } from "./utils/auditEventsChain";
import { eq } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId, getOrganizationId } from "./types/request";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";

let clerkClient: any = null;
async function getClerk() {
  if (clerkClient) return clerkClient;
  try {
    const mod = await import("@clerk/express");
    clerkClient = mod.clerkClient;
  } catch (err) {
    logger.warn("[account-security] @clerk/express not available", err instanceof Error ? err : undefined);
  }
  return clerkClient;
}

async function writeSelfAuditEvent(
  req: AuthenticatedRequest,
  opts: { action: string; metadata?: Record<string, unknown>; targetId?: string },
): Promise<void> {
  try {
    const userId = getUserId(req);
    const orgId = getOrganizationId(req);
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    await chainAndInsertAuditEvent({
      actorUserId: userId,
      actorEmail: u?.email ?? null,
      action: opts.action,
      targetType: "user",
      targetId: opts.targetId ?? userId,
      metadata: { ...(opts.metadata ?? {}), organizationId: orgId },
      ip: req.ip ?? null,
      userAgent: (req.headers["user-agent"] as string) ?? null,
    });
  } catch (err) {
    logger.warn(`[account-security] audit write failed for ${opts.action}`, err instanceof Error ? err : undefined);
  }
}

export function registerAccountSecurityRoutes(app: Express): void {
  // GET /api/account/sessions — list the requesting user's own Clerk sessions.
  app.get(
    "/api/account/sessions",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = getUserId(req);
        const [localUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!localUser) return Errors.notFound(res, "User");

        let sessions: Array<{
          sessionId: string;
          createdAt: string | null;
          lastActiveAt: string | null;
          ip: string | null;
          userAgent: string | null;
          status: string | null;
          isCurrent: boolean;
        }> = [];

        if (localUser.clerkUserId) {
          const clerk = await getClerk();
          if (clerk) {
            try {
              const list = await clerk.sessions.getSessionList({ userId: localUser.clerkUserId });
              const arr = Array.isArray(list) ? list : list?.data ?? [];
              const currentSessionId = (req as any).auth?.sessionId ?? null;
              sessions = arr.map((s: any) => ({
                sessionId: s.id,
                createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
                lastActiveAt: s.lastActiveAt ? new Date(s.lastActiveAt).toISOString() : null,
                ip: s.lastActiveIp ?? s.clientIp ?? null,
                userAgent: s.lastActiveUserAgent ?? s.userAgent ?? null,
                status: s.status ?? null,
                isCurrent: s.id === currentSessionId,
              }));
            } catch (err) {
              logger.error("[account-security] Clerk getSessionList failed", err as Error);
              return Errors.internal(res, err);
            }
          }
        }

        await writeSelfAuditEvent(req, {
          action: "account.sessions_list",
          metadata: { count: sessions.length },
        });
        return res.json({ sessions });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/account/sessions/:sid/revoke — revoke one session.
  // Operator can revoke any of their OWN sessions including current.
  app.post(
    "/api/account/sessions/:sid/revoke",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = getUserId(req);
        const sessionId = req.params.sid;
        const [localUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!localUser?.clerkUserId) return Errors.notFound(res, "User");

        const clerk = await getClerk();
        if (!clerk) return sendError(res, 501, "NOT_IMPLEMENTED", "Clerk SDK not available");

        // Verify the session belongs to THIS user before revoking.
        let sessionUserId: string | null = null;
        try {
          const session = await clerk.sessions.getSession(sessionId);
          sessionUserId = session?.userId ?? null;
        } catch {/* fall through */}
        if (sessionUserId !== localUser.clerkUserId) {
          return Errors.forbidden(res, "You can only revoke your own sessions");
        }

        try {
          await clerk.sessions.revokeSession(sessionId);
        } catch (err) {
          logger.error("[account-security] revokeSession failed", err as Error);
          return Errors.internal(res, err);
        }

        await writeSelfAuditEvent(req, {
          action: "account.session_revoked",
          metadata: { sessionId },
        });
        return res.json({ revoked: true, sessionId });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/account/sessions/revoke-others — revoke all except the current.
  app.post(
    "/api/account/sessions/revoke-others",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = getUserId(req);
        const currentSessionId = (req as any).auth?.sessionId ?? null;
        const [localUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!localUser?.clerkUserId) return Errors.notFound(res, "User");

        const clerk = await getClerk();
        if (!clerk) return sendError(res, 501, "NOT_IMPLEMENTED", "Clerk SDK not available");

        let revoked = 0;
        let skipped = 0;
        let failed = 0;
        try {
          const list = await clerk.sessions.getSessionList({ userId: localUser.clerkUserId });
          const arr = Array.isArray(list) ? list : list?.data ?? [];
          for (const s of arr) {
            if (s.id === currentSessionId) { skipped++; continue; }
            if (s.status && s.status !== "active") { skipped++; continue; }
            try {
              await clerk.sessions.revokeSession(s.id);
              revoked++;
            } catch {
              failed++;
            }
          }
        } catch (err) {
          logger.error("[account-security] revoke-others failed", err as Error);
          return Errors.internal(res, err);
        }

        await writeSelfAuditEvent(req, {
          action: "account.sessions_revoke_others",
          metadata: { revoked, skipped, failed },
        });
        return res.json({ revoked, skipped, failed });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/account/role-scopes — return the requesting user's effective
  // scopes (panel-300 #8). Lets the UI hide what the user can't use.
  app.get(
    "/api/account/role-scopes",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { hasRoleScope } = await import("./middleware/roleScope");
        const allScopes: Array<
          | "financial_read" | "financial_write"
          | "tenant_pii_read" | "tenant_pii_write"
          | "deal_read" | "deal_write"
          | "comms_read" | "comms_write"
          | "settings_write" | "audit_read"
          | "annotation_only"
        > = [
          "financial_read", "financial_write",
          "tenant_pii_read", "tenant_pii_write",
          "deal_read", "deal_write",
          "comms_read", "comms_write",
          "settings_write", "audit_read",
          "annotation_only",
        ];
        const effective: Record<string, boolean> = {};
        for (const s of allScopes) {
          effective[s] = await hasRoleScope(req, s);
        }
        return res.json({ scopes: effective });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/account/security/summary — at-a-glance security posture.
  app.get(
    "/api/account/security/summary",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const userId = getUserId(req);
        const orgId = getOrganizationId(req);
        const [localUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!localUser) return Errors.notFound(res, "User");

        let twoFactorEnabled = false;
        let lastSignInAt: string | null = null;
        if (localUser.clerkUserId) {
          const clerk = await getClerk();
          if (clerk) {
            try {
              const u = await clerk.users.getUser(localUser.clerkUserId);
              twoFactorEnabled = Boolean(u?.twoFactorEnabled);
              lastSignInAt = u?.lastSignInAt ? new Date(u.lastSignInAt).toISOString() : null;
            } catch {/* fall through */}
          }
        }

        // FCRA stale-attestation flag (RS-1 interaction).
        let fcraAttestationStale: boolean | null = null;
        try {
          const { getCurrentAttestation } = await import("./services/fcraAttestation");
          const att = await getCurrentAttestation(orgId, userId);
          fcraAttestationStale = !att;
        } catch {/* leave null */}

        return res.json({
          userId,
          email: localUser.email,
          twoFactorEnabled,
          lastSignInAt,
          fcraAttestationStale,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
