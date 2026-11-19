// ============================================================================
// SHARED/SCHEMA/PUSH-SUBSCRIPTIONS.TS — web-push endpoint registry.
// ----------------------------------------------------------------------------
// Census cure (2026-11-18): this table was LIVE but unmodelled. It is created
// on the release path by the item-0006 mirror block in scripts/migrate.mjs
// (byte-mirrored from migrations/0006_goals_portfolio_push.sql) and read /
// written by raw SQL in server/routes-organization.ts (subscribe /
// unsubscribe), server/services/pushNotificationService.ts and
// server/services/orgPushFanout.ts. Because no pgTable modelled it, the
// staging schema census counted it as undeclared residue (20 vs tolerance
// 19) after the 0006 mirror first created it on staging.
//
// This declaration models the table EXACTLY as the 0006 CREATE defines it —
// same columns, types, defaults, the endpoint UNIQUE constraint, and the
// organization FK with ON DELETE CASCADE — and is inert at runtime: the
// existing raw-SQL paths are unchanged and do not read this declaration.
// ============================================================================

import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { organizations } from "../schema";

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    /** Clerk user id of the subscription's owner. */
    userId: text("user_id").notNull(),
    /** Web-push endpoint URL — one row per endpoint (UNIQUE in the 0006 CREATE). */
    endpoint: text("endpoint").notNull().unique("push_subscriptions_endpoint_key"),
    /** The subscription's p256dh key. */
    p256dh: text("p256dh").notNull(),
    /** The subscription's auth secret. */
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("push_subscriptions_org_idx").on(table.organizationId),
    index("push_subscriptions_user_idx").on(table.userId),
  ]
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;
