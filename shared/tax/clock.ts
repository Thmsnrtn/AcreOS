/**
 * The redemption clock for one tax position — V-Tax-1 T2b. Pure.
 *
 * Sale date → redemption expiry → possession / quiet-title gate, with the
 * rule the deadline rests on cited and the countdown visible.
 *
 *   - The deadline is the one on record: computed by AcreOS from an encoded
 *     preliminary rule, or entered by the operator from the county's records
 *     — and it says which. AcreOS never presents a deadline as law.
 *   - Alerts fall at 90, 30 and 7 days before expiry.
 *   - A redeemable deed (or a deed still in its redemption period) carries a
 *     "do not improve, do not market" LOCK until expiry, with the capital it
 *     ties up shown — not a footnote.
 *   - Marketable IN ACREOS only once redemption has expired, the deed is held,
 *     and its quiet-title petition is filed (or an attorney-reviewed exception
 *     is recorded, with its reason). This is the product's gate; it never
 *     declares that title is marketable.
 *   - When the county's procedure object states a redemption period, the
 *     clock checks the deadline against it and flags a mismatch instead of
 *     picking one.
 */

export const ALERT_DAYS = [90, 30, 7] as const;

export type Phase = "redeemable" | "redemption_expired" | "redeemed" | "deed_held" | "cancelled";

export interface ClockInput {
  saleType: "lien" | "deed" | "redeemable_deed";
  status: "active" | "redeemed" | "expired_to_deed" | "deed_obtained" | "cancelled";
  saleDate: string;
  redemptionDeadline: string;
  deadlineSource: "computed_preliminary" | "operator_entered" | null;
  /** In words: what the deadline rests on (rule citation, county record). */
  deadlineBasis: string;
  purchaseAmountCents: number;
  today: string;
  /** The county procedure object's stated redemption period, when recorded. */
  procedurePeriod: { months: number; source: string; asOf: string; version: number } | null;
  quietTitle: { petitionFiledOn: string | null; marketException: { attorneyName: string; reason: string } | null } | null;
}

export interface Clock {
  phase: Phase;
  deadline: string;
  deadlineSource: ClockInput["deadlineSource"];
  deadlineBasis: string;
  /** Days from today to the deadline (negative once passed). */
  daysToDeadline: number;
  alerts: Array<{ daysBefore: number; date: string; reached: boolean }>;
  nextAction: string;
  lock: null | { what: string; until: string; clears: string[] };
  /** The capital tied up until the position resolves. */
  capitalTiedUpCents: number;
  marketable: { eligible: boolean; reason: string };
  procedureCheck: null | { statedMonths: number; source: string; asOf: string; version: number; impliedDeadlineFromSale: string; agrees: boolean };
}

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const addDays = (iso: string, days: number) => new Date((dayNum(iso) + days) * 86_400_000).toISOString().slice(0, 10);
function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

export function redemptionClock(i: ClockInput): Clock {
  const daysToDeadline = dayNum(i.redemptionDeadline) - dayNum(i.today);
  const phase: Phase =
    i.status === "redeemed" ? "redeemed"
      : i.status === "cancelled" ? "cancelled"
        : i.status === "deed_obtained" || i.status === "expired_to_deed" ? "deed_held"
          : daysToDeadline >= 0 ? "redeemable" : "redemption_expired";

  const alerts = ALERT_DAYS.map((n) => {
    const date = addDays(i.redemptionDeadline, -n);
    return { daysBefore: n, date, reached: i.today >= date };
  });

  const petitionFiled = !!i.quietTitle?.petitionFiledOn;
  const exception = i.quietTitle?.marketException ?? null;
  const marketable =
    phase !== "deed_held"
      ? { eligible: false, reason: phase === "redeemable" ? `still redeemable until ${i.redemptionDeadline}` : phase === "redemption_expired" ? "redemption has expired but the deed is not yet recorded as held" : phase === "redeemed" ? "the owner redeemed" : "the certificate was cancelled" }
      : petitionFiled
        ? { eligible: true, reason: `quiet-title petition filed ${i.quietTitle!.petitionFiledOn}` }
        : exception
          ? { eligible: true, reason: `attorney-reviewed exception (${exception.attorneyName}): ${exception.reason}` }
          : { eligible: false, reason: "the quiet-title petition is not yet filed, and no attorney-reviewed exception is recorded" };

  const lock =
    i.saleType === "lien"
      ? phase === "redeemable"
        ? { what: "you hold a lien, not the land — nothing to improve or market", until: i.redemptionDeadline, clears: [`redemption expires ${i.redemptionDeadline} without payment`, "the deed is issued to you", "the quiet-title petition is filed"] }
        : null
      : !marketable.eligible && phase !== "redeemed" && phase !== "cancelled"
        ? { what: "do not improve, do not market", until: phase === "redeemable" ? i.redemptionDeadline : "the quiet-title filing", clears: [...(phase === "redeemable" ? [`redemption expires ${i.redemptionDeadline}`] : []), "the quiet-title petition is filed, or an attorney-reviewed exception is recorded"] }
        : null;

  const nextAction =
    phase === "redeemable"
      ? daysToDeadline <= 7 ? `Redemption expires in ${daysToDeadline} day${daysToDeadline === 1 ? "" : "s"}: confirm with the county whether it has been redeemed.` : `Hold. Next alert ${alerts.find((a) => !a.reached)?.date ?? i.redemptionDeadline}.`
      : phase === "redemption_expired" ? "Redemption has expired: apply for the deed per the county's procedure and record it here."
        : phase === "deed_held" ? (marketable.eligible ? "Eligible to market in AcreOS." : "File the quiet-title petition (or record an attorney-reviewed exception) before marketing.")
          : phase === "redeemed" ? "Redeemed: reconcile the county's payoff against the amount on record." : "Cancelled: confirm the county's refund.";

  let procedureCheck: Clock["procedureCheck"] = null;
  if (i.procedurePeriod) {
    const implied = addMonthsClamped(i.saleDate, i.procedurePeriod.months);
    procedureCheck = { statedMonths: i.procedurePeriod.months, source: i.procedurePeriod.source, asOf: i.procedurePeriod.asOf, version: i.procedurePeriod.version, impliedDeadlineFromSale: implied, agrees: implied === i.redemptionDeadline };
  }

  return {
    phase,
    deadline: i.redemptionDeadline,
    deadlineSource: i.deadlineSource,
    deadlineBasis: i.deadlineBasis,
    daysToDeadline,
    alerts,
    nextAction,
    lock,
    capitalTiedUpCents: phase === "redeemed" || phase === "cancelled" ? 0 : i.purchaseAmountCents,
    marketable,
    procedureCheck,
  };
}
