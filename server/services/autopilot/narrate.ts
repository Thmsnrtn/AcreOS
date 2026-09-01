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
    /** "unknown" only when the pulse itself couldn't be read — never guessed green. */
    envelopeStatus: "green" | "amber" | "red" | "unknown";
    /** Measured uptime; null until there's enough real heartbeat data to claim one. */
    uptimePct: number | null;
    dispatchesCompletedLast24h: number;
    dispatchesFlaggedLast24h: number;
    decisionsWaitingCount: number;
  };
  /** Open founder asks needing a decision, already ordered by urgency. */
  openAsks: FounderDecisionCard[];
  /**
   * Frozen-send counters (stage-4 turn 5, OD-9 grants-for-all). null = the
   * read failed — the Letter stays silent rather than claiming zeros.
   */
  frozenSends: {
    proposed: number;
    tappedByFounder: number;
    autoWitnessed: number;
    expiredUnseen: number;
    /** Sends frozen RIGHT NOW awaiting the founder's tap — part of the
     * needs-you union (2026-09-01: the Letter said "Nothing needs you" while
     * the Decisions door showed "Waiting on you to send (N)"). */
    pendingNow: number;
  } | null;
  /** The brain's single highest-value planned focus (observational in P0). */
  plannedFocus: RankedMove | null;
  /**
   * Whether the loop can actually ACT (dispatch) and think on schedule
   * (cognition). null = the settings read failed — stay silent rather than
   * claim a mode. Without this the Letter's "Right now I'm focused on…"
   * read as operation even when both switches were off (observe-only),
   * which is exactly the kind of implied capability the honesty rules ban.
   */
  operatingMode: { dispatchEnabled: boolean; cognitionEnabled: boolean } | null;
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
  /**
   * Wedge throughput, last 7 days, platform-wide: outreach pieces sent
   * (campaign delivery events), inbound seller replies, offers created.
   * Real counts (zeros are honest zeros); null only when the tables were
   * unreadable.
   */
  wedge?: { outreachSent7d: number; replies7d: number; offers7d: number } | null;
  /** 5xx rate over the durable 24h telemetry window, as a percent. null when no traffic recorded. */
  errorRatePct?: number | null;
  /** Deployed version (short SHA) from the pulse. null when unknown. */
  prodVersion?: string | null;
  /**
   * Token-economy decision scoring, today (tokenEconomyScorer's daily
   * summary — the L5.27 pulse wire-in, landed with Horizon A4). Real counts
   * of prospective dispatches scored against expected value; null when the
   * summary was unreadable — the sentence is omitted, never invented.
   */
  scoring?: { totalScored: number; averageScore: number; deferredCount: number } | null;
  /**
   * Horizon A5 — the latest weekly connections sweep's PARSED finding count.
   * One sentence in the pulse when findings exist; SILENT when none, when no
   * sweep has run, or when the blob was unreadable/unparseable (the Letter's
   * connections paragraph carries the honest detail — the pulse never
   * interrupts and never pads). null = omit the sentence.
   */
  sweep?: { findingsCount: number } | null;
  /**
   * TRACK RECORD (trust audit, 2026-07-28) — per-domain recorded outcomes,
   * counted from the experience log's REAL votes (founder verdicts where
   * given, otherwise support/eval/mechanical/consequence signals). Only
   * domains with n > 0 are listed; zeros/unreadable → [] → the section
   * renders nothing for that piece. Never dollar-weighted — per-action
   * dollar outcomes aren't recorded, so no weighting is invented.
   */
  trackRecord?: Array<{ domain: string; n: number; good: number; bad: number }> | null;
  /**
   * "What's been working" as plain sentences built from the RAW
   * success/failure counts (the brief's `learning` carries only the
   * posterior rate, which would overstate at small n). Built via
   * learningLine() so small samples say so.
   */
  learningLines?: string[] | null;
  /**
   * CONFESSION ("Since last week — what went wrong") — self-reported misses
   * from REAL sources only: negative outcome-ledger scores recorded in the
   * trailing week, trust-ledger circuit-breaker demotions, and overdue
   * outcome check-ins. `changed` is what changed because of the miss when
   * genuinely known, else null — never invented. Newest first; the builder
   * caps at MAX_MISSES (oldest dropped). Empty → the section is silent.
   */
  misses?: Array<{ atIso: string | null; line: string; changed: string | null }> | null;
  /**
   * MODEL-CHANGE ANNUNCIATOR (trust audit, 2026-07-28) — non-null only when
   * the autopilot's underlying AI model configuration genuinely changed
   * within the last MODEL_CHANGE_NOTICE_WINDOW_DAYS. The sentence is composed
   * server-side (modelChangeAnnunciator.buildModelChangeNotice) in plain
   * roles — never raw model ids — and tells the founder to treat the track
   * record as provisional while the new brain re-proves itself. null =
   * no recent change OR the check was unreadable → render nothing, never a
   * guessed reassurance.
   */
  modelChangeNotice?: string | null;
}

export interface FounderBrief {
  greeting: string;
  /** The one-paragraph morning narrative — Solene's voice, real numbers only. */
  theWord: string;
  /** The load-bearing line: whether the founder is needed today. */
  neededLine: string;
  isFounderNeeded: boolean;
  /**
   * Total items awaiting the founder — the SAME union the neededLine reads
   * (open asks + queued decisions from the pulse). The UI keys the
   * all-clear/decision card on THIS, never on `decision` alone, so the card
   * can never contradict the headline.
   */
  needsYouCount: number;
  /** The single hero decision, if one exists. Most days this is null. */
  decision: FounderDecisionCard | null;
  vitalSign: {
    mrr: number;
    trials: number;
    weeklySpendUsd: number;
    /** "unknown" when the pulse couldn't be read — the UI shows "no data yet", never a guessed green. */
    envelopeStatus: "green" | "amber" | "red" | "unknown";
    /** Measured uptime; null until there's enough real heartbeat data. Never a flattering default. */
    uptimePct: number | null;
    /** Weeks of runway at current burn; null when not burning / unknown. Real, never invented. */
    runwayWeeks: number | null;
    /** Week-over-week MRR change (signed %); null when no real prior datapoint exists. */
    mrrWowPct: number | null;
    /** Wedge throughput (7d): outreach sent, replies in, offers made. null when unreadable. */
    wedge: { outreachSent7d: number; replies7d: number; offers7d: number } | null;
    /** 5xx rate over the last 24h (percent). null when no traffic recorded. */
    errorRatePct: number | null;
    /** Deployed version (short SHA). null when unknown. */
    prodVersion: string | null;
  };
  /** The brain's focus, in plain language. */
  focusLine: string | null;
  trustLedger: FounderBriefInputs["trustLedger"];
  /** What's working — surfaced so the founder watches the system get smarter. */
  learning: Array<{ playId: string; rate: number; n: number }>;
  /** The system's own calibration — "how right I usually am." */
  calibration: { grade: string; n: number; brier: number | null } | null;
  /**
   * Track record — per-domain recorded outcomes with a pre-worded plain
   * line (wording lives server-side, in ONE place, like the wedge receipts).
   */
  trackRecord: Array<{ domain: string; n: number; good: number; bad: number; line: string }>;
  /**
   * Calibration in plain words, with the small-n guard applied: below
   * CALIBRATION_MIN_N it says "Too early to score …" instead of claiming a
   * grade. null when calibration itself was unreadable — render nothing.
   */
  calibrationLine: string | null;
  /** "What's been working" — plain sentences from raw counts (small-n labeled). */
  learningLines: string[];
  /** The confession — capped at MAX_MISSES, newest first. Empty = silence. */
  misses: Array<{ atIso: string | null; line: string; changed: string | null }>;
  /**
   * "My brain changed" — the model-change annunciator's plain-language
   * notice while a recent change is inside its window. null = silence.
   */
  modelChangeNotice: string | null;
  /**
   * QUIET-DAY MODE (founder decision 2026-07-28, ruling #7) — true ONLY on a
   * genuinely green morning, i.e. when ALL hold: nothing needs the founder
   * (the asks + queued-decisions union is zero), the confession is empty,
   * no model-change notice is in its window, and the budget envelope reads a
   * VERIFIED "green". "unknown" (pulse unreadable) is never quiet — an
   * unreadable ledger is never dressed up as a green morning. The UI may
   * SUBTRACT on a quiet day (three lines, full letter one tap away) but never
   * hide: misses non-empty forces the full letter by definition.
   */
  quietDay: boolean;
}

const PART_OF_DAY_WORD: Record<PartOfDay, string> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
};

// ── Track record / confession helpers (pure, exported for unit tests) ────────

/**
 * The minimum checked-prediction count before the Letter claims ANY
 * calibration standing. Mirrors forecast.calibrationReport's minN=10 — below
 * it the grade is "unproven" and the honest sentence is "too early", never a
 * score. Kept as its own constant so the wording layer can't drift looser
 * than the scoring layer.
 */
export const CALIBRATION_MIN_N = 10;

/** The confession never runs past this — a cap, newest kept, oldest dropped. */
export const MAX_MISSES = 5;

/**
 * Calibration in plain founder words. Pure + total.
 *  - null input (calibration unreadable) → null: render NOTHING, never a guess.
 *  - below CALIBRATION_MIN_N → the small-n guard: "Too early to score…".
 *  - at/above it, the grade is stated plainly; "over-confident" is a caution
 *    stated at full severity, never softened. The basis is labeled honestly:
 *    outcomes come from outcomeOf(), whose PRIORITY-1 signal is the founder's
 *    own recorded verdict (experienceLog.ts) — automatic checks fill in only
 *    where no verdict exists. CORRECTED 2026-09-01: this line used to claim
 *    "not your judgment", which the priority order contradicts.
 */
export function calibrationLine(
  cal: { grade: string; n: number; brier: number | null } | null,
): string | null {
  if (!cal) return null;
  if (cal.n < CALIBRATION_MIN_N || cal.grade === "unproven") {
    return `Too early to score my own predictions — ${cal.n} checked so far (I need ${CALIBRATION_MIN_N} before a score means anything).`;
  }
  const basis = "graded against recorded outcomes — your explicit verdicts first, automatic checks where you haven't ruled";
  switch (cal.grade) {
    case "well-calibrated":
      return `When I say how confident I am, reality has matched — checked against ${cal.n} predictions (${basis}).`;
    case "fair":
      return `When I say how confident I am, reality has roughly matched, but not tightly — checked against ${cal.n} predictions (${basis}).`;
    case "over-confident":
      return `A caution: I have been over-confident — I claimed more than reality delivered, across ${cal.n} checked predictions (${basis}). Weigh my confidence accordingly.`;
    default:
      // An unknown grade is never dressed up as a score.
      return `Too early to score my own predictions — ${cal.n} checked so far (I need ${CALIBRATION_MIN_N} before a score means anything).`;
  }
}

/**
 * One per-domain track-record line in plain words. Counts only — no rates, no
 * weighting — and a small sample says so. Pure + total.
 */
export function trackRecordLine(t: { domain: string; n: number; good: number; bad: number }): string {
  const name = cap(t.domain);
  const actions = countNoun(t.n, "action", "actions");
  const smallN = t.n < 5 ? " (small sample — early days)" : "";
  if (t.bad === 0) {
    return `${name}: ${actions} with a recorded outcome — all turned out fine so far${smallN}.`;
  }
  return `${name}: ${actions} with a recorded outcome — ${t.good} turned out fine, ${t.bad} went wrong${smallN}.`;
}

/**
 * One "what's been working" line from RAW counts (never the posterior rate,
 * which would overstate at small n). Small samples are labeled. Pure + total.
 */
export function learningLine(playId: string, successes: number, failures: number): string {
  const s = Math.max(0, successes);
  const n = s + Math.max(0, failures);
  const smallN = n < 5 ? " — small sample, treat as an early signal" : "";
  return `“${playId}” went well in ${s} of ${n} recorded ${n === 1 ? "try" : "tries"}${smallN}.`;
}

/**
 * The quiet-day predicate (ruling #7, 2026-07-28). Pure + total, exported for
 * unit tests. Quiet ONLY when ALL of these hold:
 *  - needsYouCount === 0 — the SAME asks + queued-decisions union the
 *    neededLine reads; anything waiting means the founder is needed.
 *  - misses is empty — a non-empty confession ALWAYS forces the full letter.
 *  - modelChangeNotice is null — a recent brain change is never quieted.
 *  - envelopeStatus === "green" — a VERIFIED green budget. "amber"/"red" are
 *    not quiet, and "unknown" (the ledger couldn't be read) is treated as NOT
 *    quiet: unknown is never dressed up as green.
 */
export function isQuietDay(q: {
  needsYouCount: number;
  misses: ReadonlyArray<unknown>;
  modelChangeNotice: string | null;
  envelopeStatus: "green" | "amber" | "red" | "unknown";
}): boolean {
  return (
    q.needsYouCount === 0 &&
    q.misses.length === 0 &&
    q.modelChangeNotice === null &&
    q.envelopeStatus === "green"
  );
}

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

  // ── The needed-line: the single most important thing on the page. ─────────
  // It must agree with the Decisions door. Asks (solene_founder_asks, live),
  // queued decisions (pending decisions_inbox_items via the pulse's
  // decisionsWaitingCount) and frozen sends awaiting a tap
  // (autopilot_pending_actions via frozenSends.pendingNow) are three separate
  // stores; the Letter reads the UNION — it may never say "nothing needs you"
  // while the Decisions door holds work (2026-07 design-panel finding: the
  // Letter said exactly that over 17 waiting items, fatal for a product whose
  // thesis is "trust the one letter"). HISTORY (2026-08-31): until then the
  // pulse set decisionsWaitingCount from the SAME ask count as asksOpenCount,
  // double-counting every open ask. HISTORY (2026-09-01): the witnessed-send
  // queue was in NO part of the union — the Letter said quiet while the door
  // showed "Waiting on you to send (N)". letterNeedsYouUnion.test.ts pins all
  // three operands' provenance.
  const asksCount = inp.openAsks.length;
  const queueCount = Math.max(0, inp.pulse.decisionsWaitingCount);
  // frozenSends null = the read failed; degrade to the pre-wiring behavior
  // (no claim about sends either way) rather than inventing a zero.
  const sendsCount = Math.max(0, inp.frozenSends?.pendingNow ?? 0);
  const needsYouCount = asksCount + queueCount + sendsCount;
  const isFounderNeeded = needsYouCount > 0;

  const neededPieces: string[] = [];
  if (asksCount > 0) neededPieces.push(`${countNoun(asksCount, "question", "questions")} below`);
  if (queueCount > 0) neededPieces.push(`${countNoun(queueCount, "decision", "decisions")} waiting in Decisions`);
  if (sendsCount > 0) neededPieces.push(`${countNoun(sendsCount, "send frozen", "sends frozen")} until you approve`);

  const neededLine = !isFounderNeeded
    ? "Nothing needs you today."
    : neededPieces.length > 1
      ? `${needsYouCount} things need your call — ${neededPieces.join(", plus ")}.`
      : asksCount === 1
        ? "One thing needs your call — below."
        : asksCount > 1
          ? `${asksCount} things need your call — below.`
          : queueCount > 0
            ? `${countNoun(queueCount, "decision is", "decisions are")} waiting for you in Decisions.`
            : `${countNoun(sendsCount, "send is frozen", "sends are frozen")} until you approve — in Decisions.`;

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
        : inp.pulse.envelopeStatus === "red"
          ? "spend is constrained — runway needs attention"
          : "I can't read the spend ledger right now";
  const trialsBit = inp.pulse.trials > 0 ? `, ${countNoun(inp.pulse.trials, "trial", "trials")} in the funnel` : "";
  parts.push(`${money}${trialsBit}, and ${runway}.`);

  // Anything flagged — surfaced honestly rather than buried.
  if (inp.pulse.dispatchesFlaggedLast24h > 0) {
    parts.push(
      `${cap(countNoun(inp.pulse.dispatchesFlaggedLast24h, "item was", "items were"))} flagged for review and ${inp.pulse.dispatchesFlaggedLast24h === 1 ? "is" : "are"} being handled.`,
    );
  }

  // Decision scoring (Horizon A4) — one sentence, only when something was
  // genuinely scored today. Real counts from the scorer's daily summary.
  if (inp.scoring && inp.scoring.totalScored > 0) {
    parts.push(
      `I scored ${countNoun(inp.scoring.totalScored, "prospective dispatch", "prospective dispatches")} against expected value today (average score ${inp.scoring.averageScore.toFixed(2)}, ${inp.scoring.deferredCount} deferred).`,
    );
  }

  // Connections sweep (Horizon A5) — one sentence, ONLY when the last sweep
  // parsed real findings. Silence otherwise: no sweep / zero findings /
  // unreadable blob all say nothing here (never an interrupt, never padding);
  // The Letter carries the detail.
  if (inp.sweep && inp.sweep.findingsCount > 0) {
    parts.push(
      `The weekly connections sweep flagged ${countNoun(inp.sweep.findingsCount, "item", "items")} — the full list is in the monthly letter, under All instruments → Monthly letter.`,
    );
  }

  // The closing line mirrors the needed-line so the paragraph lands on the
  // one thing that matters.
  parts.push(isFounderNeeded ? capFirst(neededLine) : "Nothing needs you today.");

  // Frozen-send visibility (stage-4 turn 5, OD-9): rendered only when the
  // counters were actually read AND the lane saw traffic — a quiet lane says
  // nothing rather than reciting zeros. An expired card is called out in the
  // sentence because a send dying unseen is the one failure the
  // grants-for-all ruling must keep loud.
  if (inp.frozenSends && inp.frozenSends.proposed > 0) {
    const f = inp.frozenSends;
    let line =
      `Witnessed sends this week: ${f.proposed} frozen — ` +
      `${f.autoWitnessed} released by your grants, ${f.tappedByFounder} you tapped`;
    line += f.expiredUnseen > 0
      ? `, and ${f.expiredUnseen} EXPIRED unseen — those never went out; check the grant budgets on Controls.`
      : `, none expired.`;
    parts.push(line);
  }

  const theWord = parts.join(" ");

  // ── The brain's focus, in plain language (observational in P0). ───────────
  // Honest about MODE: when dispatch is off the loop only watches and drafts,
  // so the focus line must say so instead of reading as operation.
  const observeOnly = inp.operatingMode ? !inp.operatingMode.dispatchEnabled : false;
  const focusLine = inp.plannedFocus
    ? observeOnly
      ? `I'm watching this in observe-only mode (nothing executes until you enable Dispatch in Controls): ${inp.plannedFocus.rationale}`
      : `Right now I'm focused on: ${inp.plannedFocus.rationale}`
    : null;

  // The confession — newest first from the gatherer; cap enforced here so
  // the Letter can never become a wall of indictments (oldest dropped).
  const misses = (inp.misses ?? []).slice(0, MAX_MISSES);
  const modelChangeNotice = inp.modelChangeNotice ?? null;

  // Quiet-day (ruling #7) — computed from the SAME values the brief carries,
  // so the compact view can never quiet something the full letter would show.
  const quietDay = isQuietDay({
    needsYouCount,
    misses,
    modelChangeNotice,
    envelopeStatus: inp.pulse.envelopeStatus,
  });

  return {
    greeting,
    theWord,
    neededLine,
    isFounderNeeded,
    needsYouCount,
    decision,
    vitalSign: {
      mrr: inp.pulse.mrr,
      trials: inp.pulse.trials,
      weeklySpendUsd: inp.pulse.weeklySpendUsd,
      envelopeStatus: inp.pulse.envelopeStatus,
      uptimePct: inp.pulse.uptimePct,
      runwayWeeks: inp.runwayWeeks ?? null,
      mrrWowPct: inp.mrrWowPct ?? null,
      wedge: inp.wedge ?? null,
      errorRatePct: inp.errorRatePct ?? null,
      prodVersion: inp.prodVersion ?? null,
    },
    focusLine,
    trustLedger: inp.trustLedger,
    learning: inp.learning ?? [],
    calibration: inp.calibration ?? null,
    // Track record — only entries with real recorded outcomes; the wording
    // is composed HERE so every surface says it the same honest way.
    trackRecord: (inp.trackRecord ?? [])
      .filter((t) => t.n > 0)
      .map((t) => ({ ...t, line: trackRecordLine(t) })),
    calibrationLine: calibrationLine(inp.calibration ?? null),
    learningLines: inp.learningLines ?? [],
    misses,
    modelChangeNotice,
    quietDay,
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
  // No pulse ⇒ say so. Substituting a green envelope or a 99.9% uptime here
  // was the one fabrication on the founder's canonical surface (WS2, 2026-07-07).
  const safePulse = {
    mrr: pulse?.mrr ?? 0,
    trials: pulse?.trials ?? 0,
    weeklySpendUsd: pulse?.weeklySpendUsd ?? 0,
    envelopeStatus: (pulse?.envelopeStatus ?? "unknown") as "green" | "amber" | "red" | "unknown",
    uptimePct: pulse?.uptimePct ?? null,
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
      // The brain's senses are 3-state; an unknown envelope keeps the prior
      // (non-alarmed) posture for ranking while the DISPLAY stays honest.
      envelopeStatus: safePulse.envelopeStatus === "unknown" ? "green" : safePulse.envelopeStatus,
      dispatchesFlaggedLast24h: safePulse.dispatchesFlaggedLast24h,
    });
    plannedFocus = rankMoves(senses)[0] ?? null;
  } catch {
    plannedFocus = null;
  }

  // Trust Ledger — the felt sense of earning. The raw rows also carry the
  // last circuit-breaker demotion (when + why), which the confession reads.
  let trustLedger: FounderBrief["trustLedger"] = [];
  let trustDemotions: Array<{ domain: string; at: Date; reason: string | null }> = [];
  try {
    const { getTrustLedger } = await import("./domainAutonomy");
    const rows = await getTrustLedger();
    trustLedger = rows.map((r) => ({
      domain: r.domain,
      level: r.level,
      cleanCycleCount: r.cleanCycleCount,
      threshold: r.threshold,
    }));
    trustDemotions = rows
      .filter((r) => r.lastDemotedAt != null)
      .map((r) => ({ domain: r.domain, at: r.lastDemotedAt as Date, reason: r.lastDemotionReason }));
  } catch {
    trustLedger = [];
    trustDemotions = [];
  }

  // What's working — top plays by real efficacy across the engine domains.
  // learningLines carries the same top plays as RAW counts ("3 of 4"), so the
  // rendered sentence can never overstate the posterior rate at small n.
  let learning: FounderBrief["learning"] = [];
  let learningLines: string[] = [];
  try {
    const { getPlayStats } = await import("./experienceLog");
    const { efficacyOf } = await import("./efficacy");
    const allStats = (await Promise.all(["growth", "support"].map((d) => getPlayStats(d)))).flat();
    const ranked = allStats
      .map((s) => ({ ...s, ...efficacyOf(s) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.rate - a.rate || b.n - a.n)
      .slice(0, 3);
    learning = ranked.map((s) => ({ playId: s.playId, rate: s.rate, n: s.n }));
    learningLines = ranked.map((s) => learningLine(s.playId, s.successes, s.failures));
  } catch {
    learning = [];
    learningLines = [];
  }

  // Track record — per-domain recorded outcomes across ALL autopilot domains,
  // summed from the same experience-log votes the learning loop reads. Only
  // real counts; a domain with nothing recorded simply isn't listed.
  let trackRecord: FounderBriefInputs["trackRecord"] = [];
  try {
    const { getPlayStats } = await import("./experienceLog");
    const { AUTOPILOT_DOMAINS } = await import("./domainAutonomy");
    const perDomain = await Promise.all(
      AUTOPILOT_DOMAINS.map(async (domain) => {
        const stats = await getPlayStats(domain);
        let good = 0;
        let bad = 0;
        for (const s of stats) {
          good += Math.max(0, s.successes);
          bad += Math.max(0, s.failures);
        }
        return { domain, n: good + bad, good, bad };
      }),
    );
    trackRecord = perDomain.filter((t) => t.n > 0);
  } catch {
    trackRecord = [];
  }

  // The confession — "since last week, what went wrong", from REAL sources
  // only. Best-effort per source; a failed read contributes nothing (never a
  // guessed miss, never fake reassurance).
  let misses: FounderBriefInputs["misses"] = [];
  try {
    const sinceMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const collected: Array<{ atIso: string | null; line: string; changed: string | null }> = [];

    // (a) Outcome-ledger scores that came back NEGATIVE in the trailing week.
    // actualOutcome is the ledger's own honest sentence (it already carries
    // "causality uncertain" where that applies) — quoted, never re-worded.
    try {
      const { db } = await import("../../db");
      const { decisionsInboxItems } = await import("@shared/schema");
      const { and, desc, gte, isNotNull, lte } = await import("drizzle-orm");
      const rows = await db
        .select({
          label: decisionsInboxItems.recommendedActionLabel,
          actualOutcome: decisionsInboxItems.actualOutcome,
          outcomeScore: decisionsInboxItems.outcomeScore,
          recordedAt: decisionsInboxItems.outcomeRecordedAt,
        })
        .from(decisionsInboxItems)
        .where(
          and(
            isNotNull(decisionsInboxItems.outcomeRecordedAt),
            gte(decisionsInboxItems.outcomeRecordedAt, new Date(sinceMs)),
            isNotNull(decisionsInboxItems.outcomeScore),
            lte(decisionsInboxItems.outcomeScore, -1),
          ),
        )
        .orderBy(desc(decisionsInboxItems.outcomeRecordedAt))
        .limit(MAX_MISSES);
      for (const r of rows) {
        const what =
          r.actualOutcome ??
          ((r.outcomeScore ?? -1) <= -2
            ? "it was scored “wrong call” at check-in."
            : "it was scored “didn't help” at check-in.");
        collected.push({
          atIso: r.recordedAt ? new Date(r.recordedAt).toISOString() : null,
          line: r.label
            ? `“${r.label}” didn't turn out as predicted: ${what}`
            : `A decision didn't turn out as predicted: ${what}`,
          // No concrete per-outcome follow-up is recorded — nothing invented.
          changed: null,
        });
      }
    } catch {
      /* this source contributes nothing */
    }

    // (b) Trust-ledger circuit-breaker demotions in the trailing week. The
    // "what changed" here is real: the demotion itself (recordAnomaly drops
    // the level and resets clean-cycle progress).
    for (const d of trustDemotions) {
      if (d.at.getTime() >= sinceMs) {
        collected.push({
          atIso: d.at.toISOString(),
          line: `I pulled back my own authority in ${d.domain} after a problem${d.reason ? ` — ${d.reason}` : ""}.`,
          changed:
            "That area now runs at a lower trust level and has to re-earn clean runs before it can act more freely.",
        });
      }
    }

    // (c) Overdue outcome check-ins — promised verifications not yet done.
    // A self-reported miss about the verifying itself.
    try {
      const { getOutcomeLedgerCounts } = await import("../outcomeLedger");
      const counts = await getOutcomeLedgerCounts(new Date(nowMs));
      if (counts.overdue > 0) {
        collected.push({
          atIso: null,
          line: `${countNoun(counts.overdue, "outcome check is", "outcome checks are")} past due — I said I'd verify how those decisions turned out, and I haven't yet.`,
          changed: null,
        });
      }
    } catch {
      /* this source contributes nothing */
    }

    // Newest first (undated lines last); the builder caps at MAX_MISSES.
    const ts = (x: { atIso: string | null }) => (x.atIso ? Date.parse(x.atIso) : 0);
    collected.sort((a, b) => ts(b) - ts(a));
    misses = collected;
  } catch {
    misses = [];
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

  // Wedge throughput (7d): the outreach → reply → offer funnel, counted from
  // the real event tables. Zeros are honest zeros; null only when unreadable.
  let wedge: FounderBriefInputs["wedge"] = null;
  try {
    const { db } = await import("../../db");
    const { campaignDeliveryEvents, messages, offers } = await import("@shared/schema");
    const { sql, gte, and, eq } = await import("drizzle-orm");
    const cutoff = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
    const [[sent], [replies], [made]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(campaignDeliveryEvents).where(gte(campaignDeliveryEvents.sentAt, cutoff)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(eq(messages.direction, "inbound"), gte(messages.createdAt, cutoff))),
      db.select({ n: sql<number>`count(*)::int` }).from(offers).where(gte(offers.createdAt, cutoff)),
    ]);
    wedge = { outreachSent7d: sent?.n ?? 0, replies7d: replies?.n ?? 0, offers7d: made?.n ?? 0 };
  } catch {
    wedge = null;
  }

  // Error rate — 5xx share of the durable 24h telemetry window. 4xx is
  // excluded on purpose (auth churn isn't an outage signal). null = no traffic.
  let errorRatePct: number | null = null;
  try {
    const { getTelemetrySummaryDurable } = await import("../../middleware/apiTelemetry");
    const t = await getTelemetrySummaryDurable();
    if (t.totals.totalCount > 0) {
      errorRatePct = Math.round((t.totals.total5xx / t.totals.totalCount) * 1000) / 10;
    }
  } catch {
    errorRatePct = null;
  }

  const prodVersion =
    pulse?.prodVersion && pulse.prodVersion !== "unknown" ? pulse.prodVersion : null;

  // Decision scoring, today — the tokenEconomyScorer daily summary (the
  // L5.27 pulse wire-in). Best-effort: unreadable → null → sentence omitted.
  let scoring: FounderBriefInputs["scoring"] = null;
  try {
    const { getDailyScoringSummary } = await import("../solene/tokenEconomyScorer");
    const s = await getDailyScoringSummary();
    scoring = {
      totalScored: s.totalScored,
      averageScore: s.averageScore,
      deferredCount: s.deferredCount,
    };
  } catch {
    scoring = null;
  }

  // Connections sweep (Horizon A5) — parsed finding count from the persisted
  // blob. Best-effort: unreadable / absent / unparseable → null → the pulse
  // stays silent (the Letter paragraph carries the honest state).
  let sweep: FounderBriefInputs["sweep"] = null;
  try {
    const { readLatestSweepBlob } = await import("../solene/connectionsSweep");
    const blob = await readLatestSweepBlob();
    sweep = blob && blob.parseOk ? { findingsCount: blob.findings.length } : null;
  } catch {
    sweep = null;
  }

  // Model-change annunciator — "my brain changed" in plain words, only when
  // the underlying model config genuinely changed within its notice window.
  // Best-effort: a failed check contributes nothing (silence, never invented).
  let modelChangeNotice: string | null = null;
  try {
    const { checkModelChange } = await import("./modelChangeAnnunciator");
    const res = await checkModelChange(nowMs);
    modelChangeNotice = res.notice;
  } catch {
    modelChangeNotice = null;
  }

  // Operating mode — read the real switches; null (silent) when unreadable.
  let operatingMode: FounderBriefInputs["operatingMode"] = null;
  try {
    const { getEffectiveSettings } = await import("./settings");
    const eff = await getEffectiveSettings(nowMs);
    operatingMode = {
      dispatchEnabled: eff.dispatchEnabled,
      cognitionEnabled: eff.cognitionEnabled,
    };
  } catch {
    operatingMode = null;
  }

  // Frozen-send counters — null on read failure (silent, never zeros).
  let frozenSends: FounderBriefInputs["frozenSends"] = null;
  try {
    const { pendingHandCounters } = await import("./pendingHands");
    const c = await pendingHandCounters();
    frozenSends = {
      proposed: c.proposed,
      tappedByFounder: c.tappedByFounder,
      autoWitnessed: c.autoWitnessed,
      expiredUnseen: c.expiredUnseen,
      pendingNow: c.pendingNow,
    };
  } catch {
    frozenSends = null;
  }

  return buildFounderBrief({
    partOfDay,
    founderName,
    pulse: safePulse,
    openAsks,
    frozenSends,
    plannedFocus,
    operatingMode,
    trustLedger,
    learning,
    learningLines,
    calibration,
    trackRecord,
    misses,
    modelChangeNotice,
    runwayWeeks,
    mrrWowPct,
    wedge,
    errorRatePct,
    prodVersion,
    scoring,
    sweep,
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
