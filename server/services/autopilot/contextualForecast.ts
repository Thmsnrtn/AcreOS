/**
 * Founder Autopilot — contextual forecasting + recalibration (T2).
 *
 * The teardown's AI/ML critique: the forecast was MARGINAL — P(success | play),
 * ignoring the situation — while episodic memory matched situations separately.
 * This unifies them into P(success | situation, action), and corrects the
 * system's systematic over/under-confidence with an honest, empirical
 * recalibration (no fabricated outputs, no opaque model).
 *
 * 1. contextualForecast(global, local) — shrinkage blend of the play's GLOBAL
 *    track record with its LOCAL track record in similar past situations
 *    (episodic memory). Little local data → fall back to global; lots of
 *    similar-situation evidence → trust the local. Principled + total.
 *
 * 2. Recalibration — buildRecalibrationMap(pairs) bins (predicted, actual)
 *    history and learns the EMPIRICAL actual rate per confidence band;
 *    applyRecalibration(p) maps a raw prediction to what that confidence has
 *    actually meant. Corrects "I say 90% but only 60% happen" with real data,
 *    not a guess. Sparse bands pass through unchanged (honest — no correction
 *    without evidence).
 *
 * All pure + deterministic → exhaustively testable.
 */
import { reliabilityCurve, type CalibrationPair } from "./forecast";

export interface Evidence {
  successes: number;
  failures: number;
}

/** Laplace-smoothed rate. */
function rate(e: Evidence): number {
  const s = Math.max(0, e.successes);
  const f = Math.max(0, e.failures);
  return (1 + s) / (2 + s + f);
}

/**
 * Blend a play's global rate with its rate in SIMILAR situations. The local
 * (contextual) evidence earns weight as it accumulates: localWeight =
 * localN/(localN + k). Pure + total.
 */
export function contextualForecast(global: Evidence, local: Evidence, shrinkageK = 5): { prob: number; localWeight: number } {
  const localN = Math.max(0, local.successes) + Math.max(0, local.failures);
  const localWeight = localN / (localN + Math.max(1, shrinkageK));
  const prob = localWeight * rate(local) + (1 - localWeight) * rate(global);
  return { prob: Math.max(0, Math.min(1, prob)), localWeight };
}

export interface RecalibrationMap {
  buckets: number;
  /** Per-band empirical actual rate; null where there isn't enough evidence. */
  bands: Array<{ from: number; to: number; actualRate: number | null; n: number }>;
  /** A band needs at least this many samples to be trusted. */
  minBandN: number;
}

/**
 * Learn the empirical actual rate per confidence band from real (predicted,
 * actual) history. Bands with fewer than minBandN samples are left untrusted
 * (null) so they pass through unchanged. Pure.
 */
export function buildRecalibrationMap(pairs: CalibrationPair[], buckets = 5, minBandN = 8): RecalibrationMap {
  const curve = reliabilityCurve(pairs, buckets);
  return {
    buckets,
    minBandN,
    bands: curve.map((b) => ({ from: b.from, to: b.to, actualRate: b.n >= minBandN ? b.actualRate : null, n: b.n })),
  };
}

/**
 * Map a raw prediction to what that confidence has ACTUALLY meant historically.
 * Falls back to the raw value when the band lacks evidence. Pure + total.
 */
export function applyRecalibration(p: number, map: RecalibrationMap): number {
  const x = Number.isFinite(p) ? Math.max(0, Math.min(0.999999, p)) : 0.5;
  const idx = Math.min(map.buckets - 1, Math.floor(x * map.buckets));
  const band = map.bands[idx];
  if (!band || band.actualRate == null) return Math.max(0, Math.min(1, p));
  return band.actualRate;
}
