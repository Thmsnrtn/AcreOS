/**
 * Founder v13 Routes — Sovereign Company Protocol v13: The Sentient Enterprise
 *
 * Six cognitive pillars:
 * 1. Cognitive Memory Layer — episodic, semantic, and working memory
 * 2. Adaptive Strategy Engine — Thompson sampling and strategy evolution
 * 3. Agent Collaboration Protocol — dialogues, delegation, reputation
 * 4. Self-Healing Mesh — anomaly detection, degradation modes, chaos engineering
 * 5. Governance & Compliance Brain — policy engine, audit explanations, sandbox
 * 6. Founder Intelligence Layer — briefings, simulations, strategic recommendations
 */

import { type Express } from "express";
import { Errors } from "./utils/errors";
import { cognitiveMemoryService } from "./services/cognitiveMemoryV13";
import { adaptiveStrategyService } from "./services/adaptiveStrategyV13";
import { collaborationProtocolService } from "./services/collaborationProtocolV13";
import { selfHealingMeshService } from "./services/selfHealingMeshV13";
import { governanceBrainService } from "./services/governanceBrainV13";
import { founderIntelligenceService } from "./services/founderIntelligenceV13";

export function registerFounderV13Routes(app: Express) {

  // ─── 1. Cognitive Memory Layer ───────────────────────────────────────

  app.post("/api/founder/v13/memory/episodes", async (req, res) => {
    try { res.json(await cognitiveMemoryService.recordEpisode(req.body.agentCodename, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/memory/episodes/:codename", async (req, res) => {
    try { res.json(await cognitiveMemoryService.recallEpisodes(req.params.codename, req.query)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/memory/facts", async (req, res) => {
    try { res.json(await cognitiveMemoryService.extractFact(req.body.agentCodename, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/memory/facts/:codename", async (req, res) => {
    try { res.json(await cognitiveMemoryService.queryFacts(req.params.codename, req.query)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/memory/facts/:factId/share", async (req, res) => {
    try { res.json(await cognitiveMemoryService.shareFact(req.params.factId, req.body.withAgents)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/memory/working", async (req, res) => {
    try { res.json(await cognitiveMemoryService.setWorkingMemory(req.body.agentCodename, req.body.key, req.body.value, req.body.ttlSeconds, req.body.sagaId, req.body.orgId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/memory/working/:codename/:key", async (req, res) => {
    try { res.json(await cognitiveMemoryService.getWorkingMemory(req.params.codename, req.params.key, req.query.sagaId as string)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/memory/consolidate/:codename", async (req, res) => {
    try { res.json(await cognitiveMemoryService.consolidateMemories(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/memory/cleanup", async (_req, res) => {
    try { res.json({ deleted: await cognitiveMemoryService.clearExpiredWorkingMemory() }); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/memory/stats", async (req, res) => {
    try { res.json(await cognitiveMemoryService.getMemoryStats(req.query.agent as string)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 2. Adaptive Strategy Engine ────────────────────────────────────

  app.post("/api/founder/v13/strategies", async (req, res) => {
    try { res.json(await adaptiveStrategyService.createStrategy(req.body.agentCodename, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/strategies/select", async (req, res) => {
    try { res.json(await adaptiveStrategyService.selectStrategy(req.body.agentCodename, req.body.context, req.body.orgId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/strategies/assign", async (req, res) => {
    try { res.json(await adaptiveStrategyService.assignStrategy(req.body.strategyId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/strategies/assignments/:id/outcome", async (req, res) => {
    try { res.json(await adaptiveStrategyService.recordOutcome(parseInt(req.params.id), req.body.outcome, req.body.outcomeValue)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/strategies/proposals", async (req, res) => {
    try { res.json(await adaptiveStrategyService.proposeStrategy(req.body.agentCodename, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/strategies/proposals/:proposalId/review", async (req, res) => {
    try { res.json(await adaptiveStrategyService.reviewProposal(req.params.proposalId, req.body.decision, req.body.reviewedBy, req.body.reviewNotes)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/strategies/:codename/performance", async (req, res) => {
    try { res.json(await adaptiveStrategyService.getStrategyPerformance(req.params.codename, req.query.orgId ? parseInt(String(req.query.orgId)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/strategies/:strategyId/lineage", async (req, res) => {
    try { res.json(await adaptiveStrategyService.getStrategyLineage(req.params.strategyId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/strategies/:strategyId/deactivate", async (req, res) => {
    try { await adaptiveStrategyService.deactivateStrategy(req.params.strategyId); res.json({ success: true }); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/strategies/stats", async (req, res) => {
    try { res.json(await adaptiveStrategyService.getStats(req.query.orgId ? parseInt(String(req.query.orgId)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 3. Agent Collaboration Protocol ────────────────────────────────

  app.post("/api/founder/v13/dialogues", async (req, res) => {
    try { res.json(await collaborationProtocolService.openDialogue(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/dialogues/:dialogueId/messages", async (req, res) => {
    try { res.json(await collaborationProtocolService.addMessage(req.params.dialogueId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/dialogues/:dialogueId/consensus", async (req, res) => {
    try { res.json(await collaborationProtocolService.checkConsensus(req.params.dialogueId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/dialogues/:dialogueId/resolve", async (req, res) => {
    try { res.json(await collaborationProtocolService.resolveDialogue(req.params.dialogueId, req.body.resolution)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/dialogues", async (req, res) => {
    try { res.json(await collaborationProtocolService.getActiveDialogues(req.query.orgId ? parseInt(String(req.query.orgId)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/delegations", async (req, res) => {
    try { res.json(await collaborationProtocolService.delegate(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.put("/api/founder/v13/delegations/:delegationId", async (req, res) => {
    try { res.json(await collaborationProtocolService.updateDelegation(req.params.delegationId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/reputation/vote", async (req, res) => {
    try { res.json(await collaborationProtocolService.rateAgent(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/reputation/:codename", async (req, res) => {
    try { res.json(await collaborationProtocolService.getAgentReputation(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/skills", async (req, res) => {
    try { res.json(await collaborationProtocolService.registerSkill(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/skills/:skillName/agents", async (req, res) => {
    try { res.json(await collaborationProtocolService.findAgentForSkill(req.params.skillName, req.query.minProficiency ? parseInt(String(req.query.minProficiency)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/collaboration/stats", async (req, res) => {
    try { res.json(await collaborationProtocolService.getStats(req.query.orgId ? parseInt(String(req.query.orgId)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 4. Self-Healing Mesh ───────────────────────────────────────────

  app.post("/api/founder/v13/health/metrics", async (req, res) => {
    try { res.json(await selfHealingMeshService.recordMetric(req.body.agentCodename, req.body.metric, req.body.value)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/health/anomalies", async (req, res) => {
    try { res.json(await selfHealingMeshService.detectAnomalies(req.query.agent as string)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/anomalies/:anomalyId/rca", async (req, res) => {
    try { res.json(await selfHealingMeshService.performRootCauseAnalysis(req.params.anomalyId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/anomalies/:anomalyId/resolve", async (req, res) => {
    try { res.json(await selfHealingMeshService.resolveAnomaly(req.params.anomalyId, req.body.autoResolved)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/degradation-modes", async (req, res) => {
    try { res.json(await selfHealingMeshService.registerDegradationMode(req.body.agentCodename, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/:codename/degrade/:modeName", async (req, res) => {
    try { res.json(await selfHealingMeshService.activateDegradationMode(req.params.codename, req.params.modeName)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/:codename/restore", async (req, res) => {
    try { await selfHealingMeshService.deactivateDegradationMode(req.params.codename); res.json({ success: true }); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/health/:codename/mode", async (req, res) => {
    try { res.json(await selfHealingMeshService.getCurrentMode(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/playbooks", async (req, res) => {
    try { res.json(await selfHealingMeshService.createPlaybook(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/playbooks/evaluate/:anomalyId", async (req, res) => {
    try { res.json(await selfHealingMeshService.evaluatePlaybooks(req.params.anomalyId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/chaos", async (req, res) => {
    try { res.json(await selfHealingMeshService.startChaosExperiment(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/health/chaos/:experimentId/complete", async (req, res) => {
    try { res.json(await selfHealingMeshService.completeChaosExperiment(req.params.experimentId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/health/dashboard", async (_req, res) => {
    try { res.json(await selfHealingMeshService.getHealthDashboard()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/health/stats", async (_req, res) => {
    try { res.json(await selfHealingMeshService.getStats()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 5. Governance & Compliance Brain ───────────────────────────────

  app.post("/api/founder/v13/governance/policies", async (req, res) => {
    try { res.json(await governanceBrainService.createPolicy(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/governance/policies", async (req, res) => {
    try { res.json(await governanceBrainService.getPolicies(req.query.category as string, req.query.jurisdiction as string, req.query.activeOnly !== "false")); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.put("/api/founder/v13/governance/policies/:policyId", async (req, res) => {
    try { res.json(await governanceBrainService.updatePolicy(req.params.policyId, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/governance/evaluate", async (req, res) => {
    try { res.json(await governanceBrainService.evaluateAction(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/governance/explain", async (req, res) => {
    try { res.json(await governanceBrainService.explainAction(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/governance/explanations/:actionId", async (req, res) => {
    try { res.json(await governanceBrainService.getExplanation(req.params.actionId)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/governance/compliance/:orgId/snapshot", async (req, res) => {
    try { res.json(await governanceBrainService.generateComplianceSnapshot(parseInt(req.params.orgId), req.body.period)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/governance/compliance/:orgId", async (req, res) => {
    try { res.json(await governanceBrainService.getComplianceHistory(parseInt(req.params.orgId), req.query.limit ? parseInt(String(req.query.limit)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/governance/violations/:orgId/trends", async (req, res) => {
    try { res.json(await governanceBrainService.getViolationTrends(parseInt(req.params.orgId), req.query.periods ? parseInt(String(req.query.periods)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/governance/sandbox", async (req, res) => {
    try { res.json(await governanceBrainService.runSandbox(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/governance/stats", async (req, res) => {
    try { res.json(await governanceBrainService.getStats(req.query.orgId ? parseInt(String(req.query.orgId)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 6. Founder Intelligence Layer ──────────────────────────────────

  app.post("/api/founder/v13/intelligence/briefings/:orgId/generate", async (req, res) => {
    try { res.json(await founderIntelligenceService.generateBriefing(parseInt(req.params.orgId), req.body.date)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/intelligence/briefings/:orgId", async (req, res) => {
    try { res.json(await founderIntelligenceService.getBriefing(parseInt(req.params.orgId), req.query.date as string)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/intelligence/briefings/:orgId/history", async (req, res) => {
    try { res.json(await founderIntelligenceService.getBriefingHistory(parseInt(req.params.orgId), req.query.limit ? parseInt(String(req.query.limit)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/intelligence/simulations/:orgId", async (req, res) => {
    try { res.json(await founderIntelligenceService.runSimulation(parseInt(req.params.orgId), req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/intelligence/simulations/:orgId/history", async (req, res) => {
    try { res.json(await founderIntelligenceService.getSimulationHistory(parseInt(req.params.orgId), req.query.limit ? parseInt(String(req.query.limit)) : undefined)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/intelligence/recommendations/:orgId", async (req, res) => {
    try { res.json(await founderIntelligenceService.createRecommendation(parseInt(req.params.orgId), req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.put("/api/founder/v13/intelligence/recommendations/:id/acknowledge", async (req, res) => {
    try { res.json(await founderIntelligenceService.acknowledgeRecommendation(parseInt(req.params.id), req.body.status)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/intelligence/recommendations/:orgId", async (req, res) => {
    try { res.json(await founderIntelligenceService.getRecommendations(parseInt(req.params.orgId), req.query.status as string, req.query.category as string)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v13/intelligence/interactions/:orgId", async (req, res) => {
    try { res.json(await founderIntelligenceService.trackInteraction(parseInt(req.params.orgId), req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/intelligence/engagement/:orgId", async (req, res) => {
    try { res.json(await founderIntelligenceService.getEngagementReport(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v13/intelligence/stats/:orgId", async (req, res) => {
    try { res.json(await founderIntelligenceService.getStats(parseInt(req.params.orgId))); }
    catch (err: any) { Errors.internal(res, err); }
  });
}
