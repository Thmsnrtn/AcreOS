import type { Express } from "express";
import { storage, db } from "./storage";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { supportTickets, supportTicketMessages, activityLog } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { inArray, or } from "drizzle-orm";
import { knowledgeBaseArticles, paxMemory, systemAlerts, organizations } from "@shared/schema";
import { logger } from "./utils/logger";
import { Errors } from "./utils/errors";
import { costClass } from "./utils/costClass";
import { notifyFounderOfTicket } from "./services/supportNotifications";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization, getUserId } from "./types/request";

export function registerSupportTicketRoutes(app: Express): void {
  const api = app;

  // SUPPORT TICKET ROUTES
  // ============================================
  
  // Create support ticket
  api.post("/api/support/tickets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const user = req.user as any;
      
      const { subject, description, category, priority, pageContext, errorContext } = req.body;
      
      if (!subject || !description) {
        return Errors.badRequest(res, "Subject and description are required");
      }
      
      const { createSupportTicket } = await import("./ai/supportAgent");
      const ticket = await createSupportTicket(org, user.id, subject, description, {
        category,
        priority,
        pageContext,
        errorContext,
        source: "in_app"
      });

      // RAFE (Tahoe Wave-2): first-response SLA is only possible if a new ticket
      // actually reaches a human. Pax may auto-resolve, but the founder must be
      // able to SEE the inbound in real time. Drop a founder-visible system_alert
      // (the same surface /founder/escalations + the founder pulse already read),
      // so a brand-new ticket is never silent. Non-fatal — never block the create.
      try {
        await notifyFounderOfTicket({
          orgId: org.id,
          orgName: org.name,
          ticketId: ticket.id,
          subject,
          priority: priority || "normal",
          reason: "created",
        });
      } catch (notifyErr) {
        logger.warn("[support] ticket-created founder notification failed", { ticketId: ticket.id, err: String(notifyErr) });
      }

      res.status(201).json(ticket);
    } catch (error: any) {
      logger.error("[support] Error creating ticket", error);
      Errors.internal(res, error);
    }
  });
  
  // Get user's support tickets
  api.get("/api/support/tickets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const user = req.user as any;
      const { status } = req.query;
      
      const { getSupportTickets } = await import("./ai/supportAgent");
      const tickets = await getSupportTickets(org.id, {
        status: status as string,
        userId: user.id
      });
      
      res.json(tickets);
    } catch (error: any) {
      logger.error("[support] Error fetching tickets", error);
      Errors.internal(res, error);
    }
  });
  
  // Get ticket details with messages
  api.get("/api/support/tickets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const ticketId = parseInt(req.params.id);
      const { getTicketMessages } = await import("./ai/supportAgent");

      const [ticket] = await db.select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));

      if (!ticket) {
        return Errors.notFound(res, "Ticket");
      }
      // Org-scope guard: a customer may only read their own org's tickets.
      if (ticket.organizationId !== org.id && !org.isFounder) {
        return Errors.forbidden(res);
      }

      const messages = await getTicketMessages(ticketId);

      // SLA metrics (wire-for-real: measurementLoops.computeSla). First-reply =
      // the first agent message; resolution = resolvedAt. Best-effort.
      let sla = null;
      try {
        const { computeSla } = await import("./services/autopilot/measurementLoops");
        const firstAgentMsg = (messages as Array<{ role?: string; createdAt?: Date | string | null }>)
          .find((m) => m.role === "agent");
        sla = computeSla({
          createdAt: ticket.createdAt ?? new Date(),
          firstReplyAt: firstAgentMsg?.createdAt ? new Date(firstAgentMsg.createdAt) : null,
          resolvedAt: ticket.resolvedAt ?? null,
          now: new Date(),
        });
      } catch { /* SLA is best-effort metadata */ }

      res.json({ ticket, messages, sla });
    } catch (error: any) {
      logger.error("[support] Error fetching ticket", error);
      Errors.internal(res, error);
    }
  });
  
  // Send message to support ticket (triggers AI response)
  api.post("/api/support/tickets/:id/messages", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const user = req.user as any;
      const ticketId = parseInt(req.params.id);
      const { message } = req.body;
      
      if (!message) {
        return Errors.badRequest(res, "Message is required");
      }

      // Org-scope guard: a customer may only post to their own org's tickets.
      // Must run BEFORE any grading/mutation below so we never touch a
      // sibling org's ticket. 404 when the ticket doesn't exist at all.
      const [ticketForGuard] = await db
        .select({ organizationId: supportTickets.organizationId })
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));
      if (!ticketForGuard) {
        return Errors.notFound(res, "Ticket");
      }
      if (ticketForGuard.organizationId !== org.id && !org.isFounder) {
        return Errors.forbidden(res);
      }

      // Andrei — calibration loop. A customer posting again on an auto-resolved
      // ticket is the strongest signal the auto-resolve DIDN'T land: it's a
      // reopen. Grade it BEFORE we re-engage Pax so the outcome label flips to
      // 'reopened' (the Brier-stream negative the calibration job needs). The
      // grader no-ops on anything that wasn't a Pax auto-resolve. Fail-soft.
      try {
        const [prior] = await db
          .select({
            status: supportTickets.status,
            aiHandled: supportTickets.aiHandled,
            resolvedBy: supportTickets.resolvedBy,
          })
          .from(supportTickets)
          .where(eq(supportTickets.id, ticketId));
        if (
          prior &&
          prior.aiHandled === true &&
          prior.resolvedBy === "pax" &&
          (prior.status === "resolved" || prior.status === "closed")
        ) {
          const { gradeAutoResolvedTicket } = await import(
            "./services/andrei/supportResolverCalibration"
          );
          await gradeAutoResolvedTicket(ticketId, "reopened");
        }
      } catch (gradeErr) {
        logger.warn("[support] auto-resolve reopen grading failed (non-fatal)", {
          ticketId,
          err: String(gradeErr),
        });
      }

      // Add user message
      await db.insert(supportTicketMessages).values({
        ticketId,
        role: "user",
        content: message
      });

      // Process with Pax
      const { processSupportChat } = await import("./ai/supportAgent");
      const response = await processSupportChat(message, org, user.id, ticketId);
      
      res.json(response);
    } catch (error: any) {
      logger.error("[support] Error processing message", error);
      Errors.internal(res, error);
    }
  });

  // Tahoe E4 — Pax-Support resolution variant.
  // Runs the ticket end-to-end through the specialized resolution agent
  // (server/ai/paxSupportResolver.ts) and applies the confidence gate:
  //   confidence >= threshold → auto-resolve (reply persisted as Pax, ticket
  //                             marked resolved/auto)
  //   confidence <  threshold → escalate to a human (after an optional Opus
  //                             second-opinion attempt).
  // SAME Pax identity to the customer — never an internal codename.
  api.post(
    "/api/support/tickets/:id/pax-resolve",
    isAuthenticated,
    getOrCreateOrg,
    async (req, res) => {
      try {
        const org = getOrganization(req as AuthenticatedRequest);
        const ticketId = parseInt(req.params.id, 10);
        if (Number.isNaN(ticketId)) {
          return Errors.badRequest(res, "Invalid ticket id");
        }

        const [ticket] = await db
          .select()
          .from(supportTickets)
          .where(eq(supportTickets.id, ticketId));
        if (!ticket) {
          return Errors.notFound(res, "Ticket");
        }
        // Org-scope guard: a customer may only resolve their own org's tickets.
        if (ticket.organizationId !== org.id && !org.isFounder) {
          return Errors.forbidden(res);
        }

        const { resolveTicketWithPax } = await import("./ai/paxSupportResolver");
        // The person asking is not the person the ticket is about. Both go to
        // the permission ladder, which takes the intersection — this route
        // authorises the ORGANIZATION and nothing else, and `/api/support/` is
        // on VIEWER_WRITE_EXEMPT_PREFIXES, so without this a read-only viewer
        // could resolve a ticket the owner filed and reach the billing,
        // settings and job-queue tools through the owner's scopes.
        const result = await resolveTicketWithPax(ticketId, org, {
          requestedByUserId: getUserId(req as AuthenticatedRequest),
        });

        res.json({
          autoResolved: result.autoResolved,
          escalated: result.escalated,
          confidence: result.confidence,
          resolutionType: result.resolutionType,
          response: result.response,
          toolsUsed: result.toolsUsed,
          geniusResolved: result.geniusResolved ?? false,
        });
      } catch (error: any) {
        logger.error("[support] Error running Pax resolution", error);
        Errors.internal(res, error);
      }
    },
  );

  // Close/resolve ticket
  api.post("/api/support/tickets/:id/close", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      const ticketId = parseInt(req.params.id);
      const { resolution, rating, feedback } = req.body;

      // Org-scope guard: a customer may only close their own org's tickets.
      const [ticket] = await db.select({ organizationId: supportTickets.organizationId })
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));
      if (!ticket) {
        return Errors.notFound(res, "Ticket");
      }
      if (ticket.organizationId !== org.id && !org.isFounder) {
        return Errors.forbidden(res);
      }

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

      // Andrei — calibration loop. A low CSAT (≤2★ of 5) on a Pax auto-resolved
      // ticket labels that auto-resolve a miss: outcome → 'csat_negative' (a
      // Brier-stream negative). The grader no-ops if this ticket wasn't a Pax
      // auto-resolve. Fail-soft — never block the close.
      try {
        const ratingNum = typeof rating === "number" ? rating : Number(rating);
        if (Number.isFinite(ratingNum) && ratingNum > 0 && ratingNum <= 2) {
          const { gradeAutoResolvedTicket } = await import(
            "./services/andrei/supportResolverCalibration"
          );
          await gradeAutoResolvedTicket(ticketId, "csat_negative");
        }
      } catch (gradeErr) {
        logger.warn("[support] auto-resolve CSAT grading failed (non-fatal)", {
          ticketId,
          err: String(gradeErr),
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      logger.error("[support] Error closing ticket", error);
      Errors.internal(res, error);
    }
  });
  
  // Human resolve ticket (triggers Pax learning and knowledge base update).
  //
  // Rafe / Tahoe E3 Sub-2 (2026-06-06): the `publishable` flag (preferred
  // name; `addToKnowledgeBase` retained as legacy alias) now routes the
  // generated KB article through the *draft queue* (is_draft=true,
  // draft_status='pending_review') instead of publishing live. A
  // founder/admin reviews drafts at /founder/support/kb-drafts and clicks
  // Publish to flip is_published=true. Sanitization (redactPII) runs on
  // the conversation summary before persisting the draft.
  api.post("/api/support/tickets/:id/resolve-human", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const org = req.organization;
      const user = req.user as any;
      const { resolution, rating, feedback, addToKnowledgeBase, publishable } = req.body;
      // Accept either name; publishable wins when both present.
      const shouldCreateDraft = publishable === true || addToKnowledgeBase === true;
      
      if (!resolution) {
        return Errors.badRequest(res, "Resolution is required");
      }
      
      const [ticket] = await db.select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));
      
      if (!ticket) {
        return Errors.notFound(res, "Ticket");
      }
      // Org-scope guard: a customer may only resolve their own org's tickets.
      // THIS LINE WAS MISSING while the four sibling handlers in this file (the
      // read at :103, the update at :153, and :235/:272) all performed it — so
      // this one route let any authenticated user write a resolution onto another
      // tenant's ticket and then feed that tenant's text into Pax's learning
      // corpus. Found by the 2026-08-20 rule-2 audit; see ledger 49.
      if (ticket.organizationId !== org.id && !org.isFounder) {
        return Errors.forbidden(res);
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
      
      // Trigger Pax self-learning from this resolution
      try {
        const { paxLearningService } = await import("./services/paxLearning");
        learningResult = await paxLearningService.learnFromHumanResolution(org.id, ticketId);
        logger.info(`[support] Pax learned from human resolution: ${JSON.stringify(learningResult)}`);
        
        // Tahoe E3 Sub-2 — if the resolver marked the resolution as
        // publishable, persist a *draft* (is_draft=true, is_published=false,
        // draft_status='pending_review') instead of going live. Founder
        // reviews at /founder/support/kb-drafts and clicks Publish.
        if (shouldCreateDraft && learningResult?.crossOrgLearning) {
          const learning = learningResult.crossOrgLearning;
          const slug = `draft-${ticket.category}-${ticketId}`.toLowerCase().replace(/\s+/g, '-');

          const existingArticle = await db.select()
            .from(knowledgeBaseArticles)
            .where(eq(knowledgeBaseArticles.slug, slug))
            .limit(1);

          if (existingArticle.length === 0) {
            // Sanitize ticket-derived text through redactPII before
            // persisting. The conversation summary may contain customer
            // email/phone; the redactor (server/utils/logger.ts) scrubs
            // those patterns so the draft never carries raw PII into the
            // KB review queue.
            const { redactPII } = await import("./utils/logger");
            const safeSubject = redactPII(ticket.subject || "");
            const safePattern = redactPII(learning.issuePattern || "");
            const safeApproach = redactPII(learning.resolutionApproach || "");
            const safeLesson = redactPII(learning.lessonLearned || "");
            const safeResolution = redactPII(resolution || "");

            const [article] = await db.insert(knowledgeBaseArticles).values({
              title: `How to resolve: ${safePattern.substring(0, 100) || safeSubject}`,
              slug,
              summary: safeLesson || `Resolution for ${ticket.category} issues`,
              content: `## Issue Pattern\n${safePattern}\n\n## Resolution Approach\n${safeApproach}\n\n## Steps That Worked\n${safeResolution}\n\n## Key Learnings\n${safeLesson || 'See resolution approach above.'}`,
              category: ticket.category || "general",
              tags: learning.applicableCategories || [],
              keywords: learning.keywords || [],
              relatedIssues: [safeSubject],
              canAutoFix: learning.isAutoFixable || false,
              autoFixToolName: learning.autoFixAction,
              // DRAFT — NOT live until founder/admin publishes.
              isPublished: false,
              isDraft: true,
              draftStatus: "pending_review",
              sourceTicketId: ticketId,
            }).returning();

            knowledgeBaseArticle = article;
            logger.info(`[support] Created KB draft from human resolution: ${article.id} (ticket=${ticketId})`);
          }
        }
        
        // Store in paxMemory for future reference
        try {
          await db.insert(paxMemory).values({
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
          logger.error("[support] Error saving resolution memory", undefined, { metadata: { detail: memErr } });
        }
      } catch (learnErr) {
        logger.error("[support] Error in Pax learning", undefined, { metadata: { detail: learnErr } });
      }
      
      res.json({ 
        success: true, 
        message: "Ticket resolved. Pax has learned from this resolution.",
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
      logger.error("[support] Error resolving ticket", error);
      Errors.internal(res, error);
    }
  });
  
  // Get knowledge base articles
  api.get("/api/support/knowledge-base", async (req, res) => {
    try {
      const { category, search } = req.query;
      
      // Tahoe E3 Sub-2 — drafts must not surface in the customer-facing
      // /api/support/knowledge-base read; explicit AND with isDraft=false.
      let query = db.select().from(knowledgeBaseArticles)
        .where(and(
          eq(knowledgeBaseArticles.isPublished, true),
          or(eq(knowledgeBaseArticles.isDraft, false), sql`${knowledgeBaseArticles.isDraft} IS NULL`),
        ));

      const articles = await query.orderBy(desc(knowledgeBaseArticles.viewCount)).limit(500);
      
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
      logger.error("[support] Error fetching knowledge base", error);
      Errors.internal(res, error);
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
        return Errors.notFound(res, "Article");
      }
      
      // Increment view count
      await db.update(knowledgeBaseArticles)
        .set({ viewCount: (article.viewCount || 0) + 1 })
        .where(eq(knowledgeBaseArticles.id, article.id));
      
      res.json(article);
    } catch (error: any) {
      logger.error("[support] Error fetching article", error);
      Errors.internal(res, error);
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
        return Errors.notFound(res, "Article");
      }
      
      await db.update(knowledgeBaseArticles)
        .set({
          helpfulCount: helpful ? (article.helpfulCount || 0) + 1 : article.helpfulCount,
          notHelpfulCount: !helpful ? (article.notHelpfulCount || 0) + 1 : article.notHelpfulCount
        })
        .where(eq(knowledgeBaseArticles.id, articleId));
      
      res.json({ success: true });
    } catch (error: any) {
      logger.error("[support] Error recording feedback", error);
      Errors.internal(res, error);
    }
  });
  
  // Get active alerts for the user's organization (for proactive support)
  api.get("/api/support/alerts", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
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
      logger.error("[support] Error fetching alerts", error);
      res.json({ alerts: [] }); // Return empty array on error instead of failing
    }
  });

  // Founder endpoint: Get all support tickets across all orgs
  api.get("/api/founder/support/tickets", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
      }
      
      const tickets = await db.select()
        .from(supportTickets)
        .orderBy(desc(supportTickets.createdAt))
        .limit(100);
      
      res.json(tickets);
    } catch (error: any) {
      logger.error("[support] Error fetching all tickets", error);
      Errors.internal(res, error);
    }
  });
  
  // Founder endpoint: Support analytics
  api.get("/api/founder/support/analytics", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
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
      logger.error("[support] Error fetching analytics", error);
      Errors.internal(res, error);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // RAFE — Tahoe E3 Sub-2: KB drafts review queue (founder-only).
  // ─────────────────────────────────────────────────────────────────

  // List pending KB drafts. Stagger-friendly shape: array of articles
  // with the source ticket joined in summary form. costClass: low —
  // single index hit on (draft_status, created_at).
  api.get("/api/founder/support/kb-drafts", isAuthenticated, getOrCreateOrg, costClass("low"), async (req, res) => {
    try {
      const org = req.organization!;
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
      }

      const drafts = await db.select({
        id: knowledgeBaseArticles.id,
        title: knowledgeBaseArticles.title,
        slug: knowledgeBaseArticles.slug,
        summary: knowledgeBaseArticles.summary,
        content: knowledgeBaseArticles.content,
        category: knowledgeBaseArticles.category,
        sourceTicketId: knowledgeBaseArticles.sourceTicketId,
        createdAt: knowledgeBaseArticles.createdAt,
      })
        .from(knowledgeBaseArticles)
        .where(eq(knowledgeBaseArticles.draftStatus, "pending_review"))
        .orderBy(desc(knowledgeBaseArticles.createdAt))
        .limit(100);

      res.json({ drafts });
    } catch (error: any) {
      logger.error("[support] Error fetching KB drafts", error);
      Errors.internal(res, error);
    }
  });

  // Publish a KB draft — flips isPublished=true, isDraft=false,
  // draft_status='published'. The article becomes visible in
  // /api/support/knowledge-base on the next read.
  api.post("/api/founder/support/kb-drafts/:id/publish", isAuthenticated, getOrCreateOrg, costClass("low"), async (req, res) => {
    try {
      const org = req.organization!;
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
      }

      const articleId = parseInt(req.params.id);
      if (Number.isNaN(articleId)) {
        return Errors.badRequest(res, "Invalid article id");
      }

      const [existing] = await db.select()
        .from(knowledgeBaseArticles)
        .where(eq(knowledgeBaseArticles.id, articleId));

      if (!existing) {
        return Errors.notFound(res, "Article");
      }
      if (existing.draftStatus !== "pending_review") {
        return Errors.badRequest(res, "Article is not a pending draft");
      }

      await db.update(knowledgeBaseArticles)
        .set({
          isPublished: true,
          isDraft: false,
          draftStatus: "published",
          updatedAt: new Date(),
        })
        .where(eq(knowledgeBaseArticles.id, articleId));

      logger.info(`[support] KB draft published`, { metadata: { articleId, userId: req.user?.id } });
      res.json({ success: true });
    } catch (error: any) {
      logger.error("[support] Error publishing KB draft", error);
      Errors.internal(res, error);
    }
  });

  // Dismiss a KB draft — terminal state, draft_status='dismissed'.
  // Kept in the table for audit (so we can later mine which drafts
  // never made the bar).
  api.post("/api/founder/support/kb-drafts/:id/dismiss", isAuthenticated, getOrCreateOrg, costClass("low"), async (req, res) => {
    try {
      const org = req.organization!;
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
      }

      const articleId = parseInt(req.params.id);
      if (Number.isNaN(articleId)) {
        return Errors.badRequest(res, "Invalid article id");
      }

      const [existing] = await db.select()
        .from(knowledgeBaseArticles)
        .where(eq(knowledgeBaseArticles.id, articleId));

      if (!existing) {
        return Errors.notFound(res, "Article");
      }
      if (existing.draftStatus !== "pending_review") {
        return Errors.badRequest(res, "Article is not a pending draft");
      }

      await db.update(knowledgeBaseArticles)
        .set({
          isPublished: false,
          isDraft: true,
          draftStatus: "dismissed",
          updatedAt: new Date(),
        })
        .where(eq(knowledgeBaseArticles.id, articleId));

      logger.info(`[support] KB draft dismissed`, { metadata: { articleId, userId: req.user?.id } });
      res.json({ success: true });
    } catch (error: any) {
      logger.error("[support] Error dismissing KB draft", error);
      Errors.internal(res, error);
    }
  });

  // Founder endpoint: Get escalated tickets with full context
  api.get("/api/founder/escalations", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
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
        
        // Get Pax's memory for this ticket (root cause analysis, solutions tried)
        const memories = await db.select()
          .from(paxMemory)
          .where(and(
            eq(paxMemory.organizationId, ticket.organizationId),
            or(
              eq(paxMemory.sourceTicketId, ticket.id),
              eq(paxMemory.memoryType, "solution_tried")
            )
          ))
          .orderBy(desc(paxMemory.createdAt))
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
      logger.error("[founder] Error fetching escalations", error);
      Errors.internal(res, error);
    }
  });

  // Founder endpoint: Generate a prompt for Replit Agent from a single escalation
  api.post("/api/founder/escalations/:id/generate-prompt", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
      }
      
      const ticketId = parseInt(req.params.id);
      if (isNaN(ticketId)) {
        return Errors.badRequest(res, "Invalid ticket ID");
      }
      
      // Get the ticket with full context
      const [ticket] = await db.select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));
      
      if (!ticket) {
        return Errors.notFound(res, "Ticket");
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
      
      // Get Pax's memory for this ticket
      const memories = await db.select()
        .from(paxMemory)
        .where(and(
          eq(paxMemory.organizationId, ticket.organizationId),
          or(
            eq(paxMemory.sourceTicketId, ticket.id),
            eq(paxMemory.memoryType, "solution_tried")
          )
        ))
        .orderBy(desc(paxMemory.createdAt))
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
      if (category.includes('ai') || category.includes('pax') || category.includes('support')) {
        relevantFiles.push('server/ai/supportAgent.ts', 'server/services/paxLearning.ts', 'server/services/supportBrain.ts');
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
${messages.map(m => `**${m.role === 'agent' ? `Pax (${m.agentName || 'AI'})` : m.role === 'user' ? 'Customer' : 'System'}:** ${m.content}`).join('\n\n')}

## Root Cause Analysis (Pax's Assessment)
${rootCauseMemory ? `
- **Identified Cause:** ${(rootCauseMemory.value as any)?.summary || (rootCauseMemory.value as any)?.rootCause || 'Analysis inconclusive'}
- **Confidence:** ${(rootCauseMemory.value as any)?.confidence ? `${Math.round((rootCauseMemory.value as any).confidence * 100)}%` : 'Unknown'}
- **Affected Layers:** ${((rootCauseMemory.value as any)?.affectedLayers || []).join(', ') || 'Unknown'}
- **Suggested Fix:** ${(rootCauseMemory.value as any)?.suggestedFix || 'Manual investigation required'}
` : 'Pax was unable to determine a root cause with sufficient confidence.'}

## What Pax Already Tried
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
5. Update Pax's knowledge base if this reveals a new issue pattern

## Relevant Files to Check
${relevantFiles.map(f => `- \`${f}\``).join('\n')}

## Success Criteria
- [ ] The user's reported issue is resolved
- [ ] Root cause is identified and documented
- [ ] Fix is tested and doesn't break other functionality
- [ ] If applicable, Pax's knowledge is updated to handle similar cases
- [ ] User is notified of the resolution

## Notes
This ticket was escalated by Pax (AI Support Agent) because it could not be resolved automatically. Please investigate and resolve manually.`;

      res.json({ prompt });
    } catch (error: any) {
      logger.error("[founder] Error generating prompt", error);
      Errors.internal(res, error);
    }
  });

  // Founder endpoint: Generate batch prompt for multiple escalations
  api.post("/api/founder/escalations/batch-prompt", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
      }
      
      const { ticketIds } = req.body as { ticketIds: number[] };
      
      if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
        return Errors.badRequest(res, "ticketIds array is required");
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
This batch contains ${tickets.length} escalated support tickets that Pax (AI Support Agent) could not resolve automatically.

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
5. Update Pax's training data to prevent similar escalations

## Common Files to Check
- \`server/routes.ts\` - API endpoints
- \`server/ai/supportAgent.ts\` - Pax's support logic
- \`server/services/\` - Business logic services
- \`shared/schema.ts\` - Database schema

## Success Criteria
- [ ] All listed tickets are resolved
- [ ] Root causes are documented
- [ ] Related tickets are linked if they share a common cause
- [ ] Pax's knowledge base is updated as needed
`;

      res.json({ prompt });
    } catch (error: any) {
      logger.error("[founder] Error generating batch prompt", error);
      Errors.internal(res, error);
    }
  });

  // Founder endpoint: Mark escalation as resolved
  api.post("/api/founder/escalations/:id/resolve", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
      }
      
      const ticketId = parseInt(req.params.id);
      if (isNaN(ticketId)) {
        return Errors.badRequest(res, "Invalid ticket ID");
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
      logger.error("[founder] Error resolving escalation", error);
      Errors.internal(res, error);
    }
  });

  // ============================================
  // PAX LEARNINGS ENDPOINTS
  // ============================================
  
  // Get Pax's cross-org learnings (what Pax has learned)
  api.get("/api/founder/pax/learnings", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
      
      if (!org.isFounder) {
        return Errors.forbidden(res, "Founder access required");
      }
      
      const { paxLearningService } = await import("./services/paxLearning");
      const learnings = await paxLearningService.getAllLearnings();
      
      res.json(learnings);
    } catch (error: any) {
      logger.error("[founder] Error fetching Pax learnings", error);
      Errors.internal(res, error);
    }
  });
  
  // ============================================
  // ENHANCED BUG REPORTING
  // ============================================
  
  // Report a bug with full context capture
  api.post("/api/support/report-bug", isAuthenticated, getOrCreateOrg, async (req, res) => {
    try {
      const org = req.organization!;
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
        return Errors.badRequest(res, "Title and description are required");
      }
      
      let orgHealth = null;
      try {
        const { healthCheckService } = await import("./services/healthCheck");
        orgHealth = await (healthCheckService as any).checkAll();
      } catch (err) {
        logger.error("[support] Error fetching org health for bug report", err);
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
        logger.error("[support] Error fetching recent errors for bug report", err);
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
        .values(bugTicketData as any)
        .returning();
      
      logger.info(`[support] Bug report created: ticket ${ticket.id} for org ${org.id}`);
      
      res.json({
        success: true,
        ticketId: ticket.id,
        message: "Bug report submitted successfully. We'll look into it."
      });
    } catch (error: any) {
      logger.error("[support] Error creating bug report", error);
      Errors.internal(res, error);
    }
  });

}
