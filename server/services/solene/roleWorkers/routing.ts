/**
 * Which worker runs a dispatch — the MOVE KIND decides (Stage 2, S11).
 *
 * Before this, every autopilot dispatch ran a developer-style coding agent
 * (file_read, git_commit, run_tests) — so a growth move to write an article
 * "completed" with "Nothing further to add." and zero marketing artifacts, and
 * a support move had no way to answer a customer. Business moves now go to a
 * role worker with business tools and its own instructions; code work keeps
 * the coding agent.
 *
 * Pure: routing is a lookup on the dispatch's source, never on the agent role
 * a caller happened to pass (a founder-enqueued "autopilot:grow_owned_channels"
 * goes to the Writer whatever role it names).
 */
export const ROLE_WORKERS = ["writer", "support", "retention", "ops"] as const;
export type RoleWorker = (typeof ROLE_WORKERS)[number];

/** Move kind → the business role that carries it. Absent ⇒ coding agent. */
export const ROLE_WORKER_BY_MOVE: Readonly<Record<string, RoleWorker>> = {
  grow_owned_channels: "writer",
  clear_support_backlog: "support",
  retain_at_risk: "retention",
  recover_payments: "retention",
  convert_trials: "retention",
  stabilize_reflexes: "ops",
};

const AUTOPILOT_PREFIX = "autopilot:";

/** The move kind an autopilot dispatch carries, or null for any other dispatch. */
export function moveKindOfDispatch(row: { sourceType: string; sourceId: string }): string | null {
  if (row.sourceType !== "auto_dispatch" || !row.sourceId.startsWith(AUTOPILOT_PREFIX)) return null;
  return row.sourceId.slice(AUTOPILOT_PREFIX.length);
}

/** The role worker for a dispatch, or null when it is code work. Pure. */
export function roleWorkerForDispatch(row: { sourceType: string; sourceId: string }): RoleWorker | null {
  const kind = moveKindOfDispatch(row);
  if (!kind) return null;
  return ROLE_WORKER_BY_MOVE[kind] ?? null;
}

/**
 * support_tickets.assigned_agent markers: the Support worker drafted a reply
 * (awaiting its witness), or handed the ticket to the founder (an open ask
 * names it). Shared with the brain's backlog sense (senses.ts).
 */
export const SUPPORT_WORKER_AGENT = "solene-support";
export const FOUNDER_AGENT = "founder";

/** True when a move is carried by a role worker (not the coding agent). */
export function isRoleWorkerMove(moveKind: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROLE_WORKER_BY_MOVE, moveKind);
}
