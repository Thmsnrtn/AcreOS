/**
 * Founder Autopilot — forecasting-driven proactivity (Elite Vision D3).
 *
 * The brain reacts to the present (senses → moves). This lets it act on the
 * FUTURE: project a trend forward, and if a problem is coming (runway running
 * out, churn rising, demand spiking), surface a pre-emptive move NOW — with the
 * lead time, so the founder/loop can act before it lands instead of after.
 *
 * Honest by construction: a projection is only made from real history (≥2
 * points); with too little data it returns "unknown" and proposes nothing —
 * never a fabricated forecast. Pure → unit-testable.
 */

/** Least-squares slope per step over an evenly-spaced series. null if <2 points. */
export function trendSlope(history: number[]): number | null {
  const n = history.length;
  if (n < 2) return null;
  const xs = history.map((_, i) => i);
  const mx = (n - 1) / 2;
  const my = history.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (history[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Project the series `stepsAhead` forward from its last point. null if <2 points. */
export function projectAhead(history: number[], stepsAhead: number): number | null {
  const slope = trendSlope(history);
  if (slope === null) return null;
  return history[history.length - 1] + slope * stepsAhead;
}

/** Days until reserves hit the floor at the current burn. null if not burning. */
export function runwayDays(reserveCents: number, floorCents: number, dailyBurnCents: number): number | null {
  if (dailyBurnCents <= 0) return null; // not burning → no breach
  const headroom = reserveCents - floorCents;
  if (headroom <= 0) return 0; // already at/under the floor
  return headroom / dailyBurnCents;
}

export interface PreemptiveSignal {
  /** Reserve trajectory. */
  reserveCents?: number;
  floorCents?: number;
  dailyBurnCents?: number;
  /** Recent churn-rate history (oldest→newest), e.g. weekly churn %. */
  churnHistory?: number[];
  /** Recent demand history (oldest→newest), e.g. signups/day. */
  demandHistory?: number[];
}

export interface PreemptiveMove {
  kind: "protect_runway" | "retain_ahead_of_churn" | "scale_for_demand";
  /** Lead time in days before the projected problem. */
  leadDays: number;
  rationale: string;
}

/** How many days out a runway breach must be inside to act now. */
export const RUNWAY_LEAD_DAYS = 45;
/** Churn-rate rise (absolute, over the window) that warrants acting ahead. */
export const CHURN_RISE_THRESHOLD = 0.02;

/**
 * Turn projections into pre-emptive moves. Returns only genuinely-warranted
 * moves (a real, near-enough projected problem), highest-urgency first. Pure.
 */
export function forecastToPreemptiveMoves(s: PreemptiveSignal): PreemptiveMove[] {
  const moves: PreemptiveMove[] = [];

  // Runway: act if the projected breach is within the lead window.
  if (s.reserveCents != null && s.floorCents != null && s.dailyBurnCents != null) {
    const days = runwayDays(s.reserveCents, s.floorCents, s.dailyBurnCents);
    if (days != null && days <= RUNWAY_LEAD_DAYS) {
      moves.push({ kind: "protect_runway", leadDays: Math.floor(days), rationale: `reserves project to hit the floor in ~${Math.floor(days)} day(s) at the current burn — protect runway now.` });
    }
  }

  // Churn: act if churn is trending UP meaningfully.
  if (s.churnHistory && s.churnHistory.length >= 2) {
    const slope = trendSlope(s.churnHistory) ?? 0;
    const rise = slope * (s.churnHistory.length - 1);
    if (rise >= CHURN_RISE_THRESHOLD) {
      moves.push({ kind: "retain_ahead_of_churn", leadDays: 7, rationale: `churn rate is trending up (+${(rise * 100).toFixed(1)}pts over the window) — start retention before it compounds.` });
    }
  }

  // Demand: act if signups are projected to rise sharply (capacity/cost ahead).
  if (s.demandHistory && s.demandHistory.length >= 3) {
    const next = projectAhead(s.demandHistory, 7);
    const last = s.demandHistory[s.demandHistory.length - 1];
    if (next != null && last > 0 && next > last * 1.5) {
      moves.push({ kind: "scale_for_demand", leadDays: 7, rationale: `demand projects to rise ~${Math.round(((next - last) / last) * 100)}% next week — prepare support + infra ahead of it.` });
    }
  }

  return moves.sort((a, b) => a.leadDays - b.leadDays);
}

// ────────────────────────────────────────────────────────────────────────────
// Impure source — build the PreemptiveSignal from REAL data and forecast
// (wire-for-real: forecastToPreemptiveMoves was dead). Sources only what exists
// honestly: reserve trajectory + burn (real today). churnHistory/demandHistory
// are omitted — no per-day time-series exists yet, and the pure forecaster
// skips a series with <2 points rather than fabricate one. So today this yields
// the protect_runway move when reserves project to hit the floor inside the
// lead window, and nothing otherwise. Best-effort: [] on any read error.
// ────────────────────────────────────────────────────────────────────────────

export async function computeRunwayForecast(): Promise<PreemptiveMove[]> {
  try {
    const { computeReserveFloor } = await import("../reserveFloorChecker");
    const { getSpendSummary } = await import("../solene/capitalTracker");
    const rf = await computeReserveFloor();
    // Daily burn from the trailing 7-day capital spend (USD → cents/day).
    const spend = await getSpendSummary(7 * 24);
    const dailyBurnCents = Math.max(0, Math.round((spend.totalUsd * 100) / 7));
    return forecastToPreemptiveMoves({
      reserveCents: rf.reservesTotalCents,
      floorCents: rf.floorCents,
      dailyBurnCents,
      // churnHistory / demandHistory deliberately omitted — no real series yet.
    });
  } catch {
    return [];
  }
}
