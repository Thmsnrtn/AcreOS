/**
 * /api/founder/pax-traces — read-only Pax trace viewer (Workstream A).
 *
 * Founder-only audit surface that returns the raw LLM prompt/response capture
 * for every Pax-emitted call, joined where possible against the
 * decisions_inbox_items row that recorded the founder's eventual disposition
 * (accept / reject / defer). Used by /founder/pax-traces.
 *
 * This is the "Honesty" workstream's truth source: the autonomy slider may
 * still be in preview, but every Pax LLM call is already captured here — the
 * founder can verify the slider's confidence number against the underlying
 * prompt/response any time.
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { agentLlmTraces, decisionsInboxItems } from "@shared/schema";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PAX_CODENAME = "pax";

export function registerPaxTracesRoutes(app: Express) {
  app.get(
    "/api/founder/pax-traces",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limitRaw = parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
        const limit = Number.isFinite(limitRaw)
          ? Math.min(Math.max(1, limitRaw), MAX_LIMIT)
          : DEFAULT_LIMIT;

        const beforeRaw = req.query.before ? parseInt(String(req.query.before), 10) : null;
        const before = beforeRaw !== null && Number.isFinite(beforeRaw) ? beforeRaw : null;

        const filters = [eq(agentLlmTraces.agentCodename, PAX_CODENAME)];
        if (before !== null) filters.push(lt(agentLlmTraces.id, before));

        // Left-join on decisions_inbox_items so the founder can see how each
        // Pax LLM call was eventually dispositioned (accept/reject/defer) without
        // a second round-trip. Many traces have no decision row at all (raw
        // observation calls) — that's fine, we render them as "no decision".
        const rows = await db
          .select({
            id: agentLlmTraces.id,
            organizationId: agentLlmTraces.organizationId,
            agentCodename: agentLlmTraces.agentCodename,
            purpose: agentLlmTraces.purpose,
            model: agentLlmTraces.model,
            systemPrompt: agentLlmTraces.systemPrompt,
            userPrompt: agentLlmTraces.userPrompt,
            response: agentLlmTraces.response,
            latencyMs: agentLlmTraces.latencyMs,
            inputTokens: agentLlmTraces.inputTokens,
            outputTokens: agentLlmTraces.outputTokens,
            costCents: agentLlmTraces.costCents,
            error: agentLlmTraces.error,
            metadata: agentLlmTraces.metadata,
            decisionId: agentLlmTraces.decisionId,
            createdAt: agentLlmTraces.createdAt,
            decisionStatus: decisionsInboxItems.status,
            decisionItemType: decisionsInboxItems.itemType,
            decisionRecommendedAction: decisionsInboxItems.recommendedAction,
            decisionResolvedAt: decisionsInboxItems.resolvedAt,
            decisionResolvedBy: decisionsInboxItems.resolvedBy,
            decisionFounderOverrideAction: decisionsInboxItems.founderOverrideAction,
            decisionOutcomeScore: decisionsInboxItems.outcomeScore,
          })
          .from(agentLlmTraces)
          .leftJoin(
            decisionsInboxItems,
            eq(agentLlmTraces.decisionId, decisionsInboxItems.id),
          )
          .where(and(...filters))
          .orderBy(desc(agentLlmTraces.id))
          .limit(limit);

        // Aggregate header — gives the founder a quick "is Pax actually
        // running?" signal without needing to count the list.
        const [totals] = await db
          .select({
            total: sql<number>`count(*)::int`,
            errors: sql<number>`count(*) filter (where ${agentLlmTraces.error} is not null)::int`,
          })
          .from(agentLlmTraces)
          .where(eq(agentLlmTraces.agentCodename, PAX_CODENAME));

        const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

        res.json({
          traces: rows,
          nextCursor,
          totals: totals ?? { total: 0, errors: 0 },
        });
      } catch (error) {
        logger.error("[pax-traces] Failed to load traces", {
          error: error instanceof Error ? error.message : String(error),
        });
        Errors.internal(res, error);
      }
    },
  );
}
