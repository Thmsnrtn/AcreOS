/**
 * Script scorer — Haiku-tier classifier that grades each draft script against
 * the brand profile before any voice or render spend is committed.
 *
 * The pre-render gate is the single biggest cost saver in the engine: a
 * rejected script costs ~0.5¢ (one Haiku classify call) vs ~25¢+ if it had
 * been voiced and rendered. Aim: reject ~30-50% of generations pre-render.
 *
 * Scoring axes (0-100 each, then averaged):
 *  - brandVoice    : how well it matches the tone descriptors + voice samples
 *  - hookStrength  : how compelling the first 1-3 seconds are
 *  - compliance    : overlap with brand-banned phrases or platform rules
 *  - novelty       : how different it is from the last 30 scripts shipped
 *
 * Below threshold (default 65) → status='rejected_pre_render'. The full
 * structured score lands in cmo_scripts.score_breakdown so we can iterate
 * the scorer prompt against past data.
 */

import { db } from "../../db";
import { cmoScripts, type BrandProfile, type CmoScript } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { getOpenAIClient } from "../../utils/openaiClient";
import { logger } from "../../utils/logger";
import { estimateOpenRouterCostCents } from "./costTracker";

const SCORER_MODEL = "anthropic/claude-haiku-4.5";
const PASS_THRESHOLD = 65;
const RECENT_SHIPPED_LIMIT = 30;

export interface ScoreBreakdown {
  brandVoice: number;
  hookStrength: number;
  compliance: number;
  novelty: number;
  notes: string;
}

export interface ScoreResult {
  script: CmoScript;
  score: number;
  breakdown: ScoreBreakdown;
  passed: boolean;
  costCents: number;
}

async function loadRecentShippedHooks(brandProfileId: number): Promise<string[]> {
  const rows = await db
    .select({ hook: cmoScripts.hook })
    .from(cmoScripts)
    .where(
      and(
        eq(cmoScripts.brandProfileId, brandProfileId),
        eq(cmoScripts.status, "rendered"),
      ),
    )
    .orderBy(desc(cmoScripts.createdAt))
    .limit(RECENT_SHIPPED_LIMIT);
  return rows.map((r) => r.hook);
}

function buildScorerPrompt(brand: BrandProfile, recentHooks: string[]): string {
  return `You are the quality control reviewer for ${brand.displayName} ad scripts.

YOUR JOB: score the candidate script against four axes, each 0-100. Be strict. Return ONLY structured JSON.

BRAND VOICE (target tone): ${brand.toneDescriptors.join(", ")}
Voice samples that exemplify the brand:
${brand.founderVoiceSamples.map((s, i) => `  ${i + 1}. "${s}"`).join("\n")}

BRAND BANNED PHRASES (any presence drops compliance to ≤30):
${brand.bannedPhrases.map((p) => `  - "${p}"`).join("\n")}

RECENTLY SHIPPED HOOKS (the novelty axis penalizes anything that resembles these):
${recentHooks.length > 0 ? recentHooks.map((h, i) => `  ${i + 1}. "${h}"`).join("\n") : "  (no shipped hooks yet — novelty score should be neutral, around 70)"}

SCORING RUBRIC:
- brandVoice (0-100): Match to tone descriptors + voice samples. 100 = indistinguishable from a brand-written script. 50 = generic SaaS copy. 0 = sounds like a guru.
- hookStrength (0-100): Power of the first 1-3 seconds. 100 = stops the scroll immediately. 70 = solid. 30 = scrollable.
- compliance (0-100): Distance from banned phrases + ad-platform safety. 100 = perfectly safe. <40 = at least one banned phrase or compliance trigger.
- novelty (0-100): How different the hook is from recently shipped ones. 100 = totally new angle. 30 = warmed-over rephrase of a recent hook.

OUTPUT FORMAT — strict JSON, no markdown fence:
{
  "brandVoice": <int>,
  "hookStrength": <int>,
  "compliance": <int>,
  "novelty": <int>,
  "notes": "<one or two sentences justifying the lowest score. Concrete. No fluff.>"
}`;
}

export async function scoreScript(brand: BrandProfile, script: CmoScript): Promise<ScoreResult> {
  const recentHooks = await loadRecentShippedHooks(brand.id);
  const systemPrompt = buildScorerPrompt(brand, recentHooks);

  const userPrompt = `Score this script:

HOOK: ${script.hook}
BODY: ${script.body}
CTA: ${script.cta}
ARCHETYPE: ${script.hookArchetype}
INTENT: ${script.intent}
FUNNEL STAGE: ${script.funnelStage}

Return strict JSON only.`;

  const client = getOpenAIClient();
  if (!client) {
    throw new Error(
      "[cmo:score] OpenRouter client unavailable — AI_INTEGRATIONS_OPENROUTER_API_KEY is not set",
    );
  }

  const response = await client.chat.completions.create({
    model: SCORER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2, // Low temperature — we want consistent scoring
    max_tokens: 400,
  });

  const usage = response.usage;
  const costCents = estimateOpenRouterCostCents(
    SCORER_MODEL,
    usage?.prompt_tokens ?? 1500,
    usage?.completion_tokens ?? 200,
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("[cmo:score] empty response from OpenRouter");
  }

  let breakdown: ScoreBreakdown;
  try {
    const parsed = JSON.parse(raw);
    breakdown = {
      brandVoice: clamp(parsed.brandVoice, 0, 100),
      hookStrength: clamp(parsed.hookStrength, 0, 100),
      compliance: clamp(parsed.compliance, 0, 100),
      novelty: clamp(parsed.novelty, 0, 100),
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch (err) {
    logger.error("[cmo:score] failed to parse JSON", err instanceof Error ? err : undefined, {
      metadata: { raw: raw.slice(0, 500) },
    });
    throw new Error("[cmo:score] scorer returned non-JSON output");
  }

  const score = Math.round(
    (breakdown.brandVoice + breakdown.hookStrength + breakdown.compliance + breakdown.novelty) / 4,
  );
  const passed = score >= PASS_THRESHOLD;

  // Persist the score back to the script row.
  const newStatus = passed ? "scored" : "rejected_pre_render";
  const rejectionReason = passed
    ? null
    : `pre-render score ${score} < ${PASS_THRESHOLD}; lowest axis: ${lowestAxis(breakdown)}; notes: ${breakdown.notes}`;

  const [updated] = await db
    .update(cmoScripts)
    .set({
      qualityScore: score,
      scoreBreakdown: breakdown,
      scoringCostCents: costCents,
      status: newStatus,
      rejectionReason: passed ? null : rejectionReason,
    })
    .where(eq(cmoScripts.id, script.id))
    .returning();

  return {
    script: updated,
    score,
    breakdown,
    passed,
    costCents,
  };
}

function clamp(n: unknown, min: number, max: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function lowestAxis(b: ScoreBreakdown): string {
  const axes: Array<[string, number]> = [
    ["brandVoice", b.brandVoice],
    ["hookStrength", b.hookStrength],
    ["compliance", b.compliance],
    ["novelty", b.novelty],
  ];
  axes.sort((a, b) => a[1] - b[1]);
  return `${axes[0][0]}=${axes[0][1]}`;
}
