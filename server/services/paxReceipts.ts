/**
 * Pax receipts — the dedicated, attributed writer behind "What Pax did"
 * (AUTONOMY_SPEC.md §4.7).
 *
 * Every effect Pax or a customer's rule has on the customer's records goes
 * through `recordPaxEffect`, which writes ONE row to `activity_log` with
 * `agent_type = 'pax'` via storage.logActivity — the same table the existing
 * per-case `logActivity({ agentType: "pax" })` calls already write (e.g.
 * server/ai/tools.ts update_lead_status), so the reader
 * (`GET /api/pax/receipts`, wave 1 C) is one query, not a union.
 *
 * What a receipt carries that a plain activity row did not:
 *   - WHO acted:       actor "pax" (Pax itself) or "rule" (a workflow /
 *                      sequence / job the customer turned on)
 *   - HOW it happened: "asked" (a human tapped), "ran on its own", or "rule"
 *                      — the third column of every receipt row, in the
 *                      glossary's words
 *   - UNDER WHAT:      the org's stance at the time, or null when it could
 *                      not be read (never a guessed stance)
 *   - WHICH group:     the capability group from PAX_TOOL_GROUPS
 *   - before / after:  captured now; "Undo" is not printed until a revert
 *                      route exists (wave 3)
 *
 * NEVER THROWS INTO THE CALLER. A receipt that fails to write is logged as an
 * error and reported as `{ written: false }`; the effect already happened
 * and a bookkeeping failure must not turn it into a second, retried effect.
 *
 * Wave-1 writers: the post-dispatch hook in executeTool and the migrated
 * per-case calls (A); leadNurturer stage transitions, financeAgent staging /
 * dispatch, sequenceProcessor.sendStep, workflow-engine.executeAction, the
 * expiry sweep (B); pause / resume (C). Wave 0 writer:
 * server/services/paxAskExecutors.ts (approval replays).
 */

import { storage } from "../storage";
import { logger } from "../utils/logger";
import {
  groupForTool,
  UNATTENDED_PATHS,
  type PaxAskOrigin,
  type PaxStance,
  type PaxToolGroup,
  type UnattendedPathId,
} from "@shared/pax-controls";
import { PAX_RECEIPT_WORDS } from "@shared/pax-glossary";

/** An ask lane, or "engine" for a rule / job that never proposed an ask. */
export type PaxEffectOrigin = PaxAskOrigin | "engine";

export interface PaxEffect {
  orgId: number;
  /** Pax itself, or a rule the customer turned on. */
  actor: "pax" | "rule";
  origin: PaxEffectOrigin;
  /** Defaults to PAX_TOOL_GROUPS[tool] for a tool, "runs_rules" for an engine. */
  group?: PaxToolGroup;
  /** The org's stance when it acted; null when the read failed. */
  stance: PaxStance | null;
  /** Exactly one of `tool` (a dispatch-switch case) or `engine` (an UNATTENDED_PATHS id). */
  tool?: string;
  engine?: UnattendedPathId;
  /** activity_log.action; defaults to the tool name or the engine id. */
  action?: string;
  entityType: string;
  entityId: number;
  /** The "what" line; defaults to a plain sentence from the tool / engine. */
  description?: string;
  before?: unknown;
  after?: unknown;
  pendingActionId?: number | null;
  workflowRunId?: number | null;
  enrollmentId?: number | null;
  /** True only when a human tapped for exactly this effect. */
  witnessed: boolean;
  /** The human, when there was one (the approver, the chat user). */
  userId?: string | null;
}

/** metadata.receipt marker — lets the reader tell receipts from older rows. */
const RECEIPT_KIND = "pax_effect";

/** "update_lead_status" → "Update lead status". */
function humanizeTool(tool: string): string {
  const words = tool.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : tool;
}

function whatHappened(effect: PaxEffect): string {
  if (effect.description) return effect.description;
  if (effect.tool) return humanizeTool(effect.tool);
  const path = UNATTENDED_PATHS.find((p) => p.id === effect.engine);
  return path?.label ?? humanizeTool(String(effect.engine));
}

function howItHappened(effect: PaxEffect): keyof typeof PAX_RECEIPT_WORDS {
  if (effect.witnessed || effect.pendingActionId != null) return "asked";
  if (effect.actor === "rule") return "rule";
  return "onItsOwn";
}

/**
 * Write one attributed receipt. Resolves `{ written: false }` — and logs —
 * instead of throwing, for any reason at all.
 */
export async function recordPaxEffect(effect: PaxEffect): Promise<{ written: boolean }> {
  try {
    const hasTool = typeof effect.tool === "string" && effect.tool.length > 0;
    const hasEngine = typeof effect.engine === "string" && effect.engine.length > 0;
    if (hasTool === hasEngine) {
      logger.error(
        "[paxReceipts] Receipt refused — exactly one of tool / engine is required",
        new Error("invalid receipt"),
        { orgId: effect.orgId, metadata: { tool: effect.tool ?? null, engine: effect.engine ?? null } },
      );
      return { written: false };
    }
    if (!Number.isInteger(effect.entityId)) {
      logger.error(
        "[paxReceipts] Receipt refused — entityId must be an integer",
        new Error("invalid receipt"),
        { orgId: effect.orgId, metadata: { entityType: effect.entityType, entityId: effect.entityId } },
      );
      return { written: false };
    }

    const group: PaxToolGroup | null =
      effect.group ?? (hasTool ? groupForTool(effect.tool as string) : "runs_rules");
    const how = howItHappened(effect);
    const hasChange = effect.before !== undefined || effect.after !== undefined;

    await storage.logActivity({
      organizationId: effect.orgId,
      userId: effect.userId ?? undefined,
      agentType: "pax",
      action: effect.action ?? (hasTool ? (effect.tool as string) : (effect.engine as string)),
      entityType: effect.entityType,
      entityId: effect.entityId,
      description: `${whatHappened(effect)} — ${PAX_RECEIPT_WORDS[how]}`,
      changes: hasChange ? { before: effect.before ?? null, after: effect.after ?? null } : undefined,
      metadata: {
        receipt: RECEIPT_KIND,
        actor: effect.actor,
        origin: effect.origin,
        group,
        stance: effect.stance,
        tool: hasTool ? effect.tool : null,
        engine: hasEngine ? effect.engine : null,
        how,
        pendingActionId: effect.pendingActionId ?? null,
        workflowRunId: effect.workflowRunId ?? null,
        enrollmentId: effect.enrollmentId ?? null,
        witnessed: effect.witnessed,
      },
    });
    return { written: true };
  } catch (err) {
    logger.error("[paxReceipts] Receipt write failed — the effect stands, the record does not", err as Error, {
      orgId: effect.orgId,
      metadata: { tool: effect.tool ?? null, engine: effect.engine ?? null, entityType: effect.entityType },
    });
    return { written: false };
  }
}
