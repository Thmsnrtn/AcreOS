/**
 * Rehab realized-vs-forecast grading — what the deal actually returned, set
 * beside what the scenario forecast (fix-and-flip package, Leg 4, §6.2/§6.3).
 *
 * Pure arithmetic on recorded facts. The panel grades a FORECAST, it does not
 * grade the operator (§7.3): a delta is a difference between two figures, with
 * no threshold, no "good/bad" label and no recommendation. Both sides are
 * immutable — the sale facts once recorded, and the scenario snapshot the
 * forecast came from — so the comparison cannot be quietly re-fit afterwards.
 *
 * A MISSING INPUT YIELDS NULL AND A NAMED EXCLUSION, NEVER AN ESTIMATE (the
 * computeMao honesty discipline). The realized net needs a purchase price,
 * recorded holding-cost entries and rehab scope lines; if any is absent the
 * net is null and `netMissing` says which, in words. A missing component is
 * never treated as zero. Recorded-spend figures are used verbatim when present.
 *
 * THE HOLDING METER NEVER ENTERS THE NET. The Leg 3 holding meter is an
 * accrual — a running estimate of what carrying the property is costing. Only
 * RECORDED holding entries (costs actually paid) are subtracted here.
 *
 * `roiRatio` on the scenario side is the flip_mao scenario's stored `roi`
 * metric, which is a ratio (the engine converts its percent by /100), so the
 * realized ROI is a ratio too and the two compare directly.
 *
 * No server imports, no I/O, no clock — everything derives from the arguments.
 */

const MS_PER_DAY = 86_400_000;
const DAYS_PER_MONTH = 30;

export interface RealizedFacts {
  salePriceCents: number;
  sellingCostsCents: number;
  /** ISO date, "YYYY-MM-DD". */
  closingDate: string;
}

export interface ScenarioGradeFacts {
  arvCents: number | null;
  profitCents: number | null;
  /** A ratio (0.25 = 25%), not a percent. */
  roiRatio: number | null;
  holdMonths: number | null;
}

export interface RealizedGradeInput {
  facts: RealizedFacts;
  purchasePriceCents: number | null;
  rehabSpentCents: number;
  rehabLineCount: number;
  holdingEntriesTotalCents: number;
  holdingEntryCount: number;
  startedAt: string | null;
  scenario: ScenarioGradeFacts | null;
}

export interface RealizedGrade {
  /** Whole days startedAt → closingDate; null when either is missing/unparseable. */
  holdDays: number | null;
  investedCents: number | null;
  investedParts: {
    purchaseCents: number | null;
    rehabSpentCents: number;
    holdingRecordedCents: number | null;
  };
  realizedNetCents: number | null;
  /** Each missing net component, in words; empty when the net is computed. */
  netMissing: string[];
  realizedRoiRatio: number | null;
  deltas: {
    saleVsArvCents: number | null;
    holdDaysVsScenarioDays: number | null;
    netVsScenarioProfitCents: number | null;
    roiVsScenarioRatio: number | null;
  };
}

/** UTC-midnight milliseconds of the date part; null when not parseable. */
function utcDayMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

export function gradeRealized(input: RealizedGradeInput): RealizedGrade {
  const {
    facts,
    purchasePriceCents,
    rehabSpentCents,
    rehabLineCount,
    holdingEntriesTotalCents,
    holdingEntryCount,
    startedAt,
    scenario,
  } = input;

  const startMs = utcDayMs(startedAt);
  const closeMs = utcDayMs(facts.closingDate);
  const holdDays =
    startMs === null || closeMs === null
      ? null
      : Math.round((closeMs - startMs) / MS_PER_DAY);

  const netMissing: string[] = [];
  if (purchasePriceCents === null) netMissing.push("purchase price");
  if (holdingEntryCount === 0) netMissing.push("recorded holding costs");
  if (rehabLineCount === 0) netMissing.push("rehab scope lines");

  const holdingRecordedCents = holdingEntryCount === 0 ? null : holdingEntriesTotalCents;

  const realizedNetCents =
    netMissing.length === 0 && purchasePriceCents !== null
      ? facts.salePriceCents -
        facts.sellingCostsCents -
        purchasePriceCents -
        rehabSpentCents -
        holdingEntriesTotalCents
      : null;

  const investedCents =
    purchasePriceCents === null || holdingRecordedCents === null
      ? null
      : purchasePriceCents + rehabSpentCents + holdingRecordedCents;

  const realizedRoiRatio =
    realizedNetCents === null || investedCents === null || investedCents <= 0
      ? null
      : realizedNetCents / investedCents;

  const holdDaysVsScenarioDays =
    holdDays === null || !scenario || scenario.holdMonths === null
      ? null
      : holdDays - scenario.holdMonths * DAYS_PER_MONTH;

  return {
    holdDays,
    investedCents,
    investedParts: {
      purchaseCents: purchasePriceCents,
      rehabSpentCents,
      holdingRecordedCents,
    },
    realizedNetCents,
    netMissing,
    realizedRoiRatio,
    deltas: {
      saleVsArvCents: scenario ? diff(facts.salePriceCents, scenario.arvCents) : null,
      holdDaysVsScenarioDays,
      netVsScenarioProfitCents: scenario
        ? diff(realizedNetCents, scenario.profitCents)
        : null,
      roiVsScenarioRatio: scenario ? diff(realizedRoiRatio, scenario.roiRatio) : null,
    },
  };
}
