/**
 * botSignals — capture-only signup-fingerprinting middleware.
 *
 * Phase 0 traffic-readiness — the first 10-100 signups will arrive mixed
 * with bot probes. We don't want to block bots (false-positives on a real
 * launch are worse than letting a bot create an empty account); instead
 * we COLLECT signals and surface them to the founder for review.
 *
 * Signals collected:
 *   1. honeypot_filled — A hidden form field named `website` that humans
 *      never see and bots routinely fill. If filled, flag (don't block).
 *   2. time_to_fill_ms — Form-render timestamp vs. submit timestamp. Real
 *      humans take 5-30 seconds; bots submit in <2s.
 *   3. user_agent — Stored raw + checked against a known-crawler list. We
 *      flag but never auto-block based on UA.
 *   4. ip_bucket — /24 IPv4 or /48 IPv6, matched to the same coarsening
 *      used in authPathLimits.ts so signals cross-join cleanly.
 *
 * Optional CAPTCHA scaffolding (env-gated):
 *   - When ENABLE_CAPTCHA=1, we require + verify a captcha token (hCaptcha
 *     or Cloudflare Turnstile, picked by CAPTCHA_PROVIDER) before the
 *     signal row is marked verified. The verifier is a stub by default so
 *     the env-gating works end-to-end without a real provider account.
 *
 * Storage: writes one row to signup_signals per signup attempt. Always
 * fire-and-forget so accounting failures never block the user.
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { sendError } from "../utils/errors";
import { signupSignals } from "@shared/schema";
import { logger } from "../utils/logger";
import { ipBucket } from "./authPathLimits";

/**
 * Heuristic regexes for known crawler/scrape UAs. Conservative on purpose —
 * we'd rather miss a few than false-positive a Safari iPhone.
 */
const KNOWN_CRAWLER_PATTERNS = [
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /scrape/i,
  /headlesschrome/i,
  /puppeteer/i,
  /playwright/i,
  /selenium/i,
  /python-requests/i,
  /curl\//i,
  /wget\//i,
  /go-http-client/i,
];

/**
 * Minimum time-to-fill (ms) before we consider the submission suspicious.
 * 2 seconds is the lower bound for a real human moving fast — even
 * autofill takes longer than that because the user still has to read the
 * page and click submit.
 */
const TTF_SUSPICIOUS_BELOW_MS = 2000;

interface SignupBodyShape {
  email?: string;
  identifier?: string;
  // Honeypot — humans don't see this field; bots fill it.
  website?: string;
  // Time-to-fill — page-load timestamp emitted by the client signup form.
  formRenderedAt?: number;
  // Optional captcha token from hCaptcha / Cloudflare Turnstile.
  captchaToken?: string;
}

function sha256Email(email: string): string {
  return crypto.createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

function reqIpBucket(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const ip =
    (typeof fwd === "string" ? fwd.split(",")[0].trim() : null) ??
    req.ip ??
    req.socket.remoteAddress ??
    "";
  return ipBucket(ip);
}

/**
 * Stub captcha verifier. Production wiring should swap this for the real
 * provider (hCaptcha verify endpoint or Cloudflare Turnstile siteverify).
 * Returning `null` means "captcha not enabled / not present" — distinct
 * from `false` ("captcha was attempted and failed").
 */
async function verifyCaptchaToken(token: string | undefined | null): Promise<boolean | null> {
  if (process.env.ENABLE_CAPTCHA !== "1") return null;
  if (!token) return false;
  const provider = (process.env.CAPTCHA_PROVIDER || "hcaptcha").toLowerCase();
  const secret = process.env.CAPTCHA_SECRET_KEY;
  if (!secret) {
    logger.warn("[botSignals] ENABLE_CAPTCHA=1 but CAPTCHA_SECRET_KEY not set — treating as verified to avoid blocking signups");
    return true;
  }
  try {
    const verifyUrl =
      provider === "turnstile"
        ? "https://challenges.cloudflare.com/turnstile/v0/siteverify"
        : "https://hcaptcha.com/siteverify";
    const body = new URLSearchParams({ secret, response: token });
    const resp = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch (err) {
    logger.warn("[botSignals] captcha verify call failed — failing open to avoid signup block", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    // Fail open so a downed verifier never blocks signups — the signal
    // row still records that the token was present but not verified.
    return true;
  }
}

/**
 * Programmatic signal-row writer. Used by:
 *   1. `captureSignupSignals` middleware (legacy / future custom-form path)
 *   2. POST /api/auth/signup-signals (the sideband emission from the Clerk
 *      <SignUp> widget — see client/src/pages/auth-page.tsx)
 *   3. `recordSignalsNotEmitted` (audit fallback when client never POSTs)
 *
 * Always fire-and-forget at the call site: the DB insert is awaited inside
 * this function but the caller decides whether to `void` it. Never block
 * the signup completion path on the insert.
 *
 * @returns the inserted row id, or null if the write failed (caller can
 * decide to log additional context — we already log internally).
 */
export async function recordSignupSignals(input: {
  email?: string | null;
  userId?: string | null;
  userAgent?: string | null;
  ipBucket?: string;
  website?: string | null;
  formRenderedAt?: number | null;
  formSubmittedAt?: number | null;
  captchaToken?: string | null;
  /**
   * When false, persists a row with `signals_emitted=false` flagged in
   * reasons so the audit can count "client never fired the sideband POST"
   * vs. "client fired but submitted nothing suspicious." We co-opt the
   * existing `reasons` jsonb array rather than adding a new column.
   */
  signalsEmitted?: boolean;
}): Promise<number | null> {
  const now = Date.now();
  const email = (input.email || "").toLowerCase().trim();
  const emailHash = email ? sha256Email(email) : null;
  const userAgent = (input.userAgent || "").slice(0, 1000);
  const bucket = input.ipBucket || "unknown";
  const honeypotFilled = typeof input.website === "string" && input.website.length > 0;
  const renderedAt =
    typeof input.formRenderedAt === "number" && Number.isFinite(input.formRenderedAt)
      ? input.formRenderedAt
      : null;
  const submittedAt =
    typeof input.formSubmittedAt === "number" && Number.isFinite(input.formSubmittedAt)
      ? input.formSubmittedAt
      : null;
  // Prefer client-supplied submittedAt over server-now so the TTF reflects
  // the actual form-fill duration, not network latency. Fall back to now.
  const referenceEnd = submittedAt && renderedAt && submittedAt > renderedAt ? submittedAt : now;
  const timeToFillMs =
    renderedAt !== null && renderedAt > 0 && renderedAt <= referenceEnd
      ? referenceEnd - renderedAt
      : null;

  const reasons: string[] = [];
  if (honeypotFilled) reasons.push("honeypot");
  if (timeToFillMs !== null && timeToFillMs < TTF_SUSPICIOUS_BELOW_MS) reasons.push("ttf-too-fast");
  if (KNOWN_CRAWLER_PATTERNS.some((rx) => rx.test(userAgent))) reasons.push("crawler-ua");
  if (!userAgent || userAgent.length < 10) reasons.push("missing-ua");
  if (input.signalsEmitted === false) reasons.push("signals-not-emitted");

  const isSuspicious = reasons.length > 0 && !(reasons.length === 1 && reasons[0] === "signals-not-emitted");

  const captchaTokenPresent =
    typeof input.captchaToken === "string" && input.captchaToken.length > 0;
  let captchaVerified: boolean | null = null;
  try {
    captchaVerified = await verifyCaptchaToken(input.captchaToken ?? undefined);
  } catch {
    captchaVerified = null;
  }

  try {
    const [row] = await db
      .insert(signupSignals)
      .values({
        emailHash,
        userId: input.userId ?? null,
        userAgent,
        ipBucket: bucket,
        honeypotFilled,
        timeToFillMs,
        isSuspicious,
        reasons,
        captchaTokenPresent,
        captchaVerified,
      })
      .returning({ id: signupSignals.id });
    if (isSuspicious) {
      logger.warn("[botSignals] suspicious signup attempt captured", {
        metadata: {
          ipBucket: bucket,
          reasons,
          ua: userAgent.slice(0, 200),
          timeToFillMs,
          honeypotFilled,
        },
      });
    }
    return row?.id ?? null;
  } catch (err) {
    logger.warn("[botSignals] signup_signals insert failed — continuing", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}

/**
 * Convenience for the "client never fired the sideband POST" case.
 * Called from provisionUser when no prior signal row exists for the email
 * hash. Persists a row with signals_emitted=false so the audit can see the
 * gap (rather than silently missing).
 */
export async function recordSignalsNotEmitted(input: {
  email: string;
  userId: string;
  userAgent?: string | null;
  ipBucket?: string;
}): Promise<void> {
  await recordSignupSignals({
    email: input.email,
    userId: input.userId,
    userAgent: input.userAgent ?? null,
    ipBucket: input.ipBucket,
    signalsEmitted: false,
  });
}

export function computeReqIpBucket(req: Request): string {
  return reqIpBucket(req);
}

/**
 * Captures bot signals for a signup request. ALWAYS calls next() — this is
 * collection-only by design. The decision to act on a suspicious row sits
 * outside this middleware (founder admin surface).
 *
 * NOTE (2026-06-02): Originally mounted on /api/register — which has no
 * handler in this codebase (signup flows through Clerk → first authenticated
 * request → getOrCreateOrg.provisionUser). Kept as exported middleware in
 * case a non-Clerk signup form re-enters the stack, but the real signal
 * capture now flows through POST /api/auth/signup-signals + recordSignalsNotEmitted
 * inside provisionUser.
 */
export async function captureSignupSignals(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const body = (req.body ?? {}) as SignupBodyShape;
  const now = Date.now();

  const email = (body.email || body.identifier || "").toLowerCase().trim();
  const emailHash = email ? sha256Email(email) : null;
  const userAgent = (req.headers["user-agent"] as string) || "";
  const bucket = reqIpBucket(req);

  const honeypotFilled = typeof body.website === "string" && body.website.length > 0;
  const renderedAt =
    typeof body.formRenderedAt === "number" && Number.isFinite(body.formRenderedAt)
      ? body.formRenderedAt
      : null;
  const timeToFillMs =
    renderedAt !== null && renderedAt > 0 && renderedAt <= now ? now - renderedAt : null;

  const reasons: string[] = [];
  if (honeypotFilled) reasons.push("honeypot");
  if (timeToFillMs !== null && timeToFillMs < TTF_SUSPICIOUS_BELOW_MS) reasons.push("ttf-too-fast");
  if (KNOWN_CRAWLER_PATTERNS.some((rx) => rx.test(userAgent))) reasons.push("crawler-ua");
  if (!userAgent || userAgent.length < 10) reasons.push("missing-ua");

  const isSuspicious = reasons.length > 0;

  // Captcha verification — only when ENABLE_CAPTCHA=1.
  const captchaTokenPresent = typeof body.captchaToken === "string" && body.captchaToken.length > 0;
  let captchaVerified: boolean | null = null;
  try {
    captchaVerified = await verifyCaptchaToken(body.captchaToken);
  } catch {
    captchaVerified = null;
  }

  // Fire-and-forget DB write. We never block the request on this.
  void (async () => {
    try {
      await db.insert(signupSignals).values({
        emailHash,
        userId: null,
        userAgent: userAgent.slice(0, 1000),
        ipBucket: bucket,
        honeypotFilled,
        timeToFillMs,
        isSuspicious,
        reasons,
        captchaTokenPresent,
        captchaVerified,
      });

      if (isSuspicious) {
        logger.warn("[botSignals] suspicious signup attempt captured", {
          metadata: {
            ipBucket: bucket,
            reasons,
            ua: userAgent.slice(0, 200),
            timeToFillMs,
            honeypotFilled,
          },
        });
      }
    } catch (err) {
      logger.warn("[botSignals] signup_signals insert failed — continuing", {
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  })();

  // If honeypot is filled, slightly delay the response to avoid leaking
  // detection signal to the bot. Still accept the request — refusal would
  // reveal the trap.
  if (honeypotFilled) {
    setTimeout(() => next(), 500);
    return;
  }

  next();
}

/**
 * Captcha gate — env-gated middleware that BLOCKS the signup if
 * ENABLE_CAPTCHA=1 and the token did not verify. Mount AFTER
 * captureSignupSignals so the signal row records the attempt even on
 * failure.
 *
 * Default off: returns next() immediately when ENABLE_CAPTCHA is not set,
 * so flipping the flag is a one-env-var rollback if the captcha provider
 * misfires during a launch.
 */
export async function requireCaptchaIfEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (process.env.ENABLE_CAPTCHA !== "1") return next();
  const body = (req.body ?? {}) as SignupBodyShape;
  const token = body.captchaToken;
  const verified = await verifyCaptchaToken(token);
  if (verified === false) {
    sendError(res, 400, "CAPTCHA_REQUIRED", "Please complete the verification challenge to continue.");
    return;
  }
  next();
}
