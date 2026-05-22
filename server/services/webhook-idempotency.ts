/**
 * Pillar 9.5 — generic webhook idempotency helper.
 *
 * The Stripe webhook handler already uses `stripe_processed_events` to
 * guarantee exactly-once dispatch even when Stripe retries the same
 * event. Twilio, SendGrid, Lob, PostGrid, Telnyx all retry on 5xx /
 * timeout in the same way — duplicate processing of the same event_id
 * causes data corruption (e.g. counting one inbound SMS twice, or
 * double-recording a mailpiece delivery).
 *
 * This module provides `withIdempotency(provider, eventId, eventType,
 * handler)` — a thin wrapper that:
 *
 *   1. Atomically INSERTs (provider, event_id) into
 *      `processed_webhook_events` via ON CONFLICT DO NOTHING.
 *   2. If the row was already present (duplicate), returns
 *      `{ processed: false, duplicate: true }` without calling handler.
 *   3. If the INSERT succeeded, runs handler() and returns
 *      `{ processed: true, duplicate: false }`. If the handler throws,
 *      the idempotency row is rolled back so a retry actually retries
 *      (rather than silently swallowing the error and pretending the
 *      event was handled).
 *
 * Stripe keeps its dedicated table — the existing flow is battle-tested
 * and we don't want to risk regression by migrating it.
 */

import { db } from "../db";
import { processedWebhookEvents } from "@shared/schema";
import { logger } from "../utils/logger";

export type WebhookProvider =
  | "twilio"
  | "sendgrid"
  | "lob"
  | "postgrid"
  | "telnyx";

export interface IdempotencyResult {
  /** True when the handler ran (or would have, on a fresh event). */
  processed: boolean;
  /** True when this event was already processed previously. */
  duplicate: boolean;
}

/**
 * Run `handler` exactly once for the given (provider, eventId) pair.
 *
 * Semantics:
 *   • First call with a fresh eventId → INSERT succeeds, handler runs,
 *     returns { processed: true, duplicate: false }.
 *   • Subsequent call with the same eventId → INSERT no-ops (ON CONFLICT
 *     DO NOTHING), handler is skipped, returns
 *     { processed: false, duplicate: true }.
 *   • Handler throws → idempotency row is removed so a retry actually
 *     re-runs. Caller should re-throw or surface a 5xx to the provider
 *     so it queues a retry.
 */
export async function withIdempotency<T>(
  provider: WebhookProvider,
  eventId: string,
  eventType: string,
  handler: () => Promise<T>,
  options: { metadata?: Record<string, unknown> } = {},
): Promise<IdempotencyResult & { result?: T }> {
  if (!eventId) {
    // Defensive: a provider that didn't send an event_id can't be
    // deduped.  We log loud + run the handler anyway so the data path
    // isn't broken — but the operator should investigate and configure
    // a stable id where possible.
    logger.warn("[webhook-idempotency] missing eventId — running handler without dedup", {
      metadata: { provider, eventType },
    });
    const result = await handler();
    return { processed: true, duplicate: false, result };
  }

  // INSERT … ON CONFLICT DO NOTHING returns the inserted row id when the
  // row is new, or an empty result set when the row already existed.
  // Drizzle's `.returning()` makes this trivial to detect.
  const inserted = await db
    .insert(processedWebhookEvents)
    .values({
      provider,
      eventId,
      eventType,
      metadata: options.metadata,
    })
    .onConflictDoNothing()
    .returning({ id: processedWebhookEvents.id });

  if (inserted.length === 0) {
    // Already processed — return without running the handler.
    return { processed: false, duplicate: true };
  }

  const idempotencyRowId = inserted[0].id;

  try {
    const result = await handler();
    return { processed: true, duplicate: false, result };
  } catch (err) {
    // Roll back the idempotency claim so the provider's retry actually
    // re-runs.  Best-effort — if the rollback delete also fails, the
    // event is stuck in the dedup ledger and the retry will be a
    // no-op.  Logging surfaces the rare double-failure for manual
    // recovery.
    try {
      const { eq } = await import("drizzle-orm");
      await db
        .delete(processedWebhookEvents)
        .where(eq(processedWebhookEvents.id, idempotencyRowId));
    } catch (rollbackErr) {
      logger.error(
        "[webhook-idempotency] rollback delete failed — event may be stuck in dedup ledger",
        rollbackErr instanceof Error ? rollbackErr : undefined,
        { metadata: { provider, eventId, eventType } },
      );
    }
    throw err;
  }
}

/**
 * Inspect whether an event has been processed without claiming it.
 * Useful for diagnostics / health checks.  Does not race-safe-claim
 * the event — use `withIdempotency` for that.
 */
export async function isWebhookEventProcessed(
  provider: WebhookProvider,
  eventId: string,
): Promise<boolean> {
  const { and, eq } = await import("drizzle-orm");
  const rows = await db
    .select({ id: processedWebhookEvents.id })
    .from(processedWebhookEvents)
    .where(
      and(
        eq(processedWebhookEvents.provider, provider),
        eq(processedWebhookEvents.eventId, eventId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
