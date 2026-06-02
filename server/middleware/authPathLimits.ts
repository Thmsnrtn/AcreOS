/**
 * authPathLimits — Phase 0 traffic-readiness auth-path rate limiters.
 *
 * Public acquisition opens any day. The first 10-100 signups will arrive
 * mixed with credential-stuffing probes, signup-farm scripts, and
 * password-reset-spammers. These limiters are the floor protection.
 *
 * # Design — dual-lane keying, cellular-NAT-safe
 *
 * Tom has explicit prior burn (2026-05-10) on a pure-IP limiter that 429'd
 * iPhones behind T-Mobile / Verizon CGNAT. See:
 * memory/feedback_rate_limit_ip_keying.md.
 *
 * EVERY limiter here uses a dual-lane key: a primary `email/identifier`
 * lane and a secondary `ip-bucket` lane (the /24 IPv4 prefix or /48 IPv6
 * prefix — coarse enough that 100 phones behind one carrier egress share
 * the bucket without colliding with a different cell tower).
 *
 *   signup:        5/email/hour, 50/ip-bucket/hour
 *   login:         5 failures/email/hour → 15-min email cooldown
 *                  IP-bucket secondary, soft (warn + slow only)
 *   password reset: 3/email/hour. ZERO ip-only blocks.
 *                  (knowing the email IS the threat model)
 *   email verify:  10/email/hour
 *
 * The email lane is the credential-of-record for credential-stuffing. The
 * ip-bucket lane is the cap of last resort for unauth probes where we
 * don't have an email yet (e.g. enumeration via password-reset for random
 * emails). 50/ip-bucket/hour on /24 = ~2 carrier-NAT'd users hitting
 * signup once each is a no-op; 50 probes from one /24 IS suspicious.
 *
 * # Storage
 *
 * Uses the existing Redis-backed sliding window from
 * server/middleware/rateLimit.ts via createRateLimiter — same cross-instance
 * enforcement and in-memory fallback semantics as the rest of the stack.
 *
 * # Response shape
 *
 * Always Errors.limitExceeded so the client toast handler can render the
 * standard "you've hit the rate limit" panel with retry-after.
 */

import type { Request, Response, NextFunction } from "express";
import { createRateLimiter, type RateLimitConfig } from "./rateLimit";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";

// ── IP-bucket helpers (CGNAT-tolerant) ──────────────────────────────────────

/**
 * Coarsen an IPv4 address to its /24 prefix and an IPv6 address to its
 * /48 prefix. The /24 bucket is wide enough that the typical carrier-grade
 * NAT egress (one tower, hundreds of phones, one public IP) sits inside a
 * single bucket without crossing into a neighbor's /24. The /48 IPv6
 * mirror keeps the same coarseness for cellular IPv6 deployments (most
 * carriers hand out a /64 per phone but share the /48 across the cell).
 *
 * Returns `unknown` for empty / unparseable input.
 */
export function ipBucket(ip: string | undefined | null): string {
  if (!ip) return "unknown";
  const trimmed = ip.trim();
  if (!trimmed) return "unknown";

  // IPv6 — split on ":", take the first three hextets as the /48 bucket.
  if (trimmed.includes(":")) {
    // Strip any IPv6-mapped-IPv4 prefix (::ffff:) before bucketing.
    const stripped = trimmed.replace(/^::ffff:/i, "");
    if (stripped.includes(":")) {
      const hextets = stripped.split(":").slice(0, 3);
      return `v6:${hextets.join(":")}::/48`;
    }
    // Was actually a mapped IPv4 — fall through.
    return ipBucket(stripped);
  }

  // IPv4 — first three octets = /24
  const parts = trimmed.split(".");
  if (parts.length !== 4) return `raw:${trimmed}`;
  return `v4:${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function reqIpBucket(req: Request): string {
  // Honor X-Forwarded-For if Express trust proxy is set (Fly fronts us).
  const fwd = req.headers["x-forwarded-for"];
  const ip =
    (typeof fwd === "string" ? fwd.split(",")[0].trim() : null) ??
    req.ip ??
    req.socket.remoteAddress ??
    "";
  return ipBucket(ip);
}

function submittedEmail(req: Request): string | null {
  const body = (req as Request & { body?: Record<string, unknown> }).body ?? {};
  const raw =
    typeof body.email === "string"
      ? body.email
      : typeof body.identifier === "string"
        ? body.identifier
        : "";
  const trimmed = raw.toLowerCase().trim();
  return trimmed.length > 0 && trimmed.length <= 320 ? trimmed : null;
}

// ── Limiter factory: dual-lane (email + ip-bucket) ──────────────────────────

interface DualLaneOptions {
  /** Cap on the primary email/identifier lane. */
  emailLane: RateLimitConfig;
  /** Cap on the IP-bucket lane. Optional — omit for "email-only" routes (password reset). */
  ipBucketLane?: RateLimitConfig;
  /** Friendly route label for log / error context. */
  label: string;
  /**
   * `soft` IP-bucket means: log a warning if the bucket would have tripped,
   * but do not block the request. Used for /login where the email lane is
   * the real defense and we don't want CGNAT lockouts.
   */
  ipBucketSoft?: boolean;
  /**
   * docsSlug surfaced to clients via Errors.limitExceeded — explains why
   * the user hit a rate limit.
   */
  docsSlug?: string;
}

/**
 * Compose two underlying createRateLimiter instances (email-lane,
 * ip-bucket-lane) into a single Express middleware. Both lanes run; the
 * first to trip blocks. On block, we send Errors.limitExceeded with
 * structured `details` so the client can render an accurate retry message.
 */
export function dualLaneLimiter(opts: DualLaneOptions) {
  const emailLimiter = createRateLimiter(opts.emailLane, (req) => {
    const email = submittedEmail(req);
    return email ? `auth:${opts.label}:email:${email}` : `auth:${opts.label}:noemail:${reqIpBucket(req)}`;
  });

  const ipBucketLimiter = opts.ipBucketLane
    ? createRateLimiter(opts.ipBucketLane, (req) => `auth:${opts.label}:ipb:${reqIpBucket(req)}`)
    : null;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Build a per-call "capture wrapper" — when the inner limiter calls
    // res.status(429).json(body), we intercept instead of actually writing
    // so we can choose whether to soft-pass (login IP-bucket) or hard-block
    // through Errors.limitExceeded.
    //
    // CRITICAL: the underlying createRateLimiter middleware does NOT call
    // next() when it blocks (it returns res.status(429).json(...)). So we
    // can't rely on the next callback to fire on the block path. Instead
    // we await the inner middleware and then inspect captured.tripped().
    // For pass-through we DO get the next callback.

    const runLane = async (
      laneMiddleware: ReturnType<typeof createRateLimiter>,
    ): Promise<{ passed: boolean; retryAfter: number }> => {
      const captured = buildCaptureRes(res);
      return await new Promise((resolve) => {
        let settled = false;
        Promise.resolve(
          laneMiddleware(req, captured.res, () => {
            if (settled) return;
            settled = true;
            resolve({ passed: true, retryAfter: 0 });
          }),
        ).then(() => {
          if (settled) return;
          // Inner middleware completed without next() ⇒ it 429'd.
          if (captured.tripped()) {
            settled = true;
            resolve({ passed: false, retryAfter: captured.retryAfter() });
          } else {
            // Edge: middleware exited without calling next AND without
            // tripping. Treat as pass (fail-open).
            settled = true;
            resolve({ passed: true, retryAfter: 0 });
          }
        }).catch(() => {
          if (!settled) {
            settled = true;
            resolve({ passed: true, retryAfter: 0 });
          }
        });
      });
    };

    // Lane 1: email lane (always hard).
    const emailLane = await runLane(emailLimiter);
    if (!emailLane.passed) {
      return respondBlocked(res, emailLane.retryAfter, opts.label, opts.docsSlug, "email");
    }

    // Lane 2: ip-bucket lane (optional; optionally soft).
    if (!ipBucketLimiter) return next();
    const ipLane = await runLane(ipBucketLimiter);
    if (!ipLane.passed) {
      if (opts.ipBucketSoft) {
        logger.warn(`[auth-rate] ip-bucket soft-trip (${opts.label}) — passing through`, {
          metadata: {
            label: opts.label,
            ipBucket: reqIpBucket(req),
            retryAfterSeconds: ipLane.retryAfter,
          },
        });
        return next();
      }
      return respondBlocked(res, ipLane.retryAfter, opts.label, opts.docsSlug, "ip-bucket");
    }
    next();
  };
}

/**
 * Wraps a Response in a capture shim. The shim's `.status(429).json(...)`
 * call sets internal flags instead of writing the response so the outer
 * caller can decide whether to forward to Errors.limitExceeded or pass.
 * Any other response (200, 500, etc.) writes through normally.
 *
 * Headers (Retry-After, X-RateLimit-*) DO write through so the limit
 * state is visible to clients even when we soft-pass.
 */
function buildCaptureRes(real: Response): {
  res: Response;
  tripped: () => boolean;
  retryAfter: () => number;
  reset: () => void;
} {
  let tripped = false;
  let retryAfter = 60;

  const shim = Object.create(real) as Response;
  // Capture status calls.
  (shim as any).status = (code: number) => {
    if (code === 429) {
      tripped = true;
      // Return an object that swallows .json/.end but keeps the real header
      // setters reachable through `shim` for the outer caller.
      return {
        json: (body: { retryAfter?: number } | unknown) => {
          if (body && typeof body === "object" && "retryAfter" in body && typeof (body as any).retryAfter === "number") {
            retryAfter = (body as { retryAfter: number }).retryAfter;
          }
          return shim;
        },
        end: () => shim,
        setHeader: (name: string, value: string | number | readonly string[]) => real.setHeader(name, value),
        getHeader: (name: string) => real.getHeader(name),
      } as unknown as Response;
    }
    return real.status(code);
  };
  // Header methods pass through to the real response.
  (shim as any).setHeader = (name: string, value: string | number | readonly string[]) =>
    real.setHeader(name, value);
  (shim as any).getHeader = (name: string) => real.getHeader(name);

  return {
    res: shim,
    tripped: () => tripped,
    retryAfter: () => retryAfter,
    reset: () => {
      tripped = false;
      retryAfter = 60;
    },
  };
}

function respondBlocked(
  res: Response,
  retryAfterSeconds: number,
  label: string,
  docsSlug: string | undefined,
  lane: "email" | "ip-bucket",
): void {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  Errors.limitExceeded(
    res,
    {
      route: label,
      lane,
      retryAfterSeconds,
      reason:
        lane === "email"
          ? "too_many_attempts_for_this_email"
          : "too_many_attempts_from_this_network",
    },
    docsSlug ? { docsSlug } : undefined,
  );
}

// ── Concrete limiters — exported for mounting ───────────────────────────────

/**
 * Signup limiter.
 *   - 5 attempts per email per hour    (credential-of-record cap)
 *   - 50 attempts per /24 IPv4 bucket per hour  (CGNAT-tolerant)
 *
 * Why these numbers:
 *   - 5/email/hour: an honest user mistypes 2-3 times before getting it
 *     right; 5 is generous, but tight enough that an attacker can't grind
 *     an email-list against signup. The cap is per HOUR not per minute
 *     because real users come back later — we don't want to lock out
 *     someone who tried 3 times this morning and is finishing now.
 *   - 50/ip-bucket/hour: a normal cellular tower (one /24) might have
 *     100 phones on it, but only a tiny fraction are signing up at any
 *     given hour. 50 is the worst-case "the entire neighborhood decided
 *     to try AcreOS today" — at which point we'd be ecstatic, not
 *     defending against. Realistically the bucket trips only on signup
 *     farms / scrape bots.
 */
export const signupLimiter = dualLaneLimiter({
  label: "signup",
  emailLane: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  ipBucketLane: { maxRequests: 50, windowMs: 60 * 60 * 1000 },
  docsSlug: "signup-rate-limit",
});

/**
 * Login limiter.
 *   - 5 failed attempts per email per hour → 15-min cooldown on that email
 *   - IP-bucket secondary lane is SOFT (logs warning, doesn't block)
 *
 * Why IP-bucket is soft on login:
 *   - The targeted account is the threat model — the email is what we
 *     limit hard. A CGNAT lockout would 429 every iPhone on the cell
 *     because one neighbor mistyped their password 5 times. We'd rather
 *     trust the per-email cap and emit a signal for review than hard-block
 *     the network. Repeated soft-trips get surfaced via getRateLimitHitStats.
 */
export const loginLimiter = dualLaneLimiter({
  label: "login",
  // 5 failures / email / hour with a 15-minute cooldown window. We model
  // this as a 5-event sliding window where the window is the cooldown
  // duration — once you've hit the cap, you're locked out until the
  // oldest entry rolls off (i.e. effectively 15 min).
  //
  // NOTE: This middleware counts every POST, not just failures. The
  // ideal version increments only on auth failure (skipSuccessfulRequests).
  // For now: 5 attempts / 15 min is still cellular-NAT-safe because the
  // key is the SUBMITTED EMAIL — one bad neighbor cannot lock anyone else
  // out by definition.
  emailLane: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  ipBucketLane: { maxRequests: 100, windowMs: 15 * 60 * 1000 },
  ipBucketSoft: true,
  docsSlug: "login-rate-limit",
});

/**
 * Password-reset limiter.
 *   - 3 attempts per email per hour
 *   - NO IP-bucket lane (no soft, no hard)
 *
 * Why: an attacker who knows your email can spam reset emails to flood
 * your inbox. The threat is the email-knowledge, not the IP. A pure-IP
 * limiter here would falsely lock out legitimate carrier-NAT'd users
 * trying to reset a forgotten password while sharing an IP with someone
 * doing legitimate signup work.
 */
export const passwordResetLimiter = dualLaneLimiter({
  label: "password_reset",
  emailLane: { maxRequests: 3, windowMs: 60 * 60 * 1000 },
  // No ipBucketLane — see comment above.
  docsSlug: "password-reset-rate-limit",
});

/**
 * Email verification re-send limiter.
 *   - 10 attempts per email per hour
 *   - No IP-bucket lane (same reasoning as password reset — email
 *     knowledge IS the threat model).
 *
 * Users routinely click "resend verification" 2-3 times when an email
 * goes to spam, so 10 is the comfortable floor.
 */
export const emailVerifyLimiter = dualLaneLimiter({
  label: "email_verify",
  emailLane: { maxRequests: 10, windowMs: 60 * 60 * 1000 },
  docsSlug: "email-verify-rate-limit",
});
