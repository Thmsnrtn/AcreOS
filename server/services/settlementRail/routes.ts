/**
 * Settlement & Documents Rail — routes (P1-3 core + the Notes transplant).
 *
 *   POST /api/notes/:id/payoff-letter        — N-1: quote (canonical engine,
 *                                              recorded) → formal letter →
 *                                              download | mail | certified.
 *   POST /api/notes/:id/lien-release         — N-2: release for a paid-off
 *                                              note + its recording row.
 *   GET  /api/recording-statuses             — S-2 reads (by subject).
 *   POST /api/recording-statuses/:id/advance — S-2 transitions.
 *   POST /api/money-events                   — S-3: record money received.
 *   GET  /api/money-events                   — S-3 reads (by subject, or a
 *                                              month's received total).
 *
 * Both note books share `/api/notes/:id` and are told apart by id shape
 * (integer = serviced, uuid = acquired) — see settlementRail/payoffLetter.
 * The borrower-portal payoff letter lives in routes-borrower.ts beside the
 * payoff quote, behind the borrower session.
 *
 * MOUNTING: this module is registered from `registerNoteRoutes`
 * (server/routes-notes.ts), NOT from server/routes.ts / routeManifest.ts —
 * those two files are owned by the Phase-0 landing lane while this package
 * is in flight, and the route-manifest test requires every routes-*.ts file
 * to be manifested. The rail's routes therefore live here, inside the rail
 * module, and mount through the notes register function (the same nested
 * registration routes-misc.ts uses for routes-ai-operations). When the
 * landing queue settles, this can move to a manifested routes-*.ts file
 * without changing a path.
 *
 * Nothing here moves money. Mail lanes charge the org's purchased mail
 * credits under the mail lane's own rules; a refused lane is a 4xx with the
 * refusal's own words, and no letter is ever reported sent on a refusal.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../types/request";
import { getOrganizationId, getUserId } from "../../types/request";
import { isAuthenticated } from "../../auth";
import { getOrCreateOrg } from "../../middleware/getOrCreateOrg";
import { requireRole } from "../../middleware/roleGuard";
import { Errors } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { routeParam } from "../../utils/routeParams";
import { parseIsoDateUtc } from "../notePaymentMath";
import { generatePayoffLetter } from "./payoffLetter";
import { generateLienRelease, LienReleaseRefusedError } from "./lienRelease";
import { deliverRailLetterByMail, RailDeliveryRefusedError } from "./delivery";
import {
  listRecordingStatusesForSubject,
  advanceRecordingStatus,
  RecordingTransitionError,
} from "./recordingStatus";
import { listMoneyEventsForSubject, moneyEventVarianceCents, recordMoneyEvent, sumMoneyReceivedInMonth } from "./moneyEvents";
import { MONEY_EVENT_KINDS, RECORDING_STATUSES } from "@shared/settlement-rail";
import { clock } from "../../utils/clock";

const payoffLetterSchema = z.object({
  /** Date the payoff funds are good (ISO). Defaults to today (UTC). */
  payoffDate: z.string().min(1).optional(),
  /** Org-configured payoff/processing fee (acquired book). Supplied, never assumed. */
  payoffFeeCents: z.number().int().nonnegative().optional(),
  delivery: z.enum(["download", "mail", "certified_mail"]).default("download"),
  /** Where payoff funds go, printed on the letter. */
  paymentInstructions: z.string().max(500).optional(),
});

const lienReleaseSchema = z.object({
  originalInstrumentNumber: z.string().max(120).optional(),
  originalRecordingDate: z.string().min(1).optional(),
  payoffDate: z.string().min(1).optional(),
  delivery: z.enum(["download"]).default("download"),
});

const advanceSchema = z.object({
  to: z.enum(RECORDING_STATUSES),
  instrumentNumber: z.string().max(120).optional(),
  documentRef: z.string().max(500).optional(),
  rejectionReason: z.string().max(500).optional(),
});

const moneyEventSchema = z.object({
  kind: z.enum(MONEY_EVENT_KINDS),
  vertical: z.string().min(1).max(60),
  subjectType: z.string().min(1).max(60),
  subjectId: z.string().min(1).max(120),
  amountCents: z.number().int().positive(),
  receivedDate: z.string().min(1),
  sourceName: z.string().max(200).optional(),
  sourceReference: z.string().max(200).optional(),
  reconcilesAgainstType: z.string().max(60).optional(),
  reconcilesAgainstId: z.string().max(120).optional(),
  expectedAmountCents: z.number().int().nonnegative().optional(),
  proofDocumentRef: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export function registerSettlementRailRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── N-1: the payoff letter ────────────────────────────────────────────────
  app.post(
    "/api/notes/:id/payoff-letter",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = routeParam(req.params.id);
        const parsed = payoffLetterSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        let payoffDate: Date;
        try {
          payoffDate = parseIsoDateUtc(parsed.data.payoffDate ?? clock.now().toISOString().slice(0, 10));
        } catch {
          return Errors.badRequest(res, "payoffDate must be a valid ISO date (YYYY-MM-DD)");
        }
        const result = await generatePayoffLetter({
          organizationId: orgId,
          noteId,
          payoffDate,
          channel: "operator_api",
          quotedByUserId: getUserId(req),
          payoffFeeCents: parsed.data.payoffFeeCents,
          paymentInstructions: parsed.data.paymentInstructions ?? null,
        });
        if (!result) return Errors.notFound(res, "Note");

        if (parsed.data.delivery === "download") {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="${result.artifact.filename}"`);
          return res.send(result.artifact.pdf);
        }
        if (!result.recipient) {
          return Errors.badRequest(
            res,
            "This note's borrower has no complete mailing address on record, so the letter cannot be mailed. Download it instead, or complete the borrower's address first.",
          );
        }
        const receipt = await deliverRailLetterByMail({
          organizationId: orgId,
          html: result.artifact.html,
          recipient: result.recipient,
          lane: parsed.data.delivery,
          idempotencyKey: `payoff-letter:${result.quoteRow.id}`,
        });
        return res.json({ quote: result.quoteRow, delivery: receipt });
      } catch (err) {
        if (err instanceof RailDeliveryRefusedError) return Errors.badRequest(res, err.message);
        logger.error("settlementRail.payoffLetter failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── N-2: the lien release ─────────────────────────────────────────────────
  app.post(
    "/api/notes/:id/lien-release",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = routeParam(req.params.id);
        const parsed = lienReleaseSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const result = await generateLienRelease({
          organizationId: orgId,
          noteId,
          createdByUserId: getUserId(req),
          originalInstrumentNumber: parsed.data.originalInstrumentNumber ?? null,
          originalRecordingDate: parsed.data.originalRecordingDate ?? null,
          payoffDate: parsed.data.payoffDate ?? null,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${result.artifact.filename}"`);
        res.setHeader("X-Recording-Status-Id", String(result.recording.id));
        res.setHeader("X-Recording-Status", result.recording.status);
        return res.send(result.artifact.pdf);
      } catch (err) {
        if (err instanceof LienReleaseRefusedError) {
          return err.reason === "note_not_found" ? Errors.notFound(res, "Note") : Errors.badRequest(res, err.message);
        }
        logger.error("settlementRail.lienRelease failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── S-2: recording status ─────────────────────────────────────────────────
  app.get(
    "/api/recording-statuses",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const subjectType = typeof req.query.subjectType === "string" ? req.query.subjectType : "";
        const subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : "";
        if (!subjectType || !subjectId) {
          return Errors.badRequest(res, "subjectType and subjectId query parameters are required");
        }
        const rows = await listRecordingStatusesForSubject(orgId, subjectType, subjectId);
        return res.json({ recordingStatuses: rows });
      } catch (err) {
        logger.error("settlementRail.recordingStatuses.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/recording-statuses/:id/advance",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = Number(routeParam(req.params.id));
        if (!Number.isInteger(id) || id <= 0) return Errors.badRequest(res, "Invalid recording status ID");
        const parsed = advanceSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const row = await advanceRecordingStatus({
          organizationId: orgId,
          id,
          to: parsed.data.to,
          instrumentNumber: parsed.data.instrumentNumber ?? null,
          documentRef: parsed.data.documentRef ?? null,
          rejectionReason: parsed.data.rejectionReason ?? null,
        });
        return res.json({ recordingStatus: row });
      } catch (err) {
        if (err instanceof RecordingTransitionError) return Errors.badRequest(res, err.message);
        logger.error("settlementRail.recordingStatuses.advance failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── S-3: money events ─────────────────────────────────────────────────────
  app.post(
    "/api/money-events",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = moneyEventSchema.safeParse(req.body ?? {});
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        try {
          parseIsoDateUtc(parsed.data.receivedDate);
        } catch {
          return Errors.badRequest(res, "receivedDate must be a valid ISO date (YYYY-MM-DD)");
        }
        const row = await recordMoneyEvent({
          organizationId: orgId,
          kind: parsed.data.kind,
          vertical: parsed.data.vertical,
          subjectType: parsed.data.subjectType,
          subjectId: parsed.data.subjectId,
          amountCents: parsed.data.amountCents,
          receivedDate: parsed.data.receivedDate,
          sourceName: parsed.data.sourceName ?? null,
          sourceReference: parsed.data.sourceReference ?? null,
          reconcilesAgainstType: parsed.data.reconcilesAgainstType ?? null,
          reconcilesAgainstId: parsed.data.reconcilesAgainstId ?? null,
          expectedAmountCents: parsed.data.expectedAmountCents ?? null,
          proofDocumentRef: parsed.data.proofDocumentRef ?? null,
          notes: parsed.data.notes ?? null,
          recordedByUserId: getUserId(req),
        });
        return res.json({ moneyEvent: row });
      } catch (err) {
        logger.error("settlementRail.moneyEvents.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/money-events",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const subjectType = typeof req.query.subjectType === "string" ? req.query.subjectType : "";
        const subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : "";
        const month = typeof req.query.month === "string" ? req.query.month : "";
        if (subjectType && subjectId) {
          const rows = await listMoneyEventsForSubject(orgId, subjectType, subjectId);
          // Each row carries its variance against the figure it reconciles
          // to (received − expected), so a short-pay is visible in the read
          // itself, not only derivable by the caller.
          return res.json({ moneyEvents: rows.map((r) => ({ ...r, varianceCents: moneyEventVarianceCents(r) })) });
        }
        if (/^\d{4}-\d{2}$/.test(month)) {
          const [y, m] = month.split("-").map(Number);
          const start = `${month}-01`;
          const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
          const summary = await sumMoneyReceivedInMonth(orgId, start, next);
          return res.json({ month, ...summary });
        }
        return Errors.badRequest(res, "Provide subjectType + subjectId, or a month (YYYY-MM)");
      } catch (err) {
        logger.error("settlementRail.moneyEvents.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
