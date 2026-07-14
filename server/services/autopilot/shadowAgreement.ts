/**
 * Founder Autopilot — SHADOW AGREEMENT (Horizon A2: autonomy promotions by
 * demonstrated agreement).
 *
 * When the domain-autonomy gate holds a move back (OBSERVE blocks it; DRAFT
 * escalates it for a human tap), the experience log already records the call
 * the autopilot WOULD have made. Those rows are SHADOW decisions: predictions
 * of the ruling, made while the machine had no authority to act. This module
 * (a) marks those rows so they are identifiable, and (b) computes the honest
 * agreement statistic — of the shadow calls whose real-world ruling has since
 * RESOLVED (founder verdict / real consequence, via outcomeOf), how many did
 * the ruling agree with?
 *
 * ┌─ THE SACRED LINE (same invariant as shadowRegret.ts:9-21) ────────────────┐
 * │ SHADOW NEVER ACTS. A shadow record is STRUCTURALLY INCAPABLE of producing │
 * │ side effects:                                                             │
 * │   • markShadowExperience is PURE — it returns annotated metadata for a    │
 * │     row that was ALREADY held back by the gate; it enqueues nothing,      │
 * │     imports no DB, and never mutates its input.                           │
 * │   • the shadow targetRef lives in its own "shadow:" namespace, disjoint   │
 * │     from the real consequence keys ("invoice:…", "email:…" —              │
 * │     experienceLog.deriveTargetRef), so no consequence webhook can ever    │
 * │     credit — or fire autonomy feedback through — a shadow row.            │
 * │   • ShadowAgreement carries NO successes/failures fields — it cannot be   │
 * │     coerced into a PlayStats, so it can never move a learning posterior.  │
 * │ Its ONLY consumer is the founder-gated promotion card + the trust-ledger  │
 * │ UI line. Constitutional basis: Sovereign Principle 10 — "No agent may     │
 * │ unilaterally expand its own authority"; promotions/demotions are Class B  │
 * │ decisions.                                                                │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Honesty rules (no fabricated data):
 *   • a pair only counts when its real outcome actually RESOLVED (outcomeOf ≠
 *     pending); unresolved pairs are excluded from the denominator and
 *     reported as pendingPairs;
 *   • below SHADOW_MIN_PAIRS resolved pairs, no promotion card may cite
 *     agreement — the caller declines to fire and says so;
 *   • the agreement math is the EXISTING decisionEval shelf-ware
 *     (replayPolicy + agreementProxy), wired — not reimplemented.
 */
import {
  agreementProxy,
  replayPolicy,
  buildDecisionRecords,
  type DecisionRecord,
} from "./decisionEval";

/** Resolved shadow pairs required before a promotion card may cite agreement. */
export const SHADOW_MIN_PAIRS = 8;

/** Default trailing evidence window. */
export const SHADOW_WINDOW_WEEKS = 6;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Namespace prefix for shadow join keys — disjoint from real consequence keys. */
export const SHADOW_TARGET_PREFIX = "shadow:";

// ── 1. Shadow marking (pure) ─────────────────────────────────────────────────

export interface ShadowMarkInput {
  /** The act outcome for the move ("acted" | "escalated" | "suppressed" | "error"). */
  outcome: string;
  /** Which gate produced the terminal decision (PolicyGateDecision.decidedBy). */
  gateDecidedBy?: string | null;
  moveKind: string;
  /** The already-built glass-box reasoning trace (never mutated). */
  reasoningTrace: Record<string, unknown>;
  /**
   * Deterministic key binding this shadow decision to the real-world situation
   * it shadows (deal/org/alert/growth-target id when one exists; otherwise the
   * move's own dedupe/effect key).
   */
  situationKey?: string | null;
}

export interface ShadowMarkResult {
  isShadow: boolean;
  /** The trace to store — a NEW object when marked; the input object untouched. */
  reasoningTrace: Record<string, unknown>;
  /** "shadow:<situationKey>" when marked (and a key exists), else null. */
  targetRef: string | null;
}

/**
 * Mark an experience payload as a SHADOW decision when — and only when — the
 * AUTONOMY gate is what held the move back: an OBSERVE block (suppressed) or a
 * DRAFT escalation (a human must approve). Every other suppression/escalation
 * cause (budget, compliance, risk, pre-mortem, witnessed-send) is a safety
 * verdict, not a shadow of withheld authority, and is left unmarked.
 *
 * PURE + total: returns new data, mutates nothing, performs no I/O. The rows
 * were already being written; this only adds identifying fields.
 */
export function markShadowExperience(input: ShadowMarkInput): ShadowMarkResult {
  const heldByAutonomyGate =
    (input.outcome === "suppressed" || input.outcome === "escalated") &&
    input.gateDecidedBy === "autonomy";
  if (!heldByAutonomyGate) {
    return { isShadow: false, reasoningTrace: input.reasoningTrace, targetRef: null };
  }
  const key = input.situationKey?.trim();
  return {
    isShadow: true,
    reasoningTrace: {
      ...input.reasoningTrace,
      shadow: true,
      shadowedCapability: input.moveKind,
    },
    targetRef: key ? `${SHADOW_TARGET_PREFIX}${key}` : null,
  };
}

// ── 2. Agreement statistics (pure core + thin impure wrapper) ────────────────

export interface ShadowMiss {
  /** ISO timestamp of the shadow decision, or null if the row carried none. */
  when: string | null;
  moveKind: string;
  /** The call the autopilot would have made. */
  shadowCall: string;
  /** How the real ruling resolved, verbatim from the resolved vote. */
  actualRuling: string;
}

/**
 * The shadow-agreement reading. NOTE the deliberate absence of any
 * successes/failures fields — this type cannot be passed where the reward edge
 * expects PlayStats (the same structural guarantee as ShadowRegret).
 */
export interface ShadowAgreement {
  /** Resolved pairs where the real ruling agreed with the shadow's call. */
  matched: number;
  /** Resolved pairs total (the honest denominator). */
  total: number;
  /** Shadow rows whose real outcome has not resolved — never in the denominator. */
  pendingPairs: number;
  windowWeeks: number;
  /** The 3 most recent disagreements, verbatim. */
  misses: ShadowMiss[];
  /** total >= SHADOW_MIN_PAIRS — whether a promotion card may cite this. */
  sufficient: boolean;
  /** Distinct capabilities (move kinds) the shadow evidence cites. */
  capabilities: string[];
  /** Honest caveat carried from the agreement proxy. */
  caveat: string;
}

/** A DecisionRecord that carries the shadow marker (see decisionEval). */
function isShadowRecord(r: DecisionRecord): boolean {
  return r.shadow != null;
}

/**
 * Compute shadow agreement from already-loaded decision records. Pure.
 *
 * WIRES the decisionEval shelf-ware rather than reimplementing its math:
 *   • replayPolicy replays the SHADOW policy ("the call the autopilot would
 *     have made") over the logged situations;
 *   • agreementProxy scores it: agreement-with-wins (the shadow made the call
 *     the ruling upheld) + divergence-from-losses (the shadow would have
 *     avoided the call the ruling struck down).
 * matched = agreedWins + divergedLosses over the resolved denominator.
 *
 * Only RESOLVED votes count (outcomeOf already refused to invent them);
 * pending pairs are excluded from the denominator and reported separately.
 */
export function shadowAgreementFromRecords(
  records: DecisionRecord[],
  opts: { now?: Date; windowWeeks?: number } = {},
): ShadowAgreement {
  const now = opts.now ?? new Date();
  const windowWeeks = opts.windowWeeks ?? SHADOW_WINDOW_WEEKS;
  const windowStart = now.getTime() - windowWeeks * WEEK_MS;

  // Shadow-marked rows inside the window. A row without a timestamp cannot be
  // honestly placed in the window, so it is excluded (never guessed in).
  const shadowRows = records.filter(
    (r) =>
      isShadowRecord(r) &&
      r.at != null &&
      r.at.getTime() >= windowStart &&
      r.at.getTime() <= now.getTime(),
  );

  const resolved = shadowRows.filter((r) => r.vote === "success" || r.vote === "failure");
  const pendingPairs = shadowRows.length - resolved.length;

  // Replay the shadow policy over the resolved situations. The policy's call
  // for each situation is the recorded shadowedCapability (the move the gate
  // held back) — looked up by the record's own senses object identity, which
  // is unique per record (built fresh by buildDecisionRecords).
  const shadowCallOf = (r: DecisionRecord): string => r.shadow?.shadowedCapability ?? r.moveKind;
  const callBySenses = new Map<Record<string, unknown>, string>();
  for (const r of resolved) callBySenses.set(r.senses, shadowCallOf(r));
  const replay = replayPolicy(resolved, (senses) => callBySenses.get(senses) ?? "");
  const proxy = agreementProxy(replay);

  const agreedWins =
    proxy.agreementOnWins != null ? Math.round(proxy.agreementOnWins * proxy.winsN) : 0;
  const divergedLosses =
    proxy.divergenceOnLosses != null ? Math.round(proxy.divergenceOnLosses * proxy.lossesN) : 0;
  const matched = agreedWins + divergedLosses;
  const total = proxy.winsN + proxy.lossesN;

  // A miss is a resolved pair where the ruling went AGAINST the shadow's call:
  // a win the shadow would have skipped, or a loss the shadow would have made.
  const misses: ShadowMiss[] = resolved
    .map((r, i) => ({ r, entry: replay[i] }))
    .filter(
      ({ entry }) =>
        (entry.vote === "success" && entry.chosen !== entry.actual) ||
        (entry.vote === "failure" && entry.chosen === entry.actual),
    )
    .sort((a, b) => (b.r.at?.getTime() ?? 0) - (a.r.at?.getTime() ?? 0))
    .slice(0, 3)
    .map(({ r, entry }) => ({
      when: r.at ? r.at.toISOString() : null,
      moveKind: r.moveKind,
      shadowCall: entry.chosen,
      actualRuling:
        entry.vote === "failure"
          ? `resolved as a failure — the real ruling went against "${entry.chosen}"`
          : `resolved as a success on "${entry.actual}" — the shadow called "${entry.chosen}"`,
    }));

  return {
    matched,
    total,
    pendingPairs,
    windowWeeks,
    misses,
    sufficient: total >= SHADOW_MIN_PAIRS,
    capabilities: [...new Set(shadowRows.map(shadowCallOf))],
    caveat: proxy.caveat,
  };
}

/**
 * Live shadow agreement for a domain over the trailing window. Best-effort
 * reader (buildDecisionRecords returns [] on DB error → honest zeros).
 */
export async function computeShadowAgreement(
  domain: string,
  weeks = SHADOW_WINDOW_WEEKS,
): Promise<ShadowAgreement> {
  const records = await buildDecisionRecords(domain, 500);
  return shadowAgreementFromRecords(records, { windowWeeks: weeks });
}

/** The small, honest trust-ledger line. Pure. */
export function formatShadowAgreementLine(a: ShadowAgreement): string {
  if (a.sufficient) {
    return `shadow: ${a.matched}/${a.total} matched, ${a.windowWeeks}wk`;
  }
  return `shadow evidence accumulating: ${a.total}/${SHADOW_MIN_PAIRS} pairs`;
}

/** Best-effort wrapper for route enrichment — never throws. */
export async function getShadowAgreementLine(domain: string): Promise<string | null> {
  try {
    return formatShadowAgreementLine(await computeShadowAgreement(domain));
  } catch {
    return null;
  }
}
