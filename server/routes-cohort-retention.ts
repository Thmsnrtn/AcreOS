/**
 * Pillar E / E3 — Cohort retention curves.
 *
 *   GET /api/founder/cohorts/retention
 *     Returns D1/D7/D30/D60/D90 retention % per signup-week cohort.
 *     Retention = % of signups that produced any `engagement` or
 *     `activation`-stage lifecycle event within the window.
 *
 *   GET /api/founder/cohorts/retention/by-source
 *     Same metric grouped by acquisition source (from lifecycle metadata).
 *
 * Reads from `lifecycle_events` (the E5 firehose). Until E5 is fully
 * backfilled, the endpoint relies on whatever's been recorded since
 * the firehose was deployed and gracefully reports zero rows.
 */

import type { Express, Response } from "express";
import { dbForReads } from "./db-replica";
import { sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const RETENTION_WINDOWS = [1, 7, 30, 60, 90] as const;

interface CohortRow {
  cohort: string; // ISO week, e.g. "2026-W18"
  signupCount: number;
  retention: Record<string, number>; // { d1: 0.42, d7: 0.31, ... }
}

export function registerCohortRetentionRoutes(app: Express): void {
  // ── GET /api/founder/cohorts/retention ─────────────────────────────────
  app.get(
    "/api/founder/cohorts/retention",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        // Pull signups (eventType='signup.created' OR stage='signup')
        // per week, then for each cohort count which orgs had an
        // engagement event within each window. One query per window so
        // the SQL stays readable.
        const reader = await dbForReads("cohort.retention");
        // `execute` takes the row type, so `.rows` comes back typed and NO cast
        // is needed. The previous form cast the RESULT OBJECT to an array —
        // a different claim entirely, and a false one.
        type SignupRow = { cohort: string; organization_id: number; occurred_at: string | Date };
        const signups = await reader.execute<SignupRow>(sql.raw(`
          SELECT
            to_char(date_trunc('week', occurred_at), 'IYYY-"W"IW') AS cohort,
            organization_id,
            occurred_at
          FROM lifecycle_events
          WHERE stage = 'signup'
             OR event_type LIKE 'signup.%'
        `));


        // `reader.execute()` returns a node-postgres QueryResult — an OBJECT with
        // `.rows`, not an array. This read `(signups as unknown as SignupRow[])`,
        // a double assertion that told the compiler the container was an array
        // and then handed the QueryResult straight to the `for...of` below,
        // which throws `signupRows is not iterable` on every request. The route
        // has therefore never produced a cohort.
        //
        // The house convention is one file over: routes-platform-features reads
        // `result.rows?.[0]`. One honest cast remains — the ROW SHAPE, which
        // TypeScript genuinely cannot know from raw SQL — instead of a lie about
        // the container.
        const signupRows = signups.rows ?? [];
        const byCohort = new Map<string, SignupRow[]>();
        for (const row of signupRows) {
          if (!row.cohort || !row.organization_id) continue;
          const list = byCohort.get(row.cohort) ?? [];
          list.push(row);
          byCohort.set(row.cohort, list);
        }

        const cohorts: CohortRow[] = [];
        for (const [cohort, rows] of byCohort.entries()) {
          const orgIds = rows.map((r) => r.organization_id);
          const signupAtByOrg = new Map<number, Date>();
          for (const r of rows) {
            signupAtByOrg.set(r.organization_id, new Date(r.occurred_at));
          }

          const retention: Record<string, number> = {};
          for (const window of RETENTION_WINDOWS) {
            // For each org in the cohort, was there any engagement event
            // between signup and signup+window?
            let retained = 0;
            for (const orgId of orgIds) {
              const start = signupAtByOrg.get(orgId);
              if (!start) continue;
              const end = new Date(start.getTime() + window * 24 * 60 * 60 * 1000);
              const probe = await reader.execute(sql.raw(`
                SELECT 1
                FROM lifecycle_events
                WHERE organization_id = ${orgId}
                  AND occurred_at > '${start.toISOString()}'
                  AND occurred_at <= '${end.toISOString()}'
                  AND (stage IN ('engagement', 'activation') OR event_type LIKE 'engagement.%' OR event_type LIKE 'activation.%')
                LIMIT 1
              `));
              // Same defect, second read: `.length` on a QueryResult is
              // undefined, so `matched` was always 0 and `retained` was never
              // incremented — every cohort would have reported 0% retention even
              // if the loop above had survived to reach this line.
              const matched = probe.rows?.length ?? 0;
              if (matched > 0) retained++;
            }
            retention[`d${window}`] = orgIds.length > 0 ? retained / orgIds.length : 0;
          }

          cohorts.push({
            cohort,
            signupCount: orgIds.length,
            retention,
          });
        }

        cohorts.sort((a, b) => a.cohort.localeCompare(b.cohort));

        return res.json({
          cohorts,
          windows: [...RETENTION_WINDOWS],
          generatedAt: new Date().toISOString(),
          note:
            cohorts.length === 0
              ? "lifecycle_events is empty for the signup stage. Wire recordLifecycleEvent() into your signup flow + run the backfill script to populate."
              : undefined,
        });
      } catch (err: unknown) {
        logger.error("[cohort-retention] query failed", err);
        return Errors.internal(res, err);
      }
    },
  );
}
