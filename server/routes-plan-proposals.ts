/**
 * Solene (Phase B L2.6) — plan-then-execute founder routes.
 *
 *   GET  /api/founder/plan-proposals          — list, ?status= ?limit=
 *   GET  /api/founder/plan-proposals/:id      — single proposal
 *   POST /api/founder/plan-proposals/:id/approve
 *     body: { decisionRationale?, enqueueOptions? }
 *   POST /api/founder/plan-proposals/:id/reject
 *     body: { decisionRationale }
 *
 * Auth: isAuthenticated + requireFounder.
 *
 * TODO(solene-cron-wiring): registerPlanProposalRoutes(app) is NOT yet wired
 *   in server/routes.ts because routes.ts is frozen this wave. The next
 *   Solene routing-wiring commit will add the call alongside the other
 *   /api/founder/* mounts.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import {
  approvePlan,
  getProposal,
  listPendingPlans,
  rejectPlan,
  type ApprovePlanEnqueueOptions,
} from "@acreos/solene";
import {
  PLAN_PROPOSAL_STATUSES,
  type PlanProposalStatus,
} from "@shared/schema/solene-plan-proposals";
import {
  DISPATCH_AGENT_ROLES,
  DISPATCH_SOURCE_TYPES,
  type SoleneDispatchAgentRole,
  type SoleneDispatchSourceType,
} from "@shared/schema/solene-dispatch";
import { db } from "./db";
import { planProposals } from "@shared/schema/solene-plan-proposals";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./utils/logger";

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(Math.max(1, Math.floor(n)), 200);
}

function parseStatus(raw: unknown): PlanProposalStatus | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return PLAN_PROPOSAL_STATUSES.includes(raw as PlanProposalStatus)
    ? (raw as PlanProposalStatus)
    : undefined;
}

function parseAgentRole(raw: unknown): SoleneDispatchAgentRole | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return DISPATCH_AGENT_ROLES.includes(raw as SoleneDispatchAgentRole)
    ? (raw as SoleneDispatchAgentRole)
    : undefined;
}

function parseEnqueueOptions(
  raw: unknown,
): ApprovePlanEnqueueOptions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const sourceType = o.sourceType;
  const sourceId = o.sourceId;
  const promptText = o.promptText;
  if (
    typeof sourceType !== "string" ||
    !DISPATCH_SOURCE_TYPES.includes(sourceType as SoleneDispatchSourceType)
  ) {
    throw new Error(
      `invalid enqueueOptions.sourceType=${String(sourceType)}`,
    );
  }
  if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
    throw new Error("invalid enqueueOptions.sourceId");
  }
  if (typeof promptText !== "string" || promptText.trim().length === 0) {
    throw new Error("invalid enqueueOptions.promptText");
  }
  const out: ApprovePlanEnqueueOptions = {
    sourceType: sourceType as SoleneDispatchSourceType,
    sourceId,
    promptText,
  };
  if (typeof o.maxCostUsd === "number") out.maxCostUsd = o.maxCostUsd;
  if (typeof o.timeoutMs === "number") out.timeoutMs = o.timeoutMs;
  if (typeof o.priority === "number") out.priority = o.priority;
  return out;
}

export function registerPlanProposalRoutes(app: Express): void {
  // --------------------------------------------------------------------------
  // GET /api/founder/plan-proposals — list
  // --------------------------------------------------------------------------
  app.get(
    "/api/founder/plan-proposals",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = clampLimit(req.query.limit);
        const status = parseStatus(req.query.status);
        const agentRole = parseAgentRole(req.query.agentRole);

        // 'proposed' has a fast path through the service; for everything else
        // we run a small inline query so we don't add list-by-status to the
        // service surface this wave.
        if (!status || status === "proposed") {
          const rows = await listPendingPlans({ agentRole, limit });
          return res.json({ proposals: rows, total: rows.length });
        }

        const where = agentRole
          ? and(
              eq(planProposals.status, status),
              eq(planProposals.agentRole, agentRole),
            )
          : eq(planProposals.status, status);
        const rows = await db
          .select()
          .from(planProposals)
          .where(where)
          .orderBy(desc(planProposals.proposedAt))
          .limit(limit);
        return res.json({ proposals: rows, total: rows.length });
      } catch (err) {
        logger.error("[plan-proposals] list failed", { err: String(err) });
        return Errors.internal(res, err);
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/founder/plan-proposals/:id — single
  // --------------------------------------------------------------------------
  app.get(
    "/api/founder/plan-proposals/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
          return Errors.badRequest(res, "invalid proposal id");
        }
        const row = await getProposal(id);
        if (!row) return Errors.notFound(res, "Plan proposal");
        return res.json({ proposal: row });
      } catch (err) {
        logger.error("[plan-proposals] get failed", { err: String(err) });
        return Errors.internal(res, err);
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/founder/plan-proposals/:id/approve
  // --------------------------------------------------------------------------
  app.post(
    "/api/founder/plan-proposals/:id/approve",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
          return Errors.badRequest(res, "invalid proposal id");
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const decisionRationale =
          typeof body.decisionRationale === "string"
            ? body.decisionRationale
            : undefined;

        let enqueueOptions: ApprovePlanEnqueueOptions | undefined;
        try {
          enqueueOptions = parseEnqueueOptions(body.enqueueOptions);
        } catch (err) {
          return Errors.badRequest(
            res,
            err instanceof Error ? err.message : String(err),
          );
        }

        const result = await approvePlan(id, {
          decidedBy: "tom",
          decisionRationale,
          enqueueOptions,
        });
        return res.json({
          ok: true,
          proposalId: id,
          executedDispatchId: result.executedDispatchId ?? null,
        });
      } catch (err) {
        logger.error("[plan-proposals] approve failed", {
          err: String(err),
          id: req.params.id,
        });
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) return Errors.notFound(res, "Plan proposal");
        if (msg.includes("only 'proposed'"))
          return Errors.badRequest(res, msg);
        return Errors.internal(res, err);
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/founder/plan-proposals/:id/reject
  // --------------------------------------------------------------------------
  app.post(
    "/api/founder/plan-proposals/:id/reject",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
          return Errors.badRequest(res, "invalid proposal id");
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const decisionRationale = body.decisionRationale;
        if (
          typeof decisionRationale !== "string" ||
          decisionRationale.trim().length === 0
        ) {
          return Errors.badRequest(
            res,
            "decisionRationale required to reject a plan",
          );
        }

        await rejectPlan(id, {
          decidedBy: "tom",
          decisionRationale,
        });
        return res.json({ ok: true, proposalId: id });
      } catch (err) {
        logger.error("[plan-proposals] reject failed", {
          err: String(err),
          id: req.params.id,
        });
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) return Errors.notFound(res, "Plan proposal");
        if (msg.includes("only 'proposed'"))
          return Errors.badRequest(res, msg);
        return Errors.internal(res, err);
      }
    },
  );
}
