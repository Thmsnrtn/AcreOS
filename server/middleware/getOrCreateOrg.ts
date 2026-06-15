import type { Request, Response, NextFunction, CookieOptions } from "express";
import { storage, db } from "../storage";
import { withTransaction } from "../db";
import { and, eq, gt } from "drizzle-orm";
import { organizations, teamMembers } from "@shared/schema";
import { signupSignals } from "@shared/schema";
import crypto from "crypto";
import { logger } from "../utils/logger";
import { Errors } from "../utils/errors";
import { signupLimiter } from "./authPathLimits";
import { computeReqIpBucket, recordSignalsNotEmitted } from "./botSignals";
import { subscriptionPauseGate } from "./subscriptionPauseGate";

/**
 * Cookie name + options for the per-session "active organization" override.
 * Set by POST /api/auth/switch-organization (Reyna §2 — VA workflow).
 * httpOnly so JS can't read it; sameSite=lax so it survives in-app navigation
 * but won't leak on cross-site POSTs; 30-day TTL so the user's choice
 * survives logout cycles.
 */
export const ACTIVE_ORG_COOKIE = "acreos_active_org";
export const ACTIVE_ORG_COOKIE_OPTS: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

/**
 * Founder email — gets enterprise tier and unlimited access.
 * Reads FOUNDER_EMAIL (single) and/or FOUNDER_EMAILS (comma-separated),
 * matching the same logic as server/services/founder.ts.
 */
const _founderPrimary = (process.env.FOUNDER_EMAIL || "").trim().toLowerCase();
const _founderAdditional = (process.env.FOUNDER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const FOUNDER_EMAILS = [...new Set([_founderPrimary, ..._founderAdditional].filter(Boolean))];

function isFounderEmail(email: string | undefined): boolean {
  if (!email) return false;
  return FOUNDER_EMAILS.includes(email.toLowerCase());
}

/**
 * Middleware to get or create an organization for the authenticated user.
 * Attaches `req.organization` and `req.organizationId` for downstream handlers.
 *
 * Must be placed AFTER `isAuthenticated` in the middleware chain.
 */
export async function getOrCreateOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = req.user as any;
  const userId = user.id;
  const userEmail = user.email;

  if (!userId) {
    logger.warn("No user ID found in session", { source: "getOrCreateOrg" });
    return res.status(401).json({ message: "Invalid user session" });
  }

  const isFounder = isFounderEmail(userEmail);

  let org: any = undefined;

  // Reyna §2 — honor the active-org cookie set by /api/auth/switch-organization,
  // but only if the user is still a verified active member of that org.
  // A revoked seat cannot keep operating in someone else's org by holding
  // onto a stale cookie.
  const activeOrgCookieRaw = (req as any).cookies?.[ACTIVE_ORG_COOKIE];
  const activeOrgCookieId = activeOrgCookieRaw ? Number(activeOrgCookieRaw) : NaN;
  if (Number.isFinite(activeOrgCookieId) && activeOrgCookieId > 0) {
    try {
      const [candidate] = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, activeOrgCookieId))
        .limit(1);
      if (candidate) {
        if (candidate.ownerId === userId) {
          org = candidate;
        } else {
          const [member] = await db
            .select()
            .from(teamMembers)
            .where(
              and(
                eq(teamMembers.organizationId, candidate.id),
                eq(teamMembers.userId, userId),
                eq(teamMembers.isActive, true),
              ),
            )
            .limit(1);
          if (member) org = candidate;
        }
      }
    } catch {
      /* non-fatal — fall through to default resolution. */
    }
  }

  if (!org) {
    org = await storage.getOrganizationByOwner(userId);
  }

  // Cycle 14: if the user doesn't own any org but is an active team
  // member of one (invited seat user), use that org instead of
  // spinning up a fresh shadow org. Prevents seat users from
  // accidentally landing in a personal sandbox after accepting an
  // invite.
  if (!org) {
    try {
      const memberships = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId));
      const active = memberships.find((m) => m.isActive);
      if (active) {
        const [inviteOrg] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.id, active.organizationId))
          .limit(1);
        if (inviteOrg) org = inviteOrg;
      }
    } catch {
      /* non-fatal; fall through to shadow-org creation below */
    }
  }

  if (!org) {
    // Phase 0 traffic-readiness — this is the REAL signup-completion path
    // in this codebase. There is no /api/register handler; Clerk creates
    // the user upstream, then the first authenticated request flows here
    // and we provision the org. So the signup rate-limit + bot-signal
    // capture must run on THIS branch — not on the (dead) /api/register
    // mount the index.ts wiring used to advertise. See provisionUser
    // below for the helper that encapsulates these checks.
    const provisionResult = await provisionUser(req, res, {
      userId,
      userEmail,
      isFounder,
    });
    if (provisionResult.shortCircuited) return;

    // Phase 0 traffic-readiness — OFAC + sanctioned-country screening before
    // we ever stand up the org. Founder bypasses (the check skips when
    // isFounder=true is already known). Failure mode is fail-open: a downed
    // sanctions table never blocks legitimate signups. See
    // server/services/sanctionsList.ts.
    if (!isFounder) {
      try {
        const { checkSignup } = await import("../services/sanctionsList");
        const candidateName =
          (user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : "") || user.email || "";
        const candidateCountry =
          (user as { country?: string | null }).country ??
          (req.headers["cf-ipcountry"] as string | undefined) ??
          (req.headers["x-vercel-ip-country"] as string | undefined) ??
          "";
        const block = await checkSignup({ name: candidateName, country: candidateCountry });
        if (block.matched) {
          logger.warn("[getOrCreateOrg] signup blocked by sanctions check", {
            source: "getOrCreateOrg",
            metadata: {
              userId,
              email: userEmail,
              reason: block.reason,
              country: candidateCountry || null,
            },
          });
          return res.status(403).json({
            error: "SANCTIONS_BLOCK",
            message: block.message,
            statusCode: 403,
          });
        }
      } catch (err) {
        // Sanctions module unavailable: log + continue (fail open).
        logger.warn("[getOrCreateOrg] sanctions screening unavailable — failing open", {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    // DEFECT-0021: Wrap org creation + team member creation in a transaction
    // so we never end up with an org that has no owner team member.
    const displayName = user.firstName || user.email || "User";
    const slug = `org-${userId}-${Date.now()}`;
    const now = new Date();
    // Trial duration must match the landing page promise. Landing copy
    // says "free for 14 days" (client/src/pages/landing/copy.ts hero.cta1)
    // and the Stripe checkout path already passes `trial_period_days: 14`
    // (server/routes-billing.ts:319). The in-app trial granted on org
    // creation was 7 days — a Soren-P0 mismatch that broke the promise
    // for any user who hit the app before billing.
    const TRIAL_DURATION_DAYS = 14;
    const trialEnds = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

    org = await withTransaction(async (tx) => {
      const [newOrg] = await tx.insert(organizations).values({
        name: `${displayName}'s Organization`,
        slug,
        ownerId: userId,
        subscriptionTier: isFounder ? "enterprise" : "free",
        subscriptionStatus: "active",
        trialStartedAt: isFounder ? null : now,
        trialEndsAt: isFounder ? null : trialEnds,
        trialUsed: isFounder ? true : false,
        isFounder,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
      }).returning();

      // Add user as owner team member
      await tx.insert(teamMembers).values({
        organizationId: newOrg.id,
        userId,
        displayName,
        role: "owner",
        isActive: true,
      });

      return newOrg;
    });

    if (isFounder) {
      logger.info(`Founder organization created`, { source: "getOrCreateOrg", metadata: { email: userEmail } });
    }

    // Phase 3 Week 14 — Activation telemetry. First (and only) org_created
    // event for this organisation. Fire-and-forget; never blocks request.
    try {
      const { recordActivationEventAsync } = await import("../services/activation");
      recordActivationEventAsync({
        orgId: org.id,
        userId,
        eventName: "org_created",
        eventValue: { isFounder, source: "getOrCreateOrg" },
      });
    } catch {
      /* non-fatal; telemetry failures must not break org creation */
    }

    // Pillar E / E5 — Lifecycle firehose. Same event, unified table.
    // Powers cohort retention + LTV endpoints. Fire-and-forget.
    try {
      const { recordLifecycleEvent } = await import("../services/lifecycleEvents");
      void recordLifecycleEvent({
        organizationId: org.id,
        userId,
        eventType: "signup.created",
        stage: "signup",
        metadata: { isFounder, source: "getOrCreateOrg" },
        sourceTable: "organizations",
        sourceId: String(org.id),
      });
    } catch {
      /* non-fatal */
    }
  } else if (isFounder && !org.isFounder) {
    // Upgrade existing org to founder status
    await db
      .update(organizations)
      .set({
        isFounder: true,
        subscriptionTier: "enterprise",
        subscriptionStatus: "active",
      })
      .where(eq(organizations.id, org.id));

    org = {
      ...org,
      isFounder: true,
      subscriptionTier: "enterprise",
      subscriptionStatus: "active",
    };
    logger.info(`Founder organization upgraded to enterprise`, { source: "getOrCreateOrg", metadata: { email: userEmail } });
  }

  // Set typed properties on the request
  req.organization = org;
  req.organizationId = org.id;
  // Legacy alias — will be removed once all route files use AuthenticatedRequest
  (req as any).org = org;

  // Activity heartbeat: stamp lastActiveAt so churn/health signals reflect real
  // last-seen time (it was never written, so every org read as "no activity" /
  // high churn risk). Throttled to ~15 min and fire-and-forget — never block or
  // fail the request on a heartbeat write miss.
  const HEARTBEAT_MS = 15 * 60 * 1000;
  const lastActiveTs = org.lastActiveAt ? new Date(org.lastActiveAt).getTime() : 0;
  if (Date.now() - lastActiveTs > HEARTBEAT_MS) {
    db.update(organizations)
      .set({ lastActiveAt: new Date() })
      .where(eq(organizations.id, org.id))
      .catch((e) =>
        logger.warn("Activity heartbeat write failed (non-fatal)", {
          source: "getOrCreateOrg",
          orgId: org.id,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
  }

  // RS-5: fire-and-forget new-location detector. Bounded by an in-memory
  // Set keyed on sessionId so it touches the DB at most once per session
  // per process — not on every authenticated request.
  // RS-6: same memo pattern, detects an email change in Clerk vs our
  // local DB row and alerts both addresses.
  try {
    const sessionId = (req as any).auth?.sessionId ?? null;
    const ip = req.ip ?? null;
    const userAgent = (req.headers["user-agent"] as string) ?? null;
    void import("../services/loginAnomalyDetector").then((m) =>
      m.recordAndAlertIfNew({
        userId,
        sessionId,
        ip,
        userAgent,
        headers: req.headers as Record<string, any>,
      }).catch(() => {/* fail-open */}),
    ).catch(() => {/* fail-open */});
    void import("../services/emailChangeDetector").then((m) =>
      m.detectAndAlertEmailChange({
        userId,
        clerkUserId: (user as any).clerkUserId ?? null,
        sessionId,
        ip,
        userAgent,
      }).catch(() => {/* fail-open */}),
    ).catch(() => {/* fail-open */});
  } catch {/* fail-open */}

  // Tahoe E11 — subscription-pause mutation gate. getOrCreateOrg is the
  // single chokepoint that sets req.organization across every org-scoped
  // route, so the pause gate is delegated here rather than mounted globally
  // (there is no global /api org middleware — org is attached per-route).
  // The gate no-ops on reads, on the exempt prefix allow-list, and on
  // un-paused orgs; otherwise it 402s. It either calls next() or responds.
  return subscriptionPauseGate(req, res, next);
}

/**
 * provisionUser — the "new-user about to be provisioned" branch helper.
 *
 * Why this lives in getOrCreateOrg.ts: signup in this codebase has no
 * dedicated POST handler. Clerk creates the user upstream and we discover
 * "this is a brand-new user" on the FIRST authenticated request that
 * reaches getOrCreateOrg without finding an existing org. That branch is
 * the single chokepoint where signup-time hardening MUST run:
 *
 *   1. Signup rate-limit (dual-lane: email + /24 IP-bucket; cellular-NAT
 *      safe per memory/feedback_rate_limit_ip_keying.md). If limited,
 *      we return 429 Errors.limitExceeded and SHORT-CIRCUIT so no org
 *      or team_member row is ever created. The Clerk user record itself
 *      will remain orphaned for one cycle — acceptable, since it carries
 *      no AcreOS-side state until provisioning completes.
 *
 *   2. Bot-signal cross-reference: if the client emitted to
 *      POST /api/auth/signup-signals during the Clerk widget interaction,
 *      we'll find a row keyed by sha256(email) within the last hour.
 *      If we don't, we persist a row with `signals-not-emitted` in
 *      reasons so the audit can count the gap rather than silently
 *      missing.
 *
 * Returns {shortCircuited: true} if a response was already written (caller
 * must early-return). Returns {shortCircuited: false} on pass-through so
 * caller continues with sanctions check + org creation.
 */
async function provisionUser(
  req: Request,
  res: Response,
  ctx: { userId: string; userEmail: string | undefined | null; isFounder: boolean },
): Promise<{ shortCircuited: boolean }> {
  // Founder bypass — Tom signing up in dev/staging shouldn't trip an
  // empty signup_signals row or fight the rate limit.
  if (ctx.isFounder) return { shortCircuited: false };

  const email = (ctx.userEmail || "").toLowerCase().trim();

  // ── 1. Signup rate-limit ────────────────────────────────────────────────
  // We invoke the dual-lane signupLimiter middleware programmatically. It
  // already handles cellular-NAT safety (/24 IP-bucket secondary lane) and
  // writes the 429 response via Errors.limitExceeded when tripped. We give
  // it a controlled "body" override so the email lane key resolves to the
  // Clerk-resolved email (req.body is empty on these GET requests).
  const limiterReq = Object.create(req) as Request;
  (limiterReq as Request & { body: Record<string, unknown> }).body = { email };

  const limiterOutcome = await new Promise<"passed" | "blocked">((resolve) => {
    let settled = false;
    const settle = (v: "passed" | "blocked") => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    // The limiter writes res directly on block; we treat the absence of
    // a next() callback within a short window as "blocked". Mirrors the
    // pattern dualLaneLimiter itself uses internally.
    void Promise.resolve(
      signupLimiter(limiterReq, res, () => settle("passed")),
    )
      .then(() => {
        if (!settled) {
          // Inspect res.headersSent / statusCode to detect block.
          if (res.headersSent || res.statusCode === 429) {
            settle("blocked");
          } else {
            settle("passed");
          }
        }
      })
      .catch(() => settle("passed")); // fail-open
  });

  if (limiterOutcome === "blocked") {
    logger.warn("[provisionUser] signup blocked by signupLimiter", {
      source: "provisionUser",
      metadata: { userId: ctx.userId, email },
    });
    return { shortCircuited: true };
  }

  // ── 2. Bot-signal cross-reference ───────────────────────────────────────
  // Look for a signup_signals row written by POST /api/auth/signup-signals
  // in the last hour, keyed by sha256(email). If absent, persist a row
  // with signals-not-emitted so the audit knows the client never fired
  // the sideband POST (vs. silently missing).
  try {
    if (email) {
      const emailHash = crypto.createHash("sha256").update(email).digest("hex");
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const [existing] = await db
        .select({ id: signupSignals.id })
        .from(signupSignals)
        .where(
          and(
            eq(signupSignals.emailHash, emailHash),
            gt(signupSignals.capturedAt, oneHourAgo),
          ),
        )
        .limit(1);
      if (!existing) {
        void recordSignalsNotEmitted({
          email,
          userId: ctx.userId,
          userAgent: (req.headers["user-agent"] as string) ?? null,
          ipBucket: computeReqIpBucket(req),
        });
      }
    }
  } catch (err) {
    // Non-fatal — signal capture is observability, not a gate.
    logger.warn("[provisionUser] signup_signals cross-reference failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  return { shortCircuited: false };
}

// Re-export for testing without going through the full getOrCreateOrg path.
export const _provisionUserForTests = provisionUser;
// Helper to silence unused-import lint on Errors when limiter doesn't trip
// (Errors is referenced through Errors.limitExceeded inside dualLaneLimiter
// via the signupLimiter middleware we invoke programmatically).
void Errors;
