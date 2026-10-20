/**
 * The mail products AcreOS can actually deliver (P1 false-claims sweep).
 *
 * The composer used to offer "Handwritten — premium touch", "Next day",
 * "Batch (3-day / cheapest)" and "EDDM blast". None of them existed: the Lob
 * adapter priced a handwritten piece at a premium and mailed a plain printed
 * letter, quoted a 1-day ETA for "next day" without ever passing a mail class
 * to Lob, and the presort / EDDM / LettrLabs adapters are disabled stubs that
 * nothing aggregates through. Every piece goes out as an ordinary Lob (or the
 * org's own PostGrid) piece on the standard class.
 *
 * This module is the single answer to "can this be mailed". The composer
 * renders only these options, the outreach-mail routes validate against them,
 * and the mail router refuses anything else before any provider is contacted
 * — so an undeliverable product is never quoted, queued or charged.
 *
 * To make one real: build the provider path that delivers it, add it here,
 * and the mailOptionsAreDeliverable test will hold the composer to it.
 */

/** Every piece type the stored schema can name (historic rows included). */
export const ALL_MAIL_PIECE_TYPES = ["postcard_4x6", "postcard_6x9", "letter_10", "handwritten"] as const;
/** Every speed the stored schema can name (historic rows included). */
export const ALL_MAIL_SPEEDS = ["next_day", "standard", "batch_3d", "batch_weekly", "eddm_geo"] as const;

/** Piece types a configured provider actually prints as named. */
export const DELIVERABLE_MAIL_PIECE_TYPES = ["postcard_4x6", "postcard_6x9", "letter_10"] as const;
/** Speeds a configured provider actually honours. */
export const DELIVERABLE_MAIL_SPEEDS = ["standard"] as const;

export type DeliverableMailPieceType = (typeof DELIVERABLE_MAIL_PIECE_TYPES)[number];
export type DeliverableMailSpeed = (typeof DELIVERABLE_MAIL_SPEEDS)[number];

export function isDeliverablePieceType(pieceType: string): pieceType is DeliverableMailPieceType {
  return (DELIVERABLE_MAIL_PIECE_TYPES as readonly string[]).includes(pieceType);
}

function isDeliverableSpeed(speed: string): speed is DeliverableMailSpeed {
  return (DELIVERABLE_MAIL_SPEEDS as readonly string[]).includes(speed);
}

/**
 * Why a shipment spec cannot be mailed, or null when every part of it can.
 * The reason is safe to show the customer.
 */
export function undeliverableMailReason(pieceTypes: readonly string[], speed: string): string | null {
  const badPiece = pieceTypes.find((p) => !isDeliverablePieceType(p));
  if (badPiece !== undefined) {
    return `"${badPiece}" mail is not available: no connected provider prints it, so nothing was quoted or charged.`;
  }
  if (!isDeliverableSpeed(speed)) {
    return `"${speed}" delivery is not available: every piece mails on the standard class, so nothing was quoted or charged.`;
  }
  return null;
}
