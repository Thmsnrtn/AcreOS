/**
 * Atlas pending-confirmation nudger (Phase F mobile-push).
 *
 * When Atlas calls a destructive tool, the executor persists a row to
 * chat_pending_tool_calls with a 5-minute TTL and emits a
 * confirmation_request artifact. If Tom doesn't act, the row simply
 * expires — but if he's away from the screen, he'd never know an
 * approval was waiting.
 *
 * This poller checks every 60 seconds for confirmations that have been
 * idle past NUDGE_AFTER_SECONDS (default 60s) and haven't been pushed
 * yet. It uses the existing pushNotificationService and a small
 * dedupe-via-jsonb mechanism so we never double-push the same request.
 *
 * Non-fatal — if web-push isn't configured (no VAPID keys), we log and
 * carry on. The chat UI is still authoritative.
 */

import { and, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { chatPendingToolCalls } from "@shared/schema";
import { logger } from "../utils/logger";
import { sendPushToUser } from "../services/pushNotificationService";

/** How many seconds a confirmation must sit idle before we nudge. */
const NUDGE_AFTER_SECONDS = 60;

/** How often we scan for nudgable rows. */
const POLL_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

interface NudgableCtx {
  pushedAt?: string;
}

export async function runNudgePass(now = new Date()): Promise<number> {
  const nudgeBefore = new Date(now.getTime() - NUDGE_AFTER_SECONDS * 1000);

  // Idle, not yet expired, never pushed. We mark pushed-at inside the
  // ctxSnapshot jsonb to keep the schema unchanged.
  const candidates = await db
    .select()
    .from(chatPendingToolCalls)
    .where(
      and(
        lt(chatPendingToolCalls.createdAt, nudgeBefore),
        sql`(ctx_snapshot ->> 'pushedAt') IS NULL`,
        sql`expires_at > ${now}`,
      ),
    )
    .limit(50);

  if (!candidates.length) return 0;

  let pushed = 0;
  for (const row of candidates) {
    try {
      // Founder push is platform-scoped (org 0), matching founderChatBackgroundTaskRunner.
      await sendPushToUser(0, row.founderUserId, {
        title: "Atlas needs your approval",
        body: `Pending: ${row.toolName}`,
        url: `/founder?thread=${row.threadId}&confirm=${row.id}`,
        tag: `atlas-confirm-${row.id}`,
      });

      // Stamp pushedAt into the ctx_snapshot jsonb so the next pass skips us.
      const existing = (row.ctxSnapshot ?? {}) as NudgableCtx;
      const updated: NudgableCtx = { ...existing, pushedAt: now.toISOString() };
      await db
        .update(chatPendingToolCalls)
        .set({ ctxSnapshot: updated })
        .where(sql`id = ${row.id}`);

      pushed += 1;
    } catch (err) {
      // Push failures shouldn't kill the loop; the row will be retried
      // on the next pass since pushedAt didn't get stamped.
      logger.warn("atlas pending-confirmation push failed", {
        metadata: { err: err instanceof Error ? err.message : String(err), id: row.id },
      });
    }
  }

  if (pushed > 0) {
    logger.info("atlas pending-confirmation nudge pass", {
      metadata: { pushed, scanned: candidates.length },
    });
  }
  return pushed;
}

/** Start the polling loop. Safe to call once at boot — idempotent. */
export function startAtlasPendingConfirmationNudger(): void {
  if (timer) return;
  // First pass after one full interval so server boot isn't slowed.
  timer = setInterval(() => {
    runNudgePass().catch((err) =>
      logger.error("atlas pending-confirmation nudger pass crashed", err),
    );
  }, POLL_INTERVAL_MS);
  // Don't keep the process alive just for this poller.
  if (typeof timer.unref === "function") timer.unref();
  logger.info("atlas pending-confirmation nudger started", {
    metadata: { intervalMs: POLL_INTERVAL_MS, nudgeAfterSec: NUDGE_AFTER_SECONDS },
  });
}

/** For tests. */
export function _stopAtlasPendingConfirmationNudgerForTests(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
