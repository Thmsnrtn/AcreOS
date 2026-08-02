/**
 * Founder read-only impersonation — real, enforced, and auditable.
 *
 * The prior endpoint returned `{ readOnly: true, expiresAt }` as plain JSON that
 * NOTHING enforced: no token was minted, no middleware swapped the org, and no
 * middleware blocked writes — a fabricated guarantee (INV-TRUTH-1) that would
 * not survive a deposition. This replaces it with a real mechanism:
 *
 *   - a short-lived HMAC-signed token carrying {founderUserId, targetOrgId,
 *     expiresAt}, set as an httpOnly cookie by the start endpoint;
 *   - getOrCreateOrg swaps the active org to the target ONLY for the founder the
 *     token was minted for, and hard-blocks every mutating HTTP method;
 *   - start/end are written to the immutable, hash-chained audit_events log
 *     (founder-visible), not the tenant's activity log.
 *
 * This module is pure (no db, no Express) so it is fully unit-testable; the
 * middleware does the org load and the endpoints do the cookie + audit.
 */
import crypto from "crypto";

export const IMPERSONATION_COOKIE = "acreos_impersonation";
export const IMPERSONATION_HEADER = "x-impersonation-token";
export const IMPERSONATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ImpersonationSession {
  founderUserId: string;
  targetOrgId: number;
  /** epoch ms */
  expiresAt: number;
}

/**
 * Signing secret. Falls back across the app's stable secrets; when NONE is
 * configured, minting returns null → impersonation is disabled (fail-safe),
 * never signed with a guessable key.
 */
function signingSecret(): string | null {
  return process.env.SESSION_SECRET || process.env.CLERK_SECRET_KEY || null;
}

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

/** Mint a signed impersonation token, or null if no secret is configured. */
export function mintImpersonationToken(
  founderUserId: string,
  targetOrgId: number,
  now: number,
): { token: string; session: ImpersonationSession } | null {
  const secret = signingSecret();
  if (!secret) return null;
  const session: ImpersonationSession = {
    founderUserId,
    targetOrgId,
    expiresAt: now + IMPERSONATION_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { token: `${body}.${sign(body, secret)}`, session };
}

/**
 * Verify a token: valid signature, well-formed payload, and unexpired.
 * Returns the session or null. Constant-time signature comparison.
 */
export function verifyImpersonationToken(
  token: string | undefined | null,
  now: number,
): ImpersonationSession | null {
  const secret = signingSecret();
  if (!secret || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body, secret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const p = payload as Partial<ImpersonationSession>;
  if (
    typeof p.founderUserId !== "string" ||
    typeof p.targetOrgId !== "number" ||
    !Number.isInteger(p.targetOrgId) ||
    typeof p.expiresAt !== "number"
  ) {
    return null;
  }
  if (now >= p.expiresAt) return null; // expired
  return { founderUserId: p.founderUserId, targetOrgId: p.targetOrgId, expiresAt: p.expiresAt };
}

/** True for HTTP methods that can change state — blocked during impersonation. */
export function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes((method || "").toUpperCase());
}
