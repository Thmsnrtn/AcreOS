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
    // In development/test without a configured auth token, log a warning
    // but allow the request through so local development isn't blocked.
    if (process.env.NODE_ENV === 'production') {
      logger.error('[TwilioSignature] TWILIO_AUTH_TOKEN is not set in production — rejecting request');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }
    logger.warn('[TwilioSignature] TWILIO_AUTH_TOKEN not set — skipping signature verification (non-production)');
    return next();
  }

  const twilioSignature = req.headers['x-twilio-signature'] as string;
  if (!twilioSignature) {
    logger.warn('[TwilioSignature] Request missing X-Twilio-Signature header', {
      metadata: { detail: { path: req.originalUrl } },
    });
    return res.status(403).json({ error: 'Missing Twilio signature' });
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
      return res.status(403).json({ error: 'Invalid Twilio signature' });
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
