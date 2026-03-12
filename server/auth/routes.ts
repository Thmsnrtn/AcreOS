import type { Express, RequestHandler } from "express";
import crypto from "crypto";
import passport from "passport";
import { z } from "zod";
import bcrypt from "bcrypt";
import { isAuthenticated, createUser } from "./localAuth";
import { isFounderEmail } from "../services/founder";
import { setCsrfCookie } from "../middleware/csrf";
import { emailService } from "../services/emailService";
import { db } from "../db";
import { users, passwordResetTokens } from "@shared/models/auth";
import { eq, and, gt, isNull, sql } from "drizzle-orm";

const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// ============================================
// F-A09-1: Auth failure alerting
// Rolling per-IP counter; fires a Sentry alert when ≥50 failures in 5 minutes.
// ============================================

interface FailureRecord {
  count: number;
  windowStart: number;
  alerted: boolean;
}

const AUTH_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const AUTH_FAILURE_ALERT_THRESHOLD = 50;
const authFailures = new Map<string, FailureRecord>();

function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const record = authFailures.get(ip);

  if (!record || now - record.windowStart > AUTH_FAILURE_WINDOW_MS) {
    authFailures.set(ip, { count: 1, windowStart: now, alerted: false });
    return;
  }

  record.count += 1;

  if (record.count >= AUTH_FAILURE_ALERT_THRESHOLD && !record.alerted) {
    record.alerted = true;
    const msg = `[auth] BRUTE FORCE ALERT: ${record.count} auth failures from IP ${ip} in the last 5 minutes`;
    console.error(msg);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Sentry } = require("../utils/sentry");
      if (Sentry?.captureMessage) {
        Sentry.captureMessage(msg, "warning");
      }
    } catch {
      // Sentry optional — swallow import error
    }
  }
}

// Evict stale records every 10 minutes to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - AUTH_FAILURE_WINDOW_MS * 2;
  for (const [ip, record] of authFailures) {
    if (record.windowStart < cutoff) authFailures.delete(ip);
  }
}, AUTH_FAILURE_WINDOW_MS * 2).unref();

// ============================================
// Task #8: Account lockout constants
// 5 failed attempts triggers a 30-minute lock
// ============================================

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// ============================================
// VALIDATION SCHEMAS
// ============================================

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  agreedToTerms: z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Service to create an account." }),
  }),
  referralCode: z.string().max(16).optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ============================================
// AUTH ROUTES
// ============================================

export function registerAuthRoutes(app: Express): void {
  // UTM attribution: called from landing page before register to persist UTM params in session
  app.post("/api/auth/attribution", (req, res) => {
    const { utmSource, utmMedium, utmCampaign, utmContent } = req.body;
    (req.session as any).utmAttribution = {
      utmSource: utmSource || null,
      utmMedium: utmMedium || null,
      utmCampaign: utmCampaign || null,
      utmContent: utmContent || null,
    };
    res.json({ ok: true });
  });

  // Register new account
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => i.message);
        return res.status(400).json({ message: errors[0] });
      }

      const { email, password, firstName, lastName, referralCode } = parsed.data;
      const user = await createUser({ email, password, firstName, lastName });

      // Apply referral code post-registration (non-blocking)
      if (referralCode) {
        fetch(`${req.protocol}://${req.get("host")}/api/referral/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: referralCode, refereeId: user.id }),
        }).catch((err: any) => {
          console.error("[auth] Failed to apply referral code:", err?.message);
        });
        // Clear the stored code so it can't be reused by the same browser
      }

      // Send welcome email (non-blocking — don't fail registration if email fails)
      emailService
        .sendTransactionalEmail("welcome", {
          to: email,
          templateData: { firstName: firstName || "there" },
        })
        .catch((err: any) => {
          console.error("[auth] Failed to send welcome email:", err?.message);
        });

      // Session rotation: regenerate session ID before login to prevent session fixation
      req.session.regenerate((regenErr) => {
        if (regenErr) return next(regenErr);
        req.login(user, (err) => {
          if (err) return next(err);
          setCsrfCookie(req, res);
          const isFounder = isFounderEmail(user.email);
          return res.status(201).json(
            isFounder ? { ...user, passwordHash: undefined, isFounder: true } : { ...user, passwordHash: undefined }
          );
        });
      });
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        return res.status(409).json({ message: error.message });
      }
      console.error("[auth] Registration error:", error);
      return res.status(500).json({ message: "Registration failed" });
    }
  });

  // Login
  app.post("/api/auth/login", async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: errors[0] });
    }

    // Task #8: Check account lockout BEFORE attempting passport auth.
    // Avoids unnecessary bcrypt work while lock is active.
    const loginEmail = parsed.data.email.toLowerCase().trim();
    try {
      const [targetUser] = await db
        .select({ id: users.id, lockedUntil: users.lockedUntil, failedLoginAttempts: users.failedLoginAttempts })
        .from(users)
        .where(eq(users.email, loginEmail))
        .limit(1);

      if (targetUser?.lockedUntil && new Date(targetUser.lockedUntil) > new Date()) {
        const unlockAt = new Date(targetUser.lockedUntil).toISOString();
        console.log(JSON.stringify({
          level: "SECURITY",
          event: "auth.lockout.blocked",
          email: loginEmail,
          lockedUntil: unlockAt,
          timestamp: new Date().toISOString(),
        }));
        return res.status(423).json({
          message: `Account locked due to too many failed attempts. Try again after ${unlockAt}.`,
        });
      }
    } catch (lockCheckErr) {
      console.error("[auth] Lockout check error:", lockCheckErr);
    }

    passport.authenticate("local", async (err: any, user: any, info: any) => {
      if (err) {
        console.error("[auth] Login error:", err);
        return res.status(500).json({ message: "Login failed" });
      }
      if (!user) {
        // F-A09-1: Record auth failure for brute-force detection
        const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
          || req.socket.remoteAddress
          || "unknown";
        recordAuthFailure(clientIp);

        // Task #8: Increment per-account failed attempts, lock if threshold reached
        try {
          const [targetUser] = await db
            .select({ id: users.id, failedLoginAttempts: users.failedLoginAttempts })
            .from(users)
            .where(eq(users.email, loginEmail))
            .limit(1);

          if (targetUser) {
            const currentAttempts = parseInt(targetUser.failedLoginAttempts ?? "0", 10) + 1;
            const shouldLock = currentAttempts >= MAX_FAILED_ATTEMPTS;
            await db
              .update(users)
              .set({
                failedLoginAttempts: String(currentAttempts),
                lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
              })
              .where(eq(users.id, targetUser.id));

            if (shouldLock) {
              console.log(JSON.stringify({
                level: "SECURITY",
                event: "auth.lockout.triggered",
                userId: targetUser.id,
                attempts: currentAttempts,
                timestamp: new Date().toISOString(),
              }));
            }
          }
        } catch (updateErr) {
          console.error("[auth] Failed attempt counter error:", updateErr);
        }

        return res.status(401).json({ message: info?.message || "Invalid email or password" });
      }

      // Successful login — reset failed attempt counter
      try {
        await db
          .update(users)
          .set({ failedLoginAttempts: "0", lockedUntil: null })
          .where(eq(users.id, user.id));
      } catch (resetErr) {
        console.error("[auth] Failed to reset attempt counter:", resetErr);
      }

      // Session rotation: regenerate session ID before login to prevent session fixation
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error("[auth] Session regeneration error:", regenErr);
          return res.status(500).json({ message: "Login failed" });
        }
        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error("[auth] Session error:", loginErr);
            return res.status(500).json({ message: "Login failed" });
          }
          // Task #45: Security audit log for successful login
          const loginIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress;
          console.log(JSON.stringify({
            level: "SECURITY",
            event: "auth.login",
            userId: user.id,
            ip: loginIp,
            userAgent: req.headers["user-agent"],
            timestamp: new Date().toISOString(),
          }));
          setCsrfCookie(req, res);
          const isFounder = isFounderEmail(user.email);
          return res.json(
            isFounder ? { ...user, passwordHash: undefined, isFounder: true } : { ...user, passwordHash: undefined }
          );
        });
      });
    })(req, res, next);
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error("[auth] Logout error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      // Task #45: Security audit log for logout
      const logoutUser = req.user as any;
      if (logoutUser?.id) {
        const logoutIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress;
        console.log(JSON.stringify({
          level: "SECURITY",
          event: "auth.logout",
          userId: logoutUser.id,
          ip: logoutIp,
          timestamp: new Date().toISOString(),
        }));
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error("[auth] Session destroy error:", destroyErr);
        }
        res.clearCookie("connect.sid");
        return res.json({ message: "Logged out" });
      });
    });
  });

  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      // Set CSRF cookie on every authenticated read (double-submit cookie pattern)
      setCsrfCookie(req, res);
      const user = req.user as any;
      const isFounder = isFounderEmail(user?.email);
      // Strip passwordHash from response, add isFounder only for founders
      const { passwordHash, ...safeUser } = user;
      res.json(isFounder ? { ...safeUser, isFounder: true } : safeUser);
    } catch (error) {
      console.error("[auth] Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // ============================================
  // PASSWORD RESET (using passwordResetTokens table)
  // ============================================

  // Request a password reset link
  // Always returns 200 to prevent email enumeration
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0].message });
      }

      const { email } = parsed.data;
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      // If no user found, still return 200 to prevent enumeration
      if (user) {
        const token = crypto.randomBytes(48).toString("hex");
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        await db.insert(passwordResetTokens).values({
          userId: user.id,
          token,
          expiresAt,
        });

        const rawAppUrl = process.env.APP_URL;
        if (!rawAppUrl && process.env.NODE_ENV === "production") {
          console.error("[auth] APP_URL is not set — password reset link will point to localhost");
        }
        const appUrl = (rawAppUrl || "http://localhost:5000").replace(/\/$/, "");
        const resetUrl = `${appUrl}/auth?mode=reset&token=${token}`;

        emailService
          .sendTransactionalEmail("password_reset", {
            to: email,
            templateData: {
              name: user.firstName || "there",
              resetUrl,
              expiresIn: "1 hour",
            },
          })
          .catch((err: any) => {
            console.error("[auth] Failed to send password reset email:", err?.message);
          });
      }

      return res.json({ message: "If an account with that email exists, a reset link has been sent." });
    } catch (error) {
      console.error("[auth] Forgot password error:", error);
      return res.status(500).json({ message: "Failed to process request" });
    }
  });

  // Reset password using a token
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0].message });
      }

      const { token, password } = parsed.data;
      const now = new Date();

      const [resetRecord] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.token, token),
            gt(passwordResetTokens.expiresAt, now),
            isNull(passwordResetTokens.usedAt)
          )
        )
        .limit(1);

      if (!resetRecord) {
        return res.status(400).json({ message: "This reset link is invalid or has expired." });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      await db
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, resetRecord.userId));

      await db
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, resetRecord.id));

      console.log(`[auth] Password reset completed for user ${resetRecord.userId}`);
      return res.json({ message: "Password updated successfully. You can now log in." });
    } catch (error) {
      console.error("[auth] Reset password error:", error);
      return res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // ─── Change password (authenticated) ──────────────────────────────────────
  // Allows logged-in users to change their password from Settings → Security tab.
  // Requires current password verification to prevent CSRF-based account takeover.
  app.post("/api/auth/change-password", isAuthenticated, async (req, res) => {
    const schema = z.object({
      currentPassword: z.string().min(1, "Current password is required"),
      newPassword: z.string().min(8, "New password must be at least 8 characters"),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0].message });
    }

    try {
      const currentUser = req.user as any;
      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, currentUser.id))
        .limit(1);

      if (!user?.passwordHash) {
        return res.status(400).json({ message: "Password change is not available for this account type" });
      }

      const isCorrect = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
      if (!isCorrect) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      const newHash = await bcrypt.hash(parsed.data.newPassword, SALT_ROUNDS);
      await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));

      console.log(JSON.stringify({
        level: "SECURITY",
        event: "auth.password_changed",
        userId: user.id,
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress,
        timestamp: new Date().toISOString(),
      }));

      // Regenerate session after password change to invalidate any stolen session tokens.
      const passportUser = (req.session as any).passport;
      await new Promise<void>((resolve) => req.session.regenerate((err) => {
        if (!err && passportUser) {
          (req.session as any).passport = passportUser;
        }
        resolve();
      }));

      return res.json({ message: "Password changed successfully" });
    } catch (err) {
      console.error("[auth] Change password error:", err);
      return res.status(500).json({ message: "Failed to change password" });
    }
  });
}

// ============================================
// FOUNDER MIDDLEWARE
// ============================================

/**
 * Middleware that requires the user to be a founder.
 * Returns 404 to hide the existence of founder-only routes from non-founders.
 */
export const requireFounder: RequestHandler = async (req, res, next) => {
  try {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(404).json({ message: "Not found" });
    }

    const user = req.user as any;
    if (!isFounderEmail(user.email)) {
      return res.status(404).json({ message: "Not found" });
    }

    (req as any).isFounder = true;
    next();
  } catch (error) {
    return res.status(404).json({ message: "Not found" });
  }
};
