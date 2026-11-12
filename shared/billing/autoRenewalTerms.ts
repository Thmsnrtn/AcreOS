/**
 * Automatic-renewal terms, the pre-renewal notice for yearly plans, and the
 * acknowledgment — California's Automatic Renewal Law (Cal. Bus. & Prof. Code
 * §§ 17600–17606), read 2026-10-09 from the current text of § 17602.
 *
 * What this module supplies, and the subsection each piece answers:
 *   § 17602(a)(1)  the terms, clear and conspicuous, in visual proximity to the
 *                  request for consent — autoRenewalTermsText(), shown next to
 *                  the pay button on Stripe Checkout (custom_text.submit);
 *                  with a trial, the price charged after the trial ends.
 *   § 17602(a)(3)  an acknowledgment the consumer can keep, with the terms,
 *                  the cancellation policy and how to cancel —
 *                  autoRenewalAcknowledgment().
 *   § 17602(a)(6)  verification of consent kept ≥ 3 years — the checkout
 *                  session id and AUTO_RENEWAL_TERMS_VERSION are recorded on
 *                  the subscription-history row when checkout completes.
 *   § 17602(a)(8), (b)(2)  for a term of one year or longer, a notice at least
 *                  15 and at most 45 days before renewal stating that it
 *                  renews unless cancelled, the renewal length, the amount,
 *                  how to cancel, a link to the cancellation process, and the
 *                  business's contact — annualRenewalNotice() and
 *                  annualRenewalNoticeDue().
 *   § 17602(d)(1)  online cancellation, exclusively online, at will and
 *                  immediately, by a prominent link or button — the
 *                  self-serve cancel cancels at period end directly (no
 *                  survey required, no portal hand-off).
 *
 * Massachusetts' rule runs alongside California's: 940 CMR 38.05(4)–(5)
 * (trial offers and negative-option features; enforcement from
 * 2025-09-02) requires, for a feature exceeding 31 days — every yearly
 * plan — a written renewal notice no more than 30 and no fewer than 5
 * days before the cancel-by date, at EVERY renewal, price change or
 * not, disclosing (a) the obligations if the consumer fails to cancel,
 * (b) every Product chargeable, (c) the cancellation mechanism, (d) the
 * cancel-by calendar date, and (e) the charge calendar date, delivered
 * through a medium substantially similar to sign-up (email, the sign-up
 * medium). One notice can satisfy both regimes: sent 15–30 days out it
 * sits inside both windows; a renewal first observed 5–14 days out is
 * outside California's 15-day floor but still inside Massachusetts'
 * 5-day floor, so the job sends on either regime's window rather than
 * staying silent — see maAnnualRenewalNoticeDue(). The notice content
 * below carries the (4)(a)–(e) disclosures explicitly, as a superset of
 * the § 17602(a)(8) contents.
 */

export const AUTO_RENEWAL_TERMS_VERSION = "ca-arl-2026-10-09";
export const ANNUAL_NOTICE_MIN_DAYS = 15;
export const ANNUAL_NOTICE_MAX_DAYS = 45;
/** Send inside the window with slack on both sides of a missed job run. */
export const ANNUAL_NOTICE_TARGET_DAYS = 30;
/** 940 CMR 38.05(4): written notice no fewer than 5 days before the cancel-by date. */
export const MA_ANNUAL_NOTICE_MIN_DAYS = 5;
/** 940 CMR 38.05(4): written notice no more than 30 days before the cancel-by date. */
export const MA_ANNUAL_NOTICE_MAX_DAYS = 30;
const CANCEL_PATH = "/settings?tab=billing";
const SUPPORT_CONTACT = "support@acreos.io";

export type RenewalInterval = "month" | "year";

function money(cents: number, currency = "usd"): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase() });
}

/** § 17602(a)(1) / (a)(8)(A)–(D): the offer terms shown beside the pay button. */
export function autoRenewalTermsText(o: { planName: string; priceCents: number; interval: RenewalInterval; currency?: string; trialDays?: number }): string {
  const every = o.interval === "year" ? "year" : "month";
  const price = money(o.priceCents, o.currency);
  const trial = o.trialDays && o.trialDays > 0
    ? `After your ${o.trialDays}-day free trial you will be charged ${price} (plus applicable tax), then `
    : `You will be charged ${price} (plus applicable tax) today, then `;
  return (
    `Automatic renewal: your AcreOS ${o.planName} plan renews automatically every ${every} at ${price} (plus applicable tax) until you cancel. ` +
    `${trial}${price} every ${every}. ` +
    `Cancel any time online in Settings → Billing — one click, no call; cancellation takes effect at the end of the current ${every === "year" ? "year" : "billing period"}. ` +
    (o.interval === "year" ? `We will email you 15–45 days before each yearly renewal (in Massachusetts, 5–30 days before the cancel-by date, per 940 CMR 38.05). ` : "") +
    `By subscribing you agree to these renewal terms.`
  );
}

/** § 17602(b)(2): due when the renewal is between 15 and the target days away (inside the 15–45 window). */
export function annualRenewalNoticeDue(o: { renewsAtMs: number; nowMs: number; alreadySentForThisPeriod: boolean; cancelAtPeriodEnd: boolean }): boolean {
  if (o.alreadySentForThisPeriod || o.cancelAtPeriodEnd) return false;
  const days = (o.renewsAtMs - o.nowMs) / 86_400_000;
  return days >= ANNUAL_NOTICE_MIN_DAYS && days <= ANNUAL_NOTICE_TARGET_DAYS;
}

/**
 * 940 CMR 38.05(4): due when the cancel-by date is 5–30 days away. The
 * cancel-by date is the renewal date itself — a cancellation recorded at
 * any moment before the renewal instant stops the charge (the plan then
 * ends at period end), so the window is measured to the renewal. This
 * window reaches the 5–14-day band the California predicate above
 * cannot: a renewal first observed there is late for § 17602 but still
 * timely for 38.05, and the duty is owed at every renewal.
 */
export function maAnnualRenewalNoticeDue(o: { renewsAtMs: number; nowMs: number; alreadySentForThisPeriod: boolean; cancelAtPeriodEnd: boolean }): boolean {
  if (o.alreadySentForThisPeriod || o.cancelAtPeriodEnd) return false;
  const days = (o.renewsAtMs - o.nowMs) / 86_400_000;
  return days >= MA_ANNUAL_NOTICE_MIN_DAYS && days <= MA_ANNUAL_NOTICE_MAX_DAYS;
}

/**
 * The pre-renewal notice for a yearly plan — § 17602(a)(8)(A)–(F) and,
 * as an explicit superset, 940 CMR 38.05(4)(a)–(e):
 *   (a) the obligations if the consumer fails to cancel — the charge and
 *       the renewed one-year term, stated as a consequence of not
 *       cancelling by the cancel-by date;
 *   (b) every Product chargeable at renewal (`products`; the caller
 *       lists the plan plus any seat add-on items on the subscription);
 *   (c) the cancellation mechanism;
 *   (d) the cancel-by calendar date (`cancelBy`, defaulting to the
 *       renewal date — cancelling at any moment before the renewal
 *       instant stops the charge);
 *   (e) the charge calendar date (`chargeOn`, defaulting to the
 *       renewal date).
 */
export function annualRenewalNotice(o: { planName: string; renewsOn: Date; amountCents: number; currency?: string; appUrl: string; cancelBy?: Date; chargeOn?: Date; products?: string[] }): { subject: string; html: string; text: string } {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const date = fmt(o.renewsOn);
  const cancelByDate = fmt(o.cancelBy ?? o.renewsOn);
  const chargeDate = fmt(o.chargeOn ?? o.renewsOn);
  const amount = money(o.amountCents, o.currency);
  const products = (o.products && o.products.length > 0 ? o.products : [`AcreOS ${o.planName} plan`]).join(", ");
  const cancelUrl = `${o.appUrl}${CANCEL_PATH}`;
  const lines = [
    `Your AcreOS ${o.planName} plan renews automatically on ${date} unless you cancel.`,
    `Renewal term: one year. Amount: ${amount} (plus applicable tax), charged once to your payment method on file.`,
    `Products charged at renewal: ${products}.`,
    `If you do not cancel by ${cancelByDate}, ${amount} (plus applicable tax) will be charged to your payment method on file on ${chargeDate}, and your plan will renew for one year.`,
    `To cancel, open Settings → Billing and choose Cancel subscription: ${cancelUrl} — it takes one click and ends the plan at the close of the current year.`,
    `Questions: ${SUPPORT_CONTACT}, or reply to this email.`,
  ];
  return {
    subject: `Your AcreOS plan renews on ${date} for ${amount}`,
    html: `<p>${lines[0]}</p><p>${lines[1]}</p><p>${lines[2]}</p><p>${lines[3]}</p><p>To cancel, open <a href="${cancelUrl}">Settings → Billing</a> and choose Cancel subscription — it takes one click and ends the plan at the close of the current year.</p><p>Questions: ${SUPPORT_CONTACT}, or reply to this email.</p><p>— AcreOS</p>`,
    text: lines.join("\n\n") + "\n\n— AcreOS",
  };
}

/** § 17602(a)(3): the acknowledgment sent when the subscription starts. */
export function autoRenewalAcknowledgment(o: { termsText: string; appUrl: string }): { subject: string; html: string; text: string } {
  const cancelUrl = `${o.appUrl}${CANCEL_PATH}`;
  const policy = "Cancellation policy: you can cancel any time online; the plan stays active until the end of the period you have paid for, and you are not charged again.";
  const how = `How to cancel: Settings → Billing → Cancel subscription (${cancelUrl}), or email ${SUPPORT_CONTACT}.`;
  return {
    subject: "Your AcreOS subscription: renewal terms and how to cancel",
    html: `<p>Thanks for subscribing. Please keep this email.</p><p>${o.termsText}</p><p>${policy}</p><p>How to cancel: <a href="${cancelUrl}">Settings → Billing → Cancel subscription</a>, or email ${SUPPORT_CONTACT}.</p><p>— AcreOS</p>`,
    text: `Thanks for subscribing. Please keep this email.\n\n${o.termsText}\n\n${policy}\n\n${how}\n\n— AcreOS`,
  };
}
