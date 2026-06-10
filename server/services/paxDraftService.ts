/**
 * Pax draft persistence + approval binding (2026-06-10, T0-6 elevation
 * blueprint).
 *
 * The witnessed-send contract is "Pax drafts, a human taps Send, every time."
 * For that contract to mean anything, the thing the human approved must be
 * the thing that sends. Before this module the approve-and-send endpoint
 * accepted client-resupplied subject/message — any payload got the trusted
 * send — and a double-tap sent twice.
 *
 * Now:
 *   1. The draft is persisted in pax_drafts the moment it is generated.
 *   2. Approval references draftId + a sha256 content hash of exactly that
 *      row; mismatches are rejected upstream.
 *   3. The pending→sent transition is a guarded UPDATE (WHERE status =
 *      'pending') so exactly ONE approval wins; the losing tap sees
 *      "already_sent" and returns the first result instead of re-sending.
 *
 * This is the minimal binding — the full pending_actions approval kernel
 * (Tier 1A) generalizes it to every approval-required tool.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { paxDrafts, type PaxDraft } from "@shared/schema";
import { logger } from "../utils/logger";

/** Canonical content hash binding an approval to an exact draft. */
export function draftContentHash(subject: string, message: string): string {
  return createHash("sha256").update(`${subject}\n${message}`, "utf8").digest("hex");
}

/**
 * Persist a pending draft for a lead, reusing an identical pending row if one
 * already exists (the wizard refetches the draft endpoint freely; we must not
 * mint a new approval target on every render).
 */
export async function upsertPendingDraft(params: {
  organizationId: number;
  leadId: number;
  channel: "email" | "sms";
  toAddress: string;
  subject: string;
  message: string;
}): Promise<PaxDraft> {
  const contentHash = draftContentHash(params.subject, params.message);

  const existing = await db
    .select()
    .from(paxDrafts)
    .where(
      and(
        eq(paxDrafts.organizationId, params.organizationId),
        eq(paxDrafts.leadId, params.leadId),
        eq(paxDrafts.channel, params.channel),
        eq(paxDrafts.status, "pending"),
        eq(paxDrafts.contentHash, contentHash),
      ),
    )
    .limit(1);

  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(paxDrafts)
    .values({
      organizationId: params.organizationId,
      leadId: params.leadId,
      channel: params.channel,
      toAddress: params.toAddress,
      subject: params.subject,
      message: params.message,
      contentHash,
    })
    .returning();

  return inserted[0];
}

export type DraftClaimResult =
  | { outcome: "not_found" }
  | { outcome: "hash_mismatch"; draft: PaxDraft }
  | { outcome: "already_sent"; draft: PaxDraft }
  | { outcome: "claimed"; draft: PaxDraft };

/**
 * Atomically claim a pending draft for sending.
 *
 * The guarded UPDATE (WHERE status = 'pending') is the idempotency gate: with
 * two concurrent taps, exactly one transitions the row to 'sent' and gets
 * "claimed"; the other observes zero updated rows and gets "already_sent".
 */
export async function claimDraftForSend(
  organizationId: number,
  draftId: number,
  contentHash: string,
): Promise<DraftClaimResult> {
  const rows = await db
    .select()
    .from(paxDrafts)
    .where(and(eq(paxDrafts.id, draftId), eq(paxDrafts.organizationId, organizationId)))
    .limit(1);

  const draft = rows[0];
  if (!draft) return { outcome: "not_found" };

  // The approval must be for EXACTLY this content. A stale or tampered hash
  // means the human did not witness what would send.
  if (draft.contentHash !== contentHash) {
    logger.warn("[paxDraftService] Draft hash mismatch on approval", {
      metadata: { draftId, organizationId },
    });
    return { outcome: "hash_mismatch", draft };
  }

  if (draft.status === "sent") return { outcome: "already_sent", draft };

  const claimed = await db
    .update(paxDrafts)
    .set({ status: "sent", sentAt: new Date() })
    .where(
      and(
        eq(paxDrafts.id, draftId),
        eq(paxDrafts.organizationId, organizationId),
        eq(paxDrafts.status, "pending"),
      ),
    )
    .returning();

  if (claimed.length === 0) {
    // Lost the race — the other tap claimed it between our read and update.
    const reread = await db
      .select()
      .from(paxDrafts)
      .where(and(eq(paxDrafts.id, draftId), eq(paxDrafts.organizationId, organizationId)))
      .limit(1);
    return { outcome: "already_sent", draft: reread[0] ?? draft };
  }

  return { outcome: "claimed", draft: claimed[0] };
}

/**
 * Record the result of the claimed send. On success, store the provider
 * message id. On failure, release the claim back to 'pending' so the human
 * can retry — the claim must not eat the draft when nothing actually sent.
 */
export async function recordDraftSendResult(
  organizationId: number,
  draftId: number,
  result: { success: boolean; messageId?: string | null },
): Promise<void> {
  if (result.success) {
    await db
      .update(paxDrafts)
      .set({ sentMessageId: result.messageId ?? null })
      .where(and(eq(paxDrafts.id, draftId), eq(paxDrafts.organizationId, organizationId)));
  } else {
    await db
      .update(paxDrafts)
      .set({ status: "pending", sentAt: null })
      .where(and(eq(paxDrafts.id, draftId), eq(paxDrafts.organizationId, organizationId)));
  }
}
