/**
 * Note pricing — the arithmetic behind a note investor's bid / pass call on a
 * PERFORMING note they are considering buying, at THEIR OWN target yield.
 *
 * WHAT IT ANSWERS. "If I pay P for this note's remaining payments, do I earn my
 * target yield?" — inverted: the most I can pay and still earn it.
 *
 *   net_t        = scheduled payment_t − stated servicing cost per month
 *   yield price  = Σ_t round( net_t × 1 / (1 + y/12)^t )   (all-in, at period 0)
 *   max bid      = yield price − stated acquisition costs, and — only when the
 *                  operator states a maximum ITV — no more than
 *                  floor(max ITV × collateral value) − senior liens on record
 *   discount     = (UPB − max bid) ÷ UPB
 *   LTV          = (senior liens + UPB) ÷ collateral value      (combined for a junior lien)
 *   ITV          = (senior liens + max bid) ÷ collateral value  (combined for a junior lien)
 *   total cost   = max bid + acquisition costs   (what the outcome loop grades as
 *                  "what did it actually cost to acquire?")
 *   profit       = Σ_t net_t − total cost        (IF every scheduled payment arrives)
 *
 * THE SCHEDULE USES THE WORKOUT ENGINE'S CONVENTIONS EXACTLY. Notes V2 Leg 2
 * (`shared/notes/workoutEngine.ts`, PR #461 — open, not on main when this was
 * written) prices the acquired book's hold/perform path with the same period,
 * interest, payment and rounding rules, so a performing note's yield price here
 * equals that engine's hold/perform NPV at a discount rate equal to the target
 * yield, with no arrears. tests/unit/notePricingEngine.test.ts pins the
 * equality against #461's independent Python-Decimal golden case. That is a
 * KNOWN DUPLICATION of one money formula, written down rather than hidden: when
 * #461 merges, the two payment streams become one exported function (the first
 * follow-up in docs/company/proposals/2026-11-06-b10-note-model-merge.md §B).
 *
 * NO DEFAULTS. The target yield, the servicing cost and the acquisition costs
 * are the operator's own judgements; AcreOS supplies none of them (zero is a
 * valid STATED answer). There is no default yield, discount rate, recovery
 * rate, collateral haircut or ITV cap anywhere in this file. A missing judgement
 * refuses every line that needs it, by name.
 *
 * REFUSE PER LINE, NEVER DEFAULT. Each output line is `computed` or `refused`
 * with the inputs it is missing and why. A missing collateral value refuses LTV
 * and ITV but not the yield price; a missing target yield refuses the price
 * lines but not LTV. A STATED maximum ITV that cannot be applied (no collateral
 * value, no lien position, or a junior lien without its senior balance) refuses
 * the max bid: silently dropping a cap the operator asked for would produce a
 * bid above their own limit.
 *
 * PROVENANCE. A fact arrives as one of three kinds and every output echoes which:
 *   - `recorded` — the note record's field (V-Notes-1, shared/provenance/
 *     fieldRecord.ts): the book value, the observation that states it, every
 *     other observation, and any disagreement. A field whose sources DISAGREE
 *     refuses the lines that need it (AcreOS has not picked one); a field with
 *     no value says why (blank on the tape vs never stated);
 *   - `stated` — a value the operator states for this pricing (a pipeline note
 *     that has no record yet, a lien position read off a title commitment);
 *   - `input` — a bare scenario input on the registered engine's wire, whose
 *     provenance the caller records.
 *
 * ONLY A PERFORMING NOTE. The yield price assumes every scheduled payment
 * arrives. A note the record calls late or in default is refused by name — its
 * value is in its workout paths (Notes V2 Leg 2's comparison), not in a
 * schedule the borrower is not keeping. A record that says "performing" and
 * also states days delinquent above zero contradicts itself and is refused.
 *
 * PURE: no I/O, no clock, no randomness. Integer cents and basis points in;
 * cents and unrounded ratios out.
 */
import type { ObservationView, RecordedValue } from "../provenance/fieldRecord";

export const NOTE_PRICING_ENGINE_ID = "note_pricing" as const;
/** Bump when the arithmetic or a convention changes in a way that could move a number. */
export const NOTE_PRICING_ENGINE_VERSION = "note-pricing-1" as const;

const CONVENTIONS = {
  period: "period t = t months after the as-of date; monthly 30/360, no calendar day-count",
  interest: "interest per period = balance × note rate ÷ 12, rounded to the cent (half away from zero)",
  payment:
    "each period the borrower pays the recorded payment, or the balance plus interest if that is smaller; the remaining balance plus interest is due at the last period of the remaining term",
  discounting:
    "net cash flow × 1 / (1 + target yield ÷ 12)^t, rounded to the cent (half away from zero); the yield price is the sum of the rounded lines",
  targetYield:
    "a nominal annual rate compounded monthly, in basis points (the workout engine's discount-rate convention); its effective annual equivalent is (1 + y/12)^12 − 1, the convention the note page's yield panel reports",
  acquisitionCosts: "paid at purchase (period 0), so not discounted",
  itvCap: "max ITV × collateral value is rounded DOWN to the cent, so the cap is never exceeded",
  ratios: "discount, LTV and ITV are unrounded fractions (0.2 = 20%)",
} as const;

/** Money bound: $1bn in cents. Keeps balance × rate exact in a double (≤ 10^15). */
const MAX_CENTS = 100_000_000_000;
/** Rate bound: 100% a year, in basis points. */
const MAX_BPS = 10_000;

type FactValue = number | string;

/** Where one fact came from. */
export type NoteFact =
  /** The note record's field: its book value, every observation of it, and any disagreement. */
  | { kind: "recorded"; record: RecordedValue }
  /** A value the operator states for this pricing. */
  | { kind: "stated"; value: FactValue; note?: string }
  /** A bare scenario input (the registered engine's wire); the caller records its provenance. */
  | { kind: "input"; value: FactValue };

const FACT_LABEL = {
  upbCents: "Unpaid principal balance",
  noteRateBps: "Note rate",
  paymentCents: "Scheduled payment (P&I)",
  remainingTermMonths: "Remaining term (months)",
  status: "Payment status",
  daysDelinquent: "Days delinquent",
  collateralValueCents: "Collateral value",
  lienPosition: "Lien position",
  seniorLienBalanceCents: "Senior lien balance",
} as const;
type FactKey = keyof typeof FACT_LABEL;

const STATED_LABEL = {
  targetYieldBps: "Target yield",
  servicingMonthlyCents: "Servicing cost per month",
  acquisitionCostsCents: "Acquisition costs (closing, diligence)",
  maxItvBps: "Maximum ITV",
} as const;
type StatedKey = keyof typeof STATED_LABEL;

export interface NotePricingInputs {
  facts: {
    upbCents: NoteFact | null;
    noteRateBps: NoteFact | null;
    paymentCents: NoteFact | null;
    remainingTermMonths: NoteFact | null;
    /** performing | late | default | paid_off | sold — the acquired book's vocabulary. */
    status: NoteFact | null;
    daysDelinquent?: NoteFact | null;
    collateralValueCents?: NoteFact | null;
    /** 1 = first lien. */
    lienPosition?: NoteFact | null;
    /** Required when the lien position is 2 or more. */
    seniorLienBalanceCents?: NoteFact | null;
  };
  /** The operator's own judgements for this pricing. AcreOS supplies none of them. */
  stated: {
    targetYieldBps: number | null;
    servicingMonthlyCents: number | null;
    acquisitionCostsCents: number | null;
    /** Optional ceiling on (senior liens + bid) ÷ collateral value. Absent = no cap is applied. */
    maxItvBps?: number | null;
  };
}

export interface Refusal {
  input: string;
  reason: string;
}

export type PricingLine =
  | { status: "computed"; value: number; unit: "cents" | "ratio"; basis: string }
  | { status: "refused"; refusals: Refusal[] };

export type MaxBidLine =
  | { status: "computed"; value: number; unit: "cents"; basis: string; binding: "yield" | "itv_cap" }
  | { status: "refused"; refusals: Refusal[] };

export interface InputView {
  key: string;
  label: string;
  value: FactValue | null;
  basis: "recorded" | "operator_stated" | "scenario_input" | null;
  source: string | null;
  /** Why the value cannot be used, when it cannot. */
  problem: string | null;
}

export interface ScheduleLine {
  period: number;
  interestCents: number;
  principalCents: number;
  paymentCents: number;
  servicingCents: number;
  netCents: number;
  discountedCents: number;
}

export interface NotePricingResult {
  engineId: typeof NOTE_PRICING_ENGINE_ID;
  engineVersion: typeof NOTE_PRICING_ENGINE_VERSION;
  conventions: typeof CONVENTIONS;
  /** Every fact, with the provenance it arrived with. */
  inputs: InputView[];
  /** The operator's judgements, each labelled as stated by the operator. */
  stated: Array<{ key: StatedKey; label: string; value: number | null; statedBy: "operator"; note: string }>;
  /** What the model itself assumes, in words. */
  assumptions: string[];
  /** The scheduled cash flows the yield price is the sum of; null when the price is refused. */
  schedule: ScheduleLine[] | null;
  lines: {
    yieldPrice: PricingLine;
    maxBid: MaxBidLine;
    discountToUpb: PricingLine;
    ltv: PricingLine;
    itv: PricingLine;
    totalCost: PricingLine;
    profitIfPerforming: PricingLine;
  };
}

// ── formatting (reasons and bases are read by a person) ─────────────────────

function usd(cents: number): string {
  const s = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? "−" : ""}$${s}`;
}
const pctBps = (bps: number) => `${(bps / 100).toFixed(2)}%`;

const CENTS_KEYS: ReadonlySet<string> = new Set(["upbCents", "paymentCents", "collateralValueCents", "seniorLienBalanceCents"]);
function show(key: string, v: unknown): string {
  if (typeof v === "number" && CENTS_KEYS.has(key)) return usd(v);
  if (typeof v === "number" && key === "noteRateBps") return pctBps(v);
  return JSON.stringify(v);
}

function describeObservation(o: ObservationView | null): string {
  if (!o) return "on the book; no source recorded";
  const ref = (o.sourceRef ?? {}) as { fileName?: unknown; fileRow?: unknown; column?: unknown };
  const where = [
    typeof ref.fileName === "string" ? ref.fileName : null,
    typeof ref.fileRow === "number" ? `row ${ref.fileRow}` : null,
    typeof ref.column === "string" && ref.column ? `column "${ref.column}"` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `${o.source}${where ? ` (${where})` : ""}${o.asOf ? `, as of ${o.asOf}` : ""}, ${o.confidence} confidence`;
}

// ── reading one fact ────────────────────────────────────────────────────────

interface FactRead extends InputView {
  /** absent = nothing usable on record; disputed = sources or facts disagree. */
  problemKind: "absent" | "disputed" | null;
}

function readFact(key: FactKey, fact: NoteFact | null | undefined): FactRead {
  const label = FACT_LABEL[key];
  if (!fact) {
    return { key, label, value: null, basis: null, source: null, problem: "not on record and not stated", problemKind: "absent" };
  }
  if (fact.kind === "stated") {
    return { key, label, value: fact.value, basis: "operator_stated", source: fact.note ? `stated by the operator: ${fact.note}` : "stated by the operator", problem: null, problemKind: null };
  }
  if (fact.kind === "input") {
    return { key, label, value: fact.value, basis: "scenario_input", source: "scenario input (its provenance is recorded by the caller)", problem: null, problemKind: null };
  }
  const rv = fact.record;
  const source = describeObservation(rv.provenance);
  if (rv.disagreement) {
    const listed = rv.disagreement.values.map((d) => `${show(key, d.value)} (${d.observations.map(describeObservation).join("; ")})`).join(" vs ");
    return { key, label, value: null, basis: "recorded", source, problem: `sources disagree: ${listed}; AcreOS has not picked one`, problemKind: "disputed" };
  }
  if (rv.value === null || rv.value === undefined) {
    const a = rv.absence;
    const why =
      a?.status === "blank_on_source"
        ? `not on record: blank on ${a.fileName ?? "the source"}${a.column ? ` (column "${a.column}")` : ""} — asked, nothing stated`
        : a?.status === "never_stated"
          ? "not on record: no import has stated it"
          : "not on record";
    return { key, label, value: null, basis: "recorded", source: null, problem: why, problemKind: "absent" };
  }
  if (typeof rv.value !== "number" && typeof rv.value !== "string") {
    return { key, label, value: null, basis: "recorded", source, problem: "the recorded value is not a number or a word", problemKind: "disputed" };
  }
  return { key, label, value: rv.value, basis: "recorded", source, problem: null, problemKind: null };
}

// ── validation ──────────────────────────────────────────────────────────────

type Got<T> = { ok: true; value: T } | { ok: false; refusals: Refusal[] };
const refuse = (input: string, reason: string): { ok: false; refusals: Refusal[] } => ({ ok: false, refusals: [{ input, reason }] });

function intFact(r: FactRead, min: number, max: number, what: string): Got<number> {
  if (r.problem) return refuse(r.label, r.problem);
  const v = r.value;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return refuse(r.label, `${JSON.stringify(v)} is not ${what}`);
  return { ok: true, value: v };
}

function intStated(key: StatedKey, v: number | null | undefined, min: number, max: number, what: string): Got<number> {
  const label = STATED_LABEL[key];
  if (v === null || v === undefined) return refuse(label, "not stated — AcreOS supplies no default (zero is a valid answer where it applies)");
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return refuse(label, `${JSON.stringify(v)} is not ${what}`);
  return { ok: true, value: v };
}

/** Join several reads: every value, or every refusal (deduplicated, in order). */
function all<T extends unknown[]>(...gots: { [K in keyof T]: Got<T[K]> }): Got<T> {
  const refusals: Refusal[] = [];
  for (const g of gots as Got<unknown>[]) if (!g.ok) for (const r of g.refusals) if (!refusals.some((x) => x.input === r.input && x.reason === r.reason)) refusals.push(r);
  if (refusals.length) return { ok: false, refusals };
  return { ok: true, value: (gots as Array<{ ok: true; value: unknown }>).map((g) => g.value) as T };
}

/** The note must be performing for a scheduled-payment price to mean anything. */
function performing(status: FactRead, days: FactRead | null): Got<true> {
  if (status.problem) return refuse(status.label, status.problem);
  const v = status.value;
  if (v !== "performing") {
    const why =
      v === "late" || v === "default"
        ? `the record says the note is ${v === "late" ? "late" : "in default"}; a scheduled-payment price would assume payments the record says are not arriving — compare its workout paths and state a value basis instead`
        : v === "paid_off" || v === "sold"
          ? `the note is ${v === "paid_off" ? "paid off" : "sold"}; there are no remaining payments to price`
          : `${JSON.stringify(v)} is not a recognised note status (performing, late, default, paid_off, sold)`;
    return refuse(status.label, why);
  }
  if (days) {
    if (days.problemKind === "disputed") return refuse(days.label, days.problem!);
    if (!days.problem) {
      const d = days.value;
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0) return refuse(days.label, `${JSON.stringify(d)} is not a whole number of days`);
      if (d > 0) return refuse(status.label, `the record disagrees with itself: status "performing" but ${d} days delinquent`);
    }
  }
  return { ok: true, value: true };
}

interface Collateral {
  valueCents: number;
  seniorCents: number;
  junior: boolean;
}

/** Collateral value, lien position and (for a junior lien) the senior balance — what LTV, ITV and an ITV cap need. */
function collateral(value: FactRead, lien: FactRead, senior: FactRead | null): Got<Collateral> {
  const v = intFact(value, 1, MAX_CENTS, "a positive whole number of cents");
  const l = intFact(lien, 1, 9, "a lien position from 1 (first lien) to 9");
  if (!l.ok) return all(v, l) as Got<never>;
  if (l.value === 1) {
    if (senior && !senior.problem && senior.value !== 0) {
      return all(v, refuse(senior.label, `a first lien has no senior lien, but ${show("seniorLienBalanceCents", senior.value)} is given as one`)) as Got<never>;
    }
    if (senior?.problemKind === "disputed") return all(v, refuse(senior.label, senior.problem!)) as Got<never>;
    return v.ok ? { ok: true, value: { valueCents: v.value, seniorCents: 0, junior: false } } : v;
  }
  const s = senior
    ? senior.problem
      ? refuse(senior.label, `${senior.problem} — a junior lien's LTV and ITV are combined with the senior balance`)
      : intFact(senior, 0, MAX_CENTS, "a whole number of cents, zero or more")
    : refuse(FACT_LABEL.seniorLienBalanceCents, "not on record and not stated — a junior lien's LTV and ITV are combined with the senior balance");
  const both = all(v, s);
  return both.ok ? { ok: true, value: { valueCents: both.value[0], seniorCents: both.value[1], junior: true } } : both;
}

// ── the schedule (identical conventions to shared/notes/workoutEngine.ts, PR #461) ──

/** Round to the nearest integer, half away from zero. */
function roundCents(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

function discountFactor(yieldBps: number, period: number): number {
  return 1 / Math.pow(1 + yieldBps / 10_000 / 12, period);
}

function scheduledStream(upbCents: number, rateBps: number, paymentCents: number, months: number, servicingCents: number, yieldBps: number): ScheduleLine[] {
  const lines: ScheduleLine[] = [];
  let bal = upbCents;
  for (let t = 1; t <= months; t++) {
    const interest = roundCents((bal * rateBps) / 10_000 / 12);
    const isLast = t === months;
    const due = bal + interest;
    const pay = isLast ? due : Math.min(paymentCents, due);
    const principal = pay - interest;
    bal -= principal;
    const net = pay - servicingCents;
    lines.push({
      period: t,
      interestCents: interest,
      principalCents: principal,
      paymentCents: pay,
      servicingCents,
      netCents: net,
      discountedCents: roundCents(net * discountFactor(yieldBps, t)),
    });
    if (!isLast && bal <= 0) break; // paid off early: nothing more is scheduled
  }
  return lines;
}

const MODEL_ASSUMPTIONS = [
  "Every scheduled payment arrives on schedule through the remaining term; no prepayment, default, modification or sale is assumed.",
  "The remaining balance plus interest is received at the last period of the remaining term (a balloon, when the note has one, is that amount).",
  "The stated servicing cost is paid every period a payment arrives.",
  "Acquisition costs are paid at purchase and are not discounted.",
];

// ── the engine ──────────────────────────────────────────────────────────────

/** Price one note. Pure and deterministic: the same inputs give the same result, every time. */
export function priceNote(inp: NotePricingInputs): NotePricingResult {
  const F = {
    upb: readFact("upbCents", inp.facts.upbCents),
    rate: readFact("noteRateBps", inp.facts.noteRateBps),
    payment: readFact("paymentCents", inp.facts.paymentCents),
    term: readFact("remainingTermMonths", inp.facts.remainingTermMonths),
    status: readFact("status", inp.facts.status),
    days: inp.facts.daysDelinquent ? readFact("daysDelinquent", inp.facts.daysDelinquent) : null,
    value: readFact("collateralValueCents", inp.facts.collateralValueCents),
    lien: readFact("lienPosition", inp.facts.lienPosition),
    senior: inp.facts.seniorLienBalanceCents ? readFact("seniorLienBalanceCents", inp.facts.seniorLienBalanceCents) : null,
  };
  const s = inp.stated;

  const upb = intFact(F.upb, 1, MAX_CENTS, "a positive whole number of cents");
  const price = all(
    upb,
    intFact(F.rate, 0, MAX_BPS, "a whole number of basis points from 0 to 10,000"),
    intFact(F.payment, 0, MAX_CENTS, "a whole number of cents, zero or more"),
    intFact(F.term, 1, 600, "a whole number of months from 1 to 600"),
    performing(F.status, F.days),
    intStated("targetYieldBps", s.targetYieldBps, 0, MAX_BPS, "a whole number of basis points from 0 to 10,000"),
    intStated("servicingMonthlyCents", s.servicingMonthlyCents, 0, MAX_CENTS, "a whole number of cents, zero or more"),
  );
  const costs = intStated("acquisitionCostsCents", s.acquisitionCostsCents, 0, MAX_CENTS, "a whole number of cents, zero or more");
  const capStated = s.maxItvBps !== null && s.maxItvBps !== undefined;
  const coll = collateral(F.value, F.lien, F.senior);

  // Yield price.
  let schedule: ScheduleLine[] | null = null;
  let yieldPrice: PricingLine;
  if (price.ok) {
    const [upbC, rateBps, payC, months, , yieldBps, servC] = price.value;
    schedule = scheduledStream(upbC, rateBps, payC, months, servC, yieldBps);
    const pv = schedule.reduce((a, l) => a + l.discountedCents, 0);
    yieldPrice = {
      status: "computed",
      value: pv,
      unit: "cents",
      basis: `the ${schedule.length} scheduled payments net of ${usd(servC)} servicing a month, discounted at a ${pctBps(yieldBps)} target yield, sum to ${usd(pv)}`,
    };
  } else {
    yieldPrice = { status: "refused", refusals: price.refusals };
  }

  // Max bid.
  let maxBid: MaxBidLine;
  const pvGot: Got<number> = yieldPrice.status === "computed" ? { ok: true, value: yieldPrice.value } : { ok: false, refusals: yieldPrice.refusals };
  const priced = all(pvGot, costs);
  /** A computed bid at or below zero is still the arithmetic — and it says pass. */
  const noPositive = (v: number) => (v <= 0 ? " — no positive price earns the target yield within these limits" : "");
  if (!priced.ok) {
    maxBid = { status: "refused", refusals: priced.refusals };
  } else {
    const [pv, costC] = priced.value;
    const byYield = pv - costC;
    if (!capStated) {
      maxBid = {
        status: "computed",
        value: byYield,
        unit: "cents",
        binding: "yield",
        basis: `yield price ${usd(pv)} less ${usd(costC)} acquisition costs; no maximum ITV was stated, so no cap is applied${noPositive(byYield)}`,
      };
    } else {
      const capped = all(intStated("maxItvBps", s.maxItvBps, 1, MAX_BPS, "a whole number of basis points from 1 to 10,000"), coll);
      if (!capped.ok) {
        maxBid = {
          status: "refused",
          refusals: [
            ...capped.refusals,
            { input: STATED_LABEL.maxItvBps, reason: "a maximum ITV was stated and cannot be applied without these, so no bid is computed" },
          ],
        };
      } else {
        const [capBps, c] = capped.value;
        const capC = Math.floor((capBps * c.valueCents) / 10_000) - c.seniorCents;
        const binding = capC < byYield ? "itv_cap" : "yield";
        const bid = Math.min(byYield, capC);
        maxBid = {
          status: "computed",
          value: bid,
          unit: "cents",
          binding,
          basis:
            `yield price ${usd(pv)} less ${usd(costC)} acquisition costs is ${usd(byYield)}; ` +
            `the stated ${pctBps(capBps)} maximum ITV allows ${usd(capC)}` +
            (c.junior ? ` after the ${usd(c.seniorCents)} senior lien` : "") +
            ` — the ${binding === "itv_cap" ? "ITV cap" : "target yield"} binds${noPositive(bid)}`,
        };
      }
    }
  }

  const bidGot: Got<number> = maxBid.status === "computed" ? { ok: true, value: maxBid.value } : { ok: false, refusals: maxBid.refusals };

  // Discount to UPB.
  const disc = all(bidGot, upb);
  const discountToUpb: PricingLine = disc.ok
    ? { status: "computed", value: (disc.value[1] - disc.value[0]) / disc.value[1], unit: "ratio", basis: `(UPB ${usd(disc.value[1])} − max bid ${usd(disc.value[0])}) ÷ UPB` }
    : { status: "refused", refusals: disc.refusals };

  // LTV — the loan against the collateral, combined with any senior lien.
  const ltvGot = all(upb, coll);
  const ltv: PricingLine = ltvGot.ok
    ? {
        status: "computed",
        value: (ltvGot.value[1].seniorCents + ltvGot.value[0]) / ltvGot.value[1].valueCents,
        unit: "ratio",
        basis: ltvGot.value[1].junior
          ? `combined: (senior lien ${usd(ltvGot.value[1].seniorCents)} + UPB ${usd(ltvGot.value[0])}) ÷ collateral value ${usd(ltvGot.value[1].valueCents)}`
          : `UPB ${usd(ltvGot.value[0])} ÷ collateral value ${usd(ltvGot.value[1].valueCents)}`,
      }
    : { status: "refused", refusals: ltvGot.refusals };

  // ITV — the investment (at the max bid) against the collateral.
  const itvGot = all(bidGot, coll);
  const itv: PricingLine = itvGot.ok
    ? {
        status: "computed",
        value: (itvGot.value[1].seniorCents + itvGot.value[0]) / itvGot.value[1].valueCents,
        unit: "ratio",
        basis: itvGot.value[1].junior
          ? `combined: (senior lien ${usd(itvGot.value[1].seniorCents)} + max bid ${usd(itvGot.value[0])}) ÷ collateral value ${usd(itvGot.value[1].valueCents)}`
          : `max bid ${usd(itvGot.value[0])} ÷ collateral value ${usd(itvGot.value[1].valueCents)}`,
      }
    : { status: "refused", refusals: itvGot.refusals };

  // Total cost to acquire, and profit if every scheduled payment arrives.
  const totalGot = all(bidGot, costs);
  const totalCost: PricingLine = totalGot.ok
    ? { status: "computed", value: totalGot.value[0] + totalGot.value[1], unit: "cents", basis: `max bid ${usd(totalGot.value[0])} + acquisition costs ${usd(totalGot.value[1])}` }
    : { status: "refused", refusals: totalGot.refusals };
  let profitIfPerforming: PricingLine;
  if (totalCost.status === "computed") {
    // A computed total cost implies a computed max bid, hence a computed yield
    // price, hence a schedule.
    const collected = schedule!.reduce((a, l) => a + l.netCents, 0);
    profitIfPerforming = {
      status: "computed",
      value: collected - totalCost.value,
      unit: "cents",
      basis: `scheduled net collections ${usd(collected)} − total cost ${usd(totalCost.value)}, if every scheduled payment arrives`,
    };
  } else {
    profitIfPerforming = { status: "refused", refusals: totalCost.refusals };
  }

  const strip = ({ problemKind: _k, ...view }: FactRead): InputView => view;
  const inputs = [F.upb, F.rate, F.payment, F.term, F.status, F.days, F.value, F.lien, F.senior].filter((r): r is FactRead => r !== null).map(strip);

  const statedView = (Object.keys(STATED_LABEL) as StatedKey[])
    .filter((k) => k !== "maxItvBps" || capStated)
    .map((k) => ({
      key: k,
      label: STATED_LABEL[k],
      value: (s[k] ?? null) as number | null,
      statedBy: "operator" as const,
      note: s[k] === null || s[k] === undefined ? "not stated — AcreOS supplies no default" : "stated by the operator for this pricing; AcreOS supplies no default",
    }));

  return {
    engineId: NOTE_PRICING_ENGINE_ID,
    engineVersion: NOTE_PRICING_ENGINE_VERSION,
    conventions: CONVENTIONS,
    inputs,
    stated: statedView,
    assumptions: MODEL_ASSUMPTIONS,
    schedule,
    lines: { yieldPrice, maxBid, discountToUpb, ltv, itv, totalCost, profitIfPerforming },
  };
}
