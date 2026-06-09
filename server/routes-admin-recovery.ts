/**
 * Admin Recovery Console — Backend Endpoints (Coriander §1)
 *
 * Founder-only admin recovery surfaces for cases where customers have lost
 * access to their account (lost 2FA device, locked out, original owner died,
 * autopay charged after death, etc.). Every endpoint:
 *
 *   - Requires founder identity (email or Clerk user-id match).
 *   - Validates body with Zod.
 *   - Returns structured errors via Errors.* helpers.
 *   - Writes an immutable row to audit_events (7-year retention).
 *
 * UI ships in Week 13 — this module is BACKEND ONLY.
 *
 * Endpoints (all under /api/admin):
 *   POST  /users/:id/2fa/reset                    — disable user MFA after identity proof
 *   GET   /users/:id/sessions                     — list active sessions for a user
 *   POST  /users/:id/sessions/:sid/revoke         — revoke a single session
 *   POST  /users/:id/sessions/revoke-all-others   — revoke all but admin's session
 *   POST  /orgs/:id/freeze-autopay                — pause Stripe collection on org
 *   POST  /orgs/:id/transfer-ownership            — transfer organizations.ownerId
 *   POST  /users/:id/password-reset-link          — generate Clerk reset link
 *
 * Clerk SDK: uses `@clerk/express` createClerkClient (already in package.json
 * and configured elsewhere in the codebase). When a Clerk admin operation
 * is unavailable in the current SDK surface, the handler throws a 501-style
 * "Clerk admin API not yet wired" error so ops can patch in the SDK call
 * without changing the handler shape.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { createClerkClient } from "@clerk/express";
import { eq, desc, ilike, or, inArray } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "./db";
import { STRIPE_API_VERSION } from "./stripeClient";
import { auditEvents, organizations } from "@shared/schema";
import { chainAndInsertAuditEvent } from "./utils/auditEventsChain";
import { users } from "@shared/models/auth";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";

// ─── Clerk client (lazy, env-driven) ──────────────────────────────────────────
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

// ─── Stripe client (lazy, optional) ───────────────────────────────────────────
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

// ─── Zod request bodies ──────────────────────────────────────────────────────
const reset2faSchema = z.object({
  identityProofType: z.enum(["video_call", "court_doc", "id_photo"]),
  proofRefId: z.string().min(1).max(500),
  justification: z.string().min(10).max(2000),
});

const revokeAllOthersSchema = z.object({
  exceptCurrentAdminSessionId: z.string().min(1).max(200),
});

const freezeAutopaySchema = z.object({
  reason: z.string().min(1).max(2000),
  untilDate: z.string().datetime().optional(),
});

const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().min(1).max(200),
  courtDocumentS3Key: z.string().max(500).optional(),
  justification: z.string().min(10).max(2000),
});

// ─── Founder gate ────────────────────────────────────────────────────────────
/**
 * Returns true and writes nothing to the response if caller is a founder.
 * Returns false and writes a 403 if not. Handlers should `return` immediately
 * when this returns false.
 */
export function requireFounderForRecovery(req: AuthenticatedRequest, res: Response): boolean {
  const user = req.user as any;
  const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;

  if (!isFounderIdentity({ email, userId })) {
    Errors.forbidden(res, "Founder access required");
    return false;
  }
  return true;
}

// ─── Audit-event writer ──────────────────────────────────────────────────────
async function writeAuditEvent(
  req: AuthenticatedRequest,
  entry: {
    action: string;
    targetType: "user" | "organization" | "session";
    targetId: string;
    justification?: string;
    metadata?: Record<string, any>;
  }
): Promise<void> {
  try {
    const user = req.user as any;
    const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
    const email = user?.email ?? null;
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.socket?.remoteAddress ??
      null;
    const userAgent = (req.headers["user-agent"] as string) ?? null;

    await chainAndInsertAuditEvent({
      actorUserId: userId,
      actorEmail: email,
      action: entry.action,
      targetType: entry.targetType,
      targetId: String(entry.targetId),
      justification: entry.justification ?? null,
      metadata: entry.metadata ?? {},
      ip,
      userAgent,
    });
  } catch (err) {
    // Audit logging must never crash the request — log and continue.
    logger.error("[admin-recovery] audit_events write failed", err as Error);
  }
}

// ─── Clerk gap helper ────────────────────────────────────────────────────────
/**
 * Throws a structured error when a Clerk admin operation is not yet wired
 * via the available SDK surface. Caller catches and returns a 501.
 */
class ClerkGapError extends Error {
  constructor(public method: string) {
    super(`Clerk admin API not yet wired: ${method}`);
    this.name = "ClerkGapError";
  }
}

function isClerkGap(err: unknown): err is ClerkGapError {
  return err instanceof ClerkGapError;
}

// ─── Route registration ──────────────────────────────────────────────────────
export function registerAdminRecoveryRoutes(app: Express): void {
  // NOTE: GET /api/admin/users/search MUST be registered before any
  // /api/admin/users/:id/* route, otherwise Express resolves :id="search".
  // The same goes for /api/admin/recovery/audit — keep these listed first.

  // ── GET /api/admin/users/search?q=... ────────────────────────────────────
  app.get(
    "/api/admin/users/search",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const q = String(req.query.q ?? "").trim();
      if (!q || q.length < 2) {
        return res.json({ results: [] });
      }

      try {
        const rows = await db
          .select({
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            clerkUserId: users.clerkUserId,
          })
          .from(users)
          .where(
            or(
              eq(users.id, q),
              eq(users.clerkUserId, q),
              ilike(users.email, `%${q}%`)
            )
          )
          .limit(25);

        return res.json({ results: rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ── GET /api/admin/recovery/audit?limit=N ────────────────────────────────
  app.get(
    "/api/admin/recovery/audit",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(String(req.query.limit ?? "25"), 10) || 25)
      );

      try {
        const RECOVERY_ACTIONS = [
          "recovery.2fa_reset",
          "recovery.sessions_list",
          "recovery.session_revoke",
          "recovery.sessions_revoke_all_others",
          "recovery.autopay_freeze",
          "recovery.ownership_transfer",
          "recovery.password_reset_link",
        ];

        const rows = await db
          .select()
          .from(auditEvents)
          .where(inArray(auditEvents.action, RECOVERY_ACTIONS))
          .orderBy(desc(auditEvents.createdAt))
          .limit(limit);

        return res.json({ events: rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ── POST /api/admin/users/:id/2fa/reset ──────────────────────────────────
  app.post(
    "/api/admin/users/:id/2fa/reset",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const parsed = reset2faSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const targetUserId = req.params.id;
      const body = parsed.data;

      try {
        // 1. Look up the local user record so we can resolve their Clerk id.
        const [localUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, String(targetUserId)))
          .limit(1);

        if (!localUser) {
          return Errors.notFound(res, "User");
        }

        // 2. R4: In-house 2FA columns (twoFactorEnabled / twoFactorSecret /
        //    twoFactorBackupCodes) were never persisted to the users table —
        //    the legacy code wrote through `as any` to a column set that
        //    doesn't exist in shared/models/auth.ts. MFA state now lives
        //    exclusively in Clerk (see requireClerkMFA middleware), so the
        //    only thing left to clear here is Clerk's own factor list.

        // 3. Disable Clerk MFA factors. The Clerk JS SDK exposes per-factor
        //    delete endpoints; we iterate and remove every TOTP / phone /
        //    backup-code factor on the user.
        const clerkResults: Record<string, any> = {};
        if (localUser.clerkUserId) {
          try {
            // The @clerk/express client exposes users.updateUser but does
            // NOT expose a single "disable all MFA" call. We emulate it by
            // (a) fetching the user, (b) calling deleteMfa where supported
            // by the SDK surface. If the SDK lacks this, we record the gap.
            const clerkUser = await clerkClient.users.getUser(localUser.clerkUserId);
            clerkResults.clerkUserId = clerkUser.id;

            const anyClient = clerkClient as any;
            if (typeof anyClient.users?.disableMFA === "function") {
              const r = await anyClient.users.disableMFA(localUser.clerkUserId);
              clerkResults.disableMFA = r ?? "ok";
            } else {
              // SDK gap — surface as a non-fatal warning. The local 2FA flag
              // has already been cleared above, which prevents our app from
              // requiring the code; the Clerk-side factor will need to be
              // disabled manually via the Clerk dashboard or REST API until
              // the SDK exposes disableMFA. Tracked: CORIANDER-CLERK-GAP.
              clerkResults.disableMFA = "SDK_GAP";
              logger.warn(
                "[admin-recovery] Clerk SDK does not expose users.disableMFA — manual dashboard step required",
                { targetUserId, clerkUserId: localUser.clerkUserId }
              );
            }
          } catch (clerkErr) {
            logger.error(
              "[admin-recovery] Clerk MFA reset call failed",
              clerkErr as Error
            );
            clerkResults.error = (clerkErr as Error).message;
          }
        }

        await writeAuditEvent(areq, {
          action: "recovery.2fa_reset",
          targetType: "user",
          targetId: targetUserId,
          justification: body.justification,
          metadata: {
            identityProofType: body.identityProofType,
            proofRefId: body.proofRefId,
            clerkResults,
          },
        });

        return res.status(200).json({
          success: true,
          targetUserId,
          clerkResults,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ── GET /api/admin/users/:id/sessions ────────────────────────────────────
  app.get(
    "/api/admin/users/:id/sessions",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const targetUserId = req.params.id;

      try {
        const [localUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, String(targetUserId)))
          .limit(1);

        if (!localUser) return Errors.notFound(res, "User");

        let sessions: Array<{
          sessionId: string;
          createdAt: string | null;
          lastActiveAt: string | null;
          ip: string | null;
          userAgent: string | null;
          status: string | null;
        }> = [];

        if (localUser.clerkUserId) {
          const anyClient = clerkClient as any;
          try {
            // @clerk/express exposes sessions.getSessionList({ userId })
            const list = await anyClient.sessions.getSessionList({
              userId: localUser.clerkUserId,
            });
            const arr = Array.isArray(list) ? list : list?.data ?? [];
            sessions = arr.map((s: any) => ({
              sessionId: s.id,
              createdAt: s.createdAt
                ? new Date(s.createdAt).toISOString()
                : null,
              lastActiveAt: s.lastActiveAt
                ? new Date(s.lastActiveAt).toISOString()
                : null,
              ip: s.lastActiveIp ?? s.clientIp ?? null,
              userAgent: s.lastActiveUserAgent ?? s.userAgent ?? null,
              status: s.status ?? null,
            }));
          } catch (clerkErr) {
            logger.error(
              "[admin-recovery] Clerk getSessionList failed",
              clerkErr as Error
            );
            return Errors.internal(res, clerkErr);
          }
        }

        await writeAuditEvent(areq, {
          action: "recovery.sessions_list",
          targetType: "user",
          targetId: targetUserId,
          metadata: { count: sessions.length },
        });

        return res.json(sessions);
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ── POST /api/admin/users/:id/sessions/:sid/revoke ───────────────────────
  app.post(
    "/api/admin/users/:id/sessions/:sid/revoke",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const targetUserId = req.params.id;
      const sessionId = req.params.sid;

      try {
        const [localUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, String(targetUserId)))
          .limit(1);

        if (!localUser) return Errors.notFound(res, "User");

        const anyClient = clerkClient as any;
        let revokeResult: any = null;
        try {
          if (typeof anyClient.sessions?.revokeSession === "function") {
            revokeResult = await anyClient.sessions.revokeSession(sessionId);
          } else {
            throw new ClerkGapError("sessions.revokeSession");
          }
        } catch (clerkErr) {
          if (isClerkGap(clerkErr)) {
            logger.warn("[admin-recovery] Clerk SDK gap on revokeSession", {
              sessionId,
            });
            await writeAuditEvent(areq, {
              action: "recovery.session_revoke",
              targetType: "session",
              targetId: sessionId,
              metadata: {
                targetUserId,
                clerkResult: "SDK_GAP",
              },
            });
            return res.status(501).json({
              error: "NOT_IMPLEMENTED",
              message: "Clerk admin API not yet wired: sessions.revokeSession",
              statusCode: 501,
            });
          }
          logger.error(
            "[admin-recovery] Clerk revokeSession failed",
            clerkErr as Error
          );
          return Errors.internal(res, clerkErr);
        }

        await writeAuditEvent(areq, {
          action: "recovery.session_revoke",
          targetType: "session",
          targetId: sessionId,
          metadata: { targetUserId, clerkResult: revokeResult ?? "ok" },
        });

        return res.json({ success: true, sessionId });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ── POST /api/admin/users/:id/sessions/revoke-all-others ─────────────────
  app.post(
    "/api/admin/users/:id/sessions/revoke-all-others",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const parsed = revokeAllOthersSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { exceptCurrentAdminSessionId } = parsed.data;
      const targetUserId = req.params.id;

      try {
        const [localUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, String(targetUserId)))
          .limit(1);

        if (!localUser) return Errors.notFound(res, "User");

        if (!localUser.clerkUserId) {
          return Errors.badRequest(
            res,
            "User has no Clerk identity — cannot revoke sessions"
          );
        }

        const anyClient = clerkClient as any;
        const revoked: string[] = [];
        const skipped: string[] = [];
        const failed: Array<{ sessionId: string; error: string }> = [];

        try {
          const list = await anyClient.sessions.getSessionList({
            userId: localUser.clerkUserId,
          });
          const arr = Array.isArray(list) ? list : list?.data ?? [];

          for (const s of arr) {
            if (s.id === exceptCurrentAdminSessionId) {
              skipped.push(s.id);
              continue;
            }
            try {
              if (typeof anyClient.sessions?.revokeSession === "function") {
                await anyClient.sessions.revokeSession(s.id);
                revoked.push(s.id);
              } else {
                throw new ClerkGapError("sessions.revokeSession");
              }
            } catch (e) {
              if (isClerkGap(e)) {
                failed.push({ sessionId: s.id, error: "SDK_GAP" });
              } else {
                failed.push({
                  sessionId: s.id,
                  error: (e as Error).message,
                });
              }
            }
          }
        } catch (clerkErr) {
          logger.error(
            "[admin-recovery] revoke-all-others list failed",
            clerkErr as Error
          );
          return Errors.internal(res, clerkErr);
        }

        await writeAuditEvent(areq, {
          action: "recovery.sessions_revoke_all_others",
          targetType: "user",
          targetId: targetUserId,
          metadata: {
            exceptCurrentAdminSessionId,
            revoked,
            skipped,
            failed,
          },
        });

        return res.json({
          success: true,
          revokedCount: revoked.length,
          revoked,
          skipped,
          failed,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ── POST /api/admin/orgs/:id/freeze-autopay ──────────────────────────────
  app.post(
    "/api/admin/orgs/:id/freeze-autopay",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const parsed = freezeAutopaySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { reason, untilDate } = parsed.data;
      const orgId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(orgId)) {
        return Errors.badRequest(res, "Invalid organization id");
      }

      try {
        const [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        if (!org) return Errors.notFound(res, "Organization");

        const stripeResults: Record<string, any> = {};
        const stripe = getStripe();
        if (stripe && org.stripeSubscriptionId) {
          try {
            // Pause Stripe collection by switching to send_invoice. This
            // stops the auto-charge while leaving the subscription active.
            const sub = await stripe.subscriptions.update(
              org.stripeSubscriptionId,
              {
                collection_method: "send_invoice",
                days_until_due: 30,
              }
            );
            stripeResults.subscriptionId = sub.id;
            stripeResults.collectionMethod = sub.collection_method;
          } catch (stripeErr) {
            logger.error(
              "[admin-recovery] Stripe freeze-autopay failed",
              stripeErr as Error
            );
            stripeResults.error = (stripeErr as Error).message;
          }
        } else if (!stripe) {
          stripeResults.error = "STRIPE_SDK_NOT_CONFIGURED";
        } else {
          stripeResults.error = "NO_SUBSCRIPTION";
        }

        const until = untilDate ? new Date(untilDate) : null;
        await db
          .update(organizations)
          .set({
            autopayFrozen: true,
            autopayFrozenAt: new Date(),
            autopayFrozenReason: reason,
            autopayFrozenUntil: until,
          } as any)
          .where(eq(organizations.id, orgId));

        await writeAuditEvent(areq, {
          action: "recovery.autopay_freeze",
          targetType: "organization",
          targetId: String(orgId),
          justification: reason,
          metadata: { untilDate: untilDate ?? null, stripeResults },
        });

        return res.json({
          success: true,
          orgId,
          autopayFrozen: true,
          stripeResults,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ── POST /api/admin/orgs/:id/transfer-ownership ──────────────────────────
  app.post(
    "/api/admin/orgs/:id/transfer-ownership",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const parsed = transferOwnershipSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { newOwnerUserId, courtDocumentS3Key, justification } = parsed.data;
      const orgId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(orgId)) {
        return Errors.badRequest(res, "Invalid organization id");
      }

      try {
        const [org] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);

        if (!org) return Errors.notFound(res, "Organization");

        // Verify the new owner exists in our users table.
        const [newOwner] = await db
          .select()
          .from(users)
          .where(eq(users.id, String(newOwnerUserId)))
          .limit(1);

        if (!newOwner) {
          return Errors.badRequest(res, "New owner user not found", {
            newOwnerUserId,
          });
        }

        const oldOwnerId = org.ownerId;
        const [oldOwner] = oldOwnerId
          ? await db
              .select()
              .from(users)
              .where(eq(users.id, String(oldOwnerId)))
              .limit(1)
          : [];

        await db
          .update(organizations)
          .set({ ownerId: String(newOwnerUserId) } as any)
          .where(eq(organizations.id, orgId));

        // Best-effort emails to old + new owner. Failures must not roll
        // back the transfer — we audit-log either outcome.
        const emailResults: Record<string, any> = {};
        try {
          const { emailService } = await import("./services/emailService");
          if (oldOwner?.email) {
            const oldHtml =
              `<p>Your AcreOS organization "<strong>${org.name}</strong>" ` +
              `has been transferred to a new owner by AcreOS support. ` +
              `If you did not expect this, please reply immediately.</p>` +
              `<p><em>Reason on file:</em> ${justification}</p>`;
            const r = await emailService.sendEmail({
              to: oldOwner.email,
              subject: "AcreOS account ownership transferred",
              html: oldHtml,
              transactional: true, // security/account notice — not commercial
            });
            emailResults.oldOwner = r?.success ? "sent" : r?.error ?? "failed";
          } else {
            emailResults.oldOwner = "no_email_on_file";
          }
          if (newOwner.email) {
            const newHtml =
              `<p>You have been granted ownership of AcreOS organization ` +
              `"<strong>${org.name}</strong>". Sign in to begin managing it.</p>`;
            const r = await emailService.sendEmail({
              to: newOwner.email,
              subject: "You are now the owner of an AcreOS organization",
              html: newHtml,
              transactional: true, // security/account notice — not commercial
            });
            emailResults.newOwner = r?.success ? "sent" : r?.error ?? "failed";
          } else {
            emailResults.newOwner = "no_email_on_file";
          }
        } catch (emailErr) {
          logger.error(
            "[admin-recovery] transfer-ownership email failed",
            emailErr as Error
          );
          emailResults.error = (emailErr as Error).message;
        }

        await writeAuditEvent(areq, {
          action: "recovery.ownership_transfer",
          targetType: "organization",
          targetId: String(orgId),
          justification,
          metadata: {
            oldOwnerId,
            newOwnerUserId,
            courtDocumentS3Key: courtDocumentS3Key ?? null,
            emailResults,
          },
        });

        return res.json({
          success: true,
          orgId,
          oldOwnerId,
          newOwnerId: newOwnerUserId,
          emailResults,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );

  // ── POST /api/admin/users/:id/password-reset-link ────────────────────────
  app.post(
    "/api/admin/users/:id/password-reset-link",
    isAuthenticated,
    async (req, res) => {
      const areq = req as AuthenticatedRequest;
      if (!requireFounderForRecovery(areq, res)) return;

      const targetUserId = req.params.id;

      try {
        const [localUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, String(targetUserId)))
          .limit(1);

        if (!localUser) return Errors.notFound(res, "User");
        if (!localUser.clerkUserId) {
          return Errors.badRequest(
            res,
            "User has no Clerk identity — cannot generate reset link"
          );
        }

        const anyClient = clerkClient as any;
        let url: string | null = null;
        let clerkGap = false;
        try {
          // Clerk supports POST /v1/sign_in_tokens for admin-initiated sign-in.
          // The @clerk/express SDK exposes this via signInTokens.createSignInToken.
          // We treat that as the canonical "magic link" / reset entry.
          if (
            typeof anyClient.signInTokens?.createSignInToken === "function"
          ) {
            const token = await anyClient.signInTokens.createSignInToken({
              userId: localUser.clerkUserId,
              expiresInSeconds: 60 * 60, // 1 hour
            });
            url =
              token?.url ??
              token?.token ??
              null;
            if (!url && token?.token) {
              const base =
                process.env.CLERK_FRONTEND_API ??
                process.env.PUBLIC_BASE_URL ??
                "https://acreos.io";
              url = `${base}/sign-in?__clerk_ticket=${token.token}`;
            }
          } else {
            clerkGap = true;
          }
        } catch (clerkErr) {
          logger.error(
            "[admin-recovery] Clerk createSignInToken failed",
            clerkErr as Error
          );
          return Errors.internal(res, clerkErr);
        }

        await writeAuditEvent(areq, {
          action: "recovery.password_reset_link",
          targetType: "user",
          targetId: targetUserId,
          metadata: {
            clerkUserId: localUser.clerkUserId,
            clerkResult: clerkGap ? "SDK_GAP" : "ok",
          },
        });

        if (clerkGap) {
          return res.status(501).json({
            error: "NOT_IMPLEMENTED",
            message:
              "Clerk admin API not yet wired: signInTokens.createSignInToken",
            statusCode: 501,
          });
        }

        return res.json({ url });
      } catch (err) {
        return Errors.internal(res, err);
      }
    }
  );
}
