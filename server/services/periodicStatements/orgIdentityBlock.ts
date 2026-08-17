/**
 * The org-identity block: the terminal outcome, and how to recognise it.
 *
 * Extracted from delivery.ts so both the sender and its tests import it from
 * ONE place. It lived in delivery.ts exported purely so the test could reach
 * it, which the reachability gate correctly counts as an export with no
 * consumer outside its defining module — the "exists only for its test" shape.
 * A separate module with a real importer is the honest fix; an allowlist entry
 * would only have recorded the smell.
 *
 * Founder ruling 2026-08-16 ("New state + founder alert"): a Reg Z sec.1026.41
 * statement that cannot be sent because the ORG has connected no email identity
 * is neither `suppressed` (that means no borrower address) nor `failed` (that
 * means a transient error worth retrying). It is its own terminal state, and
 * retrying it forever against an org that will never connect email is how a
 * statutory obligation quietly becomes a retry loop.
 */
import type { EmailResult } from "../emailService";

export const ORG_IDENTITY_BLOCK_REASON = "org_email_identity_not_connected";

/**
 * Did emailService REFUSE this send for want of an org sending identity,
 * as opposed to failing to deliver it?
 *
 * The refusal is a pre-flight return from the counterparty branch
 * (emailService.ts:614-641). Its signature is
 * `{ success:false, errorType:"configuration_error", retryable:false,
 *    attempts:0 }`.
 *
 * `attempts === 0` is the load-bearing part, not decoration. A REAL SES
 * configuration exception also categorises to "configuration_error"
 * (emailService.ts categorizeError, :160-166 — it matches on
 * ConfigurationSetDoesNotExistException / "configuration" / "not
 * configured" / "credentials not"), but it can only be produced from
 * inside the retry loop, so it always carries `attempts >= 1`
 * (emailService.ts:786). Only the pre-flight refusals return
 * `attempts: 0`, and of those, only the two counterparty guards use
 * "configuration_error" (the others are "recipient_rejected" at :552/:573
 * and "quota_exceeded" at :597). So this predicate cannot mistake a live
 * SES misconfiguration — which IS worth retrying — for an org-identity
 * refusal, which is not.
 */
export function isOrgIdentityRefusal(result: EmailResult): boolean {
  return (
    result.success === false &&
    result.errorType === "configuration_error" &&
    result.retryable === false &&
    (result.attempts ?? 0) === 0
  );
}
