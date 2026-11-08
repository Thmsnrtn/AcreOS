/**
 * Workout NPV engine — V-Notes-2 Leg 2. THE one place the workout comparison is
 * computed. The server stores what this returns; the client renders what the
 * server stored. Nothing re-computes it anywhere else.
 *
 * A COMPARISON OF STATED SCENARIOS, NEVER A RECOMMENDATION.
 *   - Paths are returned in one fixed, neutral order (WORKOUT_PATHS — the order
 *     the spec lists them), never sorted by value. The output carries no
 *     "recommended", "best", score, rank or winner field; a test pins that
 *     structurally (workoutEngine.test.ts).
 *   - The engine proposes nothing. Modification terms, forbearance windows,
 *     timelines, costs, recoveries and the discount rate are the operator's
 *     stated inputs; a path whose inputs were not stated is "not_stated", and a
 *     path missing a required input is "refused" naming the input. No value is
 *     ever defaulted, guessed or carried silently.
 *   - No money moves, no record changes, nothing is sent: this module is pure
 *     (no db, no clock, no I/O). Amounts a path forgives or writes off are shown
 *     as facts with their period only — this engine computes no tax figure.
 *
 * CONVENTIONS (stated on every run record — CONVENTIONS below):
 *   - Period t = t months after the run's as-of date (t = 1 is the first
 *     period). No calendar day-count is used: monthly 30/360.
 *   - Interest per period = balance × annual rate ÷ 12, rounded to the cent.
 *   - Discounting: each period's net cash flow × 1 / (1 + d/12)^t, rounded to
 *     the cent (half away from zero). A path's NPV is the SUM OF ITS ROUNDED
 *     LINE ITEMS, so re-adding the discounted column lands exactly on the NPV.
 *   - Rates are basis points (1% = 100 bps). Money is integer cents.
 */

export const WORKOUT_ENGINE_VERSION = "workout-engine v1";

const WORKOUT_PATHS = [
  "hold_perform",
  "modification",
  "forbearance",
  "deed_in_lieu",
  "foreclosure",
  "charge_off_hold",
] as const;
export type WorkoutPath = (typeof WORKOUT_PATHS)[number];

const WORKOUT_PATH_LABEL: Record<WorkoutPath, string> = {
  hold_perform: "Hold / perform as-is",
  modification: "Modification",
  forbearance: "Forbearance / trial plan",
  deed_in_lieu: "Deed-in-lieu",
  foreclosure: "Foreclosure",
  charge_off_hold: "Charge-off / hold for exit",
};

export const CONVENTIONS = {
  period: "period t = t months after the as-of date; monthly 30/360, no calendar day-count",
  interest: "interest per period = balance × annual rate ÷ 12, rounded to the cent",
  discounting: "net cash flow × 1 / (1 + discount rate ÷ 12)^t, rounded to the cent (half away from zero)",
  npv: "NPV = sum of the rounded discounted line items",
  sensitivity: "collateral value × 0.8 / 0.9 / 1.0 / 1.1 / 1.2 and timeline × 0.75 / 1.0 / 1.25 (rounded to whole months, minimum 1); paths whose model uses neither are unchanged across the grid",
} as const;

const SENSITIVITY_VALUE_FACTORS = [0.8, 0.9, 1, 1.1, 1.2] as const;
const SENSITIVITY_TIMELINE_FACTORS = [0.75, 1, 1.25] as const;

export type CostTiming = "upfront" | "monthly" | "at_resolution";
export interface CostLine {
  label: string;
  amountCents: number;
  timing: CostTiming;
}

/** Everything one run is computed from. Stored verbatim on the run record. */
export interface WorkoutInputs {
  /** YYYY-MM-DD. Informational: periods count months from it. */
  asOf: string;
  /** Operator-set per run. There is no platform default. */
  discountRateBps: number | null;
  note: {
    upbCents: number | null;
    rateBps: number | null;
    paymentCents: number | null;
    remainingTermMonths: number | null;
    /** Past-due amount owed now, as stated by the operator. */
    arrearsCents: number | null;
  };
  /** The disposition value basis for the deed-in-lieu and foreclosure paths. */
  collateralValueCents: number | null;
  /** Servicing cost per period on the paths where the borrower keeps paying. Zero is a stated value. */
  servicingMonthlyCents: number | null;
  modification: null | {
    rateBps: number;
    termMonths: number;
    arrearsTreatment: "capitalize" | "defer_to_maturity" | "waive";
    /** Non-interest-bearing principal, due at the modified maturity. */
    principalForbearanceCents: number;
    /** Principal forgiven. Shown as a fact; no tax figure is computed. */
    principalReductionCents: number;
  };
  forbearance: null | {
    months: number;
    reducedPaymentCents: number;
  };
  deedInLieu: null | { timelineMonths: number | null; costs: CostLine[] };
  foreclosure: null | { timelineMonths: number | null; costs: CostLine[] };
  chargeOffHold: null | { recoveryCents: number; horizonMonths: number; costs: CostLine[] };
}

export interface CashFlowLine {
  period: number;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  discountedCents: number;
  /** What the inflow and outflow are made of, in cents, by named component. */
  components: Record<string, number>;
}

export type PathResult =
  | {
      path: WorkoutPath;
      label: string;
      status: "computed";
      npvCents: number;
      /** Plain-language assumptions this path's model makes, beyond CONVENTIONS. */
      assumptions: string[];
      /** Amounts the path forgives or does not collect, as facts (no tax figure). */
      facts: Array<{ label: string; cents: number; period: number | null }>;
      lines: CashFlowLine[];
    }
  | { path: WorkoutPath; label: string; status: "not_stated"; reason: string }
  | { path: WorkoutPath; label: string; status: "refused"; missing: string[]; reason: string };

export interface SensitivityCell {
  valueFactor: number;
  timelineFactor: number;
  npvCents: number | null;
}

export interface WorkoutRunResult {
  engineVersion: string;
  conventions: typeof CONVENTIONS;
  status: "computed" | "refused";
  /** When the whole run is refused: the inputs it could not run without. */
  refusedFor: string[];
  paths: PathResult[];
  sensitivity: Array<{ path: WorkoutPath; sensitiveTo: Array<"value" | "timeline">; cells: SensitivityCell[] }>;
}

// ── arithmetic ──────────────────────────────────────────────────────────────

/** Round to the nearest integer, half away from zero. */
function roundCents(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

function discountFactor(discountRateBps: number, period: number): number {
  return 1 / Math.pow(1 + discountRateBps / 10_000 / 12, period);
}

function monthlyInterest(balanceCents: number, rateBps: number): number {
  return roundCents((balanceCents * rateBps) / 10_000 / 12);
}

/** Level payment that amortizes `principalCents` over `months` at `rateBps`. */
function amortizingPayment(principalCents: number, rateBps: number, months: number): number {
  if (months <= 0) return principalCents;
  const j = rateBps / 10_000 / 12;
  if (j === 0) return roundCents(principalCents / months);
  return roundCents((principalCents * j) / (1 - Math.pow(1 + j, -months)));
}

type Flow = { period: number; components: Record<string, number> };

/** Sum per period; inflow = positive components, outflow = negative ones (shown as positive). */
function toLines(flows: Flow[], discountRateBps: number): { lines: CashFlowLine[]; npvCents: number } {
  const byPeriod = new Map<number, Record<string, number>>();
  for (const f of flows) {
    const into = byPeriod.get(f.period) ?? {};
    for (const [k, v] of Object.entries(f.components)) into[k] = (into[k] ?? 0) + v;
    byPeriod.set(f.period, into);
  }
  const lines: CashFlowLine[] = [...byPeriod.entries()]
    .sort(([a], [b]) => a - b)
    .map(([period, components]) => {
      const vals = Object.values(components);
      const inflowCents = vals.filter((v) => v > 0).reduce((a, b) => a + b, 0);
      const outflowCents = -vals.filter((v) => v < 0).reduce((a, b) => a + b, 0);
      const netCents = inflowCents - outflowCents;
      return { period, inflowCents, outflowCents, netCents, discountedCents: roundCents(netCents * discountFactor(discountRateBps, period)), components };
    });
  return { lines, npvCents: lines.reduce((a, l) => a + l.discountedCents, 0) };
}

/**
 * Borrower payments on a balance at `rateBps`, paying `paymentFor(t)` each
 * period through `lastPeriod`, where the balance (plus `atLastPeriod`) is due
 * in full. Stops early if the balance is paid off.
 */
function paymentStream(opts: {
  balanceCents: number;
  rateBps: number;
  firstPeriod: number;
  lastPeriod: number;
  paymentFor: (t: number) => number;
  servicingMonthlyCents: number;
  atLastPeriod?: Record<string, number>;
}): Flow[] {
  const flows: Flow[] = [];
  let bal = opts.balanceCents;
  for (let t = opts.firstPeriod; t <= opts.lastPeriod; t++) {
    const interest = monthlyInterest(bal, opts.rateBps);
    const isLast = t === opts.lastPeriod;
    const due = bal + interest;
    const pay = isLast ? due : Math.min(opts.paymentFor(t), due);
    const principal = pay - interest;
    bal -= principal;
    const components: Record<string, number> = { interest_received: interest, principal_received: principal };
    if (opts.servicingMonthlyCents > 0) components.servicing_cost = -opts.servicingMonthlyCents;
    if (isLast && opts.atLastPeriod) Object.assign(components, opts.atLastPeriod);
    flows.push({ period: t, components });
    if (!isLast && bal <= 0) {
      // Paid off early: amounts due at maturity are still due at maturity.
      if (opts.atLastPeriod && Object.keys(opts.atLastPeriod).length) flows.push({ period: opts.lastPeriod, components: { ...opts.atLastPeriod } });
      break;
    }
  }
  return flows;
}

function costFlows(costs: CostLine[], resolutionPeriod: number): Flow[] {
  const flows: Flow[] = [];
  for (const c of costs) {
    const key = `cost: ${c.label}`;
    if (c.timing === "upfront") flows.push({ period: 1, components: { [key]: -c.amountCents } });
    else if (c.timing === "at_resolution") flows.push({ period: resolutionPeriod, components: { [key]: -c.amountCents } });
    else for (let t = 1; t <= resolutionPeriod; t++) flows.push({ period: t, components: { [key]: -c.amountCents } });
  }
  return flows;
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNonNegInt = (v: unknown): v is number => isInt(v) && v >= 0;

// ── paths ───────────────────────────────────────────────────────────────────

function holdPerform(i: WorkoutInputs, d: number): PathResult {
  const missing: string[] = [];
  if (!isInt(i.note.remainingTermMonths) || i.note.remainingTermMonths < 1) missing.push("remaining term (months)");
  if (!isNonNegInt(i.note.arrearsCents)) missing.push("arrears owed now");
  if (!isNonNegInt(i.servicingMonthlyCents)) missing.push("servicing cost per month");
  const base = { path: "hold_perform" as const, label: WORKOUT_PATH_LABEL.hold_perform };
  if (missing.length) return { ...base, status: "refused", missing, reason: `Not computed: ${missing.join(", ")} not stated.` };
  const n = i.note.remainingTermMonths!;
  const flows = paymentStream({
    balanceCents: i.note.upbCents!,
    rateBps: i.note.rateBps!,
    firstPeriod: 1,
    lastPeriod: n,
    paymentFor: () => i.note.paymentCents!,
    servicingMonthlyCents: i.servicingMonthlyCents!,
  });
  if (i.note.arrearsCents! > 0) flows.push({ period: 1, components: { arrears_received: i.note.arrearsCents! } });
  return {
    ...base,
    status: "computed",
    ...toLines(flows, d),
    assumptions: [
      "The borrower pays the recorded payment every period from period 1 and the remaining balance at the last period.",
      "Arrears owed now are received in period 1.",
      "No default, prepayment or haircut is assumed.",
    ],
    facts: [],
  };
}

function modification(i: WorkoutInputs, d: number): PathResult {
  const base = { path: "modification" as const, label: WORKOUT_PATH_LABEL.modification };
  const m = i.modification;
  if (!m) return { ...base, status: "not_stated", reason: "No modified terms were stated for this run." };
  const missing: string[] = [];
  if (!isNonNegInt(m.rateBps)) missing.push("modified rate");
  if (!isInt(m.termMonths) || m.termMonths < 1) missing.push("modified term (months)");
  if (!isNonNegInt(m.principalForbearanceCents)) missing.push("principal forbearance");
  if (!isNonNegInt(m.principalReductionCents)) missing.push("principal reduction");
  if (m.arrearsTreatment !== "waive" && !isNonNegInt(i.note.arrearsCents)) missing.push("arrears owed now");
  if (!isNonNegInt(i.servicingMonthlyCents)) missing.push("servicing cost per month");
  if (missing.length) return { ...base, status: "refused", missing, reason: `Not computed: ${missing.join(", ")} not stated.` };
  const arrears = m.arrearsTreatment === "waive" ? 0 : i.note.arrearsCents!;
  const bearing = i.note.upbCents! + (m.arrearsTreatment === "capitalize" ? arrears : 0) - m.principalForbearanceCents - m.principalReductionCents;
  if (bearing < 0) {
    return { ...base, status: "refused", missing: ["principal forbearance + reduction"], reason: "Not computed: forbearance plus reduction exceeds the balance they come out of." };
  }
  const payment = amortizingPayment(bearing, m.rateBps, m.termMonths);
  const atLast: Record<string, number> = {};
  if (m.principalForbearanceCents > 0) atLast.forborne_principal_received = m.principalForbearanceCents;
  if (m.arrearsTreatment === "defer_to_maturity" && arrears > 0) atLast.deferred_arrears_received = arrears;
  const flows = paymentStream({
    balanceCents: bearing,
    rateBps: m.rateBps,
    firstPeriod: 1,
    lastPeriod: m.termMonths,
    paymentFor: () => payment,
    servicingMonthlyCents: i.servicingMonthlyCents!,
    atLastPeriod: atLast,
  });
  const facts: Array<{ label: string; cents: number; period: number | null }> = [];
  if (m.principalReductionCents > 0) facts.push({ label: "Principal forgiven by the stated modification", cents: m.principalReductionCents, period: null });
  if (m.arrearsTreatment === "waive" && isNonNegInt(i.note.arrearsCents) && i.note.arrearsCents > 0) {
    facts.push({ label: "Arrears waived by the stated modification", cents: i.note.arrearsCents, period: null });
  }
  return {
    ...base,
    status: "computed",
    ...toLines(flows, d),
    assumptions: [
      `Modified payment ${payment} cents per period amortizes the interest-bearing balance of ${bearing} cents over ${m.termMonths} months at the stated rate.`,
      `Arrears treatment as stated: ${m.arrearsTreatment.replace(/_/g, " ")}.`,
      "Forborne principal bears no interest and is received at the modified maturity.",
      "The borrower performs on the modified terms; no re-default is assumed.",
    ],
    facts,
  };
}

function forbearance(i: WorkoutInputs, d: number): PathResult {
  const base = { path: "forbearance" as const, label: WORKOUT_PATH_LABEL.forbearance };
  const f = i.forbearance;
  if (!f) return { ...base, status: "not_stated", reason: "No forbearance window was stated for this run." };
  const missing: string[] = [];
  if (!isInt(i.note.remainingTermMonths) || i.note.remainingTermMonths < 1) missing.push("remaining term (months)");
  if (!isNonNegInt(i.note.arrearsCents)) missing.push("arrears owed now");
  if (!isNonNegInt(i.servicingMonthlyCents)) missing.push("servicing cost per month");
  if (!isInt(f.months) || f.months < 1) missing.push("forbearance months");
  if (!isNonNegInt(f.reducedPaymentCents)) missing.push("reduced payment");
  if (missing.length) return { ...base, status: "refused", missing, reason: `Not computed: ${missing.join(", ")} not stated.` };
  const n = i.note.remainingTermMonths!;
  if (f.months >= n) {
    return { ...base, status: "refused", missing: ["forbearance months"], reason: "Not computed: the forbearance window is not shorter than the remaining term." };
  }
  const flows = paymentStream({
    balanceCents: i.note.upbCents!,
    rateBps: i.note.rateBps!,
    firstPeriod: 1,
    lastPeriod: n,
    paymentFor: (t) => (t <= f.months ? f.reducedPaymentCents : i.note.paymentCents!),
    servicingMonthlyCents: i.servicingMonthlyCents!,
  });
  if (i.note.arrearsCents! > 0) flows.push({ period: f.months + 1, components: { arrears_received: i.note.arrearsCents! } });
  return {
    ...base,
    status: "computed",
    ...toLines(flows, d),
    assumptions: [
      `For periods 1–${f.months} the borrower pays the stated reduced payment; interest keeps accruing on the balance, so any shortfall is added to it.`,
      `From period ${f.months + 1} the recorded payment resumes, with the remaining balance due at period ${n}.`,
      `Arrears owed now are received in period ${f.months + 1}, when the window ends.`,
    ],
    facts: [],
  };
}

function disposition(
  path: "deed_in_lieu" | "foreclosure",
  i: WorkoutInputs,
  d: number,
  valueFactor = 1,
  timelineFactor = 1,
): PathResult {
  const base = { path, label: WORKOUT_PATH_LABEL[path] };
  const s = path === "deed_in_lieu" ? i.deedInLieu : i.foreclosure;
  if (!s) return { ...base, status: "not_stated", reason: `No ${path === "deed_in_lieu" ? "deed-in-lieu" : "foreclosure"} timeline or costs were stated for this run.` };
  const missing: string[] = [];
  if (!isNonNegInt(i.collateralValueCents)) missing.push("collateral value");
  if (!isInt(s.timelineMonths) || s.timelineMonths < 1) missing.push(`${path === "deed_in_lieu" ? "deed-in-lieu" : "foreclosure"} timeline (months)`);
  if (s.costs.some((c) => !isNonNegInt(c.amountCents) || !c.label.trim())) missing.push("a cost line's label or amount");
  if (missing.length) return { ...base, status: "refused", missing, reason: `Not computed: ${missing.join(", ")} not stated.` };
  const T = Math.max(1, Math.round(s.timelineMonths! * timelineFactor));
  const value = roundCents(i.collateralValueCents! * valueFactor);
  const flows: Flow[] = [{ period: T, components: { disposition_proceeds: value } }, ...costFlows(s.costs, T)];
  return {
    ...base,
    status: "computed",
    ...toLines(flows, d),
    assumptions: [
      `No borrower payments are received during the ${T}-month timeline.`,
      `The collateral is disposed of at period ${T} at the stated value basis; selling costs appear only where stated as cost lines.`,
    ],
    facts: [],
  };
}

function chargeOffHold(i: WorkoutInputs, d: number, timelineFactor = 1): PathResult {
  const base = { path: "charge_off_hold" as const, label: WORKOUT_PATH_LABEL.charge_off_hold };
  const c = i.chargeOffHold;
  if (!c) return { ...base, status: "not_stated", reason: "No recovery or horizon was stated for this run." };
  const missing: string[] = [];
  if (!isNonNegInt(c.recoveryCents)) missing.push("recovery");
  if (!isInt(c.horizonMonths) || c.horizonMonths < 1) missing.push("horizon (months)");
  if (c.costs.some((x) => !isNonNegInt(x.amountCents) || !x.label.trim())) missing.push("a cost line's label or amount");
  if (missing.length) return { ...base, status: "refused", missing, reason: `Not computed: ${missing.join(", ")} not stated.` };
  const H = Math.max(1, Math.round(c.horizonMonths * timelineFactor));
  const flows: Flow[] = [{ period: H, components: { recovery_received: c.recoveryCents } }, ...costFlows(c.costs, H)];
  const facts = isNonNegInt(i.note.upbCents)
    ? [{ label: "Unpaid principal not collected beyond the stated recovery", cents: Math.max(0, i.note.upbCents - c.recoveryCents), period: null }]
    : [];
  return {
    ...base,
    status: "computed",
    ...toLines(flows, d),
    assumptions: [`The stated recovery is received at period ${H}; nothing else is collected.`],
    facts,
  };
}

// ── run ─────────────────────────────────────────────────────────────────────

/** Compute every path on one input snapshot. Pure and deterministic. */
export function runWorkoutComparison(inputs: WorkoutInputs): WorkoutRunResult {
  const refusedFor: string[] = [];
  if (!isNonNegInt(inputs.discountRateBps)) refusedFor.push("discount rate");
  if (!isNonNegInt(inputs.note.upbCents)) refusedFor.push("unpaid principal balance");
  if (!isNonNegInt(inputs.note.rateBps)) refusedFor.push("note rate");
  if (!isNonNegInt(inputs.note.paymentCents)) refusedFor.push("payment amount");
  if (refusedFor.length) {
    return { engineVersion: WORKOUT_ENGINE_VERSION, conventions: CONVENTIONS, status: "refused", refusedFor, paths: [], sensitivity: [] };
  }
  const d = inputs.discountRateBps!;
  const paths: PathResult[] = [
    holdPerform(inputs, d),
    modification(inputs, d),
    forbearance(inputs, d),
    disposition("deed_in_lieu", inputs, d),
    disposition("foreclosure", inputs, d),
    chargeOffHold(inputs, d),
  ];

  const npvOf = (p: PathResult) => (p.status === "computed" ? p.npvCents : null);
  const grid = (fn: (vf: number, tf: number) => number | null): SensitivityCell[] =>
    SENSITIVITY_TIMELINE_FACTORS.flatMap((tf) => SENSITIVITY_VALUE_FACTORS.map((vf) => ({ valueFactor: vf, timelineFactor: tf, npvCents: fn(vf, tf) })));
  const sensitivity: WorkoutRunResult["sensitivity"] = paths.map((p) => {
    switch (p.path) {
      case "deed_in_lieu":
      case "foreclosure":
        return { path: p.path, sensitiveTo: ["value", "timeline"], cells: grid((vf, tf) => npvOf(disposition(p.path as "deed_in_lieu" | "foreclosure", inputs, d, vf, tf))) };
      case "charge_off_hold":
        return { path: p.path, sensitiveTo: ["timeline"], cells: grid((_vf, tf) => npvOf(chargeOffHold(inputs, d, tf))) };
      default:
        return { path: p.path, sensitiveTo: [], cells: grid(() => npvOf(p)) };
    }
  });

  return { engineVersion: WORKOUT_ENGINE_VERSION, conventions: CONVENTIONS, status: "computed", refusedFor: [], paths, sensitivity };
}
