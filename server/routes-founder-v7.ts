// @ts-nocheck
/**
 * Founder v7 Routes — Sovereign Company Protocol v7: The Learning Company
 *
 * API endpoints for:
 * - Decision Autopilot (learn founder's judgment)
 * - Scenario Engine ("what if?" simulations)
 * - Agent Self-Improvement (growth plans + skill requests)
 * - Founder Digital Twin (draft comms in your voice)
 * - Attention Optimizer (focus card + time tracking)
 * - Institutional Memory (compound pattern library)
 */

import { type Express } from "express";
import { decisionAutopilotService } from "./services/decisionAutopilot";
import { scenarioEngineService } from "./services/scenarioEngine";
import { agentSelfImprovementService } from "./services/agentSelfImprovement";
import { founderTwinService } from "./services/founderTwin";
import { attentionOptimizerService } from "./services/attentionOptimizer";
import { institutionalMemoryService } from "./services/institutionalMemory";

export function registerFounderV7Routes(app: Express) {

  // ─── Decision Autopilot ──────────────────────────────────────────────────

  app.get("/api/founder/v7/autopilot/patterns", async (_req, res) => {
    try {
      const patterns = await decisionAutopilotService.getPatterns();
      res.json(patterns);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/founder/v7/autopilot/stats", async (_req, res) => {
    try {
      const stats = await decisionAutopilotService.getAccuracyStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/founder/v7/autopilot/suggestions", async (_req, res) => {
    try {
      const suggestions = await decisionAutopilotService.getSuggestions();
      res.json(suggestions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/autopilot/:id/toggle", async (req, res) => {
    try {
      const pattern = (await decisionAutopilotService.getPatterns()).find(p => p.id === parseInt(req.params.id));
      if (!pattern) return res.status(404).json({ error: "Pattern not found" });

      if (pattern.isAutopilotActive) {
        await decisionAutopilotService.disableAutopilot(pattern.id);
      } else {
        await decisionAutopilotService.enableAutopilot(pattern.id, req.body.conditionRules);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Scenario Engine ─────────────────────────────────────────────────────

  app.get("/api/founder/v7/scenarios", async (_req, res) => {
    try {
      const scenarios = await scenarioEngineService.getRecent(10);
      res.json(scenarios);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/founder/v7/scenarios/:id", async (req, res) => {
    try {
      const scenario = await scenarioEngineService.getById(parseInt(req.params.id));
      res.json(scenario || null);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/scenarios/simulate", async (req, res) => {
    try {
      const id = await scenarioEngineService.simulate(req.body.hypothesis, req.body.scenarioType);
      res.json({ id, status: "running" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Agent Self-Improvement ───────────────────────────────────────────────

  app.get("/api/founder/v7/improvement", async (_req, res) => {
    try {
      const plans = await agentSelfImprovementService.getActivePlans();
      res.json(plans);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/improvement/generate", async (_req, res) => {
    try {
      const ids = await agentSelfImprovementService.generateAllPlans();
      res.json({ generated: ids.length, ids });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/improvement/:id/skill/:idx/approve", async (req, res) => {
    try {
      await agentSelfImprovementService.approveSkillRequest(
        parseInt(req.params.id),
        parseInt(req.params.idx),
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/improvement/:id/skill/:idx/deny", async (req, res) => {
    try {
      await agentSelfImprovementService.denySkillRequest(
        parseInt(req.params.id),
        parseInt(req.params.idx),
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Founder Digital Twin ─────────────────────────────────────────────────

  app.get("/api/founder/v7/twin/drafts", async (_req, res) => {
    try {
      const drafts = await founderTwinService.getRecentDrafts(10);
      res.json(drafts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/twin/generate", async (req, res) => {
    try {
      const id = await founderTwinService.generateDraft({
        draftType: req.body.draftType || "investor_update",
        topic: req.body.topic,
        context: req.body.context,
      });
      res.json({ id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/twin/drafts/:id/edit", async (req, res) => {
    try {
      await founderTwinService.saveDraftEdits(parseInt(req.params.id), req.body.content);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/twin/drafts/:id/approve", async (req, res) => {
    try {
      await founderTwinService.approveDraft(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/founder/v7/twin/style", async (_req, res) => {
    try {
      const profile = await founderTwinService.getStyleProfile();
      res.json({ profile });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Attention Optimizer ──────────────────────────────────────────────────

  app.get("/api/founder/v7/focus-card", async (_req, res) => {
    try {
      const focusCard = await attentionOptimizerService.getLatestFocusCard();
      res.json({ focusCard });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/focus-card/generate", async (_req, res) => {
    try {
      const focusCard = await attentionOptimizerService.generateFocusCard();
      res.json({ focusCard });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/attention/time", async (req, res) => {
    try {
      await attentionOptimizerService.recordTimeSpent(req.body.area, req.body.durationMinutes);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/founder/v7/attention/recommendations", async (_req, res) => {
    try {
      const recs = await attentionOptimizerService.generateWeeklyRecommendations();
      res.json(recs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Institutional Memory ─────────────────────────────────────────────────

  app.get("/api/founder/v7/institutional/patterns", async (_req, res) => {
    try {
      const patterns = await institutionalMemoryService.getPatterns();
      res.json(patterns);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/founder/v7/institutional/correlations", async (_req, res) => {
    try {
      const correlations = await institutionalMemoryService.getCorrelations();
      res.json(correlations);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v7/institutional/discover", async (_req, res) => {
    try {
      const created = await institutionalMemoryService.discoverPatterns();
      res.json({ discovered: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
