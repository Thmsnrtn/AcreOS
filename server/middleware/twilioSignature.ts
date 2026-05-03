import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * Middleware to verify Twilio webhook request signatures.
 *
 * Twilio signs every webhook request with an HMAC-SHA1 of the full URL
 * plus all POST parameters (sorted by key), using the account's Auth Token
 * as the signing key. The signature is sent in the `X-Twilio-Signature` header.
 *
 * This middleware rejects any request that cannot be verified, preventing
 * webhook forgery attacks (BE-03).
 *
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
export function verifyTwilioSignature(req: Request, res: Response, next: NextFunction) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // FAIL CLOSED (Hessam §2.4): a missing auth token means we cannot verify
    // the signature, so we MUST reject the request rather than silently
    // accept it. The previous behavior of letting unsigned requests through
    // in non-production was a webhook-forgery vector if NODE_ENV was ever
    // misconfigured. Local development that actually needs to test inbound
    // webhooks must export TWILIO_AUTH_TOKEN (use a sandbox token if needed).
    logger.error('[TwilioSignature] TWILIO_AUTH_TOKEN is not set — rejecting webhook (fail-closed)');
    return res.status(401).json({ error: 'Twilio signature verification unavailable' });
  }

  const twilioSignature = req.headers['x-twilio-signature'] as string;
  if (!twilioSignature) {
    logger.warn('[TwilioSignature] Request missing X-Twilio-Signature header', {
      metadata: { detail: { path: req.originalUrl } },
    });
    return res.status(401).json({ error: 'Missing Twilio signature' });
  }

  // Build the canonical URL that Twilio signed against.
  // When behind a reverse proxy / load balancer, the forwarded headers
  // reflect the original public URL that Twilio used.
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${protocol}://${host}${req.originalUrl}`;

  // Build the data-to-sign: URL + sorted POST body params concatenated as key+value
  const body = req.body || {};
  const sortedKeys = Object.keys(body).sort();
  const paramString = sortedKeys.reduce((s: string, key: string) => s + key + body[key], '');
  const toSign = url + paramString;

  const expectedSignature = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(toSign, 'utf-8'))
    .digest('base64');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const valid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'base64'),
      Buffer.from(twilioSignature, 'base64'),
    );

    if (!valid) {
      logger.warn('[TwilioSignature] Invalid signature', {
        metadata: { detail: { path: req.originalUrl } },
      });
      return res.status(401).json({ error: 'Invalid Twilio signature' });
    }
  } catch {
    // timingSafeEqual throws if buffer lengths differ — treat as invalid
    logger.warn('[TwilioSignature] Signature length mismatch', {
      metadata: { detail: { path: req.originalUrl } },
    });
    return res.status(403).json({ error: 'Invalid Twilio signature' });
  }

  next();
}
