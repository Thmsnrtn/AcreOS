/**
 * Rosy River C4 — Founder agent-queue endpoints.
 *
 * Reads from the EXISTING autonomy tables (no parallel storage):
 *   - agentTasks                — proposal queue (Rosy River writes here)
 *   - decisionsInboxItems       — founder review feed (paired with each agentTask
 *                                 that requires review)
 *   - agentLlmTraces            — LLM cost ledger (single source of truth)
 *
 * Routes:
 *   GET    /api/founder/proposed-changes              — agentTasks filtered to
 *                                                      Rosy-River agent types
 *   PATCH  /api/founder/proposed-changes/:id          — approve / reject / defer
 *                                                      (updates BOTH the agentTask
 *                                                      and the paired inbox item)
 *   GET    /api/founder/agent-notifications           — decisionsInboxItems with
 *                                                      itemType='agent_event'
 *   PATCH  /api/founder/agent-notifications/:id       — mark inbox item resolved
 *   GET    /api/founder/agent-budget                  — weekly spend summary
 *                                                      from agent_llm_traces
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { agentTasks, decisionsInboxItems } from "@shared/schema";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  getWeeklyAgentSpend,
  notifyFounder,
  ROSY_RIVER_AGENT_TYPES,
  WEEKLY_BUDGET_ALERT_USD,
  WEEKLY_BUDGET_CEILING_USD,
} from "./services/rosyRiver";

const PROPOSAL_DECISIONS = ["approve", "reject", "defer"] as const;
const INBOX_STATUSES = ["pending", "approved", "rejected", "deferred", "auto_resolved"] as const;

const proposalDecisionSchema = z.object({
  decision: z.enum(PROPOSAL_DECISIONS),
  notes: z.string().trim().max(2000).optional(),
});

const inboxUpdateSchema = z.object({
  status: z.enum(INBOX_STATUSES),
  founderModification: z.string().trim().max(2000).optional(),
});

export function registerRosyRiverRoutes(app: Express): void {
  // ── GET /api/founder/proposed-changes ───────────────────────────────────
  // Lists agentTasks originated by Rosy River agents (codebase_monitor, etc.).
  // The paired decisionsInboxItem is looked up by actionPayload.agentTaskId
  // so the founder sees both proposal context and review state in one row.
  app.get(
    "/api/founder/proposed-changes",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
        const limit = Math.min(
          100,
          Math.max(1, parseInt((req.query.limit as string) || "50", 10)),
        );
        const offset = (page - 1) * limit;

        const status = req.query.status as string | undefined;
        const agentType = req.query.agent as string | undefined;

        const agentTypes = agentType
          ? [agentType]
          : ([...ROSY_RIVER_AGENT_TYPES] as string[]);

        const filters = [inArray(agentTasks.agentType, agentTypes)];
        if (status) {
          filters.push(eq(agentTasks.status, status));
        }
        const where = and(...filters);

        const rows = await db
          .select()
          .from(agentTasks)
          .where(where)
          .orderBy(desc(agentTasks.createdAt))
          .limit(limit)
          .offset(offset);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(agentTasks)
          .where(where);

        // Inbox pairing: pull every inbox item whose actionPayload.agentTaskId
        // matches one of the returned task ids. One query, in-memory join.
        const ids = rows.map((r) => r.id);
        const inboxItems = ids.length
          ? await db
              .select()
              .from(decisionsInboxItems)
              .where(
                and(
                  eq(decisionsInboxItems.itemType, "agent_code_proposal"),
                  sql`(${decisionsInboxItems.actionPayload}->>'agentTaskId')::int IN (${sql.join(
                    ids.map((id) => sql`${id}`),
                    sql`, `,
                  )})`,
                ),
              )
          : [];
        const inboxByTaskId = new Map<number, (typeof inboxItems)[number]>();
        for (const item of inboxItems) {
          const tid = (item.actionPayload as Record<string, unknown> | null)?.agentTaskId;
          if (typeof tid === "number") inboxByTaskId.set(tid, item);
        }

        const proposals = rows.map((task) => {
          const inbox = inboxByTaskId.get(task.id);
          return {
            ...task,
            inboxItemId: inbox?.id ?? null,
            inboxStatus: inbox?.status ?? null,
            founderModification: inbox?.founderModification ?? null,
          };
        });

        return res.json({ proposals, total: count, page, limit });
      } catch (err: unknown) {
        logger.error("[rosy-river] GET /api/founder/proposed-changes failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── PATCH /api/founder/proposed-changes/:id ────────────────────────────
  // Founder decision on an agent-originated proposal. Updates BOTH the
  // agentTask (status / requiresReview) AND the paired decisionsInboxItem
  // (status / founderModification) so both queues stay consistent.
  app.patch(
    "/api/founder/proposed-changes/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const taskId = parseInt(req.params.id, 10);
        if (!Number.isFinite(taskId)) return Errors.badRequest(res, "Invalid id");

        const parsed = proposalDecisionSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const { decision, notes } = parsed.data;
        const now = new Date();
        const founderId = req.user?.id ? parseInt(String(req.user.id), 10) : null;

        // 1. Update the agentTask. Approve clears the simulationMode flag in
        //    `input` and clears requiresReview so the gauntlet picks it up
        //    on its next tick. Reject cancels the task. Defer leaves it as
        //    pending+requiresReview.
        const [existing] = await db
          .select()
          .from(agentTasks)
          .where(eq(agentTasks.id, taskId))
          .limit(1);
        if (!existing) return Errors.notFound(res, "Proposed change");

        const nextStatus =
          decision === "approve"
            ? "pending" // pending + requiresReview=false lets evolution pipeline pick it up
            : decision === "reject"
              ? "cancelled"
              : existing.status;

        const updatedInput = (() => {
          const base = (existing.input as Record<string, unknown> | null) ?? {};
          if (decision === "approve") {
            return { ...base, simulationMode: false };
          }
          return base;
        })();

        const [updatedTask] = await db
          .update(agentTasks)
          .set({
            status: nextStatus,
            requiresReview: decision === "defer",
            reviewedBy: founderId,
            reviewedAt: now,
            reviewNotes: notes ?? null,
            input: updatedInput,
          })
          .where(eq(agentTasks.id, taskId))
          .returning();

        // 2. Update the paired inbox item, if any.
        const inboxRows = await db
          .select()
          .from(decisionsInboxItems)
          .where(
            and(
              eq(decisionsInboxItems.itemType, "agent_code_proposal"),
              sql`(${decisionsInboxItems.actionPayload}->>'agentTaskId')::int = ${taskId}`,
            ),
          );
        for (const inbox of inboxRows) {
          await db
            .update(decisionsInboxItems)
            .set({
              status:
                decision === "approve"
                  ? "approved"
                  : decision === "reject"
                    ? "rejected"
                    : "deferred",
              founderModification: notes ?? null,
              resolvedAt: decision === "defer" ? null : now,
              resolvedBy: req.user?.id ? String(req.user.id) : "founder",
              updatedAt: now,
            })
            .where(eq(decisionsInboxItems.id, inbox.id));
        }

        return res.json({ task: updatedTask, decision, notes: notes ?? null });
      } catch (err: unknown) {
        logger.error("[rosy-river] PATCH /api/founder/proposed-changes/:id failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/founder/agent-notifications ───────────────────────────────
  // Informational agent events (planner weekly, budget warnings, circuit
  // breaker trips, telemetry drift). Lives in decisionsInboxItems with
  // itemType='agent_event' so it shows up in the same founder feed UI.
  app.get(
    "/api/founder/agent-notifications",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
        const limit = Math.min(
          100,
          Math.max(1, parseInt((req.query.limit as string) || "50", 10)),
        );
        const offset = (page - 1) * limit;

        const status = req.query.status as string | undefined;

        const filters = [eq(decisionsInboxItems.itemType, "agent_event")];
        if (status && (INBOX_STATUSES as readonly string[]).includes(status)) {
          filters.push(eq(decisionsInboxItems.status, status));
        }
        const where = and(...filters);

        const rows = await db
          .select()
          .from(decisionsInboxItems)
          .where(where)
          .orderBy(desc(decisionsInboxItems.createdAt))
          .limit(limit)
          .offset(offset);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(decisionsInboxItems)
          .where(where);

        const [{ unread }] = await db
          .select({ unread: sql<number>`count(*)::int` })
          .from(decisionsInboxItems)
          .where(
            and(
              eq(decisionsInboxItems.itemType, "agent_event"),
              eq(decisionsInboxItems.status, "pending"),
            ),
          );

        return res.json({ notifications: rows, total: count, unread, page, limit });
      } catch (err: unknown) {
        logger.error("[rosy-river] GET /api/founder/agent-notifications failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── PATCH /api/founder/agent-notifications/:id ─────────────────────────
  app.patch(
    "/api/founder/agent-notifications/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");

        const parsed = inboxUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const { status, founderModification } = parsed.data;
        const now = new Date();

        const patch: Record<string, unknown> = {
          status,
          updatedAt: now,
        };
        if (status === "approved" || status === "rejected" || status === "auto_resolved") {
          patch.resolvedAt = now;
          patch.resolvedBy = req.user?.id ? String(req.user.id) : "founder";
        }
        if (founderModification) {
          patch.founderModification = founderModification;
        }

        const [row] = await db
          .update(decisionsInboxItems)
          .set(patch)
          .where(eq(decisionsInboxItems.id, id))
          .returning();

        if (!row) return Errors.notFound(res, "Notification");
        return res.json(row);
      } catch (err: unknown) {
        logger.error("[rosy-river] PATCH /api/founder/agent-notifications/:id failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/founder/agent-budget ──────────────────────────────────────
  // Weekly LLM spend pulled from agent_llm_traces. Single source of truth.
  app.get(
    "/api/founder/agent-budget",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const summary = await getWeeklyAgentSpend();
        return res.json({
          ...summary,
          ceilingUsd: WEEKLY_BUDGET_CEILING_USD,
          alertUsd: WEEKLY_BUDGET_ALERT_USD,
        });
      } catch (err: unknown) {
        logger.error("[rosy-river] GET /api/founder/agent-budget failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // The notifyFounder helper is intentionally referenced here so this file
  // re-exports the import path that route consumers expect — keep linter
  // from flagging the import as unused even if no inline call site uses it.
  void notifyFounder;
}
