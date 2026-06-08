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
 * Honesty note (Lena, 2026-06-08): the summary endpoint now presents the REAL
 * three-scenario runway model (`server/services/finance/runwayModel.ts`),
 * replacing the honest-but-crude P0 placeholder (founder-declared cash ÷
 * trailing 30-day burn). Cash is read off the real reserve buckets on the
 * financial_ledger; burn off opex_spent rows + solene_capital_events; MRR off
 * live paying orgs. The founder-declared env cash remains ONLY as a labeled
 * override when it exceeds the ledger balance. The legacy single-point fields
 * (`runwayMonths`, `method`, `basis`) are kept for UI back-compat, fed from the
 * base scenario, and `isModeled` is now true.
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
import { computeRunway } from "./services/finance/runwayModel";

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
        // REAL three-scenario runway model (Lena #1). Reads cash off the
        // reserve buckets, burn off the ledger + solene_capital_events, MRR off
        // live paying orgs. The founder-declared env cash is a labeled override
        // only (used when it exceeds the ledger). This IS a model now.
        const runway = await computeRunway();

        const base = runway.scenarios.base;
        // Legacy single-point fields kept for UI back-compat — fed from base.
        // monthlyBurnUsd is the GROSS base costs (pre-MRR-offset) so the old
        // "$X / mo burn" label still reads as total spend.
        const monthlyBurnUsd = base.monthlyCostsUsd;
        // runwayMonths is the base scenario's months-to-zero; null only when
        // there's no cash basis at all (so the UI shows "—", never a fake 0).
        const runwayMonths = base.monthsToZero;

        return res.json({
          asOf: runway.asOf,
          cashOnHandUsd: runway.cashOnHandUsd,
          monthlyBurnUsd,
          runwayMonths,
          // The model now stands behind these numbers.
          method: "model",
          basis: "three-scenario runway off the financial ledger (base shown)",
          isModeled: true,
          cashDeclared: runway.cashBasis === "founder-declared",
          cashBasis: runway.cashBasis,
          // The full three-scenario block + transparency inputs.
          scenarios: runway.scenarios,
          inputs: runway.inputs,
          source: {
            ledgerCashUsd: runway.inputs.ledgerCashUsd,
            founderDeclaredCashUsd: runway.inputs.founderDeclaredCashUsd,
            monthlyOpexUsd: runway.inputs.monthlyOpexUsd,
            monthlyAiBurnUsd: runway.inputs.monthlyAiBurnUsd,
            fixedInfraMonthlyUsd: runway.inputs.fixedInfraMonthlyUsd,
            mrrUsd: runway.inputs.mrrUsd,
            cashSource: runway.cashBasis,
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
