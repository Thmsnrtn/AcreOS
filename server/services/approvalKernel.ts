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
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import { pendingActions, paxSends, type PendingAction } from "@shared/schema";
import { logger } from "../utils/logger";
import { wsServer } from "../websocket";
import { dispatchForTool, type PaxAskOrigin, type PaxAskSourceRef } from "@shared/pax-controls";

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
  /** Which lane proposed it (PAX_ASK_ORIGINS). Rendered on the ask card in words. */
  origin?: PaxAskOrigin | null;
  /** The record the ask is about — frozen with the row (migration 0250). */
  sourceRef?: PaxAskSourceRef | null;
  /** Pax's own explanation, verbatim; never a number. */
  reason?: string | null;
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
      origin: params.origin ?? null,
      sourceRef: params.sourceRef ?? null,
      reason: typeof params.reason === "string" && params.reason.length > 0 ? params.reason : null,
    })
    .returning();

  logger.info("[approvalKernel] Pending action proposed", {
    metadata: {
      pendingActionId: inserted[0].id,
      organizationId: params.organizationId,
      toolName: params.toolName,
    },
  });

  // Review-queue plumbing (2026-09-02): nudge the org's pending-approval
  // badges to refetch live instead of waiting on their poll (same shape as
  // the inbox.unread publish in inboundEmailService). Org-scoped — the queue
  // is per-org. Fires only for a genuinely NEW row: a reused live duplicate
  // (above) changes nothing a badge counts. Best-effort: the row is already
  // persisted, so a WS failure must never fail the proposal.
  try {
    wsServer.broadcastToOrg(params.organizationId, "pending_action.created", { id: inserted[0].id });
  } catch (err) {
    logger.warn(
      "[approvalKernel] failed to publish pending_action.created over WebSocket (poll fallback remains)",
      err instanceof Error ? err : undefined,
    );
  }
  // "Waiting for your tap (N)" — the door badge and the pinned strip read the
  // COUNT (spec §4.5); the id-only event above is kept for its existing pin.
  await publishNeedsYou(params.organizationId);

  // The socket only reaches a tab that is OPEN. The notification lane is how
  // a customer who is not looking at the app finds out an ask is waiting —
  // their own tray row and, by their own preference, an email. This call was
  // the missing half of wave 1: notificationDispatcher.dispatchPaxAskEvent
  // named "the kernel on a genuinely NEW pending_actions row" as its caller
  // in its own header, and nothing called it, so the whole lane was built and
  // never fired (2026-09-04 central verification). Best-effort by the same
  // contract as the broadcast above: the ask is a fact already.
  try {
    const { dispatchPaxAskEvent } = await import("./notificationDispatcher");
    await dispatchPaxAskEvent({
      type: "pax:needs_you",
      orgId: params.organizationId,
      pendingActionId: inserted[0].id,
      count: await countPendingActions(params.organizationId),
    });
  } catch (err) {
    logger.warn(
      "[approvalKernel] pax:needs_you notification failed (the ask is queued regardless)",
      err instanceof Error ? err : undefined,
    );
  }

  return inserted[0];
}

// ── "Waiting for your tap" live count ────────────────────────────────────────

/** The one event name the badge, the strip and the queue invalidate on. */
const PAX_NEEDS_YOU_EVENT = "pax.needs_you";

/**
 * Publish the org's live ask count on its WebSocket channel. Called from
 * every transition that can change the count — propose, approve (executed
 * and lazy-expire), reject, revise, and the expiry sweep. Best-effort by
 * contract: the row transition is already persisted, and a badge that is
 * late is a poll away; a badge that FAILS the kernel would be a second
 * effect nobody asked for. Never throws.
 */
async function publishNeedsYou(organizationId: number): Promise<void> {
  try {
    const count = await countPendingActions(organizationId);
    wsServer.broadcastToOrg(organizationId, PAX_NEEDS_YOU_EVENT, { count });
  } catch (err) {
    logger.warn(
      `[approvalKernel] failed to publish ${PAX_NEEDS_YOU_EVENT} over WebSocket (poll fallback remains)`,
      { orgId: organizationId, metadata: { error: err instanceof Error ? err.message : String(err) } },
    );
  }
}

// ── Review queue: list / count / expiry sweep ───────────────────────────────
//
// Customer-side plumbing for "what is waiting on a human tap right now"
// (autonomy clarity program, 2026-09-02). Expiry is written lazily (approve
// on a stale row, plus the daily sweep below), so `status = 'pending'` alone
// OVER-counts: a row past its TTL is not reviewable. Every reader therefore
// applies the live predicate itself — status AND expires_at > now() — the
// same discipline as the founder's listPendingHands. Both pending_actions
// indexes lead with organization_id, so each read is one index range.

/** The predicate every review-queue reader must apply (org + pending + unexpired). */
function livePendingPredicate(organizationId: number) {
  return and(
    eq(pendingActions.organizationId, organizationId),
    eq(pendingActions.status, "pending"),
    sql`${pendingActions.expiresAt} > now()`,
  );
}

const PENDING_LIST_DEFAULT_LIMIT = 50;
const PENDING_LIST_MAX_LIMIT = 200;

/** Live (pending, unexpired) actions for one org, newest first. */
export async function listPendingActions(
  organizationId: number,
  { limit = PENDING_LIST_DEFAULT_LIMIT }: { limit?: number } = {},
): Promise<PendingAction[]> {
  const cap = Number.isFinite(limit)
    ? Math.min(Math.max(1, Math.floor(limit)), PENDING_LIST_MAX_LIMIT)
    : PENDING_LIST_DEFAULT_LIMIT;
  return db
    .select()
    .from(pendingActions)
    .where(livePendingPredicate(organizationId))
    .orderBy(desc(pendingActions.createdAt))
    .limit(cap);
}

/** Badge count: how many live actions await a tap in this org. Same predicate as the list. */
export async function countPendingActions(organizationId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pendingActions)
    .where(livePendingPredicate(organizationId));
  return Number(row?.count ?? 0);
}

/**
 * Flip every pending row past its TTL to 'expired'. Deliberately cross-org
 * (a platform bookkeeping sweep, like the referral-maturity sweep — it
 * writes no org's data INTO another's; it only stamps a status the readers
 * already treat as expired). Guarded UPDATE on `status = 'pending'` so a
 * re-run finds nothing to flip — idempotent by construction. Returns the
 * number of rows flipped on THIS run.
 */
export async function sweepExpiredPendingActions(): Promise<number> {
  const flipped = await unscopedForPlatformOps(
    "pending-action expiry sweep: cross-org status stamp (pending -> expired past TTL); writes no org's data into another's",
  )
    .update(pendingActions)
    .set({ status: "expired" })
    .where(and(eq(pendingActions.status, "pending"), sql`${pendingActions.expiresAt} <= now()`))
    .returning({ id: pendingActions.id, organizationId: pendingActions.organizationId });
  // One count per org TOUCHED — never a cross-org broadcast, and nothing for
  // orgs the sweep did not change.
  const orgs = new Set<number>();
  for (const row of flipped) if (typeof row.organizationId === "number") orgs.add(row.organizationId);
  for (const orgId of orgs) await publishNeedsYou(orgId);
  return flipped.length;
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
      await publishNeedsYou(organizationId);
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

  await publishNeedsYou(organizationId);

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

  if (updated.length > 0) {
    await publishNeedsYou(organizationId);
    return { outcome: "rejected", action: updated[0] };
  }

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

// ── Revise (Edit on the ask card, spec §4.5) ────────────────────────────────

export type RevisionOutcome =
  | { ok: true; newId: number }
  | { ok: false; reason: "not_found" | "not_pending" | "invalid_args"; details?: unknown };

/**
 * A JSON-schema tool definition, the shape both dispatch switches declare
 * (OpenAI function-calling format). Only the subset the definitions use.
 */
interface JsonSchemaNode {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  enum?: readonly (string | number)[];
  items?: JsonSchemaNode;
  description?: string;
}

/**
 * Build a STRICT zod schema from a tool's JSON-schema parameters, so a
 * revised ask is validated against the tool's OWN definition: a key the
 * tool does not declare is refused, a required key that is missing is
 * refused, an enum value the tool does not offer is refused. Everything
 * the tool declares as optional stays optional. Unknown node shapes fall
 * back to `unknown` rather than refusing the whole edit.
 */
function zodFromToolParameters(node: JsonSchemaNode | undefined): z.ZodTypeAny {
  if (!node || typeof node !== "object") return z.unknown();
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const values = node.enum.filter((v): v is string => typeof v === "string");
    if (values.length === node.enum.length && values.length > 0) {
      return z.enum(values as [string, ...string[]]);
    }
    return z.union(node.enum.map((v) => z.literal(v)) as unknown as [z.ZodTypeAny, z.ZodTypeAny]);
  }
  switch (node.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(zodFromToolParameters(node.items));
    case "object": {
      const required = new Set(node.required ?? []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        const inner = zodFromToolParameters(child);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      return z.object(shape).strict();
    }
    default:
      return z.unknown();
  }
}

/** Frozen shape of the borrower ladder's ask (spec §4.4; frozen contract 2). */
const BORROWER_REMINDER_ARGS = z
  .object({
    reminderId: z.number().int().positive(),
    noteId: z.number().int().positive(),
    type: z.enum(["upcoming", "due", "late", "final_warning", "demand_letter"]),
  })
  .strict();

/**
 * The tool's own definition, looked up by the rail that runs the name. The
 * dispatch switches are imported lazily — they are large graphs, and both
 * import THIS module, so a static import here would be a cycle.
 */
async function toolArgsSchema(toolName: string): Promise<z.ZodTypeAny | null> {
  switch (dispatchForTool(toolName)) {
    case "executeTool": {
      const { toolDefinitions } = await import("../ai/tools");
      const def = (toolDefinitions as Record<string, { parameters?: JsonSchemaNode }>)[toolName];
      return def ? zodFromToolParameters(def.parameters) : null;
    }
    case "executeSupportTool": {
      const { supportToolDefinitions } = await import("../ai/supportAgent");
      const def = (supportToolDefinitions as Record<string, { parameters?: JsonSchemaNode }>)[toolName];
      return def ? zodFromToolParameters(def.parameters) : null;
    }
    case "finance_ladder":
      return BORROWER_REMINDER_ARGS;
    default:
      return null;
  }
}

/**
 * Edit → revise. Validates the human's args against the tool's own
 * definition, then in ONE transaction inserts the revised row (created by
 * the human, origin "revised", fresh content hash, same expiry policy) and
 * claims the old row pending→rejected with a guarded `WHERE status =
 * 'pending'` UPDATE whose resultSummary points at the new row. If the guard
 * claims nothing — the old row was approved, rejected, expired or already
 * revised by a concurrent tap — the transaction rolls back and the revised
 * row never exists: a double tap yields ONE new row, so one approval, so
 * one send. Approval of the new row replays through the kernel like any
 * other ask.
 */
export async function revisePendingAction(params: {
  organizationId: number;
  pendingActionId: number;
  userId: string;
  args: Record<string, unknown>;
}): Promise<RevisionOutcome> {
  const { organizationId, pendingActionId, userId } = params;

  const rows = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, pendingActionId), eq(pendingActions.organizationId, organizationId)));
  const current = rows[0];
  if (!current) return { ok: false, reason: "not_found" };
  if (current.status !== "pending" || !current.expiresAt || current.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "not_pending" };
  }

  const schema = await toolArgsSchema(current.toolName);
  if (!schema) {
    return { ok: false, reason: "invalid_args", details: `no definition for ${current.toolName}` };
  }
  const parsed = schema.safeParse(params.args);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_args",
      details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const args = parsed.data as Record<string, unknown>;
  const contentHash = actionContentHash(current.toolName, args);

  class NotPendingError extends Error {}

  let newId: number;
  try {
    newId = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(pendingActions)
        .values({
          organizationId,
          toolName: current.toolName,
          args,
          contentHash,
          status: "pending",
          expiresAt: new Date(Date.now() + PENDING_ACTION_TTL_MS),
          createdByUserId: userId,
          origin: "revised",
          sourceRef: current.sourceRef ?? null,
          reason: current.reason ?? null,
        })
        .returning({ id: pendingActions.id });

      const claimed = await tx
        .update(pendingActions)
        .set({ status: "rejected", resultSummary: { revisedTo: inserted.id } })
        .where(
          and(
            eq(pendingActions.id, pendingActionId),
            eq(pendingActions.organizationId, organizationId),
            eq(pendingActions.status, "pending"),
          ),
        )
        .returning({ id: pendingActions.id });
      if (claimed.length === 0) throw new NotPendingError("lost the revise race");
      return inserted.id;
    });
  } catch (err) {
    if (err instanceof NotPendingError) return { ok: false, reason: "not_pending" };
    throw err;
  }

  logger.info("[approvalKernel] Pending action revised", {
    metadata: { organizationId, pendingActionId, newId, toolName: current.toolName },
  });
  await publishNeedsYou(organizationId);
  return { ok: true, newId };
}
