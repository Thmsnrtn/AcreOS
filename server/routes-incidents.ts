/**
 * Pillar D / D9 — Incident tracking + post-mortem routes.
 *
 *   GET    /api/founder/incidents       — list, filter by status/severity
 *   POST   /api/founder/incidents       — create a new incident
 *   PATCH  /api/founder/incidents/:id   — update status, root cause, post-mortem
 *   GET    /api/founder/incidents/stats — counts + MTTR by severity over 90d
 *
 * Founder-only. The route doesn't require an org because incidents are
 * platform-wide.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { incidents, INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@shared/schema";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const createSchema = z.object({
  severity: z.enum(INCIDENT_SEVERITIES),
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(3).max(5000),
  startedAt: z.string().datetime().optional(),
  detectionSource: z.string().trim().max(40).optional(),
  impactSummary: z.string().trim().max(2000).optional(),
  affectedOrgCount: z.number().int().min(0).optional(),
});

const updateSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  mitigatedAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().optional(),
  rootCauseCategory: z.string().trim().max(40).optional(),
  rootCauseSummary: z.string().trim().max(5000).optional(),
  postMortemUrl: z.string().trim().url().max(500).optional(),
  lessonsLearned: z.string().trim().max(10_000).optional(),
  estimatedRevenueImpactCents: z.number().int().optional(),
  followupActions: z
    .array(
      z.object({
        owner: z.string().trim().max(80),
        description: z.string().trim().max(500),
        dueBy: z.string().datetime().optional(),
        done: z.boolean().optional(),
      }),
    )
    .optional(),
});

export function registerIncidentRoutes(app: Express): void {
  // ── GET /api/founder/incidents ──────────────────────────────────────────
  app.get(
    "/api/founder/incidents",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "50", 10)));
        const status = req.query.status as string | undefined;
        const severity = req.query.severity as string | undefined;

        const filters = [];
        if (status && (INCIDENT_STATUSES as readonly string[]).includes(status)) {
          filters.push(eq(incidents.status, status));
        }
        if (severity && (INCIDENT_SEVERITIES as readonly string[]).includes(severity)) {
          filters.push(eq(incidents.severity, severity));
        }
        const where = filters.length ? and(...filters) : undefined;

        const rows = await db
          .select()
          .from(incidents)
          .where(where)
          .orderBy(desc(incidents.startedAt))
          .limit(limit);

        return res.json({ incidents: rows, count: rows.length });
      } catch (err: unknown) {
        logger.error("[incidents] list failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST /api/founder/incidents ─────────────────────────────────────────
  app.post(
    "/api/founder/incidents",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const now = new Date();
        const startedAt = parsed.data.startedAt ? new Date(parsed.data.startedAt) : now;
        const founderEmail = req.user?.email ?? "founder";

        const [row] = await db
          .insert(incidents)
          .values({
            severity: parsed.data.severity,
            title: parsed.data.title,
            summary: parsed.data.summary,
            status: "open",
            startedAt,
            detectedAt: now,
            detectionSource: parsed.data.detectionSource ?? "internal",
            impactSummary: parsed.data.impactSummary,
            affectedOrgCount: parsed.data.affectedOrgCount,
            createdBy: founderEmail,
          })
          .returning();
        return res.status(201).json(row);
      } catch (err: unknown) {
        logger.error("[incidents] create failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── PATCH /api/founder/incidents/:id ────────────────────────────────────
  app.patch(
    "/api/founder/incidents/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = updateSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const id = req.params.id;
        const now = new Date();

        const patch: Record<string, unknown> = { updatedAt: now };
        for (const [k, v] of Object.entries(parsed.data)) {
          if (v === undefined) continue;
          if (k === "mitigatedAt" || k === "resolvedAt") {
            patch[k] = new Date(v as string);
          } else {
            patch[k] = v;
          }
        }

        // Status transitions auto-populate the corresponding timestamp.
        if (parsed.data.status === "mitigated" && !patch.mitigatedAt) patch.mitigatedAt = now;
        if (parsed.data.status === "resolved" && !patch.resolvedAt) patch.resolvedAt = now;

        const [row] = await db
          .update(incidents)
          .set(patch)
          .where(eq(incidents.id, id))
          .returning();
        if (!row) return Errors.notFound(res, "Incident");
        return res.json(row);
      } catch (err: unknown) {
        logger.error("[incidents] update failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/founder/incidents/stats ────────────────────────────────────
  app.get(
    "/api/founder/incidents/stats",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const rows = await db
          .select({
            severity: incidents.severity,
            count: sql<number>`count(*)::int`,
            mttrMs: sql<string>`COALESCE(AVG(EXTRACT(EPOCH FROM (${incidents.resolvedAt} - ${incidents.startedAt})) * 1000), 0)`,
          })
          .from(incidents)
          .where(gte(incidents.startedAt, ninetyDaysAgo))
          .groupBy(incidents.severity);

        const bySeverity: Record<string, { count: number; mttrMinutes: number | null }> = {};
        for (const r of rows) {
          const mttrMs = Number(r.mttrMs) || 0;
          bySeverity[r.severity] = {
            count: Number(r.count),
            mttrMinutes: mttrMs > 0 ? Math.round(mttrMs / 60000) : null,
          };
        }

        return res.json({
          windowDays: 90,
          bySeverity,
          generatedAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        logger.error("[incidents] stats failed", err);
        return Errors.internal(res, err);
      }
    },
  );
}
