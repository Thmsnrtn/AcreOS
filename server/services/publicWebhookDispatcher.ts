/**
 * Public outbound webhook dispatcher — Lens 50 (Public API v0).
 *
 * Separate from the legacy server/services/webhookDispatcher.ts (which
 * uses organization_integrations + BullMQ for the internal integrations
 * surface). This dispatcher targets the new `webhook_subscriptions`
 * table — customer-managed endpoints registered via /api/v1/webhooks
 * or the /settings/api-keys UI.
 *
 * Signing scheme (Stripe-compatible):
 *
 *   Header: AcreOS-Signature: t=<unix>,v1=<hex>
 *   Sign payload: `${t}.${rawJsonBody}` with HMAC-SHA256(signing_secret)
 *
 * Retry policy: 5 attempts, exponential backoff.
 *   t1 = +1m, t2 = +5m, t3 = +30m, t4 = +2h, t5 = +12h.
 * After 5 failed attempts the row is marked status='dlq'. At 10
 * consecutive failures the subscription is auto-disabled.
 *
 * Concurrency: dispatchWebhookEvent fires the first attempt
 * asynchronously (not blocking the API response) and inserts a
 * delivery-log row. Retries are picked up by a background poller
 * (scaffold — worker registration not wired in v0).
 */

import { createHmac, randomUUID } from "node:crypto";
import { db } from "../db";
import {
  webhookSubscriptions,
  webhookDeliveryLog,
  type WebhookSubscription,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export type PublicWebhookEventType =
  | "lead.created"
  | "lead.updated"
  | "property.created"
  | "property.updated"
  | "deal.created"
  | "deal.updated"
  | "deal.closed"
  | "note.created";

const ATTEMPT_BACKOFF_SEC = [60, 300, 1800, 7200, 43200] as const;
const MAX_ATTEMPTS = ATTEMPT_BACKOFF_SEC.length;
const AUTO_DISABLE_THRESHOLD = 10;

export const ALL_PUBLIC_EVENTS: readonly PublicWebhookEventType[] = [
  "lead.created",
  "lead.updated",
  "property.created",
  "property.updated",
  "deal.created",
  "deal.updated",
  "deal.closed",
  "note.created",
] as const;

interface SignedPayload {
  body: string;
  signature: string;
  timestamp: number;
}

export function signPayload(
  secret: string,
  payload: unknown,
  ts = Math.floor(Date.now() / 1000),
): SignedPayload {
  const body = JSON.stringify(payload);
  const mac = createHmac("sha256", secret)
    .update(`${ts}.${body}`)
    .digest("hex");
  return { body, signature: `t=${ts},v1=${mac}`, timestamp: ts };
}

interface DispatchResult {
  ok: boolean;
  status: number | null;
  error?: string;
  responseBody?: string;
}

async function postToEndpoint(
  sub: WebhookSubscription,
  eventId: string,
  eventType: PublicWebhookEventType,
  signed: SignedPayload,
): Promise<DispatchResult> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AcreOS-Webhooks/1.0",
        "AcreOS-Event-Id": eventId,
        "AcreOS-Event-Type": eventType,
        "AcreOS-Signature": signed.signature,
      },
      body: signed.body,
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    const text = await resp.text().catch(() => "");
    return {
      ok: resp.ok,
      status: resp.status,
      responseBody: text.slice(0, 2048),
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fan an event out to every active subscription for this org that
 * is subscribed to `eventType`. Returns after the first attempt; retries
 * happen via the background worker (scaffold).
 *
 * Re-exported as `dispatchWebhookEvent` for callers in /api/v1/* routes.
 */
export async function dispatchWebhookEvent(
  organizationId: number,
  eventType: PublicWebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const subs = await db
    .select()
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.organizationId, organizationId),
        eq(webhookSubscriptions.isActive, true),
      ),
    );

  const targets = subs.filter((s) => s.events.includes(eventType));
  if (targets.length === 0) return;

  const eventId = randomUUID();
  const envelope = {
    id: eventId,
    type: eventType,
    created: Math.floor(Date.now() / 1000),
    organization_id: organizationId,
    data: payload,
  };

  await Promise.all(
    targets.map((sub) => attemptDelivery(sub, eventId, eventType, envelope, 1)),
  );
}

async function attemptDelivery(
  sub: WebhookSubscription,
  eventId: string,
  eventType: PublicWebhookEventType,
  envelope: Record<string, unknown>,
  attemptNumber: number,
): Promise<void> {
  const signed = signPayload(sub.signingSecret, envelope);
  const result = await postToEndpoint(sub, eventId, eventType, signed);

  const isFinalAttempt = attemptNumber >= MAX_ATTEMPTS;
  const nextRetryAt =
    !result.ok && !isFinalAttempt
      ? new Date(Date.now() + ATTEMPT_BACKOFF_SEC[attemptNumber - 1] * 1000)
      : null;

  await db.insert(webhookDeliveryLog).values({
    subscriptionId: sub.id,
    organizationId: sub.organizationId,
    eventId,
    eventType,
    payload: envelope,
    attemptNumber,
    status: result.ok ? "succeeded" : isFinalAttempt ? "dlq" : "pending",
    statusCode: result.status ?? null,
    responseBody: result.responseBody ?? null,
    errorMessage: result.error ?? null,
    nextRetryAt,
    deliveredAt: result.ok ? new Date() : null,
  });

  if (result.ok) {
    await db
      .update(webhookSubscriptions)
      .set({
        consecutiveFailures: 0,
        lastSuccessAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(webhookSubscriptions.id, sub.id));
    return;
  }

  // Bump consecutive failures atomically and auto-disable if needed.
  const updated = await db
    .update(webhookSubscriptions)
    .set({
      consecutiveFailures: sql`${webhookSubscriptions.consecutiveFailures} + 1`,
      lastFailureAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(webhookSubscriptions.id, sub.id))
    .returning({ count: webhookSubscriptions.consecutiveFailures });

  const failures = updated[0]?.count ?? 0;
  if (failures >= AUTO_DISABLE_THRESHOLD) {
    await db
      .update(webhookSubscriptions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(webhookSubscriptions.id, sub.id));
    logger.warn("webhook subscription auto-disabled after consecutive failures", {
      metadata: {
        subscriptionId: sub.id,
        organizationId: sub.organizationId,
        failures,
      },
    });
  }
}
