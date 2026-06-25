/**
 * Founder Autopilot — the glass-box reasoning trace.
 *
 * Every autonomous action records WHY it happened, as a structured + human
 * trace the founder can expand: the senses it read, the options it weighed, the
 * one it chose, its honest forecast, which gate decided, and the outcome. No
 * black box — the founder can always reconstruct the full reasoning chain.
 *
 * buildReasoningTrace is PURE → testable. It only assembles facts the loop
 * already computed; it invents nothing.
 */

export interface TraceSenses {
  mrr: number;
  trials: number;
  supportBacklog: number;
  envelopeStatus: "green" | "amber" | "red";
  dispatchBacklog: number;
  openIncidents: number;
  complianceOpenCount: number;
}

export interface TraceForecast {
  successProb: number;
  n: number;
  confidence: string;
}

export interface ReasoningTraceInput {
  consideredMoves: Array<{ kind: string; priority: number; rationale: string }>;
  chosen: { kind: string; domain: string; playId?: string | null };
  senses: TraceSenses;
  forecast?: TraceForecast | null;
  gate: { decision: string; decidedBy?: string };
  outcome: string; // acted | escalated | suppressed
  /** Living-memory recall — what worked in similar past situations (optional). */
  memory?: string | null;
  /**
   * Shadow regret (Frontier #2) — the best UNCHOSEN option's model-PREDICTED
   * value vs the chosen one. Glass-box only; an estimate, never an observed
   * outcome, and never fed to learning. Surfaced when the model ranked some
   * unchosen option higher (regret > 0).
   */
  shadowRegret?: { bestAlternativeKind: string | null; regret: number; isEstimate: true } | null;
}

export interface ReasoningTrace extends ReasoningTraceInput {
  /** One plain-language paragraph reconstructing the decision. */
  narrative: string;
}

const GATE_PHRASE: Record<string, string> = {
  pass: "cleared every gate (compliance, quality, budget, autonomy, witnessed-send)",
  block: "was stopped by a gate",
  escalate: "needed your tap before proceeding",
};

const DECIDED_BY_PHRASE: Record<string, string> = {
  compliance: "the compliance gate",
  quality: "the quality/grounding gate",
  budget: "the budget gate",
  autonomy: "the autonomy gate (this domain hasn't earned this yet)",
  witnessed_send: "witnessed-send (it's customer-facing)",
};

const OUTCOME_PHRASE: Record<string, string> = {
  acted: "so I carried it out",
  escalated: "so I brought it to you",
  suppressed: "so I held it and self-corrected",
};

/** Compose the structured trace + a readable narrative. Pure + total. */
export function buildReasoningTrace(input: ReasoningTraceInput): ReasoningTrace {
  const { chosen, senses, forecast, gate, outcome } = input;

  // Why this move rose to the top — name the dominant sense.
  const driver =
    senses.openIncidents > 0
      ? `${senses.openIncidents} open incident(s) needed stabilizing first`
      : senses.complianceOpenCount > 0
        ? `${senses.complianceOpenCount} open compliance item(s) had to clear first`
        : senses.envelopeStatus === "red"
          ? "runway was constrained, so protecting it came first"
          : senses.supportBacklog > 0
            ? `${senses.supportBacklog} customer(s) were waiting`
            : "the system was stable, so I advanced growth/optimization";

  const considered = input.consideredMoves.length;
  const playBit = chosen.playId ? ` (${chosen.playId})` : "";
  const forecastBit =
    forecast && forecast.confidence !== "none"
      ? ` My forecast: ~${Math.round(forecast.successProb * 100)}% likely to go well, from ${forecast.n} past run${forecast.n === 1 ? "" : "s"}.`
      : forecast
        ? " No track record yet, so I couldn't forecast it honestly."
        : "";
  const gatePhrase = GATE_PHRASE[gate.decision] ?? `was decided (${gate.decision})`;
  const byPhrase = gate.decidedBy ? ` — specifically ${DECIDED_BY_PHRASE[gate.decidedBy] ?? gate.decidedBy}` : "";
  const outcomePhrase = OUTCOME_PHRASE[outcome] ?? `(${outcome})`;

  const memoryBit = input.memory ? ` ${input.memory}` : "";

  // Frontier #2 — glass-box the road not taken when the model ranked one higher.
  // Always framed as an estimate; this is a transparency note, not a correction.
  const sr = input.shadowRegret;
  const regretBit =
    sr && sr.regret > 0 && sr.bestAlternativeKind
      ? ` The model rated "${sr.bestAlternativeKind}" a bit higher (est. +${sr.regret.toFixed(1)}, not observed) — I chose "${chosen.kind}" anyway because urgency/priority came first.`
      : "";

  const narrative =
    `I weighed ${considered} option${considered === 1 ? "" : "s"} and chose "${chosen.kind}"${playBit} because ${driver}.` +
    memoryBit +
    forecastBit +
    regretBit +
    ` It ${gatePhrase}${byPhrase}, ${outcomePhrase}.`;

  return { ...input, narrative };
}
