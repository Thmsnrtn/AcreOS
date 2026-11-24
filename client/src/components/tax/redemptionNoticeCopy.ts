/**
 * Operator-facing copy for the redemption-notice control (T-DEF-3) — pure.
 *
 * Copy-truth rules, pinned by tests/unit/certificateRedemptionNotice.test.tsx:
 *   - A gate refusal renders the reason for THAT reason code, in plain
 *     language. The server's 422 already carries a truthful message; these
 *     sentences are the client-side rendering of the same reasons, kept
 *     here so the mapping is reviewable and pinned.
 *   - An unknown refusal or a server fault renders as a generic failure —
 *     never as a success, and never with a reason AcreOS does not know.
 *   - A downloaded draft is labelled a draft. Only a provider receipt
 *     (provider id + the delivery state the provider reported) may be
 *     rendered as sent, and a test-mode acceptance is rendered as what it
 *     is: rendered by the provider, not printed or posted.
 */

export type RedemptionNoticeDelivery = {
  lane: string;
  providerId: string | null;
  testMode: boolean;
  alreadySent: boolean;
  expectedDeliveryDate: string | null;
};

const REFUSAL_TEXT: Record<string, string> = {
  notice_requirements_not_recorded:
    "Not sent — no notice requirements are recorded for this county yet. Record what the county requires a redemption notice to say, with its source, on the county procedure card first; AcreOS will not improvise statutory notice language.",
  notice_requirements_stale:
    "Not sent — the recorded notice requirements rest on a source more than 12 months old. Re-verify them with the county before a notice goes out on them.",
  amount_not_determinable:
    "Not sent — the redemption amount cannot be determined for this certificate. Enter the amount from the county's records, with its source, in the fields above, or do not send the notice.",
  not_redeemable:
    "Not sent — this certificate is no longer redeemable, so there is no redemption left to notice.",
  recipient_incomplete:
    "Not sent — the owner of record's name and complete mailing address are not on the certificate, so the notice cannot be mailed. Complete them first, or download the notice and mail it yourself.",
};

/**
 * The sentence for a 422 from POST /redemption-notice. A known reason code
 * renders its mapped sentence; an unknown code falls back to the server's
 * own message when it sent one, and otherwise to a generic not-sent line.
 */
export function redemptionNoticeRefusalText(reason: unknown, serverMessage?: string | null): string {
  if (typeof reason === "string" && reason in REFUSAL_TEXT) return REFUSAL_TEXT[reason];
  if (serverMessage && serverMessage.trim().length > 0) return `Not sent — ${serverMessage.trim()}`;
  return "Not sent — the notice was refused, and nothing was sent or recorded as sent.";
}

/** The generic failure line for a 500 / network failure: no reason is invented. */
export const REDEMPTION_NOTICE_FAILURE_TEXT =
  "The notice could not be sent — something went wrong on our end, and nothing was sent or recorded as sent. Try again, or download the draft and mail it yourself.";

/** The draft line for the download lane: a draft is never rendered as sent. */
export const REDEMPTION_NOTICE_DRAFT_TEXT =
  "Draft downloaded — this is a draft, not a sent notice. Nothing was sent and nothing was recorded as sent. Mail it yourself, then record it on this panel.";

/**
 * The receipt line for a provider-accepted send, from the receipt itself:
 * the provider's id and the state the provider reported. A test-mode
 * acceptance was rendered, not printed or posted, and says so.
 */
export function redemptionNoticeReceiptText(d: RedemptionNoticeDelivery): string {
  const id = d.providerId ? ` Provider id: ${d.providerId}.` : " The provider did not return an id for this piece.";
  if (d.testMode) return `Accepted by the mail provider in test mode — rendered, not printed or posted.${id}`;
  if (d.alreadySent) return `Already sent — the mail provider had already accepted this notice, so no second copy was sent.${id}`;
  return `Sent — accepted by the mail provider.${id}`;
}
