// @ts-nocheck
/**
 * Self-Healing Mesh — Sovereign Company Protocol v13
 *
 * Autonomous health monitoring, anomaly detection, degradation management,
 * incident playbook evaluation, and chaos engineering for the agent mesh.
 */

import { db } from "../db";
import {
  agentHealthBaselines,
  anomalyDetections,
  degradationModes,
  incidentPlaybooks,
  chaosExperiments,
  eventMeshEvents,
  integrationExecutionLog,
} from "@shared/schema";
import { eq, and, desc, isNull, sql, asc, gte, lte, count, avg } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecordMetricResult {
  baseline: typeof agentHealthBaselines.$inferSelect;
  anomaly?: typeof anomalyDetections.$inferSelect;
}

interface DegradationModeInput {
  modeName: string;
  capabilitiesAvailable: string[];
  capabilitiesDisabled: string[];
  triggerConditions: Record<string, any>;
}

interface PlaybookInput {
  name: string;
  triggerPattern: Record<string, any>;
  actions: Array<{ type: string; target: string; params: Record<string, any> }>;
  cooldownMinutes?: number;
}

interface ChaosExperimentInput {
  name: string;
  experimentType: string;
  targetAgent?: string;
  targetService?: string;
  config?: Record<string, any>;
  durationMs?: number;
}

interface ChaosCompletionInput {
  impactObserved: Record<string, any>;
  recoveryTimeMs: number;
  lessonsLearned?: string;
}

interface HealthDashboard {
  baselines: (typeof agentHealthBaselines.$inferSelect)[];
  anomaliesBySeverity: Record<string, number>;
  degradedAgents: (typeof degradationModes.$inferSelect)[];
  enabledPlaybooksCount: number;
  recentExperiments: (typeof chaosExperiments.$inferSelect)[];
}

interface MeshStats {
  totalBaselines: number;
  unresolvedAnomalies: number;
  resolvedAnomalies: number;
  degradationModesDefined: number;
  playbooksCount: number;
  chaosExperimentsRun: number;
  avgRecoveryTimeMs: number | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class SelfHealingMeshService {

  /** Record a metric sample, update baseline percentiles, and detect anomalies. */
  async recordMetric(agentCodename: string, metric: string, value: number): Promise<RecordMetricResult> {
    const [existing] = await db
      .select()
      .from(agentHealthBaselines)
      .where(and(
        eq(agentHealthBaselines.agentCodename, agentCodename),
        eq(agentHealthBaselines.metric, metric),
      ))
      .limit(1);

    let baseline: typeof agentHealthBaselines.$inferSelect;

    if (existing) {
      const oldP50 = parseFloat(existing.p50 as string);
      const oldP95 = parseFloat(existing.p95 as string);
      const oldP99 = parseFloat(existing.p99 as string);
      const newP50 = oldP50 + 0.05 * (value - oldP50);
      const newP95 = oldP95 + 0.025 * (value - oldP95);
      const newP99 = oldP99 + 0.01 * (value - oldP99);

      const [updated] = await db
        .update(agentHealthBaselines)
        .set({
          p50: newP50.toFixed(4),
          p95: newP95.toFixed(4),
          p99: newP99.toFixed(4),
          sampleCount: existing.sampleCount + 1,
          lastCalculatedAt: new Date(),
        })
        .where(eq(agentHealthBaselines.id, existing.id))
        .returning();
      baseline = updated;
    } else {
      const [created] = await db
        .insert(agentHealthBaselines)
        .values({
          agentCodename,
          metric,
          p50: value.toFixed(4),
          p95: value.toFixed(4),
          p99: value.toFixed(4),
          sampleCount: 1,
          sampleWindow: "24h",
          lastCalculatedAt: new Date(),
        })
        .returning();
      baseline = created;
    }

    // Anomaly detection
    const p99 = parseFloat(baseline.p99 as string);
    const p95 = parseFloat(baseline.p95 as string);
    let severity: string | null = null;
    if (value > p99 * 1.5) {
      severity = "critical";
    } else if (value > p95 * 1.3) {
      severity = "warning";
    }

    if (severity) {
      const expectedValue = severity === "critical" ? p99 : p95;
      const deviationPercent = expectedValue > 0
        ? ((value - expectedValue) / expectedValue) * 100
        : 0;

      const [anomaly] = await db
        .insert(anomalyDetections)
        .values({
          anomalyId: crypto.randomUUID(),
          agentCodename,
          metric,
          expectedValue: expectedValue.toFixed(4),
          actualValue: value.toFixed(4),
          deviationPercent: deviationPercent.toFixed(2),
          severity,
          correlatedEvents: [],
          autoResolved: false,
        })
        .returning();
      return { baseline, anomaly };
    }

    return { baseline };
  }

  /** Get all unresolved anomalies, optionally filtered by agent. Sorted by severity then time. */
  async detectAnomalies(agentCodename?: string): Promise<(typeof anomalyDetections.$inferSelect)[]> {
    const conditions = [isNull(anomalyDetections.resolvedAt)];
    if (agentCodename) {
      conditions.push(eq(anomalyDetections.agentCodename, agentCodename));
    }

    return db
      .select()
      .from(anomalyDetections)
      .where(and(...conditions))
      .orderBy(
        sql`CASE WHEN ${anomalyDetections.severity} = 'critical' THEN 0
             WHEN ${anomalyDetections.severity} = 'warning' THEN 1
             ELSE 2 END`,
        desc(anomalyDetections.createdAt),
      );
  }

  /** Correlate event mesh events and integration failures around the anomaly timestamp. */
  async performRootCauseAnalysis(anomalyId: string): Promise<string> {
    const [anomaly] = await db
      .select()
      .from(anomalyDetections)
      .where(eq(anomalyDetections.anomalyId, anomalyId))
      .limit(1);

    if (!anomaly) {
      throw new Error(`Anomaly not found: ${anomalyId}`);
    }

    const windowStart = new Date(anomaly.createdAt.getTime() - 5 * 60 * 1000);
    const windowEnd = new Date(anomaly.createdAt.getTime() + 5 * 60 * 1000);

    const correlatedEvents = await db
      .select()
      .from(eventMeshEvents)
      .where(and(
        gte(eventMeshEvents.createdAt, windowStart),
        lte(eventMeshEvents.createdAt, windowEnd),
      ))
      .orderBy(desc(eventMeshEvents.createdAt))
      .limit(20);

    const integrationFailures = await db
      .select()
      .from(integrationExecutionLog)
      .where(and(
        eq(integrationExecutionLog.success, false),
        gte(integrationExecutionLog.createdAt, windowStart),
        lte(integrationExecutionLog.createdAt, windowEnd),
      ))
      .orderBy(desc(integrationExecutionLog.createdAt))
      .limit(20);

    const lines: string[] = [
      `Root Cause Analysis for anomaly ${anomalyId}`,
      `Agent: ${anomaly.agentCodename}, Metric: ${anomaly.metric}`,
      `Expected: ${anomaly.expectedValue}, Actual: ${anomaly.actualValue} (${anomaly.deviationPercent}% deviation)`,
      `Severity: ${anomaly.severity}`,
      "",
    ];

    if (correlatedEvents.length > 0) {
      lines.push(`Correlated Events (${correlatedEvents.length}):`);
      for (const evt of correlatedEvents) {
        lines.push(`  - [${evt.eventType}] channel=${evt.channel} publisher=${evt.publisher} at ${evt.createdAt.toISOString()}`);
      }
    } else {
      lines.push("No correlated events found in the time window.");
    }
    lines.push("");

    if (integrationFailures.length > 0) {
      lines.push(`Integration Failures (${integrationFailures.length}):`);
      for (const fail of integrationFailures) {
        lines.push(`  - [${fail.serviceName}] ${fail.method} ${fail.endpoint} — ${fail.error ?? "unknown error"} (${fail.latencyMs ?? "?"}ms)`);
      }
    } else {
      lines.push("No integration failures found in the time window.");
    }

    const analysisText = lines.join("\n");
    const eventIds = correlatedEvents.map((e) => e.eventId);

    await db
      .update(anomalyDetections)
      .set({ rootCauseAnalysis: analysisText, correlatedEvents: eventIds })
      .where(eq(anomalyDetections.anomalyId, anomalyId));

    return analysisText;
  }

  /** Register a degradation mode for an agent. */
  async registerDegradationMode(
    agentCodename: string,
    data: DegradationModeInput,
  ): Promise<typeof degradationModes.$inferSelect> {
    const [mode] = await db
      .insert(degradationModes)
      .values({
        agentCodename,
        modeName: data.modeName,
        capabilitiesAvailable: data.capabilitiesAvailable,
        capabilitiesDisabled: data.capabilitiesDisabled,
        triggerConditions: data.triggerConditions,
        isCurrentMode: false,
      })
      .returning();
    return mode;
  }

  /** Activate a specific degradation mode, deactivating all others for the agent. */
  async activateDegradationMode(
    agentCodename: string,
    modeName: string,
  ): Promise<typeof degradationModes.$inferSelect> {
    await db
      .update(degradationModes)
      .set({ isCurrentMode: false })
      .where(eq(degradationModes.agentCodename, agentCodename));

    const [activated] = await db
      .update(degradationModes)
      .set({ isCurrentMode: true, activatedAt: new Date() })
      .where(and(
        eq(degradationModes.agentCodename, agentCodename),
        eq(degradationModes.modeName, modeName),
      ))
      .returning();

    if (!activated) {
      throw new Error(`Degradation mode "${modeName}" not found for agent "${agentCodename}"`);
    }
    return activated;
  }

  /** Deactivate all degradation modes for an agent (return to normal operation). */
  async deactivateDegradationMode(agentCodename: string): Promise<void> {
    await db
      .update(degradationModes)
      .set({ isCurrentMode: false })
      .where(eq(degradationModes.agentCodename, agentCodename));
  }

  /** Get the current active degradation mode for an agent, or null if normal. */
  async getCurrentMode(agentCodename: string): Promise<(typeof degradationModes.$inferSelect) | null> {
    const [current] = await db
      .select()
      .from(degradationModes)
      .where(and(
        eq(degradationModes.agentCodename, agentCodename),
        eq(degradationModes.isCurrentMode, true),
      ))
      .limit(1);
    return current ?? null;
  }

  /** Create an incident response playbook. */
  async createPlaybook(data: PlaybookInput): Promise<typeof incidentPlaybooks.$inferSelect> {
    const [playbook] = await db
      .insert(incidentPlaybooks)
      .values({
        playbookId: crypto.randomUUID(),
        name: data.name,
        triggerPattern: data.triggerPattern,
        actions: data.actions,
        cooldownMinutes: data.cooldownMinutes ?? 30,
        triggerCount: 0,
        isEnabled: true,
      })
      .returning();
    return playbook;
  }

  /** Evaluate all enabled playbooks against an anomaly. Trigger matching ones past cooldown. */
  async evaluatePlaybooks(anomalyId: string): Promise<{
    matched: (typeof incidentPlaybooks.$inferSelect)[];
    actions: Array<{ playbookName: string; actions: any[] }>;
  }> {
    const [anomaly] = await db
      .select()
      .from(anomalyDetections)
      .where(eq(anomalyDetections.anomalyId, anomalyId))
      .limit(1);

    if (!anomaly) {
      throw new Error(`Anomaly not found: ${anomalyId}`);
    }

    const enabledPlaybooks = await db
      .select()
      .from(incidentPlaybooks)
      .where(eq(incidentPlaybooks.isEnabled, true));

    const matched: (typeof incidentPlaybooks.$inferSelect)[] = [];
    const actionsList: Array<{ playbookName: string; actions: any[] }> = [];
    const now = new Date();

    for (const playbook of enabledPlaybooks) {
      const pattern = playbook.triggerPattern as Record<string, any>;
      let isMatch = true;

      if (pattern.severity && pattern.severity !== anomaly.severity) isMatch = false;
      if (pattern.metric && pattern.metric !== anomaly.metric) isMatch = false;
      if (pattern.agentCodename && pattern.agentCodename !== anomaly.agentCodename) isMatch = false;
      if (pattern.minDeviation) {
        const deviation = parseFloat(anomaly.deviationPercent as string);
        if (deviation < pattern.minDeviation) isMatch = false;
      }
      if (!isMatch) continue;

      // Check cooldown period
      if (playbook.lastTriggeredAt) {
        const cooldownEnd = new Date(
          playbook.lastTriggeredAt.getTime() + playbook.cooldownMinutes * 60 * 1000,
        );
        if (now < cooldownEnd) continue;
      }

      // Trigger the playbook
      await db
        .update(incidentPlaybooks)
        .set({ lastTriggeredAt: now, triggerCount: playbook.triggerCount + 1 })
        .where(eq(incidentPlaybooks.id, playbook.id));

      matched.push({ ...playbook, lastTriggeredAt: now, triggerCount: playbook.triggerCount + 1 });
      actionsList.push({ playbookName: playbook.name, actions: playbook.actions as any[] });
    }

    return { matched, actions: actionsList };
  }

  /** Start a chaos experiment with status="running". */
  async startChaosExperiment(data: ChaosExperimentInput): Promise<typeof chaosExperiments.$inferSelect> {
    const [experiment] = await db
      .insert(chaosExperiments)
      .values({
        experimentId: crypto.randomUUID(),
        name: data.name,
        experimentType: data.experimentType,
        targetAgent: data.targetAgent ?? null,
        targetService: data.targetService ?? null,
        config: data.config ?? {},
        durationMs: data.durationMs ?? 60000,
        status: "running",
        startedAt: new Date(),
      })
      .returning();
    return experiment;
  }

  /** Complete a chaos experiment with observed impact and recovery metrics. */
  async completeChaosExperiment(
    experimentId: string,
    data: ChaosCompletionInput,
  ): Promise<typeof chaosExperiments.$inferSelect> {
    const [completed] = await db
      .update(chaosExperiments)
      .set({
        status: "completed",
        impactObserved: data.impactObserved,
        recoveryTimeMs: data.recoveryTimeMs,
        lessonsLearned: data.lessonsLearned ?? null,
        completedAt: new Date(),
      })
      .where(eq(chaosExperiments.experimentId, experimentId))
      .returning();

    if (!completed) {
      throw new Error(`Chaos experiment not found: ${experimentId}`);
    }
    return completed;
  }

  /** Dashboard view: baselines, anomalies by severity, degraded agents, playbooks, experiments. */
  async getHealthDashboard(): Promise<HealthDashboard> {
    const baselines = await db
      .select()
      .from(agentHealthBaselines)
      .orderBy(asc(agentHealthBaselines.agentCodename));

    const activeAnomalies = await db
      .select()
      .from(anomalyDetections)
      .where(isNull(anomalyDetections.resolvedAt));

    const anomaliesBySeverity: Record<string, number> = { critical: 0, warning: 0, info: 0 };
    for (const a of activeAnomalies) {
      anomaliesBySeverity[a.severity] = (anomaliesBySeverity[a.severity] ?? 0) + 1;
    }

    const degradedAgents = await db
      .select()
      .from(degradationModes)
      .where(eq(degradationModes.isCurrentMode, true));

    const [playbookCountRow] = await db
      .select({ value: count() })
      .from(incidentPlaybooks)
      .where(eq(incidentPlaybooks.isEnabled, true));

    const recentExperiments = await db
      .select()
      .from(chaosExperiments)
      .orderBy(desc(chaosExperiments.createdAt))
      .limit(10);

    return {
      baselines,
      anomaliesBySeverity,
      degradedAgents,
      enabledPlaybooksCount: playbookCountRow?.value ?? 0,
      recentExperiments,
    };
  }

  /** Mark an anomaly as resolved. */
  async resolveAnomaly(
    anomalyId: string,
    autoResolved: boolean = false,
  ): Promise<typeof anomalyDetections.$inferSelect> {
    const [resolved] = await db
      .update(anomalyDetections)
      .set({ resolvedAt: new Date(), autoResolved })
      .where(eq(anomalyDetections.anomalyId, anomalyId))
      .returning();

    if (!resolved) {
      throw new Error(`Anomaly not found: ${anomalyId}`);
    }
    return resolved;
  }

  /** Aggregate stats across all mesh subsystems. */
  async getStats(): Promise<MeshStats> {
    const [baselineCount] = await db
      .select({ value: count() })
      .from(agentHealthBaselines);

    const [unresolvedCount] = await db
      .select({ value: count() })
      .from(anomalyDetections)
      .where(isNull(anomalyDetections.resolvedAt));

    const [resolvedCount] = await db
      .select({ value: count() })
      .from(anomalyDetections)
      .where(sql`${anomalyDetections.resolvedAt} IS NOT NULL`);

    const [degradationCount] = await db
      .select({ value: count() })
      .from(degradationModes);

    const [playbookCount] = await db
      .select({ value: count() })
      .from(incidentPlaybooks);

    const [experimentCount] = await db
      .select({ value: count() })
      .from(chaosExperiments)
      .where(eq(chaosExperiments.status, "completed"));

    const [avgRecovery] = await db
      .select({ value: avg(chaosExperiments.recoveryTimeMs) })
      .from(chaosExperiments)
      .where(and(
        eq(chaosExperiments.status, "completed"),
        sql`${chaosExperiments.recoveryTimeMs} IS NOT NULL`,
      ));

    return {
      totalBaselines: baselineCount?.value ?? 0,
      unresolvedAnomalies: unresolvedCount?.value ?? 0,
      resolvedAnomalies: resolvedCount?.value ?? 0,
      degradationModesDefined: degradationCount?.value ?? 0,
      playbooksCount: playbookCount?.value ?? 0,
      chaosExperimentsRun: experimentCount?.value ?? 0,
      avgRecoveryTimeMs: avgRecovery?.value ? parseFloat(avgRecovery.value as string) : null,
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const selfHealingMeshService = new SelfHealingMeshService();
