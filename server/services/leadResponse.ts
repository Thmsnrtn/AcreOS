/**
 * Lead-response recording — the ONE canonical answer to "what counts as a
 * seller replying?" (autonomy gap slice 1, defect CR-036).
 *
 * Before this module `checkLeadResponded` filtered lead-activity types
 * (`email_reply|sms_reply|call|response`) that nothing wrote, and
 * `pauseEnrollmentOnResponse` had no callers — so a drip sequence kept
 * emailing a seller who had already answered. Now every inbound seam writes a
 * lead-activity row whose type is a member of RESPONSE_SOURCES and then calls
 * `pauseSequencesOnResponse`.
 *
 * This file deliberately has NO imports at module scope other than the logger:
 * sequenceProcessor imports the constant, the inbound services import the
 * helper, and the processor pulls in half the server — a static edge back would
 * be an import cycle. The processor is loaded lazily inside the helper.
 */
import { logger } from "../utils/logger";

/**
 * Every lead-activity `type` that counts as the lead responding. Each member
 * has a writer; `leadResponseSources.test.ts` fails if one has none, and fails
 * if `checkLeadResponded` filters on anything but this list.
 *
 *   email_received — inboundEmailService.processInboundEmail (an inbound email
 *                    on a resolved lead is by construction a reply; no second
 *                    row is written, so the timeline carries one entry).
 *   sms_received   — smsService.handleIncomingSMS (matched lead only).
 *   phone_response / sms_response — POST /api/leads/:id/contact-event, written
 *                    alongside the `${channel}_outcome` row when the logged
 *                    outcome means a human reached the lead (see
 *                    RESPONSE_CALL_OUTCOMES).
 */
export const RESPONSE_SOURCES = [
  "email_received",
  "sms_received",
  "phone_response",
  "sms_response",
] as const;

export type ResponseSource = (typeof RESPONSE_SOURCES)[number];

const RESPONSE_SOURCE_SET: ReadonlySet<string> = new Set(RESPONSE_SOURCES);

export function isResponseActivityType(type: string | null | undefined): boolean {
  return !!type && RESPONSE_SOURCE_SET.has(type);
}

/**
 * Logged call outcomes that mean a human on the lead's side engaged. The line:
 * `hot`/`warm`/`cold` are all conversations (a cold "not interested" is still a
 * reply — and exactly when a drip should stop). `no_answer` means nobody
 * picked up and `wrong_number` means the person reached is not the lead, so
 * neither is a response and the sequence keeps running.
 */
export const RESPONSE_CALL_OUTCOMES: readonly string[] = ["hot", "warm", "cold"];

export function callOutcomeIsResponse(outcome: string | null | undefined): boolean {
  return !!outcome && RESPONSE_CALL_OUTCOMES.includes(outcome);
}

/**
 * Pause every active sequence enrollment for the lead. Fail-soft: the inbound
 * message is already persisted by the caller, and a pause failure must never
 * fail the webhook (the processor's own `responded` condition and
 * `checkLeadResponded` are the backstop on the next tick).
 */
export async function pauseSequencesOnResponse(orgId: number, leadId: number): Promise<void> {
  try {
    const { sequenceProcessorService } = await import("./sequenceProcessor");
    await sequenceProcessorService.pauseEnrollmentOnResponse(orgId, leadId);
  } catch (err) {
    logger.error(
      "[lead-response] could not pause sequences after a lead response",
      err instanceof Error ? err : undefined,
      { metadata: { orgId, leadId } },
    );
  }
}
