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
 *
 * NOTE: the SLO math itself now lives in
 * `server/services/reliability/sloCompute.ts` so the *push*-based burn-rate
 * alerting worker shares one definition of "what is a breach" with this
 * *pull*-based endpoint. This file is just the HTTP surface.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  aiSuccessSlo,
  jobSuccessSlo,
  sev1IncidentSlo,
  monthStart,
} from "./services/reliability/sloCompute";

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
