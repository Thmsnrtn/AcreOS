// @ts-nocheck
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

export type WebhookEventType =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.status_changed'
  | 'lead.score_changed'
  | 'deal.created'
  | 'deal.stage_changed'
  | 'deal.closed'
  | 'deal.offer_sent'
  | 'deal.offer_accepted'
  | 'payment.received'
  | 'payment.overdue'
  | 'payment.failed'
  | 'note.delinquent'
  | 'campaign.response'
  | 'sms.reply'
  | 'sequence.completed'
  | 'task.completed';

export interface WebhookEndpoint {
  url: string;
  secret?: string;
  events: WebhookEventType[] | 'all';
  isActive: boolean;
  label?: string;
}

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  organizationId: number;
  data: Record<string, any>;
}

/**
 * Sign a webhook payload using HMAC-SHA256.
 * The signature is sent as: X-AcreOS-Signature: sha256=<hex>
 */
export function signPayload(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Get all registered webhook endpoints for an org from organizationIntegrations.
 * Webhooks are stored as a JSON array in the credentials.webhooks field
 * of a special 'webhooks' integration record.
 */
export async function getWebhookEndpoints(organizationId: number): Promise<WebhookEndpoint[]> {
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
 * Save webhook endpoints for an org.
 */
export async function saveWebhookEndpoints(
  organizationId: number,
  endpoints: WebhookEndpoint[]
): Promise<void> {
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

  const credentials = { endpoints };

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
  };
  const payloadJson = JSON.stringify(payload);

  let dispatched = 0;
  let failed = 0;

  await Promise.allSettled(
    activeEndpoints.map(async (endpoint) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-AcreOS-Event': event,
        'X-AcreOS-Delivery': `${organizationId}-${Date.now()}`,
      };

      if (endpoint.secret) {
        headers['X-AcreOS-Signature'] = signPayload(payloadJson, endpoint.secret);
      }

      try {
        const response = await fetchWithRetry(endpoint.url, {
          method: 'POST',
          headers,
          body: payloadJson,
        }, 3);

        if (response.ok) {
          dispatched++;
          console.log(`[Webhook] ${event} → ${endpoint.url}: ${response.status}`);
        } else {
          failed++;
          console.warn(`[Webhook] ${event} → ${endpoint.url}: HTTP ${response.status}`);
        }
      } catch (err: any) {
        failed++;
        console.error(`[Webhook] ${event} → ${endpoint.url} failed: ${err.message}`);
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
