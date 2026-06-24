/**
 * The structural approval kernel (2026-06-10, Tier 1A elevation blueprint).
 *
 * Generalizes the T0-6 draft-bound approve-and-send (paxDraftService) from
 * "the one email draft" to EVERY approval-required tool. The contract:
 *
 *   1. executeTool (server/ai/tools.ts) consults APPROVAL_REQUIRED_TOOLS
 *      INSIDE itself. An invocation without the server-side
 *      `trustedApproval` option does not execute — it freezes the call here
 *      as a pending_actions row (tool + frozen args + sha256 content hash of
 *      the canonicalized args + expiry) and returns a pending artifact.
 *   2. The approve endpoint executes THAT row: org-checked, expiry-checked,
 *      content-hash re-verified against the frozen args, idempotent via the
 *      guarded pending→approved UPDATE (exactly one approval wins; the
 *      second tap returns the first result).
 *   3. Every kernel-executed send is recorded in the append-only pax_sends
 *      audit. There is no UPDATE path to pax_sends anywhere.
 *
 * Witnessed-send becomes unbypassable BY CONSTRUCTION: there is no code path
 * from a model tool call to a live send that does not pass through a human
 * tap on a frozen, hash-verified row. The model cannot set trustedApproval
 * (it is an ExecuteToolOptions field, never a tool arg), and `_approved`
 * arriving in args is stripped upstream as defense-in-depth.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { pendingActions, paxSends, type PendingAction } from "@shared/schema";
import { logger } from "../utils/logger";

/**
 * Tools that require an explicit human approval before execution
 * (communication + payment tools). Enforced inside executeTool itself — not
 * at call sites — so every caller (chat, streaming chat, vaService, app
 * intents, future surfaces) inherits the gate automatically.
 *
 * (Re-exported from server/ai/tools.ts for existing importers.)
 */
export const APPROVAL_REQUIRED_TOOLS: ReadonlySet<string> = new Set([
  "send_email",
  "send_sms",
  "send_gmail",
  "send_slack_message",
  "create_stripe_payment_link",
]);

/** Pending approvals expire after 24 hours — stale drafts must be re-witnessed. */
export const PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

// ── Canonicalization + content hash ──────────────────────────────────────────

/**
 * Deterministic JSON: object keys sorted recursively so the hash is stable
 * across property-order differences. Arrays keep their order (order is
 * semantic). undefined values are dropped (matching JSON.stringify).
 */
export function canonicalizeToolArgs(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

/** sha256 binding an approval to exactly this tool + these frozen args. */
export function actionContentHash(toolName: string, args: Record<string, unknown>): string {
  return createHash("sha256")
    .update(`${toolName}\n${canonicalizeToolArgs(args)}`, "utf8")
    .digest("hex");
}

// ── Channel / recipient derivation for the pax_sends audit ──────────────────

const TOOL_CHANNELS: Record<string, string> = {
  send_email: "email",
  send_gmail: "email",
  send_sms: "sms",
  send_slack_message: "slack",
  create_stripe_payment_link: "stripe",
};

export function toolChannel(toolName: string): string {
  return TOOL_CHANNELS[toolName] ?? "other";
}

/** Best-effort recipient reference for the audit row (no new PII classes). */
export function toolRecipientRef(toolName: string, args: Record<string, unknown>): string | null {
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  return (
    str(args.email) ??
    str(args.phone_number) ??
    str(args.to) ??
    str(args.channel) ??
    (typeof args.lead_id === "number" ? `lead:${args.lead_id}` : null)
  );
}

// ── Propose (the executeTool gate) ───────────────────────────────────────────

/**
 * Freeze an approval-required tool call as a pending_actions row. Reuses an
 * identical live pending row (same org + tool + content hash) instead of
 * minting a new approval target every time the model re-proposes the same
 * action in one conversation.
 */
export async function proposePendingAction(params: {
  organizationId: number;
  toolName: string;
  args: Record<string, unknown>;
  createdByUserId?: string | null;
}): Promise<PendingAction> {
  const contentHash = actionContentHash(params.toolName, params.args);
  const now = Date.now();

  const existing = await db
    .select()
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.organizationId, params.organizationId),
        eq(pendingActions.toolName, params.toolName),
        eq(pendingActions.contentHash, contentHash),
        eq(pendingActions.status, "pending"),
      ),
    );

  const live = existing.find((row) => row.expiresAt && row.expiresAt.getTime() > now);
  if (live) return live;

  const inserted = await db
    .insert(pendingActions)
    .values({
      organizationId: params.organizationId,
      toolName: params.toolName,
      args: params.args,
      contentHash,
      status: "pending",
      expiresAt: new Date(now + PENDING_ACTION_TTL_MS),
      createdByUserId: params.createdByUserId ?? null,
    })
    .returning();

  logger.info("[approvalKernel] Pending action proposed", {
    metadata: {
      pendingActionId: inserted[0].id,
      organizationId: params.organizationId,
      toolName: params.toolName,
    },
  });

  return inserted[0];
}

/**
 * The artifact executeTool returns INSTEAD of executing. Shaped so the chat
 * UI can render an Approve/Reject card and so the model can tell the user a
 * human tap is required.
 */
export function pendingActionArtifact(row: PendingAction): Record<string, unknown> {
  return {
    pendingApproval: true,
    requiresApproval: true,
    pendingActionId: row.id,
    toolName: row.toolName,
    channel: toolChannel(row.toolName),
    args: row.args,
    contentHash: row.contentHash,
    expiresAt: row.expiresAt,
    note: "Action prepared and held for approval. Nothing executes until the user taps Approve — tell the user to review and approve it in the chat.",
  };
}

// ── Approve / reject ─────────────────────────────────────────────────────────

export type ToolExecutionResult = { success: boolean; data?: unknown; error?: string };

export type ApprovalOutcome =
  | { outcome: "not_found" }
  | { outcome: "expired" }
  | { outcome: "rejected" }
  | { outcome: "hash_mismatch" }
  | { outcome: "in_flight" }
  | { outcome: "already_executed"; action: PendingAction; result: Record<string, unknown> | null }
  | { outcome: "executed"; action: PendingAction; result: Record<string, unknown> }
  | { outcome: "execution_failed"; error: string };

/**
 * Approve and execute exactly one pending action.
 *
 * `execute` is injected by the route (it calls executeTool with
 * { trustedApproval: true }) so this module never imports the tool layer —
 * no import cycle, and the kernel's state machine is unit-testable against
 * the DB mock alone.
 *
 * Idempotency: the guarded pending→approved UPDATE means exactly one
 * approval claims the row. A second approve of an executed row returns the
 * stored result without re-executing.
 */
export async function approvePendingAction(params: {
  organizationId: number;
  pendingActionId: number;
  approvedByUserId?: string | null;
  execute: (toolName: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}): Promise<ApprovalOutcome> {
  const { organizationId, pendingActionId } = params;

  const rows = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, pendingActionId), eq(pendingActions.organizationId, organizationId)));
  const action = rows[0];
  if (!action) return { outcome: "not_found" };

  if (action.status === "rejected") return { outcome: "rejected" };
  if (action.status === "executed") {
    return { outcome: "already_executed", action, result: action.resultSummary ?? null };
  }
  if (action.status === "expired" || !action.expiresAt || action.expiresAt.getTime() <= Date.now()) {
    if (action.status === "pending") {
      await db
        .update(pendingActions)
        .set({ status: "expired" })
        .where(
          and(
            eq(pendingActions.id, pendingActionId),
            eq(pendingActions.organizationId, organizationId),
            eq(pendingActions.status, "pending"),
          ),
        );
    }
    return { outcome: "expired" };
  }

  // Re-verify the content hash against the frozen args. If the stored row
  // no longer hashes to its recorded contentHash, something tampered with
  // the frozen args after the human saw them — refuse.
  const recomputed = actionContentHash(action.toolName, action.args as Record<string, unknown>);
  if (recomputed !== action.contentHash) {
    logger.warn("[approvalKernel] Content hash mismatch on approval — refusing", {
      metadata: { pendingActionId, organizationId, toolName: action.toolName },
    });
    return { outcome: "hash_mismatch" };
  }

  // Atomic claim: exactly one approval transitions pending→approved.
  const claimed = await db
    .update(pendingActions)
    .set({ status: "approved", approvedByUserId: params.approvedByUserId ?? null })
    .where(
      and(
        eq(pendingActions.id, pendingActionId),
        eq(pendingActions.organizationId, organizationId),
        eq(pendingActions.status, "pending"),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    // Lost the race. Re-read to see how it resolved.
    const reread = await db
      .select()
      .from(pendingActions)
      .where(and(eq(pendingActions.id, pendingActionId), eq(pendingActions.organizationId, organizationId)));
    const current = reread[0];
    if (current?.status === "executed") {
      return { outcome: "already_executed", action: current, result: current.resultSummary ?? null };
    }
    if (current?.status === "rejected") return { outcome: "rejected" };
    return { outcome: "in_flight" };
  }

  // Execute EXACTLY the frozen row.
  const result = await params.execute(action.toolName, action.args as Record<string, unknown>);

  if (!result.success) {
    // Nothing actually sent — release the claim so the human can retry.
    await db
      .update(pendingActions)
      .set({ status: "pending", approvedByUserId: null })
      .where(
        and(
          eq(pendingActions.id, pendingActionId),
          eq(pendingActions.organizationId, organizationId),
          eq(pendingActions.status, "approved"),
        ),
      );
    return { outcome: "execution_failed", error: result.error ?? "Tool execution failed" };
  }

  const resultSummary: Record<string, unknown> = { success: true, data: result.data ?? null };
  const executedRows = await db
    .update(pendingActions)
    .set({ status: "executed", executedAt: new Date(), resultSummary })
    .where(
      and(
        eq(pendingActions.id, pendingActionId),
        eq(pendingActions.organizationId, organizationId),
        eq(pendingActions.status, "approved"),
      ),
    )
    .returning();

  // Append-only audit of the executed send. INSERT only — by contract there
  // is no UPDATE path to pax_sends anywhere in the codebase.
  await db.insert(paxSends).values({
    organizationId,
    pendingActionId: action.id,
    toolName: action.toolName,
    channel: toolChannel(action.toolName),
    recipientRef: toolRecipientRef(action.toolName, action.args as Record<string, unknown>),
    contentHash: action.contentHash,
  });

  // Foundry move #3: persist a tamper-evident, principal-attributed proof-receipt
  // for this customer-Pax witnessed send too (same artifact the autopilot hands
  // emit), scoped to the org and attributed to the approving human. Non-fatal:
  // recordReceipt swallows its own errors — the send already happened.
  try {
    const { recordReceipt } = await import("./autopilot/proofReceiptStore");
    const { orgScope } = await import("./autopilot/tenantScope");
    await recordReceipt({
      actionKind: action.toolName,
      scope: orgScope(organizationId),
      payloadHash: action.contentHash,
      accountableHumanId: action.approvedByUserId ?? params.approvedByUserId ?? "unknown",
    });
  } catch { /* non-fatal — proof-receipt persistence must never block a send */ }

  // Tier 2C — server-side funnel truth. first_value_reached used to be a
  // client-side PostHog event fired when onboarding was marked complete —
  // i.e. "clicked through the wizard," not "got value." The witnessed send
  // (this append-only pax_sends row) is the real first-value moment: a human
  // approved and the platform executed an outbound action on their behalf.
  // recordActivationEvent is first-occurrence-idempotent on (org, eventName),
  // so only the org's FIRST witnessed send ever records it. Fire-and-forget.
  try {
    const { recordActivationEventAsync } = await import("./activation");
    recordActivationEventAsync({
      orgId: organizationId,
      userId: action.approvedByUserId ?? action.createdByUserId ?? null,
      eventName: "first_value_reached",
      eventValue: {
        source: "pax_witnessed_send",
        toolName: action.toolName,
        pendingActionId: action.id,
      },
    });
  } catch { /* non-fatal — funnel telemetry must never block a send */ }

  logger.info("[approvalKernel] Pending action executed after human approval", {
    metadata: { pendingActionId, organizationId, toolName: action.toolName },
  });

  return { outcome: "executed", action: executedRows[0] ?? action, result: resultSummary };
}

export type RejectionOutcome =
  | { outcome: "not_found" }
  | { outcome: "already_executed" }
  | { outcome: "rejected"; action: PendingAction };

/** Reject a pending action — terminal; the row can never execute afterwards. */
export async function rejectPendingAction(params: {
  organizationId: number;
  pendingActionId: number;
}): Promise<RejectionOutcome> {
  const { organizationId, pendingActionId } = params;

  const updated = await db
    .update(pendingActions)
    .set({ status: "rejected" })
    .where(
      and(
        eq(pendingActions.id, pendingActionId),
        eq(pendingActions.organizationId, organizationId),
        eq(pendingActions.status, "pending"),
      ),
    )
    .returning();

  if (updated.length > 0) return { outcome: "rejected", action: updated[0] };

  const reread = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, pendingActionId), eq(pendingActions.organizationId, organizationId)));
  const current = reread[0];
  if (!current) return { outcome: "not_found" };
  if (current.status === "executed") return { outcome: "already_executed" };
  // Already rejected/expired — rejection is idempotent enough to report success.
  return { outcome: "rejected", action: current };
}
