/**
 * Invite-token primitives.
 *
 * Pelle G/H/I: invite tokens used to be stored plaintext in
 * organization_invitations.token. Anyone with read access to that table
 * (DB backup, ops dashboard, audit log spillover) could redeem any
 * outstanding invite. This module:
 *
 *   1. Generates a fresh URL-safe token (24 random bytes → 32 chars).
 *   2. Hashes it with SHA-256 — the hash is what we persist.
 *   3. Provides constant-time comparison helpers for both the new
 *      hashed-row path and the legacy plaintext-row path (tolerant
 *      validation; lazy migration on next access).
 *   4. Exposes a redaction helper used by the audit-log writer so that
 *      invite-create / invite-accept entries log only the last 4 chars.
 */

import crypto from "node:crypto";

/** 32-char base64url token (24 random bytes). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/** SHA-256 hex of the plaintext token. Persisted; the plaintext is not. */
export function hashInviteToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/** Last 4 chars of the plaintext token — safe for audit logs / support UI. */
export function inviteTokenLast4(plaintext: string): string {
  if (!plaintext || plaintext.length < 4) return plaintext;
  return plaintext.slice(-4);
}

/** Redact a plaintext token for log output: "***last4". */
export function redactToken(plaintext: string | null | undefined): string {
  if (!plaintext) return "<none>";
  return `***${inviteTokenLast4(plaintext)}`;
}

/**
 * Constant-time comparison of two equal-length strings.
 * Returns false on length mismatch (without timing leak).
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still run a dummy compare so callers don't get a fast-path early-exit
    // observable from outside.
    const dummy = Buffer.alloc(Math.max(a.length, b.length, 1));
    crypto.timingSafeEqual(dummy, Buffer.alloc(dummy.length));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Tolerant matcher: given a plaintext token from the URL and a stored row
 * with both `token` (legacy plaintext, may be null) and `inviteTokenHash`
 * (new path, may be null), decide whether the token is valid for that row.
 *
 * The caller is expected to have already loaded a candidate row by hash
 * lookup — this helper exists for the legacy fallback path where the row
 * was located by plaintext-equality query.
 */
export function tokenMatchesRow(
  plaintext: string,
  row: { token: string | null; inviteTokenHash: string | null }
): boolean {
  if (row.inviteTokenHash) {
    return timingSafeEqualStr(hashInviteToken(plaintext), row.inviteTokenHash);
  }
  if (row.token) {
    return timingSafeEqualStr(plaintext, row.token);
  }
  return false;
}
