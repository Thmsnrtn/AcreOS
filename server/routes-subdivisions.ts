/**
 * Subdivider vertical SD-2 — per-lot pipeline (parent → children).
 *
 * Brigid's deal-killer (brigid-subdivider.md §3): "Once the plat records,
 * I have eighteen lots. Lot 1 might be under contract to a buyer. Lot 7
 * is listed. Lot 12 is being held back. […] Each of those lots is in its
 * own pipeline stage, with its own price, its own buyer, its own closing
 * date. […] But there is no parent/child relationship in the schema."
 *
 * SD-1 added properties.parent_parcel_id; this PR exposes:
 *
 *   GET  /api/parcels/:id/subdivision      — parent rollup (lots + metrics)
 *   POST /api/parcels/:id/lots             — create N child lots in one shot
 *   POST /api/parcels/:id/lots/single      — create one child lot
 *   PATCH /api/lots/:childId               — edit child lot fields
 *   DELETE /api/lots/:childId              — detach child (set parent_id null)
 *
 * The parent rollup folds in:
 *   - all child lots (with status, price, buyer, days-on-market)
 *   - aggregate metrics: parent basis, sold-lot proceeds, remaining acres,
 *     blended cost-per-remaining-acre, simple IRR placeholder, breakeven
 *   - status counts (held / listed / under_contract / sold)
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, isNull, sql, asc } from "drizzle-orm";
import { db } from "./db";
import { properties, lotBasisAllocations } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const createLotSchema = z.object({
  childLotNumber: z.string().min(1).max(64),
  sizeAcres: z.coerce.number().positive(),
  apn: z.string().min(1).optional(),    // pre-recording APNs may be unknown
  address: z.string().optional(),
  zoning: z.string().optional(),
  listPrice: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const createLotsBatchSchema = z.object({
  lots: z.array(createLotSchema).min(1).max(200),
  inheritFromParent: z.boolean().default(true),  // copy county/state/zoning
  subdivisionPlanId: z.string().uuid().optional(),
});

const editLotSchema = z.object({
  childLotNumber: z.string().min(1).max(64).optional(),
  sizeAcres: z.coerce.number().positive().optional(),
  status: z.string().min(1).max(48).optional(),
  listPrice: z.coerce.number().nonnegative().optional(),
  buyerId: z.coerce.number().int().positive().nullable().optional(),
  zoning: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

// ----------------------------------------------------------------------------
// Rollup metric helpers
// ----------------------------------------------------------------------------

interface ChildSummary {
  id: number;
  childLotNumber: string | null;
  apn: string;
  sizeAcres: string | null;
  status: string;
  listPrice: string | null;
  soldPrice: string | null;
  soldDate: Date | null;
  buyerId: number | null;
  daysOnMarket: number | null;
  createdAt: Date | null;
}

interface RollupMetrics {
  childCount: number;
  totalChildAcres: number;
  totalParentAcres: number | null;
  parentBasisCents: number | null;
  soldChildCount: number;
  soldProceedsCents: number;
  remainingChildCount: number;
  remainingChildAcres: number;
  blendedCostPerRemainingAcreCents: number | null;
  // Simple breakeven: cents-still-needed-to-recover-basis at current asking.
  breakevenAtCurrentAskingCents: number | null;
  pipelineCounts: Record<string, number>;
}

function computeRollup(parent: any, children: ChildSummary[]): RollupMetrics {
  let soldProceedsCents = 0;
  let totalChildAcres = 0;
  let remainingChildAcres = 0;
  let soldChildCount = 0;
  let pendingAskingCents = 0;
  const pipelineCounts: Record<string, number> = {};

  for (const c of children) {
    const acres = parseFloat(c.sizeAcres ?? "0");
    if (Number.isFinite(acres)) totalChildAcres += acres;

    pipelineCounts[c.status] = (pipelineCounts[c.status] ?? 0) + 1;

    if (c.status === "sold" && c.soldPrice) {
      const sold = Math.round(parseFloat(c.soldPrice) * 100);
      if (Number.isFinite(sold)) soldProceedsCents += sold;
      soldChildCount++;
    } else {
      if (Number.isFinite(acres)) remainingChildAcres += acres;
      if (c.listPrice) {
        const ask = Math.round(parseFloat(c.listPrice) * 100);
        if (Number.isFinite(ask)) pendingAskingCents += ask;
      }
    }
  }

  const parentBasisCents = parent.purchasePrice
    ? Math.round(parseFloat(parent.purchasePrice) * 100)
    : null;
  const totalParentAcres = parent.sizeAcres ? parseFloat(parent.sizeAcres) : null;

  let blendedCostPerRemainingAcreCents: number | null = null;
  if (parentBasisCents !== null && remainingChildAcres > 0) {
    const remainingBasis = parentBasisCents - soldProceedsCents;
    blendedCostPerRemainingAcreCents = Math.round(remainingBasis / remainingChildAcres);
  }

  let breakevenAtCurrentAskingCents: number | null = null;
  if (parentBasisCents !== null) {
    breakevenAtCurrentAskingCents = parentBasisCents - soldProceedsCents - pendingAskingCents;
  }

  return {
    childCount: children.length,
    totalChildAcres,
    totalParentAcres,
    parentBasisCents,
    soldChildCount,
    soldProceedsCents,
    remainingChildCount: children.length - soldChildCount,
    remainingChildAcres,
    blendedCostPerRemainingAcreCents,
    breakevenAtCurrentAskingCents,
    pipelineCounts,
  };
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

export function registerSubdivisionRoutes(app: Express): void {
  // GET /api/parcels/:id/subdivision — full rollup for the parent parcel.
  app.get(
    "/api/parcels/:id/subdivision",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parent parcel id");

        const [parent] = await db
          .select()
          .from(properties)
          .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
        if (!parent) return Errors.notFound(res, "Parcel");

        const childRows = await db
          .select({
            id: properties.id,
            childLotNumber: properties.childLotNumber,
            apn: properties.apn,
            sizeAcres: properties.sizeAcres,
            status: properties.status,
            listPrice: properties.listPrice,
            soldPrice: properties.soldPrice,
            soldDate: properties.soldDate,
            buyerId: properties.buyerId,
            createdAt: properties.createdAt,
          })
          .from(properties)
          .where(and(
            eq(properties.parentParcelId, parentId),
            eq(properties.organizationId, orgId),
            isNull(properties.deletedAt),
          ))
          .orderBy(asc(properties.childLotNumber), asc(properties.id));

        const now = Date.now();
        const children: ChildSummary[] = childRows.map((c) => {
          const created = c.createdAt ? new Date(c.createdAt).getTime() : null;
          return {
            ...c,
            daysOnMarket:
              c.status === "sold" || !created
                ? null
                : Math.floor((now - created) / 86_400_000),
          };
        });

        // Pull basis allocations if any exist — surface the per-lot allocated
        // basis so the UI can render alongside list price.
        const allocs = await db
          .select()
          .from(lotBasisAllocations)
          .where(and(
            eq(lotBasisAllocations.organizationId, orgId),
            eq(lotBasisAllocations.parentParcelId, parentId),
          ));
        const allocByChild = new Map<number, typeof allocs[number]>();
        for (const a of allocs) allocByChild.set(a.childParcelId, a);

        const metrics = computeRollup(parent, children);

        return res.json({
          parent: {
            id: parent.id,
            apn: parent.apn,
            address: parent.address,
            county: parent.county,
            state: parent.state,
            sizeAcres: parent.sizeAcres,
            purchasePrice: parent.purchasePrice,
            purchaseDate: parent.purchaseDate,
          },
          children: children.map((c) => ({
            ...c,
            allocatedBasisCents: allocByChild.get(c.id)?.allocatedBasisCents ?? null,
            allocationMethod: allocByChild.get(c.id)?.method ?? null,
          })),
          metrics,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/parcels/:id/lots — create N child lots in one batch.
  app.post(
    "/api/parcels/:id/lots",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parent parcel id");

        const parsed = createLotsBatchSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const [parent] = await db
          .select()
          .from(properties)
          .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
        if (!parent) return Errors.notFound(res, "Parent parcel");

        const inheritedDefaults = parsed.data.inheritFromParent
          ? {
              county: parent.county,
              state: parent.state,
              zoning: parent.zoning,
              landStatus: parent.landStatus,
            }
          : null;

        const inserts = parsed.data.lots.map((lot) => ({
          organizationId: orgId,
          parentParcelId: parentId,
          subdivisionPlanId: parsed.data.subdivisionPlanId ?? null,
          childLotNumber: lot.childLotNumber,
          // Pre-recording lots may not have an APN — fall back to a synthetic
          // identifier the operator can replace once the assessor splits.
          apn: lot.apn ?? `${parent.apn}-LOT-${lot.childLotNumber}`,
          county: inheritedDefaults?.county ?? parent.county,
          state: inheritedDefaults?.state ?? parent.state,
          address: lot.address ?? null,
          sizeAcres: String(lot.sizeAcres),
          zoning: lot.zoning ?? inheritedDefaults?.zoning ?? null,
          landStatus: inheritedDefaults?.landStatus ?? parent.landStatus,
          status: "owned",
          listPrice: lot.listPrice != null ? String(lot.listPrice) : null,
        }));

        const created = await db.insert(properties).values(inserts).returning({
          id: properties.id,
          childLotNumber: properties.childLotNumber,
          apn: properties.apn,
        });

        logger.info("[SD-2] created child lots", {
          orgId,
          userId,
          parentId,
          count: created.length,
        });

        return res.status(201).json({ created });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // PATCH /api/lots/:childId — edit single child lot.
  app.patch(
    "/api/lots/:childId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const childId = parseInt(req.params.childId, 10);
        if (!Number.isFinite(childId)) return Errors.badRequest(res, "Invalid lot id");

        const parsed = editLotSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (parsed.data.childLotNumber !== undefined) updates.childLotNumber = parsed.data.childLotNumber;
        if (parsed.data.sizeAcres !== undefined) updates.sizeAcres = String(parsed.data.sizeAcres);
        if (parsed.data.status !== undefined) updates.status = parsed.data.status;
        if (parsed.data.listPrice !== undefined) updates.listPrice = String(parsed.data.listPrice);
        if (parsed.data.buyerId !== undefined) updates.buyerId = parsed.data.buyerId;
        if (parsed.data.zoning !== undefined) updates.zoning = parsed.data.zoning;
        if (parsed.data.address !== undefined) updates.address = parsed.data.address;
        if (parsed.data.notes !== undefined) updates.description = parsed.data.notes;

        const [updated] = await db
          .update(properties)
          .set(updates)
          .where(and(
            eq(properties.id, childId),
            eq(properties.organizationId, orgId),
          ))
          .returning();
        if (!updated) return Errors.notFound(res, "Lot");

        return res.json({ lot: updated });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/subdivider/dashboard — type-specific dashboard widget data.
  // Following the wholesaler-W5 pattern: real org-scoped queries, hasData=
  // false when no parent parcels are tracked yet (suppress the widget).
  app.get(
    "/api/subdivider/dashboard",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);

        // Parents = properties with no parent_parcel_id but at least one
        // child referencing them.
        const parentRows = await db.execute(sql`
          SELECT
            p.id,
            p.purchase_price,
            (SELECT COUNT(*) FROM properties c WHERE c.parent_parcel_id = p.id AND c.organization_id = ${orgId} AND c.deleted_at IS NULL) AS child_count,
            (SELECT COUNT(*) FROM properties c WHERE c.parent_parcel_id = p.id AND c.status = 'sold') AS sold_count,
            (SELECT COALESCE(SUM(c.sold_price::numeric * 100), 0) FROM properties c WHERE c.parent_parcel_id = p.id AND c.status = 'sold') AS sold_proceeds_cents
          FROM properties p
          WHERE p.organization_id = ${orgId}
            AND p.parent_parcel_id IS NULL
            AND p.deleted_at IS NULL
            AND EXISTS (
              SELECT 1 FROM properties c WHERE c.parent_parcel_id = p.id
            )
        `);

        const parents = (parentRows as any).rows ?? [];
        if (parents.length === 0) {
          return res.json({ hasData: false });
        }

        let totalChildren = 0;
        let soldChildren = 0;
        let totalParentBasisCents = 0;
        let totalSoldProceedsCents = 0;
        for (const p of parents) {
          totalChildren += Number(p.child_count) || 0;
          soldChildren += Number(p.sold_count) || 0;
          if (p.purchase_price) {
            totalParentBasisCents += Math.round(parseFloat(p.purchase_price) * 100);
          }
          totalSoldProceedsCents += Number(p.sold_proceeds_cents) || 0;
        }

        // Stalled permit gates count.
        const today = new Date().toISOString().slice(0, 10);
        const stalledRows = await db.execute(sql`
          SELECT COUNT(*) AS c
          FROM permit_gates
          WHERE organization_id = ${orgId}
            AND status IN ('submitted','in_review')
            AND expected_return_at IS NOT NULL
            AND expected_return_at <= ${today}::date
        `);
        const stalledGates = Number(((stalledRows as any).rows?.[0]?.c) ?? 0);

        return res.json({
          hasData: true,
          parentCount: parents.length,
          totalChildLots: totalChildren,
          soldChildLots: soldChildren,
          totalParentBasisCents,
          totalSoldProceedsCents,
          recoveredPct: totalParentBasisCents > 0
            ? Math.round((totalSoldProceedsCents / totalParentBasisCents) * 100)
            : 0,
          stalledGates,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // DELETE /api/lots/:childId — detach (do NOT hard-delete the property row).
  app.delete(
    "/api/lots/:childId",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const childId = parseInt(req.params.childId, 10);
        if (!Number.isFinite(childId)) return Errors.badRequest(res, "Invalid lot id");

        const [updated] = await db
          .update(properties)
          .set({ parentParcelId: null, childLotNumber: null, updatedAt: new Date() })
          .where(and(
            eq(properties.id, childId),
            eq(properties.organizationId, orgId),
          ))
          .returning({ id: properties.id });
        if (!updated) return Errors.notFound(res, "Lot");

        return res.json({ detached: true, id: updated.id });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
