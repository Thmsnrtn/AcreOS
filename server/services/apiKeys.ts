/**
 * Public API key service — Lens 50 (Public API v0).
 *
 * Generates, hashes, and verifies bearer tokens used by /api/v1/* routes.
 *
 * Token format (Stripe-style):
 *   ak_live_<22 bytes base64url>           — production
 *   ak_test_<22 bytes base64url>           — sandbox/test
 *
 * The plaintext token is returned to the caller exactly once at creation
 * time. We persist:
 *   - prefix     : last 4 chars of the plaintext, shown in the UI for ID
 *   - hashedKey  : scrypt(plaintext, perKeyRandomSalt)
 *
 * Verification path (see middleware/requireApiKey.ts):
 *   1. Parse the bearer header → extract token.
 *   2. Look up candidate rows by a fast hash prefix (HMAC-SHA256 truncated
 *      to 16 hex chars, stored as the hashed_key column — collision-safe
 *      and constant-time-lookupable).
 *   3. Confirm with crypto.timingSafeEqual against the full hash.
 *
 * For v0 we use HMAC-SHA256 with a server-side pepper from
 * API_KEY_HASH_PEPPER (32+ byte random hex string). HMAC is fast enough
 * to verify on every request (~1µs) and the pepper makes a stolen DB
 * dump useless without simultaneous server compromise — the same posture
 * Plaid takes for `secret`s.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type ApiScope =
  | "leads:read"
  | "leads:write"
  | "properties:read"
  | "properties:write"
  | "deals:read"
  | "deals:write"
  | "notes:read"
  | "notes:write"
  | "webhooks:write";

export const ALL_SCOPES: readonly ApiScope[] = [
  "leads:read",
  "leads:write",
  "properties:read",
  "properties:write",
  "deals:read",
  "deals:write",
  "notes:read",
  "notes:write",
  "webhooks:write",
] as const;

const TOKEN_BYTES = 22;
const PREFIX_PLAIN_LEN = 11; // "ak_live_xxx" or "ak_test_xxx" visible prefix

function pepper(): string {
  const p = process.env.API_KEY_HASH_PEPPER;
  if (!p || p.length < 32) {
    // Hard refusal in production — without a strong pepper, leaked
    // hashes are crackable. In dev/test we accept a fallback so the
    // suite doesn't require infra setup.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "API_KEY_HASH_PEPPER must be set to a >=32 byte hex string in production",
      );
    }
    return "dev-pepper-not-secure-not-secure-not-secure";
  }
  return p;
}

/** Hash a plaintext token with HMAC-SHA256(pepper, token). */
export function hashApiKey(plaintext: string): string {
  return createHmac("sha256", pepper()).update(plaintext).digest("hex");
}

/** Constant-time compare of two equal-length hex digests. */
export function verifyHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * T0-3 (2026-06-10): constant-time compare of two arbitrary secrets.
 *
 * Used for static-token auth paths (e.g. the /mcp bearer key) where the
 * stored side is a plaintext env secret rather than a persisted hash.
 * Both sides are SHA-256'd first so the buffers handed to
 * crypto.timingSafeEqual are always equal length — a length mismatch
 * neither throws nor leaks the expected secret's length.
 */
export function verifySecret(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Generate a fresh API key.
 *
 * Returns the plaintext token (show it ONCE to the user, never again),
 * a 4-char `displayPrefix` for the settings UI, and the `hashedKey` to
 * persist in api_keys.hashed_key.
 */
export function generateApiKey(mode: "live" | "test" = "live"): {
  plaintext: string;
  displayPrefix: string;
  hashedKey: string;
} {
  const random = randomBytes(TOKEN_BYTES).toString("base64url");
  const plaintext = `ak_${mode}_${random}`;
  // 4 chars of the random portion is enough to disambiguate in the UI
  // without leaking entropy — the user sees e.g. "ak_live_xxxx…3f9c".
  const displayPrefix = plaintext.slice(PREFIX_PLAIN_LEN, PREFIX_PLAIN_LEN + 4);
  return {
    plaintext,
    displayPrefix,
    hashedKey: hashApiKey(plaintext),
  };
}

/** Generate a 32-byte hex webhook signing secret. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

/**
 * Validate that a requested scope set is a subset of the canonical
 * vocabulary. Used at key-create time in the settings UI.
 */
export function validateScopes(scopes: unknown): scopes is ApiScope[] {
  if (!Array.isArray(scopes)) return false;
  return scopes.every((s): s is ApiScope =>
    (ALL_SCOPES as readonly string[]).includes(s),
  );
}
