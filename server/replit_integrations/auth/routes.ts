import type { Express, RequestHandler } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { isFounderEmail } from "../../services/founder";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      const isFounder = isFounderEmail(user?.email);
      res.json({ ...user, isFounder });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}

/**
 * Middleware that requires the user to be a founder
 * Returns 404 to hide the existence of founder-only routes from non-founders
 */
export const requireFounder: RequestHandler = async (req: any, res, next) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(404).json({ message: "Not found" });
    }
    
    const userId = req.user.claims.sub;
    const user = await authStorage.getUser(userId);
    
    if (!isFounderEmail(user?.email)) {
      return res.status(404).json({ message: "Not found" });
    }
    
    // Attach founder status to request for downstream use
    req.isFounder = true;
    next();
  } catch (error) {
    return res.status(404).json({ message: "Not found" });
  }
};
