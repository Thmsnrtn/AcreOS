/**
 * SOLENE — pre-call constitutional enforcement (L6.28).
 *
 * Companion to L6.29 (constitutionalGuard.ts):
 *   - L6.29 screens at TOOL-CALL time (downstream of the model).
 *   - L6.28 screens at PROMPT-RECEIPT time (upstream of the model).
 *
 * Before dispatchRunner.runDispatch invokes the Opus model for a dispatch's
 * first turn, it asks Haiku — fast, cheap — whether the incoming prompt would
 * INDUCE a violation of any of the 12 immutables if executed by an Opus
 * agent. If yes, the dispatch fails immediately, the (expensive) Opus call
 * is never made, and a row lands in both `solene_pre_call_decisions` and
 * `solene_constitutional_violations`.
 *
 * Why upstream + downstream: a prompt may obviously direct a violation but
 * never surface a matching tool pattern (e.g. "write a marketing email
 * promising guaranteed land-flipping returns"). The downstream guard can't
 * see that intent. Conversely, a benign prompt can produce a tool call that
 * violates anyway (e.g. an unwanted disclosure deletion). The upstream
 * checker can't see that. Both layers are required.
 *
 * FAIL-OPEN DESIGN — load-bearing. The checker must never brick the worker
 * loop. If Haiku times out, errors, or returns unparseable JSON, the
 * dispatch proceeds (allowed=true) with a logged warning. The cost of a
 * bricked loop dwarfs the cost of one missed upstream screen — L6.29 still
 * catches downstream violations as the safety net.
 *
 * CREDENTIAL DISCIPLINE (feedback_credential_value_handling.md):
 *   - The Anthropic API key is read from process.env and NEVER logged. We
 *     log key length only (`keyLen=${apiKey.length}`).
 *   - The full prompt text is NEVER persisted. Only a 500-char summary lands
 *     in `solene_pre_call_decisions.prompt_summary`. The original prompt
 *     never leaves the dispatch transcript.
 *   - The full prompt is also NEVER included in error messages that surface
 *     to logs — only the summary + reasoning.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../utils/logger";
import { db } from "../../db";
import {
  solenePreCallDecisions,
  PRECALL_PROMPT_SUMMARY_MAX_CHARS,
} from "@shared/schema/solene-pre-call-decisions";
import {
  soleneConstitutionalViolations,
  type ConstitutionalSeverity,
} from "@shared/schema/solene-constitutional-violations";

// ============================================================================
// Configuration
// ============================================================================

export const PRECALL_MODEL =
  process.env.SOLENE_PRECALL_MODEL ?? "claude-haiku-4-5-20251001";

// Per-1M-token Haiku pricing. Env-overridable so Beatrice's regwatch can
// adjust without a code deploy.
const PRICE_INPUT_PER_M = Number(
  process.env.SOLENE_PRECALL_PRICE_INPUT_PER_M ?? "0.25",
);
const PRICE_OUTPUT_PER_M = Number(
  process.env.SOLENE_PRECALL_PRICE_OUTPUT_PER_M ?? "1.25",
);
// Cached-input price for Anthropic prompt-cache reads on the precall
// checker's stable system prefix (the 12 immutables + checker brief). Same
// ~10% of input ratio Anthropic publishes for Haiku.
const PRICE_CACHED_INPUT_PER_M = Number(
  process.env.SOLENE_PRECALL_PRICE_CACHED_INPUT_PER_M ?? "0.025",
);

// Generous round-trip timeout for the Haiku call. The worst case (timeout +
// fail-open) still beats the 60s+ cost of an Opus turn that would otherwise
// be wasted.
const PRECALL_TIMEOUT_MS = Number(
  process.env.SOLENE_PRECALL_TIMEOUT_MS ?? "15000",
);

// ============================================================================
// The 12 immutables — VERBATIM as presented to the checker.
//
// These are intentionally a separate constant from the canonical wording in
// shared/schema/solene-constitutional-violations.ts. The schema constant is
// the shorter denormalized snapshot used for DB column storage; this constant
// is the verbatim full-sentence wording presented to the Haiku checker so
// the model has the most explicit framing of what to screen against.
//
// The immutable_text column denormalizes THIS wording (not the schema's
// shorter form) so historical pre-call decisions survive any future
// rewording of either source.
// ============================================================================

export const TWELVE_IMMUTABLES_VERBATIM: ReadonlyArray<{
  number: number;
  text: string;
}> = [
  {
    number: 1,
    text: "Never lie to a customer about a fact, a price, or what Pax did.",
  },
  { number: 2, text: "Never use dark patterns." },
  {
    number: 3,
    text: "Never collect data that isn't immediately useful to the customer.",
  },
  { number: 4, text: "Always make cancellation as easy as signup." },
  {
    number: 5,
    text: "Never sell, share, or use customer data outside of serving them.",
  },
  {
    number: 6,
    text: "Never auto-charge without explicit, recent, easily-revoked consent.",
  },
  {
    number: 7,
    text: "Always disclose AI use clearly to every customer at first interaction.",
  },
  { number: 8, text: "Always honor data-deletion requests within 7 days." },
  {
    number: 9,
    text: "Never recommend an action against the customer's interest.",
  },
  {
    number: 10,
    text: "Never market to vulnerable populations without safeguards.",
  },
  { number: 11, text: 'Never generate "get rich quick" content.' },
  { number: 12, text: "Pax never gives advice that crosses into fiduciary." },
] as const;

function immutableTextFor(num: number | null): string | null {
  if (num === null) return null;
  const found = TWELVE_IMMUTABLES_VERBATIM.find((i) => i.number === num);
  return found ? found.text : null;
}

// Critical-severity immutables match the L6.29 (constitutionalGuard) policy:
// #5 (data misuse), #6 (auto-charge), #11 (get-rich-quick), #12 (fiduciary).
// Everything else is urgent.
const CRITICAL_IMMUTABLES = new Set<number>([5, 6, 11, 12]);

function severityFor(num: number): ConstitutionalSeverity {
  return CRITICAL_IMMUTABLES.has(num) ? "critical" : "urgent";
}

// ============================================================================
// Prompt construction
// ============================================================================

/**
 * The precall checker's system prompt is 100% stable across every call —
 * the 12 immutables + the checker brief + the output-format spec never
 * change. We mark the whole thing as the cache_control:'ephemeral' static
 * prefix; there's no per-call dynamic suffix (the per-prompt context goes
 * in the user message, not system). The cached read price is ~10% of the
 * input price, so after the first call within a 5-min TTL, every subsequent
 * precall check pays ~10% of what it used to.
 */
function buildSystemPrompt(): string {
  const immutablesBlock = TWELVE_IMMUTABLES_VERBATIM
    .map((i) => `${i.number}. ${i.text}`)
    .join("\n");
  return [
    "You are a constitutional pre-call screener for AcreOS. You are NOT performing the",
    "agent's task — you are evaluating whether the agent's incoming prompt would",
    "INDUCE a violation of any of the 12 constitutional immutables if executed.",
    "",
    "THE 12 IMMUTABLES:",
    immutablesBlock,
    "",
    "OUTPUT FORMAT (strict JSON, no other text):",
    "{",
    '  "allowed": true | false,',
    '  "immutable_number": <int 1-12 or null>,',
    '  "reasoning": "<1-2 sentences>"',
    "}",
    "",
    "If a prompt is ambiguous, default to allowed=true (don't paranoid-block). Block",
    "only when the prompt clearly directs an action that would violate.",
  ].join("\n");
}

function buildUserMessage(agentRole: string, promptText: string): string {
  return [
    `agent_role: ${agentRole}`,
    `prompt_text: ${promptText}`,
    "",
    "Evaluate.",
  ].join("\n");
}

// ============================================================================
// Cost + parsing helpers
// ============================================================================

function estimateCostUsd(
  tokensIn: number,
  tokensOut: number,
  tokensCached: number = 0,
): number {
  return (
    (tokensIn / 1_000_000) * PRICE_INPUT_PER_M +
    (tokensCached / 1_000_000) * PRICE_CACHED_INPUT_PER_M +
    (tokensOut / 1_000_000) * PRICE_OUTPUT_PER_M
  );
}

interface ParsedCheckerOutput {
  allowed: boolean;
  immutableNumber: number | null;
  reasoning: string;
}

/**
 * Parse the Haiku response. Defensive: if the model wrapped its JSON in
 * code fences or added stray prose, try to extract the first {...} block
 * before giving up.
 */
function parseCheckerOutput(rawText: string): ParsedCheckerOutput | null {
  if (!rawText || rawText.trim().length === 0) return null;
  const cleaned = rawText.trim();

  // Try direct JSON first.
  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let parsed: unknown = tryParse(cleaned);
  if (parsed === null) {
    // Try extracting a JSON object substring.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      parsed = tryParse(cleaned.slice(start, end + 1));
    }
  }
  if (parsed === null || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const allowedRaw = obj.allowed;
  if (typeof allowedRaw !== "boolean") return null;

  const immutableRaw = obj.immutable_number;
  let immutableNumber: number | null = null;
  if (typeof immutableRaw === "number" && Number.isInteger(immutableRaw)) {
    if (immutableRaw >= 1 && immutableRaw <= 12) {
      immutableNumber = immutableRaw;
    }
  } else if (immutableRaw !== null && immutableRaw !== undefined) {
    // Non-null, non-integer → unparseable.
    return null;
  }

  const reasoningRaw = obj.reasoning;
  const reasoning =
    typeof reasoningRaw === "string" && reasoningRaw.trim().length > 0
      ? reasoningRaw.trim()
      : "(no reasoning provided)";

  // Coherence: if allowed=false, we expect an immutable_number. If missing,
  // treat as unparseable (fail-open path will kick in).
  if (!allowedRaw && immutableNumber === null) return null;

  return {
    allowed: allowedRaw,
    immutableNumber,
    reasoning,
  };
}

// ============================================================================
// Persistence
// ============================================================================

interface PersistDecisionInput {
  dispatchId: number | null;
  agentRole: string;
  promptSummary: string;
  allowed: boolean;
  immutableNumber: number | null;
  immutableText: string | null;
  reasoning: string;
  modelUsed: string;
  latencyMs: number;
  costUsd: number;
  violationEventId: number | null;
}

async function persistDecision(
  input: PersistDecisionInput,
): Promise<number | null> {
  try {
    const [row] = await db
      .insert(solenePreCallDecisions)
      .values({
        dispatchId: input.dispatchId,
        agentRole: input.agentRole,
        promptSummary: input.promptSummary,
        allowed: input.allowed,
        immutableNumber: input.immutableNumber,
        immutableText: input.immutableText,
        reasoning: input.reasoning,
        modelUsed: input.modelUsed,
        latencyMs: input.latencyMs,
        // numeric columns are serialized as string by drizzle-pg.
        costUsd: input.costUsd.toFixed(6),
        violationEventId: input.violationEventId,
      })
      .returning({ id: solenePreCallDecisions.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error(
      "[preCallConstitutionalChecker] failed to persist decision row",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

interface PersistViolationInput {
  dispatchId: number | null;
  immutableNumber: number;
  immutableText: string;
  reasoning: string;
  promptSummary: string;
  severity: ConstitutionalSeverity;
}

/**
 * Write a row to solene_constitutional_violations directly via the schema.
 * We intentionally do NOT import constitutionalGuard.ts (frozen this wave).
 */
async function persistViolationRow(
  input: PersistViolationInput,
): Promise<number | null> {
  try {
    const [row] = await db
      .insert(soleneConstitutionalViolations)
      .values({
        dispatchId: input.dispatchId,
        immutableNumber: input.immutableNumber,
        immutableText: input.immutableText,
        triggerKind: "prompt_pattern",
        // Trigger evidence: the reasoning + summary, neither of which carry
        // the credential prefixes the L6.29 sanitizer guards against. We
        // truncate defensively to the same 500-char budget.
        triggerEvidence: `precall-block reasoning="${input.reasoning}" summary="${input.promptSummary}"`.slice(
          0,
          500,
        ),
        toolName: null,
        toolInputHash: null,
        actionTaken: "blocked_and_paged",
        severity: input.severity,
        pageEventId: null,
      })
      .returning({ id: soleneConstitutionalViolations.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error(
      "[preCallConstitutionalChecker] failed to persist violation row",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

export interface CheckInput {
  agentRole: string;
  promptText: string;
  dispatchId?: number;
}

export interface CheckResult {
  allowed: boolean;
  immutableNumber: number | null;
  immutableText: string | null;
  reasoning: string;
  modelUsed: string;
  latencyMs: number;
  costUsd: number;
}

function summarizePrompt(promptText: string): string {
  if (typeof promptText !== "string") return "";
  if (promptText.length <= PRECALL_PROMPT_SUMMARY_MAX_CHARS) return promptText;
  return promptText.slice(0, PRECALL_PROMPT_SUMMARY_MAX_CHARS);
}

/**
 * Internal seam — exposed for tests to inject a fake client without having
 * to vi.mock the entire @anthropic-ai/sdk module. The dispatchRunner-side
 * caller never passes this; only tests do.
 */
export interface AnthropicLike {
  messages: {
    create: (args: any, opts?: any) => Promise<any>;
  };
}

let _testClient: AnthropicLike | null = null;

/** Test-only: install a fake client. Pass null to restore real-SDK use. */
export function __setTestAnthropicClient(client: AnthropicLike | null): void {
  _testClient = client;
}

async function getClient(apiKey: string): Promise<AnthropicLike> {
  if (_testClient) return _testClient;
  return new Anthropic({ apiKey });
}

/**
 * Check whether the dispatched prompt would induce a constitutional
 * violation if executed. FAIL-OPEN on any internal error — never brick
 * the worker loop. Persists a row to solene_pre_call_decisions regardless
 * of outcome; persists an additional row to solene_constitutional_violations
 * when allowed=false.
 */
export async function checkPromptAgainstConstitution(
  input: CheckInput,
): Promise<CheckResult> {
  const startedAt = Date.now();
  const agentRole = input.agentRole;
  const promptText = input.promptText ?? "";
  const dispatchId = input.dispatchId ?? null;
  const promptSummary = summarizePrompt(promptText);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    // No key → fail-open. Log presence only, never the value.
    const reasoning =
      "ANTHROPIC_API_KEY not set; pre-call checker failing open";
    logger.warn(`[preCallConstitutionalChecker] ${reasoning}`);
    const latencyMs = Date.now() - startedAt;
    await persistDecision({
      dispatchId,
      agentRole,
      promptSummary,
      allowed: true,
      immutableNumber: null,
      immutableText: null,
      reasoning,
      modelUsed: PRECALL_MODEL,
      latencyMs,
      costUsd: 0,
      violationEventId: null,
    });
    return {
      allowed: true,
      immutableNumber: null,
      immutableText: null,
      reasoning,
      modelUsed: PRECALL_MODEL,
      latencyMs,
      costUsd: 0,
    };
  }

  // Credential discipline: log presence + length only.
  logger.info(
    `[preCallConstitutionalChecker] check start role=${agentRole} dispatchId=${dispatchId ?? "n/a"} keyLen=${apiKey.length}`,
  );

  let parsed: ParsedCheckerOutput | null = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let tokensCached = 0;
  let modelOutputText = "";
  let callError: Error | null = null;

  try {
    const client = await getClient(apiKey);
    // 2026-06-05 cost audit (batch 5): the precall system prompt is 100%
    // stable across every call (the 12 immutables + checker brief). Mark
    // it as cache_control:'ephemeral' so each call after the first within
    // the 5-min TTL pays the cached-input price (~10% of input). Cheap
    // per call, but every dispatch pays this — saves real money in
    // aggregate over a busy day.
    const cachedSystem = [
      {
        type: "text" as const,
        text: buildSystemPrompt(),
        cache_control: { type: "ephemeral" as const },
      },
    ];
    const response = await client.messages.create(
      {
        model: PRECALL_MODEL,
        max_tokens: 256,
        temperature: 0,
        system: cachedSystem as any,
        messages: [
          {
            role: "user",
            content: buildUserMessage(agentRole, promptText),
          },
        ],
      },
      { timeout: PRECALL_TIMEOUT_MS },
    );

    tokensIn = response?.usage?.input_tokens ?? 0;
    tokensOut = response?.usage?.output_tokens ?? 0;
    const cacheReadRaw = (response?.usage as Record<string, unknown> | undefined)?.[
      "cache_read_input_tokens"
    ];
    tokensCached = typeof cacheReadRaw === "number" ? cacheReadRaw : 0;

    const content = Array.isArray(response?.content) ? response.content : [];
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string") {
        modelOutputText += block.text;
      }
    }

    parsed = parseCheckerOutput(modelOutputText);
  } catch (err) {
    callError = err instanceof Error ? err : new Error(String(err));
    logger.warn(
      `[preCallConstitutionalChecker] checker call failed — failing open: ${callError.message}`,
    );
  }

  const latencyMs = Date.now() - startedAt;
  const costUsd = estimateCostUsd(tokensIn, tokensOut, tokensCached);

  // Failure paths → fail-open.
  if (callError !== null || parsed === null) {
    const reasoning =
      callError !== null
        ? `checker call errored; failing open (${callError.message})`
        : "checker output unparseable; failing open";
    await persistDecision({
      dispatchId,
      agentRole,
      promptSummary,
      allowed: true,
      immutableNumber: null,
      immutableText: null,
      reasoning,
      modelUsed: PRECALL_MODEL,
      latencyMs,
      costUsd,
      violationEventId: null,
    });
    return {
      allowed: true,
      immutableNumber: null,
      immutableText: null,
      reasoning,
      modelUsed: PRECALL_MODEL,
      latencyMs,
      costUsd,
    };
  }

  const immutableText = immutableTextFor(parsed.immutableNumber);

  // Block path: write a violation row + back-fill its id on the decision row.
  let violationEventId: number | null = null;
  if (
    !parsed.allowed &&
    parsed.immutableNumber !== null &&
    immutableText !== null
  ) {
    const severity = severityFor(parsed.immutableNumber);
    violationEventId = await persistViolationRow({
      dispatchId,
      immutableNumber: parsed.immutableNumber,
      immutableText,
      reasoning: parsed.reasoning,
      promptSummary,
      severity,
    });
  }

  await persistDecision({
    dispatchId,
    agentRole,
    promptSummary,
    allowed: parsed.allowed,
    immutableNumber: parsed.allowed ? null : parsed.immutableNumber,
    immutableText: parsed.allowed ? null : immutableText,
    reasoning: parsed.reasoning,
    modelUsed: PRECALL_MODEL,
    latencyMs,
    costUsd,
    violationEventId,
  });

  return {
    allowed: parsed.allowed,
    immutableNumber: parsed.allowed ? null : parsed.immutableNumber,
    immutableText: parsed.allowed ? null : immutableText,
    reasoning: parsed.reasoning,
    modelUsed: PRECALL_MODEL,
    latencyMs,
    costUsd,
  };
}

// Test-only export for the cost helper so the cost-calculation test can
// pin known token counts → known dollars.
export const __test = {
  estimateCostUsd,
  parseCheckerOutput,
  severityFor,
  PRICE_INPUT_PER_M,
  PRICE_OUTPUT_PER_M,
};
