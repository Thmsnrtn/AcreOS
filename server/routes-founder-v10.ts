// @ts-nocheck
/**
 * Founder v10 Routes — Sovereign Company Protocol v10: The Conscious Organization
 *
 * Eight new systems:
 * 1. Scenario War Room — multi-agent "what if?" simulation
 * 2. Closed-Loop Learning Engine — outcome → learning → propagation
 * 3. Organizational Heartbeat Monitor — system self-awareness
 * 4. Agent Self-Calibration Protocol — automatic parameter tuning
 * 5. CEO Decision Replay + Bias Detection — hindsight analysis
 * 6. Resilience & Chaos Testing — SPOF detection
 * 7. Real-Time Nervous System — typed WebSocket events
 * 8. Adaptive CEO Command Surface — context-aware dashboard
 */

import { type Express } from "express";
import { scenarioWarRoomService } from "./services/scenarioWarRoomV10";
import { closedLoopLearningService } from "./services/closedLoopLearningV10";
import { orgHeartbeatService } from "./services/orgHeartbeatV10";
import { agentSelfCalibrationService } from "./services/agentSelfCalibrationV10";
import { ceoDecisionReplayService } from "./services/ceoDecisionReplayV10";
import { resilienceTestingService } from "./services/resilienceTestingV10";
import { realtimeNervousSystemService } from "./services/realtimeNervousSystemV10";
import { adaptiveSurfaceService } from "./services/adaptiveSurfaceV10";

export function registerFounderV10Routes(app: Express) {

  // ─── 1. Scenario War Room ──────────────────────────────────────────────

  // Launch a multi-agent scenario simulation
  app.post("/api/founder/v10/scenarios/simulate", async (req, res) => {
    try {
      const scenario = await scenarioWarRoomService.simulate({
        title: req.body.title,
        scenarioType: req.body.scenarioType || "custom",
        hypothesis: req.body.hypothesis,
        parameters: req.body.parameters || {},
      });
      res.json(scenario);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get a specific scenario
  app.get("/api/founder/v10/scenarios/:id", async (req, res) => {
    try {
      const scenario = await scenarioWarRoomService.getById(parseInt(req.params.id));
      res.json(scenario || null);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent scenarios
  app.get("/api/founder/v10/scenarios", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "20"));
      const scenarios = await scenarioWarRoomService.getRecent(limit);
      res.json(scenarios);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get scenarios by type
  app.get("/api/founder/v10/scenarios/type/:type", async (req, res) => {
    try {
      const scenarios = await scenarioWarRoomService.getByType(req.params.type);
      res.json(scenarios);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Compare scenario prediction vs actual outcome
  app.post("/api/founder/v10/scenarios/:id/compare", async (req, res) => {
    try {
      const comparison = await scenarioWarRoomService.compareOutcome(
        parseInt(req.params.id),
        req.body.actualOutcome,
      );
      res.json(comparison);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get outcome comparisons for a scenario
  app.get("/api/founder/v10/scenarios/:id/comparisons", async (req, res) => {
    try {
      const comparisons = await scenarioWarRoomService.getComparisons(parseInt(req.params.id));
      res.json(comparisons);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Archive a scenario
  app.post("/api/founder/v10/scenarios/:id/archive", async (req, res) => {
    try {
      await scenarioWarRoomService.archive(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 2. Closed-Loop Learning Engine ────────────────────────────────────

  // Record a prediction for calibration
  app.post("/api/founder/v10/learning/predictions", async (req, res) => {
    try {
      const id = await closedLoopLearningService.recordPrediction({
        agentCodename: req.body.agentCodename,
        actionType: req.body.actionType,
        predictedOutcome: req.body.predictedOutcome,
        predictedConfidence: req.body.predictedConfidence,
        outcomeWindowDays: req.body.outcomeWindowDays,
      });
      res.json({ id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Measure outcome against prediction
  app.post("/api/founder/v10/learning/predictions/:id/measure", async (req, res) => {
    try {
      const result = await closedLoopLearningService.measureOutcome(
        parseInt(req.params.id),
        { actualOutcome: req.body.actualOutcome, actualSuccess: req.body.actualSuccess },
      );
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get predictions awaiting outcome
  app.get("/api/founder/v10/learning/awaiting", async (req, res) => {
    try {
      const agent = req.query.agent as string | undefined;
      const awaiting = await closedLoopLearningService.getAwaitingOutcome(agent);
      res.json(awaiting);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get overdue predictions
  app.get("/api/founder/v10/learning/overdue", async (_req, res) => {
    try {
      const overdue = await closedLoopLearningService.getOverduePredictions();
      res.json(overdue);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get calibration stats for all agents
  app.get("/api/founder/v10/learning/calibration", async (_req, res) => {
    try {
      const stats = await closedLoopLearningService.getAllCalibrationStats();
      res.json(stats);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get calibration stats for a specific agent
  app.get("/api/founder/v10/learning/calibration/:agent", async (req, res) => {
    try {
      const stats = await closedLoopLearningService.getAgentCalibrationStats(req.params.agent);
      res.json(stats);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent learning propagations
  app.get("/api/founder/v10/learning/propagations", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "20"));
      const learnings = await closedLoopLearningService.getRecentLearnings(limit);
      res.json(learnings);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get learnings for a specific agent
  app.get("/api/founder/v10/learning/propagations/agent/:agent", async (req, res) => {
    try {
      const learnings = await closedLoopLearningService.getLearningsForAgent(req.params.agent);
      res.json(learnings);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get learning velocity
  app.get("/api/founder/v10/learning/velocity", async (_req, res) => {
    try {
      const velocity = await closedLoopLearningService.getLearningVelocity();
      res.json(velocity);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 3. Organizational Heartbeat Monitor ───────────────────────────────

  // Take a heartbeat snapshot
  app.post("/api/founder/v10/heartbeat/snapshot", async (req, res) => {
    try {
      const type = req.body.type || "hourly";
      const snapshot = await orgHeartbeatService.takeSnapshot(type);
      res.json(snapshot);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get latest heartbeat
  app.get("/api/founder/v10/heartbeat", async (_req, res) => {
    try {
      const latest = await orgHeartbeatService.getLatest();
      res.json(latest || null);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent heartbeat snapshots
  app.get("/api/founder/v10/heartbeat/history", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "24"));
      const snapshots = await orgHeartbeatService.getRecent(limit);
      res.json(snapshots);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get health trend
  app.get("/api/founder/v10/heartbeat/trend", async (req, res) => {
    try {
      const days = parseInt(String(req.query.days || "7"));
      const trend = await orgHeartbeatService.getHealthTrend(days);
      res.json(trend);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get active anomalies
  app.get("/api/founder/v10/heartbeat/anomalies", async (_req, res) => {
    try {
      const anomalies = await orgHeartbeatService.getActiveAnomalies();
      res.json(anomalies);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 4. Agent Self-Calibration Protocol ────────────────────────────────

  // Run calibration cycle for all agents
  app.post("/api/founder/v10/calibration/cycle", async (_req, res) => {
    try {
      const calibrations = await agentSelfCalibrationService.runCalibrationCycle();
      res.json(calibrations);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Run AI-driven calibration for a specific agent
  app.post("/api/founder/v10/calibration/agent/:codename", async (req, res) => {
    try {
      const calibration = await agentSelfCalibrationService.analyzeAndCalibrate(req.params.codename);
      res.json(calibration || { noCalibrationNeeded: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get pending calibrations
  app.get("/api/founder/v10/calibration/pending", async (_req, res) => {
    try {
      const pending = await agentSelfCalibrationService.getPending();
      res.json(pending);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get calibration history for an agent
  app.get("/api/founder/v10/calibration/agent/:codename/history", async (req, res) => {
    try {
      const history = await agentSelfCalibrationService.getAgentHistory(req.params.codename);
      res.json(history);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get all recent calibrations
  app.get("/api/founder/v10/calibration", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "30"));
      const calibrations = await agentSelfCalibrationService.getRecent(limit);
      res.json(calibrations);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Approve a calibration
  app.post("/api/founder/v10/calibration/:id/approve", async (req, res) => {
    try {
      await agentSelfCalibrationService.approve(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Revert a calibration
  app.post("/api/founder/v10/calibration/:id/revert", async (req, res) => {
    try {
      await agentSelfCalibrationService.revert(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 5. CEO Decision Replay + Bias Detection ──────────────────────────

  // Record a CEO decision
  app.post("/api/founder/v10/decisions", async (req, res) => {
    try {
      const id = await ceoDecisionReplayService.recordDecision({
        decisionType: req.body.decisionType,
        decisionSummary: req.body.decisionSummary,
        context: req.body.context || {},
        agentRecommendations: req.body.agentRecommendations || [],
        ceoChoice: req.body.ceoChoice,
      });
      res.json({ id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Replay a decision with outcome data
  app.post("/api/founder/v10/decisions/:id/replay", async (req, res) => {
    try {
      const replay = await ceoDecisionReplayService.replayDecision(
        parseInt(req.params.id),
        req.body.outcomeData,
      );
      res.json(replay);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get bias analysis
  app.get("/api/founder/v10/decisions/biases", async (req, res) => {
    try {
      const days = parseInt(String(req.query.days || "90"));
      const analysis = await ceoDecisionReplayService.analyzeBiases(days);
      res.json(analysis);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get decisions awaiting replay
  app.get("/api/founder/v10/decisions/awaiting", async (_req, res) => {
    try {
      const awaiting = await ceoDecisionReplayService.getAwaitingReplay();
      res.json(awaiting);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent replayed decisions
  app.get("/api/founder/v10/decisions/replays", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "20"));
      const replays = await ceoDecisionReplayService.getRecentReplays(limit);
      res.json(replays);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get decision quality trend
  app.get("/api/founder/v10/decisions/quality-trend", async (req, res) => {
    try {
      const days = parseInt(String(req.query.days || "90"));
      const trend = await ceoDecisionReplayService.getQualityTrend(days);
      res.json(trend);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 6. Resilience & Chaos Testing ────────────────────────────────────

  // Run a specific chaos test
  app.post("/api/founder/v10/resilience/test", async (req, res) => {
    try {
      const result = await resilienceTestingService.runTest(
        req.body.testType,
        req.body.params,
      );
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Run full resilience suite
  app.post("/api/founder/v10/resilience/full-suite", async (_req, res) => {
    try {
      const suite = await resilienceTestingService.runFullSuite();
      res.json(suite);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get recent resilience tests
  app.get("/api/founder/v10/resilience", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "20"));
      const tests = await resilienceTestingService.getRecent(limit);
      res.json(tests);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get resilience tests by type
  app.get("/api/founder/v10/resilience/type/:type", async (req, res) => {
    try {
      const tests = await resilienceTestingService.getByType(req.params.type);
      res.json(tests);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get latest resilience score
  app.get("/api/founder/v10/resilience/score", async (_req, res) => {
    try {
      const score = await resilienceTestingService.getLatestScore();
      res.json(score || { score: 0, grade: "?", testCount: 0 });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 7. Real-Time Nervous System ──────────────────────────────────────

  // Get recent nervous system events
  app.get("/api/founder/v10/nervous-system/events", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "50"));
      const events = await realtimeNervousSystemService.getRecentEvents(limit);
      res.json(events);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get events by type
  app.get("/api/founder/v10/nervous-system/events/type/:type", async (req, res) => {
    try {
      const events = await realtimeNervousSystemService.getEventsByType(req.params.type);
      res.json(events);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get events for a specific agent
  app.get("/api/founder/v10/nervous-system/events/agent/:codename", async (req, res) => {
    try {
      const events = await realtimeNervousSystemService.getAgentEvents(req.params.codename);
      res.json(events);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get event stats
  app.get("/api/founder/v10/nervous-system/stats", async (req, res) => {
    try {
      const hours = parseInt(String(req.query.hours || "24"));
      const stats = await realtimeNervousSystemService.getEventStats(hours);
      res.json(stats);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Start nervous system heartbeat
  app.post("/api/founder/v10/nervous-system/heartbeat/start", async (_req, res) => {
    try {
      realtimeNervousSystemService.startHeartbeat();
      res.json({ success: true, message: "Heartbeat started" });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Stop nervous system heartbeat
  app.post("/api/founder/v10/nervous-system/heartbeat/stop", async (_req, res) => {
    try {
      realtimeNervousSystemService.stopHeartbeat();
      res.json({ success: true, message: "Heartbeat stopped" });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 8. Adaptive CEO Command Surface ──────────────────────────────────

  // Detect and apply current context
  app.post("/api/founder/v10/surface/detect", async (_req, res) => {
    try {
      const state = await adaptiveSurfaceService.detectContext();
      res.json(state);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get current surface state
  app.get("/api/founder/v10/surface", async (_req, res) => {
    try {
      const state = await adaptiveSurfaceService.getCurrent();
      res.json(state || { contextMode: "default", activeLayers: [], suppressedLayers: [] });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Force a specific surface mode
  app.post("/api/founder/v10/surface/force", async (req, res) => {
    try {
      const state = await adaptiveSurfaceService.forceMode(req.body.mode, req.body.reason);
      res.json(state);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get surface context history
  app.get("/api/founder/v10/surface/history", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "30"));
      const history = await adaptiveSurfaceService.getHistory(limit);
      res.json(history);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get available layers
  app.get("/api/founder/v10/surface/layers", async (_req, res) => {
    try {
      const layers = adaptiveSurfaceService.getAvailableLayers();
      res.json(layers);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Get available modes
  app.get("/api/founder/v10/surface/modes", async (_req, res) => {
    try {
      const modes = adaptiveSurfaceService.getAvailableModes();
      res.json(modes);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
