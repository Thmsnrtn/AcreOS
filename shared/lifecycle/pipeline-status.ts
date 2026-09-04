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
