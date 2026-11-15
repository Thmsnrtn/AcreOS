/**
 * Extend-and-pretend pattern — V-Notes-2 Leg 1. From RECORDED payments only:
 * over a stated window, did payments cover interest without ever reducing
 * principal? The answer is shown as NUMBERS (payments in window, interest
 * received, principal delta, the window's bounds) and labelled a pattern — never
 * a verdict on the borrower.
 *
 * Window: the 180 days ending on the as-of date, inclusive (a day count, not a
 * calendar-month walk, so no second date engine). Fewer than MIN_PAYMENTS
 * interest-bearing payments in the window is "not determinable from recorded
 * payments" — never a clean pass.
 */
import { parseCalendarDate } from "../dates/calendar";

const EXTEND_AND_PRETEND_WINDOW_DAYS = 180;
const MIN_PAYMENTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecordedPayment {
  paymentDate: string;
  principalCents: number;
  interestCents: number;
  paymentType: string;
}

export type ExtendAndPretendCheck =
  | { status: "not_determinable"; reason: string; window: { from: string; to: string }; paymentsInWindow: number }
  | {
      status: "pattern" | "no_pattern";
      window: { from: string; to: string };
      paymentsInWindow: number;
      interestReceivedCents: number;
      principalDeltaCents: number;
      basis: string;
    };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function checkExtendAndPretend(payments: RecordedPayment[], asOf: string): ExtendAndPretendCheck {
  const end = parseCalendarDate(asOf);
  if (!end) throw new Error(`checkExtendAndPretend: unreadable as-of date ${asOf}`);
  const start = new Date(end.getTime() - (EXTEND_AND_PRETEND_WINDOW_DAYS - 1) * DAY_MS);
  const window = { from: iso(start), to: iso(end) };
  const inWindow = payments.filter((p) => {
    const d = parseCalendarDate(p.paymentDate);
    return d !== null && d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
  });
  const interestBearing = inWindow.filter((p) => p.paymentType === "regular" || p.paymentType === "unapplied_apply");
  if (interestBearing.length < MIN_PAYMENTS) {
    return {
      status: "not_determinable",
      reason: `Not determinable from recorded payments: ${interestBearing.length} interest-bearing payment(s) recorded in the window; at least ${MIN_PAYMENTS} are needed.`,
      window,
      paymentsInWindow: inWindow.length,
    };
  }
  const interestReceivedCents = inWindow.reduce((a, p) => a + p.interestCents, 0);
  const principalDeltaCents = inWindow.reduce((a, p) => a + p.principalCents, 0);
  return {
    status: interestReceivedCents > 0 && principalDeltaCents <= 0 ? "pattern" : "no_pattern",
    window,
    paymentsInWindow: inWindow.length,
    interestReceivedCents,
    principalDeltaCents,
    basis: "Recorded payments in the window: interest received is the sum of their interest splits; principal delta is the sum of their principal splits (reversals included).",
  };
}
