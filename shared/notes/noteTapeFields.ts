/**
 * The note-tape field catalogue — V-Notes-1 N1 (Linnea's day-one import).
 *
 * One catalogue for the server validator and the import UI, so the label an
 * investor maps against is the same field the validator refuses on.
 *
 * REQUIRED means one of two things, and nothing else:
 *   - the canonical book row (`acquired_notes`) holds the column NOT NULL, so
 *     a missing value could only be stored by inventing one (the importer
 *     this replaces wrote rate 0, term 360 and a derived maturity — the defect
 *     this catalogue exists to end); or
 *   - the note cannot be judged without it: status, and the three critical
 *     documents (Moskowitz: document completeness is a hard gate).
 * A required field that is UNMAPPED refuses the whole file before anything is
 * built; a required cell that is blank or unparseable refuses that row, with
 * the field, the cell and the fix. Optional fields are stored only when the
 * tape states them: missing is null, never 0.
 *
 * The yield fields Napier's maths needs (unpaid balance, rate, remaining
 * term, balloon) are first-class, so yield and discount are computed from
 * the record — never from a guessed balance.
 */

import type { Confidence, DecayClass } from "../landData/bulkParcelRecord";

export type NoteTapeFieldKind = "text" | "money" | "rate" | "int" | "day" | "date" | "status" | "state" | "document";

export type NoteTapeFieldKey =
  // identity
  | "noteNumber"
  | "payerName"
  // terms (acquired_notes NOT NULL)
  | "originalPrincipal"
  | "currentBalance"
  | "interestRate"
  | "termMonths"
  | "paymentAmount"
  | "paymentDueDay"
  | "originationDate"
  | "maturityDate"
  | "acquisitionDate"
  | "acquisitionPrice"
  | "status"
  // yield fields, first-class when stated
  | "remainingTermMonths"
  | "balloonAmount"
  | "balloonDate"
  | "paidThroughDate"
  | "nextPaymentDate"
  // forward-calendar only (N3): an observation and a calendar event, no acquired_notes column
  | "rateAdjustmentDate"
  // collateral reference
  | "collateralApn"
  | "collateralState"
  | "collateralCounty"
  | "collateralAddress"
  // document set
  | "docNote"
  | "docSecurityInstrument"
  | "docAssignmentChain"
  | "docAllonges"
  | "docPaymentHistory"
  | "docExceptionNote";

export type NoteTapeGroup = "identity" | "terms" | "yield" | "collateral" | "documents";

export interface NoteTapeFieldDef {
  key: NoteTapeFieldKey;
  label: string;
  group: NoteTapeGroup;
  kind: NoteTapeFieldKind;
  /** Unmapped → the file refuses; blank cell → the row refuses. */
  required: boolean;
  /** How fast a stated value goes stale (D1 A1 pattern). */
  decay: DecayClass;
  /** Lowercased header spellings seen on seller tapes. */
  aliases: string[];
  /** What the investor should put in the cell — shown with every row error. */
  fix: string;
}

const MONEY_FIX = "a dollar amount such as 84,250.00";
const DATE_FIX = "a date such as 2026-10-01 or 10/1/2026";

export const NOTE_TAPE_FIELDS: readonly NoteTapeFieldDef[] = [
  { key: "noteNumber", label: "Loan / note number", group: "identity", kind: "text", required: true, decay: "stable", aliases: ["loan number", "loan #", "loan id", "note number", "note #", "note id", "account", "account number", "loan_no"], fix: "the seller's loan number for this note" },
  { key: "payerName", label: "Borrower name", group: "identity", kind: "text", required: true, decay: "about_a_year", aliases: ["borrower", "borrower name", "payer", "payer name", "obligor", "mortgagor"], fix: "the borrower's name as it appears on the note" },
  { key: "originalPrincipal", label: "Original principal", group: "terms", kind: "money", required: true, decay: "stable", aliases: ["original balance", "original principal", "orig balance", "original loan amount", "orig upb", "loan amount"], fix: MONEY_FIX },
  { key: "currentBalance", label: "Unpaid principal balance", group: "terms", kind: "money", required: true, decay: "months", aliases: ["upb", "unpaid balance", "unpaid principal balance", "current balance", "principal balance", "balance"], fix: MONEY_FIX },
  { key: "interestRate", label: "Interest rate (%)", group: "terms", kind: "rate", required: true, decay: "stable", aliases: ["rate", "interest rate", "note rate", "coupon", "int rate"], fix: "an annual percentage such as 8.5 or 8.5%" },
  { key: "termMonths", label: "Original term (months)", group: "terms", kind: "int", required: true, decay: "stable", aliases: ["term", "term months", "original term", "amort term", "amortization term"], fix: "a whole number of months such as 360" },
  { key: "paymentAmount", label: "Payment amount (P&I)", group: "terms", kind: "money", required: true, decay: "years", aliases: ["payment", "p&i", "pi payment", "monthly payment", "payment amount"], fix: MONEY_FIX },
  { key: "paymentDueDay", label: "Payment due day", group: "terms", kind: "day", required: true, decay: "stable", aliases: ["due day", "payment due day", "day due"], fix: "the day of the month the payment is due, 1 to 31" },
  { key: "originationDate", label: "Origination date", group: "terms", kind: "date", required: true, decay: "stable", aliases: ["origination date", "note date", "orig date", "funding date"], fix: DATE_FIX },
  { key: "maturityDate", label: "Maturity date", group: "terms", kind: "date", required: true, decay: "stable", aliases: ["maturity", "maturity date", "maturity dt"], fix: DATE_FIX },
  { key: "acquisitionDate", label: "Acquisition date", group: "terms", kind: "date", required: true, decay: "stable", aliases: ["acquisition date", "purchase date", "bought", "settlement date"], fix: DATE_FIX },
  { key: "acquisitionPrice", label: "Purchase price", group: "terms", kind: "money", required: true, decay: "stable", aliases: ["purchase price", "acquisition price", "price paid", "cost basis"], fix: MONEY_FIX },
  { key: "status", label: "Status", group: "terms", kind: "status", required: true, decay: "months", aliases: ["status", "loan status", "performance", "pay status"], fix: "one of: performing, late, default, paid off, sold" },
  { key: "remainingTermMonths", label: "Remaining term (months)", group: "yield", kind: "int", required: false, decay: "months", aliases: ["remaining term", "remaining months", "months remaining", "rem term"], fix: "a whole number of months" },
  { key: "balloonAmount", label: "Balloon amount", group: "yield", kind: "money", required: false, decay: "months", aliases: ["balloon", "balloon amount", "balloon payment"], fix: MONEY_FIX },
  { key: "balloonDate", label: "Balloon date", group: "yield", kind: "date", required: false, decay: "stable", aliases: ["balloon date", "balloon due"], fix: DATE_FIX },
  { key: "paidThroughDate", label: "Paid-through date", group: "yield", kind: "date", required: false, decay: "months", aliases: ["paid through", "paid to date", "paid thru", "ptd"], fix: DATE_FIX },
  { key: "nextPaymentDate", label: "Next payment due", group: "yield", kind: "date", required: false, decay: "months", aliases: ["next due", "next due date", "next payment date", "ndd"], fix: DATE_FIX },
  { key: "rateAdjustmentDate", label: "Next rate adjustment", group: "yield", kind: "date", required: false, decay: "months", aliases: ["next rate change", "rate change date", "next adjustment date", "rate adjustment date", "arm adjustment date", "next rate adjustment"], fix: DATE_FIX },
  { key: "collateralApn", label: "Collateral APN / parcel ID", group: "collateral", kind: "text", required: false, decay: "stable", aliases: ["apn", "parcel", "parcel id", "parcel number", "pin", "tax id"], fix: "the county parcel number of the property securing the note" },
  { key: "collateralState", label: "Collateral state", group: "collateral", kind: "state", required: false, decay: "stable", aliases: ["state", "property state", "st"], fix: "a two-letter state code such as NC" },
  { key: "collateralCounty", label: "Collateral county", group: "collateral", kind: "text", required: false, decay: "stable", aliases: ["county", "property county"], fix: "the county name, such as Wake" },
  { key: "collateralAddress", label: "Collateral address", group: "collateral", kind: "text", required: false, decay: "years", aliases: ["property address", "address", "collateral address", "situs", "street"], fix: "the property's street address" },
  { key: "docNote", label: "Original note", group: "documents", kind: "document", required: true, decay: "event", aliases: ["note", "original note", "note doc", "note in file"], fix: "present, missing, or exception" },
  { key: "docSecurityInstrument", label: "Mortgage / deed of trust", group: "documents", kind: "document", required: true, decay: "event", aliases: ["mortgage", "deed of trust", "dot", "security instrument", "mortgage/dot"], fix: "present, missing, or exception" },
  { key: "docAssignmentChain", label: "Assignment chain", group: "documents", kind: "document", required: true, decay: "event", aliases: ["assignments", "assignment chain", "aom", "assignment of mortgage", "chain of title"], fix: "present (complete chain), missing, or exception (a broken or unrecorded link)" },
  { key: "docAllonges", label: "Allonges / endorsements", group: "documents", kind: "document", required: false, decay: "event", aliases: ["allonge", "allonges", "endorsements", "endorsement chain"], fix: "present, missing, or exception" },
  { key: "docPaymentHistory", label: "Payment history", group: "documents", kind: "document", required: false, decay: "event", aliases: ["payment history", "pay history", "life of loan history", "transaction history"], fix: "present, missing, or exception" },
  { key: "docExceptionNote", label: "Document exception note", group: "documents", kind: "text", required: false, decay: "event", aliases: ["exception", "exceptions", "doc exception", "document notes", "collateral exceptions"], fix: "what the exception is, such as 'AOM from ABC Bank to XYZ unrecorded'" },
];

export const NOTE_TAPE_FIELD = Object.fromEntries(NOTE_TAPE_FIELDS.map((f) => [f.key, f])) as Record<NoteTapeFieldKey, NoteTapeFieldDef>;
export const REQUIRED_NOTE_TAPE_FIELDS: readonly NoteTapeFieldKey[] = NOTE_TAPE_FIELDS.filter((f) => f.required).map((f) => f.key);

export const NOTE_STATUSES = ["performing", "late", "default", "paid_off", "sold"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** A document's state on the tape. `exception` must say what the exception is. */
export type DocumentState = "present" | "missing" | "exception";
export const CRITICAL_DOCUMENTS: readonly NoteTapeFieldKey[] = ["docNote", "docSecurityInstrument", "docAssignmentChain"];

/**
 * Confidence of a value the seller's tape states. A tape is the seller's
 * representation, not a verified record, so it is MEDIUM — never high —
 * until something independent agrees with it (V-Notes-2 reconciliation).
 */
export const TAPE_CONFIDENCE: Confidence = "medium";
export const TAPE_CONFIDENCE_BASIS = "stated on the seller's tape; not independently verified";
