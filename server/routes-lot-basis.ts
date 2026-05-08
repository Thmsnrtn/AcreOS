/**
 * Subdivider vertical SD-4 — cost-basis allocation engine.
 *
 * Brigid §3.3: "Cost-basis allocation — when I add a child lot, the parent's
 * basis distributes by acreage (default) or by my override percentages. The
 * IRS lets me use either reasonable method; my CPA picks acreage-weighted
 * with a road-impact adjustment. This is a tax-time requirement; my CPA
 * needs basis-per-lot for every closing or I get a phone call I don't want
 * at 11pm in March."
 *
 * Brigid §4 (depreciation surface friction): "Lots held as inventory aren't
 * depreciated; they're cost-of-goods-sold when sold. […] the tax treatment
 * is COGS-and-inventory, not depreciation-and-basis-recovery."
 *
 * Routes:
 *   POST  /api/parcels/:id/basis-allocation     — (re)compute allocations
 *   GET   /api/parcels/:id/basis-allocation     — read current allocations
 *   POST  /api/lots/:childId/realize-cogs       — record COGS at sale
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, sql, asc } from "drizzle-orm";
import { db } from "./db";
import {
  lotBasisAllocations,
  properties,
  BASIS_ALLOCATION_METHODS,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const allocateSchema = z.object({
  method: z.enum(BASIS_ALLOCATION_METHODS),
  // For 'override' method: explicit per-child shares, must sum to ~1.0.
  overrides: z.record(z.string(), z.coerce.number().min(0).max(1)).optional(),
  // For 'frontage' method: explicit frontage feet per child (operator-typed).
  frontages: z.record(z.string(), z.coerce.number().nonnegative()).optional(),
  // For 'appraisal' method: explicit appraisal value per child.
  appraisals: z.record(z.string(), z.coerce.number().nonnegative()).optional(),
});

const realizeCogsSchema = z.object({
  salePriceCents: z.coerce.number().int().nonnegative(),
  closingDate: z.string().optional(),  // ISO date
});

export function registerLotBasisRoutes(app: Express): void {
  // GET allocations for a parent parcel.
  app.get(
    "/api/parcels/:id/basis-allocation",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const allocs = await db
          .select()
          .from(lotBasisAllocations)
          .where(and(
            eq(lotBasisAllocations.organizationId, orgId),
            eq(lotBasisAllocations.parentParcelId, parentId),
          ))
          .orderBy(asc(lotBasisAllocations.childParcelId));

        return res.json({ allocations: allocs });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST — compute or recompute allocations for the parent.
  app.post(
    "/api/parcels/:id/basis-allocation",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const parsed = allocateSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

        const [parent] = await db
          .select()
          .from(properties)
          .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
        if (!parent) return Errors.notFound(res, "Parent parcel");

        const parentBasisCents = parent.purchasePrice
          ? Math.round(parseFloat(parent.purchasePrice) * 100)
          : null;
        if (parentBasisCents === null) {
          return Errors.badRequest(res, "Parent parcel has no purchase_price; cannot allocate basis.");
        }

        const children = await db
          .select({
            id: properties.id,
            sizeAcres: properties.sizeAcres,
          })
          .from(properties)
          .where(and(
            eq(properties.parentParcelId, parentId),
            eq(properties.organizationId, orgId),
          ));
        if (children.length === 0) return Errors.badRequest(res, "Parent has no child lots to allocate to");

        // Build per-child numerator + denominator per method.
        const method = parsed.data.method;
        const childNumerators = new Map<number, number>();
        let denominator = 0;

        if (method === "acreage") {
          for (const c of children) {
            const a = parseFloat(c.sizeAcres ?? "0");
            childNumerators.set(c.id, Number.isFinite(a) ? a : 0);
            denominator += Number.isFinite(a) ? a : 0;
          }
        } else if (method === "frontage") {
          if (!parsed.data.frontages) return Errors.badRequest(res, "Frontage method requires per-child frontages");
          for (const c of children) {
            const f = parsed.data.frontages[String(c.id)] ?? 0;
            childNumerators.set(c.id, f);
            denominator += f;
          }
        } else if (method === "appraisal") {
          if (!parsed.data.appraisals) return Errors.badRequest(res, "Appraisal method requires per-child appraisals");
          for (const c of children) {
            const v = parsed.data.appraisals[String(c.id)] ?? 0;
            childNumerators.set(c.id, v);
            denominator += v;
          }
        } else if (method === "override") {
          if (!parsed.data.overrides) return Errors.badRequest(res, "Override method requires per-child shares");
          let sum = 0;
          for (const c of children) {
            const s = parsed.data.overrides[String(c.id)] ?? 0;
            childNumerators.set(c.id, s);
            sum += s;
          }
          if (Math.abs(sum - 1.0) > 0.001) {
            return Errors.badRequest(res, `Override shares must sum to 1.0; got ${sum.toFixed(4)}`);
          }
          denominator = 1.0;
        }

        if (denominator <= 0) {
          return Errors.badRequest(res, "Cannot allocate: total denominator is zero");
        }

        // Wipe + replace allocations atomically. (Sale realizations on the
        // old rows are intentionally lost on re-allocation — that's a
        // founder-judgment call, not mechanical: a re-allocation typically
        // happens before the first close.)
        await db.transaction(async (tx) => {
          await tx.delete(lotBasisAllocations).where(and(
            eq(lotBasisAllocations.organizationId, orgId),
            eq(lotBasisAllocations.parentParcelId, parentId),
          ));

          const inserts = children.map((c) => {
            const num = childNumerators.get(c.id) ?? 0;
            const share = num / denominator;
            const allocated = Math.round(parentBasisCents * share);
            return {
              organizationId: orgId,
              parentParcelId: parentId,
              childParcelId: c.id,
              method,
              denominator: String(denominator),
              numerator: String(num),
              sharePct: String(share),
              allocatedBasisCents: allocated,
              overrideShare: method === "override" ? String(num) : null,
            };
          });
          if (inserts.length > 0) {
            await tx.insert(lotBasisAllocations).values(inserts);
          }
        });

        logger.info("[SD-4] basis allocation computed", {
          orgId, userId, parentId, method, childCount: children.length, parentBasisCents,
        });

        const fresh = await db
          .select()
          .from(lotBasisAllocations)
          .where(and(
            eq(lotBasisAllocations.organizationId, orgId),
            eq(lotBasisAllocations.parentParcelId, parentId),
          ))
          .orderBy(asc(lotBasisAllocations.childParcelId));

        return res.status(201).json({ allocations: fresh });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // POST /api/lots/:childId/realize-cogs — record sale + COGS for tax-time.
  app.post(
    "/api/lots/:childId/realize-cogs",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const childId = parseInt(req.params.childId, 10);
        if (!Number.isFinite(childId)) return Errors.badRequest(res, "Invalid lot id");

        const parsed = realizeCogsSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

        const [alloc] = await db
          .select()
          .from(lotBasisAllocations)
          .where(and(
            eq(lotBasisAllocations.childParcelId, childId),
            eq(lotBasisAllocations.organizationId, orgId),
          ));
        if (!alloc) return Errors.notFound(res, "Basis allocation for this lot (run /basis-allocation first)");

        const [updated] = await db
          .update(lotBasisAllocations)
          .set({
            realizedAt: new Date(),
            realizedSalePriceCents: parsed.data.salePriceCents,
            realizedCogsCents: alloc.allocatedBasisCents,
            updatedAt: new Date(),
          })
          .where(eq(lotBasisAllocations.id, alloc.id))
          .returning();

        // Also flip the property to sold.
        await db.update(properties).set({
          status: "sold",
          soldPrice: String(parsed.data.salePriceCents / 100),
          soldDate: parsed.data.closingDate ? new Date(parsed.data.closingDate) : new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(properties.id, childId),
          eq(properties.organizationId, orgId),
        ));

        logger.info("[SD-4] COGS realized", {
          orgId, userId, childId,
          salePriceCents: parsed.data.salePriceCents,
          cogsCents: alloc.allocatedBasisCents,
          gainCents: parsed.data.salePriceCents - alloc.allocatedBasisCents,
        });

        return res.json({ allocation: updated });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
