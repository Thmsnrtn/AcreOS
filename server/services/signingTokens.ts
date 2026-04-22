/**
 * Signing-token helpers for the native e-sign flow.
 *
 * When an operator dispatches a generated document for signature, each
 * signer in the document's `signers` array gets a unique signing URL:
 *
 *   https://acreos.io/sign/{docId}?s={signerId}&t={token}
 *
 * The token is an HMAC-SHA256 of `{docId}:{signerId}` using SESSION_SECRET.
 * This lets an external signer (typically a seller who has no AcreOS
 * account) reach a public page, prove they're the intended recipient,
 * and submit a drawn/typed signature — without us granting them an
 * account or a login cookie.
 *
 * Security model:
 *   - Token is scoped to (docId, signerId). Rotating the signer ID on
 *     the document (by re-dispatching for signature) invalidates the
 *     old URL.
 *   - SESSION_SECRET is required; the token length is stable so timing
 *     attacks don't leak information about individual signers.
 *   - Token does NOT expire on its own — the document's `expiresAt`
 *     field gates that (30 days default, set at dispatch time).
 */

import crypto from "crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set — signing tokens cannot be issued");
  return s;
}

export function makeSigningToken(docId: number, signerId: string): string {
  const h = crypto.createHmac("sha256", secret());
  h.update(`${docId}:${signerId}`);
  return h.digest("base64url");
}

export function verifySigningToken(
  docId: number,
  signerId: string,
  token: string,
): boolean {
  if (!token || !signerId) return false;
  try {
    const expected = makeSigningToken(docId, signerId);
    const a = Buffer.from(expected);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
