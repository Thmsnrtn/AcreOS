/**
 * Constant-time comparison for a shared secret presented by a caller.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * AcreOS compares secrets in two shapes, and until 2026-08-18 it treated them
 * very differently for no reason anyone chose:
 *
 *   - HMAC DIGESTS (Twilio, Meta webhook signatures, inbound email, signing
 *     tokens, wire instructions, API keys) went through
 *     `crypto.timingSafeEqual`. Eight sites, consistently.
 *   - PLAIN HEADER TOKENS (DEPLOY_BOT_TOKEN, METRICS_TOKEN,
 *     PULSE_SHARED_SECRET, UPTIME_PROBE_TOKEN, META_WEBHOOK_VERIFY_TOKEN) used
 *     `===`. Five sites, consistently.
 *
 * The distinction the code had drawn was HOW THE SECRET IS ENCODED, not whether
 * it is a secret — and the naive half was the plain-token half, where the
 * comparison is directly against caller-supplied bytes.
 *
 * ── THE SECOND BUG, WHICH THIS FIXES BY CONSTRUCTION ────────────────────────
 * `===` also silently accepts `undefined === undefined`. `verifyMetaWebhook`
 * compared `token === process.env.META_WEBHOOK_VERIFY_TOKEN` with no truthiness
 * guard, and its caller passes `req.query["hub.verify_token"] as string` — a
 * cast, not a check. With the env var unset and the query param absent, both
 * sides are `undefined`, the comparison passes, and the handler echoes
 * `req.query["hub.challenge"]` back through `res.send()`, which Express serves
 * as `text/html`: an unauthenticated reflected-content endpoint on the AcreOS
 * origin. The four other sites happened to guard with `if (expected)` first;
 * that one did not, and nothing made the guard mandatory.
 *
 * Refusing empty and non-string input here makes the guard structural rather
 * than a convention each call site has to remember.
 *
 * ── WHY HASH-THEN-COMPARE ───────────────────────────────────────────────────
 * `timingSafeEqual` THROWS on differing buffer lengths, so comparing raw bytes
 * needs a length check first — which leaks the length and is exactly the kind
 * of hand-written detail this helper exists to stop repeating. Digesting both
 * sides to a fixed 32 bytes makes every comparison the same shape. This is the
 * pattern `services/apiKeys.ts` already documents ("confirm with
 * crypto.timingSafeEqual against the full hash").
 */

import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

/**
 * True when `presented` matches `expected`.
 *
 * Fails CLOSED: a missing, empty, or non-string value on EITHER side is a
 * mismatch. An unconfigured secret can therefore never authenticate anyone,
 * which is the property `===` did not have.
 */
export function secretEquals(presented: unknown, expected: unknown): boolean {
  if (typeof presented !== "string" || presented.length === 0) return false;
  if (typeof expected !== "string" || expected.length === 0) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}
