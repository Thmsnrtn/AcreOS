/**
 * Quinn (Chief of Alignment) + Rafe (CCO) — founder appeal-review surface.
 *
 * The founder-gated half of the "appeal the AI" recourse loop. A customer
 * filed an appeal against a Pax refusal (routes-pax-appeals.ts); here the
 * founder/Beatrice reviews it WITH the full refusal context (the cited
 * immutable in plain language + the customer's stated reason) and renders a
 * verdict: UPHELD (the refusal stands) or REVERSED (the refusal was wrong).
 * Either way the outcome is recorded AND closed back to the customer — a
 * plain-language message persisted to the appeal row (surfaced in their Pax
 * thread) plus a lifecycle email (reusing sendRegisteredEmail).
 *
 *   GET  /api/founder/appeals
 *     Open/under-review appeals across all orgs, each joined to its refusal
 *     payload (cited immutable + plain-language text + the refusal the
 *     customer saw). The founder review queue.
 *
 *   POST /api/founder/appeals/:id/resolve
 *     Record the verdict. Body: { decision: "upheld" | "reversed",
 *     reviewNotes (internal rationale), customerMessage (plain-language
 *     outcome shown to the customer) }. Writes the terminal status, the
 *     reviewer, the timestamps, and fires the close-the-loop email.
 *
 * Auth: isAuthenticated + requireFounder on every route.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { db } from "./db";
import { paxRefusalPayloads } from "@shared/schema/pax-refusal-payloads";
import { paxDecisionAppeals } from "@shared/schema/pax-decision-appeals";
import { organizations } from "@shared/schema";
import { users } from "@shared/models/auth";
import { sendRegisteredEmail } from "./services/emailRegistry";

const resolveAppealSchema = z.object({
  decision: z.enum(["upheld", "reversed"]),
  // Internal rationale — never shown to the customer. Required: a verdict
  // without a documented reason is exactly the un-reviewed seam we're closing.
  reviewNotes: z
    .string()
    .trim()
    .min(1, "Record your rationale for this verdict")
    .max(4_000),
  // Plain-language outcome the customer receives. Required so the loop always
  // closes with a human-written, calm explanation — never a bare status flip.
  customerMessage: z
    .string()
    .trim()
    .min(1, "Write the customer the outcome in plain language")
    .max(4_000),
});

/**
 * Resolve the email to notify on appeal resolution: the appellant's email if
 * we have their user row, else the org owner's email. Returns null when no
 * deliverable address is found — the loop still closes in-thread (the
 * customerMessage is persisted regardless of email).
 */
async function resolveAppellantEmail(
  appellantUserId: string | null,
  organizationId: number,
): Promise<{ email: string; firstName: string | null } | null> {
  if (appellantUserId) {
    const [u] = await db
      .select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, appellantUserId))
      .limit(1);
    if (u?.email) return { email: u.email, firstName: u.firstName ?? null };
  }
  // Fall back to the org owner.
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
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

export function registerFounderAppealRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // GET /api/founder/appeals — the review queue (open + under_review).
  // -------------------------------------------------------------------------
  app.get(
    "/api/founder/appeals",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const status = typeof req.query.status === "string" ? req.query.status : "active";
      // Default to the actionable queue; allow ?status=all for the full ledger.
      const statusFilter =
        status === "all"
          ? undefined
          : inArray(paxDecisionAppeals.status, ["open", "under_review"]);

      try {
        const rows = await db
          .select({
            appealId: paxDecisionAppeals.id,
            organizationId: paxDecisionAppeals.organizationId,
            orgName: organizations.name,
            status: paxDecisionAppeals.status,
            appealReason: paxDecisionAppeals.appealReason,
            appellantUserId: paxDecisionAppeals.appellantUserId,
            filedAt: paxDecisionAppeals.createdAt,
            reviewNotes: paxDecisionAppeals.reviewNotes,
            customerMessage: paxDecisionAppeals.customerMessage,
            resolvedAt: paxDecisionAppeals.reviewDecisionAt,
            refusalId: paxRefusalPayloads.id,
            citedImmutableId: paxRefusalPayloads.citedImmutableId,
            citedImmutableText: paxRefusalPayloads.citedImmutableText,
            refusalText: paxRefusalPayloads.refusalText,
            severity: paxRefusalPayloads.severity,
            refusedAt: paxRefusalPayloads.createdAt,
          })
          .from(paxDecisionAppeals)
          .innerJoin(
            paxRefusalPayloads,
            eq(paxRefusalPayloads.id, paxDecisionAppeals.refusalPayloadId),
          )
          .leftJoin(
            organizations,
            eq(organizations.id, paxDecisionAppeals.organizationId),
          )
          .where(statusFilter)
          .orderBy(desc(paxDecisionAppeals.createdAt))
          .limit(100);

        const appeals = rows.map((r) => ({
          id: r.appealId,
          organizationId: r.organizationId,
          orgName: r.orgName,
          status: r.status,
          appealReason: r.appealReason,
          appellantUserId: r.appellantUserId,
          filedAt: r.filedAt,
          reviewNotes: r.reviewNotes,
          customerMessage: r.customerMessage,
          resolvedAt: r.resolvedAt,
          refusal: {
            id: r.refusalId,
            citedImmutableId: r.citedImmutableId,
            citedImmutableText: r.citedImmutableText,
            refusalText: r.refusalText,
            severity: r.severity,
            refusedAt: r.refusedAt,
          },
        }));

        return res.json({ appeals, count: appeals.length });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/founder/appeals/:id/resolve — uphold | reverse + close the loop.
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/appeals/:id/resolve",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return Errors.badRequest(res, "appeal id must be a positive integer");
      }

      let reviewerUserId: string;
      try {
        reviewerUserId = getUserId(req);
      } catch {
        return Errors.unauthorized(res);
      }

      const parsed = resolveAppealSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { decision, reviewNotes, customerMessage } = parsed.data;

      try {
        const [appeal] = await db
          .select({
            id: paxDecisionAppeals.id,
            organizationId: paxDecisionAppeals.organizationId,
            status: paxDecisionAppeals.status,
            appellantUserId: paxDecisionAppeals.appellantUserId,
          })
          .from(paxDecisionAppeals)
          .where(eq(paxDecisionAppeals.id, id))
          .limit(1);

        if (!appeal) {
          return Errors.notFound(res, "Appeal");
        }

        // Idempotence + integrity: only an open/under_review appeal can be
        // resolved. A second resolve on an already-terminal appeal is rejected
        // so a verdict can't be silently overwritten.
        if (appeal.status === "upheld" || appeal.status === "reversed") {
          return Errors.badRequest(
            res,
            "This appeal has already been resolved.",
            { status: appeal.status },
          );
        }

        const resolvedAt = new Date();
        await db
          .update(paxDecisionAppeals)
          .set({
            status: decision,
            reviewerUserId,
            reviewNotes,
            customerMessage,
            reviewDecisionAt: resolvedAt,
            updatedAt: resolvedAt,
          })
          .where(
            and(
              eq(paxDecisionAppeals.id, id),
              // Re-assert the non-terminal guard in the WHERE so two
              // concurrent resolves can't both win.
              inArray(paxDecisionAppeals.status, ["open", "under_review"]),
            ),
          );

        logger.info("[founder-appeals] appeal resolved", {
          metadata: {
            appealId: id,
            decision,
            organizationId: appeal.organizationId,
            reviewerUserId,
          },
        });

        // Close the loop back to the customer — email is best-effort and must
        // never fail the resolution (the in-thread customerMessage is the
        // canonical record; the email is the courtesy nudge).
        let emailStatus: "sent" | "suppressed" | "failed" | "skipped" =
          "skipped";
        try {
          const recipient = await resolveAppellantEmail(
            appeal.appellantUserId,
            appeal.organizationId,
          );
          if (recipient) {
            const result = await sendRegisteredEmail(
              "appeal_outcome",
              {
                firstName: recipient.firstName ?? undefined,
                decision,
                outcomeMessage: customerMessage,
              },
              {
                to: recipient.email,
                organizationId: appeal.organizationId,
              },
            );
            emailStatus = result.suppressed
              ? "suppressed"
              : result.success
                ? "sent"
                : "failed";
          }
        } catch (emailErr) {
          emailStatus = "failed";
          logger.warn("[founder-appeals] outcome email failed", {
            metadata: {
              appealId: id,
              error:
                emailErr instanceof Error
                  ? emailErr.message
                  : String(emailErr),
            },
          });
        }

        return res.json({
          appeal: { id, status: decision, resolvedAt },
          notification: { emailStatus },
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  logger.info(
    "[founder-appeals] registered GET /api/founder/appeals + POST /api/founder/appeals/:id/resolve",
  );
}
