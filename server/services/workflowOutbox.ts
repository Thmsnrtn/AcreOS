/**
 * Durable hand-off from a scheduled detector to the workflow engine
 * (DEFECT-0114, 2026-09-27).
 *
 * `workflowEngine.emit` queues in process memory and is not awaited. For a
 * request handler that is a tolerable best effort. For a scheduled detector it
 * is a lost obligation: the acquired-note aging sweep wrote the new delinquency
 * status and then emitted `payment.missed`, and the note due detector published
 * its mesh finding (the ledger that makes the finding "old news") and then
 * emitted. A crash, deploy or restart between the write and the in-memory
 * drain lost the collection workflow, and the next run did not re-emit because
 * the status or the ledger already said it had happened.
 *
 * The fix uses the outbox the repository already runs (`outbox` table,
 * `server/worker.ts`, retries and a dead-letter queue):
 *
 *   - `stageWorkflowEvent` writes a `workflow_trigger` row. The aging sweep
 *     writes it in the SAME transaction as the status change, so either both
 *     land or neither does. The due detector stages it BEFORE publishing the
 *     mesh finding, keyed by the finding's dedupe key, so a publish failure
 *     retries next run without staging a second trigger.
 *   - The worker drains the row through `drainWorkflowTrigger`, which AWAITS
 *     `workflowEngine.triggerWorkflows`. A failure is retried and then
 *     dead-lettered, never swallowed.
 *
 * Delivery is at-least-once. A workflow that throws part-way through a drain
 * can run again on the retry; the in-memory path was at-most-once and lost the
 * event instead. For an overdue-payment workflow a visible duplicate is the
 * recoverable failure and a silent loss is not.
 */

import { and, eq, sql } from "drizzle-orm";
import { outbox, WORKFLOW_TRIGGER_EVENTS } from "@shared/schema";
import { db } from "../db";
import { logger } from "../utils/logger";
import type { WorkflowEventData } from "./workflow-engine";

const WORKFLOW_TRIGGER_OUTBOX_EVENT = "workflow_trigger";

/** `db` or a transaction handle — whatever the caller's write is running on. */
export type OutboxExecutor = Pick<typeof db, "select" | "insert">;

export async function stageWorkflowEvent(
  event: WorkflowEventData,
  opts: { executor?: OutboxExecutor; dedupeKey?: string } = {},
): Promise<{ staged: boolean }> {
  const exec = opts.executor ?? db;
  if (opts.dedupeKey) {
    const [already] = await exec
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, WORKFLOW_TRIGGER_OUTBOX_EVENT),
          sql`${outbox.payload}->>'dedupeKey' = ${opts.dedupeKey}`,
        ),
      )
      .limit(1);
    if (already) return { staged: false };
  }
  await exec.insert(outbox).values({
    eventType: WORKFLOW_TRIGGER_OUTBOX_EVENT,
    payload: { ...event, ...(opts.dedupeKey ? { dedupeKey: opts.dedupeKey } : {}) },
  });
  return { staged: true };
}

const ENTITY_TYPES: ReadonlySet<string> = new Set([
  "lead", "property", "deal", "payment", "parcel", "rehab", "cert", "buyer", "note",
]);

/**
 * Worker handler for a `workflow_trigger` row. A malformed payload is refused
 * terminally (retrying cannot repair it); an engine failure throws so the
 * outbox retry and dead-letter machinery owns it.
 */
export async function drainWorkflowTrigger(
  payload: Record<string, unknown>,
  engine?: Pick<(typeof import("./workflow-engine"))["workflowEngine"], "triggerWorkflows">,
): Promise<Record<string, unknown>> {
  const { event, organizationId, entityId, entityType, data } = payload;
  const known = (WORKFLOW_TRIGGER_EVENTS as readonly string[]).includes(String(event));
  if (
    !known ||
    typeof organizationId !== "number" ||
    typeof entityId !== "number" ||
    typeof entityType !== "string" ||
    !ENTITY_TYPES.has(entityType) ||
    typeof data !== "object" ||
    data === null
  ) {
    logger.error("[workflowOutbox] refused malformed workflow_trigger payload", {
      metadata: { event: String(event), organizationId: String(organizationId) },
    });
    return { refused: true, reason: "malformed_payload" };
  }
  // Lazy: workflow-engine imports this module to stage events.
  const target = engine ?? (await import("./workflow-engine")).workflowEngine;
  const runs = await target.triggerWorkflows({
    event: event as WorkflowEventData["event"],
    organizationId,
    entityId,
    entityType: entityType as WorkflowEventData["entityType"],
    data: data as Record<string, unknown>,
  });
  return { runs: runs.length };
}
