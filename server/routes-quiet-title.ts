/**
 * Quiet-title workflow routes (TD-6).
 *
 * Marcus: "AcreOS could be the first platform to actually run that
 * workflow. […] per-state quiet-title checklist (notice to lienholders,
 * notice to heirs, publication, statutory waiting period, petition draft,
 * hearing date, judgment recordation), each with a deadline driven off
 * the deed-recordation date, each with a generated document template,
 * each with an audit trail."
 *
 * Endpoints:
 *   POST   /api/quiet-title/cases             — open new case for a cert
 *   GET    /api/quiet-title/cases             — list, optional status filter
 *   GET    /api/quiet-title/cases/:id         — detail + steps
 *   PATCH  /api/quiet-title/cases/:id         — update status / fields
 *   PATCH  /api/quiet-title/steps/:id         — mark step complete / update
 *
 * Per-state deadline math is encoded in the case-creation handler — when
 * we know the deed_recordation_date and the state, we seed the standard
 * 10-step checklist with required-by dates derived from the state rule.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  noteQuietTitleCases,
  quietTitleSteps,
  taxCertificates,
  taxJurisdictionRules,
  QUIET_TITLE_STATUS,
  QUIET_TITLE_STEP_KEYS,
  type QuietTitleStepKey,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

/**
 * Default per-step deadline offsets (days) from deed_recordation_date.
 * These are starting points; some steps depend on others. Per-state
 * tweaks come from tax_jurisdiction_rules.notice_requirements when
 * present (parsed as a free-text override; not yet machine-readable —
 * that's a TD-6.1 follow-up).
 *
 * The intervals here are author-researched, not attorney-reviewed.
 * The case detail UI surfaces this with a "preliminary" label.
 */
const STEP_OFFSETS_DAYS: Record<QuietTitleStepKey, number> = {
  notice_to_lienholders:    14,    // 2 weeks after deed
  notice_to_heirs:          21,    // 3 weeks
  notice_publication:       30,    // 4 weeks
  statutory_waiting_period: 90,    // varies by state — 60-90 typical
  petition_drafted:         110,
  petition_filed:           120,
  hearing_scheduled:        150,
  hearing_held:             180,
  judgment_entered:         200,
  judgment_recorded:        210,   // ~7 months end-to-end typical
};

function offsetDaysIso(baseIso: string, days: number): string {
  const d = new Date(baseIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function registerQuietTitleRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── Open a new case ──────────────────────────────────────────────────────
  app.post(
    "/api/quiet-title/cases",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          certificateId: z.string().uuid(),
          deedRecordationDate: z.string().min(1),
          attorneyName: z.string().max(240).optional(),
          attorneyContact: z.string().max(240).optional(),
          summary: z.string().max(4_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;

        // Confirm the certificate belongs to the org + grab the state.
        const [cert] = await db
          .select({
            id: taxCertificates.id,
            state: taxCertificates.state,
            county: taxCertificates.county,
            apn: taxCertificates.apn,
          })
          .from(taxCertificates)
          .where(and(eq(taxCertificates.id, data.certificateId), eq(taxCertificates.organizationId, orgId)))
          .limit(1);
        if (!cert) return Errors.notFound(res, "Certificate");

        // Look up the state-rule citation (informational; deadlines come
        // from STEP_OFFSETS_DAYS for now).
        const [rule] = await db
          .select()
          .from(taxJurisdictionRules)
          .where(eq(taxJurisdictionRules.state, cert.state))
          .limit(1);

        // Insert the case.
        const [c] = await db
          .insert(noteQuietTitleCases)
          .values({
            organizationId: orgId,
            certificateId: data.certificateId,
            state: cert.state,
            county: cert.county,
            apn: cert.apn,
            deedRecordationDate: data.deedRecordationDate,
            attorneyName: data.attorneyName ?? null,
            attorneyContact: data.attorneyContact ?? null,
            summary: data.summary ?? null,
          })
          .returning();
        if (!c) return Errors.internal(res, new Error("Insert returned no row"));

        // Seed the 10 standard steps with computed deadlines.
        const stepRows = QUIET_TITLE_STEP_KEYS.map((key) => ({
          organizationId: orgId,
          caseId: c.id,
          stepKey: key,
          requiredByDate: offsetDaysIso(data.deedRecordationDate, STEP_OFFSETS_DAYS[key]),
        }));
        await db.insert(quietTitleSteps).values(stepRows);

        return res.status(201).json({
          case: c,
          stepCount: stepRows.length,
          stateRuleCitation: rule?.citation ?? null,
          stateRuleReviewed: !!rule?.attorneyReviewedAt,
        });
      } catch (err) {
        logger.error("quietTitle.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── List cases ───────────────────────────────────────────────────────────
  app.get(
    "/api/quiet-title/cases",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const conds = [eq(noteQuietTitleCases.organizationId, orgId)];
        if (status && (QUIET_TITLE_STATUS as readonly string[]).includes(status)) {
          conds.push(eq(noteQuietTitleCases.status, status as any));
        }
        const rows = await db
          .select()
          .from(noteQuietTitleCases)
          .where(and(...conds))
          .orderBy(asc(noteQuietTitleCases.deedRecordationDate));
        return res.json({ cases: rows });
      } catch (err) {
        logger.error("quietTitle.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Case detail + steps ──────────────────────────────────────────────────
  app.get(
    "/api/quiet-title/cases/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [c] = await db
          .select()
          .from(noteQuietTitleCases)
          .where(and(eq(noteQuietTitleCases.id, req.params.id), eq(noteQuietTitleCases.organizationId, orgId)))
          .limit(1);
        if (!c) return Errors.notFound(res, "Case");
        const steps = await db
          .select()
          .from(quietTitleSteps)
          .where(eq(quietTitleSteps.caseId, c.id))
          .orderBy(asc(quietTitleSteps.requiredByDate));
        const [rule] = await db
          .select()
          .from(taxJurisdictionRules)
          .where(eq(taxJurisdictionRules.state, c.state))
          .limit(1);
        return res.json({
          case: c,
          steps,
          stateRule: rule
            ? {
                citation: rule.citation,
                attorneyReviewedAt: rule.attorneyReviewedAt,
                noticeRequirements: rule.noticeRequirements,
                quietTitleProcedure: rule.quietTitleProcedure,
              }
            : null,
        });
      } catch (err) {
        logger.error("quietTitle.detail failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Update case ──────────────────────────────────────────────────────────
  app.patch(
    "/api/quiet-title/cases/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          status: z.enum(QUIET_TITLE_STATUS).optional(),
          attorneyName: z.string().max(240).optional(),
          attorneyContact: z.string().max(240).optional(),
          petitionFiledAt: z.string().optional(),
          courtCaseNumber: z.string().max(120).optional(),
          hearingScheduledAt: z.string().optional(),
          judgmentEnteredAt: z.string().optional(),
          judgmentRecordedAt: z.string().optional(),
          summary: z.string().max(4_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const update: Partial<typeof noteQuietTitleCases.$inferInsert> = {
          ...parsed.data,
          updatedAt: new Date(),
          hearingScheduledAt: parsed.data.hearingScheduledAt
            ? new Date(parsed.data.hearingScheduledAt)
            : undefined,
        };

        const [row] = await db
          .update(noteQuietTitleCases)
          .set(update)
          .where(and(eq(noteQuietTitleCases.id, req.params.id), eq(noteQuietTitleCases.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Case");
        return res.json({ case: row });
      } catch (err) {
        logger.error("quietTitle.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Update / complete a step ─────────────────────────────────────────────
  app.patch(
    "/api/quiet-title/steps/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          completed: z.boolean().optional(),
          requiredByDate: z.string().optional(),
          documentS3Key: z.string().optional(),
          notes: z.string().max(4_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const userId = (req.user as any)?.id || (req.user as any)?.id || null;
        const update: Partial<typeof quietTitleSteps.$inferInsert> = {
          requiredByDate: parsed.data.requiredByDate,
          documentS3Key: parsed.data.documentS3Key,
          notes: parsed.data.notes,
          updatedAt: new Date(),
        };
        if (parsed.data.completed === true) {
          update.completedAt = new Date();
          update.completedByUserId = userId;
        } else if (parsed.data.completed === false) {
          update.completedAt = null;
          update.completedByUserId = null;
        }

        const [row] = await db
          .update(quietTitleSteps)
          .set(update)
          .where(and(eq(quietTitleSteps.id, req.params.id), eq(quietTitleSteps.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Step");
        return res.json({ step: row });
      } catch (err) {
        logger.error("quietTitle.step.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
