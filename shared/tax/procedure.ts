/**
 * State/county tax-sale procedure objects — V-Tax-1 T2a. Pure.
 *
 * A procedure object is what an organization has RECORDED about one county's
 * tax-sale procedure, field by field, each with its source. AcreOS never
 * authors a field and never declares one current law: it shows where each
 * came from, how old the source is, whether it is state law or county
 * practice, and how it was verified.
 *
 *   - A source older than 12 months is STALE and the card carries a
 *     stale-law banner.
 *   - County practice is flagged as such: county practice is not state
 *     permission.
 *   - A county is BIDDABLE in AcreOS only while its current version has every
 *     required field, no stale field, and a completed county-verification
 *     task under 12 months old. Otherwise bidding is LOCKED for that county,
 *     not merely warned (V-Tax-1 T2 [AUDIT]).
 *   - Books older than ~5 years are frameworks, not law; the procedure object
 *     verified against statute and the county is the authority.
 */

export const PROCEDURE_FIELD_KEYS = [
  "instrument",
  "bidMethod",
  "returnModel",
  "redemptionPeriodMonths",
  "noticeRequirements",
  "foreclosurePath",
  "subsequentTaxRules",
] as const;
export type ProcedureFieldKey = (typeof PROCEDURE_FIELD_KEYS)[number];

/** Fields a county must have recorded before it can be bid on in AcreOS. */
const REQUIRED_PROCEDURE_FIELDS: readonly ProcedureFieldKey[] = ["instrument", "bidMethod", "returnModel", "redemptionPeriodMonths"];

export const PROCEDURE_FIELD_LABEL: Record<ProcedureFieldKey, string> = {
  instrument: "Instrument",
  bidMethod: "Bid method",
  returnModel: "Interest or penalty",
  redemptionPeriodMonths: "Redemption period",
  noticeRequirements: "Notice requirements",
  foreclosurePath: "Foreclosure / quiet-title path",
  subsequentTaxRules: "Subsequent-tax rules",
};

export type Instrument = "lien" | "deed" | "hybrid" | "redeemable_deed";

/**
 * How the holder is paid on redemption. A FLAT penalty is a one-time
 * percentage, never an annual rate: a 25% penalty redeemed in one month is
 * not a 25% annual return (V-Tax-1 T2 annualised-return honesty).
 */
export type ReturnModel =
  | { kind: "annual_rate"; rateBps: number }
  | { kind: "flat_penalty"; penaltyBps: number }
  | { kind: "tiered_penalty"; schedule: string }
  | { kind: "none" };

export interface ProcedureFieldValues {
  instrument: Instrument;
  bidMethod: string;
  returnModel: ReturnModel;
  redemptionPeriodMonths: number;
  noticeRequirements: string;
  foreclosurePath: string;
  subsequentTaxRules: string;
}

export interface ProcedureField<K extends ProcedureFieldKey> {
  value: ProcedureFieldValues[K];
  /** The citation: statute section, county procedure document, notice. */
  source: string;
  /** The date the source states it as of (YYYY-MM-DD). */
  asOf: string;
  /** State law, or the county's practice (which is not state permission). */
  basis: "state_law" | "county_practice";
  verification: "unverified" | "checked_against_statute" | "confirmed_with_county";
}

export type ProcedureFields = { [K in ProcedureFieldKey]?: ProcedureField<K> };

export interface CountyVerification {
  /** YYYY-MM-DD the county-verification task was completed. */
  completedOn: string;
  completedBy: string;
  /** How it was verified, in words (e.g. "called the county tax office"). */
  method: string;
}

export interface ProcedureVersion {
  state: string;
  county: string;
  version: number;
  fields: ProcedureFields;
  countyVerification: CountyVerification | null;
}

const STALE_AFTER_MONTHS = 12;

/** True when `isoDate` is more than 12 months before `today` (both YYYY-MM-DD). */
export function isStale(isoDate: string, today: string): boolean {
  const [y, m, d] = isoDate.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1 + STALE_AFTER_MONTHS, d));
  return limit.toISOString().slice(0, 10) < today;
}

export type BidLockReason =
  | { code: "no_procedure"; message: string }
  | { code: "missing_field"; field: ProcedureFieldKey; message: string }
  | { code: "stale_field"; field: ProcedureFieldKey; message: string }
  | { code: "not_verified"; message: string }
  | { code: "verification_stale"; message: string };

export interface ProcedureStanding {
  biddable: boolean;
  /** Why bidding is locked; empty when biddable. */
  lockReasons: BidLockReason[];
  /** A source older than 12 months → stale-law banner. */
  staleLawBanner: boolean;
  staleFields: ProcedureFieldKey[];
  /** Fields recorded as county practice (not state permission). */
  countyPracticeFields: ProcedureFieldKey[];
}

export function procedureStanding(current: ProcedureVersion | null, today: string): ProcedureStanding {
  if (!current) {
    return {
      biddable: false,
      lockReasons: [{ code: "no_procedure", message: "No procedure has been recorded for this county. Record it, with sources, and complete the county-verification task." }],
      staleLawBanner: false,
      staleFields: [],
      countyPracticeFields: [],
    };
  }
  const reasons: BidLockReason[] = [];
  const staleFields: ProcedureFieldKey[] = [];
  const countyPracticeFields: ProcedureFieldKey[] = [];
  for (const k of PROCEDURE_FIELD_KEYS) {
    const f = current.fields[k] as ProcedureField<typeof k> | undefined;
    if (!f) {
      if (REQUIRED_PROCEDURE_FIELDS.includes(k)) reasons.push({ code: "missing_field", field: k, message: `${PROCEDURE_FIELD_LABEL[k]} is not recorded.` });
      continue;
    }
    if (f.basis === "county_practice") countyPracticeFields.push(k);
    if (isStale(f.asOf, today)) {
      staleFields.push(k);
      reasons.push({ code: "stale_field", field: k, message: `${PROCEDURE_FIELD_LABEL[k]}: the source is as of ${f.asOf}, more than ${STALE_AFTER_MONTHS} months ago. Re-verify it.` });
    }
  }
  const v = current.countyVerification;
  if (!v) reasons.push({ code: "not_verified", message: "The county-verification task has not been completed for this version." });
  else if (isStale(v.completedOn, today)) reasons.push({ code: "verification_stale", message: `The county was last verified on ${v.completedOn}, more than ${STALE_AFTER_MONTHS} months ago.` });
  return { biddable: reasons.length === 0, lockReasons: reasons, staleLawBanner: staleFields.length > 0, staleFields, countyPracticeFields };
}

/**
 * The redemption return, stated honestly. A flat penalty is shown as a flat
 * penalty with the months held — never annualised as if it were a rate.
 */
export function describeReturn(model: ReturnModel): string {
  switch (model.kind) {
    case "annual_rate": return `${(model.rateBps / 100).toFixed(2)}% per year`;
    case "flat_penalty": return `${(model.penaltyBps / 100).toFixed(2)}% flat penalty — one-time, not an annual rate`;
    case "tiered_penalty": return `tiered penalty: ${model.schedule}`;
    case "none": return "no interest or penalty";
  }
}
