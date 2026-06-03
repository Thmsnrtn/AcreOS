// ============================================================================
// SHARED/SCHEMA/SOLENE-CONSTITUTIONAL-VIOLATIONS.TS
// ----------------------------------------------------------------------------
// Solene — constitutional self-defense ledger (L6.29).
//
// Today, dispatched agents are trusted to refuse any tool call or prompt that
// would violate the 12 constitutional immutables. Nothing structurally
// prevents or audits constitutional drift.
//
// This table is the audit surface for the tool-call-level guard implemented
// in server/services/solene/constitutionalGuard.ts. Every time a tool call
// is screened and BLOCKED for a constitutional violation (or later, every
// time an output-review reviewer catches a violation post-hoc) a row lands
// here. Critical-severity rows page Solene immediately; urgent ones page
// with a softer signal. Both classes are weekly-retro material.
//
// Schema:
//   id                   serial PK
//   detected_at          timestamptz default now()
//   dispatch_id          int, nullable — the dispatch the tool call came from
//   immutable_number     int 1-12 — which of the 12 immutables tripped
//   immutable_text       text — denormalized snapshot of the immutable wording
//                          so historical rows survive even if the constitution
//                          rewords (the row records what was violated AT THE
//                          TIME, not the current wording).
//   trigger_kind         text — tool_call_pattern | prompt_pattern | output_pattern
//   trigger_evidence     text — sanitized excerpt; MUST NOT contain credential
//                          values (sanitizeEvidence in constitutionalGuard.ts
//                          strips sk_/pk_/phc_/phx_/ghp_/Bearer/AWS prefixes
//                          before the row is written).
//   tool_name            text, nullable — for tool-call-pattern hits
//   tool_input_hash      text, nullable — sha256 of the raw input so
//                          attribution is possible without storing the input
//                          itself (which might contain secrets).
//   action_taken         text — blocked_and_paged | blocked | paged_only |
//                          logged_only
//   severity             text — critical (immutables 5/6/11/12) | urgent
//   page_event_id        int, nullable — FK to solene_page_events.id when
//                          a page actually fired.
//   reviewed_at          timestamptz, nullable — Tom/Solene retro mark
//   reviewer_note        text, nullable
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
} from "drizzle-orm/pg-core";

export const soleneConstitutionalViolations = pgTable(
  "solene_constitutional_violations",
  {
    id: serial("id").primaryKey(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchId: integer("dispatch_id"),
    immutableNumber: integer("immutable_number").notNull(),
    immutableText: text("immutable_text").notNull(),
    triggerKind: text("trigger_kind").notNull(),
    triggerEvidence: text("trigger_evidence").notNull(),
    toolName: text("tool_name"),
    toolInputHash: text("tool_input_hash"),
    actionTaken: text("action_taken").notNull(),
    severity: text("severity").notNull(),
    pageEventId: integer("page_event_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewerNote: text("reviewer_note"),
  },
  (t) => [
    index("solene_constitutional_violations_imm_idx").on(
      t.immutableNumber,
      t.detectedAt,
    ),
    index("solene_constitutional_violations_sev_idx").on(
      t.severity,
      t.reviewedAt,
    ),
    index("solene_constitutional_violations_dispatch_idx").on(t.dispatchId),
  ],
);

export type SoleneConstitutionalViolation =
  typeof soleneConstitutionalViolations.$inferSelect;
export type InsertSoleneConstitutionalViolation =
  typeof soleneConstitutionalViolations.$inferInsert;

export const CONSTITUTIONAL_TRIGGER_KINDS = [
  "tool_call_pattern",
  "prompt_pattern",
  "output_pattern",
] as const;
export type ConstitutionalTriggerKind =
  (typeof CONSTITUTIONAL_TRIGGER_KINDS)[number];

export const CONSTITUTIONAL_ACTIONS = [
  "blocked_and_paged",
  "blocked",
  "paged_only",
  "logged_only",
] as const;
export type ConstitutionalAction = (typeof CONSTITUTIONAL_ACTIONS)[number];

export const CONSTITUTIONAL_SEVERITIES = ["critical", "urgent"] as const;
export type ConstitutionalSeverity =
  (typeof CONSTITUTIONAL_SEVERITIES)[number];

// ============================================================================
// THE 12 IMMUTABLES (canonical wording from acreos_constitution.md).
// Exported for both runtime use (denormalized snapshot column) and for tests.
// ============================================================================

export const CONSTITUTIONAL_IMMUTABLES = [
  { number: 1, text: "Never lie to a customer about a fact, price, or what Pax did." },
  { number: 2, text: "Never use dark patterns." },
  { number: 3, text: "Never collect data not immediately useful to customer." },
  { number: 4, text: "Always make cancellation as easy as signup." },
  { number: 5, text: "Never sell/share/use customer data outside serving them." },
  { number: 6, text: "Never auto-charge without explicit, recent, easily-revoked consent." },
  { number: 7, text: "Always disclose AI use clearly." },
  { number: 8, text: "Always honor data-deletion within 7 days." },
  { number: 9, text: "Never recommend action against customer's interest." },
  { number: 10, text: "Never market to vulnerable populations without safeguards." },
  { number: 11, text: 'Never generate "get rich quick" content.' },
  { number: 12, text: "Pax never gives fiduciary advice." },
] as const;

export type ConstitutionalImmutableNumber =
  (typeof CONSTITUTIONAL_IMMUTABLES)[number]["number"];
