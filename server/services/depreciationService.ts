/**
 * IRS Depreciation Schedule Calculator
 *
 * Generates MACRS depreciation schedules for income-producing real property:
 *   - Residential rental: 27.5 years (straight-line)
 *   - Commercial/non-residential: 39 years (straight-line)
 *   - Land improvements (fence, driveway): 15 years (150% DB)
 *   - Personal property / equipment: 5 or 7 years (200% DB)
 *
 * Land itself is NEVER depreciable. Basis must be allocated between land and improvement.
 *
 * References: IRS Publication 527, 946; Rev. Proc. 87-57 (MACRS tables)
 */

export type PropertyClass =
  | 'residential_rental'    // 27.5 yr straight-line
  | 'nonresidential'        // 39 yr straight-line
  | 'land_improvements'     // 15 yr 150% DB
  | 'personal_property_5yr' // 5 yr 200% DB
  | 'personal_property_7yr' // 7 yr 200% DB (general equipment)
  | 'raw_land';             // Not depreciable

export interface DepreciationInput {
  propertyClass: PropertyClass;
  /** Total property cost basis (land + improvement, before allocation) */
  totalBasis: number;
  /** Portion of basis allocated to non-depreciable land. Default: 0 */
  landBasis?: number;
  /** In-service date (when property was placed in service / closed) */
  inServiceDate: Date;
  /** Current tax year to calculate to (for running YTD) */
  currentTaxYear?: number;
}

export interface DepreciationYear {
  taxYear: number;
  depreciationAmount: number;
  accumulatedDepreciation: number;
  adjustedBasis: number;
  percentage: number;
}

export interface DepreciationSchedule {
  propertyClass: PropertyClass;
  totalBasis: number;
  landBasis: number;
  depreciableBasis: number;
  recoveryPeriodYears: number;
  method: string;
  convention: string;
  inServiceDate: Date;
  fullyDepreciatedYear: number;
  annualDeduction: number;
  schedule: DepreciationYear[];
  ytdDepreciation: number;
  remainingBasis: number;
}

// MACRS mid-month convention percentages for 27.5-year residential
// Month placed in service → first-year %
const MACRS_275_FIRST_YEAR: Record<number, number> = {
  1: 3.485, 2: 3.182, 3: 2.879, 4: 2.576, 5: 2.273, 6: 1.970,
  7: 1.667, 8: 1.364, 9: 1.061, 10: 0.758, 11: 0.455, 12: 0.152,
};

// MACRS mid-month convention percentages for 39-year non-residential
const MACRS_39_FIRST_YEAR: Record<number, number> = {
  1: 2.461, 2: 2.247, 3: 2.033, 4: 1.819, 5: 1.605, 6: 1.391,
  7: 1.177, 8: 0.963, 9: 0.749, 10: 0.535, 11: 0.321, 12: 0.107,
};

function getRecoveryPeriod(cls: PropertyClass): number {
  switch (cls) {
    case 'residential_rental': return 27.5;
    case 'nonresidential': return 39;
    case 'land_improvements': return 15;
    case 'personal_property_5yr': return 5;
    case 'personal_property_7yr': return 7;
    case 'raw_land': return 0;
  }
}

function getMethod(cls: PropertyClass): string {
  switch (cls) {
    case 'residential_rental': return 'Straight-Line (SL)';
    case 'nonresidential': return 'Straight-Line (SL)';
    case 'land_improvements': return '150% Declining Balance → SL';
    case 'personal_property_5yr':
    case 'personal_property_7yr': return '200% Declining Balance → SL';
    case 'raw_land': return 'Not Depreciable';
  }
}

/**
 * Build a full MACRS depreciation schedule for a given property.
 */
export function buildDepreciationSchedule(input: DepreciationInput): DepreciationSchedule {
  const {
    propertyClass,
    totalBasis,
    landBasis = 0,
    inServiceDate,
    currentTaxYear = new Date().getFullYear(),
  } = input;

  const depreciableBasis = totalBasis - landBasis;
  const recoveryPeriod = getRecoveryPeriod(propertyClass);

  if (propertyClass === 'raw_land' || recoveryPeriod === 0 || depreciableBasis <= 0) {
    return {
      propertyClass,
      totalBasis,
      landBasis,
      depreciableBasis: 0,
      recoveryPeriodYears: 0,
      method: 'Not Depreciable',
      convention: 'N/A',
      inServiceDate,
      fullyDepreciatedYear: 0,
      annualDeduction: 0,
      schedule: [],
      ytdDepreciation: 0,
      remainingBasis: totalBasis,
    };
  }

  const inServiceYear = inServiceDate.getFullYear();
  const inServiceMonth = inServiceDate.getMonth() + 1; // 1-12
  const schedule: DepreciationYear[] = [];

  let accumulated = 0;
  let remainingBasis = depreciableBasis;

  if (propertyClass === 'residential_rental' || propertyClass === 'nonresidential') {
    // Straight-line with mid-month convention
    const annualRate = 1 / recoveryPeriod;
    const firstYearTable = propertyClass === 'residential_rental'
      ? MACRS_275_FIRST_YEAR
      : MACRS_39_FIRST_YEAR;

    const firstYearPct = (firstYearTable[inServiceMonth] || 0) / 100;
    const lastYear = inServiceYear + Math.ceil(recoveryPeriod) + 1;

    for (let yr = inServiceYear; yr <= lastYear; yr++) {
      let deduction: number;
      if (yr === inServiceYear) {
        deduction = depreciableBasis * firstYearPct;
      } else if (yr === lastYear) {
        // Last year gets the remaining balance (mid-month on disposal)
        deduction = remainingBasis;
      } else {
        deduction = depreciableBasis * annualRate;
      }
      deduction = Math.min(deduction, remainingBasis);
      if (deduction <= 0) break;

      accumulated += deduction;
      remainingBasis = Math.max(0, depreciableBasis - accumulated);

      schedule.push({
        taxYear: yr,
        depreciationAmount: Math.round(deduction * 100) / 100,
        accumulatedDepreciation: Math.round(accumulated * 100) / 100,
        adjustedBasis: Math.round((landBasis + remainingBasis) * 100) / 100,
        percentage: Math.round(firstYearPct * 100 * (yr === inServiceYear ? 1 : annualRate / firstYearPct) * 100) / 100,
      });

      if (remainingBasis === 0) break;
    }
  } else {
    // Declining balance (MACRS 15, 5, 7 year) with half-year convention
    const dbRate = propertyClass === 'land_improvements' ? 1.5 / recoveryPeriod : 2.0 / recoveryPeriod;
    const slRate = 1 / recoveryPeriod;

    for (let i = 0; i < Math.ceil(recoveryPeriod) + 2; i++) {
      const yr = inServiceYear + i;
      // Half-year convention: 50% of deduction in year 1 and year N+1
      const halfYear = i === 0 ? 0.5 : 1.0;
      const dbDeduction = remainingBasis * dbRate * halfYear;
      const slDeduction = (remainingBasis / (recoveryPeriod - i + 0.5)) * halfYear;
      // Switch to straight-line when SL gives higher deduction
      const deduction = Math.min(remainingBasis, Math.max(dbDeduction, slDeduction));
      if (deduction <= 0) break;

      accumulated += deduction;
      remainingBasis = Math.max(0, depreciableBasis - accumulated);

      schedule.push({
        taxYear: yr,
        depreciationAmount: Math.round(deduction * 100) / 100,
        accumulatedDepreciation: Math.round(accumulated * 100) / 100,
        adjustedBasis: Math.round((landBasis + remainingBasis) * 100) / 100,
        percentage: Math.round((deduction / depreciableBasis) * 10000) / 100,
      });

      if (remainingBasis === 0) break;
    }
  }

  const ytdDepreciation = schedule
    .filter(s => s.taxYear <= currentTaxYear)
    .reduce((sum, s) => sum + s.depreciationAmount, 0);

  const currentEntry = schedule.find(s => s.taxYear === currentTaxYear);
  const annualDeduction = currentEntry?.depreciationAmount ?? schedule[1]?.depreciationAmount ?? 0;
  const fullyDepreciatedYear = schedule[schedule.length - 1]?.taxYear ?? inServiceYear + Math.ceil(recoveryPeriod);

  return {
    propertyClass,
    totalBasis,
    landBasis,
    depreciableBasis,
    recoveryPeriodYears: recoveryPeriod,
    method: getMethod(propertyClass),
    convention: propertyClass === 'residential_rental' || propertyClass === 'nonresidential'
      ? 'Mid-Month'
      : 'Half-Year',
    inServiceDate,
    fullyDepreciatedYear,
    annualDeduction: Math.round(annualDeduction * 100) / 100,
    schedule,
    ytdDepreciation: Math.round(ytdDepreciation * 100) / 100,
    remainingBasis: Math.round((landBasis + Math.max(0, depreciableBasis - ytdDepreciation)) * 100) / 100,
  };
}

/**
 * Format depreciation schedule as a plain-text table for reports/exports.
 */
export function formatDepreciationTable(schedule: DepreciationSchedule): string {
  if (schedule.schedule.length === 0) {
    return `${schedule.propertyClass}: Land is not depreciable.`;
  }

  const header = [
    `Depreciable Basis: $${schedule.depreciableBasis.toLocaleString()} (Land: $${schedule.landBasis.toLocaleString()})`,
    `Method: ${schedule.method} | Convention: ${schedule.convention} | Recovery: ${schedule.recoveryPeriodYears} years`,
    '',
    'Year  | Annual Deduction | Accumulated | Adjusted Basis',
    '------+------------------+-------------+---------------',
  ].join('\n');

  const rows = schedule.schedule.map(s =>
    `${s.taxYear}  | $${s.depreciationAmount.toLocaleString().padStart(14)} | $${s.accumulatedDepreciation.toLocaleString().padStart(9)} | $${s.adjustedBasis.toLocaleString()}`
  ).join('\n');

  return `${header}\n${rows}`;
}
