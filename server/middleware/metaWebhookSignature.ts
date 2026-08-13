/**
 * Meta (Facebook) Lead Ads webhook signature verification — FAIL CLOSED.
 *
 * Meta signs every webhook delivery with an HMAC-SHA256 of the RAW request body
 * keyed by the app secret, sent as `X-Hub-Signature-256: sha256=<hex>`.
 *
 * WHAT THIS REPLACES, AND WHY IT MATTERED
 * ---------------------------------------
 * The check lived inline in the handler and was fail-open twice over:
 *
 *     const signature = req.headers["x-hub-signature-256"] as string;
 *     const appSecret = process.env.META_APP_SECRET;
 *     if (appSecret && signature) { …compare… }
 *
 *   1. **No secret configured → no verification at all.** Every deploy without
 *      `META_APP_SECRET` accepted any POST from anyone.
 *   2. **No header sent → the check was skipped even when the secret WAS set.**
 *      An attacker does not have to forge a signature; they omit the header.
 *
 * Either way the payload reached `processLeadAdSubmission`, which CREATES LEADS.
 * A public endpoint that writes rows on an unauthenticated request is a
 * fabrication vector as well as a spam one: those leads are indistinguishable
 * from real ones downstream, and land in an org's real pipeline.
 *
 * It also compared with `!==` on strings, which is a timing oracle, and hashed
 * `JSON.stringify(req.body)` — a re-serialisation that is not guaranteed to
 * reproduce the bytes Meta signed, so a VALID delivery could fail to verify. The
 * raw buffer captured by the body parser (`server/index.ts` `verify:` hook) is
 * the only correct input.
 *
 * The shape here is `twilioSignature.ts`'s and `inboundEmailSignature.ts`'s,
 * deliberately: three webhook verifiers that behave differently under a missing
 * secret is how one of them ends up being the wrong one.
 */

import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../utils/logger";
import { Errors } from "../utils/errors";

const PREFIX = "sha256=";

/**
 * Constant-time compare of two `sha256=<hex>` values.
 *
 * Exported for the unit test: the properties worth asserting (a mismatched
 * signature is rejected; a length mismatch does not throw) are hard to reach
 * through Express and trivial to reach here.
 */
export function signatureMatches(header: string, rawBody: Buffer, secret: string): boolean {
  if (!header.startsWith(PREFIX)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = header.slice(PREFIX.length);
  // timingSafeEqual throws on differing lengths, which is itself a mismatch.
  if (got.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function verifyMetaWebhookSignature(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    // FAIL CLOSED. A missing secret means the request cannot be verified, so it
    // must be refused — not waved through. Local development that needs to
    // exercise this webhook exports META_APP_SECRET and signs its fixtures.
    logger.error("[MetaWebhookSig] META_APP_SECRET is not set — rejecting webhook (fail-closed)");
    return Errors.unauthorized(res);
  }

  const header = req.headers["x-hub-signature-256"] as string | undefined;
  if (!header) {
    logger.warn("[MetaWebhookSig] request missing X-Hub-Signature-256", {
      metadata: { detail: { path: req.originalUrl } },
    });
    return Errors.unauthorized(res);
  }

  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    // Not the caller's fault, and not something to guess around: hashing a
    // re-serialised body would reject valid deliveries or accept altered ones.
    logger.error("[MetaWebhookSig] req.rawBody missing — body parser misconfigured");
    return Errors.internal(res, new Error("meta webhook: req.rawBody missing"));
  }

  if (!signatureMatches(header, rawBody, secret)) {
    logger.warn("[MetaWebhookSig] signature mismatch — rejecting", {
      metadata: { detail: { path: req.originalUrl } },
    });
    return Errors.unauthorized(res);
  }

  next();
}
