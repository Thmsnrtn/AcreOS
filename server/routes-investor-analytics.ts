/**
 * Buy-and-hold vertical BH-7 — investor analytics (NOI / cap / DSCR / vacancy).
 *
 * Imelda §2.11: "the metrics I actually look at on a Sunday afternoon
 * when I'm thinking about whether to buy door 32: NOI per door, DSCR,
 * vacancy rate trailing-12, average tenant tenure, cap rate."
 *
 *   GET /api/properties/:id/analytics    — single property snapshot
 *   GET /api/portfolio/analytics         — org-wide rollup
 *
 * What we compute (and what we explicitly note as approximated):
 *   - NOI annual = (collected rent annual) - (op-ex annual)
 *     Op-ex annual today comes from the lease's holding-cost-monthly
 *     proxy if set, OR an operator-supplied 40%-of-collected default.
 *     Real op-ex tracking requires Schedule E categorization which is
 *     deferred to BH+1 (Stessa-killer workstream).
 *   - Cap rate = NOI annual / market value
 *   - DSCR = NOI monthly / debt service monthly
 *     Debt service today comes from the most-recent lien on the
 *     property (placeholder, since AcreOS doesn't yet track lender
 *     mortgages on owned property — operator types principal+rate).
 *   - Vacancy rate trailing-12 = months_vacant / months_in_period
 *   - Average tenant tenure = mean(end_date - start_date) for
 *     non-active leases on the property.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { properties, rentalLeases, rentCharges, rentPayments } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";

interface PropertyAnalytics {
  propertyId: number;
  marketValueCents: number | null;
  monthlyRentCollectedCents: number;
  monthlyRentPotentialCents: number;
  occupiedUnitCount: number;
  vacantUnitCount: number;
  unitCount: number;
  vacancyRate: number;
  opExMonthlyCents: number;
  noiMonthlyCents: number;
  noiAnnualCents: number;
  capRatePct: number | null;
  dscr: number | null;
  averageTenureMonths: number | null;
}

async function snapshotForProperty(orgId: number, propId: number, opExBps?: number, debtMonthlyCents?: number): Promise<PropertyAnalytics> {
  const [prop] = await db.select().from(properties)
    .where(and(eq(properties.id, propId), eq(properties.organizationId, orgId)));
  if (!prop) throw new Error("Property not found");

  const leases = await db.select().from(rentalLeases)
    .where(and(eq(rentalLeases.propertyId, propId), eq(rentalLeases.organizationId, orgId)));

  const active = leases.filter((l) => l.status === "active");
  const past = leases.filter((l) => l.status === "ended" || l.status === "terminated" || l.status === "renewed");

  const monthlyRentCollected = active.reduce((s, l) => s + l.monthlyRentCents, 0);
  const monthlyRentPotential = monthlyRentCollected;  // operator can override later w/ explicit market rent
  const occupiedUnits = active.length;
  const vacantUnits = 0;  // we don't track unit count on a property yet — assume occupied = occupied
  const unitCount = leases.length > 0 ? Math.max(active.length, 1) : 1;

  // Op-ex: 40% rule of thumb if not specified.
  const opExBpsApplied = opExBps ?? 4000;  // 40.00%
  const opExMonthly = Math.round((monthlyRentCollected * opExBpsApplied) / 10000);

  const noiMonthly = monthlyRentCollected - opExMonthly;
  const noiAnnual = noiMonthly * 12;

  const marketValue = prop.marketValue ? Math.round(parseFloat(prop.marketValue) * 100)
    : prop.assessedValue ? Math.round(parseFloat(prop.assessedValue) * 100)
      : null;

  const capRate = marketValue && marketValue > 0 ? (noiAnnual / marketValue) : null;

  const dscr = debtMonthlyCents && debtMonthlyCents > 0 ? (noiMonthly / debtMonthlyCents) : null;

  // Average tenure = mean(end - start) for past leases.
  let averageTenureMonths: number | null = null;
  const tenures: number[] = [];
  for (const l of past) {
    if (l.endDate && l.startDate) {
      const months = (new Date(l.endDate).getTime() - new Date(l.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (Number.isFinite(months) && months > 0) tenures.push(months);
    }
  }
  if (tenures.length > 0) {
    averageTenureMonths = Math.round(tenures.reduce((s, t) => s + t, 0) / tenures.length);
  }

  // Trailing-12 vacancy: count months in last 12 with zero rent_charges
  // for this property (across all its leases).
  const twelveAgo = new Date();
  twelveAgo.setMonth(twelveAgo.getMonth() - 12);
  const t12Rows = await db.execute(sql`
    SELECT
      DATE_TRUNC('month', rc.charged_for_month) AS month,
      SUM(rc.amount_cents) AS billed
    FROM rent_charges rc
    JOIN rental_leases l ON l.id = rc.lease_id
    WHERE l.property_id = ${propId}
      AND rc.organization_id = ${orgId}
      AND rc.charged_for_month >= ${twelveAgo.toISOString().slice(0, 10)}
    GROUP BY 1
    ORDER BY 1
  `);
  const monthsBilled = ((t12Rows as any).rows ?? []).filter((r: any) => Number(r.billed) > 0).length;
  const vacancyRate = monthsBilled > 0 ? Math.max(0, 1 - monthsBilled / 12) : (occupiedUnits > 0 ? 0 : 1);

  return {
    propertyId: propId,
    marketValueCents: marketValue,
    monthlyRentCollectedCents: monthlyRentCollected,
    monthlyRentPotentialCents: monthlyRentPotential,
    occupiedUnitCount: occupiedUnits,
    vacantUnitCount: vacantUnits,
    unitCount,
    vacancyRate: Math.round(vacancyRate * 10000) / 10000,
    opExMonthlyCents: opExMonthly,
    noiMonthlyCents: noiMonthly,
    noiAnnualCents: noiAnnual,
    capRatePct: capRate !== null ? Math.round(capRate * 10000) / 100 : null,
    dscr: dscr !== null ? Math.round(dscr * 100) / 100 : null,
    averageTenureMonths,
  };
}

export function registerInvestorAnalyticsRoutes(app: Express): void {
  app.get("/api/properties/:id/analytics", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const propId = parseInt(req.params.id, 10);
      const opExBps = req.query.opExBps ? parseInt(String(req.query.opExBps), 10) : undefined;
      const debtMonthlyCents = req.query.debtMonthlyCents ? parseInt(String(req.query.debtMonthlyCents), 10) : undefined;
      const snapshot = await snapshotForProperty(orgId, propId, opExBps, debtMonthlyCents);
      return res.json({ analytics: snapshot });
    } catch (err: any) {
      if (err?.message === "Property not found") return Errors.notFound(res, "Property");
      return Errors.internal(res, err);
    }
  });

  app.get("/api/portfolio/analytics", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);

      // Properties that have at least one rental lease.
      const propRows = await db.execute(sql`
        SELECT DISTINCT property_id FROM rental_leases WHERE organization_id = ${orgId}
      `);
      const propIds = ((propRows as any).rows ?? []).map((r: any) => Number(r.property_id));

      const snapshots: PropertyAnalytics[] = [];
      for (const id of propIds) {
        snapshots.push(await snapshotForProperty(orgId, id));
      }

      const totalMonthlyRent = snapshots.reduce((s, x) => s + x.monthlyRentCollectedCents, 0);
      const totalOpEx = snapshots.reduce((s, x) => s + x.opExMonthlyCents, 0);
      const totalNoiMonthly = totalMonthlyRent - totalOpEx;
      const totalNoiAnnual = totalNoiMonthly * 12;
      const totalMarketValue = snapshots.reduce((s, x) => s + (x.marketValueCents ?? 0), 0);
      const portfolioCapRate = totalMarketValue > 0 ? (totalNoiAnnual / totalMarketValue) : null;
      const portfolioVacancy = snapshots.length > 0
        ? snapshots.reduce((s, x) => s + x.vacancyRate, 0) / snapshots.length
        : 0;

      return res.json({
        propertyCount: snapshots.length,
        portfolio: {
          totalMonthlyRentCents: totalMonthlyRent,
          totalOpExMonthlyCents: totalOpEx,
          totalNoiMonthlyCents: totalNoiMonthly,
          totalNoiAnnualCents: totalNoiAnnual,
          totalMarketValueCents: totalMarketValue,
          portfolioCapRatePct: portfolioCapRate !== null ? Math.round(portfolioCapRate * 10000) / 100 : null,
          portfolioVacancyRate: Math.round(portfolioVacancy * 10000) / 10000,
        },
        properties: snapshots,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
