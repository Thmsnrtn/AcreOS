/**
 * Founder Autopilot — outward perception bus (Hands roadmap P0.2).
 *
 * Today the brain's senses (senses.ts, decide.ts) read AcreOS's own DB. It is
 * blind to the outside world it is supposed to operate in. This module turns
 * the webhooks that ALREADY land — SendGrid deliverability events, Stripe
 * revenue/churn events, inbound SMS opt-outs — into append-only `autopilot_senses`
 * rows the brain can perceive.
 *
 * Two honesty rules, both load-bearing:
 *   1. recordSense is BEST-EFFORT and never throws. A sense write can never
 *      break a payment webhook or an email-event ingest. Callers wrap it in
 *      `void recordSense(...)` and move on.
 *   2. The aggregation is PURE (aggregateSenses) and never invents a value. A
 *      kind with no observations in the window is simply absent — the brain
 *      doesn't act on a sense it doesn't have.
 *
 * No credential/PII values ever go in `detail` (constitution: credential value
 * handling). Detail carries ids, counts, and classifications only.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { autopilotSenses, type AutopilotSense } from "@shared/schema";
import { logger } from "../../utils/logger";

/** The sense channels the perception bus understands. Extend as emitters land. */
export type SenseKind =
  | "email_complaint" // a recipient marked spam — deliverability risk
  | "email_bounce" // hard/soft bounce — list health
  | "revenue_delta" // MRR change in cents (signed)
  | "dunning_pressure" // a payment failed — recovery opportunity
  | "payment_recovered" // a previously-failed invoice paid — dunning win
  | "churn_signal" // a subscription cancelled / dispute opened
  | "sms_opt_out" // an inbound STOP — outbound suppression signal
  | "trial_ending" // a trial is about to end — conversion window
  // Jarvis 2.1 (audit G2) — note-vertical payment schedule, recorded as
  // aggregate COUNTS by the daily notePaymentDueDetector scan (never per-
  // borrower rows; constitutional: counts only, no customer PII).
  | "note_payment_due_soon" // borrower payments due within the next 7 days
  | "note_payment_overdue"; // borrower payments past their due date

/**
 * Record one outward observation. Best-effort: swallows all errors so it can be
 * safely fired from inside a webhook handler's success path. Returns true if the
 * row was written, false if it was swallowed.
 */
export async function recordSense(
  kind: SenseKind,
  value: number,
  detail?: Record<string, unknown>,
): Promise<boolean> {
  try {
    if (!Number.isFinite(value)) return false;
    await db.insert(autopilotSenses).values({
      kind,
      value,
      detail: detail ?? null,
    });
    return true;
  } catch (err) {
    logger.warn(
      "[autopilot/perception] sense write failed (swallowed)",
      err instanceof Error ? err : undefined,
    );
    return false;
  }
}

/** One aggregated sense channel over the read window. */
export interface AggregatedSense {
  kind: string;
  /** Number of observations in the window. */
  count: number;
  /** Sum of values (e.g. total revenue delta, total bounces). */
  sum: number;
  /** Most recent value. */
  latest: number;
  /** When the most recent observation landed. */
  latestAt: Date | null;
}

/**
 * Pure aggregation of raw sense rows → per-kind summary. Deterministic + total;
 * unit-testable without a DB. Rows are assumed newest-first (the read orders by
 * observed_at desc), so the first row seen per kind is the latest.
 */
export function aggregateSenses(
  rows: Array<Pick<AutopilotSense, "kind" | "value" | "observedAt">>,
): Map<string, AggregatedSense> {
  const out = new Map<string, AggregatedSense>();
  for (const r of rows) {
    const v = Number(r.value) || 0;
    const cur = out.get(r.kind);
    if (!cur) {
      out.set(r.kind, { kind: r.kind, count: 1, sum: v, latest: v, latestAt: r.observedAt ?? null });
    } else {
      cur.count += 1;
      cur.sum += v;
      // rows are newest-first → don't overwrite latest with older rows
    }
  }
  return out;
}

/**
 * Read + aggregate the outward senses observed within the last `windowHours`.
 * Best-effort: returns an empty map on any failure (honest "none known").
 */
export async function readOutwardSenses(windowHours = 24): Promise<Map<string, AggregatedSense>> {
  try {
    const rows = await db
      .select({ kind: autopilotSenses.kind, value: autopilotSenses.value, observedAt: autopilotSenses.observedAt })
      .from(autopilotSenses)
      .where(sql`${autopilotSenses.observedAt} > now() - (${windowHours} || ' hours')::interval`)
      .orderBy(sql`${autopilotSenses.observedAt} desc`)
      .limit(2000);
    return aggregateSenses(rows);
  } catch (err) {
    logger.warn(
      "[autopilot/perception] outward sense read failed; defaulting to none",
      err instanceof Error ? err : undefined,
    );
    return new Map();
  }
}

/**
 * Derive the brain-facing outward signal summary from aggregated senses. Pure.
 * Every field defaults to the honest zero so an unwired/quiet channel never
 * fabricates pressure. This is the shape decide.ts consumes.
 */
export interface OutwardSignal {
  /** Net MRR change (cents) observed in the window. */
  revenueDeltaCents: number;
  /** Count of failed-payment events awaiting recovery. */
  dunningPressure: number;
  /** Count of churn signals (cancellations / disputes). */
  churnSignals: number;
  /** Count of spam complaints — deliverability is at risk above 0. */
  emailComplaints: number;
  /** Count of inbound opt-outs. */
  smsOptOuts: number;
  /** Count of trials entering their closing window. */
  trialsEnding: number;
  /** Note-vertical borrower payments due within 7 days (Jarvis 2.1). */
  notePaymentsDueSoon: number;
  /** Note-vertical borrower payments past due (Jarvis 2.1). */
  notePaymentsOverdue: number;
}

export function outwardSignalFrom(agg: Map<string, AggregatedSense>): OutwardSignal {
  const sum = (k: SenseKind) => agg.get(k)?.sum ?? 0;
  const count = (k: SenseKind) => agg.get(k)?.count ?? 0;
  // Snapshot senses: the emitter records the CURRENT total each run, so the
  // newest observation is the truth — summing runs would double-count.
  const latest = (k: SenseKind) => agg.get(k)?.latest ?? 0;
  return {
    revenueDeltaCents: sum("revenue_delta"),
    dunningPressure: count("dunning_pressure"),
    churnSignals: count("churn_signal"),
    emailComplaints: count("email_complaint"),
    smsOptOuts: count("sms_opt_out"),
    trialsEnding: count("trial_ending"),
    notePaymentsDueSoon: latest("note_payment_due_soon"),
    notePaymentsOverdue: latest("note_payment_overdue"),
  };
}
