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
import { isAuthenticated, requireFounder } from "./auth";
import { Errors } from "./utils/errors";
import { agentLifecycleRuntimeService } from "./services/agentLifecycleRuntimeV12";
import { eventMeshService } from "./services/eventMeshV12";
import { outcomeVerificationService } from "./services/outcomeVerificationV12";
import { agentVersionControlService } from "./services/agentVersionControlV12";
import { integrationFrameworkService } from "./services/integrationFrameworkV12";

export function registerFounderV12Routes(app: Express) {
  // Defense-in-depth (2026-07 security sweep): these routes were protected
  // ONLY by the app.use('/api/founder/v12', …) gate registered earlier in
  // routes.ts — a future reordering would have made every endpoint here
  // fully public. The file now self-gates regardless of mount order.
  app.use("/api/founder/v12", isAuthenticated, requireFounder);


  // ─── 1. Agent Lifecycle Runtime ────────────────────────────────────────

  app.post("/api/founder/v12/runtime/initialize", async (_req, res) => {
    try { res.json(await agentLifecycleRuntimeService.initializeAll()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/runtime", async (_req, res) => {
    try { res.json(await agentLifecycleRuntimeService.getAllStates()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // dashboard — registered BEFORE /api/founder/v12/runtime/:codename so the literal path wins (2026-07-11 route-order sweep).
  app.get("/api/founder/v12/runtime/dashboard", async (_req, res) => {
    try { res.json(await agentLifecycleRuntimeService.getRuntimeDashboard()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/runtime/:codename", async (req, res) => {
    try { res.json(await agentLifecycleRuntimeService.getState(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/runtime/:codename/transition", async (req, res) => {
    try {
      const state = await agentLifecycleRuntimeService.transitionState(req.params.codename, req.body.newState, req.body.context);
      res.json(state);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/runtime/:codename/heartbeat", async (req, res) => {
    try { await agentLifecycleRuntimeService.heartbeat(req.params.codename); res.json({ success: true }); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/runtime/health-check", async (_req, res) => {
    try { res.json(await agentLifecycleRuntimeService.checkHealth()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/runtime/:codename/restart", async (req, res) => {
    try { await agentLifecycleRuntimeService.restart(req.params.codename); res.json({ success: true }); }
    catch (err: any) { Errors.internal(res, err); }
  });


  // ─── 2. Event Mesh ────────────────────────────────────────────────────

  app.post("/api/founder/v12/events/publish", async (req, res) => {
    try {
      const event = await eventMeshService.publish(req.body.channel, req.body.eventType, req.body.payload, req.body.options);
      res.json(event);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/events/subscribe", async (req, res) => {
    try {
      const sub = await eventMeshService.subscribe(req.body.subscriber, req.body.channelPattern, req.body.options);
      res.json(sub);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/events/:eventId/ack", async (req, res) => {
    try { await eventMeshService.acknowledge(req.params.eventId, req.body.subscriber); res.json({ success: true }); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/events/unprocessed/:subscriber", async (req, res) => {
    try { res.json(await eventMeshService.getUnprocessedEvents(req.params.subscriber)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/events/dead-letter", async (_req, res) => {
    try { res.json(await eventMeshService.getDeadLetterEvents()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/events/channel/:channel", async (req, res) => {
    try { res.json(await eventMeshService.getEventsByChannel(req.params.channel)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // Cross-channel recent-events firehose for the founder event-log stream.
  // (Previously the client fetched this path and 404'd, so the stream always
  // showed a false "no events" empty state while the stats header proved the
  // mesh was active.)
  app.get("/api/founder/v12/event-mesh/events", async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || "100", 10);
      res.json(await eventMeshService.getRecentEvents(Number.isFinite(limit) ? limit : 100));
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/events/subscriptions", async (req, res) => {
    try { res.json(await eventMeshService.getSubscriptions(req.query.subscriber as string)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/events/stats", async (_req, res) => {
    try { res.json(await eventMeshService.getStats()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 3. Outcome Verification Pipeline ─────────────────────────────────

  app.post("/api/founder/v12/verification/contracts", async (req, res) => {
    try { res.json(await outcomeVerificationService.createContract(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/verification/process", async (_req, res) => {
    try { res.json(await outcomeVerificationService.processVerifications()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/verification/:id/verify", async (req, res) => {
    try { res.json(await outcomeVerificationService.verify(parseInt(req.params.id))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/verification/discrepancies", async (_req, res) => {
    try { res.json(await outcomeVerificationService.getDiscrepancies()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/verification/stats", async (_req, res) => {
    try { res.json(await outcomeVerificationService.getAllVerificationStats()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/verification/agent/:codename", async (req, res) => {
    try { res.json(await outcomeVerificationService.getAgentVerificationStats(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/verification/pending", async (_req, res) => {
    try { res.json(await outcomeVerificationService.getPendingVerifications()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/verification", async (req, res) => {
    try { res.json(await outcomeVerificationService.getRecent(parseInt(String(req.query.limit || "30")))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 4. (Saga Orchestrator DELETED 2026-08-29, stage-4 turn 16) ───────
  // No job or event source ever created a saga — only these founder HTTP
  // routes — and its platform-sentinel orgId:0 write dies by deletion.
  // saga_instances awaits the OD-8 drop batch.

  // ─── 5. Agent Version Control ─────────────────────────────────────────

  app.post("/api/founder/v12/versions", async (req, res) => {
    try { res.json(await agentVersionControlService.createVersion(req.body.agentCodename, req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/versions/:id/deploy", async (req, res) => {
    try { res.json(await agentVersionControlService.deploy(parseInt(req.params.id), req.body.canaryWeight)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/versions/:codename/rollback", async (req, res) => {
    try { res.json(await agentVersionControlService.rollback(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/versions/:id/canary", async (req, res) => {
    try { res.json(await agentVersionControlService.updateCanaryWeight(parseInt(req.params.id), req.body.weight)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/versions/:codename", async (req, res) => {
    try { res.json(await agentVersionControlService.getVersionHistory(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/versions/:codename/active", async (req, res) => {
    try { res.json(await agentVersionControlService.getActiveVersion(req.params.codename)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/versions/canary/status", async (_req, res) => {
    try { res.json(await agentVersionControlService.getCanaryStatus()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 6. Trust Enforcement Layer — RETIRED 2026-08-30 (stage-4 turn 15) ──
  // Lane 2 deleted with Decision D: ledger-only, one HTTP call site, zero
  // engine callers; trustFloor/trustCeiling were read nowhere live. The
  // Trust-log tab on /founder/governance retired in the same commit;
  // trust_enforcement_log joined the OD-8 conditional-drop list (0246).

  // ─── 7. Integration Execution Framework ───────────────────────────────

  app.post("/api/founder/v12/integrations/credentials", async (req, res) => {
    try { res.json(await integrationFrameworkService.registerCredential(req.body)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/integrations/execute", async (req, res) => {
    try {
      const result = await integrationFrameworkService.execute(
        req.body.agentCodename, req.body.serviceName, req.body.method, req.body.endpoint, req.body.params,
      );
      res.json(result);
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.post("/api/founder/v12/integrations/:id/rollback", async (req, res) => {
    try { res.json(await integrationFrameworkService.rollbackExecution(parseInt(req.params.id))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/integrations/credentials", async (req, res) => {
    try { res.json(await integrationFrameworkService.getCredentials(req.query.service as string)); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/integrations/circuit-breakers", async (_req, res) => {
    try { res.json(await integrationFrameworkService.getCircuitBreakerStatus()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // `orgId` is explicit because a breaker reset is a LANE-EXACT write: omitted,
  // an org-lane breaker had no reset path at all while this cleared the shared
  // platform row instead. `?orgId=` absent means the platform lane, which is
  // where every credential registered today lives.
  app.post("/api/founder/v12/integrations/:service/reset-circuit", async (req, res) => {
    try {
      const raw = req.query.orgId;
      const orgId = raw === undefined || raw === "" ? null : Number(raw);
      if (orgId !== null && !Number.isInteger(orgId)) {
        return Errors.badRequest(res, "orgId must be an integer when provided");
      }
      await integrationFrameworkService.resetCircuitBreaker(req.params.service, orgId);
      res.json({ success: true });
    } catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/integrations/costs", async (req, res) => {
    try { res.json(await integrationFrameworkService.getCostReport(parseInt(String(req.query.days || "30")))); }
    catch (err: any) { Errors.internal(res, err); }
  });

  app.get("/api/founder/v12/integrations/stats", async (_req, res) => {
    try { res.json(await integrationFrameworkService.getStats()); }
    catch (err: any) { Errors.internal(res, err); }
  });

  // ─── 8. Tenant Context Fabric — RETIRED 2026-08-30 (stage-4 turn 15) ──
  // tenantFabricV12 deleted with lane 2 (Decision D): per-tenant agent
  // config that nothing live read; tenant_agent_config joined the OD-8
  // conditional-drop list (0246). The v12 auth gate above survives — it
  // covers the six remaining sections.
}
