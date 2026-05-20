/**
 * /founder/inspector API — provenance lens.
 *
 * Per-agent, per-decision, per-customer (future), per-render (future)
 * deep-dive surfaces. Every "click here to see why" in the founder UI
 * routes through one of these endpoints.
 *
 * Endpoints:
 *   GET /api/founder/inspector/agent/:codename — lifetime stats, trust curve,
 *       recent proposals, rejection summary, prompt evolution history
 *   GET /api/founder/inspector/decision/:id   — full decision with LLM trace
 *       lineage + linked rejection/approval audit
 *   GET /api/founder/inspector/audit          — recent founder_audit rows,
 *       filterable by area + target
 */

import type { Express, Request, Response } from "express";
import { db } from "./db";
import {
  companyAgents,
  decisionsInboxItems,
  trustEvolutionLog,
  agentActionLog,
  agentLlmTraces,
  agentPromptEvolutions,
  founderAudit,
} from "@shared/schema";
import { and, desc, eq, gte, sql, count } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";

export function registerFounderInspectorRoutes(app: Express) {
  // Per-agent deep dive
  app.get(
    "/api/founder/inspector/agent/:codename",
    isAuthenticated,
    requireFounder,
    async (req: Request, res: Response) => {
      const codename = req.params.codename;
      const days = Math.max(1, Math.min(180, parseInt(String(req.query.days ?? "30"), 10)));
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const agent = await db.query.companyAgents.findFirst({
        where: eq(companyAgents.codename, codename),
      });
      if (!agent) return res.status(404).json({ error: `agent ${codename} not found` });

      // Trust curve — last 30 evolution log entries
      const trustCurve = await db
        .select()
        .from(trustEvolutionLog)
        .where(eq(trustEvolutionLog.agentCodename, codename))
        .orderBy(desc(trustEvolutionLog.createdAt))
        .limit(30);

      // Recent decisions for this agent
      const recentDecisions = await db
        .select()
        .from(decisionsInboxItems)
        .where(
          and(
            eq(decisionsInboxItems.ownerAgentCodename, codename),
            gte(decisionsInboxItems.createdAt, cutoff),
          ),
        )
        .orderBy(desc(decisionsInboxItems.createdAt))
        .limit(50);

      // Action outcome stats
      const actionStats = await db
        .select({
          total: count(),
          succeeded: sql<number>`count(*) filter (where outcome = 'success')`,
          failed: sql<number>`count(*) filter (where outcome = 'failure')`,
          escalated: sql<number>`count(*) filter (where outcome = 'escalated')`,
        })
        .from(agentActionLog)
        .where(
          and(
            eq(agentActionLog.agentCodename, codename),
            gte(agentActionLog.createdAt, cutoff),
          ),
        );

      // Rejection summary (Phase B-1 helper)
      const { getRejectionSummary } = await import("./services/agentRejectionContext");
      const rejectionSummary = await getRejectionSummary(codename, days);

      // Prompt evolution history
      const promptHistory = await db
        .select()
        .from(agentPromptEvolutions)
        .where(eq(agentPromptEvolutions.agentCodename, codename))
        .orderBy(desc(agentPromptEvolutions.id))
        .limit(20);

      // Recent LLM traces (last 25, full prompts available)
      const recentTraces = await db
        .select({
          id: agentLlmTraces.id,
          purpose: agentLlmTraces.purpose,
          model: agentLlmTraces.model,
          latencyMs: agentLlmTraces.latencyMs,
          inputTokens: agentLlmTraces.inputTokens,
          outputTokens: agentLlmTraces.outputTokens,
          costCents: agentLlmTraces.costCents,
          error: agentLlmTraces.error,
          decisionId: agentLlmTraces.decisionId,
          createdAt: agentLlmTraces.createdAt,
        })
        .from(agentLlmTraces)
        .where(
          and(
            eq(agentLlmTraces.agentCodename, codename),
            gte(agentLlmTraces.createdAt, cutoff),
          ),
        )
        .orderBy(desc(agentLlmTraces.createdAt))
        .limit(25);

      res.json({
        agent: {
          codename: agent.codename,
          title: agent.title,
          trustScore: agent.trustScore,
          status: agent.status,
          personalityPromptHash: hashFirst16(agent.personalityPrompt ?? ""),
          metrics: agent.metrics,
        },
        windowDays: days,
        trustCurve,
        actionStats: actionStats[0],
        recentDecisions,
        rejectionSummary,
        promptHistory,
        recentTraces,
      });
    },
  );

  // Per-decision deep dive
  app.get(
    "/api/founder/inspector/decision/:id",
    isAuthenticated,
    requireFounder,
    async (req: Request, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid id" });

      const item = await db.query.decisionsInboxItems.findFirst({
        where: eq(decisionsInboxItems.id, id),
      });
      if (!item) return res.status(404).json({ error: "decision not found" });

      const traces = await db
        .select()
        .from(agentLlmTraces)
        .where(eq(agentLlmTraces.decisionId, id))
        .orderBy(desc(agentLlmTraces.createdAt));

      const audit = await db
        .select()
        .from(founderAudit)
        .where(eq(founderAudit.targetId, String(id)))
        .orderBy(desc(founderAudit.createdAt));

      res.json({ decision: item, traces, audit });
    },
  );

  // Recent founder mutations across the platform
  app.get(
    "/api/founder/inspector/audit",
    isAuthenticated,
    requireFounder,
    async (req: Request, res: Response) => {
      const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 500);
      const area = req.query.area ? String(req.query.area) : null;
      const targetType = req.query.targetType ? String(req.query.targetType) : null;

      const filters = [];
      if (area) filters.push(eq(founderAudit.area, area));
      if (targetType) filters.push(eq(founderAudit.targetType, targetType));

      const rows = await db
        .select()
        .from(founderAudit)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(founderAudit.createdAt))
        .limit(limit);

      res.json({ entries: rows });
    },
  );
}

function hashFirst16(input: string): string {
  // Lightweight fingerprint for the founder UI — not a security hash.
  // Used so the inspector can flag prompt drift without dumping the full prompt.
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0").slice(0, 16);
}
