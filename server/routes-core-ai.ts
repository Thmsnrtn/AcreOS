import type { Express } from "express";
import { storage } from "./storage";
import { z } from "zod";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { usageMeteringService, creditService } from "./services/credits";

export function registerCoreAIRoutes(app: Express): void {
  const api = app;

  // CORE AI AGENTS
  // ============================================

  const agentTaskSchema = z.object({
    agentType: z.enum(["research", "deals", "communications", "operations"]),
    action: z.string(),
    parameters: z.record(z.any()).optional(),
  });

  api.get("/api/agents", isAuthenticated, async (req, res) => {
    try {
      const { getAllAgentsInfo } = await import('./services/core-agents');
      res.json(getAllAgentsInfo());
    } catch (err: any) {
      console.error("Get agents error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/skills", isAuthenticated, async (req, res) => {
    try {
      const { getAllSkills } = await import('./services/core-agents');
      res.json(getAllSkills());
    } catch (err: any) {
      console.error("Get all skills error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/skills/:agentType", isAuthenticated, async (req, res) => {
    try {
      const { getAgentSkills } = await import('./services/core-agents');
      const agentType = req.params.agentType as any;
      const skills = getAgentSkills(agentType);
      
      if (!skills) {
        return res.status(404).json({ message: "Agent type not found" });
      }
      
      res.json(skills);
    } catch (err: any) {
      console.error("Get agent skills error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/skills/:skillId/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
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
      console.error("Execute skill error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/:type", isAuthenticated, async (req, res) => {
    try {
      const { getAgentInfo } = await import('./services/core-agents');
      const agentType = req.params.type as any;
      const info = getAgentInfo(agentType);
      
      if (!info) {
        return res.status(404).json({ message: "Agent type not found" });
      }
      
      res.json(info);
    } catch (err: any) {
      console.error("Get agent error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      
      const parseResult = agentTaskSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ message: "Invalid request", errors: parseResult.error.errors });
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
      console.error("Agent execute error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/research/due-diligence", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { propertyId } = req.body;

      if (!propertyId) {
        return res.status(400).json({ message: "propertyId is required" });
      }

      const { executeAgentTask } = await import('./services/core-agents');
      const result = await executeAgentTask("research", {
        action: "run_due_diligence",
        parameters: { propertyId },
        context: { organizationId: org.id },
      });

      res.json(result);
    } catch (err: any) {
      console.error("Due diligence error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/deals/generate-offer", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { leadId, propertyId, offerPrice, terms } = req.body;

      const { executeAgentTask } = await import('./services/core-agents');
      const result = await executeAgentTask("deals", {
        action: "generate_offer",
        parameters: { leadId, propertyId, offerPrice, terms },
        context: { organizationId: org.id },
      });

      res.json(result);
    } catch (err: any) {
      console.error("Generate offer error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/agents/communications/compose", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
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
      console.error("Compose message error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // Agent Memory & Feedback Endpoints
  api.post("/api/agents/feedback", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { agentTaskId, rating, helpful, feedback: feedbackText } = req.body;

      if (!agentTaskId || rating === undefined || helpful === undefined) {
        return res.status(400).json({ message: "agentTaskId, rating, and helpful are required" });
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be between 1 and 5" });
      }

      const agentTask = await storage.getAgentTask(org.id, agentTaskId);
      if (!agentTask) {
        return res.status(404).json({ message: "Agent task not found" });
      }

      const existingFeedback = await storage.getAgentFeedbackByTask(agentTaskId);
      if (existingFeedback) {
        return res.status(409).json({ message: "Feedback already submitted for this task" });
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
      console.error("Submit feedback error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/memory/:agentType", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { agentType } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      const validTypes = ["research", "deals", "communications", "operations"];
      if (!validTypes.includes(agentType)) {
        return res.status(400).json({ message: "Invalid agent type" });
      }

      const memories = await storage.getAgentMemories(org.id, agentType, limit);
      res.json({ memories, count: memories.length });
    } catch (err: any) {
      console.error("Get agent memory error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/agents/feedback/stats", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agentType = req.query.agentType as string | undefined;

      const stats = await storage.getAgentFeedbackStats(org.id, agentType);
      res.json(stats);
    } catch (err: any) {
      console.error("Get feedback stats error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.delete("/api/agents/memory/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const memoryId = parseInt(req.params.id);
      if (isNaN(memoryId)) {
        return res.status(400).json({ message: "Invalid memory ID" });
      }

      await storage.deleteAgentMemory(memoryId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Delete agent memory error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/integrations/status", isAuthenticated, async (req, res) => {
    try {
      const { communicationsService } = await import('./services/communications');
      const status = communicationsService.getChannelStatus();
      res.json(status);
    } catch (err: any) {
      console.error("Integration status error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/communications/send", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const { type, leadId, subject, content, template, variables } = req.body;
      
      if (!leadId || !type || !content) {
        return res.status(400).json({ message: "leadId, type, and content are required" });
      }
      
      const lead = await storage.getLead(org.id, leadId);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
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
      console.error("Communications send error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================

}
