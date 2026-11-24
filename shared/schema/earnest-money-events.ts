// ============================================================================
// SHARED/SCHEMA/EARNEST-MONEY-EVENTS.TS — append-only EMD event log.
// ----------------------------------------------------------------------------
// Census cure (2026-11-19): this table was LIVE on staging but unmodelled.
// It is created on the release path by the item-0086 mirror block in
// scripts/migrate.mjs (placed immediately before the 0239 trigger block;
// byte-mirrored from migrations/0086_earnest_money_events.sql) after PR #623
// executed the S4 ruling for 0086 (Option A: mirror the CREATE, keep the
// orphan registration). Because no pgTable modelled it, the staging schema
// census counted it as undeclared residue (20 vs tolerance 19) on main
// fa720626 — the 20th undeclared table, the only new physical table vs the
// prior main (777 → 778).
//
// This declaration models the table EXACTLY as the 0086 CREATE defines it —
// same columns, types, nullability, defaults, both foreign keys with
// ON DELETE CASCADE, and both index names — and is inert at runtime: there
// is no reader or writer in server/ today (the writer wiring — append an
// event in server/routes-earnest-money.ts on every status transition — is
// a named follow-up build item, NOT this slice), and this declaration does
// not add one. The table is records-only under the constitution's
// no-platform-money-custody rule: it records state changes to deposits
// HELD BY LICENSED THIRD PARTIES (the parent earnest_money_holds names the
// external holder); amount_cents is a recorded fact about someone else's
// escrow, not a balance AcreOS holds. Append-only is enforced in the
// database by 0239's BEFORE UPDATE trigger (emd_events_no_update_trg),
// not by this declaration.
// ============================================================================

import { pgTable, varchar, integer, uuid, text, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, earnestMoneyHolds } from "../schema";

export const earnestMoneyEvents = pgTable(
  "earnest_money_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    holdId: uuid("hold_id")
      .references(() => earnestMoneyHolds.id, { onDelete: "cascade" })
      .notNull(),
    /** Transition source state; null for the initial 'recorded' event. */
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    /** The deposit amount the transition concerns, in cents (a recorded fact about a third party's escrow). */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Clerk user id of the actor who made the transition, when known. */
    actorUserId: text("actor_user_id"),
    actorIp: text("actor_ip"),
    actorUa: text("actor_ua"),
    justification: text("justification"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("emd_events_hold_idx").on(table.holdId, table.occurredAt),
    index("emd_events_org_idx").on(table.organizationId, table.occurredAt),
  ]
);

export type EarnestMoneyEvent = typeof earnestMoneyEvents.$inferSelect;
export type InsertEarnestMoneyEvent = typeof earnestMoneyEvents.$inferInsert;
