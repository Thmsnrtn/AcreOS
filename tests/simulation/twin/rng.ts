/**
 * Seeded randomness for the market twin. Every draw in the twin goes through a
 * `Rng` created from a seed, so a world is a pure function of its seed: same
 * seed, same counties, owners, replies and churn, byte for byte.
 */
export class Rng {
  private s: number;
  constructor(seed: number | string) {
    this.s = typeof seed === "number" ? seed | 0 : hashSeed(seed);
  }
  /** mulberry32 — small, fast, good enough for simulation draws. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** An independent child stream (so adding draws in one place does not shift another). */
  fork(label: string): Rng {
    return new Rng(hashSeed(`${this.s}:${label}`));
  }
  bernoulli(p: number): boolean {
    return this.next() < p;
  }
  int(lo: number, hiInclusive: number): number {
    return lo + Math.floor(this.next() * (hiInclusive - lo + 1));
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length)];
  }
  /** Standard normal (Box–Muller). */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Lognormal parameterised by its MEDIAN and the sd of log. */
  lognormal(median: number, sdLog: number): number {
    return median * Math.exp(this.normal(0, sdLog));
  }
  /** Poisson (Knuth; fine for the small means the twin uses). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 50) return Math.max(0, Math.round(this.normal(mean, Math.sqrt(mean))));
    const L = Math.exp(-mean);
    let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > L);
    return k - 1;
  }
  /** Draw a key from weights (need not sum to 1). */
  categorical<K extends string>(weights: Record<K, number>): K {
    const entries = Object.entries(weights) as Array<[K, number]>;
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = this.next() * total;
    for (const [k, w] of entries) { if (r < w) return k; r -= w; }
    return entries[entries.length - 1][0];
  }
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

/** Percentile of a numeric sample (linear interpolation). */
export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
export function p10p50p90(xs: number[]): { p10: number; p50: number; p90: number; n: number } {
  return { p10: percentile(xs, 0.1), p50: percentile(xs, 0.5), p90: percentile(xs, 0.9), n: xs.length };
}
