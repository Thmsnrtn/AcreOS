/**
 * Script generator — produces N candidate ad scripts from a brand profile,
 * intent, and notes.
 *
 * Routing: OpenRouter Haiku 4.5 by default (cheap, fast, quality). Sonnet
 * 4.6 only when caller passes `forcePremium`. All chat goes through the
 * canonical getOpenAIClient() which is OpenRouter-only.
 *
 * Output: structured JSON, not freeform. The hookArchetype field is
 * load-bearing — it ties every script to a performance-tracked taxonomy
 * in cmo_hook_archetypes and enables cross-temporal "which archetype
 * wins" queries from day one.
 *
 * Notes context: when the founder rejects variants with notes, those notes
 * are loaded into the system prompt for the next generation cycle so the
 * agent learns from feedback without retraining.
 */

import { db } from "../../db";
import { brandProfiles, cmoScripts, cmoRejectionNotes, type BrandProfile, type CmoScript } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { getOpenAIClient } from "../../utils/openaiClient";
import { logger } from "../../utils/logger";
import { listActiveArchetypes } from "./archetypes";
import { selectVoiceForScript, type VoicePoolEntry } from "./voicePool";
import {
  addCost,
  emptyBreakdown,
  estimateOpenRouterCostCents,
  type CostBreakdown,
} from "./costTracker";

interface BrandVoiceConfig {
  provider: "elevenlabs";
  pool?: VoicePoolEntry[];
  voiceId?: string | null;
  stability?: number;
  similarityBoost?: number;
  sampleScripts?: string[];
}

const RECENT_VOICE_WINDOW = 10;

export interface GenerateScriptInput {
  brandProfile: BrandProfile;
  intent: string;                  // 'cold-traffic-tiktok-9x16' etc.
  funnelStage: "cold" | "warm" | "retargeting";
  count: number;
  notes?: string;                  // founder's per-batch direction
  forcePremium?: boolean;          // route to Sonnet instead of Haiku
  dryRun?: boolean;                // estimate cost, don't fire the API
}

export interface GeneratedScriptShape {
  hookArchetype: string;
  hook: string;
  body: string;
  cta: string;
  lengthTargetSec: number;
  brollQueries: string[];
  reasoning: string;
}

export interface GenerateScriptResult {
  scripts: GeneratedScriptShape[];
  model: string;
  costCents: number;
  dryRun: boolean;
  estimatedCostCents?: number;     // populated for dry-run
}

const MAX_RECENT_REJECTION_NOTES = 30;

function buildSystemPrompt(brand: BrandProfile, archetypesAllowed: string[], rejectionContext: string): string {
  const funnelDetail = JSON.stringify(brand.funnelStages, null, 2);
  const bannedList = brand.bannedPhrases.map((p) => `  - "${p}"`).join("\n");
  const complianceList = brand.complianceRules
    .map((r) => `  - ${r.name}: ${r.reason}`)
    .join("\n");

  // Surface the available voice pool so the model writes scripts in a style
  // compatible with whichever narrator gets assigned. We don't pin a voice
  // here — voice selection is per-script in persistScripts() — but knowing
  // the palette lets the generator stay tonally consistent.
  const voiceConfig = brand.voice as unknown as { pool?: Array<{ name: string; vibe: string }> };
  const voicePoolHint = voiceConfig.pool && voiceConfig.pool.length > 0
    ? `\nNARRATOR VOICES AVAILABLE — every script will be matched to one of these. Write in a style compatible with the palette as a whole; the system selects the closest fit per script.\n${voiceConfig.pool.map((v) => `  - ${v.name}: ${v.vibe}`).join("\n")}\n`
    : "";

  return `You are the lead copywriter for ${brand.displayName}, a software platform whose one-liner is: "${brand.oneLiner}".
${voicePoolHint}

PRIMARY AUDIENCE: ${brand.audiencePrimary}
${brand.audienceSecondary ? `SECONDARY AUDIENCE: ${brand.audienceSecondary}` : ""}

VOICE: ${brand.toneDescriptors.join(", ")}.
The reader is intelligent and skeptical. Mechanics-first, third-person. Describe what the system does, not why it was built. No first-person, no founder voice, no narrative testimonials. No guru energy.

USPs (ordered by priority):
${brand.usps.map((u, i) => `  ${i + 1}. ${u}`).join("\n")}

BANNED PHRASES (mechanical reject if present, including substrings):
${bannedList}

COMPLIANCE RULES (regex-based reject if matched):
${complianceList}

FUNNEL STAGES + CTAs:
${funnelDetail}

ALLOWED HOOK ARCHETYPES (pick the one that best fits the intent):
${archetypesAllowed.join(", ")}

${rejectionContext ? `RECENT FOUNDER REJECTIONS — do not repeat these mistakes:\n${rejectionContext}\n` : ""}

OUTPUT FORMAT — strict JSON, no markdown fence, no commentary:
{
  "scripts": [
    {
      "hookArchetype": "<one of the allowed slugs above>",
      "hook": "<first 1-3 seconds of the ad. The line the viewer hears or reads first. Plain text, no stage directions.>",
      "body": "<the demonstration / mechanics section. 2-4 short sentences. Each sentence is one beat the camera shows.>",
      "cta": "<closing line. Matches the funnel stage's CTA voice. Plain text, no URL.>",
      "lengthTargetSec": <integer 15-45 — TikTok max 60, Meta best <30>,
      "brollQueries": [<3-6 short search phrases for Pexels/Pixabay stock footage to back this script>],
      "reasoning": "<1-2 sentences on why this archetype + angle was chosen for this intent. Used by reviewers, not viewers.>"
    }
  ]
}

Every script must:
- Be specific. No vague pains, no abstract benefits.
- Honor the voice. If a script could be said by a guru influencer, rewrite it.
- Be safe. No banned phrases, no compliance triggers. The reviewer will reject mechanically.
- Be platform-aware. The intent string encodes platform + format — write to that.`;
}

async function loadRecentRejectionNotes(brandProfileId: number): Promise<string> {
  const notes = await db
    .select({
      tags: cmoRejectionNotes.tags,
      note: cmoRejectionNotes.note,
      rejectedAt: cmoRejectionNotes.rejectedAt,
    })
    .from(cmoRejectionNotes)
    .where(eq(cmoRejectionNotes.brandProfileId, brandProfileId))
    .orderBy(desc(cmoRejectionNotes.rejectedAt))
    .limit(MAX_RECENT_REJECTION_NOTES);

  if (notes.length === 0) return "";

  return notes
    .map((n, i) => {
      const tagPart = n.tags.length > 0 ? `[${n.tags.join(", ")}] ` : "";
      const notePart = n.note ?? "(no note)";
      return `  ${i + 1}. ${tagPart}${notePart}`;
    })
    .join("\n");
}

export async function generateScripts(input: GenerateScriptInput): Promise<GenerateScriptResult> {
  const archetypes = await listActiveArchetypes();
  const archetypeSlugs = archetypes.map((a) => a.slug);
  const rejectionContext = await loadRecentRejectionNotes(input.brandProfile.id);

  const systemPrompt = buildSystemPrompt(input.brandProfile, archetypeSlugs, rejectionContext);
  const userPrompt = `Generate ${input.count} ${input.funnelStage}-funnel scripts for intent="${input.intent}".

${input.notes ? `Founder direction: ${input.notes}` : "No specific founder direction — choose archetypes you think will hit hardest for this intent given the audience."}

Return strict JSON only.`;

  const model = input.forcePremium ? "anthropic/claude-sonnet-4.6" : "anthropic/claude-haiku-4.5";

  // Conservative pre-call estimate: assume 1.5K prompt tokens (system + user)
  // and ~300 tokens per script in output. Used for dry-run.
  const estPromptTokens = Math.ceil(systemPrompt.length / 4) + Math.ceil(userPrompt.length / 4);
  const estCompletionTokens = input.count * 300;
  const estimatedCostCents = estimateOpenRouterCostCents(model, estPromptTokens, estCompletionTokens);

  if (input.dryRun) {
    return {
      scripts: [],
      model,
      costCents: 0,
      dryRun: true,
      estimatedCostCents,
    };
  }

  const client = getOpenAIClient();
  if (!client) {
    throw new Error(
      "[cmo:script] OpenRouter client unavailable — AI_INTEGRATIONS_OPENROUTER_API_KEY is not set",
    );
  }

  // Anthropic prompt caching: the system prompt here is multi-kilobyte (brand
  // profile + archetypes + voice pool + compliance rules) and identical across
  // all generation cycles for a given brand. Marking it with cache_control
  // ephemeral cuts 70-90% off the input cost on repeat generations within the
  // 5-minute Anthropic cache TTL. OpenRouter forwards this directive to
  // Anthropic transparently for Claude models. (Pillar 7 — AI cost.)
  const isAnthropicModel = model.startsWith("anthropic/");
  const messages: any[] = [
    isAnthropicModel
      ? { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } }
      : { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const response = await client.chat.completions.create({
    model,
    messages,
    response_format: { type: "json_object" },
    temperature: 0.85, // High enough to produce real variant diversity across N scripts
    max_tokens: 4000,
  });

  const usage = response.usage;
  const actualCostCents = estimateOpenRouterCostCents(
    model,
    usage?.prompt_tokens ?? estPromptTokens,
    usage?.completion_tokens ?? estCompletionTokens,
  );

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("[cmo:script] empty response from OpenRouter");
  }

  let parsed: { scripts?: GeneratedScriptShape[] };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error("[cmo:script] failed to parse JSON", err instanceof Error ? err : undefined, {
      metadata: { raw: raw.slice(0, 500) },
    });
    throw new Error("[cmo:script] model returned non-JSON output");
  }

  if (!Array.isArray(parsed.scripts) || parsed.scripts.length === 0) {
    throw new Error("[cmo:script] model returned no scripts");
  }

  return {
    scripts: parsed.scripts,
    model,
    costCents: actualCostCents,
    dryRun: false,
  };
}

/**
 * Persists generated scripts to cmo_scripts. Returns the inserted rows.
 * Mechanical banned-phrase + compliance check happens here before persist;
 * scripts that fail land with status='rejected_pre_render' and rejection_reason
 * populated, so the audit trail captures even the rejected outputs.
 */
export async function persistScripts(
  brand: BrandProfile,
  intent: string,
  funnelStage: string,
  generated: GeneratedScriptShape[],
  model: string,
  generationCostCents: number,
  notes?: string,
): Promise<CmoScript[]> {
  const perScriptCost = Math.ceil(generationCostCents / Math.max(1, generated.length));
  const rows: CmoScript[] = [];

  // Load the brand's voice pool + the voices used by the last N scripts so
  // selection round-robins through the pool instead of clumping on the
  // archetype-preferred default.
  const voiceConfig = brand.voice as unknown as BrandVoiceConfig;
  const voicePool = voiceConfig.pool ?? [];
  const recentVoices = voicePool.length > 0
    ? await loadRecentVoiceIds(brand.id, RECENT_VOICE_WINDOW)
    : [];

  for (const script of generated) {
    const violations: string[] = [];
    const combined = `${script.hook}\n${script.body}\n${script.cta}`.toLowerCase();

    for (const banned of brand.bannedPhrases) {
      if (combined.includes(banned.toLowerCase())) {
        violations.push(`banned phrase: "${banned}"`);
      }
    }
    for (const rule of brand.complianceRules) {
      try {
        const rx = new RegExp(rule.pattern, "i");
        if (rx.test(combined)) {
          violations.push(`compliance rule "${rule.name}" matched`);
        }
      } catch (err) {
        logger.warn(`[cmo:script] compliance rule '${rule.name}' has invalid regex — skipping`, {
          metadata: { pattern: rule.pattern },
        });
      }
    }

    const status = violations.length > 0 ? "rejected_pre_render" : "draft";
    const rejectionReason = violations.length > 0 ? violations.join("; ") : null;

    // Pick a voice for this script. The voice's vibe was already in the
    // generator system prompt (so script style matched), but we persist
    // the actual selection here so the renderer can call ElevenLabs with
    // the correct voiceId.
    let selectedVoiceId: string | null = null;
    let selectedVoiceName: string | null = null;
    if (voicePool.length > 0) {
      const picked = selectVoiceForScript(voicePool, script.hookArchetype, recentVoices);
      selectedVoiceId = picked.voiceId;
      selectedVoiceName = picked.name;
      // Track this voice so subsequent scripts in the same batch prefer
      // others (rotation within a single generation cycle).
      recentVoices.unshift(picked.voiceId);
      if (recentVoices.length > RECENT_VOICE_WINDOW) {
        recentVoices.pop();
      }
    }

    const [row] = await db
      .insert(cmoScripts)
      .values({
        brandProfileId: brand.id,
        intent,
        funnelStage,
        hookArchetype: script.hookArchetype,
        hook: script.hook,
        body: script.body,
        cta: script.cta,
        lengthTargetSec: script.lengthTargetSec,
        brollQueries: script.brollQueries,
        scriptJson: script as unknown as Record<string, unknown>,
        voiceId: selectedVoiceId,
        voiceName: selectedVoiceName,
        status,
        rejectionReason,
        generationCostCents: perScriptCost,
        model,
        notes,
      })
      .returning();
    rows.push(row);
  }

  return rows;
}

async function loadRecentVoiceIds(brandProfileId: number, limit: number): Promise<string[]> {
  const rows = await db
    .select({ voiceId: cmoScripts.voiceId })
    .from(cmoScripts)
    .where(eq(cmoScripts.brandProfileId, brandProfileId))
    .orderBy(desc(cmoScripts.createdAt))
    .limit(limit);
  return rows.map((r) => r.voiceId).filter((v): v is string => Boolean(v));
}
