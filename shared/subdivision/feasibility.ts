// ============================================================================
// SHARED/SUBDIVISION/FEASIBILITY.TS — the subdivision feasibility run
// ("subdivision-feasibility v1"). Subdivision V1, Leg 3 (package 2026-11-05 §5).
// ----------------------------------------------------------------------------
// Pure and browser-safe. Peiser's missing middle on top of the pro-forma's
// land + carry: the operator's hard / infrastructure and soft cost lines, the
// operator's absorption pace and phasing, the carry over the operator's OWN
// stated timeline (ruling 2026-11-05: county timelines are operator-stated per
// run; the global table stays empty), project IRR over the paced cash flows,
// and a sensitivity grid over the same input snapshot.
//
// THE PRO-FORMA'S DISCIPLINE, INHERITED VERBATIM:
//   - REFUSE PER LINE, NEVER ASSUME. Every cost line is the operator's for this
//     run. ZERO IS A STATEMENT; AN ABSENT LINE REFUSES ITS SECTION — a run with
//     no roads line does not cost roads at $0, and the hard-cost section (and
//     everything that sums it) is refused by name.
//   - NO TIMELINE → CARRY WITHHELD. With no stated timeline, the carry and the
//     carry-inclusive margins are withheld by name — never a carry-free margin
//     dressed as the real one — and so is the IRR, which needs the timeline.
//   - NOTHING PREFILLED. No unit cost, contingency %, pace or timeline is a
//     platform or market figure (§9.4).
//
// MODELLING CHOICES (each stated; the engine adapter declares them on every
// scenario as assumptions, so they render wherever the figures do):
//   - land, hard and soft costs are spent at month 0;
//   - carry over the stated p50 timeline is spread evenly over the entitlement
//     months; carry DURING sell-out is not modelled (enter it as a cost line);
//   - lots sell at the stated pace from the month after entitlement, at the
//     average lot price (gross proceeds ÷ lots), the last month taking the
//     remainder;
//   - phases sequence the same pace; costs and proceeds are allocated to
//     phases by lot count.
// ============================================================================

import { projectCarryForMonths } from "./carryCost";

export const FEASIBILITY_ENGINE_VERSION = "subdivision-feasibility v1";

export const HARD_LINES = ["gradingCents", "roadsCents", "waterCents", "sewerCents", "septicCents", "stormwaterCents", "utilitiesCents", "landscapingCents"] as const;
export const SOFT_LINES = ["engineeringSurveyCents", "legalCents", "permittingFeesCents", "financingCents", "marketingCents", "contingencyCents"] as const;
type HardLine = (typeof HARD_LINES)[number];
type SoftLine = (typeof SOFT_LINES)[number];
export type CostLineKey = HardLine | SoftLine;

const COST_LINE_LABELS: Record<CostLineKey, string> = {
  gradingCents: "Grading & earthwork",
  roadsCents: "Roads & right-of-way construction",
  waterCents: "Water",
  sewerCents: "Sewer",
  septicCents: "Septic",
  stormwaterCents: "Stormwater",
  utilitiesCents: "Utilities extension",
  landscapingCents: "Landscaping & amenity",
  engineeringSurveyCents: "Engineering & survey",
  legalCents: "Legal",
  permittingFeesCents: "Permitting, impact fees & exactions",
  financingCents: "Financing costs",
  marketingCents: "Marketing & disposition",
  contingencyCents: "Contingency",
};

export interface FeasibilityInputs {
  /** The parent parcel's purchase price — the land cost / COGS. */
  landCostCents: number;
  lotCount: number;
  /** Sum of the lots' asking prices (the locked pricing grid, or the operator's stated figure). */
  grossProceedsCents: number;
  /** The operator's stated sales pace, lots per month. Their market claim, not a forecast. */
  absorptionLotsPerMonth: number;
  /** Which wastewater lines are live: a sewer project's septic line is not applicable, and vice versa. */
  wastewater: "sewer" | "septic";
  /** Lots per phase, in order ("4,4,4"); absent = one phase. */
  phaseLotCounts: number[] | null;
  /** Cost lines; null = not entered (the section refuses). */
  costs: Partial<Record<CostLineKey, number | null>>;
  /** The operator's own timeline for this parcel, in days; null = not stated. */
  timelineP50Days: number | null;
  timelineP90Days: number | null;
  /** Carry inputs (the carry projector's): holding per month is required for carry. */
  holdingCostMonthlyCents: number | null;
  debtPrincipalCents: number | null;
  debtRatePct: number | null;
  opportunityCostPct: number | null;
}

export interface CentsLine {
  cents: number | null;
  refusedReason: string | null;
}

export interface SectionResult {
  totalCents: number | null;
  refusedReason: string | null;
  lines: Array<{ key: CostLineKey; label: string; status: "stated" | "stated_zero" | "not_entered" | "not_applicable"; cents: number | null }>;
}

export interface FeasibilityResult {
  version: typeof FEASIBILITY_ENGINE_VERSION;
  grossProceeds: CentsLine;
  landCost: CentsLine;
  hard: SectionResult;
  soft: SectionResult;
  totalCostBeforeCarry: CentsLine;
  marginBeforeCarry: CentsLine;
  carry: { p50Cents: number | null; p90Cents: number | null; refusedReason: string | null };
  marginAfterCarryP50: CentsLine;
  marginAfterCarryP90: CentsLine;
  marginPerLotBeforeCarry: CentsLine;
  sellOutMonths: number;
  entitlementMonthsP50: number | null;
  holdMonthsP50: number | null;
  irr: { annual: number | null; refusedReason: string | null };
  /** The month-by-month cash flows the IRR solved over (month 0 first) — shown so the IRR can be checked; null when it was withheld. */
  cashFlowsCents: number[] | null;
  /** Per phase, allocated by lot count (largest remainder, so each column re-adds to its total exactly). */
  phases: Array<{
    phase: number;
    lots: number;
    grossProceedsCents: number;
    costBeforeCarryCents: number | null;
    marginBeforeCarryCents: number | null;
    carryP50Cents: number | null;
    marginAfterCarryP50Cents: number | null;
  }>;
}

export class FeasibilityInputError extends Error {}

/** Split whole cents across phases by lot share, largest remainder — the parts re-add to the total exactly. */
function allocateByLots(totalCents: number, lots: readonly number[]): number[] {
  const all = lots.reduce((a, b) => a + b, 0);
  const exact = lots.map((n) => (totalCents * n) / all);
  const floor = exact.map(Math.floor);
  let left = totalCents - floor.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floor[i] += 1;
    left -= 1;
  }
  return floor;
}

const DAYS_PER_MONTH = 30;

/**
 * Hard bounds on what one run may ask the engine to model. The cash flows are
 * one entry per month, so an unbounded pace or timeline is an unbounded loop
 * (audit 2026-11-05). These are input-validation limits, not market figures.
 */
const MAX_LOTS = 10_000;
const MAX_TIMELINE_DAYS = 3_650; // ten years to a recorded plat
const MAX_HORIZON_MONTHS = 600; // entitlement + sell-out, fifty years

function section(keys: readonly CostLineKey[], costs: FeasibilityInputs["costs"], notApplicable: CostLineKey | null, name: string): SectionResult {
  const lines: SectionResult["lines"] = keys.map((key) => {
    if (key === notApplicable) return { key, label: COST_LINE_LABELS[key], status: "not_applicable", cents: null };
    const v = costs[key];
    if (v === null || v === undefined) return { key, label: COST_LINE_LABELS[key], status: "not_entered", cents: null };
    return { key, label: COST_LINE_LABELS[key], status: v === 0 ? "stated_zero" : "stated", cents: v };
  });
  const missing = lines.filter((l) => l.status === "not_entered");
  if (missing.length > 0) {
    return {
      totalCents: null,
      refusedReason: `${name} refused — not entered: ${missing.map((l) => l.label.toLowerCase()).join(", ")}. Enter each (0 is a valid entry); a missing line is never costed at $0.`,
      lines,
    };
  }
  return { totalCents: lines.reduce((a, l) => a + (l.cents ?? 0), 0), refusedReason: null, lines };
}

/**
 * Monthly IRR by bisection on NPV over [−50%, +1000%] per month — a range in
 * which NPV stays finite for every horizon the bounds above allow (the earlier
 * −99% floor underflowed past ~150 months and mislabelled long projects).
 * Each failure carries its own reason.
 */
const IRR_LO = -0.5;
const IRR_HI = 10;
function monthlyIrr(flows: readonly number[]): { rate: number } | { refusedReason: string } {
  const npv = (r: number) => flows.reduce((a, cf, t) => a + cf / Math.pow(1 + r, t), 0);
  const total = flows.reduce((a, b) => a + b, 0);
  if (total <= 0) return { refusedReason: "No IRR: the paced cash flows do not recover the project's costs." };
  let lo = IRR_LO;
  let hi = IRR_HI;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return { refusedReason: "No IRR: the cash flows could not be evaluated across the solvable range." };
  if (fHi > 0) return { refusedReason: "No IRR reported: it is above 1,000% a month — check the inputs." };
  if (fLo < 0) return { refusedReason: "No IRR reported: it is below −50% a month." };
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (Math.abs(f) < 1e-6) return { rate: mid };
    if (fLo * f < 0) hi = mid;
    else {
      lo = mid;
      fLo = f;
    }
  }
  return { rate: (lo + hi) / 2 };
}

/** The month-by-month cash flows behind the IRR (month 0 first), or null without a timeline. */
function feasibilityCashFlows(
  inp: FeasibilityInputs,
  totalCostBeforeCarryCents: number,
  carryP50Cents: number,
): number[] {
  const e = Math.ceil((inp.timelineP50Days as number) / DAYS_PER_MONTH);
  const flows: number[] = [-totalCostBeforeCarryCents];
  // Carry spread evenly over the entitlement months, whole cents, the last
  // month taking the remainder so the months re-add to the carry exactly.
  const perMonth = Math.floor(carryP50Cents / e);
  for (let m = 1; m <= e; m++) flows.push(-(m === e ? carryP50Cents - perMonth * (e - 1) : perMonth));
  // Lots at the stated pace, at the average lot price; cumulative proceeds are
  // rounded to whole cents so the months re-add to gross proceeds exactly.
  const months = Math.ceil(inp.lotCount / inp.absorptionLotsPerMonth - 1e-9);
  let paid = 0;
  for (let k = 1; k <= months; k++) {
    const lotsSoFar = Math.min(inp.lotCount, k * inp.absorptionLotsPerMonth);
    const cumulative = k === months ? inp.grossProceedsCents : Math.round((inp.grossProceedsCents * lotsSoFar) / inp.lotCount);
    flows.push(cumulative - paid);
    paid = cumulative;
  }
  return flows;
}

function validate(inp: FeasibilityInputs): void {
  const bad = (m: string) => {
    throw new FeasibilityInputError(m);
  };
  if (!Number.isInteger(inp.lotCount) || inp.lotCount < 1 || inp.lotCount > MAX_LOTS) bad(`lotCount must be a whole number of lots, 1 to ${MAX_LOTS}`);
  if (!(inp.absorptionLotsPerMonth > 0)) bad("absorptionLotsPerMonth must be a stated pace above 0");
  if (inp.landCostCents < 0 || inp.grossProceedsCents < 0) bad("land cost and gross proceeds cannot be negative");
  const na: CostLineKey = inp.wastewater === "sewer" ? "septicCents" : "sewerCents";
  const naValue = inp.costs[na];
  if (naValue !== null && naValue !== undefined) {
    bad(`${COST_LINE_LABELS[na]} was entered on a ${inp.wastewater} project — that line is not applicable; remove it or change the wastewater path`);
  }
  for (const [k, v] of Object.entries(inp.costs)) if (v !== null && v !== undefined && !(v >= 0)) bad(`${k} cannot be negative`);
  if (inp.phaseLotCounts) {
    if (inp.phaseLotCounts.some((n) => !Number.isInteger(n) || n < 1)) bad("each phase must hold a whole number of lots, at least 1");
    const sum = inp.phaseLotCounts.reduce((a, b) => a + b, 0);
    if (sum !== inp.lotCount) bad(`the phases hold ${sum} lots but the run states ${inp.lotCount}`);
  }
  for (const d of [inp.timelineP50Days, inp.timelineP90Days]) if (d !== null && !(d > 0 && d <= MAX_TIMELINE_DAYS)) bad(`a stated timeline must be 1 to ${MAX_TIMELINE_DAYS} days`);
  if (inp.timelineP50Days !== null && inp.timelineP90Days !== null && inp.timelineP90Days < inp.timelineP50Days) {
    bad("the slow-case (p90) timeline cannot be shorter than the typical (p50) one");
  }
  const sellOut = Math.ceil(inp.lotCount / inp.absorptionLotsPerMonth - 1e-9);
  const entitlement = inp.timelineP50Days === null ? 0 : Math.ceil(inp.timelineP50Days / DAYS_PER_MONTH);
  if (!(sellOut + entitlement <= MAX_HORIZON_MONTHS)) bad(`entitlement plus sell-out at this pace runs past ${MAX_HORIZON_MONTHS} months — check the pace`);
  if (inp.debtPrincipalCents !== null && inp.debtPrincipalCents > 0 && inp.debtRatePct === null) {
    bad("a debt principal was entered with no debt rate — enter the rate (0 is a valid entry), or clear the principal");
  }
}

/** The feasibility run. Pure; every figure is reproducible from `inp`. */
export function computeFeasibility(inp: FeasibilityInputs): FeasibilityResult {
  validate(inp);
  const na: CostLineKey = inp.wastewater === "sewer" ? "septicCents" : "sewerCents";
  const hard = section(HARD_LINES, inp.costs, na, "Hard / infrastructure costs");
  const soft = section(SOFT_LINES, inp.costs, null, "Soft costs");

  const costsRefused = [hard.refusedReason, soft.refusedReason].filter(Boolean).join(" ");
  const totalCostBeforeCarry: CentsLine = costsRefused
    ? { cents: null, refusedReason: costsRefused }
    : { cents: inp.landCostCents + (hard.totalCents as number) + (soft.totalCents as number), refusedReason: null };
  const marginBeforeCarry: CentsLine =
    totalCostBeforeCarry.cents === null
      ? { cents: null, refusedReason: totalCostBeforeCarry.refusedReason }
      : { cents: inp.grossProceedsCents - totalCostBeforeCarry.cents, refusedReason: null };

  // ── Carry over the operator's stated timeline ──
  let carry: FeasibilityResult["carry"];
  if (inp.timelineP50Days === null && inp.timelineP90Days === null) {
    carry = { p50Cents: null, p90Cents: null, refusedReason: "No timeline stated for this run: carry is withheld, and so are the carry-inclusive margins and the IRR. Refusing to assume a timeline." };
  } else if (inp.holdingCostMonthlyCents === null) {
    carry = { p50Cents: null, p90Cents: null, refusedReason: "Carry inputs not stated: enter a monthly holding cost to project carry over your timeline." };
  } else {
    const ci = {
      holdingCostMonthlyCents: inp.holdingCostMonthlyCents,
      debtPrincipalCents: inp.debtPrincipalCents ?? 0,
      debtRateBps: Math.round((inp.debtRatePct ?? 0) * 100),
      purchaseBasisCents: inp.landCostCents,
      opportunityCostBps: Math.round((inp.opportunityCostPct ?? 0) * 100),
    };
    const at = (days: number | null) => (days === null ? null : projectCarryForMonths(days / DAYS_PER_MONTH, ci)?.totalCarryCents ?? null);
    carry = { p50Cents: at(inp.timelineP50Days), p90Cents: at(inp.timelineP90Days), refusedReason: null };
  }

  const after = (c: number | null, label: string): CentsLine => {
    if (marginBeforeCarry.cents === null) return { cents: null, refusedReason: marginBeforeCarry.refusedReason };
    if (carry.refusedReason) return { cents: null, refusedReason: carry.refusedReason };
    if (c === null) return { cents: null, refusedReason: `No ${label} timeline stated: this margin is withheld.` };
    return { cents: marginBeforeCarry.cents - c, refusedReason: null };
  };

  const sellOutMonths = Math.round((inp.lotCount / inp.absorptionLotsPerMonth) * 10) / 10;
  const entitlementMonthsP50 = inp.timelineP50Days === null ? null : Math.ceil(inp.timelineP50Days / DAYS_PER_MONTH);

  let irr: FeasibilityResult["irr"];
  let cashFlowsCents: number[] | null = null;
  if (totalCostBeforeCarry.cents === null) irr = { annual: null, refusedReason: totalCostBeforeCarry.refusedReason };
  else if (carry.refusedReason || carry.p50Cents === null || inp.timelineP50Days === null) {
    irr = { annual: null, refusedReason: carry.refusedReason ?? "No p50 timeline stated: the IRR needs it to place the cash flows in time." };
  } else {
    cashFlowsCents = feasibilityCashFlows(inp, totalCostBeforeCarry.cents, carry.p50Cents);
    const m = monthlyIrr(cashFlowsCents);
    irr = "rate" in m ? { annual: Math.pow(1 + m.rate, 12) - 1, refusedReason: null } : { annual: null, refusedReason: m.refusedReason };
  }

  const phaseCounts = inp.phaseLotCounts ?? [inp.lotCount];
  const proceedsByPhase = allocateByLots(inp.grossProceedsCents, phaseCounts);
  const costByPhase = totalCostBeforeCarry.cents === null ? null : allocateByLots(totalCostBeforeCarry.cents, phaseCounts);
  const carryByPhase = carry.refusedReason || carry.p50Cents === null ? null : allocateByLots(carry.p50Cents, phaseCounts);
  const phases = phaseCounts.map((lots, i) => ({
    phase: i + 1,
    lots,
    grossProceedsCents: proceedsByPhase[i],
    costBeforeCarryCents: costByPhase ? costByPhase[i] : null,
    marginBeforeCarryCents: costByPhase ? proceedsByPhase[i] - costByPhase[i] : null,
    carryP50Cents: carryByPhase ? carryByPhase[i] : null,
    marginAfterCarryP50Cents: costByPhase && carryByPhase ? proceedsByPhase[i] - costByPhase[i] - carryByPhase[i] : null,
  }));

  return {
    version: FEASIBILITY_ENGINE_VERSION,
    grossProceeds: { cents: inp.grossProceedsCents, refusedReason: null },
    landCost: { cents: inp.landCostCents, refusedReason: null },
    hard,
    soft,
    totalCostBeforeCarry,
    marginBeforeCarry,
    carry,
    marginAfterCarryP50: after(carry.p50Cents, "p50"),
    marginAfterCarryP90: after(carry.p90Cents, "p90"),
    marginPerLotBeforeCarry:
      marginBeforeCarry.cents === null ? { cents: null, refusedReason: marginBeforeCarry.refusedReason } : { cents: Math.round(marginBeforeCarry.cents / inp.lotCount), refusedReason: null },
    sellOutMonths,
    entitlementMonthsP50,
    holdMonthsP50: entitlementMonthsP50 === null ? null : entitlementMonthsP50 + Math.ceil(inp.lotCount / inp.absorptionLotsPerMonth - 1e-9),
    irr,
    cashFlowsCents,
    phases,
  };
}

// ── Sensitivity (§5.3) — a grid over the SAME input snapshot ─────────────

export interface SensitivityCell {
  axis: "lot_price" | "absorption_pace" | "infrastructure_cost";
  change: number;
  label: string;
  marginBeforeCarryCents: number | null;
  marginAfterCarryP50Cents: number | null;
  irrAnnual: number | null;
}

const scale = (n: number | null | undefined, f: number) => (n === null || n === undefined ? n : Math.round(n * f));

/**
 * Lot price ±10% / ±20%, absorption pace ±25%, infrastructure (hard) cost
 * ±15% — one axis at a time, every other input as stated. Each cell is
 * computeFeasibility over the perturbed snapshot, so it reproduces from the record.
 */
export function feasibilitySensitivity(inp: FeasibilityInputs): SensitivityCell[] {
  const cell = (axis: SensitivityCell["axis"], change: number, label: string, x: FeasibilityInputs): SensitivityCell => {
    const r = computeFeasibility(x);
    return { axis, change, label, marginBeforeCarryCents: r.marginBeforeCarry.cents, marginAfterCarryP50Cents: r.marginAfterCarryP50.cents, irrAnnual: r.irr.annual };
  };
  const cells: SensitivityCell[] = [];
  for (const c of [-0.2, -0.1, 0.1, 0.2]) {
    cells.push(cell("lot_price", c, `Lot price ${c > 0 ? "+" : ""}${c * 100}%`, { ...inp, grossProceedsCents: Math.round(inp.grossProceedsCents * (1 + c)) }));
  }
  for (const c of [-0.25, 0.25]) {
    cells.push(cell("absorption_pace", c, `Absorption pace ${c > 0 ? "+" : ""}${c * 100}%`, { ...inp, absorptionLotsPerMonth: inp.absorptionLotsPerMonth * (1 + c) }));
  }
  for (const c of [-0.15, 0.15]) {
    const costs = { ...inp.costs };
    for (const k of HARD_LINES) costs[k] = scale(costs[k], 1 + c);
    cells.push(cell("infrastructure_cost", c, `Infrastructure cost ${c > 0 ? "+" : ""}${c * 100}%`, { ...inp, costs }));
  }
  return cells;
}
