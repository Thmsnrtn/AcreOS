/**
 * What happened to the email for a team invitation. Shared by the routes that
 * report it and the settings card that words it, so the two cannot name
 * different outcomes.
 *
 *  - sent            the mail provider accepted the message (NOT proof it was
 *                    read or reached an inbox; the UI says "emailed")
 *  - not_configured  this server cannot send mail (no sender configured);
 *                    nothing left
 *  - simulated       simulation mode is on for this org or server: the send was
 *                    simulated and nothing was emailed
 *  - suppressed      AcreOS cannot mail this address; nothing left
 *  - failed          a send was attempted and refused or errored; nothing left
 */
export type TeamInviteDeliveryStatus = "sent" | "not_configured" | "simulated" | "suppressed" | "failed";
