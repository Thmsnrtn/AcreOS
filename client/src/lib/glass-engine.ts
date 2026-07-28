/**
 * The Glass Engine — pure derivations for the "how the autopilot thinks" view
 * (the Engine tab of /founder/autopilot/story).
 *
 * Everything here is computed from the SAME records the timeline renders
 * (story entries + the trust ledger). No stage ever invents a number: a stage
 * with nothing recorded derives `null` and the UI says so plainly. Pure and
 * DB-free so the honesty invariants are unit-testable (glassEngine.test.ts).
 */

export interface EngineTraceSenses {
  mrr: number;
  trials: number;
  supportBacklog: number;
  envelopeStatus: string;
}

export interface EngineEntry {
  id: number;
  at: string | null;
  outcome: string; // acted | escalated | suppressed
  vote: "success" | "failure" | "pending";
  reasoningTrace: {
    consideredMoves?: Array<{ kind: string }>;
    senses?: EngineTraceSenses;
    memory?: string | null;
    forecast?: { successProb: number; n: number; confidence: string } | null;
  } | null;
}

export interface EngineLedgerEntry {
  domain: string;
  level: string;
  cleanCycleCount: number;
  threshold: number;
  shadowLine?: string | null;
}

/** Same order as DOMAIN_AUTONOMY_LEVELS (server/services/autopilot/domainAutonomy.ts). */
export const ENGINE_LEVEL_ORDER = ["observe", "draft", "execute_gated", "autonomous_gated"] as const;

/** Same plain-words vocabulary as the Controls page (autopilot-control.tsx LEVEL_LABEL). */
export const ENGINE_LEVEL_LABEL: Record<string, string> = {
  observe: "Watching only",
  draft: "Drafts — you approve",
  execute_gated: "Acts — safety-checked",
  autonomous_gated: "Independent — safety-checked",
};

/** Lane fill fraction for a level: observe 0 … autonomous_gated 1. Unknown levels → 0 (never overstate). */
export function levelFill(level: string): number {
  const i = ENGINE_LEVEL_ORDER.indexOf(level as (typeof ENGINE_LEVEL_ORDER)[number]);
  return i <= 0 ? 0 : i / (ENGINE_LEVEL_ORDER.length - 1);
}

export interface LoopStats {
  /** How many recorded moves the stats are derived from (the honest denominator). */
  recordedMoves: number;
  /** ISO timestamp of the most recent move, or null if none recorded. */
  lastMoveAt: string | null;
  /** Latest world-reading captured in a trace, or null if no trace carries one. */
  latestSenses: { summary: string; at: string | null } | null;
  /** Options weighed in the most recent rich trace, or null. */
  latestOptionsWeighed: number | null;
  /** Gate verdicts across recorded moves. */
  gates: { cleared: number; askedYou: number; held: number };
  /** Moves that actually went out. */
  acted: number;
  /** Scored outcomes; pending = not yet scored (honest, not a failure). */
  outcomes: { wentWell: number; didntLand: number; pending: number };
  /** Moves whose trace carried a remembered lesson. */
  lessonsRemembered: number;
  /** Moves that carried an honest pre-action forecast. */
  forecastsMade: number;
}

/**
 * Derive the loop-stage stats from recorded story entries. Total: any entry
 * shape (including sparse governance/legacy traces) derives without throwing,
 * and an empty history derives the all-empty shape — never a placeholder.
 */
export function deriveLoopStats(entries: EngineEntry[]): LoopStats {
  const stats: LoopStats = {
    recordedMoves: entries.length,
    lastMoveAt: null,
    latestSenses: null,
    latestOptionsWeighed: null,
    gates: { cleared: 0, askedYou: 0, held: 0 },
    acted: 0,
    outcomes: { wentWell: 0, didntLand: 0, pending: 0 },
    lessonsRemembered: 0,
    forecastsMade: 0,
  };
  for (const e of entries) {
    if (e.at && (stats.lastMoveAt === null || e.at > stats.lastMoveAt)) stats.lastMoveAt = e.at;
    if (e.outcome === "acted") {
      stats.acted += 1;
      stats.gates.cleared += 1;
    } else if (e.outcome === "escalated") {
      stats.gates.askedYou += 1;
    } else {
      stats.gates.held += 1;
    }
    if (e.vote === "success") stats.outcomes.wentWell += 1;
    else if (e.vote === "failure") stats.outcomes.didntLand += 1;
    else stats.outcomes.pending += 1;
    const t = e.reasoningTrace;
    if (t?.memory) stats.lessonsRemembered += 1;
    if (t?.forecast) stats.forecastsMade += 1;
    if (t?.senses && stats.latestSenses === null) {
      // Entries arrive newest-first from the story endpoint; keep the first
      // (most recent) world-reading we see.
      const s = t.senses;
      stats.latestSenses = {
        summary: `MRR $${s.mrr} · ${s.trials} trial${s.trials === 1 ? "" : "s"} · ${s.supportBacklog} waiting · runway ${s.envelopeStatus}`,
        at: e.at,
      };
    }
    if (t?.consideredMoves && stats.latestOptionsWeighed === null) {
      stats.latestOptionsWeighed = t.consideredMoves.length;
    }
  }
  return stats;
}
