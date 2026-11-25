/**
 * The canonical lead-status vocabulary — a LEAF module (no imports).
 *
 * This list used to be defined inline in shared/lifecycle/pipeline-status.ts,
 * which also carries the Zod schemas, the transition tables, and the deal
 * vocabulary. Any client surface that needed only the list — the founder
 * command palette is the measured case — pulled that whole module graph
 * (Zod included) into its bundle. The definition lives here so a list-only
 * consumer imports a leaf; pipeline-status.ts re-exports it, so every
 * existing consumer of pipeline-status keeps working unchanged.
 *
 * Adding a value: add it here, and every write seam accepts it — no DDL
 * (see pipeline-status.ts for the house pattern and the full audit trail).
 */

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
