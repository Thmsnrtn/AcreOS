/**
 * Founder v11 Routes — Sovereign Company Protocol v11: The Anticipatory Enterprise
 *
 * Eight new systems:
 * 1. Agent Negotiation Protocol — conflict resolution without CEO
 * 2. Revenue Attribution Graph — trace every dollar to its agent origin
 * 3. CEO Cognitive Model — digital twin that thinks like the CEO
 * 4. Temporal Knowledge Decay — memory that ages and expires
 * 5. Agent Resource Governor — quotas, circuit breakers, burst limits
 * 6. Decision Causality Graph — full decision chain traceability
 * 7. Delegation Tokens — time-bounded, scope-limited authority grants
 * 8. Predictive Orchestration — anticipate, don't react
 */

import { type Express } from "express";
import { agentNegotiationService } from "./services/agentNegotiationV11";
import { revenueAttributionService } from "./services/revenueAttributionV11";
import { Errors } from "./utils/errors";

export function registerFounderV11Routes(app: Express) {

  // ─── 1. Agent Negotiation Protocol ─────────────────────────────────────

  app.post("/api/founder/v11/negotiations", async (req, res) => {
    try {
      const neg = await agentNegotiationService.initiate({
        initiatorAgent: req.body.initiatorAgent,
        respondentAgent: req.body.respondentAgent,
        conflictType: req.body.conflictType,
        subject: req.body.subject,
        initiatorPosition: req.body.initiatorPosition,
        initiatorEvidence: req.body.initiatorEvidence || [],
      });
      res.json(neg);
    } catch (err: any) { Errors.internal(res, err); }
  });

  // NOTE: specific paths must come BEFORE the parameterized /:id route
  // or Express will match /active, /escalated, /stats against :id.
  app.get("/api/founder/v11/negotiations/active", async (_req, res) => {
    try { res.json(await agentNegotiationService.getActive()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/negotiations/escalated", async (_req, res) => {
    try { res.json(await agentNegotiationService.getEscalated()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/negotiations/stats", async (_req, res) => {
    try { res.json(await agentNegotiationService.getStats()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/negotiations", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || "20"));
      res.json(await agentNegotiationService.getRecent(limit));
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/negotiations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) {
        return Errors.badRequest(res, "Invalid negotiation id");
      }
      const neg = await agentNegotiationService.getById(id);
      res.json(neg || null);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/negotiations/:id/override", async (req, res) => {
    try {
      await agentNegotiationService.ceoOverride(parseInt(req.params.id), req.body.override);
      res.json({ success: true });
    } catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 2. Revenue Attribution Graph ──────────────────────────────────────

  app.post("/api/founder/v11/attribution/actions", async (req, res) => {
    try {
      const node = await revenueAttributionService.recordAction({
        correlationId: req.body.correlationId,
        agentCodename: req.body.agentCodename,
        actionType: req.body.actionType,
        actionDescription: req.body.actionDescription,
        upstreamNodeId: req.body.upstreamNodeId,
        metadata: req.body.metadata,
      });
      res.json(node);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/attribution/revenue", async (req, res) => {
    try {
      const nodes = await revenueAttributionService.attributeRevenue({
        correlationId: req.body.correlationId,
        totalRevenueCents: req.body.totalRevenueCents,
      });
      res.json(nodes);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/attribution/report", async (req, res) => {
    try {
      const report = await revenueAttributionService.generateReport(req.body.period || "weekly");
      res.json(report);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/attribution/chain/:correlationId", async (req, res) => {
    try { res.json(await revenueAttributionService.getChain(req.params.correlationId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/attribution/agent/:codename", async (req, res) => {
    try { res.json(await revenueAttributionService.getAgentNodes(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/attribution/reports", async (req, res) => {
    try { res.json(await revenueAttributionService.getRecentReports()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Sections 3-6 and 8 (CEO Cognitive Model, Temporal Knowledge Decay,
  // Agent Resource Governor, Decision Causality, Predictive Orchestration)
  // were DELETED 2026-08-28 with their services — competing-brains stage 2:
  // zero client fetches, zero service/job importers, zero tests; nothing
  // ever scheduled their cycles, so decay never advanced and predictions
  // never staged unattended. Their tables await the OD-8 drop decision.
  // The incumbent plane owns these capabilities (autopilot/forecast,
  // contextualForecast, cognitionBudget; solene/cognitionThrottle).
  // ─── 7. Delegation Tokens — RETIRED 2026-08-30 (stage-4 turn 14) ───────
  // delegationTokensV11 never granted a token outside a founder curl; its
  // constant deny is now an explicit structural escalate in
  // executionEngine.validateSafetyGates (advance_deal_stage /
  // flag_deal_risk have no autonomous path). temporaryDelegation and
  // witnessGrant are the two surviving delegation rails; delegation_tokens
  // joined the OD-8 conditional-drop list (migration 0245).

}
