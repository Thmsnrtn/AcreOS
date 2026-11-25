/**
 * Pax fix-and-flip tool family (promised bar item (c), gap-sheet work item 4).
 *
 * The reads and the record changes go through the SAME records the REST
 * routes use (server/routes-rehabs.ts): the rehabs / rehab_line_items /
 * rehab_baselines / rehab_status_transitions / rehab_holding_cost_entries /
 * rehab_change_orders tables, the shared pure math in @shared/rehab
 * (variance, timeline, changeOrders, realized grading), the latest flip_mao
 * scenario row, and — for an exit decision — the one decision store
 * (`recordDecision`, pack "fix_and_flip") the exit-decision route writes
 * through. The organization always comes from the session (`orgId`), never
 * from a model-supplied argument.
 *
 * FD5: there is NO send tool here of any kind — no contractor message, no
 * lender notice, nothing outbound. Pax reads and records; anything that
 * would leave AcreOS stays on the operator's own surfaces behind a human tap.
 *
 * Ask-before (record_exit_facts): an exit decision and the realized facts
 * are write-once, consequential records, so the tool sits in
 * APPROVAL_REQUIRED_TOOLS (server/services/approvalKernel.ts). A model call
 * never executes it: executeTool freezes the call as a pending ask and only
 * the customer's tap replays it, witnessed by the kernel's audit. The
 * functions below run ONLY on that trusted replay (and in tests that call
 * them directly).
 *
 * Append-only (append_holding_cost_entry): a holding-cost entry is an
 * immutable fact (migration 0306 installs the guard). A correction is a NEW
 * negative entry whose note says what it corrects — never an edit.
 *
 * Coverage honesty (RW-D): every read states its slice — this account's
 * rehab projects and the records entered on them, nothing else.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  rehabs,
  rehabLineItems,
  rehabBaselines,
  rehabStatusTransitions,
  rehabHoldingCostEntries,
  rehabChangeOrders,
  scenarios,
  REHAB_STATUSES,
  REHAB_HOLDING_CATEGORIES,
} from "@shared/schema";
import { toolRefusal, type RefusalParts } from "@shared/refusal/plainRefusal";
import { lineVariance, projectVariance, varianceFlags } from "@shared/rehab/variance";
import {
  originalBaseline,
  phaseVariances,
  listingVarianceDays,
  holdingComparison,
} from "@shared/rehab/timeline";
import type { BaselineLike, TransitionLike } from "@shared/rehab/timeline";
import {
  approvedAmountByLine,
  approvedScheduleDays,
  effectiveEstimateCents,
  projectChangeOrderTotals,
} from "@shared/rehab/changeOrders";
import type { ChangeOrderLike } from "@shared/rehab/changeOrders";
import { gradeRealized } from "@shared/rehab/realized";
import type { ScenarioAssumption } from "@shared/economics/scenario";
import { isCalendarDate } from "@shared/dates/calendar";
import { clock } from "../utils/clock";

export type FlipToolOutcome =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; refusal: RefusalParts };

type WithReceipt = FlipToolOutcome & {
  receipt?: { before: unknown; after: unknown; description: string };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIST_CAP = 100;

const FLIP_BOOK_NOT_COVERED =
  "It does not include projects, costs or analyses kept in another system, or any other account's rehabs.";

function coverage(what: string): string {
  return `Coverage: ${what} ${FLIP_BOOK_NOT_COVERED}`;
}

const noRehab = (): FlipToolOutcome => ({
  ok: false,
  refusal: {
    what: "No rehab project with that id is in this account",
    why: "It may have been removed, or the id came from another list",
    unlock: "Ask me to list your rehab projects and pick the one you mean",
  },
});

const badRehabId = (): FlipToolOutcome => ({
  ok: false,
  refusal: {
    what: "That is not a rehab project id",
    why: "Rehab ids are long identifiers, not the project name or the property address",
    unlock: "Ask me to list your rehab projects and use the id it shows",
  },
});

async function loadRehab(orgId: number, rehabId: unknown) {
  if (typeof rehabId !== "string" || !UUID.test(rehabId.trim())) return "bad_id" as const;
  const { db } = await import("../db");
  const [row] = await db
    .select()
    .from(rehabs)
    .where(and(eq(rehabs.id, rehabId.trim()), eq(rehabs.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

type RehabRow = typeof rehabs.$inferSelect;

function shapeRehab(row: RehabRow) {
  return {
    id: row.id,
    propertyId: row.propertyId,
    name: row.name,
    status: row.status,
    startedAt: row.startedAt ?? null,
    plannedListingDate: row.plannedListingDate ?? null,
    actualListingDate: row.actualListingDate ?? null,
    closedAt: row.closedAt ?? null,
    purchasePriceCents: row.purchasePriceCents ?? null,
    purchaseClosingCents: row.purchaseClosingCents ?? null,
    budgetTotalCents: row.budgetTotalCents ?? null,
    spentTotalCents: row.spentTotalCents ?? null,
    holdingCostMonthlyCents: row.holdingCostMonthlyCents ?? null,
    arvCents: row.arvCents ?? null,
    targetMarginCents: row.targetMarginCents ?? null,
    realized:
      row.realizedRecordedAt == null
        ? null
        : {
            salePriceCents: row.realizedSalePriceCents ?? null,
            sellingCostsCents: row.realizedSellingCostsCents ?? null,
            closingDate: row.realizedClosingDate ?? null,
            recordedBy: row.realizedRecordedBy ?? null,
            recordedAt:
              row.realizedRecordedAt instanceof Date
                ? row.realizedRecordedAt.toISOString()
                : String(row.realizedRecordedAt),
          },
  };
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function assumptionOrigin(
  assumptions: ReadonlyArray<{ key: string; origin: string }> | null | undefined,
  key: string,
): string | null {
  const found = (assumptions ?? []).find((a) => a && a.key === key);
  return found ? String(found.origin) : null;
}

/** The latest flip_mao scenario row for a property, as the rehab routes read it. */
async function latestFlipScenario(orgId: number, propertyId: number) {
  const { db } = await import("../db");
  const [row] = await db
    .select()
    .from(scenarios)
    .where(
      and(
        eq(scenarios.organizationId, orgId),
        eq(scenarios.subjectType, "property"),
        eq(scenarios.subjectId, propertyId),
        eq(scenarios.engineId, "flip_mao"),
      ),
    )
    .orderBy(desc(scenarios.computedAt))
    .limit(1);
  return row ?? null;
}

type ScenarioRow = NonNullable<Awaited<ReturnType<typeof latestFlipScenario>>>;

function shapeScenario(row: ScenarioRow) {
  return {
    id: row.id,
    label: row.label,
    engineId: row.engineId,
    engineVersion: row.engineVersion,
    strategyPackId: row.strategyPackId ?? null,
    computedAt: row.computedAt instanceof Date ? row.computedAt.toISOString() : String(row.computedAt),
    inputs: row.inputs ?? {},
    // The evidence the number rests on, verbatim: every assumption with the
    // origin the analyzer recorded for it. Never summarized away.
    assumptions: (row.assumptions ?? []).map((a) => ({
      key: a.key,
      value: a.value ?? null,
      unit: a.unit ?? null,
      origin: a.origin,
      basis: a.basis ?? null,
    })),
    metrics: (row.metrics ?? []).map((m) => ({ id: m.id, value: m.value ?? null, unit: m.unit ?? null })),
  };
}

/** This account's rehab projects, newest activity first, with a status filter. */
export async function paxGetRehabProjects(
  orgId: number,
  args: { status?: string },
): Promise<FlipToolOutcome> {
  const { db } = await import("../db");
  const conditions = [eq(rehabs.organizationId, orgId)];
  const filters: string[] = [];
  const status = typeof args.status === "string" ? args.status.trim() : "";
  if (status && (REHAB_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(rehabs.status, status as RehabRow["status"]));
    filters.push(`status ${status}`);
  } else {
    filters.push("every status");
  }
  const rows = await db
    .select()
    .from(rehabs)
    .where(and(...conditions))
    .orderBy(desc(rehabs.updatedAt))
    .limit(LIST_CAP + 1);
  const shown = rows.slice(0, LIST_CAP);
  const capped = rows.length > LIST_CAP;
  return {
    ok: true,
    data: {
      coverage:
        coverage(
          `this answer reads THIS account's rehab projects only (${shown.length} shown — ${filters.join(", ")}). ` +
            "An account with no rehab projects is reported as empty, never as on budget or on schedule.",
        ) + (capped ? ` The list is capped at ${LIST_CAP}, most recently updated first; more exist.` : ""),
      asOf: clock.now().toISOString().slice(0, 10),
      projects: shown.map(shapeRehab),
      capped,
    },
  };
}

/**
 * One rehab in full: line variance against the estimate (with approved
 * change orders folded into the effective estimate), the timeline truth
 * (original baseline vs the status log), recorded holding costs, change
 * orders, exit decisions and the realized grading — the same blocks, and
 * the same shared math, as GET /api/rehabs/:id.
 */
export async function paxGetRehabDetail(orgId: number, rehabId: unknown): Promise<FlipToolOutcome> {
  const rehab = await loadRehab(orgId, rehabId);
  if (rehab === "bad_id") return badRehabId();
  if (!rehab) return noRehab();
  const { db } = await import("../db");
  const items = await db
    .select()
    .from(rehabLineItems)
    .where(and(eq(rehabLineItems.rehabId, rehab.id), eq(rehabLineItems.organizationId, orgId)))
    .orderBy(asc(rehabLineItems.sequence), asc(rehabLineItems.createdAt));
  const baselines = await db
    .select()
    .from(rehabBaselines)
    .where(and(eq(rehabBaselines.rehabId, rehab.id), eq(rehabBaselines.organizationId, orgId)))
    .orderBy(asc(rehabBaselines.createdAt));
  const transitions = await db
    .select()
    .from(rehabStatusTransitions)
    .where(and(eq(rehabStatusTransitions.rehabId, rehab.id), eq(rehabStatusTransitions.organizationId, orgId)))
    .orderBy(asc(rehabStatusTransitions.transitionedAt));
  const holdingEntries = await db
    .select()
    .from(rehabHoldingCostEntries)
    .where(and(eq(rehabHoldingCostEntries.rehabId, rehab.id), eq(rehabHoldingCostEntries.organizationId, orgId)))
    .orderBy(asc(rehabHoldingCostEntries.entryDate), asc(rehabHoldingCostEntries.createdAt));
  const changeOrderRows = await db
    .select()
    .from(rehabChangeOrders)
    .where(and(eq(rehabChangeOrders.rehabId, rehab.id), eq(rehabChangeOrders.organizationId, orgId)))
    .orderBy(asc(rehabChangeOrders.createdAt));

  const varianceLines = items.map((it) => ({
    id: String(it.id),
    category: it.category,
    scope: it.scope,
    budgetCents: it.budgetCents,
    committedCents: it.committedCents,
    spentCents: it.spentCents,
  }));
  const ordersForMath: ChangeOrderLike[] = changeOrderRows.map((o) => ({
    id: String(o.id),
    lineItemId: String(o.lineItemId),
    description: o.description,
    amountCents: Number(o.amountCents),
    scheduleImpactDays: o.scheduleImpactDays,
    status: o.status,
    decidedBy: o.decidedBy ?? null,
    decidedAt: o.decidedAt instanceof Date ? o.decidedAt.toISOString() : o.decidedAt ? String(o.decidedAt) : null,
    recordedBy: o.recordedBy,
    createdAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
  }));
  const approvedByLine = approvedAmountByLine(ordersForMath);
  const changeOrderTotals = projectChangeOrderTotals(varianceLines, ordersForMath);

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

  let daysOnSite: number | null = null;
  if (rehab.startedAt) {
    const startedMs = new Date(rehab.startedAt as unknown as string).getTime();
    if (Number.isFinite(startedMs)) daysOnSite = Math.floor((clock.nowMs() - startedMs) / 86_400_000);
  }
  const holdingDaily = rehab.holdingCostMonthlyCents ? Math.round(rehab.holdingCostMonthlyCents / 30) : null;
  const accruedHoldingCents = holdingDaily !== null && daysOnSite !== null ? holdingDaily * daysOnSite : null;

  const scenario = await latestFlipScenario(orgId, rehab.propertyId);
  const scenarioBlock = scenario
    ? {
        holdMonths: numberOrNull(scenario.inputs?.["holdMonths"]),
        monthlyHoldingCostCents: numberOrNull(scenario.inputs?.["monthlyHoldingCostCents"]),
        holdMonthsOrigin: assumptionOrigin(scenario.assumptions, "rule_hold_months"),
        monthlyOrigin: assumptionOrigin(scenario.assumptions, "holdingCost"),
      }
    : null;
  const approvedDays = approvedScheduleDays(ordersForMath);

  const { decisionsForSubject } = await import("../services/decisions/decisionStore");
  const exitDecisions = (await decisionsForSubject(orgId, "property", rehab.propertyId))
    .filter(
      (d) =>
        d.body.strategyPackId === "fix_and_flip" &&
        d.body.assumptions.some((a) => a.key === "exit_kind"),
    )
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
        reviewDueAt: d.body.reviewDueAt ? d.body.reviewDueAt.toISOString() : null,
      };
    });

  const totalSpent = items.reduce((s, i) => s + i.spentCents, 0);
  const scenarioFacts = scenario
    ? {
        arvCents: numberOrNull(scenario.inputs?.["arvCents"]),
        profitCents: numberOrNull(scenario.metrics.find((m) => m.id === "profit")?.value),
        roiRatio: numberOrNull(scenario.metrics.find((m) => m.id === "roi")?.value),
        holdMonths: numberOrNull(scenario.inputs?.["holdMonths"]),
      }
    : null;
  const realized =
    rehab.realizedRecordedAt == null ||
    rehab.realizedSalePriceCents == null ||
    rehab.realizedSellingCostsCents == null ||
    rehab.realizedClosingDate == null
      ? { facts: shapeRehab(rehab).realized, grading: null, scenario: scenarioFacts }
      : {
          facts: shapeRehab(rehab).realized,
          grading: gradeRealized({
            facts: {
              salePriceCents: Number(rehab.realizedSalePriceCents),
              sellingCostsCents: Number(rehab.realizedSellingCostsCents),
              closingDate: String(rehab.realizedClosingDate),
            },
            purchasePriceCents: rehab.purchasePriceCents ?? null,
            purchaseClosingCents: rehab.purchaseClosingCents ?? null,
            rehabSpentCents: totalSpent,
            rehabLineCount: items.length,
            holdingEntriesTotalCents: entriesTotalCents,
            holdingEntryCount: holdingEntries.length,
            startedAt: rehab.startedAt ? String(rehab.startedAt) : null,
            scenario: scenarioFacts,
          }),
          scenario: scenarioFacts,
        };

  return {
    ok: true,
    data: {
      coverage: coverage(
        "this answer reads ONE rehab project in THIS account — its scope lines, kickoff baseline, status log, " +
          "recorded holding-cost entries, change orders, exit decisions and realized facts as recorded here. " +
          "It shows what is recorded, not costs paid outside AcreOS and never recorded.",
      ),
      asOf: clock.now().toISOString().slice(0, 10),
      rehab: shapeRehab(rehab),
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
      timeline: {
        baselines: baselinesForMath.map((b) => ({
          ...b,
          isOriginal: original !== null && original.id === b.id,
        })),
        transitions: transitionsForMath,
        schedule: {
          phases: phaseVariances(original, transitionsForMath),
          listingVarianceDays: listingVarianceDays(original, rehab.actualListingDate ?? null, transitionsForMath),
          approvedChangeOrderDays: approvedDays,
        },
        holding: holdingComparison({
          scenario: scenarioBlock,
          baseline: original,
          entriesTotalCents,
          elapsedDays: daysOnSite,
          meterAccruedCents: accruedHoldingCents,
        }),
      },
      holdingEntries: holdingEntries.map((e) => ({
        id: e.id,
        entryDate: e.entryDate,
        category: e.category,
        amountCents: Number(e.amountCents),
        note: e.note ?? null,
        recordedBy: e.recordedBy,
      })),
      holdingEntriesTotalCents: entriesTotalCents,
      changeOrders: { orders: ordersForMath, totals: changeOrderTotals },
      exitDecisions,
      realized,
      totals: {
        budgetCents: items.reduce((s, i) => s + i.budgetCents, 0),
        committedCents: items.reduce((s, i) => s + i.committedCents, 0),
        spentCents: totalSpent,
        varianceCents: totalSpent - items.reduce((s, i) => s + i.budgetCents, 0),
        daysOnSite,
        accruedHoldingCents,
      },
    },
  };
}

/**
 * The latest flip_mao analysis recorded for a property (or for a rehab's
 * property): the frozen scenario — inputs, metrics and every assumption
 * with its origin and basis (the evidence) — plus the latest fix_and_flip
 * decision recorded for the property. Absence is stated, never rebuilt.
 */
export async function paxGetFlipAnalysis(
  orgId: number,
  args: { property_id?: unknown; rehab_id?: unknown },
): Promise<FlipToolOutcome> {
  let propertyId: number | null = null;
  if (args.rehab_id !== undefined && args.rehab_id !== null && args.rehab_id !== "") {
    const rehab = await loadRehab(orgId, args.rehab_id);
    if (rehab === "bad_id") return badRehabId();
    if (!rehab) return noRehab();
    propertyId = rehab.propertyId;
  } else {
    const n = typeof args.property_id === "number" ? args.property_id : Number(args.property_id);
    if (!Number.isInteger(n) || n <= 0) {
      return {
        ok: false,
        refusal: {
          what: "That is not a property number",
          why: "Flip analyses are recorded against a property in this account, by its number — or against a rehab project, by its id",
          unlock: "Ask me for your properties or your rehab projects and use the number or id shown there",
        },
      };
    }
    propertyId = n;
  }
  const scenario = await latestFlipScenario(orgId, propertyId);
  if (!scenario) {
    return {
      ok: true,
      data: {
        coverage: coverage("this answer reads THIS account's recorded flip analyses only."),
        propertyId,
        analysis: null,
        statement:
          "No flip analysis (flip_mao) is recorded for this property in this account. " +
          "Say exactly that — do not reconstruct one from the property's numbers.",
      },
    };
  }
  const { decisionsForSubject } = await import("../services/decisions/decisionStore");
  const decisions = (await decisionsForSubject(orgId, "property", propertyId)).filter(
    (d) => d.body.strategyPackId === "fix_and_flip",
  );
  const latest = decisions[0] ?? null;
  return {
    ok: true,
    data: {
      coverage: coverage(
        "this answer reads THIS account's recorded flip analyses only — the analysis as frozen when it was computed, " +
          "on the inputs and assumptions shown. It is a screen the operator ran, not a valuation or a lender determination.",
      ),
      propertyId,
      analysis: shapeScenario(scenario),
      decision: latest
        ? {
            id: latest.id,
            kind: latest.body.kind,
            choice: latest.body.choice,
            rationale: latest.body.rationale,
            decidedAt: latest.decidedAt.toISOString(),
            reviewDueAt: latest.body.reviewDueAt ? latest.body.reviewDueAt.toISOString() : null,
            citesThisScenario: (latest.body.scenarios ?? []).some((s) => s.scenarioId === scenario.id),
          }
        : null,
    },
  };
}

/**
 * Append ONE holding-cost entry to a rehab — the same append-only fact the
 * holding-entries route records. A correction is a new negative entry whose
 * note says what it corrects; the original entry is never edited.
 */
export async function paxAppendHoldingCostEntry(
  orgId: number,
  userId: string | null | undefined,
  args: Record<string, unknown>,
): Promise<WithReceipt> {
  const rehab = await loadRehab(orgId, args.rehab_id);
  if (rehab === "bad_id") return badRehabId();
  if (!rehab) return noRehab();
  const entryDate = typeof args.entry_date === "string" ? args.entry_date : "";
  const category = typeof args.category === "string" ? args.category : "";
  const amountCents = typeof args.amount_cents === "number" ? args.amount_cents : Number(args.amount_cents);
  const note = typeof args.note === "string" ? args.note.slice(0, 2000) : null;
  if (
    !DATE.test(entryDate) ||
    !isCalendarDate(entryDate) ||
    !(REHAB_HOLDING_CATEGORIES as readonly string[]).includes(category) ||
    !Number.isInteger(amountCents) ||
    amountCents === 0
  ) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the rehab",
        why: "A holding-cost entry needs a real date (YYYY-MM-DD), one of the holding categories (taxes, insurance, utilities, interest, hoa, other), and a non-zero whole-cent amount — a correction is a negative entry, never zero",
        unlock: "Give the date, the category and the amount, then I will record it",
      },
    };
  }
  const today = clock.now().toISOString().slice(0, 10);
  if (entryDate > today) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the rehab",
        why: "That date is in the future — a holding cost is recorded once it has been incurred",
        unlock: "Tell me again once it has been incurred, with the real date",
      },
    };
  }
  const { db } = await import("../db");
  const entry = {
    entryDate,
    category: category as (typeof REHAB_HOLDING_CATEGORIES)[number],
    amountCents,
    note,
  };
  await db.insert(rehabHoldingCostEntries).values({
    organizationId: orgId,
    rehabId: rehab.id,
    ...entry,
    recordedBy: userId ?? "pax",
  });
  return {
    ok: true,
    data: {
      message:
        "Recorded the holding-cost entry on the rehab. This is a record of a cost the customer incurred — " +
        "AcreOS paid nothing and sent nothing.",
      rehabId: rehab.id,
      entry,
    },
    receipt: {
      before: { rehabId: rehab.id },
      after: { rehabId: rehab.id, entry },
      description: `Recorded a holding-cost entry (${entry.category}, ${amountCents} cents, ${entryDate}) on rehab ${rehab.name}`,
    },
  };
}

const EXIT_KINDS = ["sell", "hold", "wholesale"] as const;
const EXIT_STATUSES: readonly string[] = ["listed", "under_contract", "closed"];

/**
 * Record the exit decision OR the realized facts for a rehab — the same
 * records, and the same rules, as POST /api/rehabs/:id/exit-decision and
 * POST /api/rehabs/:id/realized. ASK-BEFORE: this function is reachable
 * only on the approval kernel's trusted replay (see the file header); a
 * model call is frozen as an ask and never reaches here.
 */
export async function paxRecordExitFacts(
  orgId: number,
  userId: string | null | undefined,
  args: Record<string, unknown>,
): Promise<WithReceipt> {
  const rehab = await loadRehab(orgId, args.rehab_id);
  if (rehab === "bad_id") return badRehabId();
  if (!rehab) return noRehab();

  if (args.kind === "realized") {
    const salePriceCents = typeof args.sale_price_cents === "number" ? args.sale_price_cents : Number(args.sale_price_cents);
    const sellingCostsCents =
      typeof args.selling_costs_cents === "number" ? args.selling_costs_cents : Number(args.selling_costs_cents);
    const closingDate = typeof args.closing_date === "string" ? args.closing_date : "";
    if (
      !Number.isInteger(salePriceCents) ||
      salePriceCents < 0 ||
      !Number.isInteger(sellingCostsCents) ||
      sellingCostsCents < 0 ||
      !DATE.test(closingDate) ||
      !isCalendarDate(closingDate)
    ) {
      return {
        ok: false,
        refusal: {
          what: "Nothing was recorded on the rehab",
          why: "Realized facts need the sale price and selling costs in whole cents (zero or more) and the real closing date (YYYY-MM-DD)",
          unlock: "Give the sale price, the selling costs and the closing date, then ask me again",
        },
      };
    }
    if (rehab.status !== "closed") {
      return {
        ok: false,
        refusal: {
          what: "Nothing was recorded on the rehab",
          why: `Realized economics are recorded at close, when the outcome is a fact; this project is "${rehab.status}"`,
          unlock: "Record the realized facts once the project has closed",
        },
      };
    }
    if (rehab.realizedRecordedAt) {
      return {
        ok: false,
        refusal: {
          what: "Nothing was recorded on the rehab",
          why: "Realized economics were already recorded for this project; recorded facts are not edited",
          unlock: "Ask me for the rehab's recorded realized facts instead",
        },
      };
    }
    const { db } = await import("../db");
    const [updated] = await db
      .update(rehabs)
      .set({
        realizedSalePriceCents: salePriceCents,
        realizedSellingCostsCents: sellingCostsCents,
        realizedClosingDate: closingDate,
        realizedRecordedBy: userId ?? "pax",
        realizedRecordedAt: clock.now(),
      })
      .where(and(eq(rehabs.id, rehab.id), eq(rehabs.organizationId, orgId), sql`${rehabs.realizedRecordedAt} IS NULL`))
      .returning();
    if (!updated) {
      return {
        ok: false,
        refusal: {
          what: "Nothing was recorded on the rehab",
          why: "Realized economics were already recorded for this project; recorded facts are not edited",
          unlock: "Ask me for the rehab's recorded realized facts instead",
        },
      };
    }
    return {
      ok: true,
      data: {
        message:
          "Recorded the realized facts on the rehab, as approved. This records the outcome the customer reported — " +
          "AcreOS moved no money and sent nothing.",
        rehabId: rehab.id,
        realized: { salePriceCents, sellingCostsCents, closingDate },
      },
      receipt: {
        before: { rehabId: rehab.id, realized: null },
        after: { rehabId: rehab.id, realized: { salePriceCents, sellingCostsCents, closingDate } },
        description: `Recorded realized facts on rehab ${rehab.name} (sale ${salePriceCents} cents, selling costs ${sellingCostsCents} cents, closed ${closingDate})`,
      },
    };
  }

  if (args.kind !== "exit_decision") {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the rehab",
        why: "Say which record this is: an exit decision, or the realized facts at close",
        unlock: "Ask for the exit decision (sell, hold or wholesale) or for the realized facts, and I will prepare it for your approval",
      },
    };
  }

  const exitKind = typeof args.exit_kind === "string" ? args.exit_kind : "";
  const expectedPriceCents =
    args.expected_price_cents === null || args.expected_price_cents === undefined
      ? null
      : typeof args.expected_price_cents === "number"
        ? args.expected_price_cents
        : Number(args.expected_price_cents);
  const rationale = typeof args.rationale === "string" ? args.rationale.trim() : "";
  const reviewDueAt = typeof args.review_due_at === "string" && args.review_due_at ? args.review_due_at : null;
  if (
    !(EXIT_KINDS as readonly string[]).includes(exitKind) ||
    rationale.length < 10 ||
    rationale.length > 2000 ||
    (expectedPriceCents !== null && (!Number.isInteger(expectedPriceCents) || expectedPriceCents <= 0)) ||
    (reviewDueAt !== null && (!Number.isFinite(Date.parse(reviewDueAt)) || new Date(reviewDueAt).getTime() <= clock.nowMs()))
  ) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the rehab",
        why: "An exit decision needs the exit (sell, hold or wholesale), a positive expected price in cents where one applies, the customer's rationale (at least a sentence), and a review date in the future or none",
        unlock: "Give the exit, the price, and the rationale in the customer's words, then ask me again",
      },
    };
  }
  if (!EXIT_STATUSES.includes(rehab.status)) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the rehab",
        why: `The exit decision is recorded from the listing onward; this project is "${rehab.status}"`,
        unlock: "Record the exit decision once the project is listed",
      },
    };
  }
  if ((exitKind === "sell" || exitKind === "wholesale") && expectedPriceCents === null) {
    return {
      ok: false,
      refusal: {
        what: "Nothing was recorded on the rehab",
        why: `The asking/expected price as stated is part of the exit record for a ${exitKind}; state it, or choose hold`,
        unlock: "Give the expected price in cents, or record the exit as hold",
      },
    };
  }
  const kind = exitKind === "hold" ? "hold" : "dispose";
  const usd = (cents: number) =>
    `$${(Math.round(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const choice =
    exitKind === "sell"
      ? `Sell — asking ${usd(expectedPriceCents as number)}`
      : exitKind === "wholesale"
        ? `Wholesale — assign the contract, expected ${usd(expectedPriceCents as number)}`
        : `Hold as a rental${expectedPriceCents !== null ? ` — expected value ${usd(expectedPriceCents)}` : ""}`;
  const assumptions: ScenarioAssumption[] = [
    { key: "exit_kind", value: exitKind, origin: "user", basis: `The exit the operator chose for this project: ${exitKind}.` },
    ...(expectedPriceCents !== null
      ? [{ key: "exit_expected_price_cents", value: expectedPriceCents, unit: "cents", origin: "user" as const, basis: "The asking/expected price as stated by the operator." }]
      : []),
    { key: "exit_rehab_id", value: String(rehab.id), origin: "derived", basis: "The rehab project this exit was recorded on." },
    { key: "exit_status_at_record", value: rehab.status, origin: "derived", basis: "The project's status when the exit was recorded." },
  ];
  const scenario = await latestFlipScenario(orgId, rehab.propertyId);
  const { recordDecision } = await import("../services/decisions/decisionStore");
  const { UnavailableScenarioError } = await import("../services/economics/scenarioStore");
  try {
    const recorded = await recordDecision(
      orgId,
      {
        subjectType: "property",
        subjectId: rehab.propertyId,
        kind,
        choice,
        rationale,
        actorType: "user",
        actorRef: userId ?? "pax",
        authority: "org_member:flip_exit",
        strategyPackId: "fix_and_flip",
        strategyPackVersion: null,
        assumptions,
        alternatives: [],
        reviewDueAt: reviewDueAt ? new Date(reviewDueAt) : null,
      },
      clock.now(),
      scenario ? [scenario.id] : [],
    );
    return {
      ok: true,
      data: {
        message:
          "Recorded the exit decision on the rehab, as approved. This records the customer's decision — " +
          "AcreOS listed nothing, sold nothing and sent nothing.",
        rehabId: rehab.id,
        decisionId: recorded.id,
        exitKind,
        choice,
        reviewDueAt: reviewDueAt ? new Date(reviewDueAt).toISOString() : null,
      },
      receipt: {
        before: { rehabId: rehab.id },
        after: { rehabId: rehab.id, decisionId: recorded.id, exitKind, choice },
        description: `Recorded the ${exitKind} exit decision on rehab ${rehab.name} (${choice})`,
      },
    };
  } catch (err) {
    if (err instanceof UnavailableScenarioError) {
      return {
        ok: false,
        refusal: {
          what: "Nothing was recorded on the rehab",
          why: err.message,
          unlock: "Run the flip analysis for this property first, then ask me again",
        },
      };
    }
    throw err;
  }
}

/** Plain-words converter for the executor. */
export function flipOutcomeToResult(o: FlipToolOutcome): {
  success: boolean;
  data?: Record<string, unknown>;
  refusal?: RefusalParts;
  error?: string;
} {
  return o.ok ? { success: true, data: o.data } : toolRefusal(o.refusal);
}
