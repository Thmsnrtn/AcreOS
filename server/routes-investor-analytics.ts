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
import { rentalUnits } from "@shared/schema/rental";
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
  /**
   * Whether the expense figure behind NOI/cap-rate/DSCR was supplied by the
   * operator or ASSUMED at 40% of collections. Every number downstream of an
   * assumed ratio is an estimate, and a screen that does not say so is
   * presenting an assumption as a measurement.
   */
  opExBasis: "operator_supplied" | "assumed_ratio";
  /** Whether unit counts came from modelled units or the pre-0219 lease proxy. */
  unitCountBasis: "modelled_units" | "lease_derived";
}

async function snapshotForProperty(orgId: number, propId: number, opExBps?: number, debtMonthlyCents?: number): Promise<PropertyAnalytics> {
  const [prop] = await db.select().from(properties)
    .where(and(eq(properties.id, propId), eq(properties.organizationId, orgId)));
  if (!prop) throw new Error("Property not found");

  const leases = await db.select().from(rentalLeases)
    .where(and(eq(rentalLeases.propertyId, propId), eq(rentalLeases.organizationId, orgId)));

  const active = leases.filter((l) => l.status === "active");
  const past = leases.filter((l) => l.status === "ended" || l.status === "terminated" || l.status === "renewed");

  // ── Unit counts, from the units table (migration 0219) ───────────────────
  //
  // This block used to read:
  //
  //     const vacantUnits = 0;  // we don't track unit count on a property yet
  //     const unitCount = leases.length > 0 ? Math.max(active.length, 1) : 1;
  //
  // Both were true when written and are not any more. The consequences were
  // real: vacancy on this surface was hardcoded to ZERO, so a half-empty
  // building reported 0% vacancy and a cap rate computed as though every unit
  // were let; and the denominator came from lease COUNT, so a unit that had
  // never been leased could not appear in it. That is the same defect the
  // occupancy endpoint had, in a second place, and it survived the fix
  // because nothing pointed at it.
  const unitRows = await db
    .select({ status: rentalUnits.status, marketRentCents: rentalUnits.marketRentCents })
    .from(rentalUnits)
    .where(and(eq(rentalUnits.organizationId, orgId), eq(rentalUnits.propertyId, propId)));

  // `active` = rentable stock, the same denominator the occupancy snapshot
  // uses. Deliberately NOT the statutory one, which also counts `offline` —
  // two questions, two denominators (see STATUTORY_UNIT_STATUSES).
  const rentableUnits = unitRows.filter((u) => u.status === "active").length;
  const modelled = unitRows.length > 0;

  const monthlyRentCollected = active.reduce((s, l) => s + l.monthlyRentCents, 0);
  const occupiedUnits = active.length;
  // Fall back to the old lease-derived reading ONLY where units are not
  // modelled, so a pre-0219 org sees exactly what it saw before rather than a
  // zero that would read as "no property".
  const unitCount = modelled ? rentableUnits : (leases.length > 0 ? Math.max(active.length, 1) : 1);
  const vacantUnits = modelled ? Math.max(0, rentableUnits - occupiedUnits) : 0;

  // Potential rent = in-place rent plus the ASKING rent of the vacant units
  // that carry one. That difference is the monthly cost of the vacancy, and
  // it was previously unrepresentable: with potential pinned equal to
  // collected, an empty unit cost the operator nothing on this screen.
  // Vacant units with no asking rent on file contribute nothing rather than a
  // guess, so this is a floor on the potential, never an inflated one.
  const vacantAskingCents = modelled
    ? unitRows
        .filter((u) => u.status === "active" && typeof u.marketRentCents === "number")
        .map((u) => u.marketRentCents as number)
        .sort((a, b) => b - a)
        .slice(0, vacantUnits)
        .reduce((s, c) => s + c, 0)
    : 0;
  const monthlyRentPotential = monthlyRentCollected + vacantAskingCents;

  // Op-ex: 40% rule of thumb if not specified. This is an ASSUMPTION, not a
  // measurement — AcreOS holds no property-expense records, so every number
  // downstream of it (NOI, cap rate, DSCR) inherits that. The response says
  // so via `opExBasis`; a cap rate whose expenses nobody measured must not be
  // presented as though they were.
  const opExBpsApplied = opExBps ?? 4000;  // 40.00%
  const opExBasis: "operator_supplied" | "assumed_ratio" =
    opExBps === undefined ? "assumed_ratio" : "operator_supplied";
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
    opExBasis,
    unitCountBasis: modelled ? "modelled_units" : "lease_derived",
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
