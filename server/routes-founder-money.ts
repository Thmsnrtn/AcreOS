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
 * Honesty note (Lena): the summary endpoint does NOT present a runway
 * *model*. It returns an explicitly-labeled single-point estimate
 * (founder-declared cash ÷ trailing 30-day burn) and refuses to emit a
 * runway number at all when cash is undeclared. The three-scenario
 * runway engine (base/downside/upside) is a later elevation item; until
 * it ships, nothing here may be dressed up as a computed forecast.
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
        // HONESTY CONTRACT (Lena, 2026-06-07):
        // This is NOT a forecast model — it is a single-point estimate:
        //   founder-declared cash ÷ trailing-30-day burn.
        // The three-scenario runway engine (base/downside/upside) is a later
        // elevation item. Until it ships we MUST NOT dress this estimate up as
        // a computed model — we sell customers a provenance contract that
        // refuses unsourced numbers, so our own surface must do the same.
        // Therefore the response:
        //   - labels the method explicitly (`method`, `basis`, `isModeled`)
        //   - marks cash as founder-declared (an env override, not measured)
        //   - returns `runwayMonths: null` when cash is unset, so the UI shows
        //     "—" rather than a fabricated figure derived from a $0 assumption.
        //
        // Burn IS partly real: `aiBurnLast30dUsd` is the actual summed cost of
        // logged capital events over the trailing 30 days. Infra lines are env
        // knobs (Tom's self-reported fixed costs) and are flagged as such.
        const aiBurnLast30d = await sumCapitalSinceDays(30);
        const flyInfraUsd = envFloat("FLY_INFRA_MONTHLY_USD", 24);
        const otherInfraUsd = envFloat("OTHER_INFRA_MONTHLY_USD", 0);
        const monthlyBurnUsd = aiBurnLast30d + flyInfraUsd + otherInfraUsd;

        const cashDeclared = !!process.env.FOUNDER_CASH_ON_HAND_USD;
        const cashOnHandUsd = envFloat("FOUNDER_CASH_ON_HAND_USD", 0);

        // Only compute a runway figure when cash has actually been declared.
        // Dividing an undeclared (defaulted-to-0) cash position by burn yields
        // a misleading "0 months" — refuse to present that as a number.
        const runwayMonths =
          cashDeclared && monthlyBurnUsd > 0
            ? cashOnHandUsd / monthlyBurnUsd
            : null;

        return res.json({
          asOf: new Date().toISOString(),
          cashOnHandUsd,
          monthlyBurnUsd,
          runwayMonths:
            runwayMonths !== null && Number.isFinite(runwayMonths)
              ? runwayMonths
              : null,
          // Explicit honesty metadata so the surface never implies a model.
          method: "estimate",
          basis: "founder-declared cash ÷ trailing 30-day burn",
          isModeled: false,
          cashDeclared,
          source: {
            aiBurnLast30dUsd: aiBurnLast30d,
            flyInfraMonthlyUsd: flyInfraUsd,
            otherInfraMonthlyUsd: otherInfraUsd,
            // "founder-declared" when set via env, "unset" otherwise — never
            // presented as a measured/computed cash balance.
            cashSource: cashDeclared ? "founder-declared" : "unset",
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
