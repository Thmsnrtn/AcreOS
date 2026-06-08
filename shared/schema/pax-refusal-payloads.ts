// ============================================================================
// SHARED/SCHEMA/PAX-REFUSAL-PAYLOADS.TS
// ----------------------------------------------------------------------------
// Quinn (Chief of Alignment) + Beatrice (CRO) — refusal payload ledger.
//
// Tahoe wave E9 — codifies the customer recourse path. When Pax (or any
// post-validate gate) refuses to satisfy a customer request because doing so
// would violate a customer-facing immutable, we persist the refusal as a
// `pax_refusal_payloads` row. A refusal row is the substrate the customer
// can later appeal against (see `pax_decision_appeals`).
//
// Why this exists separately from solene_constitutional_violations:
//   - solene_constitutional_violations covers AGENT-side breaches (the agent
//     did or attempted a constitutional breach). The audit posture is
//     internal — Beatrice + Solene retro material.
//   - pax_refusal_payloads covers CUSTOMER-FACING refusals (Pax declined to
//     do something the customer asked for, citing an immutable). The audit
//     posture is external — the customer has a right to know what was
//     refused, why, and to appeal.
//
// EU AI Act Article 86 alignment — "right to obtain a clear and meaningful
// explanation … of the decision-making procedure."
//
// Schema:
//   id                   serial PK
//   organization_id      FK → organizations.id, NOT NULL — every refusal
//                          happens in an org scope (a logged-in customer
//                          OR an external signer in an org's signing flow).
//   conversation_id      int — the ai_conversations.id this refusal came
//                          from. Nullable for non-conversation refusal
//                          surfaces (future).
//   message_id           int — the ai_messages.id the refusal replaced (the
//                          assistant message returned to the customer was
//                          the refusal_text, not the would-be answer).
//                          Nullable because some emitters write a refusal
//                          BEFORE the message row lands.
//   cited_immutable_id   text — the canonical immutable ID from
//                          sovereign-protocol/immutables.json. Format
//                          "customer:N" where N is the customer immutable
//                          number. We use the prefixed string form so that
//                          future sovereign-principle refusals
//                          ("sovereign:N") can share the column.
//   cited_immutable_text text NULLABLE — the PLAIN-LANGUAGE wording of the
//                          cited immutable, snapshotted at write time. Quinn
//                          alignment fix: the future appeal UI shows the
//                          customer WHY Pax refused. Persisting the text at
//                          write time (rather than re-deriving from the id at
//                          render time) means a later constitutional amendment
//                          that changes the wording cannot retroactively alter
//                          what a past refusal told the customer. Nullable
//                          because the id may not resolve to a known immutable
//                          (defensive), and legacy rows predate the column.
//   refusal_text         text — the verbatim user-facing message Pax
//                          returned. This is what the customer saw.
//   severity             enum: info | warn | critical — matches the
//                          continuousAudit Detector severity floor; lets us
//                          aggregate refusal rates by severity in the
//                          transparency report.
//   created_at           timestamptz
//
// Indexes (L3 lint compliant — leading on organization_id):
//   - (organization_id, created_at) for per-org rollups
//   - (organization_id, cited_immutable_id, created_at) for per-immutable
//     refusal-rate aggregation (the transparency report query shape)
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
import { organizations } from "../schema";

export const PAX_REFUSAL_SEVERITIES = ["info", "warn", "critical"] as const;
export type PaxRefusalSeverity = (typeof PAX_REFUSAL_SEVERITIES)[number];

export const paxRefusalPayloads = pgTable(
  "pax_refusal_payloads",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    conversationId: integer("conversation_id"),
    messageId: integer("message_id"),
    citedImmutableId: text("cited_immutable_id").notNull(),
    // Plain-language wording of the cited immutable, snapshotted at write
    // time so the appeal UI never re-derives it (and can't drift from a
    // later constitutional amendment). Nullable: defensive + legacy rows.
    citedImmutableText: text("cited_immutable_text"),
    refusalText: text("refusal_text").notNull(),
    severity: text("severity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // L3 lint — leading on organization_id, covers per-org rollup queries.
    index("pax_refusal_payloads_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    // Per-org per-immutable refusal-rate aggregation (transparency report).
    index("pax_refusal_payloads_org_imm_created_idx").on(
      t.organizationId,
      t.citedImmutableId,
      t.createdAt,
    ),
  ],
);

export type PaxRefusalPayload = typeof paxRefusalPayloads.$inferSelect;
export type InsertPaxRefusalPayload = typeof paxRefusalPayloads.$inferInsert;
