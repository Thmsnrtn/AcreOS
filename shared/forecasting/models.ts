/**
 * Every forecasting model and every feature it reads — the population the
 * fair-housing gate checks (tests/unit/forecastingFairHousing.test.ts).
 *
 * A model that is not listed here is a model the gate never reads, so the
 * gate also enumerates every source file under the forecasting directories
 * and fails on a file this registry does not claim. Adding a model therefore
 * means declaring its features here first.
 *
 * Browser-safe.
 */
import { CYCLE_PHASE_ENGINE_ID } from "./cyclePhase";
import { LAND_VALUE_ENGINE_ID } from "./landValue";
import { SEASONALITY_ENGINE_ID } from "./seasonality";
import { DOWNTURN_RUNWAY_ENGINE_ID } from "./downturnRunway";

export interface ModelFeature {
  id: string;
  description: string;
  /** Where the value comes from: a PUBLIC_SERIES family id, an OUTCOME_FIELDS key, or an internal ledger. */
  from: string;
}

export interface ForecastModelSpec {
  id: string;
  label: string;
  /** The finest geography the model works at. County is the floor (see fairHousing.ts). */
  geography: "nation" | "state" | "county" | "company";
  features: readonly ModelFeature[];
}

/**
 * What the customer-outcome recorder may store, and nothing else. Prices,
 * timings, results and channels — no person: no names, contact details,
 * mailing addresses, or anything describing who the seller or buyer is.
 */
export const OUTCOME_FIELDS = {
  priceCents: "price of the closed deal or the offer, in cents",
  acres: "parcel size in acres",
  daysHeld: "days from purchase to sale",
  daysOnMarket: "days from listing to sale (only when a listing was published)",
  result: "accepted or declined (offers); sold or bought (closed deals)",
  channel: "the outreach channel a response came back on (sms, mail, email, call, web)",
} as const;
export type OutcomeField = keyof typeof OUTCOME_FIELDS;
const OUTCOME_FIELD_KEYS = Object.keys(OUTCOME_FIELDS) as OutcomeField[];

export const OUTCOME_KINDS = ["deal_closed", "offer_accepted", "offer_declined", "outreach_response"] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export const FORECAST_MODELS: readonly ForecastModelSpec[] = [
  {
    id: CYCLE_PHASE_ENGINE_ID,
    label: "State job-market cycle phase",
    geography: "state",
    features: [
      { id: "payrollGrowth6m", description: "six-month annualised change in total nonfarm payroll employment", from: "state_payrolls" },
      { id: "payrollMomentum3m", description: "change in that growth over three months", from: "state_payrolls" },
    ],
  },
  {
    id: LAND_VALUE_ENGINE_ID,
    label: "State farm real estate value growth",
    geography: "state",
    features: [
      { id: "agLandValueGrowth1y", description: "one-year log change in average agricultural land value per acre", from: "state_ag_land_value" },
    ],
  },
  {
    id: SEASONALITY_ENGINE_ID,
    label: "Seasonal prior (building permits)",
    geography: "state",
    features: [
      { id: "permitsSeasonalRatio", description: "monthly permits over the centred twelve-month average", from: "state_permits_nsa" },
    ],
  },
  {
    id: DOWNTURN_RUNWAY_ENGINE_ID,
    label: "AcreOS downturn runway",
    geography: "company",
    features: [
      { id: "cashUsd", description: "AcreOS planning cash basis", from: "finance ledger" },
      { id: "monthlyCostsUsd", description: "AcreOS monthly costs", from: "finance ledger" },
      { id: "mrrUsd", description: "AcreOS monthly recurring revenue", from: "finance ledger" },
      { id: "mrrMonthlyChange", description: "recorded MRR trend", from: "mrr snapshots" },
      { id: "contractionMonths", description: "typical length of a state payroll contraction", from: "state_payrolls" },
    ],
  },
  {
    id: "county_outcome_slot",
    label: "County forecast from customer outcomes (warming up)",
    geography: "county",
    features: OUTCOME_FIELD_KEYS.map((k) => ({ id: k, description: OUTCOME_FIELDS[k], from: `outcome:${k}` })),
  },
  {
    id: "mail_saturation_slot",
    label: "Mail saturation by county (aggregate across customers)",
    geography: "county",
    features: [{ id: "mailPieces90d", description: "mail pieces sent to the county in 90 days, all customers, floored", from: "campaign delivery events" }],
  },
];
