import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

// Same env var + default as worker.ts's own MAX_ATTEMPTS (processOne). Resolved
// here rather than imported: worker.ts imports this module, so importing back
// would be a cycle.
const MAX_ATTEMPTS = parseInt(process.env.WORKER_MAX_ATTEMPTS ?? "5", 10);

// ── Orphan reaper ────────────────────────────────────────────────────────────
// A worker killed mid-batch (OOM, deploy, kill -9) leaves its claimed rows in
// status='running' forever: claimBatch only takes pending/retry, and before
// this reaper existed NOTHING recovered them — the WS5 worker-kill drill
// (2026-07-08) orphaned 196/200 rows permanently. Policy mirrors the dispatch
// reaper's honesty split:
//   • OUTWARD event types (emails, platform broadcasts) → 'failed', never
//     requeued: the send may have partially fired, and at-most-once beats a
//     double-send. Surfaced via the normal failed-row telemetry.
//   • Internal compute types → requeued to 'retry' (bounded by MAX_ATTEMPTS,
//     already incremented at claim time) or 'failed' once attempts exhaust.
// claimed_at (migration 0199) is the staleness signal — created_at is enqueue
// time and would mis-reap a backlog claimed right after downtime.
export const OUTWARD_EVENT_TYPES = new Set(["lifecycle_email", "cmo.broadcast"]);
export const REAP_RUNNING_TTL_MS = parseInt(process.env.WORKER_REAP_RUNNING_TTL_MS ?? String(30 * 60_000), 10);

export interface ReapDeps {
  execute?: (query: SQL) => Promise<unknown>;
  nowMs?: () => number;
  maxAttempts?: number;
  ttlMs?: number;
}

export async function reapOrphanedOutbox(deps: ReapDeps = {}): Promise<void> {
  const execute = deps.execute ?? ((q: SQL) => db.execute(q));
  const nowMs = deps.nowMs ?? (() => clock.nowMs());
  const maxAttempts = deps.maxAttempts ?? MAX_ATTEMPTS;
  const ttlMs = deps.ttlMs ?? REAP_RUNNING_TTL_MS;
  try {
    const cutoff = new Date(nowMs() - ttlMs);
    const res = await execute(sql`
      UPDATE outbox
      SET status = CASE
            WHEN event_type IN (${sql.join([...OUTWARD_EVENT_TYPES].map((t) => sql`${t}`), sql`, `)}) THEN 'failed'
            WHEN attempts >= ${maxAttempts} THEN 'failed'
            ELSE 'retry'
          END,
          last_error_at = now(),
          last_error_message = 'reaped: orphaned running row past ' || ${Math.round(ttlMs / 60_000)} || 'min TTL (likely a worker crash mid-batch)'
      WHERE status = 'running'
        AND (claimed_at IS NULL OR claimed_at < ${cutoff})
      RETURNING id, event_type, status AS new_status
    `);
    const list: any[] = (res as any)?.rows ?? [];
    if (list.length > 0) {
      const requeued = list.filter((r) => r.new_status === "retry").length;
      logger.warn(
        `[worker] reaped ${list.length} orphaned running outbox row(s): ${requeued} requeued, ${list.length - requeued} failed (at-most-once / attempts exhausted)`,
      );
    }
  } catch (err) {
    logger.warn("[worker] outbox orphan reap failed", err instanceof Error ? err : undefined);
  }
}
