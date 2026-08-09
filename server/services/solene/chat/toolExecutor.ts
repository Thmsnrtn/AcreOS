/**
 * SOLENE CHAT — tool executor (Phase 2 of AcreOS-Solene migration).
 *
 * The chat-tier facade over dispatchToolExecutor. Three buckets:
 *
 *   - AUTO     — execute inline; result streams back as a tool_result block
 *   - APPROVE  — pending; Phase 3 frontend surfaces approve/reject UI
 *   - BLOCKED  — refuse; use dispatch flow instead
 *
 * Classification is set conservatively: anything that writes to the
 * filesystem / mutates git state / spawns shells / enqueues a dispatch
 * requires explicit founder approval at the chat layer. The dispatch layer
 * still gets the same constitutional guard rails, so APPROVE-class tools
 * gated here remain fully usable through `enqueue_dispatch`.
 */

import { randomUUID } from "node:crypto";
import {
  DISPATCH_TOOL_SCHEMAS,
  executeDispatchTool,
  type DispatchToolContext,
  type ToolExecutionResult,
} from "../dispatchToolExecutor";
import type {
  ContentBlock,
  ToolResultContentBlock,
} from "./openRouterClient";
import { wrapUntrusted } from "../../../ai/untrustedEnvelope";
import { logger } from "../../../utils/logger";

// ============================================================================
// Classification sets
// ============================================================================

/**
 * Tools the chat may run inline without approval.
 *
 * Bias is conservative: read-only / record-only / message-passing tools only.
 * No filesystem writes, no shells, no commits.
 */
export const CHAT_AUTO_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  // ── Phase-0 read primitives ────────────────────────────────────────────
  "file_read",
  "file_list",
  "git_status",
  "git_diff",
  // ── Layer-1 wire-ins: communication / introspection / proposal ─────────
  "send_message_to_agent",
  "read_agent_inbox",
  "record_decision",
  "record_decision_trace",
  "record_counterfactual",
  "record_speculation",
  "find_matching_speculations",
  "assess_evidence",
  "propose_capability",
]);

/**
 * Tools that REQUIRE Tom-approve before execution. The first time chat asks
 * to run one, we return an awaiting_approval tool_result + an approval token;
 * Phase 3 UI surfaces an approve/reject button + posts to the approve route.
 */
export const CHAT_APPROVAL_REQUIRED_TOOLS: ReadonlySet<string> = new Set([
  "file_write",
  "git_commit",
  "bash",
  "run_tests",
  "typecheck",
]);

/**
 * Tools hard-blocked at the chat layer; the model is told to go through the
 * dispatch flow instead. Empty today — placeholder for future expansions.
 */
export const CHAT_HARD_BLOCKED_TOOLS: ReadonlySet<string> = new Set<string>([]);

// ============================================================================
// Schema selection — what we expose to the chat model
// ============================================================================

/**
 * Tool schemas to advertise to the chat model. We INCLUDE approval-required
 * tool schemas (file_write, git_commit, bash) so the model can attempt them
 * — the approval pause happens at execute-time, not advertise-time. This lets
 * the model express intent ("I will write this file"); the founder gates the
 * actual side-effect.
 */
export const CHAT_TOOL_SCHEMAS = DISPATCH_TOOL_SCHEMAS.filter(
  (t) => !CHAT_HARD_BLOCKED_TOOLS.has(t.name),
);

// ============================================================================
// classifyChatTool
// ============================================================================

export interface ChatToolDecision {
  kind: "auto" | "approval_required" | "hard_blocked";
  reason?: string;
}

export function classifyChatTool(toolName: string): ChatToolDecision {
  if (CHAT_HARD_BLOCKED_TOOLS.has(toolName)) {
    return {
      kind: "hard_blocked",
      reason: `Tool "${toolName}" is hard-blocked from the chat surface. Use enqueue_dispatch to run it through the dispatch worker instead.`,
    };
  }
  if (CHAT_APPROVAL_REQUIRED_TOOLS.has(toolName)) {
    return {
      kind: "approval_required",
      reason: `Tool "${toolName}" requires founder approval before it can execute from the chat surface.`,
    };
  }
  if (CHAT_AUTO_ALLOWED_TOOLS.has(toolName)) {
    return { kind: "auto" };
  }
  // Unknown tool — treat as blocked to be safe.
  return {
    kind: "hard_blocked",
    reason: `Tool "${toolName}" is not registered for the chat surface.`,
  };
}

// ============================================================================
// Pending-approval registry (in-memory)
// ============================================================================

interface PendingApproval {
  approvalToken: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  conversationId: number;
  founderUserId: string;
  createdAt: number;
}

const PENDING_APPROVALS = new Map<string, PendingApproval>();
const APPROVAL_TTL_MS = 60 * 60 * 1000; // 1h

function gcPendingApprovals(): void {
  const now = Date.now();
  for (const [token, row] of PENDING_APPROVALS.entries()) {
    if (now - row.createdAt > APPROVAL_TTL_MS) {
      PENDING_APPROVALS.delete(token);
    }
  }
}

/**
 * Look up a pending-approval entry. Exported for the approve-tool route.
 */
export function getPendingApproval(token: string): PendingApproval | null {
  gcPendingApprovals();
  return PENDING_APPROVALS.get(token) ?? null;
}

/**
 * Remove a pending entry once the founder has decided. Exported for the
 * approve-tool route.
 */
export function deletePendingApproval(token: string): void {
  PENDING_APPROVALS.delete(token);
}

// ============================================================================
// executeChatTool
// ============================================================================

export interface ExecuteChatToolInput {
  toolName: string;
  toolInput: Record<string, unknown>;
  conversationId: number;
  founderUserId: string;
}

export interface ExecuteChatToolResult {
  result: ContentBlock[];
  awaitingApproval: boolean;
  approvalToken?: string;
}

/**
 * Execute a tool from the chat surface. Returns Anthropic-shape content
 * blocks the caller can wrap into a tool_result message.
 */
export async function executeChatTool(
  input: ExecuteChatToolInput,
): Promise<ExecuteChatToolResult> {
  const decision = classifyChatTool(input.toolName);

  if (decision.kind === "hard_blocked") {
    return {
      result: [
        {
          type: "text",
          text: `[CHAT TOOL BLOCKED] ${decision.reason}`,
        },
      ],
      awaitingApproval: false,
    };
  }

  if (decision.kind === "approval_required") {
    const approvalToken = randomUUID();
    PENDING_APPROVALS.set(approvalToken, {
      approvalToken,
      toolName: input.toolName,
      toolInput: input.toolInput,
      conversationId: input.conversationId,
      founderUserId: input.founderUserId,
      createdAt: Date.now(),
    });
    logger.info("[soleneChat] tool.approval_required", {
      toolName: input.toolName,
      conversationId: input.conversationId,
      approvalToken,
    });
    return {
      result: [
        {
          type: "text",
          text: `[AWAITING_APPROVAL token=${approvalToken}] Tom must approve before "${input.toolName}" can run. The chat UI will surface an approve/reject control.`,
        },
      ],
      awaitingApproval: true,
      approvalToken,
    };
  }

  // auto-allowed — delegate to the underlying dispatch executor.
  const ctx: DispatchToolContext = {
    dispatchId: null,
    // We don't have a dispatched-agent role here — chat is Solene's own surface.
    // The wire-in helpers that REQUIRE a dispatch agent role will refuse cleanly
    // with a typed error message; that's the correct behavior for chat-as-Solene.
    agentRole: "solene-chat",
  };

  let result: ToolExecutionResult;
  try {
    result = await executeDispatchTool(input.toolName, input.toolInput, ctx);
  } catch (err) {
    result = {
      success: false,
      output: `executeDispatchTool threw: ${
        err instanceof Error ? err.message : String(err)
      }`,
      durationMs: 0,
    };
  }

  logger.info("[soleneChat] tool.executed", {
    toolName: input.toolName,
    conversationId: input.conversationId,
    success: result.success,
    durationMs: result.durationMs,
    outputBytes: result.output.length,
  });

  // SECURITY (guard-totality audit P-2): executor output (file contents,
  // git diffs, inbox text) is untrusted data re-entering the model on the
  // trusted tool_result channel — envelope it. The executor already caps
  // output size, so the envelope sanitizes + delimits without re-truncating.
  // The server-authored BLOCKED / AWAITING_APPROVAL constants above stay
  // unwrapped on purpose.
  const outputText = result.output
    ? wrapUntrusted(result.output, `tool:${input.toolName}`, {
        maxLength: result.output.length,
      })
    : result.output;

  return {
    result: [
      {
        type: "text",
        text: outputText,
      },
    ],
    awaitingApproval: false,
  };
}

// ============================================================================
// wrapToolResult — public helper to convert an executor output into the
// Anthropic-shape tool_result block the conversation persists.
// ============================================================================

export function wrapToolResult(opts: {
  toolUseId: string;
  blocks: ContentBlock[];
  isError?: boolean;
}): ToolResultContentBlock {
  // tool_result content can be string OR an array of text blocks. We render
  // as a single text block if there's exactly one, otherwise concatenate.
  if (opts.blocks.length === 1 && opts.blocks[0].type === "text") {
    return {
      type: "tool_result",
      tool_use_id: opts.toolUseId,
      content: opts.blocks[0].text,
      is_error: opts.isError,
    };
  }
  const text = opts.blocks
    .map((b) => (b.type === "text" ? b.text : JSON.stringify(b)))
    .join("\n");
  return {
    type: "tool_result",
    tool_use_id: opts.toolUseId,
    content: text,
    is_error: opts.isError,
  };
}
