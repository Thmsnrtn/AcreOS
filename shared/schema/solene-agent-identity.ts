// ============================================================================
// SHARED/SCHEMA/SOLENE-AGENT-IDENTITY.TS
// ----------------------------------------------------------------------------
// Solene — persistent agent identity (Layer 1 capability L1.4 of the
// agentic-evolution architecture, feedback_agentic_evolution_north_star.md).
//
// Each role (iris / soren / beatrice / krieger / general-purpose) accumulates
// context across dispatches. Iris-on-Tuesday should remember what
// Iris-on-Monday decided, and *why*. Before this schema, every dispatch
// started cold — the role brief was loaded but no past-decision continuity
// existed.
//
// One table:
//   solene_agent_identity_decisions — append-only ledger of decisions an
//                                      agent made during a dispatch, with
//                                      rationale + referenced files. The
//                                      dispatchRunner reads the N most-recent
//                                      rows for the active role and injects
//                                      them into the system prompt before
//                                      the role brief.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================
//
// NOTE — tool exposure (handled in a follow-up Solene commit):
//   A future `record_decision` tool will be added to dispatchToolExecutor's
//   tool schema list so agents can write to this table at the end of a
//   working step. The intended signature is:
//
//     record_decision({
//       decision_kind: "architecture" | "bug_fix" | "policy" | "escalation",
//       summary: string,        // ≤ 500 chars
//       rationale: string,
//       referenced_files?: string[],
//       evidence_url?: string
//     })
//
//   The tool wrapper calls recordAgentDecision() from agentIdentity.ts with
//   agent_role + dispatch_id + session_token filled in from the runner's
//   context. dispatchToolExecutor.ts is owned by Sibling D's L6.29 work this
//   wave, so the tool wiring lands in a follow-up commit.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================
// SOLENE_AGENT_IDENTITY_DECISIONS
// ============================================
export const soleneAgentIdentityDecisions = pgTable(
  "solene_agent_identity_decisions",
  {
    id: serial("id").primaryKey(),
    agentRole: text("agent_role").notNull(), // mirrors DISPATCH_AGENT_ROLES
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decisionKind: text("decision_kind").notNull(), // see IDENTITY_DECISION_KINDS
    summary: text("summary").notNull(), // ≤ 500 chars enforced by service
    rationale: text("rationale").notNull(),
    referencedFiles: text("referenced_files")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Nullable FK to solene_dispatch_queue. Same nullable-by-design rationale
    // as agent_claims.dispatch_id — supports ad-hoc decisions recorded
    // outside a real dispatch row (e.g. Solene-direct manual entries).
    dispatchId: integer("dispatch_id"),
    evidenceUrl: text("evidence_url"),
    // Session token correlates multiple decisions within a single dispatch
    // run so we can render "decisions made during dispatch N" as a thread.
    sessionToken: text("session_token"),
  },
  (t) => [
    // Most-recent-decisions-by-role lookup is the hot path (every dispatch).
    index("solene_agent_identity_role_decided_idx").on(
      t.agentRole,
      t.decidedAt,
    ),
    index("solene_agent_identity_dispatch_idx").on(t.dispatchId),
    index("solene_agent_identity_kind_decided_idx").on(
      t.decisionKind,
      t.decidedAt,
    ),
  ],
);

export type SoleneAgentIdentityDecision =
  typeof soleneAgentIdentityDecisions.$inferSelect;
export type InsertSoleneAgentIdentityDecision =
  typeof soleneAgentIdentityDecisions.$inferInsert;

// ============================================
// ENUMS / CONSTANTS
// ============================================

export const IDENTITY_DECISION_KINDS = [
  "architecture",
  "bug_fix",
  "policy",
  "escalation",
  "other",
] as const;
export type SoleneIdentityDecisionKind =
  (typeof IDENTITY_DECISION_KINDS)[number];

// Summary cap mirrors the capital-tracker contextSummary discipline (500 chars).
export const IDENTITY_SUMMARY_MAX_CHARS = 500;

// Default identity-block load size — N most-recent rows per role.
export const IDENTITY_BLOCK_DEFAULT_LIMIT = 10;

// 8 KB cap on the rendered markdown block, matching the team-state preamble cap.
export const IDENTITY_BLOCK_MAX_BYTES = 8 * 1024;
