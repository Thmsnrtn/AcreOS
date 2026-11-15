/**
 * Borrower-message lender notification — the S-05 wire (P1-4b).
 *
 * The defect: a borrower's portal message (`POST /api/borrower/messages`)
 * wrote a `borrower_messages` row and nothing else. The lender-side read
 * routes existed but no client called them and no notification fired, so a
 * borrower could write into a void and the lender — the customer — never
 * saw it. The borrower is a counterparty: being silently ignored by their
 * servicer is a complaint/regulator shape, not a UX shape.
 *
 * This module is the notification leg, called AFTER the message row is
 * written (the borrower's send must never fail because notifying the
 * lender did):
 *
 *  - PUSH — `pushOrgEvent` family `borrower_message`, which gates every
 *    recipient through `getPushEligibility` on the `finance.borrower_message`
 *    preference event: a globally muted user, or a user who turned push
 *    off for borrower messages, receives NO push. Muted means muted.
 *  - IN-APP — one `notifications` row per active org team member whose
 *    stored preferences allow it (`shouldNotify(…, "inApp")` — which also
 *    refuses a globally muted user). The row's entity link lands on the
 *    note, where the lender inbox panel renders the thread.
 *
 * Contract:
 *  - BEST EFFORT. Never throws: every leg is individually guarded and a
 *    failure is logged, never propagated to the borrower's request.
 *  - NO COUNTERPARTY PII ON THE LOCK SCREEN. The push payload names the
 *    note, never the borrower, and carries no message text. The in-app
 *    row (inside the lender's own authenticated app) carries a short
 *    preview of the message the borrower sent to that lender.
 *  - ORG-SCOPED. Both legs key on the message's own `orgId` — the org the
 *    note belongs to — never on a session or caller scope.
 */

import { storage } from "../storage";
import { logger } from "../utils/logger";
import { pushOrgEvent } from "./orgPushFanout";
import { notificationPrefsService } from "./notificationPreferences";

export const BORROWER_MESSAGE_EVENT_ID = "finance.borrower_message";

export interface BorrowerMessageNotice {
  orgId: number;
  noteId: number;
  messageId: number;
  /** The borrower's message text (already sanitised by the send route). */
  content: string;
}

interface BorrowerMessageNotifyResult {
  /** At least one device accepted the push. */
  pushed: boolean;
  /** In-app notification rows written. */
  inApp: number;
}

const PREVIEW_CHARS = 140;

export async function notifyLenderOfBorrowerMessage(
  notice: BorrowerMessageNotice,
): Promise<BorrowerMessageNotifyResult> {
  const result: BorrowerMessageNotifyResult = { pushed: false, inApp: 0 };
  if (!Number.isInteger(notice.orgId) || notice.orgId <= 0) return result;
  if (!Number.isInteger(notice.noteId) || notice.noteId <= 0) return result;

  // Leg 1 — push (mute-gated inside pushOrgEvent via getPushEligibility).
  try {
    result.pushed = await pushOrgEvent(notice.orgId, {
      family: "borrower_message",
      title: "New borrower message",
      body: "A borrower sent a message on one of your notes. Open the note to read and reply.",
      url: `/notes/${notice.noteId}`,
      tag: `borrower-message-note-${notice.noteId}`,
    });
  } catch (err) {
    logger.warn("[BorrowerMessageNotify] push leg failed (message unaffected)", {
      metadata: {
        orgId: notice.orgId,
        noteId: notice.noteId,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }

  // Leg 2 — in-app rows for the org's active team members, each by their
  // own stored preference (shouldNotify refuses a global mute first).
  try {
    const members = await storage.getTeamMembers(notice.orgId);
    const preview = notice.content.slice(0, PREVIEW_CHARS);
    for (const member of members) {
      if (!member.isActive || !member.userId) continue;
      try {
        const allowed = await notificationPrefsService.shouldNotify(
          member.userId,
          notice.orgId,
          BORROWER_MESSAGE_EVENT_ID,
          "inApp",
        );
        if (!allowed) continue;
        await storage.createNotification({
          organizationId: notice.orgId,
          userId: member.userId,
          type: BORROWER_MESSAGE_EVENT_ID,
          title: "New borrower message",
          message: preview,
          entityType: "note",
          entityId: notice.noteId,
          metadata: {
            source: "borrower_message",
            noteId: notice.noteId,
            borrowerMessageId: notice.messageId,
            actionUrl: `/notes/${notice.noteId}`,
          },
        });
        result.inApp++;
      } catch (err) {
        logger.error(
          "[BorrowerMessageNotify] in-app row failed for a member (message unaffected)",
          err instanceof Error ? err : undefined,
        );
      }
    }
  } catch (err) {
    logger.error(
      "[BorrowerMessageNotify] in-app leg failed (message unaffected)",
      err instanceof Error ? err : undefined,
    );
  }

  return result;
}
