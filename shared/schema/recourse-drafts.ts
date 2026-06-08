// ============================================================================
// SHARED/SCHEMA/RECOURSE-DRAFTS.TS
// ----------------------------------------------------------------------------
// Rafe (CCO) — the Recourse Loop draft ledger.
//
// Today every NEGATIVE customer signal flows INWARD — a detractor NPS (≤6), a
// low support rating (≤2/5), or a cancellation drops a founder-visible alert
// and the customer hears crickets. The Recourse Loop flips it: each negative
// signal becomes a DRAFTED, personal, same-hour human reply sitting in one
// founder queue, one-click to edit-and-send, with the sent reply persisted
// back so the loop is auditable.
//
// This table is the persistence layer. One row per (signal → draft). The
// draft is seeded by a cheap model from the customer's VERBATIM words + their
// account context — never a template, always their situation. The founder
// edits and sends; the sent body + send timestamp are written back here.
//
// Serves immutable #1 (truth — we own the failure and say so), #2 (no dark
// patterns — the customer always hears back, in their own situation's
// language), and the cancellation-is-easy floor.
//
// Schema:
//   id                serial PK
//   organization_id   FK → organizations.id, NOT NULL — the org whose customer
//                       sent the negative signal.
//   signal_type       enum: detractor_nps | low_support_rating | cancellation
//   signal_ref_type   text — the source table ("system_alert" | "support_case"
//                       | "cancellation_survey"), for auditing back to source.
//   signal_ref_id     int — the source row id, for dedupe + provenance.
//   recipient_user_id text nullable — the user.id the reply is addressed to
//                       (else we fall back to the org owner at send time).
//   recipient_email   text nullable — resolved deliverable address (cached at
//                       draft time; re-resolved at send if absent).
//   customer_verbatim text nullable — the customer's actual words (the NPS
//                       comment, the support thread context, the cancel
//                       feedback). The seed of every draft; never paraphrased.
//   context_summary   text nullable — the account context fed to the drafter
//                       (org name, tier, recent cases) — kept for the audit.
//   draft_body        text nullable — the model-generated draft reply. Null
//                       until generated; regenerable.
//   draft_model       text nullable — which cheap model produced the draft.
//   sent_body         text nullable — the FINAL body the founder actually sent
//                       (post-edit). Distinct from draft_body so we can audit
//                       what the model proposed vs. what a human sent.
//   status            enum: draft | sent | dismissed
//   sent_at           timestamptz nullable — when the founder sent the reply.
//   email_status      text nullable — sent | suppressed | failed | skipped.
//   created_at, updated_at
//
// Indexes (L3 lint compliant — leading on organization_id):
//   - (organization_id, status, created_at) — per-org open-queue shape
//   - (signal_ref_type, signal_ref_id) — dedupe: one draft per source signal
//
// Mirror in scripts/migrate.mjs (migration 0140) +
// migrations/0140_recourse_drafts.sql.
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
import { organizations } from "../schema";

export const RECOURSE_SIGNAL_TYPES = [
  "detractor_nps",
  "low_support_rating",
  "cancellation",
] as const;
export type RecourseSignalType = (typeof RECOURSE_SIGNAL_TYPES)[number];

export const RECOURSE_DRAFT_STATUSES = ["draft", "sent", "dismissed"] as const;
export type RecourseDraftStatus = (typeof RECOURSE_DRAFT_STATUSES)[number];

export const recourseDrafts = pgTable(
  "recourse_drafts",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    signalType: text("signal_type").notNull(),
    signalRefType: text("signal_ref_type").notNull(),
    signalRefId: integer("signal_ref_id"),
    recipientUserId: text("recipient_user_id"),
    recipientEmail: text("recipient_email"),
    customerVerbatim: text("customer_verbatim"),
    contextSummary: text("context_summary"),
    draftBody: text("draft_body"),
    draftModel: text("draft_model"),
    sentBody: text("sent_body"),
    status: text("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    emailStatus: text("email_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // L3 lint — leading on organization_id; covers the per-org queue shape
    // ("which recourse drafts does this org have open right now").
    index("recourse_drafts_org_status_created_idx").on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    // Dedupe: at most one draft per source signal. The aggregator upserts
    // against this so re-running the sweep never double-drafts a signal.
    uniqueIndex("recourse_drafts_signal_ref_idx").on(
      t.signalRefType,
      t.signalRefId,
    ),
  ],
);

export type RecourseDraft = typeof recourseDrafts.$inferSelect;
export type InsertRecourseDraft = typeof recourseDrafts.$inferInsert;
