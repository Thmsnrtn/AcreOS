/**
 * chatWork — pure derivation logic for the Solene chat receipts surface
 * (experience-legibility F3b).
 *
 * Two jobs, both side-effect free so they unit-test without a DOM:
 *
 *   1. buildRenderItems — segment a conversation's messages into reply
 *      bubbles, grouped tool activity ("work"), and receipt rows. A turn's
 *      tool activity collapses behind one "Show the work (N steps)"
 *      disclosure, and the raw tool-output carrier messages (persisted as
 *      role "user" rows whose blocks are all tool_result — see
 *      server/services/solene/chat/turnRunner.ts — or streamed role "tool"
 *      messages) never render as their own bubbles.
 *
 *   2. deriveReceipts — pair tool_use blocks (by id) with their tool_result
 *      blocks and, for SUCCESSFUL artifact-creating calls only, produce
 *      tappable chips linking to the surface where the artifact lives
 *      ("Decision #214" → /founder/decisions).
 *
 * Tool-result shapes this parses (see
 * server/services/solene/dispatchToolExecutor.ts for the source of truth):
 *   - record_decision        → '{"decision_id":214}'
 *   - enqueue_dispatch       → '{"dispatch_id":7}' (queued dispatch)
 *   - witnessed-send hands   → "[WITNESSED-SEND] '<hand>' has been drafted
 *     and FROZEN for the founder's approval (pending action #12). …" — the
 *     executor words it as a refusal, but the frozen draft IS a created
 *     artifact: an approval waiting on the founder in /founder/decisions.
 */
import type { ContentBlock } from "@shared/schema/solene-conversations";
import type { UiMessage } from "@/hooks/useSoleneChat";

export type ToolUseContentBlock = Extract<ContentBlock, { type: "tool_use" }>;
export type ToolResultContentBlock = Extract<
  ContentBlock,
  { type: "tool_result" }
>;

/** One tool call inside a work group: the call and (once run) its result. */
export interface WorkStep {
  toolUse?: ToolUseContentBlock;
  result?: ToolResultContentBlock;
}

export interface Receipt {
  /** Stable machine tag — becomes data-testid="receipt-chip-<type>". */
  type: "decision" | "dispatch" | "approval";
  /** Plain-words chip text. No enum leakage. */
  label: string;
  /** Founder surface where the created artifact lives. */
  href: string;
}

export type ChatRenderItem =
  | { kind: "message"; message: UiMessage }
  | { kind: "work"; steps: WorkStep[] }
  | { kind: "receipts"; receipts: Receipt[] };

// ─── Receipt derivation ─────────────────────────────────────────────────────

/** Executor failure/refusal prefixes — never chip these. */
const FAILURE_PREFIXES = [
  "Error:",
  "error:",
  "[CHAT TOOL BLOCKED]",
  "[CONSTITUTIONAL REFUSAL]",
  "[REFUSED]",
  "[AWAITING_APPROVAL",
];

function resultText(r: ToolResultContentBlock): string {
  if (typeof r.content === "string") return r.content;
  return r.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

function parseJsonId(text: string, key: string): number | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const v = parsed?.[key];
    return typeof v === "number" && Number.isFinite(v) && v > 0
      ? Math.floor(v)
      : null;
  } catch {
    return null;
  }
}

/**
 * Derive receipt chips from a work group. Only SUCCESSFUL artifact creations
 * chip — errors, refusals, and read-only tool calls produce nothing.
 */
export function deriveReceipts(steps: WorkStep[]): Receipt[] {
  const receipts: Receipt[] = [];
  for (const step of steps) {
    if (!step.result || step.result.is_error) continue;
    const text = resultText(step.result).trim();
    if (!text) continue;

    // Witnessed-send freeze: the executor phrases it as a refusal, but a
    // pending approval WAS created and is waiting in /founder/decisions.
    const frozen = /^\[WITNESSED-SEND\][\s\S]*?\bpending action #(\d+)/.exec(
      text,
    );
    if (frozen) {
      receipts.push({
        type: "approval",
        label: "Waiting for your approval",
        href: "/founder/decisions",
      });
      continue;
    }

    if (FAILURE_PREFIXES.some((p) => text.startsWith(p))) continue;

    const name = step.toolUse?.name;
    if (name === "record_decision") {
      const id = parseJsonId(text, "decision_id");
      if (id != null) {
        receipts.push({
          type: "decision",
          label: `Decision #${id}`,
          href: "/founder/decisions",
        });
      }
      continue;
    }
    if (name === "enqueue_dispatch") {
      const id = parseJsonId(text, "dispatch_id");
      if (id != null) {
        receipts.push({
          type: "dispatch",
          label: "Dispatch queued",
          href: "/founder/dispatches",
        });
      }
    }
  }
  return receipts;
}

// ─── Message segmentation ───────────────────────────────────────────────────

/**
 * A message whose only job is carrying tool outputs back to the model:
 * streamed role-"tool" messages, or the persisted role-"user" rows the
 * turn runner writes with nothing but tool_result blocks.
 */
export function isToolResultCarrier(m: UiMessage): boolean {
  if (m.role === "tool") return true;
  return (
    m.role === "user" &&
    m.content.length > 0 &&
    m.content.every((b) => b.type === "tool_result")
  );
}

function hasVisibleContent(m: UiMessage): boolean {
  return (
    m.content.some((b) => b.type === "text" && b.text.trim().length > 0) ||
    Boolean(m.thinking) ||
    Boolean(m.errorMessage) ||
    Boolean(m.isStreaming)
  );
}

/**
 * Segment messages into render items. Contiguous tool activity groups into
 * one "work" item; its receipts land AFTER the reply bubble that follows the
 * work (so chips read as part of the answer), or directly after the work
 * when no reply follows.
 */
export function buildRenderItems(messages: UiMessage[]): ChatRenderItem[] {
  const items: ChatRenderItem[] = [];
  let openSteps: WorkStep[] = [];

  const flushWork = (): Receipt[] => {
    if (openSteps.length === 0) return [];
    const steps = openSteps;
    openSteps = [];
    items.push({ kind: "work", steps });
    return deriveReceipts(steps);
  };
  const emitReceipts = (receipts: Receipt[]) => {
    if (receipts.length > 0) items.push({ kind: "receipts", receipts });
  };

  for (const m of messages) {
    if (isToolResultCarrier(m)) {
      for (const block of m.content) {
        if (block.type !== "tool_result") continue;
        const match = openSteps.find(
          (s) => s.toolUse?.id === block.tool_use_id && !s.result,
        );
        if (match) match.result = block;
        else openSteps.push({ result: block });
      }
      continue;
    }

    if (m.role === "assistant") {
      const toolUses = m.content.filter(
        (b): b is ToolUseContentBlock => b.type === "tool_use",
      );
      if (hasVisibleContent(m)) {
        // Close the previous tool run BEFORE the reply; its chips render
        // under this reply.
        const receipts = flushWork();
        items.push({ kind: "message", message: m });
        emitReceipts(receipts);
        openSteps = toolUses.map((tu) => ({ toolUse: tu }));
      } else if (toolUses.length > 0) {
        // Tool-only assistant hop — no bubble, just work.
        for (const tu of toolUses) openSteps.push({ toolUse: tu });
      }
      // Assistant rows with neither visible text nor tool calls (the empty
      // placeholder the turn runner persists) render nothing.
      continue;
    }

    // Real user / system message — close out any open tool run first.
    emitReceipts(flushWork());
    items.push({ kind: "message", message: m });
  }

  emitReceipts(flushWork());
  return items;
}
