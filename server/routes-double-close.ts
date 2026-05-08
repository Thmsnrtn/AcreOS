/**
 * Double-close deals (W-3) — A→B + B→C linked structure.
 *
 * Trey: "I have to buy at 9 AM and sell at 9:01 AM through a transactional
 * funder. AcreOS doesn't have a double-close flow."
 *
 * Endpoints:
 *   GET    /api/double-close                — list, optional status filter
 *   GET    /api/double-close/:id            — detail
 *   POST   /api/double-close                — create
 *   PATCH  /api/double-close/:id            — update fields / advance status
 *   DELETE /api/double-close/:id            — drop (rare)
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  doubleCloseDeals,
  DOUBLE_CLOSE_STATUSES,
  type DoubleCloseStatus,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const reasonEnum = z.enum([
  "state_restriction",
  "non_assignable_contract",
  "fha_financed",
  "operator_choice",
  "other",
]);

const createSchema = z.object({
  propertyId: z.number().int().positive().nullable().optional(),
  reason: reasonEnum.default("operator_choice"),
  aSellerName: z.string().min(1).max(240),
  aSidePurchasePriceCents: z.number().int().nonnegative(),
  aSideContractDate: z.string().optional(),
  aSideClosingDate: z.string().optional(),
  aSideTitleCompany: z.string().max(240).optional(),
  bcBuyerName: z.string().max(240).optional(),
  bcSidePurchasePriceCents: z.number().int().nonnegative().optional(),
  bcSideContractDate: z.string().optional(),
  bcSideClosingDate: z.string().optional(),
  bcSideTitleCompany: z.string().max(240).optional(),
  transactionalFunderName: z.string().max(240).optional(),
  transactionalFunderFeeCents: z.number().int().nonnegative().optional(),
  transactionalFunderRateBps: z.number().int().min(0).max(10_000).optional(),
  state: z.string().length(2).optional(),
  notes: z.string().max(8_000).optional(),
});
const patchSchema = createSchema.partial().extend({
  status: z.enum(DOUBLE_CLOSE_STATUSES).optional(),
});

export function registerDoubleCloseRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── List ──────────────────────────────────────────────────────────────────
  app.get(
    "/api/double-close",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        const conds = [eq(doubleCloseDeals.organizationId, orgId)];
        if (status && (DOUBLE_CLOSE_STATUSES as readonly string[]).includes(status)) {
          conds.push(eq(doubleCloseDeals.status, status as DoubleCloseStatus));
        }
        const rows = await db
          .select()
          .from(doubleCloseDeals)
          .where(and(...conds))
          .orderBy(asc(doubleCloseDeals.aSideClosingDate));
        return res.json({ deals: rows });
      } catch (err) {
        logger.error("doubleClose.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Detail ────────────────────────────────────────────────────────────────
  app.get(
    "/api/double-close/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .select()
          .from(doubleCloseDeals)
          .where(and(eq(doubleCloseDeals.id, req.params.id), eq(doubleCloseDeals.organizationId, orgId)))
          .limit(1);
        if (!row) return Errors.notFound(res, "Double-close deal");
        // Compute net to wholesaler (B-C price minus A-B price minus
        // funder fee). Returned as a derived field; not stored to keep
        // the row authoritative on its inputs.
        const netCents = row.bcSidePurchasePriceCents != null
          ? (row.bcSidePurchasePriceCents - row.aSidePurchasePriceCents - (row.transactionalFunderFeeCents ?? 0))
          : null;
        return res.json({ deal: row, netToWholesalerCents: netCents });
      } catch (err) {
        logger.error("doubleClose.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Create ────────────────────────────────────────────────────────────────
  app.post(
    "/api/double-close",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const [row] = await db
          .insert(doubleCloseDeals)
          .values({ organizationId: orgId, ...parsed.data })
          .returning();
        return res.status(201).json({ deal: row });
      } catch (err) {
        logger.error("doubleClose.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Patch ─────────────────────────────────────────────────────────────────
  app.patch(
    "/api/double-close/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = patchSchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const [row] = await db
          .update(doubleCloseDeals)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(and(eq(doubleCloseDeals.id, req.params.id), eq(doubleCloseDeals.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Double-close deal");
        return res.json({ deal: row });
      } catch (err) {
        logger.error("doubleClose.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Delete ────────────────────────────────────────────────────────────────
  app.delete(
    "/api/double-close/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .delete(doubleCloseDeals)
          .where(and(eq(doubleCloseDeals.id, req.params.id), eq(doubleCloseDeals.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Double-close deal");
        return res.json({ deleted: true });
      } catch (err) {
        logger.error("doubleClose.delete failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
