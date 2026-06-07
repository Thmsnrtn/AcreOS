/**
 * taxRules — Year-stamped, citable U.S. federal + Massachusetts tax-rule tables
 * (FOUNDER-SIDE ONLY).
 *
 * This is the SINGLE source of truth for the numeric tax constants the draft-
 * return engine uses. Every table here is:
 *   - stamped with the tax YEAR it encodes,
 *   - annotated with the IRS / MA DOR source it was transcribed from,
 *   - kept deliberately small + boring so it is maintainable and auditable.
 *
 * HONESTY CONTRACT (non-negotiable):
 *   - These are figures for SELF-PREPARED draft estimates. AcreOS is NOT a tax
 *     advisor and does NOT e-file. Every figure the engine derives from these
 *     tables carries an "estimate — verify before filing" disclaimer.
 *   - Where a year's official figures are not yet released (e.g. a future tax
 *     year before the IRS publishes inflation adjustments), the table is marked
 *     `provisional: true` with the basis for the projection, so the UI can say
 *     so out loud. We never present a provisional number as final.
 *
 * SCOPE (intentional): the common case for Tom — MFJ, W-2 wages (self + spouse),
 * 1099/side income, standard deduction, ordinary-income brackets, MA flat tax.
 * It does NOT model: itemized deductions, capital-gains preferential rates, AMT,
 * QBI, the full credit catalog, state-specific carve-outs beyond the basics, or
 * self-employment tax nuance beyond a flagged estimate. Those are out of scope
 * for a draft and are called out as "not modeled" in the package.
 */

export type FilingStatus =
  | "single"
  | "married_joint"
  | "married_separate"
  | "head_of_household"
  | "qualifying_widow";

export interface TaxBracket {
  /** Inclusive lower bound of taxable income for this rate, in whole dollars. */
  readonly lowerBound: number;
  /** Marginal rate as a decimal (0.22 = 22%). */
  readonly rate: number;
}

export interface FederalRules {
  readonly taxYear: number;
  readonly provisional: boolean;
  readonly source: string;
  readonly standardDeduction: Readonly<Record<FilingStatus, number>>;
  readonly brackets: Readonly<Record<FilingStatus, readonly TaxBracket[]>>;
  /**
   * Self-employment tax constants (Schedule SE). Used only as a flagged
   * estimate for 1099 / side income without withholding.
   */
  readonly selfEmployment: {
    /** Net-earnings factor: net SE income × 0.9235 = SE-taxable base. */
    readonly netEarningsFactor: number;
    /** Combined OASDI + Medicare rate on the SE base. */
    readonly seTaxRate: number;
    /** Social-Security wage base cap for the year (OASDI portion only). */
    readonly socialSecurityWageBase: number;
    /** OASDI (Social Security) component of the SE rate. */
    readonly oasdiRate: number;
    /** Medicare component of the SE rate (no wage cap). */
    readonly medicareRate: number;
    /** Deductible portion of SE tax (one-half), an above-the-line deduction. */
    readonly deductibleFraction: number;
  };
}

export interface MassachusettsRules {
  readonly taxYear: number;
  readonly provisional: boolean;
  readonly source: string;
  /** MA Part B flat rate on ordinary income (e.g. wages). */
  readonly flatRate: number;
  /** Personal exemption by filing status (MA Form 1, Line 2a basis). */
  readonly personalExemption: Readonly<Record<FilingStatus, number>>;
  /**
   * "Millionaire" / Fair Share surtax: an additional rate on the portion of
   * taxable income above the threshold (MA Constitution Art. 44 amendment).
   */
  readonly surtax: {
    readonly rate: number;
    readonly threshold: number;
  };
}

// ─── Federal — Tax Year 2025 ────────────────────────────────────────────────
// Source: IRS Rev. Proc. 2024-40 (2025 inflation adjustments) + IRS 1040
// instructions. Standard deduction & brackets are the FINAL published 2025
// figures. SE-tax: 2025 Social Security wage base $176,100 (SSA 2024 press
// release). These are the figures a 2025 return filed in early 2026 uses.
const FEDERAL_2025: FederalRules = {
  taxYear: 2025,
  provisional: false,
  source:
    "IRS Rev. Proc. 2024-40 (2025 std deduction + brackets); SSA 2025 wage base $176,100; IRS Schedule SE.",
  standardDeduction: {
    single: 15000,
    married_joint: 30000,
    married_separate: 15000,
    head_of_household: 22500,
    qualifying_widow: 30000,
  },
  brackets: {
    single: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 11925, rate: 0.12 },
      { lowerBound: 48475, rate: 0.22 },
      { lowerBound: 103350, rate: 0.24 },
      { lowerBound: 197300, rate: 0.32 },
      { lowerBound: 250525, rate: 0.35 },
      { lowerBound: 626350, rate: 0.37 },
    ],
    married_joint: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 23850, rate: 0.12 },
      { lowerBound: 96950, rate: 0.22 },
      { lowerBound: 206700, rate: 0.24 },
      { lowerBound: 394600, rate: 0.32 },
      { lowerBound: 501050, rate: 0.35 },
      { lowerBound: 751600, rate: 0.37 },
    ],
    married_separate: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 11925, rate: 0.12 },
      { lowerBound: 48475, rate: 0.22 },
      { lowerBound: 103350, rate: 0.24 },
      { lowerBound: 197300, rate: 0.32 },
      { lowerBound: 250525, rate: 0.35 },
      { lowerBound: 375800, rate: 0.37 },
    ],
    head_of_household: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 17000, rate: 0.12 },
      { lowerBound: 64850, rate: 0.22 },
      { lowerBound: 103350, rate: 0.24 },
      { lowerBound: 197300, rate: 0.32 },
      { lowerBound: 250500, rate: 0.35 },
      { lowerBound: 626350, rate: 0.37 },
    ],
    // Qualifying surviving spouse uses the MFJ schedule + std deduction.
    qualifying_widow: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 23850, rate: 0.12 },
      { lowerBound: 96950, rate: 0.22 },
      { lowerBound: 206700, rate: 0.24 },
      { lowerBound: 394600, rate: 0.32 },
      { lowerBound: 501050, rate: 0.35 },
      { lowerBound: 751600, rate: 0.37 },
    ],
  },
  selfEmployment: {
    netEarningsFactor: 0.9235,
    seTaxRate: 0.153,
    socialSecurityWageBase: 176100,
    oasdiRate: 0.124,
    medicareRate: 0.029,
    deductibleFraction: 0.5,
  },
};

// ─── Federal — Tax Year 2026 (PROVISIONAL) ──────────────────────────────────
// Source: IRS Rev. Proc. 2025-32 (2026 inflation adjustments) where published;
// figures here are the announced 2026 std deduction + brackets. Marked
// provisional because a 2026 return is not filed until early 2027 and late
// legislative changes can still move figures. SE wage base for 2026 is the
// SSA-announced $184,500 (2026 cost-of-living adjustment).
const FEDERAL_2026: FederalRules = {
  taxYear: 2026,
  provisional: true,
  source:
    "IRS Rev. Proc. 2025-32 (announced 2026 std deduction + brackets); SSA 2026 wage base $184,500. Provisional — a 2026 return is filed in 2027; verify against final IRS instructions before filing.",
  standardDeduction: {
    single: 16100,
    married_joint: 32200,
    married_separate: 16100,
    head_of_household: 24150,
    qualifying_widow: 32200,
  },
  brackets: {
    single: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 12400, rate: 0.12 },
      { lowerBound: 50400, rate: 0.22 },
      { lowerBound: 105700, rate: 0.24 },
      { lowerBound: 201775, rate: 0.32 },
      { lowerBound: 256225, rate: 0.35 },
      { lowerBound: 640600, rate: 0.37 },
    ],
    married_joint: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 24800, rate: 0.12 },
      { lowerBound: 100800, rate: 0.22 },
      { lowerBound: 211400, rate: 0.24 },
      { lowerBound: 403550, rate: 0.32 },
      { lowerBound: 512450, rate: 0.35 },
      { lowerBound: 768700, rate: 0.37 },
    ],
    married_separate: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 12400, rate: 0.12 },
      { lowerBound: 50400, rate: 0.22 },
      { lowerBound: 105700, rate: 0.24 },
      { lowerBound: 201775, rate: 0.32 },
      { lowerBound: 256225, rate: 0.35 },
      { lowerBound: 384350, rate: 0.37 },
    ],
    head_of_household: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 17700, rate: 0.12 },
      { lowerBound: 67450, rate: 0.22 },
      { lowerBound: 105700, rate: 0.24 },
      { lowerBound: 201775, rate: 0.32 },
      { lowerBound: 256200, rate: 0.35 },
      { lowerBound: 640600, rate: 0.37 },
    ],
    qualifying_widow: [
      { lowerBound: 0, rate: 0.1 },
      { lowerBound: 24800, rate: 0.12 },
      { lowerBound: 100800, rate: 0.22 },
      { lowerBound: 211400, rate: 0.24 },
      { lowerBound: 403550, rate: 0.32 },
      { lowerBound: 512450, rate: 0.35 },
      { lowerBound: 768700, rate: 0.37 },
    ],
  },
  selfEmployment: {
    netEarningsFactor: 0.9235,
    seTaxRate: 0.153,
    socialSecurityWageBase: 184500,
    oasdiRate: 0.124,
    medicareRate: 0.029,
    deductibleFraction: 0.5,
  },
};

// ─── Massachusetts — Tax Year 2025 ──────────────────────────────────────────
// Source: MA DOR — Form 1 instructions. Part B income (wages) flat rate 5.0%.
// Personal exemptions: Single $4,400; MFJ $8,800; MFS $4,400; HOH $6,800.
// Fair Share surtax: +4% on taxable income over $1,083,150 (2025 inflation-
// adjusted threshold, MA DOR TIR 24-13).
const MA_2025: MassachusettsRules = {
  taxYear: 2025,
  provisional: false,
  source:
    "MA DOR Form 1 instructions (2025): Part B rate 5.0%; personal exemptions Single $4,400 / MFJ $8,800 / HOH $6,800; Fair Share surtax +4% over $1,083,150 (TIR 24-13).",
  flatRate: 0.05,
  personalExemption: {
    single: 4400,
    married_joint: 8800,
    married_separate: 4400,
    head_of_household: 6800,
    qualifying_widow: 8800,
  },
  surtax: {
    rate: 0.04,
    threshold: 1083150,
  },
};

// ─── Massachusetts — Tax Year 2026 (PROVISIONAL) ────────────────────────────
// Source: MA DOR. Part B flat rate held at 5.0% (stable since 2020). Personal
// exemptions held at the 2025 statutory figures pending the 2026 release. Fair
// Share threshold projected to inflation-adjust upward (~$1,113,000); marked
// provisional. Verify against the final 2026 Form 1 instructions.
const MA_2026: MassachusettsRules = {
  taxYear: 2026,
  provisional: true,
  source:
    "MA DOR (provisional 2026): Part B rate 5.0% (stable since 2020); personal exemptions held at 2025 figures pending release; Fair Share threshold projected ~$1,113,000. Verify against final 2026 Form 1 instructions.",
  flatRate: 0.05,
  personalExemption: {
    single: 4400,
    married_joint: 8800,
    married_separate: 4400,
    head_of_household: 6800,
    qualifying_widow: 8800,
  },
  surtax: {
    rate: 0.04,
    threshold: 1113000,
  },
};

const FEDERAL_BY_YEAR: Readonly<Record<number, FederalRules>> = {
  2025: FEDERAL_2025,
  2026: FEDERAL_2026,
};

const MA_BY_YEAR: Readonly<Record<number, MassachusettsRules>> = {
  2025: MA_2025,
  2026: MA_2026,
};

/** The most recent FINAL (non-provisional) federal year we encode. */
export const LATEST_FINAL_FEDERAL_YEAR = 2025;

/** Years for which we have ANY federal rule table (final or provisional). */
export const SUPPORTED_TAX_YEARS: readonly number[] = [2025, 2026];

/**
 * Resolve the federal rule table for a tax year. Falls back to the nearest
 * encoded year and flags the substitution so the engine can disclose it.
 */
export function getFederalRules(taxYear: number): {
  rules: FederalRules;
  exactMatch: boolean;
} {
  const exact = FEDERAL_BY_YEAR[taxYear];
  if (exact) return { rules: exact, exactMatch: true };
  // Use the latest year we have as the substitute basis.
  const fallback = FEDERAL_BY_YEAR[LATEST_FINAL_FEDERAL_YEAR];
  return { rules: fallback, exactMatch: false };
}

/** Resolve the MA rule table for a tax year, with the same fallback policy. */
export function getMassachusettsRules(taxYear: number): {
  rules: MassachusettsRules;
  exactMatch: boolean;
} {
  const exact = MA_BY_YEAR[taxYear];
  if (exact) return { rules: exact, exactMatch: true };
  const fallback = MA_BY_YEAR[LATEST_FINAL_FEDERAL_YEAR];
  return { rules: fallback, exactMatch: false };
}
