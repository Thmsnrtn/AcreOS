/**
 * Sophie Observer Service
 * 
 * Graceful proactive detection system for Sophie AI assistant.
 * Records observations with confidence scores and manages notifications
 * based on organization preferences.
 */

import { db } from "../db";
import { 
  sophieObservations, 
  organizations,
  InsertSophieObservation, 
  SophieObservation,
  SophieObservationType,
  ProactiveNotificationLevel,
  PROACTIVE_NOTIFICATION_LEVELS,
  sophieCrossOrgLearnings
} from "@shared/schema";
import { eq, and, desc, gte, ne, sql, like } from "drizzle-orm";

export type ObservationSeverity = 'info' | 'low' | 'medium' | 'high';
export type NotificationType = 'none' | 'passive' | 'active';
export type ObservationStatus = 'detected' | 'acknowledged' | 'dismissed' | 'escalated' | 'auto_resolved';

interface RecordObservationOptions {
  organizationId: number;
  userId?: string;
  type: SophieObservationType;
  confidenceScore: number;
  severity: ObservationSeverity;
  title: string;
  description: string;
  metadata?: {
    source?: string;
    relatedEntityType?: string;
    relatedEntityId?: number;
    suggestedAction?: string;
    dataPoints?: Record<string, any>;
    batchKey?: string;
  };
  skipBatching?: boolean;
}

interface NotificationDecision {
  shouldNotify: boolean;
  notificationType: NotificationType;
  reason: string;
}

const SOFT_LANGUAGE_PREFIXES = {
  info: ['Quick tip', 'FYI', 'Just noticed'],
  low: ['Something to check', 'Minor thing', 'Small note'],
  medium: ['Heads up', 'Worth a look', 'Something caught our eye'],
  high: ['Important', 'Needs attention', 'Time-sensitive'],
};

const BATCH_WINDOW_MS = 15 * 60 * 1000;
const MAX_SIMILAR_OBSERVATIONS_BEFORE_BATCH = 3;

class SophieObserverService {
  private static instance: SophieObserverService;
  private recentObservations: Map<string, { count: number; lastSeen: Date }> = new Map();

  private constructor() {}

  static getInstance(): SophieObserverService {
    if (!SophieObserverService.instance) {
      SophieObserverService.instance = new SophieObserverService();
    }
    return SophieObserverService.instance;
  }

  /**
   * Get organization's proactive notification level preference
   */
  async getNotificationLevel(orgId: number): Promise<ProactiveNotificationLevel> {
    try {
      const [org] = await db
        .select({ level: organizations.proactiveNotificationLevel })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      if (!org?.level || !PROACTIVE_NOTIFICATION_LEVELS.includes(org.level as ProactiveNotificationLevel)) {
        return 'balanced';
      }
      return org.level as ProactiveNotificationLevel;
    } catch (error) {
      console.error(`[sophieObserver] Error getting notification level for org ${orgId}:`, error);
      return 'balanced';
    }
  }

  /**
   * Determine if and how to notify based on org preference, confidence, and severity
   */
  determineNotification(
    level: ProactiveNotificationLevel,
    confidenceScore: number,
    severity: ObservationSeverity
  ): NotificationDecision {
    if (level === 'off') {
      return { shouldNotify: false, notificationType: 'none', reason: 'Notifications disabled' };
    }

    const severityWeight = { info: 0, low: 1, medium: 2, high: 3 };
    const severityValue = severityWeight[severity];

    switch (level) {
      case 'minimal':
        if (confidenceScore >= 95 && severity === 'high') {
          return { shouldNotify: true, notificationType: 'active', reason: 'Critical issue with high confidence' };
        }
        return { shouldNotify: false, notificationType: 'none', reason: 'Below minimal threshold' };

      case 'balanced':
        if (confidenceScore >= 80 && severityValue >= 3) {
          return { shouldNotify: true, notificationType: 'active', reason: 'High severity with 80%+ confidence' };
        }
        if (confidenceScore >= 60 && severityValue >= 2) {
          return { shouldNotify: true, notificationType: 'passive', reason: 'Medium+ severity with 60%+ confidence' };
        }
        return { shouldNotify: false, notificationType: 'none', reason: 'Below balanced threshold' };

      case 'proactive':
        if (confidenceScore >= 60) {
          return { 
            shouldNotify: true, 
            notificationType: severityValue >= 2 ? 'active' : 'passive',
            reason: 'Proactive mode - 60%+ confidence'
          };
        }
        return { shouldNotify: true, notificationType: 'passive', reason: 'Proactive mode - all observations' };

      default:
        return { shouldNotify: false, notificationType: 'none', reason: 'Unknown notification level' };
    }
  }

  /**
   * Apply soft language framing to observation title
   */
  applySoftLanguage(title: string, severity: ObservationSeverity): string {
    const prefixes = SOFT_LANGUAGE_PREFIXES[severity];
    const hasPrefix = prefixes.some(p => title.startsWith(p));
    
    if (hasPrefix) {
      return title;
    }

    if (title.toLowerCase().includes('problem') || 
        title.toLowerCase().includes('error') || 
        title.toLowerCase().includes('failure')) {
      const softTitle = title
        .replace(/problem detected/gi, 'something to check')
        .replace(/error occurred/gi, 'something went wrong')
        .replace(/failure/gi, 'issue');
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      return `${prefix}: ${softTitle}`;
    }

    return title;
  }

  /**
   * Check if observation should be batched with similar recent observations
   */
  shouldBatchObservation(batchKey: string): { shouldBatch: boolean; existingCount: number } {
    const now = new Date();
    const cutoff = new Date(now.getTime() - BATCH_WINDOW_MS);
    const existing = this.recentObservations.get(batchKey);

    if (!existing || existing.lastSeen < cutoff) {
      this.recentObservations.set(batchKey, { count: 1, lastSeen: now });
      return { shouldBatch: false, existingCount: 0 };
    }

    const newCount = existing.count + 1;
    this.recentObservations.set(batchKey, { count: newCount, lastSeen: now });

    return { 
      shouldBatch: newCount > MAX_SIMILAR_OBSERVATIONS_BEFORE_BATCH, 
      existingCount: existing.count 
    };
  }

  /**
   * Record an observation with confidence scoring and notification decision
   */
  async recordObservation(options: RecordObservationOptions): Promise<SophieObservation | null> {
    try {
      const {
        organizationId,
        userId,
        type,
        confidenceScore,
        severity,
        title,
        description,
        metadata = {},
        skipBatching = false
      } = options;

      const batchKey = metadata.batchKey || `${organizationId}:${type}:${title.substring(0, 50)}`;
      
      if (!skipBatching) {
        const { shouldBatch, existingCount } = this.shouldBatchObservation(batchKey);
        
        if (shouldBatch) {
          const batchedObservation = await this.updateBatchedObservation(organizationId, batchKey, existingCount + 1);
          if (batchedObservation) {
            console.log(`[sophieObserver] Batched observation for org ${organizationId}: ${type} (${existingCount + 1} occurrences)`);
            return batchedObservation;
          }
        }
      }

      const notificationLevel = await this.getNotificationLevel(organizationId);
      const notificationDecision = this.determineNotification(notificationLevel, confidenceScore, severity);
      const softTitle = this.applySoftLanguage(title, severity);

      const [observation] = await db
        .insert(sophieObservations)
        .values({
          organizationId,
          userId,
          type,
          confidenceScore,
          severity,
          title: softTitle,
          description,
          metadata: {
            ...metadata,
            batchKey,
            previousOccurrences: 0
          },
          status: 'detected',
          notificationSent: notificationDecision.shouldNotify,
          notificationType: notificationDecision.notificationType,
        })
        .returning();

      console.log(`[sophieObserver] Recorded observation for org ${organizationId}: ${type} (${severity}, ${confidenceScore}% confidence, notify: ${notificationDecision.notificationType})`);

      if (notificationDecision.shouldNotify) {
        await this.triggerNotification(observation, notificationDecision);
      }

      return observation;
    } catch (error) {
      console.error('[sophieObserver] Error recording observation:', error);
      return null;
    }
  }

  /**
   * Update an existing batched observation instead of creating a new one
   */
  private async updateBatchedObservation(
    organizationId: number, 
    batchKey: string, 
    occurrenceCount: number
  ): Promise<SophieObservation | null> {
    try {
      const recentWindow = new Date(Date.now() - BATCH_WINDOW_MS);
      
      const existing = await db
        .select()
        .from(sophieObservations)
        .where(and(
          eq(sophieObservations.organizationId, organizationId),
          gte(sophieObservations.detectedAt, recentWindow),
          ne(sophieObservations.status, 'dismissed'),
          ne(sophieObservations.status, 'auto_resolved')
        ))
        .orderBy(desc(sophieObservations.detectedAt))
        .limit(10);

      const matchingObs = existing.find(obs => {
        const meta = obs.metadata as any;
        return meta?.batchKey === batchKey;
      });

      if (matchingObs) {
        const currentMeta = matchingObs.metadata as any || {};
        const [updated] = await db
          .update(sophieObservations)
          .set({
            metadata: {
              ...currentMeta,
              previousOccurrences: occurrenceCount
            },
            description: `${matchingObs.description} (${occurrenceCount} similar occurrences)`,
            updatedAt: new Date()
          })
          .where(eq(sophieObservations.id, matchingObs.id))
          .returning();

        return updated;
      }

      return null;
    } catch (error) {
      console.error('[sophieObserver] Error updating batched observation:', error);
      return null;
    }
  }

  /**
   * Trigger notification based on type (passive or active)
   */
  private async triggerNotification(
    observation: SophieObservation, 
    decision: NotificationDecision
  ): Promise<void> {
    if (decision.notificationType === 'active') {
      console.log(`[sophieObserver] Active notification for org ${observation.organizationId}: ${observation.title}`);
    } else if (decision.notificationType === 'passive') {
      console.log(`[sophieObserver] Passive notification (badge) for org ${observation.organizationId}: ${observation.title}`);
    }
  }

  /**
   * Get active observations for an organization
   */
  async getActiveObservations(orgId: number, limit = 20): Promise<SophieObservation[]> {
    try {
      return await db
        .select()
        .from(sophieObservations)
        .where(and(
          eq(sophieObservations.organizationId, orgId),
          ne(sophieObservations.status, 'dismissed'),
          ne(sophieObservations.status, 'auto_resolved')
        ))
        .orderBy(desc(sophieObservations.detectedAt))
        .limit(limit);
    } catch (error) {
      console.error('[sophieObserver] Error getting active observations:', error);
      return [];
    }
  }

  /**
   * Get unread passive notifications count (for badge display)
   */
  async getUnreadPassiveCount(orgId: number): Promise<number> {
    try {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(sophieObservations)
        .where(and(
          eq(sophieObservations.organizationId, orgId),
          eq(sophieObservations.status, 'detected'),
          eq(sophieObservations.notificationType, 'passive')
        ));

      return result[0]?.count || 0;
    } catch (error) {
      console.error('[sophieObserver] Error getting unread passive count:', error);
      return 0;
    }
  }

  /**
   * Acknowledge an observation (user has seen it)
   */
  async acknowledgeObservation(observationId: number): Promise<boolean> {
    try {
      await db
        .update(sophieObservations)
        .set({
          status: 'acknowledged',
          acknowledgedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(sophieObservations.id, observationId));

      return true;
    } catch (error) {
      console.error('[sophieObserver] Error acknowledging observation:', error);
      return false;
    }
  }

  /**
   * Dismiss an observation (user doesn't want to see it)
   */
  async dismissObservation(observationId: number): Promise<boolean> {
    try {
      await db
        .update(sophieObservations)
        .set({
          status: 'dismissed',
          resolvedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(sophieObservations.id, observationId));

      return true;
    } catch (error) {
      console.error('[sophieObserver] Error dismissing observation:', error);
      return false;
    }
  }

  /**
   * Escalate an observation (needs human attention)
   */
  async escalateObservation(observationId: number): Promise<boolean> {
    try {
      await db
        .update(sophieObservations)
        .set({
          status: 'escalated',
          escalatedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(sophieObservations.id, observationId));

      return true;
    } catch (error) {
      console.error('[sophieObserver] Error escalating observation:', error);
      return false;
    }
  }

  /**
   * Mark observation as auto-resolved
   */
  async autoResolveObservation(
    observationId: number, 
    success: boolean, 
    details: string
  ): Promise<boolean> {
    try {
      await db
        .update(sophieObservations)
        .set({
          status: 'auto_resolved',
          autoResolveAttempted: true,
          autoResolveSuccess: success,
          autoResolveDetails: details,
          resolvedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(sophieObservations.id, observationId));

      return true;
    } catch (error) {
      console.error('[sophieObserver] Error auto-resolving observation:', error);
      return false;
    }
  }

  /**
   * Record a quota warning observation
   */
  async recordQuotaWarning(
    orgId: number,
    resourceType: string,
    current: number,
    limit: number,
    percentage: number
  ): Promise<SophieObservation | null> {
    const severity: ObservationSeverity = percentage >= 95 ? 'high' : percentage >= 80 ? 'medium' : 'low';
    const confidence = Math.min(100, Math.round(percentage));

    return this.recordObservation({
      organizationId: orgId,
      type: 'quota_warning',
      confidenceScore: confidence,
      severity,
      title: percentage >= 95 
        ? `${resourceType} almost full` 
        : `${resourceType} usage is climbing`,
      description: `You've used ${current} of ${limit} ${resourceType} (${percentage}%). ${
        percentage >= 95 
          ? 'Consider upgrading to avoid interruption.' 
          : 'Keep an eye on this one.'
      }`,
      metadata: {
        source: 'quota_monitor',
        dataPoints: { resourceType, current, limit, percentage },
        suggestedAction: percentage >= 95 ? 'upgrade_plan' : 'monitor'
      }
    });
  }

  /**
   * Record a data integrity observation
   */
  async recordDataIssue(
    orgId: number,
    issueType: string,
    table: string,
    count: number,
    description: string
  ): Promise<SophieObservation | null> {
    return this.recordObservation({
      organizationId: orgId,
      type: 'data_issue',
      confidenceScore: 85,
      severity: 'low',
      title: 'Quick data cleanup tip',
      description,
      metadata: {
        source: 'data_integrity_check',
        relatedEntityType: table,
        dataPoints: { issueType, table, count },
        suggestedAction: 'review_data'
      }
    });
  }

  /**
   * Record an activity drop observation
   */
  async recordActivityDrop(
    orgId: number,
    recentCount: number,
    avgDailyBaseline: number,
    dropPercentage: number
  ): Promise<SophieObservation | null> {
    return this.recordObservation({
      organizationId: orgId,
      type: 'activity_drop',
      confidenceScore: Math.min(95, Math.round(dropPercentage)),
      severity: dropPercentage >= 90 ? 'medium' : 'low',
      title: "Noticed you've been quieter lately",
      description: `Your activity dropped by ${Math.round(dropPercentage)}% compared to your usual pattern. Everything okay? We're here if you need help with anything.`,
      metadata: {
        source: 'activity_monitor',
        dataPoints: { recentCount, avgDailyBaseline, dropPercentage },
        suggestedAction: 'proactive_outreach'
      }
    });
  }

  /**
   * Record a service health observation
   */
  async recordServiceHealth(
    orgId: number | null,
    serviceName: string,
    status: string,
    message: string
  ): Promise<SophieObservation | null> {
    if (!orgId) return null;

    const severity: ObservationSeverity = status === 'unavailable' ? 'high' : 'medium';
    
    return this.recordObservation({
      organizationId: orgId,
      type: 'service_health',
      confidenceScore: 95,
      severity,
      title: status === 'unavailable' 
        ? `${serviceName} is temporarily unavailable` 
        : `${serviceName} is running a bit slow`,
      description: message || `The ${serviceName} service is experiencing ${status === 'unavailable' ? 'an outage' : 'some delays'}. We're on it.`,
      metadata: {
        source: 'health_check',
        dataPoints: { serviceName, status },
        suggestedAction: status === 'unavailable' ? 'wait_and_retry' : 'monitor'
      }
    });
  }

  /**
   * Clean up old resolved observations
   */
  async cleanupOldObservations(daysOld = 30): Promise<number> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysOld);

      const result = await db
        .delete(sophieObservations)
        .where(and(
          eq(sophieObservations.status, 'auto_resolved'),
          sql`${sophieObservations.resolvedAt} < ${cutoff}`
        ))
        .returning({ id: sophieObservations.id });

      if (result.length > 0) {
        console.log(`[sophieObserver] Cleaned up ${result.length} old observations`);
      }

      return result.length;
    } catch (error) {
      console.error('[sophieObserver] Error cleaning up old observations:', error);
      return 0;
    }
  }

  /**
   * Clear the recent observations cache
   */
  clearCache(): void {
    this.recentObservations.clear();
    console.log('[sophieObserver] Observation cache cleared');
  }

  /**
   * Check if an observation matches a known fix pattern with >70% success rate
   * and attempt proactive self-healing before notifying user
   */
  async checkAndApplyProactiveFix(observation: SophieObservation): Promise<{
    attempted: boolean;
    success: boolean;
    action?: string;
    result?: string;
  }> {
    try {
      const issueText = `${observation.title} ${observation.description}`.toLowerCase();
      const meta = observation.metadata as any || {};
      
      const matchingPatterns = await db
        .select()
        .from(sophieCrossOrgLearnings)
        .where(and(
          gte(sophieCrossOrgLearnings.successRate, "70"),
          eq(sophieCrossOrgLearnings.isAutoFixable, true)
        ))
        .orderBy(desc(sophieCrossOrgLearnings.successRate))
        .limit(50);
      
      let matchedPattern = null;
      for (const pattern of matchingPatterns) {
        const patternLower = (pattern.issuePattern || "").toLowerCase();
        const keywords = (pattern.keywords as string[]) || [];
        
        const patternMatch = patternLower && issueText.includes(patternLower.substring(0, 30));
        const keywordMatch = keywords.some(k => issueText.includes(k.toLowerCase()));
        
        if (patternMatch || keywordMatch) {
          matchedPattern = pattern;
          break;
        }
      }
      
      if (!matchedPattern || !matchedPattern.autoFixAction) {
        return { attempted: false, success: false };
      }
      
      console.log(`[sophieObserver] Found matching fix pattern for observation ${observation.id}: ${matchedPattern.issuePattern?.substring(0, 50)}`);
      
      const { sophieLearningService } = await import("./sophieLearning");
      const fixResult = await sophieLearningService.applySelfHealingFix(
        observation.organizationId,
        `${observation.title} ${observation.description}`,
        { observationId: observation.id }
      );
      
      if (fixResult.applied) {
        await this.autoResolveObservation(observation.id, true, fixResult.result);
        console.log(`[sophieObserver] Proactively fixed observation ${observation.id}: ${fixResult.result}`);
      } else {
        console.log(`[sophieObserver] Proactive fix attempt failed for observation ${observation.id}: ${fixResult.result}`);
      }
      
      return {
        attempted: true,
        success: fixResult.applied,
        action: fixResult.action,
        result: fixResult.result
      };
    } catch (error) {
      console.error('[sophieObserver] Error in proactive self-healing:', error);
      return { attempted: false, success: false };
    }
  }

  /**
   * Record an observation and attempt proactive fix if applicable
   */
  async recordObservationWithProactiveFix(options: RecordObservationOptions): Promise<{
    observation: SophieObservation | null;
    proactiveFix: {
      attempted: boolean;
      success: boolean;
      action?: string;
      result?: string;
    };
  }> {
    const observation = await this.recordObservation(options);
    
    if (!observation) {
      return { observation: null, proactiveFix: { attempted: false, success: false } };
    }
    
    if (options.severity === 'high' || options.confidenceScore >= 70) {
      const proactiveFix = await this.checkAndApplyProactiveFix(observation);
      return { observation, proactiveFix };
    }
    
    return { observation, proactiveFix: { attempted: false, success: false } };
  }

  /**
   * Find matching fix patterns for a given issue description
   */
  async findMatchingFixPatterns(issueText: string): Promise<Array<{
    id: number;
    issuePattern: string;
    autoFixAction: string | null;
    successRate: string | null;
  }>> {
    try {
      const keywords = issueText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      
      const patterns = await db
        .select({
          id: sophieCrossOrgLearnings.id,
          issuePattern: sophieCrossOrgLearnings.issuePattern,
          autoFixAction: sophieCrossOrgLearnings.autoFixAction,
          successRate: sophieCrossOrgLearnings.successRate
        })
        .from(sophieCrossOrgLearnings)
        .where(gte(sophieCrossOrgLearnings.successRate, "70"))
        .orderBy(desc(sophieCrossOrgLearnings.successRate))
        .limit(20);
      
      return patterns.filter(pattern => {
        const patternLower = (pattern.issuePattern || "").toLowerCase();
        return keywords.some(k => patternLower.includes(k));
      });
    } catch (error) {
      console.error('[sophieObserver] Error finding matching fix patterns:', error);
      return [];
    }
  }
}

export const sophieObserver = SophieObserverService.getInstance();
