import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { sendError } from "../utils/errors";
import { unscopedForPlatformOps } from '../utils/orgScopedDb';
import {
  byokCredentials,
  organizationIntegrations,
  provisionedPhoneNumbers,
  trackingNumberAssignments,
} from '@shared/schema';
import { readIntegrationCredentials } from '../services/integrationCredentials';

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
    return sendError(res, 401, "UNAUTHORIZED", 'Twilio signature verification unavailable');
  }

  const twilioSignature = req.headers['x-twilio-signature'] as string;
  if (!twilioSignature) {
    logger.warn('[TwilioSignature] Request missing X-Twilio-Signature header', {
      metadata: { detail: { path: req.originalUrl } },
    });
    return sendError(res, 401, "UNAUTHORIZED", 'Missing Twilio signature');
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
      return sendError(res, 401, "UNAUTHORIZED", 'Invalid Twilio signature');
    }
  } catch {
    // timingSafeEqual throws if buffer lengths differ — treat as invalid
    logger.warn('[TwilioSignature] Signature length mismatch', {
      metadata: { detail: { path: req.originalUrl } },
    });
    return sendError(res, 403, "FORBIDDEN", 'Invalid Twilio signature');
  }

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound SMS: verify with the token of the account that OWNS the number.
//
// Twilio signs a webhook with the auth token of the account the receiving
// number lives on. A customer's own (BYO) Twilio number therefore arrives
// signed with THEIR token, never the platform's — so verifying inbound SMS
// with only TWILIO_AUTH_TOKEN rejected every reply and every STOP sent to a
// customer's own number with a 401, and Twilio gave up on them. An opt-out
// that never arrives cannot be honoured.
//
// The rule below:
//   1. resolve every organization that owns the `To` number, from every place
//      a number can be configured (the legacy integration row, the BYOK vault,
//      purchased numbers, the tracking-number pool);
//   2. accept the request iff its signature verifies with THAT owner's own
//      token — which also binds the processed org to the token that signed,
//      so one tenant's token can never deliver a message into another's org;
//   3. otherwise accept it iff it verifies with the platform token (platform
//      numbers, and the platform's own account);
//   4. otherwise reject. With no token to verify against at all, reject too:
//      fail closed, exactly as the platform-only middleware above does.
// ─────────────────────────────────────────────────────────────────────────────

export type TwilioNumberSource = 'integration' | 'byok' | 'provisioned' | 'tracking_pool';

export interface TwilioNumberOwner {
  organizationId: number;
  /** Where the number-to-org binding was found. */
  source: TwilioNumberSource;
  /** The org's own Twilio auth tokens (BYOK and/or integration row). Never logged. */
  authTokens: string[];
}

export interface VerifiedTwilioInbound {
  /** The org that owns the `To` number, or null when no org claims it. */
  organizationId: number | null;
  /** Which secret verified the signature. */
  verifiedWith: 'organization' | 'platform';
}

/** Compare numbers on their last ten digits — the same rule lead matching uses. */
function last10(phone: unknown): string {
  return typeof phone === 'string' ? phone.replace(/\D/g, '').slice(-10) : '';
}

/** The value when it is a non-empty string, else null. */
function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The data Twilio signed: full URL + POST params sorted by key, concatenated. */
function twilioSigningPayload(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${protocol}://${host}${req.originalUrl}`;
  const body = req.body || {};
  const sortedKeys = Object.keys(body).sort();
  return url + sortedKeys.reduce((s: string, key: string) => s + key + body[key], '');
}

/** Timing-safe HMAC-SHA1 check. A length mismatch is a non-match, never a throw. */
function twilioSignatureMatches(payload: string, signature: string, authToken: string): boolean {
  if (!authToken || !signature) return false;
  const expected = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(payload, 'utf-8'))
    .digest();
  const provided = Buffer.from(signature, 'base64');
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/**
 * Cross-org by construction: an inbound webhook carries no session, and these
 * reads are what DETERMINE the org. They return only the owner of one number
 * and that owner's own token; nothing read here reaches a caller.
 */
const OWNER_LOOKUP_REASON =
  'inbound Twilio SMS webhook: resolve which organization owns the receiving number, to verify the signature with that org\'s own token';

/**
 * Every organization that owns `toNumber`, with that org's own Twilio tokens.
 * An empty list means no org claims the number.
 *
 * Reads are platform-scope (the hatch above) but MINIMAL: the result carries
 * only the owners' own tokens, and no other org's credential outlives the
 * match. In particular a BYOK row is decrypted only when its non-secret
 * fingerprint (the plaintext's last four characters — the number's last four
 * digits, since the plaintext ends with the phone) could match, and reading
 * it never bumps that org's `lastUsedAt`: one tenant's inbound text is not a
 * use of every other tenant's credential.
 */
async function resolveTwilioNumberOwners(toNumber: string): Promise<TwilioNumberOwner[]> {
  const want = last10(toNumber);
  if (want.length !== 10) return [];

  const owners = new Map<number, TwilioNumberSource>();
  const claim = (organizationId: number, source: TwilioNumberSource) => {
    if (!owners.has(organizationId)) owners.set(organizationId, source);
  };
  // Tokens are gathered per org first and attached only to owners at the end.
  const tokensByOrg = new Map<number, Set<string>>();
  const addToken = (organizationId: number, token: string | null) => {
    if (!token) return;
    let s = tokensByOrg.get(organizationId);
    if (!s) tokensByOrg.set(organizationId, (s = new Set()));
    s.add(token);
  };

  // (a) Legacy organization_integrations row — sealed or plaintext, read the
  //     one canonical way so an envelope-stored credential is not invisible.
  const integrations = await unscopedForPlatformOps(OWNER_LOOKUP_REASON)
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.provider, 'twilio'),
        eq(organizationIntegrations.isEnabled, true),
      ),
    );
  for (const row of integrations) {
    const creds = readIntegrationCredentials<{ authToken?: string; fromPhoneNumber?: string }>(
      row,
      row.organizationId,
      'twilio',
    );
    if (!creds) continue;
    addToken(row.organizationId, nonEmptyString(creds.authToken));
    if (last10(creds.fromPhoneNumber) === want) claim(row.organizationId, 'integration');
  }

  // (b) Universal-BYOK vault: plaintext "<accountSid>:<authToken>:<phoneNumber>",
  //     the format the Twilio comms provider reads. Decrypted through the
  //     vault's own accessor, never here — and only for candidate rows.
  const byokRows = await unscopedForPlatformOps(OWNER_LOOKUP_REASON)
    .select({
      organizationId: byokCredentials.organizationId,
      fingerprint: byokCredentials.credentialKeyFingerprint,
    })
    .from(byokCredentials)
    .where(and(eq(byokCredentials.channel, 'twilio'), isNull(byokCredentials.revokedAt)));
  const want4 = want.slice(-4);
  const byokTokenTaken = new Set<number>();
  const candidates = Array.from(
    new Set(
      byokRows
        // A four-digit fingerprint IS the number's last four digits; any other
        // shape cannot rule the row out, so it stays a candidate.
        .filter((r) => !/^\d{4}$/.test(String(r.fingerprint ?? '')) || r.fingerprint === want4)
        .map((r) => r.organizationId),
    ),
  );
  if (candidates.length > 0) {
    const { getByokCredential } = await import('../services/byok/key-vault');
    for (const orgId of candidates) {
      const blob = await getByokCredential(
        { organizationId: orgId, channel: 'twilio' },
        { touchLastUsed: false },
      ).catch(() => null);
      if (!blob) continue;
      const parts = blob.split(':');
      if (parts.length !== 3 || !parts.every(Boolean)) continue;
      if (last10(parts[2]) === want) claim(orgId, 'byok');
      // Not this number and not already an owner: its token is dropped here.
      if (!owners.has(orgId)) continue;
      addToken(orgId, parts[1]);
      byokTokenTaken.add(orgId);
    }
  }

  // (c) Numbers an org purchased through AcreOS (bought on the org's own
  //     account, so verified with that org's token).
  const provisioned = await unscopedForPlatformOps(OWNER_LOOKUP_REASON)
    .select({
      organizationId: provisionedPhoneNumbers.organizationId,
      phoneNumber: provisionedPhoneNumbers.phoneNumber,
    })
    .from(provisionedPhoneNumbers)
    .where(eq(provisionedPhoneNumbers.status, 'active'));
  for (const row of provisioned) {
    if (last10(row.phoneNumber) === want) claim(row.organizationId, 'provisioned');
  }

  // (d) Active tracking-number assignments (rented numbers).
  const tracking = await unscopedForPlatformOps(OWNER_LOOKUP_REASON)
    .select({
      organizationId: trackingNumberAssignments.organizationId,
      number: trackingNumberAssignments.number,
    })
    .from(trackingNumberAssignments)
    .where(isNull(trackingNumberAssignments.releasedAt));
  for (const row of tracking) {
    if (row.organizationId != null && last10(row.number) === want) {
      claim(row.organizationId, 'tracking_pool');
    }
  }

  // An owner claimed through (c)/(d) may hold its vault token under a
  // DIFFERENT number (its BYO sender) — fetch that OWNER's own token now.
  const missing = Array.from(owners.keys()).filter(
    (orgId) => !byokTokenTaken.has(orgId) && byokRows.some((r) => r.organizationId === orgId),
  );
  if (missing.length > 0) {
    const { getByokCredential } = await import('../services/byok/key-vault');
    for (const orgId of missing) {
      const blob = await getByokCredential(
        { organizationId: orgId, channel: 'twilio' },
        { touchLastUsed: false },
      ).catch(() => null);
      const parts = blob ? blob.split(':') : [];
      if (parts.length === 3 && parts.every(Boolean)) addToken(orgId, parts[1]);
    }
  }

  return Array.from(owners.entries()).map(([organizationId, source]) => ({
    organizationId,
    source,
    authTokens: Array.from(tokensByOrg.get(organizationId) ?? []),
  }));
}

/**
 * Signature middleware for the inbound-SMS webhook. On success it sets
 * `res.locals.twilioInbound` ({@link VerifiedTwilioInbound}); the handler must
 * take the org from there and from nowhere else.
 */
export async function verifyInboundTwilioSms(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers['x-twilio-signature'];
  if (typeof signature !== 'string' || !signature) {
    logger.warn('[TwilioSignature] Inbound SMS missing X-Twilio-Signature header', {
      metadata: { detail: { path: req.originalUrl } },
    });
    return sendError(res, 401, "UNAUTHORIZED", 'Missing Twilio signature');
  }

  let owners: TwilioNumberOwner[];
  try {
    owners = await resolveTwilioNumberOwners(String(req.body?.To ?? ''));
  } catch (err) {
    // Cannot tell whose number this is, so cannot tell which token to trust.
    // Fail closed — Twilio retries a non-2xx, so a transient DB error is not a
    // lost message.
    logger.error('[TwilioSignature] Could not resolve the owner of the inbound number — rejecting', err instanceof Error ? err : undefined);
    return sendError(res, 503, "SERVICE_UNAVAILABLE", 'Twilio signature verification unavailable');
  }

  const payload = twilioSigningPayload(req);
  const platformToken = process.env.TWILIO_AUTH_TOKEN;
  let anyToken = false;

  for (const owner of owners) {
    for (const token of owner.authTokens) {
      anyToken = true;
      if (twilioSignatureMatches(payload, signature, token)) {
        res.locals.twilioInbound = {
          organizationId: owner.organizationId,
          verifiedWith: 'organization',
        } satisfies VerifiedTwilioInbound;
        return next();
      }
    }
  }

  if (platformToken) {
    anyToken = true;
    if (twilioSignatureMatches(payload, signature, platformToken)) {
      if (owners.length > 1) {
        logger.warn('[TwilioSignature] Inbound number is claimed by more than one organization', {
          metadata: { detail: { organizationIds: owners.map((o) => o.organizationId) } },
        });
      }
      res.locals.twilioInbound = {
        organizationId: owners[0]?.organizationId ?? null,
        verifiedWith: 'platform',
      } satisfies VerifiedTwilioInbound;
      return next();
    }
  }

  if (!anyToken) {
    logger.error('[TwilioSignature] No auth token can verify this inbound SMS — rejecting webhook (fail-closed)');
    return sendError(res, 401, "UNAUTHORIZED", 'Twilio signature verification unavailable');
  }
  logger.warn('[TwilioSignature] Invalid inbound SMS signature', {
    metadata: { detail: { path: req.originalUrl } },
  });
  return sendError(res, 401, "UNAUTHORIZED", 'Invalid Twilio signature');
}
