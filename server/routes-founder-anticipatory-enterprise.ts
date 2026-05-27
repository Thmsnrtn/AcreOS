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
import { ceoCognitiveModelService } from "./services/ceoCognitiveModelV11";
import { temporalKnowledgeDecayService } from "./services/temporalKnowledgeDecayV11";
import { agentResourceGovernorService } from "./services/agentResourceGovernorV11";
import { decisionCausalityService } from "./services/decisionCausalityV11";
import { delegationTokenService } from "./services/delegationTokensV11";
import { predictiveOrchestrationService } from "./services/predictiveOrchestrationV11";
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

  // ─── 3. CEO Cognitive Model ────────────────────────────────────────────

  app.post("/api/founder/v11/cognitive/train", async (req, res) => {
    try {
      const model = await ceoCognitiveModelService.train(req.body.decisionCategory, req.body.decisions);
      res.json(model);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/cognitive/predict", async (req, res) => {
    try {
      const prediction = await ceoCognitiveModelService.shadowPredict({
        decisionCategory: req.body.decisionCategory,
        context: req.body.context,
        options: req.body.options,
        agentRecommendations: req.body.agentRecommendations,
      });
      res.json(prediction);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/cognitive/predictions/:id/resolve", async (req, res) => {
    try {
      const result = await ceoCognitiveModelService.resolvePrediction(parseInt(req.params.id), req.body.ceoDecision);
      res.json(result);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/cognitive/:category/autopilot", async (req, res) => {
    try {
      await ceoCognitiveModelService.toggleAutopilot(req.params.category, req.body.enabled);
      res.json({ success: true });
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/cognitive/models", async (_req, res) => {
    try { res.json(await ceoCognitiveModelService.getAllModels()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/cognitive/autopilot-eligible", async (_req, res) => {
    try { res.json(await ceoCognitiveModelService.getAutopilotEligible()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/cognitive/predictions", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      res.json(await ceoCognitiveModelService.getRecentPredictions(category));
    } catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 4. Temporal Knowledge Decay ───────────────────────────────────────

  app.post("/api/founder/v11/knowledge/patterns", async (req, res) => {
    try {
      const entry = await temporalKnowledgeDecayService.registerPattern({
        patternId: req.body.patternId,
        patternName: req.body.patternName,
        sourceAgent: req.body.sourceAgent,
        halfLifeDays: req.body.halfLifeDays,
        seasonalTags: req.body.seasonalTags,
        lineageParentId: req.body.lineageParentId,
      });
      res.json(entry);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/knowledge/decay-cycle", async (_req, res) => {
    try { res.json(await temporalKnowledgeDecayService.runDecayCycle()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/knowledge/patterns/:id/revalidate", async (req, res) => {
    try {
      await temporalKnowledgeDecayService.revalidate(req.params.id);
      res.json({ success: true });
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/knowledge/zombies", async (_req, res) => {
    try { res.json(await temporalKnowledgeDecayService.getZombiePatterns()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/knowledge/stale", async (_req, res) => {
    try { res.json(await temporalKnowledgeDecayService.getStalePatterns()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/knowledge/lineage/:patternId", async (req, res) => {
    try { res.json(await temporalKnowledgeDecayService.getLineage(req.params.patternId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/knowledge", async (req, res) => {
    try { res.json(await temporalKnowledgeDecayService.getAll()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/knowledge/stats", async (_req, res) => {
    try { res.json(await temporalKnowledgeDecayService.getStats()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 5. Agent Resource Governor ────────────────────────────────────────

  app.post("/api/founder/v11/governor/initialize", async (_req, res) => {
    try { res.json(await agentResourceGovernorService.initializeQuotas()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/governor/check/:codename", async (req, res) => {
    try { res.json(await agentResourceGovernorService.checkQuota(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/governor/reset/daily", async (_req, res) => {
    try { await agentResourceGovernorService.dailyReset(); res.json({ success: true }); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/governor/reset/hourly", async (_req, res) => {
    try { await agentResourceGovernorService.hourlyReset(); res.json({ success: true }); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.put("/api/founder/v11/governor/:codename/limits", async (req, res) => {
    try {
      const quota = await agentResourceGovernorService.updateLimits(req.params.codename, req.body);
      res.json(quota);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/governor", async (_req, res) => {
    try { res.json(await agentResourceGovernorService.getAllQuotas()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/governor/:codename", async (req, res) => {
    try { res.json(await agentResourceGovernorService.getQuota(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/governor/events", async (req, res) => {
    try {
      const agent = req.query.agent as string | undefined;
      res.json(await agentResourceGovernorService.getRecentEvents(agent));
    } catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 6. Decision Causality Graph ───────────────────────────────────────

  app.post("/api/founder/v11/causality/decisions", async (req, res) => {
    try {
      const node = await decisionCausalityService.recordDecision({
        agentCodename: req.body.agentCodename,
        decisionType: req.body.decisionType,
        decisionSummary: req.body.decisionSummary,
        parentDecisionIds: req.body.parentDecisionIds,
        rollbackEligible: req.body.rollbackEligible,
      });
      res.json(node);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/causality/blast-radius/:decisionId", async (req, res) => {
    try { res.json(await decisionCausalityService.getBlastRadius(req.params.decisionId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/causality/trace/:decisionId", async (req, res) => {
    try { res.json(await decisionCausalityService.traceToRoot(req.params.decisionId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/causality/:decisionId/rollback", async (req, res) => {
    try {
      const result = await decisionCausalityService.rollback(
        req.params.decisionId, req.body.reason, req.body.cascading,
      );
      res.json(result);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/causality/deepest", async (_req, res) => {
    try { res.json(await decisionCausalityService.getDeepestChains()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/causality/cascading", async (_req, res) => {
    try { res.json(await decisionCausalityService.getMostCascading()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/causality", async (req, res) => {
    try { res.json(await decisionCausalityService.getRecent()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 7. Delegation Tokens ─────────────────────────────────────────────

  app.post("/api/founder/v11/delegations", async (req, res) => {
    try {
      const token = await delegationTokenService.grant({
        agentCodename: req.body.agentCodename,
        scope: req.body.scope,
        authorityLevel: req.body.authorityLevel,
        spendingLimitCents: req.body.spendingLimitCents,
        conditions: req.body.conditions,
        reason: req.body.reason,
        expiresAt: new Date(req.body.expiresAt),
        isStanding: req.body.isStanding,
        autoRenewDays: req.body.autoRenewDays,
      });
      res.json(token);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/delegations/check/:codename/:scope", async (req, res) => {
    try {
      const amount = req.query.amount ? parseInt(String(req.query.amount)) : undefined;
      res.json(await delegationTokenService.checkDelegation(req.params.codename, req.params.scope, amount));
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/delegations/:id/revoke", async (req, res) => {
    try {
      await delegationTokenService.revoke(parseInt(req.params.id), req.body.reason);
      res.json({ success: true });
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/delegations/process-expirations", async (_req, res) => {
    try { res.json({ processed: await delegationTokenService.processExpirations() }); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/delegations/active", async (_req, res) => {
    try { res.json(await delegationTokenService.getAllActive()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/delegations/agent/:codename", async (req, res) => {
    try { res.json(await delegationTokenService.getActiveForAgent(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/delegations", async (req, res) => {
    try { res.json(await delegationTokenService.getRecent()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 8. Predictive Orchestration ───────────────────────────────────────

  app.post("/api/founder/v11/predictions/patterns", async (req, res) => {
    try {
      const pattern = await predictiveOrchestrationService.registerPattern({
        causeSignal: req.body.causeSignal,
        causeAgent: req.body.causeAgent,
        effectSignal: req.body.effectSignal,
        effectAgent: req.body.effectAgent,
        avgDelayHours: req.body.avgDelayHours,
        correlationStrength: req.body.correlationStrength,
        autoStageEnabled: req.body.autoStageEnabled,
      });
      res.json(pattern);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/predictions/signal-cause", async (req, res) => {
    try {
      const staged = await predictiveOrchestrationService.signalCause(req.body.causeSignal, req.body.causeAgent);
      res.json({ stagedActions: staged });
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/predictions/signal-effect", async (req, res) => {
    try {
      const triggered = await predictiveOrchestrationService.signalEffect(req.body.effectSignal);
      res.json({ triggered });
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/predictions/:id/execute", async (req, res) => {
    try {
      await predictiveOrchestrationService.markExecuted(parseInt(req.params.id), req.body.result);
      res.json({ success: true });
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v11/predictions/:id/cancel", async (req, res) => {
    try {
      await predictiveOrchestrationService.cancel(parseInt(req.params.id), req.body.reason);
      res.json({ success: true });
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/predictions/staged", async (_req, res) => {
    try { res.json(await predictiveOrchestrationService.getStagedActions()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/predictions/patterns", async (_req, res) => {
    try { res.json(await predictiveOrchestrationService.getPatterns()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/predictions", async (req, res) => {
    try { res.json(await predictiveOrchestrationService.getRecent()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v11/predictions/stats", async (_req, res) => {
    try { res.json(await predictiveOrchestrationService.getStats()); }
    catch (err: any) { Errors.internal(res, err); }
  });
}
