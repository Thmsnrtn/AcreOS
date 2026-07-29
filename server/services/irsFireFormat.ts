/**
 * IRS Filing Information Returns Electronically (FIRE) — fixed-width
 * record generator.
 *
 * Reference: IRS Publication 1220 (Rev. 5-2026), "Specifications for
 * Electronic Filing of Forms 1097, 1098, 1099, 3921, 3922, 5498, and
 * W-2G," For Tax Year 2025. Every field position in this file was read
 * out of that document — see `docs`-style comments carrying the spec's
 * 1-based positions next to each field. Positions are NOT guessed; if a
 * field is not in the comment table below it is not emitted.
 *
 * A FIRE submission is a single ASCII text file whose lines are fixed-
 * width records. Each line is exactly 750 characters + a CR/LF
 * terminator. The record types are:
 *
 *   T — Transmitter          (one per file, first record)
 *   A — Issuer/Payer         (one per issuer + return type)
 *   B — Payee                (one per recipient)
 *   C — End-of-Issuer totals (one per A; closes the A block)
 *   K — State totals         (CF/SF only — not emitted, see below)
 *   F — End-of-Transmission  (one per file, last record)
 *
 * Pub 1220 Part C: positions 1-543 of the "B" record are identical for
 * every return type; positions 544-750 vary per form. That structure is
 * mirrored here — `buildBRecordCommon()` emits 1-543 and each form
 * appends its own tail.
 *
 * What we DO emit
 * ───────────────
 * • Form 1099-INT — Amount Codes 1-4 (interest income, early-withdrawal
 *   penalty, US savings-bond interest, federal income tax withheld).
 * • Form 1098 (Mortgage Interest Statement) — Amount Codes 1 (mortgage
 *   interest received), 3 (refund of overpaid interest) and 6
 *   (outstanding mortgage principal), plus the 1098-specific tail
 *   (mortgage origination date, property-securing indicator + address,
 *   number of mortgaged properties, mortgage acquisition date).
 *
 * What we DON'T emit (yet)
 * ────────────────────────
 * - State filing "K" record — requires per-state participation in the
 *   Combined Federal/State Filing Program. Federal file only.
 * - Multi-issuer files — one A block per file.
 * - Negative amounts / over-punch (only used by 1099-B/OID/Q).
 *
 * Validation
 * ──────────
 * Two layers, both mechanical:
 *   1. `assembleRecord()` refuses to build a record whose declared
 *      fields are not contiguous or whose value length differs from the
 *      spec length. A layout typo is a thrown error, not a silently
 *      mis-aligned file.
 *   2. `validateFireFile()` checks record length, type sequencing,
 *      balanced A/C counts and the Required ascending record-sequence
 *      numbers (Pub 1220, positions 500-507 of every record).
 * The IRS test system additionally runs TIN-format and tax-math checks;
 * those are out of scope here.
 */

const RECORD_LEN = 750;
const TERMINATOR = "\r\n";

// ─── Field primitives ─────────────────────────────────────────────────────

/**
 * One declared field of a fixed-width record. `start` is the Pub 1220
 * 1-based position; `len` is the spec length.
 */
interface Field {
  start: number;
  len: number;
  value: string;
}

/** Right-justify, zero-fill a numeric field. */
function num(value: number | string, width: number): string {
  const s = typeof value === "number" ? Math.max(0, Math.round(value)).toString() : value;
  if (s.length >= width) return s.slice(-width);
  return s.padStart(width, "0");
}

/** Left-justify, blank-fill an alpha field. */
function alpha(value: string | null | undefined, width: number): string {
  const s = (value ?? "").toString().toUpperCase();
  if (s.length >= width) return s.slice(0, width);
  return s.padEnd(width, " ");
}

/**
 * Money field. Pub 1220 Sec. 3: "Each payment amount must contain U.S.
 * dollars and cents. The right-most two positions represent cents." So an
 * integer-cents value right-justified zero-filled is exactly the required
 * encoding — no decimal point, no sign.
 */
function money(cents: number, width: number): string {
  return num(Math.max(0, Math.round(cents)), width);
}

/** Strip non-digits from a TIN. Pub 1220 forbids dashes/spaces/alphas. */
function tin(value: string | null | undefined, width = 9): string {
  const stripped = (value ?? "").replace(/[^0-9]/g, "");
  return num(stripped, width);
}

/**
 * YYYYMMDD date field. Accepts an ISO date/timestamp string or a Date.
 * Returns `width` blanks when the value is absent — the spec's "enter
 * blanks" for a date that does not apply. We never substitute a
 * plausible date.
 */
function date8(value: string | Date | null | undefined, width = 8): string {
  if (!value) return " ".repeat(width);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return " ".repeat(width);
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}${m}${day}`.padEnd(width, " ").slice(0, width);
}

/**
 * Name Control — Pub 1220 Payee "B" Record positions 7-10 and Issuer "A"
 * Record positions 21-24: "the first four characters" of the payee's
 * surname (or of the entity's name). Non-alpha characters are dropped and
 * the result is upper-cased. Shorter names are blank-filled by the field
 * constructor, so a 2-letter surname yields "XX  " rather than padding
 * with invented letters.
 *
 * Canonical home for this helper: it is a Publication 1220 concept, and
 * both the 1098 and 1099-INT batch builders need it.
 */
export function nameControlFor(name: string): string {
  return name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
}

// Field constructors — each keeps the spec position next to the value so
// the record builders below read like the publication's field tables.
const F = {
  /** Literal / alpha (left-justified, blank-filled). */
  a(start: number, end: number, value: string | null | undefined): Field {
    const len = end - start + 1;
    return { start, len, value: alpha(value, len) };
  },
  /** Numeric (right-justified, zero-filled). */
  n(start: number, end: number, value: number | string): Field {
    const len = end - start + 1;
    return { start, len, value: num(value, len) };
  },
  /** Money in integer cents. */
  m(start: number, end: number, cents: number): Field {
    const len = end - start + 1;
    return { start, len, value: money(cents, len) };
  },
  /** Nine-position TIN. */
  tin(start: number, end: number, value: string | null | undefined): Field {
    const len = end - start + 1;
    return { start, len, value: tin(value, len) };
  },
  /** YYYYMMDD, or blanks when absent. */
  date(start: number, end: number, value: string | Date | null | undefined): Field {
    const len = end - start + 1;
    return { start, len, value: date8(value, len) };
  },
  /** Spec-mandated blanks. */
  blank(start: number, end: number): Field {
    const len = end - start + 1;
    return { start, len, value: " ".repeat(len) };
  },
  /** Spec-mandated zeros. */
  zero(start: number, end: number): Field {
    const len = end - start + 1;
    return { start, len, value: "0".repeat(len) };
  },
};

/**
 * Concatenate declared fields, asserting the layout is contiguous and
 * every value is exactly its spec length. A mis-declared position throws
 * rather than producing a subtly mis-aligned record that the IRS would
 * reject (or worse, silently mis-read).
 */
function assembleRecord(recordName: string, fields: Field[], expectedEnd = RECORD_LEN): string {
  let out = "";
  let pos = 1;
  for (const f of fields) {
    if (f.start !== pos) {
      throw new Error(
        `FIRE ${recordName}: field declared at position ${f.start} but previous field ends at ${pos - 1} (expected start ${pos}).`,
      );
    }
    if (f.value.length !== f.len) {
      throw new Error(
        `FIRE ${recordName}: field at position ${f.start} is ${f.value.length} chars, spec length is ${f.len}.`,
      );
    }
    out += f.value;
    pos += f.len;
  }
  if (pos - 1 !== expectedEnd) {
    throw new Error(
      `FIRE ${recordName}: assembled ${pos - 1} positions, expected ${expectedEnd}.`,
    );
  }
  return out;
}

// ─── Transmitter "T" Record — Pub 1220 Part C Sec. 1 ──────────────────────

export interface TransmitterRecord {
  /** Payment (tax) year e.g. 2025. */
  taxYear: number;
  /** Transmitter Control Code (TCC) — 5 chars, assigned by the IRS. */
  tcc: string;
  /** Transmitter (filer) TIN — usually our customer's EIN. */
  transmitterTin: string;
  transmitterName: string;
  /** Company mailing address (positions 190-229). */
  transmitterAddress: string;
  city: string;
  state: string;
  zip: string;
  /** Contact name + phone + email for IRS questions (Required). */
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** "T" for a test file, " " for production (position 28). */
  testIndicator?: "T" | " ";
  /**
   * Total number of Payee "B" Records in the file (positions 296-303).
   * `buildFireFile` fills this in; callers may leave it undefined.
   */
  totalPayees?: number;
  /**
   * "P" only when reporting prior-year data (position 6). Left blank for
   * the current tax year — the FIRE System rejects a "P" on a
   * current-year file.
   */
  priorYearIndicator?: "P" | " ";
}

/**
 * Vendor Indicator (position 518) is Required. AcreOS generates these
 * files with its own code, which Pub 1220 defines as "produced by
 * in-house programmers" → "I". Positions 519-704 (vendor name / address /
 * contact) are then blank per the spec.
 */
const VENDOR_INDICATOR_IN_HOUSE = "I";

export function buildTRecord(t: TransmitterRecord, sequenceNumber = 1): string {
  return assembleRecord("T", [
    F.a(1, 1, "T"), //                              Record Type
    F.n(2, 5, t.taxYear), //                        Payment Year
    F.a(6, 6, t.priorYearIndicator ?? " "), //      Prior Year Data Indicator
    F.tin(7, 15, t.transmitterTin), //              Transmitter's TIN
    F.a(16, 20, t.tcc), //                          Transmitter Control Code
    F.blank(21, 27),
    F.a(28, 28, t.testIndicator ?? " "), //         Test File Indicator
    F.a(29, 29, " "), //                            Foreign Entity Indicator
    F.a(30, 69, t.transmitterName), //              Transmitter Name
    F.a(70, 109, ""), //                            Transmitter Name (continuation)
    F.a(110, 149, t.transmitterName), //            Company Name
    F.a(150, 189, ""), //                           Company Name (continuation)
    F.a(190, 229, t.transmitterAddress), //         Company Mailing Address
    F.a(230, 269, t.city), //                       Company City
    F.a(270, 271, t.state), //                      Company State
    F.a(272, 280, t.zip), //                        Company ZIP Code
    F.blank(281, 295),
    F.n(296, 303, t.totalPayees ?? 0), //           Total Number of Payees
    F.a(304, 343, t.contactName), //                Contact Name
    F.a(344, 358, t.contactPhone), //               Contact Telephone & Extension
    F.a(359, 408, t.contactEmail), //               Contact Email Address
    F.blank(409, 499),
    F.n(500, 507, sequenceNumber), //               Record Sequence Number
    F.blank(508, 517),
    F.a(518, 518, VENDOR_INDICATOR_IN_HOUSE), //    Vendor Indicator
    F.blank(519, 558), //                           Vendor Name
    F.blank(559, 598), //                           Vendor Mailing Address
    F.blank(599, 638), //                           Vendor City
    F.blank(639, 640), //                           Vendor State
    F.blank(641, 649), //                           Vendor ZIP Code
    F.blank(650, 689), //                           Vendor Contact Name
    F.blank(690, 704), //                           Vendor Contact Telephone
    F.blank(705, 739),
    F.a(740, 740, " "), //                          Vendor Foreign Entity Indicator
    F.blank(741, 748),
    F.blank(749, 750), //                           Blank or CR/LF
  ]);
}

// ─── Issuer "A" Record — Pub 1220 Part C Sec. 2 ───────────────────────────

/**
 * Return types AcreOS emits. Codes are Pub 1220 (Rev. 5-2026) Issuer "A"
 * Record positions 26-27, "Type of Return":
 *   1098     → "3"
 *   1099-INT → "6"
 * Left-justified, blank-filled to 2 positions.
 */
export type FireReturnType = "INT" | "1098";

const RETURN_TYPE_CODES: Record<FireReturnType, string> = {
  "1098": "3",
  INT: "6",
};

/**
 * Amount Codes, Pub 1220 Issuer "A" Record positions 28-45.
 *
 * Form 1098 (verified against the publication's amount-code table):
 *   1 — Mortgage interest received from payer(s)/borrower(s)
 *   2 — Points paid on the purchase of a principal residence
 *   3 — Refund or credit of overpaid interest
 *   4 — Mortgage Insurance Premium (only when §163(h)(3)(E) applies)
 *   5 — Blank (filer's use)
 *   6 — Outstanding Mortgage Principal
 *
 * Form 1099-INT:
 *   1 — Interest income, 2 — Early withdrawal penalty,
 *   3 — Interest on US Savings Bonds/Treasury, 4 — Federal tax withheld,
 *   5 — Investment expenses, 6 — Foreign tax paid,
 *   8 — Tax-exempt interest, 9 — Specified private activity bond interest
 *
 * The code number selects the Payment Amount field in the "B" record:
 * code 1 → Payment Amount 1 (positions 55-66), code 3 → Payment Amount 3
 * (79-90), code 6 → Payment Amount 6 (115-126), etc.
 */
export const FORM_1098_AMOUNT_CODES = {
  mortgageInterestReceived: "1",
  pointsPaid: "2",
  refundOfOverpaidInterest: "3",
  mortgageInsurancePremium: "4",
  outstandingMortgagePrincipal: "6",
} as const;

export interface IssuerRecord {
  taxYear: number;
  /** Issuer's TIN (EIN). */
  payerTin: string;
  /** Issuer name control — first 4 characters of the legal entity name. */
  nameControl: string;
  payerName: string;
  payerAddress: string;
  payerCity: string;
  payerState: string;
  payerZip: string;
  payerPhone: string;
  returnType: FireReturnType;
  /**
   * Amount codes present in this A block, ascending, numerics before
   * alphas (e.g. "136" for a 1098 batch reporting interest + refunds +
   * outstanding principal).
   */
  amountCodes: string;
}

export function buildARecord(a: IssuerRecord, sequenceNumber = 2): string {
  return assembleRecord("A", [
    F.a(1, 1, "A"), //                            Record Type
    F.n(2, 5, a.taxYear), //                      Payment Year
    F.a(6, 6, " "), //                            CF/SF Indicator (off — federal only)
    F.blank(7, 11),
    F.tin(12, 20, a.payerTin), //                 Issuer's TIN
    F.a(21, 24, a.nameControl), //                Issuer Name Control
    F.a(25, 25, " "), //                          Last Filing Indicator
    F.a(26, 27, RETURN_TYPE_CODES[a.returnType]), // Type of Return
    F.a(28, 45, a.amountCodes), //                Amount Codes
    F.blank(46, 51),
    F.a(52, 52, " "), //                          Foreign Entity Indicator
    F.a(53, 92, a.payerName), //                  First Issuer Name Line
    F.a(93, 132, ""), //                          Second Issuer Name Line
    F.a(133, 133, "0"), //                        Transfer Agent Indicator ("0" = not an agent)
    F.a(134, 173, a.payerAddress), //             Issuer Shipping Address
    F.a(174, 213, a.payerCity), //                Issuer City
    F.a(214, 215, a.payerState), //               Issuer State
    F.a(216, 224, a.payerZip), //                 Issuer ZIP Code
    F.a(225, 239, a.payerPhone), //               Issuer Telephone & Extension
    F.blank(240, 499),
    F.n(500, 507, sequenceNumber), //             Record Sequence Number
    F.blank(508, 748),
    F.blank(749, 750), //                         Blank or CR/LF
  ]);
}

// ─── Payee "B" Record, positions 1-543 (all return types) ─────────────────

/** Pub 1220 "B" record position 11, Type of TIN. */
const TIN_TYPE_CODE: Record<"SSN" | "EIN" | "ITIN", string> = {
  EIN: "1", // a business, organization or other entity
  SSN: "2", // an individual, including some sole proprietors
  ITIN: "2", // an individual not eligible for an SSN
};

/** Payment Amount fields 1-9 and A-J, in integer cents. */
export interface PaymentAmounts {
  amount1Cents?: number;
  amount2Cents?: number;
  amount3Cents?: number;
  amount4Cents?: number;
  amount5Cents?: number;
  amount6Cents?: number;
  amount7Cents?: number;
  amount8Cents?: number;
  amount9Cents?: number;
}

/** The part of a "B" record that is identical for every return type. */
export interface PayeeCommonFields {
  taxYear: number;
  /** Position 6 — "G"/"C" for corrections, blank for an original return. */
  correctedReturnIndicator?: "G" | "C" | " ";
  /** Positions 7-10 — first four characters of the payee's surname. */
  nameControl: string;
  recipientTin: string;
  recipientTinType: "SSN" | "EIN" | "ITIN";
  /** Positions 21-40 — must be unique per payee per form type. */
  accountNumber: string;
  amounts: PaymentAmounts;
  /** Position 287 — "1" when the payee address is in a foreign country. */
  foreignCountryIndicator?: boolean;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
}

function buildBRecordCommon(b: PayeeCommonFields, sequenceNumber: number): Field[] {
  const amt = b.amounts;
  return [
    F.a(1, 1, "B"), //                              Record Type
    F.n(2, 5, b.taxYear), //                        Payment Year
    F.a(6, 6, b.correctedReturnIndicator ?? " "), //Corrected Return Indicator
    F.a(7, 10, b.nameControl), //                   Name Control
    F.a(11, 11, TIN_TYPE_CODE[b.recipientTinType]), // Type of TIN
    F.tin(12, 20, b.recipientTin), //               Payee's TIN
    F.a(21, 40, b.accountNumber), //                Issuer's Account Number for Payee
    F.blank(41, 44), //                             Issuer's Office Code
    F.blank(45, 54),
    F.m(55, 66, amt.amount1Cents ?? 0), //          Payment Amount 1
    F.m(67, 78, amt.amount2Cents ?? 0), //          Payment Amount 2
    F.m(79, 90, amt.amount3Cents ?? 0), //          Payment Amount 3
    F.m(91, 102, amt.amount4Cents ?? 0), //         Payment Amount 4
    F.m(103, 114, amt.amount5Cents ?? 0), //        Payment Amount 5
    F.m(115, 126, amt.amount6Cents ?? 0), //        Payment Amount 6
    F.m(127, 138, amt.amount7Cents ?? 0), //        Payment Amount 7
    F.m(139, 150, amt.amount8Cents ?? 0), //        Payment Amount 8
    F.m(151, 162, amt.amount9Cents ?? 0), //        Payment Amount 9
    F.zero(163, 174), //                            Payment Amount A
    F.zero(175, 186), //                            Payment Amount B
    F.zero(187, 198), //                            Payment Amount C
    F.zero(199, 210), //                            Payment Amount D
    F.zero(211, 222), //                            Payment Amount E
    F.zero(223, 234), //                            Payment Amount F
    F.zero(235, 246), //                            Payment Amount G
    F.zero(247, 258), //                            Payment Amount H
    F.zero(259, 270), //                            Payment Amount J
    F.blank(271, 286),
    F.a(287, 287, b.foreignCountryIndicator ? "1" : " "), // Foreign Country Indicator
    F.a(288, 327, b.recipientName), //              First Payee Name Line
    F.a(328, 367, ""), //                           Second Payee Name Line
    F.a(368, 407, b.recipientAddress), //           Payee Mailing Address
    F.blank(408, 447),
    F.a(448, 487, b.recipientCity), //              Payee City
    F.a(488, 489, b.recipientState), //             Payee State
    F.a(490, 498, b.recipientZip), //               Payee ZIP Code
    F.blank(499, 499),
    F.n(500, 507, sequenceNumber), //               Record Sequence Number
    F.blank(508, 543),
  ];
}

// ─── Payee "B" Record — Form 1099-INT (positions 544-750) ─────────────────

export interface PayeeRecord {
  taxYear: number;
  /** Payment Amount 1 (Box 1 — interest income) in cents. */
  box1IntCents: number;
  /** Payment Amount 2 (Box 2 — early withdrawal penalty) in cents. */
  box2EarlyWithdrawalCents?: number;
  /** Payment Amount 3 (Box 3 — US savings bond interest) in cents. */
  box3UsBondCents?: number;
  /** Payment Amount 4 (Box 4 — federal income tax withheld) in cents. */
  box4FedTaxWithheldCents?: number;
  recipientTin: string;
  recipientTinType: "SSN" | "EIN" | "ITIN";
  accountNumber: string;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
  nameControl: string;
  /** Position 600 — FATCA filing requirement indicator. */
  fatca?: boolean;
  /** Position 544 — "2nd TIN notice". */
  secondTinNotice?: boolean;
  /** Positions 547-586 — foreign country the withheld foreign tax applies to. */
  foreignCountry?: string;
}

export function buildBRecord(b: PayeeRecord, sequenceNumber = 3): string {
  const common = buildBRecordCommon(
    {
      taxYear: b.taxYear,
      nameControl: b.nameControl,
      recipientTin: b.recipientTin,
      recipientTinType: b.recipientTinType,
      accountNumber: b.accountNumber,
      amounts: {
        amount1Cents: b.box1IntCents,
        amount2Cents: b.box2EarlyWithdrawalCents ?? 0,
        amount3Cents: b.box3UsBondCents ?? 0,
        amount4Cents: b.box4FedTaxWithheldCents ?? 0,
      },
      recipientName: b.recipientName,
      recipientAddress: b.recipientAddress,
      recipientCity: b.recipientCity,
      recipientState: b.recipientState,
      recipientZip: b.recipientZip,
    },
    sequenceNumber,
  );
  return assembleRecord("B/1099-INT", [
    ...common,
    F.a(544, 544, b.secondTinNotice ? "2" : " "), // Second TIN Notice
    F.blank(545, 546),
    F.a(547, 586, b.foreignCountry ?? ""), //       Foreign Country or U.S. Possession
    F.blank(587, 599), //                           CUSIP Number
    F.a(600, 600, b.fatca ? "1" : " "), //          FATCA Filing Requirement Indicator
    F.blank(601, 662),
    F.blank(663, 722), //                           Special Data Entries
    F.zero(723, 734), //                            State Income Tax Withheld
    F.zero(735, 746), //                            Local Income Tax Withheld
    F.blank(747, 748), //                           Combined Federal/State Code
    F.blank(749, 750), //                           Blank or CR/LF
  ]);
}

// ─── Payee "B" Record — Form 1098 (positions 544-750) ─────────────────────

/**
 * Form 1098 payee record. Amount fields carry the paper form's boxes:
 *   Box 1  → Payment Amount 1 (Amount Code 1) — mortgage interest received
 *   Box 4  → Payment Amount 3 (Amount Code 3) — refund of overpaid interest
 *   Box 2  → Payment Amount 6 (Amount Code 6) — outstanding principal
 *   Box 6  → Payment Amount 2 (Amount Code 2) — points paid
 *   Box 5  → Payment Amount 4 (Amount Code 4) — mortgage insurance premium
 *
 * Note the paper box numbers and the Pub 1220 amount codes deliberately do
 * NOT line up for 1098 — the publication governs for electronic filing.
 */
export interface Payee1098Record {
  taxYear: number;
  /** Box 1 — mortgage interest received from the payer/borrower, in cents. */
  mortgageInterestReceivedCents: number;
  /** Box 2 — outstanding mortgage principal as of Jan 1 (or origination), cents. */
  outstandingMortgagePrincipalCents: number;
  /** Box 4 — refund of overpaid interest, in cents. */
  refundOfOverpaidInterestCents?: number;
  /** Box 6 — points paid on the purchase of a principal residence, in cents. */
  pointsPaidCents?: number;
  /** Box 5 — mortgage insurance premium, in cents (only when §163(h)(3)(E) applies). */
  mortgageInsurancePremiumCents?: number;
  /** Box 3 — mortgage origination date (positions 544-551). */
  mortgageOriginationDate: string | Date;
  /**
   * Box 7 — position 552. "1" when the property securing the mortgage is
   * the same as the payer's/borrower's address.
   */
  propertySecuringMortgageIsBorrowerAddress: boolean;
  /** Box 8 — positions 553-591, address or description of the property. */
  propertyAddressOrDescription: string;
  /**
   * Positions 592-630, "Other" — free-format. Pub 1220 lists "Real estate
   * taxes" and "Insurance paid from escrow" as examples. Not reported to
   * the IRS.
   */
  other?: string;
  /**
   * Box 9 — positions 670-673. Only populated when more than one property
   * secures the mortgage; the spec requires blanks for fewer than two.
   */
  numberOfMortgagedProperties?: number;
  /** Box 11 — positions 723-730, set only when acquired during the year. */
  mortgageAcquisitionDate?: string | Date | null;
  /** Payer/borrower identity + address. */
  recipientTin: string;
  recipientTinType: "SSN" | "EIN" | "ITIN";
  accountNumber: string;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
  nameControl: string;
}

export function buildB1098Record(b: Payee1098Record, sequenceNumber = 3): string {
  const common = buildBRecordCommon(
    {
      taxYear: b.taxYear,
      nameControl: b.nameControl,
      recipientTin: b.recipientTin,
      recipientTinType: b.recipientTinType,
      accountNumber: b.accountNumber,
      amounts: {
        amount1Cents: b.mortgageInterestReceivedCents,
        amount2Cents: b.pointsPaidCents ?? 0,
        amount3Cents: b.refundOfOverpaidInterestCents ?? 0,
        amount4Cents: b.mortgageInsurancePremiumCents ?? 0,
        amount5Cents: 0, //                          Amount Code 5 is "Blank (filer's use)"
        amount6Cents: b.outstandingMortgagePrincipalCents,
      },
      recipientName: b.recipientName,
      recipientAddress: b.recipientAddress,
      recipientCity: b.recipientCity,
      recipientState: b.recipientState,
      recipientZip: b.recipientZip,
    },
    sequenceNumber,
  );
  // Pub 1220 position 670-673: "If less than two (2), enter blanks."
  const propertyCount =
    b.numberOfMortgagedProperties !== undefined && b.numberOfMortgagedProperties >= 2
      ? num(b.numberOfMortgagedProperties, 4)
      : "    ";
  return assembleRecord("B/1098", [
    ...common,
    F.date(544, 551, b.mortgageOriginationDate), //  Mortgage Origination Date
    F.a(552, 552, b.propertySecuringMortgageIsBorrowerAddress ? "1" : " "), // Property Securing Mortgage Indicator
    F.a(553, 591, b.propertyAddressOrDescription), // Property Address or Description
    F.a(592, 630, b.other ?? ""), //                 Other
    F.blank(631, 669),
    { start: 670, len: 4, value: propertyCount }, //  Number of Mortgaged Properties
    F.blank(674, 722), //                            Special Data Entries
    F.date(723, 730, b.mortgageAcquisitionDate ?? null), // Mortgage Acquisition Date
    F.blank(731, 748),
    F.blank(749, 750), //                            Blank or CR/LF
  ]);
}

// ─── End-of-Issuer "C" Record — Pub 1220 Part C Sec. 4 ────────────────────

export interface EndOfIssuerRecord {
  /** Number of B records preceding this C in the current A block. */
  payeeCount: number;
  /** Control totals 1-9 in cents, matching the Payment Amount fields. */
  controlTotalBox1Cents: number;
  controlTotalBox2Cents?: number;
  controlTotalBox3Cents?: number;
  controlTotalBox4Cents?: number;
  controlTotalBox5Cents?: number;
  controlTotalBox6Cents?: number;
}

export function buildCRecord(c: EndOfIssuerRecord, sequenceNumber = 4): string {
  return assembleRecord("C", [
    F.a(1, 1, "C"), //                              Record Type
    F.n(2, 9, c.payeeCount), //                     Number of Payees
    F.blank(10, 15),
    F.m(16, 33, c.controlTotalBox1Cents), //        Control Total 1
    F.m(34, 51, c.controlTotalBox2Cents ?? 0), //   Control Total 2
    F.m(52, 69, c.controlTotalBox3Cents ?? 0), //   Control Total 3
    F.m(70, 87, c.controlTotalBox4Cents ?? 0), //   Control Total 4
    F.m(88, 105, c.controlTotalBox5Cents ?? 0), //  Control Total 5
    F.m(106, 123, c.controlTotalBox6Cents ?? 0), // Control Total 6
    F.zero(124, 141), //                            Control Total 7
    F.zero(142, 159), //                            Control Total 8
    F.zero(160, 177), //                            Control Total 9
    F.zero(178, 195), //                            Control Total A
    F.zero(196, 213), //                            Control Total B
    F.zero(214, 231), //                            Control Total C
    F.zero(232, 249), //                            Control Total D
    F.zero(250, 267), //                            Control Total E
    F.zero(268, 285), //                            Control Total F
    F.zero(286, 303), //                            Control Total G
    F.zero(304, 321), //                            Control Total H
    F.zero(322, 339), //                            Control Total J
    F.blank(340, 499),
    F.n(500, 507, sequenceNumber), //               Record Sequence Number
    F.blank(508, 748),
    F.blank(749, 750), //                           Blank or CR/LF
  ]);
}

// ─── End-of-Transmission "F" Record — Pub 1220 Part C Sec. 6 ──────────────

export interface EndOfFileRecord {
  /** Total number of Issuer "A" Records in the file. */
  issuerCount: number;
  /** Total number of Payee "B" Records in the file. */
  payeeCount: number;
}

export function buildFRecord(f: EndOfFileRecord, sequenceNumber = 5): string {
  return assembleRecord("F", [
    F.a(1, 1, "F"), //                              Record Type
    F.n(2, 9, f.issuerCount), //                    Number of "A" Records
    F.zero(10, 30), //                              Zero
    F.blank(31, 49),
    F.n(50, 57, f.payeeCount), //                   Total Number of Payees
    F.blank(58, 499),
    F.n(500, 507, sequenceNumber), //               Record Sequence Number
    F.blank(508, 748),
    F.blank(749, 750), //                           Blank or CR/LF
  ]);
}

// ─── File assembly ────────────────────────────────────────────────────────

export interface FireFileResult {
  /** The full FIRE text. CR/LF terminated; ASCII only. */
  text: string;
  /** Per-record-type counts, useful for logging + audit. */
  recordCounts: { T: number; A: number; B: number; C: number; F: number };
  /** Total bytes (each record is 752 bytes including CR/LF). */
  bytes: number;
}

export interface FireFileInput {
  transmitter: TransmitterRecord;
  issuer: IssuerRecord;
  payees: PayeeRecord[];
}

/** Build a single-issuer Form 1099-INT FIRE file. */
export function buildFireFile(input: FireFileInput): FireFileResult {
  const totals = { a1: 0, a2: 0, a3: 0, a4: 0 };
  for (const p of input.payees) {
    totals.a1 += p.box1IntCents;
    totals.a2 += p.box2EarlyWithdrawalCents ?? 0;
    totals.a3 += p.box3UsBondCents ?? 0;
    totals.a4 += p.box4FedTaxWithheldCents ?? 0;
  }
  return assembleFile({
    transmitter: input.transmitter,
    issuer: input.issuer,
    payeeCount: input.payees.length,
    renderPayee: (seq, index) => buildBRecord(input.payees[index]!, seq),
    controlTotals: {
      controlTotalBox1Cents: totals.a1,
      controlTotalBox2Cents: totals.a2,
      controlTotalBox3Cents: totals.a3,
      controlTotalBox4Cents: totals.a4,
      payeeCount: input.payees.length,
    },
  });
}

export interface Fire1098FileInput {
  transmitter: TransmitterRecord;
  issuer: Omit<IssuerRecord, "returnType" | "amountCodes"> & {
    /** Optional override; defaults to the codes AcreOS actually populates. */
    amountCodes?: string;
  };
  payees: Payee1098Record[];
}

/**
 * Build a single-issuer Form 1098 FIRE file.
 *
 * Amount codes are derived from what is actually populated across the
 * batch: 1 (mortgage interest) and 6 (outstanding principal) always; 2
 * (points), 3 (refund of overpaid interest) and 4 (mortgage insurance
 * premium) only when some payee carries a non-zero amount. Codes are
 * emitted ascending, as the spec requires.
 */
export function buildFire1098File(input: Fire1098FileInput): FireFileResult {
  const totals = { a1: 0, a2: 0, a3: 0, a4: 0, a6: 0 };
  for (const p of input.payees) {
    totals.a1 += p.mortgageInterestReceivedCents;
    totals.a2 += p.pointsPaidCents ?? 0;
    totals.a3 += p.refundOfOverpaidInterestCents ?? 0;
    totals.a4 += p.mortgageInsurancePremiumCents ?? 0;
    totals.a6 += p.outstandingMortgagePrincipalCents;
  }
  // Pub 1220, Issuer "A" Record positions 28-45: "Enter the amount codes in
  // ascending sequence; numeric characters followed by alphas." Form 1098
  // uses only numeric codes, and they are appended in ascending order here.
  const codes: string[] = [FORM_1098_AMOUNT_CODES.mortgageInterestReceived];
  if (totals.a2 > 0) codes.push(FORM_1098_AMOUNT_CODES.pointsPaid);
  if (totals.a3 > 0) codes.push(FORM_1098_AMOUNT_CODES.refundOfOverpaidInterest);
  if (totals.a4 > 0) codes.push(FORM_1098_AMOUNT_CODES.mortgageInsurancePremium);
  // Box 2 (Outstanding Mortgage Principal) is Amount Code 6 — always
  // reported, and highest, so it sorts last.
  codes.push(FORM_1098_AMOUNT_CODES.outstandingMortgagePrincipal);

  return assembleFile({
    transmitter: input.transmitter,
    issuer: {
      ...input.issuer,
      returnType: "1098",
      amountCodes: input.issuer.amountCodes ?? codes.sort().join(""),
    },
    payeeCount: input.payees.length,
    renderPayee: (seq, index) => buildB1098Record(input.payees[index]!, seq),
    controlTotals: {
      controlTotalBox1Cents: totals.a1,
      controlTotalBox2Cents: totals.a2,
      controlTotalBox3Cents: totals.a3,
      controlTotalBox4Cents: totals.a4,
      controlTotalBox6Cents: totals.a6,
      payeeCount: input.payees.length,
    },
  });
}

/**
 * Shared T → A → B* → C → F assembly. Record Sequence Number (positions
 * 500-507 of every record) is assigned here so it is always the record's
 * 1-based index in the file — a Required field the IRS validates.
 */
function assembleFile(args: {
  transmitter: TransmitterRecord;
  issuer: IssuerRecord;
  payeeCount: number;
  renderPayee: (sequenceNumber: number, index: number) => string;
  controlTotals: EndOfIssuerRecord;
}): FireFileResult {
  const lines: string[] = [];
  let seq = 1;
  lines.push(buildTRecord({ ...args.transmitter, totalPayees: args.payeeCount }, seq++));
  lines.push(buildARecord(args.issuer, seq++));
  for (let i = 0; i < args.payeeCount; i++) {
    lines.push(args.renderPayee(seq++, i));
  }
  lines.push(buildCRecord(args.controlTotals, seq++));
  lines.push(buildFRecord({ issuerCount: 1, payeeCount: args.payeeCount }, seq++));

  const text = lines.join(TERMINATOR) + TERMINATOR;
  return {
    text,
    recordCounts: { T: 1, A: 1, B: args.payeeCount, C: 1, F: 1 },
    bytes: text.length,
  };
}

/**
 * Structural validation — record length, type sequencing, balanced A/C
 * counts, and the Required ascending Record Sequence Number. Returns an
 * array of error messages; empty array means the file passes.
 *
 * Real IRS validation runs on submission. This guards CI / unit tests so
 * regressions in the record builders are caught at build time.
 */
export function validateFireFile(text: string): string[] {
  const errors: string[] = [];
  const records = text.split(TERMINATOR).filter((l) => l.length > 0);
  if (records.length < 4) {
    errors.push(`Expected at least T+A+C+F records, got ${records.length}.`);
  }
  records.forEach((r, i) => {
    if (r.length !== RECORD_LEN) {
      errors.push(
        `Record ${i} (type ${r[0]}) is ${r.length} bytes — must be ${RECORD_LEN}.`,
      );
    }
    // Positions 500-507 (0-based 499-507) — Record Sequence Number.
    const seq = r.slice(499, 507);
    if (!/^\d{8}$/.test(seq)) {
      errors.push(`Record ${i} (type ${r[0]}) has a non-numeric record sequence number.`);
    } else if (parseInt(seq, 10) !== i + 1) {
      errors.push(
        `Record ${i} (type ${r[0]}) sequence number is ${parseInt(seq, 10)} — must be ${i + 1}.`,
      );
    }
  });
  // Sequencing: T first, F last, A precedes B/C, C precedes F.
  if (records[0] && records[0][0] !== "T") {
    errors.push("First record must be a T record.");
  }
  if (records.length > 0 && records[records.length - 1]![0] !== "F") {
    errors.push("Last record must be an F record.");
  }
  const saw = { T: 0, A: 0, B: 0, C: 0, F: 0 };
  for (const r of records) {
    const t = r[0] as keyof typeof saw;
    if (t in saw) saw[t]++;
  }
  if (saw.T !== 1) errors.push(`Expected exactly 1 T record, got ${saw.T}.`);
  if (saw.A < 1) errors.push(`Expected at least 1 A record, got ${saw.A}.`);
  if (saw.A !== saw.C) {
    errors.push(`A record count (${saw.A}) must equal C record count (${saw.C}).`);
  }
  if (saw.F !== 1) errors.push(`Expected exactly 1 F record, got ${saw.F}.`);
  // The T record's Total Number of Payees (296-303) must equal the B count.
  if (records[0] && records[0][0] === "T") {
    const declared = parseInt(records[0].slice(295, 303), 10);
    if (Number.isFinite(declared) && declared !== saw.B) {
      errors.push(
        `T record declares ${declared} payees but the file contains ${saw.B} B records.`,
      );
    }
  }
  return errors;
}
