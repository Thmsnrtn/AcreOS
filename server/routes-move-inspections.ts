/**
 * Buy-and-hold vertical BH-4 — move-in / move-out inspections.
 *
 * Imelda §8.1: "Lowest effort, highest visible value. The infra exists.
 * Add a 'tenant signature' step (use the existing HMAC signing) and an
 * attachment to a property record. Even without a tenant entity, this is
 * shippable in 2 weeks and gives every landlord a reason to keep the app
 * on their phone. Wedge feature."
 *
 * GET    /api/properties/:id/inspections     — list per property
 * GET    /api/inspections/:id                — single
 * POST   /api/properties/:id/inspections     — create
 * PATCH  /api/inspections/:id                — update (checklist + photos)
 * POST   /api/inspections/:id/sign-tenant    — record tenant signature
 * POST   /api/inspections/:id/sign-landlord  — record landlord signature
 * POST   /api/inspections/:id/reconcile-deposit — apply damages to deposit
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  moveInspections,
  securityDeposits,
  rentalLeases,
  properties,
  INSPECTION_KINDS,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const checklistItemSchema = z.object({
  area: z.string(),
  condition: z.enum(["excellent", "good", "fair", "damaged"]),
  notes: z.string().optional(),
  photoCount: z.number().int().nonnegative().optional(),
});

const photoSchema = z.object({
  url: z.string(),
  caption: z.string().optional(),
  area: z.string().optional(),
  timestamp: z.string().optional(),
});

const inspectionSchema = z.object({
  kind: z.enum(INSPECTION_KINDS),
  inspectionDate: z.string(),
  conductedBy: z.string().optional(),
  leaseId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  checklist: z.array(checklistItemSchema).default([]),
  photos: z.array(photoSchema).default([]),
  notes: z.string().optional(),
});

const updateSchema = inspectionSchema.partial();

const reconcileSchema = z.object({
  deductions: z.array(z.object({
    description: z.string(),
    amountCents: z.coerce.number().int().nonnegative(),
    category: z.string().optional(),
  })),
});

export function registerMoveInspectionRoutes(app: Express): void {
  app.get("/api/properties/:id/inspections", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const propId = parseInt(req.params.id, 10);
      const rows = await db.select().from(moveInspections)
        .where(and(eq(moveInspections.propertyId, propId), eq(moveInspections.organizationId, orgId)))
        .orderBy(desc(moveInspections.inspectionDate));
      return res.json({ inspections: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/inspections/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [row] = await db.select().from(moveInspections)
        .where(and(eq(moveInspections.id, req.params.id), eq(moveInspections.organizationId, orgId)));
      if (!row) return Errors.notFound(res, "Inspection");
      return res.json({ inspection: row });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/properties/:id/inspections", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const propId = parseInt(req.params.id, 10);
      const parsed = inspectionSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db.select({ id: properties.id }).from(properties)
        .where(and(eq(properties.id, propId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Property");

      const [created] = await db.insert(moveInspections).values({
        organizationId: orgId,
        propertyId: propId,
        leaseId: parsed.data.leaseId ?? null,
        tenantId: parsed.data.tenantId ?? null,
        kind: parsed.data.kind,
        inspectionDate: parsed.data.inspectionDate,
        conductedBy: parsed.data.conductedBy ?? userId,
        checklist: parsed.data.checklist,
        photos: parsed.data.photos,
        notes: parsed.data.notes ?? null,
      }).returning();

      logger.info("[BH-4] inspection created", { orgId, userId, inspectionId: created.id, kind: parsed.data.kind });
      return res.status(201).json({ inspection: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/inspections/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      const [updated] = await db.update(moveInspections).set(updates)
        .where(and(eq(moveInspections.id, req.params.id), eq(moveInspections.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Inspection");
      return res.json({ inspection: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/inspections/:id/sign-tenant", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [updated] = await db.update(moveInspections)
        .set({ tenantSignedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(moveInspections.id, req.params.id), eq(moveInspections.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Inspection");
      return res.json({ inspection: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/inspections/:id/sign-landlord", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [updated] = await db.update(moveInspections)
        .set({ landlordSignedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(moveInspections.id, req.params.id), eq(moveInspections.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Inspection");
      return res.json({ inspection: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Reconcile a move-out inspection against the lease's security deposit.
  app.post("/api/inspections/:id/reconcile-deposit", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = reconcileSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [insp] = await db.select().from(moveInspections)
        .where(and(eq(moveInspections.id, req.params.id), eq(moveInspections.organizationId, orgId)));
      if (!insp) return Errors.notFound(res, "Inspection");
      if (insp.kind !== "move_out") return Errors.badRequest(res, "Only move-out inspections can reconcile deposits");
      if (!insp.leaseId) return Errors.badRequest(res, "Inspection is not linked to a lease");

      const [deposit] = await db.select().from(securityDeposits)
        .where(and(eq(securityDeposits.leaseId, insp.leaseId), eq(securityDeposits.organizationId, orgId)));
      if (!deposit) return Errors.notFound(res, "Security deposit (initialize the deposit on the lease first)");

      const totalDeductions = parsed.data.deductions.reduce((s, d) => s + d.amountCents, 0);
      const refundCents = Math.max(0, deposit.heldCents - totalDeductions);

      const [updatedDeposit] = await db.update(securityDeposits).set({
        moveOutInspectionId: insp.id,
        deductions: parsed.data.deductions,
        deductionsTotalCents: totalDeductions,
        refundCents,
        updatedAt: new Date(),
      }).where(eq(securityDeposits.id, deposit.id)).returning();

      // Stamp the inspection with damages total.
      await db.update(moveInspections).set({
        damagesTotalCents: totalDeductions,
        updatedAt: new Date(),
      }).where(eq(moveInspections.id, insp.id));

      logger.info("[BH-4] deposit reconciled", { orgId, userId, inspectionId: insp.id, totalDeductions, refundCents });
      return res.json({ deposit: updatedDeposit, refundCents, totalDeductions });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
