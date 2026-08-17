// ============================================================================
// SHARED/SCHEMA/OUTWARD-ACTIONS.TS — the consequential-action claim ledger.
// ----------------------------------------------------------------------------
// Canonical law 8: "Consequential actions require explicit authority, durable
// execution, idempotency and receipts." BI74 places idempotency specifically at
// the ACTION/PROVIDER boundary and carries it through the WorkflowRun —
// "retrying orchestration must never duplicate consequential side effects".
//
// WHAT WAS ACTUALLY BROKEN
// ------------------------
// `server/middleware/idempotency.ts` is HTTP-REQUEST-scoped: an
// `Idempotency-Key` header, a 24-hour TTL, and an in-memory fallback when Redis
// is absent. It protects a client retrying a POST. It does nothing for the case
// that actually costs money — a background JOB retrying after a partial
// success, which never passes through an HTTP request at all.
//
// `directMailService.sendLetter()` is the concrete example. It deducts credits,
// posts the piece cost to the ledger, and calls Lob. If the process dies after
// Lob accepted the letter but before the result was recorded, the retry deducts
// credits AGAIN, posts cost AGAIN, and prints a SECOND physical letter to a
// real seller. `preMailDedupe.ts` does not catch it — that is an AUDIENCE
// policy (don't mail your own parcel, don't re-mail within 90 days), not retry
// safety.
//
// WHY THIS TABLE IS MUTABLE (unlike evidence_claims / decision_snapshots)
// ----------------------------------------------------------------------
// Those two are HISTORY and must never change. This is OPERATIONAL STATE: a
// claim is made, then transitions to succeeded / failed / ambiguous. Conflating
// the two would be the mistake BI76 warns about — an audit event, a decision
// snapshot, an action receipt and an outcome are four different things and must
// not collapse into one generic log. This table is the idempotency CLAIM; the
// immutable proof is a receipt (`autopilot/proofReceipt.ts`), which is a
// separate artifact with a separate lifecycle.
//
// THE AMBIGUOUS STATE IS THE POINT
// --------------------------------
// AU28: a provider timeout AFTER the request left is neither success nor
// failure. Most idempotency implementations treat it as failure and retry,
// which is precisely how a double-send happens. Here it becomes a terminal
// `ambiguous` status that REFUSES further attempts until reconciliation — the
// system stops and asks rather than guessing with someone else's money.
// ============================================================================

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";

/** Terminal and in-flight states of an outward action claim. */
export type OutwardActionStatus =
  | "in_flight" // claimed, provider call underway
  | "succeeded" // provider accepted; externalId recorded
  | "failed" // provider rejected BEFORE any side effect — safe to retry
  | "ambiguous"; // outcome unknown — MUST NOT auto-retry (AU28)

export const outwardActions = pgTable(
  "outward_actions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),

    /** e.g. "physical_mail.letter", "email.counterparty", "sms.counterparty". */
    actionKind: text("action_kind").notNull(),
    /**
     * The caller's stable key for THIS logical action. Derived from durable
     * domain identity (campaign piece id, note payment id) — never from a
     * random value, which would defeat the whole mechanism on retry.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    /**
     * Hash of the canonical request payload. Detects the dangerous case of the
     * same key being reused for DIFFERENT content — a caller bug that silently
     * suppresses a legitimate second send if the hash is not checked.
     */
    requestHash: text("request_hash").notNull(),

    status: text("status").$type<OutwardActionStatus>().notNull().default("in_flight"),

    /** The provider's identifier — the anchor a receipt and reconciliation use. */
    externalId: text("external_id"),
    /** Number of times a claim has been taken for this key. */
    attempts: integer("attempts").notNull().default(1),
    lastError: text("last_error"),

    claimedAt: timestamp("claimed_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    // THE load-bearing constraint: the atomic claim. `INSERT ... ON CONFLICT DO
    // NOTHING` against this index is what makes two concurrent workers unable
    // to both send. Org-LEADING, which also satisfies the shard-readiness
    // invariant (scripts/check-org-leading-index.mjs).
    uniqueIndex("outward_actions_org_kind_key_uk").on(
      table.organizationId,
      table.actionKind,
      table.idempotencyKey,
    ),
    // Reconciliation sweep: "every ambiguous action, oldest first".
    index("outward_actions_org_status_idx").on(
      table.organizationId,
      table.status,
      table.claimedAt,
    ),
  ],
);

export type OutwardActionRow = typeof outwardActions.$inferSelect;
export type InsertOutwardActionRow = typeof outwardActions.$inferInsert;
