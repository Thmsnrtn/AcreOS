/**
 * Lifecycle endpoints (FW-CAMILA-2 + FW-CAMILA-3 + FW-WYNNE-2/3, push-forward 2026-05-08):
 *
 *   POST /api/nps/submit                 — customer submits a 0-10 NPS score
 *   GET  /api/founder/nps/recent         — founder pulls recent scores
 *   GET  /api/founder/power-users        — top-cohort dashboard (180-6)
 *   POST /api/founder/pre-churn/sweep    — run the rung evaluator
 *   GET  /api/founder/retention/policies — list retention rules
 *   POST /api/founder/retention/policies — set/upsert a retention rule
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  npsMicroSurveys,
  preChurnRungs,
  retentionPolicies,
  organizations,
  leads,
  deals,
  notes as notesTable,
} from "@shared/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const npsSubmitSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().max(2000).optional(),
  surveyTrigger: z.enum(["d7", "d30", "adhoc"]).optional(),
});

const retentionPolicySchema = z.object({
  tableKey: z.string().min(1).max(80),
  retentionKind: z.enum(["hard_delete", "anonymize", "archive"]),
  retentionDays: z.number().int().min(1).max(36500),
  legalBasis: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
});

const PRE_CHURN_RUNGS = ["d5", "d10", "d14", "d21", "d30"] as const;
const RUNG_DAYS: Record<typeof PRE_CHURN_RUNGS[number], number> = {
  d5: 5, d10: 10, d14: 14, d21: 21, d30: 30,
};

export function registerLifecycleRoutes(app: Express): void {
  // ─── NPS micro-survey ────────────────────────────────────────────
  app.post(
    "/api/nps/submit",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = npsSubmitSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const [row] = await db.insert(npsMicroSurveys).values({
          organizationId: orgId,
          userId,
          score: parsed.data.score,
          comment: parsed.data.comment ?? null,
          surveyTrigger: parsed.data.surveyTrigger ?? "d7",
        }).returning();
        return res.json(row);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/founder/nps/recent",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = Math.min(Number(req.query.limit ?? 200), 1000);
        const rows = await db
          .select()
          .from(npsMicroSurveys)
          .orderBy(desc(npsMicroSurveys.submittedAt))
          .limit(limit);

        const promoters = rows.filter(r => r.score >= 9).length;
        const detractors = rows.filter(r => r.score <= 6).length;
        const passives = rows.length - promoters - detractors;
        const npsScore = rows.length
          ? Math.round(((promoters - detractors) / rows.length) * 100)
          : null;

        return res.json({
          rows,
          summary: {
            count: rows.length,
            promoters,
            passives,
            detractors,
            npsScore,
          },
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ─── FW-CAMILA-1B power-user dashboard (180-6) ───────────────────
  // "Power-user" cohort = orgs with ≥10 leads OR ≥3 deals OR ≥1 note
  // in the last 30 days. Exposes the cohort + counts so the founder
  // can call them by name.
  app.get(
    "/api/founder/power-users",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const leadsByOrg = await db
          .select({
            organizationId: leads.organizationId,
            c: sql<string>`count(*)`,
          })
          .from(leads)
          .where(gte(leads.createdAt, thirtyDaysAgo))
          .groupBy(leads.organizationId);

        const dealsByOrg = await db
          .select({
            organizationId: deals.organizationId,
            c: sql<string>`count(*)`,
          })
          .from(deals)
          .where(gte(deals.createdAt, thirtyDaysAgo))
          .groupBy(deals.organizationId);

        const notesByOrg = await db
          .select({
            organizationId: notesTable.organizationId,
            c: sql<string>`count(*)`,
          })
          .from(notesTable)
          .where(gte(notesTable.createdAt, thirtyDaysAgo))
          .groupBy(notesTable.organizationId);

        const counts = new Map<number, { leads: number; deals: number; notes: number }>();
        for (const r of leadsByOrg) {
          if (r.organizationId == null) continue;
          counts.set(r.organizationId, {
            leads: Number(r.c),
            deals: 0,
            notes: 0,
          });
        }
        for (const r of dealsByOrg) {
          if (r.organizationId == null) continue;
          const e = counts.get(r.organizationId) ?? { leads: 0, deals: 0, notes: 0 };
          e.deals = Number(r.c);
          counts.set(r.organizationId, e);
        }
        for (const r of notesByOrg) {
          if (r.organizationId == null) continue;
          const e = counts.get(r.organizationId) ?? { leads: 0, deals: 0, notes: 0 };
          e.notes = Number(r.c);
          counts.set(r.organizationId, e);
        }

        const powerUserOrgIds = Array.from(counts.entries())
          .filter(([_, c]) => c.leads >= 10 || c.deals >= 3 || c.notes >= 1)
          .map(([id]) => id);

        const orgRows = powerUserOrgIds.length
          ? await db
              .select()
              .from(organizations)
              .where(sql`${organizations.id} = ANY(ARRAY[${sql.raw(powerUserOrgIds.join(","))}]::int[])`)
          : [];

        const list = orgRows.map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          tier: o.subscriptionTier,
          activity: counts.get(o.id) ?? { leads: 0, deals: 0, notes: 0 },
        }));

        return res.json({
          windowDays: 30,
          totalPowerUsers: list.length,
          orgs: list.sort((a, b) => {
            const aw = a.activity.leads + a.activity.deals * 5 + a.activity.notes * 10;
            const bw = b.activity.leads + b.activity.deals * 5 + b.activity.notes * 10;
            return bw - aw;
          }),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ─── FW-CAMILA-3 pre-churn rung sweep (180-8) ────────────────────
  // Founder-triggered (or cron-triggered later) sweep. For each org
  // with no leads/deals/notes activity in N days, fire the matching
  // rung — but only if we haven't fired it already (unique index).
  app.post(
    "/api/founder/pre-churn/sweep",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const now = Date.now();
        const fired: { orgId: number; rung: string }[] = [];
        const skipped: { orgId: number; rung: string; reason: string }[] = [];

        const orgRows = await db.select().from(organizations).limit(10000);

        for (const org of orgRows) {
          if (org.subscriptionStatus !== "active") continue;

          // Most recent activity across the 3 surfaces.
          const [recentLead] = await db
            .select({ at: sql<string>`max(${leads.createdAt})` })
            .from(leads)
            .where(eq(leads.organizationId, org.id));
          const [recentDeal] = await db
            .select({ at: sql<string>`max(${deals.createdAt})` })
            .from(deals)
            .where(eq(deals.organizationId, org.id));
          const [recentNote] = await db
            .select({ at: sql<string>`max(${notesTable.createdAt})` })
            .from(notesTable)
            .where(eq(notesTable.organizationId, org.id));

          const lastActivityIso = [recentLead?.at, recentDeal?.at, recentNote?.at]
            .filter((x): x is string => !!x)
            .sort()
            .at(-1);
          if (!lastActivityIso) continue;
          const daysSilent = Math.floor(
            (now - new Date(lastActivityIso).getTime()) / (24 * 60 * 60 * 1000),
          );

          // Pick the highest-numbered rung whose threshold is satisfied.
          const ladder: typeof PRE_CHURN_RUNGS[number][] = ["d30", "d21", "d14", "d10", "d5"];
          const rung = ladder.find((r) => daysSilent >= RUNG_DAYS[r]);
          if (!rung) continue;

          try {
            const inserted = await db
              .insert(preChurnRungs)
              .values({ organizationId: org.id, rung })
              .onConflictDoNothing({
                target: [preChurnRungs.organizationId, preChurnRungs.rung],
              })
              .returning({ id: preChurnRungs.id });

            if (inserted.length === 0) {
              skipped.push({ orgId: org.id, rung, reason: "already_fired" });
            } else {
              fired.push({ orgId: org.id, rung });
            }
          } catch (err) {
            logger.warn(
              `[pre-churn sweep] insert failed for org ${org.id} rung ${rung}`,
              err instanceof Error ? err : undefined,
            );
          }
        }

        return res.json({
          firedCount: fired.length,
          skippedCount: skipped.length,
          fired,
          skipped: skipped.slice(0, 50),
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ─── FW-WYNNE-3 retention policy admin ───────────────────────────
  app.get(
    "/api/founder/retention/policies",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select()
          .from(retentionPolicies)
          .orderBy(retentionPolicies.tableKey);
        return res.json({ rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ─── FW-OLU-2 synthetic checks (180-5) ───────────────────────────
  app.post(
    "/api/founder/synthetic-checks/run",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { runAllSyntheticChecks } = await import("./services/syntheticChecks");
        const results = await runAllSyntheticChecks();
        const summary = {
          total: results.length,
          ok: results.filter((r) => r.status === "ok").length,
          degraded: results.filter((r) => r.status === "degraded").length,
          failing: results.filter((r) => r.status === "failing").length,
        };
        return res.json({ summary, results });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/founder/synthetic-checks/recent",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const { syntheticCheckRuns } = await import("@shared/schema");
        const rows = await db
          .select()
          .from(syntheticCheckRuns)
          .orderBy(desc(syntheticCheckRuns.runAt))
          .limit(200);
        return res.json({ rows });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/founder/retention/policies",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = retentionPolicySchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const [row] = await db
          .insert(retentionPolicies)
          .values({
            tableKey: parsed.data.tableKey,
            retentionKind: parsed.data.retentionKind,
            retentionDays: parsed.data.retentionDays,
            legalBasis: parsed.data.legalBasis ?? null,
            enabled: parsed.data.enabled ?? true,
          })
          .onConflictDoUpdate({
            target: retentionPolicies.tableKey,
            set: {
              retentionKind: parsed.data.retentionKind,
              retentionDays: parsed.data.retentionDays,
              legalBasis: parsed.data.legalBasis ?? null,
              enabled: parsed.data.enabled ?? true,
              updatedAt: new Date(),
            },
          })
          .returning();
        return res.json(row);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
