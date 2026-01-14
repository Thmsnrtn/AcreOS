/**
 * Proactive Issue Detection Service
 * 
 * Monitors for system issues and creates automatic alerts for Sophie
 * (the AI support agent) to help users proactively.
 */

import { db } from "../db";
import { 
  systemAlerts, organizations, leads, properties, deals, 
  InsertSystemAlert, SystemAlert, activityLog, apiUsageLogs
} from "@shared/schema";
import { eq, and, lt, desc, isNull, count, ne, gte, sql } from "drizzle-orm";
import { healthCheckService, ServiceStatus } from "./healthCheck";
import { getAllUsageLimits, ResourceType } from "./usageLimits";

export type AlertType = 'api_error' | 'sync_failure' | 'quota_warning' | 'data_issue' | 'service_degraded' | 'activity_drop' | 'error_pattern' | 'anomaly_detected';
export type AlertSeverity = 'info' | 'warning' | 'critical';

interface ApiErrorEntry {
  endpoint: string;
  error: string;
  timestamp: Date;
  count: number;
}

interface DataIntegrityIssue {
  type: string;
  table: string;
  count: number;
  description: string;
}

class ProactiveMonitorService {
  private static instance: ProactiveMonitorService;
  private monitorInterval: NodeJS.Timeout | null = null;
  private apiErrorCache: Map<string, ApiErrorEntry[]> = new Map();
  private readonly ERROR_THRESHOLD = 5;
  private readonly ERROR_WINDOW_MS = 5 * 60 * 1000;

  private constructor() {}

  static getInstance(): ProactiveMonitorService {
    if (!ProactiveMonitorService.instance) {
      ProactiveMonitorService.instance = new ProactiveMonitorService();
    }
    return ProactiveMonitorService.instance;
  }

  /**
   * Check quota usage for an organization and create alerts at 80% and 95%
   */
  async checkQuotaUsage(orgId: number): Promise<void> {
    try {
      const usageData = await getAllUsageLimits(orgId);
      
      if (usageData.isFounder) {
        return;
      }

      const resourceTypes: ResourceType[] = ['leads', 'properties', 'notes', 'ai_requests'];
      
      for (const resourceType of resourceTypes) {
        const usage = usageData.usage[resourceType];
        if (usage.limit === null || usage.percentage === null) continue;

        const percentage = usage.percentage;
        
        if (percentage >= 95) {
          await this.createAlertIfNotExists(orgId, 'quota_warning', 'critical', 
            `${resourceType} quota critical: ${percentage}% used`,
            `You have used ${usage.current} of ${usage.limit} ${resourceType}. You are at ${percentage}% capacity.`,
            { resourceType, current: usage.current, limit: usage.limit, percentage }
          );
        } else if (percentage >= 80) {
          await this.createAlertIfNotExists(orgId, 'quota_warning', 'warning',
            `${resourceType} quota warning: ${percentage}% used`,
            `You have used ${usage.current} of ${usage.limit} ${resourceType}. Consider upgrading your plan.`,
            { resourceType, current: usage.current, limit: usage.limit, percentage }
          );
        }
      }
    } catch (error) {
      console.error(`[proactiveMonitor] Error checking quota usage for org ${orgId}:`, error);
    }
  }

  /**
   * Check data integrity for orphaned records
   */
  async checkDataIntegrity(orgId: number): Promise<DataIntegrityIssue[]> {
    const issues: DataIntegrityIssue[] = [];

    try {
      const orphanedDeals = await db
        .select({ count: count() })
        .from(deals)
        .leftJoin(properties, eq(deals.propertyId, properties.id))
        .where(and(
          eq(deals.organizationId, orgId),
          isNull(properties.id)
        ));

      if (orphanedDeals[0]?.count > 0) {
        issues.push({
          type: 'orphaned_reference',
          table: 'deals',
          count: orphanedDeals[0].count,
          description: `${orphanedDeals[0].count} deals reference non-existent properties`
        });
      }

      const orphanedLeads = await db
        .select({ count: count() })
        .from(leads)
        .where(and(
          eq(leads.organizationId, orgId),
          isNull(leads.email),
          isNull(leads.phone)
        ));

      if (orphanedLeads[0]?.count > 0) {
        issues.push({
          type: 'missing_contact',
          table: 'leads',
          count: orphanedLeads[0].count,
          description: `${orphanedLeads[0].count} leads have no email or phone number`
        });
      }

      for (const issue of issues) {
        await this.createAlertIfNotExists(orgId, 'data_issue', 'warning',
          `Data integrity issue: ${issue.type}`,
          issue.description,
          { issue }
        );
      }
    } catch (error) {
      console.error(`[proactiveMonitor] Error checking data integrity for org ${orgId}:`, error);
    }

    return issues;
  }

  /**
   * Check service health and create alerts for degraded/unavailable services
   */
  async checkServiceHealth(): Promise<void> {
    try {
      const healthResult = await healthCheckService.checkAll();

      for (const service of healthResult.services) {
        if (service.status === 'unavailable') {
          await this.createGlobalAlert('service_degraded', 'critical',
            `Service unavailable: ${service.name}`,
            service.message || `The ${service.name} service is currently unavailable.`,
            { serviceName: service.name, status: service.status, latency: service.latency }
          );
        } else if (service.status === 'degraded') {
          await this.createGlobalAlert('service_degraded', 'warning',
            `Service degraded: ${service.name}`,
            service.message || `The ${service.name} service is experiencing issues.`,
            { serviceName: service.name, status: service.status, latency: service.latency }
          );
        } else if (service.status === 'healthy') {
          await this.autoResolveAlertsByMetadata('service_degraded', { serviceName: service.name });
        }
      }
    } catch (error) {
      console.error('[proactiveMonitor] Error checking service health:', error);
    }
  }

  /**
   * Log an API error and create alert if threshold exceeded
   */
  async logApiError(orgId: number, endpoint: string, error: string): Promise<void> {
    const cacheKey = `${orgId}:${endpoint}`;
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.ERROR_WINDOW_MS);

    let errors = this.apiErrorCache.get(cacheKey) || [];
    
    errors = errors.filter(e => e.timestamp > cutoff);
    
    errors.push({
      endpoint,
      error,
      timestamp: now,
      count: 1
    });

    this.apiErrorCache.set(cacheKey, errors);

    if (errors.length >= this.ERROR_THRESHOLD) {
      await this.createAlertIfNotExists(orgId, 'api_error', 'warning',
        `Repeated API errors: ${endpoint}`,
        `The endpoint ${endpoint} has failed ${errors.length} times in the last 5 minutes. Latest error: ${error}`,
        { endpoint, errorCount: errors.length, lastError: error, errors: errors.slice(-5) }
      );
    }
  }

  /**
   * Run all checks for all organizations
   */
  async runAllChecks(): Promise<{ orgsChecked: number; alertsCreated: number; anomaliesDetected: number }> {
    let orgsChecked = 0;
    let alertsCreated = 0;
    let anomaliesDetected = 0;

    try {
      await this.checkServiceHealth();

      const orgs = await db.select({ id: organizations.id }).from(organizations);

      for (const org of orgs) {
        try {
          await this.checkQuotaUsage(org.id);
          await this.checkDataIntegrity(org.id);
          
          // Run anomaly detection
          const anomalyResults = await this.runAnomalyDetection(org.id);
          if (anomalyResults.activityDrop || anomalyResults.errorPattern || anomalyResults.anomalousPattern) {
            anomaliesDetected++;
          }
          
          orgsChecked++;
        } catch (error) {
          console.error(`[proactiveMonitor] Error running checks for org ${org.id}:`, error);
        }
      }

      await this.cleanupOldAlerts();
    } catch (error) {
      console.error('[proactiveMonitor] Error running all checks:', error);
    }

    return { orgsChecked, alertsCreated, anomaliesDetected };
  }

  /**
   * Get active (unresolved) alerts for an organization
   */
  async getActiveAlerts(orgId?: number): Promise<SystemAlert[]> {
    try {
      if (orgId) {
        return await db
          .select()
          .from(systemAlerts)
          .where(and(
            eq(systemAlerts.organizationId, orgId),
            ne(systemAlerts.status, 'resolved'),
            ne(systemAlerts.status, 'dismissed')
          ))
          .orderBy(desc(systemAlerts.createdAt));
      } else {
        return await db
          .select()
          .from(systemAlerts)
          .where(and(
            ne(systemAlerts.status, 'resolved'),
            ne(systemAlerts.status, 'dismissed')
          ))
          .orderBy(desc(systemAlerts.createdAt));
      }
    } catch (error) {
      console.error('[proactiveMonitor] Error getting active alerts:', error);
      return [];
    }
  }

  /**
   * Get all alerts for an organization (including resolved)
   */
  async getAllAlerts(orgId: number, limit = 50): Promise<SystemAlert[]> {
    try {
      return await db
        .select()
        .from(systemAlerts)
        .where(eq(systemAlerts.organizationId, orgId))
        .orderBy(desc(systemAlerts.createdAt))
        .limit(limit);
    } catch (error) {
      console.error('[proactiveMonitor] Error getting all alerts:', error);
      return [];
    }
  }

  /**
   * Auto-resolve an alert (called by Sophie or automatic resolution)
   */
  async autoResolveAlert(alertId: number, details: string, resolvedBy: string = 'auto'): Promise<boolean> {
    try {
      await db
        .update(systemAlerts)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          metadata: { resolvedBy, resolutionDetails: details }
        })
        .where(eq(systemAlerts.id, alertId));
      
      console.log(`[proactiveMonitor] Alert ${alertId} resolved by ${resolvedBy}`);
      return true;
    } catch (error) {
      console.error(`[proactiveMonitor] Error resolving alert ${alertId}:`, error);
      return false;
    }
  }

  /**
   * Create an alert if a similar one doesn't already exist
   */
  private async createAlertIfNotExists(
    orgId: number,
    alertType: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    metadata: Record<string, any>
  ): Promise<SystemAlert | null> {
    try {
      const existing = await db
        .select()
        .from(systemAlerts)
        .where(and(
          eq(systemAlerts.organizationId, orgId),
          eq(systemAlerts.alertType, alertType),
          eq(systemAlerts.title, title),
          ne(systemAlerts.status, 'resolved'),
          ne(systemAlerts.status, 'dismissed')
        ))
        .limit(1);

      if (existing.length > 0) {
        return existing[0];
      }

      const [alert] = await db
        .insert(systemAlerts)
        .values({
          organizationId: orgId,
          type: alertType,
          alertType,
          severity,
          title,
          message,
          status: 'new',
          metadata,
          autoResolvable: alertType === 'service_degraded'
        })
        .returning();

      console.log(`[proactiveMonitor] Created alert: ${title} for org ${orgId}`);
      return alert;
    } catch (error) {
      console.error('[proactiveMonitor] Error creating alert:', error);
      return null;
    }
  }

  /**
   * Create a global alert (not tied to a specific organization)
   */
  private async createGlobalAlert(
    alertType: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    metadata: Record<string, any>
  ): Promise<SystemAlert | null> {
    try {
      const existing = await db
        .select()
        .from(systemAlerts)
        .where(and(
          isNull(systemAlerts.organizationId),
          eq(systemAlerts.alertType, alertType),
          eq(systemAlerts.title, title),
          ne(systemAlerts.status, 'resolved'),
          ne(systemAlerts.status, 'dismissed')
        ))
        .limit(1);

      if (existing.length > 0) {
        return existing[0];
      }

      const [alert] = await db
        .insert(systemAlerts)
        .values({
          organizationId: null,
          type: alertType,
          alertType,
          severity,
          title,
          message,
          status: 'new',
          metadata,
          autoResolvable: true
        })
        .returning();

      console.log(`[proactiveMonitor] Created global alert: ${title}`);
      return alert;
    } catch (error) {
      console.error('[proactiveMonitor] Error creating global alert:', error);
      return null;
    }
  }

  /**
   * Auto-resolve alerts matching specific metadata criteria
   */
  private async autoResolveAlertsByMetadata(
    alertType: AlertType,
    metadataCriteria: Record<string, any>
  ): Promise<number> {
    try {
      const alerts = await db
        .select()
        .from(systemAlerts)
        .where(and(
          eq(systemAlerts.alertType, alertType),
          ne(systemAlerts.status, 'resolved'),
          ne(systemAlerts.status, 'dismissed')
        ));

      let resolved = 0;
      for (const alert of alerts) {
        const alertMeta = alert.metadata as Record<string, any> || {};
        let matches = true;
        
        for (const [key, value] of Object.entries(metadataCriteria)) {
          if (alertMeta[key] !== value) {
            matches = false;
            break;
          }
        }

        if (matches) {
          await this.autoResolveAlert(alert.id, 'Service restored to healthy status', 'auto');
          resolved++;
        }
      }

      return resolved;
    } catch (error) {
      console.error('[proactiveMonitor] Error auto-resolving alerts by metadata:', error);
      return 0;
    }
  }

  /**
   * Check for sudden drops in user activity (anomaly detection)
   * Compares recent activity to baseline to detect disengagement
   */
  async checkActivityDrop(orgId: number): Promise<{ hasAnomaly: boolean; details?: any }> {
    try {
      const now = new Date();
      
      // Recent period: last 24 hours
      const recentStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      // Baseline period: 7 days before that (to establish normal activity)
      const baselineEnd = recentStart;
      const baselineStart = new Date(baselineEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Count recent activity
      const recentActivity = await db
        .select({ count: count() })
        .from(activityLog)
        .where(and(
          eq(activityLog.organizationId, orgId),
          gte(activityLog.createdAt, recentStart)
        ));
      
      // Count baseline activity (average per day over 7 days)
      const baselineActivity = await db
        .select({ count: count() })
        .from(activityLog)
        .where(and(
          eq(activityLog.organizationId, orgId),
          gte(activityLog.createdAt, baselineStart),
          lt(activityLog.createdAt, baselineEnd)
        ));

      const recentCount = recentActivity[0]?.count || 0;
      const baselineCount = baselineActivity[0]?.count || 0;
      const avgDailyBaseline = baselineCount / 7;

      // If baseline is too low to be meaningful, skip
      if (avgDailyBaseline < 3) {
        return { hasAnomaly: false, details: { reason: "insufficient_baseline", avgDailyBaseline } };
      }

      // Alert if activity dropped by 70% or more
      const dropPercentage = ((avgDailyBaseline - recentCount) / avgDailyBaseline) * 100;
      
      if (dropPercentage >= 70) {
        await this.createAlertIfNotExists(orgId, 'activity_drop', 'warning',
          `Sudden drop in user activity detected`,
          `Your activity has dropped by ${Math.round(dropPercentage)}% compared to your usual pattern. Is everything working correctly? If you're experiencing issues, we're here to help.`,
          { 
            recentCount, 
            avgDailyBaseline: Math.round(avgDailyBaseline), 
            dropPercentage: Math.round(dropPercentage),
            suggestedAction: "proactive_outreach"
          }
        );
        return { hasAnomaly: true, details: { dropPercentage, recentCount, avgDailyBaseline } };
      }

      return { hasAnomaly: false, details: { dropPercentage, recentCount, avgDailyBaseline } };
    } catch (error) {
      console.error(`[proactiveMonitor] Error checking activity drop for org ${orgId}:`, error);
      return { hasAnomaly: false, details: { error: String(error) } };
    }
  }

  /**
   * Check for repeated errors affecting a user (error pattern detection)
   * Looks for users experiencing multiple errors in a short time based on API usage
   */
  async checkErrorPatterns(orgId: number): Promise<{ hasPattern: boolean; details?: any }> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      // Look for error patterns in API usage logs by checking metadata
      const recentApiCalls = await db
        .select()
        .from(apiUsageLogs)
        .where(and(
          eq(apiUsageLogs.organizationId, orgId),
          gte(apiUsageLogs.createdAt, oneHourAgo)
        ))
        .orderBy(desc(apiUsageLogs.createdAt))
        .limit(50);

      // Group by service/action to find patterns (high usage could indicate issues)
      const usageByService = new Map<string, number>();
      for (const log of recentApiCalls) {
        const key = `${log.service}:${log.action}`;
        usageByService.set(key, (usageByService.get(key) || 0) + (log.count || 1));
      }

      // Alert if any service has unusually high usage (10+ calls in an hour)
      const highUsageServices = Array.from(usageByService.entries())
        .filter(([_, usageCount]) => usageCount >= 10);

      if (highUsageServices.length > 0) {
        const topService = highUsageServices.sort((a, b) => b[1] - a[1])[0];
        
        await this.createAlertIfNotExists(orgId, 'error_pattern', 'warning',
          `High API usage detected on ${topService[0]}`,
          `We detected ${topService[1]} calls to ${topService[0]} in the last hour. This may indicate a problem or automation issue we can help investigate.`,
          { 
            service: topService[0],
            usageCount: topService[1],
            allServices: Object.fromEntries(usageByService),
            suggestedAction: "investigate_and_assist"
          }
        );
        return { hasPattern: true, details: { highUsageServices, totalCalls: recentApiCalls.length } };
      }

      return { hasPattern: false, details: { totalCalls: recentApiCalls.length } };
    } catch (error) {
      console.error(`[proactiveMonitor] Error checking error patterns for org ${orgId}:`, error);
      return { hasPattern: false, details: { error: String(error) } };
    }
  }

  /**
   * Check for anomalous usage patterns (unusual behavior detection)
   * Detects unusual spikes in specific operations that may indicate issues
   */
  async checkAnomalousPatterns(orgId: number): Promise<{ hasAnomaly: boolean; details?: any }> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Count different types of activities in the last hour (using action column)
      const recentOperations = await db
        .select({
          action: activityLog.action,
          count: count()
        })
        .from(activityLog)
        .where(and(
          eq(activityLog.organizationId, orgId),
          gte(activityLog.createdAt, oneHourAgo)
        ))
        .groupBy(activityLog.action);

      // Get baseline for comparison (last 24h, hourly average)
      const baselineOperations = await db
        .select({
          action: activityLog.action,
          count: count()
        })
        .from(activityLog)
        .where(and(
          eq(activityLog.organizationId, orgId),
          gte(activityLog.createdAt, oneDayAgo),
          lt(activityLog.createdAt, oneHourAgo)
        ))
        .groupBy(activityLog.action);

      // Build baseline map (average per hour over 23 hours)
      const baselineMap = new Map<string, number>();
      for (const op of baselineOperations) {
        if (op.action) {
          baselineMap.set(op.action, (op.count || 0) / 23);
        }
      }

      // Check for anomalous spikes (3x or more compared to baseline)
      const anomalies: Array<{ type: string; current: number; baseline: number; ratio: number }> = [];
      
      for (const op of recentOperations) {
        if (!op.action) continue;
        
        const current = op.count || 0;
        const baseline = baselineMap.get(op.action) || 0;
        
        // Only flag if baseline exists and spike is significant
        if (baseline >= 2 && current >= baseline * 3) {
          anomalies.push({
            type: op.action,
            current,
            baseline: Math.round(baseline * 10) / 10,
            ratio: Math.round((current / baseline) * 10) / 10
          });
        }
      }

      if (anomalies.length > 0) {
        const topAnomaly = anomalies.sort((a, b) => b.ratio - a.ratio)[0];
        
        await this.createAlertIfNotExists(orgId, 'anomaly_detected', 'info',
          `Unusual activity spike detected`,
          `We noticed ${topAnomaly.current} "${topAnomaly.type}" operations in the last hour, which is ${topAnomaly.ratio}x your usual rate. Is this expected? Let us know if you need assistance.`,
          { 
            topAnomaly,
            allAnomalies: anomalies,
            suggestedAction: "proactive_check_in"
          }
        );
        return { hasAnomaly: true, details: { anomalies } };
      }

      return { hasAnomaly: false, details: { operationsChecked: recentOperations.length } };
    } catch (error) {
      console.error(`[proactiveMonitor] Error checking anomalous patterns for org ${orgId}:`, error);
      return { hasAnomaly: false, details: { error: String(error) } };
    }
  }

  /**
   * Run all anomaly detection checks for an organization
   */
  async runAnomalyDetection(orgId: number): Promise<{
    activityDrop: boolean;
    errorPattern: boolean;
    anomalousPattern: boolean;
  }> {
    const [activityResult, errorResult, anomalyResult] = await Promise.all([
      this.checkActivityDrop(orgId),
      this.checkErrorPatterns(orgId),
      this.checkAnomalousPatterns(orgId)
    ]);

    return {
      activityDrop: activityResult.hasAnomaly,
      errorPattern: errorResult.hasPattern,
      anomalousPattern: anomalyResult.hasAnomaly
    };
  }

  /**
   * Clean up resolved alerts older than 30 days
   */
  private async cleanupOldAlerts(): Promise<number> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await db
        .delete(systemAlerts)
        .where(and(
          eq(systemAlerts.status, 'resolved'),
          lt(systemAlerts.resolvedAt, thirtyDaysAgo)
        ))
        .returning({ id: systemAlerts.id });

      if (result.length > 0) {
        console.log(`[proactiveMonitor] Cleaned up ${result.length} old resolved alerts`);
      }

      return result.length;
    } catch (error) {
      console.error('[proactiveMonitor] Error cleaning up old alerts:', error);
      return 0;
    }
  }

  /**
   * Start the background monitoring job (runs every 5 minutes)
   */
  startMonitoring(intervalMs: number = 5 * 60 * 1000): void {
    if (this.monitorInterval) {
      console.log('[proactiveMonitor] Monitoring already started');
      return;
    }

    console.log(`[proactiveMonitor] Starting proactive monitoring (every ${intervalMs / 1000}s)`);

    this.runAllChecks().catch(err => {
      console.error('[proactiveMonitor] Initial check failed:', err);
    });

    this.monitorInterval = setInterval(() => {
      this.runAllChecks().catch(err => {
        console.error('[proactiveMonitor] Periodic check failed:', err);
      });
    }, intervalMs);
  }

  /**
   * Stop the background monitoring job
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      console.log('[proactiveMonitor] Stopped proactive monitoring');
    }
  }

  /**
   * Get monitoring status
   */
  getStatus(): { isRunning: boolean; errorCacheSize: number } {
    return {
      isRunning: this.monitorInterval !== null,
      errorCacheSize: this.apiErrorCache.size
    };
  }

  /**
   * Clear the API error cache (for testing or reset)
   */
  clearErrorCache(): void {
    this.apiErrorCache.clear();
    console.log('[proactiveMonitor] Error cache cleared');
  }
}

export const proactiveMonitor = ProactiveMonitorService.getInstance();
