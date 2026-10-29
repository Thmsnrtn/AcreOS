/**
 * The certificate / deed ledger for one position — V-Tax-1 T3b. Pure.
 *
 * Lien amount, rate, redemption deadline, subsequent taxes paid, interest
 * accrual, redemption notices and the foreclosure-filing deadline, each with
 * what it rests on.
 *
 *   - Subsequent taxes the operator paid are recorded facts (amount, year,
 *     date, receipt). Whether they are reimbursed on redemption, and with what
 *     interest, is the county procedure's subsequent-tax rule: shown with its
 *     source, never added into the redemption amount by AcreOS.
 *   - Interest accrues only where AcreOS has an encoded rule for the state,
 *     and covers the certificate amount only; otherwise it is "not computed",
 *     with why.
 *   - A redemption notice is a record of a notice the OPERATOR sent, outside
 *     AcreOS. AcreOS sends nothing.
 *   - The foreclosure-filing deadline is stated with its source (the county
 *     procedure or the county's record). There is no national default: with
 *     none stated, it says so.
 */

export interface LedgerEvent {
  eventType: "redemption_expiry" | "quiet_title_filed" | "subsequent_tax_paid" | "redemption_notice_recorded" | "foreclosure_filing_deadline";
  eventDate: string;
  ruleCited: { kind: string; source?: string; [k: string]: unknown };
  detail: Record<string, unknown>;
  recordedBy: string;
  recordedAt: string;
}

export interface LedgerInput {
  purchaseAmountCents: number;
  bidDownRateBps: number | null;
  redemptionDeadline: string;
  deadlineBasis: string;
  interest: { interestCents: number | null; asOfDate: string; refusalReason: string | null; preliminary: boolean };
  /** The county procedure's subsequent-tax rule, if one is recorded. */
  subsequentTaxRule: { value: string; source: string; asOf: string; version: number } | null;
  events: LedgerEvent[];
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sourceOf = (e: LedgerEvent) => (typeof e.ruleCited.source === "string" ? e.ruleCited.source : "source not recorded");

export interface CertificateLedger {
  lienAmount: { amountCents: number; basis: string };
  rate: { text: string };
  redemptionDeadline: { date: string; basis: string };
  subsequentTaxes: {
    payments: Array<{ paidOn: string; taxYear: string | null; amountCents: number; source: string }>;
    totalCents: number;
    reimbursement: { status: "stated"; text: string } | { status: "not_stated"; why: string };
  };
  interest: { status: "computed"; text: string; cents: number } | { status: "not_computed"; why: string };
  notices: Array<{ sentOn: string; method: string; note: string | null; source: string }>;
  foreclosureFilingDeadline: { status: "stated"; date: string; basis: string } | { status: "not_stated"; why: string };
}

export function certificateLedger(i: LedgerInput): CertificateLedger {
  const payments = i.events
    .filter((e) => e.eventType === "subsequent_tax_paid")
    .map((e) => ({ paidOn: e.eventDate, taxYear: typeof e.detail.taxYear === "string" ? e.detail.taxYear : null, amountCents: Number(e.detail.amountCents ?? 0), source: sourceOf(e) }))
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const notices = i.events
    .filter((e) => e.eventType === "redemption_notice_recorded")
    .map((e) => ({ sentOn: e.eventDate, method: String(e.detail.method ?? "not stated"), note: typeof e.detail.note === "string" ? e.detail.note : null, source: sourceOf(e) }))
    .sort((a, b) => a.sentOn.localeCompare(b.sentOn));
  // The latest registration wins, as for every tax calendar event.
  const foreclosure = i.events.filter((e) => e.eventType === "foreclosure_filing_deadline").sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1);

  return {
    lienAmount: { amountCents: i.purchaseAmountCents, basis: "what you paid at the sale, as recorded on the certificate" },
    rate: {
      text: i.bidDownRateBps != null
        ? `${(i.bidDownRateBps / 100).toFixed(2)}% — the rate you won at, per year`
        : "no won rate on record; the county procedure card states the return model",
    },
    redemptionDeadline: { date: i.redemptionDeadline, basis: i.deadlineBasis },
    subsequentTaxes: {
      payments,
      totalCents: payments.reduce((s, p) => s + p.amountCents, 0),
      reimbursement: i.subsequentTaxRule
        ? { status: "stated", text: `${i.subsequentTaxRule.value} — county procedure v${i.subsequentTaxRule.version}, ${i.subsequentTaxRule.source}, as of ${i.subsequentTaxRule.asOf}` }
        : { status: "not_stated", why: "the county procedure does not state its subsequent-tax rule, so AcreOS says nothing about whether these are reimbursed" },
    },
    interest:
      i.interest.interestCents == null
        ? { status: "not_computed", why: i.interest.refusalReason ?? "no rule is encoded for this state" }
        : {
            status: "computed",
            cents: i.interest.interestCents,
            text: `${usd(i.interest.interestCents)} accrued on the certificate amount as of ${i.interest.asOfDate}${i.interest.preliminary ? " — preliminary; verify with the county" : ""}. Subsequent taxes are not included.`,
          },
    notices,
    foreclosureFilingDeadline: foreclosure
      ? { status: "stated", date: foreclosure.eventDate, basis: sourceOf(foreclosure) }
      : { status: "not_stated", why: "no foreclosure-filing deadline is on record — enter it from the county procedure or the county's records, with its source" },
  };
}
