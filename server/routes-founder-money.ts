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
import { readUnitEconomicsRollup } from "./services/unitEconomics";
import { getContributionMargin } from "./services/financial-ledger";
import { organizations } from "@shared/schema";
import { monthlyRevenueCentsFor, tierForSubscriptionTier } from "@shared/billing/tier-pricing";
import type { BillingInterval } from "@shared/billing/tier-pricing";
import {
  evaluatePaidProviderGate,
  MIN_MRR_FOR_PAID_DATA_DOLLARS,
} from "@shared/billing/data-procurement-policy";
import { getLatestEvalRun } from "./services/paidDataEvalHarness";
import { regridProvider } from "./services/providers/regrid-provider";

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

        // Map the server status vocabulary (green/amber/red) onto the
        // client EnvelopeRow.statusTone contract (ok/warn/over). The two
        // surfaces must agree or a wired, healthy envelope renders the
        // gray "Phase 0" placeholder badge.
        const TONE_MAP: Record<EnvelopeStatus, "ok" | "warn" | "over"> = {
          green: "ok",
          amber: "warn",
          red: "over",
        };

        const envelopes = [
          {
            id: "build",
            label: "AI ops (Solene + Pax)",
            description:
              "Solene + Pax model/API spend against the charter monthly cap.",
            limitUsd: aiLimit,
            spentUsd: aiSpent,
            statusTone: TONE_MAP[envelopeStatus(aiSpent, aiLimit)],
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

  // ── Unit economics: LTV : CAC : payback (Lena #3, honest) ───────────────
  //
  // Blended gross margin (from the nightly rollup) + cohort contribution
  // margin keyed by signup-month (from the financial ledger). LTV:CAC and
  // payback are reported "N/A (no CAC data yet)" — there is no marketing-spend
  // numerator on the ledger, and we never fabricate a metric we can't source.
  // The day a `marketing_spend` ledger feature exists, `cacAvailable` flips
  // true and these compute for real; until then the surface tells the truth.
  app.get(
    "/api/founder/money/unit-economics",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rollup = await readUnitEconomicsRollup();

        // Cohort contribution margin: group paying active orgs by signup month
        // and sum each cohort's trailing-window contribution off the ledger.
        const orgs = await db
          .select({
            id: organizations.id,
            tier: organizations.subscriptionTier,
            status: organizations.subscriptionStatus,
            interval: organizations.billingInterval,
            createdAt: organizations.createdAt,
          })
          .from(organizations);

        const cohortMap = new Map<
          string,
          { customers: number; mrrUsd: number; contributionUsd: number }
        >();
        for (const o of orgs) {
          if (o.status !== "active") continue;
          if (tierForSubscriptionTier(o.tier) === null) continue; // free → skip
          const created = o.createdAt ? new Date(o.createdAt) : null;
          const cohort = created
            ? `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, "0")}`
            : "unknown";
          const mrrUsd =
            monthlyRevenueCentsFor(
              o.tier,
              (o.interval as BillingInterval) ?? "monthly",
            ) / 100;
          const cm = await getContributionMargin(o.id, 30);
          const entry =
            cohortMap.get(cohort) ?? { customers: 0, mrrUsd: 0, contributionUsd: 0 };
          entry.customers += 1;
          entry.mrrUsd += mrrUsd;
          entry.contributionUsd += cm.marginCents / 100;
          cohortMap.set(cohort, entry);
        }

        const cohortContribution = Array.from(cohortMap.entries())
          .map(([cohort, v]) => ({
            cohort,
            customers: v.customers,
            mrrUsd: Math.round(v.mrrUsd * 100) / 100,
            contributionUsd: Math.round(v.contributionUsd * 100) / 100,
            contributionPerCustomerUsd:
              v.customers > 0
                ? Math.round((v.contributionUsd / v.customers) * 100) / 100
                : 0,
          }))
          .sort((a, b) => a.cohort.localeCompare(b.cohort));

        return res.json({
          asOf: new Date().toISOString(),
          blendedGrossMarginPct: rollup.totals.grossMarginPct,
          blendedGrossMarginUsd: rollup.totals.grossMarginUsd,
          totalMrrUsd: rollup.totals.totalMrrUsd,
          payingCustomerCount: rollup.totals.payingCustomerCount,
          cohortContribution,
          // Honesty: no CAC numerator exists yet (no marketing_spend feature).
          cacAvailable: false,
          ltvCacRatio: null,
          paybackMonths: null,
          // Phase-gate reference lines for the eventual chart.
          thresholds: {
            grossMarginFloorPct: 70, // charter: ≥70% sustained
            ltvCacFloor: 3, // charter: ≥3:1 at Phase 3
            paybackCeilingMonths: 12, // charter: <12mo at Phase 2
          },
          note: "LTV:CAC and payback are N/A until a marketing_spend ledger feature provides a CAC numerator. Gross margin + cohort contribution are real.",
        });
      } catch (err) {
        logger.error(
          "[founder/money/unit-economics] failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );

  // ── Paid-Data Readiness (Lena #6) ───────────────────────────────────────
  //
  // The self-announcing buy trigger. Combines the live gate
  // (evaluatePaidProviderGate, fed real trailing MRR off the ledger) + the
  // latest no-spend eval run's decision-flip count + Regrid's per-provider
  // monthly commit → a single "Regrid is / isn't justified yet" verdict.
  app.get(
    "/api/founder/money/paid-data-readiness",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        // Trailing MRR (dollars) from live paying orgs — the same basis the
        // runway model uses, so the gate reads the real number.
        const orgs = await db
          .select({
            tier: organizations.subscriptionTier,
            status: organizations.subscriptionStatus,
            interval: organizations.billingInterval,
          })
          .from(organizations);
        let mrrCents = 0;
        for (const o of orgs) {
          if (o.status !== "active") continue;
          mrrCents += monthlyRevenueCentsFor(
            o.tier,
            (o.interval as BillingInterval) ?? "monthly",
          );
        }
        const trailingMrrDollars = mrrCents / 100;

        const minMonthlyCommitCents = regridProvider.minMonthlyCommitCents ?? 0;
        const gate = evaluatePaidProviderGate({
          trailingMrrDollars,
          minMonthlyCommitCents,
        });

        const latestRun = await getLatestEvalRun(null);
        const decisionFlipCount = latestRun?.result.decisionFlipCount ?? null;
        const decisionFlipRate = latestRun?.result.decisionFlipRate ?? null;
        const parcelsCompared = latestRun?.result.parcelsCompared ?? null;

        // Justified only when BOTH the financial gate clears AND the eval shows
        // at least one decision actually flips (buying data that changes no
        // decision is waste, regardless of MRR).
        const evalShowsValue =
          decisionFlipCount != null && decisionFlipCount > 0;
        const justified = gate.allowed && evalShowsValue;

        let verdict: string;
        if (!gate.allowed) {
          verdict = gate.reason;
        } else if (latestRun == null) {
          verdict =
            "Financial gate clears — but no eval run yet. Run the paid-data eval to confirm decisions actually flip before buying.";
        } else if (!evalShowsValue) {
          verdict =
            "Financial gate clears, but the latest eval shows 0 decision flips — free data already nails these parcels. Not justified.";
        } else {
          const pct =
            decisionFlipRate != null ? Math.round(decisionFlipRate * 1000) / 10 : 0;
          verdict = `Regrid pay-per-call is now justified — ${pct}% of worked parcels (${decisionFlipCount}/${parcelsCompared}) would flip a decision, gate cleared.`;
        }

        return res.json({
          asOf: new Date().toISOString(),
          provider: regridProvider.displayName,
          justified,
          verdict,
          gate: {
            allowed: gate.allowed,
            reason: gate.reason,
            trailingMrrDollars: Math.round(trailingMrrDollars * 100) / 100,
            mrrGateDollars: MIN_MRR_FOR_PAID_DATA_DOLLARS,
            commitCeilingCents: gate.commitCeilingCents,
            minMonthlyCommitCents,
          },
          eval: {
            hasRun: latestRun != null,
            ranAt: latestRun?.createdAt ?? null,
            decisionFlipCount,
            decisionFlipRate,
            parcelsCompared,
          },
        });
      } catch (err) {
        logger.error(
          "[founder/money/paid-data-readiness] failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );
}
