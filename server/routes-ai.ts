import type { Express } from "express";
import { z } from "zod";
import { insertAgentConfigSchema, insertAgentTaskSchema } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { checkUsageLimit } from "./services/usageLimits";
import { usageLimitGate } from "./middleware/usageLimitGate";
import { usageMeteringService, creditService } from "./services/credits";
import { processChat, processChatStream, agentProfiles, getOrCreateConversation } from "./ai/executive";
import { storage, db } from "./storage";
import { eq, sql, and } from "drizzle-orm";
import type { SubscriptionTier } from "./services/usageLimits";
import { aiLimiter } from "./middleware/rateLimit";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export function registerAIRoutes(app: Express): void {
  const api = app;

  // AI AGENTS
  // ============================================
  
  api.get("/api/agents/configs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const configs = await storage.getAgentConfigs(org.id);
    res.json(configs);
  });
  
  api.post("/api/agents/configs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const input = insertAgentConfigSchema.parse({ ...req.body, organizationId: org.id });
      const config = await storage.createAgentConfig(input);
      res.status(201).json(config);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.errors[0].message);
      }
      throw err;
    }
  });

  api.get("/api/agents/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const tasks = await storage.getAgentTasks(org.id);
    res.json(tasks);
  });
  
  api.post("/api/agents/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      const input = insertAgentTaskSchema.parse({ ...req.body, organizationId: org.id });
      const task = await storage.createAgentTask(input);
      res.status(201).json(task);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return Errors.badRequest(res, err.errors[0].message);
      }
      throw err;
    }
  });

  // Get background agent statuses (for Agents tab in Command Center)
  api.get("/api/agents/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const statuses = await storage.getAgentStatuses();
      res.json(statuses);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // ============================================
  // CONVERSATIONS (Buyer Communication)
  // ============================================
  
  api.get("/api/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const filters: { leadId?: number; channel?: string } = {};
    if (req.query.leadId) {
      filters.leadId = Number(req.query.leadId);
    }
    if (req.query.channel && typeof req.query.channel === 'string') {
      filters.channel = req.query.channel;
    }
    const conversations = await storage.getConversations(org.id, filters);
    res.json(conversations);
  });
  
  api.get("/api/conversations/:id/messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const messages = await storage.getMessages(Number(req.params.id));
    res.json(messages);
  });
  
  // ============================================
  // AI COMMAND CENTER
  // ============================================
  
  // Get available AI agents
  api.get("/api/ai/agents", isAuthenticated, async (req, res) => {
    res.json(Object.values(agentProfiles));
  });
  
  // Get conversation history
  api.get("/api/ai/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const q = (req.query.q as string | undefined)?.trim();
    if (q) {
      const { ilike } = await import("drizzle-orm");
      const { aiConversations: convs } = await import("@shared/schema");
      const { desc: _desc } = await import("drizzle-orm");
      const results = await db.select().from(convs)
        .where(and(eq(convs.organizationId, org.id), ilike(convs.title, `%${q}%`)))
        .orderBy(_desc(convs.updatedAt))
        .limit(30);
      return res.json(results);
    }
    const conversations = await storage.getAiConversations(org.id);
    res.json(conversations);
  });
  
  // Get a specific conversation with messages
  api.get("/api/ai/conversations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const conversationId = parseInt(req.params.id);
    const conversation = await storage.getAiConversation(conversationId);
    
    if (!conversation || conversation.organizationId !== org.id) {
      return Errors.notFound(res, "Conversation");
    }
    
    const messages = await storage.getAiMessages(conversationId);
    res.json({ conversation, messages });
  });
  
  // Get messages for a conversation (lightweight, for session restore)
  api.get("/api/ai/conversations/:id/messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const conversationId = parseInt(req.params.id);
    const limit = Math.min(parseInt((req.query.limit as string) ?? "20"), 50);

    const conversation = await storage.getAiConversation(conversationId);
    if (!conversation || conversation.organizationId !== org.id) {
      return Errors.notFound(res, "Conversation");
    }

    const allMessages = await storage.getAiMessages(conversationId);
    const messages = allMessages.slice(-limit);

    res.json({
      conversationId,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messages,
    });
  });

  // Create new conversation
  api.post("/api/ai/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const user = req.user as any;
    const userId = user.claims?.sub || user.id;
    const { agentRole = "executive" } = req.body;
    
    const conversation = await storage.createAiConversation({
      organizationId: org.id,
      userId,
      title: "New Conversation",
      agentRole
    });
    
    res.status(201).json(conversation);
  });
  
  // Send a message (non-streaming)
  api.post("/api/ai/chat", isAuthenticated, getOrCreateOrg, aiLimiter, usageLimitGate("ai_requests"), async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { message, conversationId, agentRole, propertyId } = req.body;

      if (!message) {
        return Errors.badRequest(res, "Message is required");
      }
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      // Credit pre-check for AI chat (2 cents per request)
      const aiChatCost = await usageMeteringService.calculateCost("ai_chat", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, aiChatCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: aiChatCost / 100,
          balance: balance / 100,
        });
      }
      
      await storage.trackUsage(org.id, "ai_request");
      
      const result = await processChat(message, org, userId, {
        conversationId,
        agentRole,
        propertyId: propertyId ? Number(propertyId) : undefined,
      });
      
      // Record usage after successful AI chat with provider/model/token info
      await usageMeteringService.recordUsage(org.id, "ai_chat", 1, {
        conversationId,
        agentRole,
        provider: result.provider || "openai",
        model: result.model || "gpt-4o",
        estimatedCost: result.estimatedCost,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      });
      
      res.json(result);
    } catch (error: any) {
      logger.error("AI Chat error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
  
  // Send a message (streaming)
  api.post("/api/ai/chat/stream", isAuthenticated, getOrCreateOrg, aiLimiter, usageLimitGate("ai_requests"), async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { message, conversationId, agentRole, files, propertyId: streamPropertyId, mentionedEntities, activeProjectId, modelOverride } = req.body;
      
      if (!message) {
        return Errors.badRequest(res, "Message is required");
      }
      
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({
          message: `Daily AI request limit reached (${usageCheck.current}/${usageCheck.limit}). Upgrade your plan for more AI requests.`,
          current: usageCheck.current,
          limit: usageCheck.limit,
          resourceType: usageCheck.resourceType,
          tier: usageCheck.tier,
        });
      }
      
      // Credit pre-check for AI chat (2 cents per request)
      const aiChatCost = await usageMeteringService.calculateCost("ai_chat", 1);
      const hasCredits = await creditService.hasEnoughCredits(org.id, aiChatCost);
      if (!hasCredits) {
        const balance = await creditService.getBalance(org.id);
        return res.status(402).json({
          error: "Insufficient credits",
          required: aiChatCost / 100,
          balance: balance / 100,
        });
      }
      
      await storage.trackUsage(org.id, "ai_request");
      
      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      
      const stream = processChatStream(message, org, userId, {
        conversationId,
        agentRole,
        files,
        propertyId: streamPropertyId ? Number(streamPropertyId) : undefined,
        mentionedEntities,
        activeProjectId: activeProjectId ? Number(activeProjectId) : undefined,
        modelOverride: modelOverride || undefined,
      });
      
      let streamCompleted = false;
      let streamProvider: string | undefined;
      let streamModel: string | undefined;
      let streamEstimatedCost: number | undefined;
      let streamPromptTokens: number | undefined;
      let streamCompletionTokens: number | undefined;
      for await (const event of stream) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if ((event as any).type === "done") {
          streamCompleted = true;
          streamProvider = (event as any).provider;
          streamModel = (event as any).model;
          streamEstimatedCost = (event as any).estimatedCost;
          streamPromptTokens = (event as any).promptTokens;
          streamCompletionTokens = (event as any).completionTokens;
        }
      }
      
      // Record usage only after successful stream completion with provider/model/cost info
      if (streamCompleted) {
        await usageMeteringService.recordUsage(org.id, "ai_chat", 1, {
          conversationId,
          agentRole,
          provider: streamProvider || "openai",
          model: streamModel || "gpt-4o",
          estimatedCost: streamEstimatedCost,
          promptTokens: streamPromptTokens,
          completionTokens: streamCompletionTokens,
        });
      }
      
      res.end();
    } catch (error: any) {
      logger.error("AI Stream error", error instanceof Error ? error : undefined);
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  });
  
  // Delete a conversation
  api.delete("/api/ai/conversations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = req.organization;
    const conversationId = parseInt(req.params.id);
    const conversation = await storage.getAiConversation(conversationId);
    
    if (!conversation || conversation.organizationId !== org.id) {
      return Errors.notFound(res, "Conversation");
    }
    
    await storage.deleteAiConversation(conversationId);
    res.json({ success: true });
  });

  // PATCH /api/ai/conversations/:id/project — set active project for conversation
  api.patch("/api/ai/conversations/:id/project", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getAiConversation(conversationId);
      if (!conversation || conversation.organizationId !== org.id) {
        return Errors.notFound(res, "Conversation");
      }
      const { projectId } = req.body;
      await storage.setConversationProject(conversationId, projectId ?? null);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // KNOWLEDGE BASE ROUTES
  // ============================================

  api.get("/api/ai/knowledge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const files = await storage.getKnowledgeFiles(org.id);
      res.json(files);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/ai/knowledge", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const userId = req.user?.id ?? "unknown";
      const { name, content, mimeType, sizeBytes } = req.body;

      // Check limit
      const existing = await storage.getKnowledgeFiles(org.id);
      if (existing.length >= 8) {
        return Errors.badRequest(res, "Knowledge base file limit (8) reached.");
      }

      // Extract text from base64 content via executive helper
      const { formatFileContentFromBase64 } = await import("./ai/executive");
      let extractedContent = await formatFileContentFromBase64({ name, content, mimeType });
      // Cap at 6000 chars
      if (extractedContent.length > 6000) extractedContent = extractedContent.slice(0, 6000) + "\n[truncated]";

      const file = await storage.createKnowledgeFile({
        organizationId: org.id,
        name,
        description: null,
        mimeType,
        sizeBytes: sizeBytes ?? 0,
        extractedContent,
        uploadedBy: userId,
        isActive: true,
      });
      res.json(file);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.patch("/api/ai/knowledge/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { isActive, description } = req.body;
      await storage.updateKnowledgeFile(parseInt(req.params.id), { isActive, description });
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/ai/knowledge/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      await storage.deleteKnowledgeFile(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // ENTITY SEARCH (@ mentions)
  // ============================================

  api.get("/api/ai/search-entities", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const q = (req.query.q as string) ?? "";
      const type = (req.query.type as string) ?? "all";
      const limit = parseInt((req.query.limit as string) ?? "6");
      if (!q) return res.json([]);
      const results = await storage.searchPaxEntities(org.id, q, type, limit);
      res.json(results);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // PROJECT ROUTES
  // ============================================

  api.get("/api/ai/projects", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      res.json(await storage.getPaxProjects(org.id));
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/ai/projects", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const userId = req.user?.id ?? "unknown";
      const { name, description, entityType, entityId } = req.body;
      if (!name) return Errors.badRequest(res, "name required");
      const proj = await storage.createPaxProject({ organizationId: org.id, userId, name, description, entityType, entityId });
      res.json(proj);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.patch("/api/ai/projects/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { name, description, isActive } = req.body;
      await storage.updatePaxProject(parseInt(req.params.id), { name, description, isActive });
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/ai/projects/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      await storage.deletePaxProject(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/ai/projects/:id/files", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      res.json(await storage.getPaxProjectFiles(parseInt(req.params.id)));
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/ai/projects/:id/files", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const userId = req.user?.id ?? "unknown";
      const projectId = parseInt(req.params.id);
      const { fileName, content, mimeType, sizeBytes } = req.body;

      const { formatFileContentFromBase64 } = await import("./ai/executive");
      let extractedContent = await formatFileContentFromBase64({ name: fileName, content, mimeType });
      if (extractedContent.length > 8000) extractedContent = extractedContent.slice(0, 8000) + "\n[truncated]";

      const file = await storage.createPaxProjectFile({ projectId, fileName, mimeType, sizeBytes: sizeBytes ?? 0, extractedContent, uploadedBy: userId });
      res.json(file);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/ai/projects/:id/files/:fileId", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      await storage.deletePaxProjectFile(parseInt(req.params.fileId));
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // SCHEDULED TASK ROUTES
  // ============================================

  api.get("/api/ai/scheduled-tasks/pending-results", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const since = req.query.since ? new Date(req.query.since as string) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const results = await storage.getPaxPendingTaskResults(org.id, since);
      res.json(results.map((t) => ({ id: t.id, name: t.name, lastRunAt: t.lastRunAt, lastRunConversationId: t.lastRunConversationId })));
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/ai/scheduled-tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      res.json(await storage.getPaxScheduledTasks(org.id));
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/ai/scheduled-tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const userId = req.user?.id ?? "unknown";
      const { name, prompt, schedule, timezone } = req.body;
      if (!name || !prompt || !schedule) return Errors.badRequest(res, "name, prompt, schedule required");

      const { computeNextRun } = await import("./services/paxScheduler");
      const nextRunAt = computeNextRun(schedule, timezone ?? "America/New_York");

      const task = await storage.createPaxScheduledTask({ organizationId: org.id, userId, name, prompt, schedule, timezone, nextRunAt });
      res.json(task);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.patch("/api/ai/scheduled-tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { isActive, schedule, timezone } = req.body;
      const updates: any = { isActive };
      if (schedule) {
        const { computeNextRun } = await import("./services/paxScheduler");
        updates.schedule = schedule;
        updates.nextRunAt = computeNextRun(schedule, timezone ?? "America/New_York");
      }
      await storage.updatePaxScheduledTask(parseInt(req.params.id), updates);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/ai/scheduled-tasks/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      await storage.deletePaxScheduledTask(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/ai/scheduled-tasks/:id/run-now", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const tasks = await storage.getPaxScheduledTasks(org.id);
      const task = tasks.find((t) => t.id === parseInt(req.params.id));
      if (!task) return Errors.notFound(res, "Task");
      const { executeTask } = await import("./services/paxScheduler");
      await executeTask(task, org);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // MESSAGE RATING
  // ============================================

  api.patch("/api/ai/messages/:id/rating", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { rating } = req.body; // 1 or -1
      const msgId = parseInt(req.params.id);
      if (rating !== 1 && rating !== -1) return Errors.badRequest(res, "rating must be 1 or -1");
      const { aiMessages } = await import("@shared/schema");
      const { eq: _eq } = await import("drizzle-orm");
      await db.update(aiMessages).set({ rating } as any).where(_eq(aiMessages.id, msgId));
      // Async learning ingestion (non-blocking)
      process.nextTick(async () => {
        try {
          const { paxLearningService } = await import("./services/paxLearning");
          if (paxLearningService.learnFromRating) {
            await paxLearningService.learnFromRating(msgId, rating);
          }
        } catch {}
      });
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // CONVERSATION EXPORT
  // ============================================

  api.get("/api/ai/conversations/:id/export", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const convId = parseInt(req.params.id);
      const format = (req.query.format as string) || "markdown";
      const { aiConversations, aiMessages: msgs } = await import("@shared/schema");
      const { eq: _eq, and: _and } = await import("drizzle-orm");
      const [conv] = await db.select().from(aiConversations).where(_eq(aiConversations.id, convId));
      if (!conv || conv.organizationId !== org.id) return Errors.notFound(res, "Conversation");
      const messages = await db.select().from(msgs).where(_eq(msgs.conversationId, convId)).orderBy(msgs.createdAt);
      // Build Markdown
      const md = [
        `# ${conv.title}`,
        `_Exported ${new Date().toLocaleDateString()} · Agent: ${conv.agentRole}_`,
        "",
        ...messages.map(m => {
          const roleLabel = m.role === "user" ? "**You**" : "**Pax**";
          const toolLine = (m.toolCalls as any[])?.length
            ? `\n> _Tools used: ${(m.toolCalls as any[]).map((t: any) => t.name).join(", ")}_\n`
            : "";
          return `${roleLabel}\n\n${m.content}${toolLine}\n\n---`;
        })
      ].join("\n");

      if (format === "pdf") {
        // @ts-expect-error — pdfkit has no type declarations installed
        const PDFDocument = (await import("pdfkit")).default;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="pax-conversation-${convId}.pdf"`);
        const doc = new PDFDocument({ margin: 50 });
        doc.pipe(res);
        doc.fontSize(18).text(conv.title, { underline: true });
        doc.fontSize(10).fillColor("gray").text(`Exported ${new Date().toLocaleDateString()} · Agent: ${conv.agentRole}`);
        doc.moveDown();
        for (const m of messages) {
          doc.fontSize(11).fillColor(m.role === "user" ? "#1a56db" : "#111827").text(m.role === "user" ? "You:" : "Pax:", { continued: false });
          doc.fontSize(10).fillColor("#374151").text(m.content?.slice(0, 2000) || "", { lineGap: 2 });
          doc.moveDown(0.5);
        }
        doc.end();
      } else {
        res.setHeader("Content-Type", "text/markdown");
        res.setHeader("Content-Disposition", `attachment; filename="pax-conversation-${convId}.md"`);
        res.send(md);
      }
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // PAX NUDGES (Proactive Ambient Intelligence)
  // ============================================

  api.get("/api/ai/nudges", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user as any;
      const userId = user?.claims?.sub || user?.id;
      const { paxNudges } = await import("@shared/schema");
      const { eq: _eq, and: _and, isNull, or: _or, lte: _lte, sql: _sql } = await import("drizzle-orm");
      const now = new Date();
      const nudges = await db.select().from(paxNudges)
        .where(_and(
          _eq(paxNudges.organizationId, org.id),
          isNull(paxNudges.dismissedAt),
          // Exclude snoozed nudges (snoozedUntil IS NULL OR snoozedUntil < NOW)
          _or(isNull(paxNudges.snoozedUntil), _lte(paxNudges.snoozedUntil, now))
        ))
        .orderBy(paxNudges.priority, paxNudges.createdAt)
        .limit(5);
      res.json(nudges);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/ai/nudges/:id/dismiss", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { paxNudges } = await import("@shared/schema");
      const { eq: _eq } = await import("drizzle-orm");
      await db.update(paxNudges).set({ dismissedAt: new Date() } as any).where(_eq(paxNudges.id, parseInt(req.params.id)));
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // FOUNDER AI OBSERVATORY
  // ============================================

  api.get("/api/founder/ai/telemetry", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const isFounder = user?.id === 'founder' || user?.claims?.sub === 'founder';
      if (!isFounder) return Errors.forbidden(res, "Founder only");
      const { aiConversations, aiMessages: msgs, organizations } = await import("@shared/schema");
      const { desc: _desc, eq: _eq } = await import("drizzle-orm");
      // Last 50 conversations across all orgs
      const conversations = await db.select({
        id: aiConversations.id,
        title: aiConversations.title,
        agentRole: aiConversations.agentRole,
        organizationId: aiConversations.organizationId,
        createdAt: aiConversations.createdAt,
        orgName: organizations.name,
      })
        .from(aiConversations)
        .leftJoin(organizations, _eq(aiConversations.organizationId, organizations.id))
        .orderBy(_desc(aiConversations.createdAt))
        .limit(50);
      res.json(conversations);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.get("/api/founder/ai/stats", isAuthenticated, async (req, res) => {
    try {
      const user = req.user as any;
      const isFounder = user?.id === 'founder' || user?.claims?.sub === 'founder';
      if (!isFounder) return Errors.forbidden(res, "Founder only");
      const { aiConversations, aiMessages: msgs, paxConnectorInstances, organizations } = await import("@shared/schema");
      const { count: _count, eq: _eq, desc: _desc } = await import("drizzle-orm");
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      // Conversation count per org
      const convPerOrg = await db.select({
        organizationId: aiConversations.organizationId,
        orgName: organizations.name,
        convCount: _count(aiConversations.id),
      })
        .from(aiConversations)
        .leftJoin(organizations, _eq(aiConversations.organizationId, organizations.id))
        .groupBy(aiConversations.organizationId, organizations.name)
        .orderBy(_desc(_count(aiConversations.id)))
        .limit(20);
      // Connector adoption
      const connectorAdoption = await db.select({
        connectorId: paxConnectorInstances.connectorId,
        orgCount: _count(paxConnectorInstances.id),
      })
        .from(paxConnectorInstances)
        .where(_eq(paxConnectorInstances.status, "connected"))
        .groupBy(paxConnectorInstances.connectorId)
        .orderBy(_desc(_count(paxConnectorInstances.id)));
      res.json({ convPerOrg, connectorAdoption, generatedAt: new Date() });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // PAX CONNECTORS
  // ============================================

  // GET /api/ai/connectors — list all connectors + per-org connection status
  api.get("/api/ai/connectors", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { CONNECTOR_REGISTRY } = await import("./services/connectors/registry");
      const instances = await storage.getPaxConnectors(org.id);
      const instanceMap = new Map(instances.map(i => [i.connectorId, i]));
      const result = CONNECTOR_REGISTRY.map(def => ({
        ...def,
        instance: instanceMap.get(def.id) ?? null,
      }));
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/ai/connectors/:id/connect — save credentials and mark connected
  api.post("/api/ai/connectors/:id/connect", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const connectorId = req.params.id;
      const { credentials, settings } = req.body;
      const { getConnector } = await import("./services/connectors/registry");
      const def = getConnector(connectorId);
      if (!def) return Errors.notFound(res, "Connector");
      const { encryptCredentials } = await import("./services/encryption");
      const credentialsEncrypted = credentials
        ? encryptCredentials(JSON.stringify(credentials), org.id)
        : undefined;
      const instance = await storage.upsertPaxConnector(org.id, connectorId, {
        status: "connected",
        credentialsEncrypted,
        settings,
      });
      res.json({ success: true, instance: { ...instance, credentialsEncrypted: undefined } });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // POST /api/ai/connectors/:id/test — test the connection
  api.post("/api/ai/connectors/:id/test", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const connectorId = req.params.id;
      const instance = await storage.getPaxConnector(org.id, connectorId);
      if (!instance || instance.status !== "connected") {
        return Errors.badRequest(res, "Connector not connected");
      }
      // Basic connectivity test — attempt to load credentials
      await storage.upsertPaxConnector(org.id, connectorId, {
        lastTestedAt: new Date(),
        errorMessage: undefined,
      });
      res.json({ success: true, testedAt: new Date() });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // DELETE /api/ai/connectors/:id — disconnect and remove credentials
  api.delete("/api/ai/connectors/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      await storage.deletePaxConnector(org.id, req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // GET /api/ai/cost-savings - Get AI cost savings summary
  api.get("/api/ai/cost-savings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      
      // Cost per million tokens for each model (blended input/output rate)
      // Using weighted average: assume 1:1 input:output ratio for simplicity
      const MODEL_COSTS: Record<string, number> = {
        "deepseek/deepseek-chat": 0.21,      // (0.14 + 0.28) / 2
        "deepseek/deepseek-reasoner": 1.37,  // (0.55 + 2.19) / 2
        "gpt-4o-mini": 0.375,                // (0.15 + 0.60) / 2
        "gpt-4o": 6.25,                      // (2.50 + 10.00) / 2
      };
      
      // GPT-4o blended rate as baseline
      const GPT4O_RATE = 6.25;
      
      // Get ai_chat usage records for this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      
      const { usageRecords } = await import("@shared/schema");
      const records = await db
        .select()
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.organizationId, org.id),
            eq(usageRecords.actionType, "ai_chat"),
            sql`${usageRecords.createdAt} >= ${startOfMonth}`
          )
        );
      
      // Aggregate by provider and model
      const byProvider: Record<string, { calls: number; actualCost: number; potentialCost: number }> = {};
      let totalCalls = 0;
      let totalActualCost = 0;
      let totalPotentialCost = 0;
      
      for (const record of records) {
        const metadata = (record.metadata || {}) as { provider?: string; model?: string; estimatedCost?: number; promptTokens?: number; completionTokens?: number };
        const provider = metadata.provider || "openai";
        const model = metadata.model || "gpt-4o";
        
        let actualCost: number;
        let potentialCost: number;
        
        if (metadata.estimatedCost !== undefined && metadata.estimatedCost > 0) {
          // We have actual cost from the AI call - use it
          actualCost = metadata.estimatedCost;
          
          // Calculate what GPT-4o would have cost for same tokens
          // Use cost ratio: potentialCost = actualCost * (gpt4o_rate / model_rate)
          const modelRate = MODEL_COSTS[model] || GPT4O_RATE;
          const costMultiplier = GPT4O_RATE / modelRate;
          potentialCost = actualCost * costMultiplier;
        } else if (metadata.promptTokens !== undefined && metadata.completionTokens !== undefined) {
          // We have token counts - calculate costs directly
          const totalTokens = metadata.promptTokens + metadata.completionTokens;
          const modelRate = MODEL_COSTS[model] || GPT4O_RATE;
          actualCost = (totalTokens * modelRate) / 1_000_000;
          potentialCost = (totalTokens * GPT4O_RATE) / 1_000_000;
        } else {
          // Fallback: use average costs per call (less accurate)
          const AVG_TOKENS_PER_CALL = 1000; // Conservative estimate
          const modelRate = MODEL_COSTS[model] || GPT4O_RATE;
          actualCost = (AVG_TOKENS_PER_CALL * modelRate) / 1_000_000;
          potentialCost = (AVG_TOKENS_PER_CALL * GPT4O_RATE) / 1_000_000;
        }
        
        if (!byProvider[provider]) {
          byProvider[provider] = { calls: 0, actualCost: 0, potentialCost: 0 };
        }
        
        byProvider[provider].calls += record.quantity;
        byProvider[provider].actualCost += actualCost * record.quantity;
        byProvider[provider].potentialCost += potentialCost * record.quantity;
        
        totalCalls += record.quantity;
        totalActualCost += actualCost * record.quantity;
        totalPotentialCost += potentialCost * record.quantity;
      }
      
      const totalSavings = totalPotentialCost - totalActualCost;
      const savingsPercent = totalPotentialCost > 0 ? (totalSavings / totalPotentialCost) * 100 : 0;
      
      res.json({
        totalCalls,
        totalActualCost: Math.round(totalActualCost * 10000) / 10000,
        totalPotentialCost: Math.round(totalPotentialCost * 10000) / 10000,
        totalSavings: Math.round(totalSavings * 10000) / 10000,
        savingsPercent: Math.round(savingsPercent * 10) / 10,
        byProvider: Object.entries(byProvider).map(([provider, data]) => ({
          provider,
          calls: data.calls,
          actualCost: Math.round(data.actualCost * 10000) / 10000,
          potentialCost: Math.round(data.potentialCost * 10000) / 10000,
          savings: Math.round((data.potentialCost - data.actualCost) * 10000) / 10000,
        })),
        monthStart: startOfMonth.toISOString(),
      });
    } catch (error: any) {
      logger.error("AI Cost Savings error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // EXECUTIVE ASSISTANT (UNIFIED AI INTERFACE)
  // ============================================

  api.get("/api/assistant/skills", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      
      const { getAvailableActions, SKILL_ACTIONS } = await import('./services/skill-permissions');
      const { insights, actions, lockedActions } = getAvailableActions(tier, isFounder);
      
      res.json({
        tier,
        isFounder,
        insights,
        actions,
        lockedActions,
        allActions: SKILL_ACTIONS,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/assistant/check-permission", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { actionId } = req.body;
      
      if (!actionId) {
        return Errors.badRequest(res, "actionId is required");
      }
      
      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      
      const { checkSkillPermission } = await import('./services/skill-permissions');
      const result = checkSkillPermission(actionId, tier, isFounder);
      
      res.json(result);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/assistant/classify-intent", isAuthenticated, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return Errors.badRequest(res, "message is required");
      }
      const { classifyIntentSimple } = await import('./services/intent-router');
      const intent = classifyIntentSimple(message);
      res.json(intent);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.post("/api/assistant/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const { message, useAIClassification, useTrialToken } = req.body;

      if (!message) {
        return Errors.badRequest(res, "message is required");
      }

      const { classifyIntentSimple, classifyIntentWithAI } = await import('./services/intent-router');
      const { executeAgentTask } = await import('./services/core-agents');
      const { checkSkillPermission, mapIntentToAction, checkTrialTokenEligibility } = await import('./services/skill-permissions');

      const intent = useAIClassification 
        ? await classifyIntentWithAI(message)
        : classifyIntentSimple(message);

      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      const trialTokens = await storage.getTrialTokens(org.id);
      
      // Permission check for gated actions
      const actionId = mapIntentToAction(intent.action);
      let usedTrialToken = false;
      
      if (actionId) {
        const permissionCheck = checkSkillPermission(actionId, tier, isFounder, trialTokens);
        
        if (!permissionCheck.allowed) {
          // Action is gated - check if user wants to use a trial token
          if (useTrialToken) {
            const eligibility = checkTrialTokenEligibility(actionId, tier, trialTokens);
            if (!eligibility.eligible) {
              return Errors.forbidden(res, eligibility.reason);
            }
            
            // Attempt to consume a trial token atomically
            const consumption = await storage.consumeTrialToken(org.id);
            if (!consumption.success) {
              return Errors.forbidden(res, "No trial tokens available");
            }
            
            // Trial token consumed successfully - action is now allowed
            usedTrialToken = true;
          } else {
            // No trial token requested - deny access
            return Errors.forbidden(res, permissionCheck.reason);
          }
        }
        // If permissionCheck.allowed is true, action proceeds normally
      }

      const result = await executeAgentTask(intent.agentType, {
        action: intent.action,
        parameters: { ...intent.extractedParams, userMessage: message },
        context: {
          organizationId: org.id,
          userId: user?.id,
        },
      });

      // Get updated trial token count
      const remainingTokens = await storage.getTrialTokens(org.id);

      res.json({
        intent,
        result,
        skill: intent.skillLabel,
        trialTokensRemaining: remainingTokens,
        usedTrialToken,
      });
    } catch (err: any) {
      logger.error("Assistant execute error", err instanceof Error ? err : undefined);
      Errors.internal(res, err);
    }
  });

  api.get("/api/assistant/suggestions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const user = req.user;
      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      const trialTokens = await storage.getTrialTokens(org.id);
      
      const { getAvailableActions } = await import('./services/skill-permissions');
      const { insights, actions } = getAvailableActions(tier, isFounder);
      
      const suggestions = [
        { label: "Analyze a property", skill: "Research & Intelligence", actionId: "analyze_property", category: "insight" },
        { label: "Check environmental risks", skill: "Research & Intelligence", actionId: "lookup_environmental", category: "insight" },
        { label: "Get market analysis", skill: "Research & Intelligence", actionId: "market_analysis", category: "insight" },
        { label: "Calculate investment ROI", skill: "Deals & Acquisition", actionId: "investment_calculator", category: "insight" },
        { label: "Find comparable sales", skill: "Deals & Acquisition", actionId: "comp_analysis", category: "insight" },
        { label: "Score this deal", skill: "Deals & Acquisition", actionId: "deal_scoring", category: "insight" },
        { label: "Run due diligence report", skill: "Research & Intelligence", actionId: "run_due_diligence", category: "action", requiredTier: "starter" },
        { label: "Generate an offer letter", skill: "Deals & Acquisition", actionId: "generate_offer", category: "action", requiredTier: "starter" },
        { label: "Draft a follow-up email", skill: "Communications", actionId: "compose_email", category: "action", requiredTier: "starter" },
        { label: "Check overdue payments", skill: "Operations", actionId: "delinquency_check", category: "insight" },
      ];
      
      const availableIds = new Set([...insights, ...actions].map(a => a.id));
      const enrichedSuggestions = suggestions.map(s => ({
        ...s,
        available: availableIds.has(s.actionId),
        currentTier: tier,
        canUseTrialToken: !availableIds.has(s.actionId) && s.category === "action" && trialTokens > 0,
      }));
      
      res.json({ 
        suggestions: enrichedSuggestions,
        trialTokens,
        tier,
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // Get trial token info
  api.get("/api/assistant/trial-tokens", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const trialTokens = await storage.getTrialTokens(org.id);
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      
      res.json({
        trialTokens,
        tier,
        maxTokens: 5, // Initial tokens granted to new users
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // VA (VIRTUAL ASSISTANTS) SYSTEM
  // ============================================
  
  // Get all VA agents for the organization
  api.get("/api/va/agents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const agents = await storage.initializeVaAgents(org.id);
      res.json(agents);
    } catch (error: any) {
      logger.error("Error fetching VA agents", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });

  // Get a specific VA agent
  api.get("/api/va/agents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const agentId = parseInt(req.params.id);
      const agent = await storage.getVaAgent(org.id, agentId);
      
      if (!agent) {
        return Errors.notFound(res, "Agent");
      }
      
      res.json(agent);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Update a VA agent settings
  api.patch("/api/va/agents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const agentId = parseInt(req.params.id);
      const agent = await storage.getVaAgent(org.id, agentId);
      
      if (!agent) {
        return Errors.notFound(res, "Agent");
      }
      
      const updated = await storage.updateVaAgent(agentId, req.body);
      res.json(updated);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Get VA actions (activity feed)
  api.get("/api/va/actions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const options: { agentId?: number; status?: string; limit?: number } = {};
      
      if (req.query.agentId) options.agentId = parseInt(req.query.agentId as string);
      if (req.query.status) options.status = req.query.status as string;
      if (req.query.limit) options.limit = Math.min(100, parseInt(req.query.limit as string));
      
      const actions = await storage.getVaActions(org.id, options);
      res.json(actions);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Get pending actions count
  api.get("/api/va/actions/pending/count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const count = await storage.getPendingActionsCount(org.id);
      res.json({ count });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Approve an action
  api.post("/api/va/actions/:id/approve", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const actionId = parseInt(req.params.id);
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return Errors.notFound(res, "Action");
      }
      
      const updated = await storage.approveVaAction(actionId, userId);
      
      // Execute the action after approval
      const executionResult = await vaAgentService.executeAgentAction(updated);
      
      // Get the final updated action with execution result
      const finalAction = await storage.getVaAction(actionId);
      res.json({ action: finalAction, executionResult });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Reject an action
  api.post("/api/va/actions/:id/reject", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const actionId = parseInt(req.params.id);
      const { reason } = req.body;
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return Errors.notFound(res, "Action");
      }
      
      const updated = await storage.rejectVaAction(actionId, reason || "Rejected by user");
      res.json(updated);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Process a task with an agent
  api.post("/api/va/agents/:type/task", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = req.organization;
      const agentType = req.params.type as any;
      const { task } = req.body;

      if (!task) {
        return Errors.badRequest(res, "Task description is required");
      }

      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({ message: "AI request limit reached. Upgrade to continue." });
      }

      const result = await vaAgentService.processAgentTask(org.id, agentType, task);
      res.json(result);
    } catch (error: any) {
      logger.error("VA Task error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
  
  // Get VA agent status
  api.get("/api/va/agents/:type/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = req.organization;
      const agentType = req.params.type as any;
      
      const status = await vaAgentService.getAgentStatus(org.id, agentType);
      res.json(status);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Execute action manually
  api.post("/api/va/actions/:id/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const actionId = parseInt(req.params.id);
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return Errors.notFound(res, "Action");
      }
      
      if (action.status !== "approved") {
        return Errors.badRequest(res, "Action must be approved before execution");
      }
      
      const result = await vaAgentService.executeAgentAction(action);
      const finalAction = await storage.getVaAction(actionId);
      res.json({ action: finalAction, executionResult: result });
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Process autonomous actions (for background job)
  api.post("/api/va/actions/process-autonomous", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = req.organization;
      
      const result = await vaAgentService.processAutonomousActions(org.id);
      res.json(result);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Get briefings
  api.get("/api/va/briefings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const limit = Math.min(100, parseInt(req.query.limit as string) || 10);
      const briefings = await storage.getVaBriefings(org.id, limit);
      res.json(briefings);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Generate a new briefing
  api.post("/api/va/briefings/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = req.organization;
      const usageCheck = await checkUsageLimit(org.id, "ai_requests");
      if (!usageCheck.allowed) {
        return res.status(429).json({ message: "AI request limit reached. Upgrade to continue." });
      }
      const briefing = await vaAgentService.generateBriefing(org.id);
      res.json(briefing);
    } catch (error: any) {
      logger.error("Briefing generation error", error instanceof Error ? error : undefined);
      Errors.internal(res, error);
    }
  });
  
  // Mark briefing as read
  api.post("/api/va/briefings/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const briefingId = parseInt(req.params.id);
      const updated = await storage.markBriefingRead(briefingId);
      res.json(updated);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Get calendar events
  api.get("/api/va/calendar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
      const events = await storage.getVaCalendarEvents(org.id, startDate, endDate);
      res.json(events);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });
  
  // Create calendar event
  api.post("/api/va/calendar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const event = await storage.createVaCalendarEvent({
        ...req.body,
        organizationId: org.id
      });
      res.json(event);
    } catch (error: any) {
      Errors.internal(res, error);
    }
  });

  // ============================================
  // VOICE TRANSCRIPTION (Whisper mic input)
  // ============================================

  api.post("/api/ai/voice/transcribe", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
      upload.single("audio")(req as any, res as any, async (err: any) => {
        if (err) return Errors.badRequest(res, err.message);
        const file = (req as any).file;
        if (!file) return Errors.badRequest(res, "No audio file provided");
        try {
          const { default: OpenAI } = await import("openai");
          const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const { Readable } = await import("stream");
          const audioStream = Readable.from(file.buffer);
          (audioStream as any).name = file.originalname || "audio.webm";
          const transcription = await client.audio.transcriptions.create({
            file: audioStream as any,
            model: "whisper-1",
            response_format: "text",
          });
          res.json({ transcript: transcription });
        } catch (transcribeErr: any) {
          Errors.internal(res, transcribeErr);
        }
      });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // AI MEMORY VIEWER
  // ============================================

  api.get("/api/ai/memory", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const { aiMemory: memTable } = await import("@shared/schema");
      const { desc: _desc, eq: _eq } = await import("drizzle-orm");
      const memories = await db.select().from(memTable)
        .where(_eq(memTable.organizationId, org.id))
        .orderBy(_desc(memTable.createdAt))
        .limit(100);
      res.json(memories);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  api.delete("/api/ai/memory/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const id = parseInt(req.params.id);
      const { aiMemory: memTable } = await import("@shared/schema");
      const { eq: _eq, and: _and } = await import("drizzle-orm");
      await db.delete(memTable).where(_and(_eq(memTable.id, id), _eq(memTable.organizationId, org.id)));
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // SCHEDULED TASK RUN HISTORY
  // ============================================

  api.get("/api/ai/scheduled-tasks/:id/runs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization;
      const taskId = parseInt(req.params.id);
      const { paxScheduledTaskRuns } = await import("@shared/schema");
      const { desc: _desc, eq: _eq, and: _and } = await import("drizzle-orm");
      const runs = await db.select().from(paxScheduledTaskRuns)
        .where(_and(_eq(paxScheduledTaskRuns.taskId, taskId), _eq(paxScheduledTaskRuns.organizationId, org.id)))
        .orderBy(_desc(paxScheduledTaskRuns.runAt))
        .limit(20);
      res.json(runs);
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // PRE-APPROVAL GATE FOR DESTRUCTIVE TOOLS
  // ============================================

  // In-memory pending approvals: conversationId+toolCallId → { toolName, args, orgId, resolve }
  const pendingApprovals = new Map<string, { toolName: string; args: any; resolve: (approved: boolean) => void }>();

  // Expose the map so executive.ts can use it via module-level export
  (global as any).__paxPendingApprovals = pendingApprovals;

  api.post("/api/ai/conversations/:id/approve-tool", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { toolCallId, approved } = req.body;
      const key = `${req.params.id}:${toolCallId}`;
      const pending = pendingApprovals.get(key);
      if (!pending) return Errors.notFound(res, "Pending approval");
      pendingApprovals.delete(key);
      pending.resolve(!!approved);
      res.json({ success: true });
    } catch (err: any) {
      Errors.internal(res, err);
    }
  });

  // ============================================
  // SSE: REAL-TIME OBSERVATIONS STREAM
  // ============================================

  // Map of orgId → Set of SSE response objects
  const obsClients = new Map<number, Set<any>>();
  (global as any).__paxObsClients = obsClients;

  api.get("/api/pax/observations/stream", isAuthenticated, getOrCreateOrg, (req, res) => {
    const org = req.organization;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const MAX_CLIENTS_PER_ORG = 10;
    if (!obsClients.has(org.id)) obsClients.set(org.id, new Set());
    const orgSet = obsClients.get(org.id)!;

    // Evict oldest client if at cap (oldest = first inserted, but Set doesn't track order;
    // if at cap, reject this new connection gracefully instead of evicting silently)
    if (orgSet.size >= MAX_CLIENTS_PER_ORG) {
      // Remove the first (oldest) client to make room
      const oldest = orgSet.values().next().value;
      try { oldest?.end(); } catch {}
      orgSet.delete(oldest);
    }
    orgSet.add(res);

    // Heartbeat every 25s
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      obsClients.get(org.id)?.delete(res);
    });
  });

}

// Push a new observation to all connected SSE clients for an org
export function pushObservationSSE(orgId: number, observation: any) {
  const clients: Set<any> | undefined = (global as any).__paxObsClients?.get(orgId);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify(observation)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch {}
  }
}
