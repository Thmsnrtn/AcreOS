/**
 * Design slots for forecasts that need AcreOS's OWN data — built now, refusing
 * until the data exists.
 *
 * 1. COUNTY FORECASTS from customer outcomes (closed deals, accepted and
 *    declined offers). A county reads "warming up" — with what it has and what
 *    it needs — until the stated threshold is met. The threshold counts
 *    DISTINCT organisations as well as outcomes: a county whose every
 *    outcome came from one customer would be that customer's private numbers
 *    wearing a county label.
 *
 * 2. SATURATION — how much mail has gone to a county across all customers in
 *    the last 90 days, so a recommendation can say "this county is crowded".
 *    Cross-tenant by nature, so it is aggregate-only with two floors: a county
 *    appears only when at least `minOrgs` organisations mailed it and at least
 *    `minPieces` pieces went out. Below either floor the county is simply not
 *    in the output — not zero, not "low" — and the output carries no
 *    organisation id, no per-organisation count and an org count only as
 *    "at least the floor". A single customer's volume can never be read back.
 *
 * Pure; browser-safe.
 */

export const COUNTY_SLOT_THRESHOLD = {
  /** Recorded customer outcomes in the county. */
  minOutcomes: 30,
  /** Distinct organisations behind them. */
  minOrgs: 3,
  /** Months between the first and last outcome. */
  minSpanMonths: 12,
} as const;

export interface CountyOutcomeStat {
  state: string;
  county: string;
  outcomes: number;
  orgs: number;
  firstObserved: string | null;
  lastObserved: string | null;
}

export type CountySlot =
  | { status: "warming_up"; state: string; county: string; have: { outcomes: number; orgs: number; spanMonths: number }; need: typeof COUNTY_SLOT_THRESHOLD; line: string }
  | { status: "ready"; state: string; county: string; have: { outcomes: number; orgs: number; spanMonths: number } };

function spanMonths(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const [ya, ma] = a.slice(0, 7).split("-").map(Number);
  const [yb, mb] = b.slice(0, 7).split("-").map(Number);
  return Math.max(0, (yb - ya) * 12 + (mb - ma));
}

export function countyForecastSlot(stat: CountyOutcomeStat): CountySlot {
  const T = COUNTY_SLOT_THRESHOLD;
  const have = { outcomes: stat.outcomes, orgs: stat.orgs, spanMonths: spanMonths(stat.firstObserved, stat.lastObserved) };
  if (have.outcomes >= T.minOutcomes && have.orgs >= T.minOrgs && have.spanMonths >= T.minSpanMonths) {
    return { status: "ready", state: stat.state, county: stat.county, have };
  }
  return {
    status: "warming_up",
    state: stat.state,
    county: stat.county,
    have,
    need: T,
    line: `Warming up: a ${stat.county} forecast needs ${T.minOutcomes} recorded outcomes from at least ${T.minOrgs} customers over ${T.minSpanMonths} months.`,
  };
}

export const SATURATION_FLOORS = {
  minOrgs: 3,
  minPieces: 100,
  windowDays: 90,
} as const;

export interface MailVolumeRow {
  organizationId: number;
  state: string;
  county: string;
  pieces: number;
}

export interface CountySaturation {
  state: string;
  county: string;
  /** Rounded down to a multiple of 50. */
  pieces: number;
  /** Never the exact count — only that the floor was met. */
  orgsAtLeast: number;
}

/**
 * Aggregate per-organisation mail volume to counties, dropping any county
 * below either floor. The input carries organisation ids; the output cannot.
 */
export function aggregateSaturation(rows: readonly MailVolumeRow[], floors: { minOrgs: number; minPieces: number } = SATURATION_FLOORS): CountySaturation[] {
  const by = new Map<string, { state: string; county: string; pieces: number; orgs: Set<number> }>();
  for (const r of rows) {
    if (!(r.pieces > 0) || !r.state || !r.county) continue;
    const state = r.state.toUpperCase().trim();
    const county = r.county.trim().replace(/\s+county$/i, "");
    const k = `${state}|${county.toLowerCase()}`;
    let cur = by.get(k);
    if (!cur) by.set(k, (cur = { state, county, pieces: 0, orgs: new Set() }));
    cur.pieces += r.pieces;
    cur.orgs.add(r.organizationId);
  }
  const out: CountySaturation[] = [];
  for (const v of by.values()) {
    if (v.orgs.size < floors.minOrgs || v.pieces < floors.minPieces) continue;
    // Rounded down to a multiple of 50 so a customer who knows its own volume
    // cannot subtract it to read another's exact count.
    out.push({ state: v.state, county: v.county, pieces: Math.floor(v.pieces / 50) * 50, orgsAtLeast: floors.minOrgs });
  }
  return out.sort((a, b) => a.state.localeCompare(b.state) || a.county.localeCompare(b.county));
}
