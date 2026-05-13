/**
 * Pillar D / D6 — Error budget endpoint.
 *
 *   GET /api/founder/error-budget
 *
 * Computes the current month's error-budget consumption per SLO from
 * existing telemetry (`aiTelemetryEvents`, `jobHealthLogs`, `incidents`).
 * Founder reads to drive on-call prioritization — if a budget is 80%+
 * consumed mid-month, ship-mode should slow down.
 *
 * SLO targets are derived from /docs/slo-monitoring.md:
 *   - AI request success rate ≥ 99.9% (error budget = 0.1% / month)
 *   - Background job success rate ≥ 99% (error budget = 1.0% / month)
 *   - Zero SEV-1 incidents per month (any SEV-1 = budget exhausted)
 *
 * Returns a per-SLO breakdown:
 *   { sloId, target, current, budgetConsumedPct, remainingBudget,
 *     status: "ok" | "warning" | "critical" }
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { aiTelemetryEvents, jobHealthLogs, incidents } from "@shared/schema";
import { and, gte, sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

interface SloResult {
  sloId: string;
  target: number; // 0..1 (e.g. 0.999)
  current: number; // 0..1
  totalEvents: number;
  failedEvents: number;
  budgetConsumedPct: number; // 0..100; >100 means SLO broken
  remainingBudgetEvents: number;
  status: "ok" | "warning" | "critical";
}

function classify(consumedPct: number): SloResult["status"] {
  if (consumedPct >= 100) return "critical";
  if (consumedPct >= 80) return "warning";
  return "ok";
}

function monthStart(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function aiSuccessSlo(): Promise<SloResult> {
  const target = 0.999;
  const start = monthStart();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`sum(case when ${aiTelemetryEvents.success} = false then 1 else 0 end)::int`,
    })
    .from(aiTelemetryEvents)
    .where(gte(aiTelemetryEvents.createdAt, start));

  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  const current = total > 0 ? 1 - failed / total : 1;
  const budgetEvents = Math.floor(total * (1 - target)); // events we're allowed to fail this month
  const consumedPct = budgetEvents > 0 ? (failed / budgetEvents) * 100 : failed > 0 ? 100 : 0;
  const remainingBudgetEvents = Math.max(0, budgetEvents - failed);

  return {
    sloId: "ai_request_success",
    target,
    current,
    totalEvents: total,
    failedEvents: failed,
    budgetConsumedPct: Math.round(consumedPct * 10) / 10,
    remainingBudgetEvents,
    status: classify(consumedPct),
  };
}

async function jobSuccessSlo(): Promise<SloResult> {
  const target = 0.99;
  const start = monthStart();
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`sum(case when ${jobHealthLogs.status} = 'failed' then 1 else 0 end)::int`,
    })
    .from(jobHealthLogs)
    .where(gte(jobHealthLogs.runStartedAt, start));

  const total = Number(row?.total ?? 0);
  const failed = Number(row?.failed ?? 0);
  const current = total > 0 ? 1 - failed / total : 1;
  const budgetEvents = Math.floor(total * (1 - target));
  const consumedPct = budgetEvents > 0 ? (failed / budgetEvents) * 100 : failed > 0 ? 100 : 0;
  const remainingBudgetEvents = Math.max(0, budgetEvents - failed);

  return {
    sloId: "background_job_success",
    target,
    current,
    totalEvents: total,
    failedEvents: failed,
    budgetConsumedPct: Math.round(consumedPct * 10) / 10,
    remainingBudgetEvents,
    status: classify(consumedPct),
  };
}

async function sev1IncidentSlo(): Promise<SloResult> {
  const target = 1.0; // zero SEV-1 incidents allowed
  const start = monthStart();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(incidents)
    .where(
      and(
        gte(incidents.startedAt, start),
        sql`${incidents.severity} = 'SEV-1'`,
      ),
    );

  const sev1Count = Number(row?.count ?? 0);
  const budgetConsumedPct = sev1Count > 0 ? 100 : 0; // single SEV-1 = exhausted

  return {
    sloId: "zero_sev1_per_month",
    target,
    current: sev1Count === 0 ? 1 : 0,
    totalEvents: sev1Count,
    failedEvents: sev1Count,
    budgetConsumedPct,
    remainingBudgetEvents: sev1Count === 0 ? 1 : 0,
    status: sev1Count > 0 ? "critical" : "ok",
  };
}

export function registerErrorBudgetRoute(app: Express): void {
  app.get(
    "/api/founder/error-budget",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const [aiSlo, jobSlo, sevSlo] = await Promise.all([
          aiSuccessSlo(),
          jobSuccessSlo(),
          sev1IncidentSlo(),
        ]);
        const slos = [aiSlo, jobSlo, sevSlo];
        const worstStatus = slos.some((s) => s.status === "critical")
          ? "critical"
          : slos.some((s) => s.status === "warning")
            ? "warning"
            : "ok";
        return res.json({
          monthStart: monthStart().toISOString(),
          generatedAt: new Date().toISOString(),
          overallStatus: worstStatus,
          slos,
        });
      } catch (err: unknown) {
        logger.error("[error-budget] computation failed", err);
        return Errors.internal(res, err);
      }
    },
  );
}
