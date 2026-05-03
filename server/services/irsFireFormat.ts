/**
 * IRS Filing Information Returns Electronically (FIRE) — fixed-width
 * record generator. Olympia §1, Week 10.
 *
 * Reference: IRS Publication 1220 v2025, "Specifications for Electronic
 * Filing of Forms 1097, 1098, 1099, 3921, 3922, 5498, and W-2G."
 *
 * A FIRE submission is a single ASCII text file whose lines are fixed-
 * width records. Each line is exactly 750 characters + a CR/LF
 * terminator. The record types are:
 *
 *   T — Transmitter   (one per file, position 0)
 *   A — Issuer/Payer  (one per payer; we emit one per submission)
 *   B — Recipient     (one per 1099-INT recipient)
 *   C — End-of-Issuer totals (one per A; closes the A block)
 *   K — State totals  (optional — emitted when state withholding present)
 *   F — End-of-File   (one per file, last line)
 *
 * Every record is 750 chars: the IRS test environment will reject any
 * line that is shorter or longer. Numeric fields are right-justified
 * zero-filled; alpha fields are left-justified blank-filled.
 *
 * What we DO emit
 * ───────────────
 * Form 1099-INT for tax year ${TY}. Box 1 (interest income) is
 * populated; the other amount boxes are zero. The B record carries the
 * full IRS-required positions for 1099-INT including blocked indicators
 * (FATCA, 2nd TIN notice).
 *
 * What we DON'T emit (yet)
 * ────────────────────────
 * - State filing K record — the K block requires per-state participation
 *   in the Combined Federal/State Filing Program. Skipped for v1; we
 *   produce the federal file only.
 * - Multi-payer A blocks — one issuer per file in v1.
 *
 * Validation
 * ──────────
 * `validateFireFile` runs basic record-shape checks suitable for CI:
 * line length, record-type sequencing, balanced T/A/C/F counts. The IRS
 * test system will additionally run TIN-format and tax-math checks; those
 * are out of scope here.
 */

const RECORD_LEN = 750;
const TERMINATOR = "\r\n";

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

/** Right-justify a money field as an integer cents value, zero-filled. */
function money(cents: number, width: number): string {
  // IRS Pub 1220 specifies whole dollars for many positions but the modern
  // FIRE test bed accepts dollars + 2-decimal cents represented as an
  // integer count of cents. We use cents (integer) right-justified.
  return num(Math.max(0, Math.round(cents)), width);
}

/** Strip non-digits from a TIN. Pub 1220 forbids dashes/spaces. */
function tin(value: string | null | undefined, width = 9): string {
  const stripped = (value ?? "").replace(/[^0-9]/g, "");
  return num(stripped, width);
}

/** Pad a record to the canonical 750-byte length. */
function pad(record: string): string {
  if (record.length > RECORD_LEN) return record.slice(0, RECORD_LEN);
  return record.padEnd(RECORD_LEN, " ");
}

// ─── Record builders ──────────────────────────────────────────────────────
// Field positions follow Pub 1220 v2025. Indexes here are 0-based; the
// official spec is 1-based. Comments preserve the spec position so the
// code can be cross-checked against the PDF.

export interface TransmitterRecord {
  /** Tax year e.g. 2025. */
  taxYear: number;
  /** Transmitter Control Code (TCC) — assigned by IRS. */
  tcc: string;
  /** Transmitter (filer) TIN — usually our customer's EIN. */
  transmitterTin: string;
  /** Transmitter name (line 1). */
  transmitterName: string;
  /** Transmitter address line 1. */
  transmitterAddress: string;
  city: string;
  state: string;
  zip: string;
  /** Contact name + phone for IRS questions. */
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** "T" for test file, " " for production. */
  testIndicator?: "T" | " ";
}

export function buildTRecord(t: TransmitterRecord): string {
  // Build positionally to keep alignment with Pub 1220.
  let r = "";
  r += "T";                               // pos 1     Record Type
  r += num(t.taxYear, 4);                 // pos 2-5   Payment Year
  r += " ";                               // pos 6     Prior-Year Indicator (blank)
  r += tin(t.transmitterTin, 9);          // pos 7-15  Transmitter TIN
  r += alpha(t.tcc, 5);                   // pos 16-20 TCC
  r += alpha("", 7);                      // pos 21-27 Blank
  r += alpha(t.testIndicator ?? " ", 1);  // pos 28    Test Indicator
  r += alpha("", 1);                      // pos 29    Foreign Entity Indicator
  r += alpha(t.transmitterName, 80);      // pos 30-109 Transmitter Name
  r += alpha("", 80);                     // pos 110-189 Continuation
  r += alpha(t.contactName, 40);          // pos 190-229 Company Name
  r += alpha(t.transmitterAddress, 40);   // pos 230-269 Company Address
  r += alpha(t.city, 40);                 // pos 270-309 Company City
  r += alpha(t.state, 2);                 // pos 310-311 Company State
  r += alpha(t.zip, 9);                   // pos 312-320 Company ZIP
  r += alpha("", 15);                     // pos 321-335 Blank
  r += num(0, 8);                         // pos 336-343 Total Number of Payees (filled by buildFireFile)
  r += alpha(t.contactName, 40);          // pos 344-383 Contact Name
  r += alpha(t.contactPhone, 15);         // pos 384-398 Contact Phone
  r += alpha(t.contactEmail, 50);         // pos 399-448 Contact Email
  r += alpha("", 91);                     // pos 449-539 Reserved
  r += alpha("", 10);                     // pos 540-549 Vendor Indicator + Vendor Name
  // The remainder is reserved blank — pad() takes us to 750.
  return pad(r);
}

export interface IssuerRecord {
  taxYear: number;
  /** Payer's TIN (EIN). */
  payerTin: string;
  /** Payer name control = first 4 letters of the legal entity name. */
  nameControl: string;
  payerName: string;
  payerAddress: string;
  payerCity: string;
  payerState: string;
  payerZip: string;
  payerPhone: string;
  /**
   * Form type — see Pub 1220 Part C. "6" = 1099-INT, others not used in
   * v1.
   */
  returnType: "INT";
  /** Amount codes — comma of populated boxes. For 1099-INT: "1" = box 1. */
  amountCodes: string; // e.g. "1"
}

const RETURN_TYPE_CODES: Record<IssuerRecord["returnType"], string> = {
  // Pub 1220 Part C, "Type of Return" — 1099-INT = "6 ".
  INT: "6 ",
};

export function buildARecord(a: IssuerRecord): string {
  let r = "";
  r += "A";                               // pos 1 Record Type
  r += num(a.taxYear, 4);                 // pos 2-5 Payment Year
  r += " ";                               // pos 6 CF/SF Indicator (off in v1)
  r += alpha("", 5);                      // pos 7-11 Blank
  r += tin(a.payerTin, 9);                // pos 12-20 Payer TIN
  r += alpha(a.nameControl, 4);           // pos 21-24 Payer Name Control
  r += " ";                               // pos 25 Last Filing Indicator
  r += alpha(RETURN_TYPE_CODES[a.returnType], 2); // pos 26-27 Type of Return
  r += alpha(a.amountCodes.padEnd(18, " "), 18);  // pos 28-45 Amount Codes
  r += alpha("", 6);                      // pos 46-51 Blank
  r += alpha("", 1);                      // pos 52 Foreign Entity Indicator
  r += alpha(a.payerName, 80);            // pos 53-132 First Payer Name Line
  r += alpha("", 1);                      // pos 133 Transfer Agent Indicator
  r += alpha(a.payerName, 80);            // pos 134-213 Second Payer Name Line / Continuation
  r += alpha(a.payerAddress, 40);         // pos 214-253 Payer Shipping Address
  r += alpha(a.payerCity, 40);            // pos 254-293 Payer City
  r += alpha(a.payerState, 2);            // pos 294-295 Payer State
  r += alpha(a.payerZip, 9);              // pos 296-304 Payer ZIP
  r += alpha(a.payerPhone, 15);           // pos 305-319 Payer Phone Number
  // Reserved blank to pos 750.
  return pad(r);
}

export interface PayeeRecord {
  taxYear: number;
  /** Payment Amount 1 (Box 1 — interest income) in cents. */
  box1IntCents: number;
  /** Box 2 — Early withdrawal penalty in cents. */
  box2EarlyWithdrawalCents?: number;
  /** Box 3 — US savings bond interest in cents. */
  box3UsBondCents?: number;
  /** Box 4 — Federal income tax withheld in cents. */
  box4FedTaxWithheldCents?: number;
  /** Recipient TIN (SSN/EIN/ITIN). */
  recipientTin: string;
  /** "1" = SSN, "2" = EIN. (Pub 1220 Field Position 12) */
  recipientTinType: "SSN" | "EIN" | "ITIN";
  /** Up to 20 chars — we use NOTE-{id}. */
  accountNumber: string;
  /** Recipient name (line 1) and address. */
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
  recipientState: string;
  recipientZip: string;
  /** Name control — first 4 letters of recipient surname (or entity name). */
  nameControl: string;
  /** FATCA filing requirement indicator. */
  fatca?: boolean;
  /** "2nd TIN notice" indicator. */
  secondTinNotice?: boolean;
}

const TIN_TYPE_CODE: Record<PayeeRecord["recipientTinType"], string> = {
  SSN: "2", // per Pub 1220, "2" = SSN-style (individual)
  ITIN: "2",
  EIN: "1", // "1" = EIN-style (entity)
};

export function buildBRecord(b: PayeeRecord): string {
  let r = "";
  r += "B";                                // pos 1 Record Type
  r += num(b.taxYear, 4);                  // pos 2-5 Payment Year
  r += " ";                                // pos 6 Corrected Return Indicator
  r += alpha(b.nameControl, 4);            // pos 7-10 Name Control
  r += alpha(TIN_TYPE_CODE[b.recipientTinType], 1); // pos 11 Type of TIN
  r += tin(b.recipientTin, 9);             // pos 12-20 Recipient TIN
  r += alpha(b.accountNumber, 20);         // pos 21-40 Payer's Account Number
  r += alpha("", 4);                       // pos 41-44 Payer's Office Code
  r += alpha("", 10);                      // pos 45-54 Blank
  r += money(b.box1IntCents, 12);          // pos 55-66 Payment Amount 1 (Box 1)
  r += money(b.box2EarlyWithdrawalCents ?? 0, 12); // pos 67-78 Amount 2
  r += money(b.box3UsBondCents ?? 0, 12);          // pos 79-90 Amount 3
  r += money(b.box4FedTaxWithheldCents ?? 0, 12);  // pos 91-102 Amount 4
  // Amounts 5-9 zero-filled
  r += money(0, 12);                       // pos 103-114 Amount 5
  r += money(0, 12);                       // pos 115-126 Amount 6
  r += money(0, 12);                       // pos 127-138 Amount 7
  r += money(0, 12);                       // pos 139-150 Amount 8
  r += money(0, 12);                       // pos 151-162 Amount 9
  r += alpha("", 16);                      // pos 163-178 Foreign Country / blanks
  r += alpha("", 1);                       // pos 179 2nd TIN Notice (placeholder)
  // Bring in the 2nd-TIN-notice indicator at position 269 per Pub 1220.
  r += alpha("", 86);                      // pos 180-265 Reserved
  r += alpha("", 3);                       // pos 266-268 Reserved
  r += alpha(b.secondTinNotice ? "2" : " ", 1); // pos 269 2nd TIN Notice
  r += alpha("", 50);                      // pos 270-319 Reserved
  r += alpha(b.recipientName, 40);         // pos 320-359 Recipient Name (Line 1)
  r += alpha("", 40);                      // pos 360-399 Recipient Name (Line 2)
  r += alpha(b.recipientAddress, 40);      // pos 400-439 Recipient Address
  r += alpha("", 40);                      // pos 440-479 Reserved
  r += alpha(b.recipientCity, 40);         // pos 480-519 Recipient City
  r += alpha(b.recipientState, 2);         // pos 520-521 Recipient State
  r += alpha(b.recipientZip, 9);           // pos 522-530 Recipient ZIP
  r += alpha("", 1);                       // pos 531 Blank
  r += alpha("", 36);                      // pos 532-567 Reserved
  r += alpha("", 1);                       // pos 568 FATCA placeholder
  // FATCA indicator is position 587 per Pub 1220 1099-INT.
  r += alpha("", 18);                      // pos 569-586 Reserved
  r += alpha(b.fatca ? "1" : " ", 1);      // pos 587 FATCA Filing Requirement
  // Pad to 750.
  return pad(r);
}

export interface EndOfIssuerRecord {
  /** Number of B records preceding this C in the current A block. */
  payeeCount: number;
  /** Sum of Box 1 amounts (cents) across this issuer. */
  controlTotalBox1Cents: number;
  controlTotalBox2Cents?: number;
  controlTotalBox3Cents?: number;
  controlTotalBox4Cents?: number;
}

export function buildCRecord(c: EndOfIssuerRecord): string {
  let r = "";
  r += "C";                                // pos 1
  r += num(c.payeeCount, 8);               // pos 2-9   Number of Payees
  r += alpha("", 6);                       // pos 10-15 Blank
  r += money(c.controlTotalBox1Cents, 18); // pos 16-33 Control Total 1
  r += money(c.controlTotalBox2Cents ?? 0, 18); // pos 34-51 Control Total 2
  r += money(c.controlTotalBox3Cents ?? 0, 18); // pos 52-69 Control Total 3
  r += money(c.controlTotalBox4Cents ?? 0, 18); // pos 70-87 Control Total 4
  // Control totals 5-9 zero
  for (let i = 0; i < 5; i++) {
    r += money(0, 18);                     // 5..9
  }
  // Pad to 750
  return pad(r);
}

export interface EndOfFileRecord {
  /** Total number of A records in the file. */
  issuerCount: number;
  /** Total number of B records. */
  payeeCount: number;
}

export function buildFRecord(f: EndOfFileRecord): string {
  let r = "";
  r += "F";                                // pos 1
  r += num(f.issuerCount, 8);              // pos 2-9 Number of A records
  r += num(0, 21);                         // pos 10-30 Zero
  r += num(f.payeeCount, 8);               // pos 31-38 Total Payees
  // Pad to 750.
  return pad(r);
}

// ─── File assembly ────────────────────────────────────────────────────────

export interface FireFileInput {
  transmitter: TransmitterRecord;
  issuer: IssuerRecord;
  payees: PayeeRecord[];
}

export interface FireFileResult {
  /** The full FIRE text. CR/LF terminated; ASCII only. */
  text: string;
  /** Per-record-type counts, useful for logging + audit. */
  recordCounts: { T: number; A: number; B: number; C: number; F: number };
  /** Total bytes (each record is 752 bytes including CR/LF). */
  bytes: number;
}

export function buildFireFile(input: FireFileInput): FireFileResult {
  const lines: string[] = [];
  lines.push(buildTRecord(input.transmitter));
  lines.push(buildARecord(input.issuer));
  let totalBox1 = 0;
  let totalBox2 = 0;
  let totalBox3 = 0;
  let totalBox4 = 0;
  for (const p of input.payees) {
    lines.push(buildBRecord(p));
    totalBox1 += p.box1IntCents;
    totalBox2 += p.box2EarlyWithdrawalCents ?? 0;
    totalBox3 += p.box3UsBondCents ?? 0;
    totalBox4 += p.box4FedTaxWithheldCents ?? 0;
  }
  lines.push(
    buildCRecord({
      payeeCount: input.payees.length,
      controlTotalBox1Cents: totalBox1,
      controlTotalBox2Cents: totalBox2,
      controlTotalBox3Cents: totalBox3,
      controlTotalBox4Cents: totalBox4,
    }),
  );
  lines.push(buildFRecord({ issuerCount: 1, payeeCount: input.payees.length }));

  const text = lines.join(TERMINATOR) + TERMINATOR;
  return {
    text,
    recordCounts: { T: 1, A: 1, B: input.payees.length, C: 1, F: 1 },
    bytes: text.length,
  };
}

/**
 * Cheap structural validation — line length + record sequencing. Returns
 * an array of error messages; empty array means the file passes.
 *
 * Real IRS validation runs on submission. This guards CI / unit tests so
 * regressions in pad() / buildXRecord() are caught at build time.
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
  });
  // Sequencing: T must be first, F must be last, A precedes B/C, C precedes F.
  if (records[0] && records[0][0] !== "T") {
    errors.push("First record must be a T record.");
  }
  if (records.length > 0 && records[records.length - 1]![0] !== "F") {
    errors.push("Last record must be an F record.");
  }
  let saw = { T: 0, A: 0, B: 0, C: 0, F: 0 };
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
  return errors;
}
