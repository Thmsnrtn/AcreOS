/**
 * Ask replays — the ONE map from an approved pending_actions row to the
 * rail that runs it (AUTONOMY_SPEC.md §4.3, §4.5).
 *
 * The approve route's `execute` callback used to call executeTool for every
 * tool name. Three rails now propose asks, and each must replay through its
 * own switch, with the human's tap as the trusted approval:
 *
 *   executeTool         chat / scheduled / App-Intents tools (sends AND, at
 *                       "Ask before everything", record writes)
 *   executeSupportTool  support account fixes (ALWAYS_ASK_SUPPORT_TOOLS and,
 *                       at the strict stance, every non-pause-safe case)
 *   finance_ladder      `send_borrower_reminder` → financeAgentService
 *                       .sendManualReminder — the existing human path; the
 *                       letter rung stays document_ready, never "mailed"
 *
 * Which rail a name belongs to is not decided here: `dispatchForTool` reads
 * PAX_TOOL_GROUPS' registry in shared/pax-controls.ts, the same population
 * the page renders from. A name no rail claims is refused with the
 * glossary's line — never executed by the first switch that happens to be
 * imported. paxAsksAreExecutable.test.ts (wave 1 A) derives every toolName
 * proposePendingAction is called with and asserts each resolves here to
 * exactly one rail.
 *
 * After a successful replay this writes the attributed receipt
 * (origin "approval_replay", witnessed) — the approve route's own
 * `pax_value_event` logActivity call in server/routes-pax-insights.ts is
 * migrated onto this when wave 1 C switches the route to executeApprovedAsk.
 *
 * Rails are imported lazily, at replay time: server/ai/tools.ts and
 * server/ai/supportAgent.ts are large graphs that must not load with this
 * module, and neither may import this one (no cycle back into the kernel).
 *
 * The tap is the trusted approval on EVERY rail (wave 1 A, 2026-09-02):
 *   - executeTool gets `{ trustedApproval: true, origin: "approval_replay" }`,
 *     so neither the kernel gate nor the stance nor the pause re-freezes the
 *     replay — a human tapped for exactly this row.
 *   - executeSupportTool gets the same options as its fifth argument; before
 *     this an approved support ask re-froze as a new ask instead of running.
 *   - `send_borrower_reminder` replays through financeAgentService
 *     .sendManualReminder(noteId, orgId, type), which dispatches with the
 *     `humanApproved` flag the ladder's gate honours; noteId is read from the
 *     frozen args (the ladder freezes `{ reminderId, noteId, type }`) or the
 *     row's sourceRef, and the replay refuses without one.
 *
 * Consumer: POST /api/pax/pending-actions/:id/approve (server/routes-pax-insights.ts).
 */

import type { Organization } from "@shared/schema";
import type { ExecuteToolOptions } from "../ai/tools";
import type { ReminderType } from "./financeAgent";
import type { ToolExecutionResult } from "./approvalKernel";
import { dispatchForTool, groupForTool, type PaxAskSourceRef, type PaxToolDispatch } from "@shared/pax-controls";
import { PAX_LABELS } from "@shared/pax-glossary";
import { logger } from "../utils/logger";
import { getPaxControls } from "./paxControls";
import { recordPaxEffect } from "./paxReceipts";
import { summarizeAsk } from "./paxAskSummary";

export interface ApprovedAskContext {
  org: Organization;
  /** The human who tapped Approve. */
  userId: string;
  pendingActionId: number;
  /** The row's frozen source_ref, when it has one. */
  sourceRef?: PaxAskSourceRef | null;
}

export type ApprovedAskResult = ToolExecutionResult & {
  /** Which rail ran it; null when no rail claims the name (nothing ran). */
  executor: PaxToolDispatch | null;
};

const numberArg = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;

/** The one option shape a replay passes: the tap is the trusted approval. */
const replayOptions = (ctx: ApprovedAskContext): ExecuteToolOptions => ({
  trustedApproval: true,
  userId: ctx.userId,
  origin: "approval_replay",
});

/**
 * Replay one approved ask through the rail that owns its tool name.
 * Shaped to drop into approvePendingAction's `execute` callback.
 */
export async function executeApprovedAsk(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ApprovedAskContext,
): Promise<ApprovedAskResult> {
  const dispatch = dispatchForTool(toolName);
  let result: ToolExecutionResult;

  switch (dispatch) {
    case "executeTool": {
      const { executeTool } = await import("../ai/tools");
      result = await executeTool(toolName, args, ctx.org, replayOptions(ctx));
      break;
    }
    case "executeSupportTool": {
      const { executeSupportTool } = await import("../ai/supportAgent");
      const ticketId = numberArg(ctx.sourceRef?.ticketId) ?? undefined;
      result = await executeSupportTool(toolName, args, ctx.org, ticketId, replayOptions(ctx));
      break;
    }
    case "finance_ladder": {
      const noteId = numberArg(args.noteId) ?? numberArg(args.note_id) ?? numberArg(ctx.sourceRef?.noteId);
      if (noteId === null) {
        logger.error(
          "[paxAskExecutors] Borrower reminder replay refused — no noteId on the frozen row",
          new Error("missing noteId"),
          { orgId: ctx.org.id, metadata: { pendingActionId: ctx.pendingActionId, toolName } },
        );
        return { success: false, error: PAX_LABELS.notRunnable, executor: dispatch };
      }
      const { financeAgentService } = await import("./financeAgent");
      // The rung type was frozen by the ladder that proposed the ask;
      // sendManualReminder validates it against its own union.
      const kind = (typeof args.type === "string" ? args.type : "due") as ReminderType;
      const sent = await financeAgentService.sendManualReminder(noteId, ctx.org.id, kind);
      result = { success: sent.success, data: sent, error: sent.error };
      break;
    }
    default: {
      logger.error(
        "[paxAskExecutors] No rail claims this tool name — refusing to run it",
        new Error("no rail for tool"),
        { orgId: ctx.org.id, metadata: { pendingActionId: ctx.pendingActionId, toolName, dispatch } },
      );
      return { success: false, error: PAX_LABELS.notRunnable, executor: null };
    }
  }

  if (result.success) {
    // Attribution only — a tap is the human acting, so the stance does not
    // gate the replay; it is recorded so "What Pax did" can say under what.
    const controls = await getPaxControls(ctx.org.id);
    const summary = summarizeAsk(
      {
        id: ctx.pendingActionId,
        toolName,
        args,
        status: "executed",
        expiresAt: null,
        origin: "approval_replay",
        sourceRef: ctx.sourceRef ?? null,
      },
      { timeZone: controls.timezone },
    );
    await recordPaxEffect({
      orgId: ctx.org.id,
      actor: "pax",
      origin: "approval_replay",
      group: groupForTool(toolName) ?? undefined,
      stance: controls.checkFailed ? null : controls.stance,
      tool: toolName,
      entityType: "pending_action",
      entityId: ctx.pendingActionId,
      description: summary.verb,
      after: summary.change?.after ?? args,
      pendingActionId: ctx.pendingActionId,
      witnessed: true,
      userId: ctx.userId,
    });
  }

  return { ...result, executor: dispatch };
}
