/**
 * Founder v14 Routes — Sovereign Company Protocol v14: The Self-Running Company
 *
 * Five integration pillars that wire V13's cognitive capabilities into closed-loop
 * autonomous workflows:
 *
 * 1. Reactive Orchestration — Events trigger agent chains automatically
 * 2. Feedback Loop — Founder overrides teach the system
 * 3. Confidence Cascade — Exhaust all resources before bothering founder
 * 4. Founder Intent — Natural language goals → system configuration
 * 5. Autonomy Score — Track and minimize founder dependency
 */

import { type Express, type Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import { reactiveOrchestrationService } from "./services/reactiveOrchestrationV14";
import { feedbackLoopService } from "./services/feedbackLoopV14";
import { confidenceCascadeService } from "./services/confidenceCascadeV14";
import { autonomyScoreService } from "./services/autonomyScoreV14";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { getOrganizationId, type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";

export function registerFounderV14Routes(app: Express) {
  // Defense-in-depth (2026-07 security sweep): these routes were protected
  // ONLY by the app.use('/api/founder/v14', …) gate registered earlier in
  // routes.ts — a future reordering would have made every endpoint here
  // fully public. The file now self-gates regardless of mount order.
  app.use("/api/founder/v14", isAuthenticated, requireFounder);


  // ═══════════════════════════════════════════════════════════════════════════
  // 1. REACTIVE ORCHESTRATION — Event-driven agent chain execution
  // ═══════════════════════════════════════════════════════════════════════════

  // Chain management
  app.post("/api/founder/v14/chains", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.createChain(req.body.orgId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.put("/api/founder/v14/chains/:chainId", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.updateChain(req.params.chainId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.delete("/api/founder/v14/chains/:chainId", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.deleteChain(req.params.chainId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/chains/:orgId", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getChains(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v14/chains/link", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.linkChains(req.body.fromChainId, req.body.toChainId, req.body.linkType, req.body.conditionFilter)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Event processing (THE CORE)
  app.post("/api/founder/v14/events/process", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.processEvent(req.body.orgId, req.body.eventType, req.body.payload)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v14/runs/:runId/resume", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.resumeRun(req.params.runId, req.body.resumedBy)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Monitoring
  app.get("/api/founder/v14/runs/:orgId/history", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getRunHistory(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/runs/:runId/details", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getRunDetails(req.params.runId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/chains/:chainId/stats", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getChainStats(req.params.chainId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/events/:orgId/coverage", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getEventCoverage(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. FEEDBACK LOOP — Founder overrides teach the system
  // ═══════════════════════════════════════════════════════════════════════════

  // Override capture
  app.post("/api/founder/v14/overrides", async (req, res) => {
    try { res.json(await feedbackLoopService.recordOverride(req.body.orgId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/overrides/:orgId", async (req, res) => {
    try { res.json(await feedbackLoopService.getOverrides(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/overrides/:overrideId/details", async (req, res) => {
    try { res.json(await feedbackLoopService.getOverrideDetails(req.params.overrideId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Learning extraction
  app.post("/api/founder/v14/learnings/:orgId/extract", async (req, res) => {
    try { res.json(await feedbackLoopService.extractLearnings(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v14/learnings/:learningId/reinforce", async (req, res) => {
    try { res.json(await feedbackLoopService.reinforceLearning(req.params.learningId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Propagation
  app.post("/api/founder/v14/learnings/:learningId/propagate", async (req, res) => {
    try { res.json(await feedbackLoopService.propagateLearning(req.params.learningId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v14/learnings/:orgId/propagate-all", async (req, res) => {
    try { res.json(await feedbackLoopService.propagateAllActive(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Learning management
  app.get("/api/founder/v14/learnings/:orgId", async (req, res) => {
    try { res.json(await feedbackLoopService.getLearnings(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v14/learnings/:learningId/retract", async (req, res) => {
    try { res.json(await feedbackLoopService.retractLearning(req.params.learningId, req.body.reason)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/learnings/:learningId/impact", async (req, res) => {
    try { res.json(await feedbackLoopService.getLearningImpact(req.params.learningId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Analytics
  app.get("/api/founder/v14/overrides/:orgId/analytics", async (req, res) => {
    try { res.json(await feedbackLoopService.getOverrideAnalytics(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CONFIDENCE CASCADE — Multi-layer resolution before founder
  // ═══════════════════════════════════════════════════════════════════════════

  // Core resolution
  app.post("/api/founder/v14/cascade/resolve", async (req, res) => {
    try { res.json(await confidenceCascadeService.resolve(req.body.orgId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v14/cascade/:resolutionId/founder-resolve", async (req, res) => {
    try { res.json(await confidenceCascadeService.resolveFounderEscalation(req.params.resolutionId, req.body.founderDecision)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v14/cascade/bulk-resolve", async (req, res) => {
    try { res.json(await confidenceCascadeService.bulkResolve(req.body.orgId, req.body.requests)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Monitoring
  app.get("/api/founder/v14/cascade/:orgId/resolutions", async (req, res) => {
    try { res.json(await confidenceCascadeService.getResolutions(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/cascade/resolutions/:resolutionId", async (req, res) => {
    try { res.json(await confidenceCascadeService.getResolutionDetails(req.params.resolutionId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/cascade/:orgId/efficiency", async (req, res) => {
    try {
      const { from, to } = req.query;
      const dateRange = from && to
        ? { from: new Date(String(from)), to: new Date(String(to)) }
        : undefined;
      res.json(await confidenceCascadeService.getCascadeEfficiency(parseInt(req.params.orgId), dateRange));
    }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Founder queue (THE inbox)
  app.get("/api/founder/v14/cascade/:orgId/queue", async (req, res) => {
    try { res.json(await confidenceCascadeService.getFounderQueue(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/cascade/:orgId/agent/:codename/profile", async (req, res) => {
    try { res.json(await confidenceCascadeService.getAgentCascadeProfile(parseInt(req.params.orgId), req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/cascade/config", async (req, res) => {
    try { res.json(await confidenceCascadeService.getLayerConfig()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/cascade/:orgId/stats", async (req, res) => {
    try { res.json(await confidenceCascadeService.getCascadeStats(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Section 4 (FOUNDER INTENT) was DELETED 2026-08-28 with founderIntentV14 —
  // competing-brains stage 2: zero client fetches, zero service/job importers,
  // zero tests. The incumbent plane owns "natural-language founder goals →
  // system config" (autopilot/objectives, okr, standingOrders, steer).
  // founderIntents/intentProgressLogs await the OD-8 drop decision.

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. AUTONOMY SCORE — Track and minimize founder dependency
  // ═══════════════════════════════════════════════════════════════════════════

  // Session-scoped score for the current org. Resolves orgId from the
  // authenticated session so today.tsx and sovereign-dashboard.tsx don't have
  // to know it. Returns latest daily snapshot as `score` and rolling 7d as
  // `overallScore` to match the client's `autonomy?.score ?? autonomy?.overallScore ?? 0`
  // fallback chain. Falls back to 0 honestly when no snapshots exist.
  app.get("/api/founder/v14/autonomy/score", isAuthenticated, getOrCreateOrg, async (req, res: Response) => {
    try {
      const orgId = getOrganizationId(req as AuthenticatedRequest);
      const stats = await autonomyScoreService.getStats(orgId);
      res.json({
        score: stats.latestScore,
        overallScore: stats.weeklyAvg,
        ...stats,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Dependency tracking
  app.post("/api/founder/v14/autonomy/dependency-events", async (req, res) => {
    try { res.json(await autonomyScoreService.recordDependencyEvent(req.body.orgId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v14/autonomy/dependency-events/:eventId/resolve", async (req, res) => {
    try { res.json(await autonomyScoreService.resolveDependencyEvent(req.params.eventId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/dependency-events", async (req, res) => {
    try { res.json(await autonomyScoreService.getDependencyEvents(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Score calculation
  app.post("/api/founder/v14/autonomy/:orgId/calculate-daily", async (req, res) => {
    try { res.json(await autonomyScoreService.calculateDailyScore(parseInt(req.params.orgId), req.body.date)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/weekly", async (req, res) => {
    try { res.json(await autonomyScoreService.calculateWeeklyScore(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // The Founder-Free Week Test
  app.get("/api/founder/v14/autonomy/:orgId/founder-free-simulation", async (req, res) => {
    try { res.json(await autonomyScoreService.runFounderFreeSimulation(parseInt(req.params.orgId), req.query.days ? parseInt(req.query.days as string) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Analytics
  app.get("/api/founder/v14/autonomy/:orgId/history", async (req, res) => {
    try { res.json(await autonomyScoreService.getScoreHistory(parseInt(req.params.orgId), req.query.days ? parseInt(req.query.days as string) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/trend", async (req, res) => {
    try { res.json(await autonomyScoreService.getAutonomyTrend(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/agent-ranking", async (req, res) => {
    try { res.json(await autonomyScoreService.getAgentAutonomyRanking(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/category-breakdown", async (req, res) => {
    try { res.json(await autonomyScoreService.getCategoryBreakdown(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/bottlenecks", async (req, res) => {
    try { res.json(await autonomyScoreService.getBottlenecks(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/targets", async (req, res) => {
    try { res.json(await autonomyScoreService.getTargets(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/stats", async (req, res) => {
    try { res.json(await autonomyScoreService.getStats(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

}
