/**
 * Rafe (CCO) — founder recourse surface (the Recourse Loop).
 *
 * Every NEGATIVE customer signal (detractor NPS ≤6, low support rating ≤2/5,
 * cancellation) flows INWARD today — we alert ourselves and the customer hears
 * crickets. This surface flips it: one founder queue of drafted, personal,
 * same-hour human replies, each pre-filled from the customer's verbatim words +
 * account context, one-click to edit-and-send, with the sent reply persisted
 * back so the loop is auditable.
 *
 * Distinct from /founder/appeals (E2's "appeal the AI" surface) — that's a
 * verdict on a Pax refusal; this is the human reply to a dissatisfaction
 * signal. They share nothing but the founder-gate.
 *
 *   GET  /api/founder/recourse
 *     The queue. Runs the aggregation sweep first (idempotent), then returns
 *     open drafts (status=draft) across all orgs, each with its generated
 *     draft body, verbatim, and context. ?status=all for the full ledger.
 *
 *   POST /api/founder/recourse/:id/draft
 *     (Re)generate the model draft for one row — for rows that have no body
 *     yet, or to ask for a fresh take.
 *
 *   POST /api/founder/recourse/:id/send
 *     Body: { body }. The founder's final (edited) reply. Delivers it via the
 *     lifecycle-email registry (sendRegisteredEmail), persists sent_body +
 *     sent_at + email_status, and flips status → sent. Closes the loop.
 *
 *   POST /api/founder/recourse/:id/dismiss
 *     Drop a draft without sending (e.g. already handled out-of-band).
 *
 * Auth: isAuthenticated + requireFounder on every route.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { db } from "./db";
import {
  recourseDrafts,
  organizations,
  type RecourseSignalType,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { sendRegisteredEmail } from "./services/emailRegistry";
import {
  aggregateRecourseSignals,
  generateDraftReply,
} from "./services/recourseDrafter";

const sendSchema = z.object({
  // The founder's final, post-edit reply. Required — sending a blank reply
  // would defeat the entire purpose (a personal, situation-specific touch).
  body: z
    .string()
    .trim()
    .min(1, "Write the customer a reply before sending")
    .max(6_000),
});

/**
 * Resolve a deliverable address for a draft: the cached recipient_email, else
 * the recipient user, else the org owner. Returns null if nothing deliverable.
 */
async function resolveRecipient(row: {
  recipientEmail: string | null;
  recipientUserId: string | null;
  organizationId: number;
}): Promise<{ email: string; firstName: string | null } | null> {
  if (row.recipientEmail) {
    // We still want a first name for the greeting if we can get one.
    if (row.recipientUserId) {
      const [u] = await db
        .select({ firstName: users.firstName })
        .from(users)
        .where(eq(users.id, row.recipientUserId))
        .limit(1);
      return { email: row.recipientEmail, firstName: u?.firstName ?? null };
    }
    return { email: row.recipientEmail, firstName: null };
  }

  if (row.recipientUserId) {
    const [u] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, row.recipientUserId))
      .limit(1);
    if (u?.email) return { email: u.email, firstName: u.firstName ?? null };
  }

  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, row.organizationId))
    .limit(1);
  if (org?.ownerId) {
    const [owner] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, org.ownerId))
      .limit(1);
    if (owner?.email)
      return { email: owner.email, firstName: owner.firstName ?? null };
  }
  return null;
}

function signalLabel(t: RecourseSignalType): string {
  return t === "detractor_nps"
    ? "Detractor NPS"
    : t === "low_support_rating"
      ? "Low support rating"
      : "Cancellation";
}

export function registerFounderRecourseRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // GET /api/founder/recourse — the queue (runs the sweep, returns drafts).
  // -------------------------------------------------------------------------
  app.get(
    "/api/founder/recourse",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const status = typeof req.query.status === "string" ? req.query.status : "open";

      try {
        // Idempotent sweep: pull any new negative signals into the ledger so
        // the queue is current. Best-effort — a sweep failure must not blank
        // the queue, so we log and still return what's persisted.
        try {
          await aggregateRecourseSignals();
        } catch (sweepErr) {
          logger.warn("[founder-recourse] aggregation sweep failed", {
            metadata: {
              error:
                sweepErr instanceof Error ? sweepErr.message : String(sweepErr),
            },
          });
        }

        const statusFilter =
          status === "all"
            ? undefined
            : inArray(recourseDrafts.status, ["draft"]);

        const rows = await db
          .select({
            id: recourseDrafts.id,
            organizationId: recourseDrafts.organizationId,
            orgName: organizations.name,
            signalType: recourseDrafts.signalType,
            signalRefType: recourseDrafts.signalRefType,
            customerVerbatim: recourseDrafts.customerVerbatim,
            contextSummary: recourseDrafts.contextSummary,
            draftBody: recourseDrafts.draftBody,
            draftModel: recourseDrafts.draftModel,
            sentBody: recourseDrafts.sentBody,
            recipientEmail: recourseDrafts.recipientEmail,
            status: recourseDrafts.status,
            sentAt: recourseDrafts.sentAt,
            emailStatus: recourseDrafts.emailStatus,
            createdAt: recourseDrafts.createdAt,
          })
          .from(recourseDrafts)
          .leftJoin(
            organizations,
            eq(organizations.id, recourseDrafts.organizationId),
          )
          .where(statusFilter)
          .orderBy(desc(recourseDrafts.createdAt))
          .limit(100);

        const drafts = rows.map((r) => ({
          ...r,
          signalLabel: signalLabel(r.signalType as RecourseSignalType),
        }));

        return res.json({ drafts, count: drafts.length });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/founder/recourse/:id/draft — (re)generate the model draft.
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/recourse/:id/draft",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return Errors.badRequest(res, "draft id must be a positive integer");
      }

      try {
        const [row] = await db
          .select({ id: recourseDrafts.id, status: recourseDrafts.status })
          .from(recourseDrafts)
          .where(eq(recourseDrafts.id, id))
          .limit(1);
        if (!row) return Errors.notFound(res, "Recourse draft");
        if (row.status !== "draft") {
          return Errors.badRequest(
            res,
            "This reply has already been sent or dismissed.",
            { status: row.status },
          );
        }

        const body = await generateDraftReply(id);
        if (!body) {
          return Errors.internal(
            res,
            new Error("Draft generation returned no content"),
          );
        }
        return res.json({ draft: { id, draftBody: body } });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/founder/recourse/:id/send — deliver + persist + close the loop.
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/recourse/:id/send",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return Errors.badRequest(res, "draft id must be a positive integer");
      }

      const parsed = sendSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { body } = parsed.data;

      try {
        const [row] = await db
          .select()
          .from(recourseDrafts)
          .where(eq(recourseDrafts.id, id))
          .limit(1);
        if (!row) return Errors.notFound(res, "Recourse draft");

        // Idempotence: only an open draft can be sent. A second send on an
        // already-terminal row is rejected so we never double-email a customer.
        if (row.status !== "draft") {
          return Errors.badRequest(
            res,
            "This reply has already been sent or dismissed.",
            { status: row.status },
          );
        }

        const recipient = await resolveRecipient(row);
        if (!recipient) {
          return Errors.badRequest(
            res,
            "No deliverable email address for this customer. The reply can't be sent.",
          );
        }

        let emailStatus: "sent" | "suppressed" | "failed" = "failed";
        try {
          const result = await sendRegisteredEmail(
            "recourse_reply",
            {
              firstName: recipient.firstName ?? undefined,
              body,
            },
            {
              to: recipient.email,
              organizationId: row.organizationId,
            },
          );
          emailStatus = result.suppressed
            ? "suppressed"
            : result.success
              ? "sent"
              : "failed";
        } catch (emailErr) {
          emailStatus = "failed";
          logger.warn("[founder-recourse] reply email failed", {
            metadata: {
              draftId: id,
              error:
                emailErr instanceof Error ? emailErr.message : String(emailErr),
            },
          });
        }

        // A hard transport failure shouldn't burn the draft — keep it open so
        // the founder can retry. Suppressed (opted-out) still closes the loop:
        // the reply is recorded as the audit record either way.
        if (emailStatus === "failed") {
          return Errors.internal(
            res,
            new Error("The reply could not be delivered. Try again."),
          );
        }

        const sentAt = new Date();
        await db
          .update(recourseDrafts)
          .set({
            status: "sent",
            sentBody: body,
            sentAt,
            emailStatus,
            updatedAt: sentAt,
          })
          .where(
            and(
              eq(recourseDrafts.id, id),
              eq(recourseDrafts.status, "draft"),
            ),
          );

        logger.info("[founder-recourse] recourse reply sent", {
          metadata: {
            draftId: id,
            organizationId: row.organizationId,
            signalType: row.signalType,
            emailStatus,
          },
        });

        // F2 (one decision queue) — the founder just disposed this draft on
        // the deep surface; its mirror card on the decisions door resolves
        // itself. The sent body is customer content and stays in this ledger
        // — only the disposition line travels. Best-effort: never fail the
        // send on it.
        try {
          const { decisionsInboxService } = await import("./services/decisionsInbox");
          await decisionsInboxService.resolveMirrorItem({
            itemType: "recourse_draft",
            sourceId: id,
            status: "approved",
            detail: `Reply sent from the Recourse queue (email ${emailStatus}).`,
          });
        } catch (mirrorErr) {
          logger.warn("[founder-recourse] decisions-door mirror resolve failed (non-blocking)", {
            metadata: {
              draftId: id,
              error: mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr),
            },
          });
        }

        return res.json({
          draft: { id, status: "sent", sentAt },
          notification: { emailStatus },
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/founder/recourse/:id/dismiss — drop without sending.
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/recourse/:id/dismiss",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return Errors.badRequest(res, "draft id must be a positive integer");
      }

      // F2 reasons-on-disposition — optional one-line reason for dropping
      // the draft (e.g. "already handled by phone"). Recorded on the mirror
      // card's founderModification (the decisions ledger is where disposition
      // reasons live; recourse_drafts itself has no reason column and gains
      // none — no schema surgery in this slice).
      const dismissReason =
        typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 2000) : "";

      try {
        const [row] = await db
          .select({ id: recourseDrafts.id, status: recourseDrafts.status })
          .from(recourseDrafts)
          .where(eq(recourseDrafts.id, id))
          .limit(1);
        if (!row) return Errors.notFound(res, "Recourse draft");
        if (row.status === "sent") {
          return Errors.badRequest(
            res,
            "This reply has already been sent — it can't be dismissed.",
          );
        }

        const now = new Date();
        await db
          .update(recourseDrafts)
          .set({ status: "dismissed", updatedAt: now })
          .where(
            and(
              eq(recourseDrafts.id, id),
              inArray(recourseDrafts.status, ["draft"]),
            ),
          );

        // F2 — resolve the decisions-door mirror card (best-effort).
        try {
          const { decisionsInboxService } = await import("./services/decisionsInbox");
          await decisionsInboxService.resolveMirrorItem({
            itemType: "recourse_draft",
            sourceId: id,
            status: "rejected",
            detail: dismissReason
              ? `Dismissed from the Recourse queue — ${dismissReason}`
              : "Dismissed from the Recourse queue without sending.",
          });
        } catch (mirrorErr) {
          logger.warn("[founder-recourse] decisions-door mirror resolve failed (non-blocking)", {
            metadata: {
              draftId: id,
              error: mirrorErr instanceof Error ? mirrorErr.message : String(mirrorErr),
            },
          });
        }

        return res.json({ draft: { id, status: "dismissed" } });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  logger.info(
    "[founder-recourse] registered GET /api/founder/recourse + draft/send/dismiss",
  );
}
