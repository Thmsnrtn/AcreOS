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
// System prompt composition
// ----------------------------------------------------------------------------

function buildSystemPrompt(
  brief: string,
  role: SoleneDispatchAgentRole,
  dispatchId: number,
  maxCostUsd: number,
  timeoutMs: number,
): string {
  return [
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
    | "missing_api_key";
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
  const systemPrompt = buildSystemPrompt(
    brief,
    row.agentRole as SoleneDispatchAgentRole,
    dispatchId,
    maxCostUsd,
    timeoutMs,
  );
  await appendTranscript(transcriptPath, {
    event: "brief_loaded",
    source: briefSource,
    briefBytes: Buffer.byteLength(brief, "utf8"),
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
