/**
 * RESPA §1024.17(i) annual escrow account statement tests.
 *
 * The analysis service has had a §1024.17 spec in its header for a long
 * time and produced no disclosure artifact. These tests pin the artifact's
 * behavior, and above all the refusal discipline: a statement that contains
 * an assumed figure misstates a borrower's escrow account, so a missing
 * required input must REFUSE rather than fill a plausible value.
 *
 * Pure-function tests — no DATABASE_URL, no database.
 */
import { describe, it, expect } from "vitest";

import {
  buildAnnualEscrowStatement,
  renderAnnualEscrowStatementPdf,
  type AnnualEscrowStatementInput,
  type EscrowStatementActualMonth,
  type RespaEscrowAnalysis,
} from "../../server/services/respaEscrowAnalysis";

// ─── Fixtures ─────────────────────────────────────────────────────────────

/** Projection for the COMING year, shaped exactly as analyzeEscrowAccount emits. */
function analysisFixture(
  overrides: Partial<RespaEscrowAnalysis> = {},
): RespaEscrowAnalysis {
  const monthlyRunningBalances = Array.from({ length: 12 }, (_, m) => ({
    monthIndex: m,
    depositCents: 20_000,
    disbursementCents: m === 10 ? 240_000 : 0,
    runningBalanceCents: 0,
  }));
  return {
    noteId: 77,
    computationYearStart: "2026-01-01T00:00:00.000Z",
    computationYearEnd: "2026-12-31T00:00:00.000Z",
    monthlyEscrowPaymentCents: 20_000,
    currentEscrowBalanceCents: 60_000,
    totalProjectedAnnualDisbursementsCents: 240_000,
    maxCushionCents: 40_000,
    monthlyRunningBalances,
    lowestProjectedMonthlyBalanceCents: 20_000,
    lowestProjectedMonthlyBalanceMonth: 10,
    status: "shortage",
    surplusCents: 0,
    shortageCents: 20_000,
    deficiencyCents: 0,
    requiredAction: {
      code: "shortage_collect_lump_or_spread",
      description:
        "Shortage of $200.00. Servicer must offer borrower either a single lump-sum payment " +
        "OR a monthly add-on spread over at least 12 months (§1024.17(f)(3)).",
    },
    recomputedMonthlyEscrowPaymentCents: 21_667,
    generatedAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * A reconciling 12-month history: opens at $500, twelve $200 deposits
 * ($2,400 in), one $2,300 tax disbursement and one $150 insurance
 * disbursement ($2,450 out), so it closes at $450.
 */
function historyFixture(): EscrowStatementActualMonth[] {
  return Array.from({ length: 12 }, (_, m): EscrowStatementActualMonth => {
    const disbursements: EscrowStatementActualMonth["disbursements"] = [];
    if (m === 9) {
      disbursements.push({
        category: "property_tax",
        description: "Bastrop County 2025 taxes",
        amountCents: 230_000,
      });
    }
    if (m === 4) {
      disbursements.push({
        category: "homeowners_insurance",
        description: "Hazard policy renewal",
        amountCents: 15_000,
      });
    }
    return { monthIndex: m, depositCents: 20_000, disbursements };
  });
}

const OPENING = 50_000;
const TOTAL_IN = 12 * 20_000; // 240_000
const TOTAL_OUT = 230_000 + 15_000; // 245_000
const CLOSING = OPENING + TOTAL_IN - TOTAL_OUT; // 45_000

function inputFixture(
  overrides: Partial<AnnualEscrowStatementInput> = {},
): AnnualEscrowStatementInput {
  return {
    analysis: analysisFixture(),
    borrowerName: "Marisol Delgado",
    propertyAddress: "TR 14 County Road 219, Bastrop, TX 78602",
    servicerName: "Cedar Ridge Land Holdings LLC",
    servicerAddress: "900 Congress Ave Ste 400, Austin, TX 78701",
    servicerPhone: "5125550100",
    computationYearEndedStart: "2025-01-01",
    computationYearEndedEnd: "2025-12-31",
    startingBalanceCents: OPENING,
    endingBalanceCents: CLOSING,
    actualHistory: historyFixture(),
    currentMonthlyPaymentCents: 95_000,
    currentMonthlyEscrowPortionCents: 20_000,
    priorYearMonthlyPaymentCents: 93_000,
    priorYearMonthlyEscrowPortionCents: 18_000,
    priorYearProjectedLowestBalanceCents: 30_000,
    ...overrides,
  };
}

function expectStatement(input: AnnualEscrowStatementInput) {
  const out = buildAnnualEscrowStatement(input);
  if (out.kind !== "statement") {
    throw new Error(`expected a statement, got refusal: ${out.reason}`);
  }
  return out.statement;
}

function expectRefusal(input: AnnualEscrowStatementInput) {
  const out = buildAnnualEscrowStatement(input);
  if (out.kind !== "refused") throw new Error("expected a refusal, got a statement");
  return out;
}

// ─── The statement's §1024.17(i)(1) content ───────────────────────────────

describe("§1024.17(i) annual escrow statement content", () => {
  it("reports (i) current and (ii) prior-year payment plus escrow portions", () => {
    const s = expectStatement(inputFixture());
    expect(s.currentMonthlyPaymentCents).toBe(95_000);
    expect(s.currentMonthlyEscrowPortionCents).toBe(20_000);
    expect(s.priorYearMonthlyPaymentCents).toBe(93_000);
    expect(s.priorYearMonthlyEscrowPortionCents).toBe(18_000);
  });

  it("reports (iii) total paid in and (iv) total paid out from the history", () => {
    const s = expectStatement(inputFixture());
    expect(s.totalPaidIntoEscrowCents).toBe(TOTAL_IN);
    expect(s.totalPaidOutOfEscrowCents).toBe(TOTAL_OUT);
  });

  it("separately identifies (iv) disbursements by category", () => {
    const s = expectStatement(inputFixture());
    const byCat = Object.fromEntries(
      s.disbursementsByCategory.map((c) => [c.category, c.amountCents]),
    );
    expect(byCat["Taxes"]).toBe(230_000);
    expect(byCat["Homeowner's insurance premiums"]).toBe(15_000);
    // Totals must agree with the itemization — no unexplained residue.
    expect(s.disbursementsByCategory.reduce((t, c) => t + c.amountCents, 0)).toBe(TOTAL_OUT);
  });

  it("reports (v) the closing balance and a reconciling running balance", () => {
    const s = expectStatement(inputFixture());
    expect(s.endingBalanceCents).toBe(CLOSING);
    // The last row of the account history must land on the closing balance.
    expect(s.accountHistory[11]!.runningBalanceCents).toBe(CLOSING);
    expect(s.accountHistory).toHaveLength(12);
  });

  it("identifies the lowest balance the account ACTUALLY reached", () => {
    const s = expectStatement(inputFixture());
    // Month 10 (index 9) pays $2,300 of taxes; balance dips there.
    // Opening 50_000 + 5 deposits (100_000) - 15_000 insurance = 135_000 by
    // month index 4; by index 9 it is 50_000 + 200_000 - 15_000 - 230_000.
    expect(s.actualLowestBalanceCents).toBe(5_000);
    expect(s.actualLowestBalanceMonth).toBe(9);
  });

  it("carries (vi)/(vii) straight from the §1024.17(f) determination", () => {
    const s = expectStatement(inputFixture());
    expect(s.status).toBe("shortage");
    expect(s.shortageCents).toBe(20_000);
    expect(s.surplusOrShortageExplanation).toMatch(/§1024\.17\(f\)\(3\)/);
    expect(s.newMonthlyEscrowPaymentCents).toBe(21_667);
  });

  it("explains (viii) the variance against last year's projection", () => {
    const s = expectStatement(inputFixture());
    // Actual low $50.00 vs projected $300.00 → $250.00 below.
    expect(s.lowBalanceVarianceExplanation).toContain("$250.00");
    expect(s.lowBalanceVarianceExplanation).toContain("below");
    expect(s.lowBalanceVarianceExplanation).toContain("§1024.17(i)(1)(viii)");
  });

  it("states (viii) is not applicable for a first computation year", () => {
    const s = expectStatement(
      inputFixture({
        priorYearProjectedLowestBalanceCents: undefined,
        isFirstComputationYear: true,
      }),
    );
    expect(s.lowBalanceVarianceExplanation).toMatch(/[Nn]ot applicable/);
    expect(s.lowBalanceVarianceExplanation).toContain("first computation year");
  });

  it("computes the 30-day delivery deadline from the computation year end", () => {
    const s = expectStatement(inputFixture());
    expect(s.deliveryDueBy.slice(0, 10)).toBe("2026-01-30");
  });

  it("carries the coming year's projection alongside the history", () => {
    const s = expectStatement(inputFixture());
    expect(s.projection).toHaveLength(12);
    expect(s.projectedLowestBalanceCents).toBe(20_000);
    expect(s.maxCushionCents).toBe(40_000);
  });

  it("keeps every money field an integer number of cents", () => {
    const s = expectStatement(inputFixture());
    const values = [
      s.totalPaidIntoEscrowCents,
      s.totalPaidOutOfEscrowCents,
      s.startingBalanceCents,
      s.endingBalanceCents,
      s.actualLowestBalanceCents,
      ...s.accountHistory.map((m) => m.runningBalanceCents),
      ...s.disbursementsByCategory.map((c) => c.amountCents),
    ];
    for (const v of values) expect(Number.isInteger(v)).toBe(true);
  });
});

// ─── Refusals: missing required input ⇒ refuse, never fill ────────────────

describe("§1024.17(i) statement refuses on missing required input", () => {
  it("refuses when no account history is supplied", () => {
    const r = expectRefusal(inputFixture({ actualHistory: [] }));
    expect(r.codes).toContain("ACCOUNT_HISTORY_MISSING");
    // The reason must say WHY it cannot be derived.
    expect(r.reason).toMatch(/escrow component/);
  });

  it("refuses a partial account history instead of extrapolating the rest", () => {
    const r = expectRefusal({
      ...inputFixture(),
      actualHistory: historyFixture().slice(0, 7),
    });
    expect(r.codes).toContain("ACCOUNT_HISTORY_INCOMPLETE");
    expect(r.reason).toMatch(/missing month indices/);
  });

  it("refuses when the history does not reconcile to the closing balance", () => {
    // Off by one cent — still a refusal. The statement must not be published
    // with a balance the itemized activity does not produce.
    const r = expectRefusal(inputFixture({ endingBalanceCents: CLOSING + 1 }));
    expect(r.codes).toContain("ACCOUNT_HISTORY_DOES_NOT_RECONCILE");
    expect(r.reason).toMatch(/discrepancy/);
  });

  it("accepts a history that reconciles exactly", () => {
    const s = expectStatement(inputFixture({ endingBalanceCents: CLOSING }));
    expect(s.endingBalanceCents).toBe(CLOSING);
  });

  it("refuses when last year's monthly payment is not retained", () => {
    const r = expectRefusal(inputFixture({ priorYearMonthlyPaymentCents: 0 }));
    expect(r.codes).toContain("PRIOR_YEAR_PAYMENT_MISSING");
    expect(r.reason).toMatch(/§1024\.17\(i\)\(1\)\(ii\)/);
  });

  it("refuses when the current monthly payment is unknown", () => {
    const r = expectRefusal(inputFixture({ currentMonthlyPaymentCents: 0 }));
    expect(r.codes).toContain("CURRENT_PAYMENT_MISSING");
  });

  it("refuses when the prior-year projection is absent and no first-year assertion", () => {
    const r = expectRefusal(
      inputFixture({
        priorYearProjectedLowestBalanceCents: undefined,
        isFirstComputationYear: undefined,
      }),
    );
    expect(r.codes).toContain("PRIOR_YEAR_PROJECTION_MISSING");
  });

  it("refuses when borrower, property or servicer identity is missing", () => {
    expect(expectRefusal(inputFixture({ borrowerName: "  " })).codes).toContain(
      "BORROWER_NAME_MISSING",
    );
    expect(expectRefusal(inputFixture({ propertyAddress: "" })).codes).toContain(
      "PROPERTY_ADDRESS_MISSING",
    );
    expect(expectRefusal(inputFixture({ servicerAddress: "" })).codes).toContain(
      "SERVICER_IDENTITY_INCOMPLETE",
    );
  });

  it("refuses when the computation year is not identified", () => {
    const r = expectRefusal(inputFixture({ computationYearEndedEnd: "" }));
    expect(r.codes).toContain("COMPUTATION_YEAR_DATES_MISSING");
  });

  it("reports every missing input at once rather than one at a time", () => {
    const r = expectRefusal(
      inputFixture({
        actualHistory: [],
        priorYearMonthlyPaymentCents: 0,
        borrowerName: "",
      }),
    );
    expect(r.codes).toContain("ACCOUNT_HISTORY_MISSING");
    expect(r.codes).toContain("PRIOR_YEAR_PAYMENT_MISSING");
    expect(r.codes).toContain("BORROWER_NAME_MISSING");
  });

  it("never returns a statement when it refuses", () => {
    const out = buildAnnualEscrowStatement(inputFixture({ actualHistory: [] }));
    expect(out.kind).toBe("refused");
    expect("statement" in out).toBe(false);
  });
});

// ─── Surplus / deficiency wording flows through ───────────────────────────

describe("§1024.17(f) determination flows into the statement", () => {
  it("carries a surplus refund instruction", () => {
    const s = expectStatement(
      inputFixture({
        analysis: analysisFixture({
          status: "surplus",
          surplusCents: 12_500,
          shortageCents: 0,
          requiredAction: {
            code: "refund_within_30_days",
            description:
              "Surplus of $125.00 ≥ $50 — refund to borrower within 30 days of analysis " +
              "(§1024.17(f)(2)(i)).",
          },
          recomputedMonthlyEscrowPaymentCents: null,
        }),
      }),
    );
    expect(s.status).toBe("surplus");
    expect(s.surplusCents).toBe(12_500);
    expect(s.surplusOrShortageExplanation).toMatch(/refund/i);
    expect(s.newMonthlyEscrowPaymentCents).toBeNull();
  });

  it("carries a deficiency spread instruction", () => {
    const s = expectStatement(
      inputFixture({
        analysis: analysisFixture({
          status: "deficiency",
          shortageCents: 0,
          deficiencyCents: 45_000,
          requiredAction: {
            code: "deficiency_must_spread_gte_1mo",
            description:
              "Deficiency of $450.00 ≥ 1 month's escrow. Servicer MUST spread over ≥ 2 months " +
              "(§1024.17(f)(4)(ii)).",
          },
          recomputedMonthlyEscrowPaymentCents: 23_750,
        }),
      }),
    );
    expect(s.status).toBe("deficiency");
    expect(s.deficiencyCents).toBe(45_000);
    expect(s.surplusOrShortageExplanation).toMatch(/MUST spread/);
  });
});

// ─── PDF ──────────────────────────────────────────────────────────────────

describe("annual escrow statement PDF", () => {
  it("renders a PDF from the structured statement", () => {
    const s = expectStatement(inputFixture());
    const pdf = renderAnnualEscrowStatementPdf(s);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("renders without a prior-year projection when first-year is asserted", () => {
    const s = expectStatement(
      inputFixture({
        priorYearProjectedLowestBalanceCents: undefined,
        isFirstComputationYear: true,
      }),
    );
    expect(renderAnnualEscrowStatementPdf(s).subarray(0, 4).toString()).toBe("%PDF");
  });
});
