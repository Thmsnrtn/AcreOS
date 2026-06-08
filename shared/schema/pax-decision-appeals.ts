// ============================================================================
// SHARED/SCHEMA/PAX-DECISION-APPEALS.TS
// ----------------------------------------------------------------------------
// Quinn (Chief of Alignment) + Beatrice (CRO) — customer appeals ledger.
//
// Tahoe wave E9 — when Pax refuses a customer request (a row landed in
// `pax_refusal_payloads`), the customer has a right to appeal. This table
// records the appeal lifecycle: open → under_review → upheld | reversed.
//
// EU AI Act Article 86 alignment — "right to obtain a clear and meaningful
// explanation … of the decision-making procedure" plus the implicit right
// to challenge a refusal.
//
// Schema:
//   id                   serial PK
//   organization_id      FK → organizations.id, NOT NULL
//   conversation_id      int — the ai_conversations.id
//   message_id           int — the ai_messages.id of the refusal
//   refusal_payload_id   FK → pax_refusal_payloads.id, NOT NULL — the
//                          specific refusal being appealed.
//   appeal_reason        text NOT NULL — the customer's stated reason for
//                          appealing.
//   appellant_user_id    varchar — the user.id who filed the appeal
//                          (nullable for external-signer appeals).
//   status               enum: open | under_review | upheld | reversed
//   reviewer_user_id     varchar nullable — the AcreOS staff user who
//                          reviewed the appeal.
//   review_notes         text nullable — INTERNAL review reasoning (the
//                          rationale the reviewer records; never shown to the
//                          customer).
//   customer_message     text nullable — the plain-language outcome message
//                          surfaced back to the CUSTOMER on resolution (in
//                          their Pax thread + the closing-the-loop email).
//                          Kept distinct from review_notes so internal
//                          reasoning and the customer-facing wording never
//                          blur. Added in migration 0136 (appeal-loop close).
//   review_decision_at   timestamptz nullable — when the appeal was resolved
//                          (upheld | reversed); doubles as resolvedAt.
//   created_at, updated_at
//
// Indexes (L3 lint compliant — leading on organization_id):
//   - (organization_id, status, created_at) for per-org open-appeals queue
//   - (organization_id, created_at) for per-org rollup
//   - (refusal_payload_id) for joining back to the refusal that was appealed
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  varchar,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";
import { paxRefusalPayloads } from "./pax-refusal-payloads";

export const PAX_APPEAL_STATUSES = [
  "open",
  "under_review",
  "upheld",
  "reversed",
] as const;
export type PaxAppealStatus = (typeof PAX_APPEAL_STATUSES)[number];

export const paxDecisionAppeals = pgTable(
  "pax_decision_appeals",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    conversationId: integer("conversation_id"),
    messageId: integer("message_id"),
    refusalPayloadId: integer("refusal_payload_id")
      .references(() => paxRefusalPayloads.id, { onDelete: "cascade" })
      .notNull(),
    appealReason: text("appeal_reason").notNull(),
    appellantUserId: varchar("appellant_user_id"),
    status: text("status").notNull().default("open"),
    reviewerUserId: varchar("reviewer_user_id"),
    // INTERNAL review reasoning — never surfaced to the customer.
    reviewNotes: text("review_notes"),
    // CUSTOMER-FACING outcome wording, shown in their Pax thread + the
    // close-the-loop email. Distinct from reviewNotes (migration 0136).
    customerMessage: text("customer_message"),
    reviewDecisionAt: timestamp("review_decision_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // L3 lint — leading on organization_id, covers the open-appeals queue
    // query shape ("which appeals does my org have open right now").
    index("pax_decision_appeals_org_status_created_idx").on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    // Per-org rollup.
    index("pax_decision_appeals_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    // Join back from refusal_payload to its appeals (rare path; for the
    // transparency report's "what fraction of refusals were appealed" metric).
    index("pax_decision_appeals_refusal_idx").on(t.refusalPayloadId),
  ],
);

export type PaxDecisionAppeal = typeof paxDecisionAppeals.$inferSelect;
export type InsertPaxDecisionAppeal = typeof paxDecisionAppeals.$inferInsert;
