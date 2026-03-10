import type { Express, RequestHandler } from "express";
import passport from "passport";
import { z } from "zod";
import { isAuthenticated, createUser } from "./localAuth";
import { isFounderEmail } from "../services/founder";
import { setCsrfCookie } from "../middleware/csrf";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq, and, gt, sql } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcrypt";

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
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// ============================================
// AUTH ROUTES
// ============================================

export function registerAuthRoutes(app: Express): void {
  // Register new account
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((i) => i.message);
        return res.status(400).json({ message: errors[0] });
      }

      const { email, password, firstName, lastName } = parsed.data;
      const user = await createUser({ email, password, firstName, lastName });

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

  // ── Task #12: Password Reset (forgot / reset) ─────────────────────────────

  const forgotSchema = z.object({
    email: z.string().email(),
  });

  const resetSchema = z.object({
    token: z.string().min(64).max(64),
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  // Step 1: Request reset — send email with time-limited token
  // Always returns 200 to prevent account enumeration (Task #11)
  app.post("/api/auth/forgot-password", async (req, res) => {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Valid email required" });
    }

    const { email } = parsed.data;
    // Always respond 200 regardless of whether account exists
    res.json({ message: "If an account exists for that email, a password reset link has been sent." });

    // Fire-and-forget: find user, set token, send email
    try {
      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
      if (!user) return;

      const token = crypto.randomBytes(32).toString("hex"); // 64 hex chars
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.update(users)
        .set({ passwordResetToken: token, passwordResetExpiresAt: expiresAt })
        .where(eq(users.id, user.id));

      const appUrl = process.env.APP_URL || "http://localhost:5000";
      const resetUrl = `${appUrl}/reset-password?token=${token}`;

      // Send email (best effort — non-blocking)
      import("../services/emailService").then(({ emailService }) => {
        emailService.sendEmail({
          to: email,
          subject: "Reset your AcreOS password",
          html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
        }).catch(() => {});
      }).catch(() => {});
    } catch (err) {
      console.error("[auth] Forgot password error:", err);
    }
  });

  // Step 2: Complete reset — validate token, set new password
  app.post("/api/auth/reset-password", async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: errors[0] });
    }

    const { token, password } = parsed.data;
    const now = new Date();

    try {
      const [user] = await db.select().from(users)
        .where(and(
          eq(users.passwordResetToken, token),
          gt(users.passwordResetExpiresAt, now)
        ));

      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // Invalidate token after use (one-time use)
      await db.update(users)
        .set({
          passwordHash,
          passwordResetToken: null,
          passwordResetExpiresAt: null,
        })
        .where(eq(users.id, user.id));

      // Destroy all existing sessions for this user to force re-login
      // (session store doesn't support user-scoped deletion; log for awareness)
      console.log(`[auth] Password reset completed for user ${user.id}`);

      return res.json({ message: "Password reset successful. Please sign in with your new password." });
    } catch (error) {
      console.error("[auth] Reset password error:", error);
      return res.status(500).json({ message: "Password reset failed" });
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
