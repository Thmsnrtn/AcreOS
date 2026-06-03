/**
 * EXTERNAL-WATCH — founder visibility endpoint.
 *
 * Layer 1 cap #4 (#17 in 32-cap map). Surfaces external_watch_events to
 * Tom + supports the ack mutation:
 *
 *   GET /api/founder/external-watch/recent?source=...&ack_status=...&days=...
 *     Returns the last N days (default 30) of events, optionally filtered
 *     by source + ack_status. Groups by source for the badge counts in
 *     the morning-brief surface.
 *
 *   POST /api/founder/external-watch/:id/ack
 *     Body: { ack_status?: 'acknowledged' | 'actioned' | 'dismissed',
 *             action_taken?: string }
 *     Writes ack_status (default 'acknowledged'), ack_by='tom',
 *     ack_at=now, and optionally action_taken. Idempotent — re-acking
 *     overwrites ack_at + ack_by but the row stays.
 *
 * Auth: isAuthenticated + requireFounder. No customer-side surface.
 *
 * Underlying ingest runs on the daily crons (Anthropic 03:00 UTC,
 * npm 04:00 UTC) — see server/jobs/runScheduledJobs.ts →
 * startAnthropicWatchJob / startNpmWatchJob. Per-source discipline docs:
 *   - docs/internal/anthropic-watch-discipline.md (48h ack SLA — Iris)
 *   - docs/internal/npm-watch-discipline.md (24h critical / 7d high — Iris)
 */

import type { Express, Response } from "express";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { db } from "./db";
import {
  externalWatchEvents,
  EXTERNAL_WATCH_SOURCES,
  EXTERNAL_WATCH_ACK_STATUSES,
  type ExternalWatchAckStatus,
  type ExternalWatchSource,
} from "@shared/schema/external-watch";

const DEFAULT_DAYS = 30;

export function registerExternalWatchRoutes(app: Express): void {
  // ── GET /api/founder/external-watch/recent ─────────────────────────────
  app.get(
    "/api/founder/external-watch/recent",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const daysRaw = req.query.days;
        const days =
          typeof daysRaw === "string"
            ? Math.min(Math.max(parseInt(daysRaw, 10) || DEFAULT_DAYS, 1), 365)
            : DEFAULT_DAYS;

        const sourceFilter = parseSourceFilter(req.query.source);
        const ackFilter = parseAckStatusFilter(req.query.ack_status);

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const conditions = [gte(externalWatchEvents.publishedAt, cutoff)];
        if (sourceFilter.length > 0) {
          conditions.push(inArray(externalWatchEvents.source, sourceFilter));
        }
        if (ackFilter.length > 0) {
          conditions.push(inArray(externalWatchEvents.ackStatus, ackFilter));
        }

        const rows = await db
          .select()
          .from(externalWatchEvents)
          .where(and(...conditions))
          .orderBy(desc(externalWatchEvents.publishedAt))
          .limit(500);

        const bySource: Record<string, number> = {};
        const byAckStatus: Record<string, number> = {};
        let pendingCount = 0;
        for (const r of rows) {
          bySource[r.source] = (bySource[r.source] ?? 0) + 1;
          byAckStatus[r.ackStatus] = (byAckStatus[r.ackStatus] ?? 0) + 1;
          if (r.ackStatus === "pending") pendingCount++;
        }

        return res.json({
          days,
          totalEvents: rows.length,
          pendingCount,
          bySource,
          byAckStatus,
          events: rows.map((r) => ({
            id: r.id,
            source: r.source,
            sourceUrl: r.sourceUrl,
            title: r.title,
            summary: r.summary,
            severityKeywordMatch: r.severityKeywordMatch,
            publishedAt: r.publishedAt,
            fetchedAt: r.fetchedAt,
            ackStatus: r.ackStatus,
            ackBy: r.ackBy,
            ackAt: r.ackAt,
            actionTaken: r.actionTaken,
          })),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST /api/founder/external-watch/:id/ack ───────────────────────────
  app.post(
    "/api/founder/external-watch/:id/ack",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id) || id <= 0) {
          return Errors.badRequest(res, "Invalid event id");
        }

        const body = (req.body ?? {}) as {
          ack_status?: string;
          action_taken?: string;
        };
        const nextStatus = parseAckStatusValue(body.ack_status) ?? "acknowledged";
        if (nextStatus === "pending") {
          return Errors.badRequest(
            res,
            "Cannot ack to 'pending' — that's the default state",
          );
        }
        const actionTaken =
          typeof body.action_taken === "string" && body.action_taken.trim()
            ? body.action_taken.trim().slice(0, 4000)
            : null;

        const result = await db
          .update(externalWatchEvents)
          .set({
            ackStatus: nextStatus,
            ackBy: "tom",
            ackAt: new Date(),
            ...(actionTaken !== null ? { actionTaken } : {}),
          })
          .where(eq(externalWatchEvents.id, id))
          .returning({
            id: externalWatchEvents.id,
            ackStatus: externalWatchEvents.ackStatus,
            ackBy: externalWatchEvents.ackBy,
            ackAt: externalWatchEvents.ackAt,
            actionTaken: externalWatchEvents.actionTaken,
          });

        if (result.length === 0) {
          return Errors.notFound(res, "External-watch event");
        }

        return res.json({ ok: true, event: result[0] });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}

// ============================================================================
// Query-string parsing helpers
// ============================================================================

function parseSourceFilter(raw: unknown): ExternalWatchSource[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return tokens.filter((t): t is ExternalWatchSource =>
    (EXTERNAL_WATCH_SOURCES as readonly string[]).includes(t),
  );
}

function parseAckStatusFilter(raw: unknown): ExternalWatchAckStatus[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  return tokens.filter((t): t is ExternalWatchAckStatus =>
    (EXTERNAL_WATCH_ACK_STATUSES as readonly string[]).includes(t),
  );
}

function parseAckStatusValue(raw: unknown): ExternalWatchAckStatus | null {
  if (typeof raw !== "string") return null;
  if ((EXTERNAL_WATCH_ACK_STATUSES as readonly string[]).includes(raw)) {
    return raw as ExternalWatchAckStatus;
  }
  return null;
}

// ============================================================================
// FOUNDER-VISIBILITY HELPER — used by morningBrief.ts for the inline segment.
// ============================================================================

/**
 * Returns the count of pending external-watch events across all sources.
 * Used by the morning-brief one-line ("external-watch pending: X").
 * Best-effort — callers should wrap in a timeout + fail-graceful path
 * because the morning brief must not block on this query.
 */
export async function countPendingExternalWatchEvents(): Promise<number> {
  const rows = await db
    .select({ id: externalWatchEvents.id })
    .from(externalWatchEvents)
    .where(eq(externalWatchEvents.ackStatus, "pending"))
    .limit(10_000);
  return rows.length;
}
