import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";
import { Errors, sendError } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";

export function registerCoreAIRoutes(app: Express): void {
  const api = app;

  // CORE AI AGENTS
  // ============================================

  const agentTaskSchema = z.object({
    agentType: z.enum(["research", "deals", "communications", "operations"]),
    action: z.string(),
    parameters: z.record(z.string(), z.any()).optional(),
  });

  api.get("/api/agents", isAuthenticated, async (req, res) => {
    try {
      const { getAllAgentsInfo } = await import('./services/core-agents');
      res.json(getAllAgentsInfo());
    } catch (err: any) {
      logger.error("Get agents error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/agents/skills", isAuthenticated, async (req, res) => {
    try {
      const { getAllSkills } = await import('./services/core-agents');
      res.json(getAllSkills());
    } catch (err: any) {
      logger.error("Get all skills error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/agents/skills/:agentType", isAuthenticated, async (req, res) => {
    try {
      const { getAgentSkills } = await import('./services/core-agents');
      const agentType = req.params.agentType as any;
      const skills = getAgentSkills(agentType);
      
      if (!skills) {
        return Errors.notFound(res, "Agent type");
      }

      res.json(skills);
    } catch (err: any) {
      logger.error("Get agent skills error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/agents/skills/:skillId/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { skillId } = req.params;
      const { params, agentType } = req.body;
      
      const { executeAgentTask } = await import('./services/core-agents');
      
      const result = await executeAgentTask(agentType || "research", {
        action: "execute_skill",
        parameters: { skillId, params: params || {} },
        context: {
          organizationId: org.id,
          userId: user?.id,
          relatedLeadId: params?.leadId,
          relatedPropertyId: params?.propertyId,
          relatedDealId: params?.dealId,
        },
      });

      res.json(result);
    } catch (err: any) {
      logger.error("Execute skill error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/agents/:type", isAuthenticated, async (req, res) => {
    try {
      const { getAgentInfo } = await import('./services/core-agents');
      const agentType = req.params.type as any;
      const info = getAgentInfo(agentType);
      
      if (!info) {
        return Errors.notFound(res, "Agent type");
      }

      res.json(info);
    } catch (err: any) {
      logger.error("Get agent error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/agents/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      
      const parseResult = agentTaskSchema.safeParse(req.body);
      if (!parseResult.success) {
        return Errors.badRequest(res, "Invalid request", parseResult.error.issues);
      }

      const { agentType, action, parameters } = parseResult.data;
      const { executeAgentTask } = await import('./services/core-agents');
      
      const result = await executeAgentTask(agentType, {
        action,
        parameters: parameters || {},
        context: {
          organizationId: org.id,
          userId: user?.id,
          relatedLeadId: parameters?.leadId,
          relatedPropertyId: parameters?.propertyId,
          relatedDealId: parameters?.dealId,
        },
      });

      res.json(result);
    } catch (err: any) {
      logger.error("Agent execute error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/agents/research/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { propertyId } = req.body;

      if (!propertyId) {
        return Errors.badRequest(res, "propertyId is required");
      }

      const { executeAgentTask } = await import('./services/core-agents');
      const result = await executeAgentTask("research", {
        action: "run_due_diligence",
        parameters: { propertyId },
        context: { organizationId: org.id },
      });

      res.json(result);
    } catch (err: any) {
      logger.error("Due diligence error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/agents/deals/generate-offer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { leadId, propertyId, offerPrice, terms } = req.body;

      const { executeAgentTask } = await import('./services/core-agents');
      const result = await executeAgentTask("deals", {
        action: "generate_offer",
        parameters: { leadId, propertyId, offerPrice, terms },
        context: { organizationId: org.id },
      });

      res.json(result);
    } catch (err: any) {
      logger.error("Generate offer error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/agents/communications/compose", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { type, leadId, purpose, tone, customDetails } = req.body;

      const { executeAgentTask } = await import('./services/core-agents');
      const action = type === "sms" ? "compose_sms" : "compose_email";
      
      const result = await executeAgentTask("communications", {
        action,
        parameters: { leadId, purpose, tone, customDetails },
        context: { organizationId: org.id },
      });

      res.json(result);
    } catch (err: any) {
      logger.error("Compose message error", err);
      Errors.internal(res, err);
    }
  });

  // Agent Memory & Feedback Endpoints
  api.post("/api/agents/feedback", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { agentTaskId, rating, helpful, feedback: feedbackText } = req.body;

      if (!agentTaskId || rating === undefined || helpful === undefined) {
        return Errors.badRequest(res, "agentTaskId, rating, and helpful are required");
      }

      if (rating < 1 || rating > 5) {
        return Errors.badRequest(res, "Rating must be between 1 and 5");
      }

      const agentTask = await storage.getAgentTask(org.id, agentTaskId);
      if (!agentTask) {
        return Errors.notFound(res, "Agent task");
      }

      const existingFeedback = await storage.getAgentFeedbackByTask(agentTaskId);
      if (existingFeedback) {
        return sendError(res, 409, "FEEDBACK_ALREADY_SUBMITTED", "Feedback already submitted for this task");
      }

      const feedbackData = await storage.createAgentFeedback({
        organizationId: org.id,
        agentTaskId,
        userId: user?.id || "anonymous",
        rating,
        helpful,
        feedback: feedbackText || null,
      });

      res.json({ success: true, feedback: feedbackData });
    } catch (err: any) {
      logger.error("Submit feedback error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/agents/memory/:agentType", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { agentType } = req.params;
      const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

      const validTypes = ["research", "deals", "communications", "operations"];
      if (!validTypes.includes(agentType)) {
        return Errors.badRequest(res, "Invalid agent type");
      }

      const memories = await storage.getAgentMemories(org.id, agentType, limit);
      res.json({ memories, count: memories.length });
    } catch (err: any) {
      logger.error("Get agent memory error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/agents/feedback/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const agentType = req.query.agentType as string | undefined;

      const stats = await storage.getAgentFeedbackStats(org.id, agentType);
      res.json(stats);
    } catch (err: any) {
      logger.error("Get feedback stats error", err);
      Errors.internal(res, err);
    }
  });

  api.delete("/api/agents/memory/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as AuthenticatedRequest).organization;
      const memoryId = parseInt(req.params.id);
      if (isNaN(memoryId)) {
        return Errors.badRequest(res, "Invalid memory ID");
      }

      // F-D39: storage method already accepts an optional org filter — pass it
      // so a customer can't delete another org's agent memories.
      await storage.deleteAgentMemory(memoryId, org.id);
      res.json({ success: true });
    } catch (err: any) {
      logger.error("Delete agent memory error", err);
      Errors.internal(res, err);
    }
  });

  // ──────────────────────────────────────────────
  // PAX OBSERVATIONS — proactive insight feed
  // ──────────────────────────────────────────────

  /**
   * GET /api/pax/observations
   * Returns recent, unread pax observations for the org.
   * Used by the sidebar notification badge and the insight feed.
   * Query params:
   *   limit  – max records (default 20)
   *   unread – if "true", return only status=detected entries (for badge count)
   */
  api.get("/api/pax/observations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const limit = parseInt(req.query.limit as string) || 20;
      const unreadOnly = req.query.unread === "true";

      const { paxObserver } = await import('./services/paxObserver');

      if (unreadOnly) {
        const count = await paxObserver.getUnreadPassiveCount(org.id);
        return res.json({ count });
      }

      const observations = await paxObserver.getActiveObservations(org.id, limit);
      res.json({ observations });
    } catch (err: any) {
      logger.error("Pax observations error", err);
      Errors.internal(res, err);
    }
  });

  /**
   * POST /api/pax/observations/:id/acknowledge
   * Marks a specific observation as acknowledged (seen by user).
   */
  api.post("/api/pax/observations/:id/acknowledge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const observationId = parseInt(req.params.id);
      if (isNaN(observationId)) {
        return Errors.badRequest(res, "Invalid observation ID");
      }
      const { paxObserver } = await import('./services/paxObserver');
      const ok = await paxObserver.acknowledgeObservation(observationId);
      res.json({ success: ok });
    } catch (err: any) {
      logger.error("Acknowledge observation error", err);
      Errors.internal(res, err);
    }
  });

  /**
   * GET /api/pax/observations/:id/explain
   *
   * Lens 46 — customer-facing trust loop. Returns the reasoning, inputs,
   * alternatives Pax considered, and the model that produced the call.
   * Customers see *what Pax did for them* AND why — not just the outcome.
   * Scoped to the requester's org so customers can't read other orgs' rows.
   */
  api.get("/api/pax/observations/:id/explain", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const observationId = parseInt(req.params.id);
      if (isNaN(observationId)) {
        return Errors.badRequest(res, "Invalid observation ID");
      }
      const org = req.organization;
      if (!org) return Errors.unauthorized(res);
      const { explainPaxObservation } = await import("./services/decisionExplanation");
      const explanation = await explainPaxObservation(observationId, org.id);
      if (!explanation) return Errors.notFound(res, "Observation");
      res.json(explanation);
    } catch (err: any) {
      logger.error("Explain observation error", err);
      Errors.internal(res, err);
    }
  });

  /**
   * POST /api/pax/observations/:id/dismiss
   * Dismisses an observation so it no longer appears.
   */
  api.post("/api/pax/observations/:id/dismiss", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const observationId = parseInt(req.params.id);
      if (isNaN(observationId)) {
        return Errors.badRequest(res, "Invalid observation ID");
      }
      const { paxObserver } = await import('./services/paxObserver');
      const ok = await paxObserver.dismissObservation(observationId);
      res.json({ success: ok });
    } catch (err: any) {
      logger.error("Dismiss observation error", err);
      Errors.internal(res, err);
    }
  });

  api.get("/api/integrations/status", isAuthenticated, async (req, res) => {
    try {
      const { communicationsService } = await import('./services/communications');
      const status = communicationsService.getChannelStatus();
      res.json(status);
    } catch (err: any) {
      logger.error("Integration status error", err);
      Errors.internal(res, err);
    }
  });

  api.post("/api/communications/send", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { type, leadId, subject, content, template, variables } = req.body;
      
      if (!leadId || !type || !content) {
        return Errors.badRequest(res, "leadId, type, and content are required");
      }

      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return Errors.notFound(res, "Lead");
      }
      
      const { communicationsService } = await import('./services/communications');
      const result = await communicationsService.sendToLead({
        organizationId: org.id,
        leadId: lead.id,
        channel: type === 'email' ? 'email' : type === 'sms' ? 'sms' : 'both',
        subject,
        message: content,
      });
      
      res.json(result);
    } catch (err: any) {
      logger.error("Communications send error", err);
      Errors.internal(res, err);
    }
  });

  // ──────────────────────────────────────────────
  // NEGOTIATION COACHING (wires negotiationOrchestrator to the UI)
  // ──────────────────────────────────────────────

  // GET /api/ai/negotiation/counter-offer — recommend a counter-offer amount + tactics
  api.get("/api/ai/negotiation/counter-offer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { propertyId, askingPrice, offeredPrice, timeOnMarket, competingOffers } = req.query;
      if (!propertyId || !askingPrice) {
        return Errors.badRequest(res, "propertyId and askingPrice are required");
      }

      const { negotiationOrchestrator } = await import("./services/negotiationOrchestrator");
      const orgId = String(req.organization?.id ?? "");
      const recommendation = await negotiationOrchestrator.generateCounterOffer(
        orgId,
        "counter-offer",
        {
          propertyId: String(propertyId),
          askingPrice: Number(askingPrice),
          marketValue: Number(askingPrice), // fallback
          comparables: [],
          sellerHistory: [],
          timeOnMarket: timeOnMarket ? Number(timeOnMarket) : 60,
          competingOffers: competingOffers ? Number(competingOffers) : 0,
        },
        {
          motivation: "motivated",
          urgency: 50,
          emotionalTriggers: [],
          communicationStyle: "analytical",
          priceFlexibility: 20,
          keyPainPoints: [],
        },
        []
      );

      res.json(recommendation);
    } catch (err: any) {
      logger.error("Counter offer error", err);
      Errors.internal(res, err);
    }
  });

  // POST /api/ai/negotiation/analyze-seller — analyze seller psychology from messages
  api.post("/api/ai/negotiation/analyze-seller", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { messages, propertyId } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return Errors.badRequest(res, "messages array is required");
      }

      const { negotiationOrchestrator } = await import("./services/negotiationOrchestrator");
      const orgId = String(req.organization?.id ?? "");
      const profile = await negotiationOrchestrator.analyzeSellerPsychology(
        orgId,
        propertyId ? String(propertyId) : "unknown",
        messages
      );

      res.json(profile);
    } catch (err: any) {
      logger.error("Analyze seller error", err);
      Errors.internal(res, err);
    }
  });

  // POST /api/ai/negotiation/script — generate a negotiation script for an active offer
  api.post("/api/ai/negotiation/script", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { sellerMessages, askingPrice, offerAmount, sellerMotivation } = req.body;
      if (!askingPrice || !offerAmount) {
        return Errors.badRequest(res, "askingPrice and offerAmount are required");
      }

      const { negotiationOrchestrator } = await import("./services/negotiationOrchestrator");

      // Build a seller profile from the provided context
      const scriptOrgId = String(req.organization?.id ?? "");
      const sellerProfile = sellerMessages?.length
        ? await negotiationOrchestrator.analyzeSellerPsychology(scriptOrgId, "active", sellerMessages)
        : {
            motivation: sellerMotivation ?? "motivated",
            urgency: 50,
            emotionalTriggers: [],
            communicationStyle: "analytical",
            priceFlexibility: 20,
            keyPainPoints: [],
          };

      const counterOffer = await negotiationOrchestrator.generateCounterOffer(
        scriptOrgId,
        "active",
        {
          propertyId: "active",
          askingPrice: Number(askingPrice),
          marketValue: Number(askingPrice),
          comparables: [],
          sellerHistory: [],
          timeOnMarket: 60,
          competingOffers: 0,
        },
        sellerProfile as any,
        []
      );

      const script = await negotiationOrchestrator.generateNegotiationScript(
        scriptOrgId,
        "active",
        sellerProfile as any,
        counterOffer
      );

      res.json({ script, counterOffer, sellerProfile });
    } catch (err: any) {
      logger.error("Negotiation script error", err);
      Errors.internal(res, err);
    }
  });

  // ============================================

}
