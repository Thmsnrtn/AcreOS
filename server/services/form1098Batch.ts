/**
 * Form 1098 (Mortgage Interest Statement) Batch Generator.
 *
 * AcreOS orgs are note SERVICERS/holders: they RECEIVE mortgage interest
 * from borrowers. A person engaged in a trade or business who receives
 * $600 or more of mortgage interest from an individual on a mortgage
 * secured by real property must file Form 1098 with the IRS and furnish a
 * statement to the borrower. This module is the server-side counterpart to
 * `form1099Batch.ts` (which handles interest AcreOS orgs *pay* out).
 *
 * What this produces
 * ──────────────────
 *   • One PDF per qualifying mortgage — Form 1098 box layout
 *   • One Form 1096 transmittal-summary PDF for the batch
 *   • One IRS Pub 1220 FIRE text file (Type of Return "3")
 *   • A structured refusal list for every mortgage that could NOT be
 *     reported truthfully, each with a machine code and a stated reason
 *
 * Scaffolding reuse (NOT duplication)
 * ───────────────────────────────────
 * The fixed-width e-file layer is `irsFireFormat.ts` — the same module the
 * 1099-INT batch uses. Form 1098 support there (`buildFire1098File`,
 * `buildB1098Record`) was verified field-by-field against IRS Publication
 * 1220 (Rev. 5-2026); see that file's header. Payer/lender identity
 * resolution reuses `TaxIdentityError` + the encrypted-TIN envelope helpers
 * already used by the 1099 path.
 *
 * ── THE CENTRAL RULE OF THIS FILE ──────────────────────────────────────
 * A WRONG TAX FORM IS WORSE THAN A MISSING ONE.
 *
 * Every figure on every form produced here is DERIVED from posted ledger
 * entries or from a stored, operator-entered fact. Nothing is estimated,
 * annualized, extrapolated, or defaulted to a "plausible" value. When an
 * input required by the form is absent or cannot be derived, the form is
 * REFUSED and the reason is recorded. Refusals are a first-class output of
 * this module, not an error path.
 *
 * TIN handling: TINs are decrypted only in memory, only to place them on
 * the form/e-file record. A TIN is NEVER logged and NEVER placed in an
 * error, refusal reason, or exception message — refusals identify a
 * mortgage by note reference only.
 *
 * Idempotency: this generator is a pure derivation over the ledger. It
 * accumulates nothing and writes no counters, so regenerating a batch for
 * the same tax year yields byte-identical figures and cannot double-count.
 * Each mortgage is keyed once by (source, noteRef); a note can appear in
 * the batch at most once even if the ledger is scanned repeatedly.
 */

import { db } from "../db";
import { notes, organizations, payments, properties, leads } from "@shared/schema";
import { acquiredNotes, notePayments } from "@shared/schema/notes-vertical";
import { and, eq, inArray } from "drizzle-orm";
import { jsPDF } from "jspdf";
import {
  buildFire1098File,
  validateFireFile,
  nameControlFor,
  type Payee1098Record,
  type TransmitterRecord,
  type IssuerRecord,
  type FireFileResult,
} from "./irsFireFormat";
import { TaxIdentityError, type PayerOrRecipientAddress } from "./bookkeeping";
import { decrypt as decryptField, isAnyEncryptedEnvelope } from "./fieldEncryption";
import { logger } from "../utils/logger";

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * Form 1098 filing threshold: "$600 or more of mortgage interest" received
 * from an individual (Instructions for Form 1098, Who Must File).
 */
export const FORM_1098_THRESHOLD_CENTS = 60_000;

/** TINs we must never emit — same placeholder set the 1099 path rejects. */
const PLACEHOLDER_TINS = new Set(["00-0000000", "000-00-0000", "000000000"]);

// ─── Public shapes ────────────────────────────────────────────────────────

export type Form1098Source = "originated" | "acquired";

/**
 * How Box 2 (Outstanding Mortgage Principal) was derived. Recorded on the
 * form so an audit can reproduce the figure without re-running the batch.
 *
 * Box 2 rule (Instructions for Form 1098): "Enter the amount of outstanding
 * principal on the mortgage as of January 1, of the current year. If you
 * originated the mortgage in the current year, enter the mortgage principal
 * as of the date of origination. If you acquired the mortgage in the
 * current year, enter the outstanding mortgage principal as of the date of
 * acquisition."
 */
export type OutstandingPrincipalBasis =
  /** Mortgage originated during the tax year — principal at origination. */
  | "origination_during_year"
  /** Mortgage acquired during the tax year — balance at acquisition date. */
  | "acquisition_during_year"
  /** Held all year, no payment was due before Jan 1 — original principal. */
  | "no_principal_due_before_year"
  /** Held all year — current balance rolled back over posted principal. */
  | "rolled_back_from_current_balance";

export interface Form1098 {
  taxYear: number;
  source: Form1098Source;
  /** Human note reference for audit trails. Never a TIN. */
  noteRef: string;
  /** Pub 1220 Issuer's Account Number For Payee (≤ 20 chars, unique). */
  accountNumber: string;

  // ── RECIPIENT'S/LENDER'S side (the filer — the AcreOS org) ────────────
  lenderName: string;
  lenderAddress: PayerOrRecipientAddress;
  lenderPhone: string;
  lenderTin: string;
  lenderTinType: "EIN" | "SSN" | "ITIN";

  // ── PAYER'S/BORROWER'S side ───────────────────────────────────────────
  borrowerName: string;
  borrowerAddress: PayerOrRecipientAddress;
  borrowerTin: string;
  borrowerTinType: "SSN" | "EIN" | "ITIN";

  // ── Form boxes (IRS Form 1098) ────────────────────────────────────────
  /** Box 1 — Mortgage interest received from payer(s)/borrower(s). */
  box1MortgageInterestReceivedCents: number;
  /** Box 2 — Outstanding mortgage principal. */
  box2OutstandingMortgagePrincipalCents: number;
  /** Provenance of Box 2 — audit aid, not printed on the form. */
  box2Basis: OutstandingPrincipalBasis;
  /** Box 3 — Mortgage origination date, ISO YYYY-MM-DD. */
  box3MortgageOriginationDate: string;
  /**
   * Box 4 — Refund of overpaid interest. AcreOS has no
   * interest-refund ledger event, so no refund was made through AcreOS
   * and this is factually zero. It is NOT a stand-in for unknown data.
   */
  box4RefundOfOverpaidInterestCents: number;
  /**
   * Box 5 — Mortgage insurance premiums. Only reportable when
   * §163(h)(3)(E) applies. AcreOS does not collect MI premiums through
   * the note ledger, so this is zero.
   */
  box5MortgageInsurancePremiumCents: number;
  /**
   * Box 6 — Points paid on the purchase of a principal residence. AcreOS
   * records no points ledger event; zero means "none recorded".
   */
  box6PointsPaidCents: number;
  /** Box 7 — property securing the mortgage is the borrower's address. */
  box7PropertyAddressSameAsBorrower: boolean;
  /** Box 8 — address or description of the property securing the mortgage. */
  box8PropertyAddressOrDescription: string;
  /** Box 9 — only when more than one property secures the mortgage. */
  box9NumberOfMortgagedProperties: number | null;
  /** Box 10 — "Other". Free format, not reported to the IRS. */
  box10Other: string;
  /** Box 11 — acquisition date, only when acquired during the tax year. */
  box11MortgageAcquisitionDate: string | null;
}

/** Why a mortgage could not be reported truthfully. */
export type Form1098RefusalCode =
  | "BORROWER_NAME_MISSING"
  | "BORROWER_TIN_MISSING"
  | "BORROWER_TIN_PLACEHOLDER"
  | "BORROWER_ADDRESS_INCOMPLETE"
  | "MORTGAGE_ORIGINATION_DATE_MISSING"
  | "PROPERTY_SECURING_MORTGAGE_UNKNOWN"
  | "LEDGER_COVERAGE_INCOMPLETE"
  | "PRINCIPAL_DERIVATION_INCONSISTENT";

/**
 * A mortgage that WOULD require a 1098 but cannot be reported from the
 * data on hand. The reason is operator-facing and never contains a TIN.
 */
export interface Form1098Refusal {
  source: Form1098Source;
  noteRef: string;
  accountNumber: string;
  codes: Form1098RefusalCode[];
  reason: string;
  /** Interest we did derive, if any — lets the UI rank refusals by impact. */
  derivedInterestCents: number | null;
}

/** Why a mortgage legitimately needs no 1098 (not a failure). */
export type Form1098ExclusionCode =
  | "BELOW_600_THRESHOLD"
  | "NO_INTEREST_RECEIVED"
  | "PAYER_NOT_AN_INDIVIDUAL";

export interface Form1098Exclusion {
  source: Form1098Source;
  noteRef: string;
  code: Form1098ExclusionCode;
  reason: string;
}

/**
 * One mortgage's raw inputs. Deliberately flat and DB-free so the
 * derivation below is a pure function that unit tests can drive from a
 * seeded ledger without a database.
 */
export interface Form1098Candidate {
  source: Form1098Source;
  noteRef: string;
  accountNumber: string;
  /** ISO YYYY-MM-DD, the date the MORTGAGE was originated (never acquired). */
  originationDate: string | null;
  /** ISO YYYY-MM-DD — when this org acquired the mortgage (acquired only). */
  acquisitionDate: string | null;
  /** ISO YYYY-MM-DD — first scheduled payment, when known. */
  firstScheduledPaymentDate: string | null;
  originalPrincipalCents: number;
  /** Live balance maintained by the servicing engine. */
  currentBalanceCents: number;
  borrowerName: string;
  borrowerAddress: PayerOrRecipientAddress;
  /** Ciphertext (or legacy plaintext) TIN, exactly as stored. */
  borrowerEncryptedTin: string | null;
  borrowerTinType: "SSN" | "EIN" | "ITIN" | null;
  /** Address of the property securing the mortgage, when a parcel is attached. */
  propertyAddress: PayerOrRecipientAddress | null;
  /**
   * EVERY posted ledger entry for this mortgage, in any order — not just
   * the tax year's. Full history is required because Box 2 is derived by
   * rolling the current balance back over posted principal.
   */
  ledger: Form1098LedgerEntry[];
}

export interface Form1098LedgerEntry {
  /** ISO YYYY-MM-DD. */
  date: string;
  principalCents: number;
  interestCents: number;
}

export interface Form1098BatchResult {
  taxYear: number;
  organizationId: number;
  formCount: number;
  totalInterestReceivedCents: number;
  forms: Form1098[];
  refusals: Form1098Refusal[];
  exclusions: Form1098Exclusion[];
  /** Base64 PDFs, one per form, aligned by accountNumber. */
  formPdfs: Array<{ accountNumber: string; noteRef: string; pdfBase64: string }>;
  transmittalPdfBase64: string;
  /** Pub 1220 FIRE text. Empty when the batch produced no forms. */
  fireFile: string;
  fireFileBytes: number;
  fireRecordCounts: { T: number; A: number; B: number; C: number; F: number };
  fireValidationErrors: string[];
}

// ─── Date helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a `date`-typed column (string) or `timestamp` column (Date) to
 * an ISO calendar day. ISO day strings compare correctly with `<`/`>=`,
 * which is why the derivation works on strings rather than Date objects
 * (no timezone drift on year boundaries).
 */
export function toIsoDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function yearStartDay(taxYear: number): string {
  return `${taxYear}-01-01`;
}

function yearEndDay(taxYear: number): string {
  return `${taxYear}-12-31`;
}

// ─── TIN helpers (never log, never surface) ───────────────────────────────

function decryptTin(stored: string): string {
  if (!isAnyEncryptedEnvelope(stored)) return stored;
  try {
    return decryptField(stored);
  } catch {
    // Deliberately opaque: a decrypt failure must not leak ciphertext or
    // plaintext into an error. The caller treats "" as missing and refuses.
    return "";
  }
}

function isPlaceholderTin(tin: string): boolean {
  const stripped = tin.replace(/[\s-]/g, "");
  return (
    !stripped ||
    PLACEHOLDER_TINS.has(tin) ||
    PLACEHOLDER_TINS.has(stripped) ||
    /^0{8,9}$/.test(stripped)
  );
}

// ─── Pure derivation ──────────────────────────────────────────────────────

interface PrincipalResolution {
  cents: number;
  basis: OutstandingPrincipalBasis;
}

/**
 * Derive Box 2 — outstanding mortgage principal — or refuse.
 *
 * Four cases, each anchored on a date the IRS instructions name explicitly:
 *
 *  1. Originated during the tax year  → principal at origination (exact).
 *  2. Acquired during the tax year    → balance on the acquisition date.
 *     The org's ledger begins at acquisition, so rolling the live balance
 *     back over every posted principal entry lands exactly there.
 *  3. Held all year, but no payment was scheduled before Jan 1 → no
 *     principal could have been paid, so the original principal is exact.
 *  4. Held all year with payments before Jan 1 → roll the live balance
 *     back over principal posted on/after Jan 1. This requires the ledger
 *     to actually cover the period before Jan 1; if there is no posted
 *     entry before the year started we cannot prove coverage and REFUSE
 *     rather than report a balance that may omit pre-import payments.
 */
function resolveOutstandingPrincipal(
  c: Form1098Candidate,
  taxYear: number,
): PrincipalResolution | { refusal: Form1098RefusalCode } {
  const start = yearStartDay(taxYear);
  const end = yearEndDay(taxYear);

  const origination = c.originationDate;
  const acquisition = c.acquisitionDate;

  // Case 1 — originated during the tax year.
  if (origination && origination >= start && origination <= end) {
    return { cents: c.originalPrincipalCents, basis: "origination_during_year" };
  }

  // Case 2 — acquired during the tax year. Balance at acquisition = live
  // balance + every principal dollar posted since (the ledger starts at
  // acquisition for an acquired note).
  if (acquisition && acquisition >= start && acquisition <= end) {
    const principalSinceAcquisition = c.ledger
      .filter((e) => e.date >= acquisition)
      .reduce((s, e) => s + e.principalCents, 0);
    const cents = c.currentBalanceCents + principalSinceAcquisition;
    if (cents < 0) return { refusal: "PRINCIPAL_DERIVATION_INCONSISTENT" };
    return { cents, basis: "acquisition_during_year" };
  }

  // Case 3 — held from before the year, but nothing was due yet.
  if (c.firstScheduledPaymentDate && c.firstScheduledPaymentDate >= start) {
    return { cents: c.originalPrincipalCents, basis: "no_principal_due_before_year" };
  }

  // Case 4 — held all year. Prove the ledger covers the pre-year period.
  const hasEntryBeforeYear = c.ledger.some((e) => e.date < start);
  if (!hasEntryBeforeYear) {
    return { refusal: "LEDGER_COVERAGE_INCOMPLETE" };
  }
  const principalSinceYearStart = c.ledger
    .filter((e) => e.date >= start)
    .reduce((s, e) => s + e.principalCents, 0);
  const cents = c.currentBalanceCents + principalSinceYearStart;
  if (cents < 0) return { refusal: "PRINCIPAL_DERIVATION_INCONSISTENT" };
  return { cents, basis: "rolled_back_from_current_balance" };
}

/** Is an address complete enough for the Pub 1220 payee fields? */
function addressIsComplete(a: PayerOrRecipientAddress | null): boolean {
  return Boolean(a && a.line1?.trim() && a.city?.trim() && a.state?.trim() && a.zip?.trim());
}

function formatAddressOneLine(a: PayerOrRecipientAddress): string {
  const parts = [a.line1, a.city, a.state, a.zip].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.join(", ");
}

function sameAddress(a: PayerOrRecipientAddress, b: PayerOrRecipientAddress): boolean {
  const norm = (v: string | undefined) => (v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return (
    norm(a.line1) === norm(b.line1) &&
    norm(a.city) === norm(b.city) &&
    norm(a.state) === norm(b.state) &&
    norm(a.zip).slice(0, 5) === norm(b.zip).slice(0, 5)
  );
}

export interface LenderIdentity {
  name: string;
  address: PayerOrRecipientAddress;
  phone: string;
  tin: string;
  tinType: "EIN" | "SSN" | "ITIN";
}

export type Form1098Outcome =
  | { kind: "form"; form: Form1098 }
  | { kind: "refusal"; refusal: Form1098Refusal }
  | { kind: "excluded"; exclusion: Form1098Exclusion };

/**
 * Turn one candidate into a form, a refusal, or an exclusion. PURE — no
 * DB, no clock, no randomness. This is the function that enforces
 * "derived, never estimated".
 */
export function deriveForm1098(
  candidate: Form1098Candidate,
  lender: LenderIdentity,
  taxYear: number,
): Form1098Outcome {
  const start = yearStartDay(taxYear);
  const end = yearEndDay(taxYear);

  // ── Box 1: mortgage interest received, straight off the ledger. ───────
  // Summing signed interest nets NSF reversals (which post negative) so a
  // bounced payment cannot inflate the reported figure.
  const interestCents = candidate.ledger
    .filter((e) => e.date >= start && e.date <= end)
    .reduce((s, e) => s + e.interestCents, 0);

  // ── Exclusions: no form is REQUIRED (this is not a failure). ──────────
  if (interestCents <= 0) {
    return {
      kind: "excluded",
      exclusion: {
        source: candidate.source,
        noteRef: candidate.noteRef,
        code: "NO_INTEREST_RECEIVED",
        reason: `No mortgage interest was received on ${candidate.noteRef} during ${taxYear} — no Form 1098 is required.`,
      },
    };
  }
  if (interestCents < FORM_1098_THRESHOLD_CENTS) {
    return {
      kind: "excluded",
      exclusion: {
        source: candidate.source,
        noteRef: candidate.noteRef,
        code: "BELOW_600_THRESHOLD",
        reason:
          `Mortgage interest received on ${candidate.noteRef} in ${taxYear} was ` +
          `$${(interestCents / 100).toFixed(2)}, below the $600 Form 1098 filing threshold.`,
      },
    };
  }
  // Form 1098 is not required for interest received from a corporation,
  // partnership, trust, estate, association or company other than a sole
  // proprietor. An EIN-type payer is such an entity.
  if (candidate.borrowerTinType === "EIN") {
    return {
      kind: "excluded",
      exclusion: {
        source: candidate.source,
        noteRef: candidate.noteRef,
        code: "PAYER_NOT_AN_INDIVIDUAL",
        reason:
          `The payer on ${candidate.noteRef} is an entity (EIN), not an individual — ` +
          `Form 1098 is not required for interest received from a corporation, ` +
          `partnership, trust, estate, association or company.`,
      },
    };
  }

  // ── Refusal checks: a form IS required but cannot be filled truthfully.
  const codes: Form1098RefusalCode[] = [];

  if (!candidate.borrowerName.trim()) codes.push("BORROWER_NAME_MISSING");

  let borrowerTin = "";
  if (!candidate.borrowerEncryptedTin) {
    codes.push("BORROWER_TIN_MISSING");
  } else {
    borrowerTin = decryptTin(candidate.borrowerEncryptedTin);
    if (!borrowerTin) codes.push("BORROWER_TIN_MISSING");
    else if (isPlaceholderTin(borrowerTin)) codes.push("BORROWER_TIN_PLACEHOLDER");
  }

  if (!addressIsComplete(candidate.borrowerAddress)) {
    codes.push("BORROWER_ADDRESS_INCOMPLETE");
  }

  if (!candidate.originationDate) codes.push("MORTGAGE_ORIGINATION_DATE_MISSING");

  // Box 7/8 — the property securing the mortgage must be identifiable
  // either as "same as the borrower's address" or by its own address.
  const propertyKnown =
    addressIsComplete(candidate.propertyAddress) || addressIsComplete(candidate.borrowerAddress);
  if (!propertyKnown) codes.push("PROPERTY_SECURING_MORTGAGE_UNKNOWN");

  const refuse = (): Form1098Outcome => ({
    kind: "refusal",
    refusal: {
      source: candidate.source,
      noteRef: candidate.noteRef,
      accountNumber: candidate.accountNumber,
      codes,
      derivedInterestCents: interestCents,
      reason: refusalReason(candidate, codes, taxYear, interestCents),
    },
  });

  // Box 2 last, so its refusal reason joins any already collected. Returning
  // inside this branch also narrows `principal` for the rest of the function
  // without a cast.
  const principal = resolveOutstandingPrincipal(candidate, taxYear);
  if ("refusal" in principal) {
    codes.push(principal.refusal);
    return refuse();
  }
  if (codes.length > 0) return refuse();

  const borrowerAddress = candidate.borrowerAddress;
  const propertyAddress = candidate.propertyAddress;
  const propertySameAsBorrower =
    !propertyAddress || sameAddress(propertyAddress, borrowerAddress);

  const acquisition = candidate.acquisitionDate;
  const acquiredThisYear = Boolean(acquisition && acquisition >= start && acquisition <= end);

  return {
    kind: "form",
    form: {
      taxYear,
      source: candidate.source,
      noteRef: candidate.noteRef,
      accountNumber: candidate.accountNumber,

      lenderName: lender.name,
      lenderAddress: lender.address,
      lenderPhone: lender.phone,
      lenderTin: lender.tin,
      lenderTinType: lender.tinType,

      borrowerName: candidate.borrowerName.trim(),
      borrowerAddress,
      borrowerTin,
      // Absent an explicit type, an individual payer's TIN is an SSN. The
      // EIN case has already been excluded above.
      borrowerTinType: candidate.borrowerTinType ?? "SSN",

      box1MortgageInterestReceivedCents: interestCents,
      box2OutstandingMortgagePrincipalCents: principal.cents,
      box2Basis: principal.basis,
      // Non-null: MORTGAGE_ORIGINATION_DATE_MISSING would have refused.
      box3MortgageOriginationDate: candidate.originationDate ?? "",
      box4RefundOfOverpaidInterestCents: 0,
      box5MortgageInsurancePremiumCents: 0,
      box6PointsPaidCents: 0,
      box7PropertyAddressSameAsBorrower: propertySameAsBorrower,
      box8PropertyAddressOrDescription: propertySameAsBorrower
        ? ""
        : formatAddressOneLine(propertyAddress),
      // AcreOS models exactly one parcel per note, so "more than one
      // property secures this mortgage" is never true. Pub 1220 requires
      // blanks (not zeros) when fewer than two.
      box9NumberOfMortgagedProperties: null,
      box10Other: "",
      box11MortgageAcquisitionDate: acquiredThisYear ? acquisition : null,
    },
  };
}

function refusalReason(
  candidate: Form1098Candidate,
  codes: Form1098RefusalCode[],
  taxYear: number,
  interestCents: number,
): string {
  const explain: Record<Form1098RefusalCode, string> = {
    BORROWER_NAME_MISSING: "the borrower's name is missing",
    BORROWER_TIN_MISSING: "the borrower has no taxpayer identification number on file (collect a Form W-9)",
    BORROWER_TIN_PLACEHOLDER:
      "the borrower's taxpayer identification number on file is a placeholder, not a real TIN (collect a Form W-9)",
    BORROWER_ADDRESS_INCOMPLETE:
      "the borrower's mailing address is incomplete (street, city, state and ZIP are all required)",
    MORTGAGE_ORIGINATION_DATE_MISSING:
      "the mortgage origination date required by Box 3 is not recorded",
    PROPERTY_SECURING_MORTGAGE_UNKNOWN:
      "the property securing the mortgage cannot be identified for Box 7/8 — no parcel is attached and the borrower's address is unknown",
    LEDGER_COVERAGE_INCOMPLETE:
      `the payment ledger contains no entry before ${taxYear}-01-01, so the outstanding principal on January 1 required by Box 2 cannot be derived — it would understate any principal paid before AcreOS began servicing this note`,
    PRINCIPAL_DERIVATION_INCONSISTENT:
      "rolling the current balance back over posted principal produced a negative outstanding principal, so the ledger and the stored balance disagree",
  };
  const reasons = codes.map((c) => explain[c]);
  const joined =
    reasons.length === 1
      ? reasons[0]
      : `${reasons.slice(0, -1).join("; ")}; and ${reasons[reasons.length - 1]}`;
  return (
    `Form 1098 REFUSED for ${candidate.noteRef} (${taxYear}): ` +
    `$${(interestCents / 100).toFixed(2)} of mortgage interest was received, so a form is required, ` +
    `but ${joined}. No form was produced — a wrong Form 1098 is worse than a missing one.`
  );
}

/**
 * Derive a whole batch. De-dupes by (source, noteRef) so a candidate list
 * containing the same mortgage twice cannot produce two forms or
 * double-count interest — the idempotency guarantee at the derivation
 * layer.
 */
export function derive1098Batch(
  candidates: Form1098Candidate[],
  lender: LenderIdentity,
  taxYear: number,
): {
  forms: Form1098[];
  refusals: Form1098Refusal[];
  exclusions: Form1098Exclusion[];
} {
  const seen = new Set<string>();
  const forms: Form1098[] = [];
  const refusals: Form1098Refusal[] = [];
  const exclusions: Form1098Exclusion[] = [];

  for (const c of candidates) {
    const key = `${c.source}::${c.noteRef}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const outcome = deriveForm1098(c, lender, taxYear);
    if (outcome.kind === "form") forms.push(outcome.form);
    else if (outcome.kind === "refusal") refusals.push(outcome.refusal);
    else exclusions.push(outcome.exclusion);
  }

  // Stable ordering so regeneration is byte-identical.
  forms.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  refusals.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  exclusions.sort((a, b) => a.noteRef.localeCompare(b.noteRef));

  return { forms, refusals, exclusions };
}

// ─── PDF rendering ────────────────────────────────────────────────────────

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Render one Form 1098 as a single-page PDF. This is a substitute
 * statement for the borrower (Copy B) — AcreOS does not print the
 * scannable red-ink Copy A, which must come from an IRS-approved vendor.
 */
export function render1098Pdf(f: Form1098): Buffer {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.5;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Form 1098 — Mortgage Interest Statement", margin, y + 0.2);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Tax Year: ${f.taxYear}`, 7.0, y + 0.2, { align: "right" });
  y += 0.55;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("RECIPIENT'S/LENDER'S name and address", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(f.lenderName, margin, y + 0.18);
  doc.text(f.lenderAddress.line1, margin, y + 0.34);
  doc.text(
    `${f.lenderAddress.city}, ${f.lenderAddress.state} ${f.lenderAddress.zip}`,
    margin,
    y + 0.5,
  );
  if (f.lenderPhone) doc.text(`Phone: ${f.lenderPhone}`, margin, y + 0.66);
  doc.text(`RECIPIENT'S TIN: ${f.lenderTin}`, margin, y + 0.82);

  doc.setFont("helvetica", "bold");
  doc.text("PAYER'S/BORROWER'S name and address", 4.3, y);
  doc.setFont("helvetica", "normal");
  doc.text(f.borrowerName, 4.3, y + 0.18);
  doc.text(f.borrowerAddress.line1, 4.3, y + 0.34);
  doc.text(
    `${f.borrowerAddress.city}, ${f.borrowerAddress.state} ${f.borrowerAddress.zip}`,
    4.3,
    y + 0.5,
  );
  doc.text(`PAYER'S TIN: ${f.borrowerTin}`, 4.3, y + 0.82);
  y += 1.15;

  doc.text(`Account number: ${f.accountNumber}`, margin, y);
  y += 0.32;

  const boxes: Array<[string, string]> = [
    ["1. Mortgage interest received from payer(s)/borrower(s)", money(f.box1MortgageInterestReceivedCents)],
    ["2. Outstanding mortgage principal", money(f.box2OutstandingMortgagePrincipalCents)],
    ["3. Mortgage origination date", f.box3MortgageOriginationDate],
    ["4. Refund of overpaid interest", money(f.box4RefundOfOverpaidInterestCents)],
    ["5. Mortgage insurance premiums", money(f.box5MortgageInsurancePremiumCents)],
    ["6. Points paid on purchase of principal residence", money(f.box6PointsPaidCents)],
    [
      "7. Address of property securing mortgage is same as PAYER'S/BORROWER'S address",
      f.box7PropertyAddressSameAsBorrower ? "Yes" : "No",
    ],
    [
      "8. Address or description of property securing mortgage",
      f.box8PropertyAddressOrDescription || "(same as borrower's address)",
    ],
    [
      "9. Number of properties securing the mortgage",
      f.box9NumberOfMortgagedProperties === null
        ? "—"
        : String(f.box9NumberOfMortgagedProperties),
    ],
    ["10. Other", f.box10Other || "—"],
    ["11. Mortgage acquisition date", f.box11MortgageAcquisitionDate ?? "—"],
  ];

  doc.setFontSize(9);
  for (const [label, value] of boxes) {
    const wrapped = doc.splitTextToSize(label, 5.2) as string[];
    doc.text(wrapped, margin, y);
    doc.text(value, 7.0, y, { align: "right" });
    y += 0.18 * Math.max(1, wrapped.length);
  }

  y += 0.25;
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  const footer = doc.splitTextToSize(
    "This is a substitute Form 1098 furnished to the borrower. The information in boxes 1 " +
      "through 11 is being reported to the Internal Revenue Service. Figures are derived from " +
      "posted ledger entries for the tax year shown.",
    6.5,
  ) as string[];
  doc.text(footer, margin, y);

  return Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
}

/**
 * Render the Form 1096 annual summary + transmittal for a 1098 batch.
 * Box 5 on a 1096 transmitting Forms 1098 carries the total of Box 1
 * (mortgage interest received) across the batch.
 */
export function render1096For1098Pdf(forms: Form1098[], taxYear: number): Buffer {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.5;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Form 1096 — Annual Summary and Transmittal", margin, y + 0.25);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Tax Year: ${taxYear}`, 7.0, y + 0.25, { align: "right" });
  y += 0.7;

  const first = forms[0];
  if (first) {
    doc.setFont("helvetica", "bold");
    doc.text("Filer", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(first.lenderName, margin, y + 0.18);
    doc.text(first.lenderAddress.line1, margin, y + 0.34);
    doc.text(
      `${first.lenderAddress.city}, ${first.lenderAddress.state} ${first.lenderAddress.zip}`,
      margin,
      y + 0.5,
    );
    doc.text(`Federal TIN: ${first.lenderTin}`, margin, y + 0.66);
    y += 1.0;
  }

  const totalInterest = forms.reduce((s, f) => s + f.box1MortgageInterestReceivedCents, 0);

  const rows: Array<[string, string]> = [
    ["Box 3. Total number of forms", String(forms.length)],
    ["Box 4. Federal income tax withheld", money(0)],
    ["Box 5. Total amount reported (Box 1 of Forms 1098)", money(totalInterest)],
    ["Form being transmitted", "1098"],
  ];
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "bold");
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, 7.0, y, { align: "right" });
    y += 0.26;
  }

  y += 0.2;
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(
    "Generated by AcreOS. For paper filing, Copy A must be printed on IRS-approved scannable forms.",
    margin,
    y,
  );

  return Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
}

// ─── FIRE (Pub 1220) assembly ─────────────────────────────────────────────

/**
 * Build the Pub 1220 FIRE file for a 1098 batch.
 *
 * The record layout lives in `irsFireFormat.ts` and was verified
 * field-by-field against IRS Publication 1220 (Rev. 5-2026): Type of
 * Return "3", Amount Codes 1/2/3/4/6, and the Form 1098 payee-record tail
 * at positions 544-750.
 */
export function build1098FireFile(forms: Form1098[], taxYear: number): FireFileResult | null {
  const first = forms[0];
  if (!first) return null;

  const transmitter: TransmitterRecord = {
    taxYear,
    tcc: process.env.IRS_TCC ?? "00000",
    transmitterTin: first.lenderTin,
    transmitterName: first.lenderName,
    transmitterAddress: first.lenderAddress.line1,
    city: first.lenderAddress.city,
    state: first.lenderAddress.state,
    zip: first.lenderAddress.zip,
    contactName: first.lenderName,
    contactPhone: first.lenderPhone,
    contactEmail: process.env.IRS_CONTACT_EMAIL ?? "",
    testIndicator: process.env.IRS_FIRE_TEST === "true" ? "T" : " ",
  };

  const issuer: Omit<IssuerRecord, "returnType" | "amountCodes"> = {
    taxYear,
    payerTin: first.lenderTin,
    nameControl: nameControlFor(first.lenderName),
    payerName: first.lenderName,
    payerAddress: first.lenderAddress.line1,
    payerCity: first.lenderAddress.city,
    payerState: first.lenderAddress.state,
    payerZip: first.lenderAddress.zip,
    payerPhone: first.lenderPhone,
  };

  const payees: Payee1098Record[] = forms.map((f) => ({
    taxYear,
    mortgageInterestReceivedCents: f.box1MortgageInterestReceivedCents,
    outstandingMortgagePrincipalCents: f.box2OutstandingMortgagePrincipalCents,
    refundOfOverpaidInterestCents: f.box4RefundOfOverpaidInterestCents,
    pointsPaidCents: f.box6PointsPaidCents,
    mortgageInsurancePremiumCents: f.box5MortgageInsurancePremiumCents,
    mortgageOriginationDate: f.box3MortgageOriginationDate,
    propertySecuringMortgageIsBorrowerAddress: f.box7PropertyAddressSameAsBorrower,
    propertyAddressOrDescription: f.box8PropertyAddressOrDescription,
    numberOfMortgagedProperties: f.box9NumberOfMortgagedProperties ?? undefined,
    mortgageAcquisitionDate: f.box11MortgageAcquisitionDate,
    recipientTin: f.borrowerTin,
    recipientTinType: f.borrowerTinType,
    accountNumber: f.accountNumber,
    recipientName: f.borrowerName,
    recipientAddress: f.borrowerAddress.line1,
    recipientCity: f.borrowerAddress.city,
    recipientState: f.borrowerAddress.state,
    recipientZip: f.borrowerAddress.zip,
    nameControl: nameControlFor(surnameOf(f.borrowerName)),
  }));

  return buildFire1098File({ transmitter, issuer, payees });
}

/** Pub 1220 name control is built from the payee's SURNAME. */
function surnameOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1]! : name;
}

// ─── Lender (issuer) identity ─────────────────────────────────────────────

/**
 * Resolve the filer's identity from the org row. Mirrors the 1099 path's
 * contract: missing identity throws TaxIdentityError so the whole batch
 * fails loudly rather than emitting forms with placeholder identifiers.
 */
export async function resolveLenderIdentity(orgId: number): Promise<LenderIdentity> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) {
    throw new TaxIdentityError(
      "PAYER_NAME_MISSING",
      `Organization ${orgId} not found — cannot issue Forms 1098.`,
      { orgId },
    );
  }
  const name = org.legalEntityName?.trim() || org.name?.trim();
  if (!name) {
    throw new TaxIdentityError(
      "PAYER_NAME_MISSING",
      `Organization ${orgId} has no legal entity name — required on Form 1098 as RECIPIENT'S/LENDER'S name.`,
      { orgId },
    );
  }
  if (!org.ein) {
    throw new TaxIdentityError(
      "PAYER_EIN_MISSING",
      `Organization ${orgId} has no EIN on file — required on Form 1098 as RECIPIENT'S TIN.`,
      { orgId },
    );
  }
  const tin = decryptTin(org.ein);
  if (isPlaceholderTin(tin)) {
    throw new TaxIdentityError(
      "PAYER_EIN_MISSING",
      `Organization ${orgId} has a placeholder EIN on file — capture the real EIN before issuing Forms 1098.`,
      { orgId },
    );
  }
  const tinTypeRaw = org.taxIdType;
  const tinType: LenderIdentity["tinType"] =
    tinTypeRaw === "SSN" || tinTypeRaw === "ITIN" ? tinTypeRaw : "EIN";

  return {
    name,
    address: {
      line1: org.taxAddress?.line1 || "",
      line2: org.taxAddress?.line2,
      city: org.taxAddress?.city || "",
      state: org.taxAddress?.state || "",
      zip: org.taxAddress?.zip || "",
      country: org.taxAddress?.country,
    },
    phone: org.taxAddress?.phone || "",
    tin,
    tinType,
  };
}

// ─── Candidate collection (DB reads) ──────────────────────────────────────

function normalizeTinType(v: string | null | undefined): "SSN" | "EIN" | "ITIN" | null {
  return v === "SSN" || v === "EIN" || v === "ITIN" ? v : null;
}

function centsFromNumeric(v: string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Candidates from ACQUIRED notes: `acquired_notes` + the `note_payments`
 * ledger (integer cents, with NSF reversals posting negative).
 */
export async function collectAcquiredCandidates(
  orgId: number,
): Promise<Form1098Candidate[]> {
  const rows = await db
    .select()
    .from(acquiredNotes)
    .where(eq(acquiredNotes.organizationId, orgId));
  if (rows.length === 0) return [];

  const noteIds = rows.map((r) => r.id);
  const ledgerRows = await db
    .select({
      noteId: notePayments.noteId,
      paymentDate: notePayments.paymentDate,
      principalCents: notePayments.principalCents,
      interestCents: notePayments.interestCents,
    })
    .from(notePayments)
    .where(inArray(notePayments.noteId, noteIds));

  const ledgerByNote = new Map<string, Form1098LedgerEntry[]>();
  for (const l of ledgerRows) {
    const day = toIsoDay(l.paymentDate);
    if (!day) continue;
    const list = ledgerByNote.get(l.noteId) ?? [];
    list.push({
      date: day,
      principalCents: l.principalCents,
      interestCents: l.interestCents,
    });
    ledgerByNote.set(l.noteId, list);
  }

  const propertyIds = rows.map((r) => r.propertyId).filter((id): id is number => id !== null);
  const propertyById = await loadProperties(propertyIds);

  return rows.map((r): Form1098Candidate => ({
    source: "acquired",
    noteRef: `ANOTE-${r.noteNumber}`,
    accountNumber: `ANOTE-${r.noteNumber}`.slice(0, 20),
    originationDate: toIsoDay(r.originationDate),
    acquisitionDate: toIsoDay(r.acquisitionDate),
    firstScheduledPaymentDate: null,
    originalPrincipalCents: r.originalPrincipalCents,
    currentBalanceCents: r.currentBalanceCents,
    borrowerName: r.payerName ?? "",
    borrowerAddress: {
      line1: r.payerAddress?.line1 || "",
      line2: r.payerAddress?.line2,
      city: r.payerAddress?.city || "",
      state: r.payerAddress?.state || "",
      zip: r.payerAddress?.zip || "",
      country: r.payerAddress?.country,
    },
    borrowerEncryptedTin: r.payerEncryptedTin,
    borrowerTinType: normalizeTinType(r.payerTinType),
    propertyAddress: r.propertyId ? (propertyById.get(r.propertyId) ?? null) : null,
    ledger: ledgerByNote.get(r.id) ?? [],
  }));
}

/**
 * Candidates from ORIGINATED notes: `notes` + the `payments` ledger.
 * Only COMPLETED payments are posted entries — pending/failed/refunded
 * rows are not money received and must not appear on a tax form.
 */
export async function collectOriginatedCandidates(
  orgId: number,
): Promise<Form1098Candidate[]> {
  const rows = await db.select().from(notes).where(eq(notes.organizationId, orgId));
  if (rows.length === 0) return [];

  const noteIds = rows.map((r) => r.id);
  const ledgerRows = await db
    .select({
      noteId: payments.noteId,
      paymentDate: payments.paymentDate,
      principalAmount: payments.principalAmount,
      interestAmount: payments.interestAmount,
    })
    .from(payments)
    .where(and(inArray(payments.noteId, noteIds), eq(payments.status, "completed")));

  const ledgerByNote = new Map<number, Form1098LedgerEntry[]>();
  for (const l of ledgerRows) {
    const day = toIsoDay(l.paymentDate);
    if (!day) continue;
    const list = ledgerByNote.get(l.noteId) ?? [];
    // Round each row to cents before summing — never sum floats then round.
    list.push({
      date: day,
      principalCents: centsFromNumeric(l.principalAmount),
      interestCents: centsFromNumeric(l.interestAmount),
    });
    ledgerByNote.set(l.noteId, list);
  }

  const borrowerIds = rows.map((r) => r.borrowerId).filter((id): id is number => id !== null);
  const borrowerById = await loadBorrowers(borrowerIds);

  const propertyIds = rows.map((r) => r.propertyId).filter((id): id is number => id !== null);
  const propertyById = await loadProperties(propertyIds);

  return rows.map((r): Form1098Candidate => {
    const borrower = r.borrowerId ? borrowerById.get(r.borrowerId) : undefined;
    return {
      source: "originated",
      noteRef: `NOTE-${r.id}`,
      accountNumber: `NOTE-${r.id}`.slice(0, 20),
      originationDate: toIsoDay(r.startDate),
      acquisitionDate: null,
      firstScheduledPaymentDate: toIsoDay(r.firstPaymentDate),
      originalPrincipalCents: centsFromNumeric(r.originalPrincipal),
      currentBalanceCents: centsFromNumeric(r.currentBalance),
      borrowerName: borrower?.name ?? "",
      borrowerAddress: borrower?.address ?? { line1: "", city: "", state: "", zip: "" },
      borrowerEncryptedTin: borrower?.encryptedTin ?? null,
      borrowerTinType: borrower?.tinType ?? null,
      propertyAddress: r.propertyId ? (propertyById.get(r.propertyId) ?? null) : null,
      ledger: ledgerByNote.get(r.id) ?? [],
    };
  });
}

interface BorrowerIdentity {
  name: string;
  address: PayerOrRecipientAddress;
  encryptedTin: string | null;
  tinType: "SSN" | "EIN" | "ITIN" | null;
}

async function loadBorrowers(ids: number[]): Promise<Map<number, BorrowerIdentity>> {
  const out = new Map<number, BorrowerIdentity>();
  if (ids.length === 0) return out;
  const rows = await db.select().from(leads).where(inArray(leads.id, ids));
  for (const l of rows) {
    out.set(l.id, {
      name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim(),
      address: {
        line1: l.address || "",
        city: l.city || "",
        state: l.state || "",
        zip: l.zip || "",
      },
      encryptedTin: l.taxId ?? null,
      tinType: normalizeTinType(l.taxIdType),
    });
  }
  return out;
}

async function loadProperties(ids: number[]): Promise<Map<number, PayerOrRecipientAddress>> {
  const out = new Map<number, PayerOrRecipientAddress>();
  if (ids.length === 0) return out;
  const rows = await db.select().from(properties).where(inArray(properties.id, ids));
  for (const p of rows) {
    out.set(p.id, {
      line1: p.address || "",
      city: p.city || "",
      state: p.state || "",
      zip: p.zip || "",
    });
  }
  return out;
}

// ─── Public entry point ───────────────────────────────────────────────────

/**
 * Generate the Form 1098 batch for an org + tax year.
 *
 * Idempotent by construction: a pure derivation over the ledger with no
 * counters, no accumulation and no writes. Running it twice for the same
 * tax year produces identical forms, identical totals and an identical
 * FIRE file. Nothing is double-counted because each mortgage is keyed once
 * by (source, noteRef).
 */
export async function generate1098Batch(
  orgId: number,
  taxYear: number,
): Promise<Form1098BatchResult> {
  const lender = await resolveLenderIdentity(orgId);

  const [acquired, originated] = await Promise.all([
    collectAcquiredCandidates(orgId),
    collectOriginatedCandidates(orgId),
  ]);

  const { forms, refusals, exclusions } = derive1098Batch(
    [...originated, ...acquired],
    lender,
    taxYear,
  );

  const formPdfs = forms.map((f) => ({
    accountNumber: f.accountNumber,
    noteRef: f.noteRef,
    pdfBase64: render1098Pdf(f).toString("base64"),
  }));
  const transmittal = render1096For1098Pdf(forms, taxYear);

  const fire = build1098FireFile(forms, taxYear);
  const fireValidationErrors = fire ? validateFireFile(fire.text) : [];

  const totalInterestReceivedCents = forms.reduce(
    (s, f) => s + f.box1MortgageInterestReceivedCents,
    0,
  );

  // Structured, TIN-free telemetry. Refusal CODES are logged; refusal
  // reasons and borrower identifiers are not.
  logger.info("form1098Batch.generated", {
    organizationId: orgId,
    taxYear,
    formCount: forms.length,
    refusalCount: refusals.length,
    exclusionCount: exclusions.length,
    refusalCodes: Array.from(new Set(refusals.flatMap((r) => r.codes))),
    totalInterestReceivedCents,
    fireFileBytes: fire?.bytes ?? 0,
    fireValidationErrorCount: fireValidationErrors.length,
  });
  if (fireValidationErrors.length > 0) {
    logger.error(
      "form1098Batch.fireValidationFailed",
      new Error(fireValidationErrors.join("; ")),
    );
  }

  return {
    taxYear,
    organizationId: orgId,
    formCount: forms.length,
    totalInterestReceivedCents,
    forms,
    refusals,
    exclusions,
    formPdfs,
    transmittalPdfBase64: transmittal.toString("base64"),
    fireFile: fire?.text ?? "",
    fireFileBytes: fire?.bytes ?? 0,
    fireRecordCounts: fire?.recordCounts ?? { T: 0, A: 0, B: 0, C: 0, F: 0 },
    fireValidationErrors,
  };
}
