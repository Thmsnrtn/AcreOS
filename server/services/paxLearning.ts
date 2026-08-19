import { db } from "../db";
import { 
  supportTickets, supportResolutionHistory, paxMemory, 
  organizations, activityLog, leads, properties, deals,
  fixAttempts, paxCrossOrgLearnings, knowledgeBaseArticles
} from "@shared/schema";
import { eq, and, desc, gte, sql, count, like, or } from "drizzle-orm";
import { requireOpenAIClient } from "../utils/openaiClient";
import { logger } from "../utils/logger";
import { sanitizePromptInline } from "../utils/sanitizePrompt";

const MAX_RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;
// Cap exponential backoff so a runaway failedCount can't overflow int32
// and trigger Node's TimeoutOverflowWarning. 5 minutes is well past any
// realistic self-heal retry — anything longer should escalate, not sleep.
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export const paxLearningService = {
  
  async learnFromHumanResolution(ticketId: number): Promise<{
    learned: boolean;
    learningEntry?: any;
    crossOrgLearning?: any;
    error?: string;
  }> {
    try {
      const [ticket] = await db.select()
        .from(supportTickets)
        .where(eq(supportTickets.id, ticketId));
      
      if (!ticket) {
        return { learned: false, error: "Ticket not found" };
      }
      
      if (ticket.status !== "resolved" || ticket.resolutionType !== "human") {
        return { learned: false, error: "Ticket not resolved by human" };
      }
      
      const existingLearning = await db.select()
        .from(supportResolutionHistory)
        .where(eq(supportResolutionHistory.ticketId, ticketId))
        .limit(1);
      
      if (existingLearning.length > 0) {
        return { learned: false, error: "Already learned from this ticket" };
      }
      
      const response = await requireOpenAIClient().chat.completions.create({
        model: "openai/gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are analyzing a support ticket resolution to extract learnable patterns. 
            Extract patterns that are GENERALIZABLE across organizations (not specific to one user's data).
            
            Extract: 
            1. issuePattern: A generalizable symptom/indicator pattern (avoid org-specific data)
            2. resolutionApproach: Step-by-step solution that works for any organization
            3. lessonLearned: Key insight for similar future issues
            4. applicableCategories: Array of categories this applies to (billing, leads, properties, deals, ai, campaigns, etc.)
            5. keywords: Array of keywords for matching similar issues
            6. isAutoFixable: Boolean - can this be fixed automatically?
            7. autoFixAction: If auto-fixable, what action to take (clear_cache, retry_jobs, sync_data, refresh_sessions, etc.)
            
            Return JSON: { issuePattern, resolutionApproach, lessonLearned, applicableCategories, keywords, isAutoFixable, autoFixAction }`
          },
          {
            role: "user",
            // P0-14: ticket.subject / .description / .resolution are typed by
            // customers — sanitize before interpolating into the prompt.
            content: `Ticket Category: ${sanitizePromptInline(ticket.category ?? "", { maxLength: 100, source: "paxLearning.category" })}
Subject: ${sanitizePromptInline(ticket.subject ?? "", { maxLength: 500, source: "paxLearning.subject" })}
Description: ${sanitizePromptInline(ticket.description ?? "", { maxLength: 3000, source: "paxLearning.description" })}
Resolution: ${sanitizePromptInline(ticket.resolution ?? "", { maxLength: 3000, source: "paxLearning.resolution" })}
Error Context: ${JSON.stringify(ticket.errorContext || {})}
Page Context: ${JSON.stringify(ticket.pageContext || {})}`
          }
        ],
        response_format: { type: "json_object" }
      });
      
      const learning = JSON.parse(response.choices[0].message.content || "{}");
      
      const [resolutionEntry] = await db.insert(supportResolutionHistory).values({
        organizationId: ticket.organizationId,
        ticketId: ticket.id,
        issueType: ticket.category || "general",
        issuePattern: learning.issuePattern || ticket.subject,
        resolutionApproach: learning.resolutionApproach || ticket.resolution,
        toolsUsed: [],
        wasSuccessful: true,
        customerSatisfied: ticket.customerRating ? ticket.customerRating >= 4 : null,
        lessonLearned: learning.lessonLearned,
        variantName: "human_resolution"
      }).returning();
      
      let crossOrgLearning = null;
      try {
        crossOrgLearning = await this.updateCrossOrgLearning(
          learning.issuePattern || ticket.subject,
          ticket.category || "general",
          learning.resolutionApproach || ticket.resolution || "",
          learning.lessonLearned || "",
          learning.applicableCategories || [ticket.category || "general"],
          learning.keywords || [],
          learning.isAutoFixable || false,
          learning.autoFixAction || null,
          ticket.id,
          ticket.organizationId
        );
      } catch (crossOrgErr) {
        logger.error("[pax-learning] Error updating cross-org learning", undefined, { metadata: { detail: crossOrgErr } });
      }
      
      try {
        await db.insert(paxMemory).values({
          organizationId: ticket.organizationId,
          userId: ticket.userId || "system",
          memoryType: "solution_tried",
          key: `learned_resolution_${ticket.id}`,
          value: {
            ticketId: ticket.id,
            issuePattern: learning.issuePattern,
            resolution: learning.resolutionApproach,
            lesson: learning.lessonLearned,
            categories: learning.applicableCategories,
            keywords: learning.keywords,
            isAutoFixable: learning.isAutoFixable,
            autoFixAction: learning.autoFixAction,
            source: "human_resolution",
            learnedAt: new Date().toISOString()
          } as any,
          importance: 9,
          sourceTicketId: ticket.id
        });
      } catch (memErr) {
        logger.error("[pax-learning] Error saving memory", undefined, { metadata: { detail: memErr } });
      }
      
      logger.info(`[pax-learning] Learned from human resolution of ticket ${ticketId}`);
      
      return { learned: true, learningEntry: resolutionEntry, crossOrgLearning };
    } catch (error) {
      logger.error("[pax-learning] Error learning from resolution", error);
      return { learned: false, error: String(error) };
    }
  },
  
  async updateCrossOrgLearning(
    issuePattern: string,
    issueCategory: string,
    resolutionApproach: string,
    lessonLearned: string,
    applicableCategories: string[],
    keywords: string[],
    isAutoFixable: boolean,
    autoFixAction: string | null,
    ticketId: number,
    orgId: number
  ): Promise<any> {
    const existingPattern = await db.select()
      .from(paxCrossOrgLearnings)
      .where(like(paxCrossOrgLearnings.issuePattern, `%${issuePattern.substring(0, 50)}%`))
      .limit(1);
    
    if (existingPattern.length > 0) {
      const existing = existingPattern[0];
      const sourceTicketIds = (existing.sourceTicketIds as number[]) || [];
      const contributingOrgIds = ((existing as any).contributingOrgIds as number[]) || [];
      
      if (!sourceTicketIds.includes(ticketId)) {
        sourceTicketIds.push(ticketId);
      }
      
      if (!contributingOrgIds.includes(orgId)) {
        contributingOrgIds.push(orgId);
      }
      
      const newSuccessCount = (existing.successCount || 0) + 1;
      const totalAttempts = newSuccessCount + (existing.failureCount || 0);
      const newSuccessRate = totalAttempts > 0 ? (newSuccessCount / totalAttempts * 100).toFixed(2) : "0";
      
      const [updated] = await db.update(paxCrossOrgLearnings)
        .set({
          successCount: newSuccessCount,
          successRate: newSuccessRate,
          sourceTicketIds,
          contributingOrgIds,
          contributingOrgs: contributingOrgIds.length,
          updatedAt: new Date()
        })
        .where(eq(paxCrossOrgLearnings.id, existing.id))
        .returning();
      
      logger.info(`[pax-learning] Updated cross-org learning pattern: ${issuePattern.substring(0, 50)}`);
      return updated;
    } else {
      const [newLearning] = await db.insert(paxCrossOrgLearnings).values({
        issuePattern,
        issueCategory,
        resolutionApproach,
        lessonLearned,
        applicableCategories,
        keywords,
        successCount: 1,
        failureCount: 0,
        successRate: "100",
        isAutoFixable,
        autoFixAction,
        sourceTicketIds: [ticketId],
        contributingOrgIds: [orgId],
        contributingOrgs: 1
      }).returning();
      
      logger.info(`[pax-learning] Created new cross-org learning pattern: ${issuePattern.substring(0, 50)}`);
      return newLearning;
    }
  },
  
  async getAllLearnings(limit = 50): Promise<{
    crossOrgLearnings: any[];
    recentResolutions: any[];
    memoryInsights: any[];
    stats: {
      totalLearnings: number;
      autoFixableLearnings: number;
      avgSuccessRate: number;
    };
  }> {
    const crossOrgLearnings = await db.select()
      .from(paxCrossOrgLearnings)
      .orderBy(desc(paxCrossOrgLearnings.successCount))
      .limit(limit);
    
    const recentResolutions = await db.select()
      .from(supportResolutionHistory)
      .where(eq(supportResolutionHistory.wasSuccessful, true))
      .orderBy(desc(supportResolutionHistory.createdAt))
      .limit(20);
    
    const memoryInsights = await db.select()
      .from(paxMemory)
      .where(eq(paxMemory.memoryType, "solution_tried"))
      .orderBy(desc(paxMemory.createdAt))
      .limit(20);
    
    const totalLearnings = crossOrgLearnings.length;
    const autoFixableLearnings = crossOrgLearnings.filter(l => l.isAutoFixable).length;
    const avgSuccessRate = crossOrgLearnings.length > 0
      ? crossOrgLearnings.reduce((sum, l) => sum + parseFloat(l.successRate || "0"), 0) / crossOrgLearnings.length
      : 0;
    
    return {
      crossOrgLearnings,
      recentResolutions,
      memoryInsights,
      stats: {
        totalLearnings,
        autoFixableLearnings,
        avgSuccessRate: Math.round(avgSuccessRate * 100) / 100
      }
    };
  },
  
  async findMatchingLearning(issueText: string, category?: string): Promise<any | null> {
    const keywords = issueText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    const learnings = await db.select()
      .from(paxCrossOrgLearnings)
      .where(gte(paxCrossOrgLearnings.successRate, "70"))
      .orderBy(desc(paxCrossOrgLearnings.successRate))
      .limit(50);
    
    for (const learning of learnings) {
      const learningKeywords = (learning.keywords as string[]) || [];
      const patternLower = (learning.issuePattern || "").toLowerCase();
      
      const keywordMatch = keywords.some(k => 
        learningKeywords.some(lk => lk.toLowerCase().includes(k)) ||
        patternLower.includes(k)
      );
      
      const categoryMatch = !category || 
        (learning.applicableCategories as string[])?.includes(category);
      
      if (keywordMatch && categoryMatch) {
        return learning;
      }
    }
    
    return null;
  },
  
  async traceRootCause(orgId: number, errorContext: any, symptoms: string[]): Promise<{
    rootCause: string;
    affectedLayers: string[];
    /**
     * Diagnostic confidence in [0,1], or `null` when no diagnosis could be
     * formed (honest "not measured" — never a fabricated constant). This is a
     * rule-based classifier (no model in the loop), so confidence is derived
     * from the strength of the actual evidence gathered:
     *   - a DIRECTLY observed failing layer (db ping failed, captured failed
     *     requests, captured console errors) is hard evidence;
     *   - a keyword-only match against the symptom text is soft evidence.
     */
    confidence: number | null;
    trace: any[];
    suggestedFix: string;
  }> {
    const trace: any[] = [];
    const affectedLayers: string[] = [];
    
    if (errorContext?.consoleErrors?.length > 0) {
      affectedLayers.push("frontend");
      trace.push({
        layer: "frontend",
        errors: errorContext.consoleErrors.slice(0, 5),
        timestamp: new Date().toISOString()
      });
    }
    
    if (errorContext?.failedRequests?.length > 0) {
      affectedLayers.push("api");
      trace.push({
        layer: "api",
        errors: errorContext.failedRequests.slice(0, 5),
        timestamp: new Date().toISOString()
      });
    }
    
    try {
      await db.execute(sql`SELECT 1`);
      trace.push({ layer: "database", status: "healthy", timestamp: new Date().toISOString() });
    } catch (dbError) {
      affectedLayers.push("database");
      trace.push({
        layer: "database",
        error: String(dbError),
        timestamp: new Date().toISOString()
      });
    }
    
    // Confidence is DERIVED from evidence, not hand-coded. We start with no
    // diagnosis (null = honest "not measured") and only assign a real score
    // when actual evidence supports a root cause. Two evidence classes:
    //   - HARD: a layer we directly observed failing this turn (db ping failed,
    //     captured failed API requests, captured console errors). These come
    //     from `trace`/`affectedLayers`, which are facts gathered above.
    //   - SOFT: a keyword-only match against the free-text symptoms. This is a
    //     guess, scored lower, and scaled by how many distinct keywords for the
    //     same service actually appear (more corroboration ⇒ higher).
    let rootCause = "Unknown - requires manual investigation";
    let confidence: number | null = null;
    let suggestedFix = "Gather more information about the issue";

    const symptomText = symptoms.join(" ").toLowerCase();

    // Soft (keyword) evidence: scale 0.45..0.75 by keyword corroboration count.
    const softConfidence = (keywords: string[]): number => {
      const hits = keywords.filter(k => symptomText.includes(k)).length;
      // 1 hit → 0.45, 2 → 0.6, 3+ → 0.75. Real signal: more matching terms.
      return Math.min(0.75, 0.45 + 0.15 * (hits - 1));
    };

    if (symptomText.includes("stripe") || symptomText.includes("payment") || symptomText.includes("billing")) {
      affectedLayers.push("external:stripe");
      rootCause = "Payment/billing service issue";
      confidence = softConfidence(["stripe", "payment", "billing"]);
      suggestedFix = "Check Stripe dashboard and API credentials";
    } else if (symptomText.includes("map") || symptomText.includes("boundary") || symptomText.includes("parcel")) {
      affectedLayers.push("external:regrid");
      rootCause = "Mapping/GIS service issue";
      confidence = softConfidence(["map", "boundary", "parcel"]);
      suggestedFix = "Check Regrid API status and credentials";
    } else if (symptomText.includes("sms") || symptomText.includes("text") || symptomText.includes("twilio")) {
      affectedLayers.push("external:twilio");
      rootCause = "SMS service issue";
      confidence = softConfidence(["sms", "text", "twilio"]);
      suggestedFix = "Check Twilio API status and credentials";
    } else if (symptomText.includes("mail") || symptomText.includes("lob") || symptomText.includes("postcard")) {
      affectedLayers.push("external:lob");
      rootCause = "Direct mail service issue";
      confidence = softConfidence(["mail", "lob", "postcard"]);
      suggestedFix = "Check Lob API status and credentials";
    } else if (symptomText.includes("ai") || symptomText.includes("openai") || symptomText.includes("gpt")) {
      affectedLayers.push("external:openai");
      rootCause = "AI service issue";
      confidence = softConfidence(["ai", "openai", "gpt"]);
      suggestedFix = "Check OpenAI API status and rate limits";
    } else if (affectedLayers.includes("database")) {
      // HARD evidence: the db ping above actually failed this turn.
      rootCause = "Database connectivity or query issue";
      confidence = 0.85;
      suggestedFix = "Check database connection and recent migrations";
    } else if (affectedLayers.includes("api")) {
      // HARD evidence: real failed requests were captured in errorContext.
      rootCause = "Backend API error";
      confidence = 0.7;
      suggestedFix = "Review recent API changes and error logs";
    } else if (affectedLayers.includes("frontend")) {
      // HARD evidence: real console errors were captured in errorContext.
      rootCause = "Frontend JavaScript error";
      confidence = 0.65;
      suggestedFix = "Check browser console for detailed error messages";
    }
    // else: no evidence matched → confidence stays null (not measured).

    return {
      rootCause,
      affectedLayers,
      confidence,
      trace,
      suggestedFix
    };
  },
  
  async detectBulkIssue(issuePattern: string): Promise<{
    isSystemic: boolean;
    affectedCount: number;
    affectedOrgs: number[];
    pattern: string;
    recommendedAction: string;
  }> {
    const recentHour = new Date(Date.now() - 60 * 60 * 1000);
    
    const similarTickets = await db.select()
      .from(supportTickets)
      .where(and(
        gte(supportTickets.createdAt, recentHour),
        or(
          like(supportTickets.subject, `%${issuePattern}%`),
          like(supportTickets.description, `%${issuePattern}%`),
          eq(supportTickets.category, issuePattern)
        )
      ))
      .limit(100);
    
    const uniqueOrgsSet = new Set<number>();
    for (const t of similarTickets) {
      uniqueOrgsSet.add(t.organizationId);
    }
    const uniqueOrgs = Array.from(uniqueOrgsSet);
    
    const isSystemic = similarTickets.length >= 3 || uniqueOrgs.length >= 2;
    
    let recommendedAction = "Monitor for additional reports";
    if (isSystemic) {
      if (uniqueOrgs.length >= 5) {
        recommendedAction = "CRITICAL: System-wide issue detected. Check infrastructure and notify all affected users.";
      } else if (uniqueOrgs.length >= 2) {
        recommendedAction = "Multiple users affected. Investigate common cause and prepare bulk notification.";
      } else {
        recommendedAction = "Pattern detected within single organization. Check for org-specific data issues.";
      }
    }
    
    return {
      isSystemic,
      affectedCount: similarTickets.length,
      affectedOrgs: uniqueOrgs,
      pattern: issuePattern,
      recommendedAction
    };
  },
  
  async applyBulkFix(issueType: string, fixAction: string, affectedOrgIds: number[]): Promise<{
    success: boolean;
    fixedCount: number;
    failedOrgs: number[];
    notifications: number;
  }> {
    const fixedOrgs: number[] = [];
    const failedOrgs: number[] = [];
    
    for (const orgId of affectedOrgIds) {
      try {
        switch (fixAction) {
          case "clear_cache":
            const { invalidateContextCache } = await import("./aiContextAggregator");
            invalidateContextCache(orgId);
            logger.info(`[pax-bulk-fix] Cleared cache for org ${orgId}`);
            break;
          case "resync_data":
            const { healthCheckService } = await import("./healthCheck");
            await healthCheckService.checkAll();
            logger.info(`[pax-bulk-fix] Resynced health data for org ${orgId}`);
            break;
          case "retry_failed_jobs":
            const { jobQueueService } = await import("./jobQueue");
            await jobQueueService.processJobs();
            logger.info(`[pax-bulk-fix] Processed pending jobs for org ${orgId}`);
            break;
          case "refresh_sessions":
            logger.info(`[pax-bulk-fix] Session refresh recommended for org ${orgId}`);
            break;
          case "reset_limits":
            logger.info(`[pax-bulk-fix] Limits reset not available for org ${orgId}`);
            break;
        }
        fixedOrgs.push(orgId);
      } catch (err) {
        logger.error(`[pax-bulk-fix] Failed to apply ${fixAction} for org ${orgId}`, err);
        failedOrgs.push(orgId);
      }
    }
    
    return {
      success: failedOrgs.length === 0,
      fixedCount: fixedOrgs.length,
      failedOrgs,
      notifications: fixedOrgs.length
    };
  },
  
  async getKnownFixPatterns(): Promise<Array<{
    issuePattern: string;
    fixAction: string;
    successRate: number;
    avgEffort: number;
    isAutoFixable: boolean;
  }>> {
    const crossOrgPatterns = await db.select()
      .from(paxCrossOrgLearnings)
      .where(gte(paxCrossOrgLearnings.successRate, "70"))
      .orderBy(desc(paxCrossOrgLearnings.successRate))
      .limit(100);
    
    const patterns: Array<{
      issuePattern: string;
      fixAction: string;
      successRate: number;
      avgEffort: number;
      isAutoFixable: boolean;
    }> = crossOrgPatterns.map(p => ({
      issuePattern: p.issuePattern,
      fixAction: p.autoFixAction || p.resolutionApproach,
      successRate: parseFloat(p.successRate || "0") / 100,
      avgEffort: 0,
      isAutoFixable: p.isAutoFixable || false
    }));
    
    const resolutions = await db.select()
      .from(supportResolutionHistory)
      .where(eq(supportResolutionHistory.wasSuccessful, true))
      .orderBy(desc(supportResolutionHistory.createdAt))
      .limit(200);
    
    const resolutionPatterns = new Map<string, { attempts: number; successes: number; totalEffort: number; fixAction: string }>();
    
    for (const res of resolutions) {
      const key = res.issuePattern || res.issueType;
      const existing = resolutionPatterns.get(key) || { attempts: 0, successes: 0, totalEffort: 0, fixAction: res.resolutionApproach || "" };
      existing.attempts++;
      if (res.wasSuccessful) existing.successes++;
      if (res.customerEffortScore) existing.totalEffort += res.customerEffortScore;
      resolutionPatterns.set(key, existing);
    }
    
    for (const [pattern, data] of resolutionPatterns.entries()) {
      const successRate = data.successes / data.attempts;
      if (successRate >= 0.7 && !patterns.some(p => p.issuePattern === pattern)) {
        patterns.push({
          issuePattern: pattern,
          fixAction: data.fixAction,
          successRate,
          avgEffort: data.totalEffort / data.attempts || 0,
          isAutoFixable: false
        });
      }
    }
    
    return patterns;
  },
  
  async applySelfHealingFix(
    orgId: number, 
    issuePattern: string,
    options?: {
      observationId?: number;
      ticketId?: number;
      maxRetries?: number;
    }
  ): Promise<{
    applied: boolean;
    action: string;
    result: string;
    attemptNumber: number;
    escalated: boolean;
  }> {
    const maxRetries = options?.maxRetries ?? MAX_RETRY_ATTEMPTS;
    
    const existingAttempts = await db.select()
      .from(fixAttempts)
      .where(and(
        eq(fixAttempts.organizationId, orgId),
        like(fixAttempts.issuePattern, `%${issuePattern.substring(0, 50)}%`)
      ))
      .orderBy(desc(fixAttempts.createdAt))
      .limit(10);
    
    const recentAttempts = existingAttempts.filter(a => {
      const createdAt = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      return Date.now() - createdAt < 24 * 60 * 60 * 1000; // Within last 24 hours
    });
    
    const failedCount = recentAttempts.filter(a => a.status === "failed").length;
    const currentAttemptNumber = failedCount + 1;
    
    if (failedCount >= maxRetries) {
      const escalated = await this.escalateToHuman(orgId, issuePattern, recentAttempts);
      return {
        applied: false,
        action: "escalate",
        result: `After ${maxRetries} failed attempts, this issue has been escalated to human support.`,
        attemptNumber: currentAttemptNumber,
        escalated: true
      };
    }
    
    const knownFixes = await this.getKnownFixPatterns();
    const matchingFix = knownFixes.find(f => 
      issuePattern.toLowerCase().includes(f.issuePattern.toLowerCase()) ||
      f.issuePattern.toLowerCase().includes(issuePattern.toLowerCase())
    );
    
    if (!matchingFix) {
      await db.insert(fixAttempts).values({
        organizationId: orgId,
        issuePattern,
        fixAction: "none",
        attemptNumber: currentAttemptNumber,
        status: "failed",
        errorMessage: "No known fix pattern found",
        sourceObservationId: options?.observationId,
        sourceTicketId: options?.ticketId
      });
      
      return { 
        applied: false, 
        action: "none", 
        result: "No known fix for this issue pattern",
        attemptNumber: currentAttemptNumber,
        escalated: false
      };
    }
    
    const backoffDelay = Math.min(BASE_BACKOFF_MS * Math.pow(2, failedCount), MAX_BACKOFF_MS);
    if (failedCount > 0) {
      logger.info(`[pax-self-heal] Waiting ${backoffDelay}ms before retry attempt ${currentAttemptNumber}`);
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
    }
    
    const fixAction = matchingFix.fixAction.toLowerCase();
    let result = "";
    let success = false;
    let errorMessage = "";
    
    try {
      if (fixAction.includes("cache") || fixAction.includes("clear")) {
        const { invalidateContextCache } = await import("./aiContextAggregator");
        invalidateContextCache(orgId);
        result = "Cache cleared successfully";
        success = true;
        logger.info(`[pax-self-heal] Cleared cache for org ${orgId} (attempt ${currentAttemptNumber})`);
      } else if (fixAction.includes("retry") || fixAction.includes("job")) {
        const { jobQueueService } = await import("./jobQueue");
        const jobResult = await jobQueueService.processJobs();
        result = `Failed jobs retried: ${jobResult.processed} processed, ${jobResult.failed} failed`;
        success = jobResult.failed === 0;
        logger.info(`[pax-self-heal] Retried jobs for org ${orgId}: ${JSON.stringify(jobResult)}`);
      } else if (fixAction.includes("sync") || fixAction.includes("refresh")) {
        const { healthCheckService } = await import("./healthCheck");
        await healthCheckService.checkAll();
        result = "Data resynced via health check";
        success = true;
        logger.info(`[pax-self-heal] Resynced data for org ${orgId}`);
      } else {
        errorMessage = "Fix requires manual intervention";
        success = false;
      }
    } catch (fixErr) {
      logger.error(`[pax-self-heal] Error applying fix for org ${orgId}`, undefined, { metadata: { detail: fixErr } });
      errorMessage = String(fixErr);
      success = false;
    }
    
    await db.insert(fixAttempts).values({
      organizationId: orgId,
      issuePattern,
      fixAction: matchingFix.fixAction,
      attemptNumber: currentAttemptNumber,
      status: success ? "success" : "failed",
      errorMessage: errorMessage || null,
      result: {
        success,
        details: result || errorMessage,
        fixedAt: success ? new Date().toISOString() : undefined,
        retryAfter: !success ? new Date(Date.now() + backoffDelay * 2).toISOString() : undefined
      },
      sourceObservationId: options?.observationId,
      sourceTicketId: options?.ticketId
    });
    
    if (success) {
      try {
        await db.insert(paxMemory).values({
          organizationId: orgId,
          userId: "system",
          memoryType: "solution_tried",
          key: `self_heal_${Date.now()}`,
          value: {
            issuePattern,
            fixApplied: matchingFix.fixAction,
            result,
            appliedAt: new Date().toISOString(),
            wasAutomatic: true,
            attemptNumber: currentAttemptNumber
          } as any,
          importance: 7
        });
      } catch (memErr) {
        logger.error("[pax-learning] Error saving self-heal memory", undefined, { metadata: { detail: memErr } });
      }
      
      try {
        await db.update(paxCrossOrgLearnings)
          .set({
            successCount: sql`${paxCrossOrgLearnings.successCount} + 1`,
            updatedAt: new Date()
          })
          .where(like(paxCrossOrgLearnings.issuePattern, `%${matchingFix.issuePattern.substring(0, 50)}%`));
      } catch (updateErr) {
        logger.error("[pax-learning] Error updating cross-org success count", undefined, { metadata: { detail: updateErr } });
      }
    } else {
      try {
        await db.update(paxCrossOrgLearnings)
          .set({
            failureCount: sql`${paxCrossOrgLearnings.failureCount} + 1`,
            updatedAt: new Date()
          })
          .where(like(paxCrossOrgLearnings.issuePattern, `%${matchingFix.issuePattern.substring(0, 50)}%`));
      } catch (updateErr) {
        logger.error("[pax-learning] Error updating cross-org failure count", undefined, { metadata: { detail: updateErr } });
      }
    }
    
    return { 
      applied: success, 
      action: matchingFix.fixAction, 
      result: success ? result : (errorMessage || "Fix failed"),
      attemptNumber: currentAttemptNumber,
      escalated: false
    };
  },
  
  async escalateToHuman(orgId: number, issuePattern: string, attempts: any[]): Promise<boolean> {
    try {
      await db.update(fixAttempts)
        .set({
          status: "escalated",
          escalatedAt: new Date(),
          updatedAt: new Date()
        })
        .where(and(
          eq(fixAttempts.organizationId, orgId),
          like(fixAttempts.issuePattern, `%${issuePattern.substring(0, 50)}%`)
        ));
      
      const [ticket] = await db.insert(supportTickets).values({
        organizationId: orgId,
        userId: "system",
        subject: `[Auto-Escalated] Self-healing failed: ${issuePattern.substring(0, 100)}`,
        description: `Pax attempted to fix this issue ${MAX_RETRY_ATTEMPTS} times but was unsuccessful.

Issue Pattern: ${issuePattern}

Previous Attempts:
${attempts.map((a, i) => `${i + 1}. ${a.fixAction} - ${a.status} (${a.errorMessage || 'No error message'})`).join('\n')}

This requires human investigation.`,
        category: "technical",
        priority: "high",
        status: "open",
        source: "auto_escalation"
      }).returning();
      
      logger.info(`[pax-learning] Escalated to human: ${issuePattern.substring(0, 50)} (ticket ${ticket.id})`);
      return true;
    } catch (err) {
      logger.error("[pax-learning] Error escalating to human", err);
      return false;
    }
  },
  
  async detectDataIntegrityIssues(orgId: number): Promise<Array<{
    issue: string;
    severity: "low" | "medium" | "high";
    affected: number;
    autoFixable: boolean;
    suggestedFix: string;
  }>> {
    const issues: Array<{
      issue: string;
      severity: "low" | "medium" | "high";
      affected: number;
      autoFixable: boolean;
      suggestedFix: string;
    }> = [];
    
    try {
      const orphanedDeals = await db.execute(sql`
        SELECT COUNT(*) as count FROM deals d 
        LEFT JOIN properties p ON d.property_id = p.id 
        WHERE d.organization_id = ${orgId} 
        AND d.property_id IS NOT NULL 
        AND p.id IS NULL
      `);
      const orphanCount = Number((orphanedDeals.rows as any[])?.[0]?.count || 0);
      if (orphanCount > 0) {
        issues.push({
          issue: "Deals referencing deleted properties",
          severity: "medium",
          affected: orphanCount,
          autoFixable: true,
          suggestedFix: "Clear property references from orphaned deals"
        });
      }
    } catch (err) {
    }
    
    try {
      const duplicateLeads = await db.execute(sql`
        SELECT email, COUNT(*) as count FROM leads 
        WHERE organization_id = ${orgId} AND email IS NOT NULL AND email != ''
        GROUP BY email HAVING COUNT(*) > 1
      `);
      const dupCount = (duplicateLeads.rows as any[])?.length || 0;
      if (dupCount > 0) {
        issues.push({
          issue: "Duplicate lead email addresses",
          severity: "low",
          affected: dupCount,
          autoFixable: false,
          suggestedFix: "Review and merge duplicate leads"
        });
      }
    } catch (err) {
    }
    
    return issues;
  },
  
  async fixDataIntegrityIssue(orgId: number, issueType: string): Promise<{
    fixed: boolean;
    affectedRecords: number;
    details: string;
  }> {
    switch (issueType) {
      case "orphaned_deals":
        const result = await db.execute(sql`
          UPDATE deals SET property_id = NULL 
          WHERE organization_id = ${orgId} 
          AND property_id IS NOT NULL 
          AND property_id NOT IN (SELECT id FROM properties WHERE organization_id = ${orgId})
        `);
        return {
          fixed: true,
          affectedRecords: Number((result as any).rowCount || 0),
          details: "Cleared property references from deals where property was deleted"
        };
      
      default:
        return { fixed: false, affectedRecords: 0, details: "Unknown issue type or not auto-fixable" };
    }
  },
  
  async detectOnboardingStuck(orgId: number): Promise<{
    isStuck: boolean;
    currentStep: number | null;
    stuckDuration: number;
    suggestedHelp: string;
  }> {
    const [org] = await db.select()
      .from(organizations)
      .where(eq(organizations.id, orgId));
    
    if (!org || org.onboardingCompleted) {
      return { isStuck: false, currentStep: null, stuckDuration: 0, suggestedHelp: "" };
    }
    
    const recentActivity = await db.select()
      .from(activityLog)
      .where(eq(activityLog.organizationId, orgId))
      .orderBy(desc(activityLog.createdAt))
      .limit(1);
    
    const lastActivity = recentActivity[0]?.createdAt;
    const stuckDuration = lastActivity 
      ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60))
      : 999;
    
    const isStuck = stuckDuration >= 24;
    
    const stepHelp: Record<number, string> = {
      1: "Would you like help setting up your organization profile?",
      2: "I can guide you through adding your first property or lead.",
      3: "Let me show you how to create your first deal.",
      4: "Ready to explore the AI features? I'll walk you through them."
    };
    
    return {
      isStuck,
      currentStep: org.onboardingStep,
      stuckDuration,
      suggestedHelp: isStuck ? (stepHelp[org.onboardingStep || 1] || "Need help getting started?") : ""
    };
  },
  
  async predictUserIssues(orgId: number): Promise<Array<{
    prediction: string;
    confidence: number;
    preventiveAction: string;
    urgency: "low" | "medium" | "high";
  }>> {
    const predictions: Array<{
      prediction: string;
      confidence: number;
      preventiveAction: string;
      urgency: "low" | "medium" | "high";
    }> = [];
    
    try {
      const { getAllUsageLimits } = await import("./usageLimits");
      const limits = await getAllUsageLimits(orgId);
      
      for (const [resource, usage] of Object.entries(limits.usage)) {
        if (usage.percentage && usage.percentage >= 80) {
          predictions.push({
            prediction: `User will hit ${resource} limit soon`,
            confidence: usage.percentage / 100,
            preventiveAction: `Suggest upgrading or managing ${resource} usage`,
            urgency: usage.percentage >= 95 ? "high" : "medium"
          });
        }
      }
    } catch (err) {
    }
    
    try {
      const [org] = await db.select()
        .from(organizations)
        .where(eq(organizations.id, orgId));
      
      if (org?.stripeCustomerId) {
        const stripe = (await import("stripe")).default;
        const stripeClient = new stripe(process.env.STRIPE_SECRET_KEY || "");
        const subscriptions = await stripeClient.subscriptions.list({
          customer: org.stripeCustomerId,
          limit: 1
        });
        const sub = subscriptions.data[0];
        if (sub) {
          const periodEnd = (sub as any).current_period_end;
          if (periodEnd) {
            const daysUntilRenewal = Math.floor((periodEnd * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
            if (daysUntilRenewal <= 3) {
              predictions.push({
                prediction: "Subscription renewal in next 3 days",
                confidence: 0.9,
                preventiveAction: "Verify payment method is up to date",
                urgency: daysUntilRenewal <= 1 ? "high" : "medium"
              });
            }
          }
        }
      }
    } catch (err) {
    }
    
    const integrityIssues = await this.detectDataIntegrityIssues(orgId);
    for (const issue of integrityIssues) {
      predictions.push({
        prediction: `Data issue may cause problems: ${issue.issue}`,
        confidence: 0.7,
        preventiveAction: issue.suggestedFix,
        urgency: issue.severity
      });
    }
    
    return predictions;
  },

  // Learn from user thumbs-up / thumbs-down on a message
  async learnFromRating(messageId: number, rating: 1 | -1): Promise<void> {
    try {
      const { aiMessages } = await import("@shared/schema");
      const [msg] = await db.select().from(aiMessages).where(eq(aiMessages.id, messageId));
      if (!msg || msg.role !== "assistant") return;
      if (rating === -1) {
        // Negative: store as a correction pattern
        await db.insert(paxMemory).values({
          organizationId: (msg as any).organizationId ?? 0,
          userId: "pax_feedback",
          memoryType: "correction",
          key: `feedback_negative_${messageId}`,
          value: { content: msg.content?.slice(0, 500), messageId, feedback: "negative" },
          importance: 6,
          source: "user_feedback",
        } as any);
      } else {
        // Positive: store as a reinforcement
        await db.insert(paxMemory).values({
          organizationId: (msg as any).organizationId ?? 0,
          userId: "pax_feedback",
          memoryType: "reinforcement",
          key: `feedback_positive_${messageId}`,
          value: { content: msg.content?.slice(0, 200), messageId, feedback: "positive" },
          importance: 4,
          source: "user_feedback",
        } as any);
      }
    } catch (err) {
      logger.error("[PaxLearning] learnFromRating error", err);
    }
  },
};
