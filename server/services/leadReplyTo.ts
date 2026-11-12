/**
 * Lead-threaded Reply-To for outbound lead email (gap slice 2).
 *
 * Outbound mail to a lead that carries no Reply-To lands the lead's reply in
 * the customer's own mailbox, unlinked to the lead — so the reply can neither
 * stop a drip (slice 1, `pauseSequencesOnResponse`) nor appear on the lead's
 * timeline. Setting Reply-To to the lead-threaded inbound address sends the
 * reply back through the inbound seam (`inboundEmailService`), which resolves
 * the lead from the address, writes the `email_received` activity and stops
 * the sequences.
 *
 * The address SCHEME lives in `inboundEmailService.generateReplyToAddress` —
 * this module only delegates to it. It is loaded dynamically because
 * inboundEmailService pulls in storage + the websocket server, which the
 * send-side modules (sequenceProcessor, communications, AI tools, campaign
 * routes) must not load at import time.
 *
 * A failure to load the generator must never block a send: the mail goes out
 * unthreaded, exactly as it did before, and the failure is logged.
 */
import { logger } from "../utils/logger";

export async function leadReplyToAddress(
  leadId: number,
  organizationId: number,
): Promise<string | undefined> {
  try {
    const { generateReplyToAddress } = await import("./inboundEmailService");
    return generateReplyToAddress(leadId, organizationId);
  } catch (error) {
    logger.warn("[leadReplyTo] could not build the lead-threaded Reply-To; sending without it", {
      metadata: {
        leadId,
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return undefined;
  }
}
