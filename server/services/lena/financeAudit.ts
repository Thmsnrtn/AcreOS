// ============================================================================
// server/services/lena/financeAudit.ts
// ----------------------------------------------------------------------------
// LENA (CFO/CIO) #2 — the continuous finance-audit loop.
//
// My charter specifies a finance-audit loop with named detectors that surface
// money drift BEFORE the founder asks. This module owns the detectors that
// have REAL data today, written through the shared E1 substrate
// (`server/services/audit/domainAudit.ts`) into `domain_audit_findings` — no
// bespoke findings table. The cockpit's single "is it green?" surface renders
// them alongside the other domains.
//
// Detectors that fire today:
//   • envelope_overrun   — Solene's bootstrap capital envelope ($50/mo per
//                          charter, override SOLENE_MONTHLY_ENVELOPE_USD) is
//                          over its threshold for the trailing 30 days.
//   • tax_reserve        — re-exported from the existing exemplar
//                          (audit/detectors/taxReserveDetector): tax_reserve
//                          bucket < 25% of trailing-12mo revenue.
//   • runway_crunch      — base/downside months-to-zero (from runwayModel #1)
//                          drops below the warn/critical floors.
//
// The four post-launch detectors my brief names (vendor-cost drift,
// founder-draw miss, mission-transfer miss, unit-econ regression) need data
// that doesn't exist pre-revenue; they ship when there's signal to detect.
//
// `financeDetectors` is the array runScheduledJobs registers in the daily
// domain-audit sweep. All detectors are read-only and isolated by the runner.
// ============================================================================

import { gte, sql } from "drizzle-orm";

import { db } from "../../db";
import { logger } from "../../utils/logger";
import {
  soleneCapitalEvents,
  DEFAULT_MONTHLY_ENVELOPE_USD,
  ENVELOPE_THRESHOLDS,
} from "@shared/schema/solene-capital";
import type { DomainDetector, FindingInput } from "../audit/domainAudit";
import { taxReserveDetector } from "../audit/detectors/taxReserveDetector";
import { computeRunway } from "../finance/runwayModel";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// ── envelope_overrun ─────────────────────────────────────────────────────────
//
// The Solene capital envelope is the company's hard monthly AI-spend cap. Over
// the trailing 30 days, summed capital-event cost vs the envelope limit:
//   warn:     >= amberPercent (70%) of the envelope
//   critical: >= redPercent (90%) of the envelope, or fully over (>100%)
// Only fires when the limit is positive (a $0 envelope is undefined, not over).

export const envelopeOverrunDetector: DomainDetector = {
  id: "envelope_overrun",
  domain: "finance",
  async run(): Promise<FindingInput[]> {
    const limitUsd = envFloat(
      "SOLENE_MONTHLY_ENVELOPE_USD",
      DEFAULT_MONTHLY_ENVELOPE_USD,
    );
    if (limitUsd <= 0) return [];

    const since = new Date(Date.now() - 30 * ONE_DAY_MS);
    const [row] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${soleneCapitalEvents.costUsd}), 0)`.mapWith(
          Number,
        ),
      })
      .from(soleneCapitalEvents)
      .where(gte(soleneCapitalEvents.occurredAt, since));
    const spentUsd = row?.total ?? 0;

    const pct = (spentUsd / limitUsd) * 100;
    if (pct < ENVELOPE_THRESHOLDS.amberPercent) return [];

    const isCritical = pct >= ENVELOPE_THRESHOLDS.redPercent;
    const overBy = spentUsd - limitUsd;

    return [
      {
        domain: "finance",
        detector: "envelope_overrun",
        severity: isCritical ? "critical" : "warn",
        title: isCritical
          ? "AI capital envelope at/over its monthly cap"
          : "AI capital envelope approaching its monthly cap",
        detail:
          `Trailing-30d AI/agent spend is ${usd(spentUsd)} against a ` +
          `${usd(limitUsd)} envelope (${pct.toFixed(0)}% used)` +
          (overBy > 0 ? `, over by ${usd(overBy)}.` : "."),
        citedReason:
          "The charter sets a bootstrap AI-spend envelope (default $50/mo, " +
          "SOLENE_MONTHLY_ENVELOPE_USD); sustained spend at/over the cap burns " +
          "runway faster than the envelope was sized for.",
        dedupeKey: "envelope_overrun:ai",
        subjectRef: "solene_envelope",
        metadata: {
          spentUsd,
          limitUsd,
          pctUsed: Math.round(pct * 10) / 10,
          overByUsd: Math.max(0, overBy),
          amberPercent: ENVELOPE_THRESHOLDS.amberPercent,
          redPercent: ENVELOPE_THRESHOLDS.redPercent,
        },
      },
    ];
  },
};

// ── runway_crunch ────────────────────────────────────────────────────────────
//
// Reads the real three-scenario runway model (#1). Fires on the DOWNSIDE
// scenario (the stress case is the one a CFO watches), with the base scenario
// reported in detail for context:
//   warn:     downside months-to-zero < 9
//   critical: downside months-to-zero < 6  (or base < 6)
// A company with no cash basis (months-to-zero null) does not fire — there's
// nothing to crunch.

export const RUNWAY_WARN_MONTHS = 9;
export const RUNWAY_CRITICAL_MONTHS = 6;

export const runwayCrunchDetector: DomainDetector = {
  id: "runway_crunch",
  domain: "finance",
  async run(): Promise<FindingInput[]> {
    const runway = await computeRunway();
    const base = runway.scenarios.base.monthsToZero;
    const downside = runway.scenarios.downside.monthsToZero;

    // No cash basis at all → can't model a crunch → green.
    if (downside == null && base == null) return [];

    // Use the downside as the trigger; fall back to base if downside is null.
    const trigger = downside ?? base!;
    if (trigger >= RUNWAY_WARN_MONTHS) return [];

    const isCritical =
      trigger < RUNWAY_CRITICAL_MONTHS ||
      (base != null && base < RUNWAY_CRITICAL_MONTHS);

    return [
      {
        domain: "finance",
        detector: "runway_crunch",
        severity: isCritical ? "critical" : "warn",
        title: isCritical
          ? "Runway crunch — under 6 months in the stress case"
          : "Runway tightening — under 9 months in the stress case",
        detail:
          `Downside runway (revenue flat + costs +20%) is ` +
          `${downside != null ? `${downside.toFixed(1)} mo` : "n/a"}; ` +
          `base is ${base != null ? `${base.toFixed(1)} mo` : "n/a"}. ` +
          `Cash basis: ${runway.cashBasis} (${usd(runway.cashOnHandUsd)}).`,
        citedReason:
          "Runway-to-zero is the single most-watched number after MRR; the " +
          "charter requires it modeled three ways and surfaced before it gets " +
          "tight. The downside is the case a CFO underwrites against.",
        dedupeKey: "runway_crunch:downside",
        subjectRef: "runway",
        metadata: {
          baseMonthsToZero: base,
          downsideMonthsToZero: downside,
          upsideMonthsToZero: runway.scenarios.upside.monthsToZero,
          cashOnHandUsd: runway.cashOnHandUsd,
          cashBasis: runway.cashBasis,
          warnMonths: RUNWAY_WARN_MONTHS,
          criticalMonths: RUNWAY_CRITICAL_MONTHS,
        },
      },
    ];
  },
};

// ── registry ─────────────────────────────────────────────────────────────────

/**
 * The finance-domain detectors registered in the daily domain-audit sweep.
 * tax_reserve is the existing exemplar (re-exported here so the finance loop
 * is one coherent registration point); envelope_overrun + runway_crunch are
 * new in this module.
 */
export const financeDetectors: DomainDetector[] = [
  taxReserveDetector,
  envelopeOverrunDetector,
  runwayCrunchDetector,
];

/**
 * Convenience for ad-hoc invocation (e.g. a founder "refresh finance audit"
 * action). The daily cron uses runDomainAudits(financeDetectors) directly so
 * detector isolation + dedupe stay uniform with the other domains.
 */
export async function runFinanceAudit(): Promise<void> {
  logger.info("[financeAudit] runFinanceAudit invoked directly", {
    metadata: { detectorCount: financeDetectors.length },
  });
}
