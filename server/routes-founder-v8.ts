// @ts-nocheck
/**
 * Founder v8 Routes — Sovereign Company Protocol v8: The Living Organization
 */

import { type Express } from "express";
import { strategicCompassV8Service } from "./services/strategicCompassV8";
import { agentDebateService } from "./services/agentDebates";
import { founderWellbeingService } from "./services/founderWellbeing";
import { companySeasonService } from "./services/companySeasons";
import { agentSynergyService } from "./services/agentSynergyMap";
import { companyChronicleService } from "./services/companyChronicle";

export function registerFounderV8Routes(app: Express) {

  // ─── Strategic Compass ───────────────────────────────────────────────────

  app.get("/api/founder/v8/compass", async (_req, res) => {
    try {
      let compass = await strategicCompassV8Service.getActive();
      if (!compass) {
        await strategicCompassV8Service.initialize("balanced");
        compass = await strategicCompassV8Service.getActive();
      }
      res.json(compass);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v8/compass/mode", async (req, res) => {
    try {
      await strategicCompassV8Service.switchMode(req.body.mode, req.body.reason);
      // Also switch season
      await companySeasonService.activate(req.body.mode, req.body.reason);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v8/compass/north-star", async (req, res) => {
    try {
      await strategicCompassV8Service.updateNorthStar(req.body.northStar);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v8/compass/suggest", async (_req, res) => {
    try {
      const suggestion = await strategicCompassV8Service.suggestModeChange();
      res.json(suggestion || { shouldSwitch: false });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Agent Debates ───────────────────────────────────────────────────────

  app.get("/api/founder/v8/debates", async (_req, res) => {
    try {
      const debates = await agentDebateService.getRecent(10);
      res.json(debates);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v8/debates/initiate", async (req, res) => {
    try {
      const id = await agentDebateService.initiate(req.body.proposition, req.body.category);
      res.json({ id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v8/debates/:id/decide", async (req, res) => {
    try {
      await agentDebateService.decide(parseInt(req.params.id), req.body.decision, req.body.reasoning);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Founder Wellbeing ───────────────────────────────────────────────────

  app.get("/api/founder/v8/wellbeing", async (_req, res) => {
    try {
      const latest = await founderWellbeingService.getLatest();
      res.json(latest || null);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v8/wellbeing/assess", async (_req, res) => {
    try {
      const id = await founderWellbeingService.assess();
      const latest = await founderWellbeingService.getLatest();
      res.json(latest);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Synergy Map ─────────────────────────────────────────────────────────

  app.get("/api/founder/v8/synergy", async (_req, res) => {
    try {
      const synergies = await agentSynergyService.getAll();
      res.json(synergies);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Company Chronicle ───────────────────────────────────────────────────

  app.get("/api/founder/v8/chronicle", async (_req, res) => {
    try {
      const entries = await companyChronicleService.getRecent(10);
      res.json(entries);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v8/chronicle/search", async (req, res) => {
    try {
      const entries = await companyChronicleService.search(String(req.query.q || ""));
      res.json(entries);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v8/chronicle/generate", async (req, res) => {
    try {
      const id = await companyChronicleService.generateEntry(req.body.periodType || "week");
      res.json({ id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── Seasons ─────────────────────────────────────────────────────────────

  app.get("/api/founder/v8/seasons", async (_req, res) => {
    try {
      const history = await companySeasonService.getHistory(10);
      res.json(history);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
