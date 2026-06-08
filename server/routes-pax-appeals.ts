/**
 * Quinn (Chief of Alignment) + Rafe (CCO) — "appeal the AI" customer surface.
 *
 * Tahoe elevation (quinn.md idea #5 / rafe.md idea #2). The recourse ledgers
 * (pax_refusal_payloads → pax_decision_appeals) already exist; this is the
 * CUSTOMER-FACING affordance the EU AI Act Art. 86 right-to-recourse implies:
 * a customer can SEE a refusal-with-reason (the cited immutable in plain
 * language) and FILE an appeal against it. The outcome closes the loop back to
 * them (see routes-founder-appeals.ts + the Pax thread surface).
 *
 *   GET  /api/pax/refusals
 *     The org's recent refusals, each with its cited rule in plain language
 *     and any appeal already filed against it (status + the customer-facing
 *     outcome message once resolved). Drives the customer recourse panel.
 *
 *   POST /api/pax/appeals
 *     File an appeal against a specific refusal. Writes one row to
 *     pax_decision_appeals linked to the refusal payload. One open appeal per
 *     refusal — re-appealing an already-appealed refusal is rejected so the
 *     queue stays honest (no dark-pattern spam path, no silent dupes).
 *
 * Auth: isAuthenticated + org scope on every route. Refusals are org-scoped;
 * a customer sees the refusals that happened in their own org.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { db } from "./db";
import { paxRefusalPayloads } from "@shared/schema/pax-refusal-payloads";
import {
  paxDecisionAppeals,
  PAX_APPEAL_STATUSES,
} from "@shared/schema/pax-decision-appeals";

const fileAppealSchema = z.object({
  refusalPayloadId: z
    .number()
    .int()
    .positive("refusalPayloadId must be a positive integer"),
  // The customer's own words — why they think the refusal was wrong. Required
  // (an appeal is a deliberate act), bounded so the queue stays readable.
  appealReason: z
    .string()
    .trim()
    .min(1, "Tell us briefly why you're appealing")
    .max(2_000, "Keep your appeal under 2,000 characters"),
});

/** The active (non-terminal) appeal statuses — an open appeal blocks a re-file. */
const ACTIVE_APPEAL_STATUSES = ["open", "under_review"] as const;

export function registerPaxAppealRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // GET /api/pax/refusals — the org's refusals + their appeal state.
  // -------------------------------------------------------------------------
  app.get(
    "/api/pax/refusals",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      let organizationId: number;
      try {
        organizationId = getOrganizationId(req);
      } catch {
        return Errors.unauthorized(res);
      }

      try {
        // Left-join each refusal to the most recent appeal filed against it.
        // A refusal usually has zero or one appeal (one open appeal per
        // refusal is enforced on the write path); the join surfaces the
        // appeal lifecycle so the panel can show "Appeal this" vs the
        // already-filed status + resolved outcome.
        const rows = await db
          .select({
            refusalId: paxRefusalPayloads.id,
            conversationId: paxRefusalPayloads.conversationId,
            messageId: paxRefusalPayloads.messageId,
            citedImmutableId: paxRefusalPayloads.citedImmutableId,
            citedImmutableText: paxRefusalPayloads.citedImmutableText,
            refusalText: paxRefusalPayloads.refusalText,
            severity: paxRefusalPayloads.severity,
            refusedAt: paxRefusalPayloads.createdAt,
            appealId: paxDecisionAppeals.id,
            appealStatus: paxDecisionAppeals.status,
            appealReason: paxDecisionAppeals.appealReason,
            appealCustomerMessage: paxDecisionAppeals.customerMessage,
            appealResolvedAt: paxDecisionAppeals.reviewDecisionAt,
            appealCreatedAt: paxDecisionAppeals.createdAt,
          })
          .from(paxRefusalPayloads)
          .leftJoin(
            paxDecisionAppeals,
            eq(paxDecisionAppeals.refusalPayloadId, paxRefusalPayloads.id),
          )
          .where(eq(paxRefusalPayloads.organizationId, organizationId))
          .orderBy(desc(paxRefusalPayloads.createdAt))
          .limit(50);

        const refusals = rows.map((r) => ({
          id: r.refusalId,
          conversationId: r.conversationId,
          messageId: r.messageId,
          citedImmutableId: r.citedImmutableId,
          // Plain-language wording of the rule Pax cited (snapshotted at write
          // time). Null only for legacy rows that predate the column.
          citedImmutableText: r.citedImmutableText,
          refusalText: r.refusalText,
          severity: r.severity,
          refusedAt: r.refusedAt,
          appeal: r.appealId
            ? {
                id: r.appealId,
                status: r.appealStatus,
                reason: r.appealReason,
                // Plain-language outcome shown to the customer once resolved.
                outcomeMessage: r.appealCustomerMessage,
                resolvedAt: r.appealResolvedAt,
                filedAt: r.appealCreatedAt,
              }
            : null,
        }));

        return res.json({ refusals });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/pax/appeals — file an appeal against a refusal.
  // -------------------------------------------------------------------------
  app.post(
    "/api/pax/appeals",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      let organizationId: number;
      let userId: string;
      try {
        organizationId = getOrganizationId(req);
        userId = getUserId(req);
      } catch {
        return Errors.unauthorized(res);
      }

      const parsed = fileAppealSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      const { refusalPayloadId, appealReason } = parsed.data;

      try {
        // The refusal MUST belong to the caller's org — never let a customer
        // appeal another org's refusal (forensic-ledger integrity).
        const [refusal] = await db
          .select({
            id: paxRefusalPayloads.id,
            conversationId: paxRefusalPayloads.conversationId,
            messageId: paxRefusalPayloads.messageId,
          })
          .from(paxRefusalPayloads)
          .where(
            and(
              eq(paxRefusalPayloads.id, refusalPayloadId),
              eq(paxRefusalPayloads.organizationId, organizationId),
            ),
          )
          .limit(1);

        if (!refusal) {
          return Errors.notFound(res, "Refusal");
        }

        // One active appeal per refusal — re-appealing an already-open (or
        // already-resolved) refusal is rejected. Keeps the queue honest and
        // closes a dark-pattern spam path.
        const existing = await db
          .select({
            id: paxDecisionAppeals.id,
            status: paxDecisionAppeals.status,
          })
          .from(paxDecisionAppeals)
          .where(eq(paxDecisionAppeals.refusalPayloadId, refusalPayloadId))
          .limit(1);

        if (existing.length > 0) {
          return Errors.badRequest(
            res,
            "You've already appealed this decision.",
            { appealId: existing[0].id, status: existing[0].status },
          );
        }

        const [appeal] = await db
          .insert(paxDecisionAppeals)
          .values({
            organizationId,
            conversationId: refusal.conversationId ?? null,
            messageId: refusal.messageId ?? null,
            refusalPayloadId,
            appealReason,
            appellantUserId: userId,
            status: "open",
          })
          .returning({
            id: paxDecisionAppeals.id,
            status: paxDecisionAppeals.status,
            createdAt: paxDecisionAppeals.createdAt,
          });

        logger.info("[pax-appeals] appeal filed", {
          metadata: {
            organizationId,
            appealId: appeal.id,
            refusalPayloadId,
          },
        });

        return res.status(201).json({
          appeal: {
            id: appeal.id,
            status: appeal.status,
            filedAt: appeal.createdAt,
          },
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  logger.info(
    "[pax-appeals] registered GET /api/pax/refusals + POST /api/pax/appeals",
  );
}

// Exposed for the test suite — the canonical status set + active gate so a
// drift in either is caught.
export const __test_PAX_APPEAL_STATUSES = PAX_APPEAL_STATUSES;
export const __test_ACTIVE_APPEAL_STATUSES = ACTIVE_APPEAL_STATUSES;
