/**
 * Fix-and-flip vertical FF-2 — rehab budget builder.
 *
 * A rehabs table + rehab_line_items (category, scope, vendor, budgeted,
 * committed, spent, variance, photos), with scope templates that seed the
 * line items an operator then prices for their own market.
 *
 * Routes:
 *   GET    /api/rehabs                     — list rehabs for org
 *   GET    /api/rehabs/:id                 — single rehab w/ line items + totals
 *   POST   /api/rehabs                     — create
 *   PATCH  /api/rehabs/:id                 — update top-level fields
 *   POST   /api/rehabs/:id/line-items      — append line item
 *   PATCH  /api/rehab-line-items/:id       — update line item
 *   DELETE /api/rehab-line-items/:id       — delete line item
 *   POST   /api/rehabs/:id/seed-template   — apply a scope template
 *   POST   /api/rehabs/:id/baselines       — record a kickoff baseline (append-only)
 *   POST   /api/rehabs/:id/holding-entries — record a holding-cost entry (append-only)
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, eq, asc, desc, sql, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  rehabs,
  rehabLineItems,
  REHAB_STATUSES,
  REHAB_LINE_CATEGORIES,
  properties,
  rehabBaselines,
  type RehabStatus,
  rehabStatusTransitions,
  rehabHoldingCostEntries,
  REHAB_HOLDING_CATEGORIES,
  scenarios,
  rehabChangeOrders,
} from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { emitRehabStatusChange } from "./services/rehabEvents";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";
import {
  ESTIMATE_EDITABLE_STATUS,
  ESTIMATE_LOCK_MESSAGE,
  projectVariance,
  lineVariance,
  varianceFlags,
} from "@shared/rehab/variance";
import {
  originalBaseline,
  phaseVariances,
  listingVarianceDays,
  holdingComparison,
} from "@shared/rehab/timeline";
import type { BaselineLike, TransitionLike } from "@shared/rehab/timeline";
import { isCalendarDate } from "@shared/dates/calendar";
import { routeParam } from "./utils/routeParams";
import { refuseRedeemableDeedSpend } from "./services/tax/landExit";
import { patchSchemaOf } from "./utils/updatePayload";
import {
  approvedAmountByLine,
  approvedScheduleDays,
  effectiveEstimateCents,
  projectChangeOrderTotals,
} from "@shared/rehab/changeOrders";
import type { ChangeOrderLike } from "@shared/rehab/changeOrders";
import { gradeRealized } from "@shared/rehab/realized";
import type { ScenarioAssumption } from "@shared/economics/scenario";
import { recordDecision, decisionsForSubject } from "./services/decisions/decisionStore";
import { UnavailableScenarioError } from "./services/economics/scenarioStore";

// ----------------------------------------------------------------------------
// Scope templates — a STARTING SCOPE, not an estimate.
//
// These used to carry hardcoded Atlanta costs ("~$50-65K total at 1500 sqft
// (Devon's typical project)" — Devon is a review persona) that were written
// into the operator's budget as if they were estimates for THEIR market, a
// "10% contingency reserve" line that was really a flat $6/sqft, and a silent
// 1,500 sqft default. A template now seeds the line items (category + scope)
// with a $0 budget; the operator enters what each line costs in their market.
// No persona names, no market costs, no invented contingency.
// ----------------------------------------------------------------------------

export interface ScopeTemplateLine {
  category: typeof REHAB_LINE_CATEGORIES[number];
  scope: string;
}

export interface ScopeTemplate {
  key: string;
  label: string;
  description: string;
  lines: ScopeTemplateLine[];
}

const STARTING_SCOPE_NOTE = "Starting scope only — enter your own cost for each line.";

export const SCOPE_TEMPLATES: ScopeTemplate[] = [
  {
    key: "full_house_starter_scope",
    label: "Full-house starter scope (3BR/2BA)",
    description: `Interior demo through punch list for a typical 3BR/2BA cosmetic rehab. ${STARTING_SCOPE_NOTE}`,
    lines: [
      { category: "demolition",     scope: "Interior demo + dumpster" },
      { category: "kitchen",        scope: "Kitchen — mid-grade gut" },
      { category: "bathroom",       scope: "2 bath gut & finish" },
      { category: "flooring",       scope: "LVP throughout" },
      { category: "interior_paint", scope: "Interior paint" },
      { category: "exterior_paint", scope: "Exterior paint + trim" },
      { category: "hvac",           scope: "HVAC condenser + servicing" },
      { category: "electrical",     scope: "Outlets + fixtures" },
      { category: "plumbing",       scope: "Repairs + fixtures" },
      { category: "trim_doors",     scope: "Doors + trim package" },
      { category: "appliances",     scope: "Stainless appliance package" },
      { category: "punch_list",     scope: "Punch list + cleaning" },
    ],
  },
  {
    key: "kitchen_midgrade",
    label: "Kitchen — mid-grade",
    description: `Mid-grade kitchen rehab: cabinets, counters, appliances, backsplash, fixtures. ${STARTING_SCOPE_NOTE}`,
    lines: [
      { category: "kitchen", scope: "Cabinets (mid-grade)" },
      { category: "kitchen", scope: "Quartz countertops" },
      { category: "kitchen", scope: "Tile backsplash" },
      { category: "appliances", scope: "Stainless appliance package" },
      { category: "plumbing", scope: "Sink + faucet" },
    ],
  },
  {
    key: "bath_gut",
    label: "Bath gut + finish",
    description: `Full bathroom gut: tile, vanity, fixtures, tub or walk-in. ${STARTING_SCOPE_NOTE}`,
    lines: [
      { category: "demolition", scope: "Bath demo" },
      { category: "plumbing", scope: "Rough-in + fixtures" },
      { category: "bathroom", scope: "Tile floor + walls" },
      { category: "bathroom", scope: "Vanity + counter + mirror" },
    ],
  },
  {
    key: "roof_tear_off_replace",
    label: "Roof — tear-off + replace",
    description: `Asphalt shingle tear-off and full replacement. ${STARTING_SCOPE_NOTE}`,
    lines: [
      { category: "roof", scope: "Tear-off + decking inspection" },
      { category: "roof", scope: "Architectural shingle install" },
    ],
  },
];

/**
 * The line items a template seeds. Budget is ALWAYS 0 — the operator prices
 * each line. Exported so the seeding contract is testable without a DB.
 */
export function templateLineItems(tpl: ScopeTemplate): Array<{ category: ScopeTemplateLine["category"]; scope: string; budgetCents: 0 }> {
  return tpl.lines.map((line) => ({ category: line.category, scope: line.scope, budgetCents: 0 }));
}

const TEMPLATES_BY_KEY = new Map(SCOPE_TEMPLATES.map((t) => [t.key, t]));

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

const createRehabSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  name: z.string().min(1).max(200),
  status: z.enum(REHAB_STATUSES).default("planning"),
  startedAt: z.string().optional(),
  plannedListingDate: z.string().optional(),
  purchasePriceCents: z.coerce.number().int().nonnegative().optional(),
  purchaseClosingCents: z.coerce.number().int().nonnegative().optional(),
  budgetTotalCents: z.coerce.number().int().nonnegative().optional(),
  holdingCostMonthlyCents: z.coerce.number().int().nonnegative().optional(),
  arvCents: z.coerce.number().int().nonnegative().optional(),
  targetMarginCents: z.coerce.number().int().optional(),
  lenderName: z.string().optional(),
  lenderLoanCents: z.coerce.number().int().nonnegative().optional(),
  lenderRateBps: z.coerce.number().int().nonnegative().optional(),
});

const updateRehabSchema = patchSchemaOf(createRehabSchema).omit({ propertyId: true });

const lineItemSchema = z.object({
  category: z.enum(REHAB_LINE_CATEGORIES),
  scope: z.string().min(1).max(500),
  contractorId: z.string().uuid().optional().nullable(),
  budgetCents: z.coerce.number().int().nonnegative().default(0),
  committedCents: z.coerce.number().int().nonnegative().default(0),
  spentCents: z.coerce.number().int().nonnegative().default(0),
  startedAt: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const lineItemUpdateSchema = patchSchemaOf(lineItemSchema);

const seedTemplateSchema = z.object({
  templateKey: z.string(),
  // Accepted for older clients and ignored: templates carry no per-sqft cost.
  sqft: z.coerce.number().int().nonnegative().optional(),
  replaceExisting: z.boolean().default(false),
});

// ----------------------------------------------------------------------------
// Leg 3 — timeline truth (kickoff baselines + holding-cost entries)
//
// Both are append-only at the database (migrations/0306 installs the guard):
// a revised baseline is a NEW row that supersedes the previous one, and a
// wrong holding entry is corrected by a NEW negative entry whose note says
// what it corrects. There is deliberately no PATCH and no DELETE route for
// either — an edit would rewrite the denominator variance is measured against.
// ----------------------------------------------------------------------------

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
  .refine((v) => isCalendarDate(v), "Not a real calendar date");

const phasePlanSchema = z.object({
  phase: z.enum(REHAB_STATUSES),
  plannedDate: dateOnly,
});

const baselineSchema = z.object({
  plannedStartDate: dateOnly.optional(),
  plannedListingDate: dateOnly.optional(),
  plannedHoldMonths: z.coerce.number().int().positive().optional(),
  plannedHoldingMonthlyCents: z.coerce.number().int().nonnegative().optional(),
  // May be empty: a baseline can record only the dates the operator knows.
  phasePlans: z.array(phasePlanSchema).max(REHAB_STATUSES.length).optional(),
});

const holdingEntrySchema = z.object({
  entryDate: dateOnly,
  category: z.enum(REHAB_HOLDING_CATEGORIES),
  // Never zero (the table enforces the same). A NEGATIVE amount is a
  // correction — its note says what it corrects; the original is never edited.
  amountCents: z.coerce
    .number()
    .int()
    .refine((n) => n !== 0, "amountCents must be non-zero (a correction is a negative entry)"),
  note: z.string().max(2000).optional(),
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** A scenario input as a number; null when absent, blank or not numeric. */
function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Where a scenario assumption came from ("user", "strategy-pack-default", …). */
function assumptionOrigin(
  assumptions: ReadonlyArray<{ key: string; origin: string }> | null | undefined,
  key: string,
): string | null {
  const found = (assumptions ?? []).find((a) => a && a.key === key);
  return found ? String(found.origin) : null;
}

const usd = (cents: number) =>
  `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : String(d);

/** ISO date (UTC day) `days` after a YYYY-MM-DD date; null when unparseable. */
function addDaysUtc(dateStr: string, days: number): string | null {
  const ms = Date.parse(dateStr);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** The recorded-facts + grading block, shared by the GET and the realized POST. */
function realizedBlock(
  r: typeof rehabs.$inferSelect,
  inputs: {
    rehabSpentCents: number;
    rehabLineCount: number;
    holdingEntriesTotalCents: number;
    holdingEntryCount: number;
    scenario: {
      inputs: Record<string, unknown> | null;
      metrics: Array<{ id: string; value: number | null }>;
    } | null;
  },
) {
  const sc = inputs.scenario;
  const metric = (id: string): number | null =>
    numberOrNull(sc?.metrics.find((m) => m.id === id)?.value);
  // The forecast-side absolutes, built once: fed to gradeRealized AND returned.
  const scenarioFacts = sc
    ? {
        arvCents: numberOrNull(sc.inputs?.["arvCents"]),
        profitCents: metric("profit"),
        roiRatio: metric("roi"),
        holdMonths: numberOrNull(sc.inputs?.["holdMonths"]),
      }
    : null;
  if (
    r.realizedRecordedAt == null ||
    r.realizedSalePriceCents == null ||
    r.realizedSellingCostsCents == null ||
    r.realizedClosingDate == null
  ) {
    return { facts: null, grading: null, scenario: scenarioFacts };
  }
  const facts = {
    salePriceCents: Number(r.realizedSalePriceCents),
    sellingCostsCents: Number(r.realizedSellingCostsCents),
    closingDate: String(r.realizedClosingDate),
  };
  return {
    facts: {
      ...facts,
      recordedBy: r.realizedRecordedBy ?? null,
      recordedAt: iso(r.realizedRecordedAt),
    },
    grading: gradeRealized({
      facts,
      purchasePriceCents: r.purchasePriceCents ?? null,
      rehabSpentCents: inputs.rehabSpentCents,
      rehabLineCount: inputs.rehabLineCount,
      holdingEntriesTotalCents: inputs.holdingEntriesTotalCents,
      holdingEntryCount: inputs.holdingEntryCount,
      startedAt: r.startedAt ? String(r.startedAt) : null,
      scenario: scenarioFacts,
    }),
    scenario: scenarioFacts,
  };
}

/** The latest flip_mao scenario row for a property (id, inputs, assumptions, metrics). */
async function latestFlipScenario(orgId: number, propertyId: number) {
  const [row] = await db
    .select({
      id: scenarios.id,
      inputs: scenarios.inputs,
      assumptions: scenarios.assumptions,
      metrics: scenarios.metrics,
    })
    .from(scenarios)
    .where(and(
      eq(scenarios.organizationId, orgId),
      eq(scenarios.subjectType, "property"),
      eq(scenarios.subjectId, propertyId),
      eq(scenarios.engineId, "flip_mao"),
    ))
    .orderBy(desc(scenarios.computedAt))
    .limit(1);
  return row ?? null;
}

function changeOrderLike(o: typeof rehabChangeOrders.$inferSelect): ChangeOrderLike {
  return {
    id: String(o.id),
    lineItemId: String(o.lineItemId),
    description: o.description,
    amountCents: Number(o.amountCents),
    scheduleImpactDays: o.scheduleImpactDays,
    status: o.status,
    decidedBy: o.decidedBy ?? null,
    decidedAt: iso(o.decidedAt),
    recordedBy: o.recordedBy,
    createdAt: iso(o.createdAt) as string,
  };
}

async function recomputeRehabSpend(orgId: number, rehabId: string) {
  const [agg] = await db.execute(sql`
    SELECT COALESCE(SUM(spent_cents), 0) AS spent
    FROM rehab_line_items
    WHERE rehab_id = ${rehabId} AND organization_id = ${orgId}
  `).then((r: any) => r.rows ?? []);
  if (agg) {
    await db.update(rehabs).set({
      spentTotalCents: Number(agg.spent) || 0,
      updatedAt: clock.now(),
    }).where(eq(rehabs.id, rehabId));
  }
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

/**
 * Whether a rehab's line ESTIMATES are locked (§4.3): once it leaves planning,
 * the estimate is the number variance is measured against, so changing it is a
 * change order, not an edit. Org-scoped; null when the rehab is not this org's.
 */
async function estimateLockedFor(orgId: number, rehabId: string): Promise<boolean | null> {
  const [r] = await db.select({ status: rehabs.status }).from(rehabs)
    .where(and(eq(rehabs.id, rehabId), eq(rehabs.organizationId, orgId)));
  if (!r) return null;
  return r.status !== ESTIMATE_EDITABLE_STATUS;
}

export function registerRehabRoutes(app: Express): void {
  app.get("/api/rehab-scope-templates", isAuthenticated, async (_req: AuthenticatedRequest, res: Response) => {
    return res.json({
      templates: SCOPE_TEMPLATES.map((t) => ({
        key: t.key,
        label: t.label,
        description: t.description,
        lineCount: t.lines.length,
      })),
    });
  });

  app.get("/api/rehabs", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const rows = await db
        .select({
          id: rehabs.id,
          propertyId: rehabs.propertyId,
          name: rehabs.name,
          status: rehabs.status,
          startedAt: rehabs.startedAt,
          plannedListingDate: rehabs.plannedListingDate,
          purchasePriceCents: rehabs.purchasePriceCents,
          budgetTotalCents: rehabs.budgetTotalCents,
          spentTotalCents: rehabs.spentTotalCents,
          arvCents: rehabs.arvCents,
          updatedAt: rehabs.updatedAt,
        })
        .from(rehabs)
        .where(eq(rehabs.organizationId, orgId))
        .orderBy(desc(rehabs.updatedAt));
      return res.json({ rehabs: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.get("/api/rehabs/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [r] = await db
        .select()
        .from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const items = await db
        .select()
        .from(rehabLineItems)
        .where(and(
          eq(rehabLineItems.rehabId, r.id as string),
          eq(rehabLineItems.organizationId, orgId),
        ))
        .orderBy(asc(rehabLineItems.sequence), asc(rehabLineItems.createdAt));

      // Variance per item + per category roll-up.
      const byCategory: Record<string, { budget: number; committed: number; spent: number; variance: number }> = {};
      let totalBudget = 0;
      let totalCommitted = 0;
      let totalSpent = 0;
      for (const it of items) {
        const b = it.budgetCents;
        const c = it.committedCents;
        const s = it.spentCents;
        totalBudget += b;
        totalCommitted += c;
        totalSpent += s;
        const cat = byCategory[it.category] ?? { budget: 0, committed: 0, spent: 0, variance: 0 };
        cat.budget += b; cat.committed += c; cat.spent += s; cat.variance = cat.spent - cat.budget;
        byCategory[it.category] = cat;
      }

      // Daily holding-cost meter — Devon §3.5: "When my GC says 'we're a
      // week behind,' I want the platform to translate that into '$2,140
      // in additional carry, here's the new break-even sale price.'"
      let daysOnSite: number | null = null;
      if (r.startedAt) {
        const startedMs = new Date(r.startedAt).getTime();
        if (Number.isFinite(startedMs)) {
          daysOnSite = Math.floor((clock.nowMs() - startedMs) / 86_400_000);
        }
      }
      const holdingDaily = r.holdingCostMonthlyCents ? Math.round(r.holdingCostMonthlyCents / 30) : null;
      const accruedHoldingCents = holdingDaily !== null && daysOnSite !== null
        ? holdingDaily * daysOnSite
        : null;

      // Estimate → committed → actual, per line and rolled up, plus the facts
      // worth flagging (fix-and-flip package, Leg 2). Computed from the lines;
      // the rehab's own budget header is a separate figure and is not used here.
      const varianceLines = items.map((it) => ({
        id: String(it.id), category: it.category, scope: it.scope,
        budgetCents: it.budgetCents, committedCents: it.committedCents, spentCents: it.spentCents,
      }));
      const estimateLocked = r.status !== ESTIMATE_EDITABLE_STATUS;

      // ── Timeline truth (fix-and-flip package, Leg 3) ────────────────────
      // Reading only: the append-only rows are loaded exactly as written and
      // compared, never reconciled into a projection that could disagree with
      // them. No read below writes anything.
      const baselines = await db
        .select()
        .from(rehabBaselines)
        .where(and(eq(rehabBaselines.rehabId, r.id as string), eq(rehabBaselines.organizationId, orgId)))
        .orderBy(asc(rehabBaselines.createdAt));

      const transitions = await db
        .select()
        .from(rehabStatusTransitions)
        .where(and(eq(rehabStatusTransitions.rehabId, r.id as string), eq(rehabStatusTransitions.organizationId, orgId)))
        .orderBy(asc(rehabStatusTransitions.transitionedAt));

      const holdingEntries = await db
        .select()
        .from(rehabHoldingCostEntries)
        .where(and(eq(rehabHoldingCostEntries.rehabId, r.id as string), eq(rehabHoldingCostEntries.organizationId, orgId)))
        .orderBy(asc(rehabHoldingCostEntries.entryDate), asc(rehabHoldingCostEntries.createdAt));

      const changeOrderRows = await db
        .select()
        .from(rehabChangeOrders)
        .where(and(eq(rehabChangeOrders.rehabId, r.id as string), eq(rehabChangeOrders.organizationId, orgId)))
        .orderBy(asc(rehabChangeOrders.createdAt));
      const ordersForMath = changeOrderRows.map(changeOrderLike);
      const approvedByLine = approvedAmountByLine(ordersForMath);

      const baselinesForMath: BaselineLike[] = baselines.map((b) => ({
        id: String(b.id),
        supersedesId: b.supersedesId ? String(b.supersedesId) : null,
        plannedStartDate: b.plannedStartDate ?? null,
        plannedListingDate: b.plannedListingDate ?? null,
        plannedHoldMonths: b.plannedHoldMonths ?? null,
        plannedHoldingMonthlyCents: b.plannedHoldingMonthlyCents ?? null,
        phasePlans: b.phasePlans ?? [],
        recordedBy: b.recordedBy,
        createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : String(b.createdAt),
      }));
      const transitionsForMath: TransitionLike[] = transitions.map((t) => ({
        fromStatus: t.fromStatus ?? null,
        toStatus: t.toStatus,
        transitionedAt: t.transitionedAt instanceof Date ? t.transitionedAt.toISOString() : String(t.transitionedAt),
      }));
      const original = originalBaseline(baselinesForMath);
      const entriesTotalCents = holdingEntries.reduce((sum, e) => sum + (Number(e.amountCents) || 0), 0);

      // The latest flip_mao scenario for this rehab's property — the holding
      // assumption the operator's own underwriting used, with its provenance.
      const latestScenario = await latestFlipScenario(orgId, r.propertyId);

      const scenarioBlock = latestScenario
        ? {
            holdMonths: numberOrNull(latestScenario.inputs?.["holdMonths"]),
            monthlyHoldingCostCents: numberOrNull(latestScenario.inputs?.["monthlyHoldingCostCents"]),
            holdMonthsOrigin: assumptionOrigin(latestScenario.assumptions, "rule_hold_months"),
            monthlyOrigin: assumptionOrigin(latestScenario.assumptions, "holdingCost"),
          }
        : null;

      const changeOrderTotals = projectChangeOrderTotals(varianceLines, ordersForMath);
      const approvedDays = approvedScheduleDays(ordersForMath);
      const adjustedPlannedListingDate =
        original?.plannedListingDate && approvedDays !== 0
          ? addDaysUtc(original.plannedListingDate, approvedDays)
          : null;

      const exitDecisions = (await decisionsForSubject(orgId, "property", r.propertyId))
        .filter((d) =>
          d.body.strategyPackId === "fix_and_flip" &&
          d.body.assumptions.some((a) => a.key === "exit_kind"))
        .map((d) => {
          const kindA = d.body.assumptions.find((a) => a.key === "exit_kind");
          const priceA = d.body.assumptions.find((a) => a.key === "exit_expected_price_cents");
          return {
            id: d.id,
            decidedAt: d.decidedAt.toISOString(),
            kind: d.body.kind,
            exitKind: kindA ? String(kindA.value) : null,
            choice: d.body.choice,
            rationale: d.body.rationale,
            expectedPriceCents: priceA ? numberOrNull(priceA.value) : null,
            reviewDueAt: iso(d.body.reviewDueAt),
          };
        });

      const realized = realizedBlock(r, {
        rehabSpentCents: totalSpent,
        rehabLineCount: items.length,
        holdingEntriesTotalCents: entriesTotalCents,
        holdingEntryCount: holdingEntries.length,
        scenario: latestScenario,
      });

      return res.json({
        rehab: r,
        items,
        variance: {
          lines: varianceLines.map((l) => {
            const approved = approvedByLine.get(l.id) ?? 0;
            return {
              ...lineVariance(l),
              approvedChangeOrderCents: approved,
              effectiveEstimateCents: effectiveEstimateCents(l.budgetCents, approved),
            };
          }),
          project: {
            ...projectVariance(varianceLines),
            approvedChangeOrderCents: changeOrderTotals.approvedChangeOrderCents,
            effectiveEstimateCents: changeOrderTotals.effectiveEstimateCents,
          },
          flags: varianceFlags(varianceLines),
        },
        estimateLock: estimateLocked ? { locked: true, message: ESTIMATE_LOCK_MESSAGE } : { locked: false },
        timeline: {
          baselines: baselines.map((b) => ({
            ...b,
            isOriginal: original !== null && original.id === String(b.id),
          })),
          transitions,
          holdingEntries,
          schedule: {
            phases: phaseVariances(original, transitionsForMath),
            listingVarianceDays: listingVarianceDays(original, r.actualListingDate ?? null, transitionsForMath),
            approvedChangeOrderDays: approvedDays,
            adjustedPlannedListingDate,
          },
          holding: holdingComparison({
            scenario: scenarioBlock,
            baseline: original,
            entriesTotalCents,
            elapsedDays: daysOnSite,
            meterAccruedCents: accruedHoldingCents,
          }),
        },
        changeOrders: { orders: changeOrderRows, totals: changeOrderTotals },
        exit: { decisions: exitDecisions },
        realized,
        totals: {
          budgetCents: totalBudget,
          committedCents: totalCommitted,
          spentCents: totalSpent,
          varianceCents: totalSpent - totalBudget,
          byCategory,
          daysOnSite,
          accruedHoldingCents,
        },
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rehabs", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = createRehabSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [prop] = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, parsed.data.propertyId), eq(properties.organizationId, orgId)));
      if (!prop) return Errors.notFound(res, "Property");
      // V-Tax-1 T4b: no improvement spend on a parcel still held by a tax position.
      if (!(await refuseRedeemableDeedSpend(res, orgId, parsed.data.propertyId, "A rehab"))) return;

      const [created] = await db.insert(rehabs).values({
        organizationId: orgId,
        propertyId: parsed.data.propertyId,
        name: parsed.data.name,
        status: parsed.data.status,
        startedAt: parsed.data.startedAt ?? null,
        plannedListingDate: parsed.data.plannedListingDate ?? null,
        purchasePriceCents: parsed.data.purchasePriceCents ?? null,
        purchaseClosingCents: parsed.data.purchaseClosingCents ?? null,
        budgetTotalCents: parsed.data.budgetTotalCents ?? null,
        holdingCostMonthlyCents: parsed.data.holdingCostMonthlyCents ?? null,
        arvCents: parsed.data.arvCents ?? null,
        targetMarginCents: parsed.data.targetMarginCents ?? null,
        lenderName: parsed.data.lenderName ?? null,
        lenderLoanCents: parsed.data.lenderLoanCents ?? null,
        lenderRateBps: parsed.data.lenderRateBps ?? null,
      }).returning();

      // The status log's creation record (Leg 3): fromStatus is null because
      // the rehab did not move — it opened in this status.
      await db.insert(rehabStatusTransitions).values({
        organizationId: orgId,
        rehabId: created.id,
        fromStatus: null,
        toStatus: created.status,
        recordedBy: userId,
      });

      logger.info("[FF-2] rehab created", { orgId, userId, rehabId: created.id, propertyId: parsed.data.propertyId });
      return res.status(201).json({ rehab: created });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/rehabs/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = updateRehabSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: clock.now() };
      for (const k of [
        "name", "status", "startedAt", "plannedListingDate",
        "purchasePriceCents", "purchaseClosingCents", "budgetTotalCents",
        "holdingCostMonthlyCents", "arvCents", "targetMarginCents",
        "lenderName", "lenderLoanCents", "lenderRateBps",
      ] as const) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      // The pre-image: its parcel for the V-Tax-1 T4b gate (an update is
      // rehab spend as much as a create), and its status so the workflow
      // emitter can detect a GENUINE status transition (audit Wave 1 — wire
      // the fix-and-flip milestone loop).
      const [prev] = await db
        .select({ status: rehabs.status, propertyId: rehabs.propertyId })
        .from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!prev) return Errors.notFound(res, "Rehab");
      if (!(await refuseRedeemableDeedSpend(res, orgId, prev.propertyId, "A rehab update"))) return;
      // The estimate lock (§4.3) holds only if a project cannot step back into
      // planning, re-price its lines, and step out again. Once it has left
      // planning, it does not return.
      if (parsed.data.status === ESTIMATE_EDITABLE_STATUS && prev.status !== ESTIMATE_EDITABLE_STATUS) {
        return Errors.badRequest(
          res,
          "A project that has left planning cannot go back to it: its estimates are locked so variance is measured against what was planned. Scope changes after work starts are change orders.",
          { field: "status" },
        );
      }
      const beforeStatus: string | null = parsed.data.status !== undefined ? prev.status ?? null : null;
      const [updated] = await db.update(rehabs).set(updates)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Rehab");
      // Append the status log for a GENUINE move (Leg 3): beforeStatus is null
      // when the patch did not touch status, and an unchanged status is not a
      // transition. Recorded before the workflow fires, so the log and the
      // workflow react to the same move.
      if (beforeStatus !== null && beforeStatus !== updated.status) {
        await db.insert(rehabStatusTransitions).values({
          organizationId: orgId,
          rehabId: updated.id,
          fromStatus: beforeStatus as RehabStatus,
          toStatus: updated.status,
          recordedBy: getUserId(req),
        });
      }
      // Fire the flip lifecycle workflow on a real status transition
      // (fire-and-forget; a workflow failure never fails the rehab write).
      emitRehabStatusChange(beforeStatus, updated);
      return res.json({ rehab: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rehabs/:id/line-items", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = lineItemSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select({ id: rehabs.id, propertyId: rehabs.propertyId }).from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");
      if (!(await refuseRedeemableDeedSpend(res, orgId, r.propertyId, "A rehab line item"))) return;
      // A new line with an estimate after planning is a scope change. A $0-
      // estimate line (an unplanned cost to track) is allowed: its spend then
      // shows honestly as over its estimate.
      if (parsed.data.budgetCents > 0 && (await estimateLockedFor(orgId, r.id as string))) {
        return Errors.badRequest(res, ESTIMATE_LOCK_MESSAGE, { field: "budgetCents" });
      }

      const [maxRow] = await db.execute(sql`SELECT COALESCE(MAX(sequence), -1) AS m FROM rehab_line_items WHERE rehab_id = ${r.id}`).then((res: any) => res.rows ?? []);
      const seq = (Number((maxRow as any)?.m) ?? -1) + 1;

      const [item] = await db.insert(rehabLineItems).values({
        organizationId: orgId,
        rehabId: r.id as string,
        sequence: seq,
        category: parsed.data.category,
        scope: parsed.data.scope,
        contractorId: parsed.data.contractorId ?? null,
        budgetCents: parsed.data.budgetCents,
        committedCents: parsed.data.committedCents,
        spentCents: parsed.data.spentCents,
        startedAt: parsed.data.startedAt ?? null,
        completedAt: parsed.data.completedAt ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      await recomputeRehabSpend(orgId, r.id as string);
      return res.status(201).json({ item });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.patch("/api/rehab-line-items/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = lineItemUpdateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const updates: Record<string, unknown> = { updatedAt: clock.now() };
      for (const k of [
        "category", "scope", "contractorId", "budgetCents",
        "committedCents", "spentCents", "startedAt", "completedAt", "notes",
      ] as const) {
        if (parsed.data[k] !== undefined) updates[k] = parsed.data[k];
      }
      // V-Tax-1 T4b: a line-item update is rehab spend on the rehab's parcel.
      const [owner] = await db.select({ propertyId: rehabs.propertyId, rehabId: rehabLineItems.rehabId, budgetCents: rehabLineItems.budgetCents, category: rehabLineItems.category }).from(rehabLineItems)
        .innerJoin(rehabs, eq(rehabs.id, rehabLineItems.rehabId))
        .where(and(eq(rehabLineItems.id, routeParam(req.params.id)), eq(rehabLineItems.organizationId, orgId)));
      if (!owner) return Errors.notFound(res, "Line item");
      if (!(await refuseRedeemableDeedSpend(res, orgId, owner.propertyId, "A rehab line item update"))) return;
      const changesEstimate =
        (parsed.data.budgetCents !== undefined && owner.budgetCents !== parsed.data.budgetCents) ||
        // Moving an estimated line to another category moves its estimate there.
        (parsed.data.category !== undefined && parsed.data.category !== owner.category && Number(owner.budgetCents) > 0);
      if (changesEstimate && (await estimateLockedFor(orgId, owner.rehabId as string))) {
        return Errors.badRequest(res, ESTIMATE_LOCK_MESSAGE, { field: "budgetCents" });
      }
      const [updated] = await db.update(rehabLineItems).set(updates)
        .where(and(eq(rehabLineItems.id, routeParam(req.params.id)), eq(rehabLineItems.organizationId, orgId)))
        .returning();
      if (!updated) return Errors.notFound(res, "Line item");
      await recomputeRehabSpend(orgId, updated.rehabId as string);
      return res.json({ item: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.delete("/api/rehab-line-items/:id", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const [line] = await db.select({ rehabId: rehabLineItems.rehabId, budgetCents: rehabLineItems.budgetCents }).from(rehabLineItems)
        .where(and(eq(rehabLineItems.id, routeParam(req.params.id)), eq(rehabLineItems.organizationId, orgId)));
      if (!line) return Errors.notFound(res, "Line item");
      // Deleting an estimated line rewrites the estimate as surely as editing it.
      if (Number(line.budgetCents) > 0 && (await estimateLockedFor(orgId, line.rehabId as string))) {
        return Errors.badRequest(res, ESTIMATE_LOCK_MESSAGE, { field: "budgetCents" });
      }
      const [deleted] = await db.delete(rehabLineItems)
        .where(and(eq(rehabLineItems.id, routeParam(req.params.id)), eq(rehabLineItems.organizationId, orgId)))
        .returning();
      if (!deleted) return Errors.notFound(res, "Line item");
      await recomputeRehabSpend(orgId, deleted.rehabId as string);
      return res.json({ deleted: true, id: deleted.id });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // FF-8 — flipper dashboard widget data (replaces FLIPPER_MOCK).
  // Devon §1 thirty-second verdict: "The dashboard widget for my persona
  // shows 'Active Rehabs' with three properties and a BudgetBar — and when
  // I open the file (type-specific-widgets.tsx), it's pulling from
  // FLIPPER_MOCK. Hardcoded mock data."
  app.get("/api/flipper/dashboard", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const activeStatuses = ["planning", "demo", "framing", "rough_ins", "drywall", "finishes", "punch_list", "listed", "under_contract"];

      const statusList = sql.join(activeStatuses.map(s => sql`${s}`), sql`, `);
      const rows = await db.execute(sql`
        SELECT id, name, status, started_at, planned_listing_date,
               purchase_price_cents, budget_total_cents, spent_total_cents,
               arv_cents, holding_cost_monthly_cents
        FROM rehabs
        WHERE organization_id = ${orgId}
          AND status IN (${statusList})
        ORDER BY updated_at DESC
        LIMIT 5
      `);

      const activeRehabs = ((rows as any).rows ?? []).map((r: any) => {
        const budget = Number(r.budget_total_cents) || 0;
        const spent = Number(r.spent_total_cents) || 0;
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          budgetCents: budget,
          spentCents: spent,
          spentPct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
          arvCents: Number(r.arv_cents) || null,
          plannedListingDate: r.planned_listing_date,
        };
      });

      if (activeRehabs.length === 0) {
        return res.json({ hasData: false });
      }

      // Variance flags per project — facts from the lines, no threshold
      // (fix-and-flip package, Leg 2 §4.4). Following one is a link, not a write.
      const lineRows = await db
        .select({
          id: rehabLineItems.id, rehabId: rehabLineItems.rehabId, category: rehabLineItems.category, scope: rehabLineItems.scope,
          budgetCents: rehabLineItems.budgetCents, committedCents: rehabLineItems.committedCents, spentCents: rehabLineItems.spentCents,
        })
        .from(rehabLineItems)
        .where(and(eq(rehabLineItems.organizationId, orgId), inArray(rehabLineItems.rehabId, activeRehabs.map((r: { id: string }) => r.id))));
      for (const r of activeRehabs as Array<Record<string, unknown>>) {
        r.flags = varianceFlags(lineRows.filter((l) => l.rehabId === r.id).map((l) => ({ ...l, id: String(l.id) })));
      }

      const totalBudget = activeRehabs.reduce((s: number, r: any) => s + r.budgetCents, 0);
      const totalSpent = activeRehabs.reduce((s: number, r: any) => s + r.spentCents, 0);

      // Stalled draws — past inspection date and not funded yet.
      const today = clock.now().toISOString().slice(0, 10);
      const stalledRows = await db.execute(sql`
        SELECT COUNT(*) AS c
        FROM construction_draws cd
        WHERE cd.organization_id = ${orgId}
          AND cd.status IN ('requested', 'inspected')
          AND cd.inspection_at IS NOT NULL
          AND cd.inspection_at <= ${today}::date
          AND cd.funded_at IS NULL
      `);
      const stalledDraws = Number(((stalledRows as any).rows?.[0]?.c) ?? 0);

      // YTD-eligible 1099 contractors (over $600 paid this year, not excluded).
      const taxYear = clock.now().getFullYear();
      const necRows = await db.execute(sql`
        SELECT COUNT(*) AS c FROM (
          SELECT contractor_id, SUM(amount_cents) AS total
          FROM contractor_payments
          WHERE organization_id = ${orgId}
            AND tax_year = ${taxYear}
            AND excluded_from_1099 = false
          GROUP BY contractor_id
          HAVING SUM(amount_cents) >= 60000
        ) t
      `);
      const necEligible = Number(((necRows as any).rows?.[0]?.c) ?? 0);

      return res.json({
        hasData: true,
        activeRehabs,
        totals: {
          totalBudgetCents: totalBudget,
          totalSpentCents: totalSpent,
          spentPct: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0,
        },
        stalledDraws,
        necEligible,
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  app.post("/api/rehabs/:id/seed-template", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = seedTemplateSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const tpl = TEMPLATES_BY_KEY.get(parsed.data.templateKey);
      if (!tpl) return Errors.badRequest(res, `Unknown template ${parsed.data.templateKey}`);

      const [r] = await db.select({ id: rehabs.id, propertyId: rehabs.propertyId }).from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");
      if (!(await refuseRedeemableDeedSpend(res, orgId, r.propertyId, "Seeding a rehab budget"))) return;

      if (parsed.data.replaceExisting && (await estimateLockedFor(orgId, r.id as string))) {
        return Errors.badRequest(res, ESTIMATE_LOCK_MESSAGE, { field: "replaceExisting" });
      }
      if (parsed.data.replaceExisting) {
        await db.delete(rehabLineItems)
          .where(and(eq(rehabLineItems.rehabId, r.id as string), eq(rehabLineItems.organizationId, orgId)));
      }

      const [maxRow] = await db.execute(sql`SELECT COALESCE(MAX(sequence), -1) AS m FROM rehab_line_items WHERE rehab_id = ${r.id}`).then((res: any) => res.rows ?? []);
      let seq = (Number((maxRow as any)?.m) ?? -1) + 1;

      const inserts = templateLineItems(tpl).map((line) => ({
        organizationId: orgId,
        rehabId: r.id as string,
        sequence: seq++,
        category: line.category,
        scope: line.scope,
        budgetCents: line.budgetCents,
        committedCents: 0,
        spentCents: 0,
      }));
      const inserted = await db.insert(rehabLineItems).values(inserts).returning();
      await recomputeRehabSpend(orgId, r.id as string);

      return res.status(201).json({ inserted: inserted.length, budgetsEntered: false });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Leg 3: kickoff baselines (append-only) ────────────────────────────
  //
  // A baseline is what the operator planned at kickoff. Revising it is a NEW
  // row that points at the one it supersedes — never an edit. There is no
  // update route and no delete route, and migrations/0306 refuses both by
  // trigger, so the denominator variance is measured against cannot move.
  app.post("/api/rehabs/:id/baselines", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = baselineSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select({ id: rehabs.id }).from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      // The revision chain hangs off the rehab's latest baseline. The first
      // baseline has none — it is the original.
      const [previous] = await db
        .select({ id: rehabBaselines.id })
        .from(rehabBaselines)
        .where(and(eq(rehabBaselines.rehabId, r.id), eq(rehabBaselines.organizationId, orgId)))
        .orderBy(desc(rehabBaselines.createdAt))
        .limit(1);

      const [baseline] = await db.insert(rehabBaselines).values({
        organizationId: orgId,
        rehabId: r.id,
        supersedesId: previous?.id ?? null,
        plannedStartDate: parsed.data.plannedStartDate ?? null,
        plannedListingDate: parsed.data.plannedListingDate ?? null,
        plannedHoldMonths: parsed.data.plannedHoldMonths ?? null,
        plannedHoldingMonthlyCents: parsed.data.plannedHoldingMonthlyCents ?? null,
        phasePlans: parsed.data.phasePlans ?? [],
        recordedBy: getUserId(req),
      }).returning();

      return res.json({ baseline });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Leg 3: recorded holding-cost entries (append-only) ────────────────
  //
  // Only recorded costs live here; the monthly figure on the rehab is a plan,
  // not spend, and the daily meter is an accrual, not a ledger. A correction is
  // a NEW negative entry whose note says what it corrects.
  app.post("/api/rehabs/:id/holding-entries", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = holdingEntrySchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select({ id: rehabs.id }).from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const [entry] = await db.insert(rehabHoldingCostEntries).values({
        organizationId: orgId,
        rehabId: r.id,
        entryDate: parsed.data.entryDate,
        category: parsed.data.category,
        amountCents: parsed.data.amountCents,
        note: parsed.data.note ?? null,
        recordedBy: getUserId(req),
      }).returning();

      return res.json({ entry });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Leg 4: change orders (decided once) ───────────────────────────────
  const changeOrderSchema = z.object({
    lineItemId: z.string().uuid(),
    description: z.string().trim().min(1).max(500),
    amountCents: z.number().int().refine((n) => n !== 0, {
      message: "A change order of $0 adjusts nothing — price the change, or don't record it.",
    }),
    scheduleImpactDays: z.number().int().min(-730).max(3650).default(0),
  });

  app.post("/api/rehabs/:id/change-orders", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = changeOrderSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select({ id: rehabs.id }).from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const [line] = await db.select({ id: rehabLineItems.id }).from(rehabLineItems)
        .where(and(
          eq(rehabLineItems.id, parsed.data.lineItemId),
          eq(rehabLineItems.rehabId, r.id),
          eq(rehabLineItems.organizationId, orgId),
        ));
      if (!line) return Errors.notFound(res, "Line item");

      const [changeOrder] = await db.insert(rehabChangeOrders).values({
        organizationId: orgId,
        rehabId: r.id,
        lineItemId: line.id,
        description: parsed.data.description,
        amountCents: parsed.data.amountCents,
        scheduleImpactDays: parsed.data.scheduleImpactDays,
        status: "proposed",
        recordedBy: getUserId(req),
      }).returning();

      return res.json({ changeOrder });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  const decideSchema = z.object({ decision: z.enum(["approved", "rejected"]) });

  app.post("/api/rehabs/:id/change-orders/:orderId/decide", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = decideSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select({ id: rehabs.id }).from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      const [order] = await db.select().from(rehabChangeOrders)
        .where(and(
          eq(rehabChangeOrders.id, routeParam(req.params.orderId)),
          eq(rehabChangeOrders.rehabId, r.id),
          eq(rehabChangeOrders.organizationId, orgId),
        ));
      if (!order) return Errors.notFound(res, "Change order");

      const alreadyDecided = (o: { status: string; decidedBy: string | null; decidedAt: Date | null }) =>
        Errors.badRequest(
          res,
          `This change order was already ${o.status}${o.decidedBy ? ` by ${o.decidedBy}` : ""}${o.decidedAt ? ` on ${o.decidedAt.toISOString()}` : ""}; a change order is decided once.`,
        );
      if (order.status !== "proposed") return alreadyDecided(order);

      const [updated] = await db.update(rehabChangeOrders)
        .set({ status: parsed.data.decision, decidedBy: getUserId(req), decidedAt: clock.now() })
        .where(and(
          eq(rehabChangeOrders.id, order.id),
          eq(rehabChangeOrders.rehabId, r.id),
          eq(rehabChangeOrders.organizationId, orgId),
          eq(rehabChangeOrders.status, "proposed"),
        ))
        .returning();
      if (!updated) {
        // Lost the race: someone decided it between our read and our write.
        const [now] = await db.select().from(rehabChangeOrders)
          .where(and(eq(rehabChangeOrders.id, order.id), eq(rehabChangeOrders.organizationId, orgId)));
        return now ? alreadyDecided(now) : Errors.notFound(res, "Change order");
      }

      return res.json({ changeOrder: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Leg 4: the exit decision (recorded through the decision store) ────
  const exitDecisionSchema = z.object({
    exitKind: z.enum(["sell", "hold", "wholesale"]),
    expectedPriceCents: z.number().int().positive().nullable(),
    rationale: z.string().trim().min(10).max(2000),
    // Required-nullable, as the underwriting kit's reviewDueAt: a past date
    // would be due the instant it was recorded.
    reviewDueAt: z
      .string()
      .datetime()
      .nullable()
      .refine((d) => d === null || new Date(d).getTime() > clock.nowMs(), {
        message: "A review date must be in the future.",
      }),
  });

  const EXIT_STATUSES: readonly string[] = ["listed", "under_contract", "closed"];

  app.post("/api/rehabs/:id/exit-decision", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const userId = getUserId(req);
      const parsed = exitDecisionSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
      const body = parsed.data;

      const [r] = await db.select().from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      if (!EXIT_STATUSES.includes(r.status)) {
        return Errors.badRequest(
          res,
          `The exit decision is recorded at the operator's act from the listing onward; this project is "${r.status}".`,
          { field: "status" },
        );
      }

      const price = body.expectedPriceCents;
      if ((body.exitKind === "sell" || body.exitKind === "wholesale") && price === null) {
        return Errors.badRequest(
          res,
          `The asking/expected price as stated is part of the exit record for a ${body.exitKind}; state it, or choose hold.`,
          { field: "expectedPriceCents" },
        );
      }

      const kind = body.exitKind === "hold" ? "hold" : "dispose";
      const choice =
        body.exitKind === "sell"
          ? `Sell — asking ${usd(price as number)}`
          : body.exitKind === "wholesale"
            ? `Wholesale — assign the contract, expected ${usd(price as number)}`
            : `Hold as a rental${price !== null ? ` — expected value ${usd(price)}` : ""}`;

      const assumptions: ScenarioAssumption[] = [
        { key: "exit_kind", value: body.exitKind, origin: "user", basis: `The exit the operator chose for this project: ${body.exitKind}.` },
        ...(price !== null
          ? [{ key: "exit_expected_price_cents", value: price, unit: "cents", origin: "user" as const, basis: "The asking/expected price as stated by the operator." }]
          : []),
        { key: "exit_rehab_id", value: String(r.id), origin: "derived", basis: "The rehab project this exit was recorded on." },
        { key: "exit_status_at_record", value: r.status, origin: "derived", basis: "The project's status when the exit was recorded." },
      ];

      const scenario = await latestFlipScenario(orgId, r.propertyId);
      const scenarioIds = scenario ? [scenario.id] : [];

      try {
        const recorded = await recordDecision(
          orgId,
          {
            subjectType: "property",
            subjectId: r.propertyId,
            kind,
            choice,
            rationale: body.rationale,
            actorType: "user",
            actorRef: userId,
            authority: "org_member:flip_exit",
            strategyPackId: "fix_and_flip",
            strategyPackVersion: null,
            assumptions,
            alternatives: [],
            reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt) : null,
          },
          clock.now(),
          scenarioIds,
        );
        return res.json({
          decisionId: recorded.id,
          kind,
          exitKind: body.exitKind,
          choice,
          reviewDueAt: body.reviewDueAt ? new Date(body.reviewDueAt).toISOString() : null,
          recordKind: "decision",
        });
      } catch (err) {
        if (err instanceof UnavailableScenarioError) return Errors.badRequest(res, err.message);
        return Errors.internal(res, err);
      }
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── Leg 4: realized economics (written once, at close) ────────────────
  const realizedSchema = z.object({
    salePriceCents: z.number().int().min(0),
    sellingCostsCents: z.number().int().min(0),
    closingDate: dateOnly.refine((d) => Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, {
      message: "Expected a real calendar date (YYYY-MM-DD)",
    }),
  });

  app.post("/api/rehabs/:id/realized", isAuthenticated, getOrCreateOrg, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const orgId = getOrganizationId(req);
      const parsed = realizedSchema.safeParse(req.body);
      if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);

      const [r] = await db.select().from(rehabs)
        .where(and(eq(rehabs.id, routeParam(req.params.id)), eq(rehabs.organizationId, orgId)));
      if (!r) return Errors.notFound(res, "Rehab");

      if (r.status !== "closed") {
        return Errors.badRequest(
          res,
          `Realized economics are recorded at close, when the outcome is a fact; this project is "${r.status}".`,
          { field: "status" },
        );
      }
      if (r.realizedRecordedAt) {
        return Errors.badRequest(
          res,
          `Realized economics were already recorded (sale price ${r.realizedSalePriceCents != null ? usd(Number(r.realizedSalePriceCents)) : "not stated"}, selling costs ${r.realizedSellingCostsCents != null ? usd(Number(r.realizedSellingCostsCents)) : "not stated"}, closing ${r.realizedClosingDate ?? "not stated"}, recorded ${iso(r.realizedRecordedAt)}); recorded facts are not edited.`,
        );
      }

      const [updated] = await db.update(rehabs)
        .set({
          realizedSalePriceCents: parsed.data.salePriceCents,
          realizedSellingCostsCents: parsed.data.sellingCostsCents,
          realizedClosingDate: parsed.data.closingDate,
          realizedRecordedBy: getUserId(req),
          realizedRecordedAt: clock.now(),
        })
        .where(and(
          eq(rehabs.id, r.id),
          eq(rehabs.organizationId, orgId),
          sql`${rehabs.realizedRecordedAt} IS NULL`,
        ))
        .returning();
      if (!updated) {
        return Errors.badRequest(res, "Realized economics were already recorded; recorded facts are not edited.");
      }

      const items = await db.select().from(rehabLineItems)
        .where(and(eq(rehabLineItems.rehabId, r.id), eq(rehabLineItems.organizationId, orgId)));
      const holding = await db.select().from(rehabHoldingCostEntries)
        .where(and(eq(rehabHoldingCostEntries.rehabId, r.id), eq(rehabHoldingCostEntries.organizationId, orgId)));
      const scenario = await latestFlipScenario(orgId, r.propertyId);

      const realized = realizedBlock(updated, {
        rehabSpentCents: items.reduce((sum, i) => sum + i.spentCents, 0),
        rehabLineCount: items.length,
        holdingEntriesTotalCents: holding.reduce((sum, e) => sum + (Number(e.amountCents) || 0), 0),
        holdingEntryCount: holding.length,
        scenario,
      });
      return res.json({ realized });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
