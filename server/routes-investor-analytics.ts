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
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { properties, rentalLeases, rentCharges, rentPayments, propertyExpenses } from "@shared/schema";
import { rentalUnits } from "@shared/schema/rental";
import type { PropertyExpenseCategory } from "@shared/rental/propertyExpense";
import { summarizeMeasuredOpEx, isMeasuredCoverageComplete } from "@shared/rental/noi";
import { computeOccupancySnapshot, type OccupancySnapshot } from "./routes-rentals";
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
   *
   * "operator_supplied" now covers BOTH a real measured ledger AND an explicit
   * opExBps override — the coarse honesty gate (drop "(est.)" iff NOT assumed).
   * `opExSource` below is the finer distinction the client needs to label a
   * param override honestly (it is not "(est.)", but it is not measured either).
   */
  opExBasis: "operator_supplied" | "assumed_ratio";
  /**
   * The finer provenance of the op-ex behind NOI:
   *   - "measured_expenses" — summed from real property_expenses OPERATING rows
   *     in the trailing-12 window. This is the only value that reads as measured;
   *     the "(est.)" label is dropped ONLY here.
   *   - "ratio_override"    — no stored expenses, but the caller supplied an
   *     explicit opExBps. Operator-supplied, but still a RATIO, not a measurement
   *     from records — labelled as an assumed ratio, never as measured.
   *   - "assumed_ratio"     — neither: the flat 40%-of-collections rule of thumb.
   */
  opExSource: "measured_expenses" | "ratio_override" | "assumed_ratio";
  /**
   * Count of OPERATING property_expenses rows in the trailing-12 window. Zero
   * means no measured expenses exist, so the property stays on the assumed ratio
   * and KEEPS "(est.)". Exposed so a caller can see the coverage behind a
   * measured NOI rather than trusting the flag alone.
   */
  opExMeasuredRowCount: number;
  /**
   * Measured OPERATING expense over the trailing-12 window, in cents (0 when
   * none). The annual figure behind `opExMonthlyCents` when opExSource is
   * "measured_expenses"; retained even when unused downstream so the T-12
   * workspace can render the measured total without re-querying.
   */
  opExTrailing12Cents: number;
  /**
   * How many of the trailing-12 calendar months carry a measured operating
   * expense — the COVERAGE behind a measured NOI. A measured op-ex that spans
   * only one or two months is real but PARTIAL; the client renders it "N/12 mo"
   * rather than as an unqualified measured number, so thin coverage never reads
   * as a complete year's books. 0 when nothing is measured.
   */
  opExMonthsCovered: number;
  /**
   * Per-Schedule-E-category breakdown of the measured OPERATING expenses in the
   * trailing-12 window, in cents. Empty object when nothing is measured. The
   * T-12 stage reuses this to render the category rows; NOI never re-decides
   * which categories are operating — non-operating rows never enter this map.
   */
  opExByCategoryCents: Partial<Record<PropertyExpenseCategory, number>>;
  /** Whether unit counts came from modelled units or the pre-0219 lease proxy. */
  unitCountBasis: "modelled_units" | "lease_derived";
  /**
   * Per-building occupancy, via the SAME computeOccupancySnapshot the org-wide
   * endpoint uses — measurable/unmeasurable modelled honestly per property, so a
   * building with no rentable stock reads `measurable:false` instead of a
   * fabricated 0%/100%.
   */
  occupancy: OccupancySnapshot;
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
  const vacantAskingSlice = modelled
    ? unitRows
        .filter((u) => u.status === "active" && typeof u.marketRentCents === "number")
        .map((u) => u.marketRentCents as number)
        .sort((a, b) => b - a)
        .slice(0, vacantUnits)
    : [];
  const vacantAskingCents = vacantAskingSlice.reduce((s, c) => s + c, 0);
  const monthlyRentPotential = monthlyRentCollected + vacantAskingCents;

  // ── The trailing-12 window, declared once and reused ─────────────────────
  // Both the measured-op-ex sum immediately below and the vacancy-months query
  // further down bucket over the SAME trailing-12 months.
  const twelveAgo = new Date();
  twelveAgo.setMonth(twelveAgo.getMonth() - 12);
  const twelveAgoDate = twelveAgo.toISOString().slice(0, 10);

  // ── Measured operating expense — property_expenses is the SOLE source ─────
  // NOI's operating expense comes from the property_expenses LEDGER and from
  // nowhere else. Maintenance invoices reach NOI ONLY once they are rolled INTO
  // this ledger (source='maintenance_invoice'), so summing maintenanceTickets
  // here as well would double-count them — this route never touches that table.
  // We fetch every expense in the trailing-12 window and hand it to
  // summarizeMeasuredOpEx, the ONE predicate that keeps only OPERATING rows
  // (never mortgage_interest or depreciation) and totals them per category the
  // T-12 workspace reuses. "Measured" is defined precisely there: operating
  // expense rows PRESENT in the window. A property with none stays on the
  // assumed ratio — a thin/partial ledger must never read as complete.
  const expenseRows = await db
    .select({
      category: propertyExpenses.category,
      amountCents: propertyExpenses.amountCents,
      isOperating: propertyExpenses.isOperating,
      incurredOn: propertyExpenses.incurredOn,
    })
    .from(propertyExpenses)
    .where(and(
      eq(propertyExpenses.organizationId, orgId),
      eq(propertyExpenses.propertyId, propId),
      gte(propertyExpenses.incurredOn, twelveAgoDate),
    ));
  const measuredOpEx = summarizeMeasuredOpEx(expenseRows);
  const sumOperatingLast12 = measuredOpEx.sumCents;
  const measuredRowCount = measuredOpEx.rowCount;
  const opExMonthsCovered = measuredOpEx.monthsCovered;
  const opExByCategoryCents: Partial<Record<PropertyExpenseCategory, number>> = measuredOpEx.byCategoryCents;

  // Op-ex precedence: measured stored expenses > opExBps override > assumed 40%.
  // The 40%-of-collections rule of thumb (opExBps ?? 4000) is an ASSUMPTION, not a
  // measurement — used ONLY when no stored operating expenses exist AND no explicit
  // ratio was supplied, and every number downstream of it (NOI, cap rate, DSCR)
  // then inherits that. A param override is operator-supplied but is NOT measured
  // from records, so it is honest as an assumed ratio, never as "(est.)"-dropped
  // measured. opExBasis is the coarse gate (NOT assumed ⇒ drop "(est.)"), opExSource
  // the finer one the client needs to keep an override from reading as measured.
  const hasMeasured = measuredRowCount > 0;
  const measuredOpExMonthly = Math.round(sumOperatingLast12 / 12);
  const opExMonthly = hasMeasured
    ? measuredOpExMonthly
    : Math.round((monthlyRentCollected * (opExBps ?? 4000)) / 10000);
  const opExBasis: "operator_supplied" | "assumed_ratio" =
    (hasMeasured || opExBps !== undefined) ? "operator_supplied" : "assumed_ratio";
  const opExSource: "measured_expenses" | "ratio_override" | "assumed_ratio" =
    hasMeasured ? "measured_expenses" : (opExBps !== undefined ? "ratio_override" : "assumed_ratio");

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
  // for this property (across all its leases). Same trailing-12 window
  // (`twelveAgoDate`) the measured-op-ex sum above uses.
  const t12Rows = await db.execute(sql`
    SELECT
      DATE_TRUNC('month', rc.charged_for_month) AS month,
      SUM(rc.amount_cents) AS billed
    FROM rent_charges rc
    JOIN rental_leases l ON l.id = rc.lease_id
    WHERE l.property_id = ${propId}
      AND rc.organization_id = ${orgId}
      AND rc.charged_for_month >= ${twelveAgoDate}
    GROUP BY 1
    ORDER BY 1
  `);
  const monthsBilled = ((t12Rows as any).rows ?? []).filter((r: any) => Number(r.billed) > 0).length;
  const vacancyRate = monthsBilled > 0 ? Math.max(0, 1 - monthsBilled / 12) : (occupiedUnits > 0 ? 0 : 1);

  // ── Per-building occupancy, via the shared snapshot ──────────────────────
  // The SAME computeOccupancySnapshot the org-wide /api/rent-roll/occupancy
  // endpoint uses, fed this ONE building's unit facts. It models
  // measurable/unmeasurable + vacant-with-rent honestly, so a property with no
  // rentable stock returns measurable:false rather than a fabricated 0%/100%.
  const occupancy = computeOccupancySnapshot({
    rentableUnits,
    occupiedUnits,
    offlineUnits: unitRows.filter((u) => u.status === "offline").length,
    retiredUnits: unitRows.filter((u) => u.status === "retired").length,
    vacantUnitsWithMarketRent: vacantAskingSlice.length,
    vacantMarketRentMonthlyCents: vacantAskingCents,
    propertyCount: 1,
  });

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
    opExSource,
    opExMeasuredRowCount: measuredRowCount,
    opExTrailing12Cents: sumOperatingLast12,
    opExMonthsCovered,
    opExByCategoryCents,
    unitCountBasis: modelled ? "modelled_units" : "lease_derived",
    occupancy,
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

      // Portfolio op-ex basis. The rollup calls snapshotForProperty with NO
      // opExBps, so a property is measured here iff it has MEASURED stored
      // expenses. The rollup tile may drop "(est.)" ONLY when EVERY property is
      // measured AND its coverage is complete (a full trailing-12 span) — a
      // portfolio of thin-coverage properties is not "your books" either, so an
      // all-measured-but-thin rollout reads "mixed" and keeps the estimate
      // label. One assumed property is likewise "mixed"; all-assumed (or empty)
      // is "assumed_ratio".
      let portfolioOpExBasis: "operator_supplied" | "assumed_ratio" | "mixed";
      const allMeasuredComplete = snapshots.length > 0 && snapshots.every(
        (x) => x.opExSource === "measured_expenses" && isMeasuredCoverageComplete(x.opExMonthsCovered),
      );
      const allAssumed = snapshots.length > 0 && snapshots.every((x) => x.opExBasis === "assumed_ratio");
      if (snapshots.length === 0) {
        portfolioOpExBasis = "assumed_ratio";
      } else if (allMeasuredComplete) {
        portfolioOpExBasis = "operator_supplied";
      } else if (allAssumed) {
        portfolioOpExBasis = "assumed_ratio";
      } else {
        portfolioOpExBasis = "mixed";
      }

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
          portfolioOpExBasis,
        },
        properties: snapshots,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
