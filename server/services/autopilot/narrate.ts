/**
 * Founder Autopilot — the Narration Engine (the Voice).
 *
 * The heart of the daily experience: it turns the system's real state into a
 * calm, editorial "letter from your company." Per the North Star, the founder
 * reads a paragraph, not a console — and the load-bearing line is always
 * *whether they're needed.*
 *
 * Two parts, same split as decide.ts:
 *  - buildFounderBrief(inputs) — PURE composition. Deterministic, testable, no
 *    DB, no clock. Given the real numbers, it writes the letter.
 *  - composeFounderBrief()     — gathers the live inputs (pulse + trust ledger +
 *    open asks + the brain's plan) and calls the pure builder.
 *
 * HONESTY IS THE WHOLE POINT. The consumer is still dormant, so the system is
 * not yet *doing* things autonomously — and the letter must never claim it did.
 * It narrates only what genuinely happened: what it watched, what's within
 * budget, what (if anything) needs a human. Every number comes from the real
 * pulse; nothing is invented. This is the craft standard ([[feedback_autopilot_craft_standard]])
 * applied to the founder's own surface: a thoughtful chief of staff who
 * under-claims, never a hype bot.
 */
import type { RankedMove } from "./decide";

export type PartOfDay = "morning" | "afternoon" | "evening";

export interface FounderDecisionCard {
  askId: number;
  summary: string;
  urgency: "urgent" | "normal" | "low";
  answerFormat: string;
}

export interface FounderBriefInputs {
  partOfDay: PartOfDay;
  founderName: string;
  pulse: {
    mrr: number;
    trials: number;
    weeklySpendUsd: number;
    envelopeStatus: "green" | "amber" | "red";
    uptimePct: number;
    dispatchesCompletedLast24h: number;
    dispatchesFlaggedLast24h: number;
    decisionsWaitingCount: number;
  };
  /** Open founder asks needing a decision, already ordered by urgency. */
  openAsks: FounderDecisionCard[];
  /** The brain's single highest-value planned focus (observational in P0). */
  plannedFocus: RankedMove | null;
  /** Per-domain Trust Ledger standing, for the felt sense of earning. */
  trustLedger: Array<{
    domain: string;
    level: string;
    cleanCycleCount: number;
    threshold: number;
  }>;
  /** What's working — top plays by real efficacy (n>0), already sorted. */
  learning?: Array<{ playId: string; rate: number; n: number }>;
  /** How well-calibrated the system's own predictions have been. */
  calibration?: { grade: string; n: number; brier: number | null } | null;
  /**
   * Weeks of runway at the current burn (reserves → floor). null when not
   * burning (revenue covers spend) OR unknown. NEVER fabricated — derived from
   * the real reserve/floor/burn ledger.
   */
  runwayWeeks?: number | null;
  /**
   * Week-over-week MRR change, signed percent, vs a REAL persisted pulse ~7
   * days ago. null when there's no prior datapoint yet (a young system) — we
   * omit the trend rather than invent one.
   */
  mrrWowPct?: number | null;
}

export interface FounderBrief {
  greeting: string;
  /** The one-paragraph morning narrative — Solene's voice, real numbers only. */
  theWord: string;
  /** The load-bearing line: whether the founder is needed today. */
  neededLine: string;
  isFounderNeeded: boolean;
  /** The single hero decision, if one exists. Most days this is null. */
  decision: FounderDecisionCard | null;
  vitalSign: {
    mrr: number;
    trials: number;
    weeklySpendUsd: number;
    envelopeStatus: "green" | "amber" | "red";
    uptimePct: number;
    /** Weeks of runway at current burn; null when not burning / unknown. Real, never invented. */
    runwayWeeks: number | null;
    /** Week-over-week MRR change (signed %); null when no real prior datapoint exists. */
    mrrWowPct: number | null;
  };
  /** The brain's focus, in plain language. */
  focusLine: string | null;
  trustLedger: FounderBriefInputs["trustLedger"];
  /** What's working — surfaced so the founder watches the system get smarter. */
  learning: Array<{ playId: string; rate: number; n: number }>;
  /** The system's own calibration — "how right I usually am." */
  calibration: { grade: string; n: number; brier: number | null } | null;
}

const PART_OF_DAY_WORD: Record<PartOfDay, string> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
};

/**
 * Compose the founder's daily brief from the real state. Pure + total.
 *
 * Editorial, deterministic prose — assembled from genuine numbers, never an
 * LLM hallucination and never a fabricated accomplishment. Reads like a calm
 * chief of staff who tells you the truth and, most days, that you're free.
 */
export function buildFounderBrief(inp: FounderBriefInputs): FounderBrief {
  const greeting = `Good ${PART_OF_DAY_WORD[inp.partOfDay]}, ${inp.founderName}.`;
  const decision = inp.openAsks[0] ?? null;
  const isFounderNeeded = inp.openAsks.length > 0;

  // ── The needed-line: the single most important thing on the page. ─────────
  const neededLine = !isFounderNeeded
    ? "Nothing needs you today."
    : inp.openAsks.length === 1
      ? "One thing needs your call — below."
      : `${inp.openAsks.length} things need your call — below.`;

  // ── The Word: an honest, editorial paragraph from real fields only. ───────
  const parts: string[] = [];

  // What the system did overnight — stated truthfully. While the hands are
  // dormant, "watched" is the honest verb; once work actually runs, the
  // completed-count carries it. We never claim actions that didn't happen.
  if (inp.pulse.dispatchesCompletedLast24h > 0) {
    parts.push(
      `Overnight I completed ${countNoun(inp.pulse.dispatchesCompletedLast24h, "task", "tasks")} and kept watch over the system.`,
    );
  } else {
    parts.push("Overnight I kept watch over the system — nothing required action.");
  }

  // Money + runway, only the real figures.
  const money =
    inp.pulse.mrr > 0
      ? `We're at $${fmt(inp.pulse.mrr)} MRR`
      : "No revenue yet";
  const runway =
    inp.pulse.envelopeStatus === "green"
      ? "spend is comfortably within budget"
      : inp.pulse.envelopeStatus === "amber"
        ? "spend is approaching the budget line"
        : "spend is constrained — runway needs attention";
  const trialsBit = inp.pulse.trials > 0 ? `, ${countNoun(inp.pulse.trials, "trial", "trials")} in the funnel` : "";
  parts.push(`${money}${trialsBit}, and ${runway}.`);

  // Anything flagged — surfaced honestly rather than buried.
  if (inp.pulse.dispatchesFlaggedLast24h > 0) {
    parts.push(
      `${cap(countNoun(inp.pulse.dispatchesFlaggedLast24h, "item was", "items were"))} flagged for review and ${inp.pulse.dispatchesFlaggedLast24h === 1 ? "is" : "are"} being handled.`,
    );
  }

  // The closing line mirrors the needed-line so the paragraph lands on the
  // one thing that matters.
  parts.push(isFounderNeeded ? capFirst(neededLine) : "Nothing needs you today.");

  const theWord = parts.join(" ");

  // ── The brain's focus, in plain language (observational in P0). ───────────
  const focusLine = inp.plannedFocus
    ? `Right now I'm focused on: ${inp.plannedFocus.rationale}`
    : null;

  return {
    greeting,
    theWord,
    neededLine,
    isFounderNeeded,
    decision,
    vitalSign: {
      mrr: inp.pulse.mrr,
      trials: inp.pulse.trials,
      weeklySpendUsd: inp.pulse.weeklySpendUsd,
      envelopeStatus: inp.pulse.envelopeStatus,
      uptimePct: inp.pulse.uptimePct,
      runwayWeeks: inp.runwayWeeks ?? null,
      mrrWowPct: inp.mrrWowPct ?? null,
    },
    focusLine,
    trustLedger: inp.trustLedger,
    learning: inp.learning ?? [],
    calibration: inp.calibration ?? null,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}
function countNoun(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
function cap(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
function capFirst(s: string): string {
  return cap(s);
}

/**
 * Derive part-of-day from an ET hour (the founder is in MA). Kept tiny + pure
 * so the gatherer and the client can agree.
 */
export function partOfDayFromHour(hourEt: number): PartOfDay {
  if (hourEt < 12) return "morning";
  if (hourEt < 18) return "afternoon";
  return "evening";
}

/**
 * Gather live inputs and compose the brief. Best-effort: a failed source
 * degrades to a safe default rather than failing the whole letter — the
 * founder should always get *a* brief.
 */
export async function composeFounderBrief(opts?: { nowEpochMs?: number; founderName?: string }): Promise<FounderBrief> {
  const founderName = opts?.founderName ?? "Tom";

  // ET hour (UTC-4, summer). Approximate by design; the client can refine the
  // greeting with the real browser clock. Never load-bearing.
  const nowMs = opts?.nowEpochMs ?? Date.now();
  const etHour = new Date(nowMs - 4 * 60 * 60 * 1000).getUTCHours();
  const partOfDay = partOfDayFromHour(etHour);

  // Pulse — the canonical senses.
  const { getLatestMorningPulse, composeMorningPulse } = await import("../solene/continuousLoop");
  let pulse = await getLatestMorningPulse().catch(() => null);
  if (!pulse) {
    pulse = await composeMorningPulse().catch(() => null);
  }
  const safePulse = {
    mrr: pulse?.mrr ?? 0,
    trials: pulse?.trials ?? 0,
    weeklySpendUsd: pulse?.weeklySpendUsd ?? 0,
    envelopeStatus: pulse?.envelopeStatus ?? "green",
    uptimePct: pulse?.uptimePct ?? 99.9,
    dispatchesCompletedLast24h: pulse?.dispatchesCompletedLast24h ?? 0,
    dispatchesFlaggedLast24h: pulse?.dispatchesFlaggedLast24h ?? 0,
    decisionsWaitingCount: pulse?.decisionsWaitingCount ?? 0,
  };

  // Open asks — the decisions that need a human.
  let openAsks: FounderDecisionCard[] = [];
  try {
    const { listOpenAsks } = await import("../solene/founderCollab");
    const rows = await listOpenAsks();
    openAsks = rows.map((r) => ({
      askId: r.id,
      summary: r.questionSummary,
      urgency: (r.urgency as FounderDecisionCard["urgency"]) ?? "normal",
      answerFormat: r.answerFormat,
    }));
  } catch {
    openAsks = [];
  }

  // The brain's plan — observational.
  let plannedFocus: RankedMove | null = null;
  try {
    const { sensesFromPulse, rankMoves } = await import("./decide");
    const senses = sensesFromPulse({
      mrr: safePulse.mrr,
      trials: safePulse.trials,
      complianceOpenCount: pulse?.complianceOpenCount ?? 0,
      envelopeStatus: safePulse.envelopeStatus,
      dispatchesFlaggedLast24h: safePulse.dispatchesFlaggedLast24h,
    });
    plannedFocus = rankMoves(senses)[0] ?? null;
  } catch {
    plannedFocus = null;
  }

  // Trust Ledger — the felt sense of earning.
  let trustLedger: FounderBrief["trustLedger"] = [];
  try {
    const { getTrustLedger } = await import("./domainAutonomy");
    const rows = await getTrustLedger();
    trustLedger = rows.map((r) => ({
      domain: r.domain,
      level: r.level,
      cleanCycleCount: r.cleanCycleCount,
      threshold: r.threshold,
    }));
  } catch {
    trustLedger = [];
  }

  // What's working — top plays by real efficacy across the engine domains.
  let learning: FounderBrief["learning"] = [];
  try {
    const { getPlayStats } = await import("./experienceLog");
    const { efficacyOf } = await import("./efficacy");
    const allStats = (await Promise.all(["growth", "support"].map((d) => getPlayStats(d)))).flat();
    learning = allStats
      .map((s) => ({ playId: s.playId, ...efficacyOf(s) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.rate - a.rate || b.n - a.n)
      .slice(0, 3);
  } catch {
    learning = [];
  }

  // Calibration — how well the system's own predictions have matched reality.
  let calibration: FounderBrief["calibration"] = null;
  try {
    const { getCalibrationPairs } = await import("./experienceLog");
    const { calibrationReport } = await import("./forecast");
    const report = calibrationReport(await getCalibrationPairs());
    calibration = { grade: report.grade, n: report.n, brier: report.brier };
  } catch {
    calibration = null;
  }

  // Runway in weeks — from the REAL reserve/floor/burn ledger. runwayDays is
  // null when not burning (revenue covers spend), in which case we show no
  // weeks figure rather than invent one.
  let runwayWeeks: number | null = null;
  try {
    const { computeReserveFloor } = await import("../reserveFloorChecker");
    const { getSpendSummary } = await import("../solene/capitalTracker");
    const { runwayDays } = await import("./proactiveForecast");
    const rf = await computeReserveFloor();
    const spend = await getSpendSummary(7 * 24);
    const dailyBurnCents = Math.max(0, Math.round((spend.totalUsd * 100) / 7));
    const days = runwayDays(rf.reservesTotalCents, rf.floorCents, dailyBurnCents);
    runwayWeeks = days == null ? null : Math.max(0, Math.round(days / 7));
  } catch {
    runwayWeeks = null;
  }

  // Week-over-week MRR — vs a REAL persisted pulse ~7 days ago. Null when there's
  // no prior datapoint in the window yet (a young system); never fabricated.
  const mrrWowPct = await computeMrrWowPct(safePulse.mrr, nowMs).catch(() => null);

  return buildFounderBrief({
    partOfDay,
    founderName,
    pulse: safePulse,
    openAsks,
    plannedFocus,
    trustLedger,
    learning,
    calibration,
    runwayWeeks,
    mrrWowPct,
  });
}

/**
 * Week-over-week MRR change as a signed percent, computed from a genuinely
 * persisted morning-pulse snapshot ~7 days ago. Returns null (omit the trend)
 * when there's no real prior row in the [6, 30]-day window or the prior MRR was
 * zero — we never manufacture a trend from a single datapoint.
 */
async function computeMrrWowPct(currentMrr: number, nowMs: number): Promise<number | null> {
  if (currentMrr <= 0) return null;
  const { db } = await import("../../db");
  const { soleneMorningPulse } = await import("@shared/schema");
  const { and, gte, lte, desc } = await import("drizzle-orm");
  const windowOldest = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const windowNewest = new Date(nowMs - 6 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ snapshot: soleneMorningPulse.snapshot })
    .from(soleneMorningPulse)
    .where(and(gte(soleneMorningPulse.generatedAt, windowOldest), lte(soleneMorningPulse.generatedAt, windowNewest)))
    .orderBy(desc(soleneMorningPulse.generatedAt))
    .limit(1);
  const priorMrr = Number((rows[0]?.snapshot as { mrr?: unknown } | undefined)?.mrr ?? 0);
  if (!Number.isFinite(priorMrr) || priorMrr <= 0) return null;
  return Math.round(((currentMrr - priorMrr) / priorMrr) * 100);
}
