/**
 * SOLENE DISPATCH RUNNER — invokes the Anthropic SDK for a single dispatch.
 *
 * Called by the worker's runSoleneDispatchLoop (server/worker.ts) after a
 * row has been atomically claimed (claimNextDispatch). This module:
 *
 *   1. Loads the agent_role brief (team_<role>.md from the user-memory dir)
 *      and composes a system prompt that includes the autonomous-dispatch
 *      preamble.
 *   2. Captures git pre-state (status + HEAD) so failure mode is debuggable.
 *   3. Runs the Anthropic Messages API with tool_use, executing tool calls
 *      locally via dispatchToolExecutor, until: assistant returns end_turn,
 *      max_turns (50) reached, cost-cap exceeded, or timeout fires.
 *   4. Persists the full transcript to /tmp/solene-dispatches/<id>.jsonl.
 *   5. Calls completeDispatch / failDispatch + recordCapitalEvent.
 *
 * CREDENTIAL DISCIPLINE (feedback_credential_value_handling.md):
 *   The Anthropic API key is read once from process.env.ANTHROPIC_API_KEY
 *   and never logged. We log presence ("ANTHROPIC_API_KEY set") and key
 *   length only when debugging, never the value.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type {
  SoleneDispatchQueueRow,
  SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import {
  DISPATCH_MAX_TURNS,
  isReadOnlyDispatchSourceType,
} from "@shared/schema/solene-dispatch";
import { ANTHROPIC_MODELS } from "../models";
import { logger } from "../../utils/logger";
import { listActiveClaims } from "./agentClaims";
import { loadAgentIdentityBlock } from "./agentIdentity";
import { loadFailureModePreambleFor } from "./failureModeLibrary";
import {
  retrieveCrossNamespaceMemories,
  buildMultiNamespacePromptBlock,
} from "./memoryRetrieval";
import { recordCapitalEvent } from "./capitalTracker";
import {
  completeDispatch,
  failDispatch,
  type DispatchFailureInput,
} from "./dispatchQueue";
import {
  getDispatchToolSchemas,
  executeDispatchTool,
} from "./dispatchToolExecutor";
import { checkPromptAgainstConstitution } from "./preCallConstitutionalChecker";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

// 2026-06-05 cost audit (batch 5): the runtime default model is now Sonnet
// for routine dispatches. Strategic roles + escalations escalate to Opus via
// selectModelForDispatch() below. SOLENE_DISPATCH_MODEL env still pins a
// single model across every dispatch if set — useful for an incident where
// Tom wants every agent on the same tier — but day-to-day routing is
// per-role.
const DEFAULT_MODEL =
  process.env.SOLENE_DISPATCH_MODEL ?? ANTHROPIC_MODELS.SONNET;

// Strategic-tier model. Used when selectModelForDispatch() routes the
// dispatch up to Opus. Resolved through models.ts (2026-07-03 pin
// centralization — this held a stale Opus 4-7 while models.ts pinned 4-8).
const STRATEGIC_MODEL =
  process.env.SOLENE_DISPATCH_STRATEGIC_MODEL ?? ANTHROPIC_MODELS.OPUS;
const TRANSCRIPT_DIR =
  process.env.SOLENE_DISPATCH_TRANSCRIPT_DIR ??
  "/tmp/solene-dispatches";

const MEMORY_DIR =
  process.env.SOLENE_DISPATCH_MEMORY_DIR ??
  path.resolve(
    process.env.HOME ?? "/",
    ".claude/projects/-Users-user-AcreOS-AcreOS/memory",
  );

// Auto-regenerated team-state map (every 15 minutes by
// scripts/regenerate-team-state.mjs). Injected into the system prompt so
// every dispatched agent knows who else is in flight, what's queued, and
// what working-tree surfaces other agents are currently mutating.
const TEAM_STATE_PATH =
  process.env.SOLENE_DISPATCH_TEAM_STATE_PATH ??
  path.resolve(process.cwd(), "docs/internal/solene-team-state.md");

// Cap the team-state preamble at 8 KB. The file is normally well under
// this; this protects against runaway regeneration putting the whole
// dispatch transcript over the model's context budget.
const TEAM_STATE_MAX_BYTES = 8 * 1024;

// 2026-06-05 cost audit (batch 5) — per-model pricing table.
//
// Previously a single Opus pair lived here; now every model the dispatcher
// can route to has its own (input, output, cachedInput) triple so cost
// attribution is accurate when a Sonnet-tier role completes a dispatch and
// when prompt-cache reads dominate input tokens. The env-overridable
// SOLENE_DISPATCH_PRICE_INPUT_PER_M / _OUTPUT_PER_M are kept for the
// LEGACY default-model row to preserve Beatrice's regwatch override path.
// cachedInput is the discounted price for `cache_read_input_tokens`
// (Anthropic's prompt-cache hit, ~10 percent of the standard input price).
interface ModelPricing {
  input: number;
  output: number;
  cachedInput: number;
}
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Current Opus (4-8): $5/$25 per 1M, cached input ~10% ($0.5).
  [ANTHROPIC_MODELS.OPUS]: {
    input: Number(process.env.SOLENE_DISPATCH_OPUS_INPUT_PER_M ?? "5"),
    output: Number(process.env.SOLENE_DISPATCH_OPUS_OUTPUT_PER_M ?? "25"),
    cachedInput: Number(process.env.SOLENE_DISPATCH_OPUS_CACHED_INPUT_PER_M ?? "0.5"),
  },
  // Legacy Opus 4-7 row kept so queued rows carrying a per-dispatch
  // model="claude-opus-4-7" pin still price at that model's real rates —
  // which are $5/$25 (claude-api skill, 2026-07-08); this row previously
  // carried the pre-4.6 Opus price and over-attributed those dispatches 3×.
  "claude-opus-4-7": {
    input: 5,
    output: 25,
    cachedInput: 0.5,
  },
  [ANTHROPIC_MODELS.SONNET]: {
    input: Number(process.env.SOLENE_DISPATCH_SONNET_INPUT_PER_M ?? "3"),
    output: Number(process.env.SOLENE_DISPATCH_SONNET_OUTPUT_PER_M ?? "15"),
    cachedInput: Number(process.env.SOLENE_DISPATCH_SONNET_CACHED_INPUT_PER_M ?? "0.3"),
  },
  // Haiku 4.5 publishes at $1/$5 (claude-api skill, 2026-07-08) — the old
  // $0.25/$1.25 defaults were Haiku-3.5-era and undercounted spend 4×.
  [ANTHROPIC_MODELS.HAIKU]: {
    input: Number(process.env.SOLENE_DISPATCH_HAIKU_INPUT_PER_M ?? "1"),
    output: Number(process.env.SOLENE_DISPATCH_HAIKU_OUTPUT_PER_M ?? "5"),
    cachedInput: Number(process.env.SOLENE_DISPATCH_HAIKU_CACHED_INPUT_PER_M ?? "0.1"),
  },
};

function pricingFor(model: string): ModelPricing {
  // Fall back to Sonnet pricing if the model isn't in the table — safer than
  // assuming Opus rates for an unknown model, which would over-bill the
  // capital tracker and potentially trigger the cost cap early.
  return MODEL_PRICING[model] ?? MODEL_PRICING[ANTHROPIC_MODELS.SONNET];
}

// ----------------------------------------------------------------------------
// Per-role model tiering (2026-06-05 cost audit — batch 5)
//
// Strategic / architectural / escalation dispatches → Opus.
// Routine dispatches (Krieger mobile-feel, Iris perf alerts, Beatrice
// compliance reads, Soren SEO updates, general-purpose) → Sonnet.
//
// Override precedence:
//   1. row.model (per-dispatch pin, when the enqueuer knows what's needed)
//   2. SOLENE_DISPATCH_MODEL env (deploy-wide override — incident response)
//   3. selectModelForDispatch() heuristic below
// ----------------------------------------------------------------------------

const STRATEGIC_SOURCE_TYPES = new Set<string>([
  // Founder bypasses are by definition strategic enough to escalate.
  "founder_bypass",
]);

const ARCHITECTURE_IRIS_SOURCES = new Set<string>([
  // Iris-specific signals where Opus actually earns the price multiplier.
  "architecture_review",
  "incident_response",
]);

/**
 * Pick the right model for a dispatch. Cheaper by default — escalate only
 * when role + sourceType warrants strategic-tier judgement.
 */
export function selectModelForDispatch(row: {
  agentRole: string;
  sourceType: string;
  model?: string | null;
}): string {
  // 1. Explicit per-dispatch pin wins.
  if (row.model && row.model.trim().length > 0) return row.model;

  // 2. Deploy-wide env override (set SOLENE_DISPATCH_MODEL to force a tier).
  if (process.env.SOLENE_DISPATCH_MODEL) {
    return process.env.SOLENE_DISPATCH_MODEL;
  }

  // 3. Heuristic.
  if (
    row.sourceType === "strategic_review" ||
    row.sourceType === "escalation" ||
    STRATEGIC_SOURCE_TYPES.has(row.sourceType)
  ) {
    return STRATEGIC_MODEL;
  }

  // Iris architecture/incident work earns Opus; routine Iris dispatches
  // (e.g. perf alerts, log-trawl summaries) stay on Sonnet.
  if (
    row.agentRole === "iris" &&
    ARCHITECTURE_IRIS_SOURCES.has(row.sourceType)
  ) {
    return STRATEGIC_MODEL;
  }

  // Solene's own dispatched work is strategic by construction — she runs
  // the team and her outputs feed back into team-state and roadmap. (Note:
  // 'solene' isn't currently in DISPATCH_AGENT_ROLES because the orchestrator
  // doesn't dispatch to herself today, but the gate is here for when she does.)
  if (row.agentRole === "solene") {
    return STRATEGIC_MODEL;
  }

  return DEFAULT_MODEL;
}

// ----------------------------------------------------------------------------
// Brief loading
// ----------------------------------------------------------------------------

async function loadAgentBrief(
  role: SoleneDispatchAgentRole,
): Promise<{ brief: string; source: string }> {
  // Map role -> memory file. general-purpose has no brief; others map by name.
  const file =
    role === "general-purpose" ? null : path.join(MEMORY_DIR, `team_${role}.md`);
  if (!file) {
    return {
      brief: "Operate as a general-purpose AcreOS engineer.",
      source: "(none — general-purpose)",
    };
  }
  try {
    const content = await fs.readFile(file, "utf8");
    return { brief: content, source: file };
  } catch (err) {
    logger.warn(
      `[dispatchRunner] brief load failed for role=${role} (${err instanceof Error ? err.message : String(err)})`,
    );
    return {
      brief: `(brief unavailable for role=${role}; operate per AcreOS engineering standards from CLAUDE.md)`,
      source: `(missing: ${file})`,
    };
  }
}

// ----------------------------------------------------------------------------
// Ensemble-awareness preamble loaders (Layer 1 capability #3 — keystone 3)
//
// `buildSystemPrompt` injects two blocks at the very top of every dispatched
// agent's system prompt:
//
//   1. The auto-regenerated team-state map (the <!-- AUTO --> section of
//      docs/internal/solene-team-state.md).
//   2. The active-claims DO-NOT-TOUCH list (from agentClaims.listActiveClaims),
//      excluding the current dispatch's own claim row.
//
// Both loaders fail soft — a missing file, a missing marker pair, or a DB
// hiccup produces a short fallback string + a warn log, never a thrown
// exception. The autonomous-dispatch path must keep running even if the
// ensemble context is unavailable.
// ----------------------------------------------------------------------------

const TEAM_STATE_AUTO_OPEN = "<!-- AUTO -->";
const TEAM_STATE_AUTO_CLOSE = "<!-- /AUTO -->";
const TEAM_STATE_FALLBACK =
  "(team-state map unavailable — proceeding with no team context preamble)";
const ACTIVE_CLAIMS_EMPTY =
  "_No other agents currently in flight. Working tree is yours to claim._";

export async function loadTeamStatePreamble(): Promise<string> {
  let raw: string;
  try {
    raw = await fs.readFile(TEAM_STATE_PATH, "utf8");
  } catch (err) {
    logger.warn(
      `[dispatchRunner] team-state map unreadable at ${TEAM_STATE_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return TEAM_STATE_FALLBACK;
  }

  const openIdx = raw.indexOf(TEAM_STATE_AUTO_OPEN);
  const closeIdx = raw.indexOf(TEAM_STATE_AUTO_CLOSE);
  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    logger.warn(
      `[dispatchRunner] team-state map missing AUTO markers at ${TEAM_STATE_PATH}`,
    );
    return TEAM_STATE_FALLBACK;
  }
  let block = raw.slice(openIdx + TEAM_STATE_AUTO_OPEN.length, closeIdx).trim();

  // Cap at 8 KB so a runaway regenerator never blows the prompt budget.
  if (Buffer.byteLength(block, "utf8") > TEAM_STATE_MAX_BYTES) {
    // Slice by bytes via Buffer to avoid splitting a multi-byte char.
    const buf = Buffer.from(block, "utf8");
    block = buf.slice(0, TEAM_STATE_MAX_BYTES).toString("utf8") + "\n… [truncated]";
  }
  return block;
}

export async function loadActiveClaimsBlock(
  currentDispatchId: number,
): Promise<string> {
  let claims: Awaited<ReturnType<typeof listActiveClaims>>;
  try {
    claims = await listActiveClaims();
  } catch (err) {
    logger.warn(
      `[dispatchRunner] listActiveClaims failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return ACTIVE_CLAIMS_EMPTY;
  }

  // Exclude the row that belongs to the about-to-run dispatch — telling an
  // agent to avoid its own authorized surfaces would be incoherent.
  const others = claims.filter(
    (c) => c.dispatchId !== currentDispatchId,
  );
  if (others.length === 0) return ACTIVE_CLAIMS_EMPTY;

  const now = Date.now();
  const lines: string[] = [];
  for (const c of others) {
    const ageSec = Math.max(0, Math.round((now - c.claimedAt.getTime()) / 1000));
    const patterns = (c.fileSurfacePatterns ?? []).join(", ");
    const dispatchPart =
      c.dispatchId !== null && c.dispatchId !== undefined
        ? `dispatch #${c.dispatchId}`
        : "ad-hoc dispatch";
    lines.push(
      `- **${c.agentRole}** (${dispatchPart}, claimed ${ageSec}s ago, ttl ${c.ttlMinutes}min): ${patterns}`,
    );
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// System prompt composition
// ----------------------------------------------------------------------------

/**
 * Structured system-prompt output used at the Anthropic call site so prompt
 * caching can mark the long, stable prefix as cache_control:'ephemeral'.
 *
 * staticPrefix carries everything that does NOT change per dispatch:
 *   team-state, active-claims, identity, failure-modes, the autonomous-
 *   dispatch preamble itself, the always-on hard-rules + operating-discipline
 *   bullets, and the role brief. These are reused turn-after-turn within a
 *   single dispatch (5-min TTL is enough for every turn of a 10-min run) and
 *   often reused across back-to-back dispatches for the same role inside the
 *   5-min window. Even a single dispatch with 10 turns recovers ~9×
 *   (cached - normal) input cost.
 *
 * dynamicSuffix carries the per-dispatch context: dollar cap, time cap, turn
 * cap, dispatch id. Tiny — well under 1 KB. Not cached because it varies.
 */
export interface SystemPromptParts {
  staticPrefix: string;
  dynamicSuffix: string;
}

export async function buildSystemPromptParts(
  brief: string,
  role: SoleneDispatchAgentRole,
  dispatchId: number,
  maxCostUsd: number,
  timeoutMs: number,
): Promise<SystemPromptParts> {
  // Resolve preambles in parallel — all five are I/O bound and independent.
  // Order in the rendered prompt:
  //   team-state → active-claims → identity (L1.4) → failure-modes (L3.12)
  //     → retrieved lessons (L3.11 learning loop) → hard-rules → role brief.
  // plannedFiles is unavailable at this layer (the model decides what to
  // touch via tool_use mid-turn), so the failure-mode preamble falls back
  // to the top-3 critical/high modes for every dispatch.
  // retrieveCrossNamespaceMemories never throws by contract, but the .catch
  // keeps prompt assembly alive even if that contract regresses — a missed
  // lesson must never block a dispatch. Cross-namespace (Jarvis 2.4, G4 fix):
  // dispatched agents see founder rulings, past decisions, and audit findings
  // alongside feedback corrections — not just the feedback_memory silo.
  // Platform scope (no organizationId): dispatches are Level-1 work per
  // docs/company/three-level-boundary.md.
  const [
    teamStatePreamble,
    activeClaimsBlock,
    identityBlock,
    failureModeBlock,
    retrievedLessons,
  ] = await Promise.all([
    loadTeamStatePreamble(),
    loadActiveClaimsBlock(dispatchId),
    loadAgentIdentityBlock(role),
    loadFailureModePreambleFor(role, undefined),
    retrieveCrossNamespaceMemories({
      queryText: brief,
      queryingAgentRole: role,
      queryDispatchId: dispatchId,
    })
      .then((r) => r.retrieved)
      .catch(() => []),
  ]);

  const retrievedLessonsBlock =
    buildMultiNamespacePromptBlock(retrievedLessons) ||
    "_No relevant past lessons, rulings, or decisions retrieved for this task._";

  const staticPrefix = [
    "# Team-state preamble (auto-generated, 15-min refresh)",
    "",
    teamStatePreamble,
    "",
    "# Active agent claims — DO NOT TOUCH files matching these patterns",
    "",
    activeClaimsBlock,
    "",
    "# Persistent agent identity — your prior decisions on record",
    "",
    identityBlock,
    "",
    "# Failure-mode library — patterns to avoid",
    "",
    failureModeBlock,
    "",
    // buildMultiNamespacePromptBlock emits its own "# Relevant historical
    // context" header + per-namespace subsections; the fallback line below
    // needs the header supplied here.
    retrievedLessonsBlock.startsWith("#")
      ? retrievedLessonsBlock
      : `# Relevant historical context (memory RAG)\n\n${retrievedLessonsBlock}`,
    "",
    "# Solene autonomous-dispatch mode",
    "",
    `You are operating as ${role} in Solene's autonomous-dispatch mode — the worker`,
    "process running on AcreOS infrastructure invoked you via the Anthropic API.",
    "There is no human in the loop until you finish or escalate.",
    "",
    "## Hard rules",
    "",
    `- Max turns: ${DISPATCH_MAX_TURNS}.`,
    "- NEVER push to origin. Local commits only. Tom reviews and pushes.",
    "- NEVER run destructive git ops (reset --hard, force push, branch -D) without the `bash` tool's normal flow — there is no special path.",
    "- NEVER write the ANTHROPIC_API_KEY value, or any other credential value, into stdout or any file. Verify by length or hash only.",
    "- NEVER touch frozen surfaces: server/services/pax/*, client/src/pages/tools/*, client/src/pages/learn/*, content/learn/*, the Reg Z surface, or server/middleware/{authPathLimits,expensiveEndpointGuard,botSignals,sanctionsList,getOrCreateOrg}.ts.",
    "",
    "## Operating discipline",
    "",
    "- Engineering standards from CLAUDE.md apply: AuthenticatedRequest, Errors.*, structured logger, migrations mirrored in scripts/migrate.mjs.",
    "- Before mutating: run git_status to capture pre-state.",
    "- Before declaring done: run `npm run check` via bash; if it errors, fix the type error, don't `as any` it.",
    "- Finish with a single end_turn assistant message summarizing what shipped + commit SHA(s) + file:line citations.",
    "",
    "## Your role brief",
    "",
    brief,
  ].join("\n");

  const dynamicSuffix = [
    "## Per-dispatch envelope",
    "",
    `- Cost cap: $${maxCostUsd.toFixed(2)}. Exceed this and you will be killed mid-turn.`,
    `- Time cap: ${Math.round(timeoutMs / 1000)}s wall-clock. Same kill rule.`,
    `- Dispatch id: ${dispatchId}.`,
  ].join("\n");

  return { staticPrefix, dynamicSuffix };
}

/**
 * Back-compat wrapper — returns the concatenated single-string system prompt
 * (static prefix + blank line + dynamic suffix). Used by the transcript
 * analytics code below (which greps the assembled prompt for block headers)
 * and by the prompt-builder test suite. The Anthropic call site uses
 * buildSystemPromptParts() directly so it can apply cache_control to the
 * static prefix.
 */
export async function buildSystemPrompt(
  brief: string,
  role: SoleneDispatchAgentRole,
  dispatchId: number,
  maxCostUsd: number,
  timeoutMs: number,
): Promise<string> {
  const { staticPrefix, dynamicSuffix } = await buildSystemPromptParts(
    brief,
    role,
    dispatchId,
    maxCostUsd,
    timeoutMs,
  );
  return `${staticPrefix}\n\n${dynamicSuffix}`;
}

// ----------------------------------------------------------------------------
// Cost estimation (running, used by the cap check between turns)
// ----------------------------------------------------------------------------

/**
 * Cost estimation with prompt-cache awareness.
 *
 * tokensIn:       count of NEW (non-cached) input tokens — i.e.
 *                 response.usage.input_tokens (Anthropic excludes cache reads
 *                 from this number).
 * tokensCached:   count of cache_read_input_tokens — billed at ~10% of
 *                 the normal input rate.
 * tokensOut:      response.usage.output_tokens.
 *
 * Model determines which pricing row applies. Unknown models fall back to
 * Sonnet rates (see pricingFor()).
 */
function estimateCostUsd(
  tokensIn: number,
  tokensOut: number,
  tokensCached: number = 0,
  model: string = DEFAULT_MODEL,
): number {
  const p = pricingFor(model);
  return (
    (tokensIn / 1_000_000) * p.input +
    (tokensCached / 1_000_000) * p.cachedInput +
    (tokensOut / 1_000_000) * p.output
  );
}

// ----------------------------------------------------------------------------
// Transcript persistence (JSONL — one event per line)
// ----------------------------------------------------------------------------

async function ensureTranscriptDir(): Promise<void> {
  await fs.mkdir(TRANSCRIPT_DIR, { recursive: true });
}

function transcriptPathFor(id: number): string {
  return path.join(TRANSCRIPT_DIR, `${id}.jsonl`);
}

async function appendTranscript(
  filePath: string,
  event: Record<string, unknown>,
): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  await fs.appendFile(filePath, line, "utf8");
}

// ----------------------------------------------------------------------------
// Main entrypoint
// ----------------------------------------------------------------------------

export interface RunDispatchResult {
  dispatchId: number;
  success: boolean;
  costUsd: number;
  tokenInput: number;
  tokenOutput: number;
  durationMs: number;
  finalText: string;
  filesModified: string[];
  commitsReferenced: string[];
  transcriptPath: string | null;
  terminationReason:
    | "end_turn"
    | "max_turns"
    | "cost_cap"
    | "timeout"
    | "error"
    | "missing_api_key"
    | "platform_cost_ceiling"
    | "ensemble_monthly_cap";
}

/**
 * Run a single claimed dispatch end-to-end. Caller (worker loop) is
 * responsible for claiming the row via claimNextDispatch before calling this.
 */
export async function runDispatch(
  row: SoleneDispatchQueueRow,
): Promise<RunDispatchResult> {
  const started = Date.now();
  const dispatchId = row.id;
  const maxCostUsd = Number(row.maxCostUsd);
  const timeoutMs = row.timeoutMs;
  // Horizon A5 — STRUCTURAL read-only for audit/verification lanes (verify +
  // self_audit_drift). Derived from the queue row's sourceType and threaded
  // to BOTH the toolset (the model never sees a mutating tool) and the
  // executor (which rejects one fail-closed anyway). Closes the CP2
  // comment-only "read-only" gap.
  const readOnly = isReadOnlyDispatchSourceType(row.sourceType);

  await ensureTranscriptDir();
  const transcriptPath = transcriptPathFor(dispatchId);

  // selectedModel is computed below (after the brief loads, which is where
  // we have the assembled row context). For the start event we log the
  // default-tier model the dispatcher is *defaulting* to; the actual model
  // used appears in turn_request events and the complete event.
  await appendTranscript(transcriptPath, {
    event: "start",
    dispatchId,
    agentRole: row.agentRole,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    maxCostUsd,
    timeoutMs,
    defaultModel: DEFAULT_MODEL,
  });

  // Pre-dispatch ensemble cap (runtime backstop) — the binding monthly bound
  // on agent_dispatch spend. enqueueDispatch already gates this at enqueue
  // time, but a row may have been queued before the cap was crossed, so we
  // re-check at run time. Fails CLOSED both when the cap is exceeded AND when
  // MTD spend can't be read (ENSEMBLE_CAP_READ_FAILED) — refuse rather than
  // risk unbounding the largest cash cost. Founder per-dispatch overrides are
  // applied at enqueue, not here. (re-audit iteration 2: the read-error path
  // used to fall through and PROCEED — now it refuses, matching this comment.)
  try {
    const { assertWithinEnsembleCap } = await import("./capitalTracker");
    await assertWithinEnsembleCap();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENSEMBLE_MONTHLY_CAP_EXCEEDED" || code === "ENSEMBLE_CAP_READ_FAILED") {
      const msg =
        code === "ENSEMBLE_CAP_READ_FAILED"
          ? "ensemble cap unverifiable (spend unreadable); failing closed — refusing dispatch"
          : "ensemble monthly cap reached; refusing dispatch";
      logger.warn(`[dispatchRunner] ${msg}`, {
        metadata: {
          dispatchId,
          detail: err instanceof Error ? err.message : String(err),
        },
      });
      await appendTranscript(transcriptPath, { event: "rejected", reason: msg });
      try {
        // Retry classification: a cap READ failure is a telemetry blip that
        // happened before any model call or tool ran — safe to requeue with
        // backoff. Cap EXCEEDED is a real monthly bound — terminal.
        await failDispatch(
          dispatchId,
          {
            errorMessage: msg,
            resultFullPath: transcriptPath,
          },
          { transient: code === "ENSEMBLE_CAP_READ_FAILED" },
        );
      } catch (failErr) {
        logger.warn(
          `[dispatchRunner] failDispatch after ensemble cap swallow id=${dispatchId}: ${failErr instanceof Error ? failErr.message : String(failErr)}`,
        );
      }
      return {
        dispatchId,
        success: false,
        costUsd: 0,
        tokenInput: 0,
        tokenOutput: 0,
        durationMs: Date.now() - started,
        finalText: msg,
        filesModified: [],
        commitsReferenced: [],
        transcriptPath,
        terminationReason: "ensemble_monthly_cap",
      };
    }
    // Any non-cap error from the gate: log and proceed (the platform ceiling
    // below is the next line of defense).
    logger.warn(
      `[dispatchRunner] ensemble cap check errored non-fatally id=${dispatchId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Platform-wide cost ceiling gate — refuse the dispatch if the rolling
  // 24h spend is already at-or-over AI_PLATFORM_DAILY_CEILING_CENTS
  // (default $15/day). Same backstop as the chat path; without it a single
  // dispatch can spend $25 (the per-dispatch cap) regardless of total
  // daily burn. failClosed: an autonomous caller refuses on a telemetry-read
  // outage rather than unbounding spend (re-audit it.3) — a refused dispatch
  // is fully recoverable.
  try {
    const { assertWithinAiCostCeiling } = await import("../aiCostCeiling");
    await assertWithinAiCostCeiling(null, { failClosed: true });
  } catch (err) {
    if ((err as { code?: string })?.code === "AI_COST_CEILING_EXCEEDED") {
      const msg = "platform AI cost ceiling reached; refusing dispatch";
      logger.warn(`[dispatchRunner] ${msg}`, { metadata: { dispatchId } });
      await appendTranscript(transcriptPath, { event: "rejected", reason: msg });
      return {
        dispatchId,
        success: false,
        costUsd: 0,
        tokenInput: 0,
        tokenOutput: 0,
        durationMs: Date.now() - started,
        finalText: msg,
        filesModified: [],
        commitsReferenced: [],
        transcriptPath,
        terminationReason: "platform_cost_ceiling",
      };
    }
  }

  // Credential check — never logs the value.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    const msg = "ANTHROPIC_API_KEY is not set; cannot run dispatch";
    logger.error(`[dispatchRunner] ${msg}`);
    await appendTranscript(transcriptPath, { event: "abort", reason: "missing_api_key" });
    await failDispatch(dispatchId, {
      errorMessage: msg,
      resultFullPath: transcriptPath,
    });
    return makeResult(dispatchId, false, 0, 0, 0, started, "", [], [], transcriptPath, "missing_api_key");
  }
  logger.info(
    `[dispatchRunner] starting dispatch id=${dispatchId} role=${row.agentRole} keyLen=${apiKey.length}`,
  );

  const client = new Anthropic({ apiKey });

  const { brief, source: briefSource } = await loadAgentBrief(
    row.agentRole as SoleneDispatchAgentRole,
  );
  // 2026-06-05 cost audit (batch 5): build the system prompt in two pieces
  // so we can mark the long static prefix as cache_control:'ephemeral' on
  // the Anthropic call. The joined `systemPrompt` is retained for the
  // transcript-analytics greps below (which find block headers); the parts
  // feed the cached system-prompt array at the call site.
  const systemPromptParts = await buildSystemPromptParts(
    brief,
    row.agentRole as SoleneDispatchAgentRole,
    dispatchId,
    maxCostUsd,
    timeoutMs,
  );
  const systemPrompt = `${systemPromptParts.staticPrefix}\n\n${systemPromptParts.dynamicSuffix}`;

  // Per-role model tier (batch 5). Sonnet by default; Opus only for
  // strategic / architecture / escalation paths. row.model wins if pinned.
  const selectedModel = selectModelForDispatch({
    agentRole: row.agentRole,
    sourceType: row.sourceType,
    model: row.model,
  });
  // Compute injected ensemble-context sizes for post-hoc transcript analysis.
  // These are derived from the assembled prompt, not by re-running the
  // loaders, so the numbers match exactly what the model saw.
  const teamStatePreambleBytes = (() => {
    const open = systemPrompt.indexOf("# Team-state preamble");
    const closeMarker = "# Active agent claims";
    const close = systemPrompt.indexOf(closeMarker);
    if (open === -1 || close === -1 || close <= open) return 0;
    return Buffer.byteLength(systemPrompt.slice(open, close), "utf8");
  })();
  const activeClaimsCount = (() => {
    const blockOpen = systemPrompt.indexOf(
      "# Active agent claims — DO NOT TOUCH files matching these patterns",
    );
    const blockClose = systemPrompt.indexOf(
      "# Persistent agent identity — your prior decisions on record",
    );
    if (blockOpen === -1 || blockClose === -1) return 0;
    const block = systemPrompt.slice(blockOpen, blockClose);
    // Count rendered claim rows — lines starting with "- **".
    return block.split("\n").filter((l) => l.startsWith("- **")).length;
  })();
  const identityDecisionsCount = (() => {
    const blockOpen = systemPrompt.indexOf(
      "# Persistent agent identity — your prior decisions on record",
    );
    const blockClose = systemPrompt.indexOf(
      "# Failure-mode library — patterns to avoid",
    );
    if (blockOpen === -1 || blockClose === -1) return 0;
    const block = systemPrompt.slice(blockOpen, blockClose);
    // Each decision renders as a `- **YYYY-MM-DD** (kind):` line.
    return block.split("\n").filter((l) => /^- \*\*\d{4}-\d{2}-\d{2}\*\*/.test(l)).length;
  })();
  const failureModesIncludedCount = (() => {
    const blockOpen = systemPrompt.indexOf(
      "# Failure-mode library — patterns to avoid",
    );
    // Matches both the real cross-namespace block header ("… (n=X)") and the
    // empty-retrieval fallback ("… (memory RAG)") — prefix match by indexOf.
    const blockClose = systemPrompt.indexOf(
      "# Relevant historical context",
    );
    if (blockOpen === -1 || blockClose === -1) return 0;
    const block = systemPrompt.slice(blockOpen, blockClose);
    // Each failure mode renders as a `### [SEV] title (slug)` heading.
    return block.split("\n").filter((l) => /^### \[/.test(l)).length;
  })();
  await appendTranscript(transcriptPath, {
    event: "brief_loaded",
    source: briefSource,
    briefBytes: Buffer.byteLength(brief, "utf8"),
    teamStatePreambleBytes,
    activeClaimsCount,
    identityDecisionsCount,
    failureModesIncludedCount,
  });

  // ── conversation state ─────────────────────────────────────────────────
  type Msg = {
    role: "user" | "assistant";
    content: any;
  };
  const messages: Msg[] = [
    { role: "user", content: row.promptText },
  ];

  let tokenInput = 0;
  let tokenOutput = 0;
  // Cache-hit input tokens (Anthropic returns this as cache_read_input_tokens
  // when prompt caching is engaged). Billed at ~10% of standard input price
  // per MODEL_PRICING. Tracked separately so the capital tracker reflects
  // the actual cost shape — input bills + cached-input bills, not lumped.
  let tokenCached = 0;
  let finalText = "";
  const filesModified = new Set<string>();
  const commitsReferenced = new Set<string>();
  // Side-effect witness for the retry classifier: counts tool executions we
  // STARTED (incremented before executeDispatchTool, so a mid-tool crash still
  // registers). A dispatch that dies with this at 0 provably had no outward
  // effect and is safe to requeue; any other failure stays terminal.
  let toolCallsExecuted = 0;

  let terminationReason: RunDispatchResult["terminationReason"] = "error";
  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    logger.warn(`[dispatchRunner] dispatch ${dispatchId} timed out at ${timeoutMs}ms`);
  }, timeoutMs);

  // L6.28 — upstream constitutional pre-call check (Haiku-fast, fail-open).
  // Runs BEFORE the expensive Opus turn. If the dispatch prompt clearly
  // directs a violation of one of the 12 immutables, we fail the dispatch
  // here and skip the main model call entirely. The checker fails open on
  // any internal error (parse, timeout, throw) — never bricks the worker.
  const preCallResult = await checkPromptAgainstConstitution({
    agentRole: row.agentRole,
    promptText: row.promptText,
    dispatchId: dispatchId,
  }).catch((err) => {
    logger.warn(
      `[dispatchRunner] pre-call check threw — failing open`,
      err instanceof Error ? err : undefined,
    );
    return null;
  });

  if (preCallResult && preCallResult.allowed === false) {
    const msg = `Pre-call constitutional check blocked dispatch ${dispatchId}: immutable #${preCallResult.immutableNumber} — ${preCallResult.reasoning}`;
    logger.warn(`[dispatchRunner] ${msg}`);
    await appendTranscript(transcriptPath, {
      event: "blocked_by_precall_check",
      immutableNumber: preCallResult.immutableNumber,
      reasoning: preCallResult.reasoning,
    });
    await failDispatch(dispatchId, {
      errorMessage: msg,
      resultFullPath: transcriptPath,
    });
    clearTimeout(timeoutHandle);
    return makeResult(
      dispatchId,
      false,
      preCallResult.costUsd,
      0,
      0,
      started,
      msg,
      [],
      [],
      transcriptPath,
      "error",
    );
  }

  try {
    for (let turn = 0; turn < DISPATCH_MAX_TURNS; turn++) {
      if (timedOut) {
        terminationReason = "timeout";
        break;
      }
      const costSoFar = estimateCostUsd(
        tokenInput,
        tokenOutput,
        tokenCached,
        selectedModel,
      );
      if (costSoFar > maxCostUsd) {
        terminationReason = "cost_cap";
        await appendTranscript(transcriptPath, {
          event: "cost_cap_exceeded",
          costUsd: costSoFar,
          maxCostUsd,
          turn,
        });
        break;
      }

      await appendTranscript(transcriptPath, {
        event: "turn_request",
        turn,
        costSoFarUsd: costSoFar,
      });

      // Per-call timeout: remaining wall-clock budget.
      const remainingMs = Math.max(
        5000,
        timeoutMs - (Date.now() - started),
      );

      // 2026-06-05 cost audit (batch 5): system prompt is now a 2-block
      // array with cache_control:'ephemeral' on the long static prefix.
      // First call within a 5-min TTL is full-priced (and writes the cache);
      // every subsequent call hits cache_read at ~10% of input cost. A
      // 10-turn dispatch with a 30k-token prefix saves ~9× on prefix input.
      const cachedSystem = [
        {
          type: "text" as const,
          text: systemPromptParts.staticPrefix,
          cache_control: { type: "ephemeral" as const },
        },
        {
          type: "text" as const,
          text: systemPromptParts.dynamicSuffix,
        },
      ];
      const response = await client.messages.create(
        {
          model: selectedModel,
          max_tokens: 4096,
          system: cachedSystem as any,
          messages: messages as any,
          // Worker dispatches are untrusted → no free-form bash in the toolset.
          // Read-only lanes (verify / self_audit_drift) additionally lose
          // every mutating tool (Horizon A5 — structural, not prompt-level).
          tools: getDispatchToolSchemas({ untrusted: true, readOnly }) as any,
        },
        { timeout: remainingMs },
      );

      tokenInput += response.usage?.input_tokens ?? 0;
      tokenOutput += response.usage?.output_tokens ?? 0;
      // Prompt-cache read tokens — billed at the cached input rate. Anthropic
      // returns these as `cache_read_input_tokens` on the usage object; the
      // SDK types may not surface that field as strict-typed yet so we
      // read it via index access and Number().
      const cacheReadRaw = (response.usage as unknown as Record<string, unknown> | undefined)?.[
        "cache_read_input_tokens"
      ];
      const cacheRead = typeof cacheReadRaw === "number" ? cacheReadRaw : 0;
      tokenCached += cacheRead;
      await appendTranscript(transcriptPath, {
        event: "turn_response",
        turn,
        stopReason: response.stop_reason,
        usage: response.usage,
        cacheReadTokens: cacheRead,
        model: selectedModel,
        contentBlocks: response.content.length,
      });

      // Extract any assistant text + any tool uses.
      const toolUses: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
      }> = [];
      let textChunk = "";
      for (const block of response.content) {
        if (block.type === "text") {
          textChunk += block.text;
        } else if (block.type === "tool_use") {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      if (textChunk) finalText = textChunk;

      // Push assistant turn back into history.
      messages.push({
        role: "assistant",
        content: response.content,
      });

      if (response.stop_reason === "end_turn" && toolUses.length === 0) {
        terminationReason = "end_turn";
        break;
      }

      if (toolUses.length === 0) {
        // No tools requested + not end_turn → break to avoid infinite loop.
        terminationReason = response.stop_reason === "max_tokens" ? "max_turns" : "end_turn";
        break;
      }

      // Execute each tool, build a tool_result message.
      const toolResults: any[] = [];
      for (const tu of toolUses) {
        if (timedOut) break;
        // SECURITY (elite-audit P0): worker-run dispatches are autonomous agents —
        // their bash runs with a SECRET-SCRUBBED env (no prod creds), so they
        // cannot deploy / exfiltrate / move money outside the witnessed-send hands.
        toolCallsExecuted++;
        const exec = await executeDispatchTool(tu.name, tu.input, {
          dispatchId,
          agentRole: row.agentRole,
          untrusted: true,
          // Horizon A5 — executor-level fail-closed rejection of mutating
          // tools for read-only lanes, even if the model hallucinates one.
          readOnly,
        });
        await appendTranscript(transcriptPath, {
          event: "tool_use",
          turn,
          tool: tu.name,
          success: exec.success,
          durationMs: exec.durationMs,
          outputBytes: exec.output.length,
          truncated: exec.truncated ?? false,
        });
        if (exec.filesModified) {
          for (const f of exec.filesModified) filesModified.add(f);
        }
        if (exec.commitSha) commitsReferenced.add(exec.commitSha);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: exec.output.slice(0, 20_000),
          is_error: !exec.success,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    if (terminationReason === "error") terminationReason = "max_turns";
  } catch (err) {
    terminationReason = "error";
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[dispatchRunner] dispatch ${dispatchId} threw: ${msg}`,
      err instanceof Error ? err : undefined,
    );
    await appendTranscript(transcriptPath, { event: "error", message: msg });
  } finally {
    clearTimeout(timeoutHandle);
  }

  const durationMs = Date.now() - started;
  const costUsd = estimateCostUsd(
    tokenInput,
    tokenOutput,
    tokenCached,
    selectedModel,
  );
  const success =
    terminationReason === "end_turn" && finalText.length > 0;

  await appendTranscript(transcriptPath, {
    event: "complete",
    success,
    terminationReason,
    durationMs,
    tokenInput,
    tokenOutput,
    tokenCached,
    model: selectedModel,
    costUsd,
    filesModified: Array.from(filesModified),
    commitsReferenced: Array.from(commitsReferenced),
  });

  // Persist to capital tracker — REAL spend, not theater.
  try {
    await recordCapitalEvent(
      "agent_dispatch",
      costUsd,
      `dispatch:${dispatchId} role=${row.agentRole} source=${row.sourceType}:${row.sourceId} reason=${terminationReason}`,
    );
  } catch (err) {
    logger.warn(
      `[dispatchRunner] recordCapitalEvent swallow id=${dispatchId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Persist queue/result rows.
  try {
    if (success) {
      await completeDispatch(dispatchId, {
        costUsd,
        durationMs,
        tokenInput,
        tokenOutput,
        resultSummary: finalText.slice(0, 4000),
        resultFullPath: transcriptPath,
        commitsReferenced: Array.from(commitsReferenced),
        filesModified: Array.from(filesModified),
      });
    } else {
      const failureInput: DispatchFailureInput = {
        errorMessage: `terminated: ${terminationReason}${finalText ? ` — ${finalText.slice(0, 1500)}` : ""}`,
        costUsd,
        durationMs,
        tokenInput,
        tokenOutput,
        resultFullPath: transcriptPath,
        commitsReferenced: Array.from(commitsReferenced),
        filesModified: Array.from(filesModified),
      };
      const cancelStatus =
        terminationReason === "timeout" || terminationReason === "cost_cap"
          ? "cancelled"
          : "failed";
      // Retry classification: only a thrown error with ZERO tool executions is
      // provably side-effect-free (a provider blip before any work happened) —
      // safe to requeue with backoff. Timeouts, cost caps, max-turns, and any
      // failure after a tool ran stay terminal: the original at-most-once
      // stance for outward effects.
      const transient = terminationReason === "error" && toolCallsExecuted === 0;
      await failDispatch(dispatchId, failureInput, { status: cancelStatus, transient });
    }
  } catch (err) {
    logger.error(
      `[dispatchRunner] persistence failed for dispatch ${dispatchId}`,
      err instanceof Error ? err : undefined,
    );
  }

  return makeResult(
    dispatchId,
    success,
    costUsd,
    tokenInput,
    tokenOutput,
    started,
    finalText,
    Array.from(filesModified),
    Array.from(commitsReferenced),
    transcriptPath,
    terminationReason,
  );
}

function makeResult(
  dispatchId: number,
  success: boolean,
  costUsd: number,
  tokenInput: number,
  tokenOutput: number,
  started: number,
  finalText: string,
  filesModified: string[],
  commitsReferenced: string[],
  transcriptPath: string | null,
  terminationReason: RunDispatchResult["terminationReason"],
): RunDispatchResult {
  return {
    dispatchId,
    success,
    costUsd,
    tokenInput,
    tokenOutput,
    durationMs: Date.now() - started,
    finalText,
    filesModified,
    commitsReferenced,
    transcriptPath,
    terminationReason,
  };
}
