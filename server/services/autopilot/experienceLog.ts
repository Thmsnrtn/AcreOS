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
    })
    .returning({ id: autopilotExperiences.id });
  return row?.id ?? 0;
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
    })
    .from(autopilotExperiences)
    .where(isNotNull(autopilotExperiences.predictedSuccess))
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(limit);
  const pairs: Array<{ predicted: number; actual: 0 | 1 }> = [];
  for (const r of rows) {
    const vote = outcomeOf({
      dispatchSuccess: r.dispatchSuccess,
      evalScore: r.evalScore != null ? Number(r.evalScore) : null,
      founderVerdict: r.founderVerdict,
      resolution: r.resolution,
      satisfaction: r.satisfaction,
    });
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
    })
    .from(autopilotExperiences)
    .where(and(eq(autopilotExperiences.domain, domain), isNotNull(autopilotExperiences.playId)))
    .orderBy(desc(autopilotExperiences.createdAt))
    .limit(500);
  return statsFromExperiences(
    rows.map((r) => ({
      playId: r.playId,
      dispatchSuccess: r.dispatchSuccess,
      evalScore: r.evalScore != null ? Number(r.evalScore) : null,
      founderVerdict: r.founderVerdict,
      resolution: r.resolution,
      satisfaction: r.satisfaction,
    })),
  );
}
