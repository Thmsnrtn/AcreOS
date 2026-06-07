/**
 * taxEngine — Founder draft-return computation engine (FOUNDER-SIDE ONLY).
 *
 * Computes a federal Form 1040 estimate + a Massachusetts Form 1 estimate from
 * structured income inputs. The ONLY numeric constants come from the year-stamped
 * taxRules tables; this module is pure arithmetic + line-by-line BASIS strings so
 * every figure can show its work.
 *
 * HONESTY CONTRACT (non-negotiable — this is self-prep software, NOT advice and
 * NOT e-file):
 *   - Every computed return carries `disclaimer` + `provisional` flags.
 *   - Every LINE carries a `basis` string explaining how it was derived.
 *   - Out-of-scope items (itemized deductions, AMT, QBI, cap-gains rates, the
 *     full credit catalog) are enumerated in `notModeled` so the founder knows
 *     exactly what the estimate omits.
 *   - This is pure + deterministic so the tax math is unit-testable: known
 *     income → known federal + MA figures.
 *
 * Pure module: NO db, NO encryption, NO logging. Callers (lifeCockpit service)
 * decrypt amounts first and pass plain numbers in; nothing here ever touches a
 * secret store or a logger.
 */

import {
  getFederalRules,
  getMassachusettsRules,
  type FederalRules,
  type FilingStatus,
  type MassachusettsRules,
  type TaxBracket,
} from "./taxRules";

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * A single income line, already decrypted to a plain whole-dollar amount.
 * Mirrors founder_income_sources but stripped of storage concerns.
 */
export interface TaxEngineIncomeInput {
  /** w2_self | w2_spouse | acreos_draw | side_income | other */
  sourceType: string;
  label: string;
  /** Whole-dollar annual amount. */
  amount: number;
  /** True for W-2 wages where the employer withholds; false for 1099/side. */
  withholdingAtSource: boolean;
  /**
   * Federal income tax already withheld for this source (W-2 box 2), if known.
   * Whole dollars. Optional — defaults to 0 (an honest under-estimate of
   * withholding that the founder corrects from their actual W-2).
   */
  federalWithheld?: number;
  /** State income tax already withheld for this source (W-2 box 17), if known. */
  stateWithheld?: number;
}

export interface TaxEngineInput {
  taxYear: number;
  filingStatus: FilingStatus;
  /** Two-letter state code; only "MA" is modeled for the state return. */
  state: string;
  income: TaxEngineIncomeInput[];
}

// ─── Output line shape ─────────────────────────────────────────────────────────

export interface ReturnLine {
  /** Stable key for the UI (e.g. "fed_agi"). */
  key: string;
  /** Form line reference, e.g. "1040 line 11". */
  formRef: string;
  label: string;
  /** Whole-dollar amount. */
  amount: number;
  /** Plain-language explanation of how this figure was derived. */
  basis: string;
}

export interface FederalReturnEstimate {
  jurisdiction: "federal";
  taxYear: number;
  rulesYearUsed: number;
  exactYearMatch: boolean;
  provisional: boolean;
  rulesSource: string;
  lines: ReturnLine[];
  /** Headline figures for quick UI display. */
  summary: {
    totalIncome: number;
    adjustedGrossIncome: number;
    taxableIncome: number;
    incomeTax: number;
    selfEmploymentTax: number;
    totalTax: number;
    totalWithheld: number;
    /** Positive = refund expected; negative = balance due. */
    refundOrOwed: number;
    /** Effective rate = totalTax / totalIncome (0 if no income). */
    effectiveRate: number;
  };
}

export interface MassachusettsReturnEstimate {
  jurisdiction: "massachusetts";
  taxYear: number;
  rulesYearUsed: number;
  exactYearMatch: boolean;
  provisional: boolean;
  rulesSource: string;
  lines: ReturnLine[];
  summary: {
    massachusettsAgi: number;
    personalExemption: number;
    taxableIncome: number;
    incomeTax: number;
    surtax: number;
    totalTax: number;
    totalWithheld: number;
    refundOrOwed: number;
    effectiveRate: number;
  };
}

export interface DraftReturn {
  taxYear: number;
  filingStatus: FilingStatus;
  state: string;
  generatedAt: string;
  /** The single banner the UI shows above everything. */
  disclaimer: string;
  /** True if EITHER federal or state used provisional (unreleased) figures. */
  provisional: boolean;
  /** Explicit list of what this estimate does NOT model. */
  notModeled: string[];
  federal: FederalReturnEstimate;
  /** Null when state !== "MA" (we only model MA). */
  massachusetts: MassachusettsReturnEstimate | null;
}

export const DRAFT_DISCLAIMER =
  "ESTIMATE — review and verify before filing. AcreOS Life-Cockpit is self-prepared " +
  "tax software, not tax advice and not an e-file service. These figures are a draft " +
  "to help you transcribe into IRS Free File Fillable Forms / MassTaxConnect or hand " +
  "to a CPA. Confirm every number against your official W-2s, 1099s, and the current " +
  "IRS / MA DOR instructions before you file.";

const NOT_MODELED: string[] = [
  "Itemized deductions (Schedule A) — standard deduction is assumed.",
  "Capital gains / qualified dividends preferential rates.",
  "Alternative Minimum Tax (AMT).",
  "Qualified Business Income deduction (Section 199A / QBI).",
  "Tax credits beyond none applied (CTC, EITC, education, energy, etc.).",
  "Self-employment tax is a flagged estimate only (no Schedule C expense detail).",
  "MA-specific deductions/credits beyond the personal exemption (e.g. rental, FICA, dependent).",
  "State returns for any state other than Massachusetts.",
  "Underpayment penalties / quarterly-estimate safe-harbor analysis.",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n);
}

function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

/**
 * Progressive bracket tax. Brackets are ordered ascending by lowerBound; each
 * applies its marginal rate to the slice of taxable income within its band.
 */
export function computeBracketTax(
  taxableIncome: number,
  brackets: readonly TaxBracket[],
): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const band = brackets[i];
    const next = brackets[i + 1];
    const upper = next ? next.lowerBound : Infinity;
    if (taxableIncome <= band.lowerBound) break;
    const slice = Math.min(taxableIncome, upper) - band.lowerBound;
    if (slice > 0) tax += slice * band.rate;
  }
  return round(tax);
}

interface IncomeBuckets {
  wages: number;
  selfEmployment: number;
  totalIncome: number;
  federalWithheld: number;
  stateWithheld: number;
  hasUnwithheldIncome: boolean;
}

function bucketIncome(income: TaxEngineIncomeInput[]): IncomeBuckets {
  let wages = 0;
  let selfEmployment = 0;
  let federalWithheld = 0;
  let stateWithheld = 0;
  let hasUnwithheldIncome = false;

  for (const src of income) {
    const amt = Number.isFinite(src.amount) ? Math.max(0, round(src.amount)) : 0;
    if (src.withholdingAtSource) {
      wages += amt;
    } else {
      // 1099 / side income / draw without withholding → self-employment-ish.
      selfEmployment += amt;
      if (amt > 0) hasUnwithheldIncome = true;
    }
    federalWithheld += Number.isFinite(src.federalWithheld ?? NaN)
      ? Math.max(0, round(src.federalWithheld as number))
      : 0;
    stateWithheld += Number.isFinite(src.stateWithheld ?? NaN)
      ? Math.max(0, round(src.stateWithheld as number))
      : 0;
  }

  return {
    wages,
    selfEmployment,
    totalIncome: wages + selfEmployment,
    federalWithheld,
    stateWithheld,
    hasUnwithheldIncome,
  };
}

// ─── Federal ─────────────────────────────────────────────────────────────────

function computeSelfEmploymentTax(
  netSe: number,
  wages: number,
  rules: FederalRules,
): { seTax: number; deductiblePortion: number; basis: string } {
  const se = rules.selfEmployment;
  if (netSe <= 0) {
    return { seTax: 0, deductiblePortion: 0, basis: "No income without withholding → no self-employment tax." };
  }
  const seBase = round(netSe * se.netEarningsFactor);
  // OASDI portion is capped at the wage base, reduced by W-2 wages already
  // subject to Social Security (a conservative honest approximation).
  const oasdiCeiling = clampNonNegative(se.socialSecurityWageBase - wages);
  const oasdiBase = Math.min(seBase, oasdiCeiling);
  const oasdi = round(oasdiBase * se.oasdiRate);
  const medicare = round(seBase * se.medicareRate);
  const seTax = oasdi + medicare;
  const deductiblePortion = round(seTax * se.deductibleFraction);
  return {
    seTax,
    deductiblePortion,
    basis:
      `SE base = net SE income $${netSe.toLocaleString()} × ${se.netEarningsFactor} = $${seBase.toLocaleString()}; ` +
      `OASDI ${(se.oasdiRate * 100).toFixed(1)}% on $${oasdiBase.toLocaleString()} (capped at wage base $${se.socialSecurityWageBase.toLocaleString()} less W-2 wages) = $${oasdi.toLocaleString()}; ` +
      `Medicare ${(se.medicareRate * 100).toFixed(2)}% on $${seBase.toLocaleString()} = $${medicare.toLocaleString()}. ESTIMATE — Schedule SE without expense detail.`,
  };
}

export function computeFederalReturn(input: TaxEngineInput): FederalReturnEstimate {
  const { rules, exactMatch } = getFederalRules(input.taxYear);
  const buckets = bucketIncome(input.income);
  const stdDeduction = rules.standardDeduction[input.filingStatus];

  const { seTax, deductiblePortion, basis: seBasis } = computeSelfEmploymentTax(
    buckets.selfEmployment,
    buckets.wages,
    rules,
  );

  const totalIncome = buckets.totalIncome;
  // AGI = total income minus the deductible half of SE tax (the only above-the-
  // line adjustment modeled).
  const agi = clampNonNegative(totalIncome - deductiblePortion);
  const taxableIncome = clampNonNegative(agi - stdDeduction);
  const incomeTax = computeBracketTax(taxableIncome, rules.brackets[input.filingStatus]);
  const totalTax = incomeTax + seTax;
  const totalWithheld = buckets.federalWithheld;
  const refundOrOwed = totalWithheld - totalTax;
  const effectiveRate = totalIncome > 0 ? totalTax / totalIncome : 0;

  const lines: ReturnLine[] = [
    {
      key: "fed_wages",
      formRef: "1040 line 1a",
      label: "Wages (W-2)",
      amount: buckets.wages,
      basis: "Sum of all income sources marked as withheld-at-source (W-2 wages, self + spouse).",
    },
    {
      key: "fed_se_income",
      formRef: "Schedule 1 / Schedule C",
      label: "Business / side income (1099)",
      amount: buckets.selfEmployment,
      basis: "Sum of income sources WITHOUT withholding at source (side income, draws). Net of expenses not modeled.",
    },
    {
      key: "fed_total_income",
      formRef: "1040 line 9",
      label: "Total income",
      amount: totalIncome,
      basis: "Wages + business/side income.",
    },
    {
      key: "fed_se_deduction",
      formRef: "Schedule 1 line 15",
      label: "Deduction for ½ self-employment tax",
      amount: deductiblePortion,
      basis: deductiblePortion > 0
        ? `One-half of estimated self-employment tax ($${seTax.toLocaleString()} × 0.5).`
        : "None — no self-employment income.",
    },
    {
      key: "fed_agi",
      formRef: "1040 line 11",
      label: "Adjusted gross income (AGI)",
      amount: agi,
      basis: "Total income minus the deductible half of self-employment tax (only above-the-line adjustment modeled).",
    },
    {
      key: "fed_std_deduction",
      formRef: "1040 line 12",
      label: "Standard deduction",
      amount: stdDeduction,
      basis: `${rules.taxYear} standard deduction for ${humanFilingStatus(input.filingStatus)} = $${stdDeduction.toLocaleString()} (${rules.source}). Itemizing not modeled.`,
    },
    {
      key: "fed_taxable_income",
      formRef: "1040 line 15",
      label: "Taxable income",
      amount: taxableIncome,
      basis: "AGI minus standard deduction, floored at $0.",
    },
    {
      key: "fed_income_tax",
      formRef: "1040 line 16",
      label: "Income tax (brackets)",
      amount: incomeTax,
      basis: `Progressive ${rules.taxYear} ${humanFilingStatus(input.filingStatus)} brackets applied to taxable income. No preferential cap-gains rates modeled.`,
    },
    {
      key: "fed_se_tax",
      formRef: "Schedule 2 line 4 (Schedule SE)",
      label: "Self-employment tax",
      amount: seTax,
      basis: seBasis,
    },
    {
      key: "fed_total_tax",
      formRef: "1040 line 22 / 24",
      label: "Total tax",
      amount: totalTax,
      basis: "Income tax + self-employment tax. No additional credits or other taxes modeled.",
    },
    {
      key: "fed_withheld",
      formRef: "1040 line 25",
      label: "Federal tax withheld",
      amount: totalWithheld,
      basis: totalWithheld > 0
        ? "Sum of federal withholding entered per income source (W-2 box 2)."
        : "No federal withholding entered yet — enter your W-2 box 2 amounts to estimate refund vs. balance due.",
    },
    {
      key: "fed_result",
      formRef: "1040 line 34 / 37",
      label: refundOrOwed >= 0 ? "Estimated refund" : "Estimated balance due",
      amount: Math.abs(refundOrOwed),
      basis: "Federal withholding minus total tax. Positive = refund; negative = balance due. Estimated quarterly payments not included.",
    },
  ];

  return {
    jurisdiction: "federal",
    taxYear: input.taxYear,
    rulesYearUsed: rules.taxYear,
    exactYearMatch: exactMatch,
    provisional: rules.provisional || !exactMatch,
    rulesSource: rules.source,
    lines,
    summary: {
      totalIncome,
      adjustedGrossIncome: agi,
      taxableIncome,
      incomeTax,
      selfEmploymentTax: seTax,
      totalTax,
      totalWithheld,
      refundOrOwed,
      effectiveRate,
    },
  };
}

// ─── Massachusetts ─────────────────────────────────────────────────────────────

export function computeMassachusettsReturn(input: TaxEngineInput): MassachusettsReturnEstimate {
  const { rules, exactMatch } = getMassachusettsRules(input.taxYear);
  const buckets = bucketIncome(input.income);

  // MA Part B income ≈ total income (wages + side income). MA does NOT use the
  // federal standard deduction; it uses a personal exemption.
  const maAgi = buckets.totalIncome;
  const exemption = rules.personalExemption[input.filingStatus];
  const taxableIncome = clampNonNegative(maAgi - exemption);
  const incomeTax = round(taxableIncome * rules.flatRate);
  const surtaxBase = clampNonNegative(taxableIncome - rules.surtax.threshold);
  const surtax = round(surtaxBase * rules.surtax.rate);
  const totalTax = incomeTax + surtax;
  const totalWithheld = buckets.stateWithheld;
  const refundOrOwed = totalWithheld - totalTax;
  const effectiveRate = maAgi > 0 ? totalTax / maAgi : 0;

  const lines: ReturnLine[] = [
    {
      key: "ma_total_income",
      formRef: "MA Form 1 line 10 (5.0% income)",
      label: "Massachusetts 5.0% income",
      amount: maAgi,
      basis: "Wages + side income reported as MA Part B (ordinary) income. MA-specific deductions not modeled.",
    },
    {
      key: "ma_exemption",
      formRef: "MA Form 1 line 2a (exemptions)",
      label: "Personal exemption",
      amount: exemption,
      basis: `${rules.taxYear} MA personal exemption for ${humanFilingStatus(input.filingStatus)} = $${exemption.toLocaleString()} (${rules.source}).`,
    },
    {
      key: "ma_taxable_income",
      formRef: "MA Form 1 line 21",
      label: "Taxable 5.0% income",
      amount: taxableIncome,
      basis: "MA income minus personal exemption, floored at $0.",
    },
    {
      key: "ma_income_tax",
      formRef: "MA Form 1 line 22",
      label: `Income tax (${(rules.flatRate * 100).toFixed(1)}% flat)`,
      amount: incomeTax,
      basis: `Taxable income × MA flat rate ${(rules.flatRate * 100).toFixed(1)}%.`,
    },
    {
      key: "ma_surtax",
      formRef: "MA Form 1 line 28 (4% surtax)",
      label: "Fair Share surtax (4%)",
      amount: surtax,
      basis: surtax > 0
        ? `${(rules.surtax.rate * 100).toFixed(0)}% on taxable income above $${rules.surtax.threshold.toLocaleString()}.`
        : `None — taxable income is below the $${rules.surtax.threshold.toLocaleString()} surtax threshold.`,
    },
    {
      key: "ma_total_tax",
      formRef: "MA Form 1 line 32",
      label: "Total Massachusetts tax",
      amount: totalTax,
      basis: "Flat-rate income tax + Fair Share surtax. MA credits not modeled.",
    },
    {
      key: "ma_withheld",
      formRef: "MA Form 1 line 38",
      label: "Massachusetts tax withheld",
      amount: totalWithheld,
      basis: totalWithheld > 0
        ? "Sum of MA withholding entered per income source (W-2 box 17)."
        : "No MA withholding entered yet — enter your W-2 box 17 amounts to estimate refund vs. balance due.",
    },
    {
      key: "ma_result",
      formRef: "MA Form 1 line 49 / 50",
      label: refundOrOwed >= 0 ? "Estimated MA refund" : "Estimated MA balance due",
      amount: Math.abs(refundOrOwed),
      basis: "MA withholding minus total MA tax. Positive = refund; negative = balance due.",
    },
  ];

  return {
    jurisdiction: "massachusetts",
    taxYear: input.taxYear,
    rulesYearUsed: rules.taxYear,
    exactYearMatch: exactMatch,
    provisional: rules.provisional || !exactMatch,
    rulesSource: rules.source,
    lines,
    summary: {
      massachusettsAgi: maAgi,
      personalExemption: exemption,
      taxableIncome,
      incomeTax,
      surtax,
      totalTax,
      totalWithheld,
      refundOrOwed,
      effectiveRate,
    },
  };
}

// ─── Top-level draft ───────────────────────────────────────────────────────────

export function computeDraftReturn(input: TaxEngineInput): DraftReturn {
  const federal = computeFederalReturn(input);
  const massachusetts =
    input.state.toUpperCase() === "MA" ? computeMassachusettsReturn(input) : null;

  return {
    taxYear: input.taxYear,
    filingStatus: input.filingStatus,
    state: input.state.toUpperCase(),
    generatedAt: new Date().toISOString(),
    disclaimer: DRAFT_DISCLAIMER,
    provisional: federal.provisional || (massachusetts?.provisional ?? false),
    notModeled: NOT_MODELED,
    federal,
    massachusetts,
  };
}

// ─── Display helpers ───────────────────────────────────────────────────────────

export function humanFilingStatus(status: FilingStatus): string {
  switch (status) {
    case "single":
      return "Single";
    case "married_joint":
      return "Married filing jointly";
    case "married_separate":
      return "Married filing separately";
    case "head_of_household":
      return "Head of household";
    case "qualifying_widow":
      return "Qualifying surviving spouse";
    default:
      return status;
  }
}
