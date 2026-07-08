/**
 * SOLENE CHAT — live-state block (Launch-Week WS3, "The Brain").
 *
 * Exposes to the founder chat the SAME live numbers the founder cockpit
 * uses: the morning pulse (continuousLoop), the monthly spend envelope
 * (capitalTracker), the per-domain Trust Ledger (domainAutonomy), open
 * founder asks (founderCollab), and runway from the real reserve/floor/burn
 * ledger — the identical sources composeFounderBrief reads.
 *
 * HONEST NULLS ARE THE CONTRACT. Every source is gathered best-effort; a
 * source that fails or has no data yet is carried as null and RENDERED as
 * an explicit "unknown (no data yet)" line — never a guessed number, never
 * a flattering default. The renderer is pure and exported for tests.
 */

import { logger } from "../../../utils/logger";

// ============================================================================
// Types
// ============================================================================

export interface LiveStatePulse {
  generatedAt: string; // ISO
  mrr: number;
  trials: number;
  weeklySpendUsd: number;
  envelopeStatus: "green" | "amber" | "red";
  uptimePct: number | null;
  dispatchesCompletedLast24h: number;
  dispatchesFlaggedLast24h: number;
  decisionsWaitingCount: number;
  prodVersion: string | null;
}

export interface LiveStateEnvelope {
  envelopeUsd: number;
  monthToDateUsd: number;
  percentUsed: number;
  projectedMonthlyUsd: number;
  status: string;
}

export interface LiveStateTrustDomain {
  domain: string;
  level: string;
  cleanCycleCount: number;
  threshold: number;
}

export interface LiveStateOpenAsk {
  askId: number;
  summary: string;
  urgency: string;
}

export interface FounderLiveState {
  /** ISO timestamp of assembly — the "as of" for the whole block. */
  asOf: string;
  /** Latest persisted morning pulse; null = no pulse recorded yet. */
  pulse: LiveStatePulse | null;
  /** Monthly AI/tool spend envelope; null = ledger unreadable. */
  envelope: LiveStateEnvelope | null;
  /** Per-domain trust ledger; null = unreadable (empty array = honestly no domains). */
  trustLedger: LiveStateTrustDomain[] | null;
  /** Open founder asks; null = unreadable (empty array = honestly none). */
  openAsks: LiveStateOpenAsk[] | null;
  /** Weeks of runway at current burn; null = not burning or unknown, never invented. */
  runwayWeeks: number | null;
}

// ============================================================================
// gatherLiveState — best-effort, per-source degradation
// ============================================================================

export async function gatherLiveState(): Promise<FounderLiveState> {
  const asOf = new Date().toISOString();

  // Morning pulse — the canonical senses (read-only; we never compose here,
  // a chat turn must not trigger the loop's write path).
  let pulse: FounderLiveState["pulse"] = null;
  try {
    const { getLatestMorningPulse } = await import("../continuousLoop");
    const p = await getLatestMorningPulse();
    if (p) {
      pulse = {
        generatedAt: new Date(p.generatedAt).toISOString(),
        mrr: p.mrr,
        trials: p.trials,
        weeklySpendUsd: p.weeklySpendUsd,
        envelopeStatus: p.envelopeStatus,
        uptimePct: p.uptimePct,
        dispatchesCompletedLast24h: p.dispatchesCompletedLast24h,
        dispatchesFlaggedLast24h: p.dispatchesFlaggedLast24h,
        decisionsWaitingCount: p.decisionsWaitingCount,
        prodVersion: p.prodVersion && p.prodVersion !== "unknown" ? p.prodVersion : null,
      };
    }
  } catch (err) {
    logger.warn("[soleneChat] liveState.pulse_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Monthly envelope — capital tracker.
  let envelope: FounderLiveState["envelope"] = null;
  try {
    const { getMonthlyEnvelopeStatus } = await import("../capitalTracker");
    const e = await getMonthlyEnvelopeStatus();
    envelope = {
      envelopeUsd: e.envelopeUsd,
      monthToDateUsd: e.monthToDateUsd,
      percentUsed: e.percentUsed,
      projectedMonthlyUsd: e.projectedMonthlyUsd,
      status: e.status,
    };
  } catch (err) {
    logger.warn("[soleneChat] liveState.envelope_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Trust ledger.
  let trustLedger: FounderLiveState["trustLedger"] = null;
  try {
    const { getTrustLedger } = await import("../../autopilot/domainAutonomy");
    const rows = await getTrustLedger();
    trustLedger = rows.map((r) => ({
      domain: r.domain,
      level: r.level,
      cleanCycleCount: r.cleanCycleCount,
      threshold: r.threshold,
    }));
  } catch (err) {
    logger.warn("[soleneChat] liveState.trust_ledger_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Open founder asks.
  let openAsks: FounderLiveState["openAsks"] = null;
  try {
    const { listOpenAsks } = await import("../founderCollab");
    const rows = await listOpenAsks();
    openAsks = rows.map((r) => ({
      askId: r.id,
      summary: r.questionSummary,
      urgency: r.urgency ?? "normal",
    }));
  } catch (err) {
    logger.warn("[soleneChat] liveState.open_asks_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Runway — the same reserve/floor/burn ledger composeFounderBrief uses.
  let runwayWeeks: number | null = null;
  try {
    const { computeReserveFloor } = await import("../../reserveFloorChecker");
    const { getSpendSummary } = await import("../capitalTracker");
    const { runwayDays } = await import("../../autopilot/proactiveForecast");
    const rf = await computeReserveFloor();
    const spend = await getSpendSummary(7 * 24);
    const dailyBurnCents = Math.max(0, Math.round((spend.totalUsd * 100) / 7));
    const days = runwayDays(rf.reservesTotalCents, rf.floorCents, dailyBurnCents);
    runwayWeeks = days == null ? null : Math.max(0, Math.round(days / 7));
  } catch (err) {
    logger.warn("[soleneChat] liveState.runway_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return { asOf, pulse, envelope, trustLedger, openAsks, runwayWeeks };
}

// ============================================================================
// renderLiveStateBlock — PURE
// ============================================================================

const UNKNOWN = "unknown (no data yet — say so, do not estimate)";

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Render the live state as a labelled prompt block. Pure + total: absent
 * data becomes an explicit "unknown" line so the model can only ever quote
 * what is genuinely known.
 */
export function renderLiveStateBlock(state: FounderLiveState): string {
  const lines: string[] = [];
  lines.push(`## LIVE STATE [SOURCE: live-state] (as of ${state.asOf})`);
  lines.push(
    "The lines below are the ONLY live operational numbers you may quote. " +
      "A line marked unknown means the system has no data — answer \"no data yet\", never a guess.",
  );

  if (state.pulse) {
    const p = state.pulse;
    lines.push(`- Morning pulse generated at: ${p.generatedAt}`);
    lines.push(`- MRR: ${money(p.mrr)}`);
    lines.push(`- Trials in funnel: ${p.trials}`);
    lines.push(`- Spend last 7 days (pulse): ${money(p.weeklySpendUsd)}`);
    lines.push(`- Spend envelope status (pulse): ${p.envelopeStatus}`);
    lines.push(
      p.uptimePct == null
        ? `- Uptime: ${UNKNOWN}`
        : `- Uptime: ${p.uptimePct}%`,
    );
    lines.push(`- Dispatches completed last 24h: ${p.dispatchesCompletedLast24h}`);
    lines.push(`- Dispatches flagged last 24h: ${p.dispatchesFlaggedLast24h}`);
    lines.push(`- Decisions waiting: ${p.decisionsWaitingCount}`);
    lines.push(
      p.prodVersion == null
        ? `- Deployed version: ${UNKNOWN}`
        : `- Deployed version: ${p.prodVersion}`,
    );
  } else {
    lines.push(`- Morning pulse: ${UNKNOWN}`);
    lines.push(`- MRR: ${UNKNOWN}`);
    lines.push(`- Spend last 7 days: ${UNKNOWN}`);
    lines.push(`- Dispatches / flags last 24h: ${UNKNOWN}`);
  }

  if (state.envelope) {
    const e = state.envelope;
    lines.push(
      `- Monthly AI envelope: ${money(e.monthToDateUsd)} of ${money(e.envelopeUsd)} used ` +
        `(${Math.round(e.percentUsed)}%, status ${e.status}; projected ${money(e.projectedMonthlyUsd)} for the month)`,
    );
  } else {
    lines.push(`- Monthly AI envelope: ${UNKNOWN}`);
  }

  if (state.runwayWeeks != null) {
    lines.push(`- Runway at current burn: ~${state.runwayWeeks} weeks`);
  } else {
    lines.push(
      `- Runway: no figure — either not currently burning (revenue covers spend) or the ledger is unreadable; say which is unknown rather than inventing a number`,
    );
  }

  if (state.trustLedger == null) {
    lines.push(`- Trust ledger: ${UNKNOWN}`);
  } else if (state.trustLedger.length === 0) {
    lines.push(`- Trust ledger: no domains recorded yet`);
  } else {
    lines.push(
      `- Trust ledger: ` +
        state.trustLedger
          .map((d) => `${d.domain}=${d.level} (${d.cleanCycleCount}/${d.threshold} clean cycles)`)
          .join(", "),
    );
  }

  if (state.openAsks == null) {
    lines.push(`- Open founder asks: ${UNKNOWN}`);
  } else if (state.openAsks.length === 0) {
    lines.push(`- Open founder asks: none`);
  } else {
    lines.push(`- Open founder asks (${state.openAsks.length}):`);
    for (const a of state.openAsks.slice(0, 10)) {
      lines.push(`  - [#${a.askId}, ${a.urgency}] ${a.summary}`);
    }
  }

  return lines.join("\n");
}
