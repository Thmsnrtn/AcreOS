/**
 * loopStability — constrained exploration + oscillation damping (Frontier #10).
 * KERNEL.
 *
 * Thompson sampling (efficacy.ts) balances explore/exploit per-pick, but two
 * loop-level failure modes sit ABOVE a single pick:
 *
 *  1. UNBOUNDED EXPLORATION — nothing caps how often the brain tries an
 *     under-proven play over its current best. Fine when runway is fat; reckless
 *     when it's thin. The exploration governor bounds the rolling fraction of
 *     decisions that deviate from the greedy (best-evidence) choice: under the
 *     cap → the Thompson pick stands (keep learning); over it → force-exploit.
 *     Safety-monotone — it only ever makes the brain MORE conservative.
 *
 *  2. OSCILLATION — the loop flip-flopping between domains tick-to-tick
 *     (grow→support→grow→support) is unstable, wasteful, and reads as
 *     indecision. detectOscillation scores recent domain churn; dampingFactor
 *     turns a high score into a hysteresis multiplier the caller can use to
 *     resist switching the dominant focus without a decisive reason.
 *
 * loopStall.ts is the DUAL of this: it catches a loop that isn't running.
 * loopStability catches a loop that's running but thrashing. Pure + total — no
 * DB, no clock; the caller supplies the recent history it reads.
 */

export interface ExplorationVerdict {
  /** May this pick deviate from the greedy choice? */
  mayExplore: boolean;
  /** The rolling exploration rate observed (0..1). */
  rate: number;
  /** The cap it was compared against. */
  cap: number;
}

/**
 * Bound exploration. `recentExplores` / `recentTotal` summarise how many of the
 * last N decisions deviated from the greedy choice. With no history (cold start)
 * exploration is always allowed — learning must be able to begin. Pure.
 */
export function governExploration(recentExplores: number, recentTotal: number, cap = 0.5): ExplorationVerdict {
  const e = Math.max(0, recentExplores);
  const n = Math.max(0, recentTotal);
  const rate = n === 0 ? 0 : e / n;
  // Cold start (no history) → allow. Otherwise allow only while under the cap.
  return { mayExplore: n === 0 || rate < cap, rate, cap };
}

/**
 * Tighten the exploration cap as runway tightens — green: full cap; amber: half;
 * red: zero (pure exploitation, every dollar to the proven best). Monotone:
 * never loosens below the base. Pure.
 */
export function explorationCapForRunway(envelopeStatus: "green" | "amber" | "red", baseCap = 0.5): number {
  if (envelopeStatus === "red") return 0; // no exploration when runway is constrained
  if (envelopeStatus === "amber") return baseCap / 2;
  return baseCap;
}

export interface OscillationVerdict {
  /** 0 (perfectly stable) .. 1 (switches every tick). */
  score: number;
  /** True once churn crosses the threshold over a sufficient window. */
  oscillating: boolean;
  /** Distinct foci seen in the window. */
  distinct: number;
}

/**
 * Score domain/focus churn over a recent window. `score` = transitions / (n-1):
 * 0 means it held one focus the whole window, 1 means it switched every tick.
 * `oscillating` requires both a minimum window AND score over the threshold (a
 * couple of switches isn't thrash). Pure + total.
 */
export function detectOscillation(recentFoci: string[], threshold = 0.6, minWindow = 4): OscillationVerdict {
  const n = recentFoci.length;
  if (n < 2) return { score: 0, oscillating: false, distinct: n };
  let transitions = 0;
  for (let i = 1; i < n; i++) if (recentFoci[i] !== recentFoci[i - 1]) transitions++;
  const score = transitions / (n - 1);
  return { score, oscillating: n >= minWindow && score > threshold, distinct: new Set(recentFoci).size };
}

/**
 * A hysteresis multiplier in [floor, 1]: 1 when stable, shrinking toward `floor`
 * as oscillation rises. The caller multiplies a switch-propensity / net-new
 * action weight by this to resist churn without freezing the loop. Pure.
 */
export function dampingFactor(osc: OscillationVerdict, floor = 0.25): number {
  if (!osc.oscillating) return 1;
  return Math.max(floor, 1 - osc.score);
}
