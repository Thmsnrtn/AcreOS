import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Paths that bypass CSRF checks (webhooks, external callbacks) */
const CSRF_EXEMPT_PREFIXES = [
  "/webhook",
  "/api/stripe",
  "/api/clerk",
];

/**
 * Double-submit cookie CSRF protection.
 *
 * For mutating requests (POST, PUT, PATCH, DELETE) the middleware verifies
 * that the `x-csrf-token` request header matches the `csrf_token` cookie and
 * that neither value is empty.
 *
 * Exemptions:
 * - Safe/read-only methods (GET, HEAD, OPTIONS)
 * - Webhook endpoints (external services don't carry CSRF cookies)
 * - Requests using Bearer token auth (API clients, not browser sessions)
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe methods never need CSRF validation
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Skip CSRF for webhook / external callback endpoints
  const path = req.path.toLowerCase();
  if (CSRF_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    next();
    return;
  }

  // Skip CSRF for Bearer-token authenticated API clients
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    next();
    return;
  }

  const cookieToken: string = (req as any).cookies?.csrf_token ?? "";
  const headerToken: string = (req.headers["x-csrf-token"] as string) ?? "";

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    logger.warn("[csrf] CSRF token validation failed", {
      path: req.path,
      method: req.method,
      hasCookie: !!cookieToken,
      hasHeader: !!headerToken,
    });
    res.status(403).json({ error: "Forbidden", message: "CSRF token validation failed", statusCode: 403 });
    return;
  }

  next();
}
