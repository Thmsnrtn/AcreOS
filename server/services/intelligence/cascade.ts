/**
 * Frugal Autonomy — Reasoning Cascade
 *
 * Confidence-based model escalation. Starts cheap (Haiku), escalates
 * to Sonnet when the cheap model is uncertain, escalates to Opus
 * only when the stakes warrant it.
 *
 * Cascade rules:
 *   1. Haiku decides → if confidence ≥ 0.75 AND impact_cents < $500: DONE
 *   2. Else Sonnet decides → if confidence ≥ 0.70 OR impact < $1k: DONE
 *   3. Else Opus decides → final answer
 *
 * Notes:
 *   - Each tier writes its decision to ai_telemetry_events with the
 *     resolved complexity tag, so we can audit "would we have gotten
 *     here at the cheaper tier?" after the fact.
 *   - Prompt caching is on by default (enablePromptCaching: true)
 *     because the EXECUTOR_SYSTEM_PROMPT is reused thousands of times.
 *   - Caller passes an explicit `forceTier` to bypass escalation when
 *     a triage rule has already decided "this is a critical-tier item."
 */

import { routeAITask, routeCriticalTask, TaskComplexity } from "../aiRouter";

export interface CascadeInput {
  taskType: string;                                  // executor_inbox_decision, etc.
  systemPrompt: string;
  userPrompt: string;
  impactCents: number;                               // for escalation gating
  forceTier?: "haiku" | "sonnet" | "opus" | null;    // bypass cascade
}

export interface CascadeOutput {
  action: string;
  confidence: number;     // 0-100
  reasoning: string;
  raw: any;
  tierUsed: "haiku" | "sonnet" | "opus";
  tiersTried: Array<"haiku" | "sonnet" | "opus">;
}

interface DecisionShape {
  action?: string;
  confidence?: number;
  reasoning?: string;
  [k: string]: unknown;
}

function parseDecision(content: string): DecisionShape {
  // Tolerant JSON parse — models sometimes wrap in code fences.
  const stripped = content.replace(/```json\n?|```/g, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Fall back to a defer-shaped response so callers don't crash on
    // malformed model output.
    return { action: "defer", confidence: 0, reasoning: `Could not parse model output: ${content.slice(0, 200)}` };
  }
}

const HAIKU_CONFIDENCE_THRESHOLD = 75;
const SONNET_CONFIDENCE_THRESHOLD = 70;
const SONNET_IMPACT_FLOOR_CENTS = 50_000;   // $500 — under this, Haiku's call sticks
const OPUS_IMPACT_FLOOR_CENTS = 100_000;    // $1,000 — under this, Sonnet's call sticks

/**
 * Run a decision through the Haiku→Sonnet→Opus cascade. Returns the
 * first tier whose answer satisfies the confidence × impact gate.
 *
 * Total cost characterization for a typical 3KB system + 1KB user
 * prompt (rough, depends on model + cache):
 *   - Haiku only:       ~$0.002
 *   - Haiku + Sonnet:   ~$0.012
 *   - Full cascade:     ~$0.12
 * vs prior all-Opus: ~$0.20 per call. Most cases stop at Haiku.
 */
export async function cascade(input: CascadeInput): Promise<CascadeOutput> {
  const tiersTried: Array<"haiku" | "sonnet" | "opus"> = [];

  // Honor an explicit pin from the caller — used when triage already
  // decided "this is critical enough to skip the cheap tier."
  if (input.forceTier === "opus") {
    const opus = await callOpus(input);
    tiersTried.push("opus");
    return { ...opus, tierUsed: "opus", tiersTried };
  }
  if (input.forceTier === "sonnet") {
    const sonnet = await callSonnet(input);
    tiersTried.push("sonnet");
    return { ...sonnet, tierUsed: "sonnet", tiersTried };
  }

  // Tier 1 — Haiku
  const haiku = await callHaiku(input);
  tiersTried.push("haiku");
  if (haiku.confidence >= HAIKU_CONFIDENCE_THRESHOLD && input.impactCents < SONNET_IMPACT_FLOOR_CENTS) {
    return { ...haiku, tierUsed: "haiku", tiersTried };
  }

  // Tier 2 — Sonnet
  const sonnet = await callSonnet(input);
  tiersTried.push("sonnet");
  if (sonnet.confidence >= SONNET_CONFIDENCE_THRESHOLD || input.impactCents < OPUS_IMPACT_FLOOR_CENTS) {
    return { ...sonnet, tierUsed: "sonnet", tiersTried };
  }

  // Tier 3 — Opus (only when low-confidence Sonnet AND high impact)
  const opus = await callOpus(input);
  tiersTried.push("opus");
  return { ...opus, tierUsed: "opus", tiersTried };
}

async function callHaiku(input: CascadeInput) {
  const resp = await routeAITask({
    taskType: input.taskType,
    complexity: TaskComplexity.MODERATE,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    enablePromptCaching: input.systemPrompt.length >= 1024,
  });
  const parsed = parseDecision(resp.content);
  return {
    action: String(parsed.action ?? "defer"),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    reasoning: String(parsed.reasoning ?? "no reasoning"),
    raw: parsed,
  };
}

async function callSonnet(input: CascadeInput) {
  const resp = await routeAITask({
    taskType: input.taskType,
    complexity: TaskComplexity.COMPLEX,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    enablePromptCaching: input.systemPrompt.length >= 1024,
  });
  const parsed = parseDecision(resp.content);
  return {
    action: String(parsed.action ?? "defer"),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    reasoning: String(parsed.reasoning ?? "no reasoning"),
    raw: parsed,
  };
}

async function callOpus(input: CascadeInput) {
  const resp = await routeCriticalTask(
    input.taskType,
    input.systemPrompt,
    input.userPrompt,
  );
  const parsed = parseDecision(resp.content);
  return {
    action: String(parsed.action ?? "defer"),
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
    reasoning: String(parsed.reasoning ?? "no reasoning"),
    raw: parsed,
  };
}
