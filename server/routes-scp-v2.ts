/**
 * SCP v2 Routes — Sovereign Company Protocol v2 CEO Interface
 *
 * Enhanced CEO briefing with evolution status, evolution dashboard,
 * "talk to your company" with memory/evolution queries,
 * trust promotion/demotion, and evolution pause/resume controls.
 */

import { type Express, type Request, type Response } from "express";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { isAuthenticated, requireFounder } from "./auth";

// ─── Lazy imports to avoid circular dependencies ───────────────────────────

async function getEvolutionSummary() {
  const { getEvolutionSummary } = await import("./services/scpGoldenSuite");
  return getEvolutionSummary();
}

async function getGoldenSuiteService() {
  return import("./services/scpGoldenSuite");
}

async function getConfigVersioning() {
  return import("./services/scpConfigVersioning");
}

async function getEvolutionEngine() {
  return import("./services/scpEvolutionEngine");
}

async function getMemorySystem() {
  return import("./services/scpMemorySystem");
}

async function getLLMJudges() {
  return import("./services/scpLLMJudges");
}

// ─── In-memory evolution pause state ───────────────────────────────────────

let evolutionPaused = false;
let evolutionPausedAt: string | null = null;
let evolutionPausedReason: string | null = null;

// ─── Route Registration ────────────────────────────────────────────────────

export function registerSCPv2Routes(app: Express) {
  // Perimeter auth (2026-07-03 security fix): every SCP v2 endpoint is founder
  // tooling — including trust promote/demote and evolution pause/resume/
  // rollback — yet the file registered them with NO auth middleware. One
  // prefix-level guard covers every current and future /api/scp/v2 route so
  // a newly added endpoint can't ship open by omission.
  app.use("/api/scp/v2", isAuthenticated, requireFounder);

  // ─── Founder-triggered batch evolution (step-away gap #6) ────────────────
  /**
   * POST /api/scp/v2/evolution/run
   * Arm the evolution engine on demand: consolidation across all agents now;
   * per-agent evolution runs where the engine's cadence rules allow. Honest
   * response — reports exactly what ran and what was skipped.
   */
  app.post("/api/scp/v2/evolution/run", async (_req: Request, res: Response) => {
    try {
      if (evolutionPaused) {
        return Errors.badRequest(res, `Evolution is paused (${evolutionPausedReason ?? "no reason recorded"}). Resume it first.`);
      }
      const { runBatchEvolution } = await getEvolutionEngine();
      const result = await runBatchEvolution();
      return res.json({ ok: true, ...result });
    } catch (err) {
      logger.error("[scp-v2] founder-triggered evolution run failed", err instanceof Error ? err : undefined);
      return Errors.internal(res, err);
    }
  });

  // ─── Evolution Dashboard ───────────────────────────────────────────────

  /**
   * GET /api/scp/v2/evolution/dashboard
   * Overview of all agents' evolution status.
   */
  app.get("/api/scp/v2/evolution/dashboard", async (_req: Request, res: Response) => {
    try {
      const summary = await getEvolutionSummary();
      const { getJudgeCosts } = await getLLMJudges();
      const costs = getJudgeCosts();

      res.json({
        agents: summary,
        evolution_paused: evolutionPaused,
        evolution_paused_at: evolutionPausedAt,
        evolution_paused_reason: evolutionPausedReason,
        judge_costs: {
          total_usd: costs.total_usd,
          by_agent: costs.by_agent,
        },
      });
    } catch (err: any) {
      logger.error("Evolution dashboard error", { error: err });
      Errors.internal(res, err);
    }
  });

  /**
   * GET /api/scp/v2/evolution/agent/:agent
   * Detailed evolution info for a specific agent.
   */
  app.get("/api/scp/v2/evolution/agent/:agent", async (req: Request, res: Response) => {
    try {
      const { agent } = req.params;
      const cv = await getConfigVersioning();

      const version = cv.getAgentVersion(agent);
      const metrics = cv.getAgentMetrics(agent);
      const evolutionLog = cv.readEvolutionLog(agent);
      const goldenSuite = cv.readGoldenSuite(agent);
      const configFiles = cv.listAgentConfigFiles(agent);

      // Read all config file contents
      const configs: Record<string, string> = {};
      for (const file of configFiles) {
        configs[file] = cv.readAgentConfig(agent, file) ?? "";
      }

      res.json({
        agent,
        version,
        metrics,
        evolution_log: evolutionLog.slice(-20),
        golden_suite: goldenSuite,
        config_files: configFiles,
        configs,
      });
    } catch (err: any) {
      logger.error("Agent evolution detail error", { error: err, agent: req.params.agent });
      Errors.internal(res, err);
    }
  });

  /**
   * GET /api/scp/v2/evolution/agent/:agent/diff/:fromVersion/:toVersion
   * Show what changed between two versions of an agent's config.
   */
  app.get("/api/scp/v2/evolution/agent/:agent/diff/:fromVersion/:toVersion", async (req: Request, res: Response) => {
    try {
      const { agent, fromVersion, toVersion } = req.params;
      const cv = await getConfigVersioning();

      const log = cv.readEvolutionLog(agent);
      const relevantEntries = log.filter(
        (e) => e.version > Number(fromVersion) && e.version <= Number(toVersion)
      );

      res.json({
        agent,
        from_version: Number(fromVersion),
        to_version: Number(toVersion),
        changes: relevantEntries.map((e) => ({
          version: e.version,
          timestamp: e.timestamp,
          files_changed: e.changes,
          deltas: e.deltas,
        })),
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── Golden Suite Browser ──────────────────────────────────────────────

  /**
   * GET /api/scp/v2/golden-suite
   * Browse all golden cases across all agents.
   */
  app.get("/api/scp/v2/golden-suite", async (_req: Request, res: Response) => {
    try {
      const { getAllGoldenCases } = await getGoldenSuiteService();
      const result = await getAllGoldenCases();
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  /**
   * GET /api/scp/v2/golden-suite/:agent
   * Golden cases for a specific agent.
   */
  app.get("/api/scp/v2/golden-suite/:agent", async (req: Request, res: Response) => {
    try {
      const { getGoldenCases } = await getGoldenSuiteService();
      const cases = await getGoldenCases(req.params.agent);
      res.json({ agent: req.params.agent, cases, total: cases.length });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── Trust Promotion/Demotion ──────────────────────────────────────────

  /**
   * GET /api/scp/v2/trust/promotions
   * Get pending trust promotion suggestions.
   */
  app.get("/api/scp/v2/trust/promotions", async (_req: Request, res: Response) => {
    try {
      const { checkTrustPromotions } = await getGoldenSuiteService();
      const suggestions = await checkTrustPromotions();
      res.json({ suggestions });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  /**
   * POST /api/scp/v2/trust/promote
   * Approve a trust promotion for an agent.
   */
  app.post("/api/scp/v2/trust/promote", async (req: Request, res: Response) => {
    try {
      const { agent, new_trust_score } = req.body;
      if (!agent || new_trust_score === undefined) {
        return Errors.badRequest(res, "Missing agent or new_trust_score");
      }

      const { companyAgentService } = await import("./services/companyAgents");
      const currentAgent = await companyAgentService.getByCodename(agent);
      if (!currentAgent) {
        return Errors.notFound(res, `agent "${agent}"`);
      }

      const delta = new_trust_score - (currentAgent.trustScore ?? 50);
      const newScore = await companyAgentService.updateTrustScore(agent, delta);

      logger.info("Trust promotion approved", { agent, oldScore: currentAgent.trustScore, newScore });

      res.json({
        agent,
        previous_score: currentAgent.trustScore,
        new_score: newScore,
        promoted: true,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  /**
   * POST /api/scp/v2/trust/demote
   * Demote an agent's trust score.
   */
  app.post("/api/scp/v2/trust/demote", async (req: Request, res: Response) => {
    try {
      const { agent, new_trust_score } = req.body;
      if (!agent || new_trust_score === undefined) {
        return Errors.badRequest(res, "Missing agent or new_trust_score");
      }

      const { companyAgentService } = await import("./services/companyAgents");
      const currentAgent = await companyAgentService.getByCodename(agent);
      if (!currentAgent) {
        return Errors.notFound(res, `agent "${agent}"`);
      }

      const delta = new_trust_score - (currentAgent.trustScore ?? 50);
      const newScore = await companyAgentService.updateTrustScore(agent, delta);

      logger.info("Trust demotion applied", { agent, oldScore: currentAgent.trustScore, newScore });

      res.json({
        agent,
        previous_score: currentAgent.trustScore,
        new_score: newScore,
        demoted: true,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── Evolution Pause/Resume ────────────────────────────────────────────

  /**
   * POST /api/scp/v2/evolution/pause
   * Pause evolution for all agents.
   */
  app.post("/api/scp/v2/evolution/pause", async (req: Request, res: Response) => {
    try {
      const reason = req.body.reason || "CEO paused evolution";
      evolutionPaused = true;
      evolutionPausedAt = new Date().toISOString();
      evolutionPausedReason = reason;

      logger.info("Evolution paused", { reason });
      res.json({ paused: true, paused_at: evolutionPausedAt, reason });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  /**
   * POST /api/scp/v2/evolution/resume
   * Resume evolution for all agents.
   */
  app.post("/api/scp/v2/evolution/resume", async (_req: Request, res: Response) => {
    try {
      const wasPausedAt = evolutionPausedAt;
      evolutionPaused = false;
      evolutionPausedAt = null;
      evolutionPausedReason = null;

      logger.info("Evolution resumed", { was_paused_at: wasPausedAt });
      res.json({ paused: false, resumed_at: new Date().toISOString() });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  /**
   * GET /api/scp/v2/evolution/status
   * Check if evolution is paused/active.
   */
  app.get("/api/scp/v2/evolution/status", async (_req: Request, res: Response) => {
    res.json({
      paused: evolutionPaused,
      paused_at: evolutionPausedAt,
      paused_reason: evolutionPausedReason,
    });
  });

  // ─── Rollback Controls ────────────────────────────────────────────────

  /**
   * POST /api/scp/v2/evolution/rollback
   * Manually rollback an agent to a specific version.
   */
  app.post("/api/scp/v2/evolution/rollback", async (req: Request, res: Response) => {
    try {
      const { agent, to_version, reason } = req.body;
      if (!agent) {
        return Errors.badRequest(res, "Missing agent");
      }

      const cv = await getConfigVersioning();
      const currentVersion = cv.getAgentVersion(agent);
      if (!currentVersion) {
        return Errors.notFound(res, `agent "${agent}"`);
      }

      const { executeRollback } = await getGoldenSuiteService();
      executeRollback(
        agent,
        currentVersion.version,
        to_version ?? (currentVersion.parent ?? 1),
        reason ?? "CEO-initiated rollback"
      );

      res.json({
        agent,
        from_version: currentVersion.version,
        to_version: to_version ?? (currentVersion.parent ?? 1),
        reason: reason ?? "CEO-initiated rollback",
        rolled_back: true,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── "Talk to Your Company" — Enhanced Queries ─────────────────────────

  /**
   * POST /api/scp/v2/talk
   * Natural language interface for evolution and memory queries.
   * Supports:
   *   "What has [agent] learned this week?"
   *   "Show me [agent]'s golden suite"
   *   "Roll back [agent] to version X"
   *   "Pause evolution for all agents"
   *   "What did [agent] learn from [event]?"
   */
  app.post("/api/scp/v2/talk", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      if (!query) {
        return Errors.badRequest(res, "Missing query");
      }

      const response = await handleTalkQuery(query);
      res.json(response);
    } catch (err: any) {
      logger.error("Talk query error", { error: err });
      Errors.internal(res, err);
    }
  });

  // ─── Enhanced Briefing ─────────────────────────────────────────────────

  /**
   * GET /api/scp/v2/briefing
   * Enhanced CEO briefing with evolution status.
   */
  app.get("/api/scp/v2/briefing", async (_req: Request, res: Response) => {
    try {
      const summary = await getEvolutionSummary();
      const { getAllGoldenCases, checkTrustPromotions } = await getGoldenSuiteService();
      const { getJudgeCosts } = await getLLMJudges();

      const goldenSuiteOverview = await getAllGoldenCases();
      const trustPromotions = await checkTrustPromotions();
      const costs = getJudgeCosts();

      // Calculate company health score
      const totalSessions = summary.reduce((s, a) => s + a.total_sessions, 0);
      const avgVersion = summary.reduce((s, a) => s + a.version, 0) / summary.length;

      res.json({
        greeting: "Good morning, Thomas. Here's your company.",
        company_health: Math.min(100, Math.round(70 + avgVersion * 2)),

        evolution_overnight: summary
          .filter((a) => a.recent_changes.length > 0)
          .map((a) => ({
            agent: a.agent,
            version: a.version,
            changes: a.recent_changes,
          })),

        agent_status: summary.map((a) => ({
          agent: a.agent,
          version: a.version,
          cadence: a.cadence,
          sessions: a.total_sessions,
          golden_lessons: a.golden_suite_size,
        })),

        golden_suite: {
          total: goldenSuiteOverview.total,
          by_agent: goldenSuiteOverview.byAgent,
        },

        trust_promotions: trustPromotions,

        evolution_costs: {
          total_usd: costs.total_usd,
          by_agent: costs.by_agent,
        },

        evolution_paused: evolutionPaused,
        evolution_paused_reason: evolutionPausedReason,
      });
    } catch (err: any) {
      logger.error("Enhanced briefing error", { error: err });
      Errors.internal(res, err);
    }
  });

  // ─── Judge Cost Dashboard ──────────────────────────────────────────────

  /**
   * GET /api/scp/v2/costs
   * Evolution cost tracking dashboard.
   */
  app.get("/api/scp/v2/costs", async (_req: Request, res: Response) => {
    try {
      const { getJudgeCosts } = await getLLMJudges();
      res.json(getJudgeCosts());
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ─── Constitution View ────────────────────────────────────────────────

  /**
   * GET /api/scp/v2/constitution
   * View the immutable constitution.
   */
  app.get("/api/scp/v2/constitution", async (_req: Request, res: Response) => {
    try {
      const cv = await getConfigVersioning();
      const constitution = cv.readConstitution();
      const { CONSTITUTION_PRINCIPLES } = await import("./services/constitutionChecker");

      res.json({
        content: constitution,
        principles: CONSTITUTION_PRINCIPLES,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });
}

// ─── Talk Query Handler ────────────────────────────────────────────────────

async function handleTalkQuery(query: string): Promise<{
  type: string;
  response: string;
  data?: any;
}> {
  const q = query.toLowerCase().trim();

  // Pattern: "what has [agent] learned" / "[agent], what have you learned"
  const learnedMatch = q.match(/(?:what\s+(?:has|have)\s+)?(\w+)(?:\s+learned|\s+,?\s*what\s+(?:have\s+you|has\s+\w+)\s+learned)/i);
  if (learnedMatch) {
    const agent = learnedMatch[1].toLowerCase();
    const cv = await getConfigVersioning();
    const log = cv.readEvolutionLog(agent);
    const recentChanges = log.slice(-5);

    return {
      type: "evolution_history",
      response: recentChanges.length > 0
        ? `${agent} has evolved ${log.length} time(s). Recent changes:\n${recentChanges.map((e) => `- v${e.version}: ${e.changes.join(", ")} (${e.timestamp})`).join("\n")}`
        : `${agent} has not evolved yet.`,
      data: { agent, evolution_log: recentChanges },
    };
  }

  // Pattern: "show me [agent]'s golden suite" / "golden suite for [agent]"
  const goldenMatch = q.match(/(?:show\s+(?:me\s+)?)?(\w+)(?:'s)?\s+golden\s+suite|golden\s+suite\s+(?:for\s+)?(\w+)/i);
  if (goldenMatch) {
    const agent = (goldenMatch[1] || goldenMatch[2]).toLowerCase();
    const cv = await getConfigVersioning();
    const suite = cv.readGoldenSuite(agent);

    return {
      type: "golden_suite",
      response: suite.length > 0
        ? `${agent}'s golden suite has ${suite.length} lesson(s):\n${suite.map((gc) => `- ${gc.lesson}`).join("\n")}`
        : `${agent} has no golden cases yet.`,
      data: { agent, golden_suite: suite },
    };
  }

  // Pattern: "roll back [agent]" / "[agent] roll back"
  const rollbackMatch = q.match(/roll\s*back\s+(\w+)|(\w+)\s+roll\s*back/i);
  if (rollbackMatch) {
    const agent = (rollbackMatch[1] || rollbackMatch[2]).toLowerCase();
    const cv = await getConfigVersioning();
    const version = cv.getAgentVersion(agent);

    return {
      type: "rollback_confirm",
      response: version
        ? `${agent} is at v${version.version}. To roll back, use POST /api/scp/v2/evolution/rollback with { "agent": "${agent}" }`
        : `${agent} has no version history.`,
      data: { agent, current_version: version },
    };
  }

  // Pattern: "pause evolution"
  if (q.includes("pause evolution") || q.includes("freeze evolution")) {
    return {
      type: "pause_confirm",
      response: evolutionPaused
        ? `Evolution is already paused since ${evolutionPausedAt}. Reason: ${evolutionPausedReason}`
        : "To pause evolution, use POST /api/scp/v2/evolution/pause",
      data: { paused: evolutionPaused },
    };
  }

  // Pattern: "resume evolution"
  if (q.includes("resume evolution") || q.includes("unfreeze evolution")) {
    return {
      type: "resume_confirm",
      response: !evolutionPaused
        ? "Evolution is already active."
        : "To resume evolution, use POST /api/scp/v2/evolution/resume",
      data: { paused: evolutionPaused },
    };
  }

  // Pattern: general agent query
  const agentNames = ["atlas", "compass", "prism", "beacon", "scribe", "forge", "harbor", "sentinel", "ledger", "shield", "oracle", "crucible"];
  const mentionedAgent = agentNames.find((a) => q.includes(a));

  if (mentionedAgent) {
    const cv = await getConfigVersioning();
    const version = cv.getAgentVersion(mentionedAgent);
    const metrics = cv.getAgentMetrics(mentionedAgent);

    return {
      type: "agent_status",
      response: `${mentionedAgent} is at v${version?.version ?? 1} with ${metrics?.total_sessions ?? 0} sessions. Golden suite: ${metrics?.golden_suite_size ?? 0} lessons.`,
      data: { agent: mentionedAgent, version, metrics },
    };
  }

  return {
    type: "unknown",
    response: "I didn't understand that query. Try asking about a specific agent's evolution, golden suite, or evolution status.",
  };
}

// Export for testing
export { handleTalkQuery, evolutionPaused };
