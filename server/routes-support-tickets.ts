import type { Express } from "express";
import { storage, db } from "./storage";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { supportTickets, supportTicketMessages, activityLog } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { inArray, or } from "drizzle-orm";
import { knowledgeBaseArticles, sophieMemory, systemAlerts, organizations } from "@shared/schema";

export function registerSupportTicketRoutes(app: Express): void {
  const api = app;

  // SUPPORT TICKET ROUTES
  // ============================================
  
  // Create support ticket
  api.post("/api/support/tickets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      const user = req.user as any;
      
      const { subject, description, category, priority, pageContext, errorContext } = req.body;
      
      if (!subject || !description) {
        return res.status(400).json({ message: "Subject and description are required" });
      }
      
      const { createSupportTicket } = await import("./ai/supportAgent");
      const ticket = await createSupportTicket(org, user.id, subject, description, {
        category,
        priority,
        pageContext,
        errorContext,
        source: "in_app"
      });
      
      res.status(201).json(ticket);
    } catch (error: any) {
      console.error("[support] Error creating ticket:", error);
      res.status(500).json({ message: error.message || "Failed to create support ticket" });
    }
  });
  
  // Get user's support tickets
  api.get("/api/support/tickets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      const user = req.user as any;
      const { status } = req.query;
      
      const { getSupportTickets } = await import("./ai/supportAgent");
      const tickets = await getSupportTickets(org.id, {
        status: status as string,
        userId: user.id
      });
      
      res.json(tickets);
    } catch (error: any) {
      console.error("[support] Error fetching tickets:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tickets" });
    }
  });
  
  // Get ticket details with messages
  api.get("/api/support/tickets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { getTicketMessages } = await import("./ai/supportAgent");
      
      const [ticket] = await db.select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));
      
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      
      const messages = await getTicketMessages(ticketId);
      
      res.json({ ticket, messages });
    } catch (error: any) {
      console.error("[support] Error fetching ticket:", error);
      res.status(500).json({ message: error.message || "Failed to fetch ticket" });
    }
  });
  
  // Send message to support ticket (triggers AI response)
  api.post("/api/support/tickets/:id/messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      const user = req.user as any;
      const ticketId = parseInt(req.params.id);
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      // Add user message
      await db.insert(supportTicketMessages).values({
        ticketId,
        role: "user",
        content: message
      });
      
      // Process with Sophie
      const { processSupportChat } = await import("./ai/supportAgent");
      const response = await processSupportChat(message, org, user.id, ticketId);
      
      res.json(response);
    } catch (error: any) {
      console.error("[support] Error processing message:", error);
      res.status(500).json({ message: error.message || "Failed to process message" });
    }
  });
  
  // Close/resolve ticket
  api.post("/api/support/tickets/:id/close", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { resolution, rating, feedback } = req.body;
      
      await db.update(supportTickets)
        .set({
          status: "closed",
          resolution,
          resolvedAt: new Date(),
          customerRating: rating,
          customerFeedback: feedback,
          updatedAt: new Date()
        })
        .where(eq(supportTickets.id, ticketId));
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("[support] Error closing ticket:", error);
      res.status(500).json({ message: error.message || "Failed to close ticket" });
    }
  });
  
  // Human resolve ticket (triggers Sophie learning and knowledge base update)
  api.post("/api/support/tickets/:id/resolve-human", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const user = req.user as any;
      const { resolution, rating, feedback, addToKnowledgeBase } = req.body;
      
      if (!resolution) {
        return res.status(400).json({ message: "Resolution is required" });
      }
      
      const [ticket] = await db.select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));
      
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      
      // Mark ticket as resolved by human
      await db.update(supportTickets)
        .set({
          status: "resolved",
          resolution,
          resolutionType: "human",
          resolvedAt: new Date(),
          resolvedBy: user.id,
          customerRating: rating,
          customerFeedback: feedback,
          updatedAt: new Date()
        })
        .where(eq(supportTickets.id, ticketId));
      
      let learningResult = null;
      let knowledgeBaseArticle = null;
      
      // Trigger Sophie self-learning from this resolution
      try {
        const { sophieLearningService } = await import("./services/sophieLearning");
        learningResult = await sophieLearningService.learnFromHumanResolution(ticketId);
        console.log(`[support] Sophie learned from human resolution: ${JSON.stringify(learningResult)}`);
        
        // If cross-org learning was created and addToKnowledgeBase is true, create KB article
        if (addToKnowledgeBase && learningResult?.crossOrgLearning) {
          const learning = learningResult.crossOrgLearning;
          const slug = `auto-${ticket.category}-${ticketId}`.toLowerCase().replace(/\s+/g, '-');
          
          const existingArticle = await db.select()
            .from(knowledgeBaseArticles)
            .where(eq(knowledgeBaseArticles.slug, slug))
            .limit(1);
          
          if (existingArticle.length === 0) {
            const [article] = await db.insert(knowledgeBaseArticles).values({
              title: `How to resolve: ${learning.issuePattern?.substring(0, 100) || ticket.subject}`,
              slug,
              summary: learning.lessonLearned || `Resolution for ${ticket.category} issues`,
              content: `## Issue Pattern\n${learning.issuePattern}\n\n## Resolution Approach\n${learning.resolutionApproach}\n\n## Key Learnings\n${learning.lessonLearned || 'See resolution approach above.'}`,
              category: ticket.category || "general",
              tags: learning.applicableCategories || [],
              keywords: learning.keywords || [],
              relatedIssues: [ticket.subject],
              canAutoFix: learning.isAutoFixable || false,
              autoFixToolName: learning.autoFixAction,
              isPublished: true
            }).returning();
            
            knowledgeBaseArticle = article;
            console.log(`[support] Created KB article from human resolution: ${article.id}`);
          }
        }
        
        // Store in sophieMemory for future reference
        try {
          await db.insert(sophieMemory).values({
            organizationId: ticket.organizationId,
            userId: user.id,
            memoryType: "solution_tried",
            key: `human_resolution_${ticketId}`,
            value: {
              ticketId,
              subject: ticket.subject,
              category: ticket.category,
              resolution,
              resolvedBy: user.id,
              resolvedAt: new Date().toISOString(),
              learningId: learningResult?.learningEntry?.id,
              crossOrgLearningId: learningResult?.crossOrgLearning?.id
            } as any,
            importance: 9,
            sourceTicketId: ticketId
          });
        } catch (memErr) {
          console.error("[support] Error saving resolution memory:", memErr);
        }
      } catch (learnErr) {
        console.error("[support] Error in Sophie learning:", learnErr);
      }
      
      res.json({ 
        success: true, 
        message: "Ticket resolved. Sophie has learned from this resolution.",
        learning: learningResult ? {
          learned: learningResult.learned,
          crossOrgLearningId: learningResult.crossOrgLearning?.id
        } : null,
        knowledgeBaseArticle: knowledgeBaseArticle ? {
          id: knowledgeBaseArticle.id,
          slug: knowledgeBaseArticle.slug
        } : null
      });
    } catch (error: any) {
      console.error("[support] Error resolving ticket:", error);
      res.status(500).json({ message: error.message || "Failed to resolve ticket" });
    }
  });
  
  // Get knowledge base articles
  api.get("/api/support/knowledge-base", async (req, res) => {
    try {
      const { category, search } = req.query;
      
      let query = db.select().from(knowledgeBaseArticles)
        .where(eq(knowledgeBaseArticles.isPublished, true));
      
      const articles = await query.orderBy(desc(knowledgeBaseArticles.viewCount));
      
      let filtered = articles;
      if (category) {
        filtered = filtered.filter(a => a.category === category);
      }
      if (search) {
        const searchLower = (search as string).toLowerCase();
        filtered = filtered.filter(a => 
          a.title.toLowerCase().includes(searchLower) ||
          a.summary?.toLowerCase().includes(searchLower)
        );
      }
      
      res.json(filtered);
    } catch (error: any) {
      console.error("[support] Error fetching knowledge base:", error);
      res.status(500).json({ message: error.message || "Failed to fetch articles" });
    }
  });
  
  // Get single knowledge base article
  api.get("/api/support/knowledge-base/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      
      const [article] = await db.select()
        .from(knowledgeBaseArticles)
        .where(eq(knowledgeBaseArticles.slug, slug));
      
      if (!article) {
        return res.status(404).json({ message: "Article not found" });
      }
      
      // Increment view count
      await db.update(knowledgeBaseArticles)
        .set({ viewCount: (article.viewCount || 0) + 1 })
        .where(eq(knowledgeBaseArticles.id, article.id));
      
      res.json(article);
    } catch (error: any) {
      console.error("[support] Error fetching article:", error);
      res.status(500).json({ message: error.message || "Failed to fetch article" });
    }
  });
  
  // Mark article as helpful/not helpful
  api.post("/api/support/knowledge-base/:id/feedback", async (req, res) => {
    try {
      const articleId = parseInt(req.params.id);
      const { helpful } = req.body;
      
      const [article] = await db.select()
        .from(knowledgeBaseArticles)
        .where(eq(knowledgeBaseArticles.id, articleId));
      
      if (!article) {
        return res.status(404).json({ message: "Article not found" });
      }
      
      await db.update(knowledgeBaseArticles)
        .set({
          helpfulCount: helpful ? (article.helpfulCount || 0) + 1 : article.helpfulCount,
          notHelpfulCount: !helpful ? (article.notHelpfulCount || 0) + 1 : article.notHelpfulCount
        })
        .where(eq(knowledgeBaseArticles.id, articleId));
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("[support] Error recording feedback:", error);
      res.status(500).json({ message: error.message || "Failed to record feedback" });
    }
  });
  
  // Get active alerts for the user's organization (for proactive support)
  api.get("/api/support/alerts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      const { proactiveMonitor } = await import("./services/proactiveMonitor");
      
      const alerts = await proactiveMonitor.getActiveAlerts(org.id);
      
      res.json({
        alerts: alerts.map(a => ({
          id: a.id,
          type: a.type || a.alertType,
          severity: a.severity,
          title: a.title,
          message: a.message,
          createdAt: a.createdAt
        }))
      });
    } catch (error: any) {
      console.error("[support] Error fetching alerts:", error);
      res.json({ alerts: [] }); // Return empty array on error instead of failing
    }
  });

  // Founder endpoint: Get all support tickets across all orgs
  api.get("/api/founder/support/tickets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      
      if (!org.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      
      const tickets = await db.select()
        .from(supportTickets)
        .orderBy(desc(supportTickets.createdAt))
        .limit(100);
      
      res.json(tickets);
    } catch (error: any) {
      console.error("[support] Error fetching all tickets:", error);
      res.status(500).json({ message: error.message || "Failed to fetch tickets" });
    }
  });
  
  // Founder endpoint: Support analytics
  api.get("/api/founder/support/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      
      if (!org.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      
      const [totalTickets] = await db.select({ count: sql<number>`count(*)` })
        .from(supportTickets);
      
      const [openTickets] = await db.select({ count: sql<number>`count(*)` })
        .from(supportTickets)
        .where(eq(supportTickets.status, "open"));
      
      const [aiResolvedTickets] = await db.select({ count: sql<number>`count(*)` })
        .from(supportTickets)
        .where(eq(supportTickets.aiHandled, true));
      
      const [avgRating] = await db.select({ avg: sql<number>`avg(${supportTickets.customerRating})` })
        .from(supportTickets)
        .where(sql`${supportTickets.customerRating} IS NOT NULL`);
      
      const total = Number(totalTickets.count) || 0;
      const open = Number(openTickets.count) || 0;
      const aiResolved = Number(aiResolvedTickets.count) || 0;
      const rate = total > 0 ? Math.round((aiResolved / total) * 100) : 0;
      const avgRatingNum = avgRating.avg ? Math.round(Number(avgRating.avg) * 10) / 10 : null;
      
      res.json({
        totalTickets: total,
        openTickets: open,
        aiResolvedTickets: aiResolved,
        aiResolutionRate: rate,
        averageRating: avgRatingNum
      });
    } catch (error: any) {
      console.error("[support] Error fetching analytics:", error);
      res.status(500).json({ message: error.message || "Failed to fetch analytics" });
    }
  });

  // Founder endpoint: Get escalated tickets with full context
  api.get("/api/founder/escalations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      
      if (!org.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      
      // Get escalated tickets that are not resolved
      const escalatedTickets = await db.select()
        .from(supportTickets)
        .where(and(
          eq(supportTickets.resolutionType, "escalated"),
          sql`${supportTickets.status} != 'resolved'`
        ))
        .orderBy(desc(supportTickets.createdAt))
        .limit(50);
      
      // Enrich with additional context
      const enrichedTickets = await Promise.all(escalatedTickets.map(async (ticket) => {
        // Get organization name
        const [ticketOrg] = await db.select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, ticket.organizationId));
        
        // Get ticket messages
        const messages = await db.select()
          .from(supportTicketMessages)
          .where(eq(supportTicketMessages.ticketId, ticket.id))
          .orderBy(supportTicketMessages.createdAt);
        
        // Get Sophie's memory for this ticket (root cause analysis, solutions tried)
        const memories = await db.select()
          .from(sophieMemory)
          .where(and(
            eq(sophieMemory.organizationId, ticket.organizationId),
            or(
              eq(sophieMemory.sourceTicketId, ticket.id),
              eq(sophieMemory.memoryType, "solution_tried")
            )
          ))
          .orderBy(desc(sophieMemory.createdAt))
          .limit(10);
        
        // Get related system alerts for this org
        const relatedAlerts = await db.select()
          .from(systemAlerts)
          .where(and(
            eq(systemAlerts.organizationId, ticket.organizationId),
            sql`${systemAlerts.status} != 'resolved'`
          ))
          .orderBy(desc(systemAlerts.createdAt))
          .limit(5);
        
        // Extract root cause analysis from memories
        const rootCauseMemory = memories.find(m => 
          m.memoryType === "escalation" || 
          (m.value as any)?.rootCause
        );
        
        // Extract solutions that were tried
        const solutionsTried = memories
          .filter(m => m.memoryType === "solution_tried")
          .map(m => ({
            action: (m.value as any)?.summary || m.key,
            wasSuccessful: (m.value as any)?.wasSuccessful || false,
            timestamp: m.createdAt
          }));
        
        return {
          ...ticket,
          organizationName: ticketOrg?.name || "Unknown",
          messages,
          rootCauseAnalysis: rootCauseMemory ? {
            rootCause: (rootCauseMemory.value as any)?.summary || (rootCauseMemory.value as any)?.rootCause,
            confidence: (rootCauseMemory.value as any)?.confidence || null,
            affectedLayers: (rootCauseMemory.value as any)?.affectedLayers || [],
            suggestedFix: (rootCauseMemory.value as any)?.suggestedFix || null
          } : null,
          solutionsTried,
          relatedAlerts: relatedAlerts.map(a => ({
            id: a.id,
            title: a.title,
            severity: a.severity,
            message: a.message,
            createdAt: a.createdAt
          })),
          escalationBundle: ticket.escalationBundle || null
        };
      }));
      
      res.json(enrichedTickets);
    } catch (error: any) {
      console.error("[founder] Error fetching escalations:", error);
      res.status(500).json({ message: error.message || "Failed to fetch escalations" });
    }
  });

  // Founder endpoint: Generate a prompt for Replit Agent from a single escalation
  api.post("/api/founder/escalations/:id/generate-prompt", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      
      if (!org.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      
      const ticketId = parseInt(req.params.id);
      if (isNaN(ticketId)) {
        return res.status(400).json({ message: "Invalid ticket ID" });
      }
      
      // Get the ticket with full context
      const [ticket] = await db.select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));
      
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      
      // Get organization
      const [ticketOrg] = await db.select()
        .from(organizations)
        .where(eq(organizations.id, ticket.organizationId));
      
      // Get ticket messages
      const messages = await db.select()
        .from(supportTicketMessages)
        .where(eq(supportTicketMessages.ticketId, ticket.id))
        .orderBy(supportTicketMessages.createdAt);
      
      // Get Sophie's memory for this ticket
      const memories = await db.select()
        .from(sophieMemory)
        .where(and(
          eq(sophieMemory.organizationId, ticket.organizationId),
          or(
            eq(sophieMemory.sourceTicketId, ticket.id),
            eq(sophieMemory.memoryType, "solution_tried")
          )
        ))
        .orderBy(desc(sophieMemory.createdAt))
        .limit(10);
      
      // Extract root cause analysis
      const rootCauseMemory = memories.find(m => 
        m.memoryType === "escalation" || 
        (m.value as any)?.rootCause
      );
      
      // Extract solutions tried
      const solutionsTried = memories
        .filter(m => m.memoryType === "solution_tried")
        .map(m => `- ${(m.value as any)?.summary || m.key} (${(m.value as any)?.wasSuccessful ? 'partially worked' : 'did not resolve'})`)
        .join('\n');
      
      // Determine relevant files based on category
      const relevantFiles: string[] = [];
      const category = ticket.category?.toLowerCase() || '';
      if (category.includes('billing') || category.includes('payment') || category.includes('stripe')) {
        relevantFiles.push('server/stripeService.ts', 'server/webhookHandlers.ts', 'server/services/credits.ts');
      }
      if (category.includes('ai') || category.includes('sophie') || category.includes('support')) {
        relevantFiles.push('server/ai/supportAgent.ts', 'server/services/sophieLearning.ts', 'server/services/supportBrain.ts');
      }
      if (category.includes('lead') || category.includes('campaign') || category.includes('mail')) {
        relevantFiles.push('server/services/leadNurturer.ts', 'server/services/campaignOptimizer.ts', 'server/services/directMailService.ts');
      }
      if (category.includes('gis') || category.includes('map') || category.includes('parcel')) {
        relevantFiles.push('server/services/parcel.ts', 'server/services/propertyEnrichment.ts', 'server/services/gisValidation.ts');
      }
      if (category.includes('technical') || category.includes('bug') || relevantFiles.length === 0) {
        relevantFiles.push('server/routes.ts', 'client/src/App.tsx', 'shared/schema.ts');
      }
      
      // Build the prompt
      const prompt = `# Escalated Support Ticket - Needs Developer Attention

## Context
**Ticket ID:** #${ticket.id}
**Subject:** ${ticket.subject}
**Category:** ${ticket.category || 'General'}
**Priority:** ${ticket.priority || 'Normal'}
**Status:** ${ticket.status}
**Organization:** ${ticketOrg?.name || 'Unknown'} (ID: ${ticket.organizationId})
**User ID:** ${ticket.userId}
**Created:** ${ticket.createdAt ? new Date(ticket.createdAt).toISOString() : 'Unknown'}

## Issue Description
${ticket.description}

${ticket.errorContext ? `## Error Context
\`\`\`json
${JSON.stringify(ticket.errorContext, null, 2)}
\`\`\`` : ''}

${ticket.pageContext ? `## Page Context
User was on: ${ticket.pageContext}` : ''}

## Conversation History
${messages.map(m => `**${m.role === 'agent' ? `Sophie (${m.agentName || 'AI'})` : m.role === 'user' ? 'Customer' : 'System'}:** ${m.content}`).join('\n\n')}

## Root Cause Analysis (Sophie's Assessment)
${rootCauseMemory ? `
- **Identified Cause:** ${(rootCauseMemory.value as any)?.summary || (rootCauseMemory.value as any)?.rootCause || 'Analysis inconclusive'}
- **Confidence:** ${(rootCauseMemory.value as any)?.confidence ? `${Math.round((rootCauseMemory.value as any).confidence * 100)}%` : 'Unknown'}
- **Affected Layers:** ${((rootCauseMemory.value as any)?.affectedLayers || []).join(', ') || 'Unknown'}
- **Suggested Fix:** ${(rootCauseMemory.value as any)?.suggestedFix || 'Manual investigation required'}
` : 'Sophie was unable to determine a root cause with sufficient confidence.'}

## What Sophie Already Tried
${solutionsTried || '- No automated fixes were attempted'}

${ticket.escalationBundle ? `## Diagnostic Bundle (Auto-Gathered)
\`\`\`json
${JSON.stringify(ticket.escalationBundle, null, 2)}
\`\`\`` : ''}

## Suggested Approach
1. Review the error context and conversation history
2. Check the relevant files listed below for potential issues
3. Look for patterns in recent changes that might have caused this
4. Implement a fix and add tests to prevent regression
5. Update Sophie's knowledge base if this reveals a new issue pattern

## Relevant Files to Check
${relevantFiles.map(f => `- \`${f}\``).join('\n')}

## Success Criteria
- [ ] The user's reported issue is resolved
- [ ] Root cause is identified and documented
- [ ] Fix is tested and doesn't break other functionality
- [ ] If applicable, Sophie's knowledge is updated to handle similar cases
- [ ] User is notified of the resolution

## Notes
This ticket was escalated by Sophie (AI Support Agent) because it could not be resolved automatically. Please investigate and resolve manually.`;

      res.json({ prompt });
    } catch (error: any) {
      console.error("[founder] Error generating prompt:", error);
      res.status(500).json({ message: error.message || "Failed to generate prompt" });
    }
  });

  // Founder endpoint: Generate batch prompt for multiple escalations
  api.post("/api/founder/escalations/batch-prompt", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      
      if (!org.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      
      const { ticketIds } = req.body as { ticketIds: number[] };
      
      if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
        return res.status(400).json({ message: "ticketIds array is required" });
      }
      
      // Get all tickets
      const tickets = await db.select()
        .from(supportTickets)
        .where(inArray(supportTickets.id, ticketIds));
      
      if (tickets.length === 0) {
        return res.status(404).json({ message: "No tickets found" });
      }
      
      // Group tickets by category
      const byCategory: Record<string, typeof tickets> = {};
      for (const ticket of tickets) {
        const cat = ticket.category || 'general';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(ticket);
      }
      
      // Get org names
      const orgIds = [...new Set(tickets.map(t => t.organizationId))];
      const orgs = await db.select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(inArray(organizations.id, orgIds));
      const orgMap = new Map(orgs.map(o => [o.id, o.name]));
      
      // Build comprehensive prompt
      let prompt = `# Batch Escalation Review - ${tickets.length} Tickets Need Attention

## Overview
This batch contains ${tickets.length} escalated support tickets that Sophie (AI Support Agent) could not resolve automatically.

**Tickets by Category:**
${Object.entries(byCategory).map(([cat, tix]) => `- ${cat}: ${tix.length} ticket(s)`).join('\n')}

---

`;

      // Add each category section
      for (const [category, categoryTickets] of Object.entries(byCategory)) {
        prompt += `## Category: ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
        
        for (const ticket of categoryTickets) {
          prompt += `### Ticket #${ticket.id}: ${ticket.subject}
- **Priority:** ${ticket.priority || 'Normal'}
- **Organization:** ${orgMap.get(ticket.organizationId) || 'Unknown'}
- **Created:** ${ticket.createdAt ? new Date(ticket.createdAt).toISOString() : 'Unknown'}
- **Description:** ${ticket.description?.substring(0, 200)}${(ticket.description?.length || 0) > 200 ? '...' : ''}

`;
        }
      }
      
      prompt += `---

## Suggested Approach
1. Review tickets by category to identify common patterns
2. Prioritize by severity (urgent tickets first)
3. Check if multiple tickets point to the same underlying issue
4. Fix root causes rather than symptoms when possible
5. Update Sophie's training data to prevent similar escalations

## Common Files to Check
- \`server/routes.ts\` - API endpoints
- \`server/ai/supportAgent.ts\` - Sophie's support logic
- \`server/services/\` - Business logic services
- \`shared/schema.ts\` - Database schema

## Success Criteria
- [ ] All listed tickets are resolved
- [ ] Root causes are documented
- [ ] Related tickets are linked if they share a common cause
- [ ] Sophie's knowledge base is updated as needed
`;

      res.json({ prompt });
    } catch (error: any) {
      console.error("[founder] Error generating batch prompt:", error);
      res.status(500).json({ message: error.message || "Failed to generate batch prompt" });
    }
  });

  // Founder endpoint: Mark escalation as resolved
  api.post("/api/founder/escalations/:id/resolve", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      
      if (!org.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      
      const ticketId = parseInt(req.params.id);
      if (isNaN(ticketId)) {
        return res.status(400).json({ message: "Invalid ticket ID" });
      }
      
      const { resolution } = req.body as { resolution?: string };
      
      await db.update(supportTickets)
        .set({
          status: "resolved",
          resolution: resolution || "Manually resolved by founder",
          resolvedAt: new Date(),
          resolvedBy: "founder"
        })
        .where(eq(supportTickets.id, ticketId));
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("[founder] Error resolving escalation:", error);
      res.status(500).json({ message: error.message || "Failed to resolve escalation" });
    }
  });

  // ============================================
  // SOPHIE LEARNINGS ENDPOINTS
  // ============================================
  
  // Get Sophie's cross-org learnings (what Sophie has learned)
  api.get("/api/founder/sophie/learnings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      
      if (!org.isFounder) {
        return res.status(403).json({ message: "Founder access required" });
      }
      
      const { sophieLearningService } = await import("./services/sophieLearning");
      const learnings = await sophieLearningService.getAllLearnings();
      
      res.json(learnings);
    } catch (error: any) {
      console.error("[founder] Error fetching Sophie learnings:", error);
      res.status(500).json({ message: error.message || "Failed to fetch learnings" });
    }
  });
  
  // ============================================
  // ENHANCED BUG REPORTING
  // ============================================
  
  // Report a bug with full context capture
  api.post("/api/support/report-bug", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.org!;
      const user = req.user as any;
      
      const {
        title,
        description,
        pageUrl,
        browserInfo,
        consoleErrors,
        failedRequests,
        reproductionSteps,
        expectedBehavior,
        actualBehavior
      } = req.body;
      
      if (!title || !description) {
        return res.status(400).json({ message: "Title and description are required" });
      }
      
      let orgHealth = null;
      try {
        const { healthCheckService } = await import("./services/healthCheck");
        orgHealth = await healthCheckService.runHealthCheck(org.id);
      } catch (err) {
        console.error("[support] Error fetching org health for bug report:", err);
      }
      
      let recentErrors: any[] = [];
      try {
        const recentActivity = await db.select()
          .from(activityLog)
          .where(and(
            eq(activityLog.organizationId, org.id),
            gte(activityLog.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
          ))
          .orderBy(desc(activityLog.createdAt))
          .limit(20);
        
        recentErrors = recentActivity.filter(a => 
          a.action?.toLowerCase().includes('error') || 
          a.action?.toLowerCase().includes('fail')
        );
      } catch (err) {
        console.error("[support] Error fetching recent errors for bug report:", err);
      }
      
      const bugTicketData = {
        organizationId: org.id,
        userId: user.id,
        subject: `[BUG] ${title}`,
        description: `## Bug Report

**Description:** ${description}

**Page URL:** ${pageUrl || 'Not provided'}

**Reproduction Steps:**
${reproductionSteps || 'Not provided'}

**Expected Behavior:**
${expectedBehavior || 'Not provided'}

**Actual Behavior:**
${actualBehavior || 'Not provided'}

---
*This bug was reported through the in-app bug reporter.*`,
        category: "bug" as const,
        priority: "medium" as const,
        status: "open" as const,
        source: "bug_reporter" as const,
        pageContext: {
          url: pageUrl,
          browserInfo,
          timestamp: new Date().toISOString()
        },
        errorContext: {
          consoleErrors: consoleErrors || [],
          failedRequests: failedRequests || [],
          orgHealth,
          recentErrors: recentErrors.map(e => ({
            action: e.action,
            timestamp: e.createdAt
          }))
        }
      };
      
      const [ticket] = await db.insert(supportTickets)
        .values(bugTicketData)
        .returning();
      
      console.log(`[support] Bug report created: ticket ${ticket.id} for org ${org.id}`);
      
      res.json({
        success: true,
        ticketId: ticket.id,
        message: "Bug report submitted successfully. We'll look into it."
      });
    } catch (error: any) {
      console.error("[support] Error creating bug report:", error);
      res.status(500).json({ message: error.message || "Failed to submit bug report" });
    }
  });

}
