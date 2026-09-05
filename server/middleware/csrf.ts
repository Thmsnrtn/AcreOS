import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { e2eTestAuthEnabled } from "../auth/testAuth";


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
  "/webhooks/ses/events",
  "/webhooks/twilio/sms",
  "/webhooks/twilio/sms-status",
  "/webhooks/twilio/recording-status",
  "/webhooks/meta-lead-ads",
  // Lob direct-mail delivery events (Wave B "Wire the engine"). Lob posts
  // server-to-server and cannot carry our double-submit token, so without
  // this entry EVERY delivery webhook 403'd here before reaching the
  // handler — the piece timestamps (printed/in transit/delivered) would
  // have stayed permanently NULL while the code that fills them looked
  // wired. Safe to exempt: the route authenticates with Lob's own
  // HMAC-SHA256 signature over `${timestamp}.${rawBody}` and rejects every
  // unsigned post (server/routes/lob-webhooks.ts).
  "/webhooks/lob",
  // STR-009: analytics/telemetry are fire-and-forget beacons that can't
  // set a CSRF cookie before the first page load, and sendBeacon() can't
  // attach custom headers. They're auth-gated and don't mutate user data,
  // so CSRF exemption is safe.
  "/analytics/session/start",
  "/analytics/session/end",
  "/telemetry",
  // Crash + funnel beacons (2026-07 production-gate audit): both fire
  // before a csrf_token cookie may exist — the error-boundary trip fires
  // ON CRASH (possibly the first page load, e.g. /auth failing to boot),
  // so requiring the token meant every production crash report 403'd and
  // the founder's crash-visibility loop received nothing, ever. Validated,
  // rate-limited, no user-data mutation — same class as STR-009 above.
  "/client/error-boundary-trip",
  "/onboarding/step-entered",
  // Routes NOT mounted under /api — these never reach this middleware
  // because the mount is /api-only; kept for documentation only.
  "/webhook/twilio/recording-complete",
  "/webhook/disclosure",
]);

/**
 * Exempt callback routes whose path carries a PARAMETER, so an exact-match
 * Set entry can never fire. Kept deliberately tiny and deliberately anchored
 * (^…$): a loose prefix here would exempt far more than the callback.
 *
 * Found 2026-07-29 by the webhook-reachability guard
 * (tests/unit/lobWebhookIngest.test.ts): the title-partner status callback
 * had been mounted, HMAC-verified and API-key-authenticated — and 403'd here
 * on every real post, because a title partner cannot carry our double-submit
 * token any more than Stripe or Lob can.
 */
const CSRF_EXEMPT_PATTERNS: RegExp[] = [
  // POST /api/webhooks/title-orders/:orderId/status — partner-tier inbound
  // status callback. Authenticated by bearer API key + HMAC-SHA256 over the
  // raw body (server/routes-title-partners.ts); fails closed without both.
  /^\/webhooks\/title-orders\/[^/]+\/status$/,
];

/**
 * True when this (prefix-stripped) path is an external callback that cannot
 * supply a CSRF token. Exported so the reachability guard can assert every
 * mounted webhook route is actually reachable.
 */
export function isCsrfExemptPath(path: string): boolean {
  if (CSRF_EXEMPT_PATHS.has(path)) return true;
  return CSRF_EXEMPT_PATTERNS.some((re) => re.test(path));
}

const CSRF_COOKIE = "csrf_token";
// ~32 hex chars of entropy, readable by JS (not httpOnly) so the client
// can mirror it into the x-csrf-token header for the double-submit check.
function issueToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function ensureCsrfCookie(req: Request, res: Response): void {
  const existing = req.cookies?.[CSRF_COOKIE];
  if (existing) return;
  const token = issueToken();
  res.cookie(CSRF_COOKIE, token, {
    path: "/",
    sameSite: "lax",
    // `Secure` in production, EXCEPT under the E2E bypass — which runs a
    // production build over plain http://localhost.
    //
    // A `Secure` cookie on an insecure origin is DROPPED. Chromium grants
    // localhost a trustworthy-origin exception and keeps it; WEBKIT DOES NOT.
    // So on WebKit `document.cookie` held no `csrf_token`, the client mirrored
    // an empty `x-csrf-token`, and every mutation came back 403 "CSRF token
    // validation failed" — including approving or rejecting a Pax ask, the
    // most consequential control in the product. The E2E suite reported it as
    // a product failure; the app was never reached.
    //
    // Gated on `e2eTestAuthEnabled()` rather than on a new flag, because that
    // predicate is already hard-gated: it requires E2E_TEST_AUTH=1 AND the
    // absence of FLY_APP_NAME, and the process FATALs on boot if that flag is
    // ever seen on a Fly machine. This cannot relax the attribute in any
    // deployed environment.
    secure: process.env.NODE_ENV === "production" && !e2eTestAuthEnabled(),
    httpOnly: false, // double-submit requires JS to read it
    // No maxAge → session cookie, rotated per browser session.
  });
  // Ensure same-request reads see the new value.
  req.cookies = { ...(req.cookies ?? {}), [CSRF_COOKIE]: token };
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
  if (isCsrfExemptPath(req.path)) {
    next();
    return;
  }

  const cookieToken: string = req.cookies?.[CSRF_COOKIE] ?? "";
  const headerToken: string = (req.headers["x-csrf-token"] as string) ?? "";

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ message: "CSRF token validation failed" });
    return;
  }

  next();
}
