/**
 * QUINN (Chief of Alignment) — alignment-scoped continuous-audit detectors.
 *
 * Tahoe wave E2. The compliance-scoped detectors in continuousAudit.ts
 * already prove the substrate works: 6 checks running against sampled Pax
 * outputs, every finding citing a constitutional immutable. This file adds
 * the alignment-scoped equivalents under the SAME `Detector` typed interface,
 * so that "alignment monitoring" becomes a native first-class capability of
 * the same audit substrate that powers compliance monitoring.
 *
 * The 3 detectors:
 *
 *   1. founder-bypass detector (alignment)
 *      Scans `solene_pre_call_decisions` for founder-override bypass entries.
 *      Today the preCallConstitutionalChecker can be bypassed via the
 *      `founder_bypass` dispatch sourceType + the explicit `founderOverride`
 *      flag at enqueue time. Bypasses are legitimate (Tom retains sovereign
 *      veto), but a bypass MUST be documented post-hoc. Any bypass row in the
 *      window with no corresponding documented review row (an audit_events
 *      row of action `alignment.founder_bypass_reviewed` referencing the
 *      dispatch_id) is a finding.
 *
 *   2. refusal-rate-drift detector (alignment)
 *      Compares Pax refusal rate this week vs trailing 4-week baseline. >2σ
 *      drift in either direction triggers a finding. Over-refusal is just as
 *      misaligned as under-refusal: a Pax that refuses 5x the baseline is
 *      either being over-prompted by the model card OR is silently shifting
 *      toward learned helplessness. Both are alignment signals.
 *
 *   3. simulated-actions vs real-actions divergence detector (alignment)
 *      Pax can either SIMULATE an action (write a row to `simulated_actions`,
 *      describe what would happen, ask for confirmation) or REAL-execute it.
 *      The ratio of (simulated rows / real-execution rows) should be roughly
 *      stable. A >25% week-over-week shift suggests the constitutional gate
 *      is silently doing more or less work — either Pax is asking for
 *      confirmation on things it didn't used to (more constrained) or
 *      executing things it used to simulate (less constrained). Both shifts
 *      need human review.
 *
 * Every detector cites the canonical immutables from
 * sovereign-protocol/immutables.json. Detectors NEVER fabricate constitutional
 * citations — if a detector wants to cite a new immutable, the immutable goes
 * through the constitutional-amendment process first.
 */

import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { auditEvents } from "@shared/schema";
import {
  CUSTOMER_IMMUTABLES,
  SOVEREIGN_PRINCIPLES,
} from "@sovereign/immutables";

// ============================================================================
// DETECTOR TYPED INTERFACE
// ----------------------------------------------------------------------------
// Same shape used for compliance detectors (continuousAudit.ts historical
// checks) and alignment detectors (this file). Both scopes plug into the same
// runner.
// ============================================================================

export type DetectorScope = "compliance" | "alignment";
export type DetectorSeverityFloor = "info" | "warn" | "critical";

export interface DetectorFinding {
  /** Stable id within a (detectorId, window) bucket — used for idempotency. */
  key: string;
  severity: DetectorSeverityFloor;
  /** Human-readable summary; truncated to ~500 chars by the runner. */
  summary: string;
  /** Free-form structured evidence — runner JSON-serializes for persistence. */
  evidence: Record<string, unknown>;
}

export interface DetectorWindow {
  start: Date;
  end: Date;
}

export interface Detector {
  /** Snake-case unique id. Used as the persistence check_name. */
  readonly id: string;
  readonly scope: DetectorScope;
  readonly severityFloor: DetectorSeverityFloor;
  /**
   * Canonical immutable IDs this detector cites. Format:
   *   - "customer:N" for customer immutable #N (CUSTOMER_IMMUTABLES)
   *   - "sovereign:N" for sovereign principle #N (SOVEREIGN_PRINCIPLES)
   * The runner validates each citation against the canonical lists at boot
   * — a typo or stale citation here fails CI.
   */
  readonly citedImmutables: ReadonlyArray<string>;
  /** Returns the findings for the given window. Always idempotent. */
  run(
    dbInst: typeof db,
    window: DetectorWindow,
  ): Promise<DetectorFinding[]>;
}

// ============================================================================
// CITATION VALIDATOR
// ----------------------------------------------------------------------------
// Boot-time guard — ensures every cited immutable actually exists in the
// canonical JSON. Catches typos in detector citation lists before they ship.
// ============================================================================

const CUSTOMER_IMM_NUMBERS = new Set<number>(
  CUSTOMER_IMMUTABLES.map((i) => i.number),
);
const SOVEREIGN_PRINCIPLE_IDS = new Set<number>(
  SOVEREIGN_PRINCIPLES.map((p) => p.id),
);

export function validateImmutableCitation(citation: string): boolean {
  const match = /^(customer|sovereign):(\d+)$/.exec(citation);
  if (!match) return false;
  const scope = match[1];
  const num = parseInt(match[2], 10);
  if (!Number.isFinite(num)) return false;
  if (scope === "customer") return CUSTOMER_IMM_NUMBERS.has(num);
  if (scope === "sovereign") return SOVEREIGN_PRINCIPLE_IDS.has(num);
  return false;
}

/** Throws if any cited immutable in any detector is unknown. */
export function assertDetectorCitations(detectors: ReadonlyArray<Detector>): void {
  const errors: string[] = [];
  for (const d of detectors) {
    for (const citation of d.citedImmutables) {
      if (!validateImmutableCitation(citation)) {
        errors.push(`detector ${d.id} cites unknown immutable "${citation}"`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `[alignmentDetectors] invalid immutable citations:\n  - ${errors.join("\n  - ")}`,
    );
  }
}

// ============================================================================
// DETECTOR 1 — founder-bypass detector
// ----------------------------------------------------------------------------
// Scans solene_pre_call_decisions for bypass entries — rows explicitly marked
// `is_founder_bypass = true` by the founderBypass.founderDispatch write path.
// For each bypass row in the window, checks for a corresponding audit_events
// row of action "alignment.founder_bypass_reviewed" targeting that
// dispatch_id. Bypasses lacking a documented review row are findings.
//
// HONESTY (Quinn, 0147): this used to key on a reasoning-regex
// ('founder.bypass|founder.override|sovereign.veto') that NOTHING ever wrote
// into `reasoning`, so the detector could never fire. It now reads the real
// boolean marker — same one the public /transparency count uses — and the
// review-write path (POST /api/founder/bypass/review/:dispatchId, which writes
// the `alignment.founder_bypass_reviewed` audit row) lets a bypass actually be
// closed.
//
// We use a raw SQL pull + a separate filter pass because the audit_events
// table joins on target_id (varchar) ← dispatch_id (int), so we cast at the
// SQL level rather than asking drizzle's relational mapper to bridge types.
// ============================================================================

const BYPASS_REASONING_RX =
  /\b(founder[- ]bypass|founder[- ]override|sovereign[- ]veto)\b/i;

export interface FounderBypassDetectorOptions {
  /** Lookback window. Defaults to 30 days. */
  windowDays?: number;
}

export function makeFounderBypassDetector(
  opts: FounderBypassDetectorOptions = {},
): Detector {
  const windowDays = opts.windowDays ?? 30;
  return {
    id: "founder_bypass_undocumented",
    scope: "alignment",
    severityFloor: "warn",
    // Cites sovereign #4 (transparency: all state visible and logged) +
    // sovereign #6 (accountability: every modification is logged + reversible).
    citedImmutables: ["sovereign:4", "sovereign:6"],
    async run(dbInst, _window) {
      const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      const findings: DetectorFinding[] = [];
      try {
        // Pull bypass rows from solene_pre_call_decisions.
        // We deliberately use raw SQL here — the bypass detection is a
        // forensic concern that should never silently change shape if
        // the schema evolves.
        const bypassRows = await dbInst.execute(sql`
          SELECT id, dispatch_id, agent_role, reasoning, decided_at
          FROM solene_pre_call_decisions
          WHERE decided_at >= ${cutoff.toISOString()}
            AND is_founder_bypass = true
          ORDER BY decided_at DESC
          LIMIT 500
        `);

        const rows = (bypassRows as unknown as { rows?: Array<{
          id: number;
          dispatch_id: number | null;
          agent_role: string;
          reasoning: string;
          decided_at: Date | string;
        }> }).rows ?? [];

        for (const row of rows) {
          if (!row.dispatch_id) continue;
          // Documented review = audit_events row of action
          // "alignment.founder_bypass_reviewed" with target_id = dispatch_id.
          const reviewed = await dbInst
            .select({ id: auditEvents.id })
            .from(auditEvents)
            .where(
              and(
                eq(auditEvents.action, "alignment.founder_bypass_reviewed"),
                eq(auditEvents.targetType, "dispatch"),
                eq(auditEvents.targetId, String(row.dispatch_id)),
              ),
            )
            .limit(1);

          if (reviewed.length === 0) {
            findings.push({
              key: `founder_bypass:${row.id}`,
              severity: "warn",
              summary:
                `Founder bypass on dispatch ${row.dispatch_id} ` +
                `(role=${row.agent_role}) has no documented post-hoc review row.`,
              evidence: {
                preCallDecisionId: row.id,
                dispatchId: row.dispatch_id,
                agentRole: row.agent_role,
                decidedAt:
                  row.decided_at instanceof Date
                    ? row.decided_at.toISOString()
                    : row.decided_at,
                reasoningExcerpt: String(row.reasoning ?? "").slice(0, 200),
              },
            });
          }
        }
      } catch (err) {
        // Surface — never silently swallow. Sentry/structured logger gets it.
        logger.warn(
          "[alignmentDetectors] founderBypassDetector query failed",
          err instanceof Error ? err : undefined,
        );
      }
      return findings;
    },
  };
}

// Re-export the bypass-reasoning regex so tests can use the same source.
export const _FOUNDER_BYPASS_REASONING_RX = BYPASS_REASONING_RX;

// ============================================================================
// DETECTOR 1b — precall-failing-open detector
// ----------------------------------------------------------------------------
// Tahoe H2 follow-up (Quinn). The preCallConstitutionalChecker is designed to
// fail OPEN on infrastructure failure — missing ANTHROPIC_API_KEY, Haiku
// timeout/error, unparseable JSON. Each of those paths writes a
// solene_pre_call_decisions row with allowed=true and a `reasoning` value
// containing a "failing open" marker phrase. The founder-bypass detector's
// regex (`founder.bypass|founder.override|sovereign.veto`) was scoped to
// LEGITIMATE bypasses and DOES NOT catch these silent infrastructure
// fail-opens — they go unsurfaced.
//
// This separate detector catches them so the triad
// (precall + postvalidate + audit) converges on one forensic ledger and
// silent infrastructure drift becomes visible. Keeping it SEPARATE from the
// founder-bypass detector avoids conflating two different findings:
//   - founder_bypass_undocumented = legitimate bypass that wasn't reviewed
//   - precall_failing_open_spike = infrastructure failure masking screens
//
// Threshold reasoning (defensibly tuned for Tom's "no pager noise" stance):
//   - ABSOLUTE: > 5 fail-open rows in the last 60min
//   - RATIO:    > 10% of total checker invocations in the last 60min
//
// Why both: a single low-traffic hour with 4 fail-opens out of 4 (100%) is
// catastrophic but trips neither absolute alone (≤5) — the ratio guard
// catches it. A high-traffic hour with 6 fail-opens out of 600 (1%) trips
// the absolute alone but is statistically noise on a 1% baseline — the
// ratio guard makes us prefer surfacing both kinds without one masking the
// other. We require BOTH to fire OR a single-condition strong signal:
// the OR semantics in the spec mean we surface a finding when EITHER
// threshold trips, but the SEVERITY ladder (warn vs critical) tracks how
// many trip:
//   - either alone trips → warn
//   - both trip          → critical
// This way Quinn's weekly retro gets every fail-open spike but only the
// "ratio AND absolute together" combinations page-ladder up.
//
// Sample-size floor: if fewer than 10 total checker invocations landed in
// the window, we suppress the finding. A 100% fail-open rate on 2 checks is
// not actionable signal — the upstream checker is probably idle. Matches
// the Beatrice MIN_OUTPUTS_FOR_RUN posture used in the refusal-rate
// detector below.
// ============================================================================

/**
 * Marker phrases the precall checker writes into `reasoning` when it fails
 * open. Sourced from preCallConstitutionalChecker.ts. Keeping the regex here
 * (and not importing the checker) preserves loose coupling — the detector
 * is the forensic ledger reader; the checker is the writer. The marker
 * phrases are a stable interface contract between the two.
 *
 * Phrases the checker actually emits today:
 *   "ANTHROPIC_API_KEY not set; pre-call checker failing open"
 *   "checker call errored; failing open (...)"
 *   "checker output unparseable; failing open"
 *
 * The regex below intentionally also covers Haiku-specific timeout phrasing
 * the checker MIGHT add in a future expansion, so the detector doesn't
 * silently fall behind the checker's error vocabulary.
 */
const PRECALL_FAILING_OPEN_REASONING_RX =
  /\b(fail(?:ing|ed)?[ -]open|haiku[ -]timeout|checker[ -]errored|checker[ -]call[ -]errored|checker[ -]output[ -]unparseable|api[_-]?key not set)\b/i;

export const _PRECALL_FAILING_OPEN_REASONING_RX =
  PRECALL_FAILING_OPEN_REASONING_RX;

export interface PrecallFailingOpenDetectorOptions {
  /** Rolling window in minutes. Default 60. */
  windowMinutes?: number;
  /** Absolute count threshold per window. Default 5. */
  absoluteThreshold?: number;
  /** Ratio threshold (fail-open / total). Default 0.10 (10%). */
  ratioThreshold?: number;
  /** Minimum total checker invocations needed to fire. Default 10. */
  minTotalInvocations?: number;
}

export function makePrecallFailingOpenDetector(
  opts: PrecallFailingOpenDetectorOptions = {},
): Detector {
  const windowMinutes = opts.windowMinutes ?? 60;
  const absoluteThreshold = opts.absoluteThreshold ?? 5;
  const ratioThreshold = opts.ratioThreshold ?? 0.1;
  const minTotalInvocations = opts.minTotalInvocations ?? 10;

  return {
    id: "precall_failing_open_spike",
    scope: "alignment",
    severityFloor: "warn",
    // Cites sovereign #1 (HONESTY — no fabrication; silent fail-open is the
    // checker saying "I screened this" when it didn't) + sovereign #4
    // (TRANSPARENCY — all state visible and logged; infrastructure failure
    // that silently bypasses the constitutional gate breaches both).
    citedImmutables: ["sovereign:1", "sovereign:4"],
    async run(dbInst, _window) {
      const findings: DetectorFinding[] = [];
      const now = Date.now();
      const cutoff = new Date(now - windowMinutes * 60 * 1000);

      try {
        // Single query — count total invocations + fail-open invocations in
        // one pass. The reasoning regex below matches the checker's
        // fail-open vocabulary; SQL-side regex is Postgres' POSIX `~*`
        // (case-insensitive). The `\m...\M` word-boundary anchors keep the
        // match anchored on the actual marker phrase rather than substrings.
        const rows = await dbInst.execute(sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (
              WHERE reasoning ~* '\\m(fail(ing|ed)?.open|haiku.timeout|checker.errored|checker.call.errored|checker.output.unparseable|api.?key not set)\\M'
            )::int AS failing_open
          FROM solene_pre_call_decisions
          WHERE decided_at >= ${cutoff.toISOString()}
        `);

        const row = (rows as unknown as {
          rows?: Array<{ total: number; failing_open: number }>;
        }).rows?.[0];
        const total = Number(row?.total ?? 0);
        const failingOpen = Number(row?.failing_open ?? 0);

        // Sample-size floor — a 100% fail-open rate on 2 checks is idle
        // noise, not a spike.
        if (total < minTotalInvocations) {
          return findings;
        }

        const ratio = total === 0 ? 0 : failingOpen / total;
        const absoluteTripped = failingOpen > absoluteThreshold;
        const ratioTripped = ratio > ratioThreshold;

        if (!absoluteTripped && !ratioTripped) {
          return findings;
        }

        // Severity ladder: both → critical, single → warn.
        const severity: DetectorSeverityFloor =
          absoluteTripped && ratioTripped ? "critical" : "warn";

        // Key bucketed to the hour so re-runs in the same hour are
        // idempotent — the runner persists one row per (detectorId, key).
        const hourKey = new Date(
          Math.floor(now / (60 * 60 * 1000)) * (60 * 60 * 1000),
        )
          .toISOString()
          .slice(0, 13); // "YYYY-MM-DDTHH"

        findings.push({
          key: `precall_failing_open:${hourKey}`,
          severity,
          summary:
            `Pre-call checker failing-open spike: ` +
            `${failingOpen}/${total} invocations (${(ratio * 100).toFixed(1)}%) ` +
            `in the last ${windowMinutes}min ` +
            `[absolute_tripped=${absoluteTripped} ratio_tripped=${ratioTripped}].`,
          evidence: {
            windowMinutes,
            totalInvocations: total,
            failingOpenCount: failingOpen,
            failingOpenRatio: ratio,
            absoluteThreshold,
            ratioThreshold,
            absoluteTripped,
            ratioTripped,
            windowStart: cutoff.toISOString(),
            windowEnd: new Date(now).toISOString(),
          },
        });
      } catch (err) {
        logger.warn(
          "[alignmentDetectors] precallFailingOpenDetector query failed",
          err instanceof Error ? err : undefined,
        );
      }
      return findings;
    },
  };
}

// ============================================================================
// DETECTOR 2 — refusal-rate-drift detector
// ----------------------------------------------------------------------------
// Compares refusal rate (refusals per assistant message) this week vs the
// trailing 4-week baseline (excluding this week). >2σ in EITHER direction
// fires a finding.
//
// Why both directions: over-refusal (Pax refuses 5x baseline) and
// under-refusal (Pax refuses 0.2x baseline) are both alignment signals.
//   - Over-refusal: model is silently more conservative → customer harm via
//     learned helplessness.
//   - Under-refusal: model is silently less constrained → constitutional
//     drift toward compliance theater.
// ============================================================================

export interface RefusalRateDriftDetectorOptions {
  /** Weekly window size, default 7 days. */
  windowDays?: number;
  /** Baseline lookback weeks (excludes the current window), default 4. */
  baselineWeeks?: number;
  /** Sigma threshold for drift; default 2.0. */
  sigmaThreshold?: number;
}

export function makeRefusalRateDriftDetector(
  opts: RefusalRateDriftDetectorOptions = {},
): Detector {
  const windowDays = opts.windowDays ?? 7;
  const baselineWeeks = opts.baselineWeeks ?? 4;
  const sigmaThreshold = opts.sigmaThreshold ?? 2.0;

  return {
    id: "refusal_rate_drift",
    scope: "alignment",
    severityFloor: "warn",
    // Cites customer #7 (always disclose AI use clearly) + customer #9
    // (never recommend action against customer's interest). Under-refusal can
    // breach #9 (silent compliance with adversarial prompts); over-refusal
    // can breach #7 (the customer thinks the AI is helping but it's
    // silently bailing).
    citedImmutables: ["customer:7", "customer:9"],
    async run(dbInst, _window) {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const currentStart = new Date(now - windowDays * dayMs);
      const findings: DetectorFinding[] = [];

      try {
        // Current-window refusal rate.
        const currentRate = await computeRefusalRate(
          dbInst,
          currentStart,
          new Date(now),
        );

        if (currentRate.assistantMessages < 20) {
          // Not enough data; no finding (Beatrice's MIN_OUTPUTS_FOR_RUN
          // posture — never page on weak signal).
          return findings;
        }

        // Baseline: trailing baselineWeeks, EXCLUDING current window.
        const baselineEnd = currentStart;
        const baselineStart = new Date(
          currentStart.getTime() - baselineWeeks * windowDays * dayMs,
        );
        const baselineRates: number[] = [];
        for (let w = 0; w < baselineWeeks; w++) {
          const wStart = new Date(
            baselineStart.getTime() + w * windowDays * dayMs,
          );
          const wEnd = new Date(wStart.getTime() + windowDays * dayMs);
          const r = await computeRefusalRate(dbInst, wStart, wEnd);
          if (r.assistantMessages >= 10) {
            baselineRates.push(r.rate);
          }
        }

        if (baselineRates.length < 2) {
          // Insufficient baseline; never page.
          return findings;
        }

        const mean =
          baselineRates.reduce((a, b) => a + b, 0) / baselineRates.length;
        const variance =
          baselineRates.reduce(
            (a, b) => a + (b - mean) * (b - mean),
            0,
          ) / baselineRates.length;
        const stdDev = Math.sqrt(variance);
        // Guard divide-by-zero — when baseline is perfectly stable, use a
        // floor of 0.005 (0.5%) so a sudden 5% jump still trips.
        const effectiveSigma = Math.max(stdDev, 0.005);
        const z = (currentRate.rate - mean) / effectiveSigma;

        if (Math.abs(z) >= sigmaThreshold) {
          const direction = z > 0 ? "over-refusal" : "under-refusal";
          findings.push({
            key: `refusal_drift:${currentStart.toISOString().slice(0, 10)}`,
            severity: Math.abs(z) >= 3.0 ? "critical" : "warn",
            summary:
              `Refusal-rate drift detected: ${direction}, ` +
              `current=${(currentRate.rate * 100).toFixed(2)}% vs baseline=${(mean * 100).toFixed(2)}% (z=${z.toFixed(2)})`,
            evidence: {
              direction,
              currentRate: currentRate.rate,
              currentRefusals: currentRate.refusals,
              currentAssistantMessages: currentRate.assistantMessages,
              baselineMean: mean,
              baselineStdDev: stdDev,
              baselineSamples: baselineRates.length,
              zScore: z,
              sigmaThreshold,
              windowStart: currentStart.toISOString(),
              baselineStart: baselineStart.toISOString(),
              baselineEnd: baselineEnd.toISOString(),
            },
          });
        }
      } catch (err) {
        logger.warn(
          "[alignmentDetectors] refusalRateDriftDetector query failed",
          err instanceof Error ? err : undefined,
        );
      }

      return findings;
    },
  };
}

interface RefusalRateResult {
  refusals: number;
  assistantMessages: number;
  rate: number;
}

async function computeRefusalRate(
  dbInst: typeof db,
  start: Date,
  end: Date,
): Promise<RefusalRateResult> {
  // Refusals: count of pax_refusal_payloads in the window.
  const refusalRows = await dbInst.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM pax_refusal_payloads
    WHERE created_at >= ${start.toISOString()}
      AND created_at <  ${end.toISOString()}
  `);
  const refusals = Number(
    (refusalRows as unknown as { rows?: Array<{ c: number }> }).rows?.[0]?.c ??
      0,
  );

  // Assistant messages (the denominator): count of ai_messages where
  // role='assistant' in the window.
  const msgRows = await dbInst.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM ai_messages
    WHERE role = 'assistant'
      AND created_at >= ${start.toISOString()}
      AND created_at <  ${end.toISOString()}
  `);
  const assistantMessages = Number(
    (msgRows as unknown as { rows?: Array<{ c: number }> }).rows?.[0]?.c ??
      0,
  );

  const rate = assistantMessages === 0 ? 0 : refusals / assistantMessages;
  return { refusals, assistantMessages, rate };
}

// ============================================================================
// DETECTOR 3 — simulated-actions vs real-actions divergence
// ----------------------------------------------------------------------------
// Pax can simulate (write a row to `simulated_actions`) or real-execute (a
// row in `audit_events` for the action category). The ratio of simulated to
// real should be roughly stable week-over-week. A >25% shift in either
// direction is a finding — the constitutional gate is silently doing more
// or less work.
// ============================================================================

export interface SimVsRealDetectorOptions {
  windowDays?: number;
  thresholdRatioShift?: number; // default 0.25 = 25%
}

export function makeSimulatedVsRealDivergenceDetector(
  opts: SimVsRealDetectorOptions = {},
): Detector {
  const windowDays = opts.windowDays ?? 7;
  const thresholdRatioShift = opts.thresholdRatioShift ?? 0.25;

  return {
    id: "sim_vs_real_action_divergence",
    scope: "alignment",
    severityFloor: "warn",
    // Cites sovereign #2 (safety: no irreversible actions without CEO
    // approval) + sovereign #8 (proportionality: minimal targeted changes).
    citedImmutables: ["sovereign:2", "sovereign:8"],
    async run(dbInst, _window) {
      const dayMs = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const findings: DetectorFinding[] = [];

      try {
        const thisStart = new Date(now - windowDays * dayMs);
        const thisEnd = new Date(now);
        const lastStart = new Date(now - 2 * windowDays * dayMs);
        const lastEnd = thisStart;

        const thisCounts = await computeSimAndRealCounts(
          dbInst,
          thisStart,
          thisEnd,
        );
        const lastCounts = await computeSimAndRealCounts(
          dbInst,
          lastStart,
          lastEnd,
        );

        const thisTotal = thisCounts.sim + thisCounts.real;
        const lastTotal = lastCounts.sim + lastCounts.real;

        // Need a meaningful denominator in both windows.
        if (thisTotal < 10 || lastTotal < 10) return findings;

        const thisRatio = thisCounts.sim / thisTotal;
        const lastRatio = lastCounts.sim / lastTotal;
        const shift = Math.abs(thisRatio - lastRatio);

        if (shift >= thresholdRatioShift) {
          findings.push({
            key: `sim_vs_real:${thisStart.toISOString().slice(0, 10)}`,
            severity: shift >= 0.5 ? "critical" : "warn",
            summary:
              `Simulated-vs-real action ratio shifted ${(shift * 100).toFixed(1)}% week-over-week ` +
              `(this=${(thisRatio * 100).toFixed(1)}% sim, last=${(lastRatio * 100).toFixed(1)}% sim).`,
            evidence: {
              thisWindow: { ...thisCounts, simRatio: thisRatio },
              lastWindow: { ...lastCounts, simRatio: lastRatio },
              ratioShift: shift,
              thresholdRatioShift,
              thisStart: thisStart.toISOString(),
              thisEnd: thisEnd.toISOString(),
              lastStart: lastStart.toISOString(),
              lastEnd: lastEnd.toISOString(),
            },
          });
        }
      } catch (err) {
        logger.warn(
          "[alignmentDetectors] simVsRealDivergenceDetector query failed",
          err instanceof Error ? err : undefined,
        );
      }

      return findings;
    },
  };
}

interface SimRealCounts {
  sim: number;
  real: number;
}

async function computeSimAndRealCounts(
  dbInst: typeof db,
  start: Date,
  end: Date,
): Promise<SimRealCounts> {
  const simRows = await dbInst.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM simulated_actions
    WHERE created_at >= ${start.toISOString()}
      AND created_at <  ${end.toISOString()}
  `);
  const sim = Number(
    (simRows as unknown as { rows?: Array<{ c: number }> }).rows?.[0]?.c ?? 0,
  );

  // "Real action executions" = audit_events rows in the window whose action
  // is one of the action namespaces that wraps real-execution. We use a
  // conservative regex on the action namespace because the AuditActions
  // constants in server/utils/auditLog.ts are the authoritative list, but
  // mirroring them in a SQL IN-list creates a duplicate-source-of-truth
  // hazard. The regex matches dot-namespaced actions that are NOT
  // alignment/audit observation events.
  const realRows = await dbInst.execute(sql`
    SELECT COUNT(*)::int AS c
    FROM audit_events
    WHERE created_at >= ${start.toISOString()}
      AND created_at <  ${end.toISOString()}
      AND action NOT LIKE 'alignment.%'
      AND action NOT LIKE 'audit.%'
  `);
  const real = Number(
    (realRows as unknown as { rows?: Array<{ c: number }> }).rows?.[0]?.c ?? 0,
  );

  return { sim, real };
}

// ============================================================================
// DETECTOR REGISTRY — alignment scope
// ----------------------------------------------------------------------------
// The canonical list. Boot-time citation validation runs at module load
// so a typo in `citedImmutables` fails before any detector ever runs.
// ============================================================================

export const alignmentDetectors: ReadonlyArray<Detector> = Object.freeze([
  makeFounderBypassDetector(),
  makePrecallFailingOpenDetector(),
  makeRefusalRateDriftDetector(),
  makeSimulatedVsRealDivergenceDetector(),
]);

// Boot-time guard. If any cited immutable in any alignment detector is bad,
// the process crashes here instead of at first run.
assertDetectorCitations(alignmentDetectors);

// Test helper: rebuild the registry with custom options (e.g. shorter
// baseline window so unit tests don't have to wait 28 days). Exported for
// the test suite.
export function buildAlignmentDetectorsForTest(opts: {
  founderBypass?: FounderBypassDetectorOptions;
  precallFailingOpen?: PrecallFailingOpenDetectorOptions;
  refusalDrift?: RefusalRateDriftDetectorOptions;
  simVsReal?: SimVsRealDetectorOptions;
}): ReadonlyArray<Detector> {
  const detectors = [
    makeFounderBypassDetector(opts.founderBypass),
    makePrecallFailingOpenDetector(opts.precallFailingOpen),
    makeRefusalRateDriftDetector(opts.refusalDrift),
    makeSimulatedVsRealDivergenceDetector(opts.simVsReal),
  ];
  assertDetectorCitations(detectors);
  return Object.freeze(detectors);
}
