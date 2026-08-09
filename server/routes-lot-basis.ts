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
 *   GET   /api/lots/economics-summary           — org-level lot-economics roll-up
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, sql, asc } from "drizzle-orm";
import { db } from "./db";
import {
  lotBasisAllocations,
  lotPricingRules,
  countySubdivisionTimelines,
  properties,
  subdivisionPlans,
  BASIS_ALLOCATION_METHODS,
} from "@shared/schema";
import {
  allocateBasis,
  realizeCogs,
  type BasisAllocationChild,
} from "@shared/subdivision/basisAllocation";
import { projectCarryCost } from "@shared/subdivision/carryCost";
import { computeProForma, type ProFormaLockedGridRow } from "@shared/subdivision/proForma";
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

// Carry inputs for the pro-forma arrive as optional query params (this is a
// GET). Without a monthly holding cost the carry line refuses rather than
// project a $0 carry — never an assumed number.
const proFormaQuerySchema = z.object({
  holdingCostMonthlyCents: z.coerce.number().int().nonnegative().optional(),
  debtPrincipalCents: z.coerce.number().int().nonnegative().optional(),
  debtRateBps: z.coerce.number().int().nonnegative().optional(),
  opportunityCostBps: z.coerce.number().int().nonnegative().optional(),
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
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

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

        // Resolve each child's numerator for the chosen method (the request-shape
        // guards — a method needs its per-child map — stay here; the allocation
        // math + its refusals live in the pure engine).
        const method = parsed.data.method;
        let allocChildren: BasisAllocationChild[];
        if (method === "acreage") {
          allocChildren = children.map((c) => {
            const a = parseFloat(c.sizeAcres ?? "0");
            return { id: c.id, numerator: Number.isFinite(a) ? a : 0 };
          });
        } else if (method === "frontage") {
          if (!parsed.data.frontages) return Errors.badRequest(res, "Frontage method requires per-child frontages");
          const frontages = parsed.data.frontages;
          allocChildren = children.map((c) => ({ id: c.id, numerator: frontages[String(c.id)] ?? 0 }));
        } else if (method === "appraisal") {
          if (!parsed.data.appraisals) return Errors.badRequest(res, "Appraisal method requires per-child appraisals");
          const appraisals = parsed.data.appraisals;
          allocChildren = children.map((c) => ({ id: c.id, numerator: appraisals[String(c.id)] ?? 0 }));
        } else {
          if (!parsed.data.overrides) return Errors.badRequest(res, "Override method requires per-child shares");
          const overrides = parsed.data.overrides;
          allocChildren = children.map((c) => ({ id: c.id, numerator: overrides[String(c.id)] ?? 0 }));
        }

        // Delegate the split (denominator, cent-conserving allocation, refusals)
        // to the pure engine. A refusal is a 400 carrying the engine's reason.
        const allocation = allocateBasis({ parentBasisCents, method, children: allocChildren });
        if (allocation.refusedReason || !allocation.allocations) {
          return Errors.badRequest(res, allocation.refusedReason ?? "Cannot allocate basis");
        }
        const allocations = allocation.allocations;

        // Wipe + replace allocations atomically. (Sale realizations on the
        // old rows are intentionally lost on re-allocation — that's a
        // founder-judgment call, not mechanical: a re-allocation typically
        // happens before the first close.)
        await db.transaction(async (tx) => {
          await tx.delete(lotBasisAllocations).where(and(
            eq(lotBasisAllocations.organizationId, orgId),
            eq(lotBasisAllocations.parentParcelId, parentId),
          ));

          const inserts = allocations.map((a) => ({
            organizationId: orgId,
            parentParcelId: parentId,
            childParcelId: a.childId,
            method,
            denominator: String(a.denominator),
            numerator: String(a.numerator),
            sharePct: String(a.sharePct),
            allocatedBasisCents: a.allocatedBasisCents,
            overrideShare: method === "override" ? String(a.numerator) : null,
          }));
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
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

        const [alloc] = await db
          .select()
          .from(lotBasisAllocations)
          .where(and(
            eq(lotBasisAllocations.childParcelId, childId),
            eq(lotBasisAllocations.organizationId, orgId),
          ));
        if (!alloc) return Errors.notFound(res, "Basis allocation for this lot (run /basis-allocation first)");

        // COGS = the lot's allocated basis (inventory, not depreciation); gain =
        // sale − COGS. The pure engine owns this so the tax-time identity is tested.
        const { cogsCents, gainCents } = realizeCogs({
          allocatedBasisCents: alloc.allocatedBasisCents,
          salePriceCents: parsed.data.salePriceCents,
        });

        const [updated] = await db
          .update(lotBasisAllocations)
          .set({
            realizedAt: new Date(),
            realizedSalePriceCents: parsed.data.salePriceCents,
            realizedCogsCents: cogsCents,
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
          cogsCents,
          gainCents,
        });

        return res.json({ allocation: updated });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Org-level lot-economics roll-up ───────────────────────────────────────
  // GET /api/lots/economics-summary — the Finance door's subdivider hero
  // (wave V2, founder ruling #11 2026-07-28). Real org-scoped aggregates
  // straight from subdivision_plans + lot_basis_allocations: plans on file,
  // lots with allocated basis, lots sold (realized), and basis allocated vs
  // sale proceeds where a closing was actually recorded. Customer-scoped —
  // same isAuthenticated + getOrCreateOrg chain as the rest of this file.
  // Single round-trip instead of computing client-side (mirrors the
  // tax-certificates dashboard/summary pattern).
  app.get(
    "/api/lots/economics-summary",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);

        const [{ plansCount = 0 } = {}] = await db
          .select({ plansCount: sql<number>`COUNT(*)::int` })
          .from(subdivisionPlans)
          .where(eq(subdivisionPlans.organizationId, orgId));

        const [agg = {
          lotsAllocated: 0,
          lotsSold: 0,
          basisAllocatedCents: 0,
          realizedSaleProceedsCents: 0,
          realizedCogsCents: 0,
        }] = await db
          .select({
            lotsAllocated: sql<number>`COUNT(*)::int`,
            lotsSold: sql<number>`COUNT(*) FILTER (WHERE ${lotBasisAllocations.realizedAt} IS NOT NULL)::int`,
            basisAllocatedCents: sql<number>`COALESCE(SUM(${lotBasisAllocations.allocatedBasisCents}), 0)::bigint`,
            realizedSaleProceedsCents: sql<number>`COALESCE(SUM(${lotBasisAllocations.realizedSalePriceCents}) FILTER (WHERE ${lotBasisAllocations.realizedAt} IS NOT NULL), 0)::bigint`,
            realizedCogsCents: sql<number>`COALESCE(SUM(${lotBasisAllocations.realizedCogsCents}) FILTER (WHERE ${lotBasisAllocations.realizedAt} IS NOT NULL), 0)::bigint`,
          })
          .from(lotBasisAllocations)
          .where(eq(lotBasisAllocations.organizationId, orgId));

        return res.json({
          plansCount: Number(plansCount),
          lotsAllocated: Number(agg.lotsAllocated),
          lotsSold: Number(agg.lotsSold),
          basisAllocatedCents: Number(agg.basisAllocatedCents),
          realizedSaleProceedsCents: Number(agg.realizedSaleProceedsCents),
          realizedCogsCents: Number(agg.realizedCogsCents),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── Project pro-forma (SD Stage 2) ─────────────────────────────────────────
  // GET /api/parcels/:id/pro-forma — the subdivider's T-12 analogue: parent
  // basis (COGS) + lot count + the LOCKED lot-pricing grid (gross proceeds) +
  // carry over the county timeline → net project margin (p50/p90). Everything is
  // read from REAL stored rows; the pure engine (@shared/subdivision/proForma)
  // REFUSES PER LINE on any missing input rather than assume a number. Carry
  // inputs (a monthly holding cost, optional debt/opportunity rates) arrive as
  // query params; without them the carry line — and the carry-inclusive margin —
  // is withheld, never fabricated. Org-scoped like the rest of this file.
  app.get(
    "/api/parcels/:id/pro-forma",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parentId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parentId)) return Errors.badRequest(res, "Invalid parcel id");

        const parsedQuery = proFormaQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) return Errors.validationFailed(res, parsedQuery.error.issues);
        const q = parsedQuery.data;

        // Parent parcel — org-scoped. Its purchase price is the project basis/COGS.
        const [parent] = await db
          .select({
            id: properties.id,
            purchasePrice: properties.purchasePrice,
            county: properties.county,
            state: properties.state,
          })
          .from(properties)
          .where(and(eq(properties.id, parentId), eq(properties.organizationId, orgId)));
        if (!parent) return Errors.notFound(res, "Parcel");

        const parentPurchasePriceCents = parent.purchasePrice
          ? Math.round(parseFloat(parent.purchasePrice) * 100)
          : null;

        // Lot count — org-scoped children of this parent.
        const [{ lotCount = 0 } = {}] = await db
          .select({ lotCount: sql<number>`COUNT(*)::int` })
          .from(properties)
          .where(and(
            eq(properties.organizationId, orgId),
            eq(properties.parentParcelId, parentId),
          ));

        // The LOCKED pricing grid — org+parent scoped. Null until the operator locks.
        const [pricingRow] = await db
          .select({ lockedGrid: lotPricingRules.lockedGrid })
          .from(lotPricingRules)
          .where(and(
            eq(lotPricingRules.organizationId, orgId),
            eq(lotPricingRules.parentParcelId, parentId),
          ));
        const lockedGrid: ProFormaLockedGridRow[] | null = pricingRow?.lockedGrid
          ? pricingRow.lockedGrid.map((r) => ({
              childParcelId: r.childParcelId,
              askingPriceCents: r.askingPriceCents,
            }))
          : null;

        // County subdivision timeline — reference data keyed by (state, county),
        // not org-scoped (same as the carry-cost route).
        const [tl] = await db
          .select()
          .from(countySubdivisionTimelines)
          .where(and(
            eq(countySubdivisionTimelines.state, (parent.state ?? "").toUpperCase()),
            eq(countySubdivisionTimelines.countyName, parent.county),
          ));

        // Project carry only when a monthly holding cost was supplied; otherwise
        // the carry line refuses (no assumed carry). timelineFound still reflects
        // whether a timeline row exists at all.
        const carry =
          q.holdingCostMonthlyCents !== undefined
            ? projectCarryCost({
                p50TotalDays: tl?.p50TotalDays ?? null,
                p90TotalDays: tl?.p90TotalDays ?? null,
                inputs: {
                  holdingCostMonthlyCents: q.holdingCostMonthlyCents,
                  debtPrincipalCents: q.debtPrincipalCents ?? 0,
                  debtRateBps: q.debtRateBps ?? 0,
                  purchaseBasisCents: parentPurchasePriceCents ?? 0,
                  opportunityCostBps: q.opportunityCostBps ?? 0,
                },
              })
            : { timelineFound: !!tl, p50: null, p90: null };

        const proForma = computeProForma({
          parentPurchasePriceCents,
          lotCount: Number(lotCount),
          lockedGrid,
          carry,
        });

        return res.json({
          parcelId: parentId,
          county: parent.county,
          state: parent.state,
          timelineFound: !!tl,
          proForma,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
