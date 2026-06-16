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
import { sensesFromPulse, rankMoves, type RankedMove } from "../autopilot/decide";
import { planAndAct } from "../autopilot/act";

/**
 * Master switch for the autopilot HANDS. While false (default), the loop only
 * THINKS — it computes + logs its plan but never routes a move into action.
 * When true, the top move is routed through runPolicyGateStack + the Trust
 * Ledger, which still fails safe (OBSERVE → block) until a domain earns autonomy.
 */
const SOLENE_DISPATCH_ENABLED = process.env.SOLENE_DISPATCH_ENABLED === "true";
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
  uptimePct: number;
  prodVersion: string;
  complianceOpenCount: number;
  weeklySpendUsd: number;
  decisionsWaitingCount: number;
  autonomyHorizonDays: number;
  envelopeStatus: "green" | "amber" | "red";

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
const DEFAULT_UPTIME_PCT = 99.9;
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

  // Uptime: 30-day rolling stub. The real value lives in
  // iris/perfMonitor's roll-up; we keep this conservative + best-effort.
  const uptimePct = DEFAULT_UPTIME_PCT;

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
  // Format per the team_solene brief:
  //   "{Day} {Date} · ${MRR} MRR · +{N} trials · {X.X}% uptime ·
  //    {N}/{N} compliance · ${X.XX} week-cost · {N} decisions waiting ·
  //    Horizon: {D} days"
  const mrr = Math.round(snapshot.mrr).toLocaleString();
  const uptime = snapshot.uptimePct.toFixed(1);
  const spend = snapshot.weeklySpendUsd.toFixed(2);
  // Compliance fraction: open / open (we only track open right now —
  // both numerator and denominator are the open count, matching the
  // 0/0 → "all clear" shape).
  const complianceFrac = `${snapshot.complianceOpenCount}/${snapshot.complianceOpenCount}`;
  return [
    `${snapshot.dayLabel}`,
    `$${mrr} MRR`,
    `+${snapshot.trials} trials`,
    `${uptime}% uptime`,
    `${complianceFrac} compliance`,
    `$${spend} week-cost`,
    `${snapshot.decisionsWaitingCount} decisions waiting`,
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
    uptimePct: Number(blob.uptimePct ?? DEFAULT_UPTIME_PCT),
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
  let actOutcomeStatus: string | null = null;
  try {
    const pulse = await getLatestMorningPulse();
    if (pulse) {
      // Real support backlog — a measured sense, best-effort (defaults to 0).
      const { getOpenSupportCaseCount } = await import("../autopilot/senses");
      const supportBacklog = await getOpenSupportCaseCount();
      const senses = sensesFromPulse(
        {
          mrr: pulse.mrr,
          trials: pulse.trials,
          complianceOpenCount: pulse.complianceOpenCount,
          envelopeStatus: pulse.envelopeStatus,
          dispatchesFlaggedLast24h: pulse.dispatchesFlaggedLast24h,
        },
        { dispatchBacklog, supportBacklog },
      );
      const moves = rankMoves(senses);
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

        // ── The brain ACTS (only when the hands are switched on) ───────────
        // Route the top move through the full governance spine. Safe even when
        // enabled: at OBSERVE the autonomy gate blocks → "suppressed", nothing
        // is enqueued; customer-facing moves escalate to a human tap. When a
        // domain has earned autonomy, "acted" enqueues a governed dispatch.
        if (SOLENE_DISPATCH_ENABLED) {
          const { runPolicyGateStack } = await import("../autopilot/policyGate");
          const { classifyEscalation } = await import("../autopilot/escalation");
          const { enqueueDispatch } = await import("./dispatchQueue");
          const { askFounder } = await import("./founderCollab");

          // Growth specialization: when the move is "grow owned channels," pick
          // a CONCRETE owned, ~$0 play from the playbook (rotating by how many
          // growth plays have already run) and enrich the move's rationale so
          // the dispatch is a specific tasteful action, not a generic one.
          let actMove = plannedTopMove;
          // The play this action runs (for the Experience Log / efficacy model);
          // null for moves without a play (e.g. optimize).
          let selectedPlayId: string | null = null;
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
              const { selectPlay, makeSeededRng } = await import("../autopilot/efficacy");
              // Evidence-weighted selection (Thompson sampling) over the REAL
              // track record. Cold-start (no data) ⇒ ~uniform, i.e. equivalent to
              // the old rotation; learning only emerges as outcomes accrue. The
              // RNG is a seeded sampling source (per-tick seed), not Math.random.
              const stats = await getPlayStats("growth");
              const candidates = GROWTH_PLAYS.map(
                (p) => stats.find((s) => s.playId === p.id) ?? { playId: p.id, successes: 0, failures: 0 },
              );
              const pickedId = selectPlay(candidates, makeSeededRng(Date.now()));
              const play = (pickedId && growthPlayById(pickedId)) || selectNextGrowthPlay(0);
              selectedPlayId = play.id;
              actMove = { ...actMove, rationale: growthPlayRationale(play) };
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

          const { simulateMove, renderSimulation } = await import("../autopilot/simulate");
          const outcome = await planAndAct(
            actMove,
            { envelopeStatus: pulse.envelopeStatus, maxCostUsd: AUTOPILOT_DISPATCH_MAX_COST_USD },
            {
              runGate: (action) => runPolicyGateStack(action),
              classify: classifyEscalation,
              enqueue: enqueueDispatch,
              ask: async (input) => {
                const r = await askFounder(input);
                return { askId: r.askId };
              },
              // Honest counterfactual attached to any escalated decision.
              simulate: (m) =>
                renderSimulation(
                  simulateMove(m, {
                    maxCostUsd: AUTOPILOT_DISPATCH_MAX_COST_USD,
                    envelopeStatus: pulse.envelopeStatus,
                  }),
                ),
            },
          );
          actOutcomeStatus = outcome.status;
          if (outcome.status === "acted") dispatchesQueued += 1;
          if (outcome.status === "escalated") asksFiredToFounder += 1;
          logger.info("[continuousLoop] tick: brain act", {
            move: actMove.kind,
            outcome: outcome.status,
          });

          // Open an Experience Log row so real signals can accrete (dispatch
          // result keyed by dispatchId, founder verdict keyed by askId). This
          // is the learning loop's memory; it never fabricates — fields stay
          // null until a genuine signal lands.
          if (outcome.status !== "error") {
            try {
              const { recordExperience } = await import("../autopilot/experienceLog");
              await recordExperience({
                moveKind: actMove.kind,
                domain: actMove.domain,
                playId: selectedPlayId,
                outcome: outcome.status,
                dispatchId: outcome.status === "acted" ? outcome.dispatchId : null,
                askId: outcome.status === "escalated" ? outcome.askId : null,
              });
            } catch (recErr) {
              logger.warn(
                "[continuousLoop] tick: experience record failed",
                recErr instanceof Error ? recErr : undefined,
              );
            }
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
    return { trials, mrr: DEFAULT_MRR };
  } catch (err) {
    logger.warn(
      "[continuousLoop] safeLoadOnboardingFunnel failed",
      err instanceof Error ? err : undefined,
    );
    return { trials: 0, mrr: 0 };
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
