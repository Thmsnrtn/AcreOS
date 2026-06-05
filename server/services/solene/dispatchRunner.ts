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
import { DISPATCH_MAX_TURNS } from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";
import { listActiveClaims } from "./agentClaims";
import { loadAgentIdentityBlock } from "./agentIdentity";
import { loadFailureModePreambleFor } from "./failureModeLibrary";
import { recordCapitalEvent } from "./capitalTracker";
import {
  completeDispatch,
  failDispatch,
  type DispatchFailureInput,
} from "./dispatchQueue";
import {
  DISPATCH_TOOL_SCHEMAS,
  executeDispatchTool,
} from "./dispatchToolExecutor";
import { checkPromptAgainstConstitution } from "./preCallConstitutionalChecker";

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

const DEFAULT_MODEL =
  process.env.SOLENE_DISPATCH_MODEL ?? "claude-opus-4-7";
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

// Per-1M-token pricing for Opus 4.7. Reads from env to allow Beatrice's
// regwatch to update without a code deploy when Anthropic adjusts pricing.
const PRICE_INPUT_PER_M = Number(
  process.env.SOLENE_DISPATCH_PRICE_INPUT_PER_M ?? "15",
);
const PRICE_OUTPUT_PER_M = Number(
  process.env.SOLENE_DISPATCH_PRICE_OUTPUT_PER_M ?? "75",
);

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

export async function buildSystemPrompt(
  brief: string,
  role: SoleneDispatchAgentRole,
  dispatchId: number,
  maxCostUsd: number,
  timeoutMs: number,
): Promise<string> {
  // Resolve preambles in parallel — all four are I/O bound and independent.
  // Order in the rendered prompt:
  //   team-state → active-claims → identity (L1.4) → failure-modes (L3.12)
  //     → hard-rules → role brief.
  // plannedFiles is unavailable at this layer (the model decides what to
  // touch via tool_use mid-turn), so the failure-mode preamble falls back
  // to the top-3 critical/high modes for every dispatch.
  const [teamStatePreamble, activeClaimsBlock, identityBlock, failureModeBlock] =
    await Promise.all([
      loadTeamStatePreamble(),
      loadActiveClaimsBlock(dispatchId),
      loadAgentIdentityBlock(role),
      loadFailureModePreambleFor(role, undefined),
    ]);

  return [
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
    "# Solene autonomous-dispatch mode",
    "",
    `You are operating as ${role} in Solene's autonomous-dispatch mode — the worker`,
    "process running on AcreOS infrastructure invoked you via the Anthropic API.",
    "There is no human in the loop until you finish or escalate.",
    "",
    "## Hard rules",
    "",
    `- Cost cap: $${maxCostUsd.toFixed(2)}. Exceed this and you will be killed mid-turn.`,
    `- Time cap: ${Math.round(timeoutMs / 1000)}s wall-clock. Same kill rule.`,
    `- Max turns: ${DISPATCH_MAX_TURNS}.`,
    `- Dispatch id: ${dispatchId}.`,
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
}

// ----------------------------------------------------------------------------
// Cost estimation (running, used by the cap check between turns)
// ----------------------------------------------------------------------------

function estimateCostUsd(tokensIn: number, tokensOut: number): number {
  return (
    (tokensIn / 1_000_000) * PRICE_INPUT_PER_M +
    (tokensOut / 1_000_000) * PRICE_OUTPUT_PER_M
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
    | "platform_cost_ceiling";
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

  await ensureTranscriptDir();
  const transcriptPath = transcriptPathFor(dispatchId);

  await appendTranscript(transcriptPath, {
    event: "start",
    dispatchId,
    agentRole: row.agentRole,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    maxCostUsd,
    timeoutMs,
    model: DEFAULT_MODEL,
  });

  // Platform-wide cost ceiling gate — refuse the dispatch if the rolling
  // 24h spend is already at-or-over AI_PLATFORM_DAILY_CEILING_CENTS
  // (default $5/day). Same backstop as the chat path; without it a single
  // dispatch can spend $25 (the per-dispatch cap) regardless of total
  // daily burn. Fail-open on transient DB errors.
  try {
    const { assertWithinAiCostCeiling } = await import("../aiCostCeiling");
    await assertWithinAiCostCeiling(null);
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
  const systemPrompt = await buildSystemPrompt(
    brief,
    row.agentRole as SoleneDispatchAgentRole,
    dispatchId,
    maxCostUsd,
    timeoutMs,
  );
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
    const blockClose = systemPrompt.indexOf(
      "# Solene autonomous-dispatch mode",
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
  let finalText = "";
  const filesModified = new Set<string>();
  const commitsReferenced = new Set<string>();

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
      const costSoFar = estimateCostUsd(tokenInput, tokenOutput);
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

      const response = await client.messages.create(
        {
          model: DEFAULT_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages as any,
          tools: DISPATCH_TOOL_SCHEMAS as any,
        },
        { timeout: remainingMs },
      );

      tokenInput += response.usage?.input_tokens ?? 0;
      tokenOutput += response.usage?.output_tokens ?? 0;
      await appendTranscript(transcriptPath, {
        event: "turn_response",
        turn,
        stopReason: response.stop_reason,
        usage: response.usage,
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
        const exec = await executeDispatchTool(tu.name, tu.input);
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
  const costUsd = estimateCostUsd(tokenInput, tokenOutput);
  const success =
    terminationReason === "end_turn" && finalText.length > 0;

  await appendTranscript(transcriptPath, {
    event: "complete",
    success,
    terminationReason,
    durationMs,
    tokenInput,
    tokenOutput,
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
      await failDispatch(dispatchId, failureInput, { status: cancelStatus });
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
