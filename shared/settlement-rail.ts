/**
 * Settlement & Documents Rail — the shared vocabulary (browser-safe: no
 * server imports, so client and server read the same words).
 *
 * The rail is the ONE layer every vertical's money moment runs on
 * (conceptual-gap sweep (c), §9): money-moment document generation, delivery
 * lanes, a common payment-event ledger shape, and a recording-status
 * workflow. It moves documents, instructions and records — never funds.
 * Money itself only ever moves through the user's own Stripe Standard
 * account or entirely outside AcreOS (title/escrow, the county); the rail's
 * ledger rows are the *record* that money arrived, not the movement.
 */

// ── Documents ────────────────────────────────────────────────────────────────

/**
 * The money-moment documents the rail knows how to generate. Each vertical's
 * money moment is a kind here, generated once on the rail instead of once
 * per vertical. Kinds land with their transplant package; the registry on
 * the server (server/services/settlementRail/documents.ts) is the population
 * the reachability of this list is checked against.
 */
export const RAIL_DOCUMENT_KINDS = ["payoff_letter", "lien_release"] as const;
export type RailDocumentKind = (typeof RAIL_DOCUMENT_KINDS)[number];

export const RAIL_DOCUMENT_LABELS: Readonly<Record<RailDocumentKind, string>> = {
  payoff_letter: "Payoff letter",
  lien_release: "Lien release / satisfaction of mortgage",
};

// ── Delivery lanes ───────────────────────────────────────────────────────────

/**
 * How a rail document reaches its recipient.
 *   download       — the artifact itself (PDF); nothing is sent anywhere.
 *   mail           — physical letter through the mail lane (the org's own
 *                    Lob key, or AcreOS house mail under its pricing rules).
 *   certified_mail — the same letter infrastructure with USPS Certified Mail
 *                    added (tracking + proof of mailing) — the lane statutory
 *                    notices and payoff letters to escrow travel on.
 */
const RAIL_DELIVERY_LANES = ["download", "mail", "certified_mail"] as const;
export type RailDeliveryLane = (typeof RAIL_DELIVERY_LANES)[number];

// ── Payment-event ledger (sweep item S-3) ────────────────────────────────────

/**
 * The kinds of non-note money arrival recorded in the shared `money_events`
 * shape. Notes have their own ledger (`payments` + `payment_applications`)
 * and do NOT write here; every other vertical's "money actually arrived"
 * record — an assignment fee, a redemption, flip or lot proceeds, a payoff
 * received outside the note ledger — is one of these kinds in ONE shape, so
 * a cross-vertical "money actually received" read is one query.
 */
export const MONEY_EVENT_KINDS = [
  "assignment_fee_received",
  "redemption_received",
  "flip_proceeds_received",
  "lot_proceeds_received",
  "note_payoff_received",
  "other_received",
] as const;
export type MoneyEventKind = (typeof MONEY_EVENT_KINDS)[number];

// ── Recording status (sweep item S-2) ────────────────────────────────────────

/**
 * The life of a recordable instrument (a deed, a lien release, a partial
 * release) after the rail generates it:
 *   prepared           — generated; not yet sent to the county.
 *   sent_for_recording — handed to the recorder (by the operator, a title
 *                        company, or an e-recording service — the rail
 *                        records the fact, it does not itself record).
 *   recorded           — terminal: the instrument number is on the row.
 *   rejected           — the recorder refused it; the reason is on the row
 *                        and the instrument goes back to `prepared` when it
 *                        is re-prepared (a new status row is NOT created —
 *                        the row's history is its status + timestamps).
 */
export const RECORDING_STATUSES = ["prepared", "sent_for_recording", "recorded", "rejected"] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/** The transitions the workflow admits. `recorded` is terminal. */
const RECORDING_TRANSITIONS: Readonly<Record<RecordingStatus, readonly RecordingStatus[]>> = {
  prepared: ["sent_for_recording", "recorded"],
  sent_for_recording: ["recorded", "rejected"],
  rejected: ["prepared"],
  recorded: [],
};

export function recordingTransitionAllowed(from: RecordingStatus, to: RecordingStatus): boolean {
  return (RECORDING_TRANSITIONS[from] as readonly string[]).includes(to);
}

/** The document kinds a recording status can attach to. */
export const RECORDING_SUBJECT_KINDS = ["lien_release", "deed", "partial_release", "other_instrument"] as const;
export type RecordingSubjectKind = (typeof RECORDING_SUBJECT_KINDS)[number];
