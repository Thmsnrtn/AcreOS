/**
 * Pillar E / E10 — Cohort LTV.
 *
 *   GET /api/founder/cohorts/ltv
 *     Cumulative recognized revenue per signup-week cohort across
 *     M1, M3, M6, M12 horizons. Source = revenue_recognition_periods
 *     (the existing ASC 606 ledger), joined to organizations.created_at
 *     for cohort assignment.
 *
 * "Signup" cohort = the ISO week of organizations.createdAt. Could be
 * sharper with lifecycle_events once 'signup.created' is universally
 * recorded — this v0 uses createdAt directly so it works against
 * historical orgs without a backfill.
 */

import type { Express, Response } from "express";
import { dbForReads } from "./db-replica";
import { sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const HORIZON_MONTHS = [1, 3, 6, 12] as const;

interface CohortLtvRow {
  cohort: string;       // "2026-W18"
  signups: number;
  ltvByHorizon: Record<string, { totalCents: number; avgCents: number }>;
}

export function registerCohortLtvRoutes(app: Express): void {
  app.get(
    "/api/founder/cohorts/ltv",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        // Build the cohort assignments + per-org cumulative recognized
        // revenue at each horizon. One query per horizon keeps SQL legible.
        const reader = await dbForReads("cohort.ltv");
        const cohortRowsRaw = await reader.execute(sql.raw(`
          SELECT
            to_char(date_trunc('week', created_at), 'IYYY-"W"IW') AS cohort,
            id AS organization_id,
            created_at
          FROM organizations
          WHERE created_at IS NOT NULL
        `));
        type OrgCohortRow = { cohort: string; organization_id: number; created_at: string | Date };
        const orgRows = (cohortRowsRaw as unknown as OrgCohortRow[]) ?? [];

        const byCohort = new Map<string, OrgCohortRow[]>();
        for (const row of orgRows) {
          if (!row.cohort || row.organization_id == null) continue;
          const list = byCohort.get(row.cohort) ?? [];
          list.push(row);
          byCohort.set(row.cohort, list);
        }

        const cohorts: CohortLtvRow[] = [];

        for (const [cohort, rows] of byCohort.entries()) {
          const orgIds = rows.map((r) => r.organization_id);
          const createdAtByOrg = new Map<number, Date>();
          for (const r of rows) {
            createdAtByOrg.set(r.organization_id, new Date(r.created_at));
          }

          const ltvByHorizon: CohortLtvRow["ltvByHorizon"] = {};
          for (const months of HORIZON_MONTHS) {
            let totalCents = 0;
            for (const orgId of orgIds) {
              const start = createdAtByOrg.get(orgId);
              if (!start) continue;
              const end = new Date(start.getTime());
              end.setUTCMonth(end.getUTCMonth() + months);
              // Don't credit horizons that haven't elapsed yet — would
              // under-report newer cohorts and skew averages.
              if (end > new Date()) continue;
              const probe = await reader.execute(sql.raw(`
                SELECT COALESCE(SUM(recognized_cents), 0)::bigint AS sum
                FROM revenue_recognition_periods
                WHERE organization_id = ${orgId}
                  AND period_start >= '${start.toISOString()}'
                  AND period_start < '${end.toISOString()}'
              `));
              const sumRow = (probe as unknown as Array<{ sum: string | number }>)?.[0];
              const cents = Number(sumRow?.sum ?? 0);
              totalCents += cents;
            }
            ltvByHorizon[`m${months}`] = {
              totalCents,
              avgCents: orgIds.length > 0 ? Math.round(totalCents / orgIds.length) : 0,
            };
          }

          cohorts.push({
            cohort,
            signups: orgIds.length,
            ltvByHorizon,
          });
        }

        cohorts.sort((a, b) => a.cohort.localeCompare(b.cohort));

        return res.json({
          cohorts,
          horizons: [...HORIZON_MONTHS],
          generatedAt: new Date().toISOString(),
          notes: [
            "Cohort = ISO week of organizations.created_at.",
            "Revenue = revenue_recognition_periods.recognized_cents (ASC 606 ledger).",
            "Horizons that haven't elapsed for a given cohort are excluded so the average isn't dragged down.",
          ],
        });
      } catch (err: unknown) {
        logger.error("[cohort-ltv] query failed", err);
        return Errors.internal(res, err);
      }
    },
  );
}
