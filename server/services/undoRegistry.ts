// @ts-nocheck
/**
 * Undo Registry — Sovereign Company Protocol v4
 *
 * Tracks which agent actions can be reversed and provides undo functions.
 * When Beacon pauses a campaign, the CEO can tap "Undo" and resume it.
 * When Sophie sends an email, it's marked as irreversible.
 *
 * Every executed action registers its undo capability (or lack thereof).
 */

import { db } from "../db";
import { agentActionUndoLog, campaigns } from "@shared/schema";
import { eq, and, gte } from "drizzle-orm";

type UndoFn = (originalInput: Record<string, any>) => Promise<{ success: boolean; detail: string }>;

// Registry of undo functions keyed by agent:action
const undoFunctions = new Map<string, { fn: UndoFn; expiryMs: number | null }>();

function registerUndo(agentCodename: string, actionName: string, fn: UndoFn, expiryMs: number | null = null) {
  undoFunctions.set(`${agentCodename}:${actionName}`, { fn, expiryMs });
}

// --- Reversible Actions ---

// Beacon: unpause a campaign
registerUndo("beacon_marketing", "pause_campaign", async (input) => {
  const { campaignId } = input;
  if (!campaignId) return { success: false, detail: "No campaign ID" };

  await db.update(campaigns)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId));

  return { success: true, detail: `Campaign #${campaignId} resumed` };
}, 24 * 60 * 60 * 1000); // 24-hour undo window

// Sentinel: no meaningful undo for job restart (it's a one-shot operation)
// Sophie: emails can't be unsent
// Forge: emails can't be unsent

/**
 * Register an action's undo availability after execution.
 */
export async function registerActionUndo(
  actionLogId: number,
  agentCodename: string,
  actionName: string,
  originalInput: Record<string, any>,
): Promise<void> {
  const key = `${agentCodename}:${actionName}`;
  const registration = undoFunctions.get(key);

  const undoAvailable = !!registration;
  const undoExpiry = registration?.expiryMs
    ? new Date(Date.now() + registration.expiryMs)
    : null;

  try {
    await db.insert(agentActionUndoLog).values({
      actionLogId,
      agentCodename,
      actionName,
      undoAvailable,
      undoExpiry,
      originalInput,
    });
  } catch (err) {
    console.error("[UndoRegistry] Failed to register undo:", err);
  }
}

/**
 * Execute an undo for a given action log entry.
 */
export async function executeUndo(actionLogId: number): Promise<{
  success: boolean;
  detail: string;
}> {
  // Find the undo log entry
  const entries = await db.select()
    .from(agentActionUndoLog)
    .where(eq(agentActionUndoLog.actionLogId, actionLogId))
    .limit(1);

  const entry = entries[0];
  if (!entry) return { success: false, detail: "No undo record found for this action" };
  if (!entry.undoAvailable) return { success: false, detail: "This action cannot be undone" };
  if (entry.undoExecutedAt) return { success: false, detail: "This action has already been undone" };
  if (entry.undoExpiry && new Date() > new Date(entry.undoExpiry)) {
    return { success: false, detail: "Undo window has expired" };
  }

  const key = `${entry.agentCodename}:${entry.actionName}`;
  const registration = undoFunctions.get(key);
  if (!registration) return { success: false, detail: "Undo function no longer registered" };

  try {
    const result = await registration.fn(entry.originalInput as Record<string, any>);

    // Record the undo
    await db.update(agentActionUndoLog)
      .set({
        undoExecutedAt: new Date(),
        undoResult: result,
      })
      .where(eq(agentActionUndoLog.id, entry.id));

    return result;
  } catch (err: any) {
    const result = { success: false, detail: `Undo failed: ${err.message}` };
    await db.update(agentActionUndoLog)
      .set({ undoExecutedAt: new Date(), undoResult: result })
      .where(eq(agentActionUndoLog.id, entry.id));
    return result;
  }
}

/**
 * Check if an action has an undo available.
 */
export function canUndo(agentCodename: string, actionName: string): boolean {
  return undoFunctions.has(`${agentCodename}:${actionName}`);
}

/**
 * Get undo status for a specific action log entry.
 */
export async function getUndoStatus(actionLogId: number): Promise<{
  undoAvailable: boolean;
  expired: boolean;
  alreadyUndone: boolean;
} | null> {
  const entries = await db.select()
    .from(agentActionUndoLog)
    .where(eq(agentActionUndoLog.actionLogId, actionLogId))
    .limit(1);

  const entry = entries[0];
  if (!entry) return null;

  return {
    undoAvailable: entry.undoAvailable,
    expired: entry.undoExpiry ? new Date() > new Date(entry.undoExpiry) : false,
    alreadyUndone: !!entry.undoExecutedAt,
  };
}
