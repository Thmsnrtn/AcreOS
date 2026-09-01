import type { Express } from "express";
import crypto from "crypto";
import { db } from "./db";
import { users, referrals } from "@shared/models/auth";
import { organizations } from "@shared/schema";
import { isAuthenticated } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { eq, count, sql } from "drizzle-orm";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { applyReferralCode } from "./services/referralService";

// Generate a random 8-char alphanumeric referral code
function generateCode(): string {
  return crypto.randomBytes(5).toString("base64url").slice(0, 8).toUpperCase();
}

export function registerReferralRoutes(app: Express): void {
  /**
   * GET /api/referral/code
   * Returns (or creates) the authenticated user's personal referral code.
   */
  app.get("/api/referral/code", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return Errors.unauthorized(res);

      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) return Errors.notFound(res, "User");

      if (user.referralCode) {
        return res.json({ code: user.referralCode });
      }

      // Generate a unique code
      let code = generateCode();
      let attempts = 0;
      while (attempts < 10) {
        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
        if (!existing) break;
        code = generateCode();
        attempts++;
      }

      await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));

      // Also create the referrals tracking row for this referrer
      await db.insert(referrals).values({
        referrerId: userId,
        code,
        status: "pending",
      }).onConflictDoNothing();

      return res.json({ code });
    } catch (err) {
      logger.error("[referral] GET /code error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });

  /**
   * GET /api/referral/stats
   * Returns the referrer's stats: signups, conversions, credit balance.
   */
  app.get("/api/referral/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return Errors.unauthorized(res);

      const org = req.organization;

      const rows = await db
        .select()
        .from(referrals)
        .where(eq(referrals.referrerId, userId));

      const signups = rows.filter((r) =>
        r.status === "signed_up" || r.status === "paid" || r.status === "converted",
      ).length;
      const conversions = rows.filter((r) => r.status === "converted").length;
      const creditsEarned = rows.reduce((sum, r) => sum + (r.creditAmount ?? 0), 0);
      // Market-match terms: referrals whose referee has paid sit in the
      // 30-day retention hold — shown with the date the reward matures.
      // The terms block is served from the SAME constants the reward
      // machine enforces, so a rendered term can never drift from the
      // enforced one.
      const {
        REFERRAL_RETENTION_HOLD_DAYS,
        REFERRAL_REWARD_CENTS,
        REFERRAL_ANNUAL_BONUS_CENTS,
        REFERRAL_MILESTONES,
      } = await import("./services/referralReward");
      const pending = rows
        .filter((r) => r.status === "paid" && r.paidAt)
        .map((r) => ({
          id: r.id,
          paidAt: r.paidAt,
          maturesAt: new Date(
            (r.paidAt as Date).getTime() + REFERRAL_RETENTION_HOLD_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString(),
        }));

      return res.json({
        signups,
        conversions,
        pending,             // paid, inside the retention hold
        creditsEarned,       // cents total ever earned
        creditBalance: org?.referralCredits ?? 0, // cents currently available
        terms: {
          rewardCents: REFERRAL_REWARD_CENTS,
          annualBonusCents: REFERRAL_ANNUAL_BONUS_CENTS,
          retentionHoldDays: REFERRAL_RETENTION_HOLD_DAYS,
          milestones: REFERRAL_MILESTONES,
        },
      });
    } catch (err) {
      logger.error("[referral] GET /stats error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });

  /**
   * POST /api/referral/apply
   * Called after a new user registers if they came via ?ref=CODE.
   * Links the AUTHENTICATED user (the referee is always the caller —
   * Tier 2C removed the body-supplied refereeId, which let any authed
   * user attribute arbitrary users to arbitrary codes) to the referrer.
   *
   * Body: { code: string }
   *
   * Note: the primary apply path is now server-side during the signup
   * UTM flush (routes-acquisition-utm.ts); this route remains for
   * explicit/manual application and is idempotent with that path.
   */
  app.post("/api/referral/apply", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return Errors.unauthorized(res);

      const { code } = req.body as { code?: string };
      if (!code || typeof code !== "string") {
        return Errors.badRequest(res, "code required");
      }

      const result = await applyReferralCode(code, userId);
      if (result.applied) return res.json({ ok: true });

      switch (result.reason) {
        case "unknown_code":
          return Errors.notFound(res, "Referral code");
        case "self_referral":
          return Errors.badRequest(res, "Cannot refer yourself");
        case "invalid_code":
          return Errors.badRequest(res, "Invalid referral code");
        case "already_referred":
        case "code_exhausted":
          // Not an error from the caller's perspective — attribution
          // simply already belongs to someone. Don't leak who.
          return res.json({ ok: false, reason: result.reason });
        default:
          return Errors.internal(res, new Error("Referral apply failed"));
      }
    } catch (err) {
      logger.error("[referral] POST /apply error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });

  /**
   * POST /api/referral/activate
   * HISTORY: this used to be a second, divergent reward implementation
   * ($1, instant convert on request). Under the market-match terms
   * (founder decision 2026-09-01) rewards flow ONLY through the paid +
   * 30-day-retention machine in services/referralReward.ts — an instant
   * manual convert would bypass the fraud gates. The route now reports
   * the caller's referral status instead of mutating anything.
   */
  app.post("/api/referral/activate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return Errors.unauthorized(res);

      const [referral] = await db
        .select()
        .from(referrals)
        .where(eq(referrals.refereeId, userId))
        .limit(1);

      if (!referral) return res.json({ rewarded: false, message: "No referral found" });
      return res.json({
        rewarded: referral.status === "converted",
        status: referral.status,
        message:
          referral.status === "converted"
            ? "This referral has converted — both sides were credited."
            : referral.status === "paid"
              ? "First payment received — the referrer's credit matures after the 30-day retention hold."
              : "Rewards apply automatically when the referred account becomes a paying subscriber.",
      });
    } catch (err) {
      logger.error("[referral] POST /activate error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });

  /**
   * GET /api/referral/referees
   * Returns list of referred users and their activation status.
   */
  app.get("/api/referral/referees", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return Errors.unauthorized(res);

      const refs = await db
        .select()
        .from(referrals)
        .where(eq(referrals.referrerId, userId));

      const referees = refs.map((r) => ({
        status: r.status,
        signedUpAt: r.createdAt,
        convertedAt: (r as any).convertedAt || null,
        rewarded: r.status === "converted",
      }));

      return res.json({ referees });
    } catch (err) {
      logger.error("[referral] GET /referees error", err);
      return Errors.internal(res, new Error('Internal server error'));
    }
  });
}
