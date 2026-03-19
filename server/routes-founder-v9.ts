// @ts-nocheck
/**
 * Founder v9 Routes — Sovereign Company Protocol v9: The Self-Running Company
 *
 * Seven new systems:
 * 1. Agent Initiative + CEO Daily Briefing
 * 2. Playbook Evolution Engine
 * 3. Compass Auto-Recommendation
 * 4. Spend Autonomy Layer
 * 5. Causal Reasoning Engine
 * 6. Delegation Depth (Agent-to-Agent Goal Cascading)
 * 7. External Intelligence Feeds
 */

import { type Express } from "express";
import { agentInitiativeService } from "./services/agentInitiativeV9";
import { playbookEvolutionService } from "./services/playbookEvolutionV9";
import { compassAutoRecommendService } from "./services/compassAutoRecommendV9";
import { spendAutonomyService } from "./services/spendAutonomyV9";
import { causalReasoningService } from "./services/causalReasoningV9";
import { delegationDepthService } from "./services/delegationDepthV9";
import { externalIntelligenceService } from "./services/externalIntelligenceV9";

export function registerFounderV9Routes(app: Express) {

  // ─── 1. Agent Initiative + CEO Daily Briefing ───────────────────────────

  // Run the daily thinking cycle for all agents → produces CEO briefing
  app.post("/api/founder/v9/initiative/run-cycle", async (_req, res) => {
    try {
      const briefingId = await agentInitiativeService.runDailyCycle();
      const briefing = await agentInitiativeService.getLatestBriefing();
      res.json({ briefingId, briefing });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get the latest CEO briefing
  app.get("/api/founder/v9/briefing", async (_req, res) => {
    try {
      const briefing = await agentInitiativeService.getLatestBriefing();
      res.json(briefing || null);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent briefings
  app.get("/api/founder/v9/briefings", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "7"));
      const briefings = await agentInitiativeService.getRecentBriefings(limit);
      res.json(briefings);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get pending initiative approvals
  app.get("/api/founder/v9/initiative/pending", async (_req, res) => {
    try {
      const pending = await agentInitiativeService.getPendingApprovals();
      res.json(pending);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Approve an initiative's proposed action
  app.post("/api/founder/v9/initiative/:id/approve", async (req, res) => {
    try {
      await agentInitiativeService.approveAction(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Reject an initiative's proposed action
  app.post("/api/founder/v9/initiative/:id/reject", async (req, res) => {
    try {
      await agentInitiativeService.rejectAction(parseInt(req.params.id), req.body.reason);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 2. Playbook Evolution Engine ─────────────────────────────────────

  // Scan playbooks for degradation → propose mutations
  app.post("/api/founder/v9/evolution/scan", async (_req, res) => {
    try {
      const results = await playbookEvolutionService.scanForDegradation();
      res.json(results);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get proposed evolutions awaiting approval
  app.get("/api/founder/v9/evolution/proposed", async (_req, res) => {
    try {
      const proposed = await playbookEvolutionService.getProposedEvolutions();
      res.json(proposed);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get active A/B tests
  app.get("/api/founder/v9/evolution/active", async (_req, res) => {
    try {
      const active = await playbookEvolutionService.getActiveEvolutions();
      res.json(active);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get evolution history for a playbook
  app.get("/api/founder/v9/evolution/history/:playbookId", async (req, res) => {
    try {
      const history = await playbookEvolutionService.getPlaybookHistory(parseInt(req.params.playbookId));
      res.json(history);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Approve a proposed mutation → start A/B test
  app.post("/api/founder/v9/evolution/:id/approve", async (req, res) => {
    try {
      await playbookEvolutionService.approveEvolution(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Record a challenger execution result
  app.post("/api/founder/v9/evolution/:id/result", async (req, res) => {
    try {
      const result = await playbookEvolutionService.recordChallengerResult(
        parseInt(req.params.id),
        req.body.success
      );
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get all recent evolutions
  app.get("/api/founder/v9/evolution", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "20"));
      const evolutions = await playbookEvolutionService.getRecent(limit);
      res.json(evolutions);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 3. Compass Auto-Recommendation ──────────────────────────────────

  // Evaluate compass triggers → returns recommendations
  app.post("/api/founder/v9/compass/evaluate", async (_req, res) => {
    try {
      const recommendations = await compassAutoRecommendService.evaluate();
      res.json(recommendations);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get pending compass recommendations
  app.get("/api/founder/v9/compass/recommendations", async (_req, res) => {
    try {
      const pending = await compassAutoRecommendService.getPending();
      res.json(pending);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Accept a compass recommendation → switch mode
  app.post("/api/founder/v9/compass/recommendations/:id/accept", async (req, res) => {
    try {
      await compassAutoRecommendService.accept(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Dismiss a compass recommendation
  app.post("/api/founder/v9/compass/recommendations/:id/dismiss", async (req, res) => {
    try {
      await compassAutoRecommendService.dismiss(parseInt(req.params.id), req.body.reason);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent recommendations history
  app.get("/api/founder/v9/compass/recommendations/history", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "10"));
      const history = await compassAutoRecommendService.getRecent(limit);
      res.json(history);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 4. Spend Autonomy Layer ──────────────────────────────────────────

  // Run weekly spend audit
  app.post("/api/founder/v9/spend/audit", async (_req, res) => {
    try {
      const report = await spendAutonomyService.runWeeklyAudit();
      res.json(report);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get pending optimization proposals
  app.get("/api/founder/v9/spend/optimizations", async (_req, res) => {
    try {
      const optimizations = await spendAutonomyService.getPendingOptimizations();
      res.json(optimizations);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get spend by category
  app.get("/api/founder/v9/spend/categories", async (_req, res) => {
    try {
      const categories = await spendAutonomyService.getSpendByCategory();
      res.json(categories);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent spend watchers
  app.get("/api/founder/v9/spend/watchers", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "20"));
      const watchers = await spendAutonomyService.getRecentWatchers(limit);
      res.json(watchers);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Approve a spend optimization
  app.post("/api/founder/v9/spend/optimizations/:id/approve", async (req, res) => {
    try {
      await spendAutonomyService.approveOptimization(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Skip a spend optimization
  app.post("/api/founder/v9/spend/optimizations/:id/skip", async (req, res) => {
    try {
      await spendAutonomyService.skipOptimization(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Mark an optimization as executed
  app.post("/api/founder/v9/spend/optimizations/:id/executed", async (req, res) => {
    try {
      await spendAutonomyService.markExecuted(parseInt(req.params.id), req.body.actualSavings);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 5. Causal Reasoning Engine ───────────────────────────────────────

  // Launch a causal investigation
  app.post("/api/founder/v9/investigations", async (req, res) => {
    try {
      const id = await causalReasoningService.investigate({
        anomalyType: req.body.anomalyType,
        metric: req.body.metric,
        currentValue: req.body.currentValue,
        expectedValue: req.body.expectedValue,
        detectedBy: req.body.detectedBy || "oracle_analytics",
        additionalContext: req.body.context,
      });
      const investigation = await causalReasoningService.getById(id);
      res.json(investigation);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get open investigations
  app.get("/api/founder/v9/investigations", async (_req, res) => {
    try {
      const investigations = await causalReasoningService.getOpen();
      res.json(investigations);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get investigation by ID
  app.get("/api/founder/v9/investigations/:id", async (req, res) => {
    try {
      const investigation = await causalReasoningService.getById(parseInt(req.params.id));
      res.json(investigation || null);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Resolve an investigation
  app.post("/api/founder/v9/investigations/:id/resolve", async (req, res) => {
    try {
      await causalReasoningService.resolve(parseInt(req.params.id), req.body.confirmedCause, req.body.actionTaken);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Dismiss an investigation
  app.post("/api/founder/v9/investigations/:id/dismiss", async (req, res) => {
    try {
      await causalReasoningService.dismiss(parseInt(req.params.id), req.body.reason);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent investigations
  app.get("/api/founder/v9/investigations/history", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "10"));
      const investigations = await causalReasoningService.getRecent(limit);
      res.json(investigations);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 6. Delegation Depth ─────────────────────────────────────────────

  // CEO sets a strategic goal
  app.post("/api/founder/v9/goals", async (req, res) => {
    try {
      const id = await delegationDepthService.setStrategicGoal({
        goal: req.body.goal,
        coordinatorAgent: req.body.coordinatorAgent || "oracle_analytics",
        targetMetric: req.body.targetMetric,
        targetValue: req.body.targetValue,
        deadline: req.body.deadline ? new Date(req.body.deadline) : undefined,
      });
      res.json({ id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get all strategic goals
  app.get("/api/founder/v9/goals", async (_req, res) => {
    try {
      const goals = await delegationDepthService.getStrategicGoals();
      res.json(goals);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get sub-goals for a parent goal
  app.get("/api/founder/v9/goals/:id/sub-goals", async (req, res) => {
    try {
      const subGoals = await delegationDepthService.getSubGoals(parseInt(req.params.id));
      res.json(subGoals);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get progress report for a strategic goal
  app.get("/api/founder/v9/goals/:id/report", async (req, res) => {
    try {
      const report = await delegationDepthService.generateProgressReport(parseInt(req.params.id));
      res.json(report);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Agent reports progress on a goal
  app.post("/api/founder/v9/goals/:id/progress", async (req, res) => {
    try {
      await delegationDepthService.reportProgress(
        parseInt(req.params.id),
        req.body.progress,
        req.body.update,
      );
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get active goals for a specific agent
  app.get("/api/founder/v9/goals/agent/:codename", async (req, res) => {
    try {
      const goals = await delegationDepthService.getAgentGoals(req.params.codename);
      res.json(goals);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 7. External Intelligence Feeds ──────────────────────────────────

  // Run all intelligence scans
  app.post("/api/founder/v9/intelligence/scan", async (req, res) => {
    try {
      const frequency = req.body.frequency || undefined;
      const ids = await externalIntelligenceService.runAllScans(frequency);
      res.json({ scansCompleted: ids.length, ids });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Run a specific intelligence scan
  app.post("/api/founder/v9/intelligence/scan/:sourceName", async (req, res) => {
    try {
      const id = await externalIntelligenceService.runScan(req.params.sourceName);
      res.json({ id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get items pending review
  app.get("/api/founder/v9/intelligence/pending", async (_req, res) => {
    try {
      const items = await externalIntelligenceService.getPendingReview();
      res.json(items);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent intelligence by feed type
  app.get("/api/founder/v9/intelligence/:feedType", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "10"));
      const items = await externalIntelligenceService.getByFeedType(req.params.feedType as any, limit);
      res.json(items);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get all recent intelligence
  app.get("/api/founder/v9/intelligence", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "20"));
      const items = await externalIntelligenceService.getRecent(limit);
      res.json(items);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Acknowledge an intelligence item
  app.post("/api/founder/v9/intelligence/:id/acknowledge", async (req, res) => {
    try {
      await externalIntelligenceService.acknowledge(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Mark as acted upon
  app.post("/api/founder/v9/intelligence/:id/acted", async (req, res) => {
    try {
      await externalIntelligenceService.markActedUpon(parseInt(req.params.id), req.body.actionTaken);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get available intelligence sources
  app.get("/api/founder/v9/intelligence-sources", async (_req, res) => {
    try {
      const sources = externalIntelligenceService.getSources();
      res.json(sources);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
