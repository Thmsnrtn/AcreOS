/**
 * The real-model judge — OPT-IN and capped.
 *
 *   SIMPLAT_REAL_JUDGE=1 SIMPLAT_JUDGE_CEILING_USD=5 ANTHROPIC_API_KEY=… npx tsx tests/simulation/evals/run.ts --real
 *
 * Before any call it prices the whole run (every question × the judge prompt,
 * at the judge model's published per-token rate, both directions) and REFUSES
 * TO START when the estimate exceeds the ceiling; it also stops mid-run if the
 * metered spend would cross it. Without the flag it never builds a request.
 * This task ran no paid model calls: the CI path and the scorecard use the
 * deterministic judges only.
 */
export interface RealJudgeConfig { enabled: boolean; ceilingUsd: number; inputUsdPerMTok: number; outputUsdPerMTok: number; model: string }

export function realJudgeConfig(env: Record<string, string | undefined> = process.env): RealJudgeConfig {
  return {
    enabled: env.SIMPLAT_REAL_JUDGE === "1",
    ceilingUsd: Number(env.SIMPLAT_JUDGE_CEILING_USD ?? 0),
    // Rates are configuration, not a claim: set them for the model you choose.
    inputUsdPerMTok: Number(env.SIMPLAT_JUDGE_INPUT_USD_PER_MTOK ?? 3),
    outputUsdPerMTok: Number(env.SIMPLAT_JUDGE_OUTPUT_USD_PER_MTOK ?? 15),
    model: env.SIMPLAT_JUDGE_MODEL ?? "claude-sonnet-4-5",
  };
}

const tokens = (s: string) => Math.ceil(s.length / 4);
export function estimateUsd(items: Array<{ question: string; answer: string; rubric: string }>, cfg: RealJudgeConfig, outTokensEach = 150): number {
  const inTok = items.reduce((a, x) => a + tokens(JUDGE_PREAMBLE) + tokens(x.question) + tokens(x.answer) + tokens(x.rubric), 0);
  return (inTok / 1e6) * cfg.inputUsdPerMTok + ((outTokensEach * items.length) / 1e6) * cfg.outputUsdPerMTok;
}

export const JUDGE_PREAMBLE = "You grade one answer an AI assistant gave a land investor. Reply with JSON {\"pass\": boolean, \"why\": string}. Pass only if the answer satisfies the rubric, states no number the facts do not give, and refers legal questions to a professional.";

export class CeilingExceeded extends Error {}

/** Throws before any call when the run cannot fit under the ceiling. */
export function assertWithinCeiling(items: Array<{ question: string; answer: string; rubric: string }>, cfg: RealJudgeConfig): number {
  if (!cfg.enabled) throw new CeilingExceeded("real-model judging is off (set SIMPLAT_REAL_JUDGE=1)");
  if (!(cfg.ceilingUsd > 0)) throw new CeilingExceeded("no ceiling set (SIMPLAT_JUDGE_CEILING_USD) — refusing to start");
  const est = estimateUsd(items, cfg);
  if (est > cfg.ceilingUsd) throw new CeilingExceeded(`estimated $${est.toFixed(2)} exceeds the $${cfg.ceilingUsd.toFixed(2)} ceiling — refusing to start`);
  return est;
}

/** One real judgement. `fetchImpl` is injectable so tests never reach a provider. */
export async function realJudge(item: { question: string; answer: string; rubric: string }, cfg: RealJudgeConfig, spent: { usd: number }, fetchImpl: typeof fetch = fetch): Promise<{ pass: boolean; why: string }> {
  const add = estimateUsd([item], cfg);
  if (spent.usd + add > cfg.ceilingUsd) throw new CeilingExceeded(`next call would cross the $${cfg.ceilingUsd} ceiling`);
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: cfg.model, max_tokens: 150, system: JUDGE_PREAMBLE, messages: [{ role: "user", content: `Question: ${item.question}\nRubric: ${item.rubric}\nAnswer: ${item.answer}` }] }),
  });
  spent.usd += add;
  const j = (await r.json()) as { content?: Array<{ text?: string }> };
  try { return JSON.parse(j.content?.[0]?.text ?? "{}"); } catch { return { pass: false, why: "unparseable judge reply" }; }
}
