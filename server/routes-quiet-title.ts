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
import { clock } from "./utils/clock";
import { isCalendarDate } from "@shared/dates/calendar";

/**
 * Step deadlines are NOT invented. Until 2026-10-28 every case in every state
 * was seeded with the same fixed day offsets from deed recordation (14, 21,
 * 30, 90 … 210 days) — a national quiet-title schedule, which the tax package
 * forbids (founder decision 2026-10-28). Quiet-title notice periods, waiting
 * periods and court timelines are set by each state's statute and each
 * court's calendar. Steps now open with no required-by date; the operator
 * (or their attorney) sets each date from the actual procedure, and a
 * sourced per-county procedure object (V-Tax-1 T2) can supply them later.
 */
const STEP_DATES_UNSET_REASON =
  "AcreOS does not set quiet-title step dates: they come from the state's statute and the court's calendar. Set each date from your attorney or the procedure.";

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
            status: taxCertificates.status,
            redemptionDeadline: taxCertificates.redemptionDeadline,
          })
          .from(taxCertificates)
          .where(and(eq(taxCertificates.id, data.certificateId), eq(taxCertificates.organizationId, orgId)))
          .limit(1);
        if (!cert) return Errors.notFound(res, "Certificate");
        // STATUS GATE (V-Tax-1 T2b): quiet title is for a deed whose
        // redemption has run out. A certificate that is still redeemable,
        // was redeemed, or was cancelled cannot open a case. The date is
        // checked WHATEVER the status says: a status is an operator's
        // assertion (PATCH can set deed_obtained), the deadline is the
        // county's, and the gate must not pass on the assertion alone.
        const today = clock.now().toISOString().slice(0, 10);
        const deadline = cert.redemptionDeadline as unknown as string;
        if (cert.status === "redeemed" || cert.status === "cancelled") {
          return Errors.unprocessable(res, `This certificate is ${cert.status}; there is no deed to quiet title on.`, { status: cert.status });
        }
        if (deadline >= today) {
          return Errors.unprocessable(res, `Still redeemable until ${deadline}. A quiet-title case opens only once redemption has expired.`, { redeemableUntil: deadline });
        }

        // Look up the state-rule citation (informational only — it sets no dates).
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

        // Seed the 10 standard steps, undated (see STEP_DATES_UNSET_REASON).
        const stepRows = QUIET_TITLE_STEP_KEYS.map((key) => ({
          organizationId: orgId,
          caseId: c.id,
          stepKey: key,
          requiredByDate: null,
        }));
        await db.insert(quietTitleSteps).values(stepRows);

        return res.status(201).json({
          case: c,
          stepCount: stepRows.length,
          stepDatesSet: false,
          stepDatesReason: STEP_DATES_UNSET_REASON,
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
          .where(eq(quietTitleSteps.caseId, c.id));
        // Procedure order, not date order: steps may be undated.
        steps.sort((a, b) => QUIET_TITLE_STEP_KEYS.indexOf(a.stepKey as QuietTitleStepKey) - QUIET_TITLE_STEP_KEYS.indexOf(b.stepKey as QuietTitleStepKey));
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
          updatedAt: clock.now(),
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

  // ── Attorney-reviewed marketability exception (V-Tax-1 T2b) ───────────────
  // Without the quiet-title petition filed, a deed is not eligible to market
  // in AcreOS — unless an attorney-reviewed exception is recorded, with the
  // attorney's name and the reason. AcreOS records it; it never declares
  // that title is marketable.
  app.post(
    "/api/quiet-title/cases/:id/market-exception",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z
          .object({
            attorneyName: z.string().trim().min(2).max(240),
            reason: z.string().trim().min(10, "say why the attorney considers it marketable before the filing").max(2_000),
          })
          .strict()
          .safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const [c] = await db
          .update(noteQuietTitleCases)
          .set({
            marketException: { ...parsed.data, recordedAt: clock.now().toISOString(), recordedBy: req.user?.id ?? "unknown" },
            updatedAt: clock.now(),
          })
          .where(and(eq(noteQuietTitleCases.id, req.params.id), eq(noteQuietTitleCases.organizationId, orgId)))
          .returning();
        if (!c) return Errors.notFound(res, "Case");
        res.json({ case: c });
      } catch (err) {
        logger.error("quietTitle.marketException failed", err instanceof Error ? err : undefined);
        Errors.internal(res, err);
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
          requiredByDate: z.string().refine(isCalendarDate, "not a calendar date (YYYY-MM-DD)").optional(),
          documentS3Key: z.string().optional(),
          notes: z.string().max(4_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const userId = req.user?.id || req.user?.id || null;
        const update: Partial<typeof quietTitleSteps.$inferInsert> = {
          requiredByDate: parsed.data.requiredByDate,
          documentS3Key: parsed.data.documentS3Key,
          notes: parsed.data.notes,
          updatedAt: clock.now(),
        };
        if (parsed.data.completed === true) {
          update.completedAt = clock.now();
          update.completedByUserId = userId;
        } else if (parsed.data.completed === false) {
          update.completedAt = null;
          update.completedByUserId = null;
        }

        const [step] = await db
          .select({ id: quietTitleSteps.id, stepKey: quietTitleSteps.stepKey, caseId: quietTitleSteps.caseId, completedAt: quietTitleSteps.completedAt })
          .from(quietTitleSteps)
          .where(and(eq(quietTitleSteps.id, req.params.id), eq(quietTitleSteps.organizationId, orgId)))
          .limit(1);
        if (!step) return Errors.notFound(res, "Step");

        // The petition filing is what lifts the improve/market lock (V-Tax-1
        // T2b), so completing it re-checks the certificate — the case gate is
        // not the only way in — and puts the filing on the tax calendar
        // (tax_events, append-only). Because the calendar cannot take a
        // filing back, a filed petition is not un-filed here.
        let filing: { certificateId: string } | null = null;
        if (step.stepKey === "petition_filed") {
          if (parsed.data.completed === false && step.completedAt) {
            return Errors.unprocessable(res, "The petition filing is on the tax calendar and cannot be taken back. If it was marked in error, record the correction in this step's notes.", { filedOn: step.completedAt.toISOString().slice(0, 10) });
          }
          if (parsed.data.completed === true && !step.completedAt) {
            const [cert] = await db
              .select({ id: taxCertificates.id, status: taxCertificates.status, redemptionDeadline: taxCertificates.redemptionDeadline })
              .from(noteQuietTitleCases)
              .innerJoin(taxCertificates, and(eq(taxCertificates.id, noteQuietTitleCases.certificateId), eq(taxCertificates.organizationId, orgId)))
              .where(and(eq(noteQuietTitleCases.id, step.caseId), eq(noteQuietTitleCases.organizationId, orgId)))
              .limit(1);
            if (!cert) return Errors.unprocessable(res, "This case has no certificate on record, so a petition filing cannot be put on its calendar.");
            const deadline = cert.redemptionDeadline as unknown as string;
            if (cert.status === "redeemed" || cert.status === "cancelled") {
              return Errors.unprocessable(res, `This certificate is ${cert.status}; there is no deed to quiet title on.`, { status: cert.status });
            }
            if (deadline >= clock.now().toISOString().slice(0, 10)) {
              return Errors.unprocessable(res, `Still redeemable until ${deadline}. A quiet-title petition is filed only once redemption has expired.`, { redeemableUntil: deadline });
            }
            filing = { certificateId: cert.id };
          }
        }

        const row = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(quietTitleSteps)
            .set(update)
            .where(and(eq(quietTitleSteps.id, step.id), eq(quietTitleSteps.organizationId, orgId)))
            .returning();
          if (updated && filing && updated.completedAt) {
            const { registerQuietTitleFiled } = await import("./services/tax/taxEvents");
            await registerQuietTitleFiled(tx, {
              organizationId: orgId,
              certificateId: filing.certificateId,
              caseId: step.caseId,
              stepId: step.id,
              date: updated.completedAt.toISOString().slice(0, 10),
              recordedBy: userId ?? "unknown",
            });
          }
          return updated;
        });
        if (!row) return Errors.notFound(res, "Step");
        return res.json({ step: row });
      } catch (err) {
        logger.error("quietTitle.step.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
