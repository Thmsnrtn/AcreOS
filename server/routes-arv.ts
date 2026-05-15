/**
 * Fix-and-flip vertical FF-4 — ARV calculator (distinct from AVM).
 *
 * Devon §2.9: "An AVM is not an ARV. An AVM tells me what it's worth
 * today, in distressed condition. An ARV tells me what it'll be worth
 * after I put in $62K of cabinets, paint, flooring, HVAC, roof patches,
 * and a bathroom redo. No competent fix-and-flip platform conflates the
 * two. AcreOS conflates them silently."
 *
 *   GET  /api/parcels/:id/arv          — current ARV (most recent isCurrent)
 *   GET  /api/parcels/:id/arv/history  — past calcs
 *   POST /api/parcels/:id/arv          — compute + persist (marks others not current)
 *
 * Compute logic: per-comp $/sqft adjusted for sqft difference and
 * condition delta, low/mid/high band based on selected comps.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db } from "./db";
import { arvCalculations, properties } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const compSchema = z.object({
  address: z.string().optional(),
  mlsId: z.string().optional(),
  soldPriceCents: z.coerce.number().int().nonnegative(),
  soldDate: z.string().optional(),
  sqft: z.coerce.number().int().nonnegative().optional(),
  distanceMiles: z.coerce.number().nonnegative().optional(),
  conditionRating: z.coerce.number().int().min(1).max(5).optional(),
  adjustments: z.record(z.string(), z.coerce.number().int()).optional(),
});

const calcSchema = z.object({
  rehabId: z.string().uuid().optional(),
  subjectSqft: z.coerce.number().int().nonnegative().optional(),
  subjectConditionRating: z.coerce.number().int().min(1).max(5).default(4),  // post-rehab default
  comps: z.array(compSchema).min(1).max(10),
  methodology: z.string().optional(),
  notes: z.string().optional(),
});

interface NormalizedComp {
  address?: string;
  mlsId?: string;
  soldPriceCents: number;
  soldDate?: string;
  sqft?: number;
  distanceMiles?: number;
  conditionRating?: number;
  adjustments?: Record<string, number>;
  finalAdjustedCents: number;
}

/**
 * Adjust each comp toward the subject:
 *   1. Sqft adjustment: scale comp $/sqft × subject sqft.
 *   2. Condition adjustment: per condition-rating delta toward subject's
 *      post-rehab rating, +/− 5% per rating step (subject is typically
 *      rated 4 = "renovated to flip standards" by default).
 *   3. Operator-supplied adjustments dollar-for-dollar.
 */
function adjustComp(comp: z.infer<typeof compSchema>, subjectSqft?: number, subjectCondition: number = 4): NormalizedComp {
  let adjusted = comp.soldPriceCents;
  if (comp.sqft && subjectSqft && comp.sqft > 0) {
    const perSqft = comp.soldPriceCents / comp.sqft;
    adjusted = Math.round(perSqft * subjectSqft);
  }
  if (comp.conditionRating !== undefined) {
    const stepPct = 0.05;
    const delta = subjectCondition - comp.conditionRating;
    adjusted = Math.round(adjusted * (1 + delta * stepPct));
  }
  if (comp.adjustments) {
    for (const v of Object.values(comp.adjustments)) {
      adjusted += v;
    }
  }
  return { ...comp, finalAdjustedCents: adjusted };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export function registerArvRoutes(app: Express): void {
  app.get("/api/parcels/:id/arv", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const propId = parseInt(req.params.id, 10);
      if (!Number.isFinite(propId)) return Errors.badRequest(res, "Invalid parcel id");

      const [current] = await db.select().from(arvCalculations)
        .where(and(
          eq(arvCalculations.organizationId, orgId),
          eq(arvCalculations.propertyId, propId),
          eq(arvCalculations.isCurrent, true),
        ))
        .orderBy(desc(arvCalculations.createdAt))
        .limit(1);

      return res.json({ arv: current ?? null });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/parcels/:id/arv/history", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const propId = parseInt(req.params.id, 10);
      if (!Number.isFinite(propId)) return Errors.badRequest(res, "Invalid parcel id");

      const rows = await db.select().from(arvCalculations)
        .where(and(
          eq(arvCalculations.organizationId, orgId),
          eq(arvCalculations.propertyId, propId),
        ))
        .orderBy(desc(arvCalculations.createdAt))
        .limit(20);

      return res.json({ history: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/parcels/:id/arv", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const propId = parseInt(req.params.id, 10);
      if (!Number.isFinite(propId)) return Errors.badRequest(res, "Invalid parcel id");

      const parsed = calcSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db.select({ id: properties.id, sqft: properties.squareFeet }).from(properties)
        .where(and(eq(properties.id, propId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Parcel");

      const subjectSqft = parsed.data.subjectSqft ?? prop.sqft ?? undefined;

      const adjustedComps = parsed.data.comps.map((c) =>
        adjustComp(c, subjectSqft ?? undefined, parsed.data.subjectConditionRating)
      );
      const adjustedValues = adjustedComps.map((c) => c.finalAdjustedCents);

      const sorted = [...adjustedValues].sort((a, b) => a - b);
      const arvLow = sorted[0];
      const arvMid = median(sorted);
      const arvHigh = sorted[sorted.length - 1];

      // Per-sqft band (low/mid/high) when subjectSqft is known.
      let pLow: number | null = null;
      let pMid: number | null = null;
      let pHigh: number | null = null;
      if (subjectSqft && subjectSqft > 0) {
        pLow = Math.round(arvLow / subjectSqft);
        pMid = Math.round(arvMid / subjectSqft);
        pHigh = Math.round(arvHigh / subjectSqft);
      }

      // Confidence: high if 3+ comps within 0.5mi & 6mo, medium if 3+ comps,
      // low otherwise.
      let confidence = "low";
      const compCount = parsed.data.comps.length;
      const sixMonthsAgo = Date.now() - 180 * 86_400_000;
      const closeAndRecent = parsed.data.comps.filter((c) => {
        const isClose = c.distanceMiles !== undefined ? c.distanceMiles <= 0.5 : false;
        const dt = c.soldDate ? new Date(c.soldDate).getTime() : 0;
        const isRecent = dt > sixMonthsAgo;
        return isClose && isRecent;
      }).length;
      if (closeAndRecent >= 3) confidence = "high";
      else if (compCount >= 3) confidence = "medium";

      // Mark prior current=true rows as not current.
      await db.update(arvCalculations).set({ isCurrent: false, updatedAt: new Date() })
        .where(and(
          eq(arvCalculations.organizationId, orgId),
          eq(arvCalculations.propertyId, propId),
          eq(arvCalculations.isCurrent, true),
        ));

      const [created] = await db.insert(arvCalculations).values({
        organizationId: orgId,
        propertyId: propId,
        rehabId: parsed.data.rehabId ?? null,
        compsUsed: adjustedComps,
        subjectSqft: subjectSqft ?? null,
        pricePerSqftLowCents: pLow,
        pricePerSqftMidCents: pMid,
        pricePerSqftHighCents: pHigh,
        arvLowCents: arvLow,
        arvMidCents: arvMid,
        arvHighCents: arvHigh,
        confidence,
        methodology: parsed.data.methodology ?? null,
        isCurrent: true,
        notes: parsed.data.notes ?? null,
        createdBy: userId,
      }).returning();

      logger.info("[FF-4] ARV calculated", { orgId, userId, propId, arvMid, confidence, compCount });
      return res.status(201).json({ arv: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
