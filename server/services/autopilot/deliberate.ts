/**
 * Founder Autopilot — the deliberative brain (neuro-symbolic).
 *
 * The decide-core (decide.ts) ranks moves by transparent rules — fast, safe,
 * and the action space's source of truth. For genuinely CONTESTED calls (two+
 * discretionary moves of near-equal priority), a short LLM "council" enriches
 * the judgment: it weighs the close options across perspectives and recommends
 * ONE — but it may only recommend a move that already exists in the rules'
 * candidate set. The model proposes within the lines; it can never invent a new
 * action, and every gate still binds afterward.
 *
 * Safety/cost: deliberation fires only when warranted (rare), uses a cheap
 * model, and ALWAYS falls back to the deterministic ranking on any error or
 * invalid output. The rules are the floor; the LLM is an optional lift.
 *
 * The pure functions (shouldDeliberate / buildCouncilPrompt / parseCouncil /
 * applyDeliberation) are exhaustively testable with no model call.
 */
import type { DecisionSenses, RankedMove } from "./decide";

export interface CouncilVerdict {
  recommendedKind: string;
  rationale: string;
  perspectives?: Array<{ lens: string; point: string }>;
}

/**
 * Warrant deliberation only for a genuine discretionary contest: ≥2 non-default
 * moves (excluding the always-available `optimize`) whose priorities are within
 * 1 of each other. Mandatory stabilize moves (a single clear P0) don't qualify —
 * deliberating on "should I fix the incident?" wastes a call. Pure + total.
 */
export function shouldDeliberate(moves: RankedMove[]): boolean {
  const discretionary = moves
    .filter((m) => m.kind !== "optimize")
    .sort((a, b) => a.priority - b.priority);
  return discretionary.length >= 2 && discretionary[1].priority - discretionary[0].priority <= 1;
}

/** Build the council prompt. Pure — lists ONLY the real candidate moves. */
export function buildCouncilPrompt(senses: DecisionSenses, moves: RankedMove[]): string {
  const candidates = moves.map((m) => `- ${m.kind} (priority ${m.priority}): ${m.rationale}`).join("\n");
  return [
    "You are a council advising an autonomous company's operating loop on a close call.",
    "Weigh the candidate moves across four lenses — opportunity, risk, the customer, and runway — and recommend exactly ONE.",
    "HARD RULE: you may only recommend a move from the candidate list below, by its exact `kind`. You may not invent a new action.",
    "",
    `Current state: $${senses.mrr} MRR, ${senses.trials} trials, ${senses.supportBacklog} customers waiting, runway ${senses.envelopeStatus}, ${senses.openIncidents} open incident(s), ${senses.complianceOpenCount} compliance item(s).`,
    "",
    "Candidate moves:",
    candidates,
    "",
    'Respond ONLY with JSON: {"recommendedKind": "<one kind from the list>", "rationale": "<one sentence>", "perspectives": [{"lens": "opportunity|risk|customer|runway", "point": "<short>"}]}',
  ].join("\n");
}

/** Parse + shape-validate the council JSON. Pure. Null on anything malformed. */
export function parseCouncil(raw: string): CouncilVerdict | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof obj.recommendedKind !== "string" || obj.recommendedKind.trim() === "") return null;
    const perspectives = Array.isArray(obj.perspectives)
      ? obj.perspectives
          .filter((p): p is { lens: string; point: string } => !!p && typeof (p as any).point === "string")
          .map((p) => ({ lens: String((p as any).lens ?? ""), point: String((p as any).point) }))
      : undefined;
    return {
      recommendedKind: obj.recommendedKind.trim(),
      rationale: typeof obj.rationale === "string" ? obj.rationale : "",
      perspectives,
    };
  } catch {
    return null;
  }
}

/**
 * Apply the council's recommendation: if it names a REAL candidate, move that
 * one to the front (the rest keep their order); otherwise return the ranking
 * unchanged. Pure — the LLM can only reorder within the rules' action space.
 */
export function applyDeliberation(moves: RankedMove[], verdict: CouncilVerdict | null): RankedMove[] {
  if (!verdict) return moves;
  const idx = moves.findIndex((m) => m.kind === verdict.recommendedKind);
  if (idx <= 0) return moves; // not found, or already first → no change
  return [moves[idx], ...moves.slice(0, idx), ...moves.slice(idx + 1)];
}

export interface DeliberateDeps {
  callModel: (prompt: string) => Promise<string>;
}

export interface DeliberationResult {
  moves: RankedMove[];
  deliberated: boolean;
  verdict: CouncilVerdict | null;
}

/**
 * Run deliberation if warranted. Always returns a usable ranking — on any error
 * or invalid output it falls back to the deterministic input order. Never throws.
 */
export async function deliberateWithModel(
  senses: DecisionSenses,
  moves: RankedMove[],
  deps: DeliberateDeps,
): Promise<DeliberationResult> {
  if (!shouldDeliberate(moves)) return { moves, deliberated: false, verdict: null };
  try {
    const raw = await deps.callModel(buildCouncilPrompt(senses, moves));
    const verdict = parseCouncil(raw);
    return { moves: applyDeliberation(moves, verdict), deliberated: verdict != null, verdict };
  } catch {
    return { moves, deliberated: false, verdict: null };
  }
}
