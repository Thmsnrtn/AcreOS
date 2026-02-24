import type { Express } from "express";
import { z } from "zod";
import { insertAgentConfigSchema, insertAgentTaskSchema } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { checkUsageLimit } from "./services/usageLimits";
import { usageMeteringService, creditService } from "./services/credits";
import { processChat, processChatStream, agentProfiles, getOrCreateConversation } from "./ai/executive";
import { storage, db } from "./storage";
import { eq, sql, and } from "drizzle-orm";
import type { SubscriptionTier } from "./services/usageLimits";

export function registerAIRoutes(app: Express): void {
  const api = app;

  // AI AGENTS
  // ============================================
  
  api.get("/api/agents/configs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const configs = await storage.getAgentConfigs(org.id);
    res.json(configs);
  });
  
  api.post("/api/agents/configs", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const input = insertAgentConfigSchema.parse({ ...req.body, organizationId: org.id });
      const config = await storage.createAgentConfig(input);
      res.status(201).json(config);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });
  
  api.get("/api/agents/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const tasks = await storage.getAgentTasks(org.id);
    res.json(tasks);
  });
  
  api.post("/api/agents/tasks", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
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
        return res.status(400).json({ message: err.errors[0].message });
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
      res.status(500).json({ message: error.message || "Failed to fetch agent statuses" });
    }
  });
  
  // ============================================
  // CONVERSATIONS (Buyer Communication)
  // ============================================
  
  api.get("/api/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
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
    const org = (req as any).organization;
    const conversations = await storage.getAiConversations(org.id);
    res.json(conversations);
  });
  
  // Get a specific conversation with messages
  api.get("/api/ai/conversations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const conversationId = parseInt(req.params.id);
    const conversation = await storage.getAiConversation(conversationId);
    
    if (!conversation || conversation.organizationId !== org.id) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    
    const messages = await storage.getAiMessages(conversationId);
    res.json({ conversation, messages });
  });
  
  // Create new conversation
  api.post("/api/ai/conversations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
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
  api.post("/api/ai/chat", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { message, conversationId, agentRole } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
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
        agentRole
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
      console.error("AI Chat error:", error);
      res.status(500).json({ message: error.message || "AI processing failed" });
    }
  });
  
  // Send a message (streaming)
  api.post("/api/ai/chat/stream", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = req.user as any;
      const userId = user.claims?.sub || user.id;
      const { message, conversationId, agentRole, files } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
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
        files
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
      console.error("AI Stream error:", error);
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  });
  
  // Delete a conversation
  api.delete("/api/ai/conversations/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    const org = (req as any).organization;
    const conversationId = parseInt(req.params.id);
    const conversation = await storage.getAiConversation(conversationId);
    
    if (!conversation || conversation.organizationId !== org.id) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    
    await storage.deleteAiConversation(conversationId);
    res.json({ success: true });
  });

  // GET /api/ai/cost-savings - Get AI cost savings summary
  api.get("/api/ai/cost-savings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      
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
      console.error("AI Cost Savings error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch AI cost savings" });
    }
  });

  // ============================================
  // EXECUTIVE ASSISTANT (UNIFIED AI INTERFACE)
  // ============================================

  api.get("/api/assistant/skills", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
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
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/assistant/check-permission", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { actionId } = req.body;
      
      if (!actionId) {
        return res.status(400).json({ message: "actionId is required" });
      }
      
      const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      
      const { checkSkillPermission } = await import('./services/skill-permissions');
      const result = checkSkillPermission(actionId, tier, isFounder);
      
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/assistant/classify-intent", isAuthenticated, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ message: "message is required" });
      }
      const { classifyIntentSimple } = await import('./services/intent-router');
      const intent = classifyIntentSimple(message);
      res.json(intent);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  api.post("/api/assistant/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
      const { message, useAIClassification, useTrialToken } = req.body;

      if (!message) {
        return res.status(400).json({ message: "message is required" });
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
              return res.status(403).json({
                error: "trial_token_ineligible",
                message: eligibility.reason,
                intent,
              });
            }
            
            // Attempt to consume a trial token atomically
            const consumption = await storage.consumeTrialToken(org.id);
            if (!consumption.success) {
              return res.status(403).json({
                error: "trial_token_failed",
                message: "No trial tokens available",
                intent,
              });
            }
            
            // Trial token consumed successfully - action is now allowed
            usedTrialToken = true;
          } else {
            // No trial token requested - deny access
            return res.status(403).json({
              error: "upgrade_required",
              message: permissionCheck.reason,
              requiredTier: permissionCheck.requiredTier,
              currentTier: permissionCheck.currentTier,
              upgradeMessage: permissionCheck.upgradeMessage,
              canUseTrialToken: permissionCheck.canUseTrialToken,
              trialTokensRemaining: permissionCheck.trialTokensRemaining,
              intent,
            });
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
      console.error("Assistant execute error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  api.get("/api/assistant/suggestions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const user = (req as any).user;
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
      res.status(500).json({ message: err.message });
    }
  });

  // Get trial token info
  api.get("/api/assistant/trial-tokens", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const trialTokens = await storage.getTrialTokens(org.id);
      const tier = (org?.subscriptionTier || 'free') as SubscriptionTier;
      
      res.json({
        trialTokens,
        tier,
        maxTokens: 5, // Initial tokens granted to new users
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ============================================
  // VA (VIRTUAL ASSISTANTS) SYSTEM
  // ============================================
  
  // Get all VA agents for the organization
  api.get("/api/va/agents", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agents = await storage.initializeVaAgents(org.id);
      res.json(agents);
    } catch (error: any) {
      console.error("Error fetching VA agents:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get a specific VA agent
  api.get("/api/va/agents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agentId = parseInt(req.params.id);
      const agent = await storage.getVaAgent(org.id, agentId);
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }
      
      res.json(agent);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Update a VA agent settings
  api.patch("/api/va/agents/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const agentId = parseInt(req.params.id);
      const agent = await storage.getVaAgent(org.id, agentId);
      
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }
      
      const updated = await storage.updateVaAgent(agentId, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get VA actions (activity feed)
  api.get("/api/va/actions", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const options: { agentId?: number; status?: string; limit?: number } = {};
      
      if (req.query.agentId) options.agentId = parseInt(req.query.agentId as string);
      if (req.query.status) options.status = req.query.status as string;
      if (req.query.limit) options.limit = parseInt(req.query.limit as string);
      
      const actions = await storage.getVaActions(org.id, options);
      res.json(actions);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get pending actions count
  api.get("/api/va/actions/pending/count", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const count = await storage.getPendingActionsCount(org.id);
      res.json({ count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
        return res.status(404).json({ message: "Action not found" });
      }
      
      const updated = await storage.approveVaAction(actionId, userId);
      
      // Execute the action after approval
      const executionResult = await vaAgentService.executeAgentAction(updated);
      
      // Get the final updated action with execution result
      const finalAction = await storage.getVaAction(actionId);
      res.json({ action: finalAction, executionResult });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Reject an action
  api.post("/api/va/actions/:id/reject", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const actionId = parseInt(req.params.id);
      const { reason } = req.body;
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return res.status(404).json({ message: "Action not found" });
      }
      
      const updated = await storage.rejectVaAction(actionId, reason || "Rejected by user");
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Process a task with an agent
  api.post("/api/va/agents/:type/task", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const agentType = req.params.type as any;
      const { task } = req.body;
      
      if (!task) {
        return res.status(400).json({ message: "Task description is required" });
      }
      
      const result = await vaAgentService.processAgentTask(org.id, agentType, task);
      res.json(result);
    } catch (error: any) {
      console.error("VA Task error:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get VA agent status
  api.get("/api/va/agents/:type/status", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const agentType = req.params.type as any;
      
      const status = await vaAgentService.getAgentStatus(org.id, agentType);
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Execute action manually
  api.post("/api/va/actions/:id/execute", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const actionId = parseInt(req.params.id);
      
      const action = await storage.getVaAction(actionId);
      if (!action) {
        return res.status(404).json({ message: "Action not found" });
      }
      
      if (action.status !== "approved") {
        return res.status(400).json({ message: "Action must be approved before execution" });
      }
      
      const result = await vaAgentService.executeAgentAction(action);
      const finalAction = await storage.getVaAction(actionId);
      res.json({ action: finalAction, executionResult: result });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Process autonomous actions (for background job)
  api.post("/api/va/actions/process-autonomous", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      
      const result = await vaAgentService.processAutonomousActions(org.id);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get briefings
  api.get("/api/va/briefings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const limit = parseInt(req.query.limit as string) || 10;
      const briefings = await storage.getVaBriefings(org.id, limit);
      res.json(briefings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Generate a new briefing
  api.post("/api/va/briefings/generate", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const { vaAgentService } = await import("./ai/vaService");
      const org = (req as any).organization;
      const briefing = await vaAgentService.generateBriefing(org.id);
      res.json(briefing);
    } catch (error: any) {
      console.error("Briefing generation error:", error);
      res.status(500).json({ message: error.message });
    }
  });
  
  // Mark briefing as read
  api.post("/api/va/briefings/:id/read", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const briefingId = parseInt(req.params.id);
      const updated = await storage.markBriefingRead(briefingId);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Get calendar events
  api.get("/api/va/calendar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate = req.query.end ? new Date(req.query.end as string) : undefined;
      const events = await storage.getVaCalendarEvents(org.id, startDate, endDate);
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Create calendar event
  api.post("/api/va/calendar", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = (req as any).organization;
      const event = await storage.createVaCalendarEvent({
        ...req.body,
        organizationId: org.id
      });
      res.json(event);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  

}
