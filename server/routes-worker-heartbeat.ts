/**
 * Tess #5 — worker liveness endpoint.
 *
 *   GET /api/health/worker-heartbeat   (AUTH-FREE, like /api/healthz)
 *
 * The worker process (server/worker.ts) bumps the single-row `worker_heartbeat`
 * table on every outbox poll loop. This endpoint exposes the age of that pulse
 * so an EXTERNAL eye (the Cloudflare probe, UptimeRobot, Better Stack) can
 * detect "the worker — and therefore every scheduled job AND all of alerting —
 * is down" *from outside the Fly app*. That is the only correct topology: the
 * thing that detects "alerting is down" must not itself live inside alerting.
 *
 * Why auth-free: a free external uptime monitor can't carry our session. Like
 * /api/healthz, this returns no tenant data — only a timestamp, an age, and a
 * boolean. The single useful fact for an external eye is staleness.
 *
 * Contract (always HTTP 200 so the probe distinguishes "endpoint reachable but
 * worker stale" from "app down" — the latter is a non-200/timeout it sees
 * directly):
 *   { ok, stale, lastBeatAt, ageSeconds, staleThresholdSeconds, instanceId, gitSha }
 *
 * `stale` flips true when ageSeconds exceeds the threshold (default 600s = 10m,
 * tunable via WORKER_HEARTBEAT_STALE_SECONDS). The external probe pages on
 * `stale === true` OR on its own non-200/timeout — belt and suspenders.
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import { workerHeartbeat } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "./utils/logger";

export const DEFAULT_STALE_SECONDS = 600; // 10 minutes

export function staleThresholdSeconds(): number {
  const raw = process.env.WORKER_HEARTBEAT_STALE_SECONDS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_SECONDS;
}

export interface HeartbeatFreshness {
  ok: boolean;
  stale: boolean;
  lastBeatAt: string | null;
  ageSeconds: number | null;
  staleThresholdSeconds: number;
  instanceId: string | null;
  gitSha: string | null;
}

/**
 * Pure freshness computation, exported for unit testing without a DB. Given the
 * last-beat timestamp (or null), the current time, and the threshold, returns
 * the exact JSON body the endpoint serves. A null/absent beat reads as stale.
 */
export function computeHeartbeatFreshness(args: {
  lastBeatAt: Date | null;
  now: number;
  thresholdSeconds: number;
  instanceId?: string | null;
  gitSha?: string | null;
}): HeartbeatFreshness {
  const { lastBeatAt, now, thresholdSeconds } = args;
  if (!lastBeatAt) {
    return {
      ok: false,
      stale: true,
      lastBeatAt: null,
      ageSeconds: null,
      staleThresholdSeconds: thresholdSeconds,
      instanceId: null,
      gitSha: null,
    };
  }
  const ageSeconds = Math.max(0, Math.round((now - lastBeatAt.getTime()) / 1000));
  const stale = ageSeconds > thresholdSeconds;
  return {
    ok: !stale,
    stale,
    lastBeatAt: lastBeatAt.toISOString(),
    ageSeconds,
    staleThresholdSeconds: thresholdSeconds,
    instanceId: args.instanceId ?? null,
    gitSha: args.gitSha ?? null,
  };
}

export function registerWorkerHeartbeatRoute(app: Express): void {
  app.get("/api/health/worker-heartbeat", async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    const threshold = staleThresholdSeconds();
    try {
      const [row] = await db
        .select({
          updatedAt: workerHeartbeat.updatedAt,
          instanceId: workerHeartbeat.instanceId,
          gitSha: workerHeartbeat.gitSha,
        })
        .from(workerHeartbeat)
        .where(eq(workerHeartbeat.id, 1))
        .limit(1);

      // No row yet (fresh DB before the worker's first loop) reads as "stale" —
      // an external eye treats "never beat" the same as "beat long ago."
      const body = computeHeartbeatFreshness({
        lastBeatAt: row?.updatedAt ? new Date(row.updatedAt) : null,
        now: Date.now(),
        thresholdSeconds: threshold,
        instanceId: row?.instanceId ?? null,
        gitSha: row?.gitSha ?? null,
      });
      return res.status(200).json(body);
    } catch (err) {
      // A DB error here is itself signal the external eye should page on, but we
      // surface it as 200 + stale=true (not a 500) so a probe keyed on HTTP
      // status alone still treats it as "not healthy" rather than "app is down."
      logger.warn(`[worker-heartbeat] read failed: ${err instanceof Error ? err.message : String(err)}`);
      return res.status(200).json({
        ok: false,
        stale: true,
        lastBeatAt: null,
        ageSeconds: null,
        staleThresholdSeconds: threshold,
        instanceId: null,
        gitSha: null,
        error: "heartbeat_read_failed",
      });
    }
  });
}
