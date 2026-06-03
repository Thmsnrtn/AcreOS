/**
 * Borrower statement-access service.
 *
 * F3.4 fix (2026-06-03) — Beatrice's pre-deploy audit flagged that
 * `GET /api/borrower/statements/generate` took `accessToken` + `email`
 * as URL query params. URL params hit proxy logs, Sentry, and
 * Cloudflare logs, which together leak an auth-bypass for the
 * borrower's statement.
 *
 * Fix: borrower POSTs (accessToken, email) to an exchange endpoint
 * which mints a signed, IP-bound, 30-minute borrower_session cookie.
 * Subsequent statement-fetch requests carry only that cookie — no
 * credentials in the URL.
 *
 * Email-link first-open follow-up (frontend work, not in this commit):
 *   The current email links land directly on the credential-bearing
 *   URL. The follow-up frontend change is a small server-rendered
 *   intermediate page (or `/borrower/statements/landing?...`) that:
 *     1. POSTs (accessToken, email) to /api/borrower/auth/exchange
 *     2. Server sets the borrower_session cookie
 *     3. Page redirects to /borrower/statements/<id>
 *   Server-side surfaces ship now; the landing page lands separately.
 *
 * This module also exposes pure helpers (`signSession`,
 * `verifySignedSession`) so the signing logic can be unit-tested
 * without DB or HTTP fixtures.
 */

import crypto from "crypto";
import { logger } from "../../utils/logger";

/** 30 minutes — borrower opens email link, reads statement, done. */
export const SESSION_TTL_SECONDS = 30 * 60;
/**
 * Distinct from the DB-backed `borrower_session` cookie set by
 * `/api/borrower/verify`. The DB-backed one is a lookup token; this
 * one is a self-contained HMAC-signed value used only for statement
 * access. Keeping them separate avoids accidental confusion of
 * format expectations.
 */
export const COOKIE_NAME = "borrower_stmt_session";

/**
 * Read the signing secret lazily so tests can set the env var before
 * the first call. Module-load reads break vitest's isolated test runs.
 * Throws on first call when unset (fail-closed).
 */
function getSigningSecret(): string {
  const secret = process.env.BORROWER_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "BORROWER_SESSION_SECRET is required (>=16 chars) — fail-closed.",
    );
  }
  return secret;
}

export interface ExchangeInput {
  accessToken: string;
  email: string;
  /** Caller's IP — bind the session to mitigate token replay. */
  ip: string;
}

export interface ExchangeResult {
  ok: boolean;
  /** Signed cookie value to set on response. */
  sessionCookie?: string;
  /** Server-side scope (e.g. `note:<id>`) — caller can use for logging. */
  scope?: string;
  reason?: string;
}

export interface SignSessionPayload {
  scope: string;
  /** Lifetime in seconds (added to now). */
  expSeconds: number;
  ip: string;
}

/**
 * Pure helper: build a signed cookie value of the form `<base64(payload)>.<sig>`.
 *
 * Payload is base64({ scope, exp, ip }) where exp is the absolute
 * unix-epoch-seconds expiry. Signature is HMAC-SHA256 over the encoded
 * payload using BORROWER_SESSION_SECRET. We compare with
 * `crypto.timingSafeEqual` on verify.
 */
export function signSession(payload: SignSessionPayload): string {
  const secret = getSigningSecret();
  const exp = Math.floor(Date.now() / 1000) + payload.expSeconds;
  const body = { scope: payload.scope, exp, ip: payload.ip };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString(
    "base64url",
  );
  const sig = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export interface VerifySignedResult {
  valid: boolean;
  scope?: string;
  ip?: string;
  /** True only when the signature was valid but the timestamp has passed. */
  expired?: boolean;
}

/**
 * Pure helper: verify the signature + expiry of a signed cookie. Does
 * NOT enforce IP binding — that's the job of `verifyBorrowerSession`
 * which has the request IP in hand.
 */
export function verifySignedSession(cookieValue: string): VerifySignedResult {
  if (typeof cookieValue !== "string" || !cookieValue.includes(".")) {
    return { valid: false };
  }
  const dotIdx = cookieValue.lastIndexOf(".");
  const encoded = cookieValue.slice(0, dotIdx);
  const sig = cookieValue.slice(dotIdx + 1);

  let secret: string;
  try {
    secret = getSigningSecret();
  } catch (err) {
    // Re-throw so callers can fail-closed loudly during boot, but
    // never silently return valid.
    throw err;
  }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length) {
    return { valid: false };
  }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false };
  }

  let body: { scope?: string; exp?: number; ip?: string };
  try {
    body = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { valid: false };
  }
  if (
    typeof body.scope !== "string" ||
    typeof body.exp !== "number" ||
    typeof body.ip !== "string"
  ) {
    return { valid: false };
  }

  const now = Math.floor(Date.now() / 1000);
  if (body.exp < now) {
    return { valid: false, expired: true, scope: body.scope, ip: body.ip };
  }

  return { valid: true, scope: body.scope, ip: body.ip };
}

/**
 * Validate (accessToken, email) against the existing borrower-statement
 * grant and, on success, mint a signed session cookie bound to the
 * caller's IP.
 *
 * The actual (accessToken, email) → note lookup is injected so this
 * service stays decoupled from `storage` and is unit-testable. The
 * route wires `storage.getNoteByAccessToken` + `storage.getLead` to
 * the resolver.
 *
 * Never logs the accessToken or email values — only structured success/
 * failure outcomes for the audit trail.
 */
export interface BorrowerGrantResolver {
  resolve(input: { accessToken: string; email: string }): Promise<
    | { ok: true; scope: string }
    | { ok: false; reason: "not_found" | "email_mismatch" | "no_borrower" }
  >;
}

export async function exchangeForBorrowerSession(
  input: ExchangeInput,
  resolver: BorrowerGrantResolver,
): Promise<ExchangeResult> {
  if (!input.accessToken || !input.email || !input.ip) {
    logger.warn("Borrower session exchange rejected — missing fields", {
      metadata: {
        hasAccessToken: Boolean(input.accessToken),
        hasEmail: Boolean(input.email),
        hasIp: Boolean(input.ip),
      },
    });
    return { ok: false, reason: "missing_fields" };
  }

  const grant = await resolver.resolve({
    accessToken: input.accessToken,
    email: input.email,
  });

  if (!grant.ok) {
    logger.warn("Borrower session exchange failed", {
      metadata: { reason: grant.reason },
    });
    return { ok: false, reason: grant.reason };
  }

  const cookie = signSession({
    scope: grant.scope,
    expSeconds: SESSION_TTL_SECONDS,
    ip: input.ip,
  });

  logger.info("Borrower session exchange succeeded", {
    metadata: { scope: grant.scope, ttlSeconds: SESSION_TTL_SECONDS },
  });

  return { ok: true, sessionCookie: cookie, scope: grant.scope };
}

/**
 * Verify a session cookie on subsequent requests. Combines signature
 * + expiry check (via `verifySignedSession`) with the IP-binding
 * defense that mitigates token replay across networks.
 */
export function verifyBorrowerSession(
  cookieValue: string,
  ip: string,
): { valid: boolean; statementSetScope?: string; reason?: string } {
  const inner = verifySignedSession(cookieValue);
  if (!inner.valid) {
    return {
      valid: false,
      reason: inner.expired ? "expired" : "invalid_signature",
    };
  }
  if (inner.ip !== ip) {
    logger.warn("Borrower session IP mismatch", {
      metadata: { scope: inner.scope },
    });
    return { valid: false, reason: "ip_mismatch" };
  }
  return { valid: true, statementSetScope: inner.scope };
}
