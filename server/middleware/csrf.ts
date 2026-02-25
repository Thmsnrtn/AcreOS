import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * CSRF Protection Middleware
 *
 * Uses the double-submit cookie pattern:
 * 1. Server sets a random CSRF token in a cookie on GET /api/auth/user
 * 2. Client reads the cookie and sends it back in the X-CSRF-Token header
 * 3. Server compares the header value to the cookie value
 *
 * State-changing methods (POST, PUT, PATCH, DELETE) are protected.
 * GET / HEAD / OPTIONS are exempt.
 */

const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";

/** Safe methods that don't require CSRF validation */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Paths exempt from CSRF (webhooks, external callbacks) */
const EXEMPT_PATHS = [
  "/stripe/webhook",
  "/auth/login",
  "/auth/register",
  "/auth/logout",
];

/**
 * Set a CSRF cookie if one doesn't already exist.
 * Call this on authenticated read endpoints (e.g., GET /api/auth/user).
 */
export function setCsrfCookie(req: Request, res: Response): void {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // Client JS must be able to read it
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
}

/**
 * CSRF validation middleware.
 * Checks that the X-CSRF-Token header matches the csrf_token cookie
 * for all state-changing requests.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Skip safe methods
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  // Skip exempt paths
  if (EXEMPT_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER] as string | undefined;

  if (!cookieToken || !headerToken) {
    res.status(403).json({ message: "CSRF token missing" });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    const valid =
      cookieToken.length === headerToken.length &&
      crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));

    if (!valid) {
      res.status(403).json({ message: "CSRF token mismatch" });
      return;
    }
  } catch {
    res.status(403).json({ message: "CSRF token invalid" });
    return;
  }

  next();
}
