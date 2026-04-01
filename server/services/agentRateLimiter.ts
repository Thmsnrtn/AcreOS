/**
 * Agent Rate Limiter — Per-agent action rate limiting and anomaly detection.
 *
 * Guards against runaway agents by enforcing hourly/daily limits and detecting
 * volume anomalies (2× trailing 7-day average triggers pause + founder alert).
 */

import { db } from "../db";
import { agentActionLog, systemAlerts } from "@shared/schema";
import { eq, and, gte, count, sql } from "drizzle-orm";

// ─── Rate Limit Configuration ──────────────────────────────────────────────

const AGENT_RATE_LIMITS: Record<string, { maxPerHour: number; maxPerDay: number }> = {
  sophie_csm: { maxPerHour: 20, maxPerDay: 100 },
  forge_revenue: { maxPerHour: 10, maxPerDay: 50 },
  sentinel_devops: { maxPerHour: 30, maxPerDay: 200 },
  beacon_marketing: { maxPerHour: 5, maxPerDay: 20 },
  atlas_cto: { maxPerHour: 10, maxPerDay: 50 },
  shield_legal: { maxPerHour: 5, maxPerDay: 20 },
  oracle_analytics: { maxPerHour: 50, maxPerDay: 500 },
  ledger_finance: { maxPerHour: 10, maxPerDay: 50 },
  compass_pm: { maxPerHour: 10, maxPerDay: 50 },
  crucible_qa: { maxPerHour: 20, maxPerDay: 100 },
};

// ─── Data Boundaries ───────────────────────────────────────────────────────

export const AGENT_DATA_BOUNDARIES: Record<string, { read: string[]; write: string[] }> = {
  sophie_csm: {
    read: ["organizations", "leads", "deals", "supportTickets", "leadEmails"],
    write: ["leadEmails", "supportTickets", "agentActionLog"],
  },
  forge_revenue: {
    read: ["organizations", "payments", "notes", "creditTransactions"],
    write: ["agentActionLog"],
  },
  sentinel_devops: {
    read: ["*"],
    write: ["agentActionLog", "agentHealthBaselines", "anomalyDetections", "jobHealthLogs"],
  },
  beacon_marketing: {
    read: ["organizations", "campaigns", "contentDrafts"],
    write: ["contentDrafts", "agentActionLog"],
  },
  atlas_cto: {
    read: ["*"],
    write: ["platformIssues", "agentActionLog", "systemAlerts"],
  },
  shield_legal: {
    read: ["*"],
    write: ["systemAlerts", "agentActionLog"],
  },
  oracle_analytics: {
    read: ["*"],
    write: ["agentActionLog"],
  },
  ledger_finance: {
    read: ["organizations", "payments", "notes", "creditTransactions"],
    write: ["systemAlerts", "agentActionLog"],
  },
  compass_pm: {
    read: ["organizations", "leads", "deals", "supportTickets"],
    write: ["systemAlerts", "agentActionLog"],
  },
  crucible_qa: {
    read: ["*"],
    write: ["systemAlerts", "agentActionLog"],
  },
};

// ─── Rate Limit Check ──────────────────────────────────────────────────────

export async function checkRateLimit(agentCodename: string): Promise<{ allowed: boolean; reason?: string }> {
  const limits = AGENT_RATE_LIMITS[agentCodename];
  if (!limits) return { allowed: true };

  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [hourCount] = await db.select({ count: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        gte(agentActionLog.createdAt, oneHourAgo),
      ));

    if ((hourCount?.count || 0) >= limits.maxPerHour) {
      return { allowed: false, reason: `Rate limit exceeded: ${hourCount?.count} actions in last hour (max ${limits.maxPerHour})` };
    }

    const [dayCount] = await db.select({ count: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        gte(agentActionLog.createdAt, oneDayAgo),
      ));

    if ((dayCount?.count || 0) >= limits.maxPerDay) {
      return { allowed: false, reason: `Daily limit exceeded: ${dayCount?.count} actions today (max ${limits.maxPerDay})` };
    }

    return { allowed: true };
  } catch {
    return { allowed: true }; // Fail open — don't block agents on DB errors
  }
}

// ─── Anomaly Detection ─────────────────────────────────────────────────────

export async function checkVolumeAnomaly(agentCodename: string): Promise<{ anomaly: boolean; currentRate: number; avgRate: number }> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Current hour count
    const [hourCount] = await db.select({ count: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        gte(agentActionLog.createdAt, oneHourAgo),
      ));
    const currentRate = hourCount?.count || 0;

    // Average hourly rate over past 7 days
    const [weekCount] = await db.select({ count: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        gte(agentActionLog.createdAt, sevenDaysAgo),
      ));
    const totalWeek = weekCount?.count || 0;
    const avgRate = Math.ceil(totalWeek / (7 * 24)); // avg per hour

    const anomaly = avgRate > 0 && currentRate >= avgRate * 2;

    if (anomaly) {
      // Create founder alert
      await db.insert(systemAlerts).values({
        title: `Agent volume anomaly: ${agentCodename}`,
        message: `${agentCodename} is acting ${Math.round(currentRate / Math.max(avgRate, 1))}× faster than normal (${currentRate} actions/hour vs avg ${avgRate}).`,
        alertType: "agent_anomaly",
        severity: "warning",
        status: "active",
      } as any);
    }

    return { anomaly, currentRate, avgRate };
  } catch {
    return { anomaly: false, currentRate: 0, avgRate: 0 };
  }
}

// ─── Dead Man's Switch ─────────────────────────────────────────────────────

export async function checkDeadMansSwitch(): Promise<{ daysSinceLogin: number; action: string }> {
  try {
    // Check most recent founder activity
    const [latest] = await db.select({ created: sql<string>`MAX(${agentActionLog.createdAt})` })
      .from(agentActionLog)
      .where(eq(agentActionLog.agentCodename, "founder"));

    if (!latest?.created) {
      return { daysSinceLogin: 0, action: "none" };
    }

    const daysSince = Math.floor((Date.now() - new Date(latest.created).getTime()) / (24 * 60 * 60 * 1000));

    if (daysSince >= 21) return { daysSinceLogin: daysSince, action: "pause_non_critical" };
    if (daysSince >= 14) return { daysSinceLogin: daysSince, action: "reduce_to_assisted" };
    if (daysSince >= 7) return { daysSinceLogin: daysSince, action: "reduce_to_supervised" };

    return { daysSinceLogin: daysSince, action: "none" };
  } catch {
    return { daysSinceLogin: 0, action: "none" };
  }
}

// ─── Data Boundary Check ───────────────────────────────────────────────────

export function checkDataBoundary(agentCodename: string, table: string, operation: "read" | "write"): boolean {
  const boundaries = AGENT_DATA_BOUNDARIES[agentCodename];
  if (!boundaries) return false;

  const allowedTables = operation === "read" ? boundaries.read : boundaries.write;
  return allowedTables.includes("*") || allowedTables.includes(table);
}
