// @ts-nocheck
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

import { type Express } from "express";
import { reactiveOrchestrationService } from "./services/reactiveOrchestrationV14";
import { feedbackLoopService } from "./services/feedbackLoopV14";
import { confidenceCascadeService } from "./services/confidenceCascadeV14";
import { founderIntentService } from "./services/founderIntentV14";
import { autonomyScoreService } from "./services/autonomyScoreV14";

export function registerFounderV14Routes(app: Express) {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. REACTIVE ORCHESTRATION — Event-driven agent chain execution
  // ═══════════════════════════════════════════════════════════════════════════

  // Chain management
  app.post("/api/founder/v14/chains", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.createChain(req.body.orgId, req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/founder/v14/chains/:chainId", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.updateChain(req.params.chainId, req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/founder/v14/chains/:chainId", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.deleteChain(req.params.chainId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/chains/:orgId", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getChains(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/chains/link", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.linkChains(req.body.fromChainId, req.body.toChainId, req.body.linkType, req.body.conditionFilter)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Event processing (THE CORE)
  app.post("/api/founder/v14/events/process", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.processEvent(req.body.orgId, req.body.eventType, req.body.payload)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/runs/:runId/resume", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.resumeRun(req.params.runId, req.body.resumedBy)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Monitoring
  app.get("/api/founder/v14/runs/:orgId/history", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getRunHistory(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/runs/:runId/details", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getRunDetails(req.params.runId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/chains/:chainId/stats", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getChainStats(req.params.chainId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/events/:orgId/coverage", async (req, res) => {
    try { res.json(await reactiveOrchestrationService.getEventCoverage(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. FEEDBACK LOOP — Founder overrides teach the system
  // ═══════════════════════════════════════════════════════════════════════════

  // Override capture
  app.post("/api/founder/v14/overrides", async (req, res) => {
    try { res.json(await feedbackLoopService.recordOverride(req.body.orgId, req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/overrides/:orgId", async (req, res) => {
    try { res.json(await feedbackLoopService.getOverrides(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/overrides/:overrideId/details", async (req, res) => {
    try { res.json(await feedbackLoopService.getOverrideDetails(req.params.overrideId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Learning extraction
  app.post("/api/founder/v14/learnings/:orgId/extract", async (req, res) => {
    try { res.json(await feedbackLoopService.extractLearnings(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/learnings/:learningId/reinforce", async (req, res) => {
    try { res.json(await feedbackLoopService.reinforceLearning(req.params.learningId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Propagation
  app.post("/api/founder/v14/learnings/:learningId/propagate", async (req, res) => {
    try { res.json(await feedbackLoopService.propagateLearning(req.params.learningId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/learnings/:orgId/propagate-all", async (req, res) => {
    try { res.json(await feedbackLoopService.propagateAllActive(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Learning management
  app.get("/api/founder/v14/learnings/:orgId", async (req, res) => {
    try { res.json(await feedbackLoopService.getLearnings(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/learnings/:learningId/retract", async (req, res) => {
    try { res.json(await feedbackLoopService.retractLearning(req.params.learningId, req.body.reason)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/learnings/:learningId/impact", async (req, res) => {
    try { res.json(await feedbackLoopService.getLearningImpact(req.params.learningId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Analytics
  app.get("/api/founder/v14/overrides/:orgId/analytics", async (req, res) => {
    try { res.json(await feedbackLoopService.getOverrideAnalytics(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. CONFIDENCE CASCADE — Multi-layer resolution before founder
  // ═══════════════════════════════════════════════════════════════════════════

  // Core resolution
  app.post("/api/founder/v14/cascade/resolve", async (req, res) => {
    try { res.json(await confidenceCascadeService.resolve(req.body.orgId, req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/cascade/:resolutionId/founder-resolve", async (req, res) => {
    try { res.json(await confidenceCascadeService.resolveFounderEscalation(req.params.resolutionId, req.body.founderDecision)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/cascade/bulk-resolve", async (req, res) => {
    try { res.json(await confidenceCascadeService.bulkResolve(req.body.orgId, req.body.requests)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Monitoring
  app.get("/api/founder/v14/cascade/:orgId/resolutions", async (req, res) => {
    try { res.json(await confidenceCascadeService.getResolutions(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/cascade/resolutions/:resolutionId", async (req, res) => {
    try { res.json(await confidenceCascadeService.getResolutionDetails(req.params.resolutionId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/cascade/:orgId/efficiency", async (req, res) => {
    try { res.json(await confidenceCascadeService.getCascadeEfficiency(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Founder queue (THE inbox)
  app.get("/api/founder/v14/cascade/:orgId/queue", async (req, res) => {
    try { res.json(await confidenceCascadeService.getFounderQueue(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/cascade/:orgId/agent/:codename/profile", async (req, res) => {
    try { res.json(await confidenceCascadeService.getAgentCascadeProfile(parseInt(req.params.orgId), req.params.codename)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/cascade/config", async (req, res) => {
    try { res.json(await confidenceCascadeService.getLayerConfig()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/cascade/:orgId/stats", async (req, res) => {
    try { res.json(await confidenceCascadeService.getCascadeStats(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. FOUNDER INTENT — Natural language goals → system config
  // ═══════════════════════════════════════════════════════════════════════════

  // Intent creation
  app.post("/api/founder/v14/intents", async (req, res) => {
    try { res.json(await founderIntentService.createIntent(req.body.orgId, req.body.rawInput, req.body.completesAt)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/intents/:intentId/simulate", async (req, res) => {
    try { res.json(await founderIntentService.simulateIntent(req.params.intentId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Activation & lifecycle
  app.post("/api/founder/v14/intents/:intentId/activate", async (req, res) => {
    try { res.json(await founderIntentService.activateIntent(req.params.intentId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/intents/:intentId/pause", async (req, res) => {
    try { res.json(await founderIntentService.pauseIntent(req.params.intentId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/intents/:intentId/resume", async (req, res) => {
    try { res.json(await founderIntentService.resumeIntent(req.params.intentId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Progress
  app.get("/api/founder/v14/intents/:intentId/progress", async (req, res) => {
    try { res.json(await founderIntentService.checkProgress(req.params.intentId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/intents/:intentId/auto-adjust", async (req, res) => {
    try { res.json(await founderIntentService.autoAdjust(req.params.intentId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Management
  app.get("/api/founder/v14/intents/:orgId", async (req, res) => {
    try { res.json(await founderIntentService.getIntents(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/intents/:intentId/details", async (req, res) => {
    try { res.json(await founderIntentService.getIntentDetails(req.params.intentId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/intents/:intentId/complete", async (req, res) => {
    try { res.json(await founderIntentService.completeIntent(req.params.intentId, req.body.outcome)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/intents/:orgId/analytics", async (req, res) => {
    try { res.json(await founderIntentService.getIntentAnalytics(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. AUTONOMY SCORE — Track and minimize founder dependency
  // ═══════════════════════════════════════════════════════════════════════════

  // Dependency tracking
  app.post("/api/founder/v14/autonomy/dependency-events", async (req, res) => {
    try { res.json(await autonomyScoreService.recordDependencyEvent(req.body.orgId, req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v14/autonomy/dependency-events/:eventId/resolve", async (req, res) => {
    try { res.json(await autonomyScoreService.resolveDependencyEvent(req.params.eventId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/dependency-events", async (req, res) => {
    try { res.json(await autonomyScoreService.getDependencyEvents(parseInt(req.params.orgId), req.query)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Score calculation
  app.post("/api/founder/v14/autonomy/:orgId/calculate-daily", async (req, res) => {
    try { res.json(await autonomyScoreService.calculateDailyScore(parseInt(req.params.orgId), req.body.date)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/weekly", async (req, res) => {
    try { res.json(await autonomyScoreService.calculateWeeklyScore(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // The Founder-Free Week Test
  app.get("/api/founder/v14/autonomy/:orgId/founder-free-simulation", async (req, res) => {
    try { res.json(await autonomyScoreService.runFounderFreeSimulation(parseInt(req.params.orgId), req.query.days ? parseInt(req.query.days as string) : undefined)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Analytics
  app.get("/api/founder/v14/autonomy/:orgId/history", async (req, res) => {
    try { res.json(await autonomyScoreService.getScoreHistory(parseInt(req.params.orgId), req.query.days ? parseInt(req.query.days as string) : undefined)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/trend", async (req, res) => {
    try { res.json(await autonomyScoreService.getAutonomyTrend(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/agent-ranking", async (req, res) => {
    try { res.json(await autonomyScoreService.getAgentAutonomyRanking(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/category-breakdown", async (req, res) => {
    try { res.json(await autonomyScoreService.getCategoryBreakdown(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/bottlenecks", async (req, res) => {
    try { res.json(await autonomyScoreService.getBottlenecks(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/targets", async (req, res) => {
    try { res.json(await autonomyScoreService.getTargets(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v14/autonomy/:orgId/stats", async (req, res) => {
    try { res.json(await autonomyScoreService.getStats(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

}
