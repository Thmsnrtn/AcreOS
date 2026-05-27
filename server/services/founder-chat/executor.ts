/**
 * Founder Chat — tool executor.
 *
 * Three responsibilities:
 *   1. Validate args via the tool's zod schema.
 *   2. Destructive-tool confirmation flow (return confirmation_request
 *      artifact, persist in chat_pending_tool_calls, wait for confirm).
 *   3. Tier-3 cooldown enforcement (5 min between same-tool calls
 *      against same founder; a second call within that window requires
 *      a second confirmation).
 *
 * Post-action verification (Reliability Req 3A) and audit-log writing
 * are handled here so individual tool handlers stay simple.
 */

import { randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import { chatPendingToolCalls, chatToolCooldowns } from "@shared/schema";
import { getSetting } from "../founderSettings";
import { logger } from "../../utils/logger";
import { getTool, type FounderTool, type FounderToolContext, type ToolResult } from "./tool-registry";

/** Kill-switch key in founder_settings. Defaults false (Tom decision #13). */
export const ATLAS_KILL_SWITCH_KEY = "atlas.kill_switch";

/**
 * Atlas kill-switch — when truthy in founder_settings, every destructive
 * tool refuses fast. Read-only tools are unaffected. Tom flips this from
 * /founder/studio/atlas during incidents.
 */
export async function isAtlasKillSwitchOn(): Promise<boolean> {
  try {
    const raw = await getSetting(ATLAS_KILL_SWITCH_KEY);
    return raw === "true" || raw === "1";
  } catch {
    return false;
  }
}

/** Test override — when set, isAtlasKillSwitchOn returns this value
 *  instead of reading founder_settings. */
let killSwitchOverrideForTests: boolean | null = null;
export function __setKillSwitchOverrideForTests(v: boolean | null): void {
  killSwitchOverrideForTests = v;
}

/** Phase A default. Founder can tune via founder_settings `atlas.max_tool_calls_per_turn`. */
export const DEFAULT_MAX_TOOL_CALLS_PER_TURN = 10;

/** Cooldown window for Tier-3 same-tool calls. */
const TIER3_COOLDOWN_MS = 5 * 60 * 1000;

/** TTL on a pending tool call awaiting confirmation. */
const PENDING_TTL_MS = 5 * 60 * 1000;

/**
 * Lens 13: Tier-3 cooldown storage. Previously a process-local `Map<string,
 * number>` which a Fly restart silently wiped, letting a destructive Tier-3
 * op re-fire without the second-confirmation challenge. Now persisted in
 * `chat_tool_cooldowns` (one row per user_id + tool_name).
 *
 * `getLastConfirmedAt` / `recordTier3Confirmation` are the only DB touch
 * points; both swallow errors so an unhealthy DB doesn't deadlock the
 * cooldown check (we'd rather over-prompt than block the chat entirely).
 *
 * `__cooldownOverrideForTests` lets unit tests substitute an in-memory map
 * without spinning up Postgres.
 */
type CooldownOverride = {
  get(key: string): number | undefined;
  set(key: string, value: number): void;
  clear(): void;
};
let __cooldownOverrideForTests: CooldownOverride | null = null;

/** Test-only — supply an in-memory cooldown override. Pass null to revert. */
export function __setCooldownOverrideForTests(override: CooldownOverride | null): void {
  __cooldownOverrideForTests = override;
}

async function getLastConfirmedAt(userId: string, toolName: string): Promise<number | undefined> {
  if (__cooldownOverrideForTests) {
    return __cooldownOverrideForTests.get(`${userId}:${toolName}`);
  }
  try {
    const [row] = await db
      .select({ lastConfirmedAt: chatToolCooldowns.lastConfirmedAt })
      .from(chatToolCooldowns)
      .where(and(eq(chatToolCooldowns.userId, userId), eq(chatToolCooldowns.toolName, toolName)))
      .limit(1);
    return row?.lastConfirmedAt ? new Date(row.lastConfirmedAt).getTime() : undefined;
  } catch (err) {
    logger.warn("[founder-chat] cooldown lookup failed", {
      metadata: { userId, toolName, error: String(err) },
    });
    return undefined;
  }
}

async function recordTier3Confirmation(userId: string, toolName: string): Promise<void> {
  if (__cooldownOverrideForTests) {
    __cooldownOverrideForTests.set(`${userId}:${toolName}`, Date.now());
    return;
  }
  try {
    const now = new Date();
    await db
      .insert(chatToolCooldowns)
      .values({ userId, toolName, lastConfirmedAt: now })
      .onConflictDoUpdate({
        target: [chatToolCooldowns.userId, chatToolCooldowns.toolName],
        set: { lastConfirmedAt: now },
      });
  } catch (err) {
    logger.warn("[founder-chat] cooldown write failed", {
      metadata: { userId, toolName, error: String(err) },
    });
  }
}

export interface RunToolOpts {
  toolName: string;
  args: unknown;
  ctx: FounderToolContext;
  /** True when re-running after a confirmation_request was approved. */
  confirmed?: boolean;
  /** True when this is a Tier-3 second-confirmation re-run. */
  cooldownAcknowledged?: boolean;
}

export interface RunToolOutcome {
  artifact: ToolResult["artifact"];
  followUp?: string;
  requiresConfirmation?: boolean;
  confirmationRequestId?: string;
  verification?: { ok: boolean; evidence: string };
  consecutiveFailures?: number;
}

export async function runTool(opts: RunToolOpts): Promise<RunToolOutcome> {
  const tool = getTool(opts.toolName);
  if (!tool) {
    throw new Error(`[founder-chat] tool not found: ${opts.toolName}`);
  }

  // 1. Validate args.
  const parsed = tool.schema.safeParse(opts.args);
  if (!parsed.success) {
    throw new Error(
      `[founder-chat] tool ${tool.name} arg validation failed: ${parsed.error.message}`,
    );
  }
  const validatedArgs = parsed.data;

  // 1a. Kill-switch — every destructive tool refuses fast when atlas.kill_switch
  //     is set in founder_settings. Read-only tools pass through unchanged.
  if (tool.destructive) {
    const killed =
      killSwitchOverrideForTests !== null
        ? killSwitchOverrideForTests
        : await isAtlasKillSwitchOn();
    if (killed) {
      logger.warn("[founder-chat] kill switch active — destructive tool refused", {
        metadata: { toolName: tool.name, founderUserId: opts.ctx.founderUserId },
      });
      throw new Error(
        `Atlas write operations disabled — see /founder/studio/atlas to re-enable.`,
      );
    }
  }

  // 2. Destructive → confirmation flow.
  if (tool.destructive && !opts.confirmed) {
    const requestId = await persistPendingCall(tool, validatedArgs, opts.ctx);
    return {
      artifact: {
        type: "confirmation_request",
        toolName: tool.name,
        args: validatedArgs as unknown,
        tier: tool.tier,
        category: tool.category,
        preview: tool.description,
      },
      requiresConfirmation: true,
      confirmationRequestId: requestId,
    };
  }

  // 3. Tier-3 cooldown — second invocation of the same Tier-3 tool by the
  //    same founder within TIER3_COOLDOWN_MS demands a *fresh* confirmation
  //    even when `confirmed:true` would otherwise pass it through. This
  //    prevents Tom from accidentally double-firing a destructive op by
  //    re-confirming a stale request, or by tabbing back to a pending
  //    request that was already executed once.
  if (tool.tier === 3 && !opts.cooldownAcknowledged) {
    const lastConfirmedAt = await getLastConfirmedAt(opts.ctx.founderUserId, tool.name);
    if (lastConfirmedAt && Date.now() - lastConfirmedAt < TIER3_COOLDOWN_MS) {
      const requestId = await persistPendingCall(tool, validatedArgs, opts.ctx, { cooldownBlocked: true });
      return {
        artifact: {
          type: "confirmation_request",
          toolName: tool.name,
          args: validatedArgs as unknown,
          tier: tool.tier,
          category: tool.category,
          preview: `Tier-3 cooldown: this tool was confirmed within the last 5 min. Confirm again to re-run.`,
          cooldownBlocked: true,
        },
        requiresConfirmation: true,
        confirmationRequestId: requestId,
      };
    }
  }

  // 4. Execute.
  let result: ToolResult;
  try {
    result = await tool.handler(validatedArgs as never, opts.ctx);
  } catch (err) {
    await opts.ctx.auditLog(`tool_call_failed:${tool.name}`, validatedArgs as unknown, { error: String(err) });
    throw err;
  }

  // 5. Record this call's confirmed-at for Tier-3 cooldown tracking. DB-
  //    backed so Fly restarts / process-group failovers don't reset it.
  if (tool.tier === 3) {
    await recordTier3Confirmation(opts.ctx.founderUserId, tool.name);
  }

  // 6. Audit-log the successful call. Persist the rollbackRecipe verbatim
  //    so `undo_last_action` can find and replay it.
  await opts.ctx.auditLog(`tool_call:${tool.name}`, validatedArgs as unknown, {
    artifactType: result.artifact.type,
    rollbackRecipe: result.rollbackRecipe ?? null,
  });

  // 7. Post-action verification (Reliability Req 3A).
  let verification: RunToolOutcome["verification"];
  if (tool.destructive && result.verifyFn) {
    try {
      verification = await result.verifyFn();
      await opts.ctx.auditLog(`tool_verify:${tool.name}`, null, verification);
    } catch (verifyErr) {
      verification = { ok: false, evidence: `verifyFn threw: ${String(verifyErr)}` };
      await opts.ctx.auditLog(`tool_verify_failed:${tool.name}`, null, verification);
    }
  }

  return {
    artifact: result.artifact,
    followUp: result.followUp,
    verification,
  };
}

/**
 * Persist a pending tool call awaiting confirmation. Returns the
 * confirmationRequestId Tom's UI presents.
 */
async function persistPendingCall(
  tool: FounderTool,
  args: unknown,
  ctx: FounderToolContext,
  extras?: Record<string, unknown>,
): Promise<string> {
  const id = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await db.insert(chatPendingToolCalls).values({
    id,
    threadId: ctx.threadId,
    founderUserId: ctx.founderUserId,
    toolName: tool.name,
    args: { ...(args as object), ...(extras ?? {}) } as any,
    ctxSnapshot: serializeCtxForPersistence(ctx) as any,
    expiresAt: expiresAt as any,
  } as any);
  return id;
}

/**
 * Confirm a pending tool call. Loads the persisted row, deletes it
 * (single-use), and re-runs the tool with `confirmed: true`.
 */
export async function confirmPendingToolCall(
  confirmationRequestId: string,
  ctx: FounderToolContext,
): Promise<RunToolOutcome> {
  const rows = await db
    .select()
    .from(chatPendingToolCalls)
    .where(
      and(
        eq(chatPendingToolCalls.id, confirmationRequestId),
        eq(chatPendingToolCalls.founderUserId, ctx.founderUserId),
        gt(chatPendingToolCalls.expiresAt, new Date() as any),
      ),
    );
  if (rows.length === 0) {
    throw new Error("[founder-chat] confirmation request not found or expired");
  }
  const row = rows[0];

  // Single-use: delete before running so we can't double-execute.
  await db.delete(chatPendingToolCalls).where(eq(chatPendingToolCalls.id, confirmationRequestId));

  const cooldownAcknowledged = Boolean((row.args as any)?.cooldownBlocked);

  return runTool({
    toolName: row.toolName,
    args: row.args as unknown,
    ctx,
    confirmed: true,
    cooldownAcknowledged,
  });
}

/**
 * Cancel a pending tool call. Logs the cancel + returns a "cancelled"
 * text artifact for the chat to render in place of the original
 * confirmation card.
 */
export async function cancelPendingToolCall(
  confirmationRequestId: string,
  ctx: FounderToolContext,
  reason?: string,
): Promise<{ artifact: ToolResult["artifact"] }> {
  const rows = await db
    .select()
    .from(chatPendingToolCalls)
    .where(
      and(
        eq(chatPendingToolCalls.id, confirmationRequestId),
        eq(chatPendingToolCalls.founderUserId, ctx.founderUserId),
      ),
    );
  if (rows.length === 0) {
    return { artifact: { type: "text", markdown: "_(Confirmation request not found — may have expired.)_" } };
  }
  const row = rows[0];
  await db.delete(chatPendingToolCalls).where(eq(chatPendingToolCalls.id, confirmationRequestId));
  await ctx.auditLog(`tool_cancelled:${row.toolName}`, row.args as unknown, { reason: reason ?? null });
  return {
    artifact: {
      type: "text",
      markdown: `Cancelled \`${row.toolName}\`${reason ? `: ${reason}` : "."}`,
    },
  };
}

function serializeCtxForPersistence(ctx: FounderToolContext): Record<string, unknown> {
  // auditLog is a closure; can't serialize it. Strip it and rebuild on confirm.
  const { auditLog: _omit, ...rest } = ctx;
  return rest as Record<string, unknown>;
}

/**
 * Test-only — clear the cooldown tracker. Auto-installs an in-memory
 * override on first call so existing test suites that mock `db` (without
 * `onConflictDoUpdate` support) continue to work without changes. Tests
 * that need to exercise the real DB-backed path should call
 * `__setCooldownOverrideForTests(null)` first.
 */
export function __resetCooldownTrackerForTests(): void {
  if (!__cooldownOverrideForTests) {
    const map = new Map<string, number>();
    __cooldownOverrideForTests = {
      get: (k) => map.get(k),
      set: (k, v) => void map.set(k, v),
      clear: () => map.clear(),
    };
  }
  __cooldownOverrideForTests.clear();
}

/**
 * Cleanup helper: delete cooldown rows whose last_confirmed_at is older
 * than `olderThanMs` (default 1 hour — well past TIER3_COOLDOWN_MS). Small
 * table, so this is a nice-to-have, not a SLO concern. Wire into the cron
 * supervisor next to the other housekeeping jobs.
 */
export async function pruneExpiredCooldowns(olderThanMs = 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  try {
    const result = await db
      .delete(chatToolCooldowns)
      .where(sql`${chatToolCooldowns.lastConfirmedAt} < ${cutoff}`)
      .returning({ userId: chatToolCooldowns.userId });
    return result.length;
  } catch (err) {
    logger.warn("[founder-chat] pruneExpiredCooldowns failed", {
      metadata: { error: String(err) },
    });
    return 0;
  }
}
