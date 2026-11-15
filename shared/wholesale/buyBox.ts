/**
 * The wholesaler's buy box and candidate triage (wholesale package, Leg 2).
 * Pure and browser-safe: the server reads the rows, this decides.
 *
 * CANDIDATES ARE THE OPERATOR'S OWN. Triage reads only properties the org
 * already holds as prospects. There is no sourcing data, no skip-trace and no
 * list building here; bring-your-own stays the rule.
 *
 * FIT, WITH NAMED REASONS. Each criterion the operator set is checked against
 * a fact on the candidate:
 *   - it PASSES;
 *   - it FAILS with a sentence naming what and why;
 *   - or it is UNKNOWN, because the fact it needs is not recorded.
 * An unknown is never counted as a pass or a fail. The score is passes over
 * the criteria that could be evaluated, so a candidate with nothing recorded
 * scores nothing, not 100%.
 *
 * STALE CANDIDATES RETIRE WITH A REASON. A candidate with no activity
 * (property edit, deal edit, or recorded decision) for longer than the buy
 * box's window is RETIRED in the triage output, with the date and the window
 * named. Retiring is a verdict in the triage, not a write: the operator's
 * property record is not changed.
 */
import { z } from "zod";

const usState = z.string().regex(/^[A-Z]{2}$/, "Use 2-letter state codes");

export const buyBoxCriteriaSchema = z
  .object({
    /** Where the operator wholesales. Required: a buy box with no geography fits everything. */
    states: z.array(usState).min(1).max(51),
    /** Optional narrowing within those states. */
    counties: z
      .array(z.object({ state: usState, county: z.string().trim().min(1).max(80) }))
      .max(200)
      .optional(),
    zips: z.array(z.string().regex(/^\d{5}$/)).max(500).optional(),
    /** The most the operator will put a house under contract for. */
    maxPurchasePriceCents: z.number().int().positive().optional(),
    /** The smallest assignment fee worth the operator's time. */
    minAssignmentFeeCents: z.number().int().nonnegative().optional(),
    /** Days without activity after which a candidate retires. */
    staleAfterDays: z.number().int().min(1).max(365),
  });
// Unknown keys are DROPPED (zod's default), never stored: the criteria saved
// are exactly the fields above, so nothing else can ride in on a buy box.

export type BuyBoxCriteria = z.infer<typeof buyBoxCriteriaSchema>;

/** The statuses that make a property a CANDIDATE (not yet under contract). */
export const CANDIDATE_STATUSES = ["prospect", "due_diligence", "offer_sent"] as const;

export interface CandidateFacts {
  propertyId: number;
  label: string;
  state: string | null;
  county: string | null;
  zip: string | null;
  /** Integer cents: the latest acquisition deal's offer (or accepted) price, null when none is recorded. */
  priceCents: number | null;
  /** Integer cents: the target fee in the property's latest wholesale decision, null when not underwritten. */
  underwrittenFeeCents: number | null;
  /** The latest of property edit, deal edit and decision — what "activity" means. */
  lastActivityAt: Date | null;
}

/** `undetermined`: nothing the buy box asks about is recorded on this candidate. */
export type TriageVerdict = "fits" | "fails" | "undetermined" | "retired";

export interface TriageRow {
  propertyId: number;
  label: string;
  verdict: TriageVerdict;
  /** Passes over evaluated criteria; null when nothing could be evaluated. */
  score: number | null;
  passed: string[];
  failures: string[];
  unknowns: string[];
  /** Present on a retired candidate: the sentence that retired it. */
  retiredBecause?: string;
}

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const DAY_MS = 86_400_000;
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+county$/, "");

function triageCandidate(box: BuyBoxCriteria, c: CandidateFacts, now: Date): TriageRow {
  const passed: string[] = [];
  const failures: string[] = [];
  const unknowns: string[] = [];

  // Retirement first: a stale candidate is retired whatever it would score.
  if (c.lastActivityAt === null || now.getTime() - c.lastActivityAt.getTime() > box.staleAfterDays * DAY_MS) {
    const why =
      c.lastActivityAt === null
        ? `No recorded activity, past your ${box.staleAfterDays}-day window.`
        : `No activity since ${c.lastActivityAt.toISOString().slice(0, 10)} — past your ${box.staleAfterDays}-day window.`;
    return { propertyId: c.propertyId, label: c.label, verdict: "retired", score: null, passed, failures, unknowns, retiredBecause: why };
  }

  const state = (c.state ?? "").toUpperCase();
  if (!state) unknowns.push("State is not recorded.");
  else if (box.states.includes(state)) passed.push(`In ${state}.`);
  else failures.push(`In ${state}, outside your states (${box.states.join(", ")}).`);

  if (box.counties && box.counties.length > 0) {
    if (!c.county || !state) unknowns.push("County is not recorded.");
    else if (box.counties.some((k) => k.state === state && norm(k.county) === norm(c.county))) passed.push(`In ${c.county} County.`);
    else failures.push(`${c.county} County, ${state} is not one of your counties.`);
  }

  if (box.zips && box.zips.length > 0) {
    const zip5 = (c.zip ?? "").slice(0, 5);
    if (!/^\d{5}$/.test(zip5)) unknowns.push("ZIP is not recorded.");
    else if (box.zips.includes(zip5)) passed.push(`In ZIP ${zip5}.`);
    else failures.push(`ZIP ${zip5} is not one of your ZIPs.`);
  }

  if (box.maxPurchasePriceCents !== undefined) {
    if (c.priceCents === null) unknowns.push("No offer or contract price is recorded on a deal.");
    else if (c.priceCents <= box.maxPurchasePriceCents) passed.push(`Price ${usd(c.priceCents)} is within your ${usd(box.maxPurchasePriceCents)} max.`);
    else failures.push(`Price ${usd(c.priceCents)} is over your ${usd(box.maxPurchasePriceCents)} max.`);
  }

  if (box.minAssignmentFeeCents !== undefined) {
    if (c.underwrittenFeeCents === null) unknowns.push("Not underwritten yet, so there is no fee to check.");
    else if (c.underwrittenFeeCents >= box.minAssignmentFeeCents) passed.push(`Underwritten fee ${usd(c.underwrittenFeeCents)} meets your ${usd(box.minAssignmentFeeCents)} minimum.`);
    else failures.push(`Underwritten fee ${usd(c.underwrittenFeeCents)} is under your ${usd(box.minAssignmentFeeCents)} minimum.`);
  }

  const evaluated = passed.length + failures.length;
  return {
    propertyId: c.propertyId,
    label: c.label,
    verdict: failures.length > 0 ? "fails" : evaluated === 0 ? "undetermined" : "fits",
    score: evaluated === 0 ? null : passed.length / evaluated,
    passed,
    failures,
    unknowns,
  };
}

/** Fits first (best score first), then fails, undetermined, retired — stable within each. */
export function triageCandidates(box: BuyBoxCriteria, candidates: CandidateFacts[], now: Date): TriageRow[] {
  const order: Record<TriageVerdict, number> = { fits: 0, fails: 1, undetermined: 2, retired: 3 };
  return candidates
    .map((c) => triageCandidate(box, c, now))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => order[a.r.verdict] - order[b.r.verdict] || (b.r.score ?? -1) - (a.r.score ?? -1) || a.i - b.i)
    .map(({ r }) => r);
}
