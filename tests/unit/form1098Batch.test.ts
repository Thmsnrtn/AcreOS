/**
 * Form 1098 correctness tests.
 *
 * A wrong tax form is worse than a missing one, so these tests are written
 * as adversarial checks on the four properties that matter most:
 *
 *   1. Box figures match a SEEDED LEDGER EXACTLY — to the cent.
 *   2. An incomplete note is REFUSED, never approximated.
 *   3. Regeneration is idempotent — no duplicates, no double-counting.
 *   4. No TIN ever reaches a log line, an error, or a refusal reason.
 *
 * All tests drive the PURE derivation layer, so none of them needs
 * DATABASE_URL or a live database.
 */
import { describe, it, expect, vi } from "vitest";

import {
  deriveForm1098,
  derive1098Batch,
  build1098FireFile,
  render1098Pdf,
  render1096For1098Pdf,
  toIsoDay,
  FORM_1098_THRESHOLD_CENTS,
  type Form1098Candidate,
  type Form1098LedgerEntry,
  type LenderIdentity,
} from "../../server/services/form1098Batch";
import { validateFireFile } from "../../server/services/irsFireFormat";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const TAX_YEAR = 2025;

/** A real-looking but obviously synthetic TIN we can grep for in output. */
const BORROWER_TIN = "412-88-7635";
const LENDER_EIN = "88-1234567";

const lender: LenderIdentity = {
  name: "Cedar Ridge Land Holdings LLC",
  address: {
    line1: "900 Congress Ave Ste 400",
    city: "Austin",
    state: "TX",
    zip: "78701",
  },
  phone: "5125550100",
  tin: LENDER_EIN,
  tinType: "EIN",
};

/**
 * A seeded 12-month ledger. Interest is deliberately IRREGULAR so a test
 * that passes could not have passed by assuming equal monthly amounts.
 * The twelve 2025 interest amounts sum to 142,382 cents ($1,423.82) —
 * asserted explicitly below so the expectation is independent of the code.
 */
const SEEDED_2025_INTEREST = [
  120_11, 119_87, 119_62, 119_36, 119_10, 118_83,
  118_55, 118_27, 117_98, 117_68, 117_38, 117_07,
];
const SEEDED_2025_PRINCIPAL = [
  80_00, 80_24, 80_49, 80_75, 81_01, 81_28,
  81_56, 81_84, 82_13, 82_43, 82_73, 83_04,
];

function seededLedger(): Form1098LedgerEntry[] {
  const entries: Form1098LedgerEntry[] = [];
  // One entry in December of the PRIOR year — this is what proves the
  // ledger covers the period before Jan 1 (see LEDGER_COVERAGE_INCOMPLETE).
  entries.push({ date: "2024-12-01", principalCents: 79_76, interestCents: 120_35 });
  for (let m = 0; m < 12; m++) {
    entries.push({
      date: `2025-${String(m + 1).padStart(2, "0")}-01`,
      principalCents: SEEDED_2025_PRINCIPAL[m]!,
      interestCents: SEEDED_2025_INTEREST[m]!,
    });
  }
  // A payment in the FOLLOWING year — must not leak into the 2025 figures.
  entries.push({ date: "2026-01-01", principalCents: 83_35, interestCents: 116_76 });
  return entries;
}

const SEEDED_INTEREST_TOTAL = SEEDED_2025_INTEREST.reduce((a, b) => a + b, 0);
const SEEDED_PRINCIPAL_IN_YEAR = SEEDED_2025_PRINCIPAL.reduce((a, b) => a + b, 0);

/** Balance now, after the 2026-01 payment posted. */
const CURRENT_BALANCE = 1_000_000;

function baseCandidate(overrides: Partial<Form1098Candidate> = {}): Form1098Candidate {
  return {
    source: "originated",
    noteRef: "NOTE-41",
    accountNumber: "NOTE-41",
    originationDate: "2019-06-14",
    acquisitionDate: null,
    firstScheduledPaymentDate: "2019-07-01",
    originalPrincipalCents: 4_500_000,
    currentBalanceCents: CURRENT_BALANCE,
    borrowerName: "Marisol Delgado",
    borrowerAddress: {
      line1: "1420 Pecan Hollow Rd",
      city: "Bastrop",
      state: "TX",
      zip: "78602",
    },
    borrowerEncryptedTin: BORROWER_TIN,
    borrowerTinType: "SSN",
    propertyAddress: {
      line1: "TR 14 County Road 219",
      city: "Bastrop",
      state: "TX",
      zip: "78602",
    },
    ledger: seededLedger(),
    ...overrides,
  };
}

function expectForm(c: Form1098Candidate) {
  const out = deriveForm1098(c, lender, TAX_YEAR);
  if (out.kind !== "form") {
    throw new Error(
      `expected a form, got ${out.kind}: ${
        out.kind === "refusal" ? out.refusal.reason : out.exclusion.reason
      }`,
    );
  }
  return out.form;
}

function expectRefusal(c: Form1098Candidate) {
  const out = deriveForm1098(c, lender, TAX_YEAR);
  if (out.kind !== "refusal") {
    throw new Error(`expected a refusal, got ${out.kind}`);
  }
  return out.refusal;
}

// ─── 1. Figures match the seeded ledger exactly ───────────────────────────

describe("Form 1098 figures are derived from the ledger, to the cent", () => {
  it("Box 1 equals the exact sum of in-year ledger interest", () => {
    const form = expectForm(baseCandidate());
    // Independently computed expectation — not a snapshot.
    // 12011+11987+11962+11936+11910+11883+11855+11827+11798+11768+11738+11707
    expect(SEEDED_INTEREST_TOTAL).toBe(142_382);
    expect(form.box1MortgageInterestReceivedCents).toBe(SEEDED_INTEREST_TOTAL);
  });

  it("excludes prior-year and following-year ledger entries from Box 1", () => {
    const form = expectForm(baseCandidate());
    // The 2024-12 entry (120_35) and the 2026-01 entry (116_76) must be out.
    expect(form.box1MortgageInterestReceivedCents).not.toBe(
      SEEDED_INTEREST_TOTAL + 120_35,
    );
    expect(form.box1MortgageInterestReceivedCents).not.toBe(
      SEEDED_INTEREST_TOTAL + 116_76,
    );
  });

  it("nets an NSF reversal instead of counting the bounced payment", () => {
    const ledger = seededLedger();
    // A payment posts, then reverses. Net effect on Box 1 must be zero.
    ledger.push({ date: "2025-06-15", principalCents: 80_00, interestCents: 119_00 });
    ledger.push({ date: "2025-06-20", principalCents: -80_00, interestCents: -119_00 });
    const form = expectForm(baseCandidate({ ledger }));
    expect(form.box1MortgageInterestReceivedCents).toBe(SEEDED_INTEREST_TOTAL);
  });

  it("derives Box 2 by rolling the current balance back over posted principal", () => {
    const form = expectForm(baseCandidate());
    // Balance on 2025-01-01 = current balance + principal posted on/after it.
    // Posted on/after 2025-01-01 = the 12 in-year rows + the 2026-01 row.
    const expected = CURRENT_BALANCE + SEEDED_PRINCIPAL_IN_YEAR + 83_35;
    expect(form.box2OutstandingMortgagePrincipalCents).toBe(expected);
    expect(form.box2Basis).toBe("rolled_back_from_current_balance");
  });

  it("uses principal at origination when the mortgage originated in the tax year", () => {
    const form = expectForm(
      baseCandidate({
        originationDate: "2025-03-10",
        firstScheduledPaymentDate: "2025-04-01",
        originalPrincipalCents: 3_275_000,
      }),
    );
    expect(form.box2OutstandingMortgagePrincipalCents).toBe(3_275_000);
    expect(form.box2Basis).toBe("origination_during_year");
    // Box 3 is the ORIGINATION date, never the acquisition date.
    expect(form.box3MortgageOriginationDate).toBe("2025-03-10");
  });

  it("uses the balance at acquisition when the mortgage was acquired in the tax year", () => {
    // Ledger begins at acquisition — that is all this org ever received.
    const ledger: Form1098LedgerEntry[] = [
      { date: "2025-05-01", principalCents: 50_00, interestCents: 700_00 },
      { date: "2025-06-01", principalCents: 50_25, interestCents: 699_00 },
    ];
    const form = expectForm(
      baseCandidate({
        source: "acquired",
        noteRef: "ANOTE-7",
        accountNumber: "ANOTE-7",
        originationDate: "2018-02-01",
        acquisitionDate: "2025-04-15",
        firstScheduledPaymentDate: null,
        currentBalanceCents: 900_000,
        ledger,
      }),
    );
    expect(form.box2OutstandingMortgagePrincipalCents).toBe(900_000 + 50_00 + 50_25);
    expect(form.box2Basis).toBe("acquisition_during_year");
    // Box 11 is populated only for a mortgage acquired during the year.
    expect(form.box11MortgageAcquisitionDate).toBe("2025-04-15");
    // Box 3 remains the ORIGINATION date per the IRS instructions.
    expect(form.box3MortgageOriginationDate).toBe("2018-02-01");
  });

  it("leaves Box 11 blank when the mortgage was not acquired during the year", () => {
    const form = expectForm(baseCandidate());
    expect(form.box11MortgageAcquisitionDate).toBeNull();
  });

  it("uses original principal when no payment was due before the tax year", () => {
    const form = expectForm(
      baseCandidate({
        originationDate: "2024-11-20",
        firstScheduledPaymentDate: "2025-01-01",
        originalPrincipalCents: 2_100_000,
        // No pre-2025 entry, but none could exist — nothing was due yet.
        ledger: seededLedger().filter((e) => e.date >= "2025-01-01"),
      }),
    );
    expect(form.box2OutstandingMortgagePrincipalCents).toBe(2_100_000);
    expect(form.box2Basis).toBe("no_principal_due_before_year");
  });

  it("reports Box 9 as blank (never 0) since one parcel secures each note", () => {
    const form = expectForm(baseCandidate());
    expect(form.box9NumberOfMortgagedProperties).toBeNull();
  });

  it("sets Box 7 when the securing property is the borrower's address, else Box 8", () => {
    const sameAddr = expectForm(
      baseCandidate({
        propertyAddress: {
          line1: "1420 Pecan Hollow Rd",
          city: "Bastrop",
          state: "TX",
          zip: "78602",
        },
      }),
    );
    expect(sameAddr.box7PropertyAddressSameAsBorrower).toBe(true);
    expect(sameAddr.box8PropertyAddressOrDescription).toBe("");

    const different = expectForm(baseCandidate());
    expect(different.box7PropertyAddressSameAsBorrower).toBe(false);
    expect(different.box8PropertyAddressOrDescription).toContain("TR 14 County Road 219");
  });

  it("keeps every money field an integer number of cents", () => {
    const form = expectForm(baseCandidate());
    for (const v of [
      form.box1MortgageInterestReceivedCents,
      form.box2OutstandingMortgagePrincipalCents,
      form.box4RefundOfOverpaidInterestCents,
      form.box5MortgageInsurancePremiumCents,
      form.box6PointsPaidCents,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

// ─── 2. Incomplete data is REFUSED, never approximated ────────────────────

describe("Form 1098 refuses rather than approximating", () => {
  it("refuses when the borrower has no TIN on file", () => {
    const r = expectRefusal(baseCandidate({ borrowerEncryptedTin: null }));
    expect(r.codes).toContain("BORROWER_TIN_MISSING");
    expect(r.reason).toMatch(/W-9/);
  });

  it("refuses a placeholder TIN instead of filing it", () => {
    const r = expectRefusal(baseCandidate({ borrowerEncryptedTin: "000-00-0000" }));
    expect(r.codes).toContain("BORROWER_TIN_PLACEHOLDER");
  });

  it("refuses when the mortgage origination date (Box 3) is unknown", () => {
    const r = expectRefusal(baseCandidate({ originationDate: null }));
    expect(r.codes).toContain("MORTGAGE_ORIGINATION_DATE_MISSING");
  });

  it("refuses when the borrower's address is incomplete", () => {
    const r = expectRefusal(
      baseCandidate({
        borrowerAddress: { line1: "1420 Pecan Hollow Rd", city: "", state: "TX", zip: "78602" },
      }),
    );
    expect(r.codes).toContain("BORROWER_ADDRESS_INCOMPLETE");
  });

  it("refuses when the property securing the mortgage cannot be identified", () => {
    const r = expectRefusal(
      baseCandidate({
        propertyAddress: null,
        borrowerAddress: { line1: "", city: "", state: "", zip: "" },
      }),
    );
    expect(r.codes).toContain("PROPERTY_SECURING_MORTGAGE_UNKNOWN");
  });

  it("REFUSES a note whose ledger does not cover the start of the tax year", () => {
    // This is the headline case: an imported note, held since 2019, whose
    // AcreOS ledger only begins in May 2025. Any Box 2 figure would omit
    // the principal paid January-April, and Box 1 would understate the
    // interest received. The correct behavior is to refuse.
    const partial = seededLedger().filter((e) => e.date >= "2025-05-01");
    const r = expectRefusal(baseCandidate({ ledger: partial }));
    expect(r.codes).toContain("LEDGER_COVERAGE_INCOMPLETE");
    expect(r.reason).toMatch(/cannot be derived/);
    // It must NOT have quietly produced a partial-year figure.
    expect(r.derivedInterestCents).not.toBeNull();
  });

  it("refuses when rolling the balance back yields a negative principal", () => {
    const r = expectRefusal(
      baseCandidate({
        currentBalanceCents: -50_000_000,
      }),
    );
    expect(r.codes).toContain("PRINCIPAL_DERIVATION_INCONSISTENT");
  });

  it("accumulates every distinct reason on one refusal", () => {
    const r = expectRefusal(
      baseCandidate({
        borrowerEncryptedTin: null,
        originationDate: null,
        borrowerName: "   ",
      }),
    );
    expect(r.codes).toContain("BORROWER_TIN_MISSING");
    expect(r.codes).toContain("MORTGAGE_ORIGINATION_DATE_MISSING");
    expect(r.codes).toContain("BORROWER_NAME_MISSING");
  });

  it("never emits a form when it refuses", () => {
    const out = deriveForm1098(baseCandidate({ borrowerEncryptedTin: null }), lender, TAX_YEAR);
    expect(out.kind).toBe("refusal");
    expect("form" in out).toBe(false);
  });
});

// ─── Exclusions are not refusals ──────────────────────────────────────────

describe("Form 1098 exclusions (no form legitimately required)", () => {
  it("excludes interest under the $600 threshold", () => {
    const out = deriveForm1098(
      baseCandidate({
        ledger: [
          { date: "2024-12-01", principalCents: 10_00, interestCents: 5_00 },
          { date: "2025-03-01", principalCents: 10_00, interestCents: 599_99 },
        ],
      }),
      lender,
      TAX_YEAR,
    );
    expect(out.kind).toBe("excluded");
    if (out.kind === "excluded") expect(out.exclusion.code).toBe("BELOW_600_THRESHOLD");
  });

  it("includes interest at exactly $600 — the threshold is inclusive", () => {
    const form = expectForm(
      baseCandidate({
        ledger: [
          { date: "2024-12-01", principalCents: 10_00, interestCents: 5_00 },
          { date: "2025-03-01", principalCents: 10_00, interestCents: FORM_1098_THRESHOLD_CENTS },
        ],
      }),
    );
    expect(form.box1MortgageInterestReceivedCents).toBe(60_000);
  });

  it("excludes a note with no interest received at all", () => {
    const out = deriveForm1098(
      baseCandidate({ ledger: [{ date: "2024-12-01", principalCents: 0, interestCents: 0 }] }),
      lender,
      TAX_YEAR,
    );
    expect(out.kind).toBe("excluded");
    if (out.kind === "excluded") expect(out.exclusion.code).toBe("NO_INTEREST_RECEIVED");
  });

  it("excludes an entity payer — 1098 is only for individuals", () => {
    const out = deriveForm1098(
      baseCandidate({ borrowerTinType: "EIN", borrowerName: "Delgado Ranch LLC" }),
      lender,
      TAX_YEAR,
    );
    expect(out.kind).toBe("excluded");
    if (out.kind === "excluded") expect(out.exclusion.code).toBe("PAYER_NOT_AN_INDIVIDUAL");
  });
});

// ─── 3. Idempotency ───────────────────────────────────────────────────────

describe("Form 1098 batch regeneration is idempotent", () => {
  const candidates = [
    baseCandidate(),
    baseCandidate({
      noteRef: "NOTE-42",
      accountNumber: "NOTE-42",
      borrowerName: "Owen Whitfield",
      propertyAddress: null,
    }),
    baseCandidate({ noteRef: "NOTE-43", accountNumber: "NOTE-43", borrowerEncryptedTin: null }),
  ];

  it("produces identical output when run twice over the same ledger", () => {
    const first = derive1098Batch(candidates, lender, TAX_YEAR);
    const second = derive1098Batch(candidates, lender, TAX_YEAR);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("does not duplicate or double-count when a note appears twice", () => {
    const once = derive1098Batch(candidates, lender, TAX_YEAR);
    // Simulate a re-scan that yields every candidate a second time.
    const twice = derive1098Batch([...candidates, ...candidates], lender, TAX_YEAR);

    expect(twice.forms.length).toBe(once.forms.length);
    expect(twice.refusals.length).toBe(once.refusals.length);

    const totalOnce = once.forms.reduce((s, f) => s + f.box1MortgageInterestReceivedCents, 0);
    const totalTwice = twice.forms.reduce((s, f) => s + f.box1MortgageInterestReceivedCents, 0);
    expect(totalTwice).toBe(totalOnce);

    // Account numbers are unique — Pub 1220 requires it per payee/form type.
    const accounts = twice.forms.map((f) => f.accountNumber);
    expect(new Set(accounts).size).toBe(accounts.length);
  });

  it("produces a byte-identical FIRE file across regenerations", () => {
    const a = derive1098Batch(candidates, lender, TAX_YEAR);
    const b = derive1098Batch(candidates, lender, TAX_YEAR);
    const fireA = build1098FireFile(a.forms, TAX_YEAR);
    const fireB = build1098FireFile(b.forms, TAX_YEAR);
    expect(fireA).not.toBeNull();
    expect(fireB!.text).toBe(fireA!.text);
  });

  it("sorts forms deterministically regardless of candidate order", () => {
    const forward = derive1098Batch(candidates, lender, TAX_YEAR);
    const reversed = derive1098Batch([...candidates].reverse(), lender, TAX_YEAR);
    expect(reversed.forms.map((f) => f.accountNumber)).toEqual(
      forward.forms.map((f) => f.accountNumber),
    );
  });
});

// ─── 4. No TIN in logs, errors, or refusal reasons ────────────────────────

describe("Form 1098 never leaks a TIN", () => {
  it("keeps the TIN out of every refusal reason and code", () => {
    const cases = [
      baseCandidate({ borrowerEncryptedTin: "000-00-0000" }),
      baseCandidate({ originationDate: null }),
      baseCandidate({ ledger: seededLedger().filter((e) => e.date >= "2025-05-01") }),
      baseCandidate({ currentBalanceCents: -50_000_000 }),
    ];
    for (const c of cases) {
      const r = expectRefusal(c);
      const serialized = JSON.stringify(r);
      expect(serialized).not.toContain(BORROWER_TIN);
      expect(serialized).not.toContain(BORROWER_TIN.replace(/-/g, ""));
      expect(serialized).not.toContain("000-00-0000");
    }
  });

  it("keeps TINs out of the batch summary that gets logged", () => {
    // Mirrors exactly what generate1098Batch passes to logger.info: counts
    // and codes only, never a form or a refusal reason.
    const { forms, refusals, exclusions } = derive1098Batch(
      [baseCandidate(), baseCandidate({ noteRef: "NOTE-99", accountNumber: "NOTE-99", borrowerEncryptedTin: null })],
      lender,
      TAX_YEAR,
    );
    const logPayload = {
      formCount: forms.length,
      refusalCount: refusals.length,
      exclusionCount: exclusions.length,
      refusalCodes: Array.from(new Set(refusals.flatMap((r) => r.codes))),
      totalInterestReceivedCents: forms.reduce(
        (s, f) => s + f.box1MortgageInterestReceivedCents,
        0,
      ),
    };
    const serialized = JSON.stringify(logPayload);
    expect(serialized).not.toContain(BORROWER_TIN);
    expect(serialized).not.toContain(BORROWER_TIN.replace(/-/g, ""));
    expect(serialized).not.toContain(LENDER_EIN);
  });

  it("does not leak ciphertext or plaintext when decryption fails", () => {
    // An `enc:v1:` envelope that cannot be decrypted must be treated as
    // missing, not surfaced.
    const r = expectRefusal(
      baseCandidate({ borrowerEncryptedTin: "enc:v1:dGhpcy1pcy1ub3QtdmFsaWQ=" }),
    );
    expect(r.codes).toContain("BORROWER_TIN_MISSING");
    expect(JSON.stringify(r)).not.toContain("enc:v1:");
  });
});

// ─── FIRE e-file record shape ─────────────────────────────────────────────

describe("Form 1098 FIRE file conforms to Pub 1220 record shape", () => {
  it("passes structural validation and carries the 1098 return type", () => {
    const { forms } = derive1098Batch([baseCandidate()], lender, TAX_YEAR);
    const fire = build1098FireFile(forms, TAX_YEAR);
    expect(fire).not.toBeNull();
    expect(validateFireFile(fire!.text)).toEqual([]);

    const records = fire!.text.split("\r\n").filter((r) => r.length > 0);
    // Every record is exactly 750 positions.
    for (const r of records) expect(r.length).toBe(750);
    expect(records.map((r) => r[0]).join("")).toBe("TABCF");

    // Issuer "A" Record positions 26-27 — Type of Return "3" for Form 1098.
    const aRecord = records[1]!;
    expect(aRecord.slice(25, 27)).toBe("3 ");
    // Positions 28-45 — Amount Codes, ascending. Interest (1) + outstanding
    // principal (6) are always reported.
    expect(aRecord.slice(27, 45).trimEnd()).toBe("16");
  });

  it("places Box 1 in Payment Amount 1 and Box 2 in Payment Amount 6", () => {
    const { forms } = derive1098Batch([baseCandidate()], lender, TAX_YEAR);
    const form = forms[0]!;
    const fire = build1098FireFile(forms, TAX_YEAR)!;
    const bRecord = fire.text.split("\r\n")[2]!;

    // Payment Amount 1 → positions 55-66 (0-based 54-66).
    expect(bRecord.slice(54, 66)).toBe(
      String(form.box1MortgageInterestReceivedCents).padStart(12, "0"),
    );
    // Payment Amount 6 → positions 115-126 (0-based 114-126).
    expect(bRecord.slice(114, 126)).toBe(
      String(form.box2OutstandingMortgagePrincipalCents).padStart(12, "0"),
    );
    // Mortgage Origination Date → positions 544-551, YYYYMMDD.
    expect(bRecord.slice(543, 551)).toBe("20190614");
  });

  it("puts the C-record control totals in the right amount slots", () => {
    const { forms } = derive1098Batch([baseCandidate()], lender, TAX_YEAR);
    const fire = build1098FireFile(forms, TAX_YEAR)!;
    const cRecord = fire.text.split("\r\n")[3]!;
    const form = forms[0]!;
    // Control Total 1 → positions 16-33 (interest received).
    expect(cRecord.slice(15, 33)).toBe(
      String(form.box1MortgageInterestReceivedCents).padStart(18, "0"),
    );
    // Control Total 6 → positions 106-123 (outstanding principal).
    expect(cRecord.slice(105, 123)).toBe(
      String(form.box2OutstandingMortgagePrincipalCents).padStart(18, "0"),
    );
  });

  it("returns null rather than an empty file when there are no forms", () => {
    expect(build1098FireFile([], TAX_YEAR)).toBeNull();
  });
});

// ─── PDFs render ──────────────────────────────────────────────────────────

describe("Form 1098 PDFs", () => {
  it("renders a per-borrower 1098 and a 1096 transmittal", () => {
    const { forms } = derive1098Batch([baseCandidate()], lender, TAX_YEAR);
    const pdf = render1098Pdf(forms[0]!);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const transmittal = render1096For1098Pdf(forms, TAX_YEAR);
    expect(transmittal.subarray(0, 4).toString()).toBe("%PDF");
  });
});

// ─── Date normalization ───────────────────────────────────────────────────

describe("toIsoDay", () => {
  it("normalizes date strings, timestamps and Date objects", () => {
    expect(toIsoDay("2025-03-04")).toBe("2025-03-04");
    expect(toIsoDay("2025-03-04T18:22:00.000Z")).toBe("2025-03-04");
    expect(toIsoDay(new Date("2025-03-04T00:00:00.000Z"))).toBe("2025-03-04");
  });

  it("returns null for absent or unparseable values rather than guessing", () => {
    expect(toIsoDay(null)).toBeNull();
    expect(toIsoDay(undefined)).toBeNull();
    expect(toIsoDay("")).toBeNull();
    expect(toIsoDay("not a date")).toBeNull();
    expect(toIsoDay(new Date("nope"))).toBeNull();
  });
});
