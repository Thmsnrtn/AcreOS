/**
 * Seasonal priors — which months are busy.
 *
 * WHAT IS MEASURED, AND WHAT IS ASSUMED
 * -------------------------------------
 * No free public source counts vacant-land sales by month. What IS published,
 * monthly, by state, unadjusted, for decades, is new housing units authorised
 * by building permits (Census Building Permits Survey). The factors below are
 * MEASURED seasonality of permits. Using them for LAND demand is an
 * ASSUMPTION — builders buy lots ahead of permits, and rural land buyers are
 * not all builders — and every consumer must say so (`basis` carries it).
 *
 * HOW: each month's permits divided by the centred 12-month average around it
 * (the classic ratio-to-moving-average), averaged per calendar month, scaled
 * so the twelve factors average 1. A state with few years leans on the
 * all-state factors (partial pooling).
 *
 * TAX SALES: the W2 registry (shared/landData/taxSaleSources.ts) records where
 * counties publish sale notices, deliberately not the dates. So there is no
 * sourced tax-sale calendar to build a seasonal prior from, and
 * `taxSaleSeasonality` refuses rather than typing in months from memory.
 *
 * Pure; browser-safe.
 */
import { addMonths, type Point } from "./vintage";
import { mean, poolWeight, round } from "./stats";
import { TAX_SALE_SOURCES } from "../landData/taxSaleSources";

export const SEASONALITY_ENGINE_ID = "seasonal_prior_permits";
export const SEASONALITY_ENGINE_VERSION = "1.0.0";
const SEASONALITY_POOL_K = 5; // years
export const SEASONALITY_BASIS =
  "Measured: seasonality of new housing units authorised by building permits (U.S. Census Bureau, BPS). Assumed: land demand follows the same seasonal shape.";

/** Ratio of each month to the centred 2×12 moving average around it. */
function seasonalRatios(points: readonly Point[]): Array<{ month: number; ratio: number }> {
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out: Array<{ month: number; ratio: number }> = [];
  for (const p of points) {
    const vals: number[] = [];
    let ok = true;
    for (let k = -6; k <= 6; k++) {
      const v = byDate.get(addMonths(p.date, k));
      if (v == null) { ok = false; break; }
      vals.push(v);
    }
    if (!ok) continue;
    // 2×12 centred average: half weight on the two ends.
    const ma = (vals[0] / 2 + vals.slice(1, 12).reduce((a, b) => a + b, 0) + vals[12] / 2) / 12;
    if (!(ma > 0)) continue;
    out.push({ month: Number(p.date.slice(5, 7)), ratio: p.value / ma });
  }
  return out;
}

function factorsFrom(ratios: ReadonlyArray<{ month: number; ratio: number }>): { factors: number[]; years: number } | null {
  const per: number[][] = Array.from({ length: 12 }, () => []);
  for (const r of ratios) per[r.month - 1].push(r.ratio);
  if (per.some((a) => a.length === 0)) return null;
  const raw = per.map((a) => mean(a) as number);
  const avg = raw.reduce((a, b) => a + b, 0) / 12;
  return { factors: raw.map((f) => f / avg), years: Math.min(...per.map((a) => a.length)) };
}

export interface SeasonalPrior {
  state: string;
  /** Twelve factors, January first; 1.0 = an average month. */
  factors: number[];
  yearsOfHistory: number;
  ownWeight: number;
  basis: string;
}

export function seasonalPriors(byState: ReadonlyMap<string, readonly Point[]>): { national: number[] | null; states: SeasonalPrior[]; refusals: Array<{ state: string; refused: string }> } {
  // National: the sum of every state per month (only months every listed state reports).
  const total = new Map<string, number>();
  const count = new Map<string, number>();
  for (const pts of byState.values()) for (const p of pts) {
    total.set(p.date, (total.get(p.date) ?? 0) + p.value);
    count.set(p.date, (count.get(p.date) ?? 0) + 1);
  }
  const nStates = byState.size;
  const nationalPts = [...total.entries()].filter(([d]) => count.get(d) === nStates).map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
  const nat = factorsFrom(seasonalRatios(nationalPts));
  const states: SeasonalPrior[] = [];
  const refusals: Array<{ state: string; refused: string }> = [];
  for (const [st, pts] of byState) {
    const own = factorsFrom(seasonalRatios(pts));
    if (!own && !nat) { refusals.push({ state: st, refused: "no complete year of permits" }); continue; }
    const w = own ? poolWeight(own.years, SEASONALITY_POOL_K) : 0;
    const f = Array.from({ length: 12 }, (_, i) => w * (own?.factors[i] ?? 0) + (1 - w) * (nat?.factors[i] ?? own!.factors[i]));
    const avg = f.reduce((a, b) => a + b, 0) / 12;
    states.push({ state: st, factors: f.map((x) => round(x / avg, 4)), yearsOfHistory: own?.years ?? 0, ownWeight: round(w, 3), basis: SEASONALITY_BASIS });
  }
  states.sort((a, b) => a.state.localeCompare(b.state));
  return { national: nat ? nat.factors.map((x) => round(x, 4)) : null, states, refusals };
}

export interface TaxSaleSeasonalityRefusal {
  state: string;
  available: false;
  reason: string;
  sourcesKnown: number;
}

/**
 * A tax-sale seasonal prior for a state. Refuses today for every state: the
 * W2 registry carries sources, not dates, and a sale month typed from memory
 * is exactly the fabricated calendar that registry exists to prevent.
 */
export function taxSaleSeasonality(state: string): TaxSaleSeasonalityRefusal {
  const sources = TAX_SALE_SOURCES.filter((s) => s.state === state.toUpperCase());
  return {
    state: state.toUpperCase(),
    available: false,
    sourcesKnown: sources.length,
    reason:
      sources.length === 0
        ? "No tax-sale sources are registered for this state, so there is no sourced sale calendar."
        : `${sources.length} county source page(s) are registered, but the registry records where sales are announced, not when; no sale dates have been read from them yet.`,
  };
}
