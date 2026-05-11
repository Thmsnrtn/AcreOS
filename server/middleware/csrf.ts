import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Paths that are exempt from CSRF validation because they receive
 * callbacks from external services which cannot supply our CSRF token.
 * Only exact webhook callback paths are listed — authenticated endpoints
 * like PUT /api/webhooks are NOT exempt.
 *
 * IMPORTANT — path-prefix gotcha. This middleware is mounted at /api in
 * server/routes.ts (`app.use("/api", csrfProtection)`). Express strips the
 * mount prefix from `req.path` inside the middleware, so for a request to
 * `/api/stripe/webhook` we see `req.path === "/stripe/webhook"`. Entries
 * for routes that go through the /api mount must be written WITHOUT the
 * /api prefix; entries for non-/api roots (like the Twilio recording-
 * complete webhook mounted at `/webhook/...`) keep their full path.
 */
const CSRF_EXEMPT_PATHS = new Set([
  // Routes mounted under /api — exempt list sees these without the /api prefix
  "/stripe/webhook",
  "/stripe/connect/webhook",
  "/twilio/webhook",
  "/sns/webhook",
  "/webhooks/inbound-email",
  "/webhooks/sendgrid/events",
  "/webhooks/twilio/sms",
  "/webhooks/twilio/sms-status",
  "/webhooks/twilio/recording-status",
  "/webhooks/meta-lead-ads",
  // STR-009: analytics/telemetry are fire-and-forget beacons that can't
  // set a CSRF cookie before the first page load, and sendBeacon() can't
  // attach custom headers. They're auth-gated and don't mutate user data,
  // so CSRF exemption is safe.
  "/analytics/session/start",
  "/analytics/session/end",
  "/telemetry",
  // Routes NOT mounted under /api — these never reach this middleware
  // because the mount is /api-only; kept for documentation only.
  "/webhook/twilio/recording-complete",
  "/webhook/disclosure",
]);

const CSRF_COOKIE = "csrf_token";
// ~32 hex chars of entropy, readable by JS (not httpOnly) so the client
// can mirror it into the x-csrf-token header for the double-submit check.
function issueToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function ensureCsrfCookie(req: Request, res: Response): void {
  const existing = (req as any).cookies?.[CSRF_COOKIE];
  if (existing) return;
  const token = issueToken();
  res.cookie(CSRF_COOKIE, token, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false, // double-submit requires JS to read it
    // No maxAge → session cookie, rotated per browser session.
  });
  // Ensure same-request reads see the new value.
  (req as any).cookies = { ...((req as any).cookies ?? {}), [CSRF_COOKIE]: token };
}

/**
 * Double-submit cookie CSRF protection.
 *
 * For mutating requests (POST, PUT, PATCH, DELETE) the middleware verifies
 * that the `x-csrf-token` request header matches the `csrf_token` cookie and
 * that neither value is empty. External webhook callback paths are explicitly
 * exempted since third-party services cannot supply our CSRF token.
 *
 * On safe methods, the middleware issues the `csrf_token` cookie if the
 * client doesn't already have one. This avoids a separate bootstrap endpoint
 * — the cookie arrives on the first GET and is then mirrored by the client
 * into the `x-csrf-token` header for every mutation.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    ensureCsrfCookie(req, res);
    next();
    return;
  }

  // Skip CSRF for specific external webhook callback paths
  if (CSRF_EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const cookieToken: string = (req as any).cookies?.[CSRF_COOKIE] ?? "";
  const headerToken: string = (req.headers["x-csrf-token"] as string) ?? "";

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ message: "CSRF token validation failed" });
    return;
  }

  next();
}
