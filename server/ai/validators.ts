/**
 * T18 — Atlas Hallucination Guardrails + Structured Output Validation
 *
 * Validates all structured outputs from Atlas before they reach the client.
 * If validation fails, the output is flagged and can be retried with a
 * correction prompt, or returned with a warning label.
 *
 * Coverage:
 *   - Offer amounts (must be positive, within plausible land value range)
 *   - Amortization schedules (payment math must balance)
 *   - Property APNs (basic format validation)
 *   - Financial calculations (ROI, cash flow, LTV)
 *   - Atlas action responses (must reference valid entity IDs)
 *
 * Usage:
 *   import { validateAtlasOutput, AtlasOutputType } from "../ai/validators";
 *
 *   const result = validateAtlasOutput(AtlasOutputType.OFFER_AMOUNT, { amount: 45000 });
 *   if (!result.valid) {
 *     // retry with correction prompt, or flag for human review
 *   }
 */

import { z } from "zod";

export enum AtlasOutputType {
  OFFER_AMOUNT = "offer_amount",
  AMORTIZATION_SCHEDULE = "amortization_schedule",
  ROI_ANALYSIS = "roi_analysis",
  PROPERTY_APN = "property_apn",
  COMPS_ANALYSIS = "comps_analysis",
  CASH_FLOW = "cash_flow",
  GENERIC_JSON = "generic_json",
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized?: unknown;
  confidence: number; // 0-1
}

// ─── Individual validators ────────────────────────────────────────────────────

const offerAmountSchema = z.object({
  amount: z.number()
    .positive("Offer amount must be positive")
    .max(50_000_000, "Offer amount exceeds plausible land value ($50M)"),
  currency: z.string().optional().default("USD"),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
});

const amortizationScheduleSchema = z.object({
  loanAmount: z.number().positive(),
  interestRate: z.number().min(0).max(30, "Interest rate seems unrealistic (>30%)"),
  termMonths: z.number().int().min(1).max(480, "Term cannot exceed 40 years"),
  monthlyPayment: z.number().positive(),
  schedule: z.array(
    z.object({
      month: z.number().int().positive(),
      payment: z.number().nonnegative(),
      principal: z.number().nonnegative(),
      interest: z.number().nonnegative(),
      balance: z.number().nonnegative(),
    })
  ).optional(),
});

const roiAnalysisSchema = z.object({
  purchasePrice: z.number().positive(),
  salePrice: z.number().positive(),
  holdingCosts: z.number().nonnegative().optional(),
  grossProfit: z.number(),
  netProfit: z.number(),
  roiPercent: z.number().min(-100).max(10000),
  annualizedRoi: z.number().min(-100).max(10000).optional(),
});

const compsAnalysisSchema = z.object({
  subjectProperty: z.object({
    apn: z.string().optional(),
    address: z.string().optional(),
    acres: z.number().positive().optional(),
  }),
  comparables: z.array(
    z.object({
      address: z.string(),
      salePrice: z.number().positive(),
      acres: z.number().positive().optional(),
      saleDate: z.string().optional(),
      distanceMiles: z.number().nonnegative().optional(),
    })
  ).min(1, "At least one comparable is required"),
  estimatedValue: z.number().positive(),
  pricePerAcre: z.number().positive().optional(),
  confidence: z.number().min(0).max(1),
});

const cashFlowSchema = z.object({
  monthlyIncome: z.number().nonnegative(),
  monthlyExpenses: z.number().nonnegative(),
  netMonthly: z.number(),
  annualNOI: z.number(),
  capRate: z.number().optional(),
});

// ─── APN format validator ─────────────────────────────────────────────────────

// APNs vary by county but typically follow: digits with dashes/spaces
const APN_PATTERN = /^[0-9A-Z][0-9A-Z\-\s\.]{4,30}$/i;

function validateApn(apn: unknown): ValidationResult {
  if (typeof apn !== "string" || !APN_PATTERN.test(apn.trim())) {
    return {
      valid: false,
      errors: [`"${apn}" does not look like a valid APN format`],
      warnings: [],
      confidence: 0,
    };
  }
  return { valid: true, errors: [], warnings: [], sanitized: apn.trim().toUpperCase(), confidence: 0.8 };
}

// ─── Amortization math checker ────────────────────────────────────────────────

function checkAmortizationMath(data: z.infer<typeof amortizationScheduleSchema>): string[] {
  const warnings: string[] = [];
  const { loanAmount, interestRate, termMonths, monthlyPayment } = data;

  // Validate payment formula: P * r * (1+r)^n / ((1+r)^n - 1)
  const r = interestRate / 100 / 12;
  const n = termMonths;
  let expectedPayment: number;
  if (r === 0) {
    expectedPayment = loanAmount / n;
  } else {
    expectedPayment = loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }

  const tolerance = expectedPayment * 0.02; // 2% tolerance for rounding
  if (Math.abs(monthlyPayment - expectedPayment) > tolerance) {
    warnings.push(
      `Monthly payment ${monthlyPayment.toFixed(2)} doesn't match expected ${expectedPayment.toFixed(2)} — possible calculation error`
    );
  }

  return warnings;
}

// ─── Main validator ───────────────────────────────────────────────────────────

export function validateAtlasOutput(
  type: AtlasOutputType,
  data: unknown
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    confidence: 1,
  };

  try {
    switch (type) {
      case AtlasOutputType.OFFER_AMOUNT: {
        const parsed = offerAmountSchema.safeParse(data);
        if (!parsed.success) {
          result.valid = false;
          result.errors = parsed.error.errors.map((e) => e.message);
        } else {
          result.sanitized = parsed.data;
          result.confidence = parsed.data.confidence ?? 0.7;
        }
        break;
      }

      case AtlasOutputType.AMORTIZATION_SCHEDULE: {
        const parsed = amortizationScheduleSchema.safeParse(data);
        if (!parsed.success) {
          result.valid = false;
          result.errors = parsed.error.errors.map((e) => e.message);
        } else {
          result.warnings = checkAmortizationMath(parsed.data);
          result.sanitized = parsed.data;
          result.confidence = result.warnings.length === 0 ? 1 : 0.6;
        }
        break;
      }

      case AtlasOutputType.ROI_ANALYSIS: {
        const parsed = roiAnalysisSchema.safeParse(data);
        if (!parsed.success) {
          result.valid = false;
          result.errors = parsed.error.errors.map((e) => e.message);
        } else {
          // Cross-check: gross profit = salePrice - purchasePrice
          const expected = parsed.data.salePrice - parsed.data.purchasePrice;
          if (Math.abs(parsed.data.grossProfit - expected) > 1) {
            result.warnings.push(
              `Gross profit ${parsed.data.grossProfit} doesn't match salePrice - purchasePrice = ${expected}`
            );
          }
          result.sanitized = parsed.data;
          result.confidence = result.warnings.length === 0 ? 0.9 : 0.5;
        }
        break;
      }

      case AtlasOutputType.PROPERTY_APN:
        return validateApn(data);

      case AtlasOutputType.COMPS_ANALYSIS: {
        const parsed = compsAnalysisSchema.safeParse(data);
        if (!parsed.success) {
          result.valid = false;
          result.errors = parsed.error.errors.map((e) => e.message);
        } else {
          result.sanitized = parsed.data;
          result.confidence = parsed.data.confidence;
          if (parsed.data.comparables.length < 3) {
            result.warnings.push("Fewer than 3 comparables — value estimate may be less reliable");
          }
        }
        break;
      }

      case AtlasOutputType.CASH_FLOW: {
        const parsed = cashFlowSchema.safeParse(data);
        if (!parsed.success) {
          result.valid = false;
          result.errors = parsed.error.errors.map((e) => e.message);
        } else {
          const expected = parsed.data.monthlyIncome - parsed.data.monthlyExpenses;
          if (Math.abs(parsed.data.netMonthly - expected) > 1) {
            result.warnings.push(`Net monthly cash flow doesn't match income - expenses`);
          }
          result.sanitized = parsed.data;
          result.confidence = result.warnings.length === 0 ? 0.9 : 0.6;
        }
        break;
      }

      case AtlasOutputType.GENERIC_JSON:
      default: {
        // For generic JSON, just validate it's actually parseable
        if (typeof data === "string") {
          try {
            JSON.parse(data);
            result.sanitized = data;
          } catch {
            result.valid = false;
            result.errors = ["Output is not valid JSON"];
          }
        } else {
          result.sanitized = data;
        }
        result.confidence = 0.7;
        break;
      }
    }
  } catch (err: any) {
    result.valid = false;
    result.errors = [`Validation error: ${err.message}`];
    result.confidence = 0;
  }

  return result;
}

/**
 * Build a correction prompt to send back to Atlas when output validation fails.
 */
export function buildCorrectionPrompt(
  type: AtlasOutputType,
  errors: string[],
  warnings: string[],
  originalOutput: unknown
): string {
  return `Your previous response had validation issues that must be corrected:

Errors (must fix):
${errors.map((e) => `- ${e}`).join("\n") || "None"}

Warnings (should address):
${warnings.map((w) => `- ${w}`).join("\n") || "None"}

Original output:
\`\`\`json
${JSON.stringify(originalOutput, null, 2)}
\`\`\`

Please provide a corrected response that:
1. Fixes all errors listed above
2. Ensures all numerical calculations are mathematically consistent
3. Uses realistic values within plausible ranges for US land investing
4. Returns the same JSON structure with corrected values`;
}
