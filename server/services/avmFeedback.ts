/**
 * T43 — AVM Training Data Feedback Loop
 *
 * Every time a deal closes, records:
 *   - What AcreOS AVM predicted vs actual acquisition price
 *   - Prediction accuracy score
 *   - Market and property attributes at time of prediction
 *
 * Aggregates monthly accuracy stats for the founder dashboard.
 * This is how the AVM gets better over time.
 *
 * Call recordAvmOutcome() from the deal-close handler in routes-deals.ts.
 */

import { addMonths } from "../utils/dateUtils";

// TODO(tsc): This service targets an AVM *outcomes/feedback* table with columns
// organizationId, dealId, apn, actualValue, actualSalePrice, absoluteError,
// percentageError, overestimated, acreage, state, county, propertyType,
// recordedAt. The frozen `valuation_predictions` schema is a prediction *cache*
// (predictedValue, confidenceScore, valueRange, modelVersion, featuresUsed,
// comparableCount, validUntil) and has none of those columns. A dedicated
// `avm_outcomes` table is required before these functions can run; they are not
// wired to any live caller today. Until the migration lands, the bodies are
// stubbed so the module typechecks without referencing nonexistent columns.

export interface AvmOutcomeInput {
  orgId: number;
  dealId: number;
  propertyId?: number;
  apn?: string;
  predictedValue: number; // what AVM said before the deal
  actualAcquisitionPrice: number; // what the investor paid
  actualSalePrice?: number; // if already sold/listed
  acreage?: number;
  state?: string;
  county?: string;
  propertyType?: string;
  modelVersion?: string;
}

export interface AvmAccuracyReport {
  period: string;
  totalPredictions: number;
  avgAbsoluteError: number; // avg |predicted - actual| in dollars
  avgPercentageError: number; // avg |(predicted - actual) / actual|
  withinTenPct: number; // % of predictions within 10%
  withinTwentyPct: number;
  overestimateRate: number; // % where predicted > actual
  underestimateRate: number;
  byState: { state: string; avgPctError: number; count: number }[];
}

// ─── Record outcome when a deal closes ───────────────────────────────────────

export async function recordAvmOutcome(_input: AvmOutcomeInput): Promise<void> {
  // TODO(tsc): blocked on the `avm_outcomes` table migration (see file header).
  throw new Error(
    "recordAvmOutcome is not available: avm_outcomes table not yet migrated",
  );
}

// ─── Monthly accuracy report ──────────────────────────────────────────────────

export async function getAvmAccuracyReport(
  _orgId: number | null, // null = platform-wide (founder view)
  _months = 6
): Promise<AvmAccuracyReport[]> {
  // TODO(tsc): blocked on the `avm_outcomes` table migration (see file header).
  // Keep the date helper referenced so the import stays meaningful.
  void addMonths;
  return [];
}

// ─── Per-state breakdown ──────────────────────────────────────────────────────

export async function getAvmAccuracyByState(
  _orgId: number | null,
  _fromDate?: Date
): Promise<{ state: string; avgPctError: number; count: number }[]> {
  // TODO(tsc): blocked on the `avm_outcomes` table migration (see file header).
  return [];
}
