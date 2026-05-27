/**
 * Signing-token helpers for the native e-sign flow.
 *
 * When an operator dispatches a generated document for signature, each
 * signer in the document's `signers` array gets a unique signing URL:
 *
 *   https://acreos.io/sign/{docId}?s={signerId}&t={token}
 *
 * The token is an HMAC-SHA256 of `{docId}:{signerId}` using the current
 * signing key. This lets an external signer (typically a seller who has
 * no AcreOS account) reach a public page, prove they're the intended
 * recipient, and submit a drawn/typed signature — without us granting
 * them an account or a login cookie.
 *
 * Security model:
 *   - Token is scoped to (docId, signerId). Rotating the signer ID on
 *     the document (by re-dispatching for signature) invalidates the
 *     old URL.
 *   - At least one signing key must be loaded; the token length is
 *     stable so timing attacks don't leak information about individual
 *     signers.
 *   - Token does NOT expire on its own — the document's `expiresAt`
 *     field gates that (30 days default, set at dispatch time).
 *
 * ─── Key rotation (Lens 23 — Yuki audit) ──────────────────────────────
 *
 * Before this change, signing tokens were HMAC'd with SESSION_SECRET.
 * That coupled e-sign token lifetime to session-cookie secret lifetime —
 * rotating SESSION_SECRET (a routine ops action for cookie hygiene)
 * silently invalidated EVERY outstanding signing URL, including
 * documents already dispatched to sellers who hadn't signed yet.
 * Sellers would click the link, see "Invalid signing link" and assume
 * a phish, killing the deal.
 *
 * Fix: split signing keys into their own env var + keyring pattern
 * mirroring FIELD_ENCRYPTION_KEYS:
 *
 *   SIGNING_KEYS='{"2026q3":"<hex>","2026q4":"<hex>"}'
 *   SIGNING_CURRENT_KID=2026q4
 *
 * New tokens are stamped with the current kid: `<kid>.<hmac>` (note the
 * '.' separator, kept short to fit in URL query params cleanly). Verify
 * first looks at the kid prefix to pick the right key; if no kid is
 * present, fall back to the legacy SESSION_SECRET path so tokens minted
 * before this change still work until the document expires.
 *
 * Rotation flow:
 *   1. Add new kid to SIGNING_KEYS, leave old kid present
 *   2. Flip SIGNING_CURRENT_KID to the new kid
 *   3. Wait until every outstanding doc.expiresAt has passed (≤ 30 days)
 *   4. Remove old kid from the ring
 *
 * SESSION_SECRET rotation no longer affects signing tokens at all once
 * SIGNING_KEYS is set. If SIGNING_KEYS is unset, we still read
 * SESSION_SECRET (for unbroken backwards-compat with existing deploys
 * that haven't migrated yet) — but a startup warning is emitted.
 */

import crypto from "crypto";
import { logger } from "../utils/logger";

const LEGACY_KID = "legacy";
const KID_SEPARATOR = ".";

interface KeyRing {
  currentKid: string;
  keys: Map<string, string>;
  isLegacyOnly: boolean;
}

let _keyRing: KeyRing | null = null;

function loadKeyRing(): KeyRing {
  const ringRaw = process.env.SIGNING_KEYS;
  if (!ringRaw) {
    // Backwards-compat: fall back to SESSION_SECRET as the "legacy" kid.
    // This keeps every existing dispatched signing URL valid until its
    // document expires. Operators are expected to migrate to SIGNING_KEYS
    // at their leisure.
    const s = process.env.SESSION_SECRET;
    if (!s) {
      throw new Error(
        "[signingTokens] SIGNING_KEYS not set and SESSION_SECRET is also missing — cannot issue signing tokens",
      );
    }
    if (process.env.NODE_ENV !== "test") {
      logger.warn(
        "[signingTokens] SIGNING_KEYS not configured; falling back to SESSION_SECRET. Migrate before rotating SESSION_SECRET or all outstanding signing URLs will break.",
      );
    }
    return {
      currentKid: LEGACY_KID,
      keys: new Map([[LEGACY_KID, s]]),
      isLegacyOnly: true,
    };
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(ringRaw);
  } catch {
    throw new Error("[signingTokens] SIGNING_KEYS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("[signingTokens] SIGNING_KEYS must be an object kid → secret");
  }

  const ring = new Map<string, string>();
  for (const [kid, secret] of Object.entries(parsed)) {
    if (kid.includes(KID_SEPARATOR)) {
      throw new Error(
        `[signingTokens] kid '${kid}' must not contain '${KID_SEPARATOR}' (used as token separator)`,
      );
    }
    if (typeof secret !== "string" || secret.length < 16) {
      throw new Error(
        `[signingTokens] SIGNING_KEYS[${kid}] must be a string of at least 16 chars`,
      );
    }
    ring.set(kid, secret);
  }
  if (ring.size === 0) {
    throw new Error("[signingTokens] SIGNING_KEYS is empty");
  }

  const currentKid = process.env.SIGNING_CURRENT_KID;
  if (!currentKid) {
    throw new Error(
      "[signingTokens] SIGNING_CURRENT_KID must be set when SIGNING_KEYS is set",
    );
  }
  if (!ring.has(currentKid)) {
    throw new Error(
      `[signingTokens] SIGNING_CURRENT_KID=${currentKid} not present in keyring`,
    );
  }

  // Also pin SESSION_SECRET into the ring under LEGACY_KID so tokens
  // minted before SIGNING_KEYS was introduced still verify until they
  // expire naturally with their document. This is purely additive —
  // remove the legacy kid from the ring once the rotation window has
  // exceeded the longest doc.expiresAt (30 days default).
  if (!ring.has(LEGACY_KID)) {
    const legacy = process.env.SESSION_SECRET;
    if (legacy) ring.set(LEGACY_KID, legacy);
  }

  return { currentKid, keys: ring, isLegacyOnly: false };
}

function getKeyRing(): KeyRing {
  if (!_keyRing) _keyRing = loadKeyRing();
  return _keyRing;
}

/** Test-only — reset the cached keyring so env-var changes between tests take effect. */
export function __resetKeyRingForTests(): void {
  _keyRing = null;
}

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function makeSigningToken(docId: number, signerId: string): string {
  const ring = getKeyRing();
  const secret = ring.keys.get(ring.currentKid);
  if (!secret) {
    throw new Error(
      `[signingTokens] current kid '${ring.currentKid}' has no key material`,
    );
  }
  const digest = hmac(secret, `${docId}:${signerId}`);
  if (ring.isLegacyOnly) {
    // Maintain bit-for-bit compatibility with the pre-rotation format —
    // no kid prefix at all. Deployments that haven't migrated to
    // SIGNING_KEYS see zero behavior change.
    return digest;
  }
  return `${ring.currentKid}${KID_SEPARATOR}${digest}`;
}

export function verifySigningToken(
  docId: number,
  signerId: string,
  token: string,
): boolean {
  if (!token || !signerId) return false;
  try {
    const ring = getKeyRing();

    // Newer tokens carry a `<kid>.<hmac>` prefix. Old tokens are bare HMACs.
    let kid: string;
    let presented: string;
    const sepIdx = token.indexOf(KID_SEPARATOR);
    if (sepIdx > 0 && sepIdx < token.length - 1) {
      kid = token.slice(0, sepIdx);
      presented = token.slice(sepIdx + 1);
    } else {
      kid = LEGACY_KID;
      presented = token;
    }

    const secret = ring.keys.get(kid);
    if (!secret) {
      // Unknown kid → either token was issued under a kid we've since
      // retired, or someone fabricated a prefix. Either way, reject.
      return false;
    }

    const expected = hmac(secret, `${docId}:${signerId}`);
    const a = Buffer.from(expected);
    const b = Buffer.from(presented);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
