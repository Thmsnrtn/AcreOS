/**
 * SOLENE DISPATCH — minimal tool executor for the worker loop.
 *
 * Today's session-based dispatches (this Claude Code conversation) use
 * Claude Code's built-in tool infrastructure. The worker process has none
 * of that. This module is the minimum-viable tool executor the worker
 * uses when invoking the Anthropic SDK directly.
 *
 * Supported tools:
 *   - file_read  (path: string, encoding?: string)
 *   - file_write (path: string, content: string)
 *   - file_list  (path: string)
 *   - bash       (command: string, timeout_ms?: number)  — no shell exec; uses
 *                  bash -lc with a wall-clock timeout.
 *   - git_status ()
 *   - git_diff   (path?: string, staged?: boolean)
 *   - git_commit (message: string, files?: string[])
 *
 * HONEST GAP LIST (what this executor INTENTIONALLY does NOT support):
 *   - No `git push` — pushing to origin from the worker is gated behind
 *     founder approval; dispatched agents leave commits local for review.
 *   - No network access tools beyond what bash can do (no curl helper,
 *     no fetch helper). Bash can still curl; the cost-cap + turn limit
 *     bounds runaway behavior.
 *   - No interactive shell — no stdin write after spawn. Tools that need
 *     interactive prompts will fail; agents must use non-interactive
 *     flags (--yes, --no-edit, etc.).
 *   - No sudo. The worker user cannot escalate.
 *   - No filesystem ops outside the repo root (CWD); paths are resolved
 *     relative to CWD and rejected if they escape via `..`.
 *
 * Safety:
 *   - Every bash run gets a wall-clock timeout (default 60s, max 5m).
 *   - File paths are normalized + must stay inside the project root.
 *   - bash stdout/stderr capped at 50 KB each; truncation noted in result.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { screenToolCall } from "./constitutionalGuard";
import { sendAgentMessage, readInbox } from "./agentMessages";
import { recordAgentDecision } from "./agentIdentity";
import { addTraceStep } from "./decisionTraces";
import { recordCounterfactual } from "./counterfactuals";
import { createSpeculation, findMatchingSpeculations } from "./speculations";
import { assessEvidence } from "./evidenceWeights";
import { proposeCapability } from "./capabilityDiscovery";
import {
  DISPATCH_AGENT_ROLES,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { AGENT_MESSAGE_PRIORITIES } from "@shared/schema/solene-agent-messages";
import { IDENTITY_DECISION_KINDS } from "@shared/schema/solene-agent-identity";
import { DECISION_TRACE_STEP_KINDS } from "@shared/schema/solene-decision-traces";
import { SPECULATION_OUTPUT_KINDS } from "@shared/schema/solene-speculations";
import { EVIDENCE_SOURCE_KINDS } from "@shared/schema/solene-evidence-weights";

const PROJECT_ROOT = process.env.SOLENE_DISPATCH_PROJECT_ROOT
  ? path.resolve(process.env.SOLENE_DISPATCH_PROJECT_ROOT)
  : process.cwd();

const BASH_DEFAULT_TIMEOUT_MS = 60_000;
const BASH_MAX_TIMEOUT_MS = 5 * 60_000;
const BASH_OUTPUT_BYTE_CAP = 50_000;
const FILE_READ_BYTE_CAP = 1_000_000; // 1 MB
const FILE_WRITE_BYTE_CAP = 1_000_000;

// ----------------------------------------------------------------------------
// Path safety: resolve inside the project root, reject escape attempts.
// ----------------------------------------------------------------------------

function resolveSafePath(p: string): string {
  const abs = path.resolve(PROJECT_ROOT, p);
  const rel = path.relative(PROJECT_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `path outside project root: ${p} (resolved=${abs} root=${PROJECT_ROOT})`,
    );
  }
  return abs;
}

// ----------------------------------------------------------------------------
// Tool schemas — passed to the Anthropic SDK as `tools` so the model knows
// what's available. Keep these JSON-schema-correct.
// ----------------------------------------------------------------------------

export const DISPATCH_TOOL_SCHEMAS = [
  {
    name: "file_read",
    description:
      "Read a file from the project tree. Path is relative to the project root. Returns up to 1MB of content.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to project root" },
        encoding: {
          type: "string",
          enum: ["utf8", "base64"],
          default: "utf8",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "file_write",
    description:
      "Write a file to the project tree. Path is relative to the project root. Overwrites existing content. Max 1MB.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to project root" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "file_list",
    description: "List entries in a directory (relative to project root).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "bash",
    description:
      "Run a shell command via `bash -lc`. CWD is the project root. Wall-clock timeout enforced. No interactive stdin. No sudo. Output capped at 50KB per stream.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: {
          type: "number",
          minimum: 1000,
          maximum: BASH_MAX_TIMEOUT_MS,
          default: BASH_DEFAULT_TIMEOUT_MS,
        },
      },
      required: ["command"],
    },
  },
  {
    name: "git_status",
    description: "Run `git status --short` and return the output.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "git_diff",
    description:
      "Show git diff. With staged=true shows the staged diff, otherwise unstaged. Optional path filter.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        staged: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "git_commit",
    description:
      "Stage the provided files (or `-A` if none given) and create a commit with the given message. Does NOT push.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", minLength: 1 },
        files: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["message"],
    },
  },
  // ──────────────────────────────────────────────────────────────────────────
  // L1.5 — dormant-service wire-ins. Each wraps a backend service shipped
  // earlier this week. agent_role + dispatch_id are auto-populated from the
  // executor context, so the model never has to know its own identity to
  // call these.
  // ──────────────────────────────────────────────────────────────────────────
  {
    name: "send_message_to_agent",
    description:
      "Send a direct message to another team member (iris / soren / beatrice / krieger / general-purpose / code-reviewer). They will see it on their next dispatch's inbox poll. Use for cross-functional asks where you need their domain depth without round-tripping through Solene.",
    input_schema: {
      type: "object",
      properties: {
        to_agent_role: {
          type: "string",
          enum: [...DISPATCH_AGENT_ROLES],
          description: "Recipient agent role.",
        },
        subject: {
          type: "string",
          maxLength: 200,
          description: "Short subject line (truncated to 200 chars if longer).",
        },
        body: { type: "string", description: "Full message body." },
        priority: {
          type: "string",
          enum: [...AGENT_MESSAGE_PRIORITIES],
          default: "normal",
        },
        in_reply_to_message_id: {
          type: "integer",
          description:
            "Optional. Continue an existing thread; correlation_id is inherited from the parent.",
        },
      },
      required: ["to_agent_role", "subject", "body"],
    },
  },
  {
    name: "read_agent_inbox",
    description:
      "Read your own (the current dispatched agent's) inbox of cross-agent messages, newest first. Use at dispatch start to see who's asked you for something since you last ran.",
    input_schema: {
      type: "object",
      properties: {
        unread_only: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        priority: {
          type: "string",
          enum: [...AGENT_MESSAGE_PRIORITIES],
          description: "Optional priority filter.",
        },
      },
    },
  },
  {
    name: "record_decision",
    description:
      "Record a load-bearing decision (architecture / bug_fix / policy / escalation / other) so future-you, on the next dispatch for this role, starts with this context already in your system prompt. Auto-tags the current agent_role + dispatch_id.",
    input_schema: {
      type: "object",
      properties: {
        decision_kind: {
          type: "string",
          enum: [...IDENTITY_DECISION_KINDS],
        },
        summary: { type: "string", maxLength: 500 },
        rationale: { type: "string" },
        referenced_files: { type: "array", items: { type: "string" } },
        evidence_url: { type: "string" },
      },
      required: ["decision_kind", "summary", "rationale"],
    },
  },
  {
    name: "record_decision_trace",
    description:
      "Append a fine-grain reasoning step (observation / hypothesis / evidence / alternative / choice / uncertainty) to a previously-recorded decision. Use to leave a trail of WHY you concluded what you concluded, for future-you and for adversarial review.",
    input_schema: {
      type: "object",
      properties: {
        decision_id: { type: "integer" },
        step_kind: {
          type: "string",
          enum: [...DECISION_TRACE_STEP_KINDS],
        },
        step_text: { type: "string" },
        evidence_refs: { type: "array", items: { type: "string" } },
        alternatives_considered: { type: "array", items: { type: "string" } },
        chosen_path_reason: { type: "string" },
        confidence_at_step: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["decision_id", "step_kind", "step_text"],
    },
  },
  {
    name: "record_counterfactual",
    description:
      "Record a counterfactual analysis of a past decision: what alternative path could have been taken, what would have happened, what's the lesson. Auto-tags your role as analyzing_agent_role.",
    input_schema: {
      type: "object",
      properties: {
        source_decision_id: { type: "integer" },
        alternative_path: { type: "string" },
        alternative_rationale: { type: "string" },
        predicted_outcome: { type: "string" },
        comparison_to_actual: { type: "string" },
        lesson_learned: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: [
        "source_decision_id",
        "alternative_path",
        "alternative_rationale",
        "predicted_outcome",
        "comparison_to_actual",
        "confidence",
      ],
    },
  },
  {
    name: "record_speculation",
    description:
      "Record a speculative output (code change / draft / artifact / analysis) that you anticipate Solene or another agent will need soon. If a future dispatch's predicted_need matches, they'll consume yours instead of redoing the work. Auto-tags your role as creator.",
    input_schema: {
      type: "object",
      properties: {
        triggered_by_signal: { type: "string" },
        predicted_need: { type: "string" },
        speculative_output: { type: "string" },
        output_kind: {
          type: "string",
          enum: [...SPECULATION_OUTPUT_KINDS],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        expires_in_days: { type: "integer", minimum: 1 },
        evidence_refs: { type: "array", items: { type: "string" } },
      },
      required: [
        "triggered_by_signal",
        "predicted_need",
        "speculative_output",
        "output_kind",
      ],
    },
  },
  {
    name: "find_matching_speculations",
    description:
      "Search active (status='speculated') prior outputs whose predicted_need matches your current query. Use BEFORE doing speculative work — if a sibling agent already drafted what you need, consume that instead.",
    input_schema: {
      type: "object",
      properties: {
        predicted_need_query: { type: "string" },
        output_kind: {
          type: "string",
          enum: [...SPECULATION_OUTPUT_KINDS],
        },
        min_confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["predicted_need_query"],
    },
  },
  {
    name: "assess_evidence",
    description:
      "Score a set of evidence items (regulation / case_law / internal_doc / live_data / secondary / expert_opinion) by source kind + authority tier + recency, pick the winning source, and persist the assessment. Use for compliance / legal / policy decisions where source quality varies.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string" },
        decision_id: { type: "integer" },
        evidence_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              source_kind: {
                type: "string",
                enum: [...EVIDENCE_SOURCE_KINDS],
              },
              source_ref: { type: "string" },
              claim: { type: "string" },
              recency: {
                type: "string",
                description: 'ISO date string OR the literal "unknown".',
              },
              authority_tier: {
                type: "integer",
                minimum: 1,
                maximum: 5,
              },
            },
            required: ["id", "source_kind", "source_ref", "claim", "authority_tier"],
          },
        },
        custom_weights: {
          type: "object",
          description:
            "Optional override map of evidence_id → weight (normalized). Skips the default scorer.",
          additionalProperties: { type: "number" },
        },
      },
      required: ["topic", "evidence_items"],
    },
  },
  {
    name: "propose_capability",
    description:
      "Propose a new tool you wish existed — the one that would have saved you N turns on this dispatch. Solene reviews proposals + decides whether to build. Auto-tags your role as proposing_agent_role.",
    input_schema: {
      type: "object",
      properties: {
        proposed_capability_name: {
          type: "string",
          description: "snake_case, 3-50 chars, starts with a letter.",
        },
        problem_statement: { type: "string" },
        proposed_tool_signature: { type: "string" },
        expected_value_usd: { type: "number", minimum: 0 },
        expected_invocations_per_week: { type: "integer", minimum: 0 },
        estimated_build_cost_usd: { type: "number", minimum: 0 },
        references_existing_tools: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "proposed_capability_name",
        "problem_statement",
        "proposed_tool_signature",
      ],
    },
  },
] as const;

export type DispatchToolName =
  (typeof DISPATCH_TOOL_SCHEMAS)[number]["name"];

// ----------------------------------------------------------------------------
// Tool executor — single entrypoint, switches on tool name.
// ----------------------------------------------------------------------------

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  truncated?: boolean;
  durationMs: number;
  /** When the tool modified files, list them (for the result row). */
  filesModified?: string[];
  /** When git_commit ran, the SHA (for the result row). */
  commitSha?: string;
}

/**
 * Constitutional context for the L6.29 guard. Optional so existing callers
 * (pre-L6.29 callsites that don't yet plumb dispatch identity) keep working;
 * when omitted, the guard still screens patterns but logs the violation with
 * dispatch_id=null and agent_role='unknown'.
 */
export interface DispatchToolContext {
  dispatchId?: number | null;
  agentRole?: string;
}

export async function executeDispatchTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: DispatchToolContext = {},
): Promise<ToolExecutionResult> {
  const started = Date.now();
  try {
    // L6.29 — constitutional self-defense at the tool-call layer.
    // screenToolCall is awaited BEFORE the underlying tool runs. If a
    // pattern rule blocks the call, the underlying tool is NOT invoked,
    // a violation row is written, and a page is fired.
    const screen = await screenToolCall({
      dispatchId: ctx.dispatchId ?? null,
      toolName,
      toolInput: input,
      agentRole: ctx.agentRole ?? "unknown",
    });
    if (!screen.allowed) {
      return {
        success: false,
        output:
          `[CONSTITUTIONAL REFUSAL] This tool call would violate ` +
          `immutable #${screen.immutableNumber}: "${screen.immutableText}". ` +
          `The call has been blocked, logged, and escalated to Solene. Refusing.`,
        durationMs: Date.now() - started,
      };
    }

    switch (toolName) {
      case "file_read":
        return await toolFileRead(input, started);
      case "file_write":
        return await toolFileWrite(input, started);
      case "file_list":
        return await toolFileList(input, started);
      case "bash":
        return await toolBash(input, started);
      case "git_status":
        return await toolGitStatus(started);
      case "git_diff":
        return await toolGitDiff(input, started);
      case "git_commit":
        return await toolGitCommit(input, started);
      // ──── L1.5 dormant-service wire-ins ────
      case "send_message_to_agent":
        return await toolSendMessageToAgent(input, ctx, started);
      case "read_agent_inbox":
        return await toolReadAgentInbox(input, ctx, started);
      case "record_decision":
        return await toolRecordDecision(input, ctx, started);
      case "record_decision_trace":
        return await toolRecordDecisionTrace(input, started);
      case "record_counterfactual":
        return await toolRecordCounterfactual(input, ctx, started);
      case "record_speculation":
        return await toolRecordSpeculation(input, ctx, started);
      case "find_matching_speculations":
        return await toolFindMatchingSpeculations(input, started);
      case "assess_evidence":
        return await toolAssessEvidence(input, ctx, started);
      case "propose_capability":
        return await toolProposeCapability(input, ctx, started);
      default:
        return {
          success: false,
          output: `unknown tool: ${toolName}`,
          durationMs: Date.now() - started,
        };
    }
  } catch (err) {
    return {
      success: false,
      output: `tool ${toolName} threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - started,
    };
  }
}

// ----------------------------------------------------------------------------
// Individual tool implementations.
// ----------------------------------------------------------------------------

async function toolFileRead(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const p = String(input.path ?? "");
  const enc = String(input.encoding ?? "utf8");
  if (!p) {
    return { success: false, output: "missing 'path'", durationMs: Date.now() - started };
  }
  const abs = resolveSafePath(p);
  const stat = await fs.stat(abs).catch((e) => {
    throw new Error(`stat failed: ${e.message}`);
  });
  if (stat.size > FILE_READ_BYTE_CAP) {
    return {
      success: false,
      output: `file too large: ${stat.size} > ${FILE_READ_BYTE_CAP} bytes`,
      durationMs: Date.now() - started,
    };
  }
  const buf = await fs.readFile(abs);
  const content = enc === "base64" ? buf.toString("base64") : buf.toString("utf8");
  return {
    success: true,
    output: content,
    durationMs: Date.now() - started,
  };
}

async function toolFileWrite(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const p = String(input.path ?? "");
  const content = String(input.content ?? "");
  if (!p) {
    return { success: false, output: "missing 'path'", durationMs: Date.now() - started };
  }
  if (Buffer.byteLength(content, "utf8") > FILE_WRITE_BYTE_CAP) {
    return {
      success: false,
      output: `content too large: > ${FILE_WRITE_BYTE_CAP} bytes`,
      durationMs: Date.now() - started,
    };
  }
  const abs = resolveSafePath(p);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return {
    success: true,
    output: `wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path.relative(PROJECT_ROOT, abs)}`,
    durationMs: Date.now() - started,
    filesModified: [path.relative(PROJECT_ROOT, abs)],
  };
}

async function toolFileList(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const p = String(input.path ?? ".");
  const abs = resolveSafePath(p);
  const entries = await fs.readdir(abs, { withFileTypes: true });
  const lines = entries.map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`);
  return {
    success: true,
    output: lines.join("\n"),
    durationMs: Date.now() - started,
  };
}

async function toolBash(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const cmd = String(input.command ?? "");
  if (!cmd.trim()) {
    return { success: false, output: "missing 'command'", durationMs: Date.now() - started };
  }
  const rawTimeout = Number(input.timeout_ms ?? BASH_DEFAULT_TIMEOUT_MS);
  const timeoutMs = Math.min(
    BASH_MAX_TIMEOUT_MS,
    Math.max(1000, Number.isFinite(rawTimeout) ? rawTimeout : BASH_DEFAULT_TIMEOUT_MS),
  );

  return await new Promise<ToolExecutionResult>((resolve) => {
    const child = spawn("bash", ["-lc", cmd], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    const append = (which: "out" | "err", data: Buffer) => {
      const cur = which === "out" ? stdout : stderr;
      const remaining = BASH_OUTPUT_BYTE_CAP - Buffer.byteLength(cur, "utf8");
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const piece = data.toString("utf8").slice(0, remaining);
      if (which === "out") stdout += piece;
      else stderr += piece;
      if (Buffer.byteLength(piece, "utf8") < data.length) truncated = true;
    };
    child.stdout.on("data", (b) => append("out", b));
    child.stderr.on("data", (b) => append("err", b));

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 2000);
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const exitMarker = signal
        ? `signal=${signal}`
        : `exit=${code ?? "null"}`;
      const out = [
        `[${exitMarker}${truncated ? " truncated" : ""}]`,
        stdout && `--- stdout ---\n${stdout}`,
        stderr && `--- stderr ---\n${stderr}`,
      ]
        .filter(Boolean)
        .join("\n");
      resolve({
        success: code === 0,
        output: out,
        truncated,
        durationMs: Date.now() - started,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: `spawn error: ${err.message}`,
        durationMs: Date.now() - started,
      });
    });
  });
}

async function toolGitStatus(started: number): Promise<ToolExecutionResult> {
  return await toolBash({ command: "git status --short" }, started);
}

async function toolGitDiff(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const staged = input.staged === true ? "--staged " : "";
  const pathArg = input.path ? `-- ${shellEscape(String(input.path))}` : "";
  const cmd = `git diff ${staged}${pathArg}`.trim();
  return await toolBash({ command: cmd }, started);
}

async function toolGitCommit(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  const message = String(input.message ?? "").trim();
  if (!message) {
    return {
      success: false,
      output: "git_commit: missing 'message'",
      durationMs: Date.now() - started,
    };
  }
  const filesRaw = Array.isArray(input.files) ? (input.files as unknown[]) : [];
  const files = filesRaw.map((f) => String(f)).filter((f) => f.length > 0);
  // Validate each file is inside the repo root.
  for (const f of files) {
    try {
      resolveSafePath(f);
    } catch (err) {
      return {
        success: false,
        output: `git_commit: rejected unsafe path ${f}: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - started,
      };
    }
  }
  const addCmd =
    files.length > 0
      ? `git add ${files.map(shellEscape).join(" ")}`
      : `git add -A`;
  // Quote message with a heredoc to preserve newlines.
  const commitCmd = `git commit -m "$(cat <<'__SOLENE_DISPATCH_EOF__'\n${message}\n__SOLENE_DISPATCH_EOF__\n)"`;
  const combined = `${addCmd} && ${commitCmd} && git rev-parse HEAD`;
  const r = await toolBash({ command: combined, timeout_ms: 60_000 }, started);
  let commitSha: string | undefined;
  if (r.success) {
    // Last line of stdout (between "--- stdout ---" + end) should be the SHA.
    const m = r.output.match(/\b[0-9a-f]{40}\b/);
    if (m) commitSha = m[0];
  }
  return { ...r, commitSha, filesModified: files.length > 0 ? files : undefined };
}

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_\-./@:=+,]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ----------------------------------------------------------------------------
// L1.5 — dormant-service wire-in helpers. Each wraps the underlying service
// and translates the Anthropic-tool input shape (snake_case keys, model-facing
// vocabulary) into the service's TS-camelCase input. Failures become
// {success:false} so the runner reports is_error to the model.
// ----------------------------------------------------------------------------

function isKnownAgentRole(role: unknown): role is SoleneDispatchAgentRole {
  return (
    typeof role === "string" &&
    (DISPATCH_AGENT_ROLES as readonly string[]).includes(role)
  );
}

function svcErr(
  toolName: string,
  err: unknown,
  started: number,
): ToolExecutionResult {
  return {
    success: false,
    output: `Error: ${toolName} failed: ${
      err instanceof Error ? err.message : String(err)
    }`,
    durationMs: Date.now() - started,
  };
}

async function toolSendMessageToAgent(
  input: Record<string, unknown>,
  ctx: DispatchToolContext,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    if (!isKnownAgentRole(ctx.agentRole)) {
      return {
        success: false,
        output:
          "Error: send_message_to_agent: dispatch context missing agent_role (cannot send anonymously).",
        durationMs: Date.now() - started,
      };
    }
    const to = input.to_agent_role;
    if (!isKnownAgentRole(to)) {
      return {
        success: false,
        output: `Error: send_message_to_agent: invalid to_agent_role=${String(to)}`,
        durationMs: Date.now() - started,
      };
    }
    const subject = String(input.subject ?? "");
    const body = String(input.body ?? "");
    if (!subject.trim() || !body.trim()) {
      return {
        success: false,
        output: "Error: send_message_to_agent: subject and body must be non-empty.",
        durationMs: Date.now() - started,
      };
    }
    const priority =
      typeof input.priority === "string" ? (input.priority as any) : undefined;
    const inReplyTo =
      typeof input.in_reply_to_message_id === "number"
        ? input.in_reply_to_message_id
        : undefined;

    const result = await sendAgentMessage({
      fromAgentRole: ctx.agentRole as SoleneDispatchAgentRole,
      toAgentRole: to,
      subject,
      body,
      priority,
      inReplyToMessageId: inReplyTo,
      dispatchIdContext: ctx.dispatchId ?? undefined,
    });
    return {
      success: true,
      output: JSON.stringify({ message_id: result.messageId }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("send_message_to_agent", err, started);
  }
}

async function toolReadAgentInbox(
  input: Record<string, unknown>,
  ctx: DispatchToolContext,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    if (!isKnownAgentRole(ctx.agentRole)) {
      return {
        success: false,
        output:
          "Error: read_agent_inbox: dispatch context missing agent_role (cannot determine inbox owner).",
        durationMs: Date.now() - started,
      };
    }
    const unreadOnly = input.unread_only === true;
    const limit =
      typeof input.limit === "number" ? Math.floor(input.limit) : undefined;
    const priority =
      typeof input.priority === "string" ? (input.priority as any) : undefined;

    const rows = await readInbox(ctx.agentRole as SoleneDispatchAgentRole, {
      unreadOnly,
      limit,
      priority,
    });
    return {
      success: true,
      output: JSON.stringify({ messages: rows }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("read_agent_inbox", err, started);
  }
}

async function toolRecordDecision(
  input: Record<string, unknown>,
  ctx: DispatchToolContext,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    if (!isKnownAgentRole(ctx.agentRole)) {
      return {
        success: false,
        output:
          "Error: record_decision: dispatch context missing agent_role (cannot tag decision).",
        durationMs: Date.now() - started,
      };
    }
    const decisionKind = String(input.decision_kind ?? "") as any;
    const summary = String(input.summary ?? "");
    const rationale = String(input.rationale ?? "");
    const referencedFiles = Array.isArray(input.referenced_files)
      ? (input.referenced_files as unknown[]).map((f) => String(f))
      : undefined;
    const evidenceUrl =
      typeof input.evidence_url === "string" ? input.evidence_url : undefined;

    const decisionId = await recordAgentDecision({
      agentRole: ctx.agentRole as SoleneDispatchAgentRole,
      decisionKind,
      summary,
      rationale,
      referencedFiles,
      dispatchId: ctx.dispatchId ?? null,
      evidenceUrl,
      sessionToken: randomUUID(),
    });
    return {
      success: true,
      output: JSON.stringify({ decision_id: decisionId }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("record_decision", err, started);
  }
}

async function toolRecordDecisionTrace(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    const decisionId = Number(input.decision_id ?? 0);
    if (!Number.isFinite(decisionId) || decisionId <= 0) {
      return {
        success: false,
        output: "Error: record_decision_trace: decision_id must be a positive integer.",
        durationMs: Date.now() - started,
      };
    }
    const stepKind = String(input.step_kind ?? "") as any;
    const stepText = String(input.step_text ?? "");
    const evidenceRefs = Array.isArray(input.evidence_refs)
      ? (input.evidence_refs as unknown[]).map((s) => String(s))
      : undefined;
    const alternativesConsidered = Array.isArray(input.alternatives_considered)
      ? (input.alternatives_considered as unknown[]).map((s) => String(s))
      : undefined;
    const chosenPathReason =
      typeof input.chosen_path_reason === "string"
        ? input.chosen_path_reason
        : undefined;
    const confidenceAtStep =
      typeof input.confidence_at_step === "number"
        ? input.confidence_at_step
        : undefined;

    const r = await addTraceStep({
      decisionId,
      stepKind,
      stepText,
      evidenceRefs,
      alternativesConsidered,
      chosenPathReason,
      confidenceAtStep,
    });
    return {
      success: true,
      output: JSON.stringify({
        trace_id: r.traceId,
        step_number: r.stepNumber,
      }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("record_decision_trace", err, started);
  }
}

async function toolRecordCounterfactual(
  input: Record<string, unknown>,
  ctx: DispatchToolContext,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    if (!isKnownAgentRole(ctx.agentRole)) {
      return {
        success: false,
        output:
          "Error: record_counterfactual: dispatch context missing agent_role.",
        durationMs: Date.now() - started,
      };
    }
    const sourceDecisionId = Number(input.source_decision_id ?? 0);
    if (!Number.isFinite(sourceDecisionId) || sourceDecisionId <= 0) {
      return {
        success: false,
        output:
          "Error: record_counterfactual: source_decision_id must be a positive integer.",
        durationMs: Date.now() - started,
      };
    }
    const confidence = Number(input.confidence ?? 0);
    const r = await recordCounterfactual({
      sourceDecisionId,
      analyzingAgentRole: ctx.agentRole as SoleneDispatchAgentRole,
      alternativePath: String(input.alternative_path ?? ""),
      alternativeRationale: String(input.alternative_rationale ?? ""),
      predictedOutcome: String(input.predicted_outcome ?? ""),
      comparisonToActual: String(input.comparison_to_actual ?? ""),
      lessonLearned:
        typeof input.lesson_learned === "string"
          ? input.lesson_learned
          : undefined,
      confidence,
    });
    return {
      success: true,
      output: JSON.stringify({ counterfactual_id: r.counterfactualId }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("record_counterfactual", err, started);
  }
}

async function toolRecordSpeculation(
  input: Record<string, unknown>,
  ctx: DispatchToolContext,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    if (!isKnownAgentRole(ctx.agentRole)) {
      return {
        success: false,
        output: "Error: record_speculation: dispatch context missing agent_role.",
        durationMs: Date.now() - started,
      };
    }
    const evidenceRefs = Array.isArray(input.evidence_refs)
      ? (input.evidence_refs as unknown[]).map((s) => String(s))
      : undefined;
    const r = await createSpeculation({
      agentRole: ctx.agentRole as SoleneDispatchAgentRole,
      triggeredBySignal: String(input.triggered_by_signal ?? ""),
      predictedNeed: String(input.predicted_need ?? ""),
      speculativeOutput: String(input.speculative_output ?? ""),
      outputKind: String(input.output_kind ?? "") as any,
      confidence:
        typeof input.confidence === "number" ? input.confidence : undefined,
      expiresInDays:
        typeof input.expires_in_days === "number"
          ? Math.floor(input.expires_in_days)
          : undefined,
      evidenceRefs,
    });
    return {
      success: true,
      output: JSON.stringify({ speculation_id: r.speculationId }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("record_speculation", err, started);
  }
}

async function toolFindMatchingSpeculations(
  input: Record<string, unknown>,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    const matches = await findMatchingSpeculations({
      predictedNeedQuery: String(input.predicted_need_query ?? ""),
      outputKind:
        typeof input.output_kind === "string"
          ? (input.output_kind as any)
          : undefined,
      minConfidence:
        typeof input.min_confidence === "number"
          ? input.min_confidence
          : undefined,
    });
    return {
      success: true,
      output: JSON.stringify({
        matches: matches.map((m) => ({
          speculation_id: m.speculationId,
          predicted_need: m.predictedNeed,
          output_kind: m.outputKind,
          confidence: m.confidence,
          match_score: m.matchScore,
          age_minutes: m.ageMinutes,
        })),
      }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("find_matching_speculations", err, started);
  }
}

async function toolAssessEvidence(
  input: Record<string, unknown>,
  ctx: DispatchToolContext,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    if (!isKnownAgentRole(ctx.agentRole)) {
      return {
        success: false,
        output: "Error: assess_evidence: dispatch context missing agent_role.",
        durationMs: Date.now() - started,
      };
    }
    const itemsIn = Array.isArray(input.evidence_items)
      ? (input.evidence_items as Record<string, unknown>[])
      : [];
    const evidenceItems = itemsIn.map((it) => ({
      id: String(it.id ?? ""),
      sourceKind: String(it.source_kind ?? "") as any,
      sourceRef: String(it.source_ref ?? ""),
      claim: String(it.claim ?? ""),
      recency: typeof it.recency === "string" ? it.recency : undefined,
      authorityTier: Number(it.authority_tier ?? 5) as any,
    }));
    const r = await assessEvidence({
      agentRole: ctx.agentRole as SoleneDispatchAgentRole,
      topic: String(input.topic ?? ""),
      decisionId:
        typeof input.decision_id === "number" ? input.decision_id : undefined,
      evidenceItems,
      customWeights:
        input.custom_weights && typeof input.custom_weights === "object"
          ? (input.custom_weights as Record<string, number>)
          : undefined,
    });
    return {
      success: true,
      output: JSON.stringify({
        assessment_id: r.assessmentId,
        weight_assignments: r.weightAssignments,
        chosen_source_id: r.chosenSourceId,
        aggregate_conclusion: r.aggregateConclusion,
        rationale: r.rationale,
        confidence: r.confidence,
      }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("assess_evidence", err, started);
  }
}

async function toolProposeCapability(
  input: Record<string, unknown>,
  ctx: DispatchToolContext,
  started: number,
): Promise<ToolExecutionResult> {
  try {
    if (!isKnownAgentRole(ctx.agentRole)) {
      return {
        success: false,
        output:
          "Error: propose_capability: dispatch context missing agent_role.",
        durationMs: Date.now() - started,
      };
    }
    const refs = Array.isArray(input.references_existing_tools)
      ? (input.references_existing_tools as unknown[]).map((s) => String(s))
      : undefined;
    const r = await proposeCapability({
      proposingAgentRole: ctx.agentRole as SoleneDispatchAgentRole,
      proposedCapabilityName: String(input.proposed_capability_name ?? ""),
      problemStatement: String(input.problem_statement ?? ""),
      proposedToolSignature: String(input.proposed_tool_signature ?? ""),
      expectedValueUsd:
        typeof input.expected_value_usd === "number"
          ? input.expected_value_usd
          : undefined,
      expectedInvocationsPerWeek:
        typeof input.expected_invocations_per_week === "number"
          ? input.expected_invocations_per_week
          : undefined,
      estimatedBuildCostUsd:
        typeof input.estimated_build_cost_usd === "number"
          ? input.estimated_build_cost_usd
          : undefined,
      referencesExistingTools: refs,
    });
    return {
      success: true,
      output: JSON.stringify({ proposal_id: r.proposalId }),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return svcErr("propose_capability", err, started);
  }
}

export { PROJECT_ROOT, BASH_OUTPUT_BYTE_CAP };
