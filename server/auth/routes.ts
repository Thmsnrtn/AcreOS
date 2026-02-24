import type { Express, RequestHandler } from "express";
import passport from "passport";
import { z } from "zod";
import { isAuthenticated, createUser } from "./localAuth";
import { isFounderEmail } from "../services/founder";
import { db } from "../db";
import { users } from "@shared/models/auth";
import { eq } from "drizzle-orm";

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

      // Auto-login after registration
      req.login(user, (err) => {
        if (err) return next(err);
        const isFounder = isFounderEmail(user.email);
        return res.status(201).json(
          isFounder ? { ...user, passwordHash: undefined, isFounder: true } : { ...user, passwordHash: undefined }
        );
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
      req.login(user, (loginErr) => {
        if (loginErr) {
          console.error("[auth] Session error:", loginErr);
          return res.status(500).json({ message: "Login failed" });
        }
        const isFounder = isFounderEmail(user.email);
        return res.json(
          isFounder ? { ...user, passwordHash: undefined, isFounder: true } : { ...user, passwordHash: undefined }
        );
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
