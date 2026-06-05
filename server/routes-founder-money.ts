/**
 * Founder Money endpoints.
 *
 *   GET /api/founder/money/summary    — cash on hand + monthly burn + runway
 *   GET /api/founder/money/envelopes  — envelope limits + spent + status tone
 *   GET /api/founder/money/events     — recent capital_events (top 20)
 *
 * Before this file existed, the /founder/money page queried these paths,
 * silently 404'd, and rendered "Phase 0 placeholder" copy — looking like
 * a stub by design but actually meaning "endpoint missing." Surfaced by
 * the 2026-06-05 founder audit. This restores the contract so the page
 * tells the truth: real numbers when data exists, honest "no entries
 * yet" when not.
 *
 * Data sources:
 *   - solene_capital_events (cost ledger — sources `recordCapitalEvent`
 *     calls across the dispatch + chat paths)
 *   - env-configurable AcreOS-side cost lines (FLY_INFRA_MONTHLY_USD,
 *     OTHER_INFRA_MONTHLY_USD) for non-AI burn
 *   - env-configurable cash position (FOUNDER_CASH_ON_HAND_USD)
 *
 * Phase 1 (Lena) replaces the env-configurable knobs with a real capital
 * ledger; until then, the env values let Tom self-report his runway.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { db } from "./db";
import {
  soleneCapitalEvents,
  DEFAULT_MONTHLY_ENVELOPE_USD,
  ENVELOPE_THRESHOLDS,
  type EnvelopeStatus,
} from "@shared/schema/solene-capital";
import { and, desc, gte, sql } from "drizzle-orm";
import { logger } from "./utils/logger";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envelopeStatus(spentUsd: number, limitUsd: number): EnvelopeStatus {
  if (limitUsd <= 0) return "green";
  const pct = (spentUsd / limitUsd) * 100;
  if (pct >= ENVELOPE_THRESHOLDS.redPercent) return "red";
  if (pct >= ENVELOPE_THRESHOLDS.amberPercent) return "amber";
  return "green";
}

async function sumCapitalSinceDays(days: number): Promise<number> {
  const since = new Date(Date.now() - days * ONE_DAY_MS);
  const [row] = await db
    .select({
      sum: sql<string>`COALESCE(SUM(${soleneCapitalEvents.costUsd}), 0)`,
    })
    .from(soleneCapitalEvents)
    .where(gte(soleneCapitalEvents.occurredAt, since));
  return Number(row?.sum ?? 0);
}

export function registerFounderMoneyRoutes(app: Express): void {
  // ── Summary ───────────────────────────────────────────────────────────
  app.get(
    "/api/founder/money/summary",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        // 30d of AI capital events + infra burn = a believable monthly burn.
        // Tom can override the infra knobs via env if his real numbers diverge.
        const aiBurnLast30d = await sumCapitalSinceDays(30);
        const flyInfraUsd = envFloat("FLY_INFRA_MONTHLY_USD", 24);
        const otherInfraUsd = envFloat("OTHER_INFRA_MONTHLY_USD", 0);
        const monthlyBurnUsd = aiBurnLast30d + flyInfraUsd + otherInfraUsd;

        const cashOnHandUsd = envFloat("FOUNDER_CASH_ON_HAND_USD", 0);

        const runwayMonths =
          monthlyBurnUsd > 0
            ? cashOnHandUsd / monthlyBurnUsd
            : Number.POSITIVE_INFINITY;

        return res.json({
          asOf: new Date().toISOString(),
          cashOnHandUsd,
          monthlyBurnUsd,
          runwayMonths: Number.isFinite(runwayMonths) ? runwayMonths : null,
          source: {
            aiBurnLast30dUsd: aiBurnLast30d,
            flyInfraMonthlyUsd: flyInfraUsd,
            otherInfraMonthlyUsd: otherInfraUsd,
            cashSource: process.env.FOUNDER_CASH_ON_HAND_USD
              ? "env"
              : "unset",
          },
        });
      } catch (err) {
        logger.error(
          "[founder/money/summary] failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );

  // ── Envelopes ─────────────────────────────────────────────────────────
  // For now, single AI envelope at the charter default. As Lena's capital
  // categorization ships, this grows into build/brand/ops splits keyed on
  // event_type or a categorization column on solene_capital_events.
  app.get(
    "/api/founder/money/envelopes",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const aiLimit = envFloat(
          "SOLENE_MONTHLY_ENVELOPE_USD",
          DEFAULT_MONTHLY_ENVELOPE_USD,
        );
        const aiSpent = await sumCapitalSinceDays(30);

        const envelopes = [
          {
            id: "build",
            label: "AI ops (Solene + Pax)",
            limitUsd: aiLimit,
            spentUsd: aiSpent,
            statusTone: envelopeStatus(aiSpent, aiLimit),
          },
        ];

        return res.json({ envelopes });
      } catch (err) {
        logger.error(
          "[founder/money/envelopes] failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );

  // ── Events ────────────────────────────────────────────────────────────
  app.get(
    "/api/founder/money/events",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select({
            id: soleneCapitalEvents.id,
            occurredAt: soleneCapitalEvents.occurredAt,
            eventType: soleneCapitalEvents.eventType,
            costUsd: soleneCapitalEvents.costUsd,
            contextSummary: soleneCapitalEvents.contextSummary,
          })
          .from(soleneCapitalEvents)
          .where(
            and(
              gte(
                soleneCapitalEvents.occurredAt,
                new Date(Date.now() - 90 * ONE_DAY_MS),
              ),
              sql`${soleneCapitalEvents.costUsd} > 0`,
            ),
          )
          .orderBy(desc(soleneCapitalEvents.occurredAt))
          .limit(20);

        return res.json({
          events: rows.map((r) => ({
            id: r.id,
            occurredAt: r.occurredAt,
            label:
              r.contextSummary.length > 80
                ? r.contextSummary.slice(0, 77) + "…"
                : r.contextSummary,
            amountUsd: Number(r.costUsd),
            envelopeId: "build",
          })),
        });
      } catch (err) {
        logger.error(
          "[founder/money/events] failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );
}
