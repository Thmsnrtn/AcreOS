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
import {
  assessBreachNotification,
  EXPOSURE_KINDS,
  PERSONAL_DATA_CATEGORIES,
  type BreachAssessment,
} from "./services/breachNotificationTrigger";

/**
 * Breach-notification wiring (2026-08-16, founder ruling "Wire
 * breachNotificationTrigger only").
 *
 * `server/services/breachNotificationTrigger.ts` computes GLBA
 * 16 CFR 314.4(j), GDPR Art. 33 and state breach-notification deadlines
 * and had ZERO call sites. Its header names five security events that
 * should reach it — a leaked DB credential, an externally-shared prod
 * backup, a compromised sub-processor, unauthorized employee access to
 * non-scoped tenants, a lost laptop. NONE of the five has an automated
 * emitter in this repo; all five are discovered by a human. This route —
 * the founder-only incident tracker — is the one mounted surface where a
 * human declares a security event, so it is where the trigger hangs.
 *
 * Every statutory input is OPERATOR-SUPPLIED. Nothing is inferred:
 * `affectedOrgCount` counts ORGS and is not a data-subject count, so it is
 * deliberately not reused here. Omit `dataExposure` and no assessment runs
 * — an incident is not a breach until someone says what was exposed.
 *
 * The call is FAIL-SOFT (see `runBreachAssessment`): incident recording is
 * an incident-response path and must never break because a downstream
 * deadline computation threw.
 */
const dataExposureSchema = z.object({
  /** Which of the exposure kinds occurred. Operator-selected; never inferred. */
  exposureKind: z.enum(EXPOSURE_KINDS),
  /** High-confidence UPPER BOUND on distinct data subjects affected. */
  affectedDataSubjects: z.number().int().min(0),
  /** Categories confirmed or reasonably suspected exposed. */
  categoriesExposed: z.array(z.enum(PERSONAL_DATA_CATEGORIES)).min(1),
  /**
   * Jurisdictions where affected residents live. Omitted = the module's own
   * documented default (["ALL"], every deadline surfaced) — we do not guess
   * a narrower set on the operator's behalf.
   */
  jurisdictions: z.array(z.string().trim().min(1).max(20)).min(1).optional(),
  /** When AcreOS became AWARE. Omitted = the incident's own detectedAt. */
  discoveredAt: z.string().datetime().optional(),
  runbookUrl: z.string().trim().url().max(500).optional(),
});

type DataExposure = z.infer<typeof dataExposureSchema>;

/**
 * Fail-soft bridge from an incident row to the breach-notification trigger.
 *
 * Returns the assessment, or null when it could not be produced. A throw
 * here would 500 the incident write that a founder is making DURING an
 * incident, which is the worst possible moment for a self-inflicted
 * outage — so everything is caught and logged, matching the fail-soft
 * convention the failure-mode draft below already uses.
 */
async function runBreachAssessment(
  incident: { id: string; title: string; summary: string; detectedAt: Date | null; impactSummary: string | null },
  exposure: DataExposure,
): Promise<BreachAssessment | null> {
  try {
    const discoveredAt = exposure.discoveredAt
      ? new Date(exposure.discoveredAt)
      : incident.detectedAt ?? undefined;
    const description = incident.impactSummary
      ? `${incident.summary}\n\nCustomer impact: ${incident.impactSummary}`
      : incident.summary;

    const assessment = await assessBreachNotification({
      summary: incident.title.slice(0, 200),
      description,
      discoveredAt,
      affectedDataSubjects: exposure.affectedDataSubjects,
      categoriesExposed: exposure.categoriesExposed,
      exposureKind: exposure.exposureKind,
      jurisdictions: exposure.jurisdictions,
      runbookUrl: exposure.runbookUrl,
    });

    logger.warn("[incidents] breach-notification assessment ran", {
      metadata: {
        incidentId: incident.id,
        exposureKind: exposure.exposureKind,
        notificationRequired: assessment.notificationRequired,
        triggeredJurisdictions: assessment.triggeredJurisdictions,
        gdpr72hDeadline: assessment.gdpr72hDeadline,
        __pii_safe: true,
      },
    });
    return assessment;
  } catch (err) {
    // Never rethrow: the incident row is already persisted, and losing the
    // assessment must not lose the incident. Logged loudly so the gap is
    // visible in the same place the founder is already looking.
    logger.error(
      "[incidents] breach-notification assessment FAILED — assess manually, statutory clocks may be running",
      err as Error,
      {
        metadata: {
          incidentId: incident.id,
          exposureKind: exposure.exposureKind,
          __pii_safe: true,
        },
      },
    );
    return null;
  }
}

const createSchema = z.object({
  severity: z.enum(INCIDENT_SEVERITIES),
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(3).max(5000),
  startedAt: z.string().datetime().optional(),
  detectionSource: z.string().trim().max(40).optional(),
  impactSummary: z.string().trim().max(2000).optional(),
  affectedOrgCount: z.number().int().min(0).optional(),
  /** Present only when the incident is known at open time to have exposed
   *  personal data. Drives the breach-notification trigger. */
  dataExposure: dataExposureSchema.optional(),
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
  /** Present when investigation RECLASSIFIES the incident as a personal-data
   *  breach. GDPR Art. 33's clock runs from awareness, and awareness usually
   *  arrives here rather than at open time — so this is a real second hook,
   *  not a duplicate of the create path. */
  dataExposure: dataExposureSchema.optional(),
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

        // ── Breach-notification trigger (call site 1 of 2) ──────────────
        // Only when the founder declared what was exposed. Fail-soft: the
        // incident is already persisted above and is returned either way.
        const breachAssessment = parsed.data.dataExposure
          ? await runBreachAssessment(row, parsed.data.dataExposure)
          : null;

        return res.status(201).json({ ...row, breachAssessment });
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
          // `dataExposure` drives the breach-notification trigger below; it
          // is NOT a column on `incidents` and must never reach the update.
          if (k === "dataExposure") continue;
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

        // ── Breach-notification trigger (call site 2 of 2) ──────────────
        // The reclassification path: an incident opened as "elevated 500s"
        // that turns out on investigation to have exposed personal data.
        // GDPR Art. 33 runs from awareness, and awareness lands HERE more
        // often than at open time. Fail-soft; the row is already updated.
        const breachAssessment = parsed.data.dataExposure
          ? await runBreachAssessment(row, parsed.data.dataExposure)
          : null;

        // Tier 2D — a finalized incident with lessonsLearned auto-drafts a
        // failure-mode library entry (status='draft'; the dispatch preamble
        // reads only the disk ledger, so drafts are review-gated by
        // construction). Fail-soft: drafting never breaks the PATCH.
        if (
          row.lessonsLearned &&
          (row.status === "resolved" || row.status === "post_mortem_done")
        ) {
          try {
            const { draftFailureModeFromIncident } = await import(
              "./services/solene/incidentFailureModeDraft"
            );
            await draftFailureModeFromIncident(row);
          } catch (draftErr) {
            logger.warn("[incidents] failure-mode draft failed (non-fatal)", {
              metadata: {
                incidentId: row.id,
                error:
                  draftErr instanceof Error ? draftErr.message : String(draftErr),
              },
            });
          }
        }

        return res.json({ ...row, breachAssessment });
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
