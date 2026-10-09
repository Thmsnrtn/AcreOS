/**
 * evals/runServed.ts — score the golden set against the served model path.
 *
 * Pure over its inputs: the model call (`complete`) and the judge are
 * injected, so the unit test can stand a deterministic fake in for the
 * provider and prove the score MOVES when the served prompt changes — the
 * property the old harness never had (its stub ignored the prompt entirely).
 */
import { scoreShape, scoreTopics, combine, type EntryScore, type ExpectedShape, type ToneJudge } from "./score";
import type { Complete } from "./servedPath";

export interface GoldenEntry {
  id: string;
  category: string;
  prompt: string;
  expectedShape: ExpectedShape;
  expectedTone: string;
  expectedTopics: string[];
  needsCuration?: boolean;
}

export interface ServedRunTotals {
  count: number;
  avgOverall: number;
  avgShape: number;
  avgTopics: number;
  avgTone: number;
  byCategory: Record<string, { count: number; avgOverall: number }>;
}

export async function scoreServed(opts: {
  entries: GoldenEntry[];
  model: string;
  system: string;
  complete: Complete;
  judge: ToneJudge;
  onEntry?: (s: EntryScore) => void;
}): Promise<{ scores: EntryScore[]; totals: ServedRunTotals; errors: number }> {
  const scores: EntryScore[] = [];
  let errors = 0;
  for (const e of opts.entries) {
    let output = "";
    try {
      output = await opts.complete({ model: opts.model, system: opts.system, user: e.prompt });
    } catch (err) {
      // A failed call scores as an empty answer — never as a placeholder that
      // happens to satisfy the shape check.
      errors++;
      output = "";
    }
    const shape = scoreShape(output, e.expectedShape);
    const topics = scoreTopics(output, e.expectedTopics);
    const tone = output ? await opts.judge.judge({ prompt: e.prompt, output, expectedTone: e.expectedTone }) : { score: 0, rationale: "no output" };
    const s = combine(e.id, e.category, shape, topics, tone);
    scores.push(s);
    opts.onEntry?.(s);
  }
  const n = scores.length || 1;
  const avg = (f: (s: EntryScore) => number) => scores.reduce((a, s) => a + f(s), 0) / n;
  const byCategory: Record<string, { count: number; avgOverall: number }> = {};
  for (const s of scores) {
    const c = (byCategory[s.category] ??= { count: 0, avgOverall: 0 });
    c.count++;
    c.avgOverall += s.overall;
  }
  for (const k of Object.keys(byCategory)) byCategory[k].avgOverall /= byCategory[k].count;
  return {
    scores,
    errors,
    totals: {
      count: scores.length,
      avgOverall: avg((s) => s.overall),
      avgShape: avg((s) => s.shape.score),
      avgTopics: avg((s) => s.topics.score),
      avgTone: avg((s) => s.tone.score),
      byCategory,
    },
  };
}
