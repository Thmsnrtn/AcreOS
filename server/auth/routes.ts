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
import { eq, and, gt, isNull } from "drizzle-orm";

const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

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

      const { email, password, firstName, lastName } = parsed.data;
      const user = await createUser({ email, password, firstName, lastName });

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
  app.post("/api/auth/login", (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => i.message);
      return res.status(400).json({ message: errors[0] });
    }

    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        console.error("[auth] Login error:", err);
        return res.status(500).json({ message: "Login failed" });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid email or password" });
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
  // PASSWORD RESET
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

        const appUrl = (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
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

      return res.json({ message: "Password updated successfully. You can now log in." });
    } catch (error) {
      console.error("[auth] Reset password error:", error);
      return res.status(500).json({ message: "Failed to reset password" });
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
