/**
 * Founder Autopilot — the Experience Log (procedural memory).
 *
 * One row per autopilot action; real signals accrete as they land. The
 * honesty-critical piece is outcomeOf(): how a recorded experience becomes a
 * success / failure / pending vote for the efficacy model. It uses ONLY real,
 * attributable signals — the founder's verdict (ground truth), support
 * resolution + satisfaction, the eval score, and the mechanical dispatch result.
 * No downstream metric attribution (locked decision: strict signals only).
 *
 * outcomeOf + statsFromExperiences are PURE → exhaustively unit-testable. The DB
 * functions are thin record/accrete helpers.
 */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { autopilotExperiences, type AutopilotExperience } from "@shared/schema";
import { logger } from "../../utils/logger";
import type { PlayStats } from "./efficacy";

/** Eval score at/above this counts as a pass (matches the eval-gate spirit). */
export const EVAL_PASS_THRESHOLD = 0.6;

export type ExperienceVote = "success" | "failure" | "pending";

/** The subset of signals outcomeOf reasons over (kept narrow + pure). */
export interface ExperienceSignals {
  dispatchSuccess?: boolean | null;
  evalScore?: number | null;
  founderVerdict?: string | null; // approved | declined
  resolution?: string | null; // resolved | reopened
  satisfaction?: number | null; // 1-5
  // ── Outward outcomes (Hands roadmap P0.3) — real effects in the world, fed
  // from the perception bus. Only vote when genuinely observed; never invented.
  deliveryBounced?: boolean | null; // an outward send hard-bounced / complained
  paymentRecovered?: boolean | null; // a dunning action → invoice actually paid
}

/**
 * Derive the learning vote from an experience's REAL signals. Priority order
 * puts the strongest ground truth first:
 *   1. The founder's explicit verdict (approve/decline) — human ground truth.
 *   2. Support resolution + satisfaction — did it actually help the customer.
 *   3. The eval gate — was the output grounded/acceptable.
 *   4. The mechanical dispatch result — did it even run.
 * Anything not yet signalled is "pending" (it doesn't vote — never invented).
 */
export function outcomeOf(s: ExperienceSignals): ExperienceVote {
  // 1. Human ground truth.
  if (s.founderVerdict === "approved") return "success";
  if (s.founderVerdict === "declined") return "failure";

  // 2. Support efficacy — did it genuinely help.
  if (s.resolution === "reopened") return "failure";
  if (s.resolution === "resolved") {
    if (s.satisfaction != null && s.satisfaction <= 2) return "failure"; // resolved badly
    return "success";
  }

  // 2.5. Outward real-world outcome (Hands roadmap P0.3). A send that
  // hard-bounced/complained is a real failure of that action; a dunning action
  // whose invoice then actually paid is a real success. These are concrete
  // effects in the world, ranked above the eval/mechanical proxies below.
  if (s.deliveryBounced === true) return "failure";
  if (s.paymentRecovered === true) return "success";

  // 3. Eval gate (only if scored).
  if (s.evalScore != null && s.evalScore < EVAL_PASS_THRESHOLD) return "failure";

  // 4. Mechanical result.
  if (s.dispatchSuccess === false) return "failure";
  if (s.dispatchSuccess === true && (s.evalScore == null || s.evalScore >= EVAL_PASS_THRESHOLD)) {
    return "success";
  }

  // No real signal yet — it does not vote.
  return "pending";
}

/** Aggregate experiences into per-play stats. Pure. Pending votes are ignored. */
export function statsFromExperiences(
  rows: Array<{ playId: string | null } & ExperienceSignals>,
): PlayStats[] {
  const byPlay = new Map<string, PlayStats>();
  for (const r of rows) {
    if (!r.playId) continue;
    const vote = outcomeOf(r);
    if (vote === "pending") continue;
    const cur = byPlay.get(r.playId) ?? { playId: r.playId, successes: 0, failures: 0 };
    if (vote === "success") cur.successes += 1;
    else cur.failures += 1;
    byPlay.set(r.playId, cur);
  }
  return [...byPlay.values()];
}

/**
 * Build the outcomeOf signal set from a DB row. Centralizes the mapping so every
 * aggregator votes on the SAME fields — including the real consequence columns
 * (deliveryBounced/paymentRecovered), which the readers historically dropped
 * (so even a written consequence never voted). kernel-elevation T0.1.
 */
type ExperienceRowSignals = {
  dispatchSuccess?: boolean | null;
  evalScore?: unknown;
  founderVerdict?: string | null;
  resolution?: string | null;
  satisfaction?: number | null;
  deliveryBounced?: boolean | null;
  paymentRecovered?: boolean | null;
};
export function signalsOf(r: ExperienceRowSignals): ExperienceSignals {
  return {
    dispatchSuccess: r.dispatchSuccess ?? null,
    evalScore: r.evalScore != null ? Number(r.evalScore) : null,
    founderVerdict: r.founderVerdict ?? null,
    resolution: r.resolution ?? null,
    satisfaction: r.satisfaction ?? null,
    deliveryBounced: r.deliveryBounced ?? null,
    paymentRecovered: r.paymentRecovered ?? null,
  };
}

/**
 * Pure: the target_ref for a witnessed hand, given its tool name + input — the
 * 1:1 join key a downstream webhook credits the consequence against. Returns
 * null when there is no clean concrete target (→ honest abstention; no
 * consequence is ever attributed to an action we can't precisely identify).
 * `invoiceId` (resolved from a dunning event by the caller) takes precedence.
 */
export function deriveTargetRef(
  toolName: string,
  input: Record<string, unknown>,
  invoiceId?: string | null,
): string | null {
  if (invoiceId) return `invoice:${invoiceId}`;
  if ((toolName === "send_email" || toolName === "send_gmail") && typeof input.to === "string" && input.to) {
    return `email:${input.to.toLowerCase()}`;
  }
  return null;
}

// ── DB: record + accrete ─────────────────────────────────────────────────────

export async function recordExperience(input: {
  moveKind: string;
  domain: string;
  playId?: string | null;
  outcome: "acted" | "escalated" | "suppressed";
  dispatchId?: number | null;
  askId?: number | null;
  /** The success probability the system forecast for this action (0..1). */
  predictedSuccess?: number | null;
  /** The glass-box reasoning trace (structured + narrative). */
  reasoningTrace?: unknown;
}): Promise<number> {
  const [row] = await db
    .insert(autopilotExperiences)
    .values({
      moveKind: input.moveKind,
      domain: input.domain,
      playId: input.playId ?? null,
      outcome: input.outcome,
      dispatchId: input.dispatchId ?? null,
      askId: input.askId ?? null,
      predictedSuccess: input.predictedSuccess != null ? String(input.predictedSuccess) : null,
      reasoningTrace: input.reasoningTrace ?? null,
    })
    .returning({ id: autopilotExperiences.id });
  return row?.id ?? 0;
}

/**
 * Recent actions with their reasoning trace + resolved outcome — the glass-box
 * "story" the founder reads. Each entry exposes the full WHY plus what's known
 * about how it turned out.
 */
export async function getRecentStory(limit = 30): Promise<
  Array<{
    id: number;
    at: Date | null;
    moveKind: string;
    domain: string;
    playId: string | null;
    outcome: string;
    vote: ExperienceVote;
    reasoningTrace: unknown;
  }>
> {
  const rows = await db
    .select()
    .from(autopilotExperiences)
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    moveKind: r.moveKind,
    domain: r.domain,
    playId: r.playId,
    outcome: r.outcome,
    vote: outcomeOf(signalsOf(r)),
    reasoningTrace: r.reasoningTrace,
  }));
}

/**
 * (predicted, actual) pairs for calibration — every experience that carried a
 * forecast AND has since resolved to a real vote. Pure outcomeOf decides actual.
 */
export async function getCalibrationPairs(
  limit = 500,
): Promise<Array<{ predicted: number; actual: 0 | 1 }>> {
  const rows = await db
    .select({
      predictedSuccess: autopilotExperiences.predictedSuccess,
      dispatchSuccess: autopilotExperiences.dispatchSuccess,
      evalScore: autopilotExperiences.evalScore,
      founderVerdict: autopilotExperiences.founderVerdict,
      resolution: autopilotExperiences.resolution,
      satisfaction: autopilotExperiences.satisfaction,
      deliveryBounced: autopilotExperiences.deliveryBounced,
      paymentRecovered: autopilotExperiences.paymentRecovered,
    })
    .from(autopilotExperiences)
    .where(isNotNull(autopilotExperiences.predictedSuccess))
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(limit);
  const pairs: Array<{ predicted: number; actual: 0 | 1 }> = [];
  for (const r of rows) {
    const vote = outcomeOf(signalsOf(r));
    if (vote === "pending") continue;
    pairs.push({ predicted: Number(r.predictedSuccess), actual: vote === "success" ? 1 : 0 });
  }
  return pairs;
}

/** Accrete the dispatch result onto the experience for that dispatch. */
export async function recordDispatchSignal(
  dispatchId: number,
  signal: { dispatchSuccess: boolean; costUsd?: number; evalScore?: number | null },
): Promise<void> {
  try {
    await db
      .update(autopilotExperiences)
      .set({
        dispatchSuccess: signal.dispatchSuccess,
        costUsd: signal.costUsd != null ? String(signal.costUsd) : undefined,
        evalScore: signal.evalScore != null ? String(signal.evalScore) : undefined,
        resolvedAt: new Date(),
      })
      .where(eq(autopilotExperiences.dispatchId, dispatchId));
  } catch (err) {
    logger.warn("[autopilot/experience] dispatch signal accrete failed", err instanceof Error ? err : undefined);
  }
}

/** Accrete the founder's verdict onto the experience for that ask. */
export async function recordFounderVerdict(
  askId: number,
  verdict: "approved" | "declined",
): Promise<void> {
  try {
    await db
      .update(autopilotExperiences)
      .set({ founderVerdict: verdict, resolvedAt: new Date() })
      .where(eq(autopilotExperiences.askId, askId));
  } catch (err) {
    logger.warn("[autopilot/experience] founder verdict accrete failed", err instanceof Error ? err : undefined);
  }
}

/** Recent experiences for a domain (most recent first), for stats + induction. */
export async function getRecentExperiences(
  domain: string,
  limit = 200,
): Promise<AutopilotExperience[]> {
  return db
    .select()
    .from(autopilotExperiences)
    .where(eq(autopilotExperiences.domain, domain))
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(limit);
}

/**
 * Past episodes (situation → action → outcome) for case-based recall. Reads the
 * stored reasoning traces (which carry the senses at decision time) + the
 * resolved vote. Skips rows without a usable trace.
 */
export async function getPastEpisodes(
  limit = 200,
): Promise<Array<{ moveKind: string; vote: ExperienceVote; senses: unknown }>> {
  const rows = await db
    .select()
    .from(autopilotExperiences)
    .where(isNotNull(autopilotExperiences.reasoningTrace))
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(limit);
  const out: Array<{ moveKind: string; vote: ExperienceVote; senses: unknown }> = [];
  for (const r of rows) {
    const trace = r.reasoningTrace as { senses?: unknown } | null;
    if (!trace?.senses) continue;
    out.push({
      moveKind: r.moveKind,
      vote: outcomeOf(signalsOf(r)),
      senses: trace.senses,
    });
  }
  return out;
}

/** Per-play stats for a domain, ready to feed the efficacy model. */
export async function getPlayStats(domain: string): Promise<PlayStats[]> {
  const rows = await db
    .select({
      playId: autopilotExperiences.playId,
      dispatchSuccess: autopilotExperiences.dispatchSuccess,
      evalScore: autopilotExperiences.evalScore,
      founderVerdict: autopilotExperiences.founderVerdict,
      resolution: autopilotExperiences.resolution,
      satisfaction: autopilotExperiences.satisfaction,
      deliveryBounced: autopilotExperiences.deliveryBounced,
      paymentRecovered: autopilotExperiences.paymentRecovered,
    })
    .from(autopilotExperiences)
    .where(and(eq(autopilotExperiences.domain, domain), isNotNull(autopilotExperiences.playId)))
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(500);
  return statsFromExperiences(rows.map((r) => ({ playId: r.playId, ...signalsOf(r) })));
}

/**
 * Set the concrete target this dispatch's action hit (e.g. "invoice:in_123",
 * "email:x@y.com") onto its experience row — the join key a downstream webhook
 * uses to credit the consequence. Called at witnessed execution, where both the
 * dispatchId and the concrete target are known. Best-effort; no-op if no row.
 */
export async function setExperienceTarget(dispatchId: number, targetRef: string): Promise<void> {
  try {
    await db
      .update(autopilotExperiences)
      .set({ targetRef })
      .where(eq(autopilotExperiences.dispatchId, dispatchId));
  } catch (err) {
    logger.warn("[autopilot/experience] target_ref set failed", err instanceof Error ? err : undefined);
  }
}

/**
 * Credit a real downstream CONSEQUENCE onto the experience(s) for a target — the
 * #1 truth fix: the learning loop now learns from what actually happened in the
 * world, not just whether the action mechanically fired. Fired from the webhook
 * that observes the effect (invoice.paid → paymentRecovered; bounce →
 * deliveryBounced). Only autopilot-originated rows carry a target_ref, so this
 * never mis-credits a non-autopilot action. Best-effort; never throws.
 */
export async function recordConsequenceByTarget(
  targetRef: string,
  consequence: { paymentRecovered?: boolean; deliveryBounced?: boolean },
): Promise<number> {
  try {
    const set: Record<string, unknown> = { resolvedAt: new Date() };
    if (consequence.paymentRecovered != null) set.paymentRecovered = consequence.paymentRecovered;
    if (consequence.deliveryBounced != null) set.deliveryBounced = consequence.deliveryBounced;
    const updated = await db
      .update(autopilotExperiences)
      .set(set)
      .where(eq(autopilotExperiences.targetRef, targetRef))
      .returning({ id: autopilotExperiences.id });
    if (updated.length > 0) {
      logger.info("[autopilot/experience] consequence credited", {
        metadata: { targetRef, rows: updated.length, ...consequence },
      });
    }
    return updated.length;
  } catch (err) {
    logger.warn("[autopilot/experience] consequence credit failed", err instanceof Error ? err : undefined);
    return 0;
  }
}
