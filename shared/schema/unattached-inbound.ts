// ============================================================================
// SHARED/SCHEMA/UNATTACHED-INBOUND.TS
// ----------------------------------------------------------------------------
// Unattached inbound replies (roadmap W1.4, 2026-07 audit).
//
// THE BUG THIS FIXES: an inbound SMS from a phone number that matched no
// lead (a seller replying from a spouse's phone, a number skip-tracing never
// returned) was logged and DISCARDED — a hot seller response, lost. Every
// unmatched inbound message now lands here instead, replay-deduped on the
// carrier message id, so the Inbox can offer attach-to-lead / create-lead.
// Rows are resolved (attached/dismissed) rather than deleted — the trail of
// what came in stays honest.
// Mirror in scripts/migrate.mjs (migration 0190).
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
import { sql } from "drizzle-orm";

export const unattachedInboundMessages = pgTable(
  "unattached_inbound_messages",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    channel: text("channel").notNull(), // "sms" (email has its own matching path)
    fromAddress: text("from_address").notNull(), // phone or email
    toAddress: text("to_address"),
    body: text("body").notNull(),
    /** Carrier message id (e.g. Twilio MessageSid) — replay dedupe. */
    externalId: text("external_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** null = awaiting triage; else "attached" | "lead_created" | "dismissed". */
    resolution: text("resolution"),
    resolvedLeadId: integer("resolved_lead_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (t) => [
    index("unattached_inbound_org_idx").on(t.organizationId, t.receivedAt),
    uniqueIndex("unattached_inbound_external_uq")
      .on(t.externalId)
      .where(sql`external_id IS NOT NULL`),
  ],
);

export type UnattachedInboundMessage = typeof unattachedInboundMessages.$inferSelect;
export type InsertUnattachedInboundMessage = typeof unattachedInboundMessages.$inferInsert;
