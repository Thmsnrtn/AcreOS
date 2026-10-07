/**
 * Every number the market twin draws from, each with its SOURCE.
 *
 * Three kinds of source, and nothing else:
 *   - "market":     a parameter the existing market simulation already states
 *                   (tests/simulation/campaign/market/parameters.ts) — read
 *                   from there, never copied, so the two cannot drift;
 *   - "public":     a public, citable rule or rate (the reference names the
 *                   publisher and the document);
 *   - "assumption": everything else, labelled as such with the reasoning, so
 *                   a reader knows exactly which outputs rest on a guess.
 *
 * `twin.test.ts` fails if a parameter has no source, if an "assumption" has no
 * reasoning, or if a "market" parameter is not the value market/ exports.
 */
import { REPLY_RATE, REPLY_MIX, MAIL_CALLBACK_RATE, ARRIVAL_3, ARRIVAL_10, ARRIVAL_25 } from "../campaign/market/parameters";

export type SourceKind = "market" | "public" | "assumption";
export interface Param<T = number> {
  value: T;
  unit: string;
  source: { kind: SourceKind; ref: string; note?: string };
}
const market = <T,>(value: T, unit: string, ref: string): Param<T> => ({ value, unit, source: { kind: "market", ref } });
// Public references are cited from the author's knowledge and were NOT re-fetched
// during this run (no network calls to publishers); the scorecard says so.
const pub = <T,>(value: T, unit: string, ref: string, note?: string): Param<T> => ({ value, unit, source: { kind: "public", ref, note: note ? `${note} (reference recalled, not re-fetched)` : "reference recalled, not re-fetched" } });
const assume = <T,>(value: T, unit: string, note: string): Param<T> => ({ value, unit, source: { kind: "assumption", ref: "assumption", note } });

const replyShare = (k: string) => REPLY_MIX.find((r) => r[0] === k)![1];

export const PARAMS = {
  // ── seller response (market/) ──────────────────────────────────────────
  smsReplyRate: market(REPLY_RATE, "replies per delivered SMS", "tests/simulation/campaign/market/parameters.ts REPLY_RATE"),
  smsReplyShareStop: market(replyShare("stop"), "share of replies", "market/parameters.ts REPLY_MIX stop"),
  smsReplyShareNaturalOptOut: market(replyShare("natural-optout"), "share of replies", "market/parameters.ts REPLY_MIX natural-optout"),
  smsReplyShareWrongNumber: market(replyShare("wrong-number"), "share of replies", "market/parameters.ts REPLY_MIX wrong-number"),
  smsReplyShareInterested: market(replyShare("interested"), "share of replies", "market/parameters.ts REPLY_MIX interested"),
  smsReplyShareAngry: market(replyShare("angry"), "share of replies", "market/parameters.ts REPLY_MIX angry"),
  mailCallbackRate: market(MAIL_CALLBACK_RATE, "callbacks per delivered postcard", "market/parameters.ts MAIL_CALLBACK_RATE"),
  arrivalCurves: market({ 3: ARRIVAL_3, 10: ARRIVAL_10, 25: ARRIVAL_25 }, "arrival day per customer", "market/parameters.ts ARRIVAL_*"),

  // ── public rules and rates ─────────────────────────────────────────────
  directMailProspectResponseCeiling: pub(0.049, "responses per piece", "ANA/DMA Response Rate Report 2018 (prospect list, letter-size)", "an all-industry CEILING; the twin's land-postcard callback rate (market) sits well under it"),
  uspsUndeliverableAsAddressed: pub(0.043, "share of mail pieces", "USPS Office of Inspector General, undeliverable-as-addressed mail audit (2015)", "the twin applies it to owner mailing addresses before list hygiene"),
  sesBounceReviewThreshold: pub(0.05, "bounce rate", "Amazon SES developer guide — sending review at a 5% bounce rate (pause risk at 10%)"),
  sesComplaintReviewThreshold: pub(0.001, "complaint rate", "Amazon SES developer guide — review at 0.1% complaint rate (pause risk at 0.5%)"),
  bulkSenderSpamRateCeiling: pub(0.003, "spam-report rate", "Gmail and Yahoo bulk-sender requirements (Feb 2024): stay under 0.3%, one-click unsubscribe (RFC 8058)"),
  a2pUnregisteredBlockedShare: pub(1.0, "share of unregistered 10DLC SMS blocked", "Twilio A2P 10DLC: unregistered US 10DLC traffic blocked since 2023-08-31"),
  twilioErrorCodes: pub({ unsubscribed: 21610, filtered: 30007, unreachable: 30003, unknownDestination: 30005, landline: 30006, unregistered10dlc: 30034 }, "error code", "Twilio error and warning dictionary"),
  tcpaStatutoryDamagesUsd: pub(500, "USD per violation (1,500 if willful)", "47 U.S.C. § 227(b)(3)"),
  revocationAnyReasonableMeans: pub(true, "rule", "FCC 24-24 (Feb 2024) consent-revocation order: revocation by any reasonable means, effective 2025-04-11"),

  // ── assumptions (labelled) ─────────────────────────────────────────────
  ownerHasPhone: assume(0.55, "share of owners with a skip-traced phone", "between the market cohort's per-list 0.5 and 0.7 phone fill"),
  phoneIsLandline: assume(0.18, "share of traced phones that are landlines", "no public figure for absentee land owners; landlines answer SMS with 30006"),
  phoneWrongPerson: assume(0.12, "share of traced phones reaching someone else", "skip-trace hit quality varies by vendor; the market reply mix's 15% wrong-number replies bounds it from above"),
  ownerHasEmail: assume(0.3, "share of owners with an email", "matches the market cohort list builder's 0.3"),
  emailHardBounce: assume(0.04, "hard bounces per send to a traced email", "purchased-list email; deliberately near SES's 5% review line so the gate is exercised"),
  emailComplaint: assume(0.0015, "complaints per delivered cold email", "cold outreach runs above the 0.1% SES review line"),
  carrierFilterRate: assume(0.03, "share of registered A2P SMS filtered (30007)", "carrier filtering of registered traffic is opaque; 3% is a working guess"),
  lobAddressInvalid: assume(0.02, "share of mailing addresses Lob rejects", "after the UAA rate, most remaining failures are formatting"),
  smsReplyLatencyHoursMedian: assume(3, "hours, median", "most SMS replies arrive the same day"),
  emailReplyRate: assume(0.01, "replies per delivered cold email", "cold email to purchased lists"),
  stripeCardDeclineMonthly: assume(0.04, "share of monthly renewals declined", "involuntary churn source for dunning"),
  dunningRecoveryRate: assume(0.5, "share of declined renewals recovered by retries/emails", "typical of retry + reminder programs"),
  metaAdRejectRate: assume(0.05, "share of ad creatives rejected at review", "founder-only rail; exercised for the founder ads flow"),
  personaMix: assume({ land_flipper: 0.6, note_investor: 0.2, va_team: 0.2 }, "share of new customers", "the market cohort's 25 is 64% land, 16% note, 8% team; teams rounded up to exercise VA paths"),
  baseMonthlyChurn: assume({ land_flipper: 0.06, note_investor: 0.035, va_team: 0.04 }, "monthly hazard before friction", "SMB SaaS-like; note investors are stickier (servicing data lives in the product)"),
  churnPerUnresolvedTicket: assume(0.25, "relative hazard increase per unresolved ticket that month", "frustration compounds"),
  churnPerValueEvent: assume(-0.15, "relative hazard change per interested reply or deal that month (floored)", "customers who see results stay"),
  ticketPerFriction: assume({ refusal_no_next_step: 0.35, refusal_with_next_step: 0.05, error_5xx: 0.5, silent_noop: 0.4, compliance_event: 0.8, manual_request: 0.9 }, "chance a friction event becomes a support ticket", "a refusal that names its fix rarely becomes a ticket"),
  activationMilestones: assume({ import: 0.92, firstSend: 0.75, firstReply: 0.6, firstDeal: 0.18 }, "chance a new customer reaches each milestone in 30 days", "drives the activation metric; firstReply also depends on the response model"),
  refundRequestPerCustomerWeek: assume(0.03, "chance per active customer-week of asking to refund a purchase", "roughly one refund request per customer per 8 months"),
  aiQuestionsPerActiveCustomerWeek: assume(3, "Pax questions per active customer-week", "light usage"),
} as const;

export type ParamKey = keyof typeof PARAMS;
export function paramValue<K extends ParamKey>(k: K): (typeof PARAMS)[K]["value"] {
  return PARAMS[k].value;
}
export function assumptions(): Array<{ key: string; note: string }> {
  return Object.entries(PARAMS)
    .filter(([, p]) => p.source.kind === "assumption")
    .map(([key, p]) => ({ key, note: p.source.note ?? "" }));
}
