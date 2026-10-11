/**
 * Downturn runway — AcreOS's OWN cash and MRR under a normal path and a stress
 * path, month by month. For the founder's Letter only.
 *
 * Every input is one of two kinds, and the output says which:
 *   - MEASURED: cash basis, monthly costs and MRR from the finance ledger
 *     (server/services/finance/runwayModel.ts computeRunway), the MRR trend
 *     from recorded weekly MRR snapshots, and the stress LENGTH from public
 *     payroll history (how long state job contractions have lasted);
 *   - ASSUMED: how hard a downturn hits AcreOS's revenue. No public series
 *     measures what small land-investing businesses do with software spend in
 *     a recession, so the stress depth is a labelled guess, editable, never
 *     dressed as a measurement.
 *
 * Deterministic and versioned like every engine. Pure; browser-safe.
 */
import type { ScenarioAssumption } from "../economics/scenario";
import { round } from "./stats";

export const DOWNTURN_RUNWAY_ENGINE_ID = "acreos_downturn_runway";
const DOWNTURN_RUNWAY_ENGINE_VERSION = "1.0.0";
const RUNWAY_HORIZON_MONTHS = 60;

export interface RunwayInputs {
  /** Planning cash basis (USD) — the runway model's label travels with it. */
  cashUsd: number;
  cashLabel: string;
  monthlyCostsUsd: number;
  mrrUsd: number;
  /** Observed MRR change per month (fraction), or null when too little history. */
  observedMrrMonthlyChange: number | null;
  /** Weeks of MRR history behind observedMrrMonthlyChange. */
  mrrHistoryWeeks: number;
  /** Stress length in months from public history, or null when not available. */
  publicContractionMonths: number | null;
  publicContractionBasis: string | null;
}

export interface RunwayAssumptions {
  /** Monthly MRR fall during the stress (fraction). */
  stressMrrDeclinePerMonth: number;
  /** Change to monthly costs during the stress (fraction; 0 = unchanged). */
  stressCostChange: number;
  /** Used only when public contraction length is unavailable. */
  fallbackStressMonths: number;
}

const DEFAULT_RUNWAY_ASSUMPTIONS: RunwayAssumptions = {
  stressMrrDeclinePerMonth: 0.05,
  stressCostChange: 0,
  fallbackStressMonths: 12,
};

export interface RunwayPathPoint {
  month: number;
  cashUsd: number;
  mrrUsd: number;
}

export interface RunwayScenarioResult {
  label: string;
  /** First month cash falls below zero; null when it does not within the horizon. */
  monthsToZero: number | null;
  path: RunwayPathPoint[];
}

export interface DownturnRunway {
  engineId: string;
  engineVersion: string;
  horizonMonths: number;
  normal: RunwayScenarioResult;
  stress: RunwayScenarioResult;
  measured: Array<{ key: string; value: number | string; source: string }>;
  assumptions: ScenarioAssumption[];
}

function simulate(start: RunwayInputs, mrrChange: (m: number) => number, costs: (m: number) => number): RunwayScenarioResult & { label: string } {
  let cash = start.cashUsd;
  let mrr = start.mrrUsd;
  let monthsToZero: number | null = null;
  const path: RunwayPathPoint[] = [{ month: 0, cashUsd: round(cash, 2), mrrUsd: round(mrr, 2) }];
  for (let m = 1; m <= RUNWAY_HORIZON_MONTHS; m++) {
    mrr = Math.max(0, mrr * (1 + mrrChange(m)));
    cash += mrr - costs(m);
    path.push({ month: m, cashUsd: round(cash, 2), mrrUsd: round(mrr, 2) });
    if (monthsToZero == null && cash < 0) monthsToZero = m;
  }
  return { label: "", monthsToZero, path };
}

export function computeDownturnRunway(inp: RunwayInputs, a: RunwayAssumptions = DEFAULT_RUNWAY_ASSUMPTIONS): DownturnRunway {
  const assumptions: ScenarioAssumption[] = [];
  const measured: DownturnRunway["measured"] = [
    { key: "cashUsd", value: inp.cashUsd, source: inp.cashLabel },
    { key: "monthlyCostsUsd", value: inp.monthlyCostsUsd, source: "finance ledger opex + AI spend + declared fixed infra (runwayModel)" },
    { key: "mrrUsd", value: inp.mrrUsd, source: "live paying organisations × tier price (runwayModel)" },
  ];
  let normalChange = 0;
  if (inp.observedMrrMonthlyChange != null) {
    normalChange = inp.observedMrrMonthlyChange;
    measured.push({ key: "mrrMonthlyChange", value: round(normalChange, 4), source: `recorded MRR snapshots, ${inp.mrrHistoryWeeks} weeks` });
  } else {
    assumptions.push({ key: "normalMrrMonthlyChange", value: 0, unit: "fraction per month", origin: "platform-default", basis: `MRR held flat: only ${inp.mrrHistoryWeeks} week(s) of recorded MRR, too few to measure a trend (need 8)` });
  }
  assumptions.push({ key: "normalCostChange", value: 0, unit: "fraction", origin: "platform-default", basis: "costs held at today's level" });

  let stressMonths: number;
  if (inp.publicContractionMonths != null) {
    stressMonths = inp.publicContractionMonths;
    measured.push({ key: "stressMonths", value: stressMonths, source: inp.publicContractionBasis ?? "public payroll history" });
  } else {
    stressMonths = a.fallbackStressMonths;
    assumptions.push({ key: "stressMonths", value: stressMonths, unit: "months", origin: "platform-default", basis: "public contraction length unavailable; a one-year downturn assumed" });
  }
  assumptions.push({ key: "stressMrrDeclinePerMonth", value: a.stressMrrDeclinePerMonth, unit: "fraction per month", origin: "platform-default", basis: "ASSUMPTION — no public series measures small land-investor software spend in a downturn; chosen as a hard-but-survivable hit" });
  assumptions.push({ key: "stressCostChange", value: a.stressCostChange, unit: "fraction", origin: "platform-default", basis: "ASSUMPTION — costs unchanged during the stress (no cuts assumed)" });
  assumptions.push({ key: "afterStressMrrChange", value: 0, unit: "fraction per month", origin: "platform-default", basis: "ASSUMPTION — MRR stops falling when the stress ends and stays flat" });

  const normal = simulate(inp, () => normalChange, () => inp.monthlyCostsUsd);
  const stress = simulate(
    inp,
    (m) => (m <= stressMonths ? -a.stressMrrDeclinePerMonth : 0),
    (m) => inp.monthlyCostsUsd * (m <= stressMonths ? 1 + a.stressCostChange : 1),
  );
  return {
    engineId: DOWNTURN_RUNWAY_ENGINE_ID,
    engineVersion: DOWNTURN_RUNWAY_ENGINE_VERSION,
    horizonMonths: RUNWAY_HORIZON_MONTHS,
    normal: { ...normal, label: "Normal: today's costs, MRR on its recorded trend" },
    stress: { ...stress, label: `Stress: MRR falls ${Math.round(a.stressMrrDeclinePerMonth * 100)}% a month for ${stressMonths} months` },
    measured,
    assumptions,
  };
}

/** Observed monthly MRR change from weekly snapshots (oldest first), or null under 8 weeks. */
export function mrrMonthlyChangeFrom(snapshots: ReadonlyArray<{ capturedAt: string; mrrCents: number }>): { change: number | null; weeks: number } {
  const v = snapshots.filter((s) => Number.isFinite(s.mrrCents)).slice().sort((x, y) => x.capturedAt.localeCompare(y.capturedAt));
  if (v.length < 2) return { change: null, weeks: v.length };
  const first = v[0], last = v[v.length - 1];
  const weeks = (Date.parse(last.capturedAt) - Date.parse(first.capturedAt)) / (7 * 86_400_000);
  if (weeks < 8 || !(first.mrrCents > 0) || !(last.mrrCents > 0)) return { change: null, weeks: Math.floor(Math.max(0, weeks)) };
  const months = weeks / (52 / 12);
  return { change: Math.pow(last.mrrCents / first.mrrCents, 1 / months) - 1, weeks: Math.floor(weeks) };
}
