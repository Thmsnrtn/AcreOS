/**
 * Horizon A1 — the outcome ledger.
 *
 * Every consequential decision carries a PREDICTION at creation
 * (expectedOutcome + checkInDate on decisions_inbox_items), and the
 * prediction is scored against REALITY at the 30/90-day check-in —
 * never against a heuristic's guess at day 3.
 *
 * Two scoring paths, chosen by whether the prediction is machine-checkable:
 *
 *   machineCheck present  → scoreDueCheckIns evaluates the stored criterion
 *                           against real data. Pass → +2. Fail → -1 (the
 *                           intervention didn't hold, but causality is
 *                           uncertain — a machine check alone never awards
 *                           -2). actualOutcome states exactly what was
 *                           checked and what was found.
 *   no machineCheck       → a judgment call. The ledger raises ONE founder
 *                           check-in card (itemType outcome_check_in,
 *                           Class B) with the fixed 5-point scale; the
 *                           founder's answer is written back to the
 *                           ORIGINAL row. "Too soon to tell" pushes the
 *                           check-in forward 30 days without scoring.
 *
 * OWNERSHIP SPLIT with autonomyHealth.gradeRecentDecisions: the legacy
 * grader scores items at 3-7 days via recurrence HEURISTICS. It now skips
 * any item with a checkInDate — the ledger owns prediction-bearing items.
 * Legacy items without predictions keep the old behavior.
 *
 * CONSTITUTIONAL HONESTY: an unscored outcome stays unscored and is
 * reported as unscored. No score is ever invented, no prediction is ever
 * defaulted retroactively, and a criterion that cannot be evaluated
 * (missing anchor date, unknown check kind) leaves the row untouched.
 *
 * Reads re-apply their filters in process so unit tests pin the arithmetic
 * independent of the SQL layer; the WHERE clauses keep production scans
 * cheap (mirrors the tickMetric / getSuppressedDefects convention).
 */

import { db } from "../db";
import { decisionsInboxItems, organizations } from "@shared/schema";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { logger } from "../utils/logger";

// ─── Prediction types ────────────────────────────────────────────────────────

/**
 * An automatically-verifiable criterion, stored verbatim at
 * contextBundle.outcomePrediction.machineCheck when the prediction is made.
 */
export type MachineCheck =
  | { kind: "no_recurrence"; itemType: string; organizationId: number | null }
  | { kind: "churn_retained"; organizationId: number }
  | { kind: "dunning_recovered"; organizationId: number };

/** A prediction: what will be true if this was the right call. */
export interface OutcomePrediction {
  expectedOutcome: string;
  checkInDays: 30 | 90;
  machineCheck?: MachineCheck;
}

/** Column + contextBundle values a creator writes at insert time. */
export interface PredictionColumns {
  expectedOutcome: string;
  checkInDate: Date;
  /** Stored at contextBundle.outcomePrediction. */
  outcomePrediction: { checkInDays: 30 | 90; machineCheck?: MachineCheck };
}

/**
 * The fixed 5-point founder check-in scale. Keys are the card's
 * contextBundle.options keys; scores are applied by applyCheckInAnswer.
 */
export const OUTCOME_CHECK_IN_OPTIONS = [
  { key: "right_call", label: "Right call", score: 2 },
  { key: "mostly_right", label: "Mostly right", score: 1 },
  { key: "too_soon", label: "Too soon to tell", score: 0 },
  { key: "didnt_help", label: "Didn't help", score: -1 },
  { key: "wrong_call", label: "Wrong call", score: -2 },
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOO_SOON_PUSH_DAYS = 30;
const LEDGER_WINDOW_DAYS = 90;

// ─── 1. Predictions at creation ─────────────────────────────────────────────

/**
 * Judgment-call default: no machine check exists, so the expectedOutcome
 * text claims nothing it cannot verify.
 */
function judgmentPrediction(checkInDays: 30 | 90): OutcomePrediction {
  return {
    expectedOutcome: "Judgment call — founder will assess at check-in.",
    checkInDays,
  };
}

/**
 * Honest per-itemType defaults. expectedOutcome states ONLY what the
 * machineCheck actually checks — never invented specifics.
 */
function defaultPrediction(
  itemType: string,
  organizationId: number | null,
): OutcomePrediction | null {
  switch (itemType) {
    case "support_escalation":
      return {
        expectedOutcome:
          organizationId != null
            ? "No new support_escalation item for this organization in the 30 days after resolution (machine-checked: no_recurrence)."
            : "No new support_escalation item platform-wide in the 30 days after resolution (no organization attached; machine-checked: no_recurrence).",
        checkInDays: 30,
        machineCheck: { kind: "no_recurrence", itemType: "support_escalation", organizationId },
      };
    case "churn_risk_intervention":
      // Can't machine-check retention without an org — honest downgrade to
      // a founder judgment call rather than a criterion that can't run.
      if (organizationId == null) return judgmentPrediction(90);
      return {
        expectedOutcome:
          'Organization subscription still active and not on the free tier at the 90-day check-in (machine-checked: churn_retained).',
        checkInDays: 90,
        machineCheck: { kind: "churn_retained", organizationId },
      };
    case "dunning_recovery":
      if (organizationId == null) return judgmentPrediction(30);
      return {
        expectedOutcome:
          'Organization dunning stage back to "none" at the 30-day check-in (machine-checked: dunning_recovered).',
        checkInDays: 30,
        machineCheck: { kind: "dunning_recovered", organizationId },
      };
    case "critical_alert":
    case "feature_request_flagged":
      return judgmentPrediction(30);
    default:
      // No default for this itemType — the caller may still pass an
      // explicit prediction; otherwise the item honestly carries none.
      return null;
  }
}

/**
 * Resolve the prediction for a new inbox item. An explicit caller
 * prediction overrides the per-itemType default. Returns null when the
 * itemType has no default and no explicit prediction was given — the item
 * then carries NO prediction (never a fabricated one).
 */
export function attachPrediction(item: {
  itemType: string;
  organizationId?: number | null;
  prediction?: OutcomePrediction;
  now?: Date;
}): PredictionColumns | null {
  const prediction =
    item.prediction ?? defaultPrediction(item.itemType, item.organizationId ?? null);
  if (!prediction) return null;
  const now = item.now ?? new Date();
  return {
    expectedOutcome: prediction.expectedOutcome,
    checkInDate: new Date(now.getTime() + prediction.checkInDays * DAY_MS),
    outcomePrediction: {
      checkInDays: prediction.checkInDays,
      ...(prediction.machineCheck ? { machineCheck: prediction.machineCheck } : {}),
    },
  };
}

/** Read the stored machineCheck descriptor off a row, if any. */
function readMachineCheck(contextBundle: Record<string, any> | null): MachineCheck | null {
  const mc = contextBundle?.outcomePrediction?.machineCheck;
  if (!mc || typeof mc.kind !== "string") return null;
  return mc as MachineCheck;
}

// ─── 2. The 30/90-day scorer ────────────────────────────────────────────────

export interface ScoreDueCheckInsResult {
  due: number;
  machineScored: number;
  machinePassed: number;
  machineFailed: number;
  checkInsCreated: number;
  checkInsDeduped: number;
  /** Criteria that could not be evaluated — left honestly unscored. */
  skipped: number;
}

/**
 * Daily entry point (12:00 UTC job). Scores every resolved item whose
 * check-in date has arrived and that is still unscored: machine checks are
 * evaluated against real data; judgment calls raise one founder check-in
 * card. Items whose criterion cannot be evaluated stay unscored.
 */
export async function scoreDueCheckIns(
  now: Date = new Date(),
  limit = 50,
): Promise<ScoreDueCheckInsResult> {
  const rows = await db
    .select()
    .from(decisionsInboxItems)
    .where(
      and(
        inArray(decisionsInboxItems.status, ["approved", "rejected"]),
        isNotNull(decisionsInboxItems.checkInDate),
        lte(decisionsInboxItems.checkInDate, now),
        isNull(decisionsInboxItems.outcomeScore),
        // The ledger's own instrument is never itself ledger-scored.
        ne(decisionsInboxItems.itemType, "outcome_check_in"),
      ),
    )
    .orderBy(asc(decisionsInboxItems.checkInDate))
    .limit(limit);

  const due = rows
    .filter(
      (r) =>
        (r.status === "approved" || r.status === "rejected") &&
        r.checkInDate != null &&
        r.checkInDate.getTime() <= now.getTime() &&
        r.outcomeScore == null &&
        r.itemType !== "outcome_check_in",
    )
    .slice(0, limit);

  const result: ScoreDueCheckInsResult = {
    due: due.length,
    machineScored: 0,
    machinePassed: 0,
    machineFailed: 0,
    checkInsCreated: 0,
    checkInsDeduped: 0,
    skipped: 0,
  };

  for (const row of due) {
    const machineCheck = readMachineCheck(row.contextBundle);
    if (machineCheck) {
      const evaluation = await evaluateMachineCheck(machineCheck, row, now);
      if (!evaluation) {
        // Criterion could not be evaluated — the row stays unscored.
        result.skipped++;
        continue;
      }
      await writeOutcome(row, evaluation.pass ? 2 : -1, evaluation.actualOutcome, now);
      result.machineScored++;
      if (evaluation.pass) result.machinePassed++;
      else result.machineFailed++;
    } else {
      // Judgment call — one open founder check-in card, deduped.
      // Dynamic import: decisionsInbox statically imports this module.
      const { decisionsInboxService } = await import("./decisionsInbox");
      const { created } = await decisionsInboxService.createOutcomeCheckIn({
        id: row.id,
        itemType: row.itemType,
        organizationId: row.organizationId,
        ownerAgentCodename: row.ownerAgentCodename,
        recommendedActionLabel: row.recommendedActionLabel,
        expectedOutcome: row.expectedOutcome,
        resolvedAt: row.resolvedAt,
      });
      if (created) result.checkInsCreated++;
      else result.checkInsDeduped++;
    }
  }

  if (result.due > 0) {
    logger.info("[outcomeLedger] check-in pass complete", { metadata: { ...result } });
  }
  return result;
}

/**
 * Evaluate a machine check against real data. Returns null when the
 * criterion cannot be evaluated (missing anchor date, unknown kind) — the
 * caller leaves the row unscored. actualOutcome always states exactly what
 * was checked and what was found.
 */
async function evaluateMachineCheck(
  mc: MachineCheck,
  row: typeof decisionsInboxItems.$inferSelect,
  now: Date,
): Promise<{ pass: boolean; actualOutcome: string } | null> {
  switch (mc.kind) {
    case "no_recurrence": {
      const since = row.resolvedAt ?? row.createdAt;
      if (!since) return null; // no honest anchor for the recurrence window
      const conditions = [
        eq(decisionsInboxItems.itemType, mc.itemType),
        gte(decisionsInboxItems.createdAt, since),
      ];
      if (mc.organizationId != null) {
        conditions.push(eq(decisionsInboxItems.organizationId, mc.organizationId));
      }
      const candidates = await db
        .select({
          id: decisionsInboxItems.id,
          itemType: decisionsInboxItems.itemType,
          organizationId: decisionsInboxItems.organizationId,
          createdAt: decisionsInboxItems.createdAt,
        })
        .from(decisionsInboxItems)
        .where(and(...conditions));
      const recurrences = candidates.filter(
        (c) =>
          c.id !== row.id &&
          c.itemType === mc.itemType &&
          c.createdAt != null &&
          c.createdAt.getTime() >= since.getTime() &&
          c.createdAt.getTime() <= now.getTime() &&
          (mc.organizationId == null || c.organizationId === mc.organizationId),
      );
      const scope =
        mc.organizationId != null
          ? `for organization #${mc.organizationId}`
          : "platform-wide (no organization attached)";
      return recurrences.length === 0
        ? {
            pass: true,
            actualOutcome: `Machine check no_recurrence: 0 new ${mc.itemType} items ${scope} between resolution and check-in — the intervention held.`,
          }
        : {
            pass: false,
            actualOutcome: `Machine check no_recurrence: ${recurrences.length} new ${mc.itemType} item${recurrences.length === 1 ? "" : "s"} ${scope} since resolution — the intervention did not hold (causality uncertain).`,
          };
    }
    case "churn_retained": {
      const org = await fetchOrg(mc.organizationId);
      if (!org) {
        return {
          pass: false,
          actualOutcome: `Machine check churn_retained: organization #${mc.organizationId} no longer found at check-in — not retained (causality uncertain).`,
        };
      }
      const retained =
        org.subscriptionStatus === "active" && org.subscriptionTier !== "free";
      const found = `subscription status "${org.subscriptionStatus}", tier "${org.subscriptionTier}" at check-in`;
      return retained
        ? { pass: true, actualOutcome: `Machine check churn_retained: ${found} — customer retained.` }
        : {
            pass: false,
            actualOutcome: `Machine check churn_retained: ${found} — not retained (causality uncertain).`,
          };
    }
    case "dunning_recovered": {
      const org = await fetchOrg(mc.organizationId);
      if (!org) {
        return {
          pass: false,
          actualOutcome: `Machine check dunning_recovered: organization #${mc.organizationId} no longer found at check-in — not recovered (causality uncertain).`,
        };
      }
      // dunning_stage defaults to "none"; a null reads as no dunning state.
      const stage = org.dunningStage ?? "none";
      return stage === "none"
        ? {
            pass: true,
            actualOutcome: `Machine check dunning_recovered: dunning stage "${stage}" at check-in — recovered.`,
          }
        : {
            pass: false,
            actualOutcome: `Machine check dunning_recovered: dunning stage "${stage}" at check-in — not recovered (causality uncertain).`,
          };
    }
    default: {
      logger.warn("[outcomeLedger] unknown machineCheck kind — leaving unscored", {
        metadata: { itemId: row.id, kind: (mc as { kind?: string }).kind },
      });
      return null;
    }
  }
}

async function fetchOrg(organizationId: number) {
  const rows = await db
    .select({
      id: organizations.id,
      subscriptionStatus: organizations.subscriptionStatus,
      subscriptionTier: organizations.subscriptionTier,
      dunningStage: organizations.dunningStage,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return rows.find((o) => o.id === organizationId) ?? null;
}

/**
 * Write a scored outcome to a row and mirror it into the decision-
 * experiments rollup (same best-effort seam gradeRecentDecisions uses, so
 * ledger-owned items don't vanish from per-variant results).
 */
async function writeOutcome(
  row: { id: number; organizationId: number | null; itemType: string },
  score: number,
  actualOutcome: string,
  now: Date,
): Promise<void> {
  await db
    .update(decisionsInboxItems)
    .set({
      outcomeScore: score,
      actualOutcome,
      outcomeRecordedAt: now,
      updatedAt: now,
    })
    .where(eq(decisionsInboxItems.id, row.id));

  if (row.organizationId != null) {
    try {
      const { recordExperimentOutcome } = await import("./decisionExperiments");
      await recordExperimentOutcome(row.organizationId, row.itemType, score);
    } catch {
      // best-effort
    }
  }
}

// ─── Founder check-in answers ───────────────────────────────────────────────

export interface CheckInAnswerResult {
  applied: "scored" | "deferred" | "skipped";
  originalItemId: number | null;
  score: number | null;
}

/**
 * Apply a founder's tap on an outcome_check_in card to the ORIGINAL
 * decision row. Called by the approve/override routes BEFORE the card
 * itself resolves, so a partial failure can be retapped (the write is
 * first-answer-wins: an already-scored original is never overwritten).
 *
 * "Too soon to tell" (score 0) pushes the original checkInDate 30 days
 * from NOW — not from the stale due date, which could be far enough in
 * the past to re-ask immediately — and writes NO score.
 */
export async function applyCheckInAnswer(params: {
  checkInItem: { id: number; contextBundle: Record<string, any> | null };
  optionKey: string;
  now?: Date;
}): Promise<CheckInAnswerResult> {
  const now = params.now ?? new Date();
  const option = OUTCOME_CHECK_IN_OPTIONS.find((o) => o.key === params.optionKey);
  if (!option) {
    // The route validates keys against the stored options; an unknown key
    // here is a programming error, never a founder input to guess at.
    throw new Error(`[outcomeLedger] unknown check-in option key: ${params.optionKey}`);
  }
  const originalItemId = Number(params.checkInItem.contextBundle?.outcomeCheckInFor);
  if (!Number.isInteger(originalItemId)) {
    throw new Error(
      `[outcomeLedger] check-in card #${params.checkInItem.id} carries no outcomeCheckInFor`,
    );
  }

  const rows = await db
    .select()
    .from(decisionsInboxItems)
    .where(eq(decisionsInboxItems.id, originalItemId))
    .limit(1);
  const original = rows.find((r) => r.id === originalItemId);
  if (!original) {
    logger.warn("[outcomeLedger] original item missing for check-in answer — nothing to score", {
      metadata: { checkInItemId: params.checkInItem.id, originalItemId },
    });
    return { applied: "skipped", originalItemId, score: null };
  }

  if (option.score === 0) {
    await db
      .update(decisionsInboxItems)
      .set({
        checkInDate: new Date(now.getTime() + TOO_SOON_PUSH_DAYS * DAY_MS),
        updatedAt: now,
      })
      .where(eq(decisionsInboxItems.id, originalItemId));
    return { applied: "deferred", originalItemId, score: null };
  }

  if (original.outcomeScore != null) {
    logger.warn("[outcomeLedger] original already scored — first answer wins, skipping", {
      metadata: { originalItemId, existingScore: original.outcomeScore },
    });
    return { applied: "skipped", originalItemId, score: original.outcomeScore };
  }

  const signed = `${option.score > 0 ? "+" : ""}${option.score}`;
  await writeOutcome(
    original,
    option.score,
    `Founder scored this decision at check-in: "${option.label}" (${signed}).`,
    now,
  );
  return { applied: "scored", originalItemId, score: option.score };
}

// ─── 3. Ledger counts for the tick / the Letter ─────────────────────────────

export interface OutcomeLedgerCounts {
  /** Prediction-bearing items with a recorded outcome. */
  scored: number;
  /** Of the scored, outcomeScore >= 1. */
  positive: number;
  /** Unscored, check-in still in the future. */
  pending: number;
  /** Unscored, check-in date passed — honestly overdue, never backfilled. */
  overdue: number;
}

/**
 * Metric (d): outcome-ledger counts over predictions MADE in the trailing
 * 90 days (rows carrying a checkInDate). Honest zeros — if nothing carries
 * a prediction yet, every count is 0.
 */
export async function getOutcomeLedgerCounts(now: Date = new Date()): Promise<OutcomeLedgerCounts> {
  const windowStart = new Date(now.getTime() - LEDGER_WINDOW_DAYS * DAY_MS);
  const rows = await db
    .select({
      createdAt: decisionsInboxItems.createdAt,
      checkInDate: decisionsInboxItems.checkInDate,
      outcomeScore: decisionsInboxItems.outcomeScore,
      outcomeRecordedAt: decisionsInboxItems.outcomeRecordedAt,
    })
    .from(decisionsInboxItems)
    .where(
      and(
        isNotNull(decisionsInboxItems.checkInDate),
        gte(decisionsInboxItems.createdAt, windowStart),
      ),
    );

  const inWindow = rows.filter(
    (r) =>
      r.checkInDate != null &&
      r.createdAt != null &&
      r.createdAt.getTime() >= windowStart.getTime() &&
      r.createdAt.getTime() <= now.getTime(),
  );

  const scoredRows = inWindow.filter((r) => r.outcomeRecordedAt != null);
  const unscored = inWindow.filter((r) => r.outcomeRecordedAt == null);
  return {
    scored: scoredRows.length,
    positive: scoredRows.filter((r) => (r.outcomeScore ?? 0) >= 1).length,
    pending: unscored.filter((r) => r.checkInDate!.getTime() > now.getTime()).length,
    overdue: unscored.filter((r) => r.checkInDate!.getTime() <= now.getTime()).length,
  };
}
