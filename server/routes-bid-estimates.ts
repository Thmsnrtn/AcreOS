/**
 * Fix-and-flip vertical FF-5 — bid comparison.
 *
 * Devon §2.2: "Two of my three GCs sent bids on Cherokee yesterday — $58K,
 * $71K, $63K — for the same scope. I want to put them side-by-side: line
 * by line, where does Marcus go cheaper than Tony on flooring; where does
 * Carlos pad the demolition. AcreOS has no bid-comparison surface."
 *
 *   GET    /api/rehabs/:id/bids                  — list bids w/ side-by-side
 *   POST   /api/rehabs/:id/bids                  — record a bid
 *   PATCH  /api/bids/:id                         — update
 *   POST   /api/bids/:id/accept                  — mark accepted (others rejected)
 *   DELETE /api/bids/:id
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc } from "drizzle-orm";
import { db } from "./db";
import { bidEstimates, contractors, REHAB_LINE_CATEGORIES } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const bidSchema = z.object({
  contractorId: z.string().uuid(),
  totalCents: z.coerce.number().int().nonnegative(),
  submittedAt: z.string().optional(),
  validUntil: z.string().optional(),
  // Per-category breakdown — keys must be valid categories.
  categoryBreakdown: z.record(z.enum(REHAB_LINE_CATEGORIES), z.coerce.number().int().nonnegative()).optional(),
  notes: z.string().optional(),
});

const updateSchema = bidSchema.partial();

export function registerBidEstimateRoutes(app: Express): void {
  // List bids for a rehab — includes side-by-side category matrix.
  app.get("/api/rehabs/:id/bids", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rehabId = req.params.id;

      const bids = await db.select()
        .from(bidEstimates)
        .where(and(eq(bidEstimates.rehabId, rehabId), eq(bidEstimates.organizationId, orgId)))
        .orderBy(asc(bidEstimates.totalCents));

      // Pull contractor names.
      const contractorIds = Array.from(new Set(bids.map((b) => b.contractorId).filter(Boolean)));
      const contractorRows = contractorIds.length > 0
        ? await db.select({ id: contractors.id, name: contractors.name, businessName: contractors.businessName })
            .from(contractors)
            .where(eq(contractors.organizationId, orgId))
        : [];
      const nameById = new Map(contractorRows.map((c) => [c.id, c.businessName ?? c.name]));

      // Side-by-side: union of all category keys, then per-category cents per
      // bid plus per-category min/max + delta to the cheapest bid.
      const allCategories = new Set<string>();
      for (const b of bids) {
        for (const k of Object.keys((b.categoryBreakdown as any) ?? {})) allCategories.add(k);
      }
      const categories = Array.from(allCategories).sort();

      const matrix = categories.map((cat) => {
        const cellsByBid = bids.map((b) => ({
          bidId: b.id,
          contractorName: nameById.get(b.contractorId) ?? "Unknown",
          cents: ((b.categoryBreakdown as any) ?? {})[cat] ?? null,
        }));
        const valued = cellsByBid.filter((c) => c.cents !== null) as Array<{ bidId: string; contractorName: string; cents: number }>;
        const minCells = valued.length > 0 ? Math.min(...valued.map((c) => c.cents)) : null;
        const maxCells = valued.length > 0 ? Math.max(...valued.map((c) => c.cents)) : null;
        return {
          category: cat,
          cells: cellsByBid,
          minCents: minCells,
          maxCents: maxCells,
          spreadCents: minCells !== null && maxCells !== null ? maxCells - minCells : null,
        };
      });

      return res.json({
        bids: bids.map((b) => ({ ...b, contractorName: nameById.get(b.contractorId) ?? "Unknown" })),
        categories,
        matrix,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Create.
  app.post("/api/rehabs/:id/bids", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const rehabId = req.params.id;
      const parsed = bidSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

      // If categoryBreakdown supplied, total should equal sum of breakdown.
      // Don't enforce — operator may add line items not in our enum yet.
      const [created] = await db.insert(bidEstimates).values({
        organizationId: orgId,
        rehabId,
        contractorId: parsed.data.contractorId,
        totalCents: parsed.data.totalCents,
        submittedAt: parsed.data.submittedAt ?? null,
        validUntil: parsed.data.validUntil ?? null,
        categoryBreakdown: parsed.data.categoryBreakdown ?? {},
        notes: parsed.data.notes ?? null,
      }).returning();

      logger.info("[FF-5] bid recorded", { orgId, userId, rehabId, bidId: created.id, total: parsed.data.totalCents });
      return res.status(201).json({ bid: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Update.
  app.patch("/api/bids/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.errors);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      for (const k of Object.keys(parsed.data) as Array<keyof typeof parsed.data>) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      const [updated] = await db.update(bidEstimates).set(updates)
        .where(and(eq(bidEstimates.id, req.params.id), eq(bidEstimates.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Bid");
      return res.json({ bid: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // Accept — flips this bid to accepted, marks all others on the same rehab rejected.
  app.post("/api/bids/:id/accept", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const [target] = await db.select().from(bidEstimates)
        .where(and(eq(bidEstimates.id, req.params.id), eq(bidEstimates.organizationId, orgId)));
      if (!target) return Errors.notFound(res, "Bid");

      await db.transaction(async (tx) => {
        await tx.update(bidEstimates).set({ isAccepted: false, rejectedAt: new Date(), updatedAt: new Date() })
          .where(and(
            eq(bidEstimates.organizationId, orgId),
            eq(bidEstimates.rehabId, target.rehabId as string),
          ));
        await tx.update(bidEstimates).set({ isAccepted: true, rejectedAt: null, updatedAt: new Date() })
          .where(eq(bidEstimates.id, target.id));
      });

      logger.info("[FF-5] bid accepted", { orgId, userId, bidId: target.id });
      return res.json({ accepted: true, id: target.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/bids/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [deleted] = await db.delete(bidEstimates)
        .where(and(eq(bidEstimates.id, req.params.id), eq(bidEstimates.organizationId, orgId)))
        .returning({ id: bidEstimates.id });
      if (!deleted) return Errors.notFound(res, "Bid");
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
