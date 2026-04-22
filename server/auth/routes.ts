import type { Express } from "express";
import { isAuthenticated } from "./clerkAuth";
import { isFounderEmail } from "../services/founder";

export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user (used by frontend useAuth hook)
  // Cache-Control: no-store is belt-and-suspenders. Safari / iOS have
  // historic Vary: Cookie bugs that can serve a stale signed-out 200
  // after sign-in, trapping the user on the auth page.
  app.get("/api/auth/user", isAuthenticated, (req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    const user = req.user as any;
    const isFounder = isFounderEmail(user?.email);
    res.json(isFounder ? { ...user, isFounder: true } : user);
  });

  // UTM attribution stub — kept for API compatibility; UTM tracking
  // can be re-implemented via Clerk user metadata when needed.
  app.post("/api/auth/attribution", (_req, res) => {
    res.json({ ok: true });
  });

  // Sign out: clear every Clerk session cookie on this response so a
  // subsequent __clerk_ticket sign-in truly takes effect. Clerk stamps
  // session cookies as `__session`, `__session_<suffix>`, `__client`,
  // `__client_uat`, and `__client_uat_<suffix>`. We can't enumerate
  // them from the request body alone (they're HttpOnly so the client
  // can't read the names either), so we clear the canonical names plus
  // any header-visible name that matches the prefix.
  app.post("/api/auth/logout", (req, res) => {
    const cookieHeader = req.headers.cookie || "";
    const seen = new Set<string>();
    for (const part of cookieHeader.split(";")) {
      const name = part.split("=")[0]?.trim();
      if (!name) continue;
      if (
        name === "__session" ||
        name === "__client" ||
        name === "__client_uat" ||
        name.startsWith("__session_") ||
        name.startsWith("__client_uat_") ||
        name.startsWith("__clerk_") ||
        name === "csrf_token"
      ) {
        seen.add(name);
      }
    }
    const opts = { path: "/" } as const;
    for (const name of seen) {
      res.clearCookie(name, opts);
      res.clearCookie(name, { path: "/", domain: ".acreos.io" });
    }
    res.json({ ok: true, cleared: Array.from(seen) });
  });
}
