/**
 * Founder Autopilot — the efficacy model (Thompson sampling over real outcomes).
 *
 * The learning core. Given each candidate play's RECORDED outcomes — successes
 * and failures derived only from genuine signals (founder approval, eval score,
 * mechanical dispatch result, support resolution) — it picks the next play by
 * Thompson sampling over a Beta-Bernoulli posterior.
 *
 * Why Thompson sampling (the principled choice, not a gimmick):
 *  - Provably near-optimal explore/exploit with ZERO tuned hyperparameters.
 *  - Cold-start = today: with no data every posterior is the uniform prior
 *    Beta(1,1), so selection is effectively uniform/rotation — nothing changes
 *    until real outcomes accrue. Learning is purely additive.
 *  - No starvation: a wide prior guarantees under-tested plays keep getting
 *    explored; one bad outcome can't kill a play.
 *  - Transparent: every play exposes its real track record (successes/failures),
 *    so the founder always sees the evidence behind a preference.
 *
 * Pure + deterministic: the sampler takes an injected RNG so unit tests are
 * exact. Production passes a per-tick-seeded RNG. No DB, no clock here.
 */

/** A play's recorded, real-signal track record. */
export interface PlayStats {
  playId: string;
  successes: number;
  failures: number;
}

export interface ScoredPlay extends PlayStats {
  /** Posterior mean = (α)/(α+β) with α=1+successes, β=1+failures. For display. */
  posteriorMean: number;
  /** Total recorded outcomes (successes + failures) — the evidence weight. */
  n: number;
  /** The Thompson draw this round (only meaningful within a single select call). */
  sample: number;
}

/** Deterministic RNG: returns a float in [0,1). Injected for testable sampling. */
export type Rng = () => number;

/**
 * A seeded PRNG (mulberry32). Deterministic for a given seed → the production
 * caller seeds it from the tick time so selection varies per tick while staying
 * a pure, reproducible *sampling* source (not fabricated data, not Math.random).
 */
export function makeSeededRng(seed: number): Rng {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample from Beta(α, β) using two Gamma draws (Marsaglia–Tsang), Gamma via the
 * standard method. Pure given the rng. α, β ≥ 1 here (we always add the uniform
 * prior), so the shape>=1 path is sufficient and exact enough for selection.
 */
export function sampleBeta(alpha: number, beta: number, rng: Rng): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  // Guard the degenerate case (both ~0) → fall back to the mean.
  if (x + y === 0) return alpha / (alpha + beta);
  return x / (x + y);
}

/** Marsaglia–Tsang Gamma(shape, 1) for shape >= 1. Pure given the rng. */
function sampleGamma(shape: number, rng: Rng): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Bounded retries so a pathological RNG can't spin forever; falls back to d.
  for (let i = 0; i < 64; i++) {
    const z = standardNormal(rng);
    const v0 = 1 + c * z;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    const u = clampUnit(rng());
    if (u < 1 - 0.0331 * z * z * z * z) return d * v;
    if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;
  }
  return d;
}

/** Box–Muller standard normal from two uniforms. Pure given the rng. */
function standardNormal(rng: Rng): number {
  const u1 = Math.max(1e-12, clampUnit(rng()));
  const u2 = clampUnit(rng());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x < 0) return 0;
  if (x >= 1) return 0.9999999;
  return x;
}

/** Extra prior pseudo-counts added to the Beta(1,1) base (the pooled prior). */
export interface PlayPrior {
  alpha: number;
  beta: number;
}

const FLAT_PRIOR: PlayPrior = { alpha: 0, beta: 0 };

/**
 * The empirical-Bayes POOLED prior (kernel-elevation T3 / #14 — the hierarchical
 * primitive). An unproven play shouldn't start at a blind 0.5 once the org has a
 * track record across its OTHER plays — it should inherit the pooled success
 * rate as its prior. Returns extra pseudo-counts to add to the Beta(1,1) base:
 *   • no data anywhere → {0,0} → the base stays exactly Beta(1,1) (cold-start
 *     unchanged — learning is still purely additive);
 *   • with data → priorStrength × the pooled mean / (1−mean).
 * At one tenant this pools across that tenant's plays; the SAME function pools
 * across TENANTS once experiences carry a scope (the cross-vertical data-co-op
 * moat) — every tenant's outcomes sharpen a shared prior each new tenant
 * inherits, then sharpens to its own truth. Pure. Honesty-preserving: pooling
 * moves only the PRIOR, never a displayed track record.
 */
export function pooledPrior(stats: PlayStats[], priorStrength = 2): PlayPrior {
  let totalS = 0;
  let totalF = 0;
  for (const s of stats) {
    totalS += Math.max(0, s.successes);
    totalF += Math.max(0, s.failures);
  }
  const n = totalS + totalF;
  if (n === 0) return FLAT_PRIOR; // cold-start: contributes nothing → Beta(1,1)
  const mean = totalS / n;
  return { alpha: priorStrength * mean, beta: priorStrength * (1 - mean) };
}

/**
 * Score + Thompson-sample every play. Returns them sorted by this round's
 * sample (highest first) — `[0]` is the pick. Total: an empty list returns [].
 * `prior` (default flat → Beta(1,1)) lets the caller pass a pooled/hierarchical
 * prior; it only ever ADDS pseudo-counts, so α,β stay ≥ 1 (sampleBeta-valid).
 */
export function scorePlays(stats: PlayStats[], rng: Rng, prior: PlayPrior = FLAT_PRIOR): ScoredPlay[] {
  const pa = Math.max(0, prior.alpha);
  const pb = Math.max(0, prior.beta);
  return stats
    .map((s) => {
      const successes = Math.max(0, s.successes);
      const failures = Math.max(0, s.failures);
      const alpha = 1 + pa + successes;
      const beta = 1 + pb + failures;
      return {
        ...s,
        successes,
        failures,
        n: successes + failures,
        posteriorMean: alpha / (alpha + beta),
        sample: sampleBeta(alpha, beta, rng),
      };
    })
    .sort((a, b) => b.sample - a.sample);
}

/**
 * Pick the next play id by Thompson sampling. Returns null only for an empty
 * candidate list. The caller supplies the candidate set (so a paused/retired
 * play simply isn't passed in) and an optional pooled prior.
 */
export function selectPlay(stats: PlayStats[], rng: Rng, prior: PlayPrior = FLAT_PRIOR): string | null {
  const scored = scorePlays(stats, rng, prior);
  return scored.length ? scored[0].playId : null;
}

/**
 * A play's display-ready efficacy: the posterior mean over real outcomes, plus
 * the evidence count. Deterministic (no sampling) — for the daily letter.
 */
export function efficacyOf(s: PlayStats): { rate: number; n: number } {
  const successes = Math.max(0, s.successes);
  const failures = Math.max(0, s.failures);
  return { rate: (1 + successes) / (2 + successes + failures), n: successes + failures };
}
