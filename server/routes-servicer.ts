/**
 * Note Servicer routes — Pillar K (Ursa) foundation.
 *
 * Surfaces (org-scoped, owner/admin only):
 *
 *   GET    /api/servicer/remittances?ownerOrgId=:id&limit=:n&offset=:n
 *                                  — Paginated remittances for this servicer.
 *   GET    /api/servicer/remittances/:id
 *                                  — Single remittance + per-note line-item
 *                                    breakdown for the period.
 *   POST   /api/servicer/remittances/generate
 *                                  — Run the monthly generator for a
 *                                    caller-supplied periodEnd.
 *   GET    /api/servicer/owners
 *                                  — Active owners-of-record across all
 *                                    serviced notes (rolled up by owner).
 *   POST   /api/servicer/owners    — Add a new ownership-of-record row.
 *   GET    /api/servicer/licenses  — Per-state licensing posture.
 *   POST   /api/servicer/licenses  — Add a license row.
 *
 * The 1099-INT-on-behalf-of-owner and Reg AB reporting endpoints are
 * deliberately not in this PR (state-by-state filing posture needs
 * counsel; Reg AB report is fund-administrator-grade work).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  acquiredNotes,
  notePayments,
  noteOwnershipOfRecord,
  servicerLicenses,
  servicerRemittances,
  NOTE_OWNER_OF_RECORD_TYPES,
  SERVICER_LICENSE_TYPES,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { generateMonthlyRemittances } from "./services/servicerRemittance";

const ownerTypeEnum = z.enum(NOTE_OWNER_OF_RECORD_TYPES);
const licenseTypeEnum = z.enum(SERVICER_LICENSE_TYPES);

const createOwnerSchema = z.object({
  noteId: z.string().min(1),
  ownerOrgId: z.number().int().positive(),
  ownerType: ownerTypeEnum,
  basisPercentage: z.number().min(0).max(100).optional(),
  effectiveAt: z.string().datetime().optional(),
});

const createLicenseSchema = z.object({
  state: z.string().length(2),
  licenseType: licenseTypeEnum,
  licenseNumber: z.string().max(120).optional(),
  expiresAt: z.string().min(1).optional(), // YYYY-MM-DD
  notes: z.string().max(2000).optional(),
});

const generateSchema = z.object({
  // ISO date — the last day of the month to generate (or any day in that
  // month; the service anchors to the calendar month).
  periodEnd: z.string().min(1),
});

const listQuerySchema = z.object({
  ownerOrgId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerServicerRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── List remittances ──────────────────────────────────────────────────
  app.get(
    "/api/servicer/remittances",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = listQuerySchema.safeParse(req.query);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const { ownerOrgId, limit, offset } = parsed.data;

        const whereClause = ownerOrgId
          ? and(
              eq(servicerRemittances.organizationId, orgId),
              eq(servicerRemittances.ownerOrgId, ownerOrgId),
            )
          : eq(servicerRemittances.organizationId, orgId);

        const rows = await db
          .select()
          .from(servicerRemittances)
          .where(whereClause)
          .orderBy(desc(servicerRemittances.periodEnd))
          .limit(limit)
          .offset(offset);

        const [countRow] = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(servicerRemittances)
          .where(whereClause);

        return res.json({
          remittances: rows,
          pagination: {
            limit,
            offset,
            total: Number(countRow?.count ?? 0),
          },
        });
      } catch (err) {
        logger.error("servicer.remittances.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Detail with per-note line-items ───────────────────────────────────
  app.get(
    "/api/servicer/remittances/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .select()
          .from(servicerRemittances)
          .where(
            and(
              eq(servicerRemittances.id, req.params.id),
              eq(servicerRemittances.organizationId, orgId),
            ),
          )
          .limit(1);
        if (!row) return Errors.notFound(res, "Remittance");

        // Pull all notes this owner held with us during the period.
        const ownerships = await db
          .select({
            noteId: noteOwnershipOfRecord.noteId,
            basisPercentage: noteOwnershipOfRecord.basisPercentage,
            noteNumber: acquiredNotes.noteNumber,
            payerName: acquiredNotes.payerName,
          })
          .from(noteOwnershipOfRecord)
          .innerJoin(acquiredNotes, eq(acquiredNotes.id, noteOwnershipOfRecord.noteId))
          .where(
            and(
              eq(noteOwnershipOfRecord.organizationId, orgId),
              eq(noteOwnershipOfRecord.ownerOrgId, row.ownerOrgId),
              isNull(noteOwnershipOfRecord.supersededAt),
            ),
          );

        // Aggregate per-note line items inside the remittance period.
        const lineItems = await Promise.all(
          ownerships.map(async (ow) => {
            const [agg] = await db
              .select({
                grossCents: sql<number>`COALESCE(SUM(
                  COALESCE(${notePayments.principalCents}, 0)
                  + COALESCE(${notePayments.interestCents}, 0)
                  + COALESCE(${notePayments.escrowCents}, 0)
                  + COALESCE(${notePayments.lateFeeCents}, 0)
                ), 0)`,
                principalCents: sql<number>`COALESCE(SUM(COALESCE(${notePayments.principalCents}, 0)), 0)`,
                interestCents: sql<number>`COALESCE(SUM(COALESCE(${notePayments.interestCents}, 0)), 0)`,
              })
              .from(notePayments)
              .where(
                and(
                  eq(notePayments.organizationId, orgId),
                  eq(notePayments.noteId, ow.noteId),
                  sql`${notePayments.paymentDate} >= ${row.periodStart}`,
                  sql`${notePayments.paymentDate} <= ${row.periodEnd}`,
                ),
              );

            const basisPct = Number(ow.basisPercentage ?? "100");
            const ownerShareCents = Math.round((Number(agg?.grossCents ?? 0) * basisPct) / 100);
            return {
              noteId: ow.noteId,
              noteNumber: ow.noteNumber,
              payerName: ow.payerName,
              basisPercentage: basisPct,
              grossCents: Number(agg?.grossCents ?? 0),
              principalCents: Number(agg?.principalCents ?? 0),
              interestCents: Number(agg?.interestCents ?? 0),
              ownerShareCents,
            };
          }),
        );

        return res.json({ remittance: row, lineItems });
      } catch (err) {
        logger.error("servicer.remittances.detail failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Generate monthly remittances ──────────────────────────────────────
  app.post(
    "/api/servicer/remittances/generate",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = generateSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const periodEnd = new Date(parsed.data.periodEnd);
        if (Number.isNaN(periodEnd.getTime())) {
          return Errors.badRequest(res, "Invalid periodEnd date");
        }

        const result = await generateMonthlyRemittances(orgId, periodEnd);
        return res.status(201).json(result);
      } catch (err) {
        logger.error("servicer.remittances.generate failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Owners of record ──────────────────────────────────────────────────
  app.get(
    "/api/servicer/owners",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rows = await db
          .select({
            id: noteOwnershipOfRecord.id,
            noteId: noteOwnershipOfRecord.noteId,
            noteNumber: acquiredNotes.noteNumber,
            ownerOrgId: noteOwnershipOfRecord.ownerOrgId,
            ownerType: noteOwnershipOfRecord.ownerType,
            basisPercentage: noteOwnershipOfRecord.basisPercentage,
            effectiveAt: noteOwnershipOfRecord.effectiveAt,
            supersededAt: noteOwnershipOfRecord.supersededAt,
          })
          .from(noteOwnershipOfRecord)
          .innerJoin(acquiredNotes, eq(acquiredNotes.id, noteOwnershipOfRecord.noteId))
          .where(
            and(
              eq(noteOwnershipOfRecord.organizationId, orgId),
              isNull(noteOwnershipOfRecord.supersededAt),
            ),
          )
          .orderBy(desc(noteOwnershipOfRecord.effectiveAt));

        return res.json({ owners: rows });
      } catch (err) {
        logger.error("servicer.owners.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/servicer/owners",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createOwnerSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;

        // Confirm the note exists and belongs to this servicer.
        const [note] = await db
          .select({ id: acquiredNotes.id })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, data.noteId), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        const [row] = await db
          .insert(noteOwnershipOfRecord)
          .values({
            organizationId: orgId,
            noteId: data.noteId,
            ownerOrgId: data.ownerOrgId,
            ownerType: data.ownerType,
            basisPercentage:
              data.basisPercentage !== undefined ? data.basisPercentage.toFixed(2) : "100.00",
            effectiveAt: data.effectiveAt ? new Date(data.effectiveAt) : new Date(),
          })
          .returning();

        return res.status(201).json({ owner: row });
      } catch (err) {
        logger.error("servicer.owners.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Licenses ──────────────────────────────────────────────────────────
  app.get(
    "/api/servicer/licenses",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rows = await db
          .select()
          .from(servicerLicenses)
          .where(eq(servicerLicenses.organizationId, orgId))
          .orderBy(servicerLicenses.state);
        return res.json({ licenses: rows });
      } catch (err) {
        logger.error("servicer.licenses.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/servicer/licenses",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createLicenseSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;

        const [row] = await db
          .insert(servicerLicenses)
          .values({
            organizationId: orgId,
            state: data.state.toUpperCase(),
            licenseType: data.licenseType,
            licenseNumber: data.licenseNumber,
            expiresAt: data.expiresAt,
            notes: data.notes,
          })
          .onConflictDoUpdate({
            target: [
              servicerLicenses.organizationId,
              servicerLicenses.state,
              servicerLicenses.licenseType,
            ],
            set: {
              licenseNumber: data.licenseNumber,
              expiresAt: data.expiresAt,
              notes: data.notes,
              updatedAt: new Date(),
            },
          })
          .returning();

        return res.status(201).json({ license: row });
      } catch (err) {
        logger.error("servicer.licenses.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
