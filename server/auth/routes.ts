import type { Express } from "express";
import { isAuthenticated } from "./clerkAuth";
import { isFounderEmail } from "../services/founder";

export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user (used by frontend useAuth hook)
  app.get("/api/auth/user", isAuthenticated, (req, res) => {
    const user = req.user as any;
    const isFounder = isFounderEmail(user?.email);
    res.json(isFounder ? { ...user, isFounder: true } : user);
  });

  // UTM attribution stub — kept for API compatibility; UTM tracking
  // can be re-implemented via Clerk user metadata when needed.
  app.post("/api/auth/attribution", (_req, res) => {
    res.json({ ok: true });
  });
}
