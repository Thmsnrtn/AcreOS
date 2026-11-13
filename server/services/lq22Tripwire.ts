/**
 * LQ-22 tripwire — the /investor-network ~25-customer counter + monitor
 * (PKG-4, simulation-fixes-2026-11.md).
 *
 * The rule (founder decision 2026-10-20 #4, confirmed 2026-11-07): the
 * investor network IS a marketplace, and no marketplace opens before ~25
 * paying customers. The freeze itself is enforced elsewhere and is NOT
 * touched here:
 *   - `/investor-network` sits in FROZEN_ROUTES (shared/feature-freeze.ts);
 *   - its API mounts sit behind requireLadderFlag("feature_marketplace")
 *     (routes-epic-services.ts, routes-misc.ts), which fails CLOSED.
 *
 * What was missing — simulation #28's instrumentation gap — is that nothing
 * COUNTED the approach. This module is that instrument:
 *
 *   1. **Counter.** A daily count of paying customers, computed from the
 *      billing records of record (the organizations rows whose
 *      subscriptionTier / subscriptionStatus / billingInterval are kept
 *      current by the Stripe webhook rail — the same source of truth
 *      `liveMrrDetail()` in services/finance/runwayModel.ts reads).
 *      Computed, never stored as state: no new table. The latest report is
 *      persisted to the generic founder_settings key-value table (the
 *      gate-watcher precedent) so the ops watch can read it in-machine,
 *      and every run emits one structured log line.
 *   2. **Config-swappable definition.** What counts lives in exactly one
 *      named constant, LQ22_COUNTING_DEFINITION. Its current value is the
 *      INFERRED definition (see the constant's comment). The LQ-22
 *      determination — what counts toward the ~25 — is Tom/counsel's call
 *      and has never been pinned; when it lands it is a one-line change
 *      here, not a rebuild.
 *   3. **Threshold alerts.** The ops watch reads the daily report and acts
 *      on the band: notices (batched, not red) at 15 and 20; an immediate
 *      brief at 23 with the gate state; at the trip value the freeze is
 *      VERIFIED, not just counted (see evaluateFreezeState).
 *   4. **Gate-state check.** Every pass asserts the freeze is still in
 *      force: the route is still in FROZEN_ROUTES AND the ladder flag is
 *      not enabled for any representative non-founder context. A freeze
 *      that silently lifts is a red state — this check is what notices.
 *
 * The monitor counts, alerts, and verifies the freeze. It NEVER lifts it:
 * nothing in this module writes a feature flag or edits the frozen list.
 *
 * Design split, same as gateWatcher.ts: the definition, the counting rule,
 * the classification, and the freeze evaluation are PURE (deterministic,
 * exhaustively unit-testable, no DB, no clock). runLq22TripwireCheck()
 * gathers the real inputs and is the only impure part.
 *
 * Honesty rules (borrowed from the gate watcher): inputs are gathered
 * best-effort and NEVER fabricated. An unreadable billing source yields
 * count = null and band = "unknown" with the error stated — never a
 * guessed number.
 */

import { db } from "../db";
import { founderSettings, organizations } from "@shared/schema";
import {
  monthlyRevenueCentsFor,
  type BillingInterval,
} from "@shared/billing/tier-pricing";
import { isFrozenRoute } from "@shared/feature-freeze";
import { featureFlagService, type FlagContext } from "./featureFlags";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

// ============================================
// The gate being watched (names the existing enforcement — do not fork it)
// ============================================

/** The ladder flag the /investor-network API mounts are gated behind. */
export const LQ22_LADDER_FLAG_KEY = "feature_marketplace";

/** The frozen client route for the investor network. */
export const LQ22_FROZEN_ROUTE = "/investor-network";

/** founder_settings key the latest daily report is persisted under. */
export const LQ22_SETTINGS_KEY = "lq22_tripwire.latest";

// ============================================
// The counting definition — ONE named constant, config-swappable
// ============================================

export interface Lq22CountingDefinition {
  /**
   * The unit counted toward the ladder. "paying_orgs" = distinct
   * organizations with a paid subscription (one org = one customer,
   * regardless of seats). Alternatives a determination might choose
   * ("paying_customers", "seats") change the gather query, not just this
   * label — the label exists so the PR/test surface states the choice.
   */
  unit: "paying_orgs";
  /**
   * organizations.subscriptionStatus values that count. Trials do NOT
   * count under the inferred definition because "trialing" is absent
   * here; a determination that trials count adds it — one line.
   */
  countedStatuses: readonly string[];
  /**
   * When true, an org counts only if its tier prices above zero at its
   * billing interval (free-tier orgs never count, even when "active").
   */
  requirePositiveMonthlyPrice: boolean;
}

/**
 * THE counting definition — inferred, pending the LQ-22 determination.
 *
 * "Inferred" means: this mirrors the platform's own paying-org rule in
 * `liveMrrDetail()` (runwayModel.ts) exactly — status "active" AND a
 * positive monthly-equivalent price — because that is the only
 * paying-customer definition the codebase already stands behind. What
 * counts toward the ~25 was never pinned by Tom/counsel (PKG-4 spec,
 * decision register #5). When the determination lands, change THIS
 * constant; the counter, the tests' definition fixtures, and the watch
 * all follow.
 */
export const LQ22_COUNTING_DEFINITION: Lq22CountingDefinition = {
  unit: "paying_orgs",
  countedStatuses: ["active"],
  requirePositiveMonthlyPrice: true,
};

/**
 * Alert thresholds on the counted value. Notices at 15 and 20 are batched
 * watch reports (not red); 23 briefs Tom immediately with the gate state;
 * 25 is the trip value from the ladder itself ("no marketplace before
 * ~25 customers") — reaching it triggers freeze VERIFICATION.
 */
export const LQ22_TRIPWIRE_THRESHOLDS = {
  noticeAt: [15, 20] as readonly number[],
  briefAt: 23,
  tripAt: 25,
} as const;

// ============================================
// Pure: counting
// ============================================

/** One organization's billing row — the shape liveMrrDetail() selects. */
export interface OrgBillingRow {
  tier: string | null;
  status: string | null;
  interval: string | null;
}

/** Does this org count toward the ladder under the given definition? */
export function isPayingOrg(
  row: OrgBillingRow,
  definition: Lq22CountingDefinition = LQ22_COUNTING_DEFINITION,
): boolean {
  if (!row.status || !definition.countedStatuses.includes(row.status)) {
    return false;
  }
  if (!definition.requirePositiveMonthlyPrice) return true;
  const interval = (row.interval as BillingInterval | null) ?? "monthly";
  return monthlyRevenueCentsFor(row.tier, interval) > 0;
}

/** The paying-customer count for a set of billing rows. */
export function countPayingCustomers(
  rows: readonly OrgBillingRow[],
  definition: Lq22CountingDefinition = LQ22_COUNTING_DEFINITION,
): number {
  let count = 0;
  for (const row of rows) {
    if (isPayingOrg(row, definition)) count++;
  }
  return count;
}

// ============================================
// Pure: threshold classification
// ============================================

export type Lq22TripwireBand = "quiet" | "notice" | "brief" | "trip";

export interface Lq22Classification {
  band: Lq22TripwireBand;
  /** The highest notice threshold reached, or null below the first. */
  highestNoticeAt: number | null;
}

/**
 * Which alert band a count falls in. Bands are by highest threshold
 * reached: trip >= brief >= notice >= quiet. A count of 21 or 22 is still
 * "notice" (the 20 notice was the last one owed); 23–24 is "brief".
 */
export function classifyTripwire(
  count: number,
  thresholds: typeof LQ22_TRIPWIRE_THRESHOLDS = LQ22_TRIPWIRE_THRESHOLDS,
): Lq22Classification {
  if (count >= thresholds.tripAt) return { band: "trip", highestNoticeAt: maxNotice(thresholds) };
  if (count >= thresholds.briefAt) return { band: "brief", highestNoticeAt: maxNotice(thresholds) };
  const reached = thresholds.noticeAt.filter((n) => count >= n);
  if (reached.length > 0) {
    return { band: "notice", highestNoticeAt: reached[reached.length - 1] };
  }
  return { band: "quiet", highestNoticeAt: null };
}

function maxNotice(thresholds: typeof LQ22_TRIPWIRE_THRESHOLDS): number | null {
  return thresholds.noticeAt.length > 0
    ? thresholds.noticeAt[thresholds.noticeAt.length - 1]
    : null;
}

// ============================================
// Pure: freeze-state evaluation
// ============================================

export interface Lq22FreezeProbe {
  /** Is LQ22_FROZEN_ROUTE still in FROZEN_ROUTES? */
  routeFrozen: boolean;
  /**
   * featureFlagService.isEnabled(LQ22_LADDER_FLAG_KEY, ctx) for
   * representative NON-founder contexts, keyed by context label. The
   * ladder middleware has no tier bypass, so every one of these must be
   * false for the freeze to be in force.
   */
  ladderFlagEnabledByContext: Readonly<Record<string, boolean>>;
}

export interface Lq22FreezeVerdict {
  frozen: boolean;
  /** Human-readable reasons the freeze is NOT in force; empty = frozen. */
  problems: string[];
}

/**
 * The freeze is in force iff the route is still frozen AND the ladder
 * flag is enabled for no non-founder context. Anything else is a lifted
 * freeze — a red state for the watch, at ANY count, not just at the trip.
 */
export function evaluateFreezeState(probe: Lq22FreezeProbe): Lq22FreezeVerdict {
  const problems: string[] = [];
  if (!probe.routeFrozen) {
    problems.push(
      `${LQ22_FROZEN_ROUTE} is no longer in FROZEN_ROUTES — the route freeze has been lifted`,
    );
  }
  for (const [label, enabled] of Object.entries(probe.ladderFlagEnabledByContext)) {
    if (enabled) {
      problems.push(
        `${LQ22_LADDER_FLAG_KEY} ladder flag is ENABLED for non-founder context '${label}' — the API gate is open`,
      );
    }
  }
  return { frozen: problems.length === 0, problems };
}

// ============================================
// Impure: the daily check (gather → count → verify → report)
// ============================================

/**
 * Representative non-founder contexts the ladder flag is probed under.
 * Mirrors what requireLadderFlag would decide for real requests: no
 * founder bypass, and — unlike requireFlag — no tier bypass either, so a
 * tier-scoped flag state must still read "enabled" here and be caught.
 */
const PROBE_CONTEXTS: ReadonlyArray<{ label: string; ctx: FlagContext }> = [
  { label: "no-tier", ctx: { isFounder: false } },
  { label: "starter", ctx: { isFounder: false, tier: "starter" } },
  { label: "pro", ctx: { isFounder: false, tier: "pro" } },
  { label: "scale", ctx: { isFounder: false, tier: "scale" } },
];

export interface Lq22TripwireReport {
  ranAt: string;
  /** Null when the billing source was unreadable — never fabricated. */
  count: number | null;
  band: Lq22TripwireBand | "unknown";
  gate: Lq22FreezeVerdict;
  /**
   * One-line, ops-watch.log-shaped summary (space-separated key=value):
   *   lq22 count=13 band=quiet gate=frozen
   *   lq22 count=25 band=trip gate=verified-frozen
   *   lq22 count=4 band=quiet gate=LIFTED
   */
  watchLine: string;
  /** The gather error when count is null; otherwise null. */
  error: string | null;
}

function buildWatchLine(
  count: number | null,
  band: Lq22TripwireBand | "unknown",
  gate: Lq22FreezeVerdict,
): string {
  const gateField = !gate.frozen
    ? "LIFTED"
    : band === "trip"
      ? "verified-frozen"
      : "frozen";
  return `lq22 count=${count === null ? "unknown" : count} band=${band} gate=${gateField}`;
}

/**
 * Run one tripwire pass: count paying customers from the billing records,
 * classify against the thresholds, verify the freeze, persist the report
 * to founder_settings, and log the watch line. Never throws — a failed
 * gather returns a report with count=null and the error stated, so the
 * scheduler job and the watch see the failure instead of silence.
 */
export async function runLq22TripwireCheck(): Promise<Lq22TripwireReport> {
  const ranAt = clock.now().toISOString();

  let count: number | null = null;
  let band: Lq22TripwireBand | "unknown" = "unknown";
  let error: string | null = null;
  try {
    const rows = await db
      .select({
        tier: organizations.subscriptionTier,
        status: organizations.subscriptionStatus,
        interval: organizations.billingInterval,
      })
      .from(organizations);
    count = countPayingCustomers(rows);
    band = classifyTripwire(count).band;
  } catch (err) {
    error = `billing rows unreadable: ${String(err)}`;
  }

  // Freeze verification — the same assertions at every count, so a
  // silently-lifted freeze is caught the day it happens, not at the trip.
  // featureFlagService fails closed for non-founders (an unreadable flag
  // store reads "off"), mirroring requireLadderFlag's own catch path.
  const ladderFlagEnabledByContext: Record<string, boolean> = {};
  for (const { label, ctx } of PROBE_CONTEXTS) {
    ladderFlagEnabledByContext[label] = await featureFlagService.isEnabled(
      LQ22_LADDER_FLAG_KEY,
      ctx,
    );
  }
  const gate = evaluateFreezeState({
    routeFrozen: isFrozenRoute(LQ22_FROZEN_ROUTE),
    ladderFlagEnabledByContext,
  });

  const report: Lq22TripwireReport = {
    ranAt,
    count,
    band,
    gate,
    watchLine: buildWatchLine(count, band, gate),
    error,
  };

  logger.info("[lq22-tripwire] daily tripwire check", {
    metadata: {
      count: report.count,
      band: report.band,
      gateFrozen: gate.frozen,
      gateProblems: gate.problems,
      watchLine: report.watchLine,
      error: report.error,
      definition: LQ22_COUNTING_DEFINITION,
    },
  });
  if (!gate.frozen) {
    logger.error("[lq22-tripwire] FREEZE NOT IN FORCE", undefined, {
      metadata: { problems: gate.problems, watchLine: report.watchLine },
    });
  }

  // Persist the latest report for the ops watch (founder_settings KV —
  // the gate-watcher precedent; no new table). Best-effort: a failed
  // write is logged, never fatal — the structured log line above is
  // already emitted either way.
  try {
    const value = JSON.stringify(report);
    await db
      .insert(founderSettings)
      .values({
        key: LQ22_SETTINGS_KEY,
        value,
        valueType: "json",
        description:
          "LQ-22 tripwire: latest daily paying-customer count + /investor-network freeze verification (PKG-4)",
        category: "general",
        updatedBy: "lq22-tripwire",
      })
      .onConflictDoUpdate({
        target: founderSettings.key,
        set: { value, updatedAt: clock.now(), updatedBy: "lq22-tripwire" },
      });
  } catch (err) {
    logger.warn("[lq22-tripwire] failed to persist latest report", {
      metadata: { err: String(err) },
    });
  }

  return report;
}
