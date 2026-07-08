/**
 * Founder Autopilot — living memory (episodic, case-based recall).
 *
 * Beyond the aggregate efficacy stats, the system remembers SPECIFIC past
 * situations and what worked in them. At decision time it recalls the most
 * similar past episodes — "last time things looked like this, X worked best" —
 * the way an experienced operator reasons from precedent.
 *
 * Honest + lean by design: a situation is just its real senses, so the feature
 * vector needs no LLM embedding (zero cost) and every recalled episode is a real
 * past action with its real outcome. Nothing is invented; with no history the
 * recall is simply empty.
 *
 * All pure + deterministic → exhaustively testable.
 */

export interface EpisodeSenses {
  mrr: number;
  trials: number;
  supportBacklog: number;
  envelopeStatus: "green" | "amber" | "red";
  dispatchBacklog: number;
  openIncidents: number;
  complianceOpenCount: number;
}

export interface Episode {
  moveKind: string;
  vote: "success" | "failure" | "pending";
  senses: EpisodeSenses;
}

const ENVELOPE_ORD: Record<string, number> = { green: 0, amber: 0.5, red: 1 };

/** Map senses to a bounded [0,1]^7 feature vector. Saturating, so outliers don't dominate. */
export function situationVector(s: EpisodeSenses): number[] {
  const sat = (x: number, half: number) => {
    const v = Math.max(0, x);
    return v / (v + half);
  };
  return [
    sat(s.mrr, 500),
    sat(s.trials, 10),
    sat(s.supportBacklog, 5),
    ENVELOPE_ORD[s.envelopeStatus] ?? 0,
    sat(s.dispatchBacklog, 5),
    Math.min(1, Math.max(0, s.openIncidents) / 3),
    Math.min(1, Math.max(0, s.complianceOpenCount) / 3),
  ];
}

/** Euclidean distance between two situation vectors. Pure. */
export function situationDistance(a: number[], b: number[]): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export interface RecalledEpisode extends Episode {
  distance: number;
}

/**
 * The k most similar past episodes to the current situation. Pure. Only resolved
 * episodes (success/failure) are eligible — a pending past action has no lesson
 * yet. Ties broken by input order (stable).
 */
export function recallSimilar(current: EpisodeSenses, episodes: Episode[], k = 5): RecalledEpisode[] {
  const cur = situationVector(current);
  return episodes
    .filter((e) => e.vote !== "pending")
    .map((e) => ({ ...e, distance: situationDistance(cur, situationVector(e.senses)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, k));
}

export interface RecallSummary {
  /** The move that worked best across the recalled episodes (most successes). */
  bestKind: string | null;
  successes: number;
  total: number;
  note: string;
}

/**
 * Summarize what the recalled episodes suggest. Pure. Picks the move with the
 * most SUCCESSES among neighbours (ties → the one with the better success rate,
 * then input order). Honest: with nothing recalled it says so.
 */
export function summarizeRecall(recalled: RecalledEpisode[]): RecallSummary {
  if (recalled.length === 0) {
    return { bestKind: null, successes: 0, total: 0, note: "No similar past situations on record yet." };
  }
  const byKind = new Map<string, { successes: number; total: number }>();
  for (const e of recalled) {
    const cur = byKind.get(e.moveKind) ?? { successes: 0, total: 0 };
    cur.total += 1;
    if (e.vote === "success") cur.successes += 1;
    byKind.set(e.moveKind, cur);
  }
  let bestKind: string | null = null;
  let best = { successes: -1, rate: -1 };
  for (const [kind, agg] of byKind) {
    const rate = agg.successes / agg.total;
    if (agg.successes > best.successes || (agg.successes === best.successes && rate > best.rate)) {
      best = { successes: agg.successes, rate };
      bestKind = kind;
    }
  }
  const agg = bestKind ? byKind.get(bestKind)! : { successes: 0, total: 0 };
  const note =
    bestKind && agg.successes > 0
      ? `In ${recalled.length} similar past situation(s), "${bestKind}" worked best (${agg.successes}/${agg.total}).`
      : `In ${recalled.length} similar past situation(s), nothing has clearly worked yet — proceeding carefully.`;
  return { bestKind: agg.successes > 0 ? bestKind : null, successes: agg.successes, total: agg.total, note };
}
