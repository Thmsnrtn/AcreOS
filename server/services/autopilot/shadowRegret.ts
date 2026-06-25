/**
 * Founder Autopilot — SHADOW REGRET (off-policy decision quality). KERNEL.
 *
 * When the brain weighs N candidate moves and picks ONE, the roads NOT taken are
 * never observed. Shadow regret estimates the value left on the table by
 * comparing the chosen move against the alternatives' MODEL-PREDICTED value —
 * "did urgency/priority override a higher-EV option, and by roughly how much?"
 *
 * ┌─ THE SACRED LINE (the frozen learning invariant) ─────────────────────────┐
 * │ A not-taken road's value is ESTIMATED, never observed. Shadow regret is    │
 * │ therefore a READ-ONLY analytical + glass-box signal ONLY. It is            │
 * │ STRUCTURALLY INCAPABLE of feeding the reward edge (Thompson sampling):     │
 * │   • this module imports NOTHING from experienceLog / efficacy,             │
 * │   • its output type has NO successes/failures field — it cannot be coerced │
 * │     into a PlayStats,                                                       │
 * │   • `isEstimate: true` is non-optional and always set.                     │
 * │ It informs the FOUNDER (glass-box) and MAY emphasise exploration — it      │
 * │ NEVER converts to a success/failure, NEVER moves a posterior. Counterfact- │
 * │ ual estimates that touched the reward would be exactly the fabrication the │
 * │ learning loop was frozen to prevent.                                       │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Two flavors, both pure + total (no DB, no clock):
 *   • prospectiveRegret — at DECISION time: chosen vs alternatives, both
 *     model-predicted. Measures decision QUALITY against the model's own
 *     ranking (regret>0 ⇒ a higher-EV option was deprioritised, usually because
 *     the safety ladder put urgency first — honest, not a bug).
 *   • retrospectiveRegret — AFTER the outcome: chosen's REALIZED value vs the
 *     alternatives' PREDICTED value. "We got $X; the model thought Y might have
 *     done $Z" — explicitly an estimate (Y was never run).
 */

/** A move and its value. For alternatives this is always model-PREDICTED. */
export interface CandidateValuation {
  kind: string;
  /** Value of this move. Model-predicted for alternatives (an estimate). */
  value: number;
}

/**
 * A shadow-regret reading. NOTE the absence of any successes/failures field —
 * this is deliberate and load-bearing: the type cannot be passed where the
 * reward edge expects PlayStats, so an estimate can never leak into learning.
 */
export interface ShadowRegret {
  chosenKind: string;
  /** Value attributed to the chosen move (realized for retrospective, else predicted). */
  chosenValue: number;
  /** The best UNCHOSEN alternative by predicted value, or null if none existed. */
  bestAlternativeKind: string | null;
  /** Best alternative's model-PREDICTED value (null if no alternatives). */
  bestAlternativeValue: number | null;
  /** max(0, bestAltPredicted − chosenValue). Always ≥ 0. 0 ⇒ no road looked better. */
  regret: number;
  /** ALWAYS true — the alternatives' value is model-estimated, never observed. */
  isEstimate: true;
  /** "prospective" (both predicted) | "retrospective" (chosen realized). */
  basis: "prospective" | "retrospective";
}

/** The best alternative strictly OTHER than `chosenKind`, by value desc. Pure. */
function bestOther(alternatives: CandidateValuation[], chosenKind: string): CandidateValuation | null {
  let best: CandidateValuation | null = null;
  for (const a of alternatives) {
    if (a.kind === chosenKind) continue; // the chosen move is not its own alternative
    if (!Number.isFinite(a.value)) continue; // skip un-valued (no honest estimate)
    if (best === null || a.value > best.value) best = a;
  }
  return best;
}

function regretOf(chosenValue: number, best: CandidateValuation | null, basis: ShadowRegret["basis"], chosenKind: string): ShadowRegret {
  const cv = Number.isFinite(chosenValue) ? chosenValue : 0;
  const regret = best ? Math.max(0, best.value - cv) : 0;
  return {
    chosenKind,
    chosenValue: cv,
    bestAlternativeKind: best?.kind ?? null,
    bestAlternativeValue: best?.value ?? null,
    regret,
    isEstimate: true,
    basis,
  };
}

/**
 * DECISION-time shadow regret: chosen vs alternatives, all model-predicted.
 * regret>0 means the model ranked some unchosen option higher — almost always
 * because priority/urgency (the safety ladder) overrode raw EV. Pure + total.
 */
export function prospectiveRegret(chosen: CandidateValuation, alternatives: CandidateValuation[]): ShadowRegret {
  return regretOf(chosen.value, bestOther(alternatives, chosen.kind), "prospective", chosen.kind);
}

/**
 * POST-outcome shadow regret: the chosen move's REALIZED value vs the
 * alternatives' PREDICTED value. The realized number is observed truth; the
 * comparison target is an estimate (the alternative was never run) — hence
 * `isEstimate: true`. Pure + total.
 */
export function retrospectiveRegret(
  chosenKind: string,
  chosenRealizedValue: number,
  alternatives: CandidateValuation[],
): ShadowRegret {
  return regretOf(chosenRealizedValue, bestOther(alternatives, chosenKind), "retrospective", chosenKind);
}

export interface ShadowRegretSummary {
  episodes: number;
  /** Mean regret across episodes (0 when none). */
  meanRegret: number;
  /** Total estimated value left on the table (sum of regrets). A LOWER BOUND-ish
   *  estimate, never a claim of lost revenue. */
  totalRegret: number;
  /** Chosen move-kinds ranked by cumulative regret — where the model thinks the
   *  brain most systematically deprioritised a better option. */
  topRegretfulKinds: Array<{ kind: string; totalRegret: number; episodes: number }>;
}

/**
 * Aggregate shadow-regret across many decisions — for the daily letter + the
 * exploration-emphasis hint. Pure. Still an ESTIMATE: this summarises model
 * predictions about roads not taken, never observed outcomes, and (per the
 * sacred line) never feeds the reward edge.
 */
export function summarizeShadowRegret(regrets: ShadowRegret[], topN = 5): ShadowRegretSummary {
  const byKind = new Map<string, { totalRegret: number; episodes: number }>();
  let total = 0;
  for (const r of regrets) {
    total += r.regret;
    const cur = byKind.get(r.chosenKind) ?? { totalRegret: 0, episodes: 0 };
    cur.totalRegret += r.regret;
    cur.episodes += 1;
    byKind.set(r.chosenKind, cur);
  }
  const topRegretfulKinds = [...byKind.entries()]
    .map(([kind, v]) => ({ kind, ...v }))
    .sort((a, b) => b.totalRegret - a.totalRegret)
    .slice(0, topN);
  return {
    episodes: regrets.length,
    meanRegret: regrets.length ? total / regrets.length : 0,
    totalRegret: total,
    topRegretfulKinds,
  };
}
