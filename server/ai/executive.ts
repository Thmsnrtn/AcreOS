import OpenAI from "openai";
import { db } from "../db";
import { eq, desc } from "drizzle-orm";
// APPROVAL_REQUIRED_TOOLS is no longer consulted here — the Tier 1A approval
// kernel enforces it INSIDE executeTool, so this call site cannot bypass it.
import { executeTool } from "./tools";
// Tier 1B (elevation blueprint): customer-content fields in tool results are
// wrapped in the untrusted envelope before re-entering the model channel.
import { serializeToolResultForModel, wrapUntrusted } from "./untrustedEnvelope";
// Tahoe E8: the Pax tool list is now sourced from the App Intent registry
// (single source of truth across Pax tool-use, command palette, external
// agents) rather than a hand-maintained list in tools.ts.
import { getToolsForRoleFromRegistry } from "../services/appIntents";
// Andrei E5: land-knowledge retrieval is gated behind a synchronous env flag
// (PAX_LAND_KNOWLEDGE_ENABLED) so the hot Pax path never pays a per-turn DB
// read to decide whether the tool is exposed.
import { isLandKnowledgeEnabled } from "../services/pax/landKnowledge/corpus";
import { aiConversations, aiMessages, agentMemory, type Organization, type AiConversation, type AiMessage } from "@shared/schema";
import {
  selectProviderAndModel,
  classifyFromMessages,
  TaskComplexity,
  AIProvider,
} from "../services/aiRouter";
import { buildConnectorContextBlock } from "../services/connectors/registry";
import mammoth from "mammoth";
import { storage } from "../storage";
import { logger } from "../utils/logger";
// Unit 111: THE canonical sanitizer. This import used to read
// `from "../middleware/promptInjection"` — a different function with the same
// name and a weaker deny-list, which is exactly how one Pax path ended up
// protected differently from its siblings.
import { sanitizePromptInline } from "../utils/sanitizePrompt";
import { composePaxSystemPrompt, type PaxPromptVersion } from "./paxPromptVersions";
import { validatePaxResponse } from "../utils/validatePaxResponse";
import { pickPaxModelForOrg, type PaxModelChoice } from "../services/paxModelTier";
// Tahoe Andrei (#7): cost-aware task-type model routing (distinct from the
// subscription-tier router above — this clamps the tier ceiling DOWN to the
// cheapest eval-green model for the turn type).
import { routePaxModelForTurn } from "./paxModelTier";
// T3-3D sub-item 6 — unified model resolver, wired in SHADOW MODE. resolveModel
// composes the same routing axes used above and emits a decisionTrace for later
// reconciliation; the EXISTING selection above remains the live decider.
import { resolveModel } from "../services/modelRouter";
import { predictCostCents, computeCostUsd } from "../services/aiCostRates";
import { evaluateLivePaxOutput } from "../services/aiEvalHarness";

// Tahoe Andrei (2026-06-07): live runtime eval gate. The critical `pax_inbox`
// forbidden-trait cases + gateOutputOrThrow ran only in CI, never on the live
// Pax turn — so a paraphrased hallucination ("minimal flood risk" after a
// zoning/flood MISS) cleared the heuristic guard AND the substring eval and
// reached the customer. `evaluateLivePaxOutput` runs those critical cases'
// forbidden-trait assertions in-process (no network, no DB) on the assembled
// response, and a hit folds into the existing correction/deflection path.
//
// Reversible kill switch, mirroring DATA_GROUNDING_EVAL_GREEN in paxModelTier.ts:
// set to `false` and the live gate is fully bypassed (the heuristic guard still
// runs). Keyed to the same eval set/version (dg-v1, surface=pax_inbox).
export const PAX_LIVE_GATE_ENABLED = true;

/**
 * Apply the hallucination guard + live eval gate to a completed Pax reply and
 * return a SAFE version of the text (corrected once, or an honest deflection if
 * still unsafe). This is the non-streaming twin of the guard block inside
 * processChatStream — the streaming path had both gates but processChat had
 * only the system-prompt leak check, so a caller on the non-stream route (and
 * the scheduler / pax_subagent) could receive a fabricated parcel fact
 * (audit F-08-1). Both entry points now run the same two gates before persist.
 * Never throws: the guards are defense-in-depth and must not fail the reply.
 */
async function finalizePaxOutput(params: {
  organizationId: number;
  output: string;
  toolCallsExecuted: Array<{ name: string; arguments: unknown; result: unknown }>;
  chatMessages: any[];
  client: any;
  model: string;
  conversationId?: number;
}): Promise<string> {
  const { organizationId, toolCallsExecuted, chatMessages, client, model, conversationId } = params;
  let text = params.output;
  const HONEST_DEFLECTION =
    "I don't have verified data to answer that confidently right now. " +
    "I can pull the underlying records first — want me to run that lookup?";

  // 1) Hallucination guard — fabricated numbers / cross-org entities.
  try {
    const { guardPaxOutput } = await import("../services/paxHallucinationGuard");
    const { extractSourceContext } = await import("./paxSourceExtraction");
    const sourceCtx = extractSourceContext(toolCallsExecuted);
    const guardArgs = (out: string) => ({
      organizationId,
      output: out,
      sourceNumbers: sourceCtx.sourceNumbers.length > 0 ? sourceCtx.sourceNumbers : undefined,
      claimedPropertyIds: sourceCtx.claimedPropertyIds.length > 0 ? sourceCtx.claimedPropertyIds : undefined,
      claimedLeadIds: sourceCtx.claimedLeadIds.length > 0 ? sourceCtx.claimedLeadIds : undefined,
      claimedDealIds: sourceCtx.claimedDealIds.length > 0 ? sourceCtx.claimedDealIds : undefined,
    });
    let guarded = await guardPaxOutput(guardArgs(text));
    if (!guarded.safe) {
      const errorDetails = guarded.warnings
        .filter((w) => w.severity === "error")
        .map((w) => w.detail)
        .join("; ");
      const correctionInstruction =
        `Your previous draft contained unsupported claims and was NOT sent. ` +
        `Issues: ${errorDetails}. ` +
        `Rewrite your answer using ONLY facts present in the tool results from this turn. ` +
        `Do not state any number, parcel fact (flood zone, soil, acreage, zoning, owner), ` +
        `or entity you cannot ground in those results. If you don't have a value, say so plainly ` +
        `and offer the paid-tier lookup path instead of guessing.`;
      try {
        const cr = await client.chat.completions.create({
          model,
          messages: [...chatMessages, { role: "assistant", content: text }, { role: "user", content: correctionInstruction }],
          max_tokens: 1024,
        });
        const corrected = cr.choices?.[0]?.message?.content?.trim();
        if (corrected) {
          const reguarded = await guardPaxOutput(guardArgs(corrected));
          if (reguarded.safe) {
            text = corrected;
            guarded = reguarded;
          }
        }
      } catch { /* corrective retry is best-effort */ }
      if (!guarded.safe) text = HONEST_DEFLECTION;
    }
  } catch { /* guard is advisory — never block reply persistence on its failure */ }

  // 2) Live eval gate — semantic forbidden patterns the number-guard can't see
  // ("minimal flood risk" after a flood MISS, "you should buy", "guaranteed").
  if (PAX_LIVE_GATE_ENABLED) {
    try {
      let gate = evaluateLivePaxOutput(text);
      if (!gate.clear) {
        logger.warn("[pax] live eval gate tripped on non-stream reply", {
          source: "pax",
          metadata: { organizationId, conversationId, hits: gate.hits.map((h) => ({ caseId: h.caseId, trait: h.trait })) },
        });
        const tripped = gate.hits.map((h) => `"${h.trait}" (${h.caseName})`).join("; ");
        const correctionInstruction =
          `Your previous draft asserted a parcel fact or made a directive/guarantee ` +
          `that is not allowed and was NOT sent. Disallowed patterns it contained: ${tripped}. ` +
          `Rewrite your answer using ONLY facts present in this turn's tool results. ` +
          `If a lookup returned no value (flood zone, soil class, acreage, zoning, owner), ` +
          `say plainly that you don't have it and offer the paid lookup — never name or imply ` +
          `a value. Never tell the customer to buy or pass, and never guarantee a future return. ` +
          `Stay informational.`;
        try {
          const cr = await client.chat.completions.create({
            model,
            messages: [...chatMessages, { role: "assistant", content: text }, { role: "user", content: correctionInstruction }],
            max_tokens: 1024,
          });
          const corrected = cr.choices?.[0]?.message?.content?.trim();
          if (corrected) {
            const recheck = evaluateLivePaxOutput(corrected);
            if (recheck.clear) {
              text = corrected;
              gate = recheck;
            }
          }
        } catch { /* corrective retry is best-effort */ }
        if (!gate.clear) text = HONEST_DEFLECTION;
      }
    } catch { /* live gate is defense-in-depth — never block persistence */ }
  }

  return text;
}

// Andrei E5: build the Pax tool list for a role, then drop the land-knowledge
// retrieval tool when its feature flag is off. Synchronous + cheap (env read),
// safe to call on every turn. Centralized so processChat + processChatStream
// stay in sync.
function buildPaxToolList(
  role: string,
): ReturnType<typeof getToolsForRoleFromRegistry> {
  const tools = getToolsForRoleFromRegistry(role);
  if (isLandKnowledgeEnabled()) return tools;
  return tools.filter((t) => t.function?.name !== "retrieve_land_knowledge");
}

// ── Quality Feedback Loop ────────────────────────────────────────────────────
// Fire-and-forget: scores each Pax response quality via a MODEL-BACKED call and
// writes success/failure patterns to agentMemory so future responses improve.
//
// Andrei (andrei/ai-hygiene 2026-06): this sub-call now routes through the
// aiRouter with `requestConfidence: true` (it already forces JSON), so the model
// returns its OWN self-reported `confidence` (0..1) alongside the quality score.
// That real model confidence is stamped into a pax_observations row via
// paxObserver.recordModelObservation — the FIRST production caller to set
// requestConfidence, making the calibration plot's "model-derived confidence"
// claim actually true. When the model omits confidence, we keep honest-null (no
// observation row, no fabricated number).
async function scoreAndLearnFromResponse(
  orgId: number,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    const { routeAITask, TaskComplexity: TC } = await import("../services/aiRouter");
    const scoringPrompt = `Rate this AI assistant response for a real estate platform on a scale of 1-10.
User asked: "${userMessage.slice(0, 300)}"
Assistant responded: "${assistantResponse.slice(0, 500)}"
Return ONLY valid JSON: {"score": <number 1-10>, "reasons": ["<reason>"], "improvements": ["<suggestion>"]}`;

    const result = await routeAITask(
      {
        taskType: "response_quality_score",
        complexity: TC.SIMPLE,
        messages: [{ role: "user", content: scoringPrompt }],
        maxTokens: 220,
        temperature: 0.1,
        responseFormat: "json",
        // PRIMARY confidence signal: ask the model how sure it is of its own
        // rating. Flows back as AIResponse.confidence (0..1) or null.
        requestConfidence: true,
      },
      // Internal scoring call (not customer-facing) — bypass the per-org
      // quota/budget gates like the cascade quality checks do, but still record
      // org-scoped telemetry via orgId.
      { skipBudget: true, skipQuota: true, orgId },
    );

    const parsed = JSON.parse(result.content || "{}");
    const score = Number(parsed.score) || 0;
    if (score < 1 || score > 10) return;

    const memoryType = score >= 9 ? "success_pattern" : score < 7 ? "failure_pattern" : null;
    if (!memoryType) return;

    await db.insert(agentMemory).values({
      organizationId: orgId,
      agentType: "pax",
      memoryType,
      key: "response_quality_pattern",
      value: {
        score,
        queryPattern: userMessage.slice(0, 150),
        responsePattern: assistantResponse.slice(0, 150),
        reasons: parsed.reasons || [],
        improvements: parsed.improvements || [],
        // The model's own self-reported confidence in its rating (0..1) or null.
        modelConfidence: result.confidence ?? null,
        recordedAt: new Date().toISOString(),
      },
      confidence: String(Math.min(1, score / 10)),
    });

    // Stamp the REAL model confidence into pax_observations so the calibration
    // surface has model-derived points (not only detector heuristics). Only
    // surfaces a row when the model actually reported confidence; honest-null
    // otherwise (recordModelObservation returns null and writes nothing).
    try {
      const { paxObserver } = await import("../services/paxObserver");
      await paxObserver.recordModelObservation({
        organizationId: orgId,
        type: memoryType === "success_pattern" ? "opportunity" : "optimization",
        modelConfidence: result.confidence ?? null,
        modelSource: "pax_response_quality",
        severity: "info",
        title:
          memoryType === "success_pattern"
            ? "Strong Pax response pattern"
            : "Pax response could improve",
        description:
          memoryType === "success_pattern"
            ? `A recent Pax answer scored ${score}/10. Captured as a success pattern to reinforce.`
            : `A recent Pax answer scored ${score}/10. Captured as an improvement opportunity.`,
        skipBatching: true,
        metadata: {
          source: "pax_response_quality_scorer",
          dataPoints: { score, model: result.model },
        },
      });
    } catch {
      // Observation write is advisory — never block on it.
    }
  } catch {
    // Never block a response over scoring failure
  }
}

// ── Calibration Context Loader ───────────────────────────────────────────────
// Loads outcome calibration data (from outcomeAnalyzer) into the system prompt
// so Pax knows which score buckets actually convert and which price estimates drift.
async function loadCalibrationContext(orgId: number): Promise<string> {
  try {
    const calibrations = await db
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.organizationId, orgId))
      .orderBy(desc(agentMemory.createdAt))
      .limit(3);
    const calibration = calibrations.find(m => m.memoryType === "calibration");
    if (!calibration || !calibration.value) return "";
    const data = calibration.value as any;
    if (!data.buckets) return "";
    const lines = data.buckets
      .filter((b: any) => b.sampleSize >= 5)
      .map((b: any) => `Score ${b.range}: actual conversion rate ${(b.actualRate * 100).toFixed(1)}% (expected ${(b.expectedRate * 100).toFixed(1)}%, n=${b.sampleSize})`);
    if (lines.length === 0) return "";
    return `\n\n--- LEAD SCORE CALIBRATION (from closed deals) ---\n${lines.join("\n")}\nUse this to calibrate which leads to prioritize.\n--- END CALIBRATION ---`;
  } catch {
    return "";
  }
}

// Thrown when the AI provider (OpenRouter) returns 402 indicating the
// account doesn't have enough credit for the requested completion — even
// after we've tried to clamp max_tokens to what the account can afford.
// The route handler converts this into a 402 response so the client sees a
// clear "AI provider out of credits" signal instead of a generic 500.
export class ProviderCreditError extends Error {
  constructor(public readonly affordableTokens: number | null, public readonly providerMessage: string) {
    super(providerMessage);
    this.name = "ProviderCreditError";
  }
}

/**
 * 2026-07-14 cost audit — thrown when the org's (or the platform's) daily AI
 * cost ceiling is exhausted on the Pax chat rail. Routes map this to a
 * friendly 429, mirroring the message-count limit shape. Never a 500.
 */
export class PaxAiPausedError extends Error {
  readonly code = "PAX_AI_PAUSED" as const;
  constructor(public readonly scope: "org" | "platform") {
    super(
      scope === "org"
        ? "Pax has reached today's AI budget for your workspace. It resets tomorrow — or connect your own AI key in Settings for unlimited use."
        : "Pax is briefly paused platform-wide for the day. Please try again tomorrow.",
    );
    this.name = "PaxAiPausedError";
  }
}

/**
 * 2026-07-14 cost audit: the Pax chat rail previously bypassed the AI cost
 * ceilings entirely — it metered spend into api_usage, which the ceilings
 * (aiCostCeiling.ts, reading ai_telemetry_events) never see, and it never
 * consulted them before calling. Enforcement, in order:
 *   1. BYOK turns are exempt — the customer's key pays the provider,
 *      platform COGS is $0, so platform/org ceilings don't apply.
 *   2. Ceiling exhausted → PaxAiPausedError (friendly 429 at the route).
 *   3. Remaining org budget thin (< 50¢) → finish the day on Haiku instead
 *      of stopping — graceful degradation over hard stops.
 * Accounting READ failures inside the ceiling helpers already fail open
 * (per their own contracts) — a metering hiccup never breaks customer chat.
 */
async function enforcePaxCostCeilings(
  orgId: number,
  byokChannel: string | null,
  model: string,
): Promise<string> {
  if (byokChannel) return model;
  const {
    assertWithinAiCostCeiling,
    getRemainingDailyBudgetCents,
    AiCostCeilingExceededError,
  } = await import("../services/aiCostCeiling");
  try {
    // Includes the platform-wide check (customer-facing: no failClosed —
    // customers get the full bucket, background loops reserve at 70%).
    await assertWithinAiCostCeiling(orgId);
  } catch (err) {
    if (err instanceof AiCostCeilingExceededError) {
      logger.warn("[AI Chat] cost ceiling exhausted — pausing Pax turn", {
        metadata: { orgId, scope: err.orgId === 0 ? "platform" : "org", windowKey: err.windowKey },
      });
      throw new PaxAiPausedError(err.orgId === 0 ? "platform" : "org");
    }
    throw err;
  }
  try {
    const remainingCents = await getRemainingDailyBudgetCents(orgId);
    const isCheapModel = model.includes("haiku") || model.includes("deepseek");
    if (Number.isFinite(remainingCents) && remainingCents < 50 && !isCheapModel) {
      logger.info("[AI Chat] daily budget thin — degrading model to Haiku", {
        metadata: { orgId, remainingCents, from: model },
      });
      return "anthropic/claude-haiku-4-5-20251001";
    }
  } catch {
    // Budget lookup already fails open inside the helper; belt-and-suspenders.
  }
  return model;
}

/**
 * Write-through so the ceilings SEE Pax spend: mirror each turn's estimated
 * cost into ai_telemetry_events (the ledger aiCostCeiling sums), alongside
 * the existing api_usage log. Fire-and-forget — telemetry must never block
 * or fail a customer turn. BYOK turns log $0 (customer's spend, not COGS).
 */
function recordPaxTelemetry(payload: {
  orgId: number;
  model: string;
  provider: string;
  estimatedCostCents: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  cacheHit: boolean;
}): void {
  void (async () => {
    try {
      const { aiTelemetryEvents } = await import("@shared/schema");
      await db.insert(aiTelemetryEvents).values({
        organizationId: payload.orgId,
        taskType: "pax_chat",
        provider: payload.provider,
        model: payload.model,
        promptTokens: payload.promptTokens,
        completionTokens: payload.completionTokens,
        totalTokens: payload.promptTokens + payload.completionTokens,
        estimatedCostCents: payload.estimatedCostCents.toString(),
        latencyMs: payload.latencyMs,
        cacheHit: payload.cacheHit,
        complexity: "moderate",
        success: true,
        errorMessage: null,
      });
    } catch (err) {
      logger.warn("[AI Chat] pax telemetry write failed (turn unaffected)", {
        metadata: { detail: err instanceof Error ? err.message : String(err) },
      });
    }
  })();
}

// Extract the "can only afford N" number from an OpenRouter 402 message.
function extractAffordableTokens(message: string): number | null {
  const m = /afford\s+(\d+)/i.exec(message);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

// Call chat.completions.create with automatic one-shot retry when OpenRouter
// returns a 402 "requires more credits" complaint. We clamp max_tokens to
// what the account can afford and try once more. If that also 402s, raise a
// typed ProviderCreditError so the handler can return 402 to the client.
async function createChatCompletionWithCreditRetry(
  client: OpenAI,
  params: OpenAI.ChatCompletionCreateParamsNonStreaming
): Promise<OpenAI.ChatCompletion> {
  try {
    return await client.chat.completions.create(params);
  } catch (error: any) {
    const status = error?.status ?? error?.response?.status;
    const msg = String(error?.message ?? "");
    if (status === 402 && /credit|afford/i.test(msg)) {
      const affordable = extractAffordableTokens(msg);
      // Leave 50t headroom for the response safety margin; floor at 256.
      const retryMax = affordable && affordable > 300 ? Math.max(256, affordable - 50) : 256;
      logger.warn("[AI Chat] OpenRouter 402 — retrying with clamped max_tokens", {
        metadata: { requested: params.max_tokens, retryMax, affordable, providerMessage: msg.slice(0, 200) },
      });
      try {
        return await client.chat.completions.create({ ...params, max_tokens: retryMax });
      } catch (retryErr: any) {
        const retryMsg = String(retryErr?.message ?? "");
        const retryStatus = retryErr?.status ?? retryErr?.response?.status;
        if (retryStatus === 402) {
          throw new ProviderCreditError(extractAffordableTokens(retryMsg), retryMsg);
        }
        throw retryErr;
      }
    }
    throw error;
  }
}

function getChatProviderAndModel(complexity: TaskComplexity): { client: OpenAI; provider: AIProvider; model: string } {
  try {
    const result = selectProviderAndModel(complexity);
    logger.info(`[AI Chat] Selected provider: ${result.provider}/${result.model}`);
    return result;
  } catch (error: any) {
    logger.error('[AI Chat] Failed to get AI provider', error);
    throw new Error("AI service not available. Please check configuration.");
  }
}

/**
 * T3-3D sub-item 6 — SHADOW-MODE model-resolution probe.
 *
 * Runs the unified `resolveModel` alongside the live selection and emits its
 * `decisionTrace` (tagged `model_decision_trace`) for later reconciliation. The
 * EXISTING `liveModel` passed in remains the decider — this function NEVER
 * changes which model runs. It can only log. In dev/test it additionally warns
 * when resolveModel's model disagrees with the live path. Every failure is
 * swallowed: a shadow probe must never affect a customer turn.
 */
async function shadowResolveModel(args: {
  organizationId: number;
  paxChoice: PaxModelChoice;
  complexity: TaskComplexity;
  taskType: string;
  userText: string;
  surface: string;
  liveModel: string;
}): Promise<void> {
  try {
    const shadow = await resolveModel({
      organizationId: args.organizationId,
      paxChoice: args.paxChoice,
      complexity: args.complexity,
      taskType: args.taskType,
      userText: args.userText,
      surface: args.surface,
    });
    const agrees = shadow.model === args.liveModel;
    logger.info("[pax] model_decision_trace", {
      source: "pax.modelRouter.shadow",
      metadata: {
        organizationId: args.organizationId,
        surface: args.surface,
        liveModel: args.liveModel,
        shadowModel: shadow.model,
        agrees,
        decisionTrace: shadow.decisionTrace,
      },
    });
    if (!agrees && process.env.NODE_ENV !== "production") {
      logger.warn(
        "[pax] model_decision_trace DISAGREEMENT (shadow ≠ live; live still decides)",
        {
          source: "pax.modelRouter.shadow",
          metadata: {
            surface: args.surface,
            liveModel: args.liveModel,
            shadowModel: shadow.model,
          },
        },
      );
    }
  } catch (err) {
    // Shadow probe is best-effort; never let it touch the live turn.
    logger.warn("[pax] model_decision_trace probe failed (swallowed)", {
      source: "pax.modelRouter.shadow",
      metadata: { detail: err instanceof Error ? err.message : String(err) },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ATLAS — Real Estate Intelligence Executive AI
// ─────────────────────────────────────────────────────────────────────────────
//
// Atlas is the strategic intelligence layer of AcreOS. He is the operator's
// right hand — a tireless, brilliant, and deeply knowledgeable real estate
// executive who combines world-class data science with deep field experience.
//
// Atlas is NOT a support agent. He does NOT handle billing questions, password
// resets, or general app troubleshooting. That is Sophie's domain. Atlas is
// purely focused on making the real estate BUSINESS perform at peak.
//
// SOPHIE is the customer success / support companion. She handles:
//   • Support tickets and onboarding guidance
//   • Account diagnostics and common issue resolution
//   • Knowledge base search and user education
//   • Escalation to the founder when needed
//
// When users ask Atlas support-type questions, he should warmly redirect:
//   "For account or billing questions, Sophie handles those — she's in the
//    Support section. I'm your real estate strategist — let me help you
//    find your next deal or optimize your portfolio."
//
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS_CORE_METHODOLOGY = `
REAL ESTATE MASTERY — ATLAS CORE KNOWLEDGE BASE
====================================================
You have internalized the complete methodology of expert real estate investors. This
wisdom informs every recommendation, analysis, and strategy you provide.

FUNDAMENTAL PRINCIPLES:
• Raw land has NEVER gone to zero in US history — it is the bedrock asset class
• The real estate business is a SYSTEMS business — consistency beats cleverness every time
• Your freedom number is a math problem, not a dream. It is solved by stacking notes.
• Owner financing raw land is one of the most powerful wealth-building strategies available
• Tax delinquency is not a problem — it is an opportunity wearing a disguise
• The mailer you send today is the passive income arriving next quarter
• Every rejected offer is market data. Study it, adapt, move on.
• The seller who says no today calls back in 6 months. Follow up relentlessly.
• Build systems that run whether you are watching or not

COUNTY SELECTION — THE MOST IMPORTANT DECISION:
• Target counties with: low median home values ($50k–$200k range), population 25k–250k
• Look for counties where land SELLS (not just lists) — check DOM and sold data
• Avoid: densely populated counties, hurricane/flood zones as primary markets
• Sweet spot counties: rural recreational, Sun Belt growth corridors, hunting/agriculture states
• Research: 3 months of comparable sold properties before committing to a county
• One great county can fund your freedom number — know your counties deeply
• Multi-county strategy: 3–5 proven counties provides deal flow consistency
• AZ, NM, TX, FL, CO, TN, NC, GA are historically strong land states
• Check county redemption periods — longer = more motivated sellers at auction
• Low property tax states often yield lower acquisition costs on delinquent lists

TAX DELINQUENT LIST STRATEGY:
• Contact county tax assessor/collector for delinquent tax lists (most public record)
• Filter: 2–5 years delinquent, out-of-state owners (highest motivation), 1–40 acres
• Scrub against county GIS data — remove wetlands, landlocked, non-buildable
• Out-of-state + delinquent = seller who has psychologically surrendered the property
• Target: owners paying taxes on a property worth less than $30k they never visit
• Redemption period timing: target 6–18 months before tax auction for maximum leverage
• Stack signals: delinquent taxes + out of state + no mortgage + multiple years = hot lead
• Batch requests: many counties allow monthly or quarterly list purchases for $25–$100

PRICING & OFFER STRATEGY — THE BLIND OFFER FORMULA:
• Offer at 10–30% of retail market value (FMV) — this IS the business model
• For seller financing resell: target 3–5x your acquisition cost at the spread
• Down payment formula: collect enough to cover your acquisition cost at minimum
• Monthly note payments: $100–$400/mo is the "impulse buy" range for land buyers
• Amortize over 3–10 years at 9–12% interest (higher than banks, justified by no credit check)
• Price for the PAYMENT, not the total price — buyers shop by monthly payment
• Rule of thumb: buy at $500–$2000/acre, sell owner-financed at $2000–$8000/acre
• Blind offer strategy: send offers before getting too much data — volume beats analysis
• Tiered pricing matrix: small lots ($5k–$15k), mid-size (5–20 acres: $15k–$50k), large (20+ acres: $50k+)
• Always include "as-is" clause and inspection period in purchase contract

DUE DILIGENCE — NON-NEGOTIABLE CHECKLIST:
• Access: is there legal road access? Easements? Landlocked = deal killer
• Wetlands: check USFWS wetland mapper — wetlands severely limit usability
• Flood zone: FEMA FIRM maps — 100-year flood plain dramatically reduces value
• Zoning: confirm allowed uses match your buyer pool (residential/recreational/agricultural)
• Back taxes owed: who pays them at close? Negotiate seller pays, or factor into offer
• Liens: title search for IRS liens, HOA liens, judgment liens
• Utilities: are power/water/septic available or feasible?
• Soil/percolation: if residential, can it support a septic system?
• Survey: is the parcel properly described? Boundary disputes are expensive
• Environmental: EPA brownfields, contaminated sites (rare for rural, but verify)
• APN verification: confirm parcel ID matches county GIS records exactly

LEAD NURTURING & FOLLOW-UP SYSTEM:
• 80% of land deals close after the 4th–12th contact attempt
• Multi-touch sequence: blind offer letter → postcard → phone → email → voicemail
• Response rates: 1–5% on direct mail is excellent — don't get discouraged
• Personalize letters: handwritten font, local references, empathy for their situation
• Call scripts: "Hi, I sent you a letter about your property in [County] — did you receive it?"
• Voicemail strategy: short, professional, leave callback number twice
• SMS follow-up (with TCPA consent): highest open rates after initial contact
• Drip sequence: 8–12 touches over 90 days before moving to archive
• Seller motivation signals: mentions divorce, death in family, financial hardship, moving
• Never pressure — position yourself as solving a problem for them

SELLER FINANCING & NOTE PORTFOLIO STRATEGY:
• Never sell for cash when you can sell on terms — recurring income compounds
• Structure deals with 10–20% down payment, 9–12% interest, 3–10 year term
• Dodd-Frank compliance: follow safe harbor rules for owner-financed properties
• Note portfolio = your passive income engine. Every note is a brick in your moat.
• Track: total note count, monthly note income, default rate, payoff velocity
• Reinvest note income to mail more, acquire faster — the flywheel effect
• Default management: communication first, work out payment plans, foreclosure as last resort
• Note seasoning: after 12+ payments, notes become sellable assets (note buyers exist)
• Freedom number = monthly passive expenses / average note payment = number of notes needed
• 10 notes at $200/mo = $2,000/mo passive. 50 notes = $10,000/mo passive.

MARKETING & SELLING LAND:
• List on: AcreValue, Land.com, LandWatch, LandSearch, Lands of America, Zillow, Facebook Marketplace
• Facebook groups: local "land for sale" groups drive significant buyer traffic
• Your own buyer list is your most valuable marketing asset — build it with every sale
• Seller financing listings convert 3–5x better than cash-only listings
• Photos: drone photography dramatically increases inquiries on parcels over 5 acres
• Descriptions: lead with USES (hunting, camping, homesite, investment, farming)
• Price at the note payment: "$199/mo, $500 down" sells faster than "$8,500"
• Craigslist still works for cheap parcels under $10k — don't overlook it
• Remarketing: if a property sits 60+ days, lower price or improve terms

MARKET ANALYSIS & INTELLIGENCE:
• Study DOM (days on market) for sold properties — under 90 days = liquid market
• Price-per-acre comps: pull last 12 months, filter to same parcel size range (±50%)
• Seasonal patterns: land inquiries peak March–July, slow Oct–Dec
• Migration trends: track US Census migration data — growing counties = growing land demand
• Infrastructure signals: new highways, Amazon warehouses, data centers all lift land value
• Remote work trend: accelerated demand for recreational/rural land since 2020
• Solar/wind lease potential: check NREL wind/solar maps for energy development value
• Recreational value: proximity to hunting, fishing, camping = premium pricing
• Water rights: wells, springs, creek frontage = significant value multipliers
• Timber value: check if standing timber has marketable value (separate from land)

AUTOMATION & SYSTEMS:
• Automate: lead import → scoring → offer generation → mail queue → follow-up sequences
• KPIs to track weekly: mailers sent, response rate, offers made, deals under contract, deals closed
• Your deal conversion funnel: list pulled → scrubbed → mailed → responded → offered → accepted → closed
• VA leverage: hire VAs for list scrubbing, data entry, response handling at $3–$8/hr
• CRM discipline: every lead gets a status, every status has a next action
• Monday morning routine: check notes received, review follow-up queue, mail count for week
• Evening Review: every evening — notes paid, pipeline velocity, one win of the day
• 80/20 rule: 20% of counties produce 80% of deals — double down on what works
• Batch processing: run comps, generate offers, queue mail in weekly batches for efficiency

FINANCIAL & BUSINESS METRICS:
• Target: 100%+ cash-on-cash ROI on every deal (buy at $1k, sell for $2k+ cash, or $3k+ on terms)
• Portfolio health: default rate < 5%, average note age < 30 months, reinvestment rate > 50%
• Operating costs: track all mail costs, skip trace costs, closing costs vs. revenue
• Tax strategy: dealer vs. investor status, depreciation, 1031 exchange potential
• Business structure: LLC per county or per strategy (consult tax attorney)
• Exit strategies: sell the note portfolio, sell the business, IPO the note stream
• Bookkeeping: track every acquisition cost, every payment received, every expense
`;

export const agentProfiles = {
  executive: {
    name: "Pax",
    role: "executive",
    displayName: "Executive Assistant",
    description: "Your AI-powered executive assistant for real estate operations",
    systemPrompt: `You are Pax, an AI executive assistant for a real estate company using AcreOS.

IDENTITY & ROLE:
You are NOT a generic assistant. You are a deeply specialized real estate expert with encyclopedic knowledge of property acquisition and investment. You think like a seasoned operator who has done hundreds of deals, studied the best real estate investors in the country, and built systems that generate passive income at scale.

You are the STRATEGIC brain of the operation. Your role is to help the user:
• Find, analyze, and close deals — land, residential, commercial, STR, multifamily, or any asset class
• Build and optimize their portfolio for cash flow and passive income
• Automate and systematize their real estate business
• Make data-driven decisions on markets, pricing, and timing
• Achieve their financial goals — whether that's freedom number, cash flow targets, or portfolio growth

YOU ARE THE SINGLE FACE OF AcreOS AI:
You are the customer's only AI surface. Founder-side agents (Solene, Iris, Soren, Beatrice, Krieger, and the rest of the company) are internal — never mention them to the customer or suggest the customer contact them. If a question is about billing, account, password, or platform troubleshooting, handle it warmly yourself. Use available tools to diagnose; offer concrete next steps. If a question truly requires a human (chargeback dispute, fraud claim), say "I'll flag this for the team" and stop — do not name a specific agent.

COMMUNICATION STYLE — ADAPT TO THE USER:
Adapt your language to the user's apparent experience level. If the user asks a simple navigation question, respond with clear step-by-step instructions using plain language. Avoid jargon like APN, comps, due diligence, enrichment, FMV, DOM, or freedom number unless the user uses those terms first.
When giving directions, use specific UI element names: "Click Properties in the left sidebar" not "Navigate to the Properties module." Prefer concrete action words: "click," "open," "scroll to," "look for the button labeled..."
If the user demonstrates expertise (uses industry terms, asks advanced analytical questions), match their level. But when in doubt, default to clear and simple.

${ATLAS_CORE_METHODOLOGY}

PLATFORM ACCESS — YOU CAN ACT:
You have FULL ACCESS to all AcreOS modules and can take action, not just advise:
- Create and manage Leads in the CRM (get_leads, create_lead, update_lead_status)
- Add and update Properties in Inventory (get_properties, create_property, update_property)
- Create and manage Deals in the Pipeline (get_deals, create_deal, update_deal)
- Create and complete Tasks (get_tasks, create_task, update_task)
- Analyze Finance and seller notes (calculate_roi, calculate_payment_schedule)
- Run property research and comps (research_property, run_comps_analysis)
- Generate and send offer letters (generate_offer, generate_offer_letter)
- Send TCPA-compliant communications (send_email, send_sms)
- Get system overviews (get_system_context)

DOCUMENT PROCESSING — CRITICAL:
When a document (Word, PDF, CSV) with property data is attached:
1. IMMEDIATELY scan for APNs (123-456-789 or 12.34.56.78 or 1234567890 formats)
2. Look for county names, state abbreviations, addresses, acreage
3. Use create_properties_batch to add all properties in one operation
4. DO NOT ask the user to re-paste data — it is already in your context
5. Report back: "Created X properties from [County], [State]. Ready to research or generate offers."

REAL ESTATE ANALYSIS FRAMEWORK:
When evaluating any deal or county, apply this framework:
1. COUNTY HEALTH: recent sold comps count, average DOM, price-per-acre trend
2. DEAL MATH: acquisition cost → resell price → down payment → monthly note → ROI
3. DUE DILIGENCE FLAGS: flood zone, wetlands, access, zoning, back taxes, liens
4. SELLER MOTIVATION: years delinquent + out-of-state + no mortgage = hot signal
5. PORTFOLIO FIT: does this move the needle on the freedom number?

WORKFLOW DEFAULTS:
1. Use get_system_context first when you need the full business picture
2. Always think in terms of the freedom number and passive income optimization
3. Flag deals that don't pass the due diligence checklist with specific concerns
4. When generating offers, use the blind offer formula (10–30% of FMV)
5. Format all dollar amounts as currency; format acreage with decimal precision
6. Be decisive and direct — give concrete recommendations, not endless options
7. After completing any action, suggest the logical next step in the workflow

Keep responses sharp, business-focused, and grounded in real estate reality. You are fluent in real estate terminology — APNs, comps, blind offers, owner financing, delinquent lists, freedom numbers, note portfolios — but only use it when the user does. Meet every user where they are.`,
    icon: "Bot"
  },
  acquisitions: {
    name: "Alex",
    role: "acquisitions",
    displayName: "Acquisitions Specialist",
    description: "Expert in lead qualification, deal sourcing, and pipeline management across all real estate strategies",
    systemPrompt: `You are Alex, an AI Acquisitions Specialist working within the AcreOS real estate platform.

YOUR FOCUS: Finding, qualifying, and moving deals through the pipeline — whether land, residential, commercial, multifamily, STR, or any other strategy the user pursues.

CORE RESPONSIBILITIES:
- Qualify and score leads using seller motivation signals (delinquency, out-of-state, no mortgage)
- Analyze acquisition opportunities using the blind offer formula (10–30% of FMV)
- Manage the sales pipeline from cold lead to signed purchase agreement
- Research properties and sellers for due diligence signals
- Calculate deal math: buy price → sell price → down payment → monthly note → ROI

DUE DILIGENCE CHECKLIST (apply to every deal):
1. Access — legal road access? Easements? Landlocked?
2. Wetlands — USFWS mapper check
3. Flood zone — FEMA FIRM check
4. Zoning — allowed uses match buyer pool?
5. Back taxes — who pays at close?
6. Liens — title search complete?
7. Utilities — power/water/septic feasibility

ACQUISITION TARGETS: Out-of-state owners, 2–5 years tax delinquent, 1–40 acres, counties with proven sell-through.

Be concise, deal-focused, and always move toward a close. Quote specific numbers.`,
    icon: "Target"
  },
  underwriting: {
    name: "Uma",
    role: "underwriting",
    displayName: "Underwriting Analyst",
    description: "Financial analysis, deal structuring, and portfolio optimization across all real estate strategies",
    systemPrompt: `You are Uma, an AI Underwriting Analyst for real estate deals in AcreOS.

YOUR FOCUS: Numbers, deal structuring, and passive income optimization.

CORE RESPONSIBILITIES:
- Analyze deal financials with precision (acquisition cost, carry cost, sell price, ROI)
- Structure seller financing terms: down payment (cover acquisition cost minimum), monthly note, interest rate, term
- Calculate payment schedules and amortization for owner-financed deals
- Assess risk: flood zone, wetlands, access issues, lien exposure, title risk
- Optimize note portfolio for maximum passive income vs. risk

OWNER FINANCING DEFAULTS:
- Interest rate: 9–12% (higher than bank rates; justified by no credit check)
- Term: 3–10 years (shorter = less default exposure; longer = lower payment)
- Down payment: minimum covers your acquisition cost
- Monthly payment sweet spot: $100–$400 for "impulse buy" positioning

DEAL MATH FORMULA:
- Cash deal ROI: (sell price - buy price - costs) / buy price × 100
- Note deal ROI: (down payment + total note payments - buy price - costs) / buy price × 100
- Freedom number: monthly expenses / average note payment = notes needed

Quote precise numbers always. Show your math. Flag any deal that doesn't pencil.`,
    icon: "Calculator"
  },
  marketing: {
    name: "Maya",
    role: "marketing",
    displayName: "Marketing Specialist",
    description: "Direct mail, digital campaigns, and real estate buyer/seller outreach",
    systemPrompt: `You are Maya, an AI Marketing Specialist for real estate in AcreOS.

YOUR FOCUS: Generating seller responses and finding qualified buyers across all property types.

CORE RESPONSIBILITIES:
- Create high-response direct mail campaigns (blind offer letters, postcards)
- Draft outreach messages with emotional resonance and seller empathy
- Plan multi-touch follow-up sequences (letter → postcard → call → email → SMS)
- Analyze campaign performance: response rate, cost per response, cost per deal
- Build and leverage the buyer list for seller-financed land

DIRECT MAIL BEST PRACTICES:
- Personalize with handwritten-style fonts and local county references
- Lead with empathy: acknowledge they may not want the property anymore
- Include a specific cash offer (blind offer) — vague letters get ignored
- Yellow letters or typed letters: both work, test and track
- Send at least 3 touches before abandoning a prospect
- Best days to mail land: Tuesday–Thursday delivery for maximum response

DIGITAL MARKETING:
- List on AcreValue, Land.com, LandWatch, Lands of America, Zillow, Facebook Marketplace
- Facebook groups for local areas drive significant organic buyer traffic
- Lead with the monthly payment in all ads: "$199/mo, $500 down" not "$8,500"
- Drone photos dramatically increase conversions on parcels over 5 acres

Craft compelling copy. Every word in a campaign should earn its place. Write for the motivated seller who is ready to let go.`,
    icon: "Megaphone"
  },
  research: {
    name: "Riley",
    role: "research",
    displayName: "Research Analyst",
    description: "Property research, market analysis, and location intelligence across all real estate asset classes",
    systemPrompt: `You are Riley, an AI Research Analyst for real estate in AcreOS.

YOUR FOCUS: Deep, accurate intelligence on properties, markets, counties, and neighborhoods across all asset classes — land, residential, commercial, multifamily, STR, mobile home parks, and more.

CORE RESPONSIBILITIES:
- Property due diligence: flood zone (FEMA), wetlands (USFWS), zoning, access, utilities
- Market analysis: DOM trends, price-per-acre comps, sold-vs-listed ratios
- County intelligence: population trends, tax sale data, GIS endpoint verification
- Comparable sales research: filter by parcel size ±50%, last 12 months, same county
- Environmental and regulatory overlays: EPA, state environmental agencies

DATA SOURCES TO LEVERAGE:
- FEMA FIRM maps for flood risk
- USFWS National Wetlands Inventory
- USGS topographic and elevation data
- Census Bureau for population/migration trends
- County GIS portals for parcel data
- NREL for solar/wind potential
- FSA for farmland classifications

RESEARCH STANDARDS:
- Always note data source and last update date
- Flag any conflicting data between sources
- Give confidence score on any estimate
- Never extrapolate beyond available data without clear caveats
- County-level data is your foundation; parcel-level data is your verification

Be thorough, cite your sources, and always flag uncertainty clearly.`,
    icon: "Search"
  },
  documents: {
    name: "Dana",
    role: "documents",
    displayName: "Documents Specialist",
    description: "Contract drafting, offer letters, and closing documents",
    systemPrompt: `You are Dana, an AI Documents Specialist for land deals in AcreOS.

YOUR FOCUS: Professional, legally sound documents that close deals.

CORE RESPONSIBILITIES:
- Draft purchase and sale agreements for raw land transactions
- Create personalized offer letters (professional, friendly, or urgent tone)
- Generate seller financing contracts and promissory notes
- Manage closing documents and title transfer paperwork
- Maintain document templates for efficiency and consistency

DOCUMENT STANDARDS:
- Always include: property description (legal and APN), purchase price, earnest money, closing date, contingencies, "as-is" clause with inspection period
- Seller financing addenda: interest rate, term, payment schedule, default provisions, acceleration clause
- TCPA compliance language on all communication templates
- State-specific requirements: some states require attorney review — always note this

TONE MATCHING:
- Motivated seller / empathy letters: warm, non-threatening, solution-focused
- Investor-to-investor: direct, professional, number-focused
- Listing descriptions: benefit-focused, use-case driven, note payment prominent

Draft clean, concise documents. Legal language where required, plain English where possible.`,
    icon: "FileText"
  },
  support: {
    name: "Pax",
    role: "support",
    displayName: "AI Copilot",
    description: "Help, guidance, troubleshooting, and general land-investing advice",
    systemPrompt: `You are Pax, the Land Investor's AI copilot inside AcreOS — empathetic, warm, proactive, and the single face of the AI for every customer on every surface.

IDENTITY & ROLE:
You care deeply about the Land Investor's outcomes and always advocate for them. You are the go-to helper for anyone who needs to navigate AcreOS, understand their data, or get grounded guidance on land-investing fundamentals.

CORE RESPONSIBILITIES:
- Help users navigate AcreOS features: leads, properties, deals, tasks, campaigns, finance, documents
- Answer "how do I...?" questions about every module in the platform
- Troubleshoot issues: missing data, configuration problems, subscription questions
- Provide property valuation guidance using comps, market trends, and pricing frameworks
- Offer general land investing education: due diligence basics, deal structures, seller financing
- Guide new users through onboarding and first-deal workflows
- Escalate complex technical issues when needed

SUPPORT APPROACH:
1. Listen carefully — restate the user's issue to confirm understanding
2. Check context — use available tools to diagnose before guessing
3. Provide clear, step-by-step guidance — no jargon without explanation
4. Follow up — suggest the next logical action after resolving the issue
5. Be honest — if you don't know, say so and escalate rather than guessing

PROPERTY VALUATION GUIDANCE:
- Walk users through pulling comps (comparable sales within 12 months, ±50% acreage, same county)
- Explain the blind offer formula: 10–30% of fair market value for acquisition
- Help interpret due diligence data: flood zones, wetlands, soil types, access, zoning
- Show how to calculate ROI on cash deals and seller-financed note deals

PLATFORM KNOWLEDGE:
- Leads module: import lists, qualify sellers, manage pipeline stages
- Properties module: add inventory, run due diligence, view maps and overlays
- Deals module: create deals, track closing progress, manage contracts
- Finance module: seller notes, payment schedules, amortization, collections
- Campaigns module: direct mail, email, SMS outreach sequences
- Tasks module: to-dos, reminders, agent-assigned work items
- Documents module: offer letters, purchase agreements, contracts
- Analytics: dashboards, reports, KPIs, freedom number tracking

TONE:
Warm but professional. Use encouraging language. Celebrate progress. Never make the user feel bad for asking a basic question. Example: "Great question! Here's how that works..." rather than "Obviously, you just..."`,
    icon: "LifeBuoy"
  }
};

export type AgentRole = keyof typeof agentProfiles;

interface FileAttachment {
  name: string;
  content: string; // base64 encoded
  size: number;
}

interface ChatOptions {
  conversationId?: number;
  agentRole?: AgentRole;
  stream?: boolean;
  files?: FileAttachment[];
  propertyId?: number;
  mentionedEntities?: { type: string; id: number; name: string; preview: string }[];
  activeProjectId?: number;
  modelOverride?: string; // Override automatic model selection
  subAgentDepth?: number; // Internal: depth counter for spawn_subagent recursion guard
  /**
   * Pax response-shape prompt version. Default "v3" (one-line headline +
   * up to 3 bullets). Set to "v2" via `?paxPrompt=v2` for ops fall-back.
   */
  paxPromptVersion?: PaxPromptVersion;
}

function decodeBase64ToText(base64: string): string {
  try {
    // Handle data URLs (e.g., data:text/csv;base64,...)
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    return Buffer.from(base64Data, 'base64').toString('utf-8');
  } catch {
    return '[Unable to decode file content]';
  }
}

function parseCSV(content: string): { headers: string[]; rows: string[][]; totalRows: number } {
  const lines = content.split('\n').filter(line => line.trim());
  if (lines.length === 0) return { headers: [], rows: [], totalRows: 0 };
  
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };
  
  const headers = parseRow(lines[0]);
  const rows = lines.slice(1, 31).map(parseRow); // Limit to 30 data rows for context
  
  return { headers, rows, totalRows: lines.length - 1 };
}

// Detect if a file is an image
function isImageFile(file: { name: string; mimeType?: string }): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return (file as any).mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'].includes(ext);
}

// Build an image content part for vision-capable models
function buildImageContentPart(file: FileAttachment): { type: "image_url"; image_url: { url: string } } {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpeg';
  const mimeType = (file as any).mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } };
}

async function formatFileContentAsync(file: FileAttachment): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  // Images are handled separately as content parts — return a placeholder
  if (isImageFile(file)) {
    return `[Image file attached: ${file.name}]`;
  }

  // For DOCX files, use mammoth to extract text
  if (extension === 'docx') {
    try {
      const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
      const buffer = Buffer.from(base64Data, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value;
      const preview = text.slice(0, 15000);
      return `--- File: ${file.name} (Word Document) ---\n${preview}${text.length > 15000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
    } catch (err: any) {
      logger.error(`[AI] Error parsing DOCX file ${file.name}`, err);
      return `--- File: ${file.name} ---\n[Error: Could not parse DOCX file. The file may be corrupted or in an unsupported format.]\n--- End of ${file.name} ---`;
    }
  }
  
  const content = decodeBase64ToText(file.content);
  
  // For CSV files, parse into structured format
  if (extension === 'csv') {
    const { headers, rows, totalRows } = parseCSV(content);
    
    if (headers.length === 0) {
      return `--- File: ${file.name} (CSV, empty) ---\nNo data found.\n--- End of ${file.name} ---`;
    }
    
    let result = `--- File: ${file.name} (CSV with ${totalRows} records) ---\n`;
    result += `COLUMNS: ${headers.join(', ')}\n\n`;
    result += `DATA (showing ${Math.min(rows.length, 30)} of ${totalRows} records):\n`;
    
    // Format as readable records
    for (let i = 0; i < rows.length; i++) {
      result += `\nRecord ${i + 1}:\n`;
      for (let j = 0; j < headers.length; j++) {
        const value = rows[i][j] || '';
        if (value) {
          result += `  ${headers[j]}: ${value}\n`;
        }
      }
    }
    
    if (totalRows > 30) {
      result += `\n[...${totalRows - 30} more records not shown...]\n`;
    }
    result += `--- End of ${file.name} ---`;
    return result;
  }
  
  // For text files
  if (['txt', 'text', 'md', 'json'].includes(extension)) {
    const preview = content.slice(0, 10000);
    return `--- File: ${file.name} ---\n${preview}${content.length > 10000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
  }
  
  // For other files, show what we can
  return `--- File: ${file.name} ---\n${content.slice(0, 5000)}${content.length > 5000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
}

// Sync wrapper for backward compatibility
function formatFileContent(file: FileAttachment): string {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  
  // For DOCX files, return a placeholder - use formatFileContentAsync instead
  if (extension === 'docx') {
    return `--- File: ${file.name} (Word Document) ---\n[Processing DOCX...]\n--- End of ${file.name} ---`;
  }
  
  const content = decodeBase64ToText(file.content);
  
  // For CSV files, parse into structured format
  if (extension === 'csv') {
    const { headers, rows, totalRows } = parseCSV(content);
    
    if (headers.length === 0) {
      return `--- File: ${file.name} (CSV, empty) ---\nNo data found.\n--- End of ${file.name} ---`;
    }
    
    let result = `--- File: ${file.name} (CSV with ${totalRows} records) ---\n`;
    result += `COLUMNS: ${headers.join(', ')}\n\n`;
    result += `DATA (showing ${Math.min(rows.length, 30)} of ${totalRows} records):\n`;
    
    for (let i = 0; i < rows.length; i++) {
      result += `\nRecord ${i + 1}:\n`;
      for (let j = 0; j < headers.length; j++) {
        const value = rows[i][j] || '';
        if (value) {
          result += `  ${headers[j]}: ${value}\n`;
        }
      }
    }
    
    if (totalRows > 30) {
      result += `\n[...${totalRows - 30} more records not shown...]\n`;
    }
    result += `--- End of ${file.name} ---`;
    return result;
  }
  
  // For text files
  if (['txt', 'text', 'md', 'json'].includes(extension)) {
    const preview = content.slice(0, 10000);
    return `--- File: ${file.name} ---\n${preview}${content.length > 10000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
  }
  
  // For other files, show what we can
  return `--- File: ${file.name} ---\n${content.slice(0, 5000)}${content.length > 5000 ? '\n[...truncated...]' : ''}\n--- End of ${file.name} ---`;
}

async function getConversation(id: number): Promise<AiConversation | undefined> {
  const [conv] = await db.select().from(aiConversations).where(eq(aiConversations.id, id));
  return conv;
}

async function createConversation(data: { organizationId: number; userId: string; title: string; agentRole: string }): Promise<AiConversation> {
  const [conv] = await db.insert(aiConversations).values(data).returning();
  return conv;
}

async function updateConversation(id: number, updates: Partial<{ title: string }>): Promise<void> {
  await db.update(aiConversations).set({ ...updates, updatedAt: new Date() }).where(eq(aiConversations.id, id));
}

async function getMessages(conversationId: number): Promise<AiMessage[]> {
  return db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(aiMessages.createdAt);
}

async function createMessage(data: { conversationId: number; role: string; content: string; toolCalls?: any[] }): Promise<AiMessage> {
  const [msg] = await db.insert(aiMessages).values(data).returning();
  return msg;
}

/**
 * Load user preference memories from agentMemory and format them for system prompt injection.
 * Preferences teach the AI about the user's communication style, deal criteria, and workflow habits.
 */
async function loadUserPreferenceContext(orgId: number): Promise<string> {
  try {
    const memories = await storage.getAgentMemories(orgId, undefined, 50);
    const preferences = memories.filter(m => m.memoryType === "preference");
    if (preferences.length === 0) return "";

    const lines = preferences.map(m => `- ${m.key}: ${JSON.stringify(m.value)}`).join("\n");
    return `\n\n--- USER PREFERENCES (learned from past interactions) ---\n${lines}\n--- END USER PREFERENCES ---`;
  } catch {
    return ""; // Non-blocking — never fail a chat request over a missing preference
  }
}

async function loadOrgKnowledgeContext(orgId: number): Promise<string> {
  try {
    const files = await storage.getActiveKnowledgeFiles(orgId);
    if (files.length === 0) return "";
    // Unit 111: uploaded document text lands in the SYSTEM role message, so it
    // gets the same envelope the tool-result path already uses — the canonical
    // sanitizer plus <<USER_DATA>> markers Pax's system prompt actually
    // instructs the model about. It previously used middleware/promptInjection's
    // same-named-but-weaker sanitizePrompt and no envelope at all, so
    // `<|im_start|>`, `</system>` and `[INST]` reached the system prompt intact.
    // `f.name` is user-supplied too (it is the upload's filename), which is why
    // it goes through the source-label slot rather than into the marker line raw.
    const sections = files.map(f =>
      wrapUntrusted(f.extractedContent ?? "", `knowledge:${f.name}`)
    ).join("\n\n");
    // Non-blocking usage tracking
    process.nextTick(() => storage.incrementKnowledgeFileUsage(orgId).catch(() => {}));
    return `\n\n=== COMPANY KNOWLEDGE BASE ===\n${sections}\n=== END COMPANY KNOWLEDGE ===`;
  } catch {
    return "";
  }
}

async function loadProjectContext(orgId: number, projectId: number): Promise<string> {
  try {
    // Tier 1F: org-pinned fetch — a cross-org activeProjectId yields no
    // context instead of leaking another tenant's project files.
    const project = await storage.getPaxProject(orgId, projectId);
    if (!project) return "";
    const files = await storage.getPaxProjectFiles(projectId);
    // Unit 111, same reasoning as loadOrgKnowledgeContext above. The project's
    // own name and description are org-authored free text reaching the system
    // prompt, so they are sanitized too — inline, since they sit on the framing
    // lines rather than inside a data block.
    const sections = files
      .map(f => wrapUntrusted(f.extractedContent ?? "", `project-file:${f.fileName}`))
      .join("\n\n");
    const safeName = sanitizePromptInline(project.name ?? "", { source: "project.name" });
    const safeDesc = project.description
      ? sanitizePromptInline(project.description, { source: "project.description" })
      : "";
    return `\n\n=== PROJECT: ${safeName} ===\n${safeDesc ? `Description: ${safeDesc}\n` : ""}${sections}\n=== END PROJECT ===`;
  } catch {
    return "";
  }
}

// Exported helper used by knowledge/project upload routes
export async function formatFileContentFromBase64(file: { name: string; content: string; mimeType: string }): Promise<string> {
  return formatFileContentAsync({ name: file.name, content: file.content, size: 0 } as FileAttachment);
}

// Auto-compaction: summarize old messages when conversation grows too long
async function compactConversationIfNeeded(
  conversationId: number,
  messages: AiMessage[]
): Promise<AiMessage[]> {
  if (messages.length < 20) return messages;
  const totalChars = messages.reduce((s, m) => s + (m.content?.length ?? 0), 0);
  if (totalChars < 80_000) return messages; // ~20k tokens threshold

  const compactUpTo = Math.floor(messages.length / 2);
  const toCompact = messages.slice(0, compactUpTo);
  const toKeep = messages.slice(compactUpTo);

  try {
    const { selectProviderAndModel, TaskComplexity: TC } = await import('../services/aiRouter');
    const { client: sc, model: sm } = selectProviderAndModel(TC.SIMPLE);
    const res = await sc.chat.completions.create({
      model: sm,
      messages: [
        { role: "system", content: "Summarize this conversation as concise bullet points. Preserve all property details, deal terms, decisions made, and action items. Be specific, not generic." },
        { role: "user", content: toCompact.map(m => `${m.role.toUpperCase()}: ${m.content?.slice(0, 600)}`).join('\n\n') }
      ],
      max_tokens: 1200
    });
    const summary = res.choices[0]?.message?.content || "";
    // Store summary async (non-blocking)
    process.nextTick(() => {
      db.update(aiConversations)
        .set({ contextSummary: summary } as any)
        .where(eq(aiConversations.id, conversationId))
        .catch(() => {});
    });
    logger.info(`[AI] Auto-compacted ${compactUpTo} messages for conversation ${conversationId}`);
    return [
      { id: -1, conversationId, role: "assistant", content: `=== CONVERSATION SUMMARY (auto-compacted) ===\n${summary}\n=== END SUMMARY ===`, createdAt: new Date() } as AiMessage,
      ...toKeep
    ];
  } catch {
    return messages; // Non-blocking — if compaction fails, use original
  }
}

export async function getOrCreateConversation(
  orgId: number,
  userId: string,
  conversationId?: number
): Promise<AiConversation> {
  if (conversationId) {
    const conv = await getConversation(conversationId);
    if (conv && conv.organizationId === orgId) {
      return conv;
    }
  }

  return await createConversation({
    organizationId: orgId,
    userId,
    title: "New Conversation",
    agentRole: "executive"
  });
}

export async function processChat(
  message: string,
  org: Organization,
  userId: string,
  options: ChatOptions = {}
): Promise<{ response: string; toolCalls?: any[]; conversationId: number; model?: string; provider?: string; estimatedCost?: number; promptTokens?: number; completionTokens?: number; tierDowngraded?: boolean; paxTier?: string }> {
  const { agentRole = "executive", files, propertyId } = options;
  // Map "assistant" to "executive" and fallback to executive for unknown roles
  const roleStr = agentRole as string;
  const normalizedRole = (roleStr === "assistant" || !agentProfiles[roleStr as keyof typeof agentProfiles]) 
    ? "executive" 
    : roleStr as keyof typeof agentProfiles;
  const profile = agentProfiles[normalizedRole];
  const tools = buildPaxToolList(normalizedRole);

  const conversation = await getOrCreateConversation(org.id, userId, options.conversationId);

  // Build the full message including file contents for AI, but store only original message in DB
  let fullMessage = message;
  let displayMessage = message; // What we show in DB and chat history
  
  if (files && files.length > 0) {
    // Add file names to display message for reference
    const fileNames = files.map(f => f.name).join(', ');
    displayMessage = `${message}\n\n[Attached files: ${fileNames}]`;
    
    // Full message with content for AI processing (async for DOCX support)
    const fileContentsArray = await Promise.all(files.map(f => formatFileContentAsync(f)));
    const fileContents = fileContentsArray.join('\n\n');
    fullMessage = `${message}\n\nThe user has attached the following file(s). Please analyze and process them according to their request:\n\n${fileContents}`;
    logger.info(`[AI Chat] Processing ${files.length} file attachment(s)`);
  }

  // Store only the display message (without binary content) in the database
  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: displayMessage
  });

  let messages = await getMessages(conversation.id);
  messages = await compactConversationIfNeeded(conversation.id, messages);

  // Inject property enrichment context into the system prompt when a property is open
  let _enrichCtx = "";
  const _pid = (options as ChatOptions).propertyId;
  if (_pid) {
    try {
      const _prop = await storage.getProperty(org.id, _pid);
      if (_prop) {
        const _ed = (_prop as any).enrichmentData;
        const _lines: string[] = [
          `\n\n--- ACTIVE PROPERTY CONTEXT (ID: ${_prop.id}) ---`,
          `Address: ${_prop.address || "N/A"}`,
          `Size: ${_prop.sizeAcres ? `${_prop.sizeAcres} acres` : "N/A"}`,
          `State: ${_prop.state || "N/A"}, County: ${_prop.county || "N/A"}`,
          `APN: ${_prop.apn || "N/A"}`,
        ];
        if (_ed) {
          _lines.push(`Enrichment Completeness: ${_ed.completenessScore ?? "?"}%`);
          if (_ed.hazards?.floodZone) _lines.push(`Flood Zone: ${_ed.hazards.floodZone}`);
          if (_ed.environment?.soilType) _lines.push(`Soil: ${_ed.environment.soilType}`);
          if (_ed.demographics?.population) _lines.push(`Tract Population: ${_ed.demographics.population}, Median Income: $${_ed.demographics.medianHouseholdIncome?.toLocaleString() ?? "N/A"}`);
          if (_ed.scores) _lines.push(`Scores: ${JSON.stringify(_ed.scores)}`);
          if (_ed.hazards?.wetlandsPresent !== undefined) _lines.push(`Wetlands Present: ${_ed.hazards.wetlandsPresent}`);
          if (_ed.elevation?.elevationFeet) _lines.push(`Elevation: ${_ed.elevation.elevationFeet} ft`);
          if (_ed.transportation?.nearestHighwayMiles !== undefined) _lines.push(`Nearest Highway: ${_ed.transportation.nearestHighwayMiles} mi`);
        } else {
          _lines.push("(No enrichment data yet — use research_property to fetch it.)");
        }
        _lines.push("--- END PROPERTY CONTEXT ---");
        _enrichCtx = _lines.join("\n");
      }
    } catch (_) { /* non-blocking */ }
  }

  // Inject Atlas episodic memory into system prompt
  let _memoryCtx = "";
  try {
    const { getRelevantMemories, formatMemoriesForContext } = await import("../services/atlasMemory");
    const memories = await getRelevantMemories(org.id, agentRole || 'atlas', 15);
    _memoryCtx = formatMemoriesForContext(memories);
  } catch (_memErr) { /* non-blocking */ }

  // Inject learned user preferences into the system prompt (non-blocking)
  const _prefCtx = await loadUserPreferenceContext(org.id);
  const _knowledgeCtx = await loadOrgKnowledgeContext(org.id);
  const _projectCtx = options.activeProjectId ? await loadProjectContext(org.id, options.activeProjectId) : "";
  // Unit 111: `mentionedEntities[].name` arrives as a bare `z.string()` on the
  // request body (routes-ai.ts) and lands in the SYSTEM role message. It was the
  // one context block reaching the system prompt with NO sanitization at all.
  const _mentionCtx = options.mentionedEntities?.length
    ? `\n\n=== MENTIONED ENTITIES ===\n${options.mentionedEntities.map(e => `[${sanitizePromptInline(String(e.type ?? "")).toUpperCase()}] ${sanitizePromptInline(e.name ?? "", { source: "mention.name" })}: ${sanitizePromptInline(e.preview ?? "", { source: "mention.preview" })}`).join("\n")}\n=== END MENTIONED ENTITIES ===`
    : "";
  const _connectedIds = await storage.getConnectedConnectorIds(org.id);
  const _connectorCtx = buildConnectorContextBlock(_connectedIds);
  const _calibrationCtx = await loadCalibrationContext(org.id);
  // Vertical-aware persona context. Without this, every wholesaler /
  // fix-and-flipper / note-investor / etc gets a "Land Investor" system
  // prompt and Pax addresses them in the wrong vocabulary. Surfaced by the
  // 2026-06-05 customer audit — the helper existed + was tested + was used
  // by supportAgent.ts and customerNarrative.ts, but the primary chat path
  // never imported it.
  const { paxVerticalContext: _verticalCtxFn, getOrgInvestorType: _getInvType } =
    await import("../services/paxPersona");
  const _verticalCtx = _verticalCtxFn(await _getInvType(org.id));
  // P1-41 + P0-14: compose with response-shape v3 + untrusted-data clause.
  const _basePrompt = profile.systemPrompt + _verticalCtx + (_enrichCtx || "") + (_prefCtx || "") + (_calibrationCtx || "") + (_knowledgeCtx || "") + (_projectCtx || "") + (_mentionCtx || "") + (_connectorCtx || "");
  const _systemContent = composePaxSystemPrompt(_basePrompt, options.paxPromptVersion);

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: _systemContent },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Replace the last message with full content (including file data) for AI processing
  if (files && files.length > 0 && chatMessages.length > 1) {
    chatMessages[chatMessages.length - 1] = { role: "user", content: fullMessage };
  }

  // Replace image files with vision content parts in the last user message
  const imageFiles = (files ?? []).filter(isImageFile);
  if (imageFiles.length > 0 && chatMessages.length > 1) {
    const textPart = { type: "text" as const, text: fullMessage };
    const imageParts = imageFiles.map(buildImageContentPart);
    chatMessages[chatMessages.length - 1] = { role: "user", content: [textPart, ...imageParts] };
  }

  const hasFileAttachments = files && files.length > 0;
  const complexity = classifyFromMessages("chat", chatMessages.map(m => ({
    role: m.role as string,
    content: typeof m.content === 'string' ? m.content : ''
  })), hasFileAttachments);

  let client: OpenAI;
  let provider: AIProvider;
  let model: string;

  // Batch 7 — Pax tier gating. Resolve the org's tier-appropriate model
  // BEFORE asking the router. The router's complexity-based default does not
  // know about subscription tier, so without this a Free customer could hit
  // Opus while a Scale customer could be silently downgraded to Haiku.
  // `pickPaxModelForOrg` is fail-open (Haiku on any error), so a lookup hiccup
  // can never block a chat.
  const paxChoice = await pickPaxModelForOrg(org.id);
  logger.info("[pax-tier]", {
    metadata: {
      orgId: org.id,
      tier: paxChoice.tier,
      model: paxChoice.model,
      reason: paxChoice.reason,
      isDowngraded: paxChoice.isDowngraded,
      msgCountThisMonth: paxChoice.msgCountThisMonth,
      surface: "processChat",
    },
  });

  try {
    const result = getChatProviderAndModel(complexity);
    client = result.client;
    provider = result.provider;
    // Resolution order:
    //   1. Explicit modelOverride (founder dashboard, eval harness).
    //   2. Vision: image inputs that aren't already on a vision-capable model
    //      get bumped to gpt-4o so the image parts don't fall on the floor.
    //   3. Pax tier choice (Free→Haiku / Pro→Sonnet / Scale→Opus, with the
    //      monthly soft-cap downgrade applied) — the TIER CEILING.
    //   3b. Tahoe Andrei (#7): COST-AWARE TASK-TYPE ROUTING. Given the tier
    //       ceiling, route the cheapest model whose data-grounding eval is
    //       green for THIS turn type (extraction/restatement/formatting →
    //       Haiku/Sonnet; multi-parcel reasoning stays at the ceiling).
    //       Gated on DATA_GROUNDING_EVAL_GREEN; fully reversible. Never
    //       exceeds the ceiling, never applies when vision/override won.
    //   4. Router default (legacy fallback if something above returns empty).
    const visionFallback =
      imageFiles.length > 0
      && !result.model.includes('gpt-4o')
      && !result.model.includes('claude')
        ? 'openai/gpt-4o'
        : null;
    // Apply cost-aware task-type routing to the tier ceiling only. If the tier
    // lookup returned nothing we leave it null so the router default still wins.
    const costRoutedCeiling = paxChoice.model
      ? routePaxModelForTurn({
          organizationId: org.id,
          tierCeilingModel: paxChoice.model,
          userText: message,
          surface: "processChat",
        }).model
      : paxChoice.model;
    model = options.modelOverride
      || visionFallback
      || costRoutedCeiling
      || result.model;
  } catch (error: any) {
    logger.error('[AI Chat] Failed to get AI provider', error);
    throw new Error("AI service temporarily unavailable. Please try again.");
  }

  // T3-3D sub-item 6 — SHADOW-MODE only. Emit the unified resolveModel trace
  // alongside the live `model` decided above. The live `model` is UNCHANGED —
  // this never reassigns it; it only logs the trace + any disagreement. Run
  // before BYOK so the trace reflects the platform routing decision (BYOK is a
  // client/model-id remap layered on top of the same routing choice).
  void shadowResolveModel({
    organizationId: org.id,
    paxChoice,
    complexity,
    taskType: "pax_chat",
    userText: message,
    surface: "processChat",
    liveModel: model,
  });

  // Tier 1I — BYOK routing. If the org holds an active AI key, route this
  // turn through THEIR provider (their spend, $0 platform COGS) instead of
  // the platform key. Resolution failure falls back to platform routing —
  // a vault hiccup must never error the turn. The key itself lives only
  // inside the client; never logged.
  let byokChannel: string | null = null;
  try {
    const { resolveAiByokClient } = await import("../services/byok/aiByok");
    const byok = await resolveAiByokClient(org.id);
    if (byok) {
      client = byok.client;
      model = byok.mapModel(model);
      byokChannel = byok.channel;
      provider = (byok.channel === "openai" ? "openai" : provider) as AIProvider;
    }
  } catch (err) {
    logger.warn("[AI Chat] BYOK resolution failed — using platform routing", err instanceof Error ? err : undefined);
  }

  // Ceiling enforcement + thin-budget degradation (2026-07 cost audit).
  model = await enforcePaxCostCeilings(org.id, byokChannel, model);

  logger.info(`[AI Chat] Routing chat (${complexity}) -> ${provider}/${model}${byokChannel ? ` [byok:${byokChannel}]` : ""}`);

  // P1-41: Anthropic prompt caching. The system prompt is large and stable
  // (>1024 chars including ATLAS core methodology); annotating it with
  // cache_control: ephemeral lets OpenRouter pass the cache breakpoint to
  // Anthropic and discount the cached portion ~90% on read.
  //
  // Prefix-match invariant (claude-api skill, shared/prompt-caching.md): the
  // cached prefix is system (index 0) only; the volatile per-turn user/assistant
  // messages sit AFTER the cache_control breakpoint, so they never invalidate
  // the system prefix. The Pax system prompt is reused on every turn of every
  // conversation for an org, so the cache read discount lands on the bulk of
  // the input tokens after the first warm-up call.
  const _isAnthropicChatModel = model.startsWith("anthropic/") || model.includes("claude");
  const _systemLen = typeof _systemContent === "string" ? _systemContent.length : 0;
  const _shouldCache = _isAnthropicChatModel && _systemLen >= 1024;
  const _payloadMessages = _shouldCache
    ? chatMessages.map((m, i) => i === 0 && m.role === "system"
        ? ({ ...m, cache_control: { type: "ephemeral" } } as any)
        : m)
    : chatMessages;

  // Tahoe Andrei: pre-call cost forecast on the hot Pax path. Mounts the
  // centralized predictCostCents so the cost line + per-call usage log reflect
  // accurate per-model pricing (and the prompt-prefix cache discount) instead
  // of the old hand-rolled costMultiplier. The cached-input fraction models the
  // stable system prefix being served from Anthropic's prompt cache on warm
  // turns — when caching is active we assume the system prefix reads from cache.
  const _totalInputChars = JSON.stringify(chatMessages).length;
  const _cachedInputFraction = _shouldCache && _totalInputChars > 0
    ? Math.min(0.9, _systemLen / _totalInputChars)
    : 0;
  const _predictedCents = predictCostCents({
    model,
    inputChars: _totalInputChars,
    maxTokens: 2048,
    cachedInputFraction: _cachedInputFraction,
    // gpt-4o style function schemas / Pax tool list add input tokens the raw
    // char count doesn't capture; pad when tools are attached.
    toolOverheadTokens: tools.length > 0 ? tools.length * 120 : 0,
  });
  // Cache-savings forecast: what the same call would cost with a cold cache.
  const _predictedColdCents = predictCostCents({
    model,
    inputChars: _totalInputChars,
    maxTokens: 2048,
    cachedInputFraction: 0,
    toolOverheadTokens: tools.length > 0 ? tools.length * 120 : 0,
  });

  let response: OpenAI.ChatCompletion;
  try {
    response = await createChatCompletionWithCreditRetry(client, {
      model,
      messages: _payloadMessages,
      tools: tools.length > 0 ? tools : undefined,
      max_tokens: 2048
    });
  } catch (error: any) {
    logger.error(`[AI Chat] ${provider} API error`, error);
    // Propagate ProviderCreditError so the handler can surface a 402 with
    // a precise "provider out of credits" message instead of a generic 500.
    if (error instanceof ProviderCreditError) throw error;
    throw new Error("AI request failed. Please try again in a moment.");
  }

  try {
    const { storage } = await import('../storage');
    const estimatedTokens = _totalInputChars / 4;
    // Authoritative estimate from the centralized pricing table. Round UP to a
    // whole cent for the usage ledger (never log $0 for a real paid call).
    // Tier 1I: BYOK-routed turns are genuinely $0 PLATFORM cost — the
    // customer's key paid the provider. Log 0 so COGS telemetry stays true.
    const estimatedCostCents = byokChannel ? 0 : Math.max(1, Math.ceil(_predictedCents));
    await storage.logApiUsage({
      organizationId: org.id,
      service: provider,
      action: 'chat_completion',
      count: 1,
      estimatedCostCents,
      metadata: {
        model,
        complexity,
        provider,
        byokChannel: byokChannel ?? undefined,
        estimatedTokens: Math.round(estimatedTokens),
        // Persist the prompt-prefix cache savings forecast so the founder cost
        // dashboard can show what caching is buying on the hot Pax path.
        predictedCents: Number(_predictedCents.toFixed(4)),
        predictedColdCents: Number(_predictedColdCents.toFixed(4)),
        predictedCacheSavingsCents: Number((_predictedColdCents - _predictedCents).toFixed(4)),
        promptCacheActive: _shouldCache,
      },
    });
    // Write-through to the ceilings' ledger (2026-07 cost audit) — without
    // this, Pax spend was invisible to the daily ceilings that gate it.
    recordPaxTelemetry({
      orgId: org.id,
      model,
      provider,
      estimatedCostCents,
      promptTokens: response.usage?.prompt_tokens ?? Math.round(estimatedTokens),
      completionTokens: response.usage?.completion_tokens ?? 0,
      latencyMs: 0,
      cacheHit: Boolean(
        (response.usage as any)?.prompt_tokens_details?.cached_tokens,
      ),
    });
  } catch (error) {
    logger.error('[AI Chat] Failed to log API usage', error);
  }

  let assistantMessage = response.choices[0].message;
  const toolCallsExecuted: any[] = [];

  // Read-only tool prefixes — safe to parallelize
  const READ_ONLY_PREFIXES = ["get_", "search_", "calculate_", "list_", "recall_", "browse_"];

  const MAX_TOOL_ITERATIONS = 10; // Prevent unbounded cost from runaway tool loops
  let toolIterationCount = 0;

  while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
    toolIterationCount++;
    if (toolIterationCount > MAX_TOOL_ITERATIONS) {
      logger.warn("[processChat] Tool iteration limit reached", { iterations: toolIterationCount });
      break;
    }
    const validToolCalls = assistantMessage.tool_calls.filter((tc): tc is typeof tc & { id: string; function: { name: string; arguments: string } } => 'function' in tc);
    const allReadOnly = validToolCalls.every(tc => READ_ONLY_PREFIXES.some(p => tc.function.name.startsWith(p)));

    let toolResults: OpenAI.ChatCompletionToolMessageParam[];

    if (allReadOnly && validToolCalls.length > 1) {
      // Execute read-only tools in parallel for performance
      toolResults = await Promise.all(
        validToolCalls.map(async (toolCall) => {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await executeTool(toolCall.function.name, args, org, { userId });
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          return { role: "tool" as const, tool_call_id: toolCall.id, content: serializeToolResultForModel(toolCall.function.name, result) };
        })
      );
    } else {
      toolResults = [];
      for (const toolCall of validToolCalls) {
        const args = JSON.parse(toolCall.function.arguments);
        // Approval-required tools are gated INSIDE executeTool (Tier 1A
        // approval kernel): without trustedApproval they freeze as a
        // pending_actions row and return a pending artifact — no send fires
        // from this path, structurally.
        const result = await executeTool(toolCall.function.name, args, org, { userId });
        toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
        toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: serializeToolResultForModel(toolCall.function.name, result) });
      }
    }

    chatMessages.push(assistantMessage as any);
    chatMessages.push(...toolResults);

    try {
      response = await createChatCompletionWithCreditRetry(client, {
        model,
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: 2048
      });
    } catch (error: any) {
      logger.error(`[AI Chat] ${provider} API error during tool loop`, error);
      if (error instanceof ProviderCreditError) throw error;
      throw new Error("AI request failed during processing. Please try again.");
    }

    assistantMessage = response.choices[0].message;
  }

  const _rawFinalContent = assistantMessage.content || "I processed your request.";
  // P0-14: post-validate to catch any system-prompt leak that survived
  // the input sanitizer + delimiter contract.
  const _validated = validatePaxResponse(_rawFinalContent, {
    source: "pax.processChat",
    organizationId: org.id,
  });
  // Audit F-08-1: run the SAME hallucination guard + live eval gate the
  // streaming path runs, before persisting. Previously this non-stream path
  // (customer-reachable at routes-ai.ts, plus paxScheduler and pax_subagent)
  // shipped fabricated parcel facts with only the leak check above.
  const finalContent = await finalizePaxOutput({
    organizationId: org.id,
    output: _validated.response,
    toolCallsExecuted,
    chatMessages,
    client,
    model,
    conversationId: conversation.id,
  });

  await createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: finalContent,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined
  });

  if (messages.length <= 1) {
    const title = message.length > 50 ? message.substring(0, 50) + "..." : message;
    await updateConversation(conversation.id, { title });
  }

  // Async memory extraction — fire and forget (don't block response)
  setImmediate(async () => {
    try {
      const { processConversationMemories } = await import("../services/atlasMemory");
      const allMsgs = await getMessages(conversation.id);
      const msgHistory = allMsgs.map(m => ({ role: m.role, content: m.content || '' }));
      await processConversationMemories(org.id, msgHistory, client, agentRole || 'atlas');
    } catch (_) { /* non-blocking */ }
  });

  const usage = response.usage;
  let estimatedCost: number | undefined;
  if (usage) {
    // Central pricing table (single source of truth) — the old local table here
    // was missing every Anthropic model and fell back to a silent {1,3} guess.
    estimatedCost = computeCostUsd(
      model,
      usage.prompt_tokens || 0,
      usage.completion_tokens || 0,
    );
  }

  // Fire-and-forget quality scoring — never blocks the response
  process.nextTick(() => {
    scoreAndLearnFromResponse(org.id, message, finalContent).catch(() => {});
  });

  return {
    response: finalContent,
    toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined,
    conversationId: conversation.id,
    model,
    provider,
    estimatedCost,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    // Batch 7 — surface the tier-gating decision so the founder dashboard
    // can render "this customer was downgraded this month" without re-running
    // the lookup.
    tierDowngraded: paxChoice.isDowngraded,
    paxTier: paxChoice.tier,
  };
}

export async function* processChatStream(
  message: string,
  org: Organization,
  userId: string,
  options: ChatOptions = {}
): AsyncGenerator<{ type: string; content?: string; toolCall?: any; done?: boolean; model?: string; provider?: string; estimatedCost?: number; promptTokens?: number; completionTokens?: number }> {
  const { agentRole = "executive", files } = options;
  // Map "assistant" to "executive" and fallback to executive for unknown roles
  const roleStr = agentRole as string;
  const normalizedRole = (roleStr === "assistant" || !agentProfiles[roleStr as keyof typeof agentProfiles]) 
    ? "executive" 
    : roleStr as keyof typeof agentProfiles;
  const profile = agentProfiles[normalizedRole];
  const tools = buildPaxToolList(normalizedRole);

  const conversation = await getOrCreateConversation(org.id, userId, options.conversationId);

  // Build the full message including file contents for AI, but store only original message in DB
  let fullMessage = message;
  let displayMessage = message; // What we show in DB and chat history
  
  if (files && files.length > 0) {
    // Add file names to display message for reference
    const fileNames = files.map(f => f.name).join(', ');
    displayMessage = `${message}\n\n[Attached files: ${fileNames}]`;
    
    // Full message with content for AI processing (async for DOCX support)
    const fileContentsArray = await Promise.all(files.map(f => formatFileContentAsync(f)));
    const fileContents = fileContentsArray.join('\n\n');
    fullMessage = `${message}\n\nThe user has attached the following file(s). Please analyze and process them according to their request:\n\n${fileContents}`;
    logger.info(`[AI Stream] Processing ${files.length} file attachment(s)`);
  }

  // Store only the display message (without binary content) in the database
  await createMessage({
    conversationId: conversation.id,
    role: "user",
    content: displayMessage
  });

  let messages = await getMessages(conversation.id);
  messages = await compactConversationIfNeeded(conversation.id, messages);

  // Inject property enrichment context into the system prompt when a property is open
  let _enrichCtx = "";
  const _pid = (options as ChatOptions).propertyId;
  if (_pid) {
    try {
      const _prop = await storage.getProperty(org.id, _pid);
      if (_prop) {
        const _ed = (_prop as any).enrichmentData;
        const _lines: string[] = [
          `\n\n--- ACTIVE PROPERTY CONTEXT (ID: ${_prop.id}) ---`,
          `Address: ${_prop.address || "N/A"}`,
          `Size: ${_prop.sizeAcres ? `${_prop.sizeAcres} acres` : "N/A"}`,
          `State: ${_prop.state || "N/A"}, County: ${_prop.county || "N/A"}`,
          `APN: ${_prop.apn || "N/A"}`,
        ];
        if (_ed) {
          _lines.push(`Enrichment Completeness: ${_ed.completenessScore ?? "?"}%`);
          if (_ed.hazards?.floodZone) _lines.push(`Flood Zone: ${_ed.hazards.floodZone}`);
          if (_ed.environment?.soilType) _lines.push(`Soil: ${_ed.environment.soilType}`);
          if (_ed.demographics?.population) _lines.push(`Tract Population: ${_ed.demographics.population}, Median Income: $${_ed.demographics.medianHouseholdIncome?.toLocaleString() ?? "N/A"}`);
          if (_ed.scores) _lines.push(`Scores: ${JSON.stringify(_ed.scores)}`);
          if (_ed.hazards?.wetlandsPresent !== undefined) _lines.push(`Wetlands Present: ${_ed.hazards.wetlandsPresent}`);
          if (_ed.elevation?.elevationFeet) _lines.push(`Elevation: ${_ed.elevation.elevationFeet} ft`);
          if (_ed.transportation?.nearestHighwayMiles !== undefined) _lines.push(`Nearest Highway: ${_ed.transportation.nearestHighwayMiles} mi`);
        } else {
          _lines.push("(No enrichment data yet — use research_property to fetch it.)");
        }
        _lines.push("--- END PROPERTY CONTEXT ---");
        _enrichCtx = _lines.join("\n");
      }
    } catch (_) { /* non-blocking */ }
  }

  // Inject Atlas episodic memory into system prompt
  let _memoryCtx = "";
  try {
    const { getRelevantMemories, formatMemoriesForContext } = await import("../services/atlasMemory");
    const memories = await getRelevantMemories(org.id, agentRole || 'atlas', 15);
    _memoryCtx = formatMemoriesForContext(memories);
  } catch (_memErr) { /* non-blocking */ }

  // Inject learned user preferences into the system prompt (non-blocking)
  const _prefCtx = await loadUserPreferenceContext(org.id);
  const _knowledgeCtx = await loadOrgKnowledgeContext(org.id);
  const _projectCtx = options.activeProjectId ? await loadProjectContext(org.id, options.activeProjectId) : "";
  // Unit 111: `mentionedEntities[].name` arrives as a bare `z.string()` on the
  // request body (routes-ai.ts) and lands in the SYSTEM role message. It was the
  // one context block reaching the system prompt with NO sanitization at all.
  const _mentionCtx = options.mentionedEntities?.length
    ? `\n\n=== MENTIONED ENTITIES ===\n${options.mentionedEntities.map(e => `[${sanitizePromptInline(String(e.type ?? "")).toUpperCase()}] ${sanitizePromptInline(e.name ?? "", { source: "mention.name" })}: ${sanitizePromptInline(e.preview ?? "", { source: "mention.preview" })}`).join("\n")}\n=== END MENTIONED ENTITIES ===`
    : "";
  const _connectedIds = await storage.getConnectedConnectorIds(org.id);
  const _connectorCtx = buildConnectorContextBlock(_connectedIds);
  const _calibrationCtx = await loadCalibrationContext(org.id);
  // Vertical-aware persona context. Without this, every wholesaler /
  // fix-and-flipper / note-investor / etc gets a "Land Investor" system
  // prompt and Pax addresses them in the wrong vocabulary. Surfaced by the
  // 2026-06-05 customer audit — the helper existed + was tested + was used
  // by supportAgent.ts and customerNarrative.ts, but the primary chat path
  // never imported it.
  const { paxVerticalContext: _verticalCtxFn, getOrgInvestorType: _getInvType } =
    await import("../services/paxPersona");
  const _verticalCtx = _verticalCtxFn(await _getInvType(org.id));
  // P1-41 + P0-14: compose with response-shape v3 + untrusted-data clause.
  const _basePrompt = profile.systemPrompt + _verticalCtx + (_enrichCtx || "") + (_prefCtx || "") + (_calibrationCtx || "") + (_knowledgeCtx || "") + (_projectCtx || "") + (_mentionCtx || "") + (_connectorCtx || "");
  const _systemContent = composePaxSystemPrompt(_basePrompt, options.paxPromptVersion);

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: _systemContent },
    ...messages.map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content
    }))
  ];

  // Handle image files — build vision content parts
  const streamImageFiles = (files ?? []).filter(isImageFile);
  if (streamImageFiles.length > 0 && chatMessages.length > 1) {
    const textPart = { type: "text" as const, text: fullMessage };
    const imageParts = streamImageFiles.map(buildImageContentPart);
    chatMessages[chatMessages.length - 1] = { role: "user", content: [textPart, ...imageParts] };
  } else if (files && files.length > 0 && chatMessages.length > 1) {
    chatMessages[chatMessages.length - 1] = { role: "user", content: fullMessage };
  }

  const hasFileAttachments = files && files.length > 0;
  const complexity = classifyFromMessages("chat", chatMessages.map(m => ({
    role: m.role as string,
    content: typeof m.content === 'string' ? m.content : ''
  })), hasFileAttachments);

  let client: OpenAI;
  let provider: AIProvider;
  let model: string;

  // Batch 7 — Pax tier gating (same logic as processChat, see comment there).
  // Fail-open: any lookup error falls back to Haiku and the chat continues.
  const paxChoice = await pickPaxModelForOrg(org.id);
  logger.info("[pax-tier]", {
    metadata: {
      orgId: org.id,
      tier: paxChoice.tier,
      model: paxChoice.model,
      reason: paxChoice.reason,
      isDowngraded: paxChoice.isDowngraded,
      msgCountThisMonth: paxChoice.msgCountThisMonth,
      surface: "processChatStream",
    },
  });

  try {
    const result = getChatProviderAndModel(complexity);
    client = result.client;
    provider = result.provider;
    const visionFallback =
      streamImageFiles.length > 0
      && !result.model.includes('gpt-4o')
      && !result.model.includes('claude')
        ? 'openai/gpt-4o'
        : null;
    // Tahoe Andrei (#7): cost-aware task-type routing on the tier ceiling
    // (same logic as processChat). Reserves Opus for multi-parcel reasoning;
    // routes extraction/restatement turns to the cheapest eval-green model.
    const costRoutedCeiling = paxChoice.model
      ? routePaxModelForTurn({
          organizationId: org.id,
          tierCeilingModel: paxChoice.model,
          userText: message,
          surface: "processChatStream",
        }).model
      : paxChoice.model;
    model = options.modelOverride
      || visionFallback
      || costRoutedCeiling
      || result.model;
  } catch (error: any) {
    logger.error('[AI Stream] Failed to get AI provider', error);
    yield { type: "error", content: "AI service temporarily unavailable. Please try again." };
    return;
  }

  // T3-3D sub-item 6 — SHADOW-MODE only (parity with processChat). Emits the
  // unified resolveModel trace alongside the live `model`; the live `model`
  // remains the decider and is never reassigned here.
  void shadowResolveModel({
    organizationId: org.id,
    paxChoice,
    complexity,
    taskType: "pax_chat",
    userText: message,
    surface: "processChatStream",
    liveModel: model,
  });

  // Tier 1I — BYOK routing (parity with processChat). Org's own AI key
  // serves the turn: their spend, $0 platform COGS. Fall back to platform
  // routing on any resolution failure; key never logged.
  let streamByokChannel: string | null = null;
  try {
    const { resolveAiByokClient } = await import("../services/byok/aiByok");
    const byok = await resolveAiByokClient(org.id);
    if (byok) {
      client = byok.client;
      model = byok.mapModel(model);
      streamByokChannel = byok.channel;
      provider = (byok.channel === "openai" ? "openai" : provider) as AIProvider;
    }
  } catch (err) {
    logger.warn("[AI Stream] BYOK resolution failed — using platform routing", err instanceof Error ? err : undefined);
  }

  // Ceiling enforcement + thin-budget degradation (2026-07 cost audit) —
  // same seam as processChat; PaxAiPausedError maps to a friendly 429.
  model = await enforcePaxCostCeilings(org.id, streamByokChannel, model);

  // Reasoning trace — for COMPLEX requests
  if (complexity === TaskComplexity.COMPLEX) {
    try {
      yield { type: "thinking_start" };
      let thinkingText = "";

      if (model.includes('claude')) {
        // Real Claude extended thinking via OpenRouter
        // Use a non-streaming call to get native thinking content blocks
        const thinkingResponse = await client.chat.completions.create({
          model,
          messages: chatMessages as any,
          max_tokens: 8000,
          // OpenRouter passes thinking param to Anthropic API (cast handles type mismatch)
          thinking: { type: "enabled", budget_tokens: 6000 },
        } as any);
        const msgContent = (thinkingResponse as any).choices?.[0]?.message?.content;
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === 'thinking' && block.thinking) {
              // Stream thinking text in chunks for smooth UI
              const chunks = (block.thinking as string).match(/[\s\S]{1,60}/g) || [];
              for (const chunk of chunks) {
                thinkingText += chunk;
                yield { type: "thinking", content: chunk };
              }
            }
          }
        }
      } else {
        // Simulated thinking for non-Claude models
        const thinkingStream = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "You are planning how to answer a complex real estate question. Think step-by-step about what information you need, what tools to use, and what the user actually wants. Be brief but thorough. Max 3-4 sentences." },
            { role: "user", content: message }
          ],
          max_tokens: 300,
          stream: true,
        });
        for await (const chunk of thinkingStream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            thinkingText += delta;
            yield { type: "thinking", content: delta };
          }
        }
      }

      yield { type: "thinking_done" };
    } catch {
      // Non-blocking — ignore thinking errors
    }
  }

  logger.info(`[AI Stream] Routing chat stream (${complexity}) -> ${provider}/${model}${streamByokChannel ? ` [byok:${streamByokChannel}]` : ""}`);

  let fullResponse = "";
  const toolCallsExecuted: any[] = [];
  let continueLoop = true;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  while (continueLoop) {
    let stream;
    let streamMaxTokens = 2048;
    try {
      stream = await client.chat.completions.create({
        model,
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: streamMaxTokens,
        stream: true,
        stream_options: { include_usage: true }
      });
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      const msg = String(error?.message ?? "");
      if (status === 402 && /credit|afford/i.test(msg)) {
        const affordable = extractAffordableTokens(msg);
        const retryMax = affordable && affordable > 300 ? Math.max(256, affordable - 50) : 256;
        logger.warn("[AI Stream] OpenRouter 402 — retrying stream with clamped max_tokens", {
          metadata: { requested: streamMaxTokens, retryMax, affordable, providerMessage: msg.slice(0, 200) },
        });
        try {
          stream = await client.chat.completions.create({
            model,
            messages: chatMessages,
            tools: tools.length > 0 ? tools : undefined,
            max_tokens: retryMax,
            stream: true,
            stream_options: { include_usage: true }
          });
        } catch (retryErr: any) {
          logger.error(`[AI Stream] ${provider} 402 even after token clamp`, retryErr);
          yield {
            type: "error",
            code: "provider_credits_insufficient",
            content: "The AI provider is temporarily out of credits. Please try again shortly.",
          } as any;
          return;
        }
      } else {
        logger.error(`[AI Stream] ${provider} API error`, error);
        yield { type: "error", content: "AI request failed. Please try again." };
        return;
      }
    }

    let currentToolCalls: any[] = [];
    let currentContent = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        currentContent += delta.content;
        yield { type: "content", content: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined) {
            if (!currentToolCalls[tc.index]) {
              currentToolCalls[tc.index] = { id: tc.id, type: "function", function: { name: "", arguments: "" } };
            }
            if (tc.id) currentToolCalls[tc.index].id = tc.id;
            if (tc.function?.name) currentToolCalls[tc.index].function.name = tc.function.name;
            if (tc.function?.arguments) currentToolCalls[tc.index].function.arguments += tc.function.arguments;
          }
        }
      }
      
      if (chunk.usage) {
        totalPromptTokens += chunk.usage.prompt_tokens || 0;
        totalCompletionTokens += chunk.usage.completion_tokens || 0;
      }
    }

    if (currentToolCalls.length > 0) {
      const ARTIFACT_TOOLS: Record<string, { type: "card" | "table" | "document"; title: string }> = {
        calculate_roi:            { type: "card",     title: "ROI Analysis" },
        calculate_amortization:   { type: "table",    title: "Amortization Schedule" },
        run_comps_analysis:       { type: "table",    title: "Comparable Sales" },
        generate_offer:           { type: "document", title: "Offer" },
        generate_offer_letter:    { type: "document", title: "Offer Letter" },
        get_cashflow_summary:     { type: "card",     title: "Cash Flow Summary" },
      };

      const STREAM_READ_ONLY = ["get_", "search_", "calculate_", "list_", "recall_", "browse_"];
      const streamAllReadOnly = currentToolCalls.every(tc => STREAM_READ_ONLY.some(p => tc.function.name.startsWith(p)));
      const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];

      if (streamAllReadOnly && currentToolCalls.length > 1) {
        // Emit all tool_start events first (parallel signal to UI)
        for (const toolCall of currentToolCalls) {
          yield { type: "tool_start", toolCall: { name: toolCall.function.name } };
        }
        // Execute in parallel
        const parallelResults = await Promise.all(
          currentToolCalls.map(async (toolCall) => {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await executeTool(toolCall.function.name, args, org, { userId });
            return { toolCall, args, result };
          })
        );
        for (const { toolCall, args, result } of parallelResults) {
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          yield { type: "tool_result", toolCall: { name: toolCall.function.name, result } };
          const artifactMeta = ARTIFACT_TOOLS[toolCall.function.name];
          if (artifactMeta) {
            try {
              const parsed = typeof result === "string" ? JSON.parse(result) : result;
              const data = parsed?.data ?? parsed;
              if (data) yield { type: "artifact", artifactType: artifactMeta.type, title: artifactMeta.title, data } as any;
            } catch {}
          }
          toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: serializeToolResultForModel(toolCall.function.name, result) });
        }
      } else {
        for (const toolCall of currentToolCalls) {
          yield { type: "tool_start", toolCall: { name: toolCall.function.name } };
          const args = JSON.parse(toolCall.function.arguments);

          // Approval-required tools are gated INSIDE executeTool (Tier 1A
          // approval kernel): without trustedApproval the call freezes as a
          // pending_actions row and the result is a pending artifact. We
          // surface it as a dedicated stream event so the chat UI renders an
          // Approve/Reject card wired to the kernel endpoints. (This
          // replaces the old "approval_required" event + dead
          // __paxPendingApprovals map + natural-language "Confirmed, please
          // proceed" loop, which never actually executed anything.)
          const result = await executeTool(toolCall.function.name, args, org, { userId });
          toolCallsExecuted.push({ name: toolCall.function.name, arguments: args, result });
          yield { type: "tool_result", toolCall: { name: toolCall.function.name, result } };
          if ((result as any)?.data?.pendingApproval) {
            yield { type: "pending_action", pendingAction: (result as any).data } as any;
          }
          const artifactMeta = ARTIFACT_TOOLS[toolCall.function.name];
          if (artifactMeta) {
            try {
              const parsed = typeof result === "string" ? JSON.parse(result) : result;
              const data = parsed?.data ?? parsed;
              if (data) yield { type: "artifact", artifactType: artifactMeta.type, title: artifactMeta.title, data } as any;
            } catch {}
          }
          toolResults.push({ role: "tool", tool_call_id: toolCall.id, content: serializeToolResultForModel(toolCall.function.name, result) });
        }
      }

      chatMessages.push({
        role: "assistant",
        content: currentContent || null,
        tool_calls: currentToolCalls
      } as any);
      chatMessages.push(...toolResults);
    } else {
      fullResponse = currentContent;
      continueLoop = false;
    }
  }

  // P0-14: post-validate streamed final content for any system-prompt leak.
  // We persist the (possibly redacted) version in conversation history so
  // the leaked content never re-enters the context on the next turn.
  const _streamValidated = validatePaxResponse(fullResponse, {
    source: "pax.processChatStream",
    organizationId: org.id,
  });
  fullResponse = _streamValidated.response;

  // Pillar F / F1 — hallucination guard. Catches fabricated numbers,
  // unreasonable ARVs, and (most importantly) claimed lead/parcel/deal
  // IDs that don't belong to this org. Andrei 2026-06-06: the guard is now
  // fed the actual source context from this turn's tool results
  // (sourceNumbers + claimed entity IDs), so the numeric check has a baseline
  // to compare against and the cross-org entity-existence check can fire —
  // previously it was called with only {organizationId, output} and was
  // effectively dormant. `warning`-severity results render as an advisory
  // banner via toolCalls metadata; `error`-severity (guard.safe === false)
  // triggers a single corrective regeneration so we never persist a confident
  // wrong data claim.
  let hallucinationWarnings: unknown[] = [];
  try {
    const { guardPaxOutput } = await import("../services/paxHallucinationGuard");
    const { extractSourceContext } = await import("./paxSourceExtraction");
    const sourceCtx = extractSourceContext(toolCallsExecuted);

    let guarded = await guardPaxOutput({
      organizationId: org.id,
      output: fullResponse,
      sourceNumbers: sourceCtx.sourceNumbers.length > 0 ? sourceCtx.sourceNumbers : undefined,
      claimedPropertyIds: sourceCtx.claimedPropertyIds.length > 0 ? sourceCtx.claimedPropertyIds : undefined,
      claimedLeadIds: sourceCtx.claimedLeadIds.length > 0 ? sourceCtx.claimedLeadIds : undefined,
      claimedDealIds: sourceCtx.claimedDealIds.length > 0 ? sourceCtx.claimedDealIds : undefined,
    });
    hallucinationWarnings = guarded.warnings;

    if (guarded.warnings.length > 0) {
      try {
        logger.warn("[pax] hallucination warnings on assistant reply", {
          source: "pax",
          metadata: {
            organizationId: org.id,
            conversationId: conversation.id,
            warningCount: guarded.warnings.length,
            safe: guarded.safe,
            kinds: guarded.warnings.map((w) => w.kind),
            sourceNumberCount: sourceCtx.sourceNumbers.length,
            claimedPropertyIdCount: sourceCtx.claimedPropertyIds.length,
          },
        });
      } catch { /* logger optional */ }
    }

    // Block-and-retry on error severity: an error-severity warning means Pax
    // stated a number with no source backing, or referenced an entity that
    // isn't in this org — the high-stakes "confident wrong claim" shape. We
    // regenerate ONCE with a corrective instruction (non-streamed), re-guard,
    // and replace the streamed answer via a `correction` event. If the retry
    // still isn't safe, we fall back to a plain honest deflection rather than
    // persisting the unsafe text.
    if (!guarded.safe) {
      const errorDetails = guarded.warnings
        .filter((w) => w.severity === "error")
        .map((w) => w.detail)
        .join("; ");
      const correctionInstruction =
        `Your previous draft contained unsupported claims and was NOT sent. ` +
        `Issues: ${errorDetails}. ` +
        `Rewrite your answer using ONLY facts present in the tool results from this turn. ` +
        `Do not state any number, parcel fact (flood zone, soil, acreage, zoning, owner), ` +
        `or entity you cannot ground in those results. If you don't have a value, say so plainly ` +
        `and offer the paid-tier lookup path instead of guessing.`;
      try {
        const correctionResponse = await client.chat.completions.create({
          model,
          messages: [
            ...chatMessages,
            { role: "assistant", content: fullResponse },
            { role: "user", content: correctionInstruction },
          ],
          max_tokens: 1024,
        });
        const corrected = correctionResponse.choices?.[0]?.message?.content?.trim();
        if (corrected) {
          const reguarded = await guardPaxOutput({
            organizationId: org.id,
            output: corrected,
            sourceNumbers: sourceCtx.sourceNumbers.length > 0 ? sourceCtx.sourceNumbers : undefined,
            claimedPropertyIds: sourceCtx.claimedPropertyIds.length > 0 ? sourceCtx.claimedPropertyIds : undefined,
            claimedLeadIds: sourceCtx.claimedLeadIds.length > 0 ? sourceCtx.claimedLeadIds : undefined,
            claimedDealIds: sourceCtx.claimedDealIds.length > 0 ? sourceCtx.claimedDealIds : undefined,
          });
          if (reguarded.safe) {
            fullResponse = corrected;
            hallucinationWarnings = reguarded.warnings;
            guarded = reguarded;
            yield { type: "correction", content: corrected } as any;
          }
        }
      } catch (retryErr) {
        logger.warn("[pax] hallucination corrective retry failed", {
          source: "pax",
          metadata: { organizationId: org.id, conversationId: conversation.id },
        });
      }

      // If still unsafe after the retry, deflect honestly rather than persist a
      // confident-wrong answer.
      if (!guarded.safe) {
        const deflection =
          "I don't have verified data to answer that confidently right now. " +
          "I can pull the underlying records first — want me to run that lookup?";
        fullResponse = deflection;
        hallucinationWarnings = guarded.warnings;
        yield { type: "correction", content: deflection } as any;
      }
    }
  } catch {
    /* guard is advisory — never block reply persistence on its failure */
  }

  // Tahoe Andrei (2026-06-07): LIVE EVAL GATE — runtime critical-case gating.
  // The hallucination guard above catches fabricated numbers/entities; this
  // catches the forbidden SEMANTIC patterns the guard can't see — the
  // paraphrased hallucination ("minimal flood risk" after a flood MISS,
  // "you should buy", "guaranteed to double"). It runs the SAME critical
  // `pax_inbox` forbidden-trait assertions our CI uses, in-process on the
  // already-assembled `fullResponse` (off the streaming hot loop, no network,
  // no DB). On a hit we DON'T throw — we fold into the same correction/
  // deflection machinery the guard uses, so the unsafe text is never persisted.
  if (PAX_LIVE_GATE_ENABLED) {
    try {
      let gate = evaluateLivePaxOutput(fullResponse);
      if (!gate.clear) {
        logger.warn("[pax] live eval gate tripped on assistant reply", {
          source: "pax",
          metadata: {
            organizationId: org.id,
            conversationId: conversation.id,
            hits: gate.hits.map((h) => ({ caseId: h.caseId, trait: h.trait })),
          },
        });

        const tripped = gate.hits
          .map((h) => `"${h.trait}" (${h.caseName})`)
          .join("; ");
        const correctionInstruction =
          `Your previous draft asserted a parcel fact or made a directive/guarantee ` +
          `that is not allowed and was NOT sent. Disallowed patterns it contained: ${tripped}. ` +
          `Rewrite your answer using ONLY facts present in this turn's tool results. ` +
          `If a lookup returned no value (flood zone, soil class, acreage, zoning, owner), ` +
          `say plainly that you don't have it and offer the paid lookup — never name or imply ` +
          `a value. Never tell the customer to buy or pass, and never guarantee a future return. ` +
          `Stay informational.`;

        try {
          const correctionResponse = await client.chat.completions.create({
            model,
            messages: [
              ...chatMessages,
              { role: "assistant", content: fullResponse },
              { role: "user", content: correctionInstruction },
            ],
            max_tokens: 1024,
          });
          const corrected = correctionResponse.choices?.[0]?.message?.content?.trim();
          if (corrected) {
            const recheck = evaluateLivePaxOutput(corrected);
            if (recheck.clear) {
              fullResponse = corrected;
              gate = recheck;
              yield { type: "correction", content: corrected } as any;
            }
          }
        } catch (retryErr) {
          logger.warn("[pax] live eval gate corrective retry failed", {
            source: "pax",
            metadata: { organizationId: org.id, conversationId: conversation.id },
          });
        }

        // Still tripped after the rewrite → honest deflection, never persist
        // the disallowed text.
        if (!gate.clear) {
          const deflection =
            "I don't have verified data to answer that confidently right now. " +
            "I can pull the underlying records first — want me to run that lookup?";
          fullResponse = deflection;
          yield { type: "correction", content: deflection } as any;
        }
      }
    } catch {
      /* live gate is defense-in-depth — never block persistence on its failure */
    }
  }

  await createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: fullResponse,
    toolCalls: toolCallsExecuted.length > 0
      ? toolCallsExecuted
      : hallucinationWarnings.length > 0
        ? ([{ __hallucinationWarnings: hallucinationWarnings }] as unknown as typeof toolCallsExecuted)
        : undefined
  });

  if (messages.length <= 1) {
    const title = message.length > 50 ? message.substring(0, 50) + "..." : message;
    await updateConversation(conversation.id, { title });
  }

  let estimatedCost: number | undefined;
  if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
    // Central pricing table (single source of truth) — see processChat above.
    estimatedCost = computeCostUsd(model, totalPromptTokens, totalCompletionTokens);
  }

  yield { 
    type: "done", 
    done: true, 
    model, 
    provider, 
    estimatedCost,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens
  };
}

export { agentProfiles as agents };
