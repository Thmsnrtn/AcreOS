/**
 * Founder v6 Routes — Sovereign Company Protocol v6
 *
 * API endpoints for the self-running company:
 * - Workflow pipelines
 * - War rooms
 * - Agent initiatives
 * - Performance reviews
 * - Playbooks
 * - CEO absence mode
 */

import { type Express } from "express";
import { workflowEngine } from "./services/agentWorkflowEngine";
import { warRoomService } from "./services/warRoomService";
import { agentInitiativeService } from "./services/agentInitiatives";
import { performanceReviewService } from "./services/agentPerformanceReviews";
import { playbookService } from "./services/agentPlaybooks";
import { ceoAbsenceService } from "./services/ceoAbsenceMode";

export function registerFounderV6Routes(app: Express) {

  // ─── Workflows ───────────────────────────────────────────────────────────

  app.get("/api/founder/v6/workflows", async (_req, res) => {
    try {
      const workflows = await workflowEngine.getAll();
      res.json(workflows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/founder/v6/workflow-runs", async (_req, res) => {
    try {
      const runs = await workflowEngine.getRecentRuns(20);
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/workflows/:id/trigger", async (req, res) => {
    try {
      const runId = await workflowEngine.triggerManual(parseInt(req.params.id), req.body);
      res.json({ runId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── War Rooms ───────────────────────────────────────────────────────────

  app.get("/api/founder/v6/war-rooms", async (_req, res) => {
    try {
      const rooms = await warRoomService.getRecentRooms(10);
      res.json(rooms);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/founder/v6/war-rooms/:id/messages", async (req, res) => {
    try {
      const messages = await warRoomService.getMessages(parseInt(req.params.id));
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/war-rooms/:id/directive", async (req, res) => {
    try {
      await warRoomService.ceoDirective(parseInt(req.params.id), req.body.directive);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/war-rooms/:id/resolve", async (req, res) => {
    try {
      await warRoomService.resolve(parseInt(req.params.id), req.body.resolution, "ceo");
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/war-rooms/convene", async (req, res) => {
    try {
      const roomId = await warRoomService.convene(req.body.event, req.body.data || {});
      res.json({ roomId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Initiatives ─────────────────────────────────────────────────────────

  app.get("/api/founder/v6/initiatives", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const initiatives = status === "all"
        ? await agentInitiativeService.getAll()
        : await agentInitiativeService.getAll(status || "proposed");
      res.json(initiatives);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/initiatives/:id/approve", async (req, res) => {
    try {
      await agentInitiativeService.approve(parseInt(req.params.id), req.body.ceoNotes);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/initiatives/:id/reject", async (req, res) => {
    try {
      await agentInitiativeService.reject(parseInt(req.params.id), req.body.ceoNotes);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/initiatives/:id/shelve", async (req, res) => {
    try {
      await agentInitiativeService.shelve(parseInt(req.params.id), req.body.ceoNotes);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/initiatives/generate", async (_req, res) => {
    try {
      const ids = await agentInitiativeService.generateAllInitiatives();
      res.json({ generated: ids.length, ids });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Performance Reviews ─────────────────────────────────────────────────

  app.get("/api/founder/v6/performance-reviews", async (_req, res) => {
    try {
      const reviews = await performanceReviewService.getRecentReviews();
      res.json(reviews);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/performance-reviews/generate", async (_req, res) => {
    try {
      const ids = await performanceReviewService.generateAllReviews();
      res.json({ generated: ids.length, ids });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/performance-reviews/:id/comment", async (req, res) => {
    try {
      await performanceReviewService.addCEOComments(parseInt(req.params.id), req.body.comments);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Playbooks ───────────────────────────────────────────────────────────

  app.get("/api/founder/v6/playbooks", async (_req, res) => {
    try {
      const playbooks = await playbookService.getAll();
      res.json(playbooks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/playbooks/:id/approve", async (req, res) => {
    try {
      await playbookService.approve(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/playbooks/:id/toggle", async (req, res) => {
    try {
      const playbook = await playbookService.getById(parseInt(req.params.id));
      if (!playbook) return res.status(404).json({ error: "Not found" });
      if (playbook.isActive) {
        await playbookService.deactivate(playbook.id);
      } else {
        await playbookService.activate(playbook.id);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/playbooks/:id/execute", async (req, res) => {
    try {
      const result = await playbookService.execute(parseInt(req.params.id), req.body);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── CEO Absence Mode ───────────────────────────────────────────────────

  app.get("/api/founder/v6/absence-mode", async (_req, res) => {
    try {
      const latest = await ceoAbsenceService.getLatest();
      res.json(latest || { isActive: false });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/absence-mode/activate", async (req, res) => {
    try {
      const id = await ceoAbsenceService.activate({
        durationHours: req.body.durationHours || 72,
        trustBoost: req.body.trustBoost,
      });
      res.json({ id, success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/founder/v6/absence-mode/deactivate", async (_req, res) => {
    try {
      const briefing = await ceoAbsenceService.deactivate();
      res.json({ success: true, returnBriefing: briefing });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Seed on startup ────────────────────────────────────────────────────

  // Seed workflows and playbooks (safe to call repeatedly)
  setTimeout(async () => {
    try {
      await workflowEngine.seedWorkflows();
      await playbookService.seedPlaybooks();
      console.log("[v6] Seeded workflows and playbooks");
    } catch (err) {
      console.error("[v6] Seed error:", err);
    }
  }, 5000);
}
