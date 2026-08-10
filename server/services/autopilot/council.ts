/**
 * council — bounded cognition panel with MEASURED DISAGREEMENT (Frontier #8).
 * KERNEL.
 *
 * deliberate.ts runs ONE model to break a close call. A single voice can be
 * confidently wrong and you'd never know. The council runs a small PANEL of
 * independent voices on the same contested choice and MEASURES how much they
 * disagree — and treats disagreement as a first-class caution signal: a divided
 * council means "this is genuinely uncertain", which should make the loop MORE
 * conservative (lower confidence → escalate to the founder), never less.
 *
 * This is the pure aggregation + the disagreement→confidence mapping (the
 * load-bearing logic). The panel's model CALLS are the expensive part and live
 * in a gated, best-effort runner (runCouncilPanel) that self-disables without a
 * model handle. The confidence it yields combines with calibration confidence
 * by MIN at the risk gate — safety-monotone: it can only tighten escalation.
 *
 * Pure + total — no DB, no clock, no model here.
 */

export interface CouncilVote {
  /** The move kind this voice recommended (must be a real candidate). */
  recommendedKind: string;
}

export interface CouncilAggregate {
  /** The modal (most-voted) recommendation, or null for an empty panel. */
  consensusKind: string | null;
  votes: number;
  /** Fraction of voices agreeing with the consensus, 0..1. */
  agreement: number;
  /** 1 − agreement. High = a divided council = genuine uncertainty. */
  disagreement: number;
  /** Vote counts per recommended kind. */
  tally: Record<string, number>;
}

/**
 * Aggregate independent council votes into a consensus + a measured agreement.
 * Ties resolve to the first-seen kind at the top count (deterministic). Pure +
 * total — an empty panel yields a null consensus + full agreement (no signal,
 * so it cannot manufacture caution out of nothing).
 */
export function aggregateCouncil(votes: CouncilVote[]): CouncilAggregate {
  const tally: Record<string, number> = {};
  for (const v of votes) {
    if (!v || typeof v.recommendedKind !== "string" || !v.recommendedKind) continue;
    tally[v.recommendedKind] = (tally[v.recommendedKind] ?? 0) + 1;
  }
  const counted = Object.values(tally).reduce((s, n) => s + n, 0);
  if (counted === 0) return { consensusKind: null, votes: 0, agreement: 1, disagreement: 0, tally };
  let consensusKind: string | null = null;
  let max = 0;
  for (const [kind, n] of Object.entries(tally)) {
    if (n > max) {
      max = n;
      consensusKind = kind;
    }
  }
  const agreement = max / counted;
  return { consensusKind, votes: counted, agreement, disagreement: 1 - agreement, tally };
}

/**
 * Map a council's agreement to a confidence multiplier in (0,1], mirroring the
 * calibration bands (forecast.loopConfidenceFrom):
 *   • a panel too small to disagree (<2 voices) → 1 (no signal, no penalty),
 *   • unanimous → 1, clear majority (≥⅔) → 0.7, bare majority (>½) → 0.5,
 *   • plurality / tie (≤½ agree) → 0.3 (deeply divided ⇒ strong caution).
 * Combine with calibration confidence by MIN — it can only TIGHTEN escalation.
 * Pure.
 */
export function councilConfidence(agg: CouncilAggregate): number {
  if (agg.votes < 2) return 1;
  if (agg.agreement >= 0.999) return 1;
  if (agg.agreement >= 2 / 3) return 0.7;
  if (agg.agreement > 0.5) return 0.5;
  return 0.3;
}

/**
 * S5 — is this panel CONTESTED enough that the split itself is the news?
 *
 * Deliberately DERIVED from councilConfidence rather than carrying a second
 * threshold: a panel is contested exactly when its confidence has dropped to
 * the bare-majority band or below (agreement ≤ ½). A clear majority (≥ ⅔)
 * still lowers confidence — the risk gate handles that by MIN — but it is not
 * a disagreement worth spending a founder's attention on.
 *
 * One threshold, one place. If the bands ever move, this moves with them and
 * cannot drift. A panel too small to disagree (<2 voices) is never contested —
 * absence of a panel is not evidence of conflict. Pure.
 */
export function councilIsContested(agg: CouncilAggregate): boolean {
  if (agg.votes < 2) return false;
  return councilConfidence(agg) <= 0.5;
}

/** One side of a split panel: a recommended kind and how many voices backed it. */
export interface CouncilSide {
  kind: string;
  votes: number;
}

/**
 * S5 — the two leading positions in the tally, so a contested call can be
 * written up carrying BOTH sides instead of only the winner.
 *
 * `aggregateCouncil` answers "what did the panel decide"; this answers "what
 * did the panel decide AGAINST", which is the half a negotiation memo needs.
 * Ordering is deterministic: votes descending, ties broken by first-seen
 * (insertion) order, exactly like the consensus pick. `opposing` is null when
 * the panel was unanimous — there is no second position to report, and
 * inventing one would be fabrication. Pure + total.
 */
export function councilTopTwo(agg: CouncilAggregate): {
  leading: CouncilSide | null;
  opposing: CouncilSide | null;
} {
  const sides: CouncilSide[] = Object.entries(agg.tally).map(([kind, votes]) => ({ kind, votes }));
  if (sides.length === 0) return { leading: null, opposing: null };
  // Stable sort: Array.prototype.sort is stable in every supported runtime, so
  // equal vote counts keep insertion (first-seen) order.
  const ranked = [...sides].sort((a, b) => b.votes - a.votes);
  return { leading: ranked[0] ?? null, opposing: ranked[1] ?? null };
}
