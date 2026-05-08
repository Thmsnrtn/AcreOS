/**
 * Note acquisition pipeline — pre-book diligence surface (Phase 5 §5).
 *
 * GET    /api/note-acquisitions       — list, optionally filtered by stage
 * GET    /api/note-acquisitions/:id   — detail
 * POST   /api/note-acquisitions       — create at 'sourcing'
 * PATCH  /api/note-acquisitions/:id   — update fields / advance stage
 * POST   /api/note-acquisitions/:id/promote
 *                                      — funded → create acquired_notes row,
 *                                        mark stage='on_book', link IDs
 * DELETE /api/note-acquisitions/:id   — passed/abandoned
 *
 * Org-scoped, owner/admin-only (financial-asset entity, same posture as
 * the acquired_notes routes).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { acquiredNotes, noteAcquisitions, NOTE_ACQUISITION_STAGES, type NoteAcquisitionStage } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const addressSchema = z
  .object({
    line1: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
  })
  .passthrough();

const checklistItem = z.object({ done: z.boolean().optional(), note: z.string().optional() }).passthrough();
const checklistSchema = z
  .object({
    noteCopy: checklistItem.optional(),
    mortgageOrDot: checklistItem.optional(),
    paymentHistory: checklistItem.optional(),
    titleCommitment: checklistItem.optional(),
    priorAssignments: checklistItem.optional(),
    borrowerVerified: checklistItem.optional(),
    lienPosition: checklistItem.optional(),
  })
  .passthrough();

const stageEnum = z.enum(NOTE_ACQUISITION_STAGES);

const createSchema = z.object({
  payerName: z.string().min(1).max(240),
  propertyAddress: addressSchema.optional(),
  sourcedFrom: z.string().max(120).optional(),
  proposedFaceValueCents: z.number().int().nonnegative().optional(),
  proposedAcquisitionPriceCents: z.number().int().nonnegative().optional(),
  bpoValueCents: z.number().int().nonnegative().optional(),
  interestRateBps: z.number().int().min(0).max(100_000).optional(),
  termMonths: z.number().int().min(1).max(1200).optional(),
  diligenceChecklist: checklistSchema.optional(),
  stage: stageEnum.optional(),
  internalNotes: z.string().max(10_000).optional(),
});
const patchSchema = createSchema.partial();

const promoteSchema = z.object({
  noteNumber: z.string().min(1).max(120),
  originalPrincipalCents: z.number().int().nonnegative(),
  acquisitionPriceCents: z.number().int().nonnegative(),
  currentBalanceCents: z.number().int().nonnegative(),
  interestRateBps: z.number().int().min(0).max(100_000),
  termMonths: z.number().int().min(1).max(1200),
  paymentAmountCents: z.number().int().nonnegative(),
  paymentDueDay: z.number().int().min(1).max(31),
  originationDate: z.string().min(1),
  maturityDate: z.string().min(1),
  acquisitionDate: z.string().min(1),
  payerAddress: addressSchema.optional(),
  originalLender: z.string().max(240).optional(),
});

export function registerNoteAcquisitionRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── List ──────────────────────────────────────────────────────────────────
  app.get(
    "/api/note-acquisitions",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const stageQ = typeof req.query.stage === "string" ? req.query.stage : undefined;

        let query = db
          .select()
          .from(noteAcquisitions)
          .where(eq(noteAcquisitions.organizationId, orgId))
          .$dynamic();
        if (stageQ && (NOTE_ACQUISITION_STAGES as readonly string[]).includes(stageQ)) {
          query = query.where(
            and(
              eq(noteAcquisitions.organizationId, orgId),
              eq(noteAcquisitions.stage, stageQ as NoteAcquisitionStage),
            ),
          );
        }
        const rows = await query.orderBy(desc(noteAcquisitions.updatedAt)).limit(200);
        return res.json({ acquisitions: rows });
      } catch (err) {
        logger.error("noteAcquisitions.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Detail ────────────────────────────────────────────────────────────────
  app.get(
    "/api/note-acquisitions/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .select()
          .from(noteAcquisitions)
          .where(and(eq(noteAcquisitions.id, req.params.id), eq(noteAcquisitions.organizationId, orgId)))
          .limit(1);
        if (!row) return Errors.notFound(res, "Acquisition");
        return res.json({ acquisition: row });
      } catch (err) {
        logger.error("noteAcquisitions.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Create ────────────────────────────────────────────────────────────────
  app.post(
    "/api/note-acquisitions",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;
        const [row] = await db
          .insert(noteAcquisitions)
          .values({ organizationId: orgId, ...data })
          .returning();
        return res.status(201).json({ acquisition: row });
      } catch (err) {
        logger.error("noteAcquisitions.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Patch (advance stage / update fields) ─────────────────────────────────
  app.patch(
    "/api/note-acquisitions/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Auto-stamp BPO timestamps when the corresponding fields land.
        const update: Partial<typeof noteAcquisitions.$inferInsert> = {
          ...parsed.data,
          updatedAt: new Date(),
        };
        if (parsed.data.bpoValueCents !== undefined) {
          update.bpoReceivedAt = new Date();
          if (parsed.data.stage === undefined) update.stage = "bpo_received";
        }

        const [row] = await db
          .update(noteAcquisitions)
          .set(update)
          .where(and(eq(noteAcquisitions.id, req.params.id), eq(noteAcquisitions.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Acquisition");
        return res.json({ acquisition: row });
      } catch (err) {
        logger.error("noteAcquisitions.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Promote to acquired_notes ────────────────────────────────────────────
  // Linnea's "front door" ends here — once funded, the note enters the
  // servicing book (acquired_notes) and the pipeline row is archived.
  app.post(
    "/api/note-acquisitions/:id/promote",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = promoteSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;

        const [acq] = await db
          .select()
          .from(noteAcquisitions)
          .where(and(eq(noteAcquisitions.id, req.params.id), eq(noteAcquisitions.organizationId, orgId)))
          .limit(1);
        if (!acq) return Errors.notFound(res, "Acquisition");
        if (acq.promotedToNoteId) {
          return Errors.badRequest(res, "Acquisition already promoted to note " + acq.promotedToNoteId);
        }

        const [note] = await db
          .insert(acquiredNotes)
          .values({
            organizationId: orgId,
            noteNumber: data.noteNumber,
            originalPrincipalCents: data.originalPrincipalCents,
            currentBalanceCents: data.currentBalanceCents,
            interestRateBps: data.interestRateBps,
            termMonths: data.termMonths,
            paymentAmountCents: data.paymentAmountCents,
            paymentDueDay: data.paymentDueDay,
            originationDate: data.originationDate,
            maturityDate: data.maturityDate,
            acquisitionDate: data.acquisitionDate,
            acquisitionPriceCents: data.acquisitionPriceCents,
            payerName: acq.payerName,
            payerAddress: data.payerAddress ?? acq.propertyAddress ?? null,
            originalLender: data.originalLender ?? null,
            status: "performing",
          })
          .returning();

        if (!note) return Errors.internal(res, new Error("Promote: insert returned no row"));

        await db
          .update(noteAcquisitions)
          .set({ stage: "on_book", promotedToNoteId: note.id, updatedAt: new Date() })
          .where(eq(noteAcquisitions.id, req.params.id));

        return res.status(201).json({ note: { ...note, payerEncryptedTin: undefined }, acquisitionId: req.params.id });
      } catch (err) {
        if (err instanceof Error && /unique/i.test(err.message)) {
          return Errors.badRequest(res, "Note number already in use for this organization");
        }
        logger.error("noteAcquisitions.promote failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Delete ────────────────────────────────────────────────────────────────
  app.delete(
    "/api/note-acquisitions/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .delete(noteAcquisitions)
          .where(and(eq(noteAcquisitions.id, req.params.id), eq(noteAcquisitions.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Acquisition");
        return res.json({ deleted: true });
      } catch (err) {
        logger.error("noteAcquisitions.delete failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
