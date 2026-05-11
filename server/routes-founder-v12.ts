/**
 * Founder v12 Routes — Sovereign Company Protocol v12: The Real Runtime
 *
 * Eight foundation systems:
 * 1. Agent Lifecycle Runtime — stateful agent processes
 * 2. Event Mesh — real pub/sub replacing polling
 * 3. Outcome Verification Pipeline — verify real-world outcomes
 * 4. Saga Orchestrator — distributed transactions with compensation
 * 5. Agent Version Control — deploy agent changes like code
 * 6. Trust Enforcement Layer — trust that actually prevents
 * 7. Integration Execution Framework — secure external API access
 * 8. Tenant Context Fabric — true multi-tenant isolation
 */

import { type Express } from "express";
import { agentLifecycleRuntimeService } from "./services/agentLifecycleRuntimeV12";
import { eventMeshService } from "./services/eventMeshV12";
import { outcomeVerificationService } from "./services/outcomeVerificationV12";
import { sagaOrchestratorService } from "./services/sagaOrchestratorV12";
import { agentVersionControlService } from "./services/agentVersionControlV12";
import { trustEnforcementService } from "./services/trustEnforcementV12";
import { integrationFrameworkService } from "./services/integrationFrameworkV12";
import { tenantFabricService } from "./services/tenantFabricV12";

export function registerFounderV12Routes(app: Express) {

  // ─── 1. Agent Lifecycle Runtime ────────────────────────────────────────

  app.post("/api/founder/v12/runtime/initialize", async (_req, res) => {
    try { res.json(await agentLifecycleRuntimeService.initializeAll()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/runtime", async (_req, res) => {
    try { res.json(await agentLifecycleRuntimeService.getAllStates()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/runtime/:codename", async (req, res) => {
    try { res.json(await agentLifecycleRuntimeService.getState(req.params.codename)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/runtime/:codename/transition", async (req, res) => {
    try {
      const state = await agentLifecycleRuntimeService.transitionState(req.params.codename, req.body.newState, req.body.context);
      res.json(state);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/runtime/:codename/heartbeat", async (req, res) => {
    try { await agentLifecycleRuntimeService.heartbeat(req.params.codename); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/runtime/health-check", async (_req, res) => {
    try { res.json(await agentLifecycleRuntimeService.checkHealth()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/runtime/:codename/restart", async (req, res) => {
    try { await agentLifecycleRuntimeService.restart(req.params.codename); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/runtime/dashboard", async (_req, res) => {
    try { res.json(await agentLifecycleRuntimeService.getRuntimeDashboard()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 2. Event Mesh ────────────────────────────────────────────────────

  app.post("/api/founder/v12/events/publish", async (req, res) => {
    try {
      const event = await eventMeshService.publish(req.body.channel, req.body.eventType, req.body.payload, req.body.options);
      res.json(event);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/events/subscribe", async (req, res) => {
    try {
      const sub = await eventMeshService.subscribe(req.body.subscriber, req.body.channelPattern, req.body.options);
      res.json(sub);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/events/:eventId/ack", async (req, res) => {
    try { await eventMeshService.acknowledge(req.params.eventId, req.body.subscriber); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/events/unprocessed/:subscriber", async (req, res) => {
    try { res.json(await eventMeshService.getUnprocessedEvents(req.params.subscriber)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/events/dead-letter", async (_req, res) => {
    try { res.json(await eventMeshService.getDeadLetterEvents()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/events/channel/:channel", async (req, res) => {
    try { res.json(await eventMeshService.getEventsByChannel(req.params.channel)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/events/subscriptions", async (req, res) => {
    try { res.json(await eventMeshService.getSubscriptions(req.query.subscriber as string)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/events/stats", async (_req, res) => {
    try { res.json(await eventMeshService.getStats()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 3. Outcome Verification Pipeline ─────────────────────────────────

  app.post("/api/founder/v12/verification/contracts", async (req, res) => {
    try { res.json(await outcomeVerificationService.createContract(req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/verification/process", async (_req, res) => {
    try { res.json(await outcomeVerificationService.processVerifications()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/verification/:id/verify", async (req, res) => {
    try { res.json(await outcomeVerificationService.verify(parseInt(req.params.id))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/verification/discrepancies", async (_req, res) => {
    try { res.json(await outcomeVerificationService.getDiscrepancies()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/verification/stats", async (_req, res) => {
    try { res.json(await outcomeVerificationService.getAllVerificationStats()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/verification/agent/:codename", async (req, res) => {
    try { res.json(await outcomeVerificationService.getAgentVerificationStats(req.params.codename)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/verification/pending", async (_req, res) => {
    try { res.json(await outcomeVerificationService.getPendingVerifications()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/verification", async (req, res) => {
    try { res.json(await outcomeVerificationService.getRecent(parseInt(String(req.query.limit || "30")))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 4. Saga Orchestrator ─────────────────────────────────────────────

  app.post("/api/founder/v12/sagas", async (req, res) => {
    try { res.json(await sagaOrchestratorService.createSaga(req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/sagas/:sagaId/execute", async (req, res) => {
    try { res.json(await sagaOrchestratorService.executeSaga(req.params.sagaId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/sagas/:sagaId/compensate", async (req, res) => {
    try { res.json(await sagaOrchestratorService.compensate(req.params.sagaId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/sagas/timeout", async (_req, res) => {
    try { res.json(await sagaOrchestratorService.timeout()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/sagas/:sagaId", async (req, res) => {
    try { res.json(await sagaOrchestratorService.getById(req.params.sagaId)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/sagas", async (req, res) => {
    try { res.json(await sagaOrchestratorService.getRecent()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/sagas/stats", async (_req, res) => {
    try { res.json(await sagaOrchestratorService.getStats()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 5. Agent Version Control ─────────────────────────────────────────

  app.post("/api/founder/v12/versions", async (req, res) => {
    try { res.json(await agentVersionControlService.createVersion(req.body.agentCodename, req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/versions/:id/deploy", async (req, res) => {
    try { res.json(await agentVersionControlService.deploy(parseInt(req.params.id), req.body.canaryWeight)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/versions/:codename/rollback", async (req, res) => {
    try { res.json(await agentVersionControlService.rollback(req.params.codename)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/versions/:id/canary", async (req, res) => {
    try { res.json(await agentVersionControlService.updateCanaryWeight(parseInt(req.params.id), req.body.weight)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/versions/:codename", async (req, res) => {
    try { res.json(await agentVersionControlService.getVersionHistory(req.params.codename)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/versions/:codename/active", async (req, res) => {
    try { res.json(await agentVersionControlService.getActiveVersion(req.params.codename)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/versions/canary/status", async (_req, res) => {
    try { res.json(await agentVersionControlService.getCanaryStatus()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 6. Trust Enforcement Layer ───────────────────────────────────────

  app.post("/api/founder/v12/trust/enforce", async (req, res) => {
    try {
      const result = await trustEnforcementService.enforce(
        req.body.agentCodename, req.body.actionType, req.body.requiredTrust, req.body.orgId,
      );
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/trust/:id/approve", async (req, res) => {
    try { await trustEnforcementService.approve(parseInt(req.params.id), req.body.approvedBy || "ceo"); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/trust/:id/deny", async (req, res) => {
    try { await trustEnforcementService.deny(parseInt(req.params.id), req.body.reason); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/trust/:id/outcome", async (req, res) => {
    try { await trustEnforcementService.recordOutcome(parseInt(req.params.id), req.body.outcome); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/trust/pending", async (req, res) => {
    try { res.json(await trustEnforcementService.getPendingApprovals(req.query.orgId ? parseInt(String(req.query.orgId)) : undefined)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/trust/history", async (req, res) => {
    try { res.json(await trustEnforcementService.getEnforcementHistory(req.query.agent as string)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/trust/stats", async (_req, res) => {
    try { res.json(await trustEnforcementService.getStats()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 7. Integration Execution Framework ───────────────────────────────

  app.post("/api/founder/v12/integrations/credentials", async (req, res) => {
    try { res.json(await integrationFrameworkService.registerCredential(req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/integrations/execute", async (req, res) => {
    try {
      const result = await integrationFrameworkService.execute(
        req.body.agentCodename, req.body.serviceName, req.body.method, req.body.endpoint, req.body.params,
      );
      res.json(result);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/integrations/:id/rollback", async (req, res) => {
    try { res.json(await integrationFrameworkService.rollbackExecution(parseInt(req.params.id))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/integrations/credentials", async (req, res) => {
    try { res.json(await integrationFrameworkService.getCredentials(req.query.service as string)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/integrations/circuit-breakers", async (_req, res) => {
    try { res.json(await integrationFrameworkService.getCircuitBreakerStatus()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/integrations/:service/reset-circuit", async (req, res) => {
    try { await integrationFrameworkService.resetCircuitBreaker(req.params.service); res.json({ success: true }); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/integrations/costs", async (req, res) => {
    try { res.json(await integrationFrameworkService.getCostReport(parseInt(String(req.query.days || "30")))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/integrations/stats", async (_req, res) => {
    try { res.json(await integrationFrameworkService.getStats()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─── 8. Tenant Context Fabric ─────────────────────────────────────────
  // NOTE: specific paths must come BEFORE parameterized /:orgId routes
  // or Express will match /stats against :orgId.

  app.get("/api/founder/v12/tenants/stats", async (_req, res) => {
    try { res.json(await tenantFabricService.getStats()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/tenants", async (_req, res) => {
    try { res.json(await tenantFabricService.getAllTenants()); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/tenants/:orgId/initialize", async (req, res) => {
    try { res.json(await tenantFabricService.initializeTenant(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/tenants/:orgId", async (req, res) => {
    try { res.json(await tenantFabricService.getTenantOverview(parseInt(req.params.orgId))); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.get("/api/founder/v12/tenants/:orgId/agent/:codename", async (req, res) => {
    try { res.json(await tenantFabricService.getTenantConfig(parseInt(req.params.orgId), req.params.codename)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/founder/v12/tenants/:orgId/agent/:codename", async (req, res) => {
    try { res.json(await tenantFabricService.updateTenantConfig(parseInt(req.params.orgId), req.params.codename, req.body)); }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/founder/v12/tenants/:orgId/agent/:codename/trust", async (req, res) => {
    try {
      const trust = await tenantFabricService.adjustTenantTrust(parseInt(req.params.orgId), req.params.codename, req.body.delta);
      res.json({ trust });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}
