/**
 * Pipeline status vocabulary + transition tables (roadmap W3.4, 2026-07).
 *
 * Funnel metrics, dashboards, and the autopilot's conversion sense all key
 * off `leads.status` and `deals.status` — which were free `text` columns
 * with values scattered as string literals. The audit found live drift:
 * filters on deal status "won" and lead status "active" that matched
 * NOTHING (those values are never written), silently zeroing metrics.
 *
 * House pattern (see shared/schema/ai-telemetry.ts): `as const` list + Zod
 * enum + validation at the write seams — NOT a Postgres enum. This repo's
 * migrations are hand-maintained idempotent SQL (scripts/migrate.mjs);
 * `CREATE TYPE`/`ALTER TYPE` fights that model for zero extra safety over
 * seam validation.
 *
 * Adding a value: add it here, and every write seam accepts it — no DDL.
 */

import { z } from "zod";

// ── Leads ───────────────────────────────────────────────────────────────────

/**
 * All valid lead statuses across both lead types.
 *  Seller journey: new → mailed → responded/contacted → negotiating →
 *                  accepted → closed (or dead at any point)
 *  Buyer journey:  new → interested → qualified → under_contract → closed
 * `contacted` was written by executionEngine + taxDelinquentPipeline but
 * missing from the schema comment's list — it's real, so it's canonical now.
 */
export const LEAD_STATUSES = [
  "new",
  "mailed",
  "contacted",
  "responded",
  "negotiating",
  "accepted",
  "interested",
  "qualified",
  "under_contract",
  "closed",
  "dead",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const leadStatusSchema = z.enum(LEAD_STATUSES);

/**
 * Allowed lead transitions. Deliberately permissive within the funnel
 * (sellers respond out of order; a dead lead can resurrect on a callback)
 * but structurally forward-only where it matters: closed is terminal
 * except for correction back to negotiating, and nothing skips from
 * new straight to closed without passing a human-visible middle state.
 */
export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["mailed", "contacted", "responded", "interested", "negotiating", "qualified", "dead"],
  mailed: ["contacted", "responded", "negotiating", "dead"],
  contacted: ["responded", "negotiating", "interested", "qualified", "dead"],
  responded: ["negotiating", "contacted", "accepted", "dead"],
  negotiating: ["accepted", "responded", "under_contract", "dead"],
  accepted: ["under_contract", "closed", "negotiating", "dead"],
  interested: ["qualified", "contacted", "dead"],
  qualified: ["under_contract", "negotiating", "dead"],
  under_contract: ["closed", "negotiating", "dead"],
  closed: ["negotiating"], // correction path only
  dead: ["new", "contacted", "responded"], // resurrection on a callback
};

/**
 * The lead statuses at or past NEGOTIATION — a deal is being discussed.
 *
 * `cohortAnalysis` computed its middle funnel tier from
 * `["offer_sent", "negotiating", "under_contract", "closed"]` and called the
 * result `offerSent`. `offer_sent` is a DEAL status: a lead has no
 * "offer sent" state, because offers live on deals. So the term matched
 * nothing and the tier was, in fact, "negotiating and beyond" — which is what
 * it is called here, rather than keeping a name that describes a state the
 * lead vocabulary does not have.
 */
export const NEGOTIATING_LEAD_STATUSES = [
  "negotiating",
  "accepted",
  "under_contract",
  "closed",
] as const;

/** The lead statuses at or past a signed contract. */
export const UNDER_CONTRACT_LEAD_STATUSES = ["under_contract", "closed"] as const;

/**
 * ── VALUES THAT ARE IN THE COLUMN BUT ARE NOT FUNNEL STATES ────────────────
 *
 * The lists above are the FUNNEL vocabulary — what a lead or deal may be moved
 * to through a status change, human or agent. They are not the whole set of
 * values the column actually holds, and the difference was invisible until it
 * was measured (2026-09-06, by walking every `db.update(leads|deals).set()`
 * and `.values()` in the repo rather than every filter):
 *
 *   leads.status  <- "deleted"   server/storage/leadRepo.ts (soft delete, ×2)
 *   deals.status  <- "deleted"   server/storage/dealRepo.ts, propertyRepo.ts
 *   leads.status  <- "archived"  server/services/crmEnhancements.ts (90-day sweep)
 *   leads.status  <- "active"    server/jobs/autonomousDealMachine.ts (see below)
 *
 * This matters because pipeline-status.ts was written from an audit of
 * FILTERS, and its header says values like `active` "are never written". Three
 * of the four above are written every day, and each one makes a row invisible
 * to every projection in this file.
 *
 * They are kept OUT of LEAD_STATUSES / DEAL_STATUSES deliberately. Membership
 * there means "a status change may target this", and nothing should be able to
 * PATCH a lead to `deleted` — soft deletion is the repo's job, through its own
 * method. So they live here: real, enumerated, excluded from the funnel.
 */
export const ADMINISTRATIVE_LEAD_STATUSES = ["archived", "deleted"] as const;
export const ADMINISTRATIVE_DEAL_STATUSES = ["deleted"] as const;

/**
 * Values still sitting on rows that NOTHING MAY WRITE AGAIN.
 *
 * `active` was inserted by the Deal Hunter's auto-enrolment
 * (autonomousDealMachine.ts) for every lead it created; the canonical status
 * for a freshly created lead is `new`, and the writer now says so. `closing`
 * came from executionEngine's `newStage ?? "closing"` default — see
 * CLOSED_DEAL_STATUSES below.
 *
 * Readers that must not strand those rows consult these; writers never do.
 */
export const LEGACY_LEAD_STATUSES = ["active"] as const;

/**
 * The lead statuses that END the funnel — nothing further is expected of the
 * lead, in either direction.
 *
 * DERIVED for the same reason as the deal sets. Four call sites had each
 * spelled their own version and each got it wrong in a different way:
 * `('dead','closed','converted')` in two alerting sweeps and
 * `ne(status,'converted') AND ne(status,'dead')` in portfolioHealth, where
 * `converted` is not a lead status at all; and
 * `not in ('closed','lost','do_not_contact')` in leadScoreDecay, where neither
 * `lost` nor `do_not_contact` exists (opting out is a COLUMN, `leads.optedOut`)
 * and `dead` was simply absent.
 */
export const TERMINAL_LEAD_STATUSES = ["closed", "dead"] as const;

/**
 * The statuses that mean a lead has ENGAGED — it moved out of pure outbound
 * into a two-way state, and is not dead.
 *
 * DERIVED, not typed, for the same reason ACTIVE_DEAL_STATUSES is: adding a
 * status to LEAD_STATUSES puts it here automatically unless it is
 * pre-engagement (`new`, `mailed`) or terminal-negative (`dead`), so the two
 * lists cannot drift.
 *
 * They already had. `outcomeVerificationLoop.verifyFollowUp` — which feeds
 * agent trust evolution — scored a follow-up positive on
 * `["contacted", "qualified", "offer_sent", "under_contract"]`. `offer_sent`
 * is a DEAL status and matched no lead, ever, while `responded` and
 * `negotiating` — the strongest evidence a follow-up worked — were missing
 * entirely, so a lead that replied was recorded as "status unchanged". Both
 * halves wrong, in a loop whose whole job is measuring whether an agent's
 * action helped.
 */
export const ENGAGED_LEAD_STATUSES = LEAD_STATUSES.filter(
  (s): s is Exclude<LeadStatus, "new" | "mailed" | "dead"> =>
    !(["new", "mailed", "dead"] as readonly string[]).includes(s),
);

// ── Deals ───────────────────────────────────────────────────────────────────

/** All valid deal statuses (matches STAGE_BENCHMARK_DAYS + the kanban). */
export const DEAL_STATUSES = [
  "negotiating",
  "offer_sent",
  "countered",
  "accepted",
  "in_escrow",
  "closed",
  "cancelled",
] as const;

/**
 * The deal statuses that mean "still in the pipeline" — every canonical status
 * except the two terminal ones.
 *
 * DERIVED, not typed: adding a status to DEAL_STATUSES puts it in the pipeline
 * automatically unless it is terminal, so the two lists cannot drift. That
 * matters because they already had. `analyticsRepo` counted the pipeline with
 * an inline `or(status='negotiation', 'pending', 'due_diligence',
 * 'under_contract')` — NOT ONE of those four is a member of DEAL_STATUSES, and
 * 'negotiation' is a one-character typo for the schema default 'negotiating'.
 * routes.ts validates writes against DEAL_STATUSES, so three of the four could
 * never legitimately be stored: the "Deals in Pipeline" card and the
 * pipeline-value chart read 0 for every organization, forever (2026-09-04).
 *
 * This is the second law's shape exactly — a canonical projection that existed
 * and had no adoption in the surface that needed it. Any new pipeline query
 * imports this rather than spelling a list again.
 */
// Not exported: its only reader is the filter below, and an export with no
// importer is what the reachability ratchet calls an internal-only export —
// drop the keyword, keep the code. Export it the day something outside this
// file needs "which statuses are terminal".
const TERMINAL_DEAL_STATUSES = ["closed", "cancelled"] as const;
export const ACTIVE_DEAL_STATUSES = DEAL_STATUSES.filter(
  (s): s is Exclude<DealStatus, "closed" | "cancelled"> =>
    !(TERMINAL_DEAL_STATUSES as readonly string[]).includes(s),
);

/**
 * A LEGACY value that is not in DEAL_STATUSES and must never be written again.
 *
 * `executionEngine.advance_deal_stage` defaulted to `status: newStage ??
 * "closing"` until 2026-09-06 — so an autopilot call that omitted a stage
 * silently stored a word the vocabulary does not contain. The writer is gone
 * (it refuses a missing stage now), but rows written before that are still out
 * there and this repo does not guess at production data.
 *
 * Three revenue surfaces had each independently written `('closed',
 * 'closing')` inline to compensate — portfolioPnl, cohortAnalysis and
 * attributionService. That is precisely the drift ACTIVE_DEAL_STATUSES's
 * comment above says was already paid for once: a compensation spelled three
 * times is three places to forget it. It lives here now, exported, so the
 * readers share ONE list and the day someone backfills the rows there is ONE
 * definition to retire.
 */
const LEGACY_CLOSING_DEAL_STATUS = "closing";

/**
 * Every status that means "this deal produced revenue" — the canonical
 * terminal `closed`, plus the legacy value above so historical rows keep
 * counting. Read-only: nothing may WRITE anything here except `closed`.
 */
export const CLOSED_DEAL_STATUSES = ["closed", LEGACY_CLOSING_DEAL_STATUS] as const;

/**
 * Every FUNNEL deal status — DEAL_STATUSES plus the legacy value, and
 * deliberately NOT the administrative ones. The denominator of a rate over
 * "deals that entered the pipeline at all": a soft-deleted row is not a deal
 * that failed to close, it is a deal that was withdrawn from the count.
 */
export const ALL_FUNNEL_DEAL_STATUSES = [
  ...DEAL_STATUSES,
  LEGACY_CLOSING_DEAL_STATUS,
] as const;

/**
 * The deal statuses that mean the outcome is KNOWN — closed one way or the
 * other. What a calibration or learning sweep looks for, as opposed to
 * CLOSED_DEAL_STATUSES, which means specifically "produced revenue".
 */
export const RESOLVED_DEAL_STATUSES = [...CLOSED_DEAL_STATUSES, "cancelled"] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];
export const dealStatusSchema = z.enum(DEAL_STATUSES);

/**
 * Valid deal status transitions — no skipping states (Task #210).
 * Promoted from routes-deals.ts so the bulk route, repos, and services
 * share ONE table instead of re-declaring (or forgetting) it.
 */
export const DEAL_STATUS_TRANSITIONS: Record<DealStatus, readonly DealStatus[]> = {
  negotiating: ["offer_sent", "cancelled"],
  offer_sent: ["countered", "accepted", "cancelled"],
  countered: ["offer_sent", "accepted", "cancelled"],
  accepted: ["in_escrow", "cancelled"],
  in_escrow: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

// ── Shared helpers ──────────────────────────────────────────────────────────

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && (LEAD_STATUSES as readonly string[]).includes(value);
}

export function isDealStatus(value: unknown): value is DealStatus {
  return typeof value === "string" && (DEAL_STATUSES as readonly string[]).includes(value);
}

/**
 * Validate a lead status change. Returns null when allowed, or a
 * human-readable refusal. Unknown CURRENT values (legacy rows predating
 * this table) are allowed to move to any valid status — the table must
 * never brick an old row in place.
 */
export function validateLeadTransition(
  current: string | null | undefined,
  next: string,
): string | null {
  if (!isLeadStatus(next)) {
    return `"${next}" is not a valid lead status (expected one of: ${LEAD_STATUSES.join(", ")})`;
  }
  if (current === next) return null;
  if (!current || !isLeadStatus(current)) return null; // legacy row — allow re-entry
  const allowed = LEAD_STATUS_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    return `Cannot move a lead from ${current} to ${next}`;
  }
  return null;
}

/** Deal counterpart of validateLeadTransition — same contract. */
export function validateDealTransition(
  current: string | null | undefined,
  next: string,
): string | null {
  if (!isDealStatus(next)) {
    return `"${next}" is not a valid deal status (expected one of: ${DEAL_STATUSES.join(", ")})`;
  }
  if (current === next) return null;
  if (!current || !isDealStatus(current)) return null; // legacy row — allow re-entry
  const allowed = DEAL_STATUS_TRANSITIONS[current];
  if (!allowed.includes(next)) {
    return `Cannot transition from ${current} to ${next}`;
  }
  return null;
}
