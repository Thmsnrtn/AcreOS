/**
 * Subdivider vertical SD-6 — county subdivision timelines + carry-cost
 * projector.
 *
 * Brigid §7: "Williamson is fourteen months end-to-end. Hickman is four.
 * Maury is six. Davidson is a different planet. I bid acquisitions on the
 * carry cost of those timelines — if I think Williamson approves in
 * fourteen months I bake in fourteen months of property tax, interest
 * carry, and opportunity cost. If approval slips to twenty I've lost
 * the project."
 *
 *   GET   /api/county-timelines              — list all (filterable)
 *   GET   /api/county-timelines/:state/:county — single county
 *   POST  /api/parcels/:id/carry-cost        — projected carry given a county
 *
 * Carry-cost projector inputs (req.body):
 *   - state, county
 *   - holdingCostMonthlyCents (property tax + insurance + ops)
 *   - debtPrincipalCents (optional)
 *   - debtRateBps (optional, annual)
 *   - opportunityCostBps (optional, e.g. 800 = 8%)
 *
 * Output:
 *   - timelineMonths (p50 + p90)
 *   - holdingCostTotal, debtInterestTotal, opportunityCostTotal,
 *     totalCarryCents (p50, p90)
 *   - blendedCarryPerMonthCents
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc, sql } from "drizzle-orm";
import { db } from "./db";
import { countySubdivisionTimelines, properties } from "@shared/schema";
import { projectCarryCost } from "@shared/subdivision/carryCost";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";

const carrySchema = z.object({
  state: z.string().length(2),
  county: z.string().min(1),
  holdingCostMonthlyCents: z.coerce.number().int().nonnegative(),
  debtPrincipalCents: z.coerce.number().int().nonnegative().optional(),
  debtRateBps: z.coerce.number().int().nonnegative().optional(),
  opportunityCostBps: z.coerce.number().int().nonnegative().optional(),
});

export function registerCountyTimelineRoutes(app: Express): void {
  app.get(
    "/api/county-timelines",
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const stateFilter = typeof req.query.state === "string" ? req.query.state.toUpperCase() : null;
        const rows = stateFilter
          ? await db
              .select()
              .from(countySubdivisionTimelines)
              .where(eq(countySubdivisionTimelines.state, stateFilter))
              .orderBy(asc(countySubdivisionTimelines.countyName))
          : await db
              .select()
              .from(countySubdivisionTimelines)
              .orderBy(asc(countySubdivisionTimelines.state), asc(countySubdivisionTimelines.countyName));
        return res.json({ timelines: rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/county-timelines/:state/:county",
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const [row] = await db
          .select()
          .from(countySubdivisionTimelines)
          .where(and(
            eq(countySubdivisionTimelines.state, req.params.state.toUpperCase()),
            eq(countySubdivisionTimelines.countyName, req.params.county),
          ));
        if (!row) return Errors.notFound(res, "County timeline");
        return res.json({ timeline: row });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/parcels/:id/carry-cost",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parcelId = parseInt(req.params.id, 10);
        if (!Number.isFinite(parcelId)) return Errors.badRequest(res, "Invalid parcel id");

        const parsed = carrySchema.safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
        const carryData = parsed.data;

        const [parent] = await db
          .select()
          .from(properties)
          .where(and(eq(properties.id, parcelId), eq(properties.organizationId, orgId)));
        if (!parent) return Errors.notFound(res, "Parcel");

        const [tl] = await db
          .select()
          .from(countySubdivisionTimelines)
          .where(and(
            eq(countySubdivisionTimelines.state, parsed.data.state.toUpperCase()),
            eq(countySubdivisionTimelines.countyName, parsed.data.county),
          ));

        const purchaseBasis = parent.purchasePrice ? Math.round(parseFloat(parent.purchasePrice) * 100) : 0;

        // The p50/p90 carry projection over the county lead time is the pure,
        // behaviourally-tested engine. Never assume a timeline: a null lead time
        // yields a null projection for that percentile.
        const carry = projectCarryCost({
          p50TotalDays: tl?.p50TotalDays ?? null,
          p90TotalDays: tl?.p90TotalDays ?? null,
          inputs: {
            holdingCostMonthlyCents: carryData.holdingCostMonthlyCents,
            debtPrincipalCents: carryData.debtPrincipalCents ?? 0,
            debtRateBps: carryData.debtRateBps ?? 0,
            purchaseBasisCents: purchaseBasis,
            opportunityCostBps: carryData.opportunityCostBps ?? 0,
          },
        });

        return res.json({
          county: parsed.data.county,
          state: parsed.data.state.toUpperCase(),
          timelineFound: !!tl,
          p50: carry.p50,
          p90: carry.p90,
          inputs: {
            purchaseBasisCents: purchaseBasis,
            holdingCostMonthlyCents: parsed.data.holdingCostMonthlyCents,
            debtPrincipalCents: parsed.data.debtPrincipalCents ?? 0,
            debtRateBps: parsed.data.debtRateBps ?? 0,
            opportunityCostBps: parsed.data.opportunityCostBps ?? 0,
          },
          notes: tl?.percolationSeasonNote ?? null,
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
