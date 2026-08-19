/**
 * SOLENE — continuous between-session loop (Phase 7).
 *
 * Runs on the existing worker process (Phase 0 cost-aware: no new Fly
 * machine until revenue justifies one). Two pieces:
 *
 *   composeMorningPulse() — walks live data sources (capital tracker,
 *     agent identity, founder collab, dispatch queue, onboarding funnel,
 *     compliance findings) and assembles a MorningPulseSnapshot. Never
 *     throws — per-source failures degrade to defaults.
 *
 *   runContinuousTick() — every 30 minutes from the worker. Scans open
 *     detector signals, queues remediation dispatches per the
 *     documented guardrails, and fires founder asks for items that need
 *     Tom. Returns a structured summary so the cron log is greppable.
 *
 * The morning pulse persists to solene_morning_pulse so the founder
 * Today page reads instantly. composeMorningPulse() also re-runs on
 * fresh GET if no row exists yet (first-time / post-deploy).
 */

import { desc } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneMorningPulse,
  type SoleneMorningPulseRow,
} from "@shared/schema/solene-morning-pulse";
import { logger } from "../../utils/logger";
import { sensesFromPulse, rankMoves, applyObjectiveWeighting, type RankedMove } from "../autopilot/decide";
import { planAndAct } from "../autopilot/act";
import { FOUNDER_MINUTES_BUDGET } from "@sovereign/immutables";

/**
 * Master switch for the autopilot HANDS lives in the DB (autopilot/settings,
 * flipped from the Control Center) with the SOLENE_DISPATCH_ENABLED env var as
 * the safe-off default. While off, the loop only THINKS — it computes + logs its
 * plan but never routes a move into action. When on, the top move is routed
 * through runPolicyGateStack + the Trust Ledger, which still fails safe
 * (OBSERVE → block) until a domain earns autonomy.
 */
/** Lean-mode per-dispatch cap (the $50/mo envelope; keep autopilot work cheap). */
const AUTOPILOT_DISPATCH_MAX_COST_USD = Number(
  process.env.AUTOPILOT_DISPATCH_MAX_COST_USD ?? 5,
);

// ============================================================================
// Types
// ============================================================================

export interface AgentActivitySummary {
  agentRole: string;
  dispatchesCompleted: number;
  decisionsRecorded: number;
  lastActivityAt: Date | null;
}

export interface MorningPulseSnapshot {
  generatedAt: Date;
  dayLabel: string; // "Wed 2026-06-04"
  oneLine: string; // canonical 7am ET one-line

  // Sub-sections rendered behind the one-line.
  mrr: number;
  trials: number;
  /** Measured uptime % over the rolling window; null until there's enough real data to claim one. */
  uptimePct: number | null;
  prodVersion: string;
  complianceOpenCount: number;
  weeklySpendUsd: number;
  decisionsWaitingCount: number;
  autonomyHorizonDays: number;
  envelopeStatus: "green" | "amber" | "red";

  // Kernel-restructure step 5 (founder directive 2026-07-13): the two
  // numbers every cycle opens with. Budget is constitutional
  // (FOUNDER_MINUTES_BUDGET); consumption is null — not zero — when the
  // metric read failed, so the one-line never fabricates restraint.
  founderDecisionsUsedThisWeek: number | null;
  founderDecisionsBudget: number;

  // Jarvis Phase 1 CP4 — verification COVERAGE over the trailing 7 days:
  // passed verdicts / everything that entered the verify pipeline
  // (dispatch review_status + import/mail verify_status). null — not zero —
  // when the metric read failed, so "verified" is never fabricated.
  verifiedPassedThisWeek: number | null;
  verifiablesTotalThisWeek: number | null;

  // Activity summary (last 24h).
  dispatchesCompletedLast24h: number;
  dispatchesFlaggedLast24h: number;
  asksOpenCount: number;
  asksUrgentCount: number;

  // Per-agent activity in last 24h.
  agentActivity: AgentActivitySummary[];
}

export interface ContinuousTickResult {
  ranAt: Date;
  durationMs: number;
  morningPulseRefreshed: boolean;
  signalsScanned: number;
  dispatchesQueued: number;
  asksFiredToFounder: number;
  errors: number;
  /**
   * The single highest-value move the brain identified this tick from the
   * real senses (decide-core). Observational in P0 — the loop THINKS and
   * logs its plan; acting on it stays gated behind SOLENE_DISPATCH_ENABLED +
   * the per-domain Trust Ledger. `null` only if pulse senses were unavailable.
   */
  plannedTopMove: RankedMove | null;
  /**
   * The outcome of routing the top move through governance this tick
   * ("acted" | "escalated" | "suppressed" | "error"), or null when the hands
   * are switched off (SOLENE_DISPATCH_ENABLED=false) and the loop only thinks.
   */
  actOutcomeStatus: string | null;
}

// ============================================================================
// Defaults — used when a sub-source throws.
// ============================================================================

const DEFAULT_AUTONOMY_HORIZON_DAYS = 7;
const DEFAULT_MRR = 0;
const DEFAULT_TRIALS = 0;

// ============================================================================
// composeMorningPulse
// ============================================================================

export async function composeMorningPulse(): Promise<MorningPulseSnapshot> {
  const generatedAt = new Date();
  const dayLabel = renderDayLabel(generatedAt);

  // Each best-effort block isolates its own failure so a single bad
  // source can't take down the whole pulse. Anything that throws is
  // logged + replaced with a default.
  const capital = await safeLoadCapital();
  const collab = await safeLoadFounderCollab();
  const dispatchActivity = await safeLoadDispatchActivity();
  const onboarding = await safeLoadOnboardingFunnel();
  const compliance = await safeLoadComplianceFindings();
  const agentActivity = await safeLoadAgentActivity();
  const prodVersion = await safeLoadProdVersion();

  // Autonomy Horizon — derived honestly from the Trust Ledger (how much each
  // domain has EARNED the right to run alone), not a stub. Best-effort: falls
  // back to the conservative default if the ledger can't be read.
  let autonomyHorizonDays = DEFAULT_AUTONOMY_HORIZON_DAYS;
  try {
    const { getTrustLedger, deriveAutonomyHorizonDays } = await import(
      "../autopilot/domainAutonomy"
    );
    const ledger = await getTrustLedger();
    if (ledger.length > 0) {
      autonomyHorizonDays = deriveAutonomyHorizonDays(ledger.map((d) => d.level));
    }
  } catch (err) {
    logger.warn(
      "[continuousLoop] autonomy-horizon derivation failed; using default",
      err instanceof Error ? err : undefined,
    );
  }

  // Uptime: REAL, derived from worker heartbeat-gap samples over a 30-day
  // rolling window. null (not a flattering default) when there isn't enough
  // measured data to claim a number — the founder surface shows "no data yet".
  let uptimePct: number | null = null;
  try {
    const { getUptimePct } = await import("../autopilot/uptime");
    uptimePct = await getUptimePct();
  } catch (err) {
    logger.warn(
      "[continuousLoop] uptime read failed; reporting no data",
      err instanceof Error ? err : undefined,
    );
  }

  // Tick metric (b) — founder decisions consumed vs. the constitutional
  // budget (kernel-restructure step 5) — and metric (c), verification
  // coverage (Jarvis Phase 1 CP4). Best-effort: a failed read reports
  // null (unmeasured), never a flattering zero. The budget itself is static
  // constitutional data, so it is always known.
  let founderDecisionsUsedThisWeek: number | null = null;
  let verifiedPassedThisWeek: number | null = null;
  let verifiablesTotalThisWeek: number | null = null;
  try {
    const { getTickMetric } = await import("./tickMetric");
    const metric = await getTickMetric(generatedAt);
    founderDecisionsUsedThisWeek = metric.founderDecisionsThisWeek;
    verifiedPassedThisWeek = metric.verifiedPassed;
    verifiablesTotalThisWeek = metric.verifiablesTotal;
  } catch (err) {
    logger.warn(
      "[continuousLoop] tick-metric read failed; reporting decisions-used as unmeasured",
      err instanceof Error ? err : undefined,
    );
  }

  const snapshot: MorningPulseSnapshot = {
    generatedAt,
    dayLabel,
    oneLine: "", // filled below once all fields are populated
    mrr: DEFAULT_MRR,
    trials: DEFAULT_TRIALS,
    uptimePct,
    prodVersion,
    complianceOpenCount: compliance.openCount,
    weeklySpendUsd: capital.weeklySpendUsd,
    decisionsWaitingCount: collab.openCount,
    autonomyHorizonDays,
    envelopeStatus: capital.envelopeStatus,
    founderDecisionsUsedThisWeek,
    founderDecisionsBudget: FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek,
    verifiedPassedThisWeek,
    verifiablesTotalThisWeek,
    dispatchesCompletedLast24h: dispatchActivity.completedLast24h,
    dispatchesFlaggedLast24h: dispatchActivity.flaggedLast24h,
    asksOpenCount: collab.openCount,
    asksUrgentCount: collab.urgentCount,
    agentActivity,
  };
  // First-value funnel feeds trials count (signups in window with a
  // signup event but no first-value event yet).
  snapshot.trials = onboarding.trials;
  snapshot.mrr = onboarding.mrr;

  snapshot.oneLine = renderOneLine(snapshot);

  return snapshot;
}

// ============================================================================
// renderOneLine — canonical 7am ET morning brief format.
// ============================================================================

export function renderOneLine(snapshot: MorningPulseSnapshot): string {
  // Format per the team_solene brief, extended by kernel-restructure step 5
  // and Jarvis Phase 1 CP4:
  //   "{Day} {Date} · ${MRR} MRR · +{N} trials · {X.X}% uptime ·
  //    {N}/{N} compliance · ${X.XX} week-cost · {N} decisions waiting ·
  //    {X}/{B} decisions used · verified: {N}/{M} · Horizon: {D} days"
  // The line has no hard character cap (it renders on the founder Today page
  // and in the cron log), but it stays a single " · "-joined sentence — one
  // segment per number, no prose.
  const mrr = Math.round(snapshot.mrr).toLocaleString();
  const uptime = snapshot.uptimePct != null ? `${snapshot.uptimePct.toFixed(1)}% uptime` : "uptime n/a";
  const spend = snapshot.weeklySpendUsd.toFixed(2);
  // Compliance fraction: open / open (we only track open right now —
  // both numerator and denominator are the open count, matching the
  // 0/0 → "all clear" shape).
  const complianceFrac = `${snapshot.complianceOpenCount}/${snapshot.complianceOpenCount}`;
  // Founder decisions consumed vs. the constitutional weekly budget.
  // Unmeasured (failed read) renders honestly as n/a, never as 0/5.
  const decisionsUsed =
    snapshot.founderDecisionsUsedThisWeek != null
      ? `${snapshot.founderDecisionsUsedThisWeek}/${snapshot.founderDecisionsBudget} decisions used`
      : "decisions used n/a";
  // Verification coverage (CP4). Unmeasured renders honestly as n/a; a
  // measured-but-empty week is an explicit 0/0, never a hidden segment.
  const verified =
    snapshot.verifiedPassedThisWeek != null && snapshot.verifiablesTotalThisWeek != null
      ? snapshot.verifiablesTotalThisWeek === 0
        ? "verified: 0/0 (nothing verifiable this week)"
        : `verified: ${snapshot.verifiedPassedThisWeek}/${snapshot.verifiablesTotalThisWeek}`
      : "verified n/a";
  return [
    `${snapshot.dayLabel}`,
    `$${mrr} MRR`,
    `+${snapshot.trials} trials`,
    uptime,
    `${complianceFrac} compliance`,
    `$${spend} week-cost`,
    `${snapshot.decisionsWaitingCount} decisions waiting`,
    decisionsUsed,
    verified,
    `Horizon: ${snapshot.autonomyHorizonDays} days`,
  ].join(" · ");
}

// ============================================================================
// persistMorningPulse + getLatestMorningPulse
// ============================================================================

export async function persistMorningPulse(
  snapshot: MorningPulseSnapshot,
): Promise<{ pulseId: number }> {
  const [row] = await db
    .insert(soleneMorningPulse)
    .values({
      generatedAt: snapshot.generatedAt,
      snapshot: snapshot as unknown as Record<string, unknown>,
    })
    .returning({ id: soleneMorningPulse.id });
  return { pulseId: row?.id ?? 0 };
}

export async function getLatestMorningPulse(): Promise<MorningPulseSnapshot | null> {
  try {
    const rows = await db
      .select()
      .from(soleneMorningPulse)
      .orderBy(desc(soleneMorningPulse.generatedAt))
      .limit(1);
    if (rows.length === 0) return null;
    return hydrateRow(rows[0]);
  } catch (err) {
    logger.warn(
      "[continuousLoop] getLatestMorningPulse failed; returning null",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

function hydrateRow(row: SoleneMorningPulseRow): MorningPulseSnapshot {
  const blob = (row.snapshot ?? {}) as Partial<MorningPulseSnapshot>;
  // Dates round-trip as ISO strings through jsonb — coerce back to Date
  // for the few timestamps in the snapshot.
  const generatedAt =
    blob.generatedAt instanceof Date
      ? blob.generatedAt
      : new Date(
          typeof blob.generatedAt === "string"
            ? blob.generatedAt
            : row.generatedAt.toISOString(),
        );
  const agentActivity = Array.isArray(blob.agentActivity)
    ? blob.agentActivity.map((a) => ({
        agentRole: String(a.agentRole ?? ""),
        dispatchesCompleted: Number(a.dispatchesCompleted ?? 0),
        decisionsRecorded: Number(a.decisionsRecorded ?? 0),
        lastActivityAt:
          a.lastActivityAt instanceof Date
            ? a.lastActivityAt
            : a.lastActivityAt != null
              ? new Date(a.lastActivityAt as unknown as string)
              : null,
      }))
    : [];
  return {
    generatedAt,
    dayLabel: String(blob.dayLabel ?? renderDayLabel(generatedAt)),
    oneLine: String(blob.oneLine ?? ""),
    mrr: Number(blob.mrr ?? 0),
    trials: Number(blob.trials ?? 0),
    // Legacy rows persisted before uptime went nullable may carry the old
    // 99.9 stub — that's baked history; new snapshots only store real numbers.
    uptimePct: typeof blob.uptimePct === "number" ? blob.uptimePct : null,
    prodVersion: String(blob.prodVersion ?? "unknown"),
    complianceOpenCount: Number(blob.complianceOpenCount ?? 0),
    weeklySpendUsd: Number(blob.weeklySpendUsd ?? 0),
    decisionsWaitingCount: Number(blob.decisionsWaitingCount ?? 0),
    autonomyHorizonDays: Number(
      blob.autonomyHorizonDays ?? DEFAULT_AUTONOMY_HORIZON_DAYS,
    ),
    envelopeStatus:
      blob.envelopeStatus === "amber" || blob.envelopeStatus === "red"
        ? blob.envelopeStatus
        : "green",
    // Legacy rows predate the tick metric — null (unmeasured), never 0.
    founderDecisionsUsedThisWeek:
      typeof blob.founderDecisionsUsedThisWeek === "number"
        ? blob.founderDecisionsUsedThisWeek
        : null,
    founderDecisionsBudget: Number(
      blob.founderDecisionsBudget ?? FOUNDER_MINUTES_BUDGET.classABDecisionsPerWeek,
    ),
    // Legacy rows predate CP4 verification coverage — null (unmeasured), never 0.
    verifiedPassedThisWeek:
      typeof blob.verifiedPassedThisWeek === "number" ? blob.verifiedPassedThisWeek : null,
    verifiablesTotalThisWeek:
      typeof blob.verifiablesTotalThisWeek === "number" ? blob.verifiablesTotalThisWeek : null,
    dispatchesCompletedLast24h: Number(blob.dispatchesCompletedLast24h ?? 0),
    dispatchesFlaggedLast24h: Number(blob.dispatchesFlaggedLast24h ?? 0),
    asksOpenCount: Number(blob.asksOpenCount ?? 0),
    asksUrgentCount: Number(blob.asksUrgentCount ?? 0),
    agentActivity,
  };
}

// ============================================================================
// runContinuousTick — between-session pulse refresh + signal walk.
// ============================================================================

export async function runContinuousTick(): Promise<ContinuousTickResult> {
  const ranAt = new Date();
  const start = Date.now();
  let morningPulseRefreshed = false;
  let signalsScanned = 0;
  let dispatchesQueued = 0;
  let asksFiredToFounder = 0;
  let errors = 0;
  // Dispatch backlog (queued-but-not-run) feeds the brain's grow-gate so it
  // never piles more outward work onto an already-saturated queue.
  let dispatchBacklog = 0;

  // Kernel-restructure step 5 (founder directive 2026-07-13): every cycle
  // OPENS with the two numbers — (a) customer-visible/revenue-relevant
  // outcomes shipped this week, (b) founder decisions consumed vs. the
  // constitutional budget — plus (c) verification coverage "verified: N/M"
  // (Jarvis Phase 1 CP4) and (d) the Horizon A1 outcome ledger (predictions
  // scored/pending/overdue, trailing 90 days). A machine graded only on
  // restraint optimizes for restraint. Best-effort: a failed read logs
  // "unmeasured", never zero.
  try {
    const { getTickMetric } = await import("./tickMetric");
    const metric = await getTickMetric(ranAt);
    logger.info("[continuousLoop] tick: cycle metric", {
      metadata: {
        revenueRelevantShippedThisWeek: metric.revenueRelevantShippedThisWeek,
        shippedBreakdown: metric.shippedBreakdown,
        founderDecisionsThisWeek: metric.founderDecisionsThisWeek,
        founderDecisionsBudget: metric.founderDecisionsBudget,
        budgetSource: metric.budgetSource,
        verifiedPassed: metric.verifiedPassed,
        verifiedFlagged: metric.verifiedFlagged,
        verifiablesTotal: metric.verifiablesTotal,
        verificationBreakdown: metric.verificationBreakdown,
        // Metric (d) — Horizon A1 outcome ledger, trailing 90 days. Honest
        // zeros until decisions carry predictions; overdue is reported,
        // never backfilled.
        outcomesScored90d: metric.outcomesScored90d,
        outcomesPositive90d: metric.outcomesPositive90d,
        outcomesPending90d: metric.outcomesPending90d,
        outcomesOverdue90d: metric.outcomesOverdue90d,
        outcomeLedgerBreakdown: metric.outcomeLedgerBreakdown,
      },
    });
  } catch (err) {
    logger.warn(
      "[continuousLoop] tick: cycle metric read failed — the two numbers are unmeasured this cycle (not zero)",
      err instanceof Error ? err : undefined,
    );
  }

  // Refresh the morning pulse if the latest row is older than 6 hours
  // (this is the between-cron safety net; the daily 12:00 UTC job is
  // the primary path).
  try {
    const latest = await getLatestMorningPulse();
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    if (
      !latest ||
      ranAt.getTime() - latest.generatedAt.getTime() > SIX_HOURS
    ) {
      const snap = await composeMorningPulse();
      await persistMorningPulse(snap);
      morningPulseRefreshed = true;
    }
  } catch (err) {
    errors += 1;
    logger.warn(
      "[continuousLoop] tick: pulse refresh failed",
      err instanceof Error ? err : undefined,
    );
  }

  // Scan open founder asks — signalsScanned counts the surfaces we
  // touched, even if no dispatch resulted. Keeps the cron observability
  // honest.
  try {
    const { listOpenAsks } = await import("./founderCollab");
    const asks = await listOpenAsks();
    signalsScanned += asks.length;
    // Urgent asks fire the page channel (Phase 0: ask was already
    // surfaced when raised; this is a re-page only when the ask is past
    // the founder-notice window. For now we don't double-page — leave
    // the existing single-page flow intact and increment the counter
    // for observability).
    for (const a of asks) {
      if (a.urgency === "urgent") asksFiredToFounder += 1;
    }
    // Escalation ladder (wire-for-real: escalationLadder). Absence fails safe —
    // re-page a stale ask, and auto-resolve an unanswered DECISION to the safe
    // side (timed_out; the system never acted on an unapproved go/no-go). The
    // 30-min tick cadence is the re-page debounce window. Best-effort.
    try {
      const { runAskEscalationLadder } = await import("./founderCollab");
      const r = await runAskEscalationLadder(0.5);
      asksFiredToFounder += r.repaged;
    } catch (ladderErr) {
      logger.warn(
        "[continuousLoop] tick: escalation ladder failed",
        ladderErr instanceof Error ? ladderErr : undefined,
      );
    }
  } catch (err) {
    errors += 1;
    logger.warn(
      "[continuousLoop] tick: founder-asks scan failed",
      err instanceof Error ? err : undefined,
    );
  }

  // Scan recent dispatches for flagged/failed terminal states. The
  // remediation-dispatch enqueue path is owned by Solene's reviewer
  // queue (codeReviewQueue); we only increment the scanned counter
  // here so the cron is observable. Auto-enqueue logic stays gated to
  // the codeReviewQueue's own guardrails to avoid double-firing.
  try {
    const { listDispatches } = await import("./dispatchQueue");
    const recent = await listDispatches({ limit: 50 });
    signalsScanned += recent.length;
    dispatchBacklog = recent.filter((r) => r.queue.status === "queued").length;
  } catch (err) {
    errors += 1;
    logger.warn(
      "[continuousLoop] tick: dispatch scan failed",
      err instanceof Error ? err : undefined,
    );
  }

  // Autonomous incident triage (wire-for-real: rootCause). A loud recurring
  // error enqueues ONE investigation dispatch that proposes a fix as a local
  // commit/diff for founder review — never pushes/merges/deploys. Gated by the
  // dispatch master switch (runIncidentTriage no-ops when off) + deduped.
  try {
    const { runIncidentTriage } = await import("../autopilot/rootCause");
    const r = await runIncidentTriage({ windowHours: 24 });
    if (r.enqueued) {
      dispatchesQueued += 1;
      logger.info("[continuousLoop] tick: incident triage enqueued", {
        metadata: { signature: r.signature, dispatchId: r.dispatchId },
      });
    }
  } catch (err) {
    logger.warn(
      "[continuousLoop] tick: incident triage failed",
      err instanceof Error ? err : undefined,
    );
  }

  // Code-review queue scan — surfaces pending review items so the
  // signalsScanned counter reflects total work-in-flight. Enqueue
  // logic stays in codeReviewQueue.
  try {
    const { listPendingReviews } = await import("./codeReviewQueue");
    const reviews = await listPendingReviews();
    signalsScanned += reviews.length;
  } catch (err) {
    errors += 1;
    logger.warn(
      "[continuousLoop] tick: pending-reviews scan failed",
      err instanceof Error ? err : undefined,
    );
  }

  // ── The brain THINKS ──────────────────────────────────────────────────
  // Compute the single highest-value move from the real senses (decide-core).
  // This is judgment, not action: the loop now reasons about what it *would*
  // work next and logs it, so the plan is observable in the cron output well
  // before any execution is enabled. Acting on the plan stays gated behind
  // SOLENE_DISPATCH_ENABLED + the per-domain Trust Ledger. Honesty: only
  // genuinely-measured senses feed the decision — unmeasured ones default to
  // the truthful "none known" inside sensesFromPulse, never invented.
  let plannedTopMove: RankedMove | null = null;
  // Frontier #2 — per-move predicted causal EV, retained from the ranking step
  // so the reasoning trace can surface shadow regret (read-only; never learning).
  let moveEvByKind: Record<string, number> = {};
  // Frontier #8 — confidence from council disagreement (1 = unanimous/no panel).
  // Combined with calibration confidence by MIN at the risk gate (only tightens).
  let councilConf = 1;
  let actOutcomeStatus: string | null = null;
  try {
    const pulse = await getLatestMorningPulse();
    if (pulse) {
      // Real support backlog — a measured sense, best-effort (defaults to 0).
      const { getOpenSupportCaseCount } = await import("../autopilot/senses");
      const supportBacklog = await getOpenSupportCaseCount();
      // Outward perception (Hands P0.2) — best-effort; defaults to none-known so
      // a quiet/unwired channel never fabricates pressure.
      let outward: { emailComplaints?: number; dunningPressure?: number; churnSignals?: number; trialsEnding?: number; reflexFailures?: number; dealEvents24h?: number; notePaymentsDueSoon?: number; notePaymentsOverdue?: number } = {};
      try {
        const { readOutwardSenses, outwardSignalFrom } = await import("../autopilot/perception");
        const sig = outwardSignalFrom(await readOutwardSenses(24));
        outward = { emailComplaints: sig.emailComplaints, dunningPressure: sig.dunningPressure, churnSignals: sig.churnSignals, trialsEnding: sig.trialsEnding, notePaymentsDueSoon: sig.notePaymentsDueSoon, notePaymentsOverdue: sig.notePaymentsOverdue };
      } catch { /* perception is best-effort */ }
      // Deal-shaped perception (Jarvis 2.1, audit G2) — the tick now sees
      // pipeline motion from the mesh's own ledger. Best-effort; a quiet or
      // unreadable channel is an honest zero, never invented pressure.
      try {
        const { getDealActivitySignal } = await import("../autopilot/senses");
        outward.dealEvents24h = (await getDealActivitySignal(24)).events;
      } catch { /* deal perception is best-effort */ }
      // Reflex perception (H1) — the brain now sees the autonomic job layer.
      try {
        const { readReflexHealth } = await import("../autopilot/reflexes");
        outward.reflexFailures = (await readReflexHealth(6)).failed;
      } catch { /* reflex perception is best-effort */ }
      const senses = sensesFromPulse(
        {
          mrr: pulse.mrr,
          trials: pulse.trials,
          complianceOpenCount: pulse.complianceOpenCount,
          envelopeStatus: pulse.envelopeStatus,
          dispatchesFlaggedLast24h: pulse.dispatchesFlaggedLast24h,
        },
        { dispatchBacklog, supportBacklog },
        outward,
      );
      let moves = rankMoves(senses);
      // Forward-looking forecast (wire-for-real: proactiveForecast). Reactive
      // senses miss problems that are weeks out; this projects the reserve
      // runway from real ledger data and, when a breach is inside the lead
      // window, raises FINANCE urgency before it bites. Best-effort.
      let preemptiveMoves: Array<{ kind: string; leadDays: number; rationale: string }> = [];
      try {
        const { computeRunwayForecast } = await import("../autopilot/proactiveForecast");
        preemptiveMoves = await computeRunwayForecast();
        if (preemptiveMoves.length) {
          logger.info("[continuousLoop] tick: preemptive forecast", {
            metadata: { moves: preemptiveMoves.map((m) => `${m.kind}@${m.leadDays}d`) },
          });
        }
      } catch { /* forecast is best-effort */ }
      const preemptiveRunwayRisk = preemptiveMoves.some((m) => m.kind === "protect_runway");
      // Within-tier ordering (best-effort; never crosses tiers → safety ladder
      // is untouched). Blends two signals:
      //   • objective urgency (P5) — toward the numbers that most need moving;
      //   • cross-function coordination (H3) — toward the domain with the highest
      //     NET P&L impact, dampening a domain that would overload a stressed one
      //     (e.g. don't push growth while support is underwater).
      try {
        const { coordinationWeights } = await import("../autopilot/crossFunction");
        const coord = coordinationWeights(senses);
        let blended = { growth: coord.growth, support: coord.support, finance: coord.finance, deploy: coord.deploy, ops: coord.ops };
        try {
          const { listObjectives, domainUrgency } = await import("../autopilot/objectives");
          let objectives = await listObjectives(true);
          // Audit-fix (CEO finding): the objectives table was empty at runtime
          // because seedGrowthObjectives was never called → domainUrgency returned
          // a neutral 1.0 for everything and the "move these numbers" weighting did
          // nothing. Seed the default acquisition funnel on first sight (idempotent
          // upsert), so the brain actually has goals to steer toward.
          if (objectives.length === 0) {
            const { seedGrowthObjectives } = await import("../autopilot/growthEngine");
            await seedGrowthObjectives();
            objectives = await listObjectives(true);
          }
          if (objectives.length > 0) {
            for (const d of ["growth", "support", "finance", "deploy", "ops"] as const) {
              blended[d] = blended[d] * domainUrgency(objectives, d);
            }
          }
        } catch { /* objective urgency is best-effort */ }
        // Forward-looking finance urgency (wire-for-real: proactiveForecast):
        // a projected runway breach raises finance weight so the brain acts
        // ahead of the problem, not after. Within-tier only — never crosses the
        // safety ladder.
        if (preemptiveRunwayRisk) blended.finance *= 1.5;
        moves = applyObjectiveWeighting(moves, blended);
      } catch { /* within-tier weighting is best-effort */ }
      // T2.2: causal EV/$ tiebreak — among same-tier DISCRETIONARY candidates,
      // prefer the one with the highest predicted outcome movement × confidence
      // (the planning oracle, finally wired into the decision). Within-tier only;
      // the safety ladder is untouched. Uses the model REFINED from real
      // consequence (T1.1), so at cold-start it leans on the seed priors and
      // sharpens as consequence accrues. Best-effort.
      try {
        const { rankMovesByCausalEv, refineModel, evidenceByLever, moveEvMap } = await import("../autopilot/worldModel");
        const { resolveActivePack } = await import("../autopilot/activePack");
        const { getPastEpisodes } = await import("../autopilot/experienceLog");
        const activePack = resolveActivePack();
        const evMap = evidenceByLever(await getPastEpisodes(200), activePack.moveToLever);
        // ACQUISITION LOOP-CLOSER (panel): fold REAL Search Console reach into the
        // owned-growth/publish lever's evidence, so the world-model edge
        // (publish_guide → … → search_impressions) moves prior→measured off a
        // genuine, zero-capital consequence — a published guide earning search
        // reach. Confidence-refinement only (never the Thompson reward). Gated on
        // GSC being configured (safe-off) + best-effort.
        try {
          const { gscConfigured, getSearchConsoleMetrics, searchReachEvidence } = await import("../autopilot/searchConsoleSense");
          const reachLever = activePack.moveToLever["grow_owned_channels"];
          if (reachLever && gscConfigured()) {
            const reach = searchReachEvidence(await getSearchConsoleMetrics());
            if (reach.successes > 0 || reach.failures > 0) {
              const cur = evMap[reachLever] ?? { successes: 0, failures: 0 };
              evMap[reachLever] = { successes: cur.successes + reach.successes, failures: cur.failures + reach.failures };
              logger.info(`[continuousLoop] folded GSC reach into world-model: lever=${reachLever} +${reach.successes}s/${reach.failures}f`);
            }
          }
        } catch { /* GSC reach fold is best-effort — the model still refines from episodes */ }
        const causalModel = refineModel(activePack.causalModel, evMap);
        moves = rankMovesByCausalEv(moves, causalModel, activePack.moveToLever);
        // Frontier #2 — retain the per-move predicted EV so the trace can show
        // shadow regret (the road not taken). Read-only; never feeds learning.
        moveEvByKind = moveEvMap(moves, causalModel, activePack.moveToLever);
      } catch { /* causal EV tiebreak best-effort */ }
      plannedTopMove = moves[0] ?? null;
      if (plannedTopMove) {
        logger.info("[continuousLoop] tick: brain plan", {
          topMove: plannedTopMove.kind,
          domain: plannedTopMove.domain,
          priority: plannedTopMove.priority,
          rationale: plannedTopMove.rationale,
          candidateCount: moves.length,
          dispatchBacklog,
        });

        // Self-marketing posture (free-first / paid-when-proven) — the autopilot
        // reasons about its OWN marketing each tick. Best-effort + logged; the
        // discipline keeps paid LOCKED until the free funnel is proven. Wiring
        // the per-domain action ladders into their per-instance handlers
        // (support/finance) is the follow-on; growth fits the aggregate tick.
        try {
          const { readMarketingState, eligibleMarketingChannels, marketingPostureLine } = await import("../autopilot/marketingChannels");
          const mkt = await readMarketingState();
          logger.info("[continuousLoop] tick: self-marketing posture", {
            posture: marketingPostureLine(mkt),
            eligibleChannels: eligibleMarketingChannels(mkt).map((c) => c.id),
          });
        } catch {
          /* self-marketing posture is best-effort */
        }

        // ── The brain ACTS (only when the hands are switched on) ───────────
        // Route the top move through the full governance spine. Safe even when
        // enabled: at OBSERVE the autonomy gate blocks → "suppressed", nothing
        // is enqueued; customer-facing moves escalate to a human tap. When a
        // domain has earned autonomy, "acted" enqueues a governed dispatch.
        // The switch is DB-backed (Control Center) with the env var as default.
        const { isDispatchEnabled } = await import("../autopilot/settings");
        if (await isDispatchEnabled()) {
          const { runPolicyGateStack } = await import("../autopilot/policyGate");
          const { classifyEscalation } = await import("../autopilot/escalation");
          const { enqueueDispatch } = await import("./dispatchQueue");
          const { askFounder } = await import("./founderCollab");

          // Growth specialization: when the move is "grow owned channels," pick
          // a CONCRETE owned, ~$0 play from the playbook (rotating by how many
          // growth plays have already run) and enrich the move's rationale so
          // the dispatch is a specific tasteful action, not a generic one.
          // A single cheap model handle, reused by deliberation (neuro-symbolic
          // re-weighing of a close call) AND the adversarial pre-mortem skeptic.
          // Built only when an API key exists; both features fall back safely
          // when it's absent.
          const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
          let callModel: ((prompt: string) => Promise<string>) | null = null;
          if (apiKey) {
            try {
              const OpenAImod = (await import("openai")).default;
              const client = new OpenAImod({ apiKey, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
              const { tracedLlmCall } = await import("../tracedLlmCall");
              const { OPENAI_DIRECT_MODELS, openAiModelIdFor } = await import("../models");
              // The default is named for whichever provider
              // AI_INTEGRATIONS_OPENAI_BASE_URL points at — the client three
              // lines above is built from that same var, and OpenRouter 404s
              // the bare OpenAI name. An explicitly configured
              // AUTOPILOT_DELIBERATION_MODEL is passed through untouched.
              const model = process.env.AUTOPILOT_DELIBERATION_MODEL ?? openAiModelIdFor(
                process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
                OPENAI_DIRECT_MODELS.GPT4O_MINI,
              );
              callModel = async (prompt: string) =>
                (
                  await tracedLlmCall({
                    agentCodename: "autopilot",
                    purpose: "deliberation",
                    model,
                    userPrompt: prompt,
                    call: () =>
                      client.chat.completions.create({
                        model,
                        temperature: 0.2,
                        max_tokens: 300,
                        messages: [{ role: "user", content: prompt }],
                      }),
                  })
                ).content;
              // T2.1: bound cognition to a per-tick ceiling so wiring the
              // Operator + per-move pre-mortems can never blow the budget or
              // deadlock the money gate. Once exhausted, callModel returns "" and
              // each consumer falls back to its deterministic path.
              const { CognitionBudget } = await import("../autopilot/cognitionBudget");
              const cognitionBudget = new CognitionBudget();
              callModel = cognitionBudget.wrap(callModel, () =>
                logger.info("[continuousLoop] cognition budget exhausted this tick — deterministic fallback"),
              );
            } catch {
              callModel = null;
            }
          }

          // Living memory: recall the most similar past situations and what
          // worked in them. Surfaced in the trace (the founder sees the
          // precedent) and fed to deliberation so a close call reasons from
          // real history. Honest: empty when there's no comparable past.
          let memoryNote: string | null = null;
          // Situation-similar episodes, captured for the CONTEXTUAL forecast
          // below (P(success | situation, action), not just P(success | action)).
          let recalledEpisodes: Array<{ moveKind: string; vote: string }> = [];
          try {
            const { getPastEpisodes } = await import("../autopilot/experienceLog");
            const { recallSimilar, summarizeRecall } = await import("../autopilot/memory");
            const episodes = await getPastEpisodes(200);
            const recalled = recallSimilar(senses, episodes as never, 5);
            recalledEpisodes = recalled.map((e) => ({ moveKind: e.moveKind, vote: String(e.vote) }));
            if (recalled.length > 0) {
              memoryNote = summarizeRecall(recalled).note;
              logger.info("[continuousLoop] tick: memory recall", { note: memoryNote });
            }
          } catch (memErr) {
            logger.warn(
              "[continuousLoop] tick: memory recall failed",
              memErr instanceof Error ? memErr : undefined,
            );
          }

          // Deliberation: for a genuinely close call, the council re-weighs the
          // top options — but only ever REORDERS within the rules' candidate set
          // (it can't invent an action), and every gate still binds. Memory feeds
          // it as precedent.
          let effectiveMoves = moves;
          // T2.3: the Operator may author a NET-NEW move (a play the deterministic
          // catalog lacks), reconciled UNDER the safety floor — planToActions keeps
          // the mandatory (most-urgent) tier immovable. Gated by cognition-enabled;
          // one model call, budget-bounded (callModel is wrapped). A net-new move is
          // forced through witnessed-send in the BODY (moveToPolicyAction) — it can
          // never auto-execute; a fabricated-number net-new move is dropped (the
          // grounding gate in runOperator). Best-effort — deterministic stands.
          try {
            const { isCognitionEnabled } = await import("../autopilot/settings");
            if (callModel && (await isCognitionEnabled())) {
              const { runOperator, OPERATOR_KNOWN_KINDS } = await import("../autopilot/operator");
              const { gatherContextPack } = await import("../autopilot/cognitionContext");
              const pack = await gatherContextPack();
              const { reconciled } = await runOperator(pack.briefing, effectiveMoves, OPERATOR_KNOWN_KINDS, { callModel });
              if (!reconciled.fellBack && reconciled.moves.length > 0) {
                effectiveMoves = reconciled.moves;
                if (reconciled.netNewKinds.length > 0) {
                  logger.info("[continuousLoop] operator proposed net-new (forced witnessed)", {
                    netNewKinds: reconciled.netNewKinds,
                  });
                }
              }
            }
          } catch { /* operator best-effort — deterministic ranking stands */ }
          try {
            const { shouldDeliberate, runCouncilPanel } = await import("../autopilot/deliberate");
            if (callModel && shouldDeliberate(effectiveMoves)) {
              // Frontier #8 — a PANEL (not a single voice). The consensus
              // reorders; the measured disagreement lowers confidence, which the
              // risk gate consumes by MIN (a divided council escalates, never
              // auto-acts on a coin-flip). Bounded spend (n small, budget-wrapped).
              const del = await runCouncilPanel(senses, effectiveMoves, { callModel }, 3, memoryNote);
              effectiveMoves = del.moves;
              councilConf = del.confidence;
              if (del.deliberated) {
                logger.info("[continuousLoop] tick: council deliberated", {
                  recommended: del.verdict?.recommendedKind,
                  top: effectiveMoves[0]?.kind,
                  agreement: del.aggregate.agreement,
                  votes: del.aggregate.votes,
                });
              }
            }
          } catch (delErr) {
            logger.warn(
              "[continuousLoop] tick: deliberation failed; using ranking",
              delErr instanceof Error ? delErr : undefined,
            );
          }

          let actMove = effectiveMoves[0] ?? plannedTopMove;
          // The play this action runs (for the Experience Log / efficacy model);
          // null for moves without a play (e.g. optimize).
          let selectedPlayId: string | null = null;
          // The county the growth play was pinned to this tick (seeded/demand
          // queue), marked dispatched only if the move actually ACTS.
          let selectedGrowthTarget: { id: number; countyLabel: string; state: string } | null = null;
          // Support specialization: real people are waiting — make the move a
          // concrete, craft-bound triage-and-draft pass (witnessed-send keeps
          // every reply behind the founder's tap).
          if (actMove.kind === "clear_support_backlog") {
            try {
              const { supportPlayRationale } = await import("../autopilot/supportPlaybook");
              actMove = { ...actMove, rationale: supportPlayRationale(supportBacklog) };
              selectedPlayId = "support-triage";
            } catch (sErr) {
              logger.warn(
                "[continuousLoop] tick: support play rationale failed; using generic move",
                sErr instanceof Error ? sErr : undefined,
              );
            }
          }
          if (actMove.kind === "grow_owned_channels") {
            try {
              const { GROWTH_PLAYS, growthPlayById, growthPlayRationale, selectNextGrowthPlay } =
                await import("../autopilot/growthPlaybook");
              const { getPlayStats } = await import("../autopilot/experienceLog");
              const { selectPlay, exploitPlay, makeSeededRng, pooledPrior } = await import("../autopilot/efficacy");
              const { getStoppedPlayIds } = await import("../autopilot/policyInducer");
              // Evidence-weighted selection (Thompson sampling) over the REAL
              // track record. Cold-start (no data) ⇒ ~uniform, i.e. equivalent to
              // the old rotation; learning only emerges as outcomes accrue. The
              // RNG is a seeded sampling source (per-tick seed), not Math.random.
              // Plays the founder approved stopping are excluded.
              const stats = await getPlayStats("growth");
              const stopped = await getStoppedPlayIds();
              const live = GROWTH_PLAYS.filter((p) => !stopped.has(p.id));
              const pool = live.length > 0 ? live : GROWTH_PLAYS;
              const candidates = pool.map(
                (p) => stats.find((s) => s.playId === p.id) ?? { playId: p.id, successes: 0, failures: 0 },
              );
              // Frontier #10 — constrained exploration: Thompson sampling still
              // balances explore/exploit per pick, but the GOVERNOR caps the
              // rolling exploration rate (and zeroes it when runway is red), so
              // the brain can't churn on unproven plays when every dollar counts.
              // Over budget ⇒ force the greedy (best-evidence) pick. Safety-
              // monotone + best-effort (any failure falls back to Thompson).
              const prior = pooledPrior(candidates);
              let pickedId: string | null;
              try {
                const { governExploration, explorationCapForRunway } = await import("../autopilot/loopStability");
                const { getRecentStory } = await import("../autopilot/experienceLog");
                const recentGrowth = (await getRecentStory(24))
                  .filter((e) => e.domain === "growth" && e.playId)
                  .slice(0, 8)
                  .map((e) => e.playId as string);
                const greedyNow = exploitPlay(candidates, prior);
                const explores = recentGrowth.filter((p) => p !== greedyNow).length;
                const cap = explorationCapForRunway(senses.envelopeStatus);
                const verdict = governExploration(explores, recentGrowth.length, cap);
                pickedId = verdict.mayExplore
                  ? selectPlay(candidates, makeSeededRng(Date.now()), prior)
                  : greedyNow;
              } catch {
                pickedId = selectPlay(candidates, makeSeededRng(Date.now()), prior);
              }
              const play = (pickedId && growthPlayById(pickedId)) || selectNextGrowthPlay(0);
              selectedPlayId = play.id;
              // County-targeted owned content: for a county guide, pin it to the
              // next queued target (seeded buy-box county now, demand-ranked
              // later) so it answers a real long-tail search. Falls back to a
              // generic guide when the queue is empty.
              let focus: { countyLabel: string; state: string } | null = null;
              if (play.id === "county-guide") {
                const { selectNextGrowthTarget, refreshGrowthDemand } = await import("../autopilot/growthTargets");
                // Demand-rank the queue from real parcel-check volume before
                // selecting, so we write for the counties strangers actually check.
                await refreshGrowthDemand();
                const target = await selectNextGrowthTarget();
                if (target) {
                  focus = { countyLabel: target.countyLabel, state: target.state };
                  selectedGrowthTarget = { id: target.id, countyLabel: target.countyLabel, state: target.state };
                }
              }
              actMove = { ...actMove, rationale: growthPlayRationale(play, focus) };
              const picked = stats.find((s) => s.playId === play.id);
              logger.info("[continuousLoop] tick: growth play selected (efficacy-weighted)", {
                play: play.id,
                trackRecord: picked ? `${picked.successes}/${picked.successes + picked.failures}` : "untested",
              });
            } catch (playErr) {
              logger.warn(
                "[continuousLoop] tick: growth play selection failed; using generic move",
                playErr instanceof Error ? playErr : undefined,
              );
            }
          }

          // Your Voice: bind every outward action to the founder's active
          // standing orders + intents (instruction-level enforcement). Prepended
          // so the agent reads the founder's durable direction first.
          try {
            const { listStandingOrders, composeStandingOrdersBlock } = await import(
              "../autopilot/standingOrders"
            );
            const orders = await listStandingOrders({ activeOnly: true });
            const block = composeStandingOrdersBlock(orders);
            if (block) {
              actMove = { ...actMove, rationale: `${block}\n\n${actMove.rationale}` };
            }
          } catch (soErr) {
            logger.warn(
              "[continuousLoop] tick: standing-orders injection failed; proceeding without",
              soErr instanceof Error ? soErr : undefined,
            );
          }

          // Calibrated foresight: predict this action's outcome from its real
          // track record. The predicted probability is stored on the experience
          // (so the system can later measure its own calibration) and the
          // honest forecast line is attached to any founder ask. Only for moves
          // with a play (which have a structured history); null otherwise.
          let forecastLine: string | null = null;
          let predictedSuccess: number | null = null;
          let traceForecast: { successProb: number; n: number; confidence: string } | null = null;
          if (selectedPlayId) {
            try {
              const { getPlayStats } = await import("../autopilot/experienceLog");
              const { forecastMove, renderForecast } = await import("../autopilot/forecast");
              const ps =
                (await getPlayStats(actMove.domain)).find((s) => s.playId === selectedPlayId) ?? {
                  playId: selectedPlayId,
                  successes: 0,
                  failures: 0,
                };
              const fc = forecastMove({ successes: ps.successes, failures: ps.failures });
              forecastLine = renderForecast(fc);
              predictedSuccess = fc.successProb;
              traceForecast = { successProb: fc.successProb, n: fc.n, confidence: fc.confidence };

              // CONTEXTUAL upgrade (wire-for-real: contextualForecast). Blend the
              // play's GLOBAL track record (fc) with its LOCAL record in
              // situation-similar episodes, then recalibrate against the system's
              // own measured over/under-confidence. Falls back to the global
              // forecast when there's no comparable past — never invents signal.
              try {
                const { contextualForecast, buildRecalibrationMap, applyRecalibration } =
                  await import("../autopilot/contextualForecast");
                const local = recalledEpisodes
                  .filter((e) => e.moveKind === actMove.kind)
                  .reduce(
                    (acc, e) => {
                      if (e.vote === "success") acc.successes += 1;
                      else if (e.vote === "failure") acc.failures += 1;
                      return acc;
                    },
                    { successes: 0, failures: 0 },
                  );
                const cf = contextualForecast(
                  { successes: ps.successes, failures: ps.failures },
                  local,
                );
                const { getCalibrationPairs } = await import("../autopilot/experienceLog");
                const recalMap = buildRecalibrationMap(await getCalibrationPairs());
                const calibrated = applyRecalibration(cf.prob, recalMap);
                predictedSuccess = calibrated;
                traceForecast = {
                  successProb: calibrated,
                  n: fc.n + local.successes + local.failures,
                  confidence: fc.confidence,
                };
                forecastLine = `${renderForecast(fc)} · contextual ${(calibrated * 100).toFixed(0)}% (local wt ${(cf.localWeight * 100).toFixed(0)}%)`;
              } catch (cfErr) {
                logger.warn(
                  "[continuousLoop] tick: contextual forecast failed; using global",
                  cfErr instanceof Error ? cfErr : undefined,
                );
              }
            } catch (fcErr) {
              logger.warn(
                "[continuousLoop] tick: forecast failed; proceeding without",
                fcErr instanceof Error ? fcErr : undefined,
              );
            }
          }

          // Economic discipline (wire-for-real: economics.budgetGate). Before
          // spending the next autonomous dispatch's worst-case cost, confirm
          // there's discretionary room — reserving a slice of the monthly
          // envelope for non-deferrable work (incidents/support) so growth can't
          // starve the essentials. A GROWTH move is deferrable (it waits for
          // budget); support/finance are essential (reserve doesn't apply).
          let budgetDeferReason: string | null = null;
          try {
            const { budgetGate } = await import("../autopilot/economics");
            const { getEffectiveMonthlyCapUsd, getMonthToDateSpendForType } = await import(
              "./capitalTracker"
            );
            // Effective cap = base env/charter cap, widened by any founder-
            // approved growth-budget ramp (clamped to the hard ceiling). This is
            // how proven, paid-for acquisition actually unlocks more reach.
            const monthlyCapUsd = await getEffectiveMonthlyCapUsd();
            const spentThisMonthUsd = await getMonthToDateSpendForType("agent_dispatch");
            const deferrable = actMove.domain === "growth";
            const gate = budgetGate(
              { monthlyCapUsd, spentThisMonthUsd },
              AUTOPILOT_DISPATCH_MAX_COST_USD,
              { deferrable },
            );
            if (!gate.allowed) budgetDeferReason = gate.reason;
          } catch (budErr) {
            // Fail OPEN on a budget-read error: the ensemble cap + per-dispatch
            // cap already bound spend; this is an ADDITIONAL discretionary guard.
            logger.warn(
              "[continuousLoop] tick: budget gate read failed; proceeding (caps still bind)",
              budErr instanceof Error ? budErr : undefined,
            );
          }

          const { simulateMove, renderSimulation } = await import("../autopilot/simulate");
          // Panel #2 — exactly-once seal: a deterministic effect-key so a
          // concurrent tick (lock-TTL lapse) or retry dedups this dispatch
          // instead of double-firing the outward effect.
          const { computeEffectKey } = await import("./dispatchQueue");
          const effectKey = computeEffectKey({
            domain: actMove.domain,
            moveKind: actMove.kind,
            playId: selectedPlayId,
            targetId: selectedGrowthTarget ? String(selectedGrowthTarget.id) : null,
            nowMs: Date.now(),
          });
          const outcome = budgetDeferReason
            ? ({
                status: "suppressed" as const,
                move: actMove,
                reason: `budget-deferred: ${budgetDeferReason}`,
                gate: { decision: "block" as const, decidedBy: "budget" },
              })
            : await planAndAct(
            actMove,
            { envelopeStatus: pulse.envelopeStatus, maxCostUsd: AUTOPILOT_DISPATCH_MAX_COST_USD, idempotencyKey: effectKey },
            {
              runGate: (action) => runPolicyGateStack(action),
              classify: classifyEscalation,
              enqueue: enqueueDispatch,
              ask: async (input) => {
                const r = await askFounder(input);
                return { askId: r.askId };
              },
              // Honest counterfactual + history-grounded forecast on any ask.
              simulate: (m) => {
                const sim = renderSimulation(
                  simulateMove(m, {
                    maxCostUsd: AUTOPILOT_DISPATCH_MAX_COST_USD,
                    envelopeStatus: pulse.envelopeStatus,
                  }),
                );
                return forecastLine ? `${sim}\n${forecastLine}` : sim;
              },
              // Risk-calibrated autonomy: a high-risk action (novel / customer-
              // facing / irreversible / expensive) escalates even in a trusted
              // domain. Deterministic + cheap; runs before the pre-mortem.
              assessRisk: async (m) => {
                const { assessRisk, shouldEscalateForRisk } = await import("../autopilot/riskautonomy");
                const { bindingFor } = await import("../autopilot/act");
                const b = bindingFor(m.kind);
                const a = assessRisk({
                  reversible: b.reversible, // T0.2: the real reversibility, not a customer-facing proxy
                  customerFacing: b.isCustomerFacing,
                  predictedCostUsd: AUTOPILOT_DISPATCH_MAX_COST_USD,
                  noveltyN: traceForecast?.n ?? 0,
                });
                // T2.4: make calibration LOAD-BEARING — a poorly-calibrated brain
                // (over-confident / unproven) escalates a medium-tier action too.
                // Tighten-only; full confidence preserves the high-only behavior.
                let loopConfidence = 1;
                try {
                  const { getCalibrationPairs } = await import("../autopilot/experienceLog");
                  const { calibrationReport, loopConfidenceFrom } = await import("../autopilot/forecast");
                  // Deeper calibration: judge THIS domain's calibration (recency-
                  // weighted), not a global blend — a reckless domain can't hide.
                  loopConfidence = loopConfidenceFrom(calibrationReport(await getCalibrationPairs({ domain: b.domain })));
                } catch { /* calibration unavailable → full confidence (no extra tightening) */ }
                // Frontier #8 — fold in council disagreement by MIN: a divided
                // panel can only LOWER confidence (⇒ escalate more), never raise
                // it. Unanimous / no panel ⇒ councilConf 1 ⇒ no change.
                loopConfidence = Math.min(loopConfidence, councilConf);
                const tier = shouldEscalateForRisk(true, a, loopConfidence) && a.tier !== "high" ? "high" : a.tier;
                return { tier, reasons: a.reasons };
              },
              // Adversarial pre-mortem: a high-stakes move that would auto-run
              // gets one skeptical look first. Only active when a model is
              // available; self-gates on high-stakes inside runPremortem.
              premortem: callModel
                ? async (m) => {
                    const { runPremortem } = await import("../autopilot/safety");
                    return runPremortem(m, { callModel: callModel! }, forecastLine ?? undefined);
                  }
                : undefined,
            },
          );
          actOutcomeStatus = outcome.status;
          if (outcome.status === "acted") {
            dispatchesQueued += 1;
            // Drain the county from the growth queue only when the move actually
            // acted (not when suppressed at OBSERVE / by budget) — so a seeded
            // county is never silently consumed without a guide being produced.
            if (selectedGrowthTarget) {
              const { markTargetDispatched } = await import("../autopilot/growthTargets");
              await markTargetDispatched(selectedGrowthTarget.id, null);
            }
          }
          if (outcome.status === "escalated") asksFiredToFounder += 1;
          logger.info("[continuousLoop] tick: brain act", {
            move: actMove.kind,
            outcome: outcome.status,
          });

          // Frontier #10 — observe loop oscillation: if the brain's focus has
          // been churning domain tick-to-tick, surface it (a running-but-
          // thrashing loop, the dual of loopStall's not-running). Read-only +
          // best-effort; the damping multiplier is available to callers that
          // want hysteresis (a deeper follow-up than this observation).
          try {
            const { detectOscillation } = await import("../autopilot/loopStability");
            const { getRecentStory } = await import("../autopilot/experienceLog");
            const recentDomains = (await getRecentStory(8)).map((e) => e.domain);
            const osc = detectOscillation([actMove.domain, ...recentDomains]);
            if (osc.oscillating) {
              logger.warn(`[continuousLoop] loop oscillating — domain churn ${osc.score.toFixed(2)} across ${osc.distinct} foci`);
            }
          } catch { /* oscillation observation is best-effort */ }

          // Open an Experience Log row so real signals can accrete (dispatch
          // result keyed by dispatchId, founder verdict keyed by askId). This
          // is the learning loop's memory; it never fabricates — fields stay
          // null until a genuine signal lands.
          if (outcome.status !== "error") {
            try {
              const { recordExperience } = await import("../autopilot/experienceLog");
              const { buildReasoningTrace } = await import("../autopilot/reasoning");
              // Frontier #2 — shadow regret (decision-time, model-predicted). The
              // road not taken, glass-box only: this is computed from predicted
              // EVs and is NEVER recorded as an outcome / fed to learning.
              let shadowRegret: { bestAlternativeKind: string | null; regret: number; isEstimate: true } | null = null;
              try {
                if (Object.keys(moveEvByKind).length > 0) {
                  const { prospectiveRegret } = await import("../autopilot/shadowRegret");
                  const valuations = effectiveMoves.map((m) => ({ kind: m.kind, value: moveEvByKind[m.kind] ?? 0 }));
                  const chosenVal = { kind: actMove.kind, value: moveEvByKind[actMove.kind] ?? 0 };
                  const sr = prospectiveRegret(chosenVal, valuations);
                  shadowRegret = { bestAlternativeKind: sr.bestAlternativeKind, regret: sr.regret, isEstimate: true };
                }
              } catch { /* shadow regret is a glass-box adornment — best-effort */ }
              // Frontier #7 — multi-step lookahead: the sequence of distinct
              // high-EV moves the brain intends next. Glass-box only; each step
              // still runs one-at-a-time through the gate stack. Best-effort.
              let plannedSequence: string[] | null = null;
              try {
                if (Object.keys(moveEvByKind).length > 0) {
                  const { buildPlan } = await import("../autopilot/planner");
                  const plan = buildPlan(Object.entries(moveEvByKind).map(([moveKind, ev]) => ({ moveKind, ev })));
                  if (plan.steps.length >= 2) plannedSequence = plan.steps.map((s) => s.moveKind);
                }
              } catch { /* planner is advisory — best-effort */ }
              const trace = buildReasoningTrace({
                consideredMoves: effectiveMoves.map((m) => ({ kind: m.kind, priority: m.priority, rationale: m.rationale })),
                chosen: { kind: actMove.kind, domain: actMove.domain, playId: selectedPlayId },
                shadowRegret,
                plannedSequence,
                senses: {
                  mrr: senses.mrr,
                  trials: senses.trials,
                  supportBacklog: senses.supportBacklog,
                  envelopeStatus: senses.envelopeStatus,
                  dispatchBacklog: senses.dispatchBacklog,
                  openIncidents: senses.openIncidents,
                  complianceOpenCount: senses.complianceOpenCount,
                },
                forecast: traceForecast,
                gate: outcome.gate,
                outcome: outcome.status,
                memory: memoryNote,
              });
              // Horizon A2 — shadow mode. When the AUTONOMY gate (and only it)
              // held this move back — an OBSERVE block (suppressed) or a DRAFT
              // escalation (a human must approve) — the row records the call
              // the autopilot WOULD have made. Mark it {shadow, shadowedCapability}
              // and bind it to the real-world situation via a "shadow:"-namespaced
              // targetRef (the growth target when one exists, else the move's own
              // deterministic effect key). Pure metadata on a row that was already
              // being written; a shadow row is structurally incapable of acting
              // (Sovereign Principle 10 — no agent may unilaterally expand its own
              // authority). Best-effort: marking failure records the row unmarked.
              let traceToRecord: unknown = trace;
              let shadowTargetRef: string | null = null;
              try {
                const { markShadowExperience } = await import("../autopilot/shadowAgreement");
                const marked = markShadowExperience({
                  outcome: outcome.status,
                  gateDecidedBy: outcome.gate?.decidedBy ?? null,
                  moveKind: actMove.kind,
                  reasoningTrace: trace as unknown as Record<string, unknown>,
                  situationKey: selectedGrowthTarget
                    ? `growth_target:${selectedGrowthTarget.id}`
                    : effectKey,
                });
                traceToRecord = marked.reasoningTrace;
                shadowTargetRef = marked.targetRef;
              } catch { /* shadow marking is best-effort metadata */ }
              await recordExperience({
                moveKind: actMove.kind,
                domain: actMove.domain,
                playId: selectedPlayId,
                outcome: outcome.status,
                dispatchId: outcome.status === "acted" ? outcome.dispatchId : null,
                askId: outcome.status === "escalated" ? outcome.askId : null,
                predictedSuccess,
                reasoningTrace: traceToRecord,
                targetRef: shadowTargetRef,
              });
            } catch (recErr) {
              logger.warn(
                "[continuousLoop] tick: experience record failed",
                recErr instanceof Error ? recErr : undefined,
              );
            }
          }

          // Policy induction: spot durable patterns (a play we keep declining /
          // keep approving) and proactively propose codifying them. Fires at
          // most one calm ask per (kind, play), ever. Best-effort.
          try {
            const { runPolicyInduction } = await import("../autopilot/policyInducer");
            for (const d of ["growth", "support"]) {
              asksFiredToFounder += await runPolicyInduction(d, {
                ask: async (input) => {
                  const r = await askFounder(input);
                  return { askId: r.askId };
                },
              });
            }
          } catch (indErr) {
            logger.warn(
              "[continuousLoop] tick: policy induction failed",
              indErr instanceof Error ? indErr : undefined,
            );
          }

          // Budget ramp: when owned-channel acquisition is proven (real
          // attributed signups at a healthy, conservative CAC), propose — once,
          // with a cooldown — lifting the monthly growth cap by a bounded step.
          // The zero-capital compounding wire: the company earns its budget.
          // Founder-gated; the approval applies the new cap. Best-effort.
          try {
            const { maybeProposeBudgetRamp } = await import("../autopilot/budgetRamp");
            asksFiredToFounder += await maybeProposeBudgetRamp({
              ask: async (input) => {
                const r = await askFounder(input);
                return { askId: r.askId };
              },
            });
          } catch (rampErr) {
            logger.warn(
              "[continuousLoop] tick: budget ramp proposal failed",
              rampErr instanceof Error ? rampErr : undefined,
            );
          }

          // Funnel-health SLO: separate "work done" from "demand captured" and
          // raise ONE deduped alert on a genuine acquisition stall (publishing
          // into a void / earning attention but converting nobody). The honesty
          // guard so a green dashboard can't hide a months-long zero-user stall.
          try {
            const { checkFunnelHealth } = await import("../autopilot/funnelHealth");
            await checkFunnelHealth();
          } catch (fhErr) {
            logger.warn(
              "[continuousLoop] tick: funnel-health check failed",
              fhErr instanceof Error ? fhErr : undefined,
            );
          }
        }
      }
    }
  } catch (err) {
    errors += 1;
    logger.warn(
      "[continuousLoop] tick: brain plan failed",
      err instanceof Error ? err : undefined,
    );
  }

  // T1.3 (#10): persist a snapshot of the causal world-model's edge confidences
  // so the self-sharpening trajectory is observable (charted), not discarded.
  // Best-effort — pure observability, never disturbs the loop.
  try {
    const { persistWorldModelSnapshot } = await import("../autopilot/worldModelSnapshot");
    await persistWorldModelSnapshot();
  } catch { /* observability only */ }

  // Constitutional-drift sentinel: scan recent actions for invariant violations
  // (e.g. a customer-facing action that auto-ran instead of going through
  // witnessed-send). A critical finding pages the founder — the autopilot
  // drifting from its constitution is exactly what must never be silent.
  try {
    const { getRecentStory } = await import("../autopilot/experienceLog");
    const { detectDrift } = await import("../autopilot/safety");
    const recent = await getRecentStory(100);
    const drift = detectDrift(recent.map((r) => ({ moveKind: r.moveKind, outcome: r.outcome })));
    const critical = drift.filter((d) => d.severity === "critical");
    if (critical.length > 0) {
      logger.error(`[continuousLoop] CONSTITUTIONAL DRIFT: ${critical.map((d) => d.message).join(" ")}`);
      // T0.3: CONTAIN before paging — a constitutional-invariant breach is not an
      // alarm to sleep on; trip the atomic panic stop (all switches off + every
      // domain quarantined to OBSERVE), then page. The founder re-enables
      // deliberately once they've reviewed. (panicStop pages too; the explicit
      // page below stays as defense-in-depth.)
      try {
        const { panicStop } = await import("../autopilot/panicStop");
        await panicStop({ reason: `constitutional drift: ${critical.map((d) => d.code).join(", ")}`, by: "auto:drift_sentinel" });
      } catch (containErr) {
        logger.error("[continuousLoop] drift containment failed", containErr instanceof Error ? containErr : undefined);
      }
      try {
        const { sendSolenePage } = await import("./pagerService");
        await sendSolenePage({
          severity: "critical",
          subject: "Autopilot constitutional drift — CONTAINED (panic stop tripped)",
          body: critical.map((d) => d.message).join("\n"),
        });
      } catch {
        /* paging best-effort */
      }
    }
  } catch (driftErr) {
    logger.warn(
      "[continuousLoop] tick: drift sentinel failed",
      driftErr instanceof Error ? driftErr : undefined,
    );
  }

  return {
    ranAt,
    durationMs: Date.now() - start,
    morningPulseRefreshed,
    signalsScanned,
    dispatchesQueued,
    asksFiredToFounder,
    errors,
    actOutcomeStatus,
    plannedTopMove,
  };
}

// ============================================================================
// Internal — safe loaders. Each isolates its own failure path so the
// morning pulse remains best-effort.
// ============================================================================

async function safeLoadCapital(): Promise<{
  weeklySpendUsd: number;
  envelopeStatus: "green" | "amber" | "red";
}> {
  try {
    const { getSpendSummary, getMonthlyEnvelopeStatus } = await import(
      "./capitalTracker"
    );
    const [weekly, envelope] = await Promise.all([
      getSpendSummary(7 * 24).catch(() => ({
        totalUsd: 0,
        byType: {},
        eventCount: 0,
      })),
      getMonthlyEnvelopeStatus().catch(() => ({
        envelopeUsd: 0,
        monthToDateUsd: 0,
        percentUsed: 0,
        daysIntoMonth: 1,
        projectedMonthlyUsd: 0,
        status: "green" as const,
      })),
    ]);
    return {
      weeklySpendUsd: Number(weekly.totalUsd ?? 0),
      envelopeStatus: envelope.status,
    };
  } catch (err) {
    logger.warn(
      "[continuousLoop] safeLoadCapital failed",
      err instanceof Error ? err : undefined,
    );
    return { weeklySpendUsd: 0, envelopeStatus: "green" };
  }
}

async function safeLoadFounderCollab(): Promise<{
  openCount: number;
  urgentCount: number;
}> {
  try {
    const { listOpenAsks } = await import("./founderCollab");
    const asks = await listOpenAsks();
    const urgentCount = asks.filter((a) => a.urgency === "urgent").length;
    return { openCount: asks.length, urgentCount };
  } catch (err) {
    logger.warn(
      "[continuousLoop] safeLoadFounderCollab failed",
      err instanceof Error ? err : undefined,
    );
    return { openCount: 0, urgentCount: 0 };
  }
}

async function safeLoadDispatchActivity(): Promise<{
  completedLast24h: number;
  flaggedLast24h: number;
}> {
  try {
    const { listDispatches } = await import("./dispatchQueue");
    const recent = await listDispatches({ limit: 200 });
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let completed = 0;
    let flagged = 0;
    for (const r of recent) {
      const completedAt = r.queue.completedAt ?? null;
      if (completedAt && completedAt.getTime() >= cutoff) {
        if (r.queue.status === "completed") completed += 1;
        if (r.queue.status === "failed" || r.queue.status === "timed_out") {
          flagged += 1;
        }
      }
    }
    return { completedLast24h: completed, flaggedLast24h: flagged };
  } catch (err) {
    logger.warn(
      "[continuousLoop] safeLoadDispatchActivity failed",
      err instanceof Error ? err : undefined,
    );
    return { completedLast24h: 0, flaggedLast24h: 0 };
  }
}

/**
 * Real month-recurring revenue (USD), summed from ACTIVE-subscription orgs the
 * same way the executive dashboard does (routes.ts) — tier price from the
 * canonical shared/billing/tier-pricing, yearly normalized to per-month. This
 * is the headline vital sign on the founder home + the brain's `senses.mrr`; it
 * was hardcoded to 0 (re-audit it.3 "actively broken"), so every metric that
 * read it showed $0 regardless of real revenue. Self-contained + best-effort.
 */
async function computeRealMrrUsd(): Promise<number> {
  const { organizations } = await import("@shared/schema");
  const { monthlyRevenueCentsFor } = await import("@shared/billing/tier-pricing");
  const { eq } = await import("drizzle-orm");
  const activeOrgs = await db
    .select({
      tier: organizations.subscriptionTier,
      interval: organizations.billingInterval,
    })
    .from(organizations)
    .where(eq(organizations.subscriptionStatus, "active"))
    .limit(10000);
  const cents = activeOrgs.reduce((total, org) => {
    const interval = org.interval === "yearly" ? "yearly" : "monthly";
    return total + monthlyRevenueCentsFor(org.tier, interval);
  }, 0);
  return Math.round(cents) / 100;
}

async function safeLoadOnboardingFunnel(): Promise<{
  trials: number;
  mrr: number;
}> {
  try {
    const { getFunnelSummary } = await import(
      "../onboarding/firstValueInstrumentation"
    );
    const summary = await getFunnelSummary(7);
    // Trials = signups in window that haven't reached first-value yet.
    const trials = Math.max(
      0,
      summary.totalSignups - summary.totalFirstValue,
    );
    // MRR is computed independently of the funnel so a funnel error can't zero
    // it (and vice versa) — best-effort, defaults to 0 only on its own failure.
    let mrr = DEFAULT_MRR;
    try {
      mrr = await computeRealMrrUsd();
    } catch (mrrErr) {
      logger.warn(
        "[continuousLoop] real MRR compute failed; using 0",
        mrrErr instanceof Error ? mrrErr : undefined,
      );
    }
    return { trials, mrr };
  } catch (err) {
    logger.warn(
      "[continuousLoop] safeLoadOnboardingFunnel failed",
      err instanceof Error ? err : undefined,
    );
    // Even if the funnel read fails, still try for a real MRR number.
    let mrr = 0;
    try {
      mrr = await computeRealMrrUsd();
    } catch {
      /* leave 0 */
    }
    return { trials: 0, mrr };
  }
}

async function safeLoadComplianceFindings(): Promise<{ openCount: number }> {
  try {
    // Open compliance items = Beatrice unreviewed regulatory events. The
    // table is small + indexed; counting is cheap.
    const { beatriceRegEvents } = await import(
      "@shared/schema/beatrice-regwatch"
    );
    const { eq, sql } = await import("drizzle-orm");
    const [row] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(beatriceRegEvents)
      .where(eq(beatriceRegEvents.beatriceReviewed, false));
    return { openCount: Number(row?.n ?? 0) };
  } catch (err) {
    logger.warn(
      "[continuousLoop] safeLoadComplianceFindings failed",
      err instanceof Error ? err : undefined,
    );
    return { openCount: 0 };
  }
}

async function safeLoadAgentActivity(): Promise<AgentActivitySummary[]> {
  try {
    const { soleneAgentIdentityDecisions } = await import(
      "@shared/schema/solene-agent-identity"
    );
    const { gte, sql } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        agentRole: soleneAgentIdentityDecisions.agentRole,
        decisionsRecorded: sql<number>`COUNT(*)::int`,
        lastActivityAt: sql<Date>`MAX(${soleneAgentIdentityDecisions.decidedAt})`,
      })
      .from(soleneAgentIdentityDecisions)
      .where(gte(soleneAgentIdentityDecisions.decidedAt, cutoff))
      .groupBy(soleneAgentIdentityDecisions.agentRole);

    return rows.map((r) => ({
      agentRole: String(r.agentRole),
      dispatchesCompleted: 0,
      decisionsRecorded: Number(r.decisionsRecorded ?? 0),
      lastActivityAt:
        r.lastActivityAt instanceof Date
          ? r.lastActivityAt
          : r.lastActivityAt
            ? new Date(r.lastActivityAt as unknown as string)
            : null,
    }));
  } catch (err) {
    logger.warn(
      "[continuousLoop] safeLoadAgentActivity failed",
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

async function safeLoadProdVersion(): Promise<string> {
  try {
    const sha = process.env.RELEASE_VERSION || process.env.FLY_RELEASE_VERSION;
    if (sha && typeof sha === "string") return sha.slice(0, 16);
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ============================================================================
// Internal — render helpers
// ============================================================================

function renderDayLabel(d: Date): string {
  // "Wed 2026-06-04"
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = dayNames[d.getUTCDay()];
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${yyyy}-${mm}-${dd}`;
}
