/**
 * Founder Autopilot — learned policy thresholds (Elite roadmap Leap 1).
 *
 * The whole foundation runs on hand-typed constants: "auto-resolve when
 * confidence ≥ 0.8", "pay when ≥ 5 attributed signups". Those are guesses. Leap
 * 1 is the move from *rules* to *learning*: turn a TYPED threshold into a LEARNED
 * one, calibrated from real (signal → outcome) history, so the system tunes its
 * own gates from what actually worked instead of trusting a number someone typed.
 *
 * This is the mechanism the action-ladder gates adopt: any "act when signal ≥ T"
 * gate can call learnThreshold to make T self-calibrating. It pairs with the E1
 * decision-quality eval harness — the harness MEASURES policy quality; this
 * IMPROVES the policy from outcomes.
 *
 * Honest by construction:
 *   • cold-start-safe — below `minSamples` it returns the typed default and says
 *     so (no pretending to have learned from thin data);
 *   • conservative — it only lowers the bar to where the data supports acting at
 *     the target success rate, never below; if nothing clears the target it keeps
 *     the safe default.
 * Pure → exhaustively unit-testable.
 */

export interface SignalOutcome {
  /** The decision signal at the time (e.g. AI confidence, lead score). */
  signal: number;
  /** Whether acting at that signal actually succeeded. */
  success: boolean;
}

export interface LearnedThreshold {
  threshold: number;
  /** Did it come from data, or the typed fallback? */
  source: "learned" | "default";
  /** Resolved samples that informed it. */
  n: number;
  /** Observed success rate at/above the chosen threshold (null for default). */
  rateAtThreshold: number | null;
}

export interface LearnThresholdOpts {
  /** Below this many samples, keep the typed default. */
  minSamples?: number;
  /** Only act where the historical success rate clears this. */
  targetSuccessRate?: number;
  /** A candidate threshold's bucket (signal ≥ t) must have at least this many
   *  samples to be trusted (avoids over-fitting a tiny tail). */
  minBucket?: number;
}

/**
 * Learn the LOWEST threshold on `signal` at/above which acting historically
 * succeeds at ≥ targetSuccessRate (act as early as the data supports, never
 * earlier). Falls back to `defaultThreshold` below minSamples, or when no
 * threshold clears the target. Pure + deterministic.
 */
export function learnThreshold(
  history: SignalOutcome[],
  defaultThreshold: number,
  opts: LearnThresholdOpts = {},
): LearnedThreshold {
  const minSamples = opts.minSamples ?? 30;
  const target = opts.targetSuccessRate ?? 0.7;
  const minBucket = opts.minBucket ?? 8;

  if (history.length < minSamples) {
    return { threshold: defaultThreshold, source: "default", n: history.length, rateAtThreshold: null };
  }

  // Candidate thresholds = the distinct signal values, ascending. For each, the
  // success rate among samples with signal ≥ t. Pick the LOWEST t that clears
  // the target with a trustworthy bucket size.
  const candidates = [...new Set(history.map((h) => h.signal))].sort((a, b) => a - b);
  for (const t of candidates) {
    const bucket = history.filter((h) => h.signal >= t);
    if (bucket.length < minBucket) continue;
    const rate = bucket.filter((h) => h.success).length / bucket.length;
    if (rate >= target) {
      return { threshold: t, source: "learned", n: history.length, rateAtThreshold: rate };
    }
  }

  // Nothing cleared the target → keep the conservative typed default.
  return { threshold: defaultThreshold, source: "default", n: history.length, rateAtThreshold: null };
}

/** One-line note on a learned gate, for the glass-box trace / letter. Pure. */
export function learnedThresholdLine(name: string, lt: LearnedThreshold): string {
  if (lt.source === "default") {
    return `${name}: using typed default ${lt.threshold} (${lt.n} samples — not enough to learn yet).`;
  }
  return `${name}: LEARNED threshold ${lt.threshold.toFixed(2)} from ${lt.n} samples (${Math.round((lt.rateAtThreshold ?? 0) * 100)}% success at/above).`;
}
