/**
 * Webhook Outbound Dispatcher (T49)
 *
 * Fires webhook events to registered org URLs for:
 *   - lead.created / lead.updated / lead.status_changed
 *   - deal.created / deal.stage_changed / deal.closed
 *   - payment.received / payment.overdue
 *   - note.delinquent
 *   - offer.accepted / offer.sent
 *   - campaign.response (lead replied)
 *
 * Each org can register up to 10 webhook endpoints.
 * Payloads are signed with HMAC-SHA256 using the org's webhook secret.
 * Retries with exponential backoff (up to 5 attempts) via BullMQ.
 *
 * Compatible with: Zapier, Make.com, n8n, custom receivers.
 */

import { db } from "../db";
import { organizationIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { createHmac } from "crypto";
import { logger } from "../utils/logger";
import { validateUrl, SSRFBlockedError } from "../middleware/fileUploadSecurity";
import { encrypt, decrypt, isEncrypted } from "./fieldEncryption";
import {
  type WebhookEventId,
  normalizeSubscribedEvents,
} from "@shared/webhooks/catalogue";

/**
 * The event vocabulary now lives in `@shared/webhooks/catalogue`, so the
 * settings panel offers exactly what the dispatcher understands. It used to be
 * declared here and hand-copied into the client, and the two had drifted: six
 * of the fifteen events a customer could subscribe to did not exist on the
 * wire at all.
 */
export type WebhookEventType = WebhookEventId;

export interface WebhookEndpoint {
  url: string;
  secret?: string;
  events: WebhookEventType[] | 'all';
  isActive: boolean;
  label?: string;
  /**
   * DERIVED, never persisted. Set when the endpoint HAS a stored signing secret
   * that could not be decrypted — a different state from "no secret configured",
   * and the reason the two are distinguished is that they demand opposite
   * behaviour: no secret means deliver unsigned, unreadable secret means do not
   * deliver at all. See `dispatchWebhook`.
   */
  secretUnavailable?: boolean;
}

/**
 * The endpoint AS IT SITS IN THE COLUMN. Structurally the same, except `secret`
 * holds CIPHERTEXT for anything written since webhook secrets were encrypted at
 * rest — and plaintext for rows written before that, which are upgraded on their
 * next save. `secretUnavailable` is derived at read time and never stored.
 */
type StoredWebhookEndpoint = Omit<WebhookEndpoint, "secretUnavailable"> & {
  /**
   * LEGACY. The webhooks page wrote `enabled` and rendered its Active/Paused
   * badge from it, while the dispatcher has always filtered on `isActive` — so
   * every endpoint added through the UI was stored active-looking and was
   * structurally incapable of receiving anything. Normalised on read (so
   * existing rows start working without being re-saved) and dropped on write.
   */
  enabled?: boolean;
};

/**
 * Whether an endpoint is on. Reads `isActive`, falls back to the legacy
 * `enabled`, and defaults to OFF — an endpoint carrying neither was never
 * expressed as active by anyone, and silence is the safe reading of silence.
 */
function isEndpointActive(e: { isActive?: unknown; enabled?: unknown }): boolean {
  if (typeof e.isActive === "boolean") return e.isActive;
  if (typeof e.enabled === "boolean") return e.enabled;
  return false;
}

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  organizationId: number;
  data: Record<string, any>;
  metadata: { version: '1.0'; source: 'acreos' };
}

/**
 * Sign a webhook payload using HMAC-SHA256.
 * The signature is sent as: X-AcreOS-Signature: sha256=<hex>
 */
export function signPayload(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * The stored rows, verbatim — secrets still encrypted.
 *
 * Webhooks are stored as a JSON array in the credentials.endpoints field of a
 * special 'webhooks' integration record.
 */
async function readStoredEndpoints(organizationId: number): Promise<StoredWebhookEndpoint[]> {
  const [integration] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, 'webhooks'),
        eq(organizationIntegrations.isEnabled, true)
      )
    )
    .limit(1);

  if (!integration?.credentials) return [];
  const creds = integration.credentials as any;
  return Array.isArray(creds.endpoints) ? creds.endpoints : [];
}

/**
 * Open one stored endpoint's signing secret.
 *
 * Three outcomes, deliberately distinct:
 *   - no secret stored     → no `secret`, no flag. The endpoint is unsigned by
 *                            configuration, and delivering unsigned is correct.
 *   - ciphertext, readable → the plaintext key.
 *   - ciphertext, UNREADABLE → no `secret`, `secretUnavailable: true`. Signing
 *                            is configured and we cannot do it.
 *
 * A row written before secrets were encrypted holds plaintext. `isEncrypted`
 * distinguishes the envelope by its `enc:v1:` marker rather than asking
 * `decrypt()` to guess, because `decrypt()` treats an unrecognised string as
 * plaintext and passes it through — which would silently turn a corrupted
 * envelope into a signing key.
 */
function openSecret(stored: StoredWebhookEndpoint): WebhookEndpoint {
  const { secret, enabled, ...withoutSecret } = stored;
  const rest = {
    ...withoutSecret,
    isActive: isEndpointActive(stored),
    // Subscriptions stored under names the old picker offered but the wire
    // never carried — `offer.accepted` for `deal.offer_accepted`, and three
    // more. Normalised here so an existing customer's subscription starts
    // matching without them having to re-tick a box. See the catalogue.
    events: Array.isArray(stored.events)
      ? (normalizeSubscribedEvents(stored.events) as WebhookEventId[])
      : stored.events,
  };
  if (!secret) return { ...rest };
  if (!isEncrypted(secret)) return { ...rest, secret };
  try {
    return { ...rest, secret: decrypt(secret) };
  } catch (err) {
    logger.error(
      `[Webhook] signing secret for ${stored.url} could not be decrypted: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return { ...rest, secretUnavailable: true };
  }
}

/**
 * Every registered endpoint for an org, with signing secrets decrypted.
 *
 * This is the DISPATCHER's reader and holds real key material. The API reads
 * `getWebhookEndpointsForDisplay` below, which never decrypts anything.
 */
export async function getWebhookEndpoints(organizationId: number): Promise<WebhookEndpoint[]> {
  return (await readStoredEndpoints(organizationId)).map(openSecret);
}

/**
 * The endpoints as an API RESPONSE — with the signing secret removed.
 *
 * `WebhookEndpoint.secret` is the HMAC key every outbound delivery is signed
 * with. `GET /api/webhooks` returned the stored objects verbatim, so any
 * authenticated member of the org — including a `viewer` — could read it, while
 * the PUT that sets it is admin-only.
 *
 * A leaked signing secret is worse than leaked data: it grants the ability to
 * FORGE deliveries, so someone holding it can inject fabricated deal and lead
 * events into the customer's own downstream systems while the signature
 * verifies. That is capability, not information.
 *
 * The fix is redaction rather than a gate. Everyone in the org may legitimately
 * need to see WHICH webhooks are configured and whether they are active; nobody
 * needs to read the secret back — not even an owner, who had it when they set
 * it. A write-only secret is the standard shape and it keeps the read useful.
 *
 * `hasSecret` is reported so the UI can still say "signing is configured"
 * without carrying the value.
 *
 * NOT used by the dispatcher — `getWebhookEndpoints` above stays unredacted
 * because signing genuinely needs the key.
 */
export type RedactedWebhookEndpoint = Omit<
  WebhookEndpoint,
  "secret" | "secretUnavailable"
> & { hasSecret: boolean };

/**
 * Reads the STORED shape and never decrypts. The redacted path has no use for
 * key material, so it never holds any: whether a secret exists is answerable
 * from the ciphertext's presence alone. It follows that this path cannot leak a
 * secret even if the redaction below were later broken, and cannot fail when the
 * encryption key is unavailable — the webhook list stays viewable either way.
 *
 * It also means `secretUnavailable` is NOT reported here. Determining it
 * requires attempting decryption, so claiming it without decrypting would be a
 * guess. This surface reports what it knows.
 */
export async function getWebhookEndpointsForDisplay(
  organizationId: number,
): Promise<RedactedWebhookEndpoint[]> {
  const stored = await readStoredEndpoints(organizationId);
  return stored.map((e) => {
    const { secret, enabled, ...rest } = e;
    return {
      ...rest,
      isActive: isEndpointActive(e),
      // Same normalisation as the dispatcher's read: the panel must show the
      // subscription that will actually be matched, not the one on disk.
      events: Array.isArray(e.events)
        ? (normalizeSubscribedEvents(e.events) as WebhookEventId[])
        : e.events,
      hasSecret: typeof secret === "string" && secret.length > 0,
    };
  });
}

/**
 * How a TEST event to `url` should be signed.
 *
 * The test button exists to answer "will my endpoint accept what AcreOS
 * actually sends?", and it could not: the client sends only a url — it cannot
 * send the secret, because the read is redacted — so every test went out
 * unsigned while every real delivery went out signed. A receiver that verifies
 * signatures rejected the one message sent to prove the endpoint works, and the
 * panel reported a correctly-configured endpoint as broken.
 *
 * So a test to a CONFIGURED endpoint is signed with that endpoint's own stored
 * secret, and an unreadable secret refuses rather than downgrading — the same
 * rule `dispatchWebhook` follows, and the test is the surface where finding out
 * is most useful. A url the org has not configured is an ad-hoc probe: it may
 * carry a caller-supplied secret, or go unsigned.
 */
export type TestSigning =
  | { kind: "signed"; secret: string }
  | { kind: "unsigned" }
  | { kind: "refused"; reason: string };

export async function resolveTestSigning(
  organizationId: number,
  url: string,
  fallbackSecret?: unknown,
): Promise<TestSigning> {
  const configured = (await getWebhookEndpoints(organizationId)).find((e) => e.url === url);

  if (configured?.secretUnavailable) {
    return {
      kind: "refused",
      reason:
        "This endpoint has a signing secret that could not be decrypted, so a test " +
        "event cannot be signed the way real deliveries are. Save a new secret for " +
        "it, or restore the encryption key it was written under.",
    };
  }

  if (configured?.secret) return { kind: "signed", secret: configured.secret };
  // Only for a url that is not a configured endpoint — a configured one is
  // tested as it is configured, not as the caller asks.
  if (!configured && typeof fallbackSecret === "string" && fallbackSecret.length > 0) {
    return { kind: "signed", secret: fallbackSecret };
  }
  return { kind: "unsigned" };
}

/**
 * Save webhook endpoints for an org.
 *
 * Does three things beyond writing the array, each of which the shape demands:
 *
 * 1. ENCRYPTS the signing secret at rest. It is an HMAC key — a credential, and
 *    the only one in `organization_integrations.credentials` that used to sit in
 *    the column as plaintext while every other provider stored an envelope.
 *    Rows written before this are upgraded on their next save; nothing needs a
 *    data migration, and no row is unreadable in the meantime.
 *
 * 2. PRESERVES an existing secret when the incoming endpoint does not carry one.
 *    This is load-bearing, not a nicety: the client GETs the endpoint list and
 *    PUTs it back, so once the read is redacted a naive save would write
 *    `secret: undefined` over every configured key — silently disabling
 *    signature verification on every downstream integration, with no error
 *    anywhere. Matching is by `url`, which is the endpoint's identity here.
 *    Preservation carries the CIPHERTEXT across unchanged, so it keeps working
 *    when the key is unavailable; a save must never destroy a key it cannot
 *    read.
 *
 * 3. STRIPS the derived fields. `hasSecret` and `secretUnavailable` are answers
 *    this module computes, and the round-trip means they arrive back as input.
 *    Persisting them would let a client assert them.
 */
export async function saveWebhookEndpoints(
  organizationId: number,
  endpoints: WebhookEndpoint[]
): Promise<void> {
  const stored = await readStoredEndpoints(organizationId);
  const secretByUrl = new Map(
    stored.filter((e) => e.secret).map((e) => [e.url, e.secret as string]),
  );

  const toPersist: StoredWebhookEndpoint[] = endpoints.map((e) => {
    const { secret, secretUnavailable, hasSecret, enabled, ...withoutDerived } =
      e as WebhookEndpoint & { hasSecret?: boolean; enabled?: boolean };
    // One name for one fact. `enabled` is accepted (an older client build may
    // still send it) and normalised away, never stored alongside `isActive` —
    // two fields for one state is how they came to disagree.
    const rest = {
      ...withoutDerived,
      isActive: isEndpointActive(e),
      events: Array.isArray(e.events)
        ? (normalizeSubscribedEvents(e.events) as WebhookEventId[])
        : e.events,
    };
    // `||` not `??`, deliberately: an empty-string secret is far more likely to
    // be a blank form field than an intent to turn signing off, and this
    // function exists to stop a key being destroyed by accident. Clearing a
    // secret is a rotation, not a save with a hole in it.
    const carried = secret || secretByUrl.get(e.url);
    if (!carried) return rest;
    return { ...rest, secret: isEncrypted(carried) ? carried : encrypt(carried) };
  });

  const [existing] = await db
    .select()
    .from(organizationIntegrations)
    .where(
      and(
        eq(organizationIntegrations.organizationId, organizationId),
        eq(organizationIntegrations.provider, 'webhooks')
      )
    )
    .limit(1);

  // TODO(tsc): organization_integrations.credentials has no `endpoints` field in its
  // typed jsonb shape; webhook endpoints are persisted here by reusing the column.
  // Typed against the column's credentials type so the write is structurally checked.
  type IntegrationCredentials = typeof organizationIntegrations.$inferInsert["credentials"];
  const credentials = { endpoints: toPersist } as IntegrationCredentials;

  if (existing) {
    await db
      .update(organizationIntegrations)
      .set({ credentials, isEnabled: true, updatedAt: new Date() })
      .where(eq(organizationIntegrations.id, existing.id));
  } else {
    await db.insert(organizationIntegrations).values({
      organizationId,
      provider: 'webhooks',
      isEnabled: true,
      credentials,
    });
  }
}

/**
 * Dispatch a webhook event to all matching endpoints for an org.
 * Runs in parallel; failures do not block each other.
 */
export async function dispatchWebhook(
  organizationId: number,
  event: WebhookEventType,
  data: Record<string, any>
): Promise<{ dispatched: number; failed: number }> {
  // SIMULATION_MODE_WEBHOOK_OUTBOUND short-circuits delivery. We still
  // log what *would* have been dispatched so the testing suite can
  // verify "did the system decide to fire lead.created?" without
  // pinging an arbitrary partner URL.
  {
    const { shouldSimulate, recordSimulatedAction } = await import("../utils/simulationMode");
    const { storage } = await import("../storage");
    const org = await storage.getOrganization(organizationId).catch(() => null);
    if (shouldSimulate("webhook_outbound", org)) {
      await recordSimulatedAction(
        "webhook_outbound",
        `dispatch.${event}`,
        { organizationId, event, dataKeys: Object.keys(data).slice(0, 10) },
        org
      );
      return { dispatched: 0, failed: 0 };
    }
  }

  const endpoints = await getWebhookEndpoints(organizationId);
  const activeEndpoints = endpoints.filter(ep =>
    ep.isActive &&
    ep.url &&
    (ep.events === 'all' || (Array.isArray(ep.events) && ep.events.includes(event)))
  );

  if (activeEndpoints.length === 0) return { dispatched: 0, failed: 0 };

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    organizationId,
    data,
    metadata: { version: '1.0', source: 'acreos' },
  };
  const payloadJson = JSON.stringify(payload);

  let dispatched = 0;
  let failed = 0;

  await Promise.allSettled(
    activeEndpoints.map(async (endpoint) => {
      // A configured signing secret we cannot read is a REFUSAL, not a
      // downgrade. Delivering unsigned would hand the receiver a payload that
      // clears an "is it signed?" check by carrying no signature at all, and
      // signing with the ciphertext would produce a signature that can never
      // verify. Neither is honest about the state we are actually in, so the
      // delivery does not happen and the reason is logged.
      if (endpoint.secretUnavailable) {
        failed++;
        logger.error(
          `[Webhook] ${event} → ${endpoint.url} NOT delivered: its signing secret ` +
            `could not be decrypted, and an endpoint configured for signing is ` +
            `never delivered to unsigned. Re-save the endpoint with a new secret, ` +
            `or restore the encryption key it was written under.`,
        );
        return;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-AcreOS-Event': event,
        'X-AcreOS-Delivery': `${organizationId}-${Date.now()}`,
      };

      if (endpoint.secret) {
        headers['X-AcreOS-Signature'] = signPayload(payloadJson, endpoint.secret);
      }

      try {
        // F1 SSRF: validate per-delivery, since DNS may rebind between configuration
        // and delivery. SSRFBlockedError is logged and skipped (counted as failed).
        try {
          await validateUrl(endpoint.url);
        } catch (validationErr: any) {
          if (validationErr instanceof SSRFBlockedError) {
            failed++;
            logger.warn(
              `[Webhook] ${event} → ${endpoint.url} blocked by SSRF guard: ${validationErr.message}`
            );
            return;
          }
          throw validationErr;
        }

        const response = await fetchWithRetry(endpoint.url, {
          method: 'POST',
          headers,
          body: payloadJson,
        }, 3);

        if (response.ok) {
          dispatched++;
          logger.info(`[Webhook] ${event} → ${endpoint.url}: ${response.status}`);
        } else {
          failed++;
          logger.warn(`[Webhook] ${event} → ${endpoint.url}: HTTP ${response.status}`);
        }
      } catch (err: any) {
        failed++;
        logger.error(`[Webhook] ${event} → ${endpoint.url} failed: ${err.message}`);
      }
    })
  );

  return { dispatched, failed };
}

/**
 * Fetch with exponential backoff retry.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number,
  attempt: number = 0
): Promise<Response> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (err: any) {
    if (attempt >= maxRetries - 1) throw err;
    const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, options, maxRetries, attempt + 1);
  }
}

// ============================================
// CONVENIENCE DISPATCH FUNCTIONS
// Call these from route handlers when events occur
// ============================================

export async function webhookLeadCreated(orgId: number, lead: Record<string, any>) {
  return dispatchWebhook(orgId, 'lead.created', { lead });
}

export async function webhookLeadStatusChanged(
  orgId: number,
  leadId: number,
  oldStatus: string,
  newStatus: string,
  lead: Record<string, any>
) {
  return dispatchWebhook(orgId, 'lead.status_changed', { leadId, oldStatus, newStatus, lead });
}

export async function webhookDealCreated(orgId: number, deal: Record<string, any>) {
  return dispatchWebhook(orgId, 'deal.created', { deal });
}

export async function webhookDealStageChanged(
  orgId: number,
  dealId: number,
  oldStage: string,
  newStage: string,
  deal: Record<string, any>
) {
  return dispatchWebhook(orgId, 'deal.stage_changed', { dealId, oldStage, newStage, deal });
}

export async function webhookPaymentReceived(
  orgId: number,
  noteId: number,
  paymentId: number,
  amount: number
) {
  return dispatchWebhook(orgId, 'payment.received', { noteId, paymentId, amount });
}

export async function webhookCampaignResponse(
  orgId: number,
  leadId: number,
  channel: string,
  message: string
) {
  return dispatchWebhook(orgId, 'campaign.response', { leadId, channel, message });
}
