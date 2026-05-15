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

        const p50Days = tl?.p50TotalDays ?? null;
        const p90Days = tl?.p90TotalDays ?? null;
        const p50Months = p50Days !== null ? p50Days / 30 : null;
        const p90Months = p90Days !== null ? p90Days / 30 : null;

        const debtPrincipal = parsed.data.debtPrincipalCents ?? 0;
        const annualDebtCents = debtPrincipal * (parsed.data.debtRateBps ?? 0) / 10000;
        const purchaseBasis = parent.purchasePrice ? Math.round(parseFloat(parent.purchasePrice) * 100) : 0;
        const annualOppCents = purchaseBasis * (parsed.data.opportunityCostBps ?? 0) / 10000;

        function project(months: number | null) {
          if (months === null) return null;
          const holding = Math.round(parsed.data.holdingCostMonthlyCents * months);
          const debt = Math.round((annualDebtCents / 12) * months);
          const opp = Math.round((annualOppCents / 12) * months);
          const total = holding + debt + opp;
          return {
            months: Math.round(months * 10) / 10,
            holdingCostCents: holding,
            debtInterestCents: debt,
            opportunityCostCents: opp,
            totalCarryCents: total,
          };
        }

        const p50 = project(p50Months);
        const p90 = project(p90Months);

        return res.json({
          county: parsed.data.county,
          state: parsed.data.state.toUpperCase(),
          timelineFound: !!tl,
          p50,
          p90,
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
