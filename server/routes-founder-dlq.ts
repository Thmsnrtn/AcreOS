/**
 * Pillar 9.1 — Founder DLQ inspection + recovery endpoints.
 *
 * Routes:
 *   GET  /api/founder/dlq           — list current DLQ rows
 *   POST /api/founder/dlq/:id/retry — move a DLQ row back to outbox
 *                                     (resets attempts to 0, status='pending')
 *   POST /api/founder/dlq/:id/discard — delete a DLQ row (audit-logged)
 *
 * All three are founder-gated via the existing `requireFounder`
 * middleware. The Pax decision-queue surface (a "1 poison job in DLQ"
 * item) is wired through `surfacePoisonJobDecision` which runs from
 * the scheduler — it inserts a `decisions_inbox_items` row pointing
 * at the founder's `/founder/dlq` panel.
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { outbox, outboxDlq, decisionsInboxItems } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";

export function registerFounderDlqRoutes(app: Express): void {
  /**
   * GET /api/founder/dlq — return the current DLQ rows.  Sorted newest
   * first so the most-recent poison job is easy to spot.
   */
  app.get(
    "/api/founder/dlq",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select()
          .from(outboxDlq)
          .orderBy(desc(outboxDlq.movedToDlqAt))
          .limit(200);

        // Group by event_type for the inbox-style "N poison jobs of type X"
        // hint. The UI can use this for the badge text without a second query.
        const byType = new Map<string, number>();
        for (const r of rows) {
          byType.set(r.eventType, (byType.get(r.eventType) ?? 0) + 1);
        }

        res.json({
          rows,
          total: rows.length,
          byType: Object.fromEntries(byType.entries()),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  /**
   * POST /api/founder/dlq/:id/retry
   *
   * Re-insert the DLQ payload into the outbox (status='pending',
   * attempts=0) so the worker picks it up on the next tick.  Deletes
   * the DLQ row in the same transaction so a row is never in both
   * tables.
   */
  app.post(
    "/api/founder/dlq/:id/retry",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return Errors.badRequest(res, "Invalid DLQ id");
      }

      try {
        const result = await db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(outboxDlq)
            .where(eq(outboxDlq.id, id))
            .limit(1);

          if (!row) return null;

          const [inserted] = await tx
            .insert(outbox)
            .values({
              eventType: row.eventType,
              payload: row.payload,
              status: "pending",
              attempts: 0,
            })
            .returning({ id: outbox.id });

          await tx.delete(outboxDlq).where(eq(outboxDlq.id, id));

          return { newOutboxId: inserted.id, eventType: row.eventType };
        });

        if (!result) {
          return Errors.notFound(res, "DLQ row");
        }

        logger.info("[founder/dlq] retry — re-queued", {
          metadata: {
            __pii_safe: true,
            dlqId: id,
            newOutboxId: result.newOutboxId,
            eventType: result.eventType,
            actor: getUserId(req),
          },
        });

        res.json({ ok: true, newOutboxId: result.newOutboxId });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  /**
   * POST /api/founder/dlq/:id/discard
   *
   * Delete a DLQ row — the founder has decided the payload is
   * unrecoverable (corrupt JSON, schema mismatch, dead reference, …).
   * Audit-logged so we can reconstruct what was discarded if needed.
   */
  app.post(
    "/api/founder/dlq/:id/discard",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return Errors.badRequest(res, "Invalid DLQ id");
      }

      try {
        const [row] = await db
          .select()
          .from(outboxDlq)
          .where(eq(outboxDlq.id, id))
          .limit(1);

        if (!row) {
          return Errors.notFound(res, "DLQ row");
        }

        await db.delete(outboxDlq).where(eq(outboxDlq.id, id));

        // Audit trail.  Logging with __pii_safe because we're emitting
        // structured fields, not free-form text that could embed PII.
        logger.warn("[founder/dlq] discard — row deleted", {
          metadata: {
            __pii_safe: true,
            dlqId: id,
            eventType: row.eventType,
            originalOutboxId: row.originalOutboxId,
            failureReason: row.failureReason,
            failureCount: row.failureCount,
            actor: getUserId(req),
          },
        });

        res.json({ ok: true });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

/**
 * Pillar 9.1 — surface a Pax decision-queue item when the DLQ is non-
 * empty.  Called from the scheduler.  Inserts at most one open item per
 * (eventType) to avoid swarming the inbox if many jobs of the same
 * type land in DLQ.
 */
export async function surfacePoisonJobDecision(): Promise<{
  surfaced: number;
}> {
  // Count DLQ rows by event_type.
  const grouped = await db.execute<{ event_type: string; cnt: number }>(sql`
    SELECT event_type, COUNT(*)::int AS cnt
    FROM outbox_dlq
    GROUP BY event_type
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((grouped as any)?.rows ?? []) as Array<{ event_type: string; cnt: number }>;

  let surfaced = 0;

  for (const r of rows) {
    // Skip if there's already an open inbox item for this DLQ event_type.
    const existing = await db.execute<{ id: number }>(sql`
      SELECT id FROM decisions_inbox_items
      WHERE item_type = 'dlq_poison_job'
        AND status = 'pending'
        AND (action_payload->>'eventType') = ${r.event_type}
      LIMIT 1
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (((existing as any)?.rows ?? []).length > 0) continue;

    await db.insert(decisionsInboxItems).values({
      itemType: "dlq_poison_job",
      riskLevel: "high",
      urgencyScore: Math.min(90, 50 + r.cnt * 5),
      sophieAnalysis: `${r.cnt} poison job(s) in DLQ for event_type='${r.event_type}'. The worker retried each row ${"" /* MAX_ATTEMPTS */}≥5 times and gave up. Inspect the payload to decide whether the schema changed under the producer, whether an upstream dependency went away, or whether the rows are simply corrupt and should be discarded.`,
      sophieConfidenceScore: 70,
      recommendedAction: "review_dlq",
      recommendedActionLabel: `Review ${r.cnt} poison job(s) — type='${r.event_type}'`,
      actionPayload: {
        eventType: r.event_type,
        count: r.cnt,
        deeplink: "/founder/dlq",
        availableActions: ["retry", "discard", "investigate"],
      },
      ownerAgentCodename: "ops",
      status: "pending",
    });

    surfaced += 1;
  }

  return { surfaced };
}
