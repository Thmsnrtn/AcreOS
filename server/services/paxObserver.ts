/**
 * Pax Observer Service
 * 
 * Graceful proactive detection system for Pax AI assistant.
 * Records observations with confidence scores and manages notifications
 * based on organization preferences.
 */

import { db } from "../db";
import {
  paxObservations,
  organizations,
  leads,
  deals,
  InsertPaxObservation,
  PaxObservation,
  PaxObservationType,
  ProactiveNotificationLevel,
  PROACTIVE_NOTIFICATION_LEVELS,
  paxCrossOrgLearnings
} from "@shared/schema";
import { eq, and, desc, gte, ne, sql, like, lt, lte } from "drizzle-orm";
import { logger } from "../utils/logger";

export type ObservationSeverity = 'info' | 'low' | 'medium' | 'high';
export type NotificationType = 'none' | 'passive' | 'active';
export type ObservationStatus = 'detected' | 'acknowledged' | 'dismissed' | 'escalated' | 'auto_resolved';

interface RecordObservationOptions {
  organizationId: number;
  userId?: string;
  type: PaxObservationType;
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
    /**
     * Human-readable provenance for confidenceScore — names the real signal it
     * was derived from (e.g. "detector:stale_leads (signal=maxStaleness/28, ...)").
     * Makes every score auditable: no value is an unexplained constant.
     */
    confidenceBasis?: string;
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

/**
 * Evidence-derived confidence for DETERMINISTIC rule-based detectors.
 *
 * These detectors (stale leads, expiring offers, pipeline velocity, etc.) are
 * NOT model outputs — no LLM is in the loop. Their "confidence" used to be a
 * hand-coded constant (85/88/90/92/95). That was a fabricated number.
 *
 * This function replaces those constants with a defensible signal computed from
 * the REAL evidence the detector measured:
 *   - `signalStrength` (0..1): how strongly the underlying condition is met —
 *     e.g. how far a drop exceeds its trigger threshold, or how close a quota
 *     is to its limit. This is the detector's own measurement, not a guess.
 *   - `sampleSize`: how many entities triggered the rule. A rule that fires on
 *     20 stale leads is more trustworthy than one firing on a single lead.
 *
 * Returns an integer 0..100 suitable for pax_observations.confidenceScore
 * (notNull). The output is purely a function of inputs the detector already
 * computed — re-deriving it from the same row reproduces the same number, which
 * is exactly what makes it auditable on the calibration plot.
 *
 * Where a detector genuinely measures a percentage of certainty (quota %,
 * activity-drop %), callers should pass that through directly rather than via
 * this helper — those are already real signals (see recordQuotaWarning /
 * recordActivityDrop, unchanged).
 */
export function detectorConfidence(opts: {
  /** 0..1 — strength of the rule condition relative to its trigger. */
  signalStrength: number;
  /** count of entities that triggered the rule (≥0). */
  sampleSize: number;
  /** floor so a single-sample but strong signal isn't reported as near-zero. */
  floor?: number;
  /** ceiling — rule-based detectors are heuristics; cap below 100 by default. */
  ceiling?: number;
}): number {
  const floor = opts.floor ?? 50;
  const ceiling = opts.ceiling ?? 95;
  const strength = Math.max(0, Math.min(1, opts.signalStrength));
  // Sample-size term: saturating curve. 1 sample → ~0.0, 3 → ~0.5, 8+ → ~0.9.
  // Real evidence: more corroborating entities ⇒ higher confidence.
  const n = Math.max(0, opts.sampleSize);
  const sampleTerm = n <= 0 ? 0 : 1 - Math.exp(-n / 4);
  // Weight strength more than count — the condition being strongly met matters
  // more than how many rows met it, but both move the needle.
  const combined = 0.7 * strength + 0.3 * sampleTerm;
  const score = floor + combined * (ceiling - floor);
  return Math.round(Math.max(floor, Math.min(ceiling, score)));
}

class PaxObserverService {
  private static instance: PaxObserverService;
  private recentObservations: Map<string, { count: number; lastSeen: Date }> = new Map();

  private constructor() {}

  static getInstance(): PaxObserverService {
    if (!PaxObserverService.instance) {
      PaxObserverService.instance = new PaxObserverService();
    }
    return PaxObserverService.instance;
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
      logger.error(`[paxObserver] Error getting notification level for org ${orgId}`, error);
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
   * Record a MODEL-BACKED observation whose confidence is the model's OWN
   * self-reported confidence (aiRouter requestConfidence → AIResponse.confidence,
   * a number in 0..1), not a deterministic detector heuristic.
   *
   * This is the path that makes the calibration plot's "model-derived confidence"
   * claim TRUE: before this, NO production caller set requestConfidence, so
   * pax_observations.confidenceScore was 100% detectorConfidence() measuring
   * itself. Here:
   *   - `modelConfidence` is a number 0..1 → stamped as 0..100 with a
   *     `confidenceBasis: "model:..."` provenance string, OR
   *   - `null` (the model omitted/malformed it — honest "not measured"). Because
   *     pax_observations.confidenceScore is notNull, we DO NOT fabricate a
   *     number: we return null and write NO row. The honest-null is represented
   *     by the row's absence, never by a constant.
   *
   * Returns the observation, or null when no model signal was available (or on
   * any DB error — same fail-soft contract as recordObservation).
   */
  async recordModelObservation(
    options: Omit<RecordObservationOptions, "confidenceScore"> & {
      /** Model self-reported confidence in [0,1], or null = "not measured". */
      modelConfidence: number | null;
      /** Names the model/surface the confidence came from, for the audit trail. */
      modelSource: string;
    },
  ): Promise<PaxObservation | null> {
    const { modelConfidence, modelSource, metadata, ...rest } = options;
    // Honest-null: no measured model signal ⇒ no fabricated number ⇒ no row.
    if (
      modelConfidence === null ||
      typeof modelConfidence !== "number" ||
      !Number.isFinite(modelConfidence) ||
      modelConfidence < 0 ||
      modelConfidence > 1
    ) {
      logger.info(
        `[paxObserver] model confidence not measured (${modelSource}) — skipping model-backed observation (honest-null)`,
      );
      return null;
    }
    const confidenceScore = Math.round(modelConfidence * 100);
    return this.recordObservation({
      ...rest,
      confidenceScore,
      metadata: {
        ...(metadata ?? {}),
        confidenceBasis: `model:${modelSource} (self-reported confidence ${modelConfidence.toFixed(2)})`,
      },
    });
  }

  /**
   * Record an observation with confidence scoring and notification decision
   */
  async recordObservation(options: RecordObservationOptions): Promise<PaxObservation | null> {
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
            logger.info(`[paxObserver] Batched observation for org ${organizationId}: ${type} (${existingCount + 1} occurrences)`);
            return batchedObservation;
          }
        }
      }

      const notificationLevel = await this.getNotificationLevel(organizationId);
      const notificationDecision = this.determineNotification(notificationLevel, confidenceScore, severity);
      const softTitle = this.applySoftLanguage(title, severity);

      const [observation] = await db
        .insert(paxObservations)
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

      logger.info(`[paxObserver] Recorded observation for org ${organizationId}: ${type} (${severity}, ${confidenceScore}% confidence, notify: ${notificationDecision.notificationType})`);

      if (notificationDecision.shouldNotify) {
        await this.triggerNotification(observation, notificationDecision);
      }

      return observation;
    } catch (error) {
      logger.error('[paxObserver] Error recording observation', error);
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
  ): Promise<PaxObservation | null> {
    try {
      const recentWindow = new Date(Date.now() - BATCH_WINDOW_MS);
      
      const existing = await db
        .select()
        .from(paxObservations)
        .where(and(
          eq(paxObservations.organizationId, organizationId),
          gte(paxObservations.detectedAt, recentWindow),
          ne(paxObservations.status, 'dismissed'),
          ne(paxObservations.status, 'auto_resolved')
        ))
        .orderBy(desc(paxObservations.detectedAt))
        .limit(10);

      const matchingObs = existing.find(obs => {
        const meta = obs.metadata as any;
        return meta?.batchKey === batchKey;
      });

      if (matchingObs) {
        const currentMeta = matchingObs.metadata as any || {};
        const [updated] = await db
          .update(paxObservations)
          .set({
            metadata: {
              ...currentMeta,
              previousOccurrences: occurrenceCount
            },
            description: `${matchingObs.description} (${occurrenceCount} similar occurrences)`,
            updatedAt: new Date()
          })
          .where(eq(paxObservations.id, matchingObs.id))
          .returning();

        return updated;
      }

      return null;
    } catch (error) {
      logger.error('[paxObserver] Error updating batched observation', error);
      return null;
    }
  }

  /**
   * Trigger notification based on type (passive or active)
   */
  private async triggerNotification(
    observation: PaxObservation,
    decision: NotificationDecision
  ): Promise<void> {
    if (decision.notificationType === 'active') {
      logger.info(`[paxObserver] Active notification for org ${observation.organizationId}: ${observation.title}`);
    } else if (decision.notificationType === 'passive') {
      logger.info(`[paxObserver] Passive notification (badge) for org ${observation.organizationId}: ${observation.title}`);
    }

    // Push via SSE to connected clients
    try {
      const { pushObservationSSE } = await import("../routes-ai");
      pushObservationSSE(observation.organizationId, {
        id: observation.id,
        type: observation.type,
        severity: observation.severity,
        title: observation.title,
        description: observation.description,
        createdAt: observation.createdAt ?? new Date(),
      });
    } catch {}
  }

  /**
   * Get active observations for an organization
   */
  async getActiveObservations(orgId: number, limit = 20): Promise<PaxObservation[]> {
    try {
      return await db
        .select()
        .from(paxObservations)
        .where(and(
          eq(paxObservations.organizationId, orgId),
          ne(paxObservations.status, 'dismissed'),
          ne(paxObservations.status, 'auto_resolved')
        ))
        .orderBy(desc(paxObservations.detectedAt))
        .limit(limit);
    } catch (error) {
      logger.error('[paxObserver] Error getting active observations', error);
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
        .from(paxObservations)
        .where(and(
          eq(paxObservations.organizationId, orgId),
          eq(paxObservations.status, 'detected'),
          eq(paxObservations.notificationType, 'passive')
        ));

      return result[0]?.count || 0;
    } catch (error) {
      logger.error('[paxObserver] Error getting unread passive count', error);
      return 0;
    }
  }

  /**
   * Acknowledge an observation (user has seen it)
   */
  async acknowledgeObservation(observationId: number): Promise<boolean> {
    try {
      await db
        .update(paxObservations)
        .set({
          status: 'acknowledged',
          acknowledgedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(paxObservations.id, observationId));

      return true;
    } catch (error) {
      logger.error('[paxObserver] Error acknowledging observation', error);
      return false;
    }
  }

  /**
   * Dismiss an observation (user doesn't want to see it)
   */
  async dismissObservation(observationId: number): Promise<boolean> {
    try {
      await db
        .update(paxObservations)
        .set({
          status: 'dismissed',
          resolvedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(paxObservations.id, observationId));

      return true;
    } catch (error) {
      logger.error('[paxObserver] Error dismissing observation', error);
      return false;
    }
  }

  /**
   * Escalate an observation (needs human attention)
   */
  async escalateObservation(observationId: number): Promise<boolean> {
    try {
      await db
        .update(paxObservations)
        .set({
          status: 'escalated',
          escalatedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(paxObservations.id, observationId));

      return true;
    } catch (error) {
      logger.error('[paxObserver] Error escalating observation', error);
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
        .update(paxObservations)
        .set({
          status: 'auto_resolved',
          autoResolveAttempted: true,
          autoResolveSuccess: success,
          autoResolveDetails: details,
          resolvedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(paxObservations.id, observationId));

      return true;
    } catch (error) {
      logger.error('[paxObserver] Error auto-resolving observation', error);
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
  ): Promise<PaxObservation | null> {
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
        // Already a real signal: confidence IS the measured usage percentage.
        confidenceBasis: 'detector:quota (confidence = measured usage %)',
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
  ): Promise<PaxObservation | null> {
    // Data-integrity checks are exact queries — when a row is malformed it IS
    // malformed (signalStrength = 1). Confidence scales only with how many rows
    // corroborate the issue. (Replaces the former hand-coded 85.)
    const confidenceScore = detectorConfidence({ signalStrength: 1, sampleSize: count });
    return this.recordObservation({
      organizationId: orgId,
      type: 'data_issue',
      confidenceScore,
      severity: 'low',
      title: 'Quick data cleanup tip',
      description,
      metadata: {
        source: 'data_integrity_check',
        relatedEntityType: table,
        dataPoints: { issueType, table, count },
        confidenceBasis: 'detector:data_integrity (signal=1, n=count)',
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
  ): Promise<PaxObservation | null> {
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
        // Already a real signal: confidence IS the measured drop percentage.
        confidenceBasis: 'detector:activity_drop (confidence = measured drop %)',
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
  ): Promise<PaxObservation | null> {
    if (!orgId) return null;

    const severity: ObservationSeverity = status === 'unavailable' ? 'high' : 'medium';

    // A health check is a DIRECT observation of the service, not an inference.
    // 'unavailable' is unambiguous (signal=1); 'degraded'/'slow' is a softer
    // reading (signal≈0.7). High floor because the measurement itself is direct.
    // (Replaces the former hand-coded 95.)
    const signalStrength = status === 'unavailable' ? 1 : 0.7;
    const confidenceScore = detectorConfidence({
      signalStrength,
      sampleSize: 1,
      floor: 80,
      ceiling: 99,
    });
    return this.recordObservation({
      organizationId: orgId,
      type: 'service_health',
      confidenceScore,
      severity,
      title: status === 'unavailable'
        ? `${serviceName} is temporarily unavailable`
        : `${serviceName} is running a bit slow`,
      description: message || `The ${serviceName} service is experiencing ${status === 'unavailable' ? 'an outage' : 'some delays'}. We're on it.`,
      metadata: {
        source: 'health_check',
        dataPoints: { serviceName, status },
        confidenceBasis: `detector:health_check (signal=${signalStrength}, direct observation)`,
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
        .delete(paxObservations)
        .where(and(
          eq(paxObservations.status, 'auto_resolved'),
          sql`${paxObservations.resolvedAt} < ${cutoff}`
        ))
        .returning({ id: paxObservations.id });

      if (result.length > 0) {
        logger.info(`[paxObserver] Cleaned up ${result.length} old observations`);
      }

      return result.length;
    } catch (error) {
      logger.error('[paxObserver] Error cleaning up old observations', error);
      return 0;
    }
  }

  /**
   * Clear the recent observations cache
   */
  clearCache(): void {
    this.recentObservations.clear();
    logger.info('[paxObserver] Observation cache cleared');
  }

  /**
   * Check if an observation matches a known fix pattern with >70% success rate
   * and attempt proactive self-healing before notifying user
   */
  async checkAndApplyProactiveFix(observation: PaxObservation): Promise<{
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
        .from(paxCrossOrgLearnings)
        .where(and(
          gte(paxCrossOrgLearnings.successRate, "70"),
          eq(paxCrossOrgLearnings.isAutoFixable, true)
        ))
        .orderBy(desc(paxCrossOrgLearnings.successRate))
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
      
      logger.info(`[paxObserver] Found matching fix pattern for observation ${observation.id}: ${matchedPattern.issuePattern?.substring(0, 50)}`);
      
      const { paxLearningService } = await import("./paxLearning");
      const fixResult = await paxLearningService.applySelfHealingFix(
        observation.organizationId,
        `${observation.title} ${observation.description}`,
        { observationId: observation.id }
      );
      
      if (fixResult.applied) {
        await this.autoResolveObservation(observation.id, true, fixResult.result);
        logger.info(`[paxObserver] Proactively fixed observation ${observation.id}: ${fixResult.result}`);
      } else {
        logger.info(`[paxObserver] Proactive fix attempt failed for observation ${observation.id}: ${fixResult.result}`);
      }
      
      return {
        attempted: true,
        success: fixResult.applied,
        action: fixResult.action,
        result: fixResult.result
      };
    } catch (error) {
      logger.error('[paxObserver] Error in proactive self-healing', error);
      return { attempted: false, success: false };
    }
  }

  /**
   * Record an observation and attempt proactive fix if applicable
   */
  async recordObservationWithProactiveFix(options: RecordObservationOptions): Promise<{
    observation: PaxObservation | null;
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
          id: paxCrossOrgLearnings.id,
          issuePattern: paxCrossOrgLearnings.issuePattern,
          autoFixAction: paxCrossOrgLearnings.autoFixAction,
          successRate: paxCrossOrgLearnings.successRate
        })
        .from(paxCrossOrgLearnings)
        .where(gte(paxCrossOrgLearnings.successRate, "70"))
        .orderBy(desc(paxCrossOrgLearnings.successRate))
        .limit(20);

      return patterns.filter(pattern => {
        const patternLower = (pattern.issuePattern || "").toLowerCase();
        return keywords.some(k => patternLower.includes(k));
      });
    } catch (error) {
      logger.error('[paxObserver] Error finding matching fix patterns', error);
      return [];
    }
  }

  // ============================================================
  // PROACTIVE MONITORING CHECKS (Pax-powered)
  // ============================================================

  /**
   * Check for leads that haven't been contacted in 14+ days.
   * Surfaces an actionable insight so Pax can draft outreach.
   */
  async checkStaleLeads(orgId: number): Promise<PaxObservation | null> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);

      const allLeads = await db
        .select({
          id: leads.id,
          firstName: leads.firstName,
          lastName: leads.lastName,
          status: leads.status,
          lastContactedAt: leads.lastContactedAt,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(eq(leads.organizationId, orgId));

      const stale = allLeads.filter(l => {
        if (["closed", "dead"].includes(l.status)) return false;
        const lastContact = l.lastContactedAt || l.createdAt;
        return lastContact && new Date(lastContact) < cutoff;
      });

      if (stale.length === 0) return null;

      // Signal strength = how far past the 14-day cutoff the worst lead is
      // (capped at 2× → 28 days). A lead 28+ days cold is a maximal signal;
      // one just over 14 days is a weaker one. Confidence also grows with how
      // many leads corroborate. (Replaces the former hand-coded 90.)
      const maxDaysStale = Math.max(
        ...stale.map(l => {
          const lastContact = l.lastContactedAt || l.createdAt;
          const ms = lastContact ? Date.now() - new Date(lastContact).getTime() : 0;
          return ms / (1000 * 60 * 60 * 24);
        }),
      );
      const signalStrength = Math.min(1, maxDaysStale / 28);
      const confidenceScore = detectorConfidence({ signalStrength, sampleSize: stale.length });

      return this.recordObservation({
        organizationId: orgId,
        type: 'opportunity',
        confidenceScore,
        severity: stale.length >= 5 ? 'medium' : 'low',
        title: 'Stale leads need attention',
        description: `I noticed ${stale.length} lead${stale.length === 1 ? '' : 's'} haven't been contacted in the last 14 days. Want me to draft personalized outreach for them?`,
        metadata: {
          source: 'proactive_lead_monitor',
          suggestedAction: 'draft_outreach_message',
          dataPoints: {
            staleCount: stale.length,
            daysSinceContact: 14,
            maxDaysStale: Math.round(maxDaysStale),
            leadIds: stale.map(l => l.id).slice(0, 20),
          },
          confidenceBasis: 'detector:stale_leads (signal=maxStaleness/28, n=staleCount)',
          batchKey: `${orgId}:stale_leads:14d`,
        },
      });
    } catch (error) {
      logger.error('[paxObserver] Error checking stale leads', error);
      return null;
    }
  }

  /**
   * Check for deals in offer_sent stage where the offer is 7+ days old with no response.
   */
  async checkExpiringOffers(orgId: number): Promise<PaxObservation | null> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);

      const expiringDeals = await db
        .select({
          id: deals.id,
          status: deals.status,
          offerDate: deals.offerDate,
          offerAmount: deals.offerAmount,
          propertyId: deals.propertyId,
        })
        .from(deals)
        .where(
          and(
            eq(deals.organizationId, orgId),
            eq(deals.status, 'offer_sent'),
            lte(deals.offerDate, cutoff)
          )
        );

      if (expiringDeals.length === 0) return null;

      // Calculate average days waiting
      const now = Date.now();
      const avgDays = Math.round(
        expiringDeals.reduce((sum, d) => {
          const offerMs = d.offerDate ? new Date(d.offerDate).getTime() : now;
          return sum + (now - offerMs) / (1000 * 60 * 60 * 24);
        }, 0) / expiringDeals.length
      );

      // Signal strength = how far past the 7-day no-response window the average
      // offer has waited (capped at 2× → 14 days). (Replaces hand-coded 88.)
      const signalStrength = Math.min(1, avgDays / 14);
      const confidenceScore = detectorConfidence({
        signalStrength,
        sampleSize: expiringDeals.length,
      });

      return this.recordObservation({
        organizationId: orgId,
        type: 'opportunity',
        confidenceScore,
        severity: expiringDeals.length >= 3 ? 'high' : 'medium',
        title: 'Offers waiting without response',
        description: `You have ${expiringDeals.length} offer${expiringDeals.length === 1 ? '' : 's'} that ${expiringDeals.length === 1 ? 'has' : 'have'} been waiting an average of ${avgDays} days with no response. Want me to draft a follow-up?`,
        metadata: {
          source: 'proactive_offer_monitor',
          suggestedAction: 'draft_outreach_message',
          dataPoints: {
            expiringCount: expiringDeals.length,
            avgDaysWaiting: avgDays,
            dealIds: expiringDeals.map(d => d.id),
          },
          confidenceBasis: 'detector:expiring_offers (signal=avgDays/14, n=expiringCount)',
          batchKey: `${orgId}:expiring_offers:7d`,
        },
      });
    } catch (error) {
      logger.error('[paxObserver] Error checking expiring offers', error);
      return null;
    }
  }

  /**
   * Compare deals closed this month vs last month.
   * If velocity has dropped >20%, surface an insight.
   */
  async checkPipelineVelocity(orgId: number): Promise<PaxObservation | null> {
    try {
      const now = new Date();

      // This month boundaries
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

      const allDeals = await db
        .select({
          id: deals.id,
          status: deals.status,
          closingDate: deals.closingDate,
          updatedAt: deals.offerDate, // Use offerDate as a proxy timestamp for closed deals
        })
        .from(deals)
        .where(
          and(
            eq(deals.organizationId, orgId),
            eq(deals.status, 'closed')
          )
        );

      const closedThisMonth = allDeals.filter(d => {
        const closedAt = d.closingDate ? new Date(d.closingDate) : null;
        return closedAt && closedAt >= thisMonthStart && closedAt <= now;
      }).length;

      const closedLastMonth = allDeals.filter(d => {
        const closedAt = d.closingDate ? new Date(d.closingDate) : null;
        return closedAt && closedAt >= lastMonthStart && closedAt <= lastMonthEnd;
      }).length;

      // Only surface if there was meaningful activity last month
      if (closedLastMonth === 0) return null;

      const dropPercent = Math.round(((closedLastMonth - closedThisMonth) / closedLastMonth) * 100);
      if (dropPercent <= 20) return null;

      // Signal strength = magnitude of the velocity drop (0..1). A 100% drop is
      // maximal; a 20% drop (the trigger floor) is a weak signal. Sample size =
      // last month's deal count — comparing against 1 deal is noisier than
      // against 20. (Replaces the former hand-coded 75.)
      const signalStrength = Math.min(1, dropPercent / 100);
      const confidenceScore = detectorConfidence({
        signalStrength,
        sampleSize: closedLastMonth,
      });

      return this.recordObservation({
        organizationId: orgId,
        type: 'performance',
        confidenceScore,
        severity: dropPercent >= 50 ? 'high' : 'medium',
        title: 'Pipeline velocity has slowed',
        description: `Deals closed this month (${closedThisMonth}) are down ${dropPercent}% compared to last month (${closedLastMonth}). Worth reviewing what's in the pipeline to get things moving.`,
        metadata: {
          source: 'proactive_pipeline_monitor',
          suggestedAction: 'get_deals',
          dataPoints: {
            closedThisMonth,
            closedLastMonth,
            dropPercent,
          },
          confidenceBasis: 'detector:pipeline_velocity (signal=dropPercent/100, n=closedLastMonth)',
          batchKey: `${orgId}:pipeline_velocity:${now.getFullYear()}-${now.getMonth()}`,
        },
      });
    } catch (error) {
      logger.error('[paxObserver] Error checking pipeline velocity', error);
      return null;
    }
  }

  /**
   * Check for high-value leads (estimated property value >$50k) with no contact in 7 days.
   * Surfaces a priority alert.
   */
  async checkHighValueInactiveLeads(orgId: number): Promise<PaxObservation | null> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);

      // Import properties to cross-reference
      const { properties } = await import("@shared/schema");

      const allLeads = await db
        .select({
          id: leads.id,
          firstName: leads.firstName,
          lastName: leads.lastName,
          status: leads.status,
          lastContactedAt: leads.lastContactedAt,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(eq(leads.organizationId, orgId));

      // Find properties with high market value linked to sellers
      const highValueProperties = await db
        .select({
          sellerId: properties.sellerId,
          marketValue: properties.marketValue,
          listPrice: properties.listPrice,
          county: properties.county,
          state: properties.state,
        })
        .from(properties)
        .where(eq(properties.organizationId, orgId));

      const highValueSellerIds = new Set(
        highValueProperties
          .filter(p => {
            const value = Number(p.marketValue || p.listPrice || 0);
            return value > 50000 && p.sellerId !== null;
          })
          .map(p => p.sellerId!)
      );

      const inactive = allLeads.filter(l => {
        if (!highValueSellerIds.has(l.id)) return false;
        if (["closed", "dead"].includes(l.status)) return false;
        const lastContact = l.lastContactedAt || l.createdAt;
        return lastContact && new Date(lastContact) < cutoff;
      });

      if (inactive.length === 0) return null;

      // Signal strength = how far past the 7-day window the worst high-value
      // lead is (capped at 2× → 14 days). High floor because these are
      // high-value AND inactive — a strong, corroborated condition. (Replaces
      // the former hand-coded 92.)
      const maxDaysInactive = Math.max(
        ...inactive.map(l => {
          const lastContact = l.lastContactedAt || l.createdAt;
          const ms = lastContact ? Date.now() - new Date(lastContact).getTime() : 0;
          return ms / (1000 * 60 * 60 * 24);
        }),
      );
      const signalStrength = Math.min(1, maxDaysInactive / 14);
      const confidenceScore = detectorConfidence({
        signalStrength,
        sampleSize: inactive.length,
        floor: 70,
        ceiling: 98,
      });

      return this.recordObservation({
        organizationId: orgId,
        type: 'opportunity',
        confidenceScore,
        severity: 'high',
        title: 'High-value leads need priority attention',
        description: `${inactive.length} high-value lead${inactive.length === 1 ? '' : 's'} (property value >$50k) ${inactive.length === 1 ? 'has' : 'have'} not been contacted in 7+ days. These represent significant opportunities — want me to draft outreach?`,
        metadata: {
          source: 'proactive_high_value_monitor',
          suggestedAction: 'draft_outreach_message',
          dataPoints: {
            inactiveCount: inactive.length,
            daysSinceContact: 7,
            maxDaysInactive: Math.round(maxDaysInactive),
            valueThreshold: 50000,
            leadIds: inactive.map(l => l.id).slice(0, 10),
          },
          confidenceBasis: 'detector:high_value_inactive (signal=maxInactive/14, n=inactiveCount)',
          batchKey: `${orgId}:high_value_inactive:7d`,
        },
      });
    } catch (error) {
      logger.error('[paxObserver] Error checking high-value inactive leads', error);
      return null;
    }
  }

  /**
   * Run all proactive monitoring checks for an organization.
   * Call this on a schedule (e.g., hourly) to surface insights.
   */
  async runProactiveChecks(orgId: number): Promise<{
    staleLeads: PaxObservation | null;
    expiringOffers: PaxObservation | null;
    pipelineVelocity: PaxObservation | null;
    highValueInactive: PaxObservation | null;
  }> {
    logger.info(`[paxObserver] Running proactive checks for org ${orgId}`);
    const [staleLeads, expiringOffers, pipelineVelocity, highValueInactive] = await Promise.all([
      this.checkStaleLeads(orgId),
      this.checkExpiringOffers(orgId),
      this.checkPipelineVelocity(orgId),
      this.checkHighValueInactiveLeads(orgId),
    ]);
    return { staleLeads, expiringOffers, pipelineVelocity, highValueInactive };
  }
}

export const paxObserver = PaxObserverService.getInstance();
