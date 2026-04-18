import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Paths that are exempt from CSRF validation because they receive
 * callbacks from external services which cannot supply our CSRF token.
 * Only exact webhook callback paths are listed — authenticated endpoints
 * like PUT /api/webhooks are NOT exempt.
 */
const CSRF_EXEMPT_PATHS = new Set([
  "/api/stripe/webhook",
  "/api/stripe/connect/webhook",
  "/api/twilio/webhook",
  "/api/sns/webhook",
  "/api/webhooks/inbound-email",
  "/api/webhooks/twilio/sms",
  "/api/webhooks/twilio/sms-status",
  "/api/webhooks/twilio/recording-status",
  "/api/webhooks/dropbox-sign",
  "/api/webhooks/meta-lead-ads",
  "/api/webhooks/actum",
  "/webhook/twilio/recording-complete",
  "/webhook/disclosure",
]);

/**
 * Double-submit cookie CSRF protection.
 *
 * For mutating requests (POST, PUT, PATCH, DELETE) the middleware verifies
 * that the `x-csrf-token` request header matches the `csrf_token` cookie and
 * that neither value is empty.  External webhook callback paths are explicitly
 * exempted since third-party services cannot supply our CSRF token.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Skip CSRF for specific external webhook callback paths
  if (CSRF_EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const cookieToken: string = (req as any).cookies?.csrf_token ?? "";
  const headerToken: string = (req.headers["x-csrf-token"] as string) ?? "";

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ message: "CSRF token validation failed" });
    return;
  }

  next();
}
