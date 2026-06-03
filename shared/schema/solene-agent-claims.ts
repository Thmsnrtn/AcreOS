// ============================================================================
// SHARED/SCHEMA/SOLENE-AGENT-CLAIMS.TS
// ----------------------------------------------------------------------------
// Solene — cross-agent coordination layer (Layer 1 capability #2 of the
// agentic-evolution architecture, feedback_agentic_evolution_north_star.md).
//
// Eliminates the 3-incident pattern where agent A's `git add` sweep pulled
// agent B's untracked files into A's commit (see 2026-06-02 aff4c273
// Krieger-sweeping-Soren incident summarised in feedback_implicit_trust_…).
//
// One table:
//   solene_agent_claims — each row is "agent X has claimed file-surface
//                          patterns P for dispatch D between claimed_at and
//                          released_at (or until ttl expires)."
//
// The pre-commit hook reads ACTIVE claims and blocks commits that stage
// files matching another agent's pattern set.
//
// `dispatch_id` is nullable on purpose: this capability ships BEFORE
// keystone 1 lands in some environments. When dispatchQueue exists, the
// FK constraint applies. Until then, claims can be opened for ad-hoc
// agent dispatches identified solely by agent_role + ttl.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_AGENT_CLAIMS
// ============================================
export const soleneAgentClaims = pgTable(
  "solene_agent_claims",
  {
    id: serial("id").primaryKey(),
    // Nullable until keystone 1 (dispatch_id FK) lands everywhere.
    // When set, points at solene_dispatch_queue.id.
    dispatchId: integer("dispatch_id"),
    agentRole: text("agent_role").notNull(), // see CLAIM_AGENT_ROLES
    claimedAt: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ttlMinutes: integer("ttl_minutes").notNull().default(60),
    // Glob patterns the agent is authorized to touch. Examples:
    //   ["server/services/iris/*", "shared/schema/iris-*.ts"]
    // Stored as a Postgres text[].
    fileSurfacePatterns: text("file_surface_patterns")
      .array()
      .notNull()
      .default(sqlEmptyArray()),
    claimStatus: text("claim_status").notNull().default("active"), // active | released | expired
    // Free-form note: e.g. "founder override", "queued behind dispatch 42"
    note: text("note"),
  },
  (t) => [
    // Fast active-claim lookup: hook + service hit this every commit + dispatch.
    index("solene_agent_claims_active_idx").on(t.claimStatus, t.claimedAt),
    // Helps expireStaleClaims walk old active rows.
    index("solene_agent_claims_status_claimed_idx").on(t.claimStatus, t.claimedAt),
    // UNIQUE(dispatch_id) when dispatch_id is not null — one claim per
    // dispatch. Postgres treats NULLs as distinct by default, so this
    // permits unlimited ad-hoc (null-dispatch) claims while preventing
    // duplicates for a real dispatch.
    uniqueIndex("solene_agent_claims_dispatch_unique").on(t.dispatchId),
  ],
);

export type SoleneAgentClaim = typeof soleneAgentClaims.$inferSelect;
export type InsertSoleneAgentClaim = typeof soleneAgentClaims.$inferInsert;

// ============================================
// ENUMS / CONSTANTS
// ============================================

export const CLAIM_STATUSES = ["active", "released", "expired"] as const;
export type SoleneAgentClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_AGENT_ROLES = [
  "iris",
  "soren",
  "beatrice",
  "krieger",
  "solene",
  "general-purpose",
  "founder",
] as const;
export type SoleneAgentClaimRole = (typeof CLAIM_AGENT_ROLES)[number];

export const DEFAULT_CLAIM_TTL_MINUTES = 60;
export const MAX_CLAIM_TTL_MINUTES = 60 * 12; // 12h sanity ceiling

// Drizzle default helper: empty text[] literal. Kept local so the file
// stays self-contained.
function sqlEmptyArray() {
  // The drizzle text().array() default takes a JS array; an empty array
  // produces the correct DEFAULT '{}' clause at migration time.
  return [] as string[];
}
