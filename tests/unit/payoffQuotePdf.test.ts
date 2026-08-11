/**
 * EXIT TEST — payoff-quote PDF artifact (Wave 3, notes vertical).
 *
 * The claim under test is narrow and falsifiable: **the PDF is a function of
 * the frozen `note_payoff_quotes` row and of nothing else.**
 *
 *   1. Every figure the document prints equals the row's stored output, to the
 *      cent. Derived from a field→line map, so a new money line cannot be
 *      added without being pinned.
 *   2. Editing the underlying loan AFTER the quote does not change the
 *      rendered PDF. Proven twice: (a) behaviourally — the engine's output
 *      moves when the loan moves while the rendered bytes do not, and
 *      (b) structurally — the renderer's own source contains no engine
 *      import, no db import, and no reference to a loan table, so a
 *      recomputation path does not exist to be accidentally reintroduced.
 *   3. A row missing a required input REFUSES rather than printing a blank or
 *      a guess. One case derived per entry in `REQUIRED_QUOTE_FIELDS`.
 *   4. The required disclaimer is present in the RENDERED ARTIFACT — asserted
 *      against the PDF bytes, not against an import.
 *   5. The license-aware egress chokepoint is routed, not bypassed: a
 *      provider-derived region without provenance is withheld from the bytes
 *      and disclosed on the face of the document.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  REQUIRED_QUOTE_FIELDS,
  PAYOFF_QUOTE_PDF_CHANNEL,
  PayoffQuoteRenderRefusal,
  renderPayoffQuotePdf,
} from "../../server/services/payoffQuotePdf";
import {
  computePayoffQuote,
  parseIsoDateUtc,
  PAYOFF_ENGINE_VERSION,
  PAYOFF_DAY_COUNT_CONVENTION,
} from "../../server/services/notePaymentMath";
import { DISCLAIMER_WORKSHEET } from "../../server/services/legalDisclaimers";

const REPO_ROOT = join(__dirname, "..", "..");
const SERVICE_PATH = join(REPO_ROOT, "server", "services", "payoffQuotePdf.ts");
const ROUTE_PATH = join(REPO_ROOT, "server", "routes-payoff-quote-pdf.ts");

/**
 * The statement model for a row. `buildPayoffQuoteStatement` is deliberately
 * NOT exported — the module's public surface is exactly what the route
 * consumes — so the model is reached the way production reaches it.
 */
function statementFor(
  row: Record<string, unknown>,
  opts?: { orgName?: string | null },
) {
  return renderPayoffQuotePdf(row, opts).statement;
}

/** Expected money string, formatted independently of the module under test. */
function expectedUsd(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs - whole * 100).padStart(2, "0");
  return `${neg ? "-" : ""}$${whole.toLocaleString("en-US")}.${frac}`;
}

/**
 * Extract the drawn text from a jsPDF buffer. jsPDF writes uncompressed
 * content streams and paints every string as `(escaped) Tj`, so the document's
 * actual visible text is recoverable — which is what makes "present in the
 * rendered artifact" checkable rather than assertable by hand-wave. Wrapped
 * paragraphs arrive as one `Tj` per line, so the lines are rejoined with a
 * space and whitespace is collapsed before matching.
 */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g;
  const drawn: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    drawn.push(m[1].replace(/\\([()\\])/g, "$1"));
  }
  return drawn.join(" ").replace(/\s+/g, " ");
}

// ── The loan, and the quote frozen from it ─────────────────────────────────
//
// A real engine run, not hand-typed numbers: the frozen row must be the exact
// shape the recording endpoint writes (server/routes-notes.ts
// POST /api/notes/:id/payoff/quotes), or this test pins a fiction.

interface LoanSnapshot {
  principalBalanceCents: number;
  annualRateBps: number;
  accrualStartDate: string;
  unappliedCreditCents: number;
  payoffFeeCents: number;
}

const LOAN_AT_QUOTE_TIME: LoanSnapshot = {
  principalBalanceCents: 4_825_000, // $48,250.00
  annualRateBps: 987.5, // 9.875% — sub-basis-point, the case an int bps column loses
  accrualStartDate: "2026-07-01",
  unappliedCreditCents: 12_500,
  payoffFeeCents: 15_000,
};

const PAYOFF_DATE = "2026-08-14";

function quoteFromLoan(loan: LoanSnapshot, payoffDate = PAYOFF_DATE) {
  return computePayoffQuote({
    principalBalanceCents: loan.principalBalanceCents,
    annualRateBps: loan.annualRateBps,
    accrualStartDate: parseIsoDateUtc(loan.accrualStartDate),
    payoffDate: parseIsoDateUtc(payoffDate),
    unappliedCreditCents: loan.unappliedCreditCents,
    lateFeesOutstandingCents: 0,
    payoffFeeCents: loan.payoffFeeCents,
  });
}

/** The frozen row, written exactly as the recording endpoint writes it. */
function freezeQuoteRow(
  loan: LoanSnapshot,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const q = quoteFromLoan(loan);
  return {
    id: "3f2a9c11-0000-4a1b-9f00-payoffquote01",
    organizationId: 42,
    noteSystem: "acquired_note",
    noteRef: "8c1e5b90-1111-4d2c-8e33-acquirednote01",
    noteNumber: "AN-2026-0114",
    payerName: "Maria Delgado",
    quotedByUserId: "user_linnea",
    channel: "operator_api",
    quotedAt: new Date("2026-08-11T15:04:05.000Z"),
    payoffDate: q.payoffDate,
    goodThroughDate: q.payoffDate,
    principalBalanceCents: q.principalBalanceCents,
    annualRateBpsHundredths: Math.round(q.annualRateBps * 100),
    accrualStartDate: q.accrualStartDate,
    daysAccrued: q.daysAccrued,
    dayCountConvention: q.dayCountConvention,
    perDiemInterestCents: q.perDiemInterestCents,
    accruedInterestCents: q.accruedInterestCents,
    unappliedCreditCents: q.unappliedCreditCents,
    lateFeesOutstandingCents: q.lateFeesOutstandingCents,
    payoffFeeCents: q.payoffFeeCents,
    totalPayoffCents: q.totalPayoffCents,
    engineVersion: q.engineVersion,
    engineInputJson: {
      principalBalanceCents: loan.principalBalanceCents,
      annualRateBps: loan.annualRateBps,
      accrualStartDate: loan.accrualStartDate,
      payoffDate: PAYOFF_DATE,
      unappliedCreditCents: loan.unappliedCreditCents,
      lateFeesOutstandingCents: 0,
      payoffFeeCents: loan.payoffFeeCents,
      dayCountConvention: PAYOFF_DAY_COUNT_CONVENTION,
      engineVersion: PAYOFF_ENGINE_VERSION,
    },
    notes: "Requested by Bluebonnet Title for a 8/14 close.",
    createdAt: new Date("2026-08-11T15:04:05.000Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (1) The figures equal the frozen row's stored output, exactly.
// ---------------------------------------------------------------------------

describe("renders the frozen row, to the cent", () => {
  /**
   * Map from a money line's label prefix to the row column it must equal.
   * DERIVED, not restated: the test walks the statement's own `lines` array,
   * so a line added to the document without an entry here fails loudly rather
   * than shipping unpinned.
   */
  const LINE_TO_COLUMN: Record<string, string> = {
    "Principal balance": "principalBalanceCents",
    "Accrued interest": "accruedInterestCents",
    "Late fees included": "lateFeesOutstandingCents",
    "Payoff / processing fee": "payoffFeeCents",
    "Less unapplied credit held": "unappliedCreditCents", // rendered negated
    "TOTAL PAYOFF": "totalPayoffCents",
  };

  it("every printed money line equals its stored column", () => {
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME);
    const s = statementFor(row, { orgName: "Delgado Note Fund LLC" });

    expect(s.lines.length).toBe(Object.keys(LINE_TO_COLUMN).length);

    for (const line of s.lines) {
      const key = Object.keys(LINE_TO_COLUMN).find((k) => line.label.startsWith(k));
      expect(key, `unpinned money line on the statement: "${line.label}"`).toBeTruthy();
      const stored = row[LINE_TO_COLUMN[key!]] as number;
      const expected = key === "Less unapplied credit held" ? -stored : stored;
      expect(line.cents, `${line.label} must equal row.${LINE_TO_COLUMN[key!]}`).toBe(expected);
    }
  });

  it("the scalar figures equal their stored columns", () => {
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME);
    const s = statementFor(row);

    expect(s.totalPayoffCents).toBe(row.totalPayoffCents);
    expect(s.perDiemCents).toBe(row.perDiemInterestCents);
    expect(s.asOfDate).toBe(row.payoffDate);
    expect(s.goodThroughDate).toBe(row.goodThroughDate);
    expect(s.quoteId).toBe(row.id);
    expect(s.engineVersion).toBe(row.engineVersion);
    expect(s.dayCountConvention).toBe(row.dayCountConvention);
  });

  it("prints the as-of date, the per-diem, the inputs and the quote id in the bytes", () => {
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME);
    const { buffer, statement, filename } = renderPayoffQuotePdf(row, {
      orgName: "Delgado Note Fund LLC",
    });
    const text = pdfText(buffer);

    // The quote id — the thing that makes the figure traceable.
    expect(text).toContain(String(row.id));
    expect(filename).toBe(`payoff-quote-${row.id}.pdf`);
    // As-of + good-through, spelled out (never a locale-shifted Date).
    expect(text).toContain("August 14, 2026");
    // The per-diem, so extending the quote has a published price.
    expect(text).toContain(statement.perDiemFormatted);
    // Every money line.
    for (const line of statement.lines) expect(text).toContain(line.formatted);
    // The inputs the figure was computed from.
    expect(text).toContain("9.875%");
    expect(text).toContain(PAYOFF_DAY_COUNT_CONVENTION);
    expect(text).toContain(PAYOFF_ENGINE_VERSION);
    expect(text).toContain(String(row.daysAccrued));
  });

  it("formats money and rates with integer math (no float drift)", () => {
    // Asserted through the printed statement, not through a private helper:
    // what matters is the string on the page.
    const s = statementFor(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    expect(s.lines[0].formatted).toBe("$48,250.00");
    expect(s.inputRows.find(([k]) => k === "Annual rate")?.[1]).toBe("9.875%");

    // A one-cent balance must print as one cent, not "$0" or "$0.010000001".
    const penny = statementFor(
      freezeQuoteRow(
        { ...LOAN_AT_QUOTE_TIME, principalBalanceCents: 1 },
      ),
    );
    expect(penny.lines[0].formatted).toBe("$0.01");

    // Whole-percent and sub-basis-point rates both survive the integer path.
    const whole = statementFor(freezeQuoteRow(LOAN_AT_QUOTE_TIME, { annualRateBpsHundredths: 100_000 }));
    expect(whole.inputRows.find(([k]) => k === "Annual rate")?.[1]).toBe("10.00%");
    const hair = statementFor(freezeQuoteRow(LOAN_AT_QUOTE_TIME, { annualRateBpsHundredths: 1 }));
    expect(hair.inputRows.find(([k]) => k === "Annual rate")?.[1]).toBe("0.0001%");
  });

  it("renders unrecorded identity fields as unknown, never as an invented value", () => {
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME, {
      noteNumber: null,
      payerName: null,
      quotedByUserId: null,
      notes: null,
    });
    const s = statementFor(row);
    expect(s.noteNumber).toBe("Not recorded");
    expect(s.payerName).toBe("Not recorded");
    expect(s.quotedByUserId).toBe("Not recorded");
    expect(s.operatorNotes).toBeNull();
  });

  it("labels the money block as what the quote INCLUDED, not as what is owed", () => {
    // Refuse-not-fabricate applies to negative claims: the row records
    // lateFeesOutstandingCents = 0 because the engine was handed 0, which is
    // not evidence that no late fees exist. The artifact must not assert one.
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME);
    const { buffer, statement } = renderPayoffQuotePdf(row);
    const text = pdfText(buffer);
    expect(statement.lines.some((l) => l.label === "Late fees included")).toBe(true);
    expect(statement.lines.some((l) => /outstanding|owed|due/i.test(l.label))).toBe(false);
    expect(text).toContain("Amounts included in this payoff");
    expect(statement.exclusionNote).toMatch(/excluded from this figure rather than estimated/);
    expect(text).toContain("excluded from this figure rather than estimated");
  });
});

// ---------------------------------------------------------------------------
// (2) Editing the loan after the quote does not change the rendered PDF.
// ---------------------------------------------------------------------------

describe("frozen: the loan may move, the document may not", () => {
  it("the engine's answer moves while the rendered bytes do not", () => {
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME);
    const before = renderPayoffQuotePdf(row, { orgName: "Delgado Note Fund LLC" });

    // The borrower makes a curtailment and the note is re-rated AFTER the
    // quote was issued. This is the scenario the table exists for.
    const LOAN_AFTER_EDIT: LoanSnapshot = {
      principalBalanceCents: 3_000_000,
      annualRateBps: 1_250,
      accrualStartDate: "2026-08-01",
      unappliedCreditCents: 0,
      payoffFeeCents: 0,
    };

    // Guard the guard: the edit must genuinely move the engine, or "unchanged"
    // proves nothing.
    const recomputed = quoteFromLoan(LOAN_AFTER_EDIT);
    expect(recomputed.totalPayoffCents).not.toBe(row.totalPayoffCents);
    expect(recomputed.perDiemInterestCents).not.toBe(row.perDiemInterestCents);
    expect(recomputed.accruedInterestCents).not.toBe(row.accruedInterestCents);

    // Render the SAME frozen row again. The row is the only input the
    // renderer has, so the document is byte-identical.
    const after = renderPayoffQuotePdf(row, { orgName: "Delgado Note Fund LLC" });

    expect(after.statement.totalPayoffCents).toBe(before.statement.totalPayoffCents);
    expect(after.statement.perDiemCents).toBe(before.statement.perDiemCents);
    expect(pdfText(after.buffer)).toContain(before.statement.totalPayoffFormatted);
    expect(pdfText(after.buffer)).not.toContain(expectedUsd(recomputed.totalPayoffCents));
    // Every glyph the document paints is identical across the loan edit.
    // (Raw bytes differ only by jsPDF's own creation timestamp and the /ID
    // hash derived from it — neither is drawn on the page.)
    expect(pdfText(after.buffer)).toBe(pdfText(before.buffer));
  });

  it("no recomputation path exists in the renderer's source", () => {
    // Structural, not behavioural: a future edit that re-derives the figure
    // from a loan would pass the test above (it would still read the row for
    // *these* fields) but reintroduce the defect. Deny the capability.
    const src = readFileSync(SERVICE_PATH, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");

    for (const forbidden of [
      "computePayoffQuote",
      "computePayoffCents",
      "computeAcquiredNotePayoff",
      "resolvePayoffAccrualStart",
      "payoffInputsFromServicedNote",
      "notePaymentMath",
      "acquiredNotes",
      "notePayments",
      'from "../db"',
      'from "./db"',
      "drizzle-orm",
    ]) {
      expect(
        code.includes(forbidden),
        `payoffQuotePdf.ts must not reference ${forbidden} — the PDF renders from the frozen row only`,
      ).toBe(false);
    }
    // Positive half of the claim: it does read the frozen row's own columns.
    expect(code).toContain("totalPayoffCents");
    expect(code).toContain("REQUIRED_QUOTE_FIELDS");
  });

  it("the route reads a recorded row and does not compute one", () => {
    const src = readFileSync(ROUTE_PATH, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
    expect(code).toContain("notePayoffQuotes");
    // Org-scoped AT the query, not filtered in the handler.
    expect(code).toContain("eq(notePayoffQuotes.organizationId, orgId)");
    for (const forbidden of ["computePayoffQuote", "computeAcquiredNotePayoff", "acquiredNotes"]) {
      expect(code.includes(forbidden), `route must not reference ${forbidden}`).toBe(false);
    }
    // House patterns.
    expect(code).toContain("AuthenticatedRequest");
    expect(code).not.toContain("(req as any)");
    expect(code).not.toContain("res.status(");
    expect(code).not.toContain("console.");
  });
});

// ---------------------------------------------------------------------------
// (3) A row missing a required input refuses.
// ---------------------------------------------------------------------------

describe("refuses rather than printing a blank or a guess", () => {
  // One case per required field, DERIVED from the service's own list.
  for (const field of REQUIRED_QUOTE_FIELDS) {
    it(`refuses when ${field} is null`, () => {
      const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME, { [field]: null });
      let thrown: unknown = null;
      try {
        renderPayoffQuotePdf(row);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(PayoffQuoteRenderRefusal);
      expect((thrown as PayoffQuoteRenderRefusal).defects.join(" ")).toContain(field);
    });

    it(`refuses when ${field} is absent entirely`, () => {
      const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME);
      delete row[field];
      expect(() => renderPayoffQuotePdf(row)).toThrow(PayoffQuoteRenderRefusal);
    });
  }

  it("refuses a malformed date rather than shifting the as-of day", () => {
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME, { payoffDate: "14/08/2026" });
    expect(() => renderPayoffQuotePdf(row)).toThrow(/payoffDate is not a YYYY-MM-DD date/);
  });

  it("refuses a non-integer money column", () => {
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME, { totalPayoffCents: 4_922_178.5 });
    expect(() => renderPayoffQuotePdf(row)).toThrow(/totalPayoffCents is not an integer/);
  });

  it("refuses a row whose stored total contradicts its own components", () => {
    // A corrupted row must not become a document that disagrees with itself.
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME, {
      totalPayoffCents: (freezeQuoteRow(LOAN_AT_QUOTE_TIME).totalPayoffCents as number) + 1,
    });
    expect(() => renderPayoffQuotePdf(row)).toThrow(/does not reconcile with its own components/);
  });

  it("does not apply the reconciliation rule to an engine it does not know", () => {
    // A future engine may total differently; refusing an old row because a NEW
    // rule disagrees would be its own dishonesty. The row still renders, and
    // still names the engine that produced it.
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME, {
      engineVersion: "payoff-engine-9",
      totalPayoffCents: 1_234_567,
    });
    const s = statementFor(row);
    expect(s.totalPayoffCents).toBe(1_234_567);
    expect(s.engineVersion).toBe("payoff-engine-9");
  });

  it("a refusal produces no document at all", () => {
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME, { totalPayoffCents: null });
    let out: unknown = null;
    try {
      out = renderPayoffQuotePdf(row);
    } catch {
      /* expected */
    }
    expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (4) The disclaimer is IN the artifact, not merely imported.
// ---------------------------------------------------------------------------

describe("required disclaimer", () => {
  it("mounts the worksheet/computed-statement legend from the shared type map", () => {
    const s = statementFor(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    expect(s.disclaimer).toBe(DISCLAIMER_WORKSHEET);
  });

  it("prints the disclaimer text into the rendered bytes", () => {
    const { buffer } = renderPayoffQuotePdf(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    const text = pdfText(buffer);
    // Sample distinctive clauses — jsPDF wraps lines, so assert on phrases
    // that survive wrapping rather than on the whole paragraph.
    expect(text).toContain("informational worksheet");
    expect(text).toContain("AcreOS is not your servicer");
    expect(text).toContain("verify every figure independently");
  });

  it("states that the document is frozen, not recomputed", () => {
    const { buffer } = renderPayoffQuotePdf(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    expect(pdfText(buffer)).toContain("not from a fresh calculation");
  });
});

// ---------------------------------------------------------------------------
// (5) The egress chokepoint is routed, not bypassed.
// ---------------------------------------------------------------------------

describe("license-aware egress", () => {
  it("uses the pdf-artifact channel already defined by the chokepoint", () => {
    expect(PAYOFF_QUOTE_PDF_CHANNEL).toBe("pdf-artifact");
    const src = readFileSync(SERVICE_PATH, "utf8");
    expect(src).toContain('from "./licenseEgress"');
    expect(src).toContain("screenRecordForExport");
  });

  it("releases a first-party payoff row untouched and claims no withholding", () => {
    // Negative claims get verified in both directions: assert the notice is
    // NULL for a clean row rather than assuming it.
    const s = statementFor(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    expect(s.egressNotice).toBeNull();
    expect(s.egressAttributions).toEqual([]);
    const { buffer } = renderPayoffQuotePdf(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    expect(pdfText(buffer)).not.toContain("withheld from this PDF report");
  });

  it("withholds an unprovenanced provider-derived region and says so on the face", () => {
    // If a provider-derived field is ever attached to a payoff row, the
    // chokepoint — not this renderer — decides whether it may leave.
    const row = freezeQuoteRow(LOAN_AT_QUOTE_TIME, {
      parcelData: { apn: "R123456", owner: "SECRET VENDOR VALUE" },
    });
    const s = statementFor(row);
    expect(s.egressNotice).toBeTruthy();
    expect(s.egressNotice).toContain("withheld");

    const { buffer } = renderPayoffQuotePdf(row);
    const text = pdfText(buffer);
    expect(text).not.toContain("SECRET VENDOR VALUE");
    expect(text).toContain("withheld");
    // …and the payoff figures are unaffected by the screen.
    expect(s.totalPayoffCents).toBe(row.totalPayoffCents);
  });
});

describe("fleet-13 audit — the page is pinned by POSITION, not merely by presence", () => {
  /**
   * Every byte-level assertion in this suite was a `toContain` — membership.
   * The audit proved what that misses: swapping the headline figure from
   * `s.totalPayoffFormatted` to `s.lines[0].formatted` left all 58 tests
   * green, because the total is still drawn (in the money block) and the
   * principal is still drawn (as a line item), so both strings are present no
   * matter which one sits under the headline.
   *
   * The document that produced would read "Total payoff $48,250.00" at 26pt at
   * the top and "TOTAL PAYOFF $48,824.37" below — a $574.37 contradiction on
   * the page a closer wires from. Presence proves something was painted;
   * nothing about WHICH, or WHERE.
   */
  const firstMoneyAfter = (text: string, label: string): string | null => {
    const at = text.indexOf(label);
    if (at < 0) return null;
    const m = /\$[\d,]+\.\d{2}/.exec(text.slice(at + label.length));
    return m ? m[0] : null;
  };

  it("the figure under the 'Total payoff' headline IS the total, not a line item", () => {
    const { buffer, statement } = renderPayoffQuotePdf(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    const text = pdfText(buffer);

    expect(firstMoneyAfter(text, "Total payoff")).toBe(statement.totalPayoffFormatted);
    // And it is NOT the principal — the exact substitution that survived.
    expect(firstMoneyAfter(text, "Total payoff")).not.toBe(statement.lines[0].formatted);
  });

  it("the figure under 'TOTAL PAYOFF' in the money block is the same number", () => {
    const { buffer, statement } = renderPayoffQuotePdf(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    const text = pdfText(buffer);
    // One document, one total. A headline and a footer that disagree is the
    // failure mode; assert they are the same string, not merely both present.
    expect(firstMoneyAfter(text, "TOTAL PAYOFF")).toBe(statement.totalPayoffFormatted);
  });

  it("the drawn money sequence follows the statement's own line order", () => {
    const { buffer, statement } = renderPayoffQuotePdf(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    const text = pdfText(buffer);
    // Ordered containment: each line's formatted amount appears after the
    // previous line's, so re-ordering or dropping a line reddens this even
    // though every string remains "present".
    let cursor = text.indexOf("Principal balance");
    expect(cursor).toBeGreaterThan(-1);
    for (const line of statement.lines) {
      const at = text.indexOf(line.formatted, cursor);
      expect(at, `line "${line.label}" (${line.formatted}) out of order`).toBeGreaterThan(-1);
      cursor = at;
    }
  });
});

describe("fleet-13 audit — a clamped total states the floor instead of hiding it", () => {
  /**
   * `computePayoffQuote` floors the total at zero. The renderer's
   * self-reconciliation used the SAME clamp, so it agreed with the row by
   * construction in precisely the case where the printed components do not sum
   * to the printed total — the one reachable way to produce the contradiction
   * the check exists to prevent. It is reachable in production:
   * `computeAcquiredNotePayoff` feeds `unappliedBalanceCents`, a real column.
   */
  const base = freezeQuoteRow(LOAN_AT_QUOTE_TIME);
  const withSurplus = {
    ...base,
    unappliedCreditCents: 6_000_000, // $60,000 deposit against a ~$48.8k payoff
    totalPayoffCents: 0, // what the engine's Math.max(0, …) stores
  };

  it("prints the returnable surplus rather than a bare $0.00", () => {
    const { buffer, statement } = renderPayoffQuotePdf(withSurplus as typeof base);
    const text = pdfText(buffer);

    // The total is genuinely zero and still says so.
    expect(statement.totalPayoffFormatted).toBe("$0.00");
    // …but the page no longer stops there.
    expect(text).toContain("Credit balance remaining after payoff");
    expect(text).toContain("returnable to borrower");

    const surplus = statement.lines.find((l) =>
      l.label.startsWith("Credit balance remaining"),
    );
    expect(surplus).toBeDefined();
    // Derived from the statement's OWN printed lines rather than from field
    // names guessed off the row — the surplus must equal the credit minus
    // everything the page charged, or the page still does not add up.
    const charged = statement.lines
      .filter((l) => l.cents > 0 && !l.label.startsWith("TOTAL") && !l.label.startsWith("Credit balance"))
      .reduce((sum, l) => sum + l.cents, 0);
    expect(charged).toBeGreaterThan(0);
    expect(surplus!.cents).toBe(Number(withSurplus.unappliedCreditCents) - charged);
    expect(text).toContain(surplus!.formatted);
  });

  it("an ordinary quote grows no surplus line", () => {
    // The line must appear ONLY when the components genuinely do not sum —
    // otherwise it is noise on every statement, and a reader learns to skip it.
    const { statement } = renderPayoffQuotePdf(freezeQuoteRow(LOAN_AT_QUOTE_TIME));
    expect(
      statement.lines.some((l) => l.label.startsWith("Credit balance remaining")),
    ).toBe(false);
  });
});
