// ============================================================================
// server/services/andrei/supportResolverCalibration.ts
// ----------------------------------------------------------------------------
// ANDREI (AI/ML) — close the calibration loop on the ONE path Pax acts on a
// customer unsupervised: the autonomous support resolver
// (server/ai/paxSupportResolver.ts).
//
// THE GAP this closes
//   resolveTicketWithPax() gates an autonomous, customer-facing auto-resolve on
//   the MODEL'S OWN self-reported confidence_score vs a static threshold
//   (60/70/90). It writes that confidence into support_tickets.ai_confidence_score
//   — but until now NOTHING ever read it back against an outcome. No reopen
//   label, no CSAT label. So Pax could auto-send a wrong answer at "70%
//   confidence" forever and calibration never learned. Meanwhile the founder-side
//   calibration engine (services/calibration.ts) only measured founder agents via
//   decisions_inbox_items, and services/andrei/confidenceBand.ts was imported
//   nowhere (dead scaffold).
//
// WHAT THIS MODULE DOES (instrumentation only — the resolver's live behaviour,
// including the auto-resolve THRESHOLD, is unchanged):
//   1. recordSupportResolveDecision() — called from BOTH branches of the
//      resolver (auto-resolve AND escalate) at the decision point. It:
//        • writes a pax_observations-style row carrying the model's STATED
//          confidence + subjectRef=ticketId, tagged path:"support_resolve" so the
//          calibration plot can filter to the autonomous path (mirrors how
//          paxObserver.recordModelObservation writes model-derived rows), and
//        • calls recordBandObservation() (reviving confidenceBand.ts) with
//          wasCorrected=false — the optimistic label the daily grader flips when
//          a later signal proves the auto-resolve wrong.
//   2. gradeAutoResolvedTicket() — the grader entrypoint the reopen/CSAT handlers
//      (and the daily job) call. It flips support_tickets.ai_resolution_outcome
//      to 'reopened' | 'csat_negative' | 'held' and, on a correction, records a
//      corrected band observation so the Brier stream has its labeled negative.
//   3. computeSupportResolverCalibration() — the first REAL labeled stream for a
//      Brier-style calibration measurement, computed directly from the labeled
//      auto-resolved tickets (confidence = ai_confidence_score, "right" =
//      outcome != reopened/csat_negative). Mirrors the math in
//      services/calibration.ts::computeCalibration, which reads a different
//      source (decisions_inbox_items) and therefore could never see this path.
//
// All write paths are fail-soft: calibration instrumentation must NEVER break a
// customer support turn.
// ============================================================================

import { db } from "../../db";
import { supportTickets } from "@shared/schema";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { computeConfidenceBand, recordBandObservation } from "./confidenceBand";

/** The autonomous path tag every support-resolve observation carries. */
export const SUPPORT_RESOLVE_PATH = "support_resolve" as const;

/** Terminal outcome labels for an auto-resolved ticket. */
export type AiResolutionOutcome = "held" | "reopened" | "csat_negative";

/**
 * (reopened | csat_negative) == the auto-resolve was contradicted by reality ==
 * "was corrected" for the Brier label. 'held' (or null) == not corrected.
 */
export function outcomeWasCorrected(outcome: AiResolutionOutcome | null | undefined): boolean {
  return outcome === "reopened" || outcome === "csat_negative";
}

export interface SupportResolveDecision {
  ticketId: number;
  organizationId: number;
  /** The model's STATED confidence for this ticket, 0-100. */
  confidence: number;
  /** Which branch the gate took. */
  decision: "auto_resolve" | "escalate";
  category?: string;
  /** Threshold the confidence was gated against (for the audit trail). */
  threshold?: number;
}

/**
 * Record one autonomous support-resolve DECISION into the calibration loop.
 *
 * Writes a pax_observations row (via paxObserver.recordModelObservation, the
 * model-derived-confidence path) tagged path:"support_resolve" + subjectRef =
 * ticketId, AND a confidence-band observation (wasCorrected=false; the grader
 * flips it). Never throws.
 */
export async function recordSupportResolveDecision(
  d: SupportResolveDecision,
): Promise<void> {
  const subjectRef = `${SUPPORT_RESOLVE_PATH}:${d.ticketId}`;

  // 1. pax_observations row — model-derived confidence on the autonomous path.
  //    recordModelObservation expects modelConfidence in [0,1]; the resolver's
  //    confidence is 0-100, so normalise. It is the model's OWN self-reported
  //    number — exactly the value the gate acted on — so this is honest.
  try {
    const { paxObserver } = await import("../paxObserver");
    await paxObserver.recordModelObservation({
      organizationId: d.organizationId,
      // 'optimization' is the neutral process-quality type (same choice
      // executive.ts uses for its model-quality observations). The semantic
      // weight is in the path tag + outcome label, not the type.
      type: "optimization",
      modelConfidence: Math.max(0, Math.min(1, d.confidence / 100)),
      modelSource: SUPPORT_RESOLVE_PATH,
      severity: "info",
      title:
        d.decision === "auto_resolve"
          ? "Pax auto-resolved a support ticket"
          : "Pax escalated a support ticket",
      description:
        d.decision === "auto_resolve"
          ? `Pax auto-resolved ticket #${d.ticketId} on its own confidence (${d.confidence}%). Outcome will be graded against reopen / CSAT.`
          : `Pax escalated ticket #${d.ticketId} to a human (confidence ${d.confidence}%).`,
      skipBatching: true,
      metadata: {
        source: "pax_support_resolver",
        relatedEntityType: "support_ticket",
        relatedEntityId: d.ticketId,
        dataPoints: {
          // The autonomous-path tag the calibration plot filters on.
          path: SUPPORT_RESOLVE_PATH,
          subjectRef,
          decision: d.decision,
          statedConfidence: d.confidence,
          threshold: d.threshold ?? null,
          category: d.category ?? null,
        },
      },
    });
  } catch (err) {
    logger.warn("[supportResolverCalibration] observation write failed (non-fatal)", {
      metadata: { ticketId: d.ticketId, detail: err instanceof Error ? err.message : String(err) },
    });
  }

  // 2. Revive confidenceBand.ts — record the (band, was-corrected) pair. At the
  //    decision point the auto-resolve is optimistically un-corrected; the daily
  //    grader records the corrected pair when a reopen / CSAT-negative lands.
  try {
    const band = computeConfidenceBand({ confidence: d.confidence });
    recordBandObservation({
      band,
      wasCorrected: false,
      confidence: d.confidence,
      orgId: d.organizationId,
      subjectRef,
    });
  } catch {
    /* best-effort — never block a support turn */
  }
}

/**
 * Grade an auto-resolved ticket: flip its outcome label and, on a correction,
 * record the corrected band observation that gives the Brier stream its first
 * real labeled NEGATIVE.
 *
 * Called by the reopen handler (a customer posting again on an auto-resolved
 * ticket), the CSAT handler (a ≤2★ / thumbs-down rating), and the daily grader.
 * Only ever grades AI-handled, auto-resolved tickets; a no-op otherwise. Never
 * throws — returns false on any miss / error.
 */
export async function gradeAutoResolvedTicket(
  ticketId: number,
  outcome: AiResolutionOutcome,
): Promise<boolean> {
  try {
    const ticket = await db.query.supportTickets.findFirst({
      where: eq(supportTickets.id, ticketId),
    });
    if (!ticket) return false;

    // Only auto-resolved tickets are part of the autonomous-path calibration
    // loop. resolvedBy === 'pax' && aiHandled marks the Pax auto-resolve.
    const wasAutoResolved = ticket.aiHandled === true && ticket.resolvedBy === "pax";
    if (!wasAutoResolved) return false;

    // Idempotent: once a ticket is labeled 'reopened'/'csat_negative' (corrected)
    // we never silently downgrade it back to 'held'. A correction always wins.
    const existing = ticket.aiResolutionOutcome as AiResolutionOutcome | null;
    if (outcomeWasCorrected(existing) && !outcomeWasCorrected(outcome)) {
      return false;
    }

    await db
      .update(supportTickets)
      .set({
        aiResolutionOutcome: outcome,
        aiResolutionReopened: outcome === "reopened" ? true : ticket.aiResolutionReopened ?? false,
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, ticketId));

    // Record the corrected band observation so the Brier stream gets its label.
    if (outcomeWasCorrected(outcome)) {
      try {
        const conf = ticket.aiConfidenceScore != null ? Number(ticket.aiConfidenceScore) : null;
        const band = computeConfidenceBand({ confidence: conf });
        recordBandObservation({
          band,
          wasCorrected: true,
          confidence: conf,
          orgId: ticket.organizationId,
          subjectRef: `${SUPPORT_RESOLVE_PATH}:${ticketId}`,
        });
      } catch {
        /* best-effort */
      }
    }

    logger.info(
      `[supportResolverCalibration] graded auto-resolved ticket #${ticketId} → ${outcome}`,
    );
    return true;
  } catch (err) {
    logger.warn("[supportResolverCalibration] grade failed (non-fatal)", {
      metadata: { ticketId, detail: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}

export interface SupportResolverCalibrationReport {
  path: typeof SUPPORT_RESOLVE_PATH;
  windowDays: number;
  /** Auto-resolved tickets with a confidence score in the window. */
  totalAutoResolved: number;
  /** Of those, how many have been graded (outcome label set). */
  gradedDecisions: number;
  /** Brier score over graded decisions, lower = better. Null if <3 graded. */
  brierScore: number | null;
  /** Positive = overconfident (claims more than it earns). Null if <3 graded. */
  overconfidenceBias: number | null;
  verdict: string;
}

/**
 * Compute Brier-style calibration for the autonomous support-resolve path,
 * directly from the labeled tickets. This is the data the gap analysis said
 * never existed: (stated confidence, was-the-auto-resolve-correct) pairs.
 *
 * "right" = the auto-resolve was NOT corrected (outcome 'held'). reopened /
 * csat_negative = wrong. Ungraded tickets (outcome null) are excluded — we only
 * score decisions reality has labeled. Mirrors the Brier math in
 * services/calibration.ts::computeCalibration (which reads decisions_inbox_items
 * and therefore could never see this path).
 */
export async function computeSupportResolverCalibration(
  windowDays = 60,
): Promise<SupportResolverCalibrationReport> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      confidence: supportTickets.aiConfidenceScore,
      outcome: supportTickets.aiResolutionOutcome,
    })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.aiHandled, true),
        eq(supportTickets.resolvedBy, "pax"),
        isNotNull(supportTickets.aiConfidenceScore),
        gte(supportTickets.resolvedAt, since),
      ),
    );

  const totalAutoResolved = rows.length;
  const pairs: Array<{ confidence: number; right: number }> = [];
  for (const r of rows) {
    if (r.outcome == null) continue; // ungraded — not yet a labeled decision
    const conf = Number(r.confidence);
    if (!Number.isFinite(conf)) continue;
    pairs.push({
      confidence: conf,
      right: outcomeWasCorrected(r.outcome as AiResolutionOutcome) ? 0 : 1,
    });
  }

  const gradedDecisions = pairs.length;
  let brierScore: number | null = null;
  let overconfidenceBias: number | null = null;
  if (pairs.length >= 3) {
    const bs =
      pairs.reduce((s, p) => {
        const diff = p.confidence / 100 - p.right;
        return s + diff * diff;
      }, 0) / pairs.length;
    brierScore = Math.round(bs * 1000) / 1000;
    const meanConf = pairs.reduce((s, p) => s + p.confidence, 0) / pairs.length;
    const meanRight = (pairs.reduce((s, p) => s + p.right, 0) / pairs.length) * 100;
    overconfidenceBias = Math.round((meanConf - meanRight) * 10) / 10;
  }

  return {
    path: SUPPORT_RESOLVE_PATH,
    windowDays,
    totalAutoResolved,
    gradedDecisions,
    brierScore,
    overconfidenceBias,
    verdict: buildVerdict(brierScore, overconfidenceBias, gradedDecisions),
  };
}

function buildVerdict(brier: number | null, bias: number | null, graded: number): string {
  if (graded < 3) return "Not enough graded auto-resolves to score the support-resolve path yet.";
  if (brier == null) return "Support-resolve calibration not computable.";
  const biasWord =
    bias == null ? "" : bias > 10 ? " — overconfident" : bias < -10 ? " — underconfident" : "";
  if (brier < 0.1) return "Excellent calibration on the autonomous support path.";
  if (brier < 0.2) return `Good calibration on the autonomous support path${biasWord}.`;
  if (brier < 0.3)
    return `Mediocre calibration on the autonomous support path${biasWord}. Consider raising the auto-resolve threshold.`;
  return `Poor calibration on the autonomous support path${biasWord}. Auto-resolve confidence is unreliable; review the threshold.`;
}

/**
 * Daily grader entrypoint. Computes the support-resolve calibration report and
 * logs it (so the Brier number is produced regularly even when no reopen/CSAT
 * handler fired). The per-event grading happens in the handlers via
 * gradeAutoResolvedTicket(); this job is the rollup + a backstop that ages
 * still-unobserved auto-resolves to 'held' once they're old enough that a
 * reopen is unlikely. Returns the number of tickets aged to 'held'.
 */
export async function runSupportResolverCalibrationGrader(opts: {
  /** Auto-resolves older than this (days) with no correction are deemed 'held'. */
  holdAfterDays?: number;
  windowDays?: number;
} = {}): Promise<number> {
  const holdAfterDays = opts.holdAfterDays ?? 7;
  const cutoff = new Date(Date.now() - holdAfterDays * 24 * 60 * 60 * 1000);

  // Backstop: any auto-resolved ticket older than the hold window that still has
  // no outcome label is presumed to have HELD (the customer didn't come back).
  let aged = 0;
  try {
    const result = await db
      .update(supportTickets)
      .set({ aiResolutionOutcome: "held", updatedAt: new Date() })
      .where(
        and(
          eq(supportTickets.aiHandled, true),
          eq(supportTickets.resolvedBy, "pax"),
          isNotNull(supportTickets.aiConfidenceScore),
          sql`${supportTickets.aiResolutionOutcome} IS NULL`,
          sql`${supportTickets.resolvedAt} < ${cutoff}`,
        ),
      )
      .returning({ id: supportTickets.id });
    aged = result.length;
  } catch (err) {
    logger.warn("[supportResolverCalibration] grader aging pass failed (non-fatal)", {
      metadata: { detail: err instanceof Error ? err.message : String(err) },
    });
  }

  try {
    const report = await computeSupportResolverCalibration(opts.windowDays ?? 60);
    logger.info(
      `[supportResolverCalibration] grader: aged=${aged} to held; ` +
        `graded=${report.gradedDecisions}/${report.totalAutoResolved} brier=${report.brierScore ?? "n/a"} ` +
        `bias=${report.overconfidenceBias ?? "n/a"} — ${report.verdict}`,
    );

    // Tier 1D (alert spine): a FAILING calibration grade used to be a log
    // line nobody reads. Brier ≥ 0.3 is the "Poor calibration" verdict —
    // Pax's auto-resolve confidence is unreliable while it keeps acting on
    // customers unsupervised. Raise it as a warning (finding + system_alerts).
    if (report.brierScore != null && report.brierScore >= 0.3) {
      try {
        const { raiseAlert } = await import("../alertSpine");
        await raiseAlert({
          severity: "warning",
          source: "support_resolver_calibration",
          title: "Pax support auto-resolve calibration is FAILING",
          detail:
            `Brier=${report.brierScore} over ${report.gradedDecisions} graded decisions ` +
            `(overconfidence bias ${report.overconfidenceBias ?? "n/a"}). ${report.verdict}`,
          dedupeKey: "calibration:poor",
          domain: "ai",
          citedReason:
            "The autonomous support-resolve path must stay calibrated; unreliable confidence means Pax acts on customers it shouldn't.",
          alertType: "ai_calibration_failing",
          metadata: {
            brierScore: report.brierScore,
            overconfidenceBias: report.overconfidenceBias,
            gradedDecisions: report.gradedDecisions,
            windowDays: report.windowDays,
          },
        });
      } catch (alertErr) {
        logger.warn("[supportResolverCalibration] alert spine raise failed (non-fatal)", {
          metadata: { detail: alertErr instanceof Error ? alertErr.message : String(alertErr) },
        });
      }
    }
  } catch (err) {
    logger.warn("[supportResolverCalibration] grader report failed (non-fatal)", {
      metadata: { detail: err instanceof Error ? err.message : String(err) },
    });
  }

  return aged;
}
