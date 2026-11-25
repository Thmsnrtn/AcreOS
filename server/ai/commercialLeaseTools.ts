/**
 * Pax lease / commercial tool family (promised bar item (c) for commercial;
 * the lease base is shared with buy_and_hold, multifamily, mobile_home and
 * STR, which cross-credit these tools).
 *
 * The reads and the one record change go through the SAME tables and engines
 * the REST routes use: the commercial columns on rental_leases, the
 * lease_rent_schedule steps, the CAM pools and frozen cam_reconciliations,
 * and commercial_sales_reports — all in server/routes-rent-ledger.ts — and
 * the per-square-foot figures come from computePerSqftMetrics
 * (shared/rental/perSqft.ts), the exact engine GET /api/leases/:id/per-sqft
 * calls. The organization always comes from the session (`orgId`), never
 * from a model-supplied argument.
 *
 * No tenant PII: no tool here shapes a tenant name, email or phone. A lease
 * is carried by its unit label and amounts, exactly as in the buy-and-hold
 * family — so no read in this family sits behind the tenant-records
 * permission fence, and every read has a support-path twin.
 *
 * CAM honesty: a reconciliation is a FROZEN statement whose own snapshot
 * records how many of the period's months had expense coverage. The CAM
 * read surfaces that coverage verbatim — thin coverage is disclosed, never
 * smoothed over — and when no statement has been generated it says so
 * instead of implying a true-up exists.
 *
 * FD5: there is NO send tool here of any kind. The one record change,
 * `paxRecordTenantSalesReport`, performs exactly the insert the sales-report
 * route performs: it records what the tenant reported. It posts NO rent
 * charge, computes NO percentage rent, moves NO money — the same posture
 * the route itself documents.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  camExpensePools,
  camReconciliations,
  commercialSalesReports,
  leaseRentSchedule,
  rentalLeases,
} from "@shared/schema";
import { toolRefusal, type RefusalParts } from "@shared/refusal/plainRefusal";
import { computePerSqftMetrics, type PerSqftMetrics } from "@shared/rental/perSqft";
import type { RentScheduleStepInput } from "@shared/rental/rentEscalation";
import { clock } from "../utils/clock";

export type CommercialLeaseToolOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; refusal: RefusalParts };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const LEASE_BOOK_NOT_COVERED =
  "It covers only the leases and commercial records entered or imported into THIS account — " +
  "it does not include leases managed in another system, or any other account's leases.";

function coverage(what: string): string {
  return `Coverage: ${what} ${LEASE_BOOK_NOT_COVERED}`;
}

const noLease = (): CommercialLeaseToolOutcome => ({
  ok: false,
  refusal: {
    what: "No lease with that id is in this account",
    why: "It may have been removed, or the id came from another list",
    unlock: "Ask me to list your leases and pick the one you mean",
  },
});

const badLeaseId = (): CommercialLeaseToolOutcome => ({
  ok: false,
  refusal: {
    what: "That is not a lease id",
    why: "Lease ids are long identifiers, not a unit label or an address",
    unlock: "Ask me to list your leases and use the id it shows",
  },
});

async function loadLease(orgId: number, leaseId: unknown) {
  if (typeof leaseId !== "string" || !UUID.test(leaseId.trim())) return "bad_id" as const;
  const { db } = await import("../db");
  const [row] = await db
    .select()
    .from(rentalLeases)
    .where(and(eq(rentalLeases.id, leaseId.trim()), eq(rentalLeases.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

type LeaseRow = typeof rentalLeases.$inferSelect;
type StepRow = typeof leaseRentSchedule.$inferSelect;

function shapeStep(row: StepRow) {
  return {
    effectiveMonth: String(row.effectiveMonth).slice(0, 10),
    stepType: row.stepType,
    amountCents: row.amountCents ?? null,
    pctBps: row.pctBps ?? null,
    cpiIndexBase: row.cpiIndexBase != null ? Number(row.cpiIndexBase) : null,
    cpiIndexCurrent: row.cpiIndexCurrent != null ? Number(row.cpiIndexCurrent) : null,
    cpiIndexName: row.cpiIndexName ?? null,
    cpiIndexPublishedOn: row.cpiIndexPublishedOn ? String(row.cpiIndexPublishedOn).slice(0, 10) : null,
    floorPctBps: row.floorPctBps ?? null,
    ceilingPctBps: row.ceilingPctBps ?? null,
  };
}

function stepInputs(rows: StepRow[]): RentScheduleStepInput[] {
  return rows.map((r) => ({
    effectiveMonth: String(r.effectiveMonth).slice(0, 10),
    stepType: r.stepType,
    amountCents: r.amountCents ?? null,
    pctBps: r.pctBps ?? null,
    cpiIndexBase: r.cpiIndexBase != null ? Number(r.cpiIndexBase) : null,
    cpiIndexCurrent: r.cpiIndexCurrent != null ? Number(r.cpiIndexCurrent) : null,
    floorPctBps: r.floorPctBps ?? null,
    ceilingPctBps: r.ceilingPctBps ?? null,
  }));
}

async function loadSteps(orgId: number, leaseId: string): Promise<StepRow[]> {
  const { db } = await import("../db");
  return db
    .select()
    .from(leaseRentSchedule)
    .where(and(eq(leaseRentSchedule.organizationId, orgId), eq(leaseRentSchedule.leaseId, leaseId)))
    .orderBy(asc(leaseRentSchedule.effectiveMonth));
}

/** The lease's commercial terms, exactly as recorded — nulls stay null. */
function shapeCommercialTerms(lease: LeaseRow) {
  return {
    rentableSqft: lease.rentableSqft ?? null,
    leaseType: lease.leaseType ?? null,
    camProRataBps: lease.camProRataBps ?? null,
    camEstimateMonthlyCents: lease.camEstimateMonthlyCents ?? null,
    camBaseYearStopCents: lease.camBaseYearStopCents ?? null,
    pctRentBps: lease.pctRentBps ?? null,
    pctRentBreakpointType: lease.pctRentBreakpointType ?? null,
    pctRentArtificialBreakpointCents: lease.pctRentArtificialBreakpointCents ?? null,
    pctRentFrequency: lease.pctRentFrequency ?? null,
    lateFeeType: lease.lateFeeType ?? null,
    lateFeeFlatCents: lease.lateFeeFlatCents ?? null,
    lateFeePctBps: lease.lateFeePctBps ?? null,
    lateFeeGraceDays: lease.lateFeeGraceDays ?? null,
    lateFeeMaxCents: lease.lateFeeMaxCents ?? null,
    lateFeePerDayCents: lease.lateFeePerDayCents ?? null,
  };
}

function hasCommercialTerms(lease: LeaseRow): boolean {
  const t = shapeCommercialTerms(lease);
  return Object.values(t).some((v) => v !== null);
}

function shapePerSqft(m: PerSqftMetrics) {
  return {
    baseRentPerSqftAnnualCents: m.baseRentPerSqftAnnualCents,
    occupancyCostPerSqftAnnualCents: m.occupancyCostPerSqftAnnualCents,
    occupancyCostBasis: m.occupancyCostBasis,
    monthlyRentCentsUsed: m.monthlyRentCentsUsed,
    asOfMonth: m.asOfMonth,
    rentableSqft: m.rentableSqft,
    unavailable: m.unavailable,
  };
}

/**
 * The lease abstract: the lease itself, its commercial terms as recorded,
 * its rent steps, and the per-square-foot figures from the same engine the
 * lease screen's per-square-foot route uses. A lease with no commercial
 * terms recorded is reported as exactly that — never dressed up as one.
 */
export async function paxGetLeaseAbstract(orgId: number, leaseId: unknown): Promise<CommercialLeaseToolOutcome> {
  const lease = await loadLease(orgId, leaseId);
  if (lease === "bad_id") return badLeaseId();
  if (!lease) return noLease();
  const steps = await loadSteps(orgId, lease.id);
  const perSqft = computePerSqftMetrics({
    monthlyRentCents: lease.monthlyRentCents,
    scheduleSteps: stepInputs(steps),
    asOfMonth: clock.now().toISOString().slice(0, 7),
    rentableSqft: lease.rentableSqft,
    camEstimateMonthlyCents: lease.camEstimateMonthlyCents,
    leaseType: lease.leaseType,
  });
  const commercial = hasCommercialTerms(lease);
  return {
    ok: true,
    data: {
      coverage: coverage(
        "this answer reads ONE lease in THIS account — its recorded commercial terms, rent steps and per-square-foot figures. " +
          "Terms that were never entered are shown as not recorded, never filled in from another lease.",
      ),
      asOf: clock.now().toISOString().slice(0, 10),
      lease: {
        id: lease.id,
        propertyId: lease.propertyId,
        unitId: lease.unitId ?? null,
        unitLabel: lease.unitLabel ?? null,
        status: lease.status,
        startDate: lease.startDate,
        endDate: lease.endDate ?? null,
        monthlyRentCents: lease.monthlyRentCents,
        rentDueDayOfMonth: lease.rentDueDayOfMonth,
        securityDepositCents: lease.securityDepositCents,
        state: lease.state,
      },
      hasCommercialTerms: commercial,
      commercialTerms: commercial ? shapeCommercialTerms(lease) : null,
      statement: commercial
        ? null
        : "No commercial terms are recorded for this lease in this account — no rentable area, lease type, CAM share or percentage-rent terms. Say exactly that; do not describe it as a commercial lease.",
      rentStepCount: steps.length,
      perSqft: shapePerSqft(perSqft),
    },
  };
}

/** The lease's rent-escalation steps, in the order they take effect. */
export async function paxGetLeaseRentSteps(orgId: number, leaseId: unknown): Promise<CommercialLeaseToolOutcome> {
  const lease = await loadLease(orgId, leaseId);
  if (lease === "bad_id") return badLeaseId();
  if (!lease) return noLease();
  const steps = await loadSteps(orgId, lease.id);
  return {
    ok: true,
    data: {
      coverage: coverage(
        "this answer reads the rent steps recorded for ONE lease in THIS account. " +
          "A lease with no steps bills at its starting rent — that is stated, not filled in with an assumed escalation.",
      ),
      asOf: clock.now().toISOString().slice(0, 10),
      leaseId: lease.id,
      startingMonthlyRentCents: lease.monthlyRentCents,
      stepCount: steps.length,
      steps: steps.map(shapeStep),
      statement:
        steps.length === 0
          ? "No rent steps are recorded for this lease — its rent does not escalate on any schedule recorded here."
          : null,
    },
  };
}

/**
 * CAM status for one lease: the recorded CAM terms, the expense pools
 * defined for the lease's property, and the frozen reconciliation
 * statements generated for this lease — each with its own coverage
 * snapshot. Thin coverage (a statement built from only some of the
 * period's months) is disclosed in plain words.
 */
export async function paxGetLeaseCamStatus(orgId: number, leaseId: unknown): Promise<CommercialLeaseToolOutcome> {
  const lease = await loadLease(orgId, leaseId);
  if (lease === "bad_id") return badLeaseId();
  if (!lease) return noLease();
  const { db } = await import("../db");
  const pools = await db
    .select()
    .from(camExpensePools)
    .where(and(eq(camExpensePools.organizationId, orgId), eq(camExpensePools.propertyId, lease.propertyId)))
    .orderBy(desc(camExpensePools.periodStart));
  const reconciliations = await db
    .select()
    .from(camReconciliations)
    .where(and(eq(camReconciliations.organizationId, orgId), eq(camReconciliations.leaseId, lease.id)))
    .orderBy(desc(camReconciliations.generatedAt));
  const terms = shapeCommercialTerms(lease);
  const latest = reconciliations[0] ?? null;
  const thinCoverage =
    latest !== null && latest.coverageComplete !== true
      ? `Thin coverage: the latest CAM statement for this lease rests on recorded expenses for ` +
        `${latest.coverageMonths ?? 0} month${latest.coverageMonths === 1 ? "" : "s"} of its period — ` +
        `not the whole period. State that whenever the statement's figures are quoted; a true-up built on partial months can move when the missing months are entered.`
      : null;
  return {
    ok: true,
    data: {
      coverage: coverage(
        "this answer reads the CAM terms, expense pools and generated statements recorded for ONE lease in THIS account. " +
          "A statement is a calculation from the expenses and share recorded here — the lease itself governs any dispute about it, and AcreOS does not settle one.",
      ),
      asOf: clock.now().toISOString().slice(0, 10),
      leaseId: lease.id,
      camTerms: {
        leaseType: terms.leaseType,
        camProRataBps: terms.camProRataBps,
        camEstimateMonthlyCents: terms.camEstimateMonthlyCents,
        camBaseYearStopCents: terms.camBaseYearStopCents,
      },
      pools: pools.map((p) => ({
        id: p.id,
        poolKind: p.poolKind,
        periodStart: String(p.periodStart).slice(0, 10),
        periodEnd: String(p.periodEnd).slice(0, 10),
        status: p.status,
        totalRentableSqft: p.totalRentableSqft ?? null,
        recoverableCategories: p.recoverableCategories ?? [],
      })),
      reconciliations: reconciliations.map((r) => ({
        id: r.id,
        poolId: r.poolId,
        periodStart: r.periodStart ? String(r.periodStart).slice(0, 10) : null,
        periodEnd: r.periodEnd ? String(r.periodEnd).slice(0, 10) : null,
        proRataBpsUsed: r.proRataBpsUsed ?? null,
        proRataBasis: r.proRataBasis ?? null,
        poolActualCents: r.poolActualCents ?? null,
        recoverableShareCents: r.recoverableShareCents ?? null,
        estimatedBilledCents: r.estimatedBilledCents ?? null,
        estimatedBilledBasis: r.estimatedBilledBasis ?? null,
        deltaCents: r.deltaCents ?? null,
        coverageMonths: r.coverageMonths ?? null,
        coverageComplete: r.coverageComplete ?? null,
        generatedAt: r.generatedAt ? new Date(r.generatedAt).toISOString() : null,
      })),
      coverageDisclosure:
        thinCoverage ??
        (latest
          ? "The latest CAM statement for this lease records expense coverage for every month of its period."
          : "No CAM statement has been generated for this lease in this account — what is shown is the recorded terms and pool definitions only, not a true-up. Say exactly that; do not quote a CAM balance."),
    },
  };
}

const REPORT_SOURCES = ["tenant_statement", "operator_entered", "amended"] as const;

function isRealDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Record ONE tenant sales report — the figure the tenant reported for a
 * period, as the input to percentage rent. This performs exactly the
 * insert the sales-report route performs (a re-report for the same period
 * replaces the earlier figure and is marked as an amendment, as the route
 * marks it). It posts no charge, computes no overage and verifies nothing
 * about the sales — AcreOS records what was reported; it does not audit
 * a tenant's books.
 */
export async function paxRecordTenantSalesReport(
  orgId: number,
  userId: string | null | undefined,
  args: Record<string, unknown>,
): Promise<CommercialLeaseToolOutcome & { receipt?: { before: unknown; after: unknown; description: string } }> {
  const lease = await loadLease(orgId, args.lease_id);
  if (lease === "bad_id") return badLeaseId();
  if (!lease) return noLease();
  const periodStart = typeof args.period_start === "string" ? args.period_start : "";
  const periodEnd = typeof args.period_end === "string" ? args.period_end : "";
  const grossSalesCents = typeof args.gross_sales_cents === "number" ? args.gross_sales_cents : Number(args.gross_sales_cents);
  if (!isRealDate(periodStart) || !isRealDate(periodEnd) || periodEnd < periodStart || !Number.isInteger(grossSalesCents) || grossSalesCents < 0) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded",
        why: "A sales report needs the period it covers (a start and end date, end not before start) and the reported gross sales as a whole number of cents, zero or more",
        unlock: "Give the period dates and the reported figure, then I will record it",
      },
    };
  }
  const reportSource =
    typeof args.report_source === "string" && (REPORT_SOURCES as readonly string[]).includes(args.report_source)
      ? (args.report_source as (typeof REPORT_SOURCES)[number])
      : null;
  const reportedBy = typeof args.reported_by === "string" && args.reported_by ? args.reported_by.slice(0, 200) : null;
  const notes = typeof args.notes === "string" && args.notes ? args.notes.slice(0, 2000) : null;
  const { db } = await import("../db");
  const [existing] = await db
    .select()
    .from(commercialSalesReports)
    .where(
      and(
        eq(commercialSalesReports.organizationId, orgId),
        eq(commercialSalesReports.leaseId, lease.id),
        eq(commercialSalesReports.periodStart, periodStart),
        eq(commercialSalesReports.periodEnd, periodEnd),
      ),
    )
    .limit(1);
  const [saved] = await db
    .insert(commercialSalesReports)
    .values({
      organizationId: orgId,
      leaseId: lease.id,
      periodStart,
      periodEnd,
      grossSalesCents,
      reportedBy,
      reportSource,
      notes,
    })
    .onConflictDoUpdate({
      target: [
        commercialSalesReports.leaseId,
        commercialSalesReports.periodStart,
        commercialSalesReports.periodEnd,
      ],
      set: {
        grossSalesCents,
        reportedBy,
        // An amendment to an existing period is exactly that — the route's rule.
        reportSource: reportSource ?? "amended",
        notes,
      },
    })
    .returning();
  void userId;
  const amended = Boolean(existing);
  return {
    ok: true,
    data: {
      message:
        "Recorded the sales report on the lease. This records the figure the tenant reported — " +
        "AcreOS did not verify the sales, computed no percentage rent from it, and posted no charge.",
      leaseId: lease.id,
      reportId: saved?.id ?? null,
      periodStart,
      periodEnd,
      grossSalesCents,
      amended,
    },
    receipt: {
      before: existing
        ? { leaseId: lease.id, periodStart, periodEnd, reportId: existing.id, grossSalesCents: existing.grossSalesCents }
        : { leaseId: lease.id, periodStart, periodEnd, reportId: null },
      after: { leaseId: lease.id, periodStart, periodEnd, reportId: saved?.id ?? null, grossSalesCents },
      description: amended
        ? `Amended the tenant sales report for lease ${lease.unitLabel ?? lease.id}, ${periodStart} to ${periodEnd}, to ${grossSalesCents} cents (record only — no charge posted)`
        : `Recorded a tenant sales report of ${grossSalesCents} cents for lease ${lease.unitLabel ?? lease.id}, ${periodStart} to ${periodEnd} (record only — no charge posted)`,
    },
  };
}

/** Plain-words converter for the executors. */
export function commercialLeaseOutcomeToResult(o: CommercialLeaseToolOutcome): {
  success: boolean;
  data?: Record<string, unknown>;
  refusal?: RefusalParts;
  error?: string;
} {
  return o.ok ? { success: true, data: o.data } : toolRefusal(o.refusal);
}
