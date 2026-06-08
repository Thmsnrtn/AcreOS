/**
 * Burn-rate monitor (Tess #3) — the push half of the SLO story.
 *
 * `routes-error-budget.ts` is pull-only: it computes consumption when the
 * founder opens the page. This monitor runs every 5 minutes on the worker and
 * watches the SAME SLOs against rolling windows, so the SLOs *defend
 * themselves* instead of waiting to be read.
 *
 * Multi-window alerting (Google SRE workbook, scaled for a small shop):
 *   - FAST burn: ≥ 2% of the monthly error budget burned in the last 1h
 *       → PAGE. notifyOnCall(P0) for the AI SLO (customer-facing) /
 *         notifyOnCall(P1) for the job SLO (internal), AND auto-open an
 *         `incidents` row with detectionSource:"burn_rate", AND auto-attach the
 *         blameless post-mortem template. This is "we have SLOs" becoming "our
 *         SLOs defend themselves."
 *   - SLOW burn: ≥ 10% of the monthly error budget burned in the last 6h
 *       → WARN. recordFinding(domain:"reliability", severity:"warn"). Non-paging
 *         — it shows up in the founder's continuous-audit cockpit, not on the
 *         phone at 3am.
 *
 * Dedupe: an open burn_rate incident for the same SLO suppresses re-paging on
 * the next 5-min tick (we don't want to ring the phone every 5 minutes for one
 * sustained outage). The slow-burn finding dedupes natively via recordFinding's
 * (detector, dedupe_key) upsert.
 *
 * Substrate reused (not modified): server/services/oncall.ts notifyOnCall,
 * server/services/audit/domainAudit.ts recordFinding, the incidents table.
 */

import { db } from "../../db";
import { incidents } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { notifyOnCall, type OnCallSeverity } from "../oncall";
import { recordFinding } from "../audit/domainAudit";
import {
  aiSuccessBurnRate,
  jobSuccessBurnRate,
  type BurnRateWindow,
} from "./sloCompute";

const HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * HOUR_MS;

// Thresholds, in "% of the monthly error budget burned within the window."
const FAST_BURN_PCT = 2; // 2% in 1h  → page
const SLOW_BURN_PCT = 10; // 10% in 6h → warn

// Per-SLO config: how the burn maps to a page severity and an incident title.
interface SloAlertConfig {
  sloId: string;
  label: string; // human name in alerts
  pageSeverity: OnCallSeverity; // P0 (customer-facing) | P1 (internal)
  incidentSeverity: string; // SEV-1 | SEV-2 — for the incidents row
  fast: (windowMs: number, windowLabel: string) => Promise<BurnRateWindow>;
  slow: (windowMs: number, windowLabel: string) => Promise<BurnRateWindow>;
}

const SLO_CONFIGS: SloAlertConfig[] = [
  {
    sloId: "ai_request_success",
    label: "AI request success",
    pageSeverity: "P0", // customer-facing — page now
    incidentSeverity: "SEV-1",
    fast: aiSuccessBurnRate,
    slow: aiSuccessBurnRate,
  },
  {
    sloId: "background_job_success",
    label: "Background job success",
    pageSeverity: "P1", // internal — urgent but not customer-facing
    incidentSeverity: "SEV-2",
    fast: jobSuccessBurnRate,
    slow: jobSuccessBurnRate,
  },
];

// The blameless post-mortem template, auto-attached to burn_rate incidents so a
// resolver always has the structure in front of them. Pointer (not inlined
// body) keeps the incidents row small and the canonical template single-source.
const POST_MORTEM_TEMPLATE_PATH = "docs/runbooks/_postmortem-template.md";

export interface BurnRateRunResult {
  evaluated: number;
  fastBreaches: number;
  slowBreaches: number;
  incidentsOpened: number;
  pagesSent: number;
  findingsRecorded: number;
}

/**
 * Is there already an OPEN burn_rate incident for this SLO? If so we don't
 * re-page on this tick — one sustained outage should ring the phone once, then
 * live in the open incident until acked/resolved.
 */
async function hasOpenBurnRateIncident(sloId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(
      and(
        eq(incidents.detectionSource, "burn_rate"),
        inArray(incidents.status, ["open", "mitigated"]),
        sql`${incidents.rootCauseCategory} = ${"slo:" + sloId}`,
      ),
    )
    .limit(1);
  return !!row;
}

async function openBurnRateIncident(
  cfg: SloAlertConfig,
  fast: BurnRateWindow,
): Promise<string | null> {
  try {
    const now = new Date();
    const [row] = await db
      .insert(incidents)
      .values({
        severity: cfg.incidentSeverity,
        title: `Fast burn: ${cfg.label} SLO`,
        summary:
          `Auto-opened by the burn-rate monitor. The ${cfg.label} SLO burned ` +
          `${fast.monthlyBudgetBurnedPct}% of its monthly error budget in the last hour ` +
          `(threshold ${FAST_BURN_PCT}%). Window: ${fast.failedEvents}/${fast.totalEvents} failed ` +
          `(burn rate ${fast.burnRate ?? "n/a"}×).`,
        status: "open",
        startedAt: now,
        detectedAt: now,
        detectionSource: "burn_rate",
        // Tag the SLO id here so the dedupe check can find an open incident for
        // THIS specific SLO without a dedicated column.
        rootCauseCategory: "slo:" + cfg.sloId,
        impactSummary:
          cfg.pageSeverity === "P0"
            ? "Customer-facing AI requests are failing at an elevated rate."
            : "Background jobs are failing at an elevated rate (internal impact).",
        // Auto-attach the blameless post-mortem template so resolution has the
        // structure ready. routes-incidents lets the founder later replace this
        // with the filled-in copy URL.
        postMortemUrl: POST_MORTEM_TEMPLATE_PATH,
        createdBy: "burn_rate_monitor",
      })
      .returning({ id: incidents.id });
    return row?.id ?? null;
  } catch (err) {
    logger.error("[burnRateMonitor] failed to auto-open incident", err);
    return null;
  }
}

/**
 * Evaluate every SLO's fast + slow windows and fire the appropriate channel.
 * Each SLO is isolated — one failing branch never suppresses the others.
 */
export async function runBurnRateMonitor(): Promise<BurnRateRunResult> {
  const result: BurnRateRunResult = {
    evaluated: 0,
    fastBreaches: 0,
    slowBreaches: 0,
    incidentsOpened: 0,
    pagesSent: 0,
    findingsRecorded: 0,
  };

  for (const cfg of SLO_CONFIGS) {
    try {
      result.evaluated += 1;
      const [fast, slow] = await Promise.all([
        cfg.fast(HOUR_MS, "1h"),
        cfg.slow(SIX_HOURS_MS, "6h"),
      ]);

      // ── FAST burn → page + auto-incident ───────────────────────────────────
      if (fast.totalEvents > 0 && fast.monthlyBudgetBurnedPct >= FAST_BURN_PCT) {
        result.fastBreaches += 1;
        const alreadyOpen = await hasOpenBurnRateIncident(cfg.sloId);
        if (alreadyOpen) {
          logger.warn(
            `[burnRateMonitor] ${cfg.sloId} fast-burn still firing (${fast.monthlyBudgetBurnedPct}%) — open incident exists, not re-paging`,
          );
        } else {
          const incidentId = await openBurnRateIncident(cfg, fast);
          if (incidentId) result.incidentsOpened += 1;

          const title = `Fast SLO burn: ${cfg.label}`;
          const body =
            `${cfg.label} burned ${fast.monthlyBudgetBurnedPct}% of its monthly error ` +
            `budget in the last hour (page threshold ${FAST_BURN_PCT}%).\n\n` +
            `Window (1h): ${fast.failedEvents}/${fast.totalEvents} failed, burn rate ` +
            `${fast.burnRate ?? "n/a"}×.\n` +
            `Incident ${incidentId ?? "(open failed)"} auto-opened (detectionSource: burn_rate). ` +
            `Post-mortem template attached.`;
          try {
            await notifyOnCall(cfg.pageSeverity, title, body, {
              source: "burn_rate_monitor",
              sloId: cfg.sloId,
              incidentId,
              monthlyBudgetBurnedPct: fast.monthlyBudgetBurnedPct,
              window: "1h",
            });
            result.pagesSent += 1;
          } catch (err) {
            logger.error("[burnRateMonitor] notifyOnCall failed", err);
          }
        }
      }

      // ── SLOW burn → warn finding (non-paging) ─────────────────────────────
      if (slow.totalEvents > 0 && slow.monthlyBudgetBurnedPct >= SLOW_BURN_PCT) {
        result.slowBreaches += 1;
        try {
          await recordFinding({
            domain: "reliability",
            detector: "burn_rate_monitor",
            severity: "warn",
            title: `Slow SLO burn: ${cfg.label}`,
            detail:
              `${cfg.label} burned ${slow.monthlyBudgetBurnedPct}% of its monthly error ` +
              `budget over the last 6h (warn threshold ${SLOW_BURN_PCT}%). ` +
              `Window: ${slow.failedEvents}/${slow.totalEvents} failed (burn rate ` +
              `${slow.burnRate ?? "n/a"}×). Below the fast-burn page line but worth a look ` +
              `before it accelerates.`,
            citedReason: `SLO ${cfg.sloId} (docs/slo-monitoring.md) — 6h slow-burn ≥ ${SLOW_BURN_PCT}% of monthly budget.`,
            dedupeKey: `slow_burn:${cfg.sloId}`,
            metadata: {
              sloId: cfg.sloId,
              window: "6h",
              monthlyBudgetBurnedPct: slow.monthlyBudgetBurnedPct,
              burnRate: slow.burnRate,
            },
          });
          result.findingsRecorded += 1;
        } catch (err) {
          logger.error("[burnRateMonitor] recordFinding failed", err);
        }
      }
    } catch (err) {
      logger.error(`[burnRateMonitor] SLO ${cfg.sloId} evaluation failed`, err);
    }
  }

  if (result.fastBreaches > 0 || result.slowBreaches > 0) {
    logger.warn(
      `[burnRateMonitor] evaluated=${result.evaluated} fast=${result.fastBreaches} slow=${result.slowBreaches} ` +
        `incidents=${result.incidentsOpened} pages=${result.pagesSent} findings=${result.findingsRecorded}`,
    );
  }
  return result;
}
