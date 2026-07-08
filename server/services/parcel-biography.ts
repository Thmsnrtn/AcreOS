/**
 * Parcel Biography Engine — mine the time series, not the first difference
 * (Iyari, Chief of Future — elevation memo idea #1).
 *
 * The delta detector (server/services/parcelDeltaDetector.ts) reads the
 * `parcel_observations` log but only ever compares the LATEST TWO observations
 * per (apn, field). That throws away the entire reason to own history. With N
 * observations per (apn, field) we can compute things no paid provider sells —
 * because they sell a *snapshot* and we own the *longitudinal log*:
 *
 *   - assessed-value VELOCITY and ACCELERATION (is the value climbing, and is
 *     the climb itself speeding up or stalling?)
 *   - owner-TENURE clock (how long has the current owner held — a derived
 *     seller-likelihood prior the moment it crosses a county median)
 *   - tax-delinquency RECURRENCE pattern (a parcel that goes delinquent every
 *     third year is a different lead than one delinquent for the first time)
 *   - deed CADENCE (how often this parcel changes hands)
 *
 * "PropStream shows you today; AcreOS shows you the story." This file is that
 * sentence in code.
 *
 * CONTRACT:
 *   - READ-ONLY against `parcel_observations`. This module never INSERTs,
 *     UPDATEs, or DELETEs. The observation-log writer
 *     (server/services/data-cache/observation-log.ts) is the sole writer; the
 *     delta detector is the sole writer of parcel_alerts. This is a pure read
 *     elevation of an asset we already pay to capture.
 *   - HONEST: derived metrics are only returned when there is enough real data
 *     to compute them (a velocity needs ≥2 points; acceleration needs ≥3). We
 *     never fabricate a trend from a single dot. Series with <2 points are
 *     flagged so the UI can render an honest empty/first-seen state instead of
 *     an invented line.
 *   - Reuses the existing (apn, field, observed_at) index — no new table.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { parcelObservations } from "@shared/schema";
import { logger } from "../utils/logger";

// ----------------------------------------------------------------------------
// Tracked biography fields
// ----------------------------------------------------------------------------

/**
 * The fields whose longitudinal series tells the parcel's story. We keep this
 * superset of the delta detector's TRACKED_FIELDS because the biography cares
 * about value/acres trajectories the alert engine deliberately ignores.
 */
export const BIOGRAPHY_FIELDS = [
  "assessed_value",
  "market_value",
  "tax_amount",
  "tax_status",
  "owner",
  "owner_address",
  "acres",
  // Tier 2A (elevation blueprint 2026-06-10): dated sale observations —
  // observedAt is the REAL sale/deed date (provider data or backfill), so
  // these points reach decades before the platform existed. They are the
  // tenure clock's hard boundaries.
  "sale_price",
  "deed_date",
] as const;
export type BiographyField = (typeof BIOGRAPHY_FIELDS)[number];

// ----------------------------------------------------------------------------
// Public shapes
// ----------------------------------------------------------------------------

/** One immutable point in a field's series, as captured by the log. */
export interface SeriesPoint {
  /** The observed value, normalized only for display/derivation safety. */
  value: unknown;
  /** Numeric coercion of `value` when the field is numeric, else null. */
  numeric: number | null;
  source: string;
  confidence: number | null;
  /** When the fact was observed (NOT when we fetched/derived it). */
  observedAt: Date;
}

/** Velocity/acceleration derived from a numeric series. */
export interface NumericTrend {
  /** First and last numeric points actually used (after dropping non-numerics). */
  firstValue: number;
  lastValue: number;
  firstAt: Date;
  lastAt: Date;
  /** Total change last - first. */
  delta: number;
  /** Fractional change (last - first) / |first|, or null if first === 0. */
  pctChange: number | null;
  /**
   * Velocity = change per YEAR across the full span (units/year). Null when the
   * span is zero (all points same instant) or <2 numeric points.
   */
  velocityPerYear: number | null;
  /**
   * Acceleration = change in velocity between the first-half and second-half
   * segments (units/year²). Null when <3 numeric points or spans degenerate.
   * Positive = the climb is speeding up; negative = it is stalling.
   */
  accelerationPerYear2: number | null;
  /** Monotonic direction across the numeric series. */
  direction: "rising" | "falling" | "flat" | "mixed";
}

/** Recurrence pattern derived from the tax_status series. */
export interface TaxRecurrence {
  /** Count of observations that read as delinquent. */
  delinquentCount: number;
  /** True once the parcel has been delinquent in ≥2 *separate* episodes. */
  isRecurring: boolean;
  /** Number of times status flipped (non-delinquent)→delinquent (new episodes). */
  episodes: number;
  /** Median whole-year gap between the starts of delinquency episodes, or null. */
  medianYearsBetweenEpisodes: number | null;
  /** Whether the most recent observed status reads delinquent. */
  currentlyDelinquent: boolean;
}

/** Owner-tenure clock derived from the owner series. */
export interface OwnerTenure {
  /** Distinct owner changes detected in the series (deed cadence proxy). */
  changeCount: number;
  /** observedAt of the first observation of the CURRENT owner. */
  currentOwnerSince: Date | null;
  /** Whole years the current owner has held as of `asOf`. Null if unknown. */
  currentTenureYears: number | null;
  /**
   * Median whole-year gap between owner changes (deed cadence). Null until we
   * have observed ≥2 changes.
   */
  medianYearsBetweenChanges: number | null;
}

/** Per-field biography: the full ordered series + a provenance summary. */
export interface FieldBiography {
  field: BiographyField | string;
  /** Oldest → newest. Always present (possibly length 0 or 1). */
  series: SeriesPoint[];
  /** observedAt of the oldest point (honest "first seen"). */
  firstSeen: Date | null;
  /** observedAt of the newest point (honest "last confirmed"). */
  lastConfirmed: Date | null;
  /** Distinct sources that contributed to this field's series. */
  sources: string[];
  /**
   * True only when the series has ≥2 real points — i.e. there is an actual
   * trend to render. The UI uses this to choose sparkline vs. honest single-dot
   * / empty state. Never fabricate a line when this is false.
   */
  hasTrend: boolean;
  /** Numeric trend, present only for numeric fields with ≥2 numeric points. */
  trend?: NumericTrend;
}

/** The whole parcel's biography. */
export interface ParcelBiography {
  apn: string;
  state: string;
  county: string;
  /** Per-field series, keyed by field name. */
  fields: Record<string, FieldBiography>;
  /** Convenience: assessed-value trend (the sparkline the card leads with). */
  assessedValue: FieldBiography | null;
  taxStatus: FieldBiography | null;
  owner: FieldBiography | null;
  /** Derived owner-tenure / deed-cadence clock. */
  ownerTenure: OwnerTenure | null;
  /** Derived tax-delinquency recurrence pattern. */
  taxRecurrence: TaxRecurrence | null;
  /** Total observation rows that fed this biography. */
  observationCount: number;
  /** True when at least one field has a real (≥2-point) trend. */
  hasAnySeries: boolean;
}

// ----------------------------------------------------------------------------
// Pure derivation core (exhaustively unit-tested; no DB access)
// ----------------------------------------------------------------------------

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Best-effort numeric coercion. Strips $ , and whitespace. Null on failure. */
export function coerceNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Does a tax_status value read as delinquent? Tolerant of shapes/casing. */
export function isDelinquentStatus(value: unknown): boolean {
  if (value == null) return false;
  const s = String(value).toLowerCase();
  return (
    s.includes("delinquent") ||
    s.includes("past_due") ||
    s.includes("past due") ||
    s.includes("overdue") ||
    s.includes("unpaid") ||
    s.includes("tax_lien") ||
    s.includes("tax lien") ||
    s.includes("lien")
  );
}

/** Whole-number median of a list of millisecond gaps, expressed in years. */
function medianYears(gapsMs: number[]): number | null {
  if (gapsMs.length === 0) return null;
  const years = gapsMs.map((ms) => ms / MS_PER_YEAR).sort((a, b) => a - b);
  const mid = Math.floor(years.length / 2);
  const m = years.length % 2 === 0 ? (years[mid - 1] + years[mid]) / 2 : years[mid];
  return Math.round(m);
}

/**
 * Compute velocity + acceleration over an ordered numeric series. Expects
 * points already sorted oldest→newest. Returns null when there is not enough
 * real data (the honesty gate — never invent a trend).
 */
export function deriveNumericTrend(points: SeriesPoint[]): NumericTrend | null {
  const numeric = points.filter((p) => p.numeric !== null) as Array<
    SeriesPoint & { numeric: number }
  >;
  if (numeric.length < 2) return null;

  const first = numeric[0];
  const last = numeric[numeric.length - 1];
  const delta = last.numeric - first.numeric;
  const spanMs = last.observedAt.getTime() - first.observedAt.getTime();

  const pctChange = first.numeric === 0 ? null : delta / Math.abs(first.numeric);
  const velocityPerYear = spanMs > 0 ? delta / (spanMs / MS_PER_YEAR) : null;

  // Direction: rises vs falls across consecutive numeric pairs.
  let rises = 0;
  let falls = 0;
  for (let i = 1; i < numeric.length; i++) {
    const d = numeric[i].numeric - numeric[i - 1].numeric;
    if (d > 0) rises++;
    else if (d < 0) falls++;
  }
  let direction: NumericTrend["direction"];
  if (rises > 0 && falls > 0) direction = "mixed";
  else if (rises > 0) direction = "rising";
  else if (falls > 0) direction = "falling";
  else direction = "flat";

  // Acceleration: compare velocity of the first half vs the second half. Needs
  // ≥3 numeric points so each half has a real span.
  let accelerationPerYear2: number | null = null;
  if (numeric.length >= 3) {
    const midIdx = Math.floor((numeric.length - 1) / 2);
    const a0 = numeric[0];
    const aMid = numeric[midIdx];
    const aLast = numeric[numeric.length - 1];
    const span1 = aMid.observedAt.getTime() - a0.observedAt.getTime();
    const span2 = aLast.observedAt.getTime() - aMid.observedAt.getTime();
    if (span1 > 0 && span2 > 0) {
      const v1 = (aMid.numeric - a0.numeric) / (span1 / MS_PER_YEAR);
      const v2 = (aLast.numeric - aMid.numeric) / (span2 / MS_PER_YEAR);
      // Years between the two segment midpoints.
      const midGapYears =
        (aLast.observedAt.getTime() - a0.observedAt.getTime()) / 2 / MS_PER_YEAR;
      accelerationPerYear2 = midGapYears > 0 ? (v2 - v1) / midGapYears : null;
    }
  }

  return {
    firstValue: first.numeric,
    lastValue: last.numeric,
    firstAt: first.observedAt,
    lastAt: last.observedAt,
    delta,
    pctChange,
    velocityPerYear,
    accelerationPerYear2,
    direction,
  };
}

/**
 * Derive the owner-tenure clock + deed cadence from an ordered owner series.
 * Consecutive identical owner values collapse (the log records every lookup, so
 * the same owner appears many times — a *change* is a new distinct value).
 *
 * Tier 2A (elevation blueprint 2026-06-10): `saleEvents` are dated sale/deed
 * observations (observedAt = the REAL sale date). A sale IS an ownership
 * boundary, so:
 *   - the current owner's tenure start is pulled BACK to the most recent sale
 *     at or before their first sighting (a 1994 deed beats a 2026 first-lookup
 *     date by three decades of honest depth);
 *   - sale dates that fall outside the observed transition windows join the
 *     deed-cadence boundary set, deepening changeCount + the median gap.
 */
export function deriveOwnerTenure(
  points: SeriesPoint[],
  asOf: Date = new Date(),
  saleEvents: Date[] = [],
): OwnerTenure | null {
  const named = points.filter((p) => {
    const s = p.value == null ? "" : String(p.value).trim().toLowerCase();
    return s !== "" && s !== "unknown" && s !== "n/a";
  });
  if (named.length === 0) return null;

  // Collapse consecutive identical owners; capture the observedAt that each
  // distinct owner FIRST appeared (the start of that tenure) and the
  // observedAt they were LAST seen (closes the transition window).
  const tenures: Array<{ owner: string; since: Date; lastSeen: Date }> = [];
  for (const p of named) {
    const owner = String(p.value).trim();
    const prev = tenures[tenures.length - 1];
    if (!prev || prev.owner.toLowerCase() !== owner.toLowerCase()) {
      tenures.push({ owner, since: p.observedAt, lastSeen: p.observedAt });
    } else {
      prev.lastSeen = p.observedAt;
    }
  }

  // Normalize + sort sale boundaries; drop implausible future dates.
  const sales = saleEvents
    .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()) && d.getTime() <= asOf.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  const current = tenures[tenures.length - 1];
  const previous = tenures.length >= 2 ? tenures[tenures.length - 2] : null;

  // Refine the current owner's tenure start: the most recent sale at or
  // before their first sighting. When a previous owner was observed, the sale
  // must fall AFTER that owner was last seen (otherwise it belongs to an
  // earlier transition, not this one).
  let currentOwnerSince = current.since;
  for (const sale of sales) {
    if (sale.getTime() > current.since.getTime()) break;
    if (previous && sale.getTime() <= previous.lastSeen.getTime()) continue;
    currentOwnerSince = sale; // last qualifying sale wins (sorted ascending)
  }

  const currentTenureYears = Math.max(
    0,
    Math.floor((asOf.getTime() - currentOwnerSince.getTime()) / MS_PER_YEAR),
  );

  // Deed-cadence boundary set: observed transition starts (with the refined
  // current start) + sale dates not already explained by an observed
  // transition. A sale within ±1 year of an existing boundary is the SAME
  // hand-change seen twice (the observation lag), not a new one.
  const ONE_YEAR_MS = MS_PER_YEAR;
  const boundaries: Date[] = tenures.map((t, i) =>
    i === tenures.length - 1 ? currentOwnerSince : t.since,
  );
  for (const sale of sales) {
    const nearExisting = boundaries.some(
      (b) => Math.abs(b.getTime() - sale.getTime()) <= ONE_YEAR_MS,
    );
    if (!nearExisting) boundaries.push(sale);
  }
  boundaries.sort((a, b) => a.getTime() - b.getTime());

  const changeCount = boundaries.length - 1; // transitions between holds
  let medianYearsBetweenChanges: number | null = null;
  if (boundaries.length >= 3) {
    const gaps: number[] = [];
    for (let i = 1; i < boundaries.length; i++) {
      gaps.push(boundaries[i].getTime() - boundaries[i - 1].getTime());
    }
    medianYearsBetweenChanges = medianYears(gaps);
  }

  return {
    changeCount,
    currentOwnerSince,
    currentTenureYears,
    medianYearsBetweenChanges,
  };
}

/**
 * Derive the tax-delinquency recurrence pattern from an ordered tax_status
 * series. An "episode" is a transition from non-delinquent → delinquent; a
 * parcel delinquent across multiple separated episodes is recurring (a
 * materially different lead than a first-time delinquency).
 */
export function deriveTaxRecurrence(points: SeriesPoint[]): TaxRecurrence | null {
  if (points.length === 0) return null;

  let delinquentCount = 0;
  let episodes = 0;
  let prevDelinquent = false;
  const episodeStarts: Date[] = [];

  for (const p of points) {
    const delinquent = isDelinquentStatus(p.value);
    if (delinquent) {
      delinquentCount++;
      if (!prevDelinquent) {
        episodes++;
        episodeStarts.push(p.observedAt);
      }
    }
    prevDelinquent = delinquent;
  }

  let medianYearsBetweenEpisodes: number | null = null;
  if (episodeStarts.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < episodeStarts.length; i++) {
      gaps.push(episodeStarts[i].getTime() - episodeStarts[i - 1].getTime());
    }
    medianYearsBetweenEpisodes = medianYears(gaps);
  }

  return {
    delinquentCount,
    isRecurring: episodes >= 2,
    episodes,
    medianYearsBetweenEpisodes,
    currentlyDelinquent: prevDelinquent,
  };
}

/** Build a per-field biography from an ordered (oldest→newest) point list. */
export function buildFieldBiography(
  field: string,
  series: SeriesPoint[],
): FieldBiography {
  const sources = Array.from(new Set(series.map((p) => p.source))).filter(Boolean);
  const firstSeen = series.length > 0 ? series[0].observedAt : null;
  const lastConfirmed = series.length > 0 ? series[series.length - 1].observedAt : null;
  const hasTrend = series.length >= 2;

  const bio: FieldBiography = {
    field,
    series,
    firstSeen,
    lastConfirmed,
    sources,
    hasTrend,
  };

  const trend = deriveNumericTrend(series);
  if (trend) bio.trend = trend;
  return bio;
}

/**
 * Assemble a full ParcelBiography from a flat list of observation rows for ONE
 * parcel. Pure — no DB. Exposed for unit testing the aggregation. Rows may
 * arrive in any order; this sorts per field oldest→newest.
 */
export function assembleBiography(
  apn: string,
  state: string,
  county: string,
  rows: Array<{
    field: string;
    value: unknown;
    source: string;
    confidence: number | null;
    observedAt: Date;
  }>,
  asOf: Date = new Date(),
): ParcelBiography {
  const byField = new Map<string, SeriesPoint[]>();
  for (const r of rows) {
    const point: SeriesPoint = {
      value: r.value,
      numeric: coerceNumeric(r.value),
      source: r.source,
      confidence: r.confidence,
      observedAt: r.observedAt,
    };
    const arr = byField.get(r.field);
    if (arr) arr.push(point);
    else byField.set(r.field, [point]);
  }

  const fields: Record<string, FieldBiography> = {};
  for (const [field, points] of byField.entries()) {
    points.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    fields[field] = buildFieldBiography(field, points);
  }

  const ownerSeries = byField.get("owner") ?? [];
  const taxStatusSeries = byField.get("tax_status") ?? [];

  // Tier 2A: dated sale observations (observedAt = the REAL sale date) act as
  // hard ownership boundaries for the tenure clock. deed_date + sale_price
  // points dedupe by day (one sale is usually recorded as both fields).
  const saleEventDays = new Set<string>();
  const saleEvents: Date[] = [];
  for (const fieldName of ["deed_date", "sale_price"]) {
    for (const p of byField.get(fieldName) ?? []) {
      const day = p.observedAt.toISOString().slice(0, 10);
      if (saleEventDays.has(day)) continue;
      saleEventDays.add(day);
      saleEvents.push(p.observedAt);
    }
  }

  const ownerTenure = ownerSeries.length > 0 ? deriveOwnerTenure(ownerSeries, asOf, saleEvents) : null;
  const taxRecurrence = taxStatusSeries.length > 0 ? deriveTaxRecurrence(taxStatusSeries) : null;

  const hasAnySeries = Object.values(fields).some((f) => f.hasTrend);

  return {
    apn,
    state,
    county,
    fields,
    assessedValue: fields["assessed_value"] ?? null,
    taxStatus: fields["tax_status"] ?? null,
    owner: fields["owner"] ?? null,
    ownerTenure,
    taxRecurrence,
    observationCount: rows.length,
    hasAnySeries,
  };
}

// ----------------------------------------------------------------------------
// Log-native seller-likelihood scorer (Iyari — Chief of Future)
// ----------------------------------------------------------------------------
//
// The feature engine above computes owner-tenure, value velocity/acceleration,
// and tax-delinquency recurrence from the append-only observation log — but
// until now those features terminated at a UI card; no SCORE consumed them.
// Meanwhile the deal-feed ranker sources 25% of its composite (the
// `ownerMotivation` pillar) from a CONVERSATION-driven predictor that returns a
// neutral 50 for any cold parcel (no leadId) — exactly the cold discovery
// parcels the feed exists to surface.
//
// This is a v0 HEURISTIC (not ML): a monotone function over features we already
// own, deliberately simple and explainable, whose only job is to PROVE the
// longitudinal asset is predictive (see the parcel_alerts backtest) before we
// spend a model on it. It introduces no new table, no new external data, and no
// new capture — a pure read elevation.
//
// HONESTY GATE: when the biography has no real series (hasAnySeries === false),
// the scorer returns null. We never fabricate motivation from a single dot —
// consistent with the no-fabrication ratchet and the engine's own contract. The
// deal feed falls open to its existing neutral default when this is null.

/** Result of the log-native seller-likelihood heuristic. */
export interface SellerLikelihood {
  /** 0-100. Higher = more likely the current owner sells. Monotone in drivers. */
  score: number;
  /**
   * Human-readable reasons that moved the score, strongest first. The biography
   * card is the explanation surface; these are its bullet points.
   */
  drivers: string[];
}

// Heuristic constants — deliberately legible. Tuning lives here, not in ML.
const SELLER_LIKELIHOOD_BASE = 30; // a cold long-history parcel starts below neutral
const TENURE_LONG_YEARS = 15; // a passive holder past this is materially more likely
const TENURE_VERY_LONG_YEARS = 25; // estate / generational-hold territory

/**
 * Score how likely the CURRENT owner is to sell, from the parcel's longitudinal
 * biography alone. PURE — no DB, no I/O. Monotone: every driver can only raise
 * the score, so the ordering is interpretable and never self-cancels.
 *
 * Drivers (all sourced from EXISTING biography features):
 *   - long owner tenure (a passive holder — derived from the owner series)
 *   - recurring tax delinquency (a chronically-strained owner)
 *   - currently delinquent (an acute trigger)
 *   - stalling assessed-value acceleration (the climb is decelerating — the
 *     owner's paper-gain thesis is weakening)
 *
 * Returns null when there is no real series to reason over (honesty gate).
 */
export function scoreSellerLikelihood(
  bio: ParcelBiography,
): SellerLikelihood | null {
  // Honesty gate: no field has ≥2 real points → nothing longitudinal to mine.
  // Never invent motivation from a single observed dot.
  if (!bio || !bio.hasAnySeries) return null;

  let score = SELLER_LIKELIHOOD_BASE;
  const drivers: string[] = [];

  // --- Owner tenure (passive-holder prior) ------------------------------------
  const tenureYears = bio.ownerTenure?.currentTenureYears ?? null;
  if (tenureYears != null) {
    if (tenureYears >= TENURE_VERY_LONG_YEARS) {
      score += 30;
      drivers.push(`Owned ${tenureYears}+ yrs (long passive hold)`);
    } else if (tenureYears >= TENURE_LONG_YEARS) {
      score += 18;
      drivers.push(`Owned ${tenureYears} yrs (passive holder)`);
    } else if (tenureYears >= 8) {
      score += 8;
      drivers.push(`Owned ${tenureYears} yrs`);
    }
  }

  // --- Tax-delinquency recurrence + acute state -------------------------------
  const tax = bio.taxRecurrence;
  if (tax) {
    if (tax.isRecurring) {
      score += 22;
      drivers.push(
        tax.episodes >= 3
          ? `Chronically tax-delinquent (${tax.episodes} episodes)`
          : "Recurring tax delinquency",
      );
    }
    if (tax.currentlyDelinquent) {
      score += 15;
      drivers.push("Currently tax delinquent");
    }
  }

  // --- Stalling assessed-value acceleration -----------------------------------
  // A decelerating climb (accel < 0) means the owner's unrealized-gain thesis is
  // weakening — a classic prompt to take the gain. Only counts when we actually
  // have ≥3 numeric points (deriveNumericTrend already enforces that; accel is
  // null otherwise, so this never fires on thin data).
  const accel = bio.assessedValue?.trend?.accelerationPerYear2 ?? null;
  const valueDirection = bio.assessedValue?.trend?.direction ?? null;
  if (accel != null && accel < 0 && (valueDirection === "rising" || valueDirection === "flat")) {
    score += 10;
    drivers.push("Value appreciation stalling");
  }

  // Clamp into range. (Base + all drivers can exceed 100; clamp keeps it honest.)
  score = Math.max(0, Math.min(100, score));

  // If nothing fired beyond the base, the parcel has a real series but no
  // motivation signal — report the base honestly with an explanatory driver so
  // the ranker still gets a real (low) number rather than the conversation
  // predictor's neutral 50.
  if (drivers.length === 0) {
    drivers.push("Longitudinal history present; no motivation signal");
  }

  return { score, drivers };
}

// ----------------------------------------------------------------------------
// DB-backed reader (the only DB access; SELECT only)
// ----------------------------------------------------------------------------

export interface GetBiographyParams {
  apn: string;
  state: string;
  county?: string | null;
  /** Org scope: this org's rows OR global (null org) rows, like the detector. */
  organizationId: number;
  asOf?: Date;
}

/**
 * Read the full ordered observation series for a parcel and assemble its
 * biography. READ-ONLY. Uses the (apn, field, observed_at) index. Org-scoped to
 * this tenant's rows plus globally-shared (null-org) observations — identical
 * visibility model to the delta detector. Returns an empty (but well-formed)
 * biography when there is nothing yet (honest empty state, never throws).
 */
export async function getParcelBiography(
  params: GetBiographyParams,
): Promise<ParcelBiography> {
  const { apn, state, county, organizationId, asOf } = params;
  const upperState = (state || "").toUpperCase();

  const empty: ParcelBiography = {
    apn,
    state: upperState,
    county: county || "",
    fields: {},
    assessedValue: null,
    taxStatus: null,
    owner: null,
    ownerTenure: null,
    taxRecurrence: null,
    observationCount: 0,
    hasAnySeries: false,
  };

  if (!apn || !upperState) return empty;

  try {
    const conditions = [
      eq(parcelObservations.apn, apn),
      eq(sql`upper(${parcelObservations.state})`, upperState),
      inArray(parcelObservations.field, BIOGRAPHY_FIELDS as unknown as string[]),
      sql`(${parcelObservations.organizationId} = ${organizationId} OR ${parcelObservations.organizationId} IS NULL)`,
    ];
    if (county) {
      conditions.push(eq(sql`lower(${parcelObservations.county})`, county.toLowerCase()));
    }

    const rows = await db
      .select({
        field: parcelObservations.field,
        value: parcelObservations.value,
        source: parcelObservations.source,
        confidence: parcelObservations.confidence,
        observedAt: parcelObservations.observedAt,
      })
      .from(parcelObservations)
      .where(and(...conditions))
      // Index-ordered; assembleBiography re-sorts per field defensively.
      .orderBy(
        asc(parcelObservations.field),
        asc(parcelObservations.observedAt),
        asc(parcelObservations.id),
      );

    if (rows.length === 0) return empty;

    return assembleBiography(apn, upperState, county || "", rows, asOf ?? new Date());
  } catch (err) {
    // Read elevation must never break the parcel response; degrade to empty.
    logger.warn("[parcelBiography] read failed (non-fatal)", {
      metadata: {
        apn,
        state: upperState,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return empty;
  }
}
