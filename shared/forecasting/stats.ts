/**
 * The few statistics the forecasting models need, written out so every
 * number can be explained. Pure; browser-safe.
 */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26; |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function median(xs: readonly number[]): number | null {
  const v = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Robust standard deviation: 1.4826 × median absolute deviation from the median. */
export function robustSd(xs: readonly number[]): number | null {
  const m = median(xs);
  if (m == null) return null;
  const mad = median(xs.map((x) => Math.abs(x - m)));
  return mad == null ? null : 1.4826 * mad;
}

/**
 * Partial pooling of one number: a group estimate from `n` observations is
 * pulled toward the pooled estimate, more strongly the thinner the group.
 * weight = n / (n + k) — `k` is "how many observations before the group
 * counts as much as everyone else".
 */
export function poolWeight(n: number, k: number): number {
  if (n <= 0) return 0;
  return n / (n + k);
}

export function shrink(groupValue: number | null, n: number, pooledValue: number, k: number): number {
  if (groupValue == null || !Number.isFinite(groupValue)) return pooledValue;
  const w = poolWeight(n, k);
  return w * groupValue + (1 - w) * pooledValue;
}

/** Quantile of a weighted sample (linear in cumulative weight). */
export function weightedQuantile(samples: ReadonlyArray<{ x: number; w: number }>, q: number): number | null {
  const v = samples.filter((s) => Number.isFinite(s.x) && s.w > 0).slice().sort((a, b) => a.x - b.x);
  if (v.length === 0) return null;
  const total = v.reduce((a, s) => a + s.w, 0);
  let acc = 0;
  for (const s of v) {
    acc += s.w;
    if (acc / total >= q) return s.x;
  }
  return v[v.length - 1].x;
}

/**
 * A partially pooled empirical distribution: the group's own samples carry
 * total weight n/(n+k), the pooled samples the rest.
 */
export function pooledSample(group: readonly number[], pooled: readonly number[], k: number): Array<{ x: number; w: number }> {
  const g = group.filter(Number.isFinite);
  const p = pooled.filter(Number.isFinite);
  const wg = p.length === 0 ? 1 : poolWeight(g.length, k);
  const out: Array<{ x: number; w: number }> = [];
  for (const x of g) out.push({ x, w: wg / g.length });
  if (p.length > 0) for (const x of p) out.push({ x, w: (1 - wg) / p.length });
  return out;
}

export function mean(xs: readonly number[]): number | null {
  const v = xs.filter(Number.isFinite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Ordinary least squares y = a + b x. Null when x has no spread. */
export function ols(pairs: ReadonlyArray<{ x: number; y: number }>): { a: number; b: number; n: number } | null {
  const v = pairs.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (v.length < 3) return null;
  const mx = v.reduce((s, p) => s + p.x, 0) / v.length;
  const my = v.reduce((s, p) => s + p.y, 0) / v.length;
  let sxx = 0, sxy = 0;
  for (const p of v) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, n: v.length };
}

export function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
